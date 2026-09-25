import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { type Token } from "../lib/tokens";
import { TokenCard } from "./token-card";

type SortKey =
  | "newest"
  | "oldest"
  | "mcap-desc"
  | "mcap-asc"
  | "vol-desc"
  | "vol-asc";
type WindowKey = "all" | "1h" | "24h" | "7d";
type PairKey = "all" | "USDC" | "WETH";
type MomentumKey = "all" | "gainers" | "losers";
type QuickKey = "buys" | "newest" | "oldest" | "mcap" | "volume";

const SORT_LABELS: Record<SortKey, string> = {
  newest: "Newest",
  oldest: "Oldest",
  "mcap-desc": "Market cap, high to low",
  "mcap-asc": "Market cap, low to high",
  "vol-desc": "Volume, high to low",
  "vol-asc": "Volume, low to high",
};

export function ExploreSection({
  tokens,
  loading,
  error,
}: {
  tokens: Token[];
  loading: boolean;
  error: string | null;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [manualSort, setManualSort] = useState(false);
  const [openSort, setOpenSort] = useState(false);
  const [windowKey, setWindowKey] = useState<WindowKey>("all");
  const [pair, setPair] = useState<PairKey>("all");
  const [momentum, setMomentum] = useState<MomentumKey>("all");
  const [quick, setQuick] = useState<QuickKey>("newest");
  const sortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openSort) return;
    const onPointer = (event: PointerEvent) => {
      if (!sortRef.current?.contains(event.target as Node)) {
        setOpenSort(false);
      }
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [openSort]);

  const launched = tokens;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const cutoff =
      windowKey === "1h"
        ? Date.now() - 3_600_000
        : windowKey === "24h"
          ? Date.now() - 86_400_000
          : windowKey === "7d"
            ? Date.now() - 7 * 86_400_000
            : 0;

    let rows = launched.filter((t) => {
      if (cutoff && t.launchedAt < cutoff) return false;
      if (pair !== "all" && t.pair !== pair) return false;
      if (momentum === "gainers" && t.change24h <= 0) return false;
      if (momentum === "losers" && t.change24h >= 0) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.ticker.toLowerCase().includes(q) ||
        t.address.toLowerCase().includes(q)
      );
    });

    const effectiveSort: SortKey = manualSort
      ? sort
      : quick === "buys"
        ? "vol-desc"
        : quick === "newest"
          ? "newest"
          : quick === "oldest"
            ? "oldest"
            : quick === "mcap"
              ? "mcap-desc"
              : "vol-desc";

    const used = effectiveSort;

    rows = [...rows].sort((a, b) => {
      switch (used) {
        case "oldest":
          return a.launchedAt - b.launchedAt;
        case "mcap-desc":
          return b.mcap - a.mcap;
        case "mcap-asc":
          return a.mcap - b.mcap;
        case "vol-desc":
          return quick === "buys"
            ? b.recentBuys - a.recentBuys
            : b.volume - a.volume;
        case "vol-asc":
          return a.volume - b.volume;
        default:
          return b.launchedAt - a.launchedAt;
      }
    });

    return rows;
  }, [launched, query, sort, windowKey, pair, momentum, quick, manualSort]);

  return (
    <section className="mx-auto max-w-[1180px] px-4 pb-20 sm:px-6">
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-[26px] text-ink sm:text-[32px]">
              Explore
            </h1>
            <span className="text-[12px] text-muted">
              {filtered.length.toLocaleString()} launched
            </span>
          </div>
          <p className="mt-1 text-[13px] text-muted">
            Live on Uniswap v4 from block one.
          </p>
        </div>

        <div className="flex flex-1 flex-col gap-2 sm:flex-row lg:max-w-[640px]">
          <label className="relative flex-1">
            <span className="sr-only">Search a token or paste a CA</span>
            <span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-muted">
              <SearchIcon />
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a token or paste a CA"
              className="h-10 w-full rounded-full bg-surface pr-4 pl-9 text-[13px] text-ink outline-none ring-1 ring-line placeholder:text-muted focus:ring-yellowell"
            />
          </label>

          <div className="relative" ref={sortRef}>
            <button
              type="button"
              onClick={() => setOpenSort((v) => !v)}
              className="flex h-10 w-full items-center justify-between gap-6 rounded-full bg-surface px-4 text-[13px] font-medium text-ink ring-1 ring-line sm:w-[220px]"
            >
              {SORT_LABELS[sort]}
              <span className="text-muted">▾</span>
            </button>
            {openSort ? (
              <ul className="absolute right-0 z-20 mt-2 w-[240px] overflow-hidden rounded-2xl bg-raised py-1 shadow-xl ring-1 ring-line">
                {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => {
                        setSort(key);
                        setManualSort(true);
                        setOpenSort(false);
                      }}
                      className="flex w-full items-center justify-between px-4 py-2.5 text-left text-[13px] text-ink hover:bg-surface"
                    >
                      {SORT_LABELS[key]}
                      {sort === key ? (
                        <span className="text-yellowell">✓</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <Link
            to="/create"
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-yellowell px-4 text-[13px] font-bold text-black transition hover:brightness-110"
          >
            <PlusIcon />
            Create
          </Link>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        {(
          [
            ["buys", "Recent buys"],
            ["newest", "Newest"],
            ["oldest", "Oldest"],
            ["mcap", "Market cap"],
            ["volume", "Volume"],
          ] as const
        ).map(([key, label]) => (
          <Chip
            key={key}
            active={quick === key}
            onClick={() => {
              setQuick(key);
              setManualSort(false);
              setOpenSort(false);
            }}
          >
            {label}
          </Chip>
        ))}
        <span className="mx-1 hidden h-4 w-px bg-line sm:block" />
        {(
          [
            ["all", "All"],
            ["1h", "1h"],
            ["24h", "24h"],
            ["7d", "7d"],
          ] as const
        ).map(([key, label]) => (
          <Chip
            key={key}
            active={windowKey === key}
            onClick={() => setWindowKey(key)}
          >
            {label}
          </Chip>
        ))}
        <span className="mx-1 hidden h-4 w-px bg-line sm:block" />
        {(
          [
            ["all", "All pairs"],
            ["USDC", "USDC"],
            ["WETH", "WETH"],
          ] as const
        ).map(([key, label]) => (
          <Chip key={key} active={pair === key} onClick={() => setPair(key)}>
            {label}
          </Chip>
        ))}
        <span className="mx-1 hidden h-4 w-px bg-line sm:block" />
        {(
          [
            ["all", "All"],
            ["gainers", "Gainers"],
            ["losers", "Losers"],
          ] as const
        ).map(([key, label]) => (
          <Chip
            key={key}
            active={momentum === key}
            onClick={() => setMomentum(key)}
          >
            {label}
          </Chip>
        ))}
      </div>

      {loading ? (
        <p className="rounded-2xl bg-surface px-5 py-10 text-center text-[13px] text-muted ring-1 ring-line">
          Loading launches…
        </p>
      ) : error ? (
        <p className="rounded-2xl bg-surface px-5 py-10 text-center text-[13px] text-down ring-1 ring-line">
          {error}
        </p>
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl bg-surface px-5 py-10 text-center text-[13px] text-muted ring-1 ring-line">
          {launched.length === 0 ? (
            <>
              No tokens yet.{" "}
              <Link to="/create" className="font-medium text-yellowell">
                Create the first launch.
              </Link>
            </>
          ) : (
            "No launches match these filters."
          )}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {filtered.map((token) => (
            <TokenCard key={token.id} token={token} />
          ))}
        </div>
      )}
    </section>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 rounded-full px-3 text-[12px] font-medium transition ${
        active
          ? "bg-yellowell text-black"
          : "bg-surface text-muted ring-1 ring-line hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M7 1.25v11.5M1.25 7h11.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M16 16.5 20.5 21"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
