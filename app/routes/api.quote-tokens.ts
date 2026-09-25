import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import {
  ETH,
  MIN_QUOTE_LIQUIDITY_USD,
  RH_USDG,
  USDG,
  WETH,
  emptyCatalog,
  mergeFixedUniswap,
  type QuoteCatalog,
  type QuoteToken,
} from "../lib/quote-tokens";
import { RH_WETH } from "../lib/networks";

const RH_ASSETS = "https://api.robinhood.com/rhj/assets";
const GECKO = "https://api.geckoterminal.com/api/v2/networks/robinhood/dexes";
const DEX_TOKENS = "https://api.dexscreener.com/latest/dex/tokens/";
const DEX_SEARCH = "https://api.dexscreener.com/latest/dex/search?q=";
const UNI_DEXES = [
  "uniswap-v2-robinhood",
  "uniswap-v3-robinhood",
  "uniswap-v4-robinhood",
] as const;
const GECKO_PAGES = 4;
const HEADERS = { Accept: "application/json", "User-Agent": "zorp-quote-tokens/1" };
const CATALOG_VER = 5;

type RhAsset = {
  tokenSymbol?: string;
  tokenName?: string;
  logoUrl?: string;
  deployments?: { contractAddress?: string; chainId?: number }[];
};

type GeckoToken = {
  address: Address;
  symbol: string;
  name: string;
  logoUrl: string | null;
};

type GeckoPool = {
  reserveUsd: number;
  base: GeckoToken | null;
  quote: GeckoToken | null;
};

type DexPair = {
  chainId?: string;
  dexId?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  info?: { imageUrl?: string };
  baseToken?: { address?: string; symbol?: string; name?: string };
  quoteToken?: { address?: string; symbol?: string; name?: string };
};

let cache: { at: number; ver: number; body: QuoteCatalog } | null = null;
const TTL_MS = 2 * 60 * 1000;

export async function loader() {
  if (cache && cache.ver !== CATALOG_VER) cache = null;
  if (cache && Date.now() - cache.at < TTL_MS) {
    return Response.json(cache.body);
  }
  try {
    const body = await buildCatalog();
    cache = { at: Date.now(), ver: CATALOG_VER, body };
    return Response.json(body);
  } catch {
    return Response.json(emptyCatalog());
  }
}

async function buildCatalog(): Promise<QuoteCatalog> {
  const assets = await loadAssets();
  const stocks = new Map<string, QuoteToken>();
  for (const asset of assets) {
    const deployment = asset.deployments?.find((row) => row.chainId === 4663);
    const raw = deployment?.contractAddress;
    if (!raw || !isAddress(raw)) continue;
    const address = getAddress(raw);
    if (isWeth(address) || same(address, RH_USDG)) continue;
    stocks.set(address.toLowerCase(), {
      address,
      symbol: (asset.tokenSymbol || "TOKEN").toUpperCase(),
      name: cleanName(asset.tokenName || asset.tokenSymbol || "Stock Token"),
      logoUrl: asset.logoUrl || null,
      section: "stocks",
      liquidityUsd: 0,
    });
  }

  const [pools, dexPairs, searchPairs] = await Promise.all([
    loadGeckoPools(),
    loadDexPairs([
      ...stocks.keys(),
      "0x39dbed3a2bd333467115de45665cc57f813c4571",
      "0xf3081494b87e8d5fb7960f066e931d1d0e6e3d67",
      "0xf177d86a28b520e3e396e4f3b96cd8e72d7dabd8",
    ]),
    loadDexSearches(),
  ]);

  const uniswap = new Map<string, QuoteToken>();
  let usdgLiq = 0;
  let usdgLogo: string | null = null;
  let wethLogo: string | null = null;

  for (const pool of pools) {
    if (!pool.base || !pool.quote) continue;
    const { base, quote, reserveUsd } = pool;
    if (isWeth(base.address)) wethLogo = wethLogo || base.logoUrl;
    if (isWeth(quote.address)) wethLogo = wethLogo || quote.logoUrl;
    if (same(base.address, RH_USDG)) usdgLogo = usdgLogo || base.logoUrl;
    if (same(quote.address, RH_USDG)) usdgLogo = usdgLogo || quote.logoUrl;

    creditStock(stocks, base.address, reserveUsd);
    creditStock(stocks, quote.address, reserveUsd);

    const other = otherVsAnchor(base, quote);
    if (!other) continue;
    if (same(other.address, RH_USDG)) {
      usdgLiq = Math.max(usdgLiq, reserveUsd);
      continue;
    }
    if (isWeth(other.address) || stocks.has(other.address.toLowerCase())) continue;
    if (reserveUsd < MIN_QUOTE_LIQUIDITY_USD) continue;
    const prev = uniswap.get(other.address.toLowerCase());
    if (prev && prev.liquidityUsd >= reserveUsd) continue;
    uniswap.set(other.address.toLowerCase(), {
      address: other.address,
      symbol: other.symbol,
      name: other.name,
      logoUrl: other.logoUrl,
      section: "uniswap",
      liquidityUsd: reserveUsd,
    });
  }

  for (const pair of [...dexPairs, ...searchPairs]) {
    if (pair.chainId !== "robinhood" || !isUniswapDex(pair.dexId)) continue;
    const liq = pair.liquidity?.usd ?? 0;
    const base = pair.baseToken?.address;
    const quote = pair.quoteToken?.address;
    if (base) creditStock(stocks, base, liq);
    if (quote) creditStock(stocks, quote, liq);
    if (base && quote && isAnchor(base) && same(quote, RH_USDG)) {
      usdgLiq = Math.max(usdgLiq, liq);
    }
    if (base && quote && isAnchor(quote) && same(base, RH_USDG)) {
      usdgLiq = Math.max(usdgLiq, liq);
    }
    creditUniswapFromDex(uniswap, stocks, pair, liq);
  }

  await hydrateLogos(uniswap);

  return {
    currencies: [
      ETH,
      { ...WETH, logoUrl: WETH.logoUrl || wethLogo },
      { ...USDG, logoUrl: USDG.logoUrl || usdgLogo, liquidityUsd: usdgLiq },
    ],
    stocks: [...stocks.values()]
      .filter((row) => row.liquidityUsd >= MIN_QUOTE_LIQUIDITY_USD)
      .sort((a, b) => a.symbol.localeCompare(b.symbol)),
    uniswap: mergeFixedUniswap(
      [...uniswap.values()].sort((a, b) => b.liquidityUsd - a.liquidityUsd),
    ),
  };
}

async function loadAssets(): Promise<RhAsset[]> {
  const res = await fetch(RH_ASSETS, { headers: HEADERS });
  if (!res.ok) return [];
  const body = (await res.json()) as { assets?: RhAsset[] };
  return body.assets ?? [];
}

async function loadDexSearches(): Promise<DexPair[]> {
  const queries = [
    "uniswap robinhood",
    "uniswap v3 robinhood",
    "uniswap v4 robinhood",
    "WETH uniswap robinhood",
    "USDG uniswap robinhood",
  ];
  const rows = await Promise.all(
    queries.map(async (query) => {
      const res = await fetch(`${DEX_SEARCH}${encodeURIComponent(query)}`, { headers: HEADERS });
      if (!res.ok) return [] as DexPair[];
      const body = (await res.json()) as { pairs?: DexPair[] };
      return body.pairs ?? [];
    }),
  );
  return rows.flat();
}

async function loadDexPairs(addresses: string[]): Promise<DexPair[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < addresses.length; i += 30) {
    chunks.push(addresses.slice(i, i + 30));
  }
  const rows = await Promise.all(
    chunks.map(async (chunk) => {
      const res = await fetch(`${DEX_TOKENS}${chunk.join(",")}`, { headers: HEADERS });
      if (!res.ok) return [] as DexPair[];
      const body = (await res.json()) as { pairs?: DexPair[] | null };
      return body.pairs ?? [];
    }),
  );
  return rows.flat();
}

async function loadGeckoPools(): Promise<GeckoPool[]> {
  const requests = UNI_DEXES.flatMap((dex) =>
    Array.from({ length: GECKO_PAGES }, (_, i) =>
      fetch(
        `${GECKO}/${dex}/pools?page=${i + 1}&include=base_token,quote_token`,
        { headers: HEADERS },
      ),
    ),
  );
  const responses = await Promise.all(requests);
  const pools: GeckoPool[] = [];
  for (const res of responses) {
    if (!res.ok) continue;
    const body = (await res.json()) as {
      data?: {
        attributes?: { reserve_in_usd?: string };
        relationships?: {
          base_token?: { data?: { id?: string } };
          quote_token?: { data?: { id?: string } };
        };
      }[];
      included?: {
        id?: string;
        type?: string;
        attributes?: {
          address?: string;
          name?: string;
          symbol?: string;
          image_url?: string;
        };
      }[];
    };
    const tokens = new Map<string, GeckoToken>();
    for (const row of body.included ?? []) {
      if (row.type !== "token") continue;
      const parsed = parseGeckoToken(row.attributes?.address, row.attributes);
      if (parsed) tokens.set(row.id || "", parsed);
    }
    for (const row of body.data ?? []) {
      const reserveUsd = Number(row.attributes?.reserve_in_usd || 0);
      pools.push({
        reserveUsd: Number.isFinite(reserveUsd) ? reserveUsd : 0,
        base: tokens.get(row.relationships?.base_token?.data?.id || "") ?? null,
        quote: tokens.get(row.relationships?.quote_token?.data?.id || "") ?? null,
      });
    }
  }
  return pools;
}

function parseGeckoToken(
  raw: string | undefined,
  attributes?: { name?: string; symbol?: string; image_url?: string },
): GeckoToken | null {
  if (!raw) return null;
  const address = normalizeAddress(raw);
  if (!address) return null;
  const logo = attributes?.image_url;
  return {
    address,
    symbol: (attributes?.symbol || "TOKEN").slice(0, 16),
    name: attributes?.name || attributes?.symbol || "Token",
    logoUrl: logo && !logo.includes("missing") ? logo : null,
  };
}

function otherVsAnchor(base: GeckoToken, quote: GeckoToken): GeckoToken | null {
  const baseIsAnchor = isAnchor(base.address);
  const quoteIsAnchor = isAnchor(quote.address);
  if (baseIsAnchor === quoteIsAnchor) return null;
  return baseIsAnchor ? quote : base;
}

function creditStock(stocks: Map<string, QuoteToken>, raw: string, reserveUsd: number) {
  if (!raw || !isAddress(raw)) return;
  const stock = stocks.get(raw.toLowerCase());
  if (!stock) return;
  stock.liquidityUsd = Math.max(stock.liquidityUsd, reserveUsd);
}

function creditUniswapFromDex(
  uniswap: Map<string, QuoteToken>,
  stocks: Map<string, QuoteToken>,
  pair: DexPair,
  liq: number,
) {
  const base = pair.baseToken;
  const quote = pair.quoteToken;
  if (!base?.address || !quote?.address) return;
  if (!isAddress(base.address) || !isAddress(quote.address)) return;
  const baseIsAnchor = isAnchor(base.address);
  const quoteIsAnchor = isAnchor(quote.address);
  if (baseIsAnchor === quoteIsAnchor) return;
  const token = baseIsAnchor ? quote : base;
  const address = getAddress(token.address!);
  if (isWeth(address) || same(address, RH_USDG) || stocks.has(address.toLowerCase())) return;
  if (liq < MIN_QUOTE_LIQUIDITY_USD) return;
  const logo =
    !baseIsAnchor && pair.info?.imageUrl ? pair.info.imageUrl : null;
  const prev = uniswap.get(address.toLowerCase());
  if (prev) {
    prev.liquidityUsd = Math.max(prev.liquidityUsd, liq);
    prev.logoUrl = prev.logoUrl || logo;
    return;
  }
  uniswap.set(address.toLowerCase(), {
    address,
    symbol: (token.symbol || "TOKEN").slice(0, 16),
    name: token.name || token.symbol || "Token",
    logoUrl: logo,
    section: "uniswap",
    liquidityUsd: liq,
  });
}

async function hydrateLogos(uniswap: Map<string, QuoteToken>) {
  const missing = [...uniswap.values()]
    .filter((row) => !row.logoUrl)
    .sort((a, b) => b.liquidityUsd - a.liquidityUsd)
    .slice(0, 90)
    .map((row) => row.address);
  if (!missing.length) return;
  const pairs = await loadDexPairs(missing);
  for (const pair of pairs) {
    if (pair.chainId !== "robinhood" || !pair.info?.imageUrl) continue;
    const base = pair.baseToken?.address?.toLowerCase();
    if (!base) continue;
    const token = uniswap.get(base);
    if (token && !token.logoUrl) token.logoUrl = pair.info.imageUrl;
  }
}

function isUniswapDex(dexId?: string) {
  const dex = (dexId || "").toLowerCase();
  return dex === "uniswap" || dex.startsWith("uniswap");
}

function isAnchor(address?: string) {
  if (!address) return false;
  return isWeth(address) || same(address, RH_USDG);
}

function normalizeAddress(raw: string): Address | null {
  if (same(raw, zeroAddress)) return RH_WETH;
  if (!isAddress(raw)) return null;
  return getAddress(raw);
}

function isWeth(address: string) {
  return same(address, RH_WETH) || same(address, zeroAddress);
}

function same(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function cleanName(name: string) {
  return name.replace(/\s*[•·].*$/, "").trim();
}
