import { createMiddleware } from "hono/factory";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { pool, type DbUser } from "./db.js";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "radion2-dev-secret-change-me",
);

const USER_COLUMNS =
  "id, email, name, password_hash, google_sub, avatar_url, created_at";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
};

export type AuthVariables = {
  user: AuthUser;
};

function toPublicUser(
  user: Pick<DbUser, "id" | "email" | "name" | "avatar_url">,
): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatar_url ?? null,
  };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export async function createToken(user: AuthUser): Promise<string> {
  return new SignJWT({
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl ?? null,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (!payload.sub || typeof payload.email !== "string" || typeof payload.name !== "string") {
      return null;
    }
    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      avatarUrl:
        typeof payload.avatarUrl === "string" ? payload.avatarUrl : null,
    };
  } catch {
    return null;
  }
}

export async function findUserById(id: string): Promise<DbUser | null> {
  const result = await pool.query<DbUser>(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function findUserByEmail(email: string): Promise<DbUser | null> {
  const result = await pool.query<DbUser>(
    `SELECT ${USER_COLUMNS} FROM users WHERE email = $1`,
    [email.toLowerCase()],
  );
  return result.rows[0] ?? null;
}

export async function findUserByGoogleSub(
  googleSub: string,
): Promise<DbUser | null> {
  const result = await pool.query<DbUser>(
    `SELECT ${USER_COLUMNS} FROM users WHERE google_sub = $1`,
    [googleSub],
  );
  return result.rows[0] ?? null;
}

export async function createUser(input: {
  email: string;
  name: string;
  password: string;
}): Promise<AuthUser> {
  const passwordHash = await hashPassword(input.password);
  const result = await pool.query<DbUser>(
    `INSERT INTO users (email, name, password_hash)
     VALUES ($1, $2, $3)
     RETURNING ${USER_COLUMNS}`,
    [input.email.toLowerCase(), input.name.trim(), passwordHash],
  );
  return toPublicUser(result.rows[0]);
}

/** Login-or-register via verified Google ID token claims. */
export async function upsertGoogleUser(input: {
  googleSub: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
}): Promise<AuthUser> {
  const name = input.name.trim();
  const avatarUrl = input.avatarUrl?.trim() || null;

  const bySub = await findUserByGoogleSub(input.googleSub);
  if (bySub) {
    const updated = await pool.query<DbUser>(
      `UPDATE users
       SET name = CASE WHEN length($1) >= 2 THEN $1 ELSE name END,
           avatar_url = COALESCE($2, avatar_url)
       WHERE id = $3
       RETURNING ${USER_COLUMNS}`,
      [name, avatarUrl, bySub.id],
    );
    return toPublicUser(updated.rows[0]);
  }

  const byEmail = await findUserByEmail(input.email);
  if (byEmail) {
    if (byEmail.google_sub && byEmail.google_sub !== input.googleSub) {
      throw new Error("Email is linked to a different Google account");
    }
    const linked = await pool.query<DbUser>(
      `UPDATE users
       SET google_sub = $1,
           name = CASE WHEN length(trim($2)) >= 2 THEN $2 ELSE name END,
           avatar_url = COALESCE($3, avatar_url)
       WHERE id = $4
       RETURNING ${USER_COLUMNS}`,
      [input.googleSub, name, avatarUrl, byEmail.id],
    );
    return toPublicUser(linked.rows[0]);
  }

  const created = await pool.query<DbUser>(
    `INSERT INTO users (email, name, password_hash, google_sub, avatar_url)
     VALUES ($1, $2, NULL, $3, $4)
     RETURNING ${USER_COLUMNS}`,
    [input.email.toLowerCase(), name, input.googleSub, avatarUrl],
  );
  return toPublicUser(created.rows[0]);
}

export async function deleteUserById(id: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

export function requireAuth() {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const header = c.req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const user = await verifyToken(token);
    if (!user) {
      return c.json({ error: "Invalid or expired token" }, 401);
    }

    c.set("user", user);
    await next();
  });
}

export { toPublicUser };
