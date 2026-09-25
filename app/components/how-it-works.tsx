import { Link } from "react-router";

const STEPS = [
  {
    n: "01",
    title: "Pick any pair",
    body: "Stocks, memes, ETH, USDG. If it already trades versus ETH or USDG on Uniswap, you can launch against it.",
  },
  {
    n: "02",
    title: "Mint into a lock",
    body: "1,000,000,000 tokens go into a Uniswap v4 pool at a $3,000 FDV. Liquidity stays locked. No transfer tax.",
  },
  {
    n: "03",
    title: "Trade from block one",
    body: "The book is live the second the launch lands. Creators take 0-10% of swap fees. Protocol takes 1%.",
  },
] as const;

export function HowItWorks() {
  return (
    <section className="px-3 sm:px-6">
      <div className="mx-auto max-w-[1180px]">
        <p className="text-[12px] font-semibold tracking-[0.16em] text-yellowell uppercase">
          The idea
        </p>
        <h2 className="mt-2 max-w-[20ch] font-display text-[24px] leading-snug font-semibold text-ink sm:text-[32px]">
          A launchpad that pairs with the real market.
        </h2>
        <p className="mt-4 max-w-xl text-[16px] leading-7 font-medium text-muted">
          Zorp is non-custodial. You keep the keys. The pool is official Uniswap
          v4 on Robinhood. We just mint, lock, and let people trade.
        </p>

        <div className="mt-8 grid gap-3 md:grid-cols-3">
          {STEPS.map((step) => (
            <article
              key={step.n}
              className="rounded-3xl bg-raised p-5 ring-1 ring-line transition duration-300 hover:ring-yellowell/50 sm:p-6"
            >
              <p className="font-display text-[16px] font-semibold text-yellowell">{step.n}</p>
              <h3 className="mt-3 font-display text-[18px] leading-snug font-semibold text-ink">
                {step.title}
              </h3>
              <p className="mt-3 text-[14px] leading-6 font-medium text-muted">
                {step.body}
              </p>
            </article>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/launch"
            className="inline-flex h-11 items-center rounded-full bg-yellowell px-5 text-[14px] font-extrabold text-black transition hover:brightness-110"
          >
            Launch yours
          </Link>
          <Link
            to="/docs"
            className="inline-flex h-11 items-center rounded-full bg-surface px-5 text-[14px] font-extrabold text-ink ring-1 ring-line hover:ring-yellowell"
          >
            Read the docs
          </Link>
        </div>
      </div>
    </section>
  );
}
