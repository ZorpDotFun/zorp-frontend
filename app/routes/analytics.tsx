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

  const volume = stats?.volumeAll ?? 0;
  const launches = range === "24h" ? (stats?.launches24h ?? 0) : (stats?.launchesAll ?? 0);
  const fees = stats?.feesAll ?? 0;
  const claimed = stats?.creatorFeesAll ?? 0;
  const rh = getNetwork().id === "robinhood";
  const factory = protocolOf().factory;
  const treasury = rh ? RH_REVENUE_TREASURY : ZORP_BUYBACK;

  return (
    <PageWash>
    <main className="mx-auto max-w-[1180px] space-y-10 px-4 pb-16 pt-6 sm:px-6">
      <section>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <h1 className="page-title page-title-lg">Analytics</h1>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
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
          <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
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

      <div className="grid gap-5 lg:grid-cols-2">
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
    <div>
      <p className="page-lede text-[14px]">{label}</p>
      <p className="page-title mt-2 text-[34px] sm:text-[40px]">{value}</p>
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
          <h2 className="page-title text-[22px]">{title}</h2>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <p className="page-title text-[22px]">{value}</p>
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
      className={`page-cta text-[14px] ${
        active ? "text-ink" : "text-muted"
      }`}
    >
      {children}
    </button>
  );
}

