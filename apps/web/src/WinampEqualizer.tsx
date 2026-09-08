import { useCallback, useRef } from "react";
import { EQ_BANDS, EQ_MAX_DB, EQ_MIN_DB } from "./eqBands";

type WinampEqualizerProps = {
  values: number[];
  enabled: boolean;
  onChange: (index: number, value: number) => void;
  onToggleEnabled: () => void;
  onReset: () => void;
};

function valueFromPointer(
  clientY: number,
  track: HTMLElement,
): number {
  const rect = track.getBoundingClientRect();
  const ratio = 1 - (clientY - rect.top) / rect.height;
  const raw = EQ_MIN_DB + ratio * (EQ_MAX_DB - EQ_MIN_DB);
  const clamped = Math.min(EQ_MAX_DB, Math.max(EQ_MIN_DB, raw));
  return Math.round(clamped * 2) / 2;
}

function EqSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const setFromEvent = useCallback(
    (clientY: number) => {
      const track = trackRef.current;
      if (!track) return;
      onChange(valueFromPointer(clientY, track));
    },
    [onChange],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    setFromEvent(event.clientY);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    setFromEvent(event.clientY);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const t = (value - EQ_MIN_DB) / (EQ_MAX_DB - EQ_MIN_DB);

  return (
    <div className="winamp-eq__band">
      <div
        ref={trackRef}
        className="winamp-eq__track"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={EQ_MIN_DB}
        aria-valuemax={EQ_MAX_DB}
        aria-valuenow={value}
        aria-valuetext={`${value} dB`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowRight") {
            event.preventDefault();
            onChange(Math.min(EQ_MAX_DB, value + 0.5));
          } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
            event.preventDefault();
            onChange(Math.max(EQ_MIN_DB, value - 0.5));
          } else if (event.key === "Home") {
            event.preventDefault();
            onChange(EQ_MAX_DB);
          } else if (event.key === "End") {
            event.preventDefault();
            onChange(EQ_MIN_DB);
          }
        }}
      >
        <span className="winamp-eq__groove" aria-hidden />
        <span
          className="winamp-eq__thumb"
          aria-hidden
          style={{ bottom: `calc(${t * 100}% - 0.26rem)` }}
        />
      </div>
      <span className="winamp-eq__label">{label}</span>
    </div>
  );
}

export function WinampEqualizer({
  values,
  enabled,
  onChange,
  onToggleEnabled,
  onReset,
}: WinampEqualizerProps) {
  const preamp = EQ_BANDS[0];
  const bands = EQ_BANDS.slice(1);

  return (
    <section className={`winamp-eq ${enabled ? "is-on" : ""}`} aria-label="Equalizer">
      <div className="winamp-eq__header">
        <div className="winamp-eq__title">EQUALIZER</div>
        <div className="winamp-eq__actions">
          <button
            type="button"
            className={`winamp-eq__btn ${enabled ? "is-on" : ""}`}
            aria-pressed={enabled}
            onClick={onToggleEnabled}
          >
            ON
          </button>
          <button type="button" className="winamp-eq__btn" onClick={onReset}>
            RESET
          </button>
        </div>
      </div>
      <div className={`winamp-eq__body ${enabled ? "" : "is-bypassed"}`}>
        {preamp && (
          <EqSlider
            label={preamp.label}
            value={values[0] ?? 0}
            onChange={(value) => onChange(0, value)}
          />
        )}

        <div className="winamp-eq__scale" aria-hidden>
          <div className="winamp-eq__scale-rail">
            <span className="winamp-eq__scale-max">+12</span>
            <span className="winamp-eq__scale-mid">
              <i />
              0
              <i />
            </span>
            <span className="winamp-eq__scale-min">-12</span>
          </div>
          <span className="winamp-eq__label winamp-eq__label--spacer">
            &nbsp;
          </span>
        </div>

        <div className="winamp-eq__bands">
          {bands.map((band, index) => (
            <EqSlider
              key={band.id}
              label={band.label}
              value={values[index + 1] ?? 0}
              onChange={(value) => onChange(index + 1, value)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
