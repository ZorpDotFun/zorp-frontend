import { getAddress, zeroAddress, type Address } from "viem";
import { RH_WETH } from "./networks";

export type QuoteSectionId = "currencies" | "stocks" | "uniswap" | "custom";

export type QuoteToken = {
  address: Address;
  symbol: string;
  name: string;
  logoUrl: string | null;
  section: Exclude<QuoteSectionId, "custom">;
  liquidityUsd: number;
};

export type QuoteCatalog = {
  currencies: QuoteToken[];
  stocks: QuoteToken[];
  uniswap: QuoteToken[];
};

export const QUOTE_SECTIONS: {
  id: QuoteSectionId;
  label: string;
}[] = [
  { id: "currencies", label: "Currencies" },
  { id: "stocks", label: "Stocks" },
  { id: "uniswap", label: "Uniswap" },
  { id: "custom", label: "Custom" },
];

export const RH_NATIVE_ETH = zeroAddress;
export const RH_USDG = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
export const RH_PONS = getAddress("0x39dBED3a2bd333467115dE45665cC57F813C4571");
export const RH_TAO = getAddress("0xf3081494B87e8D5fb7960f066E931D1D0e6E3d67");
export const RH_UNI = getAddress("0xF177d86a28b520e3E396E4F3B96cd8e72D7dabd8");

export const MIN_QUOTE_LIQUIDITY_USD = 5_000;

export const FIXED_UNISWAP: QuoteToken[] = [
  {
    address: RH_PONS,
    symbol: "PONS",
    name: "Pons",
    logoUrl: "/assets/tokens/pons.png",
    section: "uniswap",
    liquidityUsd: 0,
  },
  {
    address: RH_TAO,
    symbol: "TAO",
    name: "Bittensor",
    logoUrl: "/assets/tokens/tao.jpg",
    section: "uniswap",
    liquidityUsd: 0,
  },
  {
    address: RH_UNI,
    symbol: "UNI",
    name: "Uniswap",
    logoUrl: "/assets/tokens/uni.png",
    section: "uniswap",
    liquidityUsd: 0,
  },
];

export const ETH: QuoteToken = {
  address: RH_NATIVE_ETH,
  symbol: "ETH",
  name: "Ether",
  logoUrl: "/assets/tokens/eth.png",
  section: "currencies",
  liquidityUsd: 0,
};

export const WETH: QuoteToken = {
  address: RH_WETH,
  symbol: "WETH",
  name: "Wrapped Ether",
  logoUrl: "/assets/tokens/weth.png",
  section: "currencies",
  liquidityUsd: 0,
};

export const USDG: QuoteToken = {
  address: RH_USDG,
  symbol: "USDG",
  name: "Global Dollar",
  logoUrl: "/assets/tokens/usdg.png",
  section: "currencies",
  liquidityUsd: 0,
};

export function emptyCatalog(): QuoteCatalog {
  return { currencies: [ETH, WETH, USDG], stocks: [], uniswap: [...FIXED_UNISWAP] };
}

export function stockLogoUrl(symbol: string) {
  const ticker = symbol.trim().toUpperCase();
  return ticker ? `/assets/stocks/${ticker}.png` : null;
}

export function isNativeEth(address: string) {
  return address.toLowerCase() === RH_NATIVE_ETH.toLowerCase();
}

export function knownPairSymbol(address: string): string | null {
  const key = address.toLowerCase();
  if (key === RH_NATIVE_ETH.toLowerCase()) return ETH.symbol;
  if (key === RH_WETH.toLowerCase()) return WETH.symbol;
  if (key === RH_USDG.toLowerCase()) return USDG.symbol;
  if (key === RH_TAO.toLowerCase()) return "TAO";
  if (key === RH_PONS.toLowerCase()) return "PONS";
  if (key === RH_UNI.toLowerCase()) return "UNI";
  return null;
}

export function launchPairAddress(address: Address): Address {
  return address;
}

export async function fetchQuoteCatalog(): Promise<QuoteCatalog> {
  const res = await fetch("/api/quote-tokens");
  if (!res.ok) return emptyCatalog();
  const body = (await res.json()) as QuoteCatalog;
  return {
    currencies: withNativeEth(body.currencies),
    stocks: (body.stocks ?? []).map((row) => ({
      ...row,
      logoUrl: stockLogoUrl(row.symbol) || row.logoUrl,
    })),
    uniswap: mergeFixedUniswap(body.uniswap ?? []),
  };
}

export function mergeFixedUniswap(discovered: QuoteToken[]) {
  const extras = discovered.filter(
    (row) =>
      !FIXED_UNISWAP.some(
        (fixed) => fixed.address.toLowerCase() === row.address.toLowerCase(),
      ),
  );
  return [
    ...FIXED_UNISWAP.map((fixed) => {
      const found = discovered.find(
        (row) => row.address.toLowerCase() === fixed.address.toLowerCase(),
      );
      return found
        ? {
            ...fixed,
            name: found.name || fixed.name,
            logoUrl: fixed.logoUrl || found.logoUrl,
            liquidityUsd: found.liquidityUsd,
          }
        : fixed;
    }),
    ...extras,
  ];
}

function withNativeEth(rows: QuoteToken[] | undefined) {
  const pinned = [ETH, WETH, USDG];
  const byAddr = new Map(
    (rows ?? []).map((row) => [row.address.toLowerCase(), row] as const),
  );
  const head = pinned.map((fixed) => {
    const found = byAddr.get(fixed.address.toLowerCase());
    return found
      ? {
          ...fixed,
          name: found.name || fixed.name,
          logoUrl: fixed.logoUrl,
          liquidityUsd: found.liquidityUsd,
        }
      : fixed;
  });
  const extras = (rows ?? []).filter(
    (row) =>
      !pinned.some((fixed) => fixed.address.toLowerCase() === row.address.toLowerCase()),
  );
  return [...head, ...extras];
}

export function tokensInSection(catalog: QuoteCatalog, section: QuoteSectionId) {
  if (section === "custom") return [];
  return catalog[section];
}

export async function readUniswapBookUsd(pairAsset: Address): Promise<number> {
  const res = await fetch(
    `https://api.dexscreener.com/latest/dex/tokens/${pairAsset}`,
  );
  if (!res.ok) return 0;
  const body = (await res.json()) as {
    pairs?: {
      chainId?: string;
      dexId?: string;
      liquidity?: { usd?: number };
    }[];
  };
  let best = 0;
  for (const pair of body.pairs ?? []) {
    if (pair.chainId !== "robinhood") continue;
    const dex = (pair.dexId || "").toLowerCase();
    if (dex !== "uniswap" && !dex.startsWith("uniswap")) continue;
    const liq = pair.liquidity?.usd ?? 0;
    if (liq > best) best = liq;
  }
  return best;
}
