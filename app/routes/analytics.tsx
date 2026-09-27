import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Route } from "./+types/analytics";
import { RH_REVENUE_TREASURY, ZORP_BUYBACK } from "../lib/addresses";
import { explorerAddress } from "../lib/factory";
import { getNetwork, protocolOf } from "../lib/networks";
import {
  emptyVolumeBars,
  formatStatCount,
  formatVolumeUsd,
  readCachedProtocolStats,
  subscribeProtocolStats,
  VOLUME_INTERVALS,
  type DayBucket,
  type ProtocolStats,
  type VolumeInterval,
} from "../lib/protocol-stats";
import { PageWash } from "../components/page-wash";

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
  const [range, setRange] = useState<"24h" | "all">("all");
  const [chartInterval, setChartInterval] = useState<VolumeInterval>(VOLUME_INTERVALS["30m"]);
  const [stats, setStats] = useState<ProtocolStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    try {
      const cached = readCachedProtocolStats();
      if (cached) setStats(cached);
    } catch {
      /* keep empty until live subscribe */
    }
  }, []);

  useEffect(() => {
    try {
      const stop = subscribeProtocolStats((next) => {
        setStats(next);
        setError(null);
      });
      return () => stop();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load analytics.");
    }
  }, []);

  const volume = range === "24h" ? (stats?.volume24h ?? 0) : (stats?.volumeAll ?? 0);
  const launches = range === "24h" ? (stats?.launches24h ?? 0) : (stats?.launchesAll ?? 0);
  const fees = range === "24h" ? (stats?.fees24h ?? 0) : (stats?.feesAll ?? 0);
  const claimed =
    range === "24h" ? (stats?.creatorFees24h ?? 0) : (stats?.creatorFeesAll ?? 0);
  const rh = getNetwork().id === "robinhood";
  const factory = protocolOf().factory;
  const treasury = rh ? RH_REVENUE_TREASURY : ZORP_BUYBACK;

  return (
    <PageWash>
    <main className="mx-auto w-full min-w-0 max-w-[1180px] space-y-8 overflow-x-hidden px-4 pb-16 pt-6 sm:space-y-10 sm:px-6">
      <section className="min-w-0">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-6">
          <h1 className="page-title page-title-lg">Analytics</h1>
          <div className="flex max-w-full flex-wrap items-center gap-x-4 gap-y-2 sm:gap-x-6 sm:gap-y-3">
            <RangeChip active={range === "24h"} onClick={() => setRange("24h")}>
              24h
            </RangeChip>
            <RangeChip active={range === "all"} onClick={() => setRange("all")}>
              All time
            </RangeChip>
            <a
              href={explorerAddress(factory)}
              target="_blank"
              rel="noreferrer"
              className="page-cta"
            >
              Factory
            </a>
            <a
              href={explorerAddress(treasury)}
              target="_blank"
              rel="noreferrer"
              className="page-cta"
            >
              Treasury
            </a>
          </div>
        </div>

        {error ? (
          <p className="mt-8 text-[14px] text-down">{error}</p>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-6 sm:mt-10 sm:gap-8 lg:grid-cols-3">
            <Stat label="Volume" value={<AnimatedUsd value={volume} />} />
            <Stat label="Launches" value={formatStatCount(launches)} />
            <Stat
              label="Creators"
              value={formatStatCount(stats?.uniqueDevs ?? 0)}
            />
            <Stat label="Protocol fees" value={<AnimatedUsd value={fees} />} />
            <Stat label="Creator fees" value={<AnimatedUsd value={claimed} />} />
          </div>
        )}
      </section>

      <div className="grid min-w-0 gap-4 sm:gap-5 lg:grid-cols-2">
        <BarCard
          title="Volume"
          value={<AnimatedUsd value={volume} compact />}
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
          title="Launches"
          value={formatStatCount(launches)}
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
    </PageWash>
  );
}

function AnimatedUsd({
  value,
  compact,
}: {
  value: number;
  compact?: boolean;
}) {
  const shown = useRef(0);
  const started = useRef(false);
  const frame = useRef(0);
  const [text, setText] = useState(formatVolumeUsd(0));

  useEffect(() => {
    const write = (amount: number) => {
      shown.current = amount;
      setText(formatVolumeUsd(amount));
    };
    if (!started.current) {
      started.current = true;
      write(value);
      return;
    }
    if (Math.abs(value - shown.current) <= 0.005) return;

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
  }, [value]);

  return <span className={compact ? undefined : "tabular-nums"}>{text}</span>;
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="page-lede text-[12px] sm:text-[14px]">{label}</p>
      <p className="page-title mt-1.5 break-words text-[26px] leading-none sm:mt-2 sm:text-[40px]">
        {value}
      </p>
    </div>
  );
}

function axisLabel(label?: string) {
  if (!label) return "";
  return label.split(",")[0] ?? label;
}

function candleHeight(value: number, max: number) {
  if (!(value > 0) || !(max > 0)) return 0;
  return Math.max(Math.sqrt(value / max) * 100, 24);
}

function BarCard({
  title,
  value,
  days,
  money,
  lifetime,
  interval = VOLUME_INTERVALS["30m"],
  onInterval,
}: {
  title: string;
  value: ReactNode;
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
  const dense = days.length > 48;
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
    <section className="min-w-0 overflow-hidden rounded-3xl bg-raised px-4 py-5 ring-1 ring-line sm:px-6 sm:py-6">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h2 className="page-title text-[20px] sm:text-[22px]">{title}</h2>
        <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
          <p className="page-title min-w-0 text-[20px] sm:text-[22px]">{value}</p>
          {onInterval ? (
            <div className="flex shrink-0 items-center gap-3">
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
      <div className="mt-5 min-w-0">
        <div className={`flex h-40 min-w-0 items-end sm:h-48 ${dense ? "gap-px" : "gap-1"}`}>
          {days.map((day, index) => {
            const height = candleHeight(day.value, max);
            const last = index === days.length - 1;
            const selected = hover === index;
            return (
              <div
                key={day.time}
                className="relative flex h-full min-w-0 flex-1 cursor-pointer flex-col justify-end"
                onMouseEnter={() => setHover(index)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setHover(index)}
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
      <div className="mt-3 min-h-[40px] min-w-0 text-[12px] leading-5">
        {active && activeLabel ? (
          <div className="min-w-0">
            <p className="break-words text-muted">{activeLabel}</p>
            <p className="font-semibold break-words text-ink">
              {activeValue}
              {total > 0 && active.value > 0 ? (
                <span className="ml-1.5 font-normal text-muted">
                  · {((active.value / total) * 100).toFixed(1)}%
                </span>
              ) : null}
            </p>
          </div>
        ) : (
          <div className="flex min-w-0 justify-between gap-3 text-[11px] text-muted">
            <span className="min-w-0 truncate">{axisLabel(days[0]?.label)}</span>
            <span className="min-w-0 truncate text-right">
              {axisLabel(days[days.length - 1]?.label)}
            </span>
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
      className={`page-cta text-[14px] ${
        active ? "text-ink" : "text-muted"
      }`}
    >
      {children}
    </button>
  );
}

