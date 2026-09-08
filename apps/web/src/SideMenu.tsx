import { useEffect, useRef, useState } from "react";
import type { AuthUser, Station } from "@radion2/shared";
import { initialsFor } from "./auth";
import { SpectrumAnalyzer } from "./SpectrumAnalyzer";
import { WinampEqualizer } from "./WinampEqualizer";
import { WinampPlaylist } from "./WinampPlaylist";
import type { PlayerStatus } from "./useRadioPlayer";

export type NavId = "discover" | "favorites" | "preferences";

/** Progressive collapse when sidebar height is tight. */
type VizMode = "full" | "no-eq" | "spectrum" | "none";

type SideMenuProps = {
  mode: NavId;
  favoriteCount: number;
  favoriteStations: Station[];
  user: AuthUser | null;
  open: boolean;
  playerStatus: PlayerStatus;
  playingUuid: string | null;
  analyser: AnalyserNode | null;
  eqValues: number[];
  eqEnabled: boolean;
  onEqChange: (index: number, value: number) => void;
  onEqToggle: () => void;
  onEqReset: () => void;
  onNavigate: (mode: NavId) => void;
  onClose: () => void;
  onLogout: () => void;
  onLogin: () => void;
  onPlay: (station: Station) => void;
  onPlayRandom: () => void;
  playRandomLoading?: boolean;
};

function pickVizMode(availablePx: number, rem: number): VizMode {
  const gap = 0.65 * rem;
  const spacer = 1.1 * rem;
  const spectrum = 6.6 * rem;
  const eq = 7.9 * rem;
  const playlist = 7.4 * rem;

  const stack = (...heights: number[]) =>
    spacer +
    heights.reduce((sum, h) => sum + h, 0) +
    Math.max(0, heights.length - 1) * gap;

  if (availablePx >= stack(spectrum, eq, playlist)) return "full";
  if (availablePx >= stack(spectrum, playlist)) return "no-eq";
  if (availablePx >= stack(spectrum)) return "spectrum";
  return "none";
}

export function SideMenu({
  mode,
  favoriteCount,
  favoriteStations,
  user,
  open,
  playerStatus,
  playingUuid,
  analyser,
  eqValues,
  eqEnabled,
  onEqChange,
  onEqToggle,
  onEqReset,
  onNavigate,
  onClose,
  onLogout,
  onLogin,
  onPlay,
  onPlayRandom,
  playRandomLoading = false,
}: SideMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [vizMode, setVizMode] = useState<VizMode>("full");
  const profileRef = useRef<HTMLDivElement>(null);
  const vizRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!profileRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    if (!user) setMenuOpen(false);
  }, [user]);

  useEffect(() => {
    const root = vizRef.current;
    if (!root) return;

    const update = () => {
      const rem = Number.parseFloat(getComputedStyle(root).fontSize) || 16;
      const next = pickVizMode(root.clientHeight, rem);
      setVizMode((prev) => (prev === next ? prev : next));
    };

    const observer = new ResizeObserver(update);
    observer.observe(root);
    update();
    return () => observer.disconnect();
  }, []);

  const showSpacer = vizMode !== "none";
  const showSpectrum = vizMode !== "none";
  const showEq = vizMode === "full";
  const showPlaylist = vizMode === "full" || vizMode === "no-eq";

  return (
    <>
      <button
        type="button"
        className={`sidebar-backdrop ${open ? "is-open" : ""}`}
        aria-label="Close menu"
        onClick={onClose}
      />

      <aside className={`sidebar ${open ? "is-open" : ""}`} aria-label="Main menu">
        <div className="sidebar__brand">
          <span className="sidebar__logo">RadiOn2</span>
          <span className="sidebar__tag">Station browser</span>
        </div>

        <div className="sidebar__scroll">
          <nav className="sidebar__nav">
            <button
              type="button"
              className={`sidebar__nav-btn ${mode === "discover" ? "is-on" : ""}`}
              onClick={() => {
                onNavigate("discover");
                onClose();
              }}
            >
              <span aria-hidden>◈</span>
              Discover
            </button>
            <button
              type="button"
              className={`sidebar__nav-btn ${mode === "favorites" ? "is-on" : ""}`}
              onClick={() => {
                onNavigate("favorites");
                onClose();
              }}
            >
              <span aria-hidden>★</span>
              Favorites
              <em>{favoriteCount}</em>
            </button>
            {user && (
              <button
                type="button"
                className={`sidebar__nav-btn ${mode === "preferences" ? "is-on" : ""}`}
                onClick={() => {
                  onNavigate("preferences");
                  onClose();
                }}
              >
                <span aria-hidden>◎</span>
                My Preferences
              </button>
            )}
          </nav>
        </div>

        <div className="sidebar__viz" ref={vizRef} data-viz-mode={vizMode}>
          {showSpacer && <div className="sidebar__viz-spacer" aria-hidden />}
          {showSpectrum && (
            <SpectrumAnalyzer
              active={playerStatus === "playing"}
              analyser={analyser}
            />
          )}
          {showEq && (
            <WinampEqualizer
              values={eqValues}
              enabled={eqEnabled}
              onChange={onEqChange}
              onToggleEnabled={onEqToggle}
              onReset={onEqReset}
            />
          )}
          {showPlaylist && (
            <WinampPlaylist
              stations={favoriteStations}
              activeUuid={playingUuid}
              loggedIn={Boolean(user)}
              onPlay={onPlay}
            />
          )}
        </div>

        <div className="sidebar__footer">
          <button
            type="button"
            className="sidebar__random"
            disabled={playRandomLoading}
            onClick={() => {
              onPlayRandom();
              onClose();
            }}
          >
            {playRandomLoading ? "Finding station…" : "Play random station"}
          </button>

          <div className="sidebar__profile" ref={profileRef}>
            {user ? (
              <>
                {menuOpen && (
                  <div className="sidebar__menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      className="sidebar__logout"
                      onClick={() => {
                        setMenuOpen(false);
                        onLogout();
                        onClose();
                      }}
                    >
                      Log out
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  className={`sidebar__user ${menuOpen ? "is-open" : ""}`}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((value) => !value)}
                >
                  <span className="sidebar__avatar" aria-hidden>
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
                    ) : (
                      initialsFor(user.name)
                    )}
                  </span>
                  <span className="sidebar__user-text">
                    <strong>{user.name}</strong>
                    <span>{user.email}</span>
                  </span>
                  <span className="sidebar__caret" aria-hidden>
                    {menuOpen ? "▾" : "▴"}
                  </span>
                </button>
              </>
            ) : (
              <button
                type="button"
                className="sidebar__login"
                onClick={() => {
                  onLogin();
                  onClose();
                }}
              >
                Log in
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
