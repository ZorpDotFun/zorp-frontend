import { useEffect, useState } from "react";
import { Link } from "react-router";
import { isAddress, type Address } from "viem";
import type { Route } from "./+types/token.$address";
import { ProfileAvatar } from "../components/profile-avatar";
import { TokenArt } from "../components/token-art";
import { SocialIcons } from "../components/social-icons";
import { TokenChart } from "../components/token-chart";
import { CreatorFees } from "../components/creator-fees";
import { TokenTrade } from "../components/token-trade";
import { TokenMarket } from "../components/token-market";
import { TARGET_FDV_USD, TOTAL_SUPPLY } from "../lib/addresses";
import { explorerAddress, peekLaunch, readLaunch, readLaunchFees } from "../lib/factory";
import { applyZorpMarket, isZorpToken, readZorpDexMarket, zorpLaunchToken } from "../lib/zorp-token";
import { feeDestinationLine, feeModelLabel, type FeeConfig } from "../lib/fee-models";
import {
  dexscreenerLaunchPairUrl,
  fetchSwapPrints,
  launchPoolIdForToken,
  preferOfficialUsd,
  readLiveUsdPrice,
} from "../lib/pool-price";
import { MARKET_REFRESH } from "../lib/token-market";
import {
  fetchDexscreenerPoints,
  openingPriceUsd,
  type ChartPoint,
} from "../lib/token-chart-data";
import {
  graduationPct,
  impliedPeakFdv,
  noteMarketCap,
  shortenAddress,
  tokenHasGraduated,
  type Token,
} from "../lib/tokens";
import { useNetwork } from "../lib/use-network";
import { publicError } from "../lib/public-error";
import { requestTokenVerification } from "../lib/verify-launch-token";

export function meta({ params }: Route.MetaArgs) {
  if (isZorpToken(params.address)) {
    return [
      { title: "Zorp Fun ($ZORP) : Zorp" },
      { name: "description", content: "Official $ZORP on Robinhood." },
    ];
  }
  return [
    { title: `Token ${params.address.slice(0, 8)} : Zorp` },
    { name: "description", content: "Live Zorp launch on Robinhood." },
  ];
}

export default function TokenPage({ params }: Route.ComponentProps) {
  const { network } = useNetwork();
  const cached = isAddress(params.address)
    ? peekLaunch(params.address) ?? (isZorpToken(params.address) ? zorpLaunchToken() : undefined)
    : undefined;
  const [token, setToken] = useState<Token | null>(cached ?? null);
  const [error, setError] = useState<string | null>(null);
  const [priceUsd, setPriceUsd] = useState(
    cached?.price && cached.price > 0 ? cached.price : 0,
  );
  const [fdv, setFdv] = useState(
    cached?.fdv && cached.fdv > 0 && cached.fdv !== TARGET_FDV_USD
      ? cached.fdv
      : isZorpToken(params.address)
        ? 0
        : TARGET_FDV_USD,
  );
  const [points, setPoints] = useState<ChartPoint[]>(
    cached
      ? [{ time: cached.launchedAt / 1000, value: cached.price || openingPriceUsd() }]
      : [],
  );

  useEffect(() => {
    if (!isAddress(params.address)) return;
    requestTokenVerification({
      address: params.address,
      chainId: network.chainId,
      wait: false,
    });
  }, [params.address, network.chainId]);

  useEffect(() => {
    if (!isAddress(params.address)) {
      setError("Not a valid token address.");
      return;
    }

    let cancelled = false;
    let timer = 0;

    async function load(row: Token) {
      if (isZorpToken(row.address)) {
        const market = await readZorpDexMarket();
        if (cancelled || !market) return;
        setToken((current) =>
          current ? applyZorpMarket(current, market) : current,
        );
        setPriceUsd(market.priceUsd);
        setFdv(market.fdv);
        setPoints((current) =>
          mergePoints([
            ...current,
            { time: Date.now() / 1000, value: market.priceUsd },
          ]),
        );
        return;
      }
      const address = row.address as Address;
      const poolId = launchPoolIdForToken(row);
      const live = await readLiveUsdPrice(address, row.tokenIsCurrency0, row);
      if (cancelled) return;

      const liveUsd = live && live > 0 ? live : 0;
      if (liveUsd > 0) {
        const nextFdv = liveUsd * TOTAL_SUPPLY;
        noteMarketCap(row.address, nextFdv, nextFdv);
        setPriceUsd(liveUsd);
        setFdv(nextFdv);
        setPoints((current) =>
          mergePoints([
            { time: row.launchedAt / 1000, value: openingPriceUsd() },
            ...current,
            { time: Date.now() / 1000, value: liveUsd },
          ]),
        );
      }

      let dex: Awaited<ReturnType<typeof fetchDexscreenerPoints>> = {
        priceUsd: null,
        fdv: null,
        priceChange: null,
        points: [],
      };
      let prints: Awaited<ReturnType<typeof fetchSwapPrints>> = [];
      try {
        [dex, prints] = await Promise.all([
          fetchDexscreenerPoints(address, poolId),
          fetchSwapPrints(address, row.tokenIsCurrency0, poolId, row.pairAsset),
        ]);
      } catch {
        if (liveUsd > 0) return;
      }
      if (cancelled) return;

      const latest = preferOfficialUsd(live, dex.priceUsd, row.price);
      if (!(latest > 0)) return;
      const nextFdv =
        isZorpToken(row.address) && dex.fdv && dex.fdv > 0
          ? dex.fdv
          : latest * TOTAL_SUPPLY;
      const printPeak =
        prints.reduce((best, point) => Math.max(best, point.value), 0) *
        TOTAL_SUPPLY;
      const implied =
        live && live > 0
          ? nextFdv
          : impliedPeakFdv(dex.fdv ?? nextFdv, dex.priceChange);
      noteMarketCap(row.address, nextFdv, Math.max(implied, printPeak));
      const now = Date.now() / 1000;
      const merged = mergePoints([
        { time: row.launchedAt / 1000, value: openingPriceUsd() },
        ...prints,
        { time: now, value: latest },
      ]);

      setPriceUsd(latest);
      setFdv(nextFdv);
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
        void load(row);
        timer = window.setInterval(() => {
          void load(row);
        }, 12_000);
      })
      .catch((cause) => {
        if (cancelled) return;
        if (isAddress(params.address) && peekLaunch(params.address)) return;
        setError(publicError(cause, "Could not load token."));
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
      <main className="mx-auto max-w-[1280px] px-4 py-16 sm:px-6">
        <h1 className="font-display text-[24px] font-semibold tracking-tight text-ink">Token</h1>
        <p className="mt-4 text-[15px] text-muted">{error}</p>
        <Link to="/" className="mt-6 inline-block text-[13px] text-yellowell">
          Back home
        </Link>
      </main>
    );
  }

  if (!token) {
    return (
      <main className="mx-auto max-w-[1280px] px-4 py-16 sm:px-6">
        <p className="text-[13px] text-muted">Loading launch…</p>
      </main>
    );
  }

  const dexUrl = dexscreenerLaunchPairUrl(
    token.address,
    launchPoolIdForToken(token),
  );
  const hasSocials = Boolean(token.twitter || token.telegram || token.website);
  const filled =
    token.bonded || tokenHasGraduated({ ...token, fdv, mcap: fdv });
  const bondPct = filled ? 100 : graduationPct(fdv);

  return (
    <main className="mx-auto max-w-[1280px] px-4 pb-20 pt-5 sm:px-6 lg:px-8">
      <nav className="flex items-center gap-2 text-[13px] text-muted">
        <Link to="/discover" className="hover:text-ink">
          Coin
        </Link>
        <span className="text-muted/50">›</span>
        <span className="truncate text-ink">{token.name}</span>
      </nav>

      {token.bonded || !token.creator ? null : (
        <div className="mt-6 empty:mt-0 empty:hidden">
          <CreatorFees
            token={token.address}
            creator={token.creator}
            pair={token.pair}
            pairAsset={token.pairAsset}
          />
        </div>
      )}

      <header className="mt-6 flex flex-wrap items-start justify-between gap-4 sm:gap-6">
        <div className="flex min-w-0 items-start gap-3.5">
          <TokenArt
            ticker={token.ticker}
            hue={token.hue}
            image={token.image}
            className="size-[80px] shrink-0 rounded-[14px] ring-1 ring-white/15 sm:size-[88px]"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[20px] font-semibold leading-tight text-ink">
                {token.name}
              </h1>
              <span className="size-1.5 shrink-0 rounded-full bg-yellowell" />
              {token.bonded ? (
                <span className="rounded-md bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-yellowell uppercase">
                  Bonded
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-[13px] font-medium text-muted">
              ${token.ticker}/{token.pair}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
              <span className="font-mono">{shortenAddress(token.address)}</span>
              <CopyCaButton address={token.address} />
              {hasSocials ? (
                <SocialIcons
                  twitter={token.twitter}
                  telegram={token.telegram}
                  website={token.website}
                />
              ) : null}
            </div>
            <BondingStatus pct={bondPct} filled={filled} token={token.address} />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3 pt-1">
          {isAddress(token.creator) ? (
            <a
              href={explorerAddress(token.creator)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-[13px] text-muted hover:text-ink"
            >
              <span>Created by</span>
              <ProfileAvatar address={token.creator} className="size-5" />
              <span className="font-mono text-ink">
                {shortenAddress(token.creator)}
              </span>
            </a>
          ) : null}
          <HeaderMenu address={token.address} dexUrl={dexUrl} />
        </div>
      </header>

      <div className="mt-16 grid items-start gap-x-10 gap-y-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <TokenChart
          ticker={token.ticker}
          priceUsd={priceUsd}
          fdv={fdv}
          points={points}
        />

        <aside className="min-w-0 lg:sticky lg:top-24">
          <div className="rounded-[24px] bg-raised p-4 ring-1 ring-line sm:p-5">
            <TokenTrade
              token={token.address}
              ticker={token.ticker}
              pair={token.pair}
              pairAsset={token.pairAsset}
              poolFee={token.poolFee}
              tokenIsCurrency0={token.tokenIsCurrency0}
              priceUsd={priceUsd}
              details={
                <>
                  <p>Paired with {token.pair} on Uniswap v4.</p>
                  <TokenFeeChip token={token.address} />
                  {token.description ? <p>{token.description}</p> : null}
                  <a
                    href={dexUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-ink hover:text-yellowell"
                  >
                    Open pair on Dexscreener
                  </a>
                </>
              }
            />
          </div>
        </aside>

        <TokenMarket
          token={token.address}
          ticker={token.ticker}
          tokenIsCurrency0={token.tokenIsCurrency0}
          creator={token.creator}
          poolId={token.poolId}
          pairAsset={token.pairAsset}
          pairSymbol={token.pair}
        />
      </div>
    </main>
  );
}

function BondingStatus({
  pct,
  filled,
  token,
}: {
  pct: number;
  filled: boolean;
  token: string;
}) {
  return (
    <div className="mt-3 w-[210px] sm:w-[250px]">
      <div className="flex items-end justify-between text-[12px] text-muted">
        <span>Bonding status</span>
        <span className="font-semibold text-ink">{pct.toFixed(0)}%</span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <div className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-yellowell"
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        </div>
        <ProfileAvatar address={token} className="size-5" />
      </div>
      <div className="mt-2 flex justify-center">
        <span className="rounded-full bg-raised px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">
          {filled ? "Bond is filled" : "Bonding"}
        </span>
      </div>
    </div>
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
      aria-label={copied ? "Copied" : "Copy address"}
      className="grid size-4 place-items-center text-muted hover:text-ink"
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

function HeaderMenu({ address, dexUrl }: { address: string; dexUrl: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Token actions"
        onClick={() => setOpen((value) => !value)}
        className="grid size-8 place-items-center rounded-full text-muted ring-1 ring-line hover:text-ink"
      >
        <span className="-mt-1 text-[18px] leading-none">…</span>
      </button>
      {open ? (
        <div className="absolute top-10 right-0 z-20 w-40 rounded-2xl bg-raised p-1.5 text-[13px] ring-1 ring-line">
          <a
            href={explorerAddress(address)}
            target="_blank"
            rel="noreferrer"
            className="block rounded-xl px-3 py-2 text-ink hover:bg-canvas"
            onClick={() => setOpen(false)}
          >
            Explorer
          </a>
          <a
            href={dexUrl}
            target="_blank"
            rel="noreferrer"
            className="block rounded-xl px-3 py-2 text-ink hover:bg-canvas"
            onClick={() => setOpen(false)}
          >
            Dexscreener
          </a>
        </div>
      ) : null}
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" />
      <path d="M3 10.5V3.5A1.5 1.5 0 0 1 4.5 2H11" stroke="currentColor" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
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
    <p>
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
