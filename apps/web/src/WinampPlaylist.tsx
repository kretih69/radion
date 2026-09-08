import type { Station } from "@radion2/shared";

type WinampPlaylistProps = {
  stations: Station[];
  activeUuid: string | null;
  loggedIn: boolean;
  onPlay: (station: Station) => void;
};

function metaLabel(station: Station): string {
  if (station.bitrate > 0) return `${station.bitrate}`;
  if (station.countrycode) return station.countrycode;
  return "--";
}

export function WinampPlaylist({
  stations,
  activeUuid,
  loggedIn,
  onPlay,
}: WinampPlaylistProps) {
  return (
    <section className="winamp-pl" aria-label="Favorites playlist">
      <div className="winamp-pl__title">PLAYLIST</div>
      <div className="winamp-pl__list" role="list">
        {!loggedIn && (
          <p className="winamp-pl__empty">Log in to sync favorites</p>
        )}
        {loggedIn && stations.length === 0 && (
          <p className="winamp-pl__empty">No favorites yet</p>
        )}
        {stations.map((station, index) => {
          const active = station.stationuuid === activeUuid;
          return (
            <button
              key={station.stationuuid}
              type="button"
              role="listitem"
              className={`winamp-pl__row ${active ? "is-active" : ""}`}
              onClick={() => onPlay(station)}
              aria-current={active ? "true" : undefined}
              title={station.name}
            >
              <span className="winamp-pl__name">
                {index + 1}. {station.name}
              </span>
              <span className="winamp-pl__meta">{metaLabel(station)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
