import { useEffect, useRef, useState } from "react";
import { type Address } from "viem";
import { ProfileAvatar } from "./profile-avatar";
import { explorerAddress, explorerTx } from "../lib/factory";
import {
  fetchHolders,
  fetchRecentTrades,
  MARKET_REFRESH,
  type MarketHolder,
  type MarketTrade,
} from "../lib/token-market";
import { shortenAddress } from "../lib/tokens";

type Tab = "trades" | "holders";

export function TokenMarket({
  token,
  ticker,
  tokenIsCurrency0,
  creator,
  poolId,
  pairAsset,
  pairSymbol,
}: {
  token: string;
  ticker: string;
  tokenIsCurrency0: boolean;
  creator: string;
  poolId?: string;
  pairAsset?: string;
  pairSymbol?: string;
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
      try {
        const nextTrades = await fetchRecentTrades(
          address,
          tokenIsCurrency0,
          lookback,
          { poolId, pairAsset },
        );
        if (!cancelled) setTrades((prev) => mergeTrades(prev, nextTrades));
      } catch {
        if (!cancelled) setTrades((prev) => prev ?? []);
      }
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
  }, [token, tokenIsCurrency0, creator, poolId, pairAsset]);

  const quote = pairSymbol || "PAIR";

  return (
    <section className="min-w-0 rounded-[24px] bg-raised px-4 ring-1 ring-line sm:px-5">
      <div className="flex items-center gap-2 py-3">
        <TabButton active={tab === "holders"} onClick={() => setTab("holders")}>
          Holders (top 100)
        </TabButton>
        <TabButton active={tab === "trades"} onClick={() => setTab("trades")}>
          Trades (24h)
        </TabButton>
      </div>

      <div className="max-h-[480px] overflow-y-auto">
        {tab === "trades" ? (
          <TradeList ticker={ticker} pairSymbol={quote} rows={trades} />
        ) : (
          <HolderList ticker={ticker} rows={holders} />
        )}
      </div>
    </section>
  );
}

function TradeList({
  ticker,
  pairSymbol,
  rows,
}: {
  ticker: string;
  pairSymbol: string;
  rows: MarketTrade[] | null;
}) {
  if (!rows) return <EmptyRow text="Loading trades…" />;
  if (rows.length === 0) return <EmptyRow text="No trades yet." />;

  return (
    <table className="w-full text-left text-[13px]">
      <thead className="sticky top-0 bg-canvas text-[12px] text-muted">
        <tr>
          <th className="px-1 py-3 font-medium">Side</th>
          <th className="px-1 py-3 font-medium">Trader</th>
          <th className="px-1 py-3 text-right font-medium">{ticker}</th>
          <th className="px-1 py-3 text-right font-medium">{pairSymbol}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.hash}-${row.time}`} className="border-t border-line/70">
            <td className="px-1 py-2.5">
              <span className={row.buy ? "font-semibold text-up" : "font-semibold text-down"}>
                {row.buy ? "BUY" : "SELL"}
              </span>
            </td>
            <td className="px-1 py-2.5">
              <a
                href={explorerTx(row.hash)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-ink hover:text-yellowell"
              >
                <ProfileAvatar address={row.trader} className="size-5" />
                {shortenAddress(row.trader)}
                {row.venue === "Creator" ? (
                  <span className="text-[11px] font-semibold text-muted">Dev</span>
                ) : null}
              </a>
            </td>
            <td className="px-1 py-2.5 text-right tabular-nums text-ink">
              {formatQty(row.tokenAmount)}
            </td>
            <td className="px-1 py-2.5 text-right tabular-nums text-ink">
              {formatPairQty(row.usdcAmount)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
    <table className="w-full text-left text-[13px]">
      <thead className="sticky top-0 bg-canvas text-[12px] text-muted">
        <tr>
          <th className="px-1 py-3 font-medium">Holder</th>
          <th className="px-1 py-3 text-right font-medium">{ticker}</th>
          <th className="px-1 py-3 text-right font-medium">Share</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.address} className="border-t border-line/70">
            <td className="px-1 py-2.5">
              <a
                href={explorerAddress(row.address)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-ink hover:text-yellowell"
              >
                <ProfileAvatar address={row.address} className="size-5" />
                {row.label ?? shortenAddress(row.address)}
              </a>
            </td>
            <td className="px-1 py-2.5 text-right tabular-nums text-ink">
              {formatQty(row.amount)}
            </td>
            <td className="px-1 py-2.5 text-right tabular-nums text-muted">
              {row.share >= 10 ? row.share.toFixed(1) : row.share.toFixed(2)}%
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
      className={`h-8 rounded-full px-3 text-[13px] font-semibold ${
        active ? "bg-canvas text-ink ring-1 ring-line" : "text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="px-1 py-10 text-[13px] text-muted">{text}</p>;
}

function formatPairQty(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 6 });
  }
  return value.toLocaleString("en-US", { maximumSignificantDigits: 6 });
}

function mergeTrades(prev: MarketTrade[] | null, next: MarketTrade[]) {
  const byHash = new Map<string, MarketTrade>();
  for (const row of [...(prev ?? []), ...next]) {
    const key = row.hash.toLowerCase();
    const existing = byHash.get(key);
    if (!existing || row.venue === "Creator") byHash.set(key, row);
  }
  return [...byHash.values()].sort((a, b) => b.time - a.time).slice(0, 50);
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
