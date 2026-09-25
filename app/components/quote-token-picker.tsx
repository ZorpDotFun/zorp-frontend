import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import {
  QUOTE_SECTIONS,
  emptyCatalog,
  fetchQuoteCatalog,
  tokensInSection,
  type QuoteCatalog,
  type QuoteSectionId,
  type QuoteToken,
} from "../lib/quote-tokens";

export function QuoteTokenPicker({
  selected,
  onSelect,
  customValue,
  onCustomChange,
  section,
  onSectionChange,
}: {
  selected: Address | null;
  onSelect: (token: QuoteToken) => void;
  customValue: string;
  onCustomChange: (value: string) => void;
  section: QuoteSectionId;
  onSectionChange: (section: QuoteSectionId) => void;
}) {
  const [catalog, setCatalog] = useState<QuoteCatalog>(emptyCatalog);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchQuoteCatalog().then((next) => {
      if (!cancelled) {
        setCatalog(next);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(
    () => ({
      currencies: catalog.currencies.length,
      stocks: catalog.stocks.length,
      uniswap: catalog.uniswap.length,
      custom: 0,
    }),
    [catalog],
  );
  const tokens = tokensInSection(catalog, section);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tokens;
    return tokens.filter(
      (token) =>
        token.symbol.toLowerCase().includes(q) ||
        token.name.toLowerCase().includes(q),
    );
  }, [query, tokens]);

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-5 text-muted">
        The launch token will trade against this quote token.
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-2 border-b border-line pb-2">
        {QUOTE_SECTIONS.map((item) => {
          const active = section === item.id;
          const count = item.id === "custom" ? null : counts[item.id];
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setQuery("");
                onSectionChange(item.id);
              }}
              className={`text-[13px] transition ${
                active ? "text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {item.label}
              {count !== null ? (
                <span className="ml-1 text-muted">{loaded ? count : "…"}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {section === "custom" ? (
        <input
          value={customValue}
          onChange={(event) => onCustomChange(event.target.value.trim())}
          placeholder="0x… token address on Robinhood"
          spellCheck={false}
          className="h-11 w-full rounded-2xl bg-surface px-4 text-[14px] text-ink outline-none ring-1 ring-line placeholder:text-muted focus:ring-yellowell"
        />
      ) : (
        <>
          {tokens.length > 8 ? (
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${section}…`}
              className="h-11 w-full rounded-2xl bg-surface px-4 text-[14px] text-ink outline-none ring-1 ring-line placeholder:text-muted focus:ring-yellowell"
            />
          ) : null}
          <div className="max-h-72 overflow-y-auto overflow-x-hidden rounded-2xl bg-canvas p-2 ring-1 ring-line">
            <div className="grid grid-cols-3 gap-2">
              {filtered.map((token) => (
                <QuoteCard
                  key={token.address}
                  token={token}
                  active={selected?.toLowerCase() === token.address.toLowerCase()}
                  onSelect={() => onSelect(token)}
                />
              ))}
              {loaded && filtered.length === 0 ? (
                <p className="col-span-full px-2 py-6 text-center text-[12px] text-muted">
                  {tokens.length === 0
                    ? "No Uniswap-eligible tokens in this section yet."
                    : "No tokens match that search."}
                </p>
              ) : null}
              {!loaded && tokens.length === 0 ? (
                <p className="col-span-full px-2 py-6 text-center text-[12px] text-muted">
                  Loading quote tokens…
                </p>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function QuoteCard({
  token,
  active,
  onSelect,
}: {
  token: QuoteToken;
  active: boolean;
  onSelect: () => void;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex min-w-0 items-center gap-2 rounded-2xl bg-surface px-2.5 py-2 text-left ring-1 transition ${
        active ? "ring-yellowell" : "ring-line hover:ring-yellowell/50"
      }`}
    >
      {token.logoUrl && !broken ? (
        <img
          src={token.logoUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="size-7 shrink-0 rounded-full bg-white object-contain p-0.5"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-canvas font-display text-[11px] text-yellowell ring-1 ring-line">
          {token.symbol.slice(0, 1)}
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-[12px] font-bold text-ink">
          {token.symbol}
        </span>
        <span className="block truncate text-[11px] text-muted">{token.name}</span>
      </span>
    </button>
  );
}
