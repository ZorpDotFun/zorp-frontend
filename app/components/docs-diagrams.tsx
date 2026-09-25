import type { ReactNode } from "react";

export function Board({
  children,
  caption,
}: {
  children: ReactNode;
  caption?: string;
}) {
  return (
    <figure className="docs-board my-5 overflow-hidden rounded-3xl bg-raised ring-1 ring-line">
      <div className="relative px-4 py-6 sm:px-6 sm:py-8">{children}</div>
      {caption ? (
        <figcaption className="border-t border-line px-5 py-3 text-[12px] leading-5 text-muted">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

export function Lead({ children }: { children: ReactNode }) {
  return (
    <p className="page-lede max-w-[42rem]">{children}</p>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="page-lede mb-3 text-[12px] tracking-[0.16em] uppercase">
      {children}
    </p>
  );
}

type Step = {
  kicker: string;
  title: string;
  hint: string;
  accent?: boolean;
};

export function Flow({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-0">
      {steps.map((step, index) => (
        <li key={step.title} className="flex min-w-0 flex-1 sm:items-stretch">
          <div
            className={`flex min-h-[132px] flex-1 flex-col rounded-2xl px-4 py-4 ring-1 ${
              step.accent
                ? "bg-yellowell/12 ring-yellowell/40"
                : "bg-canvas/60 ring-line"
            }`}
          >
            <span className="page-lede text-[11px] tracking-wider text-yellowell">
              {step.kicker}
            </span>
            <span className="page-title mt-2 text-[16px] leading-snug">
              {step.title}
            </span>
            <span className="page-lede mt-1.5 text-[13px]">
              {step.hint}
            </span>
          </div>
          {index < steps.length - 1 ? <FlowJoin /> : null}
        </li>
      ))}
    </ol>
  );
}

function FlowJoin() {
  return (
    <div
      className="flex items-center justify-center py-1 text-yellowell sm:w-9 sm:shrink-0 sm:py-0"
      aria-hidden
    >
      <svg className="hidden size-5 sm:block" viewBox="0 0 24 24" fill="none">
        <path
          d="M5 12h12M13 6l6 6-6 6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <svg className="size-5 sm:hidden" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 5v12M6 13l6 6 6-6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

const LAUNCH_STEPS: Step[] = [
  {
    kicker: "01",
    title: "Pair",
    hint: "Any ERC-20 with a live Uniswap book versus ETH, WETH, or USDG.",
  },
  {
    kicker: "02",
    title: "Gate",
    hint: "WETH and USDG always pass. Any other pair needs a ≥ $5k quote.",
  },
  {
    kicker: "03",
    title: "Factory",
    hint: "Mints 1,000,000,000 into a locked Uniswap v4 range. Optional first buy in the same transaction.",
    accent: true,
  },
  {
    kicker: "04",
    title: "Locker",
    hint: "The v4 position stays locked. Same pool everywhere.",
  },
  {
    kicker: "Pool",
    title: "Uniswap v4",
    hint: "1B token-only seed · $3,000 FDV open · no pair deposit.",
    accent: true,
  },
];

export function Architecture() {
  return (
    <Board caption="One factory call. One locked Uniswap v4 book. Same pool everywhere.">
      <SectionLabel>Workflow</SectionLabel>
      <ol className="flex flex-col gap-2">
        {LAUNCH_STEPS.map((step) => (
          <li
            key={step.title}
            className={`rounded-2xl px-4 py-4 ring-1 ${
              step.accent
                ? "bg-yellowell/12 ring-yellowell/40"
                : "bg-canvas/60 ring-line"
            }`}
          >
            <p className="page-lede text-[11px] tracking-wider text-yellowell">
              {step.kicker}
            </p>
            <p className="page-title mt-1 text-[18px]">{step.title}</p>
            <p className="page-lede mt-1.5 text-[14px]">{step.hint}</p>
          </li>
        ))}
      </ol>
    </Board>
  );
}

export function LiquidityCircuit() {
  return (
    <Board caption="Gate reads existing PAIR books versus ETH, WETH, or USDG. New book starts token-only.">
      <SectionLabel>How liquidity moves</SectionLabel>
      <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:items-center">
        <PoolCard
          label="Existing book"
          left="PAIR"
          right="ETH"
          fill="both"
          note="Official Uni v2 · v3 · v4 vs ETH · WETH · USDG"
        />
        <Join label="Gate" />
        <PoolCard
          label="Allowed pair"
          left="WETH"
          right="USDG / PAIR"
          fill="quote"
          note="≥ $5k quote · priced in USD"
          accent
        />
        <Join label="Launch" />
        <PoolCard
          label="New book"
          left="TOKEN"
          right="PAIR"
          fill="token"
          note="1B in · $3k FDV · no pair deposit"
        />
      </div>
    </Board>
  );
}

function Join({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-1 text-yellowell">
      <span className="page-title text-[10px] tracking-wider uppercase">
        {label}
      </span>
      <svg className="hidden size-6 lg:block" viewBox="0 0 24 24" fill="none">
        <path
          d="M4 12h14M14 6l6 6-6 6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <svg className="size-6 lg:hidden" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 4v14M6 14l6 6 6-6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function PoolCard({
  label,
  left,
  right,
  fill,
  note,
  accent,
}: {
  label: string;
  left: string;
  right: string;
  fill: "both" | "quote" | "token";
  note: string;
  accent?: boolean;
}) {
  const leftFill = fill === "both" || fill === "token";
  const rightFill = fill === "both" || fill === "quote";
  return (
    <div
      className={`rounded-2xl px-4 py-4 ring-1 ${
        accent ? "bg-yellowell/10 ring-yellowell/40" : "bg-canvas/50 ring-line"
      }`}
    >
      <p className="text-[11px] font-medium tracking-[0.14em] text-muted uppercase">
        {label}
      </p>
      <div className="mt-3 flex items-end gap-3">
        <Stack label={left} filled={leftFill} />
        <span className="mb-6 text-[11px] text-muted">/</span>
        <Stack label={right} filled={rightFill} muted />
      </div>
      <p className="mt-3 text-[12px] leading-5 text-muted">{note}</p>
    </div>
  );
}

function Stack({
  label,
  filled,
  muted,
}: {
  label: string;
  filled: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex-1">
      <div className="flex h-16 items-end gap-1">
        {[0.45, 0.7, 1, 0.55].map((h, i) => (
          <div
            key={i}
            className={`w-full rounded-sm ${
              filled
                ? muted
                  ? "bg-yellowell/45"
                  : "bg-yellowell"
                : "bg-line"
            }`}
            style={{ height: `${h * 100}%` }}
          />
        ))}
      </div>
      <p className="mt-2 page-title text-[12px] tracking-wide text-ink">
        {label}
      </p>
    </div>
  );
}

export function TradeCircuit() {
  return (
    <Board caption="Tax hits only when the transfer touches the pool. Wallet to wallet is 0%.">
      <SectionLabel>Token trades</SectionLabel>
      <div className="grid gap-3 lg:grid-cols-2">
        <TradeCard
          kicker="Buy"
          title="Pair enters the book"
          hint="TOKEN leaves the pool. Pair-side inventory is what later sells draw from."
          from="PAIR"
          to="TOKEN"
          accent
        />
        <TradeCard
          kicker="Sell"
          title="Token enters the book"
          hint="PAIR leaves. Works after buys have already filled the pair side."
          from="TOKEN"
          to="PAIR"
        />
      </div>
      <p className="page-lede mt-4 text-[13px]">
        Same route on both sides — trader, router, then the official v4 pool.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-2 border-t border-line pt-4">
        <p className="page-lede text-[13px]">
          <span className="page-title mr-2 text-[15px] text-ink">1%</span>
          Protocol
        </p>
        <p className="page-lede text-[13px]">
          <span className="page-title mr-2 text-[15px] text-ink">0–10%</span>
          Creator
        </p>
        <p className="page-lede text-[13px]">
          <span className="page-title mr-2 text-[15px] text-ink">0%</span>
          Wallet ↔ wallet
        </p>
      </div>
    </Board>
  );
}

function TradeCard({
  kicker,
  title,
  hint,
  from,
  to,
  accent,
}: {
  kicker: string;
  title: string;
  hint: string;
  from: string;
  to: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex flex-col rounded-2xl px-4 py-4 ring-1 sm:px-5 sm:py-5 ${
        accent ? "bg-yellowell/12 ring-yellowell/45" : "bg-canvas/55 ring-line"
      }`}
    >
      <p className="page-lede text-[11px] tracking-[0.16em] uppercase text-yellowell">
        {kicker}
      </p>
      <div className="mt-5 flex items-center gap-2 sm:gap-3">
        <TradeAsset label={from} solid />
        <svg
          className="size-5 shrink-0 text-yellowell sm:size-6"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
        >
          <path
            d="M4 12h14M14 6l6 6-6 6"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <TradeAsset label={to} />
      </div>
      <p className="page-title mt-5 text-[18px] leading-snug">{title}</p>
      <p className="page-lede mt-1.5 text-[13px]">{hint}</p>
    </div>
  );
}

function TradeAsset({ label, solid }: { label: string; solid?: boolean }) {
  return (
    <span
      className={`inline-flex h-10 min-w-[4.5rem] items-center justify-center rounded-full px-3.5 page-title text-[13px] tracking-wide ${
        solid
          ? "bg-yellowell text-black"
          : "bg-raised text-ink ring-1 ring-line"
      }`}
    >
      {label}
    </span>
  );
}

export function MarketsHub() {
  return (
    <Board caption="One official v4 pool. Charts and routers that read Uniswap v4 see the same book.">
      <SectionLabel>Aggregating markets</SectionLabel>
      <svg
        className="mx-auto hidden h-auto w-full max-w-[640px] sm:block"
        viewBox="0 0 640 340"
        role="img"
        aria-label="Markets around the launch pool"
      >
        <defs>
          <marker
            id="m-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0 0l10 5-10 5z" fill="#7BEC1E" />
          </marker>
        </defs>
        <circle
          cx="320"
          cy="170"
          r="118"
          fill="none"
          className="stroke-yellowell/25"
          strokeDasharray="4 6"
        />
        <line
          x1="320"
          y1="118"
          x2="320"
          y2="52"
          stroke="#7BEC1E"
          strokeWidth="1.4"
          markerEnd="url(#m-arrow)"
        />
        <line
          x1="372"
          y1="196"
          x2="500"
          y2="250"
          stroke="#7BEC1E"
          strokeWidth="1.4"
          markerEnd="url(#m-arrow)"
        />
        <line
          x1="268"
          y1="196"
          x2="140"
          y2="250"
          stroke="#7BEC1E"
          strokeWidth="1.4"
          markerEnd="url(#m-arrow)"
        />
        <line
          x1="250"
          y1="150"
          x2="120"
          y2="80"
          stroke="#7BEC1E"
          strokeWidth="1.4"
          markerEnd="url(#m-arrow)"
        />
        <line
          x1="390"
          y1="150"
          x2="520"
          y2="80"
          stroke="#7BEC1E"
          strokeWidth="1.4"
          markerEnd="url(#m-arrow)"
        />

        <rect
          x="236"
          y="128"
          width="168"
          height="84"
          rx="20"
          className="fill-yellowell/15 stroke-yellowell/60"
          strokeWidth={1}
        />
        <text
          x="320"
          y="158"
          textAnchor="middle"
          className="fill-yellowell"
          fontFamily="Instrument Sans, Helvetica Neue, Arial, sans-serif"
          fontSize="11"
        >
          Official book
        </text>
        <text
          x="320"
          y="186"
          textAnchor="middle"
          className="fill-ink"
          fontFamily="Instrument Sans, Helvetica Neue, Arial, sans-serif"
          fontSize="18"
        >
          TOKEN / PAIR
        </text>
        <text
          x="320"
          y="206"
          textAnchor="middle"
          className="fill-muted"
          fontFamily="Instrument Sans, Helvetica Neue, Arial, sans-serif"
          fontSize="11"
        >
          Uniswap v4
        </text>

        <HubLabel x={272} y={18} w={96} title="Zorp" />
        <HubLabel x={78} y={48} w={120} title="Uniswap" />
        <HubLabel x={442} y={48} w={130} title="Dexscreener" />
        <HubLabel x={36} y={248} w={140} title="Aggregators" />
        <HubLabel x={464} y={248} w={140} title="Wallets" />
      </svg>
      <div className="grid grid-cols-2 gap-2 sm:hidden">
        {["Zorp", "Uniswap", "Dexscreener", "Aggregators", "Wallets"].map(
          (name) => (
            <div
              key={name}
              className="rounded-2xl bg-canvas/50 px-3 py-3 text-center ring-1 ring-line"
            >
              <p className="page-title text-[13px] text-ink">{name}</p>
              <p className="mt-1 text-[11px] text-muted">same v4 pool</p>
            </div>
          ),
        )}
      </div>
    </Board>
  );
}

function HubLabel({
  x,
  y,
  w,
  title,
}: {
  x: number;
  y: number;
  w: number;
  title: string;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height="36"
        rx="18"
        className="fill-canvas/90 stroke-line"
        strokeWidth={1}
      />
      <text
        x={x + w / 2}
        y={y + 23}
        textAnchor="middle"
        className="fill-ink"
        fontFamily="Instrument Sans, Helvetica Neue, Arial, sans-serif"
        fontSize="12"
      >
        {title}
      </text>
    </g>
  );
}

export function FeeSplit() {
  return (
    <Board caption="Pool fee, paid in the pair. Transfers between wallets stay clean.">
      <SectionLabel>Collect, then split</SectionLabel>
      <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,0.92fr)_56px_minmax(0,1.15fr)]">
        <FeeCard
          kicker="Swap"
          title="Fee stays in the pool"
          hint="Charged in the pair on every buy and sell. Nothing is taken from wallet-to-wallet transfers."
          value="Pair"
        />
        <FeeFork />
        <div className="grid gap-3">
          <FeeCard
            kicker="Protocol"
            title="Treasury"
            hint="Fixed share. Paid out when fees are collected. Cannot change."
            value="1%"
            accent
          />
          <FeeCard
            kicker="Creator"
            title="You or holders"
            hint="Set at launch and frozen. Claim on Zorp, or push to holders at $50."
            value="0–10%"
          />
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-2 border-t border-line pt-4">
        <p className="page-lede text-[13px]">
          <span className="page-title mr-2 text-[15px] text-ink">0%</span>
          Wallet ↔ wallet
        </p>
        <p className="page-lede text-[13px]">
          <span className="page-title mr-2 text-[15px] text-ink">0%</span>
          Extra Uniswap tax
        </p>
      </div>
    </Board>
  );
}

function FeeCard({
  kicker,
  title,
  hint,
  value,
  accent,
}: {
  kicker: string;
  title: string;
  hint: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex h-full flex-col rounded-2xl px-4 py-4 ring-1 sm:px-5 sm:py-5 ${
        accent
          ? "bg-yellowell/12 ring-yellowell/45"
          : "bg-canvas/55 ring-line"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="page-lede text-[11px] tracking-[0.16em] uppercase text-yellowell">
          {kicker}
        </p>
        <p className="page-title shrink-0 text-[18px] leading-none text-ink sm:text-[22px]">
          {value}
        </p>
      </div>
      <p className="page-title mt-4 text-[18px] leading-snug">{title}</p>
      <p className="page-lede mt-1.5 text-[13px]">{hint}</p>
    </div>
  );
}

function FeeFork() {
  return (
    <div className="flex items-center justify-center text-yellowell" aria-hidden>
      <svg
        className="hidden h-full min-h-[12rem] w-14 lg:block"
        viewBox="0 0 56 200"
        fill="none"
      >
        <path
          d="M8 100 H28 M28 100 V36 H48 M28 100 V164 H48"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path
          d="M40 30 l8 6 -8 6"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M40 158 l8 6 -8 6"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <svg className="h-10 w-10 lg:hidden" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 4 v12 M6 12 l6 6 6-6"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export function Rules({
  items,
  title,
}: {
  items: { label: string; value: ReactNode }[];
  title?: string;
}) {
  return (
    <div className="mt-8">
      {title ? <SectionLabel>{title}</SectionLabel> : null}
      <dl className="flex flex-col gap-2">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex flex-col gap-1 rounded-2xl bg-raised px-4 py-3 ring-1 ring-line sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
          >
            <dt className="page-lede text-[12px] tracking-[0.14em] uppercase">
              {item.label}
            </dt>
            <dd className="page-title text-[16px] sm:text-right">{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
