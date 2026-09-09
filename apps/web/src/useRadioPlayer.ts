import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import type { Station } from "@radion2/shared";
import { loadToken } from "./auth";
import { playStation, saveLastPlayed } from "./api";
import { apiUrl } from "./config";
import { DecodedAudioStream } from "./decodedAudioStream";
import { dbToGain, EQ_BANDS, EQ_DEFAULT } from "./eqBands";
import { isWebKit } from "./isWebKit";

export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "error";

function isAutoplayBlocked(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "NotAllowedError" || error.name === "NotSupportedError")
  );
}

function playbackErrorMessage(_error: unknown): string {
  return "Playback failed, try again";
}

function streamProxyUrl(uuid: string): string {
  return apiUrl(
    `/api/stations/${encodeURIComponent(uuid)}/stream?ts=${Date.now()}`,
  );
}

/**
 * Safari: `crossOrigin="anonymous"` forces a CORS check even for same-origin
 * Vite-proxied `/api/...` streams. Only enable CORS mode for real cross-origin APIs.
 */
function applyStreamCorsMode(audio: HTMLAudioElement, streamUrl: string): void {
  try {
    const absolute = new URL(streamUrl, window.location.href);
    if (absolute.origin !== window.location.origin) {
      audio.crossOrigin = "anonymous";
    } else {
      audio.removeAttribute("crossorigin");
    }
  } catch {
    audio.crossOrigin = "anonymous";
  }
}

async function persistLastPlayed(station: Station): Promise<void> {
  if (!loadToken()) return;
  try {
    await saveLastPlayed(station);
  } catch {
    // Non-blocking — playback should continue even if persistence fails
  }
}

export function useRadioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const preampRef = useRef<GainNode | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const filtersRef = useRef<BiquadFilterNode[]>([]);
  const decodedStreamRef = useRef<DecodedAudioStream | null>(null);
  const usingDecodedRef = useRef(false);
  const stationRef = useRef<Station | null>(null);
  const wantPlayingRef = useRef(false);
  const mediaReconnectTimerRef = useRef<number | null>(null);
  const mediaReconnectAttemptRef = useRef(0);
  const waitingWatchdogRef = useRef<number | null>(null);
  const eqValuesRef = useRef<number[]>([...EQ_DEFAULT]);
  const eqEnabledRef = useRef(true);
  const volumeRef = useRef(0.85);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [eqValues, setEqValues] = useState<number[]>([...EQ_DEFAULT]);
  const [eqEnabled, setEqEnabledState] = useState(true);
  const [station, setStation] = useState<Station | null>(null);
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(0.85);

  const applyEqToGraph = useCallback((values: number[], enabled = eqEnabledRef.current) => {
    const flat = enabled ? values : EQ_DEFAULT;
    const preamp = preampRef.current;
    if (preamp) {
      preamp.gain.value = dbToGain(flat[0] ?? 0);
    }
    filtersRef.current.forEach((filter, index) => {
      filter.gain.value = flat[index + 1] ?? 0;
    });
  }, []);

  const applyMasterVolume = useCallback((value: number) => {
    volumeRef.current = value;
    if (masterGainRef.current) {
      masterGainRef.current.gain.value = value;
    }
    // Media-element path still uses element volume when MES is inactive.
    if (audioRef.current && !usingDecodedRef.current && !sourceRef.current) {
      audioRef.current.volume = value;
    } else if (audioRef.current && sourceRef.current) {
      audioRef.current.volume = 1;
    }
  }, []);

  const setupAudioGraph = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return null;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return null;

    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      audioContextRef.current = new AudioCtx();
      sourceRef.current = null;
      analyserNodeRef.current = null;
      preampRef.current = null;
      masterGainRef.current = null;
      filtersRef.current = [];
      decodedStreamRef.current = null;
    }

    const ctx = audioContextRef.current;
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    if (!analyserNodeRef.current) {
      const node = ctx.createAnalyser();
      node.fftSize = 2048;
      node.smoothingTimeConstant = 0.55;
      node.minDecibels = -90;
      node.maxDecibels = -25;
      analyserNodeRef.current = node;
    }

    if (!masterGainRef.current) {
      const master = ctx.createGain();
      master.gain.value = volumeRef.current;
      masterGainRef.current = master;
      analyserNodeRef.current.connect(master);
      master.connect(ctx.destination);
    }

    if (!preampRef.current) {
      const preamp = ctx.createGain();
      preampRef.current = preamp;

      const filters: BiquadFilterNode[] = [];
      EQ_BANDS.slice(1).forEach((band) => {
        const filter = ctx.createBiquadFilter();
        filter.type = "peaking";
        filter.frequency.value = band.hz ?? 1000;
        filter.Q.value = 1.4;
        filters.push(filter);
      });
      filtersRef.current = filters;

      // preamp → filters… → analyser → master → destination
      let node: AudioNode = preamp;
      for (const filter of filters) {
        node.connect(filter);
        node = filter;
      }
      node.connect(analyserNodeRef.current);
    }

    applyEqToGraph(eqValuesRef.current, eqEnabledRef.current);
    setAnalyser(analyserNodeRef.current);
    return analyserNodeRef.current;
  }, [applyEqToGraph]);

  const connectMediaElementSource = useCallback(() => {
    const audio = audioRef.current;
    const ctx = audioContextRef.current;
    const preamp = preampRef.current;
    if (!audio || !ctx || !preamp || sourceRef.current) return;

    try {
      const source = ctx.createMediaElementSource(audio);
      source.connect(preamp);
      sourceRef.current = source;
      audio.volume = 1;
    } catch (err) {
      console.warn("MediaElementSource setup", err);
    }
  }, []);

  const stopDecodedStream = useCallback(async () => {
    usingDecodedRef.current = false;
    const decoded = decodedStreamRef.current;
    decodedStreamRef.current = null;
    if (decoded) await decoded.stop();
  }, []);

  const clearMediaReconnect = useCallback(() => {
    if (mediaReconnectTimerRef.current != null) {
      window.clearTimeout(mediaReconnectTimerRef.current);
      mediaReconnectTimerRef.current = null;
    }
    if (waitingWatchdogRef.current != null) {
      window.clearTimeout(waitingWatchdogRef.current);
      waitingWatchdogRef.current = null;
    }
  }, []);

  const playViaMediaElement = useCallback(
    async (url: string) => {
      const audio = audioRef.current;
      if (!audio) return;

      await stopDecodedStream();
      applyStreamCorsMode(audio, url);
      connectMediaElementSource();
      audio.src = url;
      audio.load();
      await audioContextRef.current?.resume();
      await audio.play();
      await audioContextRef.current?.resume();
    },
    [connectMediaElementSource, stopDecodedStream],
  );

  const scheduleMediaReconnect = useCallback(() => {
    if (!wantPlayingRef.current || usingDecodedRef.current) return;
    const current = stationRef.current;
    if (!current) return;
    if (mediaReconnectTimerRef.current != null) return;

    const attempt = mediaReconnectAttemptRef.current;
    mediaReconnectAttemptRef.current += 1;
    const delay = Math.min(8_000, 500 * 2 ** Math.min(attempt, 4));

    setStatus("loading");
    mediaReconnectTimerRef.current = window.setTimeout(() => {
      mediaReconnectTimerRef.current = null;
      if (!wantPlayingRef.current || usingDecodedRef.current) return;
      const station = stationRef.current;
      if (!station) return;
      void playViaMediaElement(streamProxyUrl(station.stationuuid))
        .then(() => {
          mediaReconnectAttemptRef.current = 0;
          setStatus("playing");
          setError(null);
        })
        .catch(() => {
          scheduleMediaReconnectRef.current();
        });
    }, delay);
  }, [playViaMediaElement]);

  const scheduleMediaReconnectRef = useRef(scheduleMediaReconnect);
  scheduleMediaReconnectRef.current = scheduleMediaReconnect;

  const playViaDecodedStream = useCallback(
    async (stationUuid: string) => {
      const audio = audioRef.current;
      const ctx = audioContextRef.current;
      const preamp = preampRef.current;
      if (!audio || !ctx || !preamp) {
        throw new Error("Audio graph not ready");
      }

      // Stop element playback — decoded path owns audio output.
      audio.pause();
      audio.removeAttribute("src");
      audio.load();

      usingDecodedRef.current = true;
      if (!decodedStreamRef.current) {
        decodedStreamRef.current = new DecodedAudioStream(ctx);
      }
      await ctx.resume();
      try {
        await decodedStreamRef.current.start(
          () => streamProxyUrl(stationUuid),
          preamp,
        );
      } catch (err) {
        usingDecodedRef.current = false;
        await decodedStreamRef.current.stop();
        throw err;
      }
      await ctx.resume();
    },
    [],
  );

  const setEqBand = useCallback(
    (index: number, value: number) => {
      setEqValues((current) => {
        const next = [...current];
        next[index] = value;
        eqValuesRef.current = next;
        applyEqToGraph(next, eqEnabledRef.current);
        return next;
      });
    },
    [applyEqToGraph],
  );

  const setEqEnabled = useCallback(
    (enabled: boolean) => {
      eqEnabledRef.current = enabled;
      setEqEnabledState(enabled);
      applyEqToGraph(eqValuesRef.current, enabled);
    },
    [applyEqToGraph],
  );

  const resetEq = useCallback(() => {
    const next = [...EQ_DEFAULT];
    eqValuesRef.current = next;
    setEqValues(next);
    applyEqToGraph(next, eqEnabledRef.current);
  }, [applyEqToGraph]);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "none";
    audio.volume = volumeRef.current;
    // Safari: keep the element in the document for more reliable media behavior.
    audio.setAttribute("playsinline", "true");
    audio.style.display = "none";
    document.body.appendChild(audio);
    audioRef.current = audio;

    const clearWaitingWatchdog = () => {
      if (waitingWatchdogRef.current != null) {
        window.clearTimeout(waitingWatchdogRef.current);
        waitingWatchdogRef.current = null;
      }
    };

    const onPlaying = () => {
      if (usingDecodedRef.current) return;
      clearWaitingWatchdog();
      mediaReconnectAttemptRef.current = 0;
      setStatus("playing");
      setError(null);
      void audioContextRef.current?.resume();
    };
    const onPause = () => {
      if (usingDecodedRef.current) return;
      if (!audio.src) return;
      if (!wantPlayingRef.current) {
        setStatus("paused");
      }
    };
    const onWaiting = () => {
      if (usingDecodedRef.current || !wantPlayingRef.current) return;
      setStatus("loading");
      clearWaitingWatchdog();
      // If we sit in "waiting" too long, force a fresh stream connection.
      waitingWatchdogRef.current = window.setTimeout(() => {
        waitingWatchdogRef.current = null;
        if (!wantPlayingRef.current || usingDecodedRef.current) return;
        scheduleMediaReconnectRef.current();
      }, 6_000);
    };
    const onStalled = () => {
      if (usingDecodedRef.current || !wantPlayingRef.current) return;
      scheduleMediaReconnectRef.current();
    };
    const onEnded = () => {
      if (usingDecodedRef.current || !wantPlayingRef.current) return;
      scheduleMediaReconnectRef.current();
    };
    const onError = () => {
      if (usingDecodedRef.current || !wantPlayingRef.current) return;
      scheduleMediaReconnectRef.current();
    };

    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("stalled", onStalled);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      wantPlayingRef.current = false;
      clearWaitingWatchdog();
      if (mediaReconnectTimerRef.current != null) {
        window.clearTimeout(mediaReconnectTimerRef.current);
        mediaReconnectTimerRef.current = null;
      }
      audio.pause();
      audio.removeAttribute("src");
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("stalled", onStalled);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.remove();
      void decodedStreamRef.current?.stop();
      decodedStreamRef.current = null;
      void audioContextRef.current?.close();
      audioContextRef.current = null;
      sourceRef.current = null;
      analyserNodeRef.current = null;
      preampRef.current = null;
      masterGainRef.current = null;
      filtersRef.current = [];
    };
  }, []);

  useEffect(() => {
    applyMasterVolume(volume);
  }, [applyMasterVolume, volume]);

  const play = useCallback(
    async (next: Station) => {
      const audio = audioRef.current;
      if (!audio) return;

      clearMediaReconnect();
      stationRef.current = next;
      wantPlayingRef.current = true;
      setStation(next);
      setStatus("loading");
      setError(null);

      try {
        void playStation(next.stationuuid);
        void persistLastPlayed(next);

        await setupAudioGraph();
        await audioContextRef.current?.resume();

        if (isWebKit()) {
          try {
            await playViaDecodedStream(next.stationuuid);
          } catch (decodedError) {
            if (
              decodedError instanceof DOMException &&
              decodedError.name === "AbortError"
            ) {
              return;
            }
            console.warn(
              "WebKit decoded stream failed, falling back to media element",
              decodedError,
            );
            await playViaMediaElement(streamProxyUrl(next.stationuuid));
          }
        } else {
          await playViaMediaElement(streamProxyUrl(next.stationuuid));
        }

        setStatus("playing");
      } catch (playError) {
        if (isAutoplayBlocked(playError)) {
          wantPlayingRef.current = false;
          setStatus("paused");
          setError(null);
          return;
        }

        wantPlayingRef.current = false;
        setStatus("error");
        setError(playbackErrorMessage(playError));
      }
    },
    [
      clearMediaReconnect,
      playViaDecodedStream,
      playViaMediaElement,
      setupAudioGraph,
    ],
  );

  const toggle = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !station) return;

    if (status === "playing" || (!audio.paused && !usingDecodedRef.current)) {
      wantPlayingRef.current = false;
      clearMediaReconnect();
      if (usingDecodedRef.current) {
        await stopDecodedStream();
        setStatus("paused");
        return;
      }
      audio.pause();
      setStatus("paused");
      return;
    }

    try {
      clearMediaReconnect();
      wantPlayingRef.current = true;
      stationRef.current = station;
      setStatus("loading");
      setError(null);

      await setupAudioGraph();
      void playStation(station.stationuuid);
      void persistLastPlayed(station);

      if (isWebKit()) {
        try {
          await playViaDecodedStream(station.stationuuid);
        } catch (decodedError) {
          console.warn(
            "WebKit decoded stream failed, falling back to media element",
            decodedError,
          );
          await playViaMediaElement(streamProxyUrl(station.stationuuid));
        }
      } else {
        await playViaMediaElement(streamProxyUrl(station.stationuuid));
      }

      setStatus("playing");
    } catch (playError) {
      wantPlayingRef.current = false;
      setStatus("error");
      setError(playbackErrorMessage(playError));
    }
  }, [
    clearMediaReconnect,
    playViaDecodedStream,
    playViaMediaElement,
    setupAudioGraph,
    station,
    status,
    stopDecodedStream,
  ]);

  const stop = useCallback(async () => {
    const audio = audioRef.current;
    wantPlayingRef.current = false;
    stationRef.current = null;
    clearMediaReconnect();
    await stopDecodedStream();
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setStation(null);
    setStatus("idle");
    setError(null);
  }, [clearMediaReconnect, stopDecodedStream]);

  const onVolumeInput = useCallback((event: SyntheticEvent<HTMLInputElement>) => {
    setVolume(Number(event.currentTarget.value));
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    station,
    status,
    error,
    volume,
    analyser,
    eqValues,
    eqEnabled,
    setEqBand,
    setEqEnabled,
    resetEq,
    play,
    toggle,
    stop,
    setVolume: onVolumeInput,
    clearError,
  };
}
