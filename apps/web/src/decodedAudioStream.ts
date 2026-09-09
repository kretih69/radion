type StreamCodec = "mp3" | "aac";

type PcmDecoder = {
  decode(data: Uint8Array): {
    channelData: Float32Array[];
    sampleRate: number;
    samplesDecoded?: number;
  };
  free(): void;
};

/**
 * Safari/WebKit: MediaElementSource + live Icecast/radio streams feed the
 * AnalyserNode with silence (WebKit bug). Decode MP3/AAC via WASM and play
 * through Web Audio so EQ + spectrum both work.
 */
export class DecodedAudioStream {
  private abort: AbortController | null = null;
  private decoder: PcmDecoder | null = null;
  private nextStart = 0;
  private activeSources = new Set<AudioBufferSourceNode>();
  private pump: Promise<void> | null = null;
  private entry: AudioNode | null = null;

  constructor(private readonly ctx: AudioContext) {}

  get running(): boolean {
    return Boolean(this.abort && !this.abort.signal.aborted);
  }

  async start(url: string, entry: AudioNode): Promise<void> {
    await this.stop();
    this.entry = entry;
    this.abort = new AbortController();
    const { signal } = this.abort;

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

    // Peek the first chunk so we can sniff ADTS vs MP3 when Content-Type is vague.
    const reader = response.body.getReader();
    const first = await reader.read();
    if (first.done || !first.value?.byteLength) {
      throw new Error("Empty stream");
    }

    const codec = detectCodec(type, first.value);
    const decoder = await createDecoder(codec);
    this.decoder = decoder;
    if (signal.aborted) {
      decoder.free();
      return;
    }

    this.nextStart = this.ctx.currentTime + 0.2;
    this.pump = this.readBody(reader, decoder, signal, first.value);
    await Promise.race([
      this.waitForFirstAudio(signal),
      this.pump.catch((err) => {
        if (signal.aborted) return;
        throw err;
      }),
    ]);
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
  ): Promise<void> {
    try {
      this.feed(decoder, firstChunk);
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        this.feed(decoder, value);
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
      this.schedule(decoded.channelData, decoded.sampleRate);
    }
  }

  private schedule(channelData: Float32Array[], sampleRate: number): void {
    const entry = this.entry;
    if (!entry || signalAborted(this.abort)) return;

    const frames = channelData[0]?.length ?? 0;
    if (!frames) return;

    const buffer = this.ctx.createBuffer(channelData.length, frames, sampleRate);
    for (let c = 0; c < channelData.length; c += 1) {
      const src = channelData[c];
      if (!src) continue;
      // Copy — decoder may reuse backing buffers on the next decode().
      buffer.copyToChannel(src.slice(), c);
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(entry);

    const now = this.ctx.currentTime;
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

  async stop(): Promise<void> {
    this.abort?.abort();
    this.abort = null;

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

    const decoder = this.decoder;
    this.decoder = null;
    if (decoder) {
      try {
        decoder.free();
      } catch {
        // ignore
      }
    }

    this.entry = null;
    this.pump = null;
    this.nextStart = 0;
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
    // ADTS: 12-bit sync 0xFFF, layer bits = 00
    if ((b1 & 0xf6) === 0xf0) return "aac";
    // MPEG Layer I/II/III: 11-bit sync, layer != 00
    if ((b1 & 0xe0) === 0xe0 && (b1 & 0x06) !== 0x00) return "mp3";
  }
  // Default to MP3 — most Icecast mounts; AAC path retries via media element on failure.
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
