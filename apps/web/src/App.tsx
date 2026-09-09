import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { AuthUser, Country, Language, Station, Tag } from "@radion2/shared";
import {
  addFavorite,
  deleteAccount,
  getCountries,
  getFavorites,
  getGeoCountry,
  getLanguages,
  getLastClickStations,
  getLastPlayed,
  getMe,
  getPreferences,
  getPreferredStations,
  getTags,
  getTopClickStations,
  removeFavorite,
  searchStations,
} from "./api";
import {
  clearSession,
  loadAuthUser,
  loadToken,
  saveSession,
} from "./auth";
import { LoginScreen } from "./LoginScreen";
import { NoticeToast } from "./NoticeToast";
import { PlayerBar } from "./PlayerBar";
import { PreferencesPanel } from "./PreferencesPanel";
import { PrivacyPolicy } from "./PrivacyPolicy";
import { DiscoverFilters } from "./DiscoverFilters";
import { SideMenu, type NavId } from "./SideMenu";
import { StationCard } from "./StationCard";
import { Toast } from "./Toast";
import { useRadioPlayer } from "./useRadioPlayer";

type Filters = {
  name: string;
  countrycode: string;
  tag: string;
  language: string;
};

type DiscoverCategory =
  | "local"
  | "news"
  | "listening"
  | "world"
  | "world-music";

const PAGE_SIZE = 24;

const DISCOVER_CATEGORIES: { id: DiscoverCategory; label: string }[] = [
  { id: "local", label: "Most listened local stations" },
  { id: "news", label: "News" },
  { id: "listening", label: "Others are listening" },
  { id: "world", label: "Most listened world stations" },
  { id: "world-music", label: "World music" },
];

const TIMEZONE_COUNTRY: Record<string, string> = {
  "Europe/Zagreb": "HR",
  "Europe/Belgrade": "RS",
  "Europe/Ljubljana": "SI",
  "Europe/Sarajevo": "BA",
  "Europe/Podgorica": "ME",
  "Europe/Skopje": "MK",
  "Europe/Berlin": "DE",
  "Europe/Vienna": "AT",
  "Europe/Paris": "FR",
  "Europe/Rome": "IT",
  "Europe/Madrid": "ES",
  "Europe/London": "GB",
  "Europe/Amsterdam": "NL",
  "Europe/Brussels": "BE",
  "Europe/Warsaw": "PL",
  "Europe/Prague": "CZ",
  "Europe/Budapest": "HU",
  "Europe/Bucharest": "RO",
  "Europe/Sofia": "BG",
  "Europe/Athens": "GR",
  "Europe/Dublin": "IE",
  "Europe/Lisbon": "PT",
  "Europe/Zurich": "CH",
  "Europe/Stockholm": "SE",
  "Europe/Oslo": "NO",
  "Europe/Copenhagen": "DK",
  "Europe/Helsinki": "FI",
  "America/New_York": "US",
  "America/Chicago": "US",
  "America/Denver": "US",
  "America/Los_Angeles": "US",
  "America/Toronto": "CA",
  "America/Vancouver": "CA",
  "Australia/Sydney": "AU",
  "Asia/Tokyo": "JP",
};

function localeCountryFallback(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz && TIMEZONE_COUNTRY[tz]) return TIMEZONE_COUNTRY[tz];

  const candidates = [
    Intl.DateTimeFormat().resolvedOptions().locale,
    navigator.language,
    ...(navigator.languages ?? []),
  ].filter(Boolean);

  for (const locale of candidates) {
    const match = locale.match(/-([A-Za-z]{2})\b/);
    if (match?.[1]) return match[1].toUpperCase();
  }
  return "";
}

function favoriteToStation(fav: {
  stationuuid: string;
  name: string;
  favicon: string;
  countrycode: string;
  country: string;
  tags: string;
  codec: string;
  bitrate: number;
  language: string;
  url: string;
  url_resolved: string;
}): Station {
  return {
    changeuuid: "",
    stationuuid: fav.stationuuid,
    name: fav.name,
    url: fav.url,
    url_resolved: fav.url_resolved,
    homepage: "",
    favicon: fav.favicon,
    tags: fav.tags,
    country: fav.country,
    countrycode: fav.countrycode,
    state: "",
    language: fav.language,
    languagecodes: "",
    votes: 0,
    lastchangetime: "",
    lastchangetime_iso8601: null,
    codec: fav.codec,
    bitrate: fav.bitrate,
    hls: 0,
    lastcheckok: 1,
    lastchecktime: "",
    lastchecktime_iso8601: null,
    clickcount: 0,
    clicktrend: 0,
    ssl_error: 0,
    geo_lat: null,
    geo_long: null,
  };
}

type DialogState = {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm?: () => void;
};

export default function App() {
  const player = useRadioPlayer();
  const { play } = player;
  const [mode, setMode] = useState<NavId>("discover");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [playRandomLoading, setPlayRandomLoading] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(() => loadAuthUser());
  const [query, setQuery] = useState("");
  const [countrycode, setCountrycode] = useState("");
  const [tag, setTag] = useState("");
  const [language, setLanguage] = useState("");
  const [category, setCategory] = useState<DiscoverCategory | null>("local");
  const [localCountry, setLocalCountry] = useState("");
  const [stations, setStations] = useState<Station[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [favoriteStations, setFavoriteStations] = useState<Station[]>([]);
  const [preferenceTags, setPreferenceTags] = useState<string[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshFavorites = useCallback(async () => {
    if (!loadToken()) {
      setFavoriteIds([]);
      setFavoriteStations([]);
      return;
    }
    try {
      const favorites = await getFavorites();
      setFavoriteIds(favorites.map((item) => item.stationuuid));
      setFavoriteStations(favorites.map(favoriteToStation));
    } catch {
      clearSession();
      setUser(null);
      setFavoriteIds([]);
      setFavoriteStations([]);
      setPreferenceTags([]);
    }
  }, []);

  const refreshPreferences = useCallback(async () => {
    if (!loadToken()) {
      setPreferenceTags([]);
      return;
    }
    try {
      const preferences = await getPreferences();
      setPreferenceTags(preferences.tags);
    } catch {
      setPreferenceTags([]);
    }
  }, []);

  const loadCategory = useCallback(
    async (
      nextCategory: DiscoverCategory,
      nextPage: number,
      country: string,
    ) => {
      const offset = nextPage * PAGE_SIZE;
      switch (nextCategory) {
        case "local": {
          if (!country) return [];
          return searchStations({
            countrycode: country,
            order: "clickcount",
            reverse: true,
            offset,
            limit: PAGE_SIZE,
            hidebroken: true,
          });
        }
        case "news":
          return searchStations({
            tag: "news",
            tagExact: true,
            order: "votes",
            reverse: true,
            offset,
            limit: PAGE_SIZE,
            hidebroken: true,
          });
        case "listening":
          return getLastClickStations(PAGE_SIZE, offset);
        case "world":
          return getTopClickStations(PAGE_SIZE, offset);
        case "world-music":
          return searchStations({
            tag: "world music",
            tagExact: true,
            order: "votes",
            reverse: true,
            offset,
            limit: PAGE_SIZE,
            hidebroken: true,
          });
        default:
          return [];
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const token = loadToken();
        if (token) {
          try {
            const me = await getMe();
            if (!cancelled) {
              setUser(me.user);
              saveSession(me.user, token);
            }
          } catch {
            clearSession();
            if (!cancelled) setUser(null);
          }
        }

        const [geo, countryList, tagList, languageList] = await Promise.all([
          getGeoCountry().catch(() => ({ countrycode: null as string | null })),
          getCountries(),
          getTags(),
          getLanguages(40),
        ]);
        if (cancelled) return;

        const detected =
          geo.countrycode?.toUpperCase() || localeCountryFallback();
        setLocalCountry(detected);
        setCountries(countryList.slice(0, 80));
        setTags(tagList);
        setLanguages(languageList);

        const initial = await loadCategory("local", 0, detected);
        if (cancelled) return;
        if (initial.length === 0 && detected) {
          const world = await loadCategory("world", 0, detected);
          if (cancelled) return;
          setCategory("world");
          setStations(world);
          setPage(0);
          setHasMore(world.length === PAGE_SIZE);
        } else {
          setCategory("local");
          setStations(initial);
          setPage(0);
          setHasMore(initial.length === PAGE_SIZE);
        }

        await Promise.all([refreshFavorites(), refreshPreferences()]);

        if (loadToken()) {
          try {
            const { station: last } = await getLastPlayed();
            if (!cancelled && last?.stationuuid) {
              await play(favoriteToStation(last));
            }
          } catch {
            // Ignore resume failures on bootstrap
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load stations");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [loadCategory, play, refreshFavorites, refreshPreferences]);

  async function fetchStations(filters: Filters, nextPage = 0) {
    setMode("discover");
    setCategory(null);
    setLoading(true);
    setError(null);
    try {
      const offset = nextPage * PAGE_SIZE;
      const hasFilters =
        filters.name || filters.countrycode || filters.tag || filters.language;
      const results = hasFilters
        ? await searchStations({
            name: filters.name || undefined,
            countrycode: filters.countrycode || undefined,
            tag: filters.tag || undefined,
            language: filters.language || undefined,
            order: "votes",
            reverse: true,
            offset,
            limit: PAGE_SIZE,
            hidebroken: true,
          })
        : await getTopClickStations(PAGE_SIZE, offset);
      setStations(results);
      setPage(nextPage);
      setHasMore(results.length === PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  async function fetchCategory(
    nextCategory: DiscoverCategory,
    nextPage = 0,
    resetFilters = true,
  ) {
    setMode("discover");
    setCategory(nextCategory);
    if (resetFilters) {
      setQuery("");
      setCountrycode("");
      setLanguage("");
      setTag("");
    }
    setLoading(true);
    setError(null);
    try {
      if (nextCategory === "local" && !localCountry) {
        setStations([]);
        setPage(0);
        setHasMore(false);
        setError("Could not detect your country for local stations.");
        return;
      }
      const results = await loadCategory(nextCategory, nextPage, localCountry);
      setStations(results);
      setPage(nextPage);
      setHasMore(results.length === PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  const visibleStations = useMemo(
    () => (mode === "favorites" ? favoriteStations : stations),
    [mode, favoriteStations, stations],
  );

  function currentFilters(overrides: Partial<Filters> = {}): Filters {
    return {
      name: query,
      countrycode,
      tag,
      language,
      ...overrides,
    };
  }

  function runSearch(event?: FormEvent) {
    event?.preventDefault();
    void fetchStations(currentFilters({ name: query }), 0);
  }

  function changeCountry(next: string) {
    setCountrycode(next);
    setLanguage("");
    setTag("");
    void fetchStations(
      {
        name: query,
        countrycode: next,
        language: "",
        tag: "",
      },
      0,
    );
  }

  function changeLanguage(next: string) {
    setLanguage(next);
    setCountrycode("");
    setTag("");
    void fetchStations(
      {
        name: query,
        countrycode: "",
        language: next,
        tag: "",
      },
      0,
    );
  }

  function changeTag(next: string) {
    setTag(next);
    setCountrycode("");
    setLanguage("");
    void fetchStations(
      {
        name: query,
        countrycode: "",
        language: "",
        tag: next,
      },
      0,
    );
  }

  function goToPage(nextPage: number) {
    if (nextPage < 0) return;
    if (category) {
      void fetchCategory(category, nextPage, false);
    } else {
      void fetchStations(currentFilters(), nextPage);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function toggleFavorite(station: Station) {
    if (!user) {
      setDialog({
        message: "Log in to use this feature",
        confirmLabel: "OK",
        onConfirm: () => setShowLogin(true),
      });
      return;
    }

    const isFavorite = favoriteIds.includes(station.stationuuid);
    try {
      if (isFavorite) {
        await removeFavorite(station.stationuuid);
        setFavoriteIds((prev) => prev.filter((id) => id !== station.stationuuid));
        setFavoriteStations((prev) =>
          prev.filter((item) => item.stationuuid !== station.stationuuid),
        );
      } else {
        await addFavorite(station);
        setFavoriteIds((prev) => [...prev, station.stationuuid]);
        setFavoriteStations((prev) => {
          if (prev.some((item) => item.stationuuid === station.stationuuid)) {
            return prev;
          }
          return [station, ...prev];
        });
      }
    } catch (err) {
      setDialog({
        message: err instanceof Error ? err.message : "Could not update favorite",
      });
    }
  }

  async function playRandomStation() {
    if (!user) {
      setDialog({
        message: "Log in to use this feature",
        confirmLabel: "OK",
        onConfirm: () => setShowLogin(true),
      });
      return;
    }

    if (preferenceTags.length === 0) {
      setDialog({
        message: "Select your preferences first to play a random station.",
        cancelLabel: "Cancel",
        confirmLabel: "OK",
        onConfirm: () => setMode("preferences"),
      });
      return;
    }

    setPlayRandomLoading(true);
    try {
      const stations = await getPreferredStations();
      const pick = stations[Math.floor(Math.random() * stations.length)];
      if (!pick) {
        throw new Error("No stations found for your preferences");
      }
      await player.play(pick);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not play a random station";
      if (message.toLowerCase().includes("preferences")) {
        setDialog({
          message: "Select your preferences first to play a random station.",
          cancelLabel: "Cancel",
          confirmLabel: "OK",
          onConfirm: () => setMode("preferences"),
        });
      } else {
        setDialog({ message });
      }
    } finally {
      setPlayRandomLoading(false);
    }
  }

  function handleLogout() {
    clearSession();
    setUser(null);
    setFavoriteIds([]);
    setFavoriteStations([]);
    setPreferenceTags([]);
    player.stop();
    if (mode === "favorites" || mode === "preferences") setMode("discover");
  }

  function handleDeleteAccount() {
    setDialog({
      message:
        "Delete your account? This permanently removes your profile, favorites, preferences, and listening history. This cannot be undone.",
      cancelLabel: "Cancel",
      confirmLabel: "Continue",
      danger: true,
      onConfirm: () => {
        setDialog({
          message:
            "Are you absolutely sure? All of your data will be deleted forever.",
          cancelLabel: "Keep account",
          confirmLabel: "Delete my account",
          danger: true,
          onConfirm: () => {
            void (async () => {
              try {
                await deleteAccount();
                handleLogout();
              } catch (error) {
                const message =
                  error instanceof Error
                    ? error.message
                    : "Could not delete account";
                setDialog({ message });
              }
            })();
          },
        });
      },
    });
  }

  function handleLoginSuccess(nextUser: AuthUser, token: string) {
    saveSession(nextUser, token);
    setUser(nextUser);
    setShowLogin(false);
    void refreshFavorites();
    void refreshPreferences();
  }

  return (
    <div className="shell">
      <div className="atmosphere" aria-hidden>
        <div className="atmosphere__glow" />
        <div className="atmosphere__grid" />
        <div className="atmosphere__scan" />
      </div>

      <SideMenu
        mode={mode}
        favoriteCount={favoriteIds.length}
        favoriteStations={favoriteStations}
        user={user}
        open={sidebarOpen}
        playerStatus={player.status}
        playingUuid={player.station?.stationuuid ?? null}
        analyser={player.analyser}
        eqValues={player.eqValues}
        eqEnabled={player.eqEnabled}
        onEqChange={player.setEqBand}
        onEqToggle={() => player.setEqEnabled(!player.eqEnabled)}
        onEqReset={player.resetEq}
        onNavigate={setMode}
        onClose={() => setSidebarOpen(false)}
        onLogout={handleLogout}
        onPrivacyPolicy={() => setShowPrivacy(true)}
        onDeleteAccount={handleDeleteAccount}
        onLogin={() => setShowLogin(true)}
        onPlay={player.play}
        onPlayRandom={() => void playRandomStation()}
        playRandomLoading={playRandomLoading}
      />

      <div className="main">
        <div className="app">
          <div className="app__topbar">
            <button
              type="button"
              className="menu-toggle"
              aria-label="Open menu"
              onClick={() => setSidebarOpen(true)}
            >
              Menu
            </button>
          </div>

          <header className="hero">
            <h1 className="hero__headline">Tune the world</h1>
            <p className="hero__lede">
              Browse community radio stations via the Radio Browser network — search,
              filter, and play live streams.
            </p>
          </header>

          {mode !== "preferences" && (
            <section className="controls" aria-label="Search">
              <form className="search" onSubmit={runSearch}>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search stations by name"
                  aria-label="Search stations"
                />
                <button type="submit">Search</button>
              </form>
            </section>
          )}

          {mode === "discover" && (
            <DiscoverFilters
              countries={countries}
              languages={languages}
              tags={tags}
              countrycode={countrycode}
              language={language}
              tag={tag}
              onCountryChange={changeCountry}
              onLanguageChange={changeLanguage}
              onTagChange={changeTag}
            />
          )}

          {mode === "discover" && (
            <div className="discover-cats" aria-label="Discover categories">
              {DISCOVER_CATEGORIES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={category === item.id ? "is-on" : ""}
                  onClick={() => void fetchCategory(item.id, 0, true)}
                >
                  {item.label}
                  {item.id === "local" && localCountry ? ` (${localCountry})` : ""}
                </button>
              ))}
            </div>
          )}

          {mode === "preferences" ? (
            user ? (
              <PreferencesPanel
                tags={tags}
                selectedTags={preferenceTags}
                onChange={setPreferenceTags}
              />
            ) : (
              <p className="status-line">Log in to manage preferences.</p>
            )
          ) : (
            <main className="results">
              {loading && <p className="status-line">Scanning frequencies…</p>}
              {error && <p className="status-line status-line--error">{error}</p>}
              {!loading && !error && visibleStations.length === 0 && (
                <p className="status-line">
                  {mode === "favorites"
                    ? user
                      ? "No favorites yet — star a station while browsing."
                      : "Log in to save and view favorites."
                    : "No stations matched those filters."}
                </p>
              )}

              <div className="station-list">
                {visibleStations.map((station) => (
                  <StationCard
                    key={station.stationuuid}
                    station={station}
                    isPlaying={
                      player.station?.stationuuid === station.stationuuid &&
                      player.status === "playing"
                    }
                    isFavorite={favoriteIds.includes(station.stationuuid)}
                    onPlay={player.play}
                    onToggleFavorite={() => void toggleFavorite(station)}
                  />
                ))}
              </div>

              {mode === "discover" && !loading && stations.length > 0 && (
                <nav className="pagination" aria-label="Discover pages">
                  <button
                    type="button"
                    className="pagination__btn"
                    disabled={page === 0 || loading}
                    onClick={() => goToPage(page - 1)}
                  >
                    Previous
                  </button>
                  <span className="pagination__page">Page {page + 1}</span>
                  <button
                    type="button"
                    className="pagination__btn"
                    disabled={!hasMore || loading}
                    onClick={() => goToPage(page + 1)}
                  >
                    Next
                  </button>
                </nav>
              )}
            </main>
          )}
        </div>

        <div className="player-dock">
          <PlayerBar
            station={player.station}
            status={player.status}
            volume={player.volume}
            isFavorite={
              player.station
                ? favoriteIds.includes(player.station.stationuuid)
                : false
            }
            onToggle={player.toggle}
            onStop={player.stop}
            onVolume={player.setVolume}
            onToggleFavorite={() => {
              if (player.station) void toggleFavorite(player.station);
            }}
          />
        </div>
      </div>

      {player.error && (
        <NoticeToast message={player.error} onDismiss={player.clearError} />
      )}

      {showLogin && (
        <LoginScreen
          onSuccess={handleLoginSuccess}
          onClose={() => setShowLogin(false)}
          onOpenPrivacy={() => {
            setShowLogin(false);
            setShowPrivacy(true);
          }}
        />
      )}

      {showPrivacy && (
        <PrivacyPolicy onClose={() => setShowPrivacy(false)} />
      )}

      {dialog && (
        <>
          <button
            type="button"
            className="toast-backdrop"
            aria-label="Dismiss"
            onClick={() => setDialog(null)}
          />
          <Toast
            message={dialog.message}
            confirmLabel={dialog.confirmLabel}
            cancelLabel={dialog.cancelLabel}
            danger={dialog.danger}
            onConfirm={() => {
              const action = dialog.onConfirm;
              setDialog(null);
              action?.();
            }}
            onCancel={() => setDialog(null)}
          />
        </>
      )}
    </div>
  );
}
