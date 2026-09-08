import { useEffect, useRef } from "react";

const BAR_COUNT = 24;
const BAR_FALL = 0.28;
/** Frames to hold a peak at its high before it starts falling. */
const PEAK_HOLD_FRAMES = 18;
/** Peak height drop per frame once hold expires (~Winamp-ish slow fall). */
const PEAK_FALL = 0.018;

type SpectrumAnalyzerProps = {
  active: boolean;
  analyser: AnalyserNode | null;
};

export function SpectrumAnalyzer({ active, analyser }: SpectrumAnalyzerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const barsRef = useRef(new Float32Array(BAR_COUNT));
  const peaksRef = useRef(new Float32Array(BAR_COUNT));
  const peakHoldRef = useRef(new Int16Array(BAR_COUNT));
  const analyserRef = useRef<AnalyserNode | null>(analyser);
  const activeRef = useRef(active);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  analyserRef.current = analyser;
  activeRef.current = active;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
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

      if (!dataRef.current || dataRef.current.length !== node.frequencyBinCount) {
        dataRef.current = new Uint8Array(node.frequencyBinCount);
      }
      const data = dataRef.current;
      node.getByteFrequencyData(data);

      const binCount = data.length;
      for (let i = 0; i < BAR_COUNT; i += 1) {
        const start = Math.floor((i / BAR_COUNT) ** 1.55 * binCount);
        const end = Math.floor(((i + 1) / BAR_COUNT) ** 1.55 * binCount);
        let peak = 0;
        let sum = 0;
        let count = 0;
        for (let j = start; j < Math.max(start + 1, end); j += 1) {
          const value = data[j] ?? 0;
          peak = Math.max(peak, value);
          sum += value;
          count += 1;
        }
        const avg = count ? sum / count : 0;
        out[i] = Math.min(1, (peak * 0.7 + avg * 0.3) / 240);
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
      const gap = innerW * 0.028;
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

  const hasSignal = Boolean(analyser);

  return (
    <div
      className={`spectrum ${active ? "is-live" : ""}`}
      aria-hidden={!active}
      aria-label={active ? "Frequency visualization" : undefined}
    >
      <div className="spectrum__label">
        <span>SPECTRUM</span>
        <em>{active ? (hasSignal ? "LIVE" : "WAIT") : "IDLE"}</em>
      </div>
      <canvas ref={canvasRef} className="spectrum__canvas" />
    </div>
  );
}
