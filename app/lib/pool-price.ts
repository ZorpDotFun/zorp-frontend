import { encodeAbiParameters, keccak256, parseAbiItem, type Address } from "viem";
import { LAUNCH_HOOK, USDC, V4_POOL_MANAGER, V4_STATE_VIEW } from "./addresses";
import { publicClient } from "./factory";
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
  const tokenIs0 = token.toLowerCase() < USDC.toLowerCase();
  return {
    currency0: tokenIs0 ? token : USDC,
    currency1: tokenIs0 ? USDC : token,
    fee: POOL_FEE,
    tickSpacing: TICK_SPACING,
    hooks: LAUNCH_HOOK,
  };
}

export function launchPoolId(token: Address) {
  const { currency0, currency1 } = launchPoolKey(token);
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
          currency0,
          currency1,
          fee: POOL_FEE,
          tickSpacing: TICK_SPACING,
          hooks: LAUNCH_HOOK,
        },
      ],
    ),
  );
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

const PRICE_SCALE = 10n ** 12n;

/** USDC per 1 whole launch token, with sub-micro precision for the chart. */
export function usdPerTokenFromSqrt(sqrtPriceX96: bigint, tokenIsCurrency0: boolean) {
  if (sqrtPriceX96 === 0n) return 0;
  const mid = (sqrtPriceX96 * sqrtPriceX96) / Q96;
  if (mid === 0n) return 0;
  const scaled = tokenIsCurrency0
    ? (mid * TOKEN_UNIT * PRICE_SCALE) / Q96
    : (Q96 * TOKEN_UNIT * PRICE_SCALE) / mid;
  return Number(scaled) / 1e6 / 1e12;
}

export async function readLiveUsdPrice(token: Address, tokenIsCurrency0: boolean) {
  try {
    const slot0 = await publicClient.readContract({
      address: V4_STATE_VIEW,
      abi: stateViewAbi,
      functionName: "getSlot0",
      args: [launchPoolId(token)],
    });
    const price = usdPerTokenFromSqrt(slot0[0], tokenIsCurrency0);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

/** Real swap prints from PoolManager — not reconstructed % windows. */
export async function fetchSwapPrints(
  token: Address,
  tokenIsCurrency0: boolean,
): Promise<ChartPoint[]> {
  try {
    const logs = await collectSwapLogs(token);
    if (logs.length === 0) return [];

    const blocks = [...new Set(logs.map((log) => log.blockNumber))];
    const stamps = new Map<bigint, number>();
    await Promise.all(
      blocks.map(async (blockNumber) => {
        const block = await publicClient.getBlock({ blockNumber });
        stamps.set(blockNumber, Number(block.timestamp));
      }),
    );

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

async function collectSwapLogs(token: Address) {
  const latest = await publicClient.getBlockNumber();
  const lookback = 80_000n;
  const fromBlock = latest > lookback ? latest - lookback : 0n;
  const chunk = 10_000n;
  const poolId = launchPoolId(token);
  const pages: Awaited<ReturnType<typeof publicClient.getLogs>>[] = [];

  for (let end = latest; end >= fromBlock; end -= chunk) {
    const start = end + 1n - chunk < fromBlock ? fromBlock : end + 1n - chunk;
    try {
      pages.push(
        await publicClient.getLogs({
          address: V4_POOL_MANAGER,
          event: swapEvent,
          args: { id: poolId },
          fromBlock: start,
          toBlock: end,
        }),
      );
    } catch {
      continue;
    }
    if (pages.reduce((sum, page) => sum + page.length, 0) >= 200) break;
  }

  return pages.flat();
}
