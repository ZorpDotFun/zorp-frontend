import { formatUnits, getAddress, isAddress, type Address } from "viem";
import { rhTokenFactories, TOTAL_SUPPLY } from "./addresses";
import { ROBINHOOD_CHAIN_ID } from "./chains";
import { holderLabel, type MarketHolder, type MarketTrade } from "./token-market";
import { protocolOf } from "./networks";

const ZERO = "0x0000000000000000000000000000000000000000";
const TOKEN_DECIMALS = 18;
const PAGE_CAP = 40;
const HUB = "https://api.blockscout.com/4663/api/v2";

type BlockscoutPage<T> = {
  items?: T[];
  next_page_params?: Record<string, string | number | null> | null;
};

type HolderItem = {
  address?: { hash?: string } | string;
  value?: string;
};

type TransferItem = {
  from?: { hash?: string } | string;
  to?: { hash?: string } | string;
  total?: { value?: string } | string;
  transaction_hash?: string;
  timestamp?: string;
};

export async function readBlockscoutHolders(input: {
  token: Address;
  creator?: string;
}): Promise<MarketHolder[]> {
  const rows: MarketHolder[] = [];
  for (const item of await pageAll<HolderItem>(`tokens/${input.token}/holders`)) {
    const mapped = holderRow(
      hashOf(item.address),
      item.value || "0",
      input.creator,
    );
    if (mapped) rows.push(mapped);
  }
  return rows.sort((a, b) => b.amount - a.amount);
}

export async function readBlockscoutTrades(input: {
  token: Address;
  creator?: string;
}): Promise<MarketTrade[]> {
  const venues = venueSet();
  const rows: MarketTrade[] = [];
  const seen = new Set<string>();
  for (const item of await pageAll<TransferItem>(`tokens/${input.token}/transfers`)) {
    const trade = transferRow(item, venues, input.creator);
    if (!trade || seen.has(trade.hash.toLowerCase())) continue;
    seen.add(trade.hash.toLowerCase());
    rows.push(trade);
  }
  return rows.sort((a, b) => b.time - a.time);
}

async function pageAll<T>(path: string) {
  const rows: T[] = [];
  let query: Record<string, string> = {};
  for (let page = 0; page < PAGE_CAP; page += 1) {
    const body = await blockscoutGet<T>(path, query);
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) break;
    rows.push(...items);
    const next = body.next_page_params;
    if (!next) break;
    query = stringifyParams(next);
  }
  return rows;
}

async function blockscoutGet<T>(path: string, query: Record<string, string>) {
  const key = process.env.BLOCKSCOUT_API_KEY?.trim() || "";
  const params = new URLSearchParams(query);
  if (key) params.set("apikey", key);
  const suffix = `${path}?${params}`;
  const response = await fetch(`${HUB}/${suffix}`, {
    headers: { Accept: "application/json", "User-Agent": "zorp-market/1.0" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`blockscout ${response.status}`);
  return (await response.json()) as BlockscoutPage<T>;
}

function transferRow(
  item: TransferItem,
  venues: Set<string>,
  creator?: string,
): MarketTrade | null {
  const hash = item.transaction_hash;
  const from = hashOf(item.from).toLowerCase();
  const to = hashOf(item.to).toLowerCase();
  const value = BigInt(valueOf(item.total) || "0");
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
    time: transferTime(item.timestamp),
    venue:
      creatorAddr && (to === creatorAddr || from === creatorAddr)
        ? "Creator"
        : "Uniswap v4",
  };
}

function holderRow(
  address: string,
  quantity: string,
  creator?: string,
): MarketHolder | null {
  if (!isAddress(address) || address.toLowerCase() === ZERO) return null;
  const raw = BigInt(quantity || "0");
  if (raw <= 0n) return null;
  const amount = Number(formatUnits(raw, TOKEN_DECIMALS));
  if (amount <= 0) return null;
  return {
    address: getAddress(address),
    amount,
    share: TOTAL_SUPPLY > 0 ? (amount / TOTAL_SUPPLY) * 100 : 0,
    label: holderLabel(address, creator, "robinhood"),
  };
}

function venueSet() {
  const protocol = protocolOf("robinhood");
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

function hashOf(value?: { hash?: string } | string) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.hash || "";
}

function valueOf(total?: { value?: string } | string) {
  if (!total) return "0";
  if (typeof total === "string") return total;
  return total.value || "0";
}

function stringifyParams(params: Record<string, string | number | null>) {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    query[key] = String(value);
  }
  return query;
}

function transferTime(stamp?: string) {
  if (!stamp) return Date.now();
  const ms = Date.parse(stamp);
  return Number.isFinite(ms) ? ms : Date.now();
}

export function blockscoutSupported(chainId: number) {
  return chainId === ROBINHOOD_CHAIN_ID;
}
