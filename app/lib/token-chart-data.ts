import { TOTAL_SUPPLY } from "./addresses";

export type ChartPoint = { time: number; value: number };

const WINDOWS = [
  { id: "24h", label: "24h", seconds: 86_400 },
  { id: "7d", label: "7d", seconds: 7 * 86_400 },
  { id: "3mo", label: "3mo", seconds: 90 * 86_400 },
  { id: "6mo", label: "6mo", seconds: 180 * 86_400 },
] as const;

export const CHART_WINDOWS = WINDOWS;

export type CandleTf = "1h" | "4h" | "1D";

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export const CANDLE_FRAMES = [
  { id: "1h", label: "1h", bucketSec: 60 * 60 },
  { id: "4h", label: "4h", bucketSec: 4 * 60 * 60 },
  { id: "1D", label: "1D", bucketSec: 24 * 60 * 60 },
] as const;

export function candleFrame(id: CandleTf) {
  return CANDLE_FRAMES.find((row) => row.id === id) ?? CANDLE_FRAMES[0];
}

/** Fold swap prints into OHLC buckets — same fold as chart-type/candles.ts. */
export function toCandles(points: ChartPoint[], bucketSec: number): Candle[] {
  if (!(bucketSec > 0)) return [];
  const buckets = new Map<number, Candle>();
  for (const point of points) {
    if (!(point.time > 0) || !Number.isFinite(point.value) || point.value <= 0) {
      continue;
    }
    const time = Math.floor(point.time / bucketSec) * bucketSec;
    const existing = buckets.get(time);
    if (!existing) {
      buckets.set(time, {
        time,
        open: point.value,
        high: point.value,
        low: point.value,
        close: point.value,
      });
      continue;
    }
    existing.high = Math.max(existing.high, point.value);
    existing.low = Math.min(existing.low, point.value);
    existing.close = point.value;
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

export function dexscreenerTokenUrl(token: string) {
  return `https://dexscreener.com/arc/${token}`;
}

export function openingPriceUsd() {
  return TOTAL_SUPPLY > 0 ? 3000 / TOTAL_SUPPLY : 0;
}

export type DexPriceChange = {
  m5?: number;
  h1?: number;
  h6?: number;
  h24?: number;
};

export async function fetchDexscreenerPoints(
  token: string,
  officialPoolId?: string,
): Promise<{
  priceUsd: number | null;
  fdv: number | null;
  priceChange: DexPriceChange | null;
  points: ChartPoint[];
}> {
  const empty = {
    priceUsd: null,
    fdv: null,
    priceChange: null,
    points: [] as ChartPoint[],
  };
  try {
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${token}`,
    );
    if (!response.ok) return empty;
    const body = (await response.json()) as {
      pairs?: {
        chainId?: string;
        pairAddress?: string;
        priceUsd?: string;
        fdv?: number;
        marketCap?: number;
        liquidity?: { usd?: number };
        priceChange?: DexPriceChange;
      }[];
    };
    const arcPairs = (body.pairs ?? []).filter((item) => item.chainId === "arc");
    const ranked = [...(arcPairs.length > 0 ? arcPairs : body.pairs ?? [])].sort(
      (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
    );
    const official = officialPoolId?.toLowerCase();
    const pair =
      (official
        ? ranked.find((item) => item.pairAddress?.toLowerCase() === official)
        : undefined) ?? ranked[0];
    if (!pair) return empty;
    const priceUsd = pair.priceUsd ? Number(pair.priceUsd) : null;
    if (!priceUsd || !Number.isFinite(priceUsd)) return empty;
    const reported =
      typeof pair?.marketCap === "number" && pair.marketCap > 0
        ? pair.marketCap
        : typeof pair?.fdv === "number"
          ? pair.fdv
          : priceUsd * TOTAL_SUPPLY;
    return {
      priceUsd,
      fdv: reported,
      priceChange: pair?.priceChange ?? null,
      points: [],
    };
  } catch {
    return empty;
  }
}

export function filterWindow(points: ChartPoint[], seconds: number) {
  if (seconds <= 0) return points;
  const cutoff = Date.now() / 1000 - seconds;
  return points.filter((point) => point.time >= cutoff);
}
