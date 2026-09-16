import { GRADUATION_MC_USD } from "../lib/addresses";
import { formatUsd, graduationPct, isGraduated } from "../lib/tokens";

export function GraduationMeter({
  mc,
  address,
  className = "",
}: {
  mc: number;
  address?: string;
  className?: string;
}) {
  const pct = graduationPct(mc);
  const done = isGraduated(mc, address);

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3 text-[12px]">
        <p className={done ? "font-medium text-yellowell" : "text-ink"}>
          {done
            ? "Graduated"
            : `${pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}% to graduation`}
        </p>
        <p className="text-muted">{formatUsd(GRADUATION_MC_USD)} MC</p>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-yellowell"
          style={{ width: `${Math.max(done ? 100 : pct, 1.5)}%` }}
        />
      </div>
    </div>
  );
}
