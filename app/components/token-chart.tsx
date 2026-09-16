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

type Metric = "price" | "mcap" | "candles";

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
      className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${
        active
          ? "bg-yellowell text-black"
          : "border border-line text-muted hover:text-ink"
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
  const [metric, setMetric] = useState<Metric>("price");
  const [range, setRange] = useState<(typeof CHART_WINDOWS)[number]["id"]>("24h");
  const [timeframe, setTimeframe] = useState<CandleTf>("1D");

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

  const seconds = CHART_WINDOWS.find((item) => item.id === range)?.seconds ?? 86_400;
  const windowed = useMemo(
    () => filterWindow(points, seconds),
    [points, seconds],
  );
  const series = useMemo(() => {
    if (metric !== "mcap") return windowed;
    return windowed.map((point) => ({
      ...point,
      value: point.value * TOTAL_SUPPLY,
    }));
  }, [windowed, metric]);

  const last = points[points.length - 1]?.value ?? priceUsd;
  const liveMcap = last > 0 ? last * TOTAL_SUPPLY : fdv;
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
    <section className="min-w-0 overflow-hidden rounded-3xl bg-raised p-3 ring-1 ring-line sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
        <div>
          <p className="text-[13px] text-muted">
            {metric === "mcap" ? `${ticker} market cap` : `${ticker} price`}
          </p>
          <p className="mt-0.5 text-2xl font-semibold tracking-tight sm:text-3xl">
            {metric === "mcap" ? formatUsd(liveMcap) : formatUsdPrice(last)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[13px] text-muted">
            {metric === "mcap" ? `${ticker} price` : "Market cap"}
          </p>
          <p className="mt-0.5 text-2xl font-semibold tracking-tight sm:text-3xl">
            {metric === "mcap" ? formatUsdPrice(last) : formatUsd(liveMcap)}
          </p>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5 px-1">
        <Chip
          active={metric === "price"}
          onClick={() => chooseMetric("price")}
          label="Price"
        />
        <Chip
          active={metric === "mcap"}
          onClick={() => chooseMetric("mcap")}
          label="Market cap"
        />
        <Chip
          active={candlesOn}
          onClick={() => chooseMetric("candles")}
          label="Candles"
        />
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

      {candlesOn ? (
        <CandleChart
          key={timeframe}
          points={points}
          timeframe={timeframe}
        />
      ) : (
        <PriceChart
          key={`${metric}-${range}-${series.length}`}
          points={series}
          unit={metric === "mcap" ? "mcap" : "usd"}
          tone="gold"
          interactive
        />
      )}
    </section>
  );
}
