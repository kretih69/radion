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

4. Apply the DB migration (once):

```bash
psql -d radion2 -f apps/api/sql/migrations/001_google_auth.sql
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
