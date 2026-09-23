import { erc20Abi, formatUnits, isAddress, parseAbiItem, type Address } from "viem";
import { TOTAL_SUPPLY } from "./addresses";
import { getPublicClient } from "./factory";
import { protocolOf } from "./networks";
import { launchPoolId, usdPerTokenFromSqrt } from "./pool-price";

const TOKEN_DECIMALS = 18;
function pairDecimals() {
  return protocolOf().pairDecimals;
}
const ZERO = "0x0000000000000000000000000000000000000000";

const swapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

export type MarketTrade = {
  hash: HexString;
  trader: string;
  buy: boolean;
  tokenAmount: number;
  usdcAmount: number;
  price: number;
  time: number;
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
  lookback = 80_000n,
): Promise<MarketTrade[]> {
  try {
    const logs = await collectLogs({
      address: protocolOf().v4PoolManager,
      event: swapEvent,
      args: { id: launchPoolId(token) },
      lookback,
      newestFirst: true,
      limit: 50,
    });
    if (logs.length === 0) return [];

    const stamps = await blockTimes(logs.map((log) => log.blockNumber));
    const hashes = [...new Set(logs.map((log) => log.transactionHash))];
    const senders = new Map<HexString, string>();
    await Promise.all(
      hashes.map(async (hash) => {
        const tx = await getPublicClient().getTransaction({ hash });
        senders.set(hash, tx.from);
      }),
    );

    return logs
      .map((log) => {
        const amount0 = log.args.amount0 ?? 0n;
        const amount1 = log.args.amount1 ?? 0n;
        const tokenDelta = tokenIsCurrency0 ? amount0 : amount1;
        const usdcDelta = tokenIsCurrency0 ? amount1 : amount0;
        return {
          hash: log.transactionHash,
          trader: senders.get(log.transactionHash) ?? log.args.sender ?? "",
          buy: tokenDelta > 0n,
          tokenAmount: Number(formatUnits(abs(tokenDelta), TOKEN_DECIMALS)),
          usdcAmount: Number(formatUnits(abs(usdcDelta), pairDecimals())),
          price: usdPerTokenFromSqrt(log.args.sqrtPriceX96 ?? 0n, tokenIsCurrency0),
          time: (stamps.get(log.blockNumber) ?? 0) * 1000,
        };
      })
      .filter((row) => row.tokenAmount > 0 && row.time > 0)
      .sort((a, b) => b.time - a.time);
  } catch {
    return [];
  }
}

export async function fetchHolders(
  token: Address,
  creator?: string,
  extra: string[] = [],
): Promise<MarketHolder[]> {
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
    const logs = await collectLogs({
      address: token,
      event: transferEvent,
      newestFirst: true,
      limit: 200,
    });
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

function holderLabel(address: string, creator?: string) {
  const protocol = protocolOf();
  const value = address.toLowerCase();
  if (value === protocol.v4PoolManager.toLowerCase()) return "Pool";
  if (value === protocol.locker.toLowerCase()) return "Locked LP";
  if (value === protocol.factory.toLowerCase()) return "Factory";
  if (value === protocol.v4UniversalRouter.toLowerCase()) return "Router";
  if (value === protocol.distributor.toLowerCase()) return "Fees";
  if (creator && value === creator.toLowerCase()) return "Creator";
  return null;
}

async function collectLogs<T>({
  address,
  event,
  args,
  lookback = 80_000n,
  newestFirst = false,
  limit,
}: {
  address: Address;
  event: T;
  args?: Record<string, unknown>;
  lookback?: bigint;
  newestFirst?: boolean;
  limit?: number;
}) {
  const latest = await getPublicClient().getBlockNumber();
  const fromBlock = latest > lookback ? latest - lookback : 0n;
  const chunk = 10_000n;
  const pages: any[] = [];

  if (newestFirst) {
    for (let end = latest; end >= fromBlock; end -= chunk) {
      const start = end + 1n - chunk < fromBlock ? fromBlock : end + 1n - chunk;
      pages.push(
        await getPublicClient().getLogs({
          address,
          event: event as never,
          args: args as never,
          fromBlock: start,
          toBlock: end,
        }),
      );
      const count = pages.reduce((sum, page) => sum + page.length, 0);
      if (limit && count >= limit) break;
    }
    return pages.flat();
  }

  for (let start = fromBlock; start <= latest; start += chunk) {
    const end = start + chunk - 1n > latest ? latest : start + chunk - 1n;
    pages.push(
      await getPublicClient().getLogs({
        address,
        event: event as never,
        args: args as never,
        fromBlock: start,
        toBlock: end,
      }),
    );
  }

  return pages.flat();
}

async function blockTimes(blocks: bigint[]) {
  const unique = [...new Set(blocks)];
  const stamps = new Map<bigint, number>();
  await Promise.all(
    unique.map(async (blockNumber) => {
      const block = await getPublicClient().getBlock({ blockNumber });
      stamps.set(blockNumber, Number(block.timestamp));
    }),
  );
  return stamps;
}

function abs(value: bigint) {
  return value < 0n ? -value : value;
}
