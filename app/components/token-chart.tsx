import { useEffect, useMemo, useState } from "react";
import { CandleChart } from "./candle-chart";
import { PriceChart } from "./price-chart";
import {
  CANDLE_FRAMES,
  CHART_WINDOWS,
  filterWindow,
  type CandleTf,
  type ChartPoint,
} from "../lib/token-chart-data";
import { TOTAL_SUPPLY } from "../lib/addresses";
import { formatUsd, formatUsdPrice } from "../lib/tokens";

type Metric = "mcap" | "price" | "candles";

const MODE_KEY = "zorp.tokenChart";
const TF_KEY = "zorp.tokenChartTf";
const RANGE_KEY = "zorp.tokenChartRange";

function Chip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-7 px-2 text-[12px] font-semibold ${
        active ? "text-ink" : "text-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

export function TokenChart({
  ticker,
  priceUsd,
  fdv,
  points,
}: {
  ticker: string;
  priceUsd: number;
  fdv: number;
  points: ChartPoint[];
}) {
  const [metric, setMetric] = useState<Metric>("mcap");
  const [range, setRange] = useState<(typeof CHART_WINDOWS)[number]["id"]>("1m");
  const [timeframe, setTimeframe] = useState<CandleTf>("1h");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(MODE_KEY);
      if (stored === "candles" || stored === "mcap" || stored === "price") {
        setMetric(stored);
      }
      const nextRange = localStorage.getItem(RANGE_KEY);
      if (CHART_WINDOWS.some((row) => row.id === nextRange)) {
        setRange(nextRange as (typeof CHART_WINDOWS)[number]["id"]);
      }
      const nextTf = localStorage.getItem(TF_KEY);
      if (CANDLE_FRAMES.some((row) => row.id === nextTf)) {
        setTimeframe(nextTf as CandleTf);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const seconds = CHART_WINDOWS.find((item) => item.id === range)?.seconds ?? 900;
  const windowed = useMemo(
    () => filterWindow(points, seconds),
    [points, seconds],
  );
  const series = useMemo(() => {
    const mapped =
      metric === "mcap"
        ? windowed.map((point) => ({
            ...point,
            value: point.value * TOTAL_SUPPLY,
          }))
        : windowed;
    if (mapped.length !== 1) return mapped;
    const only = mapped[0];
    return [{ time: only.time - 60, value: only.value }, only];
  }, [windowed, metric]);

  const last = points[points.length - 1]?.value ?? priceUsd;
  const liveMcap = fdv > 0 ? fdv : last > 0 ? last * TOTAL_SUPPLY : 0;
  const candlesOn = metric === "candles";

  const chooseMetric = (next: Metric) => {
    setMetric(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* ignore */
    }
  };

  return (
    <section className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[28px] font-semibold tracking-tight text-ink sm:text-[34px]">
            {metric === "price" ? formatUsdPrice(last) : formatUsd(liveMcap)}
          </p>
          <p className="mt-1 text-[13px] font-medium text-muted">
            {metric === "price" ? `${ticker} price` : "Market cap"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-0.5">
          <Chip
            active={metric === "mcap"}
            onClick={() => chooseMetric("mcap")}
            label="Mcap"
          />
          <Chip
            active={metric === "price"}
            onClick={() => chooseMetric("price")}
            label="Price"
          />
          <Chip
            active={candlesOn}
            onClick={() => chooseMetric("candles")}
            label="Candles"
          />
          <span className="mx-1 h-3 w-px bg-line" />
          {candlesOn
            ? CANDLE_FRAMES.map((row) => (
                <Chip
                  key={row.id}
                  label={row.label}
                  active={timeframe === row.id}
                  onClick={() => {
                    setTimeframe(row.id);
                    try {
                      localStorage.setItem(TF_KEY, row.id);
                    } catch {
                      /* ignore */
                    }
                  }}
                />
              ))
            : CHART_WINDOWS.map((row) => (
                <Chip
                  key={row.id}
                  label={row.label}
                  active={range === row.id}
                  onClick={() => {
                    setRange(row.id);
                    try {
                      localStorage.setItem(RANGE_KEY, row.id);
                    } catch {
                      /* ignore */
                    }
                  }}
                />
              ))}
        </div>
      </div>

      <div className="mt-3 min-h-0">
        {candlesOn ? (
          <CandleChart key={timeframe} points={points} timeframe={timeframe} />
        ) : (
          <PriceChart
            key={`${metric}-${range}-${series.length}`}
            points={series}
            unit={metric === "mcap" ? "mcap" : "usd"}
            tone="gold"
            interactive
          />
        )}
      </div>
    </section>
  );
}
