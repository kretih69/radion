-- Google OAuth: nullable password + Google subject id
ALTER TABLE users
  ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS google_sub TEXT UNIQUE;
