/** User-facing copy. Never pass viem / RPC dumps through to the page. */
export function publicError(error: unknown, fallback = "Could not load this token.") {
  const text = error instanceof Error ? error.message : String(error ?? "");
  if (/429|rate limit|too many requests|-32005/i.test(text)) {
    return "Network is busy. Try again in a moment.";
  }
  if (
    /https?:\/\/|quiknode|Request body:|Raw Call Arguments|Contract Call:|Docs: https:\/\/viem/i.test(
      text,
    )
  ) {
    return fallback;
  }
  if (/failed to fetch|rpc \d+|HTTP request failed|timed out|timeout/i.test(text)) {
    return "Could not reach Robinhood right now.";
  }
  if (!text || text.length > 160) return fallback;
  return text;
}
