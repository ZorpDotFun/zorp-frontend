import { GRADUATION_MC_USD } from "./addresses";

export type Token = {
  id: string;
  name: string;
  ticker: string;
  address: string;
  image: string;
  description: string;
  twitter: string;
  telegram: string;
  website: string;
  creator: string;
  mcap: number;
  fdv: number;
  volume: number;
  price: number;
  change24h: number;
  launchedAt: number;
  pair: "USDC";
  hue: number;
  recentBuys: number;
  tokenIsCurrency0: boolean;
  graduated?: boolean;
};

export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0.00";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatUsdPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0.00";
  if (value >= 1) return formatUsd(value);
  const decimals =
    value >= 0.01 ? 4 : value >= 0.0001 ? 6 : value >= 0.000001 ? 9 : 12;
  const trimmed = value
    .toFixed(decimals)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
  return `$${trimmed}`;
}

export function formatCompact(value: number): string {
  return formatUsd(value);
}

export function formatAge(ts: number): string {
  const delta = Math.max(0, Date.now() - ts);
  const secs = Math.floor(delta / 1000);
  if (secs < 60) return `${Math.max(1, secs)}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function shortenAddress(address: string): string {
  if (address.length < 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatChange(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

const GRADUATED_KEY = "zorp-graduated";

function loadGraduated() {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const raw = window.localStorage.getItem(GRADUATED_KEY);
    const rows = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(rows.map((row) => row.toLowerCase()));
  } catch {
    return new Set<string>();
  }
}

const graduatedMem = loadGraduated();

export function rememberGraduated(address: string) {
  const key = address.toLowerCase();
  if (!key || graduatedMem.has(key)) return;
  graduatedMem.add(key);
  try {
    window.localStorage.setItem(GRADUATED_KEY, JSON.stringify([...graduatedMem]));
  } catch {
    /* private mode */
  }
}

export function hasGraduated(address: string) {
  return graduatedMem.has(address.toLowerCase());
}

export function noteMarketCap(
  address: string,
  fdv: number,
  peakFdv = fdv,
) {
  if (Math.max(fdv, peakFdv) >= GRADUATION_MC_USD) rememberGraduated(address);
}

export function impliedPeakFdv(
  fdv: number,
  changes?: { m5?: number; h1?: number; h6?: number; h24?: number } | null,
) {
  if (!(fdv > 0)) return 0;
  let peak = fdv;
  if (!changes) return peak;
  for (const pct of [changes.m5, changes.h1, changes.h6, changes.h24]) {
    if (typeof pct === "number" && pct < 0 && pct > -99.9) {
      peak = Math.max(peak, fdv / (1 + pct / 100));
    }
  }
  return peak;
}

export function tokenMarketCap(token: Pick<Token, "fdv" | "mcap">) {
  return token.fdv > 0 ? token.fdv : token.mcap;
}

export function graduationPct(mc: number) {
  if (mc <= 0) return 0;
  return Math.min(100, (mc / GRADUATION_MC_USD) * 100);
}

export function isGraduated(mc: number, address?: string) {
  if (mc >= GRADUATION_MC_USD) {
    if (address) rememberGraduated(address);
    return true;
  }
  return address ? hasGraduated(address) : false;
}

export function tokenHasGraduated(
  token: Pick<Token, "address" | "fdv" | "mcap" | "graduated">,
) {
  if (token.graduated) return true;
  return isGraduated(tokenMarketCap(token), token.address);
}

export function socialHref(value: string) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}
