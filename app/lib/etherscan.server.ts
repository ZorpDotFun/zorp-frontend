import {
  decodeEventLog,
  formatUnits,
  getAddress,
  isAddress,
  parseAbiItem,
  toEventSelector,
  type Address,
  type Hex,
} from "viem";
import { rhTokenFactories, TOTAL_SUPPLY } from "./addresses";
import { ARC_CHAIN_ID, ROBINHOOD_CHAIN_ID } from "./chains";
import type { NetworkId } from "./active-network";
import { protocolOf } from "./networks";
import { holderLabel, type MarketHolder, type MarketTrade } from "./token-market";

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO = "0x0000000000000000000000000000000000000000";
const TOKEN_DECIMALS = 18;
const PAGE_CAP = 80;

const swapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);

type EtherscanBody = {
  status?: string;
  message?: string;
  result?: unknown;
};

type EtherscanLog = {
  address?: string;
  topics?: string[];
  data?: string;
  timeStamp?: string;
  transactionHash?: string;
};

type HolderRow = {
  TokenHolderAddress?: string;
  TokenHolderQuantity?: string;
  address?: string;
  value?: string;
};

export async function readEtherscanHolders(input: {
  token: Address;
  creator?: string;
  chainId: number;
}): Promise<MarketHolder[]> {
  const listed = await holdersFromList(input);
  if (listed.length > 0) return listed;
  return holdersFromTransfers(input);
}

async function holdersFromList(input: {
  token: Address;
  creator?: string;
  chainId: number;
}): Promise<MarketHolder[]> {
  const networkId = networkFromChain(input.chainId);
  const rows: MarketHolder[] = [];
  for (let page = 1; page <= PAGE_CAP; page += 1) {
    const batch = asArray<HolderRow>(
      await etherscanQuery(input.chainId, {
        module: "token",
        action: "tokenholderlist",
        contractaddress: input.token,
        page: String(page),
        offset: "100",
      }),
    );
    if (batch.length === 0) break;
    for (const row of batch) {
      const mapped = holderFromQuantity(
        row.TokenHolderAddress || row.address || "",
        row.TokenHolderQuantity || row.value || "0",
        input.creator,
        networkId,
      );
      if (mapped) rows.push(mapped);
    }
    if (batch.length < 100) break;
  }
  return rows.sort((a, b) => b.amount - a.amount);
}

async function holdersFromTransfers(input: {
  token: Address;
  creator?: string;
  chainId: number;
}): Promise<MarketHolder[]> {
  const networkId = networkFromChain(input.chainId);
  const balances = new Map<string, bigint>();
  const logs = await pageLogs(input.chainId, {
    address: input.token,
    topic0: TRANSFER_TOPIC,
  });
  for (const log of logs) {
    const from = topicAddress(log.topics?.[1]);
    const to = topicAddress(log.topics?.[2]);
    const value = hexAmount(log.data);
    if (value <= 0n) continue;
    if (from && from !== ZERO) balances.set(from, (balances.get(from) ?? 0n) - value);
    if (to && to !== ZERO) balances.set(to, (balances.get(to) ?? 0n) + value);
  }
  return [...balances.entries()]
    .map(([address, raw]) =>
      holderFromQuantity(address, raw.toString(), input.creator, networkId),
    )
    .filter((row): row is MarketHolder => Boolean(row))
    .sort((a, b) => b.amount - a.amount);
}

function holderFromQuantity(
  address: string,
  quantity: string,
  creator: string | undefined,
  networkId: NetworkId,
): MarketHolder | null {
  if (!isAddress(address)) return null;
  const raw = BigInt(quantity || "0");
  if (raw <= 0n) return null;
  const amount = Number(formatUnits(raw, TOKEN_DECIMALS));
  if (amount <= 0) return null;
  return {
    address: getAddress(address),
    amount,
    share: TOTAL_SUPPLY > 0 ? (amount / TOTAL_SUPPLY) * 100 : 0,
    label: holderLabel(address, creator, networkId),
  };
}

export async function readEtherscanTrades(input: {
  token: Address;
  creator?: string;
  poolId?: string;
  pairAsset?: string;
  tokenIsCurrency0: boolean;
  chainId: number;
}): Promise<MarketTrade[]> {
  const networkId = networkFromChain(input.chainId);
  const protocol = protocolOf(networkId);
  const venues = venueSet(protocol);
  const markUsd = networkId === "robinhood" ? 3_000 : 1;

  const [swaps, transfers] = await Promise.all([
    input.poolId
      ? pageLogs(input.chainId, {
          address: protocol.v4PoolManager,
          topic0: toEventSelector(swapEvent),
          topic1: input.poolId,
          topic0_1_opr: "and",
        })
      : Promise.resolve([]),
    pageLogs(input.chainId, {
      address: input.token,
      topic0: TRANSFER_TOPIC,
    }),
  ]);

  const byHash = new Map<string, MarketTrade>();

  for (const log of swaps) {
    const trade = swapTrade(log, input.tokenIsCurrency0, markUsd, protocol.pairDecimals);
    if (trade) byHash.set(trade.hash.toLowerCase(), trade);
  }

  for (const log of transfers) {
    const trade = transferTrade(log, venues, input.creator);
    if (!trade) continue;
    const key = trade.hash.toLowerCase();
    const existing = byHash.get(key);
    if (!existing) {
      byHash.set(key, trade);
      continue;
    }
    byHash.set(key, {
      ...existing,
      trader: trade.trader || existing.trader,
      buy: trade.buy,
      tokenAmount: trade.tokenAmount || existing.tokenAmount,
      venue: trade.venue ?? existing.venue,
    });
  }

  return [...byHash.values()].sort((a, b) => b.time - a.time);
}

async function pageLogs(chainId: number, extra: Record<string, string>) {
  const rows: EtherscanLog[] = [];
  for (let page = 1; page <= PAGE_CAP; page += 1) {
    const batch = asArray<EtherscanLog>(
      await etherscanQuery(chainId, {
        module: "logs",
        action: "getLogs",
        fromBlock: "0",
        toBlock: "latest",
        page: String(page),
        offset: "1000",
        ...extra,
      }),
    );
    if (batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  return rows;
}

function swapTrade(
  log: EtherscanLog,
  tokenIsCurrency0: boolean,
  markUsd: number,
  pairDecimals: number,
): MarketTrade | null {
  const hash = log.transactionHash;
  if (!hash) return null;
  try {
    const parsed = decodeEventLog({
      abi: [swapEvent],
      data: (log.data || "0x") as Hex,
      topics: (log.topics ?? []) as [Hex, ...Hex[]],
    });
    const amount0 = parsed.args.amount0 ?? 0n;
    const amount1 = parsed.args.amount1 ?? 0n;
    const tokenDelta = tokenIsCurrency0 ? amount0 : amount1;
    const pairDelta = tokenIsCurrency0 ? amount1 : amount0;
    const tokenAmount = Number(formatUnits(abs(tokenDelta), TOKEN_DECIMALS));
    if (tokenAmount <= 0) return null;
    return {
      hash: hash as `0x${string}`,
      trader: topicAddress(log.topics?.[2]) || String(parsed.args.sender ?? ""),
      buy: tokenDelta > 0n,
      tokenAmount,
      usdcAmount: Number(formatUnits(abs(pairDelta), pairDecimals)) * markUsd,
      price: 0,
      time: logTime(log.timeStamp),
      venue: "Uniswap v4",
    };
  } catch {
    return null;
  }
}

function transferTrade(
  log: EtherscanLog,
  venues: Set<string>,
  creator?: string,
): MarketTrade | null {
  const hash = log.transactionHash;
  const from = topicAddress(log.topics?.[1]);
  const to = topicAddress(log.topics?.[2]);
  const value = hexAmount(log.data);
  if (!hash || value <= 0n) return null;

  const buy = venues.has(from) && !venues.has(to);
  const sell = venues.has(to) && !venues.has(from);
  if (!buy && !sell) return null;

  const creatorAddr = creator?.toLowerCase();
  return {
    hash: hash as `0x${string}`,
    trader: buy ? to : from,
    buy,
    tokenAmount: Number(formatUnits(value, TOKEN_DECIMALS)),
    usdcAmount: 0,
    price: 0,
    time: logTime(log.timeStamp),
    venue:
      creatorAddr && (to === creatorAddr || from === creatorAddr)
        ? "Creator"
        : "Uniswap v4",
  };
}

function venueSet(protocol: ReturnType<typeof protocolOf>) {
  return new Set(
    [
      protocol.v4PoolManager,
      protocol.locker,
      protocol.factory,
      protocol.vault,
      protocol.v4UniversalRouter,
      protocol.filler,
      ZERO,
      ...rhTokenFactories(protocol.factory),
    ]
      .filter(Boolean)
      .map((value) => value.toLowerCase()),
  );
}

export async function etherscanQuery(chainId: number, query: Record<string, string>) {
  const key = process.env.ETHERSCAN_API_KEY?.trim();
  if (!key) throw new Error("ETHERSCAN_API_KEY unset");
  const params = new URLSearchParams({
    chainid: String(chainId),
    apikey: key,
    ...query,
  });
  const response = await fetch(`https://api.etherscan.io/v2/api?${params}`, {
    headers: { Accept: "application/json", "User-Agent": "zorp-market/1.0" },
    signal: AbortSignal.timeout(2_500),
  });
  const body = (await response.json()) as EtherscanBody;
  if (isEmptyResult(body) || isProBlocked(body)) return [];
  if (body.status === "0") {
    throw new Error(String(body.message || "etherscan failed"));
  }
  return body.result;
}

function isEmptyResult(body: EtherscanBody) {
  const message = String(body.message || "").toLowerCase();
  const result = body.result;
  return (
    message.includes("no transaction") ||
    message.includes("no record") ||
    message.includes("no data") ||
    result === "No transactions found" ||
    result === ""
  );
}

function isProBlocked(body: EtherscanBody) {
  const text = `${body.message || ""} ${typeof body.result === "string" ? body.result : ""}`;
  return /api pro endpoint|pro plus|not available on your/i.test(text);
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function networkFromChain(chainId: number): NetworkId {
  return chainId === ARC_CHAIN_ID ? "arc" : "robinhood";
}

function topicAddress(topic?: string) {
  if (!topic || topic.length < 40) return "";
  const value = `0x${topic.slice(-40)}`;
  return isAddress(value) ? getAddress(value).toLowerCase() : "";
}

function hexAmount(data?: string) {
  if (!data || data === "0x") return 0n;
  try {
    return BigInt(data);
  } catch {
    return 0n;
  }
}

function logTime(stamp?: string) {
  if (!stamp) return Date.now();
  try {
    const seconds = stamp.startsWith("0x") ? Number(BigInt(stamp)) : Number(stamp);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Date.now();
  } catch {
    return Date.now();
  }
}

function abs(value: bigint) {
  return value < 0n ? -value : value;
}

export function etherscanChainId(value?: string | null) {
  const parsed = Number(value || ROBINHOOD_CHAIN_ID);
  return parsed === ARC_CHAIN_ID ? ARC_CHAIN_ID : ROBINHOOD_CHAIN_ID;
}
