import { encodeAbiParameters, keccak256, parseAbiItem, type Address } from "viem";
import { GRADUATION_MC_USD, LAUNCH_HOOK, TOTAL_SUPPLY, USDC } from "./addresses";
import { getPublicClient, launchFactoryAbi } from "./factory";
import { getNetwork, protocolOf } from "./networks";
import type { ChartPoint } from "./token-chart-data";

const swapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);

const POOL_FEE = 0;
const TICK_SPACING = 60;
const Q96 = 2n ** 96n;
const TOKEN_UNIT = 10n ** 18n;

const stateViewAbi = [
  {
    type: "function",
    name: "getSlot0",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
] as const;

export function launchPoolKey(token: Address) {
  const protocol = protocolOf();
  const pair = protocol.pairAsset;
  const tokenIs0 = token.toLowerCase() < pair.toLowerCase();
  return {
    currency0: tokenIs0 ? token : pair,
    currency1: tokenIs0 ? pair : token,
    fee: POOL_FEE,
    tickSpacing: TICK_SPACING,
    hooks: protocol.hook,
  };
}

export function dexscreenerLaunchPairUrl(token: Address | string) {
  return `https://dexscreener.com/${getNetwork().dexSlug}/${launchPoolId(token as Address)}`;
}

let pairUsdCache = 1;

export async function refreshPairUsd() {
  const protocol = protocolOf();
  if (protocol.pairDecimals === 6) {
    pairUsdCache = 1;
    return pairUsdCache;
  }
  if (!protocol.deployed) {
    pairUsdCache = 3_000;
    return pairUsdCache;
  }
  try {
    const raw = await getPublicClient().readContract({
      address: protocol.factory,
      abi: launchFactoryAbi,
      functionName: "pairUsdPrice6",
      args: [protocol.pairAsset],
    });
    const usd = Number(raw) / 1e6;
    if (usd > 0) pairUsdCache = usd;
  } catch {
    pairUsdCache = pairUsdCache || 3_000;
  }
  return pairUsdCache;
}

export function launchPoolIdFor(token: Address, pairAsset: Address, hook: Address) {
  const tokenIs0 = token.toLowerCase() < pairAsset.toLowerCase();
  return keccak256(
    encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "currency0", type: "address" },
            { name: "currency1", type: "address" },
            { name: "fee", type: "uint24" },
            { name: "tickSpacing", type: "int24" },
            { name: "hooks", type: "address" },
          ],
        },
      ],
      [
        {
          currency0: tokenIs0 ? token : pairAsset,
          currency1: tokenIs0 ? pairAsset : token,
          fee: POOL_FEE,
          tickSpacing: TICK_SPACING,
          hooks: hook,
        },
      ],
    ),
  );
}

export function launchPoolId(token: Address) {
  const protocol = protocolOf();
  return launchPoolIdFor(token, protocol.pairAsset, protocol.hook);
}

export function arcLaunchPoolId(token: Address) {
  return launchPoolIdFor(token, USDC, LAUNCH_HOOK);
}

/** USDC (6dp) raw units per 1 whole launch token. */
export function quoteWeiFromSqrt(sqrtPriceX96: bigint, tokenIsCurrency0: boolean) {
  if (sqrtPriceX96 === 0n) return 0n;
  if (tokenIsCurrency0) {
    return (sqrtPriceX96 * sqrtPriceX96 * TOKEN_UNIT) / (Q96 * Q96);
  }
  const num = (sqrtPriceX96 * sqrtPriceX96) / Q96;
  if (num === 0n) return 0n;
  return (Q96 * TOKEN_UNIT) / num;
}

/** Quote-asset units per 1 whole launch token, converted to USD. */
export function usdPerTokenFromSqrt(sqrtPriceX96: bigint, tokenIsCurrency0: boolean) {
  if (sqrtPriceX96 === 0n) return 0;
  const protocol = protocolOf();
  const wei = quoteWeiFromSqrt(sqrtPriceX96, tokenIsCurrency0);
  if (wei === 0n) return 0;
  const quote = Number(wei) / 10 ** protocol.pairDecimals;
  if (!Number.isFinite(quote) || quote <= 0) return 0;
  return quote * (protocol.pairDecimals === 6 ? 1 : pairUsdCache);
}

export async function readLiveUsdPrice(token: Address, tokenIsCurrency0: boolean) {
  const prices = await readLiveUsdPrices([{ address: token, tokenIsCurrency0 }]);
  return prices.get(token.toLowerCase()) ?? null;
}

export async function readLiveUsdPrices(
  rows: { address: Address; tokenIsCurrency0: boolean }[],
) {
  const prices = new Map<string, number>();
  if (rows.length === 0) return prices;
  await refreshPairUsd();
  const protocol = protocolOf();
  try {
    const results = await getPublicClient().multicall({
      allowFailure: true,
      contracts: rows.map((row) => ({
        address: protocol.v4StateView,
        abi: stateViewAbi,
        functionName: "getSlot0",
        args: [launchPoolId(row.address)],
      })),
    });
    results.forEach((item, index) => {
      if (item.status !== "success") return;
      const price = usdPerTokenFromSqrt(item.result[0], rows[index].tokenIsCurrency0);
      if (Number.isFinite(price) && price > 0) {
        prices.set(rows[index].address.toLowerCase(), price);
      }
    });
  } catch {
    /* leave empty — caller keeps last known price */
  }
  return prices;
}

/** Highest launch-pool FDV seen in recent swap prints. */
export async function launchPeakFdv(
  token: Address,
  tokenIsCurrency0: boolean,
) {
  try {
    await refreshPairUsd();
    const latest = await getPublicClient().getBlockNumber();
    const lookback = 80_000n;
    const fromBlock = latest > lookback ? latest - lookback : 0n;
    const chunk = 4_000n;
    const poolId = launchPoolId(token);
    let peak = 0;

    for (let end = latest; end >= fromBlock; end -= chunk) {
      const start = end + 1n - chunk < fromBlock ? fromBlock : end + 1n - chunk;
      try {
        const logs = await getPublicClient().getLogs({
          address: protocolOf().v4PoolManager,
          event: swapEvent,
          args: { id: poolId },
          fromBlock: start,
          toBlock: end,
        });
        for (const log of logs) {
          const price = usdPerTokenFromSqrt(
            log.args.sqrtPriceX96 ?? 0n,
            tokenIsCurrency0,
          );
          if (price > 0) peak = Math.max(peak, price * TOTAL_SUPPLY);
        }
      } catch {
        continue;
      }
    }
    return peak;
  } catch {
    return 0;
  }
}

/** True if any launch-pool swap printed at or above the $40k FDV tick. */
export async function launchEverGraduated(
  token: Address,
  tokenIsCurrency0: boolean,
) {
  const peak = await launchPeakFdv(token, tokenIsCurrency0);
  return peak >= GRADUATION_MC_USD;
}

/** Real swap prints from PoolManager — not reconstructed % windows. */
export async function fetchSwapPrints(
  token: Address,
  tokenIsCurrency0: boolean,
): Promise<ChartPoint[]> {
  try {
    await refreshPairUsd();
    const logs = await collectSwapLogs(token, { limit: 80, lookback: 24_000n });
    if (logs.length === 0) return [];
    const stamps = await stampSwapBlocks(logs.map((log) => log.blockNumber));

    return logs
      .map((log) => {
        const time = stamps.get(log.blockNumber) ?? 0;
        const value = usdPerTokenFromSqrt(
          log.args.sqrtPriceX96 ?? 0n,
          tokenIsCurrency0,
        );
        return { time, value };
      })
      .filter((point) => point.time > 0 && point.value > 0)
      .sort((a, b) => a.time - b.time);
  } catch {
    return [];
  }
}

async function collectSwapLogs(
  token: Address,
  opts?: { limit?: number; lookback?: bigint },
) {
  const latest = await getPublicClient().getBlockNumber();
  const lookback = opts?.lookback ?? 24_000n;
  const limit = opts?.limit ?? 80;
  const fromBlock = latest > lookback ? latest - lookback : 0n;
  const chunk = 3_000n;
  const poolId = launchPoolId(token);
  // Concrete getLogs overloads do not survive a shared client type.
  const pages: any[] = [];
  void pages;

  for (let end = latest; end >= fromBlock; end -= chunk) {
    const start = end + 1n - chunk < fromBlock ? fromBlock : end + 1n - chunk;
    try {
      pages.push(
        await getPublicClient().getLogs({
          address: protocolOf().v4PoolManager,
          event: swapEvent,
          args: { id: poolId },
          fromBlock: start,
          toBlock: end,
        }),
      );
    } catch {
      continue;
    }
    if (pages.reduce((sum, page) => sum + page.length, 0) >= limit) break;
  }

  return pages.flat();
}

async function stampSwapBlocks(blocks: bigint[]) {
  const unique = [...new Set(blocks)].sort((a, b) => (a < b ? -1 : 1));
  const stamps = new Map<bigint, number>();
  if (unique.length === 0) return stamps;
  const first = unique[0];
  const last = unique[unique.length - 1];
  try {
    const [start, end] = await Promise.all([
      getPublicClient().getBlock({ blockNumber: first }),
      first === last
        ? Promise.resolve(null)
        : getPublicClient().getBlock({ blockNumber: last }),
    ]);
    const startTs = Number(start.timestamp);
    const endTs = end ? Number(end.timestamp) : startTs;
    const span = last - first;
    for (const block of unique) {
      stamps.set(
        block,
        span === 0n
          ? startTs
          : startTs +
              Number((block - first) * BigInt(Math.max(endTs - startTs, 0))) /
                Number(span),
      );
    }
  } catch {
    const now = Math.floor(Date.now() / 1000);
    for (const block of unique) stamps.set(block, now);
  }
  return stamps;
}
