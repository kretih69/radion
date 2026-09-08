import type { Station } from "@radion2/shared";

type StationCardProps = {
  station: Station;
  isPlaying: boolean;
  isFavorite: boolean;
  onPlay: (station: Station) => void;
  onToggleFavorite: () => void;
};

function tagList(tags: string): string[] {
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 3);
}

export function StationCard({
  station,
  isPlaying,
  isFavorite,
  onPlay,
  onToggleFavorite,
}: StationCardProps) {
  const tags = tagList(station.tags);

  return (
    <article className={`station ${isPlaying ? "station--live" : ""}`}>
      <button
        type="button"
        className="station__play"
        onClick={() => onPlay(station)}
        aria-label={`Play ${station.name}`}
      >
        <span className="station__favicon" aria-hidden>
          {station.favicon ? (
            <img
              src={station.favicon}
              alt=""
              loading="lazy"
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <span className="station__fallback">
              {station.name.slice(0, 1).toUpperCase()}
            </span>
          )}
        </span>
        <span className="station__meta">
          <span className="station__name">{station.name}</span>
          <span className="station__sub">
            {[station.countrycode, station.codec, station.bitrate ? `${station.bitrate} kbps` : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {tags.length > 0 && (
            <span className="station__tags">
              {tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </span>
          )}
        </span>
        <span className={`station__wave ${isPlaying ? "is-on" : ""}`} aria-hidden>
          <i />
          <i />
          <i />
        </span>
      </button>
      <button
        type="button"
        className={`station__fav ${isFavorite ? "is-on" : ""}`}
        onClick={() => onToggleFavorite()}
        aria-label={isFavorite ? "Remove favorite" : "Save favorite"}
        aria-pressed={isFavorite}
      >
        ★
      </button>
    </article>
  );
}
