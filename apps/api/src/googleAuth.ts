import { createRemoteJWKSet, jwtVerify } from "jose";

const GOOGLE_ISSUERS = new Set([
  "https://accounts.google.com",
  "accounts.google.com",
]);

const googleJwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

export type GoogleIdTokenPayload = {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture?: string;
};

export function getGoogleClientId(): string | null {
  const id = process.env.GOOGLE_CLIENT_ID?.trim();
  return id || null;
}

export async function verifyGoogleIdToken(
  credential: string,
): Promise<GoogleIdTokenPayload> {
  const clientId = getGoogleClientId();
  if (!clientId) {
    throw new Error("Google sign-in is not configured");
  }

  const { payload } = await jwtVerify(credential, googleJwks, {
    audience: clientId,
  });

  const issuer = typeof payload.iss === "string" ? payload.iss : "";
  if (!GOOGLE_ISSUERS.has(issuer)) {
    throw new Error("Invalid Google token issuer");
  }

  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  const name =
    typeof payload.name === "string" && payload.name.trim()
      ? payload.name.trim()
      : email.split("@")[0] || "Google user";
  const emailVerified =
    payload.email_verified === true || payload.email_verified === "true";

  if (!sub || !email || !email.includes("@")) {
    throw new Error("Google account did not provide a verified email");
  }
  if (!emailVerified) {
    throw new Error("Google email is not verified");
  }

  return {
    sub,
    email: email.toLowerCase(),
    email_verified: true,
    name,
    picture: typeof payload.picture === "string" ? payload.picture : undefined,
  };
}
