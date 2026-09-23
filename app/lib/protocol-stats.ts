import { erc20Abi, formatUnits, parseAbiItem, type Address } from "viem";
import { fetchApiJson } from "./api";
import { FEE_DISTRIBUTOR, LAUNCH_FACTORY, USDC, V4_POOL_MANAGER, ZORP_BUYBACK } from "./addresses";
import { feeDistributorAbi, getPublicClient, launchFactoryAbi, readProtocolFeeBps } from "./factory";
import { PROTOCOL_SWAP_FEE_BPS } from "./fee-models";
import { arcLaunchPoolId } from "./pool-price";

const USDC_DECIMALS = 6;
const DAY = 86_400;
const HOUR = 3_600;
const HALF_HOUR = 1_800;
const LOG_CHUNK = 4_000n;
const CLAIM_RECENT = 80_000n;
const CLAIM_FLOOR = 200_000n;
const CACHE_KEY = "zorp-protocol-stats-v4";
const SWAP_PRINTS_KEY = "zorp-swap-prints-v1";
/** Arc mainstage window on 16 Sep 2026 — factory cannot be earlier than this UTC day. */
const FACTORY_DAY = Math.floor(Date.UTC(2026, 8, 16) / 1000);
/** Factory 0x0471…baAe created at Arc block 21148315. */
export const FACTORY_BLOCK = 21_148_315n;
export const FACTORY_LIVE_FALLBACK = 1_789_557_183;
export const VOLUME_INTERVALS = { "30m": HALF_HOUR, "1h": HOUR } as const;
export type VolumeInterval = (typeof VOLUME_INTERVALS)[keyof typeof VOLUME_INTERVALS];

const swapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);

const accruedEvent = parseAbiItem(
  "event Accrued(address indexed token, uint256 splitQuote, uint256 protocolQuote)",
);

const claimedEvent = parseAbiItem(
  "event Claimed(address indexed account, address indexed asset, uint256 amount)",
);

export type DayBucket = { time: number; label: string; endLabel: string; value: number };

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
  creatorFees24h: number;
  creatorFeesPrev24h: number;
  creatorFeesAll: number;
  creatorFeesHeld: number;
  volumeDays: DayBucket[];
  volume30m: DayBucket[];
  volume1h: DayBucket[];
  launchDays: DayBucket[];
  launch30m: DayBucket[];
  launch1h: DayBucket[];
  factoryLiveAt: number;
  volumeReady: boolean;
  partial: boolean;
};

type Print = { time: number; value: number; account?: string; key?: string };
type LaunchRow = {
  address: Address;
  creator: string;
  launchedAt: number;
  creatorBps: number;
  tributeBps: number;
  tributeToCreator: boolean;
};

let memoryCache: ProtocolStats | null = null;
let swapPrintsMem: Print[] = [];
let feePrintsMem: Print[] = [];
let claimPrintsMem: Print[] = [];
let creatorFeePrintsMem: Print[] = [];
const liveCreatorShare = new Map<string, number>();
let scannedTo = 0n;
let scannedClaimsTo = 0n;
let scannedFeesTo = 0n;
let liveNow = () => Math.floor(Date.now() / 1000);
let liveFactoryAt = FACTORY_LIVE_FALLBACK;
let liveLaunchTimes: number[] = [];
let liveCreators = new Set<string>();
let liveFeesHeld = 0;
let liveFeeBps = PROTOCOL_SWAP_FEE_BPS;
let liveDex24h = 0;
let committedVolume = 0;
let volumeReady = false;
let snapshotReady = false;
let swapHistoryReady = false;
let fetchInFlight: Promise<ProtocolStats> | null = null;
const livePools = new Map<string, boolean>();
const claimKeys = new Set<string>();
const swapKeys = new Set<string>();
const liveListeners = new Set<(stats: ProtocolStats) => void>();
let liveStarted = false;
let claimsReady = false;

export function readCachedProtocolStats(): ProtocolStats | null {
  if (memoryCache) return memoryCache;
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProtocolStats;
    if (!parsed.volume30m || !parsed.volume1h) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function fetchProtocolStats(
  onUpdate?: (stats: ProtocolStats) => void,
): Promise<ProtocolStats> {
  if (fetchInFlight) return fetchInFlight;
  fetchInFlight = runFetchProtocolStats(onUpdate).finally(() => {
    fetchInFlight = null;
  });
  return fetchInFlight;
}

async function runFetchProtocolStats(
  onUpdate?: (stats: ProtocolStats) => void,
): Promise<ProtocolStats> {
  const fromApi = await fetchApiJson<ProtocolStats>("/stats");
  if (fromApi && typeof fromApi.updatedAt === "number") {
    const next = withCreatorFees(fromApi);
    cacheStats(next);
    onUpdate?.(next);
    notifyLive(next);
    return next;
  }
  seedClaimsFromCache();
  seedVolumeFromCache();
  seedSwapPrints();
  const headPromise = arcClient().getBlockNumber();
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
  liveFactoryAt = resolveFactoryLive(launchTimes);
  rememberLaunchPools(tokens);
  rememberCreatorShare(rows);
  liveCreators = creators;
  liveFeesHeld = feesHeld;
  liveFeeBps = feeBps;
  const publish = (partial: boolean) => {
    const next = assemble({
      now: liveNow(),
      swapPrints: swapPrintsMem,
      feePrints: feePrintsMem,
      claimPrints: claimPrintsMem,
      creatorFeePrints: creatorFeePrintsMem,
      dex24h: liveDex24h,
      launchTimes: liveLaunchTimes,
      creators: liveCreators,
      feesHeld: liveFeesHeld,
      feeBps: liveFeeBps,
      partial: partial && !snapshotReady,
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

  const fromBlock =
    swapHistoryReady && scannedTo >= FACTORY_BLOCK
      ? scannedTo + 1n
      : FACTORY_BLOCK;

  const swapPromise = collectSwapVolume(tokens, fromBlock, head, (prints) => {
    swapPrintsMem = prints;
    persistSwapPrints();
    commitVolume(sumSince(prints, 0));
    publish(true);
  }).then(async (result) => {
    let next = result;
    if (next.prints.length === 0 || (!swapHistoryReady && sumSince(next.prints, 0) < committedVolume * 0.2)) {
      next = await collectSwapVolumeByToken(tokens, fromBlock, head, (prints) => {
        swapPrintsMem = prints;
        persistSwapPrints();
        commitVolume(sumSince(prints, 0));
        publish(true);
      });
    }
    swapPrintsMem = next.prints;
    persistSwapPrints();
    commitVolume(sumSince(next.prints, 0));
    if (next.ok) {
      scannedTo = head;
      swapHistoryReady = true;
    }
  });

  const [, feePrints] = await Promise.all([
    claimsStart,
    feesStart,
    swapPromise,
  ]);

  feePrintsMem = feePrints;
  snapshotReady = true;
  return publish(false);
}

export function subscribeProtocolStats(
  onUpdate: (stats: ProtocolStats) => void,
) {
  liveListeners.add(onUpdate);
  seedClaimsFromCache();
  seedSwapPrints();
  const cached = readCachedProtocolStats();
  if (cached) onUpdate(cached);
  seedVolumeFromCache();
  if (!liveStarted) {
    liveStarted = true;
    void startStatsSource();
  }
  return () => {
    liveListeners.delete(onUpdate);
  };
}

async function startStatsSource() {
  const fromApi = await fetchApiJson<ProtocolStats>("/stats");
  if (fromApi && typeof fromApi.updatedAt === "number") {
    const first = withCreatorFees(fromApi);
    cacheStats(first);
    notifyLive(first);
    if (!(first.creatorFeesAll > 0)) {
      void hydrateCreatorFeesFromChain().then((stats) => {
        if (stats) notifyLive(stats);
      });
    }
    window.setInterval(() => {
      void fetchApiJson<ProtocolStats>("/stats").then((next) => {
        if (!next || typeof next.updatedAt !== "number") return;
        const stats = withCreatorFees(next);
        cacheStats(stats);
        notifyLive(stats);
      });
    }, 8_000);
    return;
  }
  startLiveStats();
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
    creatorFeePrints: creatorFeePrintsMem,
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
  arcClient().watchEvent({
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
  arcClient().watchEvent({
    address: V4_POOL_MANAGER,
    event: swapEvent,
    pollingInterval: 2_000,
    onLogs: (logs) => {
      if (logs.length === 0) return;
      void ingestSwapLogs(logs).then((changed) => {
        if (changed) publishLive(false);
      });
    },
  });
  arcClient().watchEvent({
    address: FEE_DISTRIBUTOR,
    event: accruedEvent,
    pollingInterval: 2_000,
    onLogs: (logs) => {
      if (logs.length === 0) return;
      let added = false;
      for (const log of logs) {
        const proto = log.args.protocolQuote ?? 0n;
        if (proto > 0n) {
          const value = Number(formatUnits(proto, USDC_DECIMALS));
          if (value > 0) {
            feePrintsMem.push({ time: liveNow(), value });
            added = true;
          }
        }
        const creatorValue = creatorShareFromSplit(
          log.args.token ?? "",
          log.args.splitQuote ?? 0n,
        );
        if (creatorValue > 0) {
          creatorFeePrintsMem.push({ time: liveNow(), value: creatorValue });
          added = true;
        }
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
      arcClient().getBlockNumber(),
      readTreasuryUsdc(),
      readLaunchIndex(),
    ]);
    liveFeesHeld = feesHeld;
    liveLaunchTimes = rows.map((row) => row.launchedAt);
    liveFactoryAt = resolveFactoryLive(liveLaunchTimes);
    rememberLaunchPools(rows.map((row) => row.address));
    rememberCreatorShare(rows);
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

function seedVolumeFromCache() {
  const cached = memoryCache ?? readCachedProtocolStats();
  if (!cached || !(cached.volumeAll > 0)) return;
  committedVolume = Math.max(committedVolume, cached.volumeAll);
  volumeReady = true;
}

function commitVolume(scanned: number) {
  if (scanned > committedVolume) committedVolume = scanned;
  volumeReady = true;
}

function arcClient() {
  return getPublicClient("arc");
}

function rememberLaunchPools(tokens: Address[]) {
  for (const token of tokens) {
    livePools.set(arcLaunchPoolId(token).toLowerCase(), token.toLowerCase() < USDC.toLowerCase());
  }
}

function rememberCreatorShare(rows: LaunchRow[]) {
  for (const row of rows) {
    const tributeShare = row.tributeToCreator ? row.tributeBps : 0;
    liveCreatorShare.set(row.address.toLowerCase(), row.creatorBps + tributeShare);
  }
}

function creatorShareFromSplit(token: string, splitQuote: bigint) {
  if (splitQuote === 0n) return 0;
  const bps = liveCreatorShare.get(token.toLowerCase()) ?? 10_000;
  if (bps <= 0) return 0;
  const value = Number(formatUnits((splitQuote * BigInt(bps)) / 10_000n, USDC_DECIMALS));
  return value > 0 ? value : 0;
}

function withCreatorFees(stats: ProtocolStats): ProtocolStats {
  const creatorFeesAll = stats.creatorFeesAll ?? 0;
  const claimedAll = stats.claimedAll ?? 0;
  return {
    ...stats,
    creatorFees24h: stats.creatorFees24h ?? 0,
    creatorFeesPrev24h: stats.creatorFeesPrev24h ?? 0,
    creatorFeesAll,
    creatorFeesHeld: stats.creatorFeesHeld ?? Math.max(0, creatorFeesAll - claimedAll),
  };
}

async function hydrateCreatorFeesFromChain() {
  try {
    const [rows, head] = await Promise.all([readLaunchIndex(), arcClient().getBlockNumber()]);
    rememberCreatorShare(rows);
    const floor = head > 200_000n ? head - 200_000n : FACTORY_BLOCK;
    await collectProtocolFees(floor, head);
    const cached = memoryCache;
    if (!cached || !(sumSince(creatorFeePrintsMem, 0) > 0)) return null;
    const next = {
      ...cached,
      creatorFees24h: sumSince(creatorFeePrintsMem, liveNow() - DAY),
      creatorFeesPrev24h: sumBetween(creatorFeePrintsMem, liveNow() - 2 * DAY, liveNow() - DAY),
      creatorFeesAll: sumSince(creatorFeePrintsMem, 0),
      creatorFeesHeld: Math.max(0, sumSince(creatorFeePrintsMem, 0) - (cached.claimedAll ?? 0)),
    };
    cacheStats(next);
    return next;
  } catch {
    return null;
  }
}

function seedSwapPrints() {
  if (swapPrintsMem.length > 0 || typeof sessionStorage === "undefined") return;
  try {
    const raw = sessionStorage.getItem(SWAP_PRINTS_KEY);
    if (!raw) return;
    const rows = JSON.parse(raw) as Print[];
    for (const row of rows) {
      if (!row.time || !(row.value > 0)) continue;
      if (row.key) {
        if (swapKeys.has(row.key)) continue;
        swapKeys.add(row.key);
      }
      swapPrintsMem.push(row);
    }
    if (swapPrintsMem.length > 0) swapHistoryReady = true;
  } catch {
    /* ignore */
  }
}

function persistSwapPrints() {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(SWAP_PRINTS_KEY, JSON.stringify(swapPrintsMem));
  } catch {
    /* quota */
  }
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
        void backfillOlderClaims(
          recentFrom > CLAIM_FLOOR ? recentFrom - CLAIM_FLOOR : 0n,
          recentFrom - 1n,
        );
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
  let end = until;
  while (end >= fromBlock) {
    const start = end > LOG_CHUNK ? end - LOG_CHUNK + 1n : fromBlock;
    const older = await collectCreatorClaims(start < fromBlock ? fromBlock : start, end);
    if (older.ok) {
      applyClaimPrints(older.added);
      if (older.added.length > 0) publishLive(false);
    }
    if (start <= fromBlock) break;
    end = start - 1n;
  }
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

async function ingestSwapLogs(
  logs: {
    blockNumber?: bigint | null;
    transactionHash?: string | null;
    logIndex?: number | null;
    args: { id?: `0x${string}`; amount0?: bigint; amount1?: bigint };
  }[],
) {
  let added = 0;
  const stamps = await stampBlocks(
    logs.map((log) => log.blockNumber).filter((block): block is bigint => block != null),
  );
  for (const log of logs) {
    const poolId = (log.args.id ?? "").toLowerCase();
    const tokenIs0 = livePools.get(poolId);
    if (tokenIs0 === undefined) continue;
    const key = `${log.transactionHash ?? ""}:${log.logIndex ?? ""}`;
    if (key !== ":" && swapKeys.has(key)) continue;
    const usdc = tokenIs0 ? log.args.amount1 : log.args.amount0;
    if (usdc === undefined) continue;
    const value = Number(formatUnits(usdc < 0n ? -usdc : usdc, USDC_DECIMALS));
    if (!(value > 0)) continue;
    if (key !== ":") swapKeys.add(key);
    const time = (log.blockNumber && stamps.get(log.blockNumber)) || liveNow();
    swapPrintsMem.push({ time, value, key });
    if (log.blockNumber && log.blockNumber > scannedTo) scannedTo = log.blockNumber;
    added += value;
  }
  if (added > 0) {
    commitVolume(sumSince(swapPrintsMem, 0));
    persistSwapPrints();
  }
  return added > 0;
}

async function readLaunchIndex(): Promise<LaunchRow[]> {
  const count = await arcClient().readContract({
    address: LAUNCH_FACTORY,
    abi: launchFactoryAbi,
    functionName: "launchCount",
  });
  if (count === 0n) return [];

  const addresses = await Promise.all(
    Array.from({ length: Number(count) }, (_, index) =>
      arcClient().readContract({
        address: LAUNCH_FACTORY,
        abi: launchFactoryAbi,
        functionName: "allTokens",
        args: [BigInt(index)],
      }),
    ),
  );

  const [launches, feeLaunches] = await Promise.all([
    Promise.all(
      addresses.map((address) =>
        arcClient().readContract({
          address: LAUNCH_FACTORY,
          abi: launchFactoryAbi,
          functionName: "launches",
          args: [address],
        }),
      ),
    ),
    Promise.all(
      addresses.map((address) =>
        arcClient().readContract({
            address: FEE_DISTRIBUTOR,
            abi: feeDistributorAbi,
            functionName: "launches",
            args: [address],
          })
          .catch(() => null),
      ),
    ),
  ]);

  return addresses.flatMap((address, index) => {
    const launch = launches[index];
    if (!launch[10]) return [];
    const fees = feeLaunches[index]?.[4];
    const tribute = feeLaunches[index]?.[3] ?? "";
    const tributeBps = fees?.tributeBps ?? 0;
    const creator = launch[1];
    return [
      {
        address,
        creator,
        launchedAt: Number(launch[6]),
        creatorBps: fees?.creatorBps ?? 10_000,
        tributeBps,
        tributeToCreator:
          tributeBps > 0 &&
          (!tribute ||
            tribute === "0x0000000000000000000000000000000000000000" ||
            tribute.toLowerCase() === creator.toLowerCase()),
      },
    ];
  });
}

async function collectSwapVolume(
  tokens: Address[],
  fromBlock: bigint,
  latest: bigint,
  onChunk?: (prints: Print[]) => void,
): Promise<{ prints: Print[]; ok: boolean }> {
  if (tokens.length === 0) return { prints: swapPrintsMem, ok: true };
  if (fromBlock > latest) return { prints: swapPrintsMem, ok: true };

  const pools = new Map(
    tokens.map((token) => [
      arcLaunchPoolId(token).toLowerCase(),
      token.toLowerCase() < USDC.toLowerCase(),
    ]),
  );
  const ids = tokens.map((token) => arcLaunchPoolId(token));
  const pages: Print[] = [...swapPrintsMem];
  let ok = true;

  for (const chunk of blockChunks(fromBlock, latest)) {
    try {
      const logs = await getLogsSplit({
        address: V4_POOL_MANAGER,
        event: swapEvent,
        args: { id: ids },
        fromBlock: chunk.start,
        toBlock: chunk.end,
      });
      if (logs.length > 0) {
        const stamps = await stampSwapBlocks(logs.map((log) => log.blockNumber), latest);
        for (const log of logs) {
          const tokenIs0 = pools.get((log.args.id ?? "").toLowerCase());
          if (tokenIs0 === undefined) continue;
          const key = `${log.transactionHash}:${log.logIndex}`;
          if (swapKeys.has(key)) continue;
          const usdc = tokenIs0 ? log.args.amount1 : log.args.amount0;
          if (usdc === undefined) continue;
          const value = Number(formatUnits(usdc < 0n ? -usdc : usdc, USDC_DECIMALS));
          if (!(value > 0)) continue;
          const time =
            stamps.get(log.blockNumber) ||
            timeAtFactoryBlock(log.blockNumber, latest, liveNow());
          swapKeys.add(key);
          pages.push({ time, value, key });
        }
        onChunk?.(pages);
      }
    } catch {
      ok = false;
    }
  }

  return { prints: pages, ok };
}

async function collectSwapVolumeByToken(
  tokens: Address[],
  fromBlock: bigint,
  latest: bigint,
  onChunk?: (prints: Print[]) => void,
): Promise<{ prints: Print[]; ok: boolean }> {
  const pages: Print[] = [...swapPrintsMem];
  let ok = true;
  for (const token of tokens) {
    try {
      const logs = await getLogsSplit({
        address: V4_POOL_MANAGER,
        event: swapEvent,
        args: { id: arcLaunchPoolId(token) },
        fromBlock,
        toBlock: latest,
      });
      if (logs.length === 0) continue;
      const tokenIs0 = token.toLowerCase() < USDC.toLowerCase();
      const stamps = await stampSwapBlocks(logs.map((log) => log.blockNumber), latest);
      for (const log of logs) {
        const key = `${log.transactionHash}:${log.logIndex}`;
        if (swapKeys.has(key)) continue;
        const usdc = tokenIs0 ? log.args.amount1 : log.args.amount0;
        if (usdc === undefined) continue;
        const value = Number(formatUnits(usdc < 0n ? -usdc : usdc, USDC_DECIMALS));
        if (!(value > 0)) continue;
        swapKeys.add(key);
        pages.push({
          time: stamps.get(log.blockNumber) || timeAtFactoryBlock(log.blockNumber, latest, liveNow()),
          value,
          key,
        });
      }
      onChunk?.(pages);
    } catch {
      ok = false;
    }
  }
  return { prints: pages, ok };
}

function timeAtFactoryBlock(block: bigint, head: bigint, headTs: number) {
  if (block <= FACTORY_BLOCK) return FACTORY_LIVE_FALLBACK;
  const span = head > FACTORY_BLOCK ? head - FACTORY_BLOCK : 1n;
  const dt = Math.max(headTs - FACTORY_LIVE_FALLBACK, 1);
  return FACTORY_LIVE_FALLBACK + (Number(block - FACTORY_BLOCK) * dt) / Number(span);
}

async function stampSwapBlocks(blocks: bigint[], head: bigint) {
  const stamps = await stampBlocks(blocks);
  const now = liveNow();
  for (const block of blocks) {
    const time = stamps.get(block);
    if (!time || time < FACTORY_DAY) {
      stamps.set(block, timeAtFactoryBlock(block, head, now));
    }
  }
  return stamps;
}

async function collectProtocolFees(fromBlock: bigint, latest: bigint) {
  const prints: Print[] = [...feePrintsMem];
  if (fromBlock > latest) return prints;
  try {
    const pages = await Promise.all(
      blockChunks(fromBlock, latest).map(async (chunk) => {
        try {
          return await getLogsSplit({
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
      if (!time) continue;
      const raw = log.args.protocolQuote ?? 0n;
      if (raw > 0n) {
        const value = Number(formatUnits(raw, USDC_DECIMALS));
        if (value > 0) prints.push({ time, value });
      }
      const creatorValue = creatorShareFromSplit(
        log.args.token ?? "",
        log.args.splitQuote ?? 0n,
      );
      if (creatorValue > 0) {
        creatorFeePrintsMem.push({ time, value: creatorValue });
      }
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
  const logs = await getLogsSplit({
    address: FEE_DISTRIBUTOR,
    event: claimedEvent,
    fromBlock,
    toBlock: latest,
  });
  return logs;
}

async function getLogsSplit({
  address,
  event,
  args,
  fromBlock,
  toBlock,
}: {
  address: Address;
  event: typeof claimedEvent | typeof accruedEvent | typeof swapEvent;
  args?: Record<string, unknown>;
  fromBlock: bigint;
  toBlock: bigint;
}) {
  if (fromBlock > toBlock) return [];
  try {
    return await arcClient().getLogs({
      address,
      event,
      ...(args ? { args } : {}),
      fromBlock,
      toBlock,
    });
  } catch {
    const span = toBlock - fromBlock;
    if (span <= 200n) return [];
    const mid = fromBlock + span / 2n;
    const [left, right] = await Promise.all([
      getLogsSplit({ address, event, args, fromBlock, toBlock: mid }),
      getLogsSplit({ address, event, args, fromBlock: mid + 1n, toBlock }),
    ]);
    return [...left, ...right];
  }
}

async function readTreasuryUsdc() {
  try {
    const raw = await arcClient().readContract({
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
      arcClient().getBlock({ blockNumber: latest }),
      span === 0n
        ? Promise.resolve(null)
        : arcClient().getBlock({ blockNumber: from }),
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
  if (blocks > 250_000n) return 250_000n;
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
      arcClient().getBlock({ blockNumber: first }),
      first === last
        ? Promise.resolve(null)
        : arcClient().getBlock({ blockNumber: last }),
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
  creatorFeePrints,
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
  creatorFeePrints: Print[];
  dex24h: number;
  launchTimes: number[];
  creators: Set<string>;
  feesHeld: number;
  feeBps: number;
  partial: boolean;
}): ProtocolStats {
  const volume24h = sumSince(swapPrints, now - DAY);
  const volumePrev24h = sumBetween(swapPrints, now - 2 * DAY, now - DAY);
  const scannedVolume = sumSince(swapPrints, 0);
  const volumeAll = Math.max(committedVolume, scannedVolume);
  const accruedAll = sumSince(feePrints, 0);
  const feesAll = accruedAll > 0 ? Math.max(accruedAll, feesHeld) : feesHeld;
  const fees24h = accruedAll > 0 ? sumSince(feePrints, now - DAY) : 0;
  const feesPrev24h = accruedAll > 0
    ? sumBetween(feePrints, now - 2 * DAY, now - DAY)
    : 0;
  const from = resolveFactoryLive(launchTimes);
  const launchPrints = launchTimes.map((time) => ({ time, value: 1 }));
  const volume30m = fillInterval(swapPrints, from, now, HALF_HOUR);
  const volume1h = fillInterval(swapPrints, from, now, HOUR);
  const launch30m = fillInterval(launchPrints, from, now, HALF_HOUR);
  const launch1h = fillInterval(launchPrints, from, now, HOUR);

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
    creatorFees24h: sumSince(creatorFeePrints, now - DAY),
    creatorFeesPrev24h: sumBetween(creatorFeePrints, now - 2 * DAY, now - DAY),
    creatorFeesAll: sumSince(creatorFeePrints, 0),
    creatorFeesHeld: Math.max(0, sumSince(creatorFeePrints, 0) - sumSince(claimPrints, 0)),
    volumeDays: volume1h,
    volume30m,
    volume1h,
    launchDays: launch1h,
    launch30m,
    launch1h,
    factoryLiveAt: from,
    volumeReady: volumeReady || volumeAll > 0,
    partial: partial && !snapshotReady,
  };
}

function resolveFactoryLive(launchTimes: number[]) {
  let start = liveFactoryAt >= FACTORY_DAY ? liveFactoryAt : FACTORY_LIVE_FALLBACK;
  for (const time of launchTimes) {
    if (time >= FACTORY_DAY && time < start) start = time;
  }
  return start;
}

function cacheStats(stats: ProtocolStats) {
  const prev = memoryCache;
  let next = stats;
  if (next.volumeAll > committedVolume) committedVolume = next.volumeAll;
  if (prev && next.volumeAll < prev.volumeAll) {
    next = { ...next, volumeAll: prev.volumeAll };
  }
  if (next.volumeAll > 0) next = { ...next, volumeReady: true };
  if (
    prev &&
    prev.volume30m?.some((bar) => bar.value > 0) &&
    !stats.volume30m.some((bar) => bar.value > 0)
  ) {
    next = {
      ...next,
      volume30m: prev.volume30m,
      volume1h: prev.volume1h,
      volumeDays: prev.volumeDays,
    };
  }
  if (
    prev &&
    prev.launch30m?.some((bar) => bar.value > 0) &&
    !stats.launch30m?.some((bar) => bar.value > 0)
  ) {
    next = {
      ...next,
      launch30m: prev.launch30m,
      launch1h: prev.launch1h,
      launchDays: prev.launchDays,
    };
  }
  if (prev && stats.claimedAll < prev.claimedAll && !claimsReady) {
    next = {
      ...next,
      claimed24h: Math.max(stats.claimed24h, prev.claimed24h),
      claimedPrev24h: Math.max(stats.claimedPrev24h, prev.claimedPrev24h),
      claimedAll: prev.claimedAll,
    };
  }
  if (prev && (stats.creatorFeesAll ?? 0) < (prev.creatorFeesAll ?? 0)) {
    next = {
      ...next,
      creatorFees24h: Math.max(stats.creatorFees24h ?? 0, prev.creatorFees24h ?? 0),
      creatorFeesPrev24h: Math.max(stats.creatorFeesPrev24h ?? 0, prev.creatorFeesPrev24h ?? 0),
      creatorFeesAll: prev.creatorFeesAll,
      creatorFeesHeld: Math.max(stats.creatorFeesHeld ?? 0, prev.creatorFeesHeld ?? 0),
    };
  }
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

function alignDown(ts: number, interval: number) {
  return Math.floor(ts / interval) * interval;
}

function fillInterval(
  rows: Print[],
  from: number,
  now: number,
  interval: VolumeInterval,
): DayBucket[] {
  const floor = from >= FACTORY_DAY ? from : FACTORY_LIVE_FALLBACK;
  const start = alignDown(floor, interval);
  const end = alignDown(Math.max(now, start), interval);
  const buckets = new Map<number, number>();
  for (const row of rows) {
    if (row.time < start) continue;
    const time = alignDown(row.time, interval);
    buckets.set(time, (buckets.get(time) ?? 0) + row.value);
  }
  const out: DayBucket[] = [];
  for (let time = start; time <= end; time += interval) {
    out.push({
      time,
      label: formatIntervalLabel(time),
      endLabel: formatIntervalLabel(time + interval),
      value: buckets.get(time) ?? 0,
    });
  }
  return out;
}

function formatIntervalLabel(time: number) {
  return new Date(time * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  });
}

export function emptyVolumeBars(interval: VolumeInterval): DayBucket[] {
  return fillInterval([], FACTORY_LIVE_FALLBACK, Math.floor(Date.now() / 1000), interval);
}

export function changePct(current: number, previous: number) {
  if (!(previous > 0)) return null;
  return ((current - previous) / previous) * 100;
}

export function formatStatUsd(value: number) {
  if (!(value > 0)) return "$0.00";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatVolumeUsd(value: number) {
  if (!(value > 0)) return "$0.00";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatStatCount(value: number) {
  if (!(value > 0)) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString("en-US");
}
