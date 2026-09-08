import "./loadEnv.js";
import pg from "pg";

const { Pool } = pg;

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://kresimirretih@localhost:5432/radion2";

export const pool = new Pool({ connectionString: databaseUrl });

export type DbUser = {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  google_sub: string | null;
  avatar_url: string | null;
  created_at: Date;
};

export type DbFavorite = {
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
  created_at: Date;
};

export type DbLastPlayed = {
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
  updated_at: Date;
};
