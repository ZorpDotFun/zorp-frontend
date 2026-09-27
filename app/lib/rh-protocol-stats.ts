import { erc20Abi, formatUnits, parseAbiItem, type Address, type Hex } from "viem";
import { RH_REVENUE_TREASURY, rhTokenFactories } from "./addresses";
import {
  loadRhPad,
  readProtocolFeeBps,
  readRhFactoryTokens,
} from "./factory";
import { getPublicClient, protocolOf, RH_WETH } from "./networks";
import { pairMark } from "./pool-price";
import type { DayBucket, ProtocolStats } from "./protocol-stats";
import {
  ETH,
  isNativeEth,
  RH_PONS,
  RH_TAO,
  RH_UNI,
  RH_USDG,
} from "./quote-tokens";
import { collectContractLogs } from "./rpc-logs";
import { readRhFeeEstimate } from "./uncollected-fees";

const DAY = 86_400;
const HOUR = 3_600;
const HALF_HOUR = 1_800;
const POOL_TOPIC_BATCH = 8;
const CACHE_KEY = "zorp-rh-protocol-stats-v5";
/** First RH pad went live in this window. Charts start here unless an earlier launch exists. */
export const RH_FACTORY_LIVE = Math.floor(Date.UTC(2026, 8, 20) / 1000);
const ZERO_POOL = `0x${"0".repeat(64)}` as Hex;

const swapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);
const launchedEvent = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed creator, address indexed pairAsset, bytes32 poolId, uint24 fee, uint16 creatorFeeBps, uint8 feeTo, uint256 firstBuySpent, uint256 firstBuyTokens)",
);
const collectedEvent = parseAbiItem(
  "event FeesCollected(address indexed token, address indexed pairAsset, uint256 protocolAmt, uint256 creatorAmt)",
);
const claimedEvent = parseAbiItem(
  "event Claimed(address indexed account, address indexed asset, uint256 amount)",
);

type RhLaunchRow = {
  token: Address;
  creator: Address;
  pairAsset: Address;
  poolId: Hex;
  launchedAt: number;
  vault: Address;
  locker: Address;
};

type Print = { time: number; value: number };

type RhSnap = {
  launches: RhLaunchRow[];
  swapPrints: Print[];
  feePrints: Print[];
  creatorPrints: Print[];
  claimPrints: Print[];
  protocolUncollected: number;
  creatorUncollected: number;
  treasuryUsd: number;
  protocolFeeBps: number;
  volumeReady: boolean;
  partial: boolean;
};

let started = false;
let refreshing = false;
let cache: ProtocolStats | null = null;
const listeners = new Set<(stats: ProtocolStats) => void>();
const timers: number[] = [];

export function readRhCachedProtocolStats(): ProtocolStats | null {
  if (cache) return cache;
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProtocolStats;
    if (!parsed.volume30m || !parsed.volume1h) return null;
    cache = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export function startRhProtocolStats(publish: (stats: ProtocolStats) => void) {
  listeners.add(publish);
  const cached = readRhCachedProtocolStats();
  if (cached) publish(cached);
  if (started) return;
  started = true;
  void refreshRhStats(true);
  timers.push(window.setInterval(() => void refreshRhStats(false), 20_000));
}

export function stopRhProtocolStats() {
  for (const timer of timers) window.clearInterval(timer);
  timers.length = 0;
}

async function refreshRhStats(first: boolean) {
  if (refreshing) return;
  refreshing = true;
  try {
    const [launches, protocolFeeBps] = await Promise.all([
      readRhLaunchIndex(),
      readProtocolFeeBps().catch(() => 100),
    ]);
    const snap: RhSnap = {
      launches,
      swapPrints: [],
      feePrints: [],
      creatorPrints: [],
      claimPrints: [],
      protocolUncollected: 0,
      creatorUncollected: 0,
      treasuryUsd: 0,
      protocolFeeBps,
      volumeReady: false,
      partial: true,
    };
    emit(snap);

    const estimates = await Promise.all(
      launches.map((row) => readRhFeeEstimate(row.token, row.creator).catch(() => null)),
    );
    for (const row of estimates) {
      if (!row) continue;
      snap.protocolUncollected += row.protocolUsd;
      snap.creatorUncollected += row.creatorUsd;
    }
    emit(snap);

    snap.treasuryUsd = await readRhTreasuryUsd().catch(() => 0);
    const firstBuys = await collectFirstBuyPrints(launches).catch(() => [] as Print[]);
    if (firstBuys.length > 0) {
      snap.swapPrints = firstBuys;
      emit(snap);
    }

    const vaults = uniqueAddresses(launches.map((row) => row.vault));
    const logs = await collectRhPrints(launches, vaults).catch(() => ({
      swaps: [] as Print[],
      fees: [] as Print[],
      creators: [] as Print[],
      claims: [] as Print[],
    }));
    snap.swapPrints =
      sumSince(logs.swaps, 0) >= sumSince(firstBuys, 0) && logs.swaps.length > 0
        ? logs.swaps
        : firstBuys.length > 0
          ? firstBuys
          : logs.swaps;
    snap.feePrints = logs.fees;
    snap.creatorPrints = logs.creators;
    snap.claimPrints = logs.claims;
    snap.volumeReady = true;
    snap.partial = false;
    emit(snap);
  } catch {
    if (first && !cache?.launchesAll) emitEmpty();
  } finally {
    refreshing = false;
  }
}

function emit(snap: RhSnap) {
  const next = assembleRh(snap);
  cache = mergeRh(cache, next);
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* private mode */
  }
  for (const listener of listeners) listener(cache);
}

function emitEmpty() {
  emit({
    launches: [],
    swapPrints: [],
    feePrints: [],
    creatorPrints: [],
    claimPrints: [],
    protocolUncollected: 0,
    creatorUncollected: 0,
    treasuryUsd: 0,
    protocolFeeBps: 100,
    volumeReady: false,
    partial: true,
  });
}

async function readRhLaunchIndex(): Promise<RhLaunchRow[]> {
  const protocol = protocolOf();
  const factories = rhTokenFactories(protocol.factory);
  const grouped = await Promise.all(
    factories.map(async (factory) => ({
      factory,
      tokens: await readRhFactoryTokens(factory).catch(() => [] as Address[]),
    })),
  );

  const rows: RhLaunchRow[] = [];
  const seen = new Set<string>();
  await Promise.all(
    grouped.flatMap(({ factory, tokens }) =>
      tokens.map(async (token) => {
        const key = token.toLowerCase();
        if (seen.has(key)) return;
        const pad = await loadRhPad(token, factory);
        if (!pad || !pad.launch[8] || !pad.launch[3] || pad.launch[3] === ZERO_POOL) {
          return;
        }
        if (seen.has(key)) return;
        seen.add(key);
        rows.push({
          token,
          creator: pad.launch[1],
          pairAsset: pad.launch[2],
          poolId: pad.launch[3],
          launchedAt: Number(pad.launch[7]),
          vault: pad.vault,
          locker: pad.locker,
        });
      }),
    ),
  );
  rows.sort((a, b) => a.launchedAt - b.launchedAt);
  return rows;
}

async function collectFirstBuyPrints(launches: RhLaunchRow[]) {
  if (launches.length === 0) return [] as Print[];
  const tokenByAddr = new Map(
    launches.map((row) => [row.token.toLowerCase(), row] as const),
  );
  const marks = await marksFor([
    ...launches.map((row) => row.pairAsset),
    ETH.address,
    RH_WETH,
  ]);
  const factories = rhTokenFactories(protocolOf().factory);
  const launchedLogs = await Promise.all(
    factories.map((factory) =>
      collectContractLogs({
        address: factory,
        event: launchedEvent,
        fromBlock: 0n,
        wide: true,
      }).catch(() => []),
    ),
  );
  const prints: Print[] = [];
  for (const log of launchedLogs.flat() as Array<{
    args: { token?: Address; pairAsset?: Address; firstBuySpent?: bigint };
  }>) {
    const token = (log.args.token ?? "").toLowerCase();
    const row = tokenByAddr.get(token);
    if (!row) continue;
    const spent = log.args.firstBuySpent ?? 0n;
    if (spent === 0n) continue;
    const pair = (log.args.pairAsset ?? row.pairAsset) as Address;
    const usd = usdOf(spent, pair, marks);
    if (!(usd > 0)) continue;
    prints.push({ time: row.launchedAt || nowSec(), value: usd });
  }
  return prints;
}

async function collectRhPrints(launches: RhLaunchRow[], vaults: Address[]) {
  if (launches.length === 0) {
    return { swaps: [] as Print[], fees: [] as Print[], creators: [] as Print[], claims: [] as Print[] };
  }
  const protocol = protocolOf();
  const poolById = new Map(
    launches.map((row) => [row.poolId.toLowerCase(), row] as const),
  );
  const tokenByAddr = new Map(
    launches.map((row) => [row.token.toLowerCase(), row] as const),
  );
  const marks = await marksFor([
    ...launches.map((row) => row.pairAsset),
    ETH.address,
    RH_WETH,
  ]);
  const factories = rhTokenFactories(protocol.factory);
  const poolBatches = chunk(launches.map((row) => row.poolId), POOL_TOPIC_BATCH);

  const [swapLogs, launchedLogs, collected, claimed] = await Promise.all([
    Promise.all(
      poolBatches.map((ids) =>
        collectContractLogs({
          address: protocol.v4PoolManager,
          event: swapEvent,
          args: { id: ids },
          fromBlock: 0n,
          wide: true,
        }).catch(() => []),
      ),
    ).then((pages) => pages.flat()),
    Promise.all(
      factories.map((factory) =>
        collectContractLogs({
          address: factory,
          event: launchedEvent,
          fromBlock: 0n,
          wide: true,
        }).catch(() => []),
      ),
    ),
    Promise.all(
      vaults.map((vault) =>
        collectContractLogs({
          address: vault,
          event: collectedEvent,
          fromBlock: 0n,
          wide: true,
        }).catch(() => []),
      ),
    ),
    Promise.all(
      vaults.map((vault) =>
        collectContractLogs({
          address: vault,
          event: claimedEvent,
          fromBlock: 0n,
          wide: true,
        }).catch(() => []),
      ),
    ),
  ]);

  const stamps = await stampBlocks([
    ...swapLogs.map((log) => (log as { blockNumber: bigint }).blockNumber),
    ...launchedLogs.flat().map((log) => (log as { blockNumber: bigint }).blockNumber),
    ...collected.flat().map((log) => (log as { blockNumber: bigint }).blockNumber),
    ...claimed.flat().map((log) => (log as { blockNumber: bigint }).blockNumber),
  ]);

  const swaps: Print[] = [];
  for (const log of swapLogs as Array<{
    args: { id?: Hex; amount0?: bigint; amount1?: bigint };
    blockNumber: bigint;
  }>) {
    const row = poolById.get((log.args.id ?? "").toLowerCase());
    if (!row) continue;
    const tokenIs0 = row.token.toLowerCase() < (row.pairAsset || ETH.address).toLowerCase();
    const raw = tokenIs0 ? log.args.amount1 : log.args.amount0;
    if (raw === undefined) continue;
    const usd = usdOf(raw < 0n ? -raw : raw, row.pairAsset, marks);
    if (!(usd > 0)) continue;
    swaps.push({
      time: stamps.get(log.blockNumber) ?? nowSec(),
      value: usd,
    });
  }

  if (swaps.length === 0) {
    for (const log of launchedLogs.flat() as Array<{
      args: { token?: Address; pairAsset?: Address; firstBuySpent?: bigint };
      blockNumber: bigint;
    }>) {
      const token = (log.args.token ?? "").toLowerCase();
      const row = tokenByAddr.get(token);
      if (!row) continue;
      const spent = log.args.firstBuySpent ?? 0n;
      if (spent === 0n) continue;
      const pair = (log.args.pairAsset ?? row.pairAsset) as Address;
      const usd = usdOf(spent, pair, marks);
      if (!(usd > 0)) continue;
      swaps.push({
        time: stamps.get(log.blockNumber) ?? row.launchedAt,
        value: usd,
      });
    }
  }

  const fees: Print[] = [];
  const creators: Print[] = [];
  for (const log of collected.flat() as Array<{
    args: { pairAsset?: Address; protocolAmt?: bigint; creatorAmt?: bigint };
    blockNumber: bigint;
  }>) {
    const pair = (log.args.pairAsset ?? ETH.address) as Address;
    const time = stamps.get(log.blockNumber) ?? nowSec();
    const proto = usdOf(log.args.protocolAmt ?? 0n, pair, marks);
    const creator = usdOf(log.args.creatorAmt ?? 0n, pair, marks);
    if (proto > 0) fees.push({ time, value: proto });
    if (creator > 0) creators.push({ time, value: creator });
  }

  const claims: Print[] = [];
  for (const log of claimed.flat() as Array<{
    args: { asset?: Address; amount?: bigint };
    blockNumber: bigint;
  }>) {
    const asset = (log.args.asset ?? ETH.address) as Address;
    const usd = usdOf(log.args.amount ?? 0n, asset, marks);
    if (!(usd > 0)) continue;
    claims.push({
      time: stamps.get(log.blockNumber) ?? nowSec(),
      value: usd,
    });
  }

  return { swaps, fees, creators, claims };
}

async function readRhTreasuryUsd() {
  const client = getPublicClient();
  const treasuries = uniqueAddresses([RH_REVENUE_TREASURY]);
  const assets: Address[] = [RH_WETH, RH_USDG, RH_TAO, RH_PONS, RH_UNI];
  const marks = await marksFor([ETH.address, ...assets]);
  let usd = 0;
  await Promise.all(
    treasuries.map(async (account) => {
      try {
        const eth = await client.getBalance({ address: account });
        usd += usdOf(eth, ETH.address, marks);
      } catch {
        /* skip */
      }
      const balances = await Promise.all(
        assets.map((asset) =>
          client
            .readContract({
              address: asset,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [account],
            })
            .catch(() => 0n),
        ),
      );
      assets.forEach((asset, index) => {
        usd += usdOf(balances[index] ?? 0n, asset, marks);
      });
    }),
  );
  return usd;
}

async function marksFor(assets: Address[]) {
  const unique = uniqueAssets(assets);
  const rows = await Promise.all(
    unique.map(async (asset) => [asset.toLowerCase(), await pairMark(asset)] as const),
  );
  if (!rows.some(([key]) => isNativeEth(key))) {
    const eth = await pairMark(ETH.address);
    rows.push([ETH.address.toLowerCase(), eth]);
  }
  return new Map(rows);
}

function usdOf(
  amount: bigint,
  asset: Address,
  marks: Map<string, { decimals: number; usd: number }>,
) {
  if (amount === 0n) return 0;
  const mark =
    marks.get(asset.toLowerCase()) ??
    (isNativeEth(asset) ? marks.get(ETH.address.toLowerCase()) : undefined);
  const decimals = mark?.decimals ?? 18;
  const price = mark?.usd ?? 0;
  if (!(price > 0)) return 0;
  const value = Number(formatUnits(amount, decimals)) * price;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function stampBlocks(blocks: bigint[]) {
  const unique = [...new Set(blocks)];
  const stamps = new Map<bigint, number>();
  if (unique.length === 0) return stamps;
  const client = getPublicClient();
  await Promise.all(
    unique.map(async (blockNumber) => {
      try {
        const block = await client.getBlock({ blockNumber });
        stamps.set(blockNumber, Number(block.timestamp));
      } catch {
        stamps.set(blockNumber, nowSec());
      }
    }),
  );
  return stamps;
}

function assembleRh(snap: RhSnap): ProtocolStats {
  const now = nowSec();
  const launchTimes = snap.launches
    .map((row) => row.launchedAt)
    .filter((time) => time > 0);
  const from = Math.min(
    RH_FACTORY_LIVE,
    ...launchTimes.filter((time) => time >= RH_FACTORY_LIVE - 14 * DAY),
    launchTimes[0] || RH_FACTORY_LIVE,
  );
  const creators = new Set(
    snap.launches.map((row) => row.creator.toLowerCase()).filter(Boolean),
  );
  const volumeAll = sumSince(snap.swapPrints, 0);
  const collectedFees = sumSince(snap.feePrints, 0);
  const collectedCreator = sumSince(snap.creatorPrints, 0);
  const claimedAll = sumSince(snap.claimPrints, 0);
  const feesAll = collectedFees + snap.protocolUncollected;
  const creatorFeesAll = Math.max(
    collectedCreator + snap.creatorUncollected,
    claimedAll + snap.creatorUncollected,
  );
  const launchPrints = launchTimes.map((time) => ({ time, value: 1 }));

  return {
    updatedAt: Date.now(),
    volume24h: sumSince(snap.swapPrints, now - DAY),
    volumePrev24h: sumBetween(snap.swapPrints, now - 2 * DAY, now - DAY),
    volumeAll,
    launches24h: launchTimes.filter((time) => time >= now - DAY).length,
    launchesPrev24h: launchTimes.filter(
      (time) => time >= now - 2 * DAY && time < now - DAY,
    ).length,
    launchesAll: snap.launches.length,
    uniqueDevs: creators.size,
    fees24h: sumSince(snap.feePrints, now - DAY),
    feesPrev24h: sumBetween(snap.feePrints, now - 2 * DAY, now - DAY),
    feesAll,
    feesHeld: snap.treasuryUsd,
    claimed24h: sumSince(snap.claimPrints, now - DAY),
    claimedPrev24h: sumBetween(snap.claimPrints, now - 2 * DAY, now - DAY),
    claimedAll,
    creatorFees24h: sumSince(snap.creatorPrints, now - DAY),
    creatorFeesPrev24h: sumBetween(snap.creatorPrints, now - 2 * DAY, now - DAY),
    creatorFeesAll,
    creatorFeesHeld: snap.creatorUncollected,
    volumeDays: fillBars(snap.swapPrints, from, now, HOUR),
    volume30m: fillBars(snap.swapPrints, from, now, HALF_HOUR),
    volume1h: fillBars(snap.swapPrints, from, now, HOUR),
    launchDays: fillBars(launchPrints, from, now, HOUR),
    launch30m: fillBars(launchPrints, from, now, HALF_HOUR),
    launch1h: fillBars(launchPrints, from, now, HOUR),
    factoryLiveAt: from,
    volumeReady: snap.volumeReady || volumeAll > 0,
    partial: snap.partial,
  };
}

function mergeRh(prev: ProtocolStats | null, next: ProtocolStats): ProtocolStats {
  if (!prev) return next;
  const volumeAll = Math.max(prev.volumeAll, next.volumeAll);
  return {
    ...next,
    launchesAll: Math.max(prev.launchesAll, next.launchesAll),
    uniqueDevs: Math.max(prev.uniqueDevs, next.uniqueDevs),
    volumeAll,
    volume24h: next.volumeReady ? next.volume24h : Math.max(prev.volume24h, next.volume24h),
    feesAll: Math.max(prev.feesAll, next.feesAll),
    creatorFeesAll: Math.max(prev.creatorFeesAll, next.creatorFeesAll),
    volumeReady: prev.volumeReady || next.volumeReady || volumeAll > 0,
    volume30m:
      next.volume30m.some((bar) => bar.value > 0) || !prev.volume30m?.some((bar) => bar.value > 0)
        ? next.volume30m
        : prev.volume30m,
    volume1h:
      next.volume1h.some((bar) => bar.value > 0) || !prev.volume1h?.some((bar) => bar.value > 0)
        ? next.volume1h
        : prev.volume1h,
    launch30m:
      next.launch30m.some((bar) => bar.value > 0) || !prev.launch30m?.some((bar) => bar.value > 0)
        ? next.launch30m
        : prev.launch30m,
    launch1h:
      next.launch1h.some((bar) => bar.value > 0) || !prev.launch1h?.some((bar) => bar.value > 0)
        ? next.launch1h
        : prev.launch1h,
  };
}

function chunk<T>(rows: T[], size: number) {
  const out: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    out.push(rows.slice(index, index + size));
  }
  return out;
}

function fillBars(
  rows: Print[],
  from: number,
  now: number,
  interval: number,
): DayBucket[] {
  const start = Math.floor(Math.max(from, RH_FACTORY_LIVE - 2 * DAY) / interval) * interval;
  const end = Math.floor(Math.max(now, start) / interval) * interval;
  const buckets = new Map<number, number>();
  for (const row of rows) {
    if (row.time < start) continue;
    const time = Math.floor(row.time / interval) * interval;
    buckets.set(time, (buckets.get(time) ?? 0) + row.value);
  }
  const out: DayBucket[] = [];
  for (let time = start; time <= end; time += interval) {
    out.push({
      time,
      label: formatLabel(time),
      endLabel: formatLabel(time + interval),
      value: buckets.get(time) ?? 0,
    });
  }
  return out;
}

function formatLabel(time: number) {
  return new Date(time * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  });
}

function uniqueAddresses(values: Address[]) {
  return uniqueAssets(values, false);
}

function uniqueAssets(values: Address[], keepNative = true) {
  const seen = new Set<string>();
  const out: Address[] = [];
  for (const value of values) {
    if (!value) continue;
    if (!keepNative && value === "0x0000000000000000000000000000000000000000") continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function sumSince(rows: Print[], since: number) {
  return rows.reduce((sum, row) => (row.time >= since ? sum + row.value : sum), 0);
}

function sumBetween(rows: Print[], from: number, to: number) {
  return rows.reduce(
    (sum, row) => (row.time >= from && row.time < to ? sum + row.value : sum),
    0,
  );
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}
