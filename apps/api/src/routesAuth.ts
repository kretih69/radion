import { Hono } from "hono";
import { pool, type DbFavorite, type DbLastPlayed } from "./db.js";
import {
  createToken,
  createUser,
  findUserByEmail,
  findUserById,
  requireAuth,
  toPublicUser,
  upsertGoogleUser,
  verifyPassword,
  type AuthVariables,
} from "./auth.js";
import { getGoogleClientId, verifyGoogleIdToken } from "./googleAuth.js";

export const authRoutes = new Hono();

authRoutes.get("/google/config", (c) => {
  const clientId = getGoogleClientId();
  return c.json({
    enabled: Boolean(clientId),
    clientId,
  });
});

authRoutes.post("/google", async (c) => {
  if (!getGoogleClientId()) {
    return c.json({ error: "Google sign-in is not configured" }, 503);
  }

  const body = await c.req.json<{ credential?: string }>();
  const credential = body.credential?.trim() ?? "";
  if (!credential) {
    return c.json({ error: "Google credential is required" }, 400);
  }

  try {
    const googleUser = await verifyGoogleIdToken(credential);
    const user = await upsertGoogleUser({
      googleSub: googleUser.sub,
      email: googleUser.email,
      name: googleUser.name,
      avatarUrl: googleUser.picture ?? null,
    });
    const token = await createToken(user);
    return c.json({ user, token });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Google sign-in failed";
    const status =
      message.includes("not configured") || message.includes("linked to a different")
        ? 409
        : 401;
    return c.json({ error: message }, status);
  }
});

authRoutes.post("/register", async (c) => {
  const body = await c.req.json<{
    email?: string;
    name?: string;
    password?: string;
  }>();

  const email = body.email?.trim() ?? "";
  const name = body.name?.trim() ?? "";
  const password = body.password ?? "";

  if (!email || !email.includes("@")) {
    return c.json({ error: "Valid email is required" }, 400);
  }
  if (name.length < 2) {
    return c.json({ error: "Name must be at least 2 characters" }, 400);
  }
  if (password.length < 6) {
    return c.json({ error: "Password must be at least 6 characters" }, 400);
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    return c.json({ error: "Email is already registered" }, 409);
  }

  const user = await createUser({ email, name, password });
  const token = await createToken(user);
  return c.json({ user, token }, 201);
});

authRoutes.post("/login", async (c) => {
  const body = await c.req.json<{
    email?: string;
    password?: string;
  }>();

  const email = body.email?.trim() ?? "";
  const password = body.password ?? "";

  if (!email || !password) {
    return c.json({ error: "Email and password are required" }, 400);
  }

  const existing = await findUserByEmail(email);
  if (!existing?.password_hash) {
    if (existing?.google_sub) {
      return c.json(
        { error: "This account uses Google sign-in. Continue with Google." },
        401,
      );
    }
    return c.json({ error: "Invalid email or password" }, 401);
  }

  if (!(await verifyPassword(password, existing.password_hash))) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const user = toPublicUser(existing);
  const token = await createToken(user);
  return c.json({ user, token });
});

authRoutes.get("/me", requireAuth(), async (c) => {
  const session = c.get("user");
  const row = await findUserById(session.id);
  if (!row) {
    return c.json({ error: "User not found" }, 401);
  }
  return c.json({ user: toPublicUser(row) });
});

export const favoriteRoutes = new Hono<{ Variables: AuthVariables }>();

favoriteRoutes.use("*", requireAuth());

favoriteRoutes.get("/", async (c) => {
  const user = c.get("user");
  const result = await pool.query<DbFavorite>(
    `SELECT *
     FROM favorites
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [user.id],
  );
  return c.json(result.rows);
});

favoriteRoutes.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    stationuuid?: string;
    name?: string;
    favicon?: string;
    countrycode?: string;
    country?: string;
    tags?: string;
    codec?: string;
    bitrate?: number;
    language?: string;
    url?: string;
    url_resolved?: string;
  }>();

  const stationuuid = body.stationuuid?.trim();
  if (!stationuuid) {
    return c.json({ error: "stationuuid is required" }, 400);
  }

  const result = await pool.query<DbFavorite>(
    `INSERT INTO favorites (
       user_id, stationuuid, name, favicon, countrycode, country,
       tags, codec, bitrate, language, url, url_resolved
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (user_id, stationuuid) DO UPDATE SET
       name = EXCLUDED.name,
       favicon = EXCLUDED.favicon,
       countrycode = EXCLUDED.countrycode,
       country = EXCLUDED.country,
       tags = EXCLUDED.tags,
       codec = EXCLUDED.codec,
       bitrate = EXCLUDED.bitrate,
       language = EXCLUDED.language,
       url = EXCLUDED.url,
       url_resolved = EXCLUDED.url_resolved
     RETURNING *`,
    [
      user.id,
      stationuuid,
      body.name ?? "",
      body.favicon ?? "",
      body.countrycode ?? "",
      body.country ?? "",
      body.tags ?? "",
      body.codec ?? "",
      body.bitrate ?? 0,
      body.language ?? "",
      body.url ?? "",
      body.url_resolved ?? "",
    ],
  );

  return c.json(result.rows[0], 201);
});

favoriteRoutes.delete("/:stationuuid", async (c) => {
  const user = c.get("user");
  const stationuuid = c.req.param("stationuuid");
  await pool.query(
    "DELETE FROM favorites WHERE user_id = $1 AND stationuuid = $2",
    [user.id, stationuuid],
  );
  return c.json({ ok: true });
});

export const preferenceRoutes = new Hono<{ Variables: AuthVariables }>();

preferenceRoutes.use("*", requireAuth());

preferenceRoutes.get("/", async (c) => {
  const user = c.get("user");
  const result = await pool.query<{ tag: string }>(
    `SELECT tag
     FROM user_preference_tags
     WHERE user_id = $1
     ORDER BY tag ASC`,
    [user.id],
  );
  return c.json({ tags: result.rows.map((row) => row.tag) });
});

preferenceRoutes.put("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ tags?: unknown }>();
  const rawTags = Array.isArray(body.tags) ? body.tags : null;

  if (!rawTags) {
    return c.json({ error: "tags must be an array of strings" }, 400);
  }

  const tags = [
    ...new Set(
      rawTags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];

  if (tags.length > 100) {
    return c.json({ error: "You can select at most 100 tags" }, 400);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM user_preference_tags WHERE user_id = $1", [
      user.id,
    ]);

    for (const tag of tags) {
      await client.query(
        `INSERT INTO user_preference_tags (user_id, tag)
         VALUES ($1, $2)
         ON CONFLICT (user_id, tag) DO NOTHING`,
        [user.id, tag],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return c.json({ tags });
});

export const lastPlayedRoutes = new Hono<{ Variables: AuthVariables }>();

lastPlayedRoutes.use("*", requireAuth());

lastPlayedRoutes.get("/", async (c) => {
  const user = c.get("user");
  const result = await pool.query<DbLastPlayed>(
    `SELECT *
     FROM last_played
     WHERE user_id = $1`,
    [user.id],
  );
  const row = result.rows[0];
  if (!row) {
    return c.json({ station: null });
  }
  return c.json({ station: row });
});

lastPlayedRoutes.put("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    stationuuid?: string;
    name?: string;
    favicon?: string;
    countrycode?: string;
    country?: string;
    tags?: string;
    codec?: string;
    bitrate?: number;
    language?: string;
    url?: string;
    url_resolved?: string;
  }>();

  const stationuuid = body.stationuuid?.trim();
  if (!stationuuid) {
    return c.json({ error: "stationuuid is required" }, 400);
  }

  const result = await pool.query<DbLastPlayed>(
    `INSERT INTO last_played (
       user_id, stationuuid, name, favicon, countrycode, country,
       tags, codec, bitrate, language, url, url_resolved, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       stationuuid = EXCLUDED.stationuuid,
       name = EXCLUDED.name,
       favicon = EXCLUDED.favicon,
       countrycode = EXCLUDED.countrycode,
       country = EXCLUDED.country,
       tags = EXCLUDED.tags,
       codec = EXCLUDED.codec,
       bitrate = EXCLUDED.bitrate,
       language = EXCLUDED.language,
       url = EXCLUDED.url,
       url_resolved = EXCLUDED.url_resolved,
       updated_at = NOW()
     RETURNING *`,
    [
      user.id,
      stationuuid,
      body.name ?? "",
      body.favicon ?? "",
      body.countrycode ?? "",
      body.country ?? "",
      body.tags ?? "",
      body.codec ?? "",
      body.bitrate ?? 0,
      body.language ?? "",
      body.url ?? "",
      body.url_resolved ?? "",
    ],
  );

  return c.json({ station: result.rows[0] });
});
