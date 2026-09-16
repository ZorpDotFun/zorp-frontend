import { erc20Abi, formatUnits, parseAbiItem, type Address } from "viem";
import { FEE_DISTRIBUTOR, LAUNCH_FACTORY, USDC, V4_POOL_MANAGER, ZORP_BUYBACK } from "./addresses";
import { launchFactoryAbi, publicClient, readProtocolFeeBps } from "./factory";
import { PROTOCOL_SWAP_FEE_BPS } from "./fee-models";
import { launchPoolId } from "./pool-price";

const USDC_DECIMALS = 6;
const DAY = 86_400;
const CHART_DAYS = 14;
const LOG_CHUNK = 20_000n;
const CLAIM_RECENT = 8_000n;
const CACHE_KEY = "zorp-protocol-stats";

const swapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);

const accruedEvent = parseAbiItem(
  "event Accrued(address indexed token, uint256 splitQuote, uint256 protocolQuote)",
);

const claimedEvent = parseAbiItem(
  "event Claimed(address indexed account, address indexed asset, uint256 amount)",
);

export type DayBucket = { time: number; label: string; value: number };

export type ProtocolStats = {
  updatedAt: number;
  volume24h: number;
  volumePrev24h: number;
  volumeAll: number;
  launches24h: number;
  launchesPrev24h: number;
  launchesAll: number;
  uniqueDevs: number;
  fees24h: number;
  feesPrev24h: number;
  feesAll: number;
  feesHeld: number;
  claimed24h: number;
  claimedPrev24h: number;
  claimedAll: number;
  volumeDays: DayBucket[];
  launchDays: DayBucket[];
  partial: boolean;
};

type Print = { time: number; value: number; account?: string };
type LaunchRow = { address: Address; creator: string; launchedAt: number };

let memoryCache: ProtocolStats | null = null;
let swapPrintsMem: Print[] = [];
let feePrintsMem: Print[] = [];
let claimPrintsMem: Print[] = [];
let scannedTo = 0n;
let scannedClaimsTo = 0n;
let scannedFeesTo = 0n;
let liveNow = () => Math.floor(Date.now() / 1000);
let liveLaunchTimes: number[] = [];
let liveCreators = new Set<string>();
let liveFeesHeld = 0;
let liveFeeBps = PROTOCOL_SWAP_FEE_BPS;
let liveDex24h = 0;
const claimKeys = new Set<string>();
const liveListeners = new Set<(stats: ProtocolStats) => void>();
let liveStarted = false;
let claimsReady = false;

export function readCachedProtocolStats(): ProtocolStats | null {
  if (memoryCache) return memoryCache;
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as ProtocolStats) : null;
  } catch {
    return null;
  }
}

export async function fetchProtocolStats(
  onUpdate?: (stats: ProtocolStats) => void,
): Promise<ProtocolStats> {
  const now = Math.floor(Date.now() / 1000);
  seedClaimsFromCache();
  const headPromise = publicClient.getBlockNumber();
  const claimsStart = headPromise.then((head) => pullCreatorClaims(head));
  const feesStart = headPromise.then((head) => {
    const floor = head > 120_000n ? head - 120_000n : 0n;
    const from = scannedFeesTo > floor ? scannedFeesTo + 1n : floor;
    return collectProtocolFees(from, head);
  });

  const [rows, feesHeld, feeBps, head] = await Promise.all([
    readLaunchIndex(),
    readTreasuryUsdc(),
    readProtocolFeeBps(),
    headPromise,
  ]);

  const launchTimes = rows.map((row) => row.launchedAt);
  const creators = new Set(
    rows.map((row) => row.creator.toLowerCase()).filter(Boolean),
  );
  const tokens = rows.map((row) => row.address);

  liveLaunchTimes = launchTimes;
  liveCreators = creators;
  liveFeesHeld = feesHeld;
  liveFeeBps = feeBps;
  const publish = (partial: boolean) => {
    const next = assemble({
      now: liveNow(),
      swapPrints: swapPrintsMem,
      feePrints: feePrintsMem,
      claimPrints: claimPrintsMem,
      dex24h: liveDex24h,
      launchTimes: liveLaunchTimes,
      creators: liveCreators,
      feesHeld: liveFeesHeld,
      feeBps: liveFeeBps,
      partial,
    });
    cacheStats(next);
    onUpdate?.(next);
    notifyLive(next);
    return next;
  };

  publish(true);

  void claimsStart.then(() => publish(true));
  void feesStart.then((prints) => {
    feePrintsMem = prints;
    publish(true);
  });

  const lookback = await lookbackBlocks(head, 2 * DAY);
  const floor = head > lookback ? head - lookback : 0n;
  const fromBlock = scannedTo > floor ? scannedTo + 1n : floor;

  const dexPromise = collectDexVolume(tokens).then((prints) => {
    liveDex24h = sumSince(prints, now - DAY);
    publish(true);
  });

  const swapPromise = collectSwapVolume(tokens, fromBlock, head, (prints) => {
    swapPrintsMem = prints;
    publish(true);
  }).then((prints) => {
    swapPrintsMem = prints;
    publish(true);
  });

  const [, feePrints] = await Promise.all([
    claimsStart,
    feesStart,
    dexPromise,
    swapPromise,
  ]);

  scannedTo = head;
  feePrintsMem = feePrints;
  return publish(false);
}

export function subscribeProtocolStats(
  onUpdate: (stats: ProtocolStats) => void,
) {
  liveListeners.add(onUpdate);
  seedClaimsFromCache();
  const cached = readCachedProtocolStats();
  if (cached) onUpdate(cached);
  if (!liveStarted) {
    liveStarted = true;
    startLiveStats();
  }
  return () => {
    liveListeners.delete(onUpdate);
  };
}

function notifyLive(stats: ProtocolStats) {
  for (const listener of liveListeners) listener(stats);
}

function publishLive(partial: boolean) {
  const next = assemble({
    now: liveNow(),
    swapPrints: swapPrintsMem,
    feePrints: feePrintsMem,
    claimPrints: claimPrintsMem,
    dex24h: liveDex24h,
    launchTimes: liveLaunchTimes,
    creators: liveCreators,
    feesHeld: liveFeesHeld,
    feeBps: liveFeeBps,
    partial,
  });
  cacheStats(next);
  notifyLive(next);
  return next;
}

function startLiveStats() {
  publicClient.watchEvent({
    address: FEE_DISTRIBUTOR,
    event: claimedEvent,
    pollingInterval: 2_000,
    onLogs: (logs) => {
      if (logs.length === 0) return;
      void ingestClaimLogs(logs).then((changed) => {
        if (changed) publishLive(false);
      });
    },
  });
  publicClient.watchEvent({
    address: FEE_DISTRIBUTOR,
    event: accruedEvent,
    pollingInterval: 2_000,
    onLogs: (logs) => {
      if (logs.length === 0) return;
      let added = false;
      for (const log of logs) {
        const raw = log.args.protocolQuote ?? 0n;
        if (raw === 0n) continue;
        const value = Number(formatUnits(raw, USDC_DECIMALS));
        if (!(value > 0)) continue;
        feePrintsMem.push({ time: liveNow(), value });
        added = true;
      }
      if (added) publishLive(false);
    },
  });

  void refreshLiveClaims();
  void fetchProtocolStats();
  window.setInterval(() => {
    void refreshLiveClaims();
  }, 3_000);
  window.setInterval(() => {
    void fetchProtocolStats();
  }, 30_000);
}

async function refreshLiveClaims() {
  try {
    seedClaimsFromCache();
    const [head, feesHeld, rows] = await Promise.all([
      publicClient.getBlockNumber(),
      readTreasuryUsdc(),
      readLaunchIndex(),
    ]);
    liveFeesHeld = feesHeld;
    liveLaunchTimes = rows.map((row) => row.launchedAt);
    liveCreators = new Set(
      rows.map((row) => row.creator.toLowerCase()).filter(Boolean),
    );
    await pullCreatorClaims(head);
    publishLive(claimPrintsMem.length === 0);
  } catch {
    /* keep the last live total */
  }
}

function seedClaimsFromCache() {
  if (claimPrintsMem.length > 0) return;
  const cached = memoryCache ?? readCachedProtocolStats();
  if (!cached || !(cached.claimedAll > 0)) return;
  claimPrintsMem.push({
    time: liveNow(),
    value: cached.claimedAll,
    account: "cache",
  });
}

async function pullCreatorClaims(head: bigint) {
  if (!claimsReady) {
    const recentFrom = head > CLAIM_RECENT ? head - CLAIM_RECENT : 0n;
    const recent = await collectCreatorClaims(recentFrom, head);
    if (recent.ok) {
      applyClaimPrints(recent.added);
      scannedClaimsTo = recent.scannedTo;
      claimsReady = true;
      if (recentFrom > 0n) {
        const olderFrom = recentFrom > CLAIM_RECENT ? recentFrom - CLAIM_RECENT : 0n;
        void backfillOlderClaims(olderFrom, recentFrom - 1n);
      }
      return recent.added.length > 0;
    }
    return false;
  }
  const from = scannedClaimsTo + 1n;
  const result = await collectCreatorClaims(from, head);
  if (!result.ok) return false;
  applyClaimPrints(result.added);
  scannedClaimsTo = result.scannedTo;
  return result.added.length > 0;
}

function applyClaimPrints(added: Print[]) {
  if (added.length === 0) return;
  for (const print of added) claimPrintsMem.push(print);
  claimPrintsMem = claimPrintsMem.filter((row) => row.account !== "cache");
}

async function backfillOlderClaims(fromBlock: bigint, until: bigint) {
  if (fromBlock > until) return;
  const older = await collectCreatorClaims(fromBlock, until);
  if (!older.ok || older.added.length === 0) return;
  applyClaimPrints(older.added);
  publishLive(false);
}

async function ingestClaimLogs(
  logs: { blockNumber?: bigint | null; transactionHash?: string | null; logIndex?: number | null; args: { account?: string; asset?: string; amount?: bigint } }[],
) {
  const usdc = USDC.toLowerCase();
  let added = false;
  const stamps = await stampBlocks(
    logs.map((log) => log.blockNumber).filter((block): block is bigint => block != null),
  );
  for (const log of logs) {
    const key = `${log.transactionHash ?? ""}:${log.logIndex ?? ""}`;
    if (key !== ":" && claimKeys.has(key)) continue;
    const raw = log.args.amount ?? 0n;
    const asset = (log.args.asset ?? "").toLowerCase();
    if (raw === 0n || asset !== usdc) continue;
    const value = Number(formatUnits(raw, USDC_DECIMALS));
    if (!(value > 0)) continue;
    const account = (log.args.account ?? "").toLowerCase();
    if (key !== ":") claimKeys.add(key);
    const time = (log.blockNumber && stamps.get(log.blockNumber)) || liveNow();
    claimPrintsMem.push({ time, value, account });
    if (log.blockNumber && log.blockNumber > scannedClaimsTo) scannedClaimsTo = log.blockNumber;
    added = true;
  }
  if (added) claimsReady = true;
  return added;
}

async function readLaunchIndex(): Promise<LaunchRow[]> {
  const count = await publicClient.readContract({
    address: LAUNCH_FACTORY,
    abi: launchFactoryAbi,
    functionName: "launchCount",
  });
  if (count === 0n) return [];

  const addresses = await Promise.all(
    Array.from({ length: Number(count) }, (_, index) =>
      publicClient.readContract({
        address: LAUNCH_FACTORY,
        abi: launchFactoryAbi,
        functionName: "allTokens",
        args: [BigInt(index)],
      }),
    ),
  );

  const launches = await Promise.all(
    addresses.map((address) =>
      publicClient.readContract({
        address: LAUNCH_FACTORY,
        abi: launchFactoryAbi,
        functionName: "launches",
        args: [address],
      }),
    ),
  );

  return addresses.flatMap((address, index) => {
    const launch = launches[index];
    if (!launch[10]) return [];
    return [
      {
        address,
        creator: launch[1],
        launchedAt: Number(launch[6]),
      },
    ];
  });
}

async function collectSwapVolume(
  tokens: Address[],
  fromBlock: bigint,
  latest: bigint,
  onChunk?: (prints: Print[]) => void,
) {
  if (tokens.length === 0 || fromBlock > latest) return swapPrintsMem;

  const chunks = blockChunks(fromBlock, latest).reverse();
  const pages: Print[] = [...swapPrintsMem];

  for (const chunk of chunks) {
    const part = (
      await Promise.all(
        tokens.map((token) => swapLogsForToken(token, chunk.start, chunk.end)),
      )
    ).flat();
    pages.push(...part);
    onChunk?.(pages);
  }

  return pages;
}

async function swapLogsForToken(token: Address, fromBlock: bigint, toBlock: bigint) {
  const tokenIs0 = token.toLowerCase() < USDC.toLowerCase();
  const logs = [];
  try {
    logs.push(
      ...(await publicClient.getLogs({
        address: V4_POOL_MANAGER,
        event: swapEvent,
        args: { id: launchPoolId(token) },
        fromBlock,
        toBlock,
      })),
    );
  } catch {
    return [] as Print[];
  }
  if (logs.length === 0) return [];
  const stamps = await stampBlocks(logs.map((log) => log.blockNumber));
  const prints: Print[] = [];
  for (const log of logs) {
    const time = stamps.get(log.blockNumber);
    if (!time) continue;
    const usdc = tokenIs0 ? log.args.amount1 : log.args.amount0;
    if (usdc === undefined) continue;
    const value = Number(formatUnits(usdc < 0n ? -usdc : usdc, USDC_DECIMALS));
    if (value > 0) prints.push({ time, value });
  }
  return prints;
}

async function collectProtocolFees(fromBlock: bigint, latest: bigint) {
  const prints: Print[] = [...feePrintsMem];
  if (fromBlock > latest) return prints;
  try {
    const pages = await Promise.all(
      blockChunks(fromBlock, latest).map(async (chunk) => {
        try {
          return await publicClient.getLogs({
            address: FEE_DISTRIBUTOR,
            event: accruedEvent,
            fromBlock: chunk.start,
            toBlock: chunk.end,
          });
        } catch {
          return [];
        }
      }),
    );
    const logs = pages.flat();
    const stamps = await stampBlocks(logs.map((log) => log.blockNumber));
    for (const log of logs) {
      const time = stamps.get(log.blockNumber);
      const raw = log.args.protocolQuote ?? 0n;
      if (!time || raw === 0n) continue;
      const value = Number(formatUnits(raw, USDC_DECIMALS));
      if (value > 0) prints.push({ time, value });
    }
    if (latest > scannedFeesTo) scannedFeesTo = latest;
  } catch {
    /* treasury balance is the fallback */
  }
  return prints;
}

async function collectCreatorClaims(fromBlock: bigint, latest: bigint) {
  if (fromBlock > latest) {
    return { ok: true, added: [] as Print[], scannedTo: latest };
  }
  const logs = await getClaimLogs(fromBlock, latest);
  if (!logs) return { ok: false, added: [] as Print[], scannedTo: scannedClaimsTo };
  const stamps = await stampBlocks(logs.map((log) => log.blockNumber));
  const usdc = USDC.toLowerCase();
  const added: Print[] = [];
  for (const log of logs) {
    const key = `${log.transactionHash}:${log.logIndex}`;
    if (claimKeys.has(key)) continue;
    const asset = (log.args.asset ?? "").toLowerCase();
    const raw = log.args.amount ?? 0n;
    if (raw === 0n || asset !== usdc) continue;
    const value = Number(formatUnits(raw, USDC_DECIMALS));
    if (!(value > 0)) continue;
    claimKeys.add(key);
    added.push({
      time: stamps.get(log.blockNumber) || liveNow(),
      value,
      account: (log.args.account ?? "").toLowerCase(),
    });
  }
  return { ok: true, added, scannedTo: latest };
}

async function getClaimLogs(fromBlock: bigint, latest: bigint) {
  try {
    return await publicClient.getLogs({
      address: FEE_DISTRIBUTOR,
      event: claimedEvent,
      fromBlock,
      toBlock: latest,
    });
  } catch {
    const span = latest - fromBlock;
    if (span <= 400n) return null;
    const mid = fromBlock + span / 2n;
    const [left, right] = await Promise.all([
      getClaimLogs(fromBlock, mid),
      getClaimLogs(mid + 1n, latest),
    ]);
    if (!left && !right) return null;
    return [...(left ?? []), ...(right ?? [])];
  }
}

async function collectDexVolume(tokens: Address[]) {
  if (tokens.length === 0) return [] as Print[];
  const now = Math.floor(Date.now() / 1000);
  try {
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${tokens.join(",")}`,
    );
    if (!response.ok) return [];
    const body = (await response.json()) as {
      pairs?: { chainId?: string; baseToken?: { address?: string }; volume?: { h24?: number } }[];
    };
    const seen = new Set<string>();
    const prints: Print[] = [];
    for (const pair of body.pairs ?? []) {
      const address = (pair.baseToken?.address ?? "").toLowerCase();
      if (!address || seen.has(address)) continue;
      if (pair.chainId && pair.chainId !== "arc") continue;
      seen.add(address);
      const value = Number(pair.volume?.h24 ?? 0);
      if (Number.isFinite(value) && value > 0) prints.push({ time: now, value });
    }
    return prints;
  } catch {
    return [];
  }
}

async function readTreasuryUsdc() {
  try {
    const raw = await publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [ZORP_BUYBACK],
    });
    return Number(formatUnits(raw, USDC_DECIMALS));
  } catch {
    return 0;
  }
}

let cachedSecPerBlock = 0;

async function lookbackBlocks(latest: bigint, seconds: number) {
  if (cachedSecPerBlock > 0) {
    return clampLookback(BigInt(Math.ceil(seconds / cachedSecPerBlock)));
  }
  try {
    const span = latest > 2_000n ? 2_000n : latest;
    const from = latest - span;
    const [head, tail] = await Promise.all([
      publicClient.getBlock({ blockNumber: latest }),
      span === 0n
        ? Promise.resolve(null)
        : publicClient.getBlock({ blockNumber: from }),
    ]);
    if (!tail) return 20_000n;
    const dt = Number(head.timestamp) - Number(tail.timestamp);
    cachedSecPerBlock = dt > 0 ? dt / Number(span) : 2;
    return clampLookback(BigInt(Math.ceil(seconds / Math.max(cachedSecPerBlock, 0.4))));
  } catch {
    return 40_000n;
  }
}

function clampLookback(blocks: bigint) {
  if (blocks < 8_000n) return 8_000n;
  if (blocks > 120_000n) return 120_000n;
  return blocks;
}

function blockChunks(fromBlock: bigint, latest: bigint) {
  const chunks: { start: bigint; end: bigint }[] = [];
  for (let start = fromBlock; start <= latest; start += LOG_CHUNK) {
    const end = start + LOG_CHUNK - 1n > latest ? latest : start + LOG_CHUNK - 1n;
    chunks.push({ start, end });
  }
  return chunks;
}

async function stampBlocks(blocks: bigint[]) {
  const unique = [...new Set(blocks)].sort((a, b) => (a < b ? -1 : 1));
  const stamps = new Map<bigint, number>();
  if (unique.length === 0) return stamps;
  const first = unique[0];
  const last = unique[unique.length - 1];
  try {
    const [start, end] = await Promise.all([
      publicClient.getBlock({ blockNumber: first }),
      first === last
        ? Promise.resolve(null)
        : publicClient.getBlock({ blockNumber: last }),
    ]);
    const startTs = Number(start.timestamp);
    const endTs = end ? Number(end.timestamp) : startTs;
    const span = last - first;
    for (const block of unique) {
      if (span === 0n) {
        stamps.set(block, startTs);
      } else {
        stamps.set(
          block,
          startTs + Number((block - first) * BigInt(Math.max(endTs - startTs, 0))) / Number(span),
        );
      }
    }
  } catch {
    const now = Math.floor(Date.now() / 1000);
    for (const block of unique) stamps.set(block, now);
  }
  return stamps;
}

function assemble({
  now,
  swapPrints,
  feePrints,
  claimPrints,
  dex24h,
  launchTimes,
  creators,
  feesHeld,
  feeBps,
  partial,
}: {
  now: number;
  swapPrints: Print[];
  feePrints: Print[];
  claimPrints: Print[];
  dex24h: number;
  launchTimes: number[];
  creators: Set<string>;
  feesHeld: number;
  feeBps: number;
  partial: boolean;
}): ProtocolStats {
  const chain24h = sumSince(swapPrints, now - DAY);
  const volume24h = Math.max(chain24h, dex24h);
  const volumePrev24h = sumBetween(swapPrints, now - 2 * DAY, now - DAY);
  const volumeAll = Math.max(sumSince(swapPrints, 0), volume24h);
  const accruedAll = sumSince(feePrints, 0);
  const rate = (feeBps || PROTOCOL_SWAP_FEE_BPS) / 10_000;
  const feesAll = accruedAll > 0
    ? Math.max(accruedAll, feesHeld)
    : Math.max(feesHeld, volumeAll * rate);
  const fees24h = accruedAll > 0
    ? sumSince(feePrints, now - DAY)
    : volume24h * rate;
  const feesPrev24h = accruedAll > 0
    ? sumBetween(feePrints, now - 2 * DAY, now - DAY)
    : volumePrev24h * rate;

  return {
    updatedAt: Date.now(),
    volume24h,
    volumePrev24h,
    volumeAll,
    launches24h: countSince(launchTimes, now - DAY),
    launchesPrev24h: countBetween(launchTimes, now - 2 * DAY, now - DAY),
    launchesAll: launchTimes.length,
    uniqueDevs: creators.size,
    fees24h,
    feesPrev24h,
    feesAll,
    feesHeld,
    claimed24h: sumSince(claimPrints, now - DAY),
    claimedPrev24h: sumBetween(claimPrints, now - 2 * DAY, now - DAY),
    claimedAll: sumSince(claimPrints, 0),
    volumeDays: fillDays(
      swapPrints.length > 0 ? swapPrints : volume24h > 0 ? [{ time: now, value: volume24h }] : [],
      now,
      CHART_DAYS,
    ),
    launchDays: fillDays(
      launchTimes.map((time) => ({ time, value: 1 })),
      now,
      CHART_DAYS,
    ),
    partial,
  };
}

function cacheStats(stats: ProtocolStats) {
  const prev = memoryCache;
  const next =
    prev && stats.claimedAll < prev.claimedAll && !claimsReady
      ? {
          ...stats,
          claimed24h: Math.max(stats.claimed24h, prev.claimed24h),
          claimedPrev24h: Math.max(stats.claimedPrev24h, prev.claimedPrev24h),
          claimedAll: prev.claimedAll,
        }
      : stats;
  memoryCache = next;
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
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

function countSince(times: number[], since: number) {
  return times.filter((time) => time >= since).length;
}

function countBetween(times: number[], from: number, to: number) {
  return times.filter((time) => time >= from && time < to).length;
}

function utcDayStart(ts: number) {
  const date = new Date(ts * 1000);
  return Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 1000,
  );
}

function fillDays(rows: Print[], now: number, days: number): DayBucket[] {
  const last = utcDayStart(now);
  const buckets = new Map<number, number>();
  for (const row of rows) {
    const day = utcDayStart(row.time);
    buckets.set(day, (buckets.get(day) ?? 0) + row.value);
  }
  return Array.from({ length: days }, (_, index) => {
    const time = last - (days - 1 - index) * DAY;
    const date = new Date(time * 1000);
    return {
      time,
      label: date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
      value: buckets.get(time) ?? 0,
    };
  });
}

export function changePct(current: number, previous: number) {
  if (!(previous > 0)) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

export function formatStatUsd(value: number) {
  if (!(value > 0)) return "$0.00";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatStatCount(value: number) {
  if (!(value > 0)) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString("en-US");
}
