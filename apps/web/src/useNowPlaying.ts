import { useEffect, useState } from "react";
import { getNowPlaying } from "./api";
import type { PlayerStatus } from "./useRadioPlayer";

const POLL_MS = 20_000;

export function useNowPlaying(
  stationUuid: string | null | undefined,
  status: PlayerStatus,
): string | null {
  const [title, setTitle] = useState<string | null>(null);

  useEffect(() => {
    if (!stationUuid || (status !== "playing" && status !== "loading")) {
      setTitle(null);
      return;
    }

    let cancelled = false;
    let timer = 0;

    const load = async () => {
      try {
        const result = await getNowPlaying(stationUuid);
        if (!cancelled) {
          setTitle(result.title);
        }
      } catch {
        if (!cancelled) {
          // Keep last known title on transient failures.
        }
      }
    };

    void load();
    timer = window.setInterval(() => {
      void load();
    }, POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [stationUuid, status]);

  return title;
}
