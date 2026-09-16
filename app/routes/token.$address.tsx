import { useEffect, useState } from "react";
import { Link } from "react-router";
import { isAddress, type Address } from "viem";
import type { Route } from "./+types/token.$address";
import { TokenArt } from "../components/token-art";
import { SocialIcons } from "../components/social-icons";
import { TokenChart } from "../components/token-chart";
import { GraduationMeter } from "../components/graduation-meter";
import { CreatorFees } from "../components/creator-fees";
import { TokenTrade } from "../components/token-trade";
import { TokenMarket } from "../components/token-market";
import { GRADUATION_MC_USD, TARGET_FDV_USD, TOTAL_SUPPLY } from "../lib/addresses";
import { peekLaunch, readLaunch, readLaunchFees } from "../lib/factory";
import { feeDestinationLine, feeModelLabel, type FeeConfig } from "../lib/fee-models";
import {
  dexscreenerLaunchPairUrl,
  fetchSwapPrints,
  launchEverGraduated,
  launchPoolId,
  readLiveUsdPrice,
} from "../lib/pool-price";
import { MARKET_REFRESH } from "../lib/token-market";
import {
  fetchDexscreenerPoints,
  openingPriceUsd,
  type ChartPoint,
} from "../lib/token-chart-data";
import {
  impliedPeakFdv,
  noteMarketCap,
  shortenAddress,
  type Token,
} from "../lib/tokens";

export function meta({ params }: Route.MetaArgs) {
  return [
    { title: `Token ${params.address.slice(0, 8)} : Zorp` },
    { name: "description", content: "Live Zorp launch on Arc." },
  ];
}

export default function TokenPage({ params }: Route.ComponentProps) {
  const cached = isAddress(params.address) ? peekLaunch(params.address) : undefined;
  const [token, setToken] = useState<Token | null>(cached ?? null);
  const [error, setError] = useState<string | null>(null);
  const [priceUsd, setPriceUsd] = useState(cached?.price ?? openingPriceUsd());
  const [fdv, setFdv] = useState(cached?.fdv && cached.fdv > 0 ? cached.fdv : TARGET_FDV_USD);
  const [points, setPoints] = useState<ChartPoint[]>(
    cached
      ? [{ time: cached.launchedAt / 1000, value: cached.price || openingPriceUsd() }]
      : [],
  );

  useEffect(() => {
    if (!isAddress(params.address)) {
      setError("Not a valid token address.");
      return;
    }

    let cancelled = false;
    let timer = 0;

    async function load(row: Token) {
      const address = row.address as Address;
      const [live, dex, prints] = await Promise.all([
        readLiveUsdPrice(address, row.tokenIsCurrency0),
        fetchDexscreenerPoints(address, launchPoolId(address)),
        fetchSwapPrints(address, row.tokenIsCurrency0),
      ]);
      if (cancelled) return;

      const latest = Math.max(live ?? 0, dex.priceUsd ?? 0, row.price);
      const nextFdv = Math.max(
        latest * TOTAL_SUPPLY,
        dex.fdv && dex.fdv > 0 ? dex.fdv : 0,
      );
      const printPeak =
        prints.reduce((best, point) => Math.max(best, point.value), 0) *
        TOTAL_SUPPLY;
      const implied = impliedPeakFdv(dex.fdv ?? nextFdv, dex.priceChange);
      let graduated =
        nextFdv >= GRADUATION_MC_USD ||
        printPeak >= GRADUATION_MC_USD ||
        implied >= GRADUATION_MC_USD;
      if (!graduated) {
        graduated = await launchEverGraduated(address, row.tokenIsCurrency0);
      }
      if (graduated) noteMarketCap(row.address, GRADUATION_MC_USD);
      else noteMarketCap(row.address, nextFdv, implied);
      const now = Date.now() / 1000;
      const merged = mergePoints([
        { time: row.launchedAt / 1000, value: openingPriceUsd() },
        ...prints,
        latest > 0 ? { time: now, value: latest } : null,
      ]);

      setPriceUsd(latest);
      setFdv(latest > 0 ? nextFdv : dex.fdv && dex.fdv > 0 ? dex.fdv : TARGET_FDV_USD);
      setPoints(merged);
    }

    void readLaunch(params.address as Address)
      .then((row) => {
        if (cancelled) return;
        if (!row) {
          setError("Token is not a Zorp launch.");
          return;
        }
        setToken(row);
        setPoints((current) =>
          current.length > 0
            ? current
            : [{ time: row.launchedAt / 1000, value: openingPriceUsd() }],
        );
        document.title = `${row.name} ($${row.ticker}) : Zorp`;
        return load(row).then(() => {
          timer = window.setInterval(() => {
            void load(row);
          }, 12_000);
        });
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not load token.");
        }
      });

    function onTrade() {
      if (cancelled) return;
      void readLaunch(params.address as Address).then((row) => {
        if (row && !cancelled) void load(row);
      });
    }

    window.addEventListener(MARKET_REFRESH, onTrade);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener(MARKET_REFRESH, onTrade);
    };
  }, [params.address]);

  if (error) {
    return (
      <main className="mx-auto max-w-[1180px] px-4 py-16 sm:px-6">
        <h1 className="font-display text-[32px] tracking-wide text-ink">Token</h1>
        <p className="mt-4 text-[15px] text-muted">{error}</p>
        <Link to="/" className="mt-6 inline-block text-[13px] text-yellowell">
          Back home
        </Link>
      </main>
    );
  }

  if (!token) {
    return (
      <main className="mx-auto max-w-[1180px] px-4 py-16 sm:px-6">
        <p className="text-[13px] text-muted">Loading launch…</p>
      </main>
    );
  }

  const dexUrl = dexscreenerLaunchPairUrl(token.address);
  const hasSocials = Boolean(token.twitter || token.telegram || token.website);

  return (
    <main className="mx-auto max-w-[1180px] space-y-6 px-4 py-8 sm:px-6">
      <CreatorFees token={token.address} creator={token.creator} />
      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">
        <aside className="h-fit rounded-3xl bg-raised p-6 ring-1 ring-line lg:sticky lg:top-24">
          <TokenDetails
            token={token}
            dexUrl={dexUrl}
            hasSocials={hasSocials}
            priceUsd={priceUsd}
          />
        </aside>

        <div className="space-y-6">
          <Link to="/" className="text-[13px] text-muted hover:text-ink">
            ← Explore
          </Link>
          <div className="rounded-3xl bg-raised px-5 py-4 ring-1 ring-line">
            <GraduationMeter mc={fdv} address={token.address} />
          </div>
          <TokenChart
            ticker={token.ticker}
            priceUsd={priceUsd}
            fdv={fdv}
            points={points}
          />
        </div>
      </div>
      <TokenMarket
        token={token.address}
        ticker={token.ticker}
        tokenIsCurrency0={token.tokenIsCurrency0}
        creator={token.creator}
      />
    </main>
  );
}

function TokenDetails({
  token,
  dexUrl,
  hasSocials,
  priceUsd,
}: {
  token: Token;
  dexUrl: string;
  hasSocials: boolean;
  priceUsd: number;
}) {
  return (
    <>
      <div className="flex items-start gap-4">
        <TokenArt
          ticker={token.ticker}
          hue={token.hue}
          image={token.image}
          className="size-16 shrink-0 rounded-2xl"
        />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[26px] tracking-wide text-ink">
            ${token.ticker}
            <span className="text-muted">/{token.pair}</span>
          </h1>
          <p className="truncate text-[14px] text-muted">{token.name}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="truncate font-mono text-[12px] text-muted">
              {shortenAddress(token.address)}
            </span>
            <CopyCaButton address={token.address} />
          </div>
          <p className="mt-1.5 truncate font-mono text-[11px] text-muted">
            Official pool {shortenAddress(launchPoolId(token.address as Address))}
          </p>
        </div>
      </div>
      <TokenFeeChip token={token.address} />

      <div className="mt-5 flex items-end justify-between gap-3">
        {token.description ? (
          <p className="min-w-0 text-[14px] leading-6 text-muted">{token.description}</p>
        ) : (
          <span />
        )}
        <a
          href={dexUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-full bg-white px-2.5 py-0.5 text-[11px] font-medium text-black ring-1 ring-black/10"
        >
          Dex
        </a>
      </div>

      {hasSocials ? (
        <SocialIcons
          twitter={token.twitter}
          telegram={token.telegram}
          website={token.website}
          className="mt-5"
        />
      ) : null}

      <TokenTrade
        token={token.address}
        ticker={token.ticker}
        tokenIsCurrency0={token.tokenIsCurrency0}
        priceUsd={priceUsd}
      />
    </>
  );
}

function CopyCaButton({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      const field = document.createElement("textarea");
      field.value = address;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="shrink-0 rounded-full bg-white px-2.5 py-0.5 text-[11px] font-medium text-black ring-1 ring-black/10"
    >
      {copied ? "Copied" : "Copy CA"}
    </button>
  );
}

function TokenFeeChip({ token }: { token: string }) {
  const [fees, setFees] = useState<FeeConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readLaunchFees(token as Address).then((row) => {
      if (!cancelled) setFees(row);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!fees) return null;
  return (
    <p className="mt-4 text-[13px] leading-5 text-muted">
      <span className="font-medium text-ink">{feeModelLabel(fees)}.</span>{" "}
      {feeDestinationLine(fees)}
    </p>
  );
}

function mergePoints(rows: Array<ChartPoint | null>) {
  const seen = new Map<number, number>();
  for (const row of rows) {
    if (!row || !Number.isFinite(row.value) || row.value <= 0) continue;
    seen.set(Math.round(row.time), row.value);
  }
  return [...seen.entries()]
    .map(([time, value]) => ({ time, value }))
    .sort((a, b) => a.time - b.time);
}
