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

    const onPlaying = () => {
      if (usingDecodedRef.current) return;
      setStatus("playing");
      void audioContextRef.current?.resume();
    };
    const onPause = () => {
      if (usingDecodedRef.current) return;
      if (!audio.src) return;
      setStatus("paused");
    };
    const onWaiting = () => {
      if (usingDecodedRef.current) return;
      setStatus("loading");
    };
    const onError = () => {
      if (usingDecodedRef.current) return;
      setStatus("error");
      setError("Stream failed to load. Try another station.");
    };

    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("error", onError);

    return () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("waiting", onWaiting);
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
    async (url: string) => {
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
        await decodedStreamRef.current.start(url, preamp);
      } catch (err) {
        usingDecodedRef.current = false;
        await decodedStreamRef.current.stop();
        throw err;
      }
      await ctx.resume();
    },
    [],
  );

  const play = useCallback(
    async (next: Station) => {
      const audio = audioRef.current;
      if (!audio) return;

      setStation(next);
      setStatus("loading");
      setError(null);

      try {
        void playStation(next.stationuuid);
        void persistLastPlayed(next);

        const url = streamProxyUrl(next.stationuuid);
        await setupAudioGraph();
        await audioContextRef.current?.resume();

        if (isWebKit()) {
          try {
            await playViaDecodedStream(url);
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
            await playViaMediaElement(url);
          }
        } else {
          await playViaMediaElement(url);
        }

        setStatus("playing");
      } catch (playError) {
        if (isAutoplayBlocked(playError)) {
          setStatus("paused");
          setError(null);
          return;
        }

        setStatus("error");
        setError(playbackErrorMessage(playError));
      }
    },
    [playViaDecodedStream, playViaMediaElement, setupAudioGraph],
  );

  const toggle = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !station) return;

    if (status === "playing" || (!audio.paused && !usingDecodedRef.current)) {
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
      setStatus("loading");
      setError(null);

      const url = streamProxyUrl(station.stationuuid);
      await setupAudioGraph();
      void playStation(station.stationuuid);
      void persistLastPlayed(station);

      if (isWebKit()) {
        try {
          await playViaDecodedStream(url);
        } catch (decodedError) {
          console.warn(
            "WebKit decoded stream failed, falling back to media element",
            decodedError,
          );
          await playViaMediaElement(url);
        }
      } else {
        if (!audio.getAttribute("src")) {
          applyStreamCorsMode(audio, url);
          connectMediaElementSource();
          audio.src = url;
          audio.load();
        } else {
          connectMediaElementSource();
        }
        await audioContextRef.current?.resume();
        await audio.play();
        await audioContextRef.current?.resume();
      }

      setStatus("playing");
    } catch (playError) {
      setStatus("error");
      setError(playbackErrorMessage(playError));
    }
  }, [
    connectMediaElementSource,
    playViaDecodedStream,
    playViaMediaElement,
    setupAudioGraph,
    station,
    status,
    stopDecodedStream,
  ]);

  const stop = useCallback(async () => {
    const audio = audioRef.current;
    await stopDecodedStream();
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setStation(null);
    setStatus("idle");
    setError(null);
  }, [stopDecodedStream]);

  const onVolumeInput = useCallback((event: SyntheticEvent<HTMLInputElement>) => {
    setVolume(Number(event.currentTarget.value));
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
  };
}
