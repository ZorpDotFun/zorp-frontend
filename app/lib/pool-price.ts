import { encodeAbiParameters, erc20Abi, keccak256, parseAbiItem, type Address } from "viem";
import { GRADUATION_MC_USD, LAUNCH_HOOK, TOTAL_SUPPLY, USDC } from "./addresses";
import { getPublicClient, rhLaunchFactoryAbi } from "./factory";
import { getNetwork, protocolOf } from "./networks";
import { isNativeEth, RH_USDG } from "./quote-tokens";
import { collectContractLogs, marketWindow } from "./rpc-logs";
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

export function launchPoolKeyFor(
  token: Address,
  pairAsset: Address,
  hook: Address,
  fee = POOL_FEE,
  tickSpacing = TICK_SPACING,
) {
  const tokenIs0 = token.toLowerCase() < pairAsset.toLowerCase();
  return {
    currency0: tokenIs0 ? token : pairAsset,
    currency1: tokenIs0 ? pairAsset : token,
    fee,
    tickSpacing,
    hooks: hook,
  };
}

export function launchPoolKey(token: Address) {
  const protocol = protocolOf();
  return launchPoolKeyFor(token, protocol.pairAsset, protocol.hook);
}

export function dexscreenerLaunchPairUrl(
  token: Address | string,
  poolId?: string,
) {
  return `https://dexscreener.com/${getNetwork().dexSlug}/${poolId ?? launchPoolId(token as Address)}`;
}

type PairMark = { decimals: number; usd: number };

const markCache = new Map<string, PairMark & { at: number }>();

const gateUsdAbi = [
  {
    type: "function",
    name: "pairUsd6",
    stateMutability: "view",
    inputs: [
      { name: "pairAsset", type: "address" },
      { name: "ethUsdMark", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

function defaultMark(): PairMark {
  const protocol = protocolOf();
  return protocol.pairDecimals === 6
    ? { decimals: 6, usd: 1 }
    : { decimals: protocol.pairDecimals, usd: 1 };
}

export async function refreshPairUsd() {
  const mark = await pairMark();
  return mark.usd;
}

export async function pairMark(pairAsset?: string): Promise<PairMark> {
  const protocol = protocolOf();
  const pair = (pairAsset ?? protocol.pairAsset).toLowerCase();
  const hit = markCache.get(pair);
  if (hit && Date.now() - hit.at < 30_000) return hit;

  if (getNetwork().id !== "robinhood") {
    const mark = defaultMark();
    markCache.set(pair, { ...mark, at: Date.now() });
    return mark;
  }

  if (!protocol.deployed) {
    const mark = { decimals: 18, usd: 3_000 };
    markCache.set(pair, { ...mark, at: Date.now() });
    return mark;
  }

  try {
    const client = getPublicClient();
    const ethUsd6 = await client.readContract({
      address: protocol.factory,
      abi: rhLaunchFactoryAbi,
      functionName: "ethUsd6",
    });
    const ethUsd = Number(ethUsd6) / 1e6;

    if (isNativeEth(pair) || pair === protocol.pairAsset.toLowerCase()) {
      const mark = { decimals: 18, usd: ethUsd > 0 ? ethUsd : 3_000 };
      markCache.set(pair, { ...mark, at: Date.now() });
      return mark;
    }

    if (pair === RH_USDG.toLowerCase()) {
      const mark = { decimals: 6, usd: 1 };
      markCache.set(pair, { ...mark, at: Date.now() });
      return mark;
    }

    const gate = await client.readContract({
      address: protocol.factory,
      abi: rhLaunchFactoryAbi,
      functionName: "gate",
    });
    const [pairUsd6, decimals] = await Promise.all([
      client.readContract({
        address: gate,
        abi: gateUsdAbi,
        functionName: "pairUsd6",
        args: [pair as Address, ethUsd6],
      }),
      client.readContract({
        address: pair as Address,
        abi: erc20Abi,
        functionName: "decimals",
      }),
    ]);
    const usd = Number(pairUsd6) / 1e6;
    const mark = {
      decimals: Number(decimals),
      usd: usd > 0 ? usd : 0,
    };
    markCache.set(pair, { ...mark, at: Date.now() });
    return mark;
  } catch {
    const fallback =
      getNetwork().id === "robinhood"
        ? { decimals: 18, usd: 3_000 }
        : defaultMark();
    markCache.set(pair, { ...fallback, at: Date.now() });
    return fallback;
  }
}

export function launchPoolIdFor(
  token: Address,
  pairAsset: Address,
  hook: Address,
  fee = POOL_FEE,
  tickSpacing = TICK_SPACING,
) {
  const key = launchPoolKeyFor(token, pairAsset, hook, fee, tickSpacing);
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
      [key],
    ),
  );
}

export function launchPoolId(token: Address) {
  const protocol = protocolOf();
  return launchPoolIdFor(token, protocol.pairAsset, protocol.hook);
}

export function launchPoolIdForToken(token: {
  address: Address | string;
  pairAsset?: string;
  poolFee?: number;
  poolId?: string;
}) {
  if (token.poolId) return token.poolId;
  const protocol = protocolOf();
  if (!token.pairAsset) return launchPoolId(token.address as Address);
  const spacing = getNetwork().id === "robinhood" ? 200 : TICK_SPACING;
  return launchPoolIdFor(
    token.address as Address,
    token.pairAsset as Address,
    protocol.hook,
    token.poolFee ?? POOL_FEE,
    spacing,
  );
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
export function usdPerTokenFromSqrt(
  sqrtPriceX96: bigint,
  tokenIsCurrency0: boolean,
  mark: PairMark = defaultMark(),
) {
  if (sqrtPriceX96 === 0n || !(mark.usd > 0)) return 0;
  const wei = quoteWeiFromSqrt(sqrtPriceX96, tokenIsCurrency0);
  if (wei === 0n) return 0;
  const quote = Number(wei) / 10 ** mark.decimals;
  if (!Number.isFinite(quote) || quote <= 0) return 0;
  return quote * mark.usd;
}

/** Official pool first. Dexscreener is fallback only — never Math.max the two. */
export function preferOfficialUsd(
  live: number | null | undefined,
  dex: number | null | undefined,
  fallback: number,
) {
  if (live && live > 0) return live;
  if (dex && dex > 0) return dex;
  return fallback;
}

export async function readLiveUsdPrice(
  token: Address,
  tokenIsCurrency0: boolean,
  pair?: { pairAsset?: string; poolFee?: number },
) {
  const prices = await readLiveUsdPrices([
    { address: token, tokenIsCurrency0, pairAsset: pair?.pairAsset, poolFee: pair?.poolFee },
  ]);
  return prices.get(token.toLowerCase()) ?? null;
}

export async function readLiveUsdPrices(
  rows: {
    address: Address;
    tokenIsCurrency0: boolean;
    pairAsset?: string;
    poolFee?: number;
    poolId?: string;
  }[],
) {
  const prices = new Map<string, number>();
  if (rows.length === 0) return prices;
  const uniquePairs = [...new Set(rows.map((row) => row.pairAsset ?? protocolOf().pairAsset))];
  const marks = new Map<string, PairMark>();
  await Promise.all(
    uniquePairs.map(async (pair) => {
      marks.set(pair.toLowerCase(), await pairMark(pair));
    }),
  );
  const protocol = protocolOf();
  try {
    const results = await getPublicClient().multicall({
      allowFailure: true,
      contracts: rows.map((row) => ({
        address: protocol.v4StateView,
        abi: stateViewAbi,
        functionName: "getSlot0",
        args: [launchPoolIdForToken(row)],
      })),
    });
    results.forEach((item, index) => {
      if (item.status !== "success") return;
      const pair = (rows[index].pairAsset ?? protocol.pairAsset).toLowerCase();
      const price = usdPerTokenFromSqrt(
        item.result[0],
        rows[index].tokenIsCurrency0,
        marks.get(pair) ?? defaultMark(),
      );
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
  pair?: { pairAsset?: string; poolFee?: number; poolId?: string },
) {
  try {
    const mark = await pairMark(pair?.pairAsset);
    const latest = await getPublicClient().getBlockNumber();
    const lookback = 80_000n;
    const fromBlock = latest > lookback ? latest - lookback : 0n;
    const chunk = 4_000n;
    const poolId = pair ? launchPoolIdForToken({ address: token, ...pair }) : launchPoolId(token);
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
            mark,
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
  poolId?: string,
  pairAsset?: string,
): Promise<ChartPoint[]> {
  try {
    const mark = await pairMark(pairAsset);
    const logs = await collectSwapLogs(token, { limit: 80, poolId });
    if (logs.length === 0) return [];
    const stamps = await stampSwapBlocks(logs.map((log) => log.blockNumber));

    return logs
      .map((log) => {
        const time = stamps.get(log.blockNumber) ?? 0;
        const value = usdPerTokenFromSqrt(
          log.args.sqrtPriceX96 ?? 0n,
          tokenIsCurrency0,
          mark,
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
  opts?: { limit?: number; lookback?: bigint; poolId?: string },
) {
  const limit = opts?.limit ?? 80;
  const window =
    opts?.lookback != null
      ? await (async () => {
          const latest = await getPublicClient().getBlockNumber();
          return {
            fromBlock: latest > opts.lookback! ? latest - opts.lookback! : 0n,
          };
        })()
      : await marketWindow();
  const poolId = (opts?.poolId as Address | undefined) ?? launchPoolId(token);
  return collectContractLogs({
    address: protocolOf().v4PoolManager,
    event: swapEvent,
    args: { id: poolId },
    fromBlock: window.fromBlock,
    newestFirst: true,
    limit,
  });
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
