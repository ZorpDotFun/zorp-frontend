import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  formatAge,
  formatChange,
  formatCompact,
  formatUsd,
  tokenAth,
  tokenMarketCap,
  type Token,
} from "../lib/tokens";
import { SocialIcons } from "./social-icons";
import { TokenArt } from "./token-art";

const PAGE_SIZE = 8;

export function GraduatedSection({
  tokens,
  loading,
  error,
}: {
  tokens: Token[];
  loading: boolean;
  error: string | null;
}) {
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const graduated = tokens;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return graduated;
    return graduated.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.ticker.toLowerCase().includes(q) ||
        t.address.toLowerCase().includes(q),
    );
  }, [graduated, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const slice = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <section className="mx-auto max-w-[1180px] px-4 sm:px-6">
      <div className="mb-5">
        <div className="flex items-center gap-2.5">
          <h2 className="font-display text-[22px] tracking-wide text-ink sm:text-[26px]">
            Graduated
          </h2>
          <span className="rounded-full bg-yellowell/15 px-2 py-0.5 text-[11px] font-bold text-yellowell">
            {filtered.length}
          </span>
        </div>
        <p className="mt-1 text-[13px] text-muted">
          Reached $40k market cap. Still trading on the same Uniswap v4 pool.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <label className="relative block min-w-0 flex-1 max-w-xl">
            <span className="sr-only">Search graduated tokens</span>
            <span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-muted">
              <SearchIcon />
            </span>
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder="Search a token or paste a CA"
              className="h-10 w-full rounded-full bg-surface pr-4 pl-9 text-[13px] text-ink outline-none ring-1 ring-line placeholder:text-muted focus:ring-yellowell"
            />
          </label>
          <Link
            to="/create"
            className="ml-auto inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-yellowell px-4 text-[13px] font-bold text-black transition hover:brightness-110"
          >
            <PlusIcon />
            Create
          </Link>
        </div>
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
        graduated.length === 0 ? null : (
        <p className="rounded-2xl bg-surface px-5 py-10 text-center text-[13px] text-muted ring-1 ring-line">
          No tokens match this search.
        </p>
        )
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          {slice.map((token) => (
            <GraduatedCard key={token.id} token={token} />
          ))}
        </div>
      )}

      {filtered.length > 0 ? (
      <div className="mt-6 flex items-center justify-center gap-1.5">
        <PagerButton
          label="Previous"
          disabled={page === 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        >
          ‹
        </PagerButton>
        {Array.from({ length: pages }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setPage(i)}
            className={`grid size-8 place-items-center rounded-full text-[12px] font-medium transition ${
              i === page
                ? "bg-ink text-canvas"
                : "text-muted hover:bg-surface hover:text-ink"
            }`}
          >
            {i + 1}
          </button>
        ))}
        <PagerButton
          label="Next"
          disabled={page === pages - 1}
          onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
        >
          ›
        </PagerButton>
      </div>
      ) : null}
    </section>
  );
}

function PagerButton({
  children,
  disabled,
  onClick,
  label,
}: {
  children: string;
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-full text-muted transition hover:bg-surface hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function GraduatedCard({ token }: { token: Token }) {
  const up = token.change24h >= 0;

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl bg-raised ring-1 ring-line transition duration-300 hover:-translate-y-0.5 hover:ring-yellowell/50 sm:min-h-[380px]">
      <div className="p-2 pb-0 sm:p-3 sm:pb-0">
        <TokenArt
          ticker={token.ticker}
          hue={token.hue}
          image={token.image}
          className="aspect-square w-full rounded-xl sm:rounded-2xl"
        />
      </div>

      <div className="flex flex-1 flex-col px-2 pb-2.5 pt-2 sm:px-3 sm:pb-3.5 sm:pt-3">
        <SocialIcons
          twitter={token.twitter}
          telegram={token.telegram}
          website={token.website}
          className="mb-2 justify-end sm:mb-3"
        />
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[14px] font-bold text-ink">
              ${token.ticker}
              <span className="font-medium text-muted">/{token.pair}</span>
            </p>
            <p className="truncate text-[11px] text-muted">{token.name}</p>
          </div>
          <div className="text-right">
            <p className="text-[14px] font-bold text-ink">
              {formatCompact(tokenMarketCap(token))}
            </p>
            <p
              className={`text-[11px] font-medium ${up ? "text-up" : "text-down"}`}
            >
              {formatChange(token.change24h)}
            </p>
          </div>
        </div>

        <dl className="mt-auto grid grid-cols-2 gap-1 border-t border-line pt-3 text-[10px] text-muted sm:grid-cols-4">
          <div>
            <dt>Mcap</dt>
            <dd className="mt-0.5 font-medium text-ink">
              {formatUsd(tokenMarketCap(token))}
            </dd>
          </div>
          <div>
            <dt>ATH</dt>
            <dd className="mt-0.5 font-medium text-ink">
              {formatUsd(tokenAth(token))}
            </dd>
          </div>
          <div>
            <dt>Volume</dt>
            <dd className="mt-0.5 font-medium text-ink">
              {formatUsd(token.volume)}
            </dd>
          </div>
          <div>
            <dt>Live</dt>
            <dd className="mt-0.5 font-medium text-ink">
              {formatAge(token.launchedAt)}
            </dd>
          </div>
        </dl>

        <Link
          to={`/token/${token.address}`}
          className="mt-3 grid h-8 w-full place-items-center rounded-full bg-ink text-[12px] font-bold text-canvas transition group-hover:bg-yellowell group-hover:text-black"
        >
          View ${token.ticker}
        </Link>
      </div>
    </article>
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
