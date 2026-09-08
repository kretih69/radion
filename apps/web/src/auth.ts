import type { AuthUser } from "@radion2/shared";

const TOKEN_KEY = "radion2:token";
const USER_KEY = "radion2:auth-user";

export function loadToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function loadAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthUser;
    if (
      typeof parsed?.id === "string" &&
      typeof parsed?.email === "string" &&
      typeof parsed?.name === "string"
    ) {
      return {
        ...parsed,
        avatarUrl:
          typeof parsed.avatarUrl === "string" ? parsed.avatarUrl : null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSession(user: AuthUser, token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
