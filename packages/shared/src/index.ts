export type Station = {
  changeuuid: string;
  stationuuid: string;
  name: string;
  url: string;
  url_resolved: string;
  homepage: string;
  favicon: string;
  tags: string;
  country: string;
  countrycode: string;
  state: string;
  language: string;
  languagecodes: string;
  votes: number;
  lastchangetime: string;
  lastchangetime_iso8601: string | null;
  codec: string;
  bitrate: number;
  hls: number;
  lastcheckok: number;
  lastchecktime: string;
  lastchecktime_iso8601: string | null;
  clickcount: number;
  clicktrend: number;
  ssl_error: number;
  geo_lat: number | null;
  geo_long: number | null;
};

export type Country = {
  name: string;
  iso_3166_1: string;
  stationcount: number;
};

export type Tag = {
  name: string;
  stationcount: number;
};

export type Language = {
  name: string;
  iso_639: string | null;
  stationcount: number;
};

export type ClickResult = {
  ok: boolean;
  message: string;
  stationuuid: string;
  name: string;
  url: string;
};

export type StationSearchParams = {
  name?: string;
  countrycode?: string;
  tag?: string;
  tagExact?: boolean;
  language?: string;
  order?:
    | "name"
    | "votes"
    | "clickcount"
    | "bitrate"
    | "random"
    | "clicktrend";
  reverse?: boolean;
  offset?: number;
  limit?: number;
  hidebroken?: boolean;
};

export type ApiError = {
  error: string;
  details?: string;
};

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
};

export type AuthResponse = {
  user: AuthUser;
  token: string;
};

export type FavoriteStation = {
  id: string;
  user_id: string;
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
  created_at: string;
};

export type UserPreferences = {
  tags: string[];
};

export type LastPlayedStation = {
  user_id: string;
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
  updated_at: string;
};
