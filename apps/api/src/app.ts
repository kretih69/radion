import { Hono } from "hono";
import { cors } from "hono/cors";
import type {
  ClickResult,
  Country,
  Language,
  Station,
  Tag,
} from "@radion2/shared";
import { radioFetch } from "./radioClient.js";
import { verifyToken } from "./auth.js";
import { pool } from "./db.js";
import { authRoutes, favoriteRoutes, lastPlayedRoutes, preferenceRoutes } from "./routesAuth.js";
import { getCachedTags } from "./tagsCache.js";
import { openUpstreamStream, proxyResponseHeaders } from "./streamProxy.js";

const app = new Hono();

const defaultOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function allowedOrigins(): Set<string> {
  const fromEnv =
    process.env.WEB_ORIGINS?.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean) ?? [];
  return new Set([...defaultOrigins, ...fromEnv]);
}

function isAllowedWebOrigin(origin: string): boolean {
  if (allowedOrigins().has(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    // Netlify production + deploy previews
    if (host === "radion2.netlify.app" || host.endsWith(".netlify.app")) {
      return true;
    }
    if (
      host === "radion-online.com" ||
      host === "www.radion-online.com"
    ) {
      return true;
    }
  } catch {
    // ignore invalid Origin
  }
  return false;
}

app.use(
  "*",
  cors({
    origin: (origin) => (origin && isAllowedWebOrigin(origin) ? origin : null),
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

app.get("/health", (c) => c.json({ ok: true, service: "radion2-api" }));

app.route("/api/auth", authRoutes);
app.route("/api/favorites", favoriteRoutes);
app.route("/api/preferences", preferenceRoutes);
app.route("/api/last-played", lastPlayedRoutes);

function toSearchParams(
  query: Record<string, string | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") {
      params.set(key, value);
    }
  }
  return params;
}

app.get("/api/stations/search", async (c) => {
  const q = c.req.query();
  const params = toSearchParams({
    name: q.name,
    countrycode: q.countrycode,
    tag: q.tag,
    tagExact: q.tagExact,
    language: q.language,
    order: q.order ?? "votes",
    reverse: q.reverse ?? "true",
    offset: q.offset ?? "0",
    limit: q.limit ?? "40",
    hidebroken: q.hidebroken ?? "true",
  });

  const response = await radioFetch(`/json/stations/search?${params}`);
  const stations = (await response.json()) as Station[];
  return c.json(stations);
});

app.get("/api/stations/topclick", async (c) => {
  const limit = c.req.query("limit") ?? "24";
  const offset = c.req.query("offset") ?? "0";
  const params = new URLSearchParams({
    limit,
    offset,
    hidebroken: "true",
  });
  const response = await radioFetch(`/json/stations/topclick?${params}`);
  const stations = (await response.json()) as Station[];
  return c.json(stations);
});

app.get("/api/stations/lastclick", async (c) => {
  const limit = c.req.query("limit") ?? "24";
  const offset = c.req.query("offset") ?? "0";
  const params = new URLSearchParams({
    limit,
    offset,
    hidebroken: "true",
  });
  const response = await radioFetch(`/json/stations/lastclick?${params}`);
  const stations = (await response.json()) as Station[];
  return c.json(stations);
});

function isPrivateIp(ip: string): boolean {
  if (!ip || ip === "::1" || ip === "127.0.0.1" || ip === "0.0.0.0") return true;
  if (ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("fc") || ip.startsWith("fd")) {
    return true;
  }
  if (ip.startsWith("172.")) {
    const second = Number(ip.split(".")[1]);
    return second >= 16 && second <= 31;
  }
  return false;
}

async function lookupCountryByIp(ip?: string): Promise<string | null> {
  const path = ip
    ? `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,countryCode`
    : "http://ip-api.com/json/?fields=status,countryCode";
  try {
    const response = await fetch(path, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      status?: string;
      countryCode?: string;
    };
    if (data.status === "success" && data.countryCode) {
      return data.countryCode.toUpperCase();
    }
  } catch {
    // ignore
  }
  return null;
}

app.get("/api/geo", async (c) => {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp =
    c.req.header("cf-connecting-ip")?.trim() ||
    c.req.header("x-real-ip")?.trim();
  const ip = forwarded || realIp || "";

  const fromLanguage = () => {
    const accept = c.req.header("accept-language") ?? "";
    // Prefer primary tag with region: hr-HR, en-GB, etc.
    for (const part of accept.split(",")) {
      const tag = part.trim().split(";")[0] ?? "";
      const match = tag.match(/^[A-Za-z]{2,3}-([A-Za-z]{2})\b/);
      if (match?.[1]) return match[1].toUpperCase();
    }
    return null;
  };

  if (ip && !isPrivateIp(ip)) {
    const country = await lookupCountryByIp(ip);
    if (country) return c.json({ countrycode: country });
  }

  // Local/dev or missing proxy headers: use this server's public egress IP.
  const egress = await lookupCountryByIp();
  if (egress) return c.json({ countrycode: egress });

  return c.json({ countrycode: fromLanguage() });
});

app.get("/api/stations/preferred", async (c) => {
  const header = c.req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const user = await verifyToken(token);
  if (!user) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  const prefs = await pool.query<{ tag: string }>(
    `SELECT tag FROM user_preference_tags WHERE user_id = $1 ORDER BY tag ASC`,
    [user.id],
  );
  const tags = prefs.rows.map((row) => row.tag);

  if (tags.length === 0) {
    return c.json(
      {
        error: "Select your preferences first",
        code: "NO_PREFERENCES",
      },
      400,
    );
  }

  const perTagLimit = Math.max(20, Math.floor(200 / tags.length));
  const batches = await Promise.all(
    tags.map(async (tag) => {
      const params = toSearchParams({
        tag,
        tagExact: "true",
        order: "random",
        reverse: "false",
        limit: String(perTagLimit),
        hidebroken: "true",
      });
      const response = await radioFetch(`/json/stations/search?${params}`);
      return (await response.json()) as Station[];
    }),
  );

  const byId = new Map<string, Station>();
  for (const batch of batches) {
    for (const station of batch) {
      if (station.stationuuid) {
        byId.set(station.stationuuid, station);
      }
    }
  }

  const stations = [...byId.values()];
  if (stations.length === 0) {
    return c.json(
      {
        error: "No stations found for your preferences",
        code: "NO_STATIONS",
      },
      404,
    );
  }

  return c.json(stations);
});

app.get("/api/stations/top", async (c) => {
  const limit = c.req.query("limit") ?? "40";
  const offset = c.req.query("offset") ?? "0";
  const params = new URLSearchParams({
    order: "clickcount",
    reverse: "true",
    limit,
    offset,
    hidebroken: "true",
  });
  const response = await radioFetch(`/json/stations/search?${params}`);
  const stations = (await response.json()) as Station[];
  return c.json(stations);
});

app.get("/api/stations/:uuid", async (c) => {
  const uuid = c.req.param("uuid");
  const response = await radioFetch(
    `/json/stations/byuuid/${encodeURIComponent(uuid)}`,
  );
  const stations = (await response.json()) as Station[];
  if (!stations.length) {
    return c.json({ error: "Station not found" }, 404);
  }
  return c.json(stations[0]);
});

app.get("/api/stations/:uuid/play", async (c) => {
  const uuid = c.req.param("uuid");
  const response = await radioFetch(
    `/json/url/${encodeURIComponent(uuid)}`,
  );
  const result = (await response.json()) as ClickResult;
  return c.json(result);
});

app.get("/api/stations/:uuid/stream", async (c) => {
  const uuid = c.req.param("uuid");
  const clickResponse = await radioFetch(
    `/json/url/${encodeURIComponent(uuid)}`,
  );
  const click = (await clickResponse.json()) as ClickResult;
  if (!click.url) {
    return c.json({ error: "No stream URL available" }, 404);
  }

  try {
    const upstream = await openUpstreamStream(click.url);
    const requestOrigin = c.req.header("Origin");
    const corsOrigin =
      requestOrigin && isAllowedWebOrigin(requestOrigin) ? requestOrigin : null;
    return new Response(upstream.body, {
      status: 200,
      headers: proxyResponseHeaders(upstream, corsOrigin),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Stream proxy failed";
    return c.json({ error: message }, 502);
  }
});

app.get("/api/countries", async (c) => {
  const response = await radioFetch("/json/countries");
  const countries = (await response.json()) as Country[];
  return c.json(
    countries
      .filter((country) => country.stationcount > 0 && country.iso_3166_1)
      .sort((a, b) => b.stationcount - a.stationcount),
  );
});

app.get("/api/tags", async (c) => {
  const tags = await getCachedTags();
  const limitParam = c.req.query("limit");
  if (limitParam !== undefined && limitParam !== "") {
    const limit = Number(limitParam);
    if (Number.isFinite(limit) && limit >= 0) {
      return c.json(tags.slice(0, limit));
    }
  }
  return c.json(tags);
});

app.get("/api/languages", async (c) => {
  const limit = Number(c.req.query("limit") ?? "60");
  const response = await radioFetch("/json/languages");
  const languages = (await response.json()) as Language[];
  return c.json(
    languages
      .filter((language) => language.name && language.stationcount > 0)
      .sort((a, b) => b.stationcount - a.stationcount)
      .slice(0, limit),
  );
});

app.onError((err, c) => {
  console.error(err);
  const message = err instanceof Error ? err.message : String(err);
  const isDb = message.includes("connect") || message.includes("password");
  return c.json(
    {
      error: isDb ? "Database error" : "Request failed",
      details: message,
    },
    isDb ? 500 : 502,
  );
});

export default app;
export { app };
