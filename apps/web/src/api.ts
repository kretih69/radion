import type {
  AuthResponse,
  AuthUser,
  ClickResult,
  Country,
  FavoriteStation,
  Language,
  LastPlayedStation,
  Station,
  StationSearchParams,
  Tag,
  UserPreferences,
} from "@radion2/shared";
import { loadToken } from "./auth";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = loadToken();
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function searchStations(params: StationSearchParams): Promise<Station[]> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      query.set(key, String(value));
    }
  });
  return request(`/api/stations/search?${query}`);
}

export function getPreferredStations(): Promise<Station[]> {
  return request("/api/stations/preferred");
}

export function getTopStations(limit = 40, offset = 0): Promise<Station[]> {
  return request(`/api/stations/top?limit=${limit}&offset=${offset}`);
}

export function getTopClickStations(
  limit = 24,
  offset = 0,
): Promise<Station[]> {
  return request(`/api/stations/topclick?limit=${limit}&offset=${offset}`);
}

export function getLastClickStations(
  limit = 24,
  offset = 0,
): Promise<Station[]> {
  return request(`/api/stations/lastclick?limit=${limit}&offset=${offset}`);
}

export async function getGeoCountry(): Promise<{ countrycode: string | null }> {
  // Prefer browser-side IP lookup so localhost / private proxies still see the
  // user's real public IP (API would otherwise only see 127.0.0.1).
  try {
    const response = await fetch("https://get.geojs.io/v1/ip/country.json", {
      signal: AbortSignal.timeout(4000),
    });
    if (response.ok) {
      const data = (await response.json()) as { country?: string };
      if (data.country && /^[A-Za-z]{2}$/.test(data.country)) {
        return { countrycode: data.country.toUpperCase() };
      }
    }
  } catch {
    // fall through
  }

  return request("/api/geo");
}

export function playStation(uuid: string): Promise<ClickResult> {
  return request(`/api/stations/${encodeURIComponent(uuid)}/play`);
}

export function getCountries(): Promise<Country[]> {
  return request("/api/countries");
}

export function getTags(limit?: number): Promise<Tag[]> {
  if (limit === undefined) {
    return request("/api/tags");
  }
  return request(`/api/tags?limit=${limit}`);
}

export function getLanguages(limit = 40): Promise<Language[]> {
  return request(`/api/languages?limit=${limit}`);
}

export function login(email: string, password: string): Promise<AuthResponse> {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function register(
  name: string,
  email: string,
  password: string,
): Promise<AuthResponse> {
  return request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  });
}

export function getGoogleAuthConfig(): Promise<{
  enabled: boolean;
  clientId: string | null;
}> {
  return request("/api/auth/google/config");
}

export function loginWithGoogle(credential: string): Promise<AuthResponse> {
  return request("/api/auth/google", {
    method: "POST",
    body: JSON.stringify({ credential }),
  });
}

export function getMe(): Promise<{ user: AuthUser }> {
  return request("/api/auth/me");
}

export function getFavorites(): Promise<FavoriteStation[]> {
  return request("/api/favorites");
}

export function addFavorite(station: Station): Promise<FavoriteStation> {
  return request("/api/favorites", {
    method: "POST",
    body: JSON.stringify({
      stationuuid: station.stationuuid,
      name: station.name,
      favicon: station.favicon,
      countrycode: station.countrycode,
      country: station.country,
      tags: station.tags,
      codec: station.codec,
      bitrate: station.bitrate,
      language: station.language,
      url: station.url,
      url_resolved: station.url_resolved,
    }),
  });
}

export function removeFavorite(stationuuid: string): Promise<{ ok: boolean }> {
  return request(`/api/favorites/${encodeURIComponent(stationuuid)}`, {
    method: "DELETE",
  });
}

export function getPreferences(): Promise<UserPreferences> {
  return request("/api/preferences");
}

export function savePreferences(tags: string[]): Promise<UserPreferences> {
  return request("/api/preferences", {
    method: "PUT",
    body: JSON.stringify({ tags }),
  });
}

export function getLastPlayed(): Promise<{ station: LastPlayedStation | null }> {
  return request("/api/last-played");
}

export function saveLastPlayed(station: Station): Promise<{ station: LastPlayedStation }> {
  return request("/api/last-played", {
    method: "PUT",
    body: JSON.stringify({
      stationuuid: station.stationuuid,
      name: station.name,
      favicon: station.favicon,
      countrycode: station.countrycode,
      country: station.country,
      tags: station.tags,
      codec: station.codec,
      bitrate: station.bitrate,
      language: station.language,
      url: station.url,
      url_resolved: station.url_resolved,
    }),
  });
}
