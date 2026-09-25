import { readCachedRhTape, TAPE_CACHE_CONTROL } from "../lib/launch-tape.server";

export async function loader() {
  try {
    const tokens = await readCachedRhTape();
    return Response.json(tokens, {
      headers: { "Cache-Control": TAPE_CACHE_CONTROL },
    });
  } catch {
    return Response.json([], {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
