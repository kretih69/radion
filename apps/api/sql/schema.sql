-- RadiOn2 schema (PostgreSQL)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT,
  google_sub TEXT UNIQUE,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stationuuid TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  favicon TEXT NOT NULL DEFAULT '',
  countrycode TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  codec TEXT NOT NULL DEFAULT '',
  bitrate INTEGER NOT NULL DEFAULT 0,
  language TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  url_resolved TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, stationuuid)
);

CREATE INDEX IF NOT EXISTS favorites_user_id_idx ON favorites(user_id);

CREATE TABLE IF NOT EXISTS user_preference_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, tag)
);

CREATE INDEX IF NOT EXISTS user_preference_tags_user_id_idx
  ON user_preference_tags(user_id);

CREATE TABLE IF NOT EXISTS last_played (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stationuuid TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  favicon TEXT NOT NULL DEFAULT '',
  countrycode TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  codec TEXT NOT NULL DEFAULT '',
  bitrate INTEGER NOT NULL DEFAULT 0,
  language TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  url_resolved TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
