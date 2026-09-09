const USER_AGENT = "RadiOn2/1.0";

function firstHttpUrl(text: string): string | null {
  const pls = text.match(/File\d+=\s*(\S+)/i);
  if (pls?.[1]?.startsWith("http")) return pls[1].trim();

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^https?:\/\//i.test(line)) return line;
  }
  return null;
}

/** Resolve playlists (.m3u / .pls) to a direct media URL. Leaves HLS (.m3u8) unchanged. */
export async function resolveMediaUrl(url: string): Promise<string> {
  if (/\.m3u8(\?|$)/i.test(url)) return url;
  if (!/\.(m3u|pls)(\?|$)/i.test(url)) return url;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "*/*",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return url;
    const text = await response.text();
    const nested = firstHttpUrl(text);
    if (nested && nested !== url) {
      return resolveMediaUrl(nested);
    }
  } catch {
    // keep original
  }
  return url;
}

export async function openUpstreamStream(url: string): Promise<Response> {
  const mediaUrl = await resolveMediaUrl(url);
  const upstream = await fetch(mediaUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "*/*",
      "Icy-MetaData": "0",
    },
    redirect: "follow",
  });

  if (!upstream.ok || !upstream.body) {
    throw new Error(`Upstream stream failed (${upstream.status})`);
  }

  return upstream;
}

export function proxyResponseHeaders(
  upstream: Response,
  origin?: string | null,
): Headers {
  const headers = new Headers();
  const type = upstream.headers.get("content-type") || "audio/mpeg";
  headers.set("Content-Type", type);
  headers.set("Cache-Control", "no-store, no-cache");
  headers.set("Accept-Ranges", "none");
  // Never forward Content-Length — live mounts are endless; a finite length
  // makes browsers stop the media element after N bytes.
  headers.set("Connection", "keep-alive");
  headers.set("X-Accel-Buffering", "no");

  // Safari requires CORS on the media response for MediaElementSource /
  // AnalyserNode to receive real samples (otherwise spectrum stays flat).
  headers.set("Access-Control-Allow-Origin", origin?.trim() || "*");
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Range, Icy-MetaData, Authorization",
  );
  headers.set("Vary", "Origin");

  return headers;
}
