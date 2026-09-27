import { zeroAddress, type Address } from "viem";
import { RH_ZORP, RH_ZORP_POOL_ID, TARGET_FDV_USD, TOTAL_SUPPLY } from "./addresses";
import type { Token } from "./tokens";

export type ZorpMarket = {
  priceUsd: number;
  fdv: number;
  change24h: number;
  volume: number;
  bondProgress?: number;
};

export const ZORP_POOL_ID = RH_ZORP_POOL_ID;
export const ZORP_DEXSCREENER_URL = `https://dexscreener.com/robinhood/${RH_ZORP_POOL_ID}`;
const ZORP_DEX_PAIR_URL = `https://api.dexscreener.com/latest/dex/pairs/robinhood/${RH_ZORP_POOL_ID}`;
export const ZORP_IMAGE = "/assets/logos/z-3d.png";
export const ZORP_LAUNCHED_AT = 1_790_512_178_000;

export function isZorpToken(address?: string | null) {
  return Boolean(address && address.toLowerCase() === RH_ZORP.toLowerCase());
}

export function hueFromAddress(address: string) {
  return Number.parseInt(address.slice(2, 8), 16) % 360;
}

export function zorpLaunchToken(overrides: Partial<Token> = {}): Token {
  return {
    id: RH_ZORP,
    name: "Zorp Fun",
    ticker: "ZORP",
    address: RH_ZORP,
    image: ZORP_IMAGE,
    description: "Launch coins and pair it with any meme, stock or custom token.",
    twitter: "x.com/zorpdotfun",
    telegram: "t.me/zorpdotfun",
    website: "https://www.zorpdotfun.com/",
    creator: "0xd9AF654f660527e82d1c072ae6254Caa54867789",
    mcap: 0,
    fdv: 0,
    ath: 0,
    volume: 0,
    price: 0,
    change24h: 0,
    launchedAt: ZORP_LAUNCHED_AT,
    pair: "ETH",
    pairAsset: zeroAddress,
    poolId: RH_ZORP_POOL_ID,
    poolFee: 0,
    hue: hueFromAddress(RH_ZORP),
    recentBuys: 0,
    tokenIsCurrency0: RH_ZORP.toLowerCase() < zeroAddress.toLowerCase(),
    graduated: false,
    bonded: true,
    ...overrides,
    id: RH_ZORP,
    address: RH_ZORP,
    ticker: overrides.ticker || "ZORP",
    pair: overrides.pair || "ETH",
    pairAsset: (overrides.pairAsset as Address | undefined) || zeroAddress,
    poolId: overrides.poolId || RH_ZORP_POOL_ID,
    image: overrides.image || ZORP_IMAGE,
    bonded: true,
    graduated: overrides.graduated ?? false,
  };
}

export function applyZorpMarket(token: Token, market: ZorpMarket | null): Token {
  if (!isZorpToken(token.address) || !market || !(market.priceUsd > 0)) return token;
  const fdv = market.fdv > 0 ? market.fdv : market.priceUsd * TOTAL_SUPPLY;
  return {
    ...token,
    price: market.priceUsd,
    fdv,
    mcap: fdv,
    ath: Math.max(token.ath ?? 0, fdv),
    change24h: market.change24h,
    volume: Math.max(token.volume ?? 0, market.volume),
    bondProgress: market.bondProgress ?? token.bondProgress,
    graduated: false,
  };
}

export function pinZorp(tokens: Token[], market: ZorpMarket | null = null): Token[] {
  const rest = tokens.filter((row) => !isZorpToken(row.address));
  const existing = tokens.find((row) => isZorpToken(row.address));
  const stub =
    existing &&
    existing.mcap === TARGET_FDV_USD &&
    existing.change24h === 0 &&
    existing.volume === 0;
  return [
    applyZorpMarket(zorpLaunchToken(stub ? { ...existing, mcap: 0, fdv: 0, price: 0 } : existing), market),
    ...rest,
  ];
}

export async function readZorpDexMarket(): Promise<ZorpMarket | null> {
  try {
    const response = await fetch(ZORP_DEX_PAIR_URL, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      pair?: DexPairBody;
      pairs?: DexPairBody[];
    };
    const pair = body.pair ?? body.pairs?.[0];
    if (!pair || pair.pairAddress?.toLowerCase() !== RH_ZORP_POOL_ID.toLowerCase()) {
      return null;
    }
    const priceUsd = Number(pair.priceUsd);
    if (!(priceUsd > 0) || !Number.isFinite(priceUsd)) return null;
    const fdv =
      pair.marketCap && pair.marketCap > 0
        ? pair.marketCap
        : pair.fdv && pair.fdv > 0
          ? pair.fdv
          : priceUsd * TOTAL_SUPPLY;
    return {
      priceUsd,
      fdv,
      change24h: Number(pair.priceChange?.h24) || 0,
      volume: Number(pair.volume?.h24) || 0,
      bondProgress: 100,
    };
  } catch {
    return null;
  }
}

type DexPairBody = {
  pairAddress?: string;
  priceUsd?: string;
  fdv?: number;
  marketCap?: number;
  volume?: { h24?: number };
  priceChange?: { h24?: number };
};
