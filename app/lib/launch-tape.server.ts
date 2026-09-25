import { readCurrentRhLaunches } from "./factory";
import type { Token } from "./tokens";

const TTL_MS = 8_000;

export const TAPE_CACHE_CONTROL = "public, max-age=8, stale-while-revalidate=20";

let memory: { at: number; tokens: Token[] } | null = null;
let inflight: Promise<Token[]> | null = null;

export async function readCachedRhTape(): Promise<Token[]> {
  const now = Date.now();
  if (memory && now - memory.at < TTL_MS) return memory.tokens;
  if (inflight) return inflight;

  inflight = readCurrentRhLaunches()
    .then((tokens) => {
      if (tokens.length > 0) memory = { at: Date.now(), tokens };
      return tokens;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}
