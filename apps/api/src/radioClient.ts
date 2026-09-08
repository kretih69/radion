import { resolve4, reverse } from "node:dns/promises";

const FALLBACK_SERVERS = [
  "https://de1.api.radio-browser.info",
  "https://nl1.api.radio-browser.info",
  "https://at1.api.radio-browser.info",
];

const USER_AGENT = "RadiOn2/1.0";

let cachedServers: string[] | null = null;
let cacheExpiresAt = 0;

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function discoverServers(): Promise<string[]> {
  const ips = await resolve4("all.api.radio-browser.info");
  const hostnames = await Promise.all(
    ips.map(async (ip) => {
      try {
        const names = await reverse(ip);
        return names[0] ?? null;
      } catch {
        return null;
      }
    }),
  );

  const fromDns = hostnames
    .filter((name): name is string => Boolean(name))
    .map((name) => `https://${name.replace(/\.$/, "")}`);

  return [...new Set([...fromDns, ...FALLBACK_SERVERS])];
}

export async function getServers(): Promise<string[]> {
  const now = Date.now();
  if (cachedServers && now < cacheExpiresAt) {
    return cachedServers;
  }

  try {
    cachedServers = shuffle(await discoverServers());
    cacheExpiresAt = now + 10 * 60 * 1000;
    return cachedServers;
  } catch {
    cachedServers = shuffle(FALLBACK_SERVERS);
    cacheExpiresAt = now + 2 * 60 * 1000;
    return cachedServers;
  }
}

export async function radioFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const servers = await getServers();
  let lastError: unknown;

  for (const base of servers) {
    try {
      const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
      const response = await fetch(url, {
        ...init,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
          ...(init?.headers ?? {}),
        },
        signal: AbortSignal.timeout(12_000),
      });

      if (response.ok || response.status < 500) {
        return response;
      }

      lastError = new Error(`Upstream ${response.status} from ${base}`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("All Radio Browser servers failed");
}
