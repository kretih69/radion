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
import { dbToGain, EQ_BANDS, EQ_DEFAULT } from "./eqBands";

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
  const filtersRef = useRef<BiquadFilterNode[]>([]);
  const eqValuesRef = useRef<number[]>([...EQ_DEFAULT]);
  const eqEnabledRef = useRef(true);
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
      filtersRef.current = [];
    }

    const ctx = audioContextRef.current;
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    if (!analyserNodeRef.current) {
      const node = ctx.createAnalyser();
      node.fftSize = 2048;
      node.smoothingTimeConstant = 0.5;
      node.minDecibels = -90;
      node.maxDecibels = -20;
      analyserNodeRef.current = node;
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

      // source → preamp → filters… → analyser → destination
      let node: AudioNode = preamp;
      for (const filter of filters) {
        node.connect(filter);
        node = filter;
      }
      node.connect(analyserNodeRef.current);
      analyserNodeRef.current.connect(ctx.destination);
    }

    if (!sourceRef.current) {
      const source = ctx.createMediaElementSource(audio);
      source.connect(preampRef.current);
      sourceRef.current = source;
    }

    applyEqToGraph(eqValuesRef.current, eqEnabledRef.current);
    setAnalyser(analyserNodeRef.current);
    return analyserNodeRef.current;
  }, [applyEqToGraph]);

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
    audio.crossOrigin = "anonymous";
    audio.volume = volume;
    audioRef.current = audio;

    const onPlaying = () => setStatus("playing");
    const onPause = () => {
      if (!audio.src) return;
      setStatus("paused");
    };
    const onWaiting = () => setStatus("loading");
    const onError = () => {
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
      void audioContextRef.current?.close();
      audioContextRef.current = null;
      sourceRef.current = null;
      analyserNodeRef.current = null;
      preampRef.current = null;
      filtersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  const play = useCallback(
    async (next: Station) => {
      const audio = audioRef.current;
      if (!audio) return;

      try {
        await setupAudioGraph();
      } catch (err) {
        console.warn("Audio analyser setup failed", err);
      }

      setStation(next);
      setStatus("loading");
      setError(null);

      try {
        void playStation(next.stationuuid);
        void persistLastPlayed(next);

        audio.crossOrigin = "anonymous";
        audio.src = streamProxyUrl(next.stationuuid);

        await audioContextRef.current?.resume();
        await audio.play();
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
    [setupAudioGraph],
  );

  const toggle = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !station) return;

    if (audio.paused) {
      try {
        await setupAudioGraph();
        setStatus("loading");
        setError(null);

        if (!audio.getAttribute("src")) {
          audio.crossOrigin = "anonymous";
          audio.src = streamProxyUrl(station.stationuuid);
        }

        void playStation(station.stationuuid);
        void persistLastPlayed(station);
        await audioContextRef.current?.resume();
        await audio.play();
        setStatus("playing");
      } catch (playError) {
        setStatus("error");
        setError(playbackErrorMessage(playError));
      }
    } else {
      audio.pause();
      setStatus("paused");
    }
  }, [setupAudioGraph, station]);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    setStation(null);
    setStatus("idle");
    setError(null);
  }, []);

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
