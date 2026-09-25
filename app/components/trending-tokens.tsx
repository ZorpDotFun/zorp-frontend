import { Link } from "react-router";
import { useMemo } from "react";
import { type Token } from "../lib/tokens";
import { TokenCard } from "./token-card";

function trendScore(token: Token) {
  return (
    token.volume +
    token.mcap * 0.04 +
    token.recentBuys * 800 +
    Math.max(0, token.change24h) * 120
  );
}

export function TrendingTokens({
  tokens,
  loading,
  error,
}: {
  tokens: Token[];
  loading: boolean;
  error?: string | null;
}) {
  const trending = useMemo(
    () =>
      [...tokens]
        .sort((a, b) => {
          const delta = trendScore(b) - trendScore(a);
          if (delta !== 0) return delta;
          if (a.launchedAt !== b.launchedAt) return b.launchedAt - a.launchedAt;
          return a.address.localeCompare(b.address);
        })
        .slice(0, 10),
    [tokens],
  );

  return (
    <section id="explore" className="scroll-mt-24 px-3 sm:px-6">
      <div className="mx-auto max-w-[1180px]">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="text-[12px] font-semibold tracking-[0.16em] text-yellowell uppercase">
              Live
            </p>
            <h2 className="mt-1 font-display text-[22px] leading-snug font-semibold text-ink sm:text-[26px]">
              Discover tokens
            </h2>
          </div>
          <Link
            to="/discover"
            className="text-[13px] font-extrabold text-muted transition hover:text-yellowell"
          >
            All launches →
          </Link>
        </div>

        {loading && trending.length === 0 ? (
          <p className="rounded-3xl bg-surface px-5 py-12 text-center text-[14px] font-medium text-muted ring-1 ring-line">
            Loading the tape…
          </p>
        ) : error && trending.length === 0 ? (
          <p className="rounded-3xl bg-surface px-5 py-12 text-center text-[14px] font-medium text-muted ring-1 ring-line">
            {error}
          </p>
        ) : trending.length === 0 ? (
          <p className="rounded-3xl bg-surface px-5 py-12 text-center text-[14px] font-medium text-muted ring-1 ring-line">
            No launches yet.{" "}
            <Link to="/launch" className="text-yellowell">
              Be first.
            </Link>
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              {trending.map((token, index) => (
                <div key={token.address} className={index >= 8 ? "hidden xl:block" : undefined}>
                  <TokenCard
                    token={token}
                    badge={index === 0 ? "HOTTEST" : "HOT"}
                  />
                </div>
              ))}
            </div>
            <div className="mt-8 flex justify-center">
              <Link
                to="/discover"
                className="inline-flex h-12 items-center rounded-full bg-yellowell px-7 text-[15px] font-extrabold text-black transition hover:brightness-110"
              >
                Discover all
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
