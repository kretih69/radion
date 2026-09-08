-- Store Google (or other) profile photo URL
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;
