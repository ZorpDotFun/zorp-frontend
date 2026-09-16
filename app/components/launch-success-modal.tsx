import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { dexscreenerLaunchPairUrl } from "../lib/pool-price";
import { shortenAddress } from "../lib/tokens";

export function LaunchSuccessModal({
  ticker,
  token,
  onClose,
}: {
  ticker: string;
  token: string;
  onClose: () => void;
}) {
  const [ready, setReady] = useState(false);
  const symbol = ticker.trim().toUpperCase() || "TOKEN";
  const dexUrl = dexscreenerLaunchPairUrl(token);

  useEffect(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, ready]);

  if (!ready) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
        aria-label="Close"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="launch-success-title"
        className="relative w-full max-w-[400px] rounded-[28px] bg-raised px-6 py-8 text-center ring-1 ring-line"
      >
        <div className="mx-auto grid size-16 place-items-center rounded-full bg-yellowell text-[28px] font-bold text-black">
          ✓
        </div>
        <h2
          id="launch-success-title"
          className="mt-5 font-display text-[22px] tracking-wide text-ink"
        >
          Token launched
        </h2>
        <p className="mt-2 text-[15px] font-medium text-ink">${symbol} is live</p>
        <p className="mt-1 font-mono text-[13px] text-muted">
          {shortenAddress(token)}
        </p>
        <Link
          to={`/token/${token}`}
          className="mt-6 flex h-11 items-center justify-center rounded-full bg-yellowell text-[14px] font-bold text-black hover:brightness-110"
        >
          View Live Token
        </Link>
        <a
          href={dexUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex h-11 items-center justify-center rounded-full bg-surface text-[14px] font-bold text-ink ring-1 ring-line hover:ring-yellowell"
        >
          Dexscreener
        </a>
      </div>
    </div>,
    document.body,
  );
}
