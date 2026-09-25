import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { fetchApiJson } from "./api";
import { GRADUATION_MC_USD, TARGET_FDV_USD, TOTAL_SUPPLY } from "./addresses";
import { getNetworkId, NETWORK_EVENT } from "./active-network";
import {
  LAUNCH_LIST_EVENT,
  launchListKey,
  publishLaunch,
  readCurrentRhLaunches,
  readLaunch,
  readLaunchListCache,
  rememberLaunch,
  rhLaunchFactoryAbi,
  writeLaunchListCache,
} from "./factory";
import { getPublicClient, protocolOf } from "./networks";
import { readLiveUsdPrices } from "./pool-price";
import {
  hasGraduated,
  noteAth,
  noteExactMcap,
  noteMarketCap,
  readExactMcap,
  tokenAth,
  type Token,
} from "./tokens";
import { publicError } from "./public-error";

const PRICE_POLL_MS = 12_000;
const TAPE_POLL_MS = 8_000;
const KEEP_LOCAL_MS = 10 * 60_000;

export function useLaunches() {
  const [networkId, setNetworkIdState] = useState(getNetworkId);
  const [tokens, setTokens] = useState<Token[]>(() => readLaunchListCache());
  const [loading, setLoading] = useState(() => readLaunchListCache().length === 0);
  const [error, setError] = useState<string | null>(null);
  const tokensRef = useRef<Token[]>([]);
  const refreshGen = useRef(0);
  tokensRef.current = tokens;

  useEffect(() => {
    const sync = () => {
      const next = getNetworkId();
      setNetworkIdState(next);
      const cached = readLaunchListCache();
      tokensRef.current = cached;
      setTokens(cached);
      setLoading(cached.length === 0);
    };
    window.addEventListener(NETWORK_EVENT, sync);
    return () => window.removeEventListener(NETWORK_EVENT, sync);
  }, []);

  const publish = useCallback((next: Token[]) => {
    if (sameTape(next, tokensRef.current)) return;
    for (const row of next) rememberLaunch(row);
    writeLaunchListCache(next);
    tokensRef.current = next;
    setTokens(next);
  }, []);

  const mergeIn = useCallback(
    (rows: Token[]) => {
      if (rows.length === 0) return;
      publish(mergeCached(rows.map(withKnownGraduation), tokensRef.current));
    },
    [publish],
  );

  const replaceCurrent = useCallback(
    (rows: Token[]) => {
      publish(keepCurrentFactory(rows.map(withKnownGraduation), tokensRef.current));
    },
    [publish],
  );

  const refreshCurrent = useCallback(async () => {
    const gen = ++refreshGen.current;
    try {
      const rows =
        getNetworkId() === "robinhood"
          ? await readCurrentRhLaunches()
          : ((await fetchApiJson<Token[]>("/launches")) ?? []);
      if (gen !== refreshGen.current) return;
      if (rows.length === 0 && tokensRef.current.length > 0) {
        setLoading(false);
        return;
      }
      replaceCurrent(rows);
      setError(null);
      setLoading(false);
    } catch (cause) {
      if (tokensRef.current.length === 0) {
        setError(publicError(cause, "Could not load launches."));
      }
      if (gen === refreshGen.current) setLoading(false);
    }
  }, [replaceCurrent]);

  const refreshPrices = useCallback(async () => {
    const current = tokensRef.current;
    if (current.length === 0) return;
    const priced = await withLiveMarkets(current);
    publish(priced);
  }, [publish]);

  useEffect(() => {
    let cancelled = false;
    void refreshCurrent().then(() => {
      if (!cancelled) void refreshPrices();
    });

    const poll = window.setInterval(() => {
      if (cancelled || document.visibilityState === "hidden") return;
      void refreshCurrent();
    }, TAPE_POLL_MS);

    const pricePoll = window.setInterval(() => {
      if (cancelled || document.visibilityState === "hidden") return;
      void refreshPrices();
    }, PRICE_POLL_MS);

    const onAdded = (event: Event) => {
      const row = (event as CustomEvent<Token>).detail;
      if (row?.address) mergeIn([row]);
    };
    window.addEventListener(LAUNCH_LIST_EVENT, onAdded);

    const onStorage = (event: StorageEvent) => {
      if (event.key !== launchListKey() || !event.newValue) return;
      try {
        const rows = JSON.parse(event.newValue) as Token[];
        if (Array.isArray(rows) && rows.length > 0) mergeIn(rows);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("storage", onStorage);

    let stopWatch: (() => void) | undefined;
    if (getNetworkId() === "robinhood") {
      const factory = protocolOf().factory;
      stopWatch = getPublicClient().watchContractEvent({
        address: factory,
        abi: rhLaunchFactoryAbi,
        eventName: "TokenLaunched",
        pollingInterval: 2_000,
        onLogs: (logs) => {
          for (const log of logs) {
            const token = log.args.token;
            if (!token) continue;
            void readLaunch(token).then((row) => {
              if (row) publishLaunch(row);
            });
          }
        },
      });
    }

    return () => {
      cancelled = true;
      refreshGen.current += 1;
      window.clearInterval(poll);
      window.clearInterval(pricePoll);
      window.removeEventListener(LAUNCH_LIST_EVENT, onAdded);
      window.removeEventListener("storage", onStorage);
      stopWatch?.();
    };
  }, [networkId, refreshCurrent, refreshPrices, mergeIn]);

  return { tokens, loading, error, refresh: refreshCurrent };
}

function keepCurrentFactory(fresh: Token[], prev: Token[]) {
  const old = new Map(prev.map((row) => [row.address.toLowerCase(), row]));
  const merged = new Map<string, Token>();
  for (const row of fresh) {
    const prior = old.get(row.address.toLowerCase());
    merged.set(row.address.toLowerCase(), holdTape(prior, row));
  }
  const now = Date.now();
  for (const row of prev) {
    const key = row.address.toLowerCase();
    if (merged.has(key)) continue;
    if (now - row.launchedAt < KEEP_LOCAL_MS) merged.set(key, row);
  }
  return [...merged.values()].sort((a, b) => b.launchedAt - a.launchedAt);
}

function mergeCached(fresh: Token[], prev: Token[]) {
  const merged = new Map<string, Token>();
  for (const row of prev) merged.set(row.address.toLowerCase(), row);
  for (const row of fresh) {
    const key = row.address.toLowerCase();
    merged.set(key, holdTape(merged.get(key), row));
  }
  return [...merged.values()].sort((a, b) => b.launchedAt - a.launchedAt);
}

function sameTape(next: Token[], prev: Token[]) {
  if (next.length !== prev.length) return false;
  return next.every((row, index) => {
    const other = prev[index];
    return (
      other &&
      row.address === other.address &&
      row.mcap === other.mcap &&
      row.price === other.price &&
      row.volume === other.volume &&
      row.image === other.image &&
      row.change24h === other.change24h
    );
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

function holdTape(prior: Token | undefined, row: Token): Token {
  const held = readExactMcap(row.address);
  const mcap = held || prior?.mcap || row.mcap;
  const fdv = held || prior?.fdv || row.fdv;
  return {
    ...row,
    image: row.image || prior?.image || "",
    ath: Math.max(row.ath ?? 0, prior?.ath ?? 0, held),
    volume: Math.max(row.volume ?? 0, prior?.volume ?? 0),
    mcap,
    fdv,
    price: held ? held / TOTAL_SUPPLY : prior?.price || row.price,
    change24h: held ? changeFromOpen(held) : prior?.change24h ?? row.change24h,
    pair: row.pair && row.pair !== "WETH" ? row.pair : prior?.pair || row.pair,
    pairAsset: row.pairAsset || prior?.pairAsset,
    poolId: row.poolId || prior?.poolId,
    graduated: row.graduated || prior?.graduated,
  };
}

function changeFromOpen(mcap: number) {
  if (!(TARGET_FDV_USD > 0)) return 0;
  return ((mcap - TARGET_FDV_USD) / TARGET_FDV_USD) * 100;
}

async function withLiveMarkets(tokens: Token[]): Promise<Token[]> {
  if (tokens.length === 0) return tokens;
  try {
    const lives = await readLiveUsdPrices(
      tokens.map((token) => ({
        address: token.address as Address,
        tokenIsCurrency0: token.tokenIsCurrency0,
        pairAsset: token.pairAsset,
        poolFee: token.poolFee,
        poolId: token.poolId,
      })),
    );
    return tokens.map((token) => {
      const livePrice = lives.get(token.address.toLowerCase()) ?? 0;
      if (!(livePrice > 0)) return token;
      const exact = noteExactMcap(token.address, livePrice * TOTAL_SUPPLY);
      const ath = noteAth(token.address, exact);
      noteMarketCap(token.address, exact);
      return {
        ...token,
        price: exact / TOTAL_SUPPLY,
        fdv: exact,
        mcap: exact,
        ath,
        change24h: changeFromOpen(exact),
        graduated:
          token.graduated ||
          exact >= GRADUATION_MC_USD ||
          hasGraduated(token.address) ||
          ath >= GRADUATION_MC_USD,
      };
    });
  } catch {
    return tokens.map(withKnownGraduation);
  }
}

