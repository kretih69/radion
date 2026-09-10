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

/** Enhanced = proxy + Web Audio (spectrum/EQ). Direct = station URL, no Railway audio. */
type PlaybackPath = "enhanced" | "direct";

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

function directStreamUrl(station: Station): string | null {
  const url = (station.url_resolved || station.url || "").trim();
  return url || null;
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

function createHiddenAudio(volume: number): HTMLAudioElement {
  const audio = new Audio();
  audio.preload = "none";
  audio.volume = volume;
  audio.setAttribute("playsinline", "true");
  audio.style.display = "none";
  document.body.appendChild(audio);
  return audio;
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
  const directAudioRef = useRef<HTMLAudioElement | null>(null);
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
  const pathRef = useRef<PlaybackPath>("enhanced");
  const switchingPathRef = useRef(false);
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
      // Mute Web Audio output while on the direct background path.
      masterGainRef.current.gain.value =
        pathRef.current === "direct" ? 0 : value;
    }
    if (audioRef.current) {
      audioRef.current.volume =
        sourceRef.current || usingDecodedRef.current ? 1 : value;
    }
    if (directAudioRef.current) {
      directAudioRef.current.volume = value;
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

  const stopProxyAudio = useCallback(async () => {
    clearMediaReconnect();
    await stopDecodedStream();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    if (masterGainRef.current) {
      masterGainRef.current.gain.value = 0;
    }
  }, [clearMediaReconnect, stopDecodedStream]);

  const stopDirectAudio = useCallback(() => {
    const direct = directAudioRef.current;
    if (!direct) return;
    direct.pause();
    direct.removeAttribute("src");
    direct.load();
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

  const playViaDecodedStream = useCallback(
    async (stationUuid: string) => {
      const audio = audioRef.current;
      const ctx = audioContextRef.current;
      const preamp = preampRef.current;
      if (!audio || !ctx || !preamp) {
        throw new Error("Audio graph not ready");
      }

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

  const playEnhanced = useCallback(
    async (next: Station) => {
      pathRef.current = "enhanced";
      stopDirectAudio();
      await setupAudioGraph();
      await audioContextRef.current?.resume();
      if (masterGainRef.current) {
        masterGainRef.current.gain.value = volumeRef.current;
      }

      if (isWebKit()) {
        try {
          await playViaDecodedStream(next.stationuuid);
          return;
        } catch (decodedError) {
          if (
            decodedError instanceof DOMException &&
            decodedError.name === "AbortError"
          ) {
            throw decodedError;
          }
          console.warn(
            "WebKit decoded stream failed, falling back to media element",
            decodedError,
          );
        }
      }
      await playViaMediaElement(streamProxyUrl(next.stationuuid));
    },
    [playViaDecodedStream, playViaMediaElement, setupAudioGraph, stopDirectAudio],
  );

  const playDirect = useCallback(
    async (next: Station) => {
      const direct = directAudioRef.current;
      const url = directStreamUrl(next);
      if (!direct || !url) {
        // No direct URL — keep enhanced path.
        await playEnhanced(next);
        return;
      }

      pathRef.current = "direct";
      await stopProxyAudio();
      direct.removeAttribute("crossorigin");
      direct.volume = volumeRef.current;
      direct.src = url;
      direct.load();
      await direct.play();
    },
    [playEnhanced, stopProxyAudio],
  );

  const playForVisibility = useCallback(
    async (next: Station) => {
      if (document.hidden) {
        await playDirect(next);
      } else {
        await playEnhanced(next);
      }
    },
    [playDirect, playEnhanced],
  );

  const scheduleMediaReconnect = useCallback(() => {
    if (!wantPlayingRef.current) return;
    if (pathRef.current !== "enhanced") return;
    if (usingDecodedRef.current) return;
    if (document.hidden) return;
    const current = stationRef.current;
    if (!current) return;
    if (mediaReconnectTimerRef.current != null) return;

    const attempt = mediaReconnectAttemptRef.current;
    mediaReconnectAttemptRef.current += 1;
    const delay = Math.min(8_000, 500 * 2 ** Math.min(attempt, 4));

    setStatus("loading");
    mediaReconnectTimerRef.current = window.setTimeout(() => {
      mediaReconnectTimerRef.current = null;
      if (!wantPlayingRef.current || pathRef.current !== "enhanced") return;
      if (document.hidden) return;
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

  const scheduleDirectReconnect = useCallback(() => {
    if (!wantPlayingRef.current || pathRef.current !== "direct") return;
    const current = stationRef.current;
    if (!current) return;
    if (mediaReconnectTimerRef.current != null) return;

    const attempt = mediaReconnectAttemptRef.current;
    mediaReconnectAttemptRef.current += 1;
    const delay = Math.min(8_000, 500 * 2 ** Math.min(attempt, 4));

    setStatus("loading");
    mediaReconnectTimerRef.current = window.setTimeout(() => {
      mediaReconnectTimerRef.current = null;
      if (!wantPlayingRef.current || pathRef.current !== "direct") return;
      const station = stationRef.current;
      if (!station) return;
      void playDirect(station)
        .then(() => {
          mediaReconnectAttemptRef.current = 0;
          setStatus("playing");
          setError(null);
        })
        .catch(() => {
          scheduleDirectReconnectRef.current();
        });
    }, delay);
  }, [playDirect]);

  const scheduleDirectReconnectRef = useRef(scheduleDirectReconnect);
  scheduleDirectReconnectRef.current = scheduleDirectReconnect;

  const syncPathToVisibility = useCallback(async () => {
    if (!wantPlayingRef.current || !stationRef.current) return;
    if (switchingPathRef.current) return;

    const wantDirect = document.hidden;
    const nextPath: PlaybackPath = wantDirect ? "direct" : "enhanced";
    if (pathRef.current === nextPath) return;

    switchingPathRef.current = true;
    clearMediaReconnect();
    setStatus("loading");
    try {
      await playForVisibility(stationRef.current);
      setStatus("playing");
      setError(null);
    } catch (err) {
      if (isAutoplayBlocked(err)) {
        // Background resume can be blocked; keep trying enhanced on focus.
        if (!document.hidden) {
          setStatus("paused");
          wantPlayingRef.current = false;
        }
        return;
      }
      // If direct fails (bad station URL), fall back to enhanced even in background.
      if (wantDirect) {
        try {
          await playEnhanced(stationRef.current);
          setStatus("playing");
          setError(null);
          return;
        } catch {
          // fall through
        }
      }
      setStatus("error");
      setError(playbackErrorMessage(err));
    } finally {
      switchingPathRef.current = false;
    }
  }, [clearMediaReconnect, playEnhanced, playForVisibility]);

  const syncPathToVisibilityRef = useRef(syncPathToVisibility);
  syncPathToVisibilityRef.current = syncPathToVisibility;

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
    const audio = createHiddenAudio(volumeRef.current);
    const direct = createHiddenAudio(volumeRef.current);
    audioRef.current = audio;
    directAudioRef.current = direct;

    const clearWaitingWatchdog = () => {
      if (waitingWatchdogRef.current != null) {
        window.clearTimeout(waitingWatchdogRef.current);
        waitingWatchdogRef.current = null;
      }
    };

    const onProxyPlaying = () => {
      if (pathRef.current !== "enhanced" || usingDecodedRef.current) return;
      clearWaitingWatchdog();
      mediaReconnectAttemptRef.current = 0;
      setStatus("playing");
      setError(null);
      void audioContextRef.current?.resume();
    };
    const onProxyPause = () => {
      if (pathRef.current !== "enhanced" || usingDecodedRef.current) return;
      if (!audio.src) return;
      if (!wantPlayingRef.current) setStatus("paused");
    };
    const onProxyWaiting = () => {
      if (pathRef.current !== "enhanced" || usingDecodedRef.current) return;
      if (!wantPlayingRef.current) return;
      setStatus("loading");
      clearWaitingWatchdog();
      waitingWatchdogRef.current = window.setTimeout(() => {
        waitingWatchdogRef.current = null;
        if (!wantPlayingRef.current || pathRef.current !== "enhanced") return;
        scheduleMediaReconnectRef.current();
      }, 6_000);
    };
    const onProxyStalled = () => {
      if (pathRef.current !== "enhanced" || usingDecodedRef.current) return;
      if (!wantPlayingRef.current) return;
      scheduleMediaReconnectRef.current();
    };
    const onProxyEnded = () => {
      if (pathRef.current !== "enhanced" || usingDecodedRef.current) return;
      if (!wantPlayingRef.current) return;
      scheduleMediaReconnectRef.current();
    };
    const onProxyError = () => {
      if (pathRef.current !== "enhanced" || usingDecodedRef.current) return;
      if (!wantPlayingRef.current) return;
      scheduleMediaReconnectRef.current();
    };

    const onDirectPlaying = () => {
      if (pathRef.current !== "direct") return;
      mediaReconnectAttemptRef.current = 0;
      setStatus("playing");
      setError(null);
    };
    const onDirectPause = () => {
      if (pathRef.current !== "direct") return;
      if (!direct.src) return;
      if (!wantPlayingRef.current) setStatus("paused");
    };
    const onDirectWaiting = () => {
      if (pathRef.current !== "direct" || !wantPlayingRef.current) return;
      setStatus("loading");
    };
    const onDirectError = () => {
      if (pathRef.current !== "direct" || !wantPlayingRef.current) return;
      scheduleDirectReconnectRef.current();
    };
    const onDirectEnded = () => {
      if (pathRef.current !== "direct" || !wantPlayingRef.current) return;
      scheduleDirectReconnectRef.current();
    };

    const onVisibility = () => {
      void syncPathToVisibilityRef.current();
    };

    audio.addEventListener("playing", onProxyPlaying);
    audio.addEventListener("pause", onProxyPause);
    audio.addEventListener("waiting", onProxyWaiting);
    audio.addEventListener("stalled", onProxyStalled);
    audio.addEventListener("ended", onProxyEnded);
    audio.addEventListener("error", onProxyError);

    direct.addEventListener("playing", onDirectPlaying);
    direct.addEventListener("pause", onDirectPause);
    direct.addEventListener("waiting", onDirectWaiting);
    direct.addEventListener("ended", onDirectEnded);
    direct.addEventListener("error", onDirectError);

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      wantPlayingRef.current = false;
      clearWaitingWatchdog();
      if (mediaReconnectTimerRef.current != null) {
        window.clearTimeout(mediaReconnectTimerRef.current);
        mediaReconnectTimerRef.current = null;
      }
      document.removeEventListener("visibilitychange", onVisibility);

      audio.pause();
      audio.removeAttribute("src");
      audio.removeEventListener("playing", onProxyPlaying);
      audio.removeEventListener("pause", onProxyPause);
      audio.removeEventListener("waiting", onProxyWaiting);
      audio.removeEventListener("stalled", onProxyStalled);
      audio.removeEventListener("ended", onProxyEnded);
      audio.removeEventListener("error", onProxyError);
      audio.remove();

      direct.pause();
      direct.removeAttribute("src");
      direct.removeEventListener("playing", onDirectPlaying);
      direct.removeEventListener("pause", onDirectPause);
      direct.removeEventListener("waiting", onDirectWaiting);
      direct.removeEventListener("ended", onDirectEnded);
      direct.removeEventListener("error", onDirectError);
      direct.remove();

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
      if (!audioRef.current || !directAudioRef.current) return;

      clearMediaReconnect();
      stationRef.current = next;
      wantPlayingRef.current = true;
      setStation(next);
      setStatus("loading");
      setError(null);

      try {
        void playStation(next.stationuuid);
        void persistLastPlayed(next);
        await playForVisibility(next);
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
    [clearMediaReconnect, playForVisibility],
  );

  const toggle = useCallback(async () => {
    if (!audioRef.current || !directAudioRef.current || !station) return;

    const isPlaying =
      status === "playing" ||
      (!audioRef.current.paused && pathRef.current === "enhanced") ||
      (!directAudioRef.current.paused && pathRef.current === "direct") ||
      (usingDecodedRef.current && pathRef.current === "enhanced");

    if (isPlaying) {
      wantPlayingRef.current = false;
      clearMediaReconnect();
      await stopDecodedStream();
      audioRef.current.pause();
      directAudioRef.current.pause();
      setStatus("paused");
      return;
    }

    try {
      clearMediaReconnect();
      wantPlayingRef.current = true;
      stationRef.current = station;
      setStatus("loading");
      setError(null);

      void playStation(station.stationuuid);
      void persistLastPlayed(station);
      await playForVisibility(station);
      setStatus("playing");
    } catch (playError) {
      wantPlayingRef.current = false;
      setStatus("error");
      setError(playbackErrorMessage(playError));
    }
  }, [
    clearMediaReconnect,
    playForVisibility,
    station,
    status,
    stopDecodedStream,
  ]);

  const stop = useCallback(async () => {
    wantPlayingRef.current = false;
    stationRef.current = null;
    pathRef.current = "enhanced";
    clearMediaReconnect();
    await stopDecodedStream();
    stopDirectAudio();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    if (masterGainRef.current) {
      masterGainRef.current.gain.value = volumeRef.current;
    }
    setStation(null);
    setStatus("idle");
    setError(null);
  }, [clearMediaReconnect, stopDecodedStream, stopDirectAudio]);

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
