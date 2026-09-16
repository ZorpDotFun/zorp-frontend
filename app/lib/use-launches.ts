import { useCallback, useEffect, useRef, useState } from "react";
import { parseAbiItem, type Address } from "viem";
import { LAUNCH_FACTORY, TOTAL_SUPPLY } from "./addresses";
import { publicClient, readLaunch, readLaunchCount, readLaunches } from "./factory";
import { readLiveUsdPrice } from "./pool-price";
import { fetchDexscreenerPoints } from "./token-chart-data";
import type { Token } from "./tokens";

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

    return () => {
      cancelled = true;
      unwatch();
      window.clearInterval(poll);
    };
  }, [refresh, upsert]);

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
    const price = live ?? dex.priceUsd ?? token.price;
    const fdv = price > 0 ? price * TOTAL_SUPPLY : dex.fdv && dex.fdv > 0 ? dex.fdv : token.fdv;
    return { ...token, price, fdv, mcap: fdv };
  } catch {
    return token;
  }
}
