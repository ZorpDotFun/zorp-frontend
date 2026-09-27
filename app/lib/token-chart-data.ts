import { RH_ZORP, RH_ZORP_POOL_ID, TOTAL_SUPPLY } from "./addresses";
import { getNetwork } from "./networks";

export type ChartPoint = { time: number; value: number };

const WINDOWS = [
  { id: "1m", label: "1m", seconds: 60 },
  { id: "5m", label: "5m", seconds: 300 },
  { id: "15m", label: "15m", seconds: 900 },
  { id: "1h", label: "1h", seconds: 3_600 },
  { id: "4h", label: "4h", seconds: 14_400 },
  { id: "24h", label: "24h", seconds: 86_400 },
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
  return `https://dexscreener.com/${getNetwork().dexSlug}/${token}`;
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

type DexPair = {
  chainId?: string;
  pairAddress?: string;
  baseToken?: { address?: string };
  priceUsd?: string;
  fdv?: number;
  marketCap?: number;
  liquidity?: { usd?: number };
  priceChange?: DexPriceChange;
};

export type DexMarket = {
  priceUsd: number | null;
  fdv: number | null;
  priceChange: DexPriceChange | null;
  points: ChartPoint[];
};

const emptyDex: DexMarket = {
  priceUsd: null,
  fdv: null,
  priceChange: null,
  points: [],
};

export async function fetchDexscreenerPoints(
  token: string,
  officialPoolId?: string,
): Promise<DexMarket> {
  const markets = await fetchDexscreenerMarkets([
    { address: token, poolId: officialPoolId },
  ]);
  return markets.get(token.toLowerCase()) ?? emptyDex;
}

export async function fetchDexscreenerMarkets(
  tokens: { address: string; poolId?: string }[],
) {
  const markets = new Map<string, DexMarket>();
  if (tokens.length === 0) return markets;
  const chunks: { address: string; poolId?: string }[][] = [];
  for (let index = 0; index < tokens.length; index += 20) {
    chunks.push(tokens.slice(index, index + 20));
  }
  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const response = await fetch(
          `https://api.dexscreener.com/latest/dex/tokens/${chunk.map((row) => row.address).join(",")}`,
        );
        if (!response.ok) return;
        const body = (await response.json()) as { pairs?: DexPair[] };
        const byToken = new Map<string, DexPair[]>();
        for (const pair of body.pairs ?? []) {
          const address = (pair.baseToken?.address ?? "").toLowerCase();
          if (!address) continue;
          const list = byToken.get(address) ?? [];
          list.push(pair);
          byToken.set(address, list);
        }
        for (const row of chunk) {
          const key = row.address.toLowerCase();
          const picked = pickDexPair(byToken.get(key) ?? [], row.poolId);
          if (picked) markets.set(key, picked);
        }
      } catch {
        /* keep last known */
      }
    }),
  );
  return markets;
}

function pickDexPair(pairs: DexPair[], officialPoolId?: string): DexMarket | null {
  const network = getNetwork();
  const slugs = new Set(
    [network.dexSlug, network.id, String(network.chainId)].map((item) => item.toLowerCase()),
  );
  const chainPairs = pairs.filter((item) =>
    slugs.has((item.chainId ?? "").toLowerCase()),
  );
  if (chainPairs.length === 0) return null;
  const ranked = [...chainPairs].sort(
    (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
  );
  const official = (
    officialPoolId ||
    (ranked.some((item) => item.baseToken?.address?.toLowerCase() === RH_ZORP.toLowerCase())
      ? RH_ZORP_POOL_ID
      : undefined)
  )?.toLowerCase();
  const pair =
    (official
      ? ranked.find((item) => item.pairAddress?.toLowerCase() === official)
      : undefined) ?? ranked[0];
  if (!pair) return null;
  const priceUsd = pair.priceUsd ? Number(pair.priceUsd) : null;
  if (!priceUsd || !Number.isFinite(priceUsd)) return null;
  const reported =
    typeof pair.marketCap === "number" && pair.marketCap > 0
      ? pair.marketCap
      : typeof pair.fdv === "number"
        ? pair.fdv
        : priceUsd * TOTAL_SUPPLY;
  return {
    priceUsd,
    fdv: reported,
    priceChange: pair.priceChange ?? null,
    points: [],
  };
}

export function filterWindow(points: ChartPoint[], seconds: number) {
  if (seconds <= 0) return points;
  const cutoff = Date.now() / 1000 - seconds;
  const windowed = points.filter((point) => point.time >= cutoff);
  if (windowed.length > 0) return windowed;
  return points.slice(-1);
}
