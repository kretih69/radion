import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type SyntheticEvent,
} from "react";
import type { Station } from "@radion2/shared";
import type { PlayerStatus } from "./useRadioPlayer";

type PlayerBarProps = {
  station: Station | null;
  status: PlayerStatus;
  error: string | null;
  volume: number;
  isFavorite: boolean;
  onToggle: () => void;
  onStop: () => void;
  onVolume: (event: SyntheticEvent<HTMLInputElement>) => void;
  onToggleFavorite: () => void;
};

function tagList(tags: string): string[] {
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function MarqueeTitle({ text }: { text: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLHeadingElement>(null);
  const [distance, setDistance] = useState(0);

  useEffect(() => {
    const wrap = wrapRef.current;
    const title = textRef.current;
    if (!wrap || !title) return;

    function measure() {
      if (!wrap || !title) return;
      const overflow = title.scrollWidth - wrap.clientWidth;
      setDistance(overflow > 4 ? overflow : 0);
    }

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    observer.observe(title);
    return () => observer.disconnect();
  }, [text]);

  const style =
    distance > 0
      ? ({
          "--marquee-distance": `-${distance}px`,
          "--marquee-duration": `${Math.max(8, distance / 18)}s`,
        } as CSSProperties)
      : undefined;

  return (
    <div className="player__title-wrap" ref={wrapRef}>
      <h2
        ref={textRef}
        className={`player__title ${distance > 0 ? "is-marquee" : ""}`}
        style={style}
        title={text}
      >
        {text}
      </h2>
    </div>
  );
}

export function PlayerBar({
  station,
  status,
  error,
  volume,
  isFavorite,
  onToggle,
  onStop,
  onVolume,
  onToggleFavorite,
}: PlayerBarProps) {
  if (!station) {
    return (
      <footer className="player player--empty">
        <p>Select a station to start listening</p>
      </footer>
    );
  }

  const label =
    status === "loading"
      ? "Tuning…"
      : status === "error"
        ? "Signal lost"
        : status === "paused"
          ? "Paused"
          : "On air";

  const tags = tagList(station.tags);

  return (
    <footer className="player">
      <div className="player__dial" aria-hidden>
        <span className={`player__pulse ${status === "playing" ? "is-on" : ""}`} />
      </div>
      <div className="player__info">
        <p className="player__status">{label}</p>
        <MarqueeTitle text={station.name} />
        <p className="player__detail">
          {[station.country, station.language, station.codec]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {tags.length > 0 && (
          <div className="player__tags" aria-label="Station tags">
            {tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        )}
        {error && <p className="player__error">{error}</p>}
      </div>
      <div className="player__controls">
        <button
          type="button"
          className={`player__fav ${isFavorite ? "is-on" : ""}`}
          onClick={onToggleFavorite}
          aria-label={isFavorite ? "Remove favorite" : "Save favorite"}
          aria-pressed={isFavorite}
        >
          ★
        </button>
        <button type="button" className="player__btn" onClick={onToggle}>
          {status === "playing" ? "Pause" : "Play"}
        </button>
        <button type="button" className="player__btn player__btn--ghost" onClick={onStop}>
          Stop
        </button>
        <label className="player__vol">
          <span>Vol</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={onVolume}
          />
        </label>
      </div>
    </footer>
  );
}
