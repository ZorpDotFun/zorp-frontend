import { useCallback, useEffect, useState } from "react";
import { TOTAL_SUPPLY } from "./addresses";
import { readLaunches } from "./factory";
import { readLiveUsdPrice } from "./pool-price";
import { fetchDexscreenerPoints } from "./token-chart-data";
import type { Token } from "./tokens";

export function useLaunches() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await readLaunches();
      const priced = await Promise.all(rows.map(withLiveMarket));
      setTokens(priced);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load launches.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { tokens, loading, error, refresh };
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
