export const EQ_BANDS = [
  { id: "preamp", label: "PREAMP", hz: null },
  { id: "60", label: "60", hz: 60 },
  { id: "170", label: "170", hz: 170 },
  { id: "310", label: "310", hz: 310 },
  { id: "600", label: "600", hz: 600 },
  { id: "1k", label: "1K", hz: 1000 },
  { id: "3k", label: "3K", hz: 3000 },
  { id: "6k", label: "6K", hz: 6000 },
  { id: "12k", label: "12K", hz: 12000 },
  { id: "14k", label: "14K", hz: 14000 },
  { id: "16k", label: "16K", hz: 16000 },
] as const;

export type EqBandId = (typeof EQ_BANDS)[number]["id"];

export const EQ_MIN_DB = -12;
export const EQ_MAX_DB = 12;
export const EQ_DEFAULT = EQ_BANDS.map(() => 0);

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}
