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

export type NowPlayingInfo = {
  title: string | null;
  source: "shoutcast" | "icecast" | null;
};

function streamOrigin(streamUrl: string): string | null {
  try {
    const parsed = new URL(streamUrl);
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

async function fetchText(
  url: string,
  accept = "*/*",
): Promise<{ ok: boolean; text: string; type: string }> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: accept,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(6_000),
    });
    const text = await response.text();
    return {
      ok: response.ok,
      text,
      type: response.headers.get("content-type") || "",
    };
  } catch {
    return { ok: false, text: "", type: "" };
  }
}

function cleanTitle(value: string | null | undefined): string | null {
  const title = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!title) return null;
  if (/^unknown$/i.test(title)) return null;
  return title;
}

/** Best-effort “now playing” for Shoutcast / Icecast mounts. */
export async function fetchNowPlaying(streamUrl: string): Promise<NowPlayingInfo> {
  const mediaUrl = await resolveMediaUrl(streamUrl);
  const origin = streamOrigin(mediaUrl);
  if (!origin) return { title: null, source: null };

  // Shoutcast DNAS v2 JSON stats
  for (const path of ["/stats?sid=1&json=1", "/stats?json=1"]) {
    const result = await fetchText(`${origin}${path}`, "application/json,*/*");
    if (!result.ok) continue;
    try {
      const data = JSON.parse(result.text) as {
        songtitle?: string;
        servertitle?: string;
      };
      const title = cleanTitle(data.songtitle);
      if (title) return { title, source: "shoutcast" };
    } catch {
      // not JSON
    }
  }

  // Shoutcast plain currentsong
  const current = await fetchText(`${origin}/currentsong?sid=1`, "text/plain,*/*");
  if (current.ok) {
    const title = cleanTitle(current.text.replace(/<[^>]+>/g, ""));
    if (title) return { title, source: "shoutcast" };
  }

  // Icecast status-json.xsl (common default)
  const ice = await fetchText(`${origin}/status-json.xsl`, "application/json,*/*");
  if (ice.ok) {
    try {
      const data = JSON.parse(ice.text) as {
        icestats?: {
          source?:
            | { title?: string; yp_currently_playing?: string }
            | Array<{ title?: string; yp_currently_playing?: string }>;
        };
      };
      const source = data.icestats?.source;
      const entries = Array.isArray(source) ? source : source ? [source] : [];
      for (const entry of entries) {
        const title = cleanTitle(
          entry.yp_currently_playing || entry.title,
        );
        if (title) return { title, source: "icecast" };
      }
    } catch {
      // ignore
    }
  }

  return { title: null, source: null };
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
