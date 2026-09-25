import { getPublicClient } from "./networks";
import type { Address } from "viem";

const LOG_CHUNK = 2_000n;
const DAY_SECONDS = 86_400;

export async function marketWindow(launchedAt?: bigint) {
  const client = getPublicClient();
  const latest = await client.getBlockNumber();
  try {
    const sampleSpan = latest > 20_000n ? 20_000n : latest;
    const [head, sample] =
      sampleSpan > 0n
        ? await Promise.all([
            client.getBlock({ blockNumber: latest }),
            client.getBlock({ blockNumber: latest - sampleSpan }),
          ])
        : [await client.getBlock({ blockNumber: latest }), null];
    const now = Number(head.timestamp);
    const sec =
      sample && sampleSpan > 0n
        ? (now - Number(sample.timestamp)) / Number(sampleSpan)
        : 1;
    const age =
      launchedAt && launchedAt > 0n ? now - Number(launchedAt) : DAY_SECONDS;
    const seconds = Math.min(DAY_SECONDS, Math.max(age + 180, 600));
    const raw = BigInt(Math.ceil(seconds / Math.max(sec, 0.05)) + 800);
    const blocks = raw > 250_000n ? 250_000n : raw;
    return { latest, fromBlock: latest > blocks ? latest - blocks : 0n };
  } catch {
    const lookback = 200_000n;
    return { latest, fromBlock: latest > lookback ? latest - lookback : 0n };
  }
}

export async function collectContractLogs<T>({
  address,
  event,
  args,
  lookback,
  fromBlock: fromOverride,
  newestFirst = false,
  limit,
}: {
  address: Address;
  event: T;
  args?: Record<string, unknown>;
  lookback?: bigint;
  fromBlock?: bigint;
  newestFirst?: boolean;
  limit?: number;
}) {
  const latest = await getPublicClient().getBlockNumber();
  const fromBlock =
    fromOverride ?? (lookback != null && latest > lookback ? latest - lookback : 0n);
  const pages: unknown[][] = [];

  if (newestFirst) {
    for (let end = latest; end >= fromBlock; end -= LOG_CHUNK) {
      const start = end + 1n - LOG_CHUNK < fromBlock ? fromBlock : end + 1n - LOG_CHUNK;
      pages.push(await getLogsRange({ address, event, args, fromBlock: start, toBlock: end }));
      const count = pages.reduce((sum, page) => sum + page.length, 0);
      if (limit && count >= limit) break;
    }
    return pages.flat();
  }

  for (let start = fromBlock; start <= latest; start += LOG_CHUNK) {
    const end = start + LOG_CHUNK - 1n > latest ? latest : start + LOG_CHUNK - 1n;
    pages.push(await getLogsRange({ address, event, args, fromBlock: start, toBlock: end }));
    if (limit && pages.reduce((sum, page) => sum + page.length, 0) >= limit) break;
  }
  return pages.flat();
}

async function getLogsRange<T>({
  address,
  event,
  args,
  fromBlock,
  toBlock,
}: {
  address: Address;
  event: T;
  args?: Record<string, unknown>;
  fromBlock: bigint;
  toBlock: bigint;
}) {
  if (toBlock < fromBlock) return [];
  try {
    return await withRetry(() =>
      getPublicClient().getLogs({
        address,
        event: event as never,
        args: args as never,
        fromBlock,
        toBlock,
      }),
    );
  } catch {
    if (toBlock <= fromBlock) return [];
    const mid = fromBlock + (toBlock - fromBlock) / 2n;
    if (mid < fromBlock || mid >= toBlock) return [];
    const left = await getLogsRange({ address, event, args, fromBlock, toBlock: mid });
    const right = await getLogsRange({
      address,
      event,
      args,
      fromBlock: mid + 1n,
      toBlock,
    });
    return [...left, ...right];
  }
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/too many requests|429|busy|rate limit/i.test(message) || attempt === attempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
    }
  }
  throw last;
}
