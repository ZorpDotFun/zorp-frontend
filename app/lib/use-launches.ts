import { useCallback, useEffect, useRef, useState } from "react";
import { parseAbiItem, type Address } from "viem";
import { fetchApiJson } from "./api";
import { GRADUATION_MC_USD, TOTAL_SUPPLY } from "./addresses";
import { getNetworkId, NETWORK_EVENT } from "./active-network";
import { protocolOf } from "./networks";
import {
  publicClient,
  peekLaunch,
  readLaunch,
  readLaunchCount,
  readLaunches,
  rememberLaunch,
} from "./factory";
import { launchPoolId, readLiveUsdPrices } from "./pool-price";
import { fetchDexscreenerMarkets } from "./token-chart-data";
import {
  impliedPeakFdv,
  hasGraduated,
  noteAth,
  noteMarketCap,
  tokenAth,
  type Token,
} from "./tokens";

const PRICE_POLL_MS = 12_000;
function listKey() {
  return `zorp-launch-list-v2-${getNetworkId()}`;
}

const launchedEvent = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed creator, address indexed pairAsset, uint256 supply, uint256 openingPrice, uint256 firstBuySpent, uint256 firstBuyTokens)",
);

export function useLaunches() {
  const [networkId, setNetworkIdState] = useState(getNetworkId);
  const [tokens, setTokens] = useState<Token[]>(() => readCachedLaunchList());
  const [loading, setLoading] = useState(() => readCachedLaunchList().length === 0);
  const [error, setError] = useState<string | null>(null);
  const tokensRef = useRef<Token[]>([]);
  const refreshGen = useRef(0);
  tokensRef.current = tokens;

  useEffect(() => {
    const sync = () => {
      const next = getNetworkId();
      setNetworkIdState(next);
      const cached = readCachedLaunchList();
      tokensRef.current = cached;
      setTokens(cached);
      setLoading(cached.length === 0);
    };
    window.addEventListener(NETWORK_EVENT, sync);
    return () => window.removeEventListener(NETWORK_EVENT, sync);
  }, []);

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
      const apiRows =
        getNetworkId() === "arc" ? await fetchApiJson<Token[]>("/launches") : null;
      if (apiRows && apiRows.length > 0) {
        if (gen !== refreshGen.current) return;
        publish(mergeCached(apiRows.map(withKnownGraduation), tokensRef.current));
        setError(null);
        setLoading(false);
        return;
      }
      const rows = await readLaunches();
      if (gen !== refreshGen.current) return;
      const seeded = mergeCached(rows.map(withKnownGraduation), tokensRef.current);
      publish(seeded);
      setError(null);
      setLoading(false);

      const priced = await withLiveMarkets(seeded);
      if (gen !== refreshGen.current) return;
      publish(priced);
    } catch (cause) {
      if (!silent || tokensRef.current.length === 0) {
        setError(cause instanceof Error ? cause.message : "Could not load launches.");
      }
      if (gen === refreshGen.current) setLoading(false);
    }
  }, [publish]);

  const refreshPrices = useCallback(async () => {
    const apiRows = getNetworkId() === "arc"
      ? await fetchApiJson<Token[]>("/launches")
      : null;
    if (apiRows && apiRows.length > 0) {
      publish(mergeCached(apiRows.map(withKnownGraduation), tokensRef.current));
      return;
    }
    const current = tokensRef.current;
    if (current.length === 0) return;
    const priced = await withLiveMarkets(current);
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
      const [priced] = await withLiveMarkets([seeded]);
      rememberLaunch(priced);
      setTokens((current) => {
        const next = current.some((item) => item.address.toLowerCase() === key)
          ? current.map((item) => (item.address.toLowerCase() === key ? priced : item))
          : [priced, ...current];
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

    const factory = protocolOf().factory;
    const unwatch = protocolOf().deployed
      ? publicClient.watchEvent({
          address: factory,
          event: launchedEvent,
          pollingInterval: 2_000,
          onLogs: (logs) => {
            if (cancelled) return;
            for (const log of logs) {
              const token = log.args.token;
              if (token) void upsert(token);
            }
          },
        })
      : () => {};

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
  }, [networkId, refresh, refreshPrices, upsert]);

  return { tokens, loading, error, refresh };
}

function mergeCached(fresh: Token[], prev: Token[]) {
  const old = new Map(prev.map((row) => [row.address.toLowerCase(), row]));
  return fresh.map((row) => {
    const prior = old.get(row.address.toLowerCase());
    if (!prior) return row;
    return {
      ...row,
      image: row.image || prior.image,
      ath: Math.max(row.ath ?? 0, prior.ath ?? 0),
      volume: row.volume || prior.volume,
      graduated: row.graduated || prior.graduated,
    };
  });
}

function withKnownGraduation(token: Token): Token {
  const ath = tokenAth(token);
  return {
    ...token,
    ath,
    graduated:
      token.graduated ||
      hasGraduated(token.address) ||
      ath >= GRADUATION_MC_USD,
  };
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function withLiveMarkets(tokens: Token[]): Promise<Token[]> {
  if (tokens.length === 0) return tokens;
  try {
    const [lives, dex] = await Promise.all([
      readLiveUsdPrices(
        tokens.map((token) => ({
          address: token.address as Address,
          tokenIsCurrency0: token.tokenIsCurrency0,
        })),
      ),
      fetchDexscreenerMarkets(
        tokens.map((token) => ({
          address: token.address,
          poolId: launchPoolId(token.address as Address),
        })),
      ),
    ]);
    return tokens.map((token) => {
      const key = token.address.toLowerCase();
      const market = dex.get(key);
      const livePrice = lives.get(key) ?? 0;
      const dexPrice = market?.priceUsd ?? 0;
      const price = [livePrice, dexPrice, token.price].reduce(
        (best, next) => (next > best ? next : best),
        0,
      );
      const liveFdv = livePrice > 0 ? livePrice * TOTAL_SUPPLY : 0;
      const dexFdv = market?.fdv && market.fdv > 0 ? market.fdv : 0;
      const fdv =
        Math.max(liveFdv, dexFdv, price > 0 ? price * TOTAL_SUPPLY : 0) ||
        token.fdv;
      const implied = impliedPeakFdv(dexFdv || fdv, market?.priceChange);
      const ath = noteAth(token.address, Math.max(fdv, implied, token.ath ?? 0));
      noteMarketCap(token.address, fdv, implied);
      const graduated =
        token.graduated ||
        fdv >= GRADUATION_MC_USD ||
        hasGraduated(token.address) ||
        ath >= GRADUATION_MC_USD;
      if (graduated) noteMarketCap(token.address, GRADUATION_MC_USD);
      return { ...token, price, fdv, mcap: fdv, ath, graduated };
    });
  } catch {
    return tokens.map(withKnownGraduation);
  }
}

function readCachedLaunchList(): Token[] {
  if (typeof window === "undefined") return [];
  try {
    const raw =
      window.localStorage.getItem(listKey()) ??
      (getNetworkId() === "arc"
        ? window.sessionStorage.getItem("zorp-launch-list")
        : null);
    const rows = raw ? (JSON.parse(raw) as Token[]) : [];
    for (const row of rows) rememberLaunch(row);
    return rows;
  } catch {
    return [];
  }
}

function writeCachedLaunchList(tokens: Token[]) {
  const raw = JSON.stringify(tokens);
  try {
    window.localStorage.setItem(listKey(), raw);
  } catch {
    /* quota / private */
  }
  try {
    window.sessionStorage.setItem(listKey(), raw);
  } catch {
    /* private mode */
  }
}
