const THUMB_W = 40;
const TICKS = [0, 0.25, 0.5, 0.75, 1] as const;

function formatTick(value: number) {
  if (Number.isInteger(value)) return `${value}%`;
  return `${value.toFixed(1)}%`;
}

export function PercentSlider({
  label,
  value,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  step?: number;
  onChange: (value: string) => void;
}) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  const ticks = TICKS.map((tick) => tick * max);
  const activeTick = ticks.reduce((closest, tick) =>
    Math.abs(tick - value) < Math.abs(closest - value) ? tick : closest,
  );

  return (
    <div className="block">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-medium tracking-[0.16em] text-muted uppercase">
          {label}
        </span>
        <span className="text-[12px] font-medium text-ink">
          {formatTick(value)}
        </span>
      </div>

      <div className="relative mt-3 h-8">
        <div className="fee-slider-track absolute inset-x-0 top-1/2 h-2 -translate-y-1/2" />
        <div
          className="fee-slider-thumb pointer-events-none absolute top-1/2 z-10 -translate-y-1/2"
          style={{ left: `calc(${pct / 100} * (100% - ${THUMB_W}px))` }}
        >
          <span />
          <span />
          <span />
        </div>
        <input
          type="range"
          min={0}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          onChange={(event) => onChange(event.target.value)}
          className="absolute inset-0 z-20 cursor-pointer opacity-0"
        />
      </div>

      <div className="mt-1.5 flex justify-between text-[11px]">
        {ticks.map((tick) => (
          <span
            key={tick}
            className={
              tick === activeTick ? "font-medium text-[#F4E08C]" : "text-muted"
            }
          >
            {formatTick(tick)}
          </span>
        ))}
      </div>
    </div>
  );
}
