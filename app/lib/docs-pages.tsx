import type { ReactNode } from "react";
import {
  COUNCIL,
  FEE_DISTRIBUTOR,
  GRADUATION_MC_USD,
  LAUNCH_FACTORY,
  LAUNCH_HOOK,
  LAUNCH_LOCKER,
  TARGET_FDV_USD,
  TIMELOCK,
  TOTAL_SUPPLY,
  USDC,
  V4_POOL_MANAGER,
  V4_QUOTER,
  V4_STATE_VIEW,
  V4_UNIVERSAL_ROUTER,
  ZORP_BUYBACK,
} from "./addresses";
import { ARC_CHAIN_ID, ARC_EXPLORER, ARC_RPC_PRIMARY } from "./chains";
import { explorerAddress } from "./factory";

export const REFERENCE_TOKEN = "0xe44756A4913caa27dE723dA633422D21B632460f";

export function docsBody(slug: string): ReactNode {
  switch (slug) {
    case "overview":
      return <Overview />;
    case "launch-mechanism":
      return <LaunchMechanism />;
    case "trading-and-pricing":
      return <TradingAndPricing />;
    case "graduation":
      return <Graduation />;
    case "fees-and-burns":
      return <FeesAndBurns />;
    case "protocol-revenue":
      return <ProtocolRevenue />;
    case "community-takeovers":
      return <CommunityTakeovers />;
    case "risk-disclosures":
      return <RiskDisclosures />;
    case "network":
      return <Network />;
    case "contracts":
      return <Contracts />;
    case "onchain-events":
      return <OnchainEvents />;
    case "reading-token-state":
      return <ReadingTokenState />;
    case "pricing-and-graduation":
      return <PricingAndGraduation />;
    case "reference-token":
      return <ReferenceToken />;
    case "support":
      return <Support />;
    case "terms-and-attribution":
      return <Terms />;
    default:
      return null;
  }
}

function Overview() {
  return (
    <>
      <p>
        Zorp is a non-custodial token launchpad on Arc. A launch does not use a
        bonding curve. The factory mints 1 billion tokens into a locked Uniswap
        v4 concentrated position, paired with USDC, at a hardcoded{" "}
        ${TARGET_FDV_USD.toLocaleString()} opening FDV. The token is tradable
        from the first block.
      </p>
      <p>
        Fees on trades are always taken in the pair asset (USDC), never in the
        launch token. Graduation at ${GRADUATION_MC_USD.toLocaleString()} market
        cap is a frontend milestone only — the pool does not migrate or unlock.
      </p>
      <h2>What Zorp is not</h2>
      <ul>
        <li>Not a custodial issuer. Zorp never holds user funds.</li>
        <li>Not a bonding-curve pad. There is no virtual curve to graduate out of.</li>
        <li>Not a compliance registry. Pairing assets are an admin allowlist.</li>
      </ul>
    </>
  );
}

function LaunchMechanism() {
  return (
    <>
      <p>
        Anyone calls <Code>LaunchFactory.launchToken</Code> with name, ticker,
        metadata, an optional first buy, and a fee config. The creator must be
        the connected wallet. Pairing is USDC on the live factory.
      </p>
      <h2>On launch</h2>
      <ul>
        <li>1B tokens are minted and seeded into a Uniswap v4 position.</li>
        <li>Fee tier is 0, tick spacing is 60, hook is the Zorp launch hook.</li>
        <li>The LP NFT is locked in <Code>LaunchLocker</Code>.</li>
        <li>
          Opening price is implied by ${TARGET_FDV_USD.toLocaleString()} FDV
          over {TOTAL_SUPPLY.toLocaleString()} supply — about $0.000003 per token
          against 6-decimal USDC.
        </li>
        <li>
          An optional first buy pulls USDC from the creator, swaps through the
          new pool, and takes the 0.5% protocol cut on the amount spent.
        </li>
      </ul>
      <p>
        Factory, hook, locker, distributor, pool manager, and buyback are
        excluded from token tax so seeding and fee routing do not recurse.
      </p>
    </>
  );
}

function TradingAndPricing() {
  return (
    <>
      <p>
        After launch, the pool is a normal Uniswap v4 pool. The site quotes
        through the v4 Quoter and swaps through the Universal Router with
        Permit2. Price is the pool <Code>sqrtPriceX96</Code> from StateView,
        converted to USDC per whole token.
      </p>
      <h2>Anti-snipe window</h2>
      <p>
        Buys in the first seconds pay an extra decaying tax on top of the
        creator buy tax: 99% at t=0, effectively gone by about 3 seconds. The
        factory first buy is treated as internal and skips hook tax.
      </p>
      <h2>What you pay</h2>
      <p>
        Every non-internal swap pays the launch tax (creator-set, up to 10% buy
        / 10% sell) plus a separate 0.5% protocol fee. Both are taken in USDC.
        The hook pulls that USDC from the pool and sends it to{" "}
        <Code>FeeDistributor.accrue</Code>.
      </p>
    </>
  );
}

function Graduation() {
  return (
    <>
      <p>
        Graduation is a display flag at ${GRADUATION_MC_USD.toLocaleString()}{" "}
        market cap. The pool, hook, locker, and fee config do not change when
        that line is crossed. Tokens stay on the same Uniswap v4 pool they
        launched in.
      </p>
      <p>
        Approximate USDC that must flow into a one-sided concentrated pool to
        move FDV from ${TARGET_FDV_USD.toLocaleString()} to $
        {GRADUATION_MC_USD.toLocaleString()} is{" "}
        ${TARGET_FDV_USD.toLocaleString()} × (√(
        {GRADUATION_MC_USD / TARGET_FDV_USD}) − 1) ≈ $7,955 before taxes. The
        site meter uses live spot × 1B supply.
      </p>
    </>
  );
}

function FeesAndBurns() {
  return (
    <>
      <p>
        Launch tax is split 100% across creator, holders (USDC dividends),
        buyback-and-burn, auto-LP, tribute, and an optional protocol share of
        that tax. Presets: Creator backed, Diamond hands, Deflationary, Auto LP,
        Tribute, or Custom.
      </p>
      <ul>
        <li>Creator and tribute amounts sit in <Code>claimable</Code> until claimed.</li>
        <li>Dividends are notified onto the launch token for holders to claim.</li>
        <li>
          Buyback quote is spent through the same pool; tokens received are
          burned when someone calls <Code>distribute</Code>.
        </li>
        <li>Auto LP adds more USDC + token into the locked position.</li>
      </ul>
      <p>
        The 0.5% protocol swap fee is not part of that 100% split. It is always
        taken in USDC and pushed to the protocol treasury.
      </p>
    </>
  );
}

function ProtocolRevenue() {
  return (
    <>
      <p>
        Protocol revenue is the 0.5% USDC fee on every external trade and on
        the factory first buy. <Code>FeeDistributor</Code> transfers that
        amount to <Code>protocolTreasury</Code>, which is{" "}
        <Code>ZorpBuyback</Code> on the live deploy.
      </p>
      <p>
        USDC sits in the buyback contract until an admin sets official $ZORP
        and calls <Code>buybackAndBurn</Code>, or withdraws. $ZORP is not set
        yet. Check the buyback USDC balance on Arc for the current earned
        amount.
      </p>
      <Addr label="Treasury / buyback" value={ZORP_BUYBACK} />
    </>
  );
}

function CommunityTakeovers() {
  return (
    <>
      <p>
        Zorp has no community-takeover auction and no bonding-curve handoff.
        The token is a Uniswap v4 pool from block one. Liquidity is locked;
        graduation does not move it.
      </p>
      <p>
        Creators cannot pull the LP. They can claim their tax share and they
        chose the fee split at launch. Metadata is written once at launch
        through the factory. If a creator walks away, the pool keeps trading.
      </p>
    </>
  );
}

function RiskDisclosures() {
  return (
    <>
      <p>
        Launches are experimental tokens on a new chain. Prices can go to
        zero. The opening FDV is an implied starting mark, not a valuation.
        Taxes, the snipe window, and the protocol fee change what a trader
        receives versus the quoter mid.
      </p>
      <ul>
        <li>Smart contracts can have bugs. Review source before sizing a trade.</li>
        <li>Wallet RPCs on Arc are uneven; a failed quote is not a failed pool.</li>
        <li>Graduation is cosmetic. It does not add liquidity or change risk.</li>
        <li>Zorp does not list, endorse, or custody any launch token.</li>
      </ul>
    </>
  );
}

function Network() {
  return (
    <>
      <p>
        Live Zorp is on Arc public mainnet, chain id {ARC_CHAIN_ID}. Native gas
        is USDC at 18 decimals. The pair asset is the USDC predeploy at 6
        decimals. Those are different contracts in practice — do not mix units.
      </p>
      <ul>
        <li>Chain id: {ARC_CHAIN_ID}</li>
        <li>
          Primary RPC: <Code>{ARC_RPC_PRIMARY}</Code>
        </li>
        <li>
          Explorer:{" "}
          <a href={ARC_EXPLORER} target="_blank" rel="noreferrer">
            {ARC_EXPLORER}
          </a>
        </li>
        <li>
          Pair USDC (6dp): <Code>{USDC}</Code>
        </li>
      </ul>
    </>
  );
}

function Contracts() {
  return (
    <>
      <p>Live Zorp deploy on Arc {ARC_CHAIN_ID}. Factory owner is the 2-of-3 council; hook and buyback owners are the timelock. Telegram and Dexscreener should watch <Code>{LAUNCH_FACTORY}</Code> and read <Code>image()</Code> / <Code>imageUri()</Code> on each launched token.</p>
      <div className="mt-4 overflow-x-auto rounded-2xl ring-1 ring-line">
        <table className="w-full min-w-[520px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-muted">
              <th className="px-4 py-2.5 font-medium">Role</th>
              <th className="px-4 py-2.5 font-medium">Address</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["LaunchFactory", LAUNCH_FACTORY],
              ["LaunchHook", LAUNCH_HOOK],
              ["FeeDistributor", FEE_DISTRIBUTOR],
              ["LaunchLocker", LAUNCH_LOCKER],
              ["ZorpBuyback", ZORP_BUYBACK],
              ["Council", COUNCIL],
              ["Timelock", TIMELOCK],
              ["USDC (6dp)", USDC],
              ["v4 PoolManager", V4_POOL_MANAGER],
              ["v4 StateView", V4_STATE_VIEW],
              ["v4 Quoter", V4_QUOTER],
              ["v4 Universal Router", V4_UNIVERSAL_ROUTER],
            ].map(([role, address]) => (
              <tr key={role} className="border-b border-line/70 last:border-0">
                <td className="px-4 py-2.5 text-ink">{role}</td>
                <td className="px-4 py-2.5">
                  <a
                    href={explorerAddress(address)}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all text-muted hover:text-ink"
                  >
                    {address}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function OnchainEvents() {
  return (
    <>
      <p>Index these to list launches, trades, and fee movement.</p>
      <h2>Factory</h2>
      <ul>
        <li>
          <Code>TokenLaunched(token, creator, pairAsset, supply, openingPrice, firstBuySpent, firstBuyTokens)</Code>
        </li>
        <li>
          <Code>TokenMetadataSet(token, name, symbol, image, description, twitter, telegram, website)</Code>{" "}
          — <Code>image</Code> is an <Code>ipfs://</Code> CID (or a legacy https
          gateway URL on early tokens).
        </li>
      </ul>
      <h2>Distributor</h2>
      <ul>
        <li>
          <Code>Accrued(token, splitQuote, protocolQuote)</Code> — tax split vs protocol USDC.
        </li>
        <li>
          <Code>Claimed(account, asset, amount)</Code>
        </li>
        <li>
          <Code>Distributed(token, boughtBack, autoLpQuote)</Code>
        </li>
      </ul>
      <h2>Pool</h2>
      <p>
        Uniswap v4 <Code>Swap</Code> on PoolManager, filtered by the launch
        pool id. Sender is usually the Universal Router; the trader is{" "}
        <Code>tx.from</Code>.
      </p>
    </>
  );
}

function ReadingTokenState() {
  return (
    <>
      <p>
        Treat an address as a Zorp launch only if{" "}
        <Code>factory.launches(token).exists</Code> is true.
      </p>
      <ul>
        <li>
          <Code>factory.launches(token)</Code> — creator, pair, opening price,
          launch time, tick range, token-is-currency0.
        </li>
        <li>
          <Code>token.getTokenInfo()</Code> — name, symbol, image, socials,
          description.
        </li>
        <li>
          <Code>token.image()</Code> and <Code>token.imageUri()</Code> — same
          string. Prefer <Code>ipfs://&lt;cid&gt;</Code>. Resolve through any
          public IPFS gateway for Telegram / Dexscreener cards.
        </li>
        <li>
          <Code>factory.allTokens(i)</Code> / <Code>launchCount()</Code> — the
          full list.
        </li>
        <li>
          <Code>FeeDistributor.claimable(account, USDC)</Code> — unclaimed
          creator / tribute USDC.
        </li>
        <li>
          <Code>StateView.getSlot0(poolId)</Code> — live sqrt price.
        </li>
      </ul>
      <h2>Telegram and Dexscreener</h2>
      <p>
        Watch factory <Code>{LAUNCH_FACTORY}</Code> for{" "}
        <Code>TokenLaunched</Code> and <Code>TokenMetadataSet</Code>. Read the
        image from <Code>imageUri()</Code> (Argus-style) or <Code>image()</Code>
        — they return the same URI. Do not expect a separate metadata JSON;
        the pointer lives on the ERC-20. Every launch is submitted to Sourcify,
        Arcscan, and A/X Explorer with the same 0.8.26 / viaIR standard JSON.
      </p>
    </>
  );
}

function PricingAndGraduation() {
  return (
    <>
      <p>
        Market cap on the site is live USDC per token × {TOTAL_SUPPLY.toLocaleString()}.
        Do not use Dexscreener as the source of truth for the opening print —
        compute from <Code>sqrtPriceX96</Code>.
      </p>
      <ul>
        <li>
          Opening FDV is ${TARGET_FDV_USD.toLocaleString()}. Graduation mark is $
          {GRADUATION_MC_USD.toLocaleString()}.
        </li>
        <li>
          Token is currency1 vs USDC when <Code>token &gt; USDC</Code>. Invert
          the v4 price in that case.
        </li>
        <li>
          Integer USDC-raw (6dp) per token truncates micro moves. Scale the
          bigint math if you need a chart that actually wiggles.
        </li>
        <li>
          Graduation is <Code>mcap &gt;= {GRADUATION_MC_USD}</Code> in the
          frontend. No contract call.
        </li>
      </ul>
    </>
  );
}

function ReferenceToken() {
  return (
    <>
      <p>
        TEST1 is the first live launch on the factory. Use it to wire quotes,
        swaps, holders, and fee claims.
      </p>
      <Addr label="TEST1" value={REFERENCE_TOKEN} />
      <Addr label="Creator" value="0x91ac26b715185D91aE361fef5ACB24743210EfF7" />
      <ul>
        <li>Ticker TEST1, 18 decimals, USDC pair.</li>
        <li>Token is currency1. Opening raw price is 3 (6dp USDC per token).</li>
        <li>
          Dexscreener:{" "}
          <a
            href={`https://dexscreener.com/arc/${REFERENCE_TOKEN}`}
            target="_blank"
            rel="noreferrer"
          >
            dexscreener.com/arc/TEST1
          </a>
        </li>
      </ul>
    </>
  );
}

function Support() {
  return (
    <>
      <p>
        Product and status updates go through{" "}
        <a href="https://x.com/zorpdotfun" target="_blank" rel="noreferrer">
          @zorpdotfun
        </a>
        . There is no support inbox that can reverse a swap or a launch.
      </p>
      <ul>
        <li>
          App:{" "}
          <a href="https://zorpdotfun.com" target="_blank" rel="noreferrer">
            zorpdotfun.com
          </a>
        </li>
        <li>
          Explorer:{" "}
          <a href={ARC_EXPLORER} target="_blank" rel="noreferrer">
            {ARC_EXPLORER}
          </a>
        </li>
        <li>
          Factory:{" "}
          <a href={explorerAddress(LAUNCH_FACTORY)} target="_blank" rel="noreferrer">
            {LAUNCH_FACTORY}
          </a>
        </li>
      </ul>
    </>
  );
}

function Terms() {
  return (
    <>
      <p>
        These docs describe the live Zorp contracts and site as shipped. They
        are not an offer, not investment advice, and not a guarantee of uptime
        or token value. Use at your own risk.
      </p>
      <p>
        Uniswap v4 addresses on Arc come from the official Uniswap deployments
        feed. USDC on Arc is Circle’s predeploy. Zorp branding (Yellowell,
        wordmark, 3D marks) is Zorp. Do not treat third-party charts or bots as
        protocol documents.
      </p>
    </>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md bg-surface px-1.5 py-0.5 text-[13px] ring-1 ring-line">
      {children}
    </code>
  );
}

function Addr({ label, value }: { label: string; value: string }) {
  return (
    <p className="mt-3">
      <span className="text-muted">{label}: </span>
      <a
        href={explorerAddress(value)}
        target="_blank"
        rel="noreferrer"
        className="break-all text-ink underline decoration-yellowell/50 underline-offset-2 hover:text-yellowell"
      >
        {value}
      </a>
    </p>
  );
}
