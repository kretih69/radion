type StreamCodec = "mp3" | "aac";

type PcmDecoder = {
  decode(data: Uint8Array): {
    channelData: Float32Array[];
    sampleRate: number;
    samplesDecoded?: number;
  };
  free(): void;
};

type UrlSource = string | (() => string);

/** Keep roughly this much audio scheduled ahead of the playhead. */
const MAX_AHEAD_SEC = 1.75;
/** Reconnect if no decode progress for this long while supposed to be live. */
const STALL_RECONNECT_MS = 4_000;
const MAX_RECONNECT_DELAY_MS = 8_000;

/**
 * Safari/WebKit: MediaElementSource + live Icecast/radio streams feed the
 * AnalyserNode with silence (WebKit bug). Decode MP3/AAC via WASM and play
 * through Web Audio so EQ + spectrum both work.
 *
 * Auto-reconnects when the HTTP body ends or stalls (proxy/upstream timeouts).
 */
export class DecodedAudioStream {
  private abort: AbortController | null = null;
  private decoder: PcmDecoder | null = null;
  private nextStart = 0;
  private activeSources = new Set<AudioBufferSourceNode>();
  private entry: AudioNode | null = null;
  private urlSource: UrlSource | null = null;
  private codec: StreamCodec | null = null;
  private lastProgressAt = 0;
  private reconnectAttempt = 0;
  private watchdogTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private pumpGeneration = 0;

  constructor(private readonly ctx: AudioContext) {}

  get running(): boolean {
    return Boolean(this.abort && !this.abort.signal.aborted);
  }

  async start(urlSource: UrlSource, entry: AudioNode): Promise<void> {
    await this.stop();
    this.entry = entry;
    this.urlSource = urlSource;
    this.abort = new AbortController();
    this.reconnectAttempt = 0;
    this.lastProgressAt = performance.now();
    this.startWatchdog();

    await this.connectAndPump(true);
  }

  private resolveUrl(): string {
    const source = this.urlSource;
    if (!source) throw new Error("No stream URL");
    return typeof source === "function" ? source() : source;
  }

  private async connectAndPump(waitForAudio: boolean): Promise<void> {
    const signal = this.abort?.signal;
    const entry = this.entry;
    if (!signal || !entry || signal.aborted) return;

    const generation = ++this.pumpGeneration;
    const url = this.resolveUrl();

    const response = await fetch(url, {
      signal,
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "audio/mpeg, audio/aac, audio/aacp, audio/*, */*" },
    });

    if (!response.ok || !response.body) {
      throw new Error(`Stream failed (${response.status})`);
    }

    const type = (response.headers.get("content-type") || "").toLowerCase();
    if (/mpegurl|m3u8|ogg|opus|vorbis|flac|wav|webm/i.test(type)) {
      throw new Error(`Unsupported stream type for decoded pipeline: ${type}`);
    }

    const reader = response.body.getReader();
    const first = await reader.read();
    if (first.done || !first.value?.byteLength) {
      throw new Error("Empty stream");
    }

    if (!this.codec) {
      this.codec = detectCodec(type, first.value);
    }

    if (!this.decoder) {
      this.decoder = await createDecoder(this.codec);
    } else {
      // Fresh HTTP body — reset decoder state for a clean bitstream.
      this.decoder.free();
      this.decoder = await createDecoder(this.codec);
    }

    if (signal.aborted || generation !== this.pumpGeneration) {
      this.decoder.free();
      this.decoder = null;
      return;
    }

    this.clearScheduledSources();
    this.nextStart = this.ctx.currentTime + 0.25;
    this.lastProgressAt = performance.now();
    this.reconnectAttempt = 0;

    const pump = this.readBody(
      reader,
      this.decoder,
      signal,
      first.value,
      generation,
    );

    if (waitForAudio) {
      await Promise.race([
        this.waitForFirstAudio(signal),
        pump.catch((err) => {
          if (signal.aborted) return;
          throw err;
        }),
      ]);
    }

    void pump.then(() => {
      if (signal.aborted || generation !== this.pumpGeneration) return;
      this.scheduleReconnect("stream ended");
    });
  }

  private waitForFirstAudio(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        if (signal.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        if (this.activeSources.size > 0) {
          resolve();
          return;
        }
        if (Date.now() - started > 12_000) {
          reject(new Error("Decoded stream timed out"));
          return;
        }
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  private async readBody(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    decoder: PcmDecoder,
    signal: AbortSignal,
    firstChunk: Uint8Array,
    generation: number,
  ): Promise<void> {
    try {
      this.feed(decoder, firstChunk);
      while (!signal.aborted && generation === this.pumpGeneration) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        this.feed(decoder, value);
      }
    } catch (err) {
      if (!signal.aborted && generation === this.pumpGeneration) {
        this.scheduleReconnect(
          err instanceof Error ? err.message : "stream read failed",
        );
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }
  }

  private feed(decoder: PcmDecoder, chunk: Uint8Array): void {
    const decoded = decoder.decode(chunk);
    const frames = decoded.channelData?.[0]?.length ?? 0;
    const samples = decoded.samplesDecoded ?? frames;
    if (samples > 0 && decoded.channelData?.length && decoded.sampleRate) {
      this.lastProgressAt = performance.now();
      this.schedule(decoded.channelData, decoded.sampleRate);
    }
  }

  private schedule(channelData: Float32Array[], sampleRate: number): void {
    const entry = this.entry;
    if (!entry || signalAborted(this.abort)) return;

    // Avoid building minutes of backlog after a stall/catch-up burst.
    const now = this.ctx.currentTime;
    if (this.nextStart - now > MAX_AHEAD_SEC) {
      return;
    }

    const frames = channelData[0]?.length ?? 0;
    if (!frames) return;

    const buffer = this.ctx.createBuffer(channelData.length, frames, sampleRate);
    for (let c = 0; c < channelData.length; c += 1) {
      const src = channelData[c];
      if (!src) continue;
      buffer.copyToChannel(src.slice(), c);
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(entry);

    if (this.nextStart < now + 0.05) {
      this.nextStart = now + 0.05;
    }
    const startAt = this.nextStart;
    this.nextStart = startAt + buffer.duration;

    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
      try {
        source.disconnect();
      } catch {
        // ignore
      }
    };
    source.start(startAt);
  }

  private startWatchdog(): void {
    this.clearWatchdog();
    this.watchdogTimer = window.setInterval(() => {
      if (!this.running || !this.entry) return;
      if (this.ctx.state === "suspended") {
        void this.ctx.resume();
        return;
      }
      const silent =
        this.activeSources.size === 0 &&
        performance.now() - this.lastProgressAt > STALL_RECONNECT_MS;
      const stalledFeed =
        performance.now() - this.lastProgressAt > STALL_RECONNECT_MS * 1.5;
      if (silent || stalledFeed) {
        this.scheduleReconnect("stall watchdog");
      }
    }, 1_000);
  }

  private scheduleReconnect(_reason: string): void {
    if (!this.running || this.reconnectTimer != null) return;

    const attempt = this.reconnectAttempt;
    this.reconnectAttempt += 1;
    const delay = Math.min(
      MAX_RECONNECT_DELAY_MS,
      400 * 2 ** Math.min(attempt, 4),
    );

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectAndPump(false).catch(() => {
        this.scheduleReconnect("reconnect failed");
      });
    }, delay);
  }

  private clearScheduledSources(): void {
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
      try {
        source.disconnect();
      } catch {
        // ignore
      }
    }
    this.activeSources.clear();
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer != null) {
      window.clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  async stop(): Promise<void> {
    this.pumpGeneration += 1;
    this.abort?.abort();
    this.abort = null;

    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearWatchdog();
    this.clearScheduledSources();

    const decoder = this.decoder;
    this.decoder = null;
    this.codec = null;
    if (decoder) {
      try {
        decoder.free();
      } catch {
        // ignore
      }
    }

    this.entry = null;
    this.urlSource = null;
    this.nextStart = 0;
    this.reconnectAttempt = 0;
  }
}

/** @deprecated Use DecodedAudioStream */
export const DecodedMp3Stream = DecodedAudioStream;

function signalAborted(abort: AbortController | null): boolean {
  return Boolean(abort?.signal.aborted);
}

function detectCodec(contentType: string, head: Uint8Array): StreamCodec {
  if (/aacp|aac|mp4|m4a|x-aac/i.test(contentType)) return "aac";
  if (/mpeg|mp3/i.test(contentType) && !/mpegurl|m3u8/i.test(contentType)) {
    return "mp3";
  }
  return sniffCodec(head);
}

function sniffCodec(head: Uint8Array): StreamCodec {
  for (let i = 0; i < Math.min(head.length - 1, 4096); i += 1) {
    const b0 = head[i] ?? 0;
    const b1 = head[i + 1] ?? 0;
    if (b0 !== 0xff) continue;
    if ((b1 & 0xf6) === 0xf0) return "aac";
    if ((b1 & 0xe0) === 0xe0 && (b1 & 0x06) !== 0x00) return "mp3";
  }
  return "mp3";
}

async function createDecoder(codec: StreamCodec): Promise<PcmDecoder> {
  if (codec === "aac") {
    const { decoder: createAacDecoder } = await import("@audio/decode-aac");
    const aac = await createAacDecoder();
    return {
      decode(data) {
        const result = aac.decode(data);
        return {
          channelData: result.channelData ?? [],
          sampleRate: result.sampleRate || 0,
          samplesDecoded: result.channelData?.[0]?.length ?? 0,
        };
      },
      free() {
        aac.free();
      },
    };
  }

  const { MPEGDecoder } = await import("mpg123-decoder");
  const mp3 = new MPEGDecoder();
  await mp3.ready;
  return {
    decode(data) {
      const result = mp3.decode(data);
      return {
        channelData: result.channelData ?? [],
        sampleRate: result.sampleRate,
        samplesDecoded: result.samplesDecoded,
      };
    },
    free() {
      mp3.free();
    },
  };
}
