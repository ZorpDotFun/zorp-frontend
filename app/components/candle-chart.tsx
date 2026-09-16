import { useEffect, useMemo, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { candleFrame, toCandles, type CandleTf } from "../lib/token-chart-data";
import { formatUsdPrice } from "../lib/tokens";
import type { ChartPoint } from "./price-chart";

export function CandleChart({
  points,
  timeframe,
}: {
  points: ChartPoint[];
  timeframe: CandleTf;
}) {
  const host = useRef<HTMLDivElement>(null);
  const frame = candleFrame(timeframe);
  const candles = useMemo(
    () => toCandles(points, frame.bucketSec),
    [points, frame.bucketSec],
  );
  const ready = candles.length >= 2;

  useEffect(() => {
    const el = host.current;
    if (!el || candles.length < 2) return;

    const chart: IChartApi = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8a8a8a",
        fontFamily: "Satoshi, ui-sans-serif, system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.06)" },
        horzLines: { color: "rgba(255,255,255,0.06)" },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        barSpacing: 6,
        minBarSpacing: 3,
        rightOffset: 4,
      },
      crosshair: { mode: CrosshairMode.Magnet },
      handleScroll: true,
      handleScale: true,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#7BEC1E",
      downColor: "#f26d5b",
      borderVisible: false,
      wickUpColor: "#7BEC1E",
      wickDownColor: "#f26d5b",
      priceLineVisible: true,
      priceLineWidth: 1,
      priceLineStyle: LineStyle.Dashed,
      lastValueVisible: true,
      priceFormat: {
        type: "custom",
        minMove: 0.000000000001,
        formatter: (p: number) => formatUsdPrice(p),
      },
    });
    series.setData(
      candles.map((row) => ({
        time: row.time as UTCTimestamp,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
      })),
    );

    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, candles.length - 96),
      to: candles.length + 3,
    });
    return () => {
      chart.remove();
    };
  }, [candles, timeframe]);

  if (!ready) {
    return (
      <div className="grid h-72 place-items-center rounded-2xl bg-surface text-sm text-muted sm:h-[28rem]">
        Not enough ticks yet for this timeframe.
      </div>
    );
  }

  return (
    <div
      ref={host}
      className="relative z-0 h-72 w-full min-w-0 isolate overflow-hidden sm:h-[28rem]"
    />
  );
}
