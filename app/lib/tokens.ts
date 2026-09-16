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

export function tokenMarketCap(token: Pick<Token, "fdv" | "mcap">) {
  return token.fdv > 0 ? token.fdv : token.mcap;
}

export function graduationPct(mc: number) {
  if (mc <= 0) return 0;
  return Math.min(100, (mc / GRADUATION_MC_USD) * 100);
}

export function isGraduated(mc: number) {
  return mc >= GRADUATION_MC_USD;
}

export function socialHref(value: string) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}
