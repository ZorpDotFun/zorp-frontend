import { useCallback, useEffect, useRef, useState } from "react";
import { parseAbiItem, type Address } from "viem";
import { LAUNCH_FACTORY, TOTAL_SUPPLY } from "./addresses";
import {
  publicClient,
  readLaunch,
  readLaunchCount,
  readLaunches,
  rememberLaunch,
} from "./factory";
import { readLiveUsdPrice } from "./pool-price";
import { fetchDexscreenerPoints } from "./token-chart-data";
import { impliedPeakFdv, noteMarketCap, type Token } from "./tokens";

const PRICE_POLL_MS = 8_000;

const launchedEvent = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed creator, address indexed pairAsset, uint256 supply, uint256 openingPrice, uint256 firstBuySpent, uint256 firstBuyTokens)",
);

export function useLaunches() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tokensRef = useRef<Token[]>([]);
  tokensRef.current = tokens;

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const rows = await readLaunches();
      const priced = await Promise.all(rows.map(withLiveMarket));
      for (const row of priced) rememberLaunch(row);
      setTokens(priced);
      setError(null);
    } catch (cause) {
      if (!silent || tokensRef.current.length === 0) {
        setError(cause instanceof Error ? cause.message : "Could not load launches.");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const refreshPrices = useCallback(async () => {
    const current = tokensRef.current;
    if (current.length === 0) return;
    const priced = await Promise.all(current.map(withLiveMarket));
    for (const row of priced) rememberLaunch(row);
    setTokens(priced);
  }, []);

  const upsert = useCallback(async (address: Address) => {
    const key = address.toLowerCase();
    if (tokensRef.current.some((row) => row.address.toLowerCase() === key)) return;
    try {
      let row = await readLaunch(address);
      if (!row) return;
      if (!row.name || !row.image) {
        await wait(700);
        row = (await readLaunch(address)) ?? row;
      }
      const priced = await withLiveMarket(row);
      rememberLaunch(priced);
      setTokens((current) => {
        if (current.some((item) => item.address.toLowerCase() === key)) return current;
        return [priced, ...current];
      });
      setError(null);
    } catch {
      void refresh(true);
    }
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    void refresh(false);

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
      unwatch();
      window.clearInterval(poll);
      window.clearInterval(pricePoll);
    };
  }, [refresh, refreshPrices, upsert]);

  return { tokens, loading, error, refresh };
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function withLiveMarket(token: Token): Promise<Token> {
  try {
    const [live, dex] = await Promise.all([
      readLiveUsdPrice(token.address as `0x${string}`, token.tokenIsCurrency0),
      fetchDexscreenerPoints(token.address),
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
    noteMarketCap(
      token.address,
      fdv,
      impliedPeakFdv(dexFdv || fdv, dex.priceChange),
    );
    return { ...token, price, fdv, mcap: fdv };
  } catch {
    return token;
  }
}
