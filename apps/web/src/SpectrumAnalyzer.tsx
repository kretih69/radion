import { useEffect, useRef, useState } from "react";

const BAR_COUNT = 48;
const BAR_FALL = 0.28;
/** Frames to hold a peak at its high before it starts falling. */
const PEAK_HOLD_FRAMES = 18;
/** Peak height drop per frame once hold expires (~Winamp-ish slow fall). */
const PEAK_FALL = 0.018;

type SpectrumAnalyzerProps = {
  active: boolean;
  analyser: AnalyserNode | null;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

function getFullscreenElement(): Element | null {
  const doc = document as FullscreenDocument;
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

async function requestElementFullscreen(el: HTMLElement): Promise<void> {
  const node = el as FullscreenElement;
  if (node.requestFullscreen) {
    await node.requestFullscreen();
    return;
  }
  if (node.webkitRequestFullscreen) {
    await node.webkitRequestFullscreen();
  }
}

async function exitElementFullscreen(): Promise<void> {
  const doc = document as FullscreenDocument;
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return;
  }
  if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) {
    await doc.webkitExitFullscreen();
  }
}

export function SpectrumAnalyzer({ active, analyser }: SpectrumAnalyzerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const barsRef = useRef(new Float32Array(BAR_COUNT));
  const peaksRef = useRef(new Float32Array(BAR_COUNT));
  const peakHoldRef = useRef(new Int16Array(BAR_COUNT));
  const analyserRef = useRef<AnalyserNode | null>(analyser);
  const activeRef = useRef(active);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const [expanded, setExpanded] = useState(false);

  analyserRef.current = analyser;
  activeRef.current = active;

  useEffect(() => {
    function syncFullscreen() {
      const root = rootRef.current;
      setExpanded(Boolean(root && getFullscreenElement() === root));
    }
    document.addEventListener("fullscreenchange", syncFullscreen);
    document.addEventListener("webkitfullscreenchange", syncFullscreen);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreen);
      document.removeEventListener("webkitfullscreenchange", syncFullscreen);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let raf = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };

    const readLevels = (out: Float32Array) => {
      out.fill(0);
      const node = analyserRef.current;
      if (!activeRef.current || !node) return;

      // Keep AudioContext running — Safari often suspends it in background tabs.
      const audioCtx = node.context as AudioContext;
      if (audioCtx.state === "suspended") {
        void audioCtx.resume();
      }

      const binCount = node.frequencyBinCount;
      if (!dataRef.current || dataRef.current.length !== binCount) {
        // Explicit ArrayBuffer avoids Safari TypedArray edge cases.
        dataRef.current = new Uint8Array(new ArrayBuffer(binCount));
      }
      const data = dataRef.current;
      node.getByteFrequencyData(data);

      // Non-overlapping log bands so neighboring bars don't share the same
      // coarse low-frequency bins (which made bars 2–6 move identically).
      const nyquist = node.context.sampleRate / 2;
      const minHz = 40;
      const maxHz = Math.min(16_000, nyquist * 0.92);
      const minBin = Math.max(
        1,
        Math.round((minHz / nyquist) * binCount),
      );
      const maxBin = Math.max(
        minBin + BAR_COUNT,
        Math.min(
          binCount - 1,
          Math.round((maxHz / nyquist) * binCount),
        ),
      );
      const ratio = maxBin / minBin;

      for (let i = 0; i < BAR_COUNT; i += 1) {
        const start = Math.round(minBin * ratio ** (i / BAR_COUNT));
        let end = Math.round(minBin * ratio ** ((i + 1) / BAR_COUNT));
        if (end <= start) end = start + 1;
        const from = Math.min(start, maxBin);
        const to = Math.min(Math.max(end, from + 1), maxBin + 1);

        let peak = 0;
        let sum = 0;
        let count = 0;
        for (let j = from; j < to; j += 1) {
          const value = data[j] ?? 0;
          peak = Math.max(peak, value);
          sum += value;
          count += 1;
        }
        const avg = count ? sum / count : 0;
        out[i] = Math.min(1, (peak * 0.65 + avg * 0.35) / 240);
      }
    };

    const draw = () => {
      resize();
      const { width, height } = canvas;
      const levels = new Float32Array(BAR_COUNT);
      readLevels(levels);

      const bars = barsRef.current;
      const peaks = peaksRef.current;
      const holds = peakHoldRef.current;
      for (let i = 0; i < BAR_COUNT; i += 1) {
        const next = levels[i] ?? 0;
        bars[i] = next >= bars[i] ? next : bars[i] - (bars[i] - next) * BAR_FALL;

        if (bars[i] >= peaks[i]) {
          peaks[i] = bars[i];
          holds[i] = PEAK_HOLD_FRAMES;
        } else if (holds[i] > 0) {
          holds[i] -= 1;
        } else {
          peaks[i] = Math.max(0, peaks[i] - PEAK_FALL);
        }
      }

      ctx.clearRect(0, 0, width, height);

      const padX = width * 0.04;
      const padY = height * 0.08;
      const innerW = width - padX * 2;
      const innerH = height - padY * 2;
      const gap = Math.max(1, innerW * 0.008);
      const barW = (innerW - gap * (BAR_COUNT - 1)) / BAR_COUNT;
      const segmentH = Math.max(2, height * 0.035);
      const segmentGap = Math.max(1, segmentH * 0.35);
      const step = segmentH + segmentGap;
      const maxSegments = Math.max(1, Math.floor(innerH / step));
      const peakLineH = Math.max(1, Math.round(segmentH * 0.45));

      for (let i = 0; i < BAR_COUNT; i += 1) {
        const x = padX + i * (barW + gap);
        const level = bars[i] ?? 0;
        const segments = Math.max(0, Math.round(level * maxSegments));

        for (let s = 0; s < segments; s += 1) {
          const y = padY + innerH - (s + 1) * step;
          const t = s / maxSegments;
          if (t < 0.55) ctx.fillStyle = "#3dcf4a";
          else if (t < 0.8) ctx.fillStyle = "#d4c01e";
          else ctx.fillStyle = "#e23b2f";
          ctx.fillRect(x, y, barW, segmentH);
        }

        const peakLevel = peaks[i] ?? 0;
        if (peakLevel > 0.02) {
          const peakSeg = Math.max(1, Math.round(peakLevel * maxSegments));
          const peakY = padY + innerH - peakSeg * step + (segmentH - peakLineH) / 2;
          ctx.fillStyle = "#f4f7fb";
          ctx.fillRect(x, peakY, barW, peakLineH);
        }
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  async function toggleFullscreen() {
    const root = rootRef.current;
    if (!root) return;
    try {
      if (getFullscreenElement() === root) {
        await exitElementFullscreen();
      } else {
        await requestElementFullscreen(root);
      }
    } catch (err) {
      console.warn("Fullscreen unavailable", err);
    }
  }

  const hasSignal = Boolean(analyser);

  return (
    <>
      {expanded && <div className="spectrum spectrum--slot" aria-hidden />}
      <div
        ref={rootRef}
        className={`spectrum ${active ? "is-live" : ""} ${expanded ? "is-expanded" : ""}`}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={
          expanded
            ? "Spectrum visualization, full screen. Press Escape to exit."
            : "Spectrum visualization. Activate for full screen."
        }
        onClick={() => {
          void toggleFullscreen();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void toggleFullscreen();
          }
        }}
      >
        <div className="spectrum__label">
          <span>SPECTRUM</span>
          <em>{active ? (hasSignal ? "LIVE" : "WAIT") : "IDLE"}</em>
        </div>
        <canvas ref={canvasRef} className="spectrum__canvas" />
        {expanded && (
          <span className="spectrum__hint" aria-hidden>
            Click or Esc to exit full screen
          </span>
        )}
      </div>
    </>
  );
}
