import { useCallback, useEffect, useRef, useState } from "react";
import { parseAbiItem, type Address } from "viem";
import { GRADUATION_MC_USD, LAUNCH_FACTORY, TOTAL_SUPPLY } from "./addresses";
import {
  publicClient,
  peekLaunch,
  readLaunch,
  readLaunchCount,
  readLaunches,
  rememberLaunch,
} from "./factory";
import { launchEverGraduated, launchPoolId, readLiveUsdPrice } from "./pool-price";
import { fetchDexscreenerPoints } from "./token-chart-data";
import {
  impliedPeakFdv,
  hasGraduated,
  noteMarketCap,
  type Token,
} from "./tokens";

const peakChecked = new Set<string>();
const PRICE_POLL_MS = 8_000;
const SCAN_CONCURRENCY = 3;
const LIST_KEY = "zorp-launch-list";

const launchedEvent = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed creator, address indexed pairAsset, uint256 supply, uint256 openingPrice, uint256 firstBuySpent, uint256 firstBuyTokens)",
);

export function useLaunches() {
  const [tokens, setTokens] = useState<Token[]>(() => readCachedLaunchList());
  const [loading, setLoading] = useState(() => readCachedLaunchList().length === 0);
  const [error, setError] = useState<string | null>(null);
  const tokensRef = useRef<Token[]>([]);
  const refreshGen = useRef(0);
  tokensRef.current = tokens;

  const publish = useCallback((next: Token[]) => {
    for (const row of next) rememberLaunch(row);
    writeCachedLaunchList(next);
    tokensRef.current = next;
    setTokens(next);
  }, []);

  const refresh = useCallback(async (silent = false) => {
    const gen = ++refreshGen.current;
    if (!silent && tokensRef.current.length === 0) setLoading(true);
    try {
      const rows = await readLaunches();
      if (gen !== refreshGen.current) return;
      const seeded = rows.map(withKnownGraduation);
      publish(seeded);
      setError(null);
      setLoading(false);

      const priced = await Promise.all(seeded.map(withLiveMarket));
      if (gen !== refreshGen.current) return;
      publish(priced);

      const scanned = await mapPool(priced, SCAN_CONCURRENCY, scanGraduation);
      if (gen !== refreshGen.current) return;
      publish(scanned);
    } catch (cause) {
      if (!silent || tokensRef.current.length === 0) {
        setError(cause instanceof Error ? cause.message : "Could not load launches.");
      }
      if (gen === refreshGen.current) setLoading(false);
    }
  }, [publish]);

  const refreshPrices = useCallback(async () => {
    const current = tokensRef.current;
    if (current.length === 0) return;
    const priced = await Promise.all(current.map(withLiveMarket));
    publish(priced);
  }, [publish]);

  const upsert = useCallback(async (address: Address) => {
    const key = address.toLowerCase();
    if (tokensRef.current.some((row) => row.address.toLowerCase() === key)) return;
    try {
      let row = peekLaunch(address) ?? (await readLaunch(address));
      if (!row) return;
      if (!row.name || !row.image) {
        await wait(700);
        row = (await readLaunch(address)) ?? row;
      }
      const seeded = withKnownGraduation(row);
      publish([seeded, ...tokensRef.current.filter((item) => item.address.toLowerCase() !== key)]);
      const priced = await withLiveMarket(seeded);
      const scanned = await scanGraduation(priced);
      rememberLaunch(scanned);
      setTokens((current) => {
        const next = current.some((item) => item.address.toLowerCase() === key)
          ? current.map((item) => (item.address.toLowerCase() === key ? scanned : item))
          : [scanned, ...current];
        writeCachedLaunchList(next);
        tokensRef.current = next;
        return next;
      });
      setError(null);
    } catch {
      void refresh(true);
    }
  }, [publish, refresh]);

  useEffect(() => {
    let cancelled = false;
    void refresh(tokensRef.current.length > 0);

    const unwatch = publicClient.watchEvent({
      address: LAUNCH_FACTORY,
      event: launchedEvent,
      pollingInterval: 2_000,
      onLogs: (logs) => {
        if (cancelled) return;
        for (const log of logs) {
          const token = log.args.token;
          if (token) void upsert(token);
        }
      },
    });

    const poll = window.setInterval(() => {
      if (cancelled || document.visibilityState === "hidden") return;
      void readLaunchCount()
        .then((count) => {
          if (!cancelled && count > tokensRef.current.length) void refresh(true);
        })
        .catch(() => {
          /* next tick */
        });
    }, 5_000);

    const pricePoll = window.setInterval(() => {
      if (cancelled || document.visibilityState === "hidden") return;
      void refreshPrices();
    }, PRICE_POLL_MS);

    return () => {
      cancelled = true;
      refreshGen.current += 1;
      unwatch();
      window.clearInterval(poll);
      window.clearInterval(pricePoll);
    };
  }, [refresh, refreshPrices, upsert]);

  return { tokens, loading, error, refresh };
}

function withKnownGraduation(token: Token): Token {
  return {
    ...token,
    graduated: token.graduated || hasGraduated(token.address),
  };
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function withLiveMarket(token: Token): Promise<Token> {
  try {
    const [live, dex] = await Promise.all([
      readLiveUsdPrice(token.address as `0x${string}`, token.tokenIsCurrency0),
      fetchDexscreenerPoints(
        token.address,
        launchPoolId(token.address as `0x${string}`),
      ),
    ]);
    const livePrice = live ?? 0;
    const dexPrice = dex.priceUsd ?? 0;
    const price = [livePrice, dexPrice, token.price].reduce(
      (best, next) => (next > best ? next : best),
      0,
    );
    const liveFdv = livePrice > 0 ? livePrice * TOTAL_SUPPLY : 0;
    const dexFdv = dex.fdv && dex.fdv > 0 ? dex.fdv : 0;
    const fdv =
      Math.max(liveFdv, dexFdv, price > 0 ? price * TOTAL_SUPPLY : 0) ||
      token.fdv;
    const implied = impliedPeakFdv(dexFdv || fdv, dex.priceChange);
    noteMarketCap(token.address, fdv, implied);
    const graduated =
      token.graduated ||
      fdv >= GRADUATION_MC_USD ||
      hasGraduated(token.address) ||
      implied >= GRADUATION_MC_USD;
    if (graduated) noteMarketCap(token.address, GRADUATION_MC_USD);
    return { ...token, price, fdv, mcap: fdv, graduated };
  } catch {
    return withKnownGraduation(token);
  }
}

async function scanGraduation(token: Token): Promise<Token> {
  if (token.graduated || hasGraduated(token.address)) {
    return { ...token, graduated: true };
  }
  const key = token.address.toLowerCase();
  if (peakChecked.has(key)) return token;
  peakChecked.add(key);
  const ever = await launchEverGraduated(
    token.address as `0x${string}`,
    token.tokenIsCurrency0,
  );
  if (!ever) return token;
  noteMarketCap(token.address, GRADUATION_MC_USD);
  return { ...token, graduated: true };
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
) {
  if (items.length === 0) return [] as R[];
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return out;
}

function readCachedLaunchList(): Token[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(LIST_KEY);
    const rows = raw ? (JSON.parse(raw) as Token[]) : [];
    for (const row of rows) rememberLaunch(row);
    return rows;
  } catch {
    return [];
  }
}

function writeCachedLaunchList(tokens: Token[]) {
  try {
    sessionStorage.setItem(LIST_KEY, JSON.stringify(tokens));
  } catch {
    /* private mode */
  }
}
