# RadiOn2

Radio station browser built on the [Radio Browser API](https://api.radio-browser.info/).

Monorepo with a Node API (BFF) and a React web app. The backend discovers Radio Browser mirrors via DNS, sends a proper User-Agent, and records play clicks through `/json/url/{uuid}` as the API recommends.

## Structure

```
apps/api      Hono server — proxies & normalizes Radio Browser
apps/web      Vite + React UI — search, filters, player, favorites
packages/shared   Shared TypeScript types
```

## Setup

```bash
npm install
createdb radion2   # if needed
psql -d radion2 -f apps/api/sql/schema.sql
cp apps/api/.env.example apps/api/.env
```

## Develop

Run API and web in two terminals:

```bash
npm run dev:api
npm run dev:web
```

- Web: http://localhost:5173  
- API: http://localhost:8787  

Vite proxies `/api` to the backend.

## Deploy API to Railway

Config lives in [`railway.toml`](railway.toml) (build/start + `/health`).

1. Create a Railway project and deploy this repo (root directory = monorepo root).
2. Add a **PostgreSQL** plugin so Railway injects `DATABASE_URL`.
3. Apply the schema once (Railway query pane, or `railway connect` / `psql "$DATABASE_URL"`):

```bash
psql "$DATABASE_URL" -f apps/api/sql/schema.sql
```

4. Set service variables:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | From Postgres plugin (usually automatic) |
| `JWT_SECRET` | Strong random secret (do not use the dev default) |
| `GOOGLE_CLIENT_ID` | Same Web client ID as local Google sign-in |
| `WEB_ORIGINS` | Comma-separated production frontend origins (optional; `http://localhost:5173` is always allowed) |
| `PORT` | Set by Railway automatically |

5. Deploy and check `https://<your-api>.up.railway.app/health` → `{ "ok": true, "service": "radion2-api" }`.

6. When you host the web app, add its origin to `WEB_ORIGINS` and to Google Cloud **Authorized JavaScript origins** (the web origin, not the API URL).

Local web can call a Railway API as long as CORS includes localhost (default).

## Deploy web to Netlify

Config lives in [`netlify.toml`](netlify.toml) (build from monorepo root → `apps/web/dist`).

1. Create a Netlify site from this GitHub repo.
2. In **Build settings**, set exactly:
   - **Base directory:** empty (repo root)
   - **Build command:** `npm install && npm run build -w @radion2/web`
   - **Publish directory:** `apps/web/dist` (not `apps/web` — that serves raw Vite source and shows a blank page)
3. In Netlify **Environment variables**, set:

| Variable | Value |
| --- | --- |
| `VITE_API_BASE_URL` | Your Railway API origin, no trailing slash — e.g. `https://radion2api-production.up.railway.app` |

4. Trigger a **Clear cache and deploy site**. After deploy, View page source: you should see `/assets/index-….js`, not `/src/main.tsx`.
5. On Railway API, set `WEB_ORIGINS` to your Netlify URL(s), e.g. `https://radion2.netlify.app`. Redeploy/restart the API if needed.
6. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), add the same Netlify origin under **Authorized JavaScript origins**.
7. Open the Netlify site and confirm browse + play + Google login work.

Local `npm run dev:web` leaves `VITE_API_BASE_URL` unset and keeps using the Vite `/api` proxy.

**Blank page?** Netlify is publishing `apps/web` (source) instead of `apps/web/dist` (build). Fix publish directory and redeploy.

## Auth & favorites

Login is optional. Browse freely without an account.

- **Logged out:** side menu shows **Log in**; starring a station shows “Log in to use this feature”
- **Logged in:** favorites are stored in PostgreSQL per user

Create an account from the login screen (Register), log in with email/password, or **Continue with Google**.

### Google sign-in

1. Create an OAuth client ID (Web application) in [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Add authorized JavaScript origin: `http://localhost:5173` (and your production origin)
3. Put the client ID in `apps/api/.env`:

```bash
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

4. Apply the DB migration (once) if your DB was created before Google auth:

```bash
psql -d radion2 -f apps/api/sql/migrations/001_google_auth.sql
psql -d radion2 -f apps/api/sql/migrations/002_user_avatar.sql
```

First Google sign-in automatically creates the user. If that email already has a password account, Google is linked to it.

## Features

- Search by name, country, language, and genre/tag
- Top stations by click count
- Live stream playback with click tracking
- Local favorites (browser storage)
- Server failover across Radio Browser mirrors

## API routes

| Route | Description |
| --- | --- |
| `GET /api/stations/search` | Advanced search |
| `GET /api/stations/top` | Popular stations |
| `GET /api/stations/:uuid` | Station by UUID |
| `GET /api/stations/:uuid/play` | Register click + resolve stream URL |
| `GET /api/countries` | Countries with station counts |
| `GET /api/tags` | Popular tags |
| `GET /api/languages` | Popular languages |
| `GET /health` | Liveness (Railway healthcheck) |
