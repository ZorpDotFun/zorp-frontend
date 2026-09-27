import { zeroAddress, type Address } from "viem";
import { RH_ZORP, TARGET_FDV_USD, TOTAL_SUPPLY } from "./addresses";
import type { Token } from "./tokens";

export type ZorpMarket = {
  priceUsd: number;
  fdv: number;
  change24h: number;
  volume: number;
  bondProgress?: number;
};

const PONS_TOKEN_URL =
  "https://api.ponsfamily.com/v1/tokens/0xEe28144F417181fCdc7283bf48eD0fb68944F332";
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
    const response = await fetch(PONS_TOKEN_URL);
    if (!response.ok) return null;
    const body = (await response.json()) as {
      last_price?: string;
      quote_price_usd?: string;
      progress_bps?: number;
      buy_count?: number;
      sell_count?: number;
      curve_quote_in?: string;
      curve_quote_out?: string;
    };
    const lastPrice = Number(body.last_price);
    const ethUsd = Number(body.quote_price_usd);
    if (!(lastPrice > 0) || !(ethUsd > 0)) return null;
    const priceUsd = (lastPrice / 1e18) * ethUsd;
    if (!(priceUsd > 0) || !Number.isFinite(priceUsd)) return null;
    const quoteIn = Number(body.curve_quote_in) || 0;
    const quoteOut = Number(body.curve_quote_out) || 0;
    const volumeEth = Math.max(0, (quoteIn + quoteOut) / 1e18);
    return {
      priceUsd,
      fdv: priceUsd * TOTAL_SUPPLY,
      change24h: 0,
      volume: volumeEth * ethUsd,
      bondProgress:
        typeof body.progress_bps === "number"
          ? Math.min(100, body.progress_bps / 100)
          : undefined,
    };
  } catch {
    return null;
  }
}
