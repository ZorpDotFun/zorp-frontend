import { useEffect, useRef, useState } from "react";
import { type Address } from "viem";
import { explorerAddress, explorerTx } from "../lib/factory";
import {
  fetchHolders,
  fetchRecentTrades,
  MARKET_REFRESH,
  type MarketHolder,
  type MarketTrade,
} from "../lib/token-market";
import { formatUsdPrice, shortenAddress } from "../lib/tokens";

type Tab = "trades" | "holders";

export function TokenMarket({
  token,
  ticker,
  tokenIsCurrency0,
  creator,
}: {
  token: string;
  ticker: string;
  tokenIsCurrency0: boolean;
  creator: string;
}) {
  const [tab, setTab] = useState<Tab>("trades");
  const [trades, setTrades] = useState<MarketTrade[] | null>(null);
  const [holders, setHolders] = useState<MarketHolder[] | null>(null);
  const tradesRef = useRef<MarketTrade[] | null>(null);
  tradesRef.current = trades;

  useEffect(() => {
    let cancelled = false;
    const address = token as Address;

    async function loadTrades(lookback?: bigint) {
      const nextTrades = await fetchRecentTrades(
        address,
        tokenIsCurrency0,
        lookback,
      );
      if (!cancelled) setTrades((prev) => mergeTrades(prev, nextTrades));
    }

    async function loadHolders() {
      const extra = (tradesRef.current ?? []).map((row) => row.trader);
      const nextHolders = await fetchHolders(address, creator, extra);
      if (!cancelled) setHolders(nextHolders);
    }

    void loadTrades();
    void loadHolders();
    const timer = window.setInterval(() => {
      void loadTrades();
      void loadHolders();
    }, 12_000);

    function onRefresh(event: Event) {
      const detail = (event as CustomEvent<{ token?: string; trade?: MarketTrade }>)
        .detail;
      if (detail?.token && detail.token.toLowerCase() !== token.toLowerCase()) {
        return;
      }
      if (detail?.trade) {
        setTrades((prev) => mergeTrades(prev, [detail.trade as MarketTrade]));
      }
      void loadTrades(4_000n);
      void loadHolders();
      window.setTimeout(() => {
        if (!cancelled) void loadTrades(4_000n);
      }, 2_000);
    }

    window.addEventListener(MARKET_REFRESH, onRefresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener(MARKET_REFRESH, onRefresh);
    };
  }, [token, tokenIsCurrency0, creator]);

  return (
    <section className="overflow-hidden rounded-3xl bg-raised ring-1 ring-line">
      <div className="flex items-center gap-1 border-b border-line px-3 py-2">
        <TabButton active={tab === "trades"} onClick={() => setTab("trades")}>
          Recent trades
        </TabButton>
        <TabButton active={tab === "holders"} onClick={() => setTab("holders")}>
          Holders
        </TabButton>
      </div>

      <div className="max-h-[420px] overflow-y-auto">
        {tab === "trades" ? (
          <TradeList ticker={ticker} rows={trades} />
        ) : (
          <HolderList ticker={ticker} rows={holders} />
        )}
      </div>
    </section>
  );
}

function TradeList({
  ticker,
  rows,
}: {
  ticker: string;
  rows: MarketTrade[] | null;
}) {
  if (!rows) return <EmptyRow text="Loading trades…" />;
  if (rows.length === 0) return <EmptyRow text="No trades yet." />;

  return (
    <ul className="divide-y divide-line/70">
      {rows.map((row) => (
        <li key={`${row.hash}-${row.time}`}>
          <a
            href={explorerTx(row.hash)}
            target="_blank"
            rel="noreferrer"
            className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-[13px] sm:grid-cols-[minmax(0,1.4fr)_minmax(140px,1fr)_minmax(90px,0.7fr)_88px_72px]"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <SideArrow buy={row.buy} />
              <span className="truncate font-medium text-ink">
                {formatQty(row.tokenAmount)} {ticker}
              </span>
            </span>
            <span className="hidden truncate text-muted sm:block">
              {shortenAddress(row.trader)}
            </span>
            <span className="text-right tabular-nums text-ink">
              {formatUsdPrice(row.usdcAmount)}
            </span>
            <span className="hidden text-right text-[12px] text-muted sm:block">
              Uniswap v4
            </span>
            <span className="text-right tabular-nums text-muted">
              {formatTradeAge(row.time)}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function HolderList({
  ticker,
  rows,
}: {
  ticker: string;
  rows: MarketHolder[] | null;
}) {
  if (!rows) return <EmptyRow text="Loading holders…" />;
  if (rows.length === 0) return <EmptyRow text="No holders found." />;

  return (
    <ul className="divide-y divide-line/70">
      {rows.map((row) => (
        <li key={row.address}>
          <a
            href={explorerAddress(row.address)}
            target="_blank"
            rel="noreferrer"
            className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-[13px] sm:grid-cols-[minmax(0,1.4fr)_minmax(140px,1fr)_88px_72px]"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-yellowell/15 text-[10px] font-bold text-yellowell">
                {row.label ? row.label[0] : "W"}
              </span>
              <span className="truncate font-medium text-ink">
                {formatQty(row.amount)} {ticker}
              </span>
            </span>
            <span className="hidden truncate text-muted sm:block">
              {row.label ?? shortenAddress(row.address)}
            </span>
            <span className="hidden text-right text-[12px] text-muted sm:block">
              {row.label ? shortenAddress(row.address) : ""}
            </span>
            <span className="text-right tabular-nums text-muted">
              {row.share >= 10 ? row.share.toFixed(1) : row.share.toFixed(2)}%
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function TabButton({
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
      className={`rounded-full px-3 py-1.5 text-[13px] ${
        active ? "font-medium text-ink" : "text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function SideArrow({ buy }: { buy: boolean }) {
  return (
    <span
      className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
        buy ? "bg-up/15 text-up" : "bg-down/15 text-down"
      }`}
      aria-hidden
    >
      {buy ? "↗" : "↘"}
    </span>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="px-4 py-10 text-center text-[13px] text-muted">{text}</p>;
}

function formatTradeAge(ts: number) {
  const delta = Math.max(0, Date.now() - ts);
  const secs = Math.floor(delta / 1000);
  if (secs < 60) return `${Math.max(1, secs)}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function mergeTrades(prev: MarketTrade[] | null, next: MarketTrade[]) {
  const seen = new Set<string>();
  const out: MarketTrade[] = [];
  for (const row of [...next, ...(prev ?? [])]) {
    const key = row.hash.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out.sort((a, b) => b.time - a.time).slice(0, 50);
}

function formatQty(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trim(value / 1_000)}K`;
  return trim(value);
}

function trim(value: number) {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: value >= 100 ? 2 : value >= 1 ? 2 : 4,
  });
}
