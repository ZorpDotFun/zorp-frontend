import { useState, type MouseEvent } from "react";
import { Link } from "react-router";
import { RH_ZORP } from "../lib/addresses";
import { explorerAddress } from "../lib/factory";
import { shortenAddress } from "../lib/tokens";

export function ZorpCa({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(RH_ZORP);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className={`inline-flex min-w-0 items-center gap-2 text-[13px] text-muted ${className}`}
    >
      <span className="shrink-0 font-medium text-ink">$ZORP</span>
      <Link
        to={`/token/${RH_ZORP}`}
        className="min-w-0 truncate font-mono text-[12px] hover:text-ink"
      >
        {compact ? shortenAddress(RH_ZORP) : RH_ZORP}
      </Link>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 font-medium text-muted transition hover:text-yellowell"
        aria-label="Copy ZORP contract address"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <a
        href={explorerAddress(RH_ZORP)}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 font-medium text-muted transition hover:text-ink"
      >
        Explorer
      </a>
    </div>
  );
}
