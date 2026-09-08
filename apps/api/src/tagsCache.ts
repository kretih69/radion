import type { Tag } from "@radion2/shared";
import { radioFetch } from "./radioClient.js";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cachedTags: Tag[] | null = null;
let cacheExpiresAt = 0;
let inflight: Promise<Tag[]> | null = null;

function normalizeTags(tags: Tag[]): Tag[] {
  return tags
    .filter((tag) => tag.name?.trim() && tag.stationcount > 0)
    .sort((a, b) => b.stationcount - a.stationcount);
}

async function fetchAllTags(): Promise<Tag[]> {
  const params = new URLSearchParams({
    order: "stationcount",
    reverse: "true",
    hidebroken: "true",
    limit: "100000",
  });
  const response = await radioFetch(`/json/tags?${params}`);
  const tags = (await response.json()) as Tag[];
  return normalizeTags(tags);
}

export async function getCachedTags(): Promise<Tag[]> {
  const now = Date.now();
  if (cachedTags && now < cacheExpiresAt) {
    return cachedTags;
  }

  if (!inflight) {
    inflight = fetchAllTags()
      .then((tags) => {
        cachedTags = tags;
        cacheExpiresAt = Date.now() + CACHE_TTL_MS;
        console.log(`Cached ${tags.length} radio tags`);
        return tags;
      })
      .finally(() => {
        inflight = null;
      });
  }

  try {
    return await inflight;
  } catch (error) {
    if (cachedTags) {
      console.warn("Tag refresh failed; serving stale cache", error);
      return cachedTags;
    }
    throw error;
  }
}
