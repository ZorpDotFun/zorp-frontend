import { erc20Abi, formatUnits, isAddress, parseAbiItem, type Address } from "viem";
import { TOTAL_SUPPLY } from "./addresses";
import { getPublicClient, resolveRhLaunchFactory } from "./factory";
import type { NetworkId } from "./active-network";
import { getNetwork, protocolOf } from "./networks";
import { launchPoolIdForToken, pairMark, usdPerTokenFromSqrt } from "./pool-price";
import { collectContractLogs, marketWindow } from "./rpc-logs";

const TOKEN_DECIMALS = 18;
const ZERO = "0x0000000000000000000000000000000000000000";

const swapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

const launchedEvent = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed creator, address indexed pairAsset, uint256 supply, uint256 openingPrice, uint256 firstBuySpent, uint256 firstBuyTokens)",
);
const rhLaunchedEvent = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed creator, address indexed pairAsset, bytes32 poolId, uint24 fee, uint16 creatorFeeBps, uint8 feeTo, uint256 firstBuySpent, uint256 firstBuyTokens)",
);

export type MarketTrade = {
  hash: HexString;
  trader: string;
  buy: boolean;
  tokenAmount: number;
  usdcAmount: number;
  price: number;
  time: number;
  venue?: string;
};

export type MarketHolder = {
  address: string;
  amount: number;
  share: number;
  label: string | null;
};

type HexString = `0x${string}`;

export const MARKET_REFRESH = "zorp:market-refresh";

export function requestMarketRefresh(detail?: {
  token?: string;
  hash?: string;
  trade?: MarketTrade;
}) {
  window.dispatchEvent(new CustomEvent(MARKET_REFRESH, { detail }));
}

export async function fetchRecentTrades(
  token: Address,
  tokenIsCurrency0: boolean,
  lookback?: bigint,
  meta?: { poolId?: string; pairAsset?: string; creator?: string },
): Promise<MarketTrade[]> {
  const indexed = await fetchMarketIndex<MarketTrade[]>("trades", token, {
    tokenIsCurrency0,
    poolId: meta?.poolId,
    pairAsset: meta?.pairAsset,
    creator: meta?.creator,
  });
  if (indexed && indexed.length > 0) return indexed;

  const [resolved, creatorBuy, mark] = await Promise.all([
    resolveLaunch(token, meta),
    fetchCreatorBuy(token),
    pairMark(meta?.pairAsset),
  ]);
  const window =
    lookback != null
      ? await lookbackWindow(lookback)
      : await marketWindow(resolved.launchedAt);

  let rows: MarketTrade[] = [];
  try {
    const logs = (await collectContractLogs({
      address: protocolOf().v4PoolManager,
      event: swapEvent,
      args: { id: resolved.poolId },
      fromBlock: window.fromBlock,
      newestFirst: true,
      limit: 50,
    })) as {
      args: {
        amount0?: bigint;
        amount1?: bigint;
        sender?: Address;
        sqrtPriceX96?: bigint;
      };
      blockNumber: bigint;
      transactionHash: HexString;
    }[];

    const stamps = await blockTimes(logs.map((log) => log.blockNumber));
    const hashes = [...new Set(logs.map((log) => log.transactionHash))];
    const senders = new Map<HexString, string>();
    await Promise.all(
      hashes.map(async (hash) => {
        try {
          const tx = await getPublicClient().getTransaction({ hash });
          senders.set(hash, tx.from);
        } catch {
          /* sender falls back to the pool sender */
        }
      }),
    );

    rows = logs
      .map((log) => {
        const amount0 = log.args.amount0 ?? 0n;
        const amount1 = log.args.amount1 ?? 0n;
        const tokenDelta = tokenIsCurrency0 ? amount0 : amount1;
        const pairDelta = tokenIsCurrency0 ? amount1 : amount0;
        const locker = protocolOf().locker.toLowerCase();
        const sender = (log.args.sender ?? "").toLowerCase();
        const fromWallet = senders.get(log.transactionHash) ?? log.args.sender ?? "";
        return {
          hash: log.transactionHash,
          trader: fromWallet,
          buy: tokenDelta > 0n || sender === locker,
          tokenAmount: Number(formatUnits(abs(tokenDelta), TOKEN_DECIMALS)),
          usdcAmount: Number(formatUnits(abs(pairDelta), mark.decimals)) * mark.usd,
          price: usdPerTokenFromSqrt(log.args.sqrtPriceX96 ?? 0n, tokenIsCurrency0),
          time: (stamps.get(log.blockNumber) ?? Date.now() / 1000) * 1000,
          venue: sender === locker ? "Creator" : "Uniswap v4",
        };
      })
      .filter((row) => row.tokenAmount > 0);
  } catch {
    rows = [];
  }

  if (rows.length === 0) {
    rows = await fetchTradesFromTransfers(token, window.fromBlock);
  }

  if (creatorBuy) {
    const index = rows.findIndex(
      (row) => row.hash.toLowerCase() === creatorBuy.hash.toLowerCase(),
    );
    if (index >= 0) {
      rows[index] = {
        ...rows[index],
        buy: true,
        trader: creatorBuy.trader || rows[index].trader,
        tokenAmount: creatorBuy.tokenAmount || rows[index].tokenAmount,
        usdcAmount: creatorBuy.usdcAmount || rows[index].usdcAmount,
        venue: "Creator",
      };
    } else {
      rows.push(creatorBuy);
    }
  }

  return rows.sort((a, b) => b.time - a.time);
}

async function resolveLaunch(
  token: Address,
  meta?: { poolId?: string; pairAsset?: string },
) {
  if (getNetwork().id === "robinhood") {
    try {
      const resolved = await resolveRhLaunchFactory(token);
      if (resolved) {
        return {
          poolId: meta?.poolId || resolved.launch[3],
          pairAsset: meta?.pairAsset || resolved.launch[2],
          launchedAt: resolved.launch[7],
          exists: true,
        };
      }
    } catch {
      /* fall through */
    }
  }
  return {
    poolId: launchPoolIdForToken({
      address: token,
      pairAsset: meta?.pairAsset,
      poolId: meta?.poolId,
    }),
    pairAsset: meta?.pairAsset,
    launchedAt: undefined,
    exists: Boolean(meta?.poolId),
  };
}

async function fetchCreatorBuy(token: Address): Promise<MarketTrade | null> {
  const fromLaunch = await readFirstBuyFromLaunch(token);
  if (fromLaunch) return fromLaunch;
  return readFirstBuyFromTransfers(token);
}

async function readFirstBuyFromLaunch(token: Address): Promise<MarketTrade | null> {
  try {
    const rh = getNetwork().id === "robinhood";
    const pad = rh ? await resolveRhLaunchFactory(token) : null;
    const window = await marketWindow();
    const logs = (await collectContractLogs({
      address: pad?.factory ?? protocolOf().factory,
      event: rh ? rhLaunchedEvent : launchedEvent,
      args: { token },
      fromBlock: window.fromBlock,
      newestFirst: true,
      limit: 1,
    })) as {
      args: {
        firstBuySpent?: bigint;
        firstBuyTokens?: bigint;
        pairAsset?: Address;
        creator?: Address;
      };
      blockNumber: bigint;
      transactionHash: HexString;
    }[];
    const log = logs[0];
    const spent = log?.args.firstBuySpent ?? 0n;
    const tokens = log?.args.firstBuyTokens ?? 0n;
    if (!log || (spent === 0n && tokens === 0n)) return null;

    const [stamps, mark] = await Promise.all([
      blockTimes([log.blockNumber]),
      pairMark(log.args.pairAsset),
    ]);
    return {
      hash: log.transactionHash,
      trader: log.args.creator ?? "",
      buy: true,
      tokenAmount: Number(formatUnits(tokens, TOKEN_DECIMALS)),
      usdcAmount: Number(formatUnits(spent, mark.decimals)),
      price: 0,
      time: (stamps.get(log.blockNumber) ?? 0) * 1000,
      venue: "Creator",
    };
  } catch {
    return null;
  }
}

async function readFirstBuyFromTransfers(token: Address): Promise<MarketTrade | null> {
  try {
    const pad =
      getNetwork().id === "robinhood" ? await resolveRhLaunchFactory(token) : null;
    const creator = pad?.launch[1];
    if (!creator) return null;

    const sources = new Set(
      [
        pad.locker,
        pad.factory,
        protocolOf().locker,
        protocolOf().factory,
        protocolOf().v4PoolManager,
        ZERO,
      ].map((value) => value.toLowerCase()),
    );

    const window = await marketWindow(pad.launch[7]);
    const logs = (await collectContractLogs({
      address: token,
      event: transferEvent,
      args: { to: creator },
      fromBlock: window.fromBlock,
      newestFirst: false,
      limit: 30,
    })) as {
      args: { from?: Address; value?: bigint };
      blockNumber: bigint;
      transactionHash: HexString;
    }[];
    const first = logs.find((log) =>
      sources.has((log.args.from ?? "").toLowerCase()),
    );
    const tokens = first?.args.value ?? 0n;
    if (!first || tokens === 0n) return null;

    const stamps = await blockTimes([first.blockNumber]);
    return {
      hash: first.transactionHash,
      trader: creator,
      buy: true,
      tokenAmount: Number(formatUnits(tokens, TOKEN_DECIMALS)),
      usdcAmount: 0,
      price: 0,
      time: (stamps.get(first.blockNumber) ?? 0) * 1000,
      venue: "Creator",
    };
  } catch {
    return null;
  }
}

export async function fetchHolders(
  token: Address,
  creator?: string,
  extra: string[] = [],
): Promise<MarketHolder[]> {
  const indexed = await fetchMarketIndex<MarketHolder[]>("holders", token, { creator });
  if (indexed && indexed.length > 0) return indexed;

  const protocol = protocolOf();
  const seen = new Set<string>([
    protocol.v4PoolManager.toLowerCase(),
    protocol.locker.toLowerCase(),
    protocol.factory.toLowerCase(),
    protocol.v4UniversalRouter.toLowerCase(),
    protocol.distributor.toLowerCase(),
    ...(creator ? [creator.toLowerCase()] : []),
    ...extra.map((value) => value.toLowerCase()).filter(Boolean),
  ]);

  try {
    const window = await marketWindow();
    const logs = (await collectContractLogs({
      address: token,
      event: transferEvent,
      fromBlock: window.fromBlock,
      newestFirst: true,
      limit: 200,
    })) as { args: { from?: Address; to?: Address } }[];
    for (const log of logs) {
      const from = log.args.from?.toLowerCase();
      const to = log.args.to?.toLowerCase();
      if (from && from !== ZERO) seen.add(from);
      if (to && to !== ZERO) seen.add(to);
    }
  } catch {
    // Transfer history is optional; seeded wallets still get balances.
  }

  const addresses = [...seen].filter((value): value is Address => isAddress(value));
  const balances = await readBalances(token, addresses);

  return addresses
    .map((address, index) => {
      const raw = balances[index] ?? 0n;
      const amount = Number(formatUnits(raw, TOKEN_DECIMALS));
      return {
        address,
        amount,
        share: TOTAL_SUPPLY > 0 ? (amount / TOTAL_SUPPLY) * 100 : 0,
        label: holderLabel(address, creator),
      };
    })
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 50);
}

async function readBalances(token: Address, addresses: Address[]) {
  try {
    const results = await getPublicClient().multicall({
      allowFailure: true,
      contracts: addresses.map((account) => ({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf" as const,
        args: [account],
      })),
    });
    return results.map((result) =>
      result.status === "success" ? result.result : 0n,
    );
  } catch {
    return Promise.all(
      addresses.map(async (account) => {
        try {
          return await getPublicClient().readContract({
            address: token,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [account],
          });
        } catch {
          return 0n;
        }
      }),
    );
  }
}

export function holderLabel(address: string, creator?: string, networkId?: NetworkId) {
  const protocol = protocolOf(networkId);
  const value = address.toLowerCase();
  if (value === protocol.v4PoolManager.toLowerCase()) return "Pool";
  if (value === protocol.locker.toLowerCase()) return "Locked LP";
  if (value === protocol.factory.toLowerCase()) return "Factory";
  if (value === protocol.v4UniversalRouter.toLowerCase()) return "Router";
  if (value === protocol.distributor.toLowerCase()) return "Fees";
  if (creator && value === creator.toLowerCase()) return "Creator";
  return null;
}

async function fetchTradesFromTransfers(
  token: Address,
  fromBlock: bigint,
): Promise<MarketTrade[]> {
  try {
    const protocol = protocolOf();
    const skip = new Set(
      [
        protocol.v4PoolManager,
        protocol.locker,
        protocol.factory,
        protocol.vault,
        protocol.v4UniversalRouter,
        ZERO,
      ].map((value) => value.toLowerCase()),
    );
    const pool = protocol.v4PoolManager.toLowerCase();
    const logs = (await collectContractLogs({
      address: token,
      event: transferEvent,
      fromBlock,
      newestFirst: true,
      limit: 80,
    })) as {
      args: { from?: Address; to?: Address; value?: bigint };
      blockNumber: bigint;
      transactionHash: HexString;
    }[];
    const stamps = await blockTimes(logs.map((log) => log.blockNumber));
    const rows: MarketTrade[] = [];
    const seen = new Set<string>();
    for (const log of logs) {
      const from = (log.args.from ?? "").toLowerCase();
      const to = (log.args.to ?? "").toLowerCase();
      const value = log.args.value ?? 0n;
      if (value <= 0n || seen.has(log.transactionHash)) continue;
      const buy = from === pool && !skip.has(to);
      const sell = to === pool && !skip.has(from);
      if (!buy && !sell) continue;
      seen.add(log.transactionHash);
      rows.push({
        hash: log.transactionHash,
        trader: buy ? log.args.to ?? "" : log.args.from ?? "",
        buy,
        tokenAmount: Number(formatUnits(value, TOKEN_DECIMALS)),
        usdcAmount: 0,
        price: 0,
        time: (stamps.get(log.blockNumber) ?? Date.now() / 1000) * 1000,
        venue: buy && from === protocol.locker.toLowerCase() ? "Creator" : "Uniswap v4",
      });
    }
    return rows;
  } catch {
    return [];
  }
}

async function lookbackWindow(lookback: bigint) {
  const latest = await getPublicClient().getBlockNumber();
  return { latest, fromBlock: latest > lookback ? latest - lookback : 0n };
}

async function blockTimes(blocks: bigint[]) {
  const unique = [...new Set(blocks)];
  const stamps = new Map<bigint, number>();
  await Promise.all(
    unique.map(async (blockNumber) => {
      try {
        const block = await getPublicClient().getBlock({ blockNumber });
        stamps.set(blockNumber, Number(block.timestamp));
      } catch {
        /* keep going; the row falls back to now */
      }
    }),
  );
  return stamps;
}

function abs(value: bigint) {
  return value < 0n ? -value : value;
}

async function fetchMarketIndex<T>(
  kind: "trades" | "holders",
  token: Address,
  extra: {
    creator?: string;
    poolId?: string;
    pairAsset?: string;
    tokenIsCurrency0?: boolean;
  } = {},
): Promise<T | null> {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams({
    kind,
    token,
    chainId: String(getNetwork().chainId),
  });
  if (extra.creator) params.set("creator", extra.creator);
  if (extra.poolId) params.set("poolId", extra.poolId);
  if (extra.pairAsset) params.set("pairAsset", extra.pairAsset);
  if (extra.tokenIsCurrency0) params.set("tokenIsCurrency0", "1");
  try {
    const response = await fetch(`/api/market?${params}`);
    if (!response.ok) return null;
    const body = (await response.json()) as T | { error?: string };
    if (body && typeof body === "object" && "error" in body) return null;
    return Array.isArray(body) ? (body as T) : null;
  } catch {
    return null;
  }
}
