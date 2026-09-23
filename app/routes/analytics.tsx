import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Route } from "./+types/analytics";
import { LAUNCH_FACTORY, ZORP_BUYBACK } from "../lib/addresses";
import { explorerAddress } from "../lib/factory";
import { useNetwork } from "../lib/use-network";
import {
  changePct,
  emptyVolumeBars,
  formatStatCount,
  formatStatUsd,
  formatVolumeUsd,
  readCachedProtocolStats,
  subscribeProtocolStats,
  VOLUME_INTERVALS,
  type DayBucket,
  type ProtocolStats,
  type VolumeInterval,
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
  const { network } = useNetwork();
  const [range, setRange] = useState<"24h" | "all">("all");
  const [chartInterval, setChartInterval] = useState<VolumeInterval>(VOLUME_INTERVALS["30m"]);
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

  const volume = stats?.volumeAll ?? 0;
  const launches = range === "24h" ? (stats?.launches24h ?? 0) : (stats?.launchesAll ?? 0);
  const fees = range === "24h" ? (stats?.fees24h ?? 0) : (stats?.feesAll ?? 0);
  const claimed = range === "24h" ? (stats?.creatorFees24h ?? 0) : (stats?.creatorFeesAll ?? 0);
  const launchDelta = changePct(stats?.launches24h ?? 0, stats?.launchesPrev24h ?? 0);
  const feesDelta = changePct(stats?.fees24h ?? 0, stats?.feesPrev24h ?? 0);
  const claimedDelta = changePct(stats?.creatorFees24h ?? 0, stats?.creatorFeesPrev24h ?? 0);

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
              cut sent to the treasury. Creator fees are the launch-tax USDC
              accrued to creators. Launches come from the factory.
            </p>
            {network.id === "robinhood" ? (
              <p className="mt-3 rounded-2xl bg-surface px-3 py-2 text-[12px] text-muted ring-1 ring-line">
                This dashboard is the Arc indexer. Switch to Arc for live
                protocol totals, or use Home to browse Robinhood launches.
              </p>
            ) : null}
            <p className="mt-2 text-[12px] text-muted">
              {stats && !stats.partial
                ? `Live · updated ${new Date(stats.updatedAt).toLocaleTimeString()} · volume from factory go-live`
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
              label="All-time volume"
              value={
                <AnimatedUsd
                  value={volume}
                  ready={Boolean(stats?.volumeReady || volume > 0)}
                />
              }
              hint="USDC swapped across all Zorp pools since factory go-live"
              pending={!stats || !(stats.volumeReady || volume > 0)}
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
              label={range === "24h" ? "24h creator fees" : "Creator fees"}
              value={stats ? formatStatUsd(claimed) : "—"}
              delta={stats && range === "24h" ? claimedDelta : null}
              hint={
                range === "24h"
                  ? "from prior 24h"
                  : stats && stats.creatorFeesHeld > 0
                    ? `${formatStatUsd(stats.creatorFeesHeld)} unclaimed`
                    : "USDC accrued to launch creators"
              }
              pending={!stats}
            />
          </div>
        )}

        <p className="mt-8 text-[12px] text-muted">
          Volume is always all-time USDC notional swapped through every Zorp
          pool since factory go-live. The 24h toggle only applies to launches,
          fees, and creator fees.
        </p>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <BarCard
          title="All-time volume"
          value={
            <AnimatedUsd
              value={volume}
              ready={Boolean(stats?.volumeReady || volume > 0)}
              compact
            />
          }
          hint={
            chartInterval === VOLUME_INTERVALS["30m"]
              ? "All-time USDC swapped in Zorp pools since factory go-live, 30-minute UTC bars."
              : "All-time USDC swapped in Zorp pools since factory go-live, 1-hour UTC bars."
          }
          lifetime={volume}
          days={
            chartInterval === VOLUME_INTERVALS["30m"]
              ? (stats?.volume30m ?? emptyVolumeBars(VOLUME_INTERVALS["30m"]))
              : (stats?.volume1h ?? emptyVolumeBars(VOLUME_INTERVALS["1h"]))
          }
          money
          interval={chartInterval}
          onInterval={setChartInterval}
        />
        <BarCard
          title="Token launches"
          value={formatStatCount(launches)}
          hint={
            chartInterval === VOLUME_INTERVALS["30m"]
              ? "Tokens created through the live factory, 30-minute UTC bars."
              : "Tokens created through the live factory, 1-hour UTC bars."
          }
          days={
            chartInterval === VOLUME_INTERVALS["30m"]
              ? (stats?.launch30m ?? emptyVolumeBars(VOLUME_INTERVALS["30m"]))
              : (stats?.launch1h ?? emptyVolumeBars(VOLUME_INTERVALS["1h"]))
          }
          interval={chartInterval}
          onInterval={setChartInterval}
        />
      </div>
    </main>
  );
}

function AnimatedUsd({
  value,
  ready,
  compact,
}: {
  value: number;
  ready: boolean;
  compact?: boolean;
}) {
  const shown = useRef(0);
  const started = useRef(false);
  const frame = useRef(0);
  const [text, setText] = useState("—");

  useEffect(() => {
    const write = (amount: number) => {
      shown.current = amount;
      setText(formatVolumeUsd(amount));
    };
    if (!ready && !(value > 0)) {
      setText("—");
      return;
    }
    if (!started.current) {
      started.current = true;
      write(value);
      return;
    }
    if (value <= shown.current + 0.005) return;

    const from = shown.current;
    const to = value;
    const startedAt = performance.now();
    const duration = Math.min(800, 320 + Math.log10(to - from + 1) * 160);
    cancelAnimationFrame(frame.current);
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - (1 - progress) ** 3;
      write(from + (to - from) * eased);
      if (progress < 1) frame.current = requestAnimationFrame(tick);
      else write(to);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [ready, value]);

  return <span className={compact ? undefined : "tabular-nums"}>{text}</span>;
}

function Stat({
  label,
  value,
  delta,
  hint,
  pending,
}: {
  label: string;
  value: ReactNode;
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

function candleHeight(value: number, max: number) {
  if (!(value > 0) || !(max > 0)) return 0;
  return Math.max(Math.sqrt(value / max) * 100, 24);
}

function BarCard({
  title,
  value,
  hint,
  days,
  money,
  lifetime,
  interval = VOLUME_INTERVALS["30m"],
  onInterval,
}: {
  title: string;
  value: ReactNode;
  hint: string;
  days: DayBucket[];
  money?: boolean;
  lifetime?: number;
  interval?: VolumeInterval;
  onInterval?: (next: VolumeInterval) => void;
}) {
  const max = Math.max(...days.map((day) => day.value), 0);
  const total = lifetime && lifetime > 0
    ? lifetime
    : days.reduce((sum, day) => sum + day.value, 0);
  const dense = days.length > 24;
  const [hover, setHover] = useState<number | null>(null);
  const active = hover !== null ? days[hover] : null;
  const activeLabel = active
    ? `${active.label} – ${active.endLabel || active.label} UTC`
    : null;
  const activeValue = active
    ? money
      ? formatVolumeUsd(active.value)
      : `${formatStatCount(active.value)} ${active.value === 1 ? "launch" : "launches"}`
    : null;

  return (
    <section className="rounded-3xl bg-raised px-5 py-6 ring-1 ring-line sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-ink">{title}</h2>
          <p className="mt-1 text-[12px] leading-5 text-muted">{hint}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <p className="text-[18px] font-semibold text-ink">{value}</p>
          {onInterval ? (
            <div className="flex items-center gap-1">
              <RangeChip
                active={interval === VOLUME_INTERVALS["30m"]}
                onClick={() => onInterval(VOLUME_INTERVALS["30m"])}
              >
                30m
              </RangeChip>
              <RangeChip
                active={interval === VOLUME_INTERVALS["1h"]}
                onClick={() => onInterval(VOLUME_INTERVALS["1h"])}
              >
                1h
              </RangeChip>
            </div>
          ) : null}
        </div>
      </div>
      <div className={`mt-6 ${dense ? "overflow-x-auto" : ""}`}>
        <div
          className={`flex h-48 items-end ${dense ? "gap-px" : "gap-1.5"}`}
          style={dense ? { minWidth: `${Math.max(days.length * 12, 280)}px` } : undefined}
        >
          {days.map((day, index) => {
            const height = candleHeight(day.value, max);
            const last = index === days.length - 1;
            const selected = hover === index;
            return (
              <div
                key={day.time}
                className={`relative flex h-full flex-1 cursor-pointer flex-col justify-end ${
                  dense ? "min-w-[10px]" : "min-w-0"
                }`}
                onMouseEnter={() => setHover(index)}
                onMouseLeave={() => setHover(null)}
              >
                <div className="absolute inset-0 rounded-sm hover:bg-yellowell/10" />
                <div
                  className={`relative z-10 w-full rounded-sm transition-colors ${
                    selected
                      ? "bg-yellowell"
                      : last
                        ? "bg-yellowell"
                        : day.value > 0
                          ? "bg-yellowell/75"
                          : "bg-line"
                  }`}
                  style={{ height: day.value > 0 ? `${height}%` : "4px" }}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-3 min-h-[40px] text-[12px] leading-5">
        {active && activeLabel ? (
          <div>
            <p className="text-muted">{activeLabel}</p>
            <p className="font-semibold text-ink">
              {activeValue}
              {total > 0 && active.value > 0 ? (
                <span className="ml-1.5 font-normal text-muted">
                  · {((active.value / total) * 100).toFixed(1)}%
                </span>
              ) : null}
            </p>
          </div>
        ) : (
          <div className="flex justify-between text-[11px] text-muted">
            <span>{days[0]?.label} UTC</span>
            <span>{days[days.length - 1]?.label} UTC</span>
          </div>
        )}
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

