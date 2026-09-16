import { useEffect, useLayoutEffect, useState } from "react";
import type { Route } from "./+types/analytics";
import { LAUNCH_FACTORY, ZORP_BUYBACK } from "../lib/addresses";
import { explorerAddress } from "../lib/factory";
import {
  changePct,
  formatStatCount,
  formatStatUsd,
  readCachedProtocolStats,
  subscribeProtocolStats,
  type DayBucket,
  type ProtocolStats,
} from "../lib/protocol-stats";
import { formatChange } from "../lib/tokens";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Analytics : Zorp" },
    {
      name: "description",
      content: "Live on-chain volume, launches, creator claims, and protocol fees on Zorp.",
    },
  ];
}

export default function Analytics() {
  const [range, setRange] = useState<"24h" | "all">("24h");
  const [stats, setStats] = useState<ProtocolStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    const cached = readCachedProtocolStats();
    if (cached) setStats(cached);
  }, []);

  useEffect(() => {
    const stop = subscribeProtocolStats((next) => {
      setStats(next);
      setError(null);
    });
    return () => stop();
  }, []);

  const volume = range === "24h" ? (stats?.volume24h ?? 0) : (stats?.volumeAll ?? 0);
  const launches = range === "24h" ? (stats?.launches24h ?? 0) : (stats?.launchesAll ?? 0);
  const fees = range === "24h" ? (stats?.fees24h ?? 0) : (stats?.feesAll ?? 0);
  const claimed = range === "24h" ? (stats?.claimed24h ?? 0) : (stats?.claimedAll ?? 0);
  const volumeDelta = changePct(stats?.volume24h ?? 0, stats?.volumePrev24h ?? 0);
  const launchDelta = changePct(stats?.launches24h ?? 0, stats?.launchesPrev24h ?? 0);
  const feesDelta = changePct(stats?.fees24h ?? 0, stats?.feesPrev24h ?? 0);
  const claimedDelta = changePct(stats?.claimed24h ?? 0, stats?.claimedPrev24h ?? 0);

  return (
    <main className="mx-auto max-w-[1180px] space-y-5 px-4 py-10 sm:px-6">
      <section className="rounded-3xl bg-raised px-6 py-7 ring-1 ring-line sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-[28px] tracking-wide text-ink sm:text-[32px]">
              Protocol analytics
            </h1>
            <p className="mt-2 max-w-xl text-[14px] leading-6 text-muted">
              Live on-chain reporting for Zorp launches on Arc. Volume is USDC
              swapped through each launch pool. Protocol fees are the 0.5% USDC
              cut sent to the treasury. Creator claims are USDC pulled by
              launch creators. Launches come from the factory.
            </p>
            <p className="mt-2 text-[12px] text-muted">
              {stats && !stats.partial
                ? `Live · updated ${new Date(stats.updatedAt).toLocaleTimeString()} · last complete UTC day highlighted`
                : stats
                  ? "Live · updating figures…"
                  : "Reading factory and pool swaps…"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RangeChip active={range === "24h"} onClick={() => setRange("24h")}>
              24h
            </RangeChip>
            <RangeChip active={range === "all"} onClick={() => setRange("all")}>
              All time
            </RangeChip>
            <a
              href={explorerAddress(LAUNCH_FACTORY)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center rounded-full bg-ink px-3.5 text-[13px] font-medium text-canvas"
            >
              View factory
            </a>
            <a
              href={explorerAddress(ZORP_BUYBACK)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center rounded-full bg-surface px-3.5 text-[13px] font-medium text-ink ring-1 ring-line"
            >
              View treasury
            </a>
          </div>
        </div>

        {error ? (
          <p className="mt-8 text-[14px] text-down">{error}</p>
        ) : (
          <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            <Stat
              label={range === "24h" ? "24h volume" : "All-time volume"}
              value={stats ? formatStatUsd(volume) : "—"}
              delta={stats && range === "24h" ? volumeDelta : null}
              hint={range === "24h" ? "from prior 24h" : "USDC notional"}
              pending={!stats}
            />
            <Stat
              label={range === "24h" ? "24h launches" : "All-time launches"}
              value={stats ? formatStatCount(launches) : "—"}
              delta={stats && range === "24h" ? launchDelta : null}
              hint={range === "24h" ? "from prior 24h" : "factory TokenLaunched"}
              pending={!stats}
            />
            <Stat
              label="Unique token creators"
              value={stats ? formatStatCount(stats.uniqueDevs) : "—"}
              hint="lifetime total"
              pending={!stats}
            />
            <Stat
              label={range === "24h" ? "24h protocol fees" : "Protocol fees earned"}
              value={stats ? formatStatUsd(fees) : "—"}
              delta={stats && range === "24h" ? feesDelta : null}
              hint={
                range === "24h"
                  ? "from prior 24h"
                  : stats && stats.feesHeld > 0
                    ? `${formatStatUsd(stats.feesHeld)} held in treasury`
                    : "0.5% USDC swap fee"
              }
              pending={!stats}
            />
            <Stat
              label={range === "24h" ? "24h creator claims" : "Creator claims"}
              value={stats ? formatStatUsd(claimed) : "—"}
              delta={stats && range === "24h" ? claimedDelta : null}
              hint={range === "24h" ? "from prior 24h" : "USDC claimed by launch creators"}
              pending={!stats}
            />
          </div>
        )}

        <p className="mt-8 text-[12px] text-muted">
          Data is read from Arc RPC. The 24h view uses a rolling window, not a
          completed UTC day. Swaps include first buys and protocol distribute
          trades.
        </p>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <BarCard
          title="Trading volume"
          value={formatStatUsd(volume)}
          hint="Daily USDC swapped in Zorp pools. Latest UTC day is highlighted."
          days={stats?.volumeDays ?? emptyDays()}
          money
        />
        <BarCard
          title="Token launches"
          value={formatStatCount(launches)}
          hint="Tokens created through the live factory, bucketed by UTC day."
          days={stats?.launchDays ?? emptyDays()}
        />
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  delta,
  hint,
  pending,
}: {
  label: string;
  value: string;
  delta?: number | null;
  hint: string;
  pending?: boolean;
}) {
  const up = (delta ?? 0) >= 0;
  return (
    <div>
      <p className="text-[13px] text-muted">{label}</p>
      <p className={`mt-2 font-sans text-[34px] font-bold tracking-tight text-ink sm:text-[40px] ${pending ? "animate-pulse text-muted" : ""}`}>
        {value}
      </p>
      {delta !== null && delta !== undefined ? (
        <p className={`mt-1 text-[13px] ${up ? "text-up" : "text-down"}`}>
          {formatChange(delta)} {hint}
        </p>
      ) : (
        <p className="mt-1 text-[13px] text-muted">{hint}</p>
      )}
    </div>
  );
}

function BarCard({
  title,
  value,
  hint,
  days,
  money,
}: {
  title: string;
  value: string;
  hint: string;
  days: DayBucket[];
  money?: boolean;
}) {
  const max = Math.max(...days.map((day) => day.value), 0);
  return (
    <section className="rounded-3xl bg-raised px-5 py-6 ring-1 ring-line sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-ink">{title}</h2>
          <p className="mt-1 text-[12px] leading-5 text-muted">{hint}</p>
        </div>
        <p className="text-[18px] font-semibold text-ink">{value}</p>
      </div>
      <div className="mt-8 flex h-40 items-end gap-1.5">
        {days.map((day, index) => {
          const height = max > 0 ? Math.max((day.value / max) * 100, day.value > 0 ? 6 : 0) : 0;
          const last = index === days.length - 1;
          return (
            <div key={day.time} className="flex h-full min-w-0 flex-1 flex-col justify-end">
              <div
                title={`${day.label}: ${money ? formatStatUsd(day.value) : formatStatCount(day.value)}`}
                className={`w-full rounded-sm ${
                  last ? "bg-yellowell" : day.value > 0 ? "bg-yellowell/70" : "bg-line"
                }`}
                style={{ height: day.value > 0 ? `${height}%` : "3px" }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex justify-between text-[11px] text-muted">
        <span>{days[0]?.label}</span>
        <span>{days[days.length - 1]?.label}</span>
      </div>
    </section>
  );
}

function RangeChip({
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
      className={`h-9 rounded-full px-3.5 text-[13px] font-medium ${
        active ? "bg-surface text-ink ring-1 ring-line" : "text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function emptyDays(): DayBucket[] {
  const start = Math.floor(Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  ) / 1000);
  return Array.from({ length: 14 }, (_, index) => {
    const time = start - (13 - index) * 86_400;
    return {
      time,
      label: new Date(time * 1000).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }),
      value: 0,
    };
  });
}
