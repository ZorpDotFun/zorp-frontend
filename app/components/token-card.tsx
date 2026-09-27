import { useState, type MouseEvent } from "react";
import { Link } from "react-router";
import {
  formatChange,
  formatCompactUsd,
  graduationPct,
  shortenAddress,
  tokenHasGraduated,
  tokenMarketCap,
  type Token,
} from "../lib/tokens";
import { TokenArt } from "./token-art";

export function TokenCard({
  token,
  badge,
}: {
  token: Token;
  badge?: string;
}) {
  const [copied, setCopied] = useState(false);
  const mcap = tokenMarketCap(token);
  const bonded = token.bonded || badge === "BONDED";
  const progress =
    bonded || tokenHasGraduated(token) ? 100 : graduationPct(mcap);
  const up = token.change24h >= 0;
  const label = bonded
    ? "BONDED"
    : (badge ?? (tokenHasGraduated(token) ? "LIVE" : "HOT"));

  async function copyAddress(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(token.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  }

  return (
    <Link
      to={`/token/${token.address}`}
      className="group flex flex-col overflow-hidden rounded-2xl bg-raised ring-1 ring-line transition duration-300 hover:-translate-y-1 hover:ring-yellowell/70"
    >
      <div className="relative">
        <TokenArt
          ticker={token.ticker}
          hue={token.hue}
          image={token.image}
          className="aspect-square w-full"
        />
        <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-yellowell uppercase backdrop-blur-sm">
          {bonded ? null : <span aria-hidden>🔥</span>}
          {label}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 px-3 pt-2.5 pb-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-extrabold text-ink">{token.name}</p>
          <div className="mt-0.5 flex items-center gap-1.5 text-[12px] font-medium text-muted">
            <span className="truncate">${token.ticker}/{token.pair}</span>
            <span className="size-1.5 shrink-0 rounded-full bg-yellowell" />
            <button
              type="button"
              onClick={copyAddress}
              className="inline-flex min-w-0 items-center gap-1 font-mono text-[11px] hover:text-ink"
              aria-label="Copy contract address"
            >
              <span className="truncate">{shortenAddress(token.address)}</span>
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 font-extrabold">
          <span className="text-[16px] text-ink sm:text-[18px]">
            {formatCompactUsd(mcap)}{" "}
            <span className="text-[12px] font-medium text-muted">MC</span>
          </span>
          <span className={`inline-flex items-center gap-0.5 ${up ? "text-up" : "text-down"}`}>
            <span aria-hidden>{up ? "▲" : "▼"}</span>
            {formatChange(Math.abs(token.change24h)).replace("+", "")}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="w-10 shrink-0 text-[11px] font-extrabold text-muted">
            {Math.round(progress)}%
          </span>
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-yellowell"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
    </Link>
  );
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.4" stroke="currentColor" />
      <path
        d="M10.5 5.5V3.9A1.4 1.4 0 0 0 9.1 2.5H3.9A1.4 1.4 0 0 0 2.5 3.9v5.2A1.4 1.4 0 0 0 3.9 10.5H5.5"
        stroke="currentColor"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3.5 8.4 6.4 11.2 12.5 4.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
