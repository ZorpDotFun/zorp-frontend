import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  Architecture,
  FeeSplit,
  Lead,
  LiquidityCircuit,
  MarketsHub,
  Rules,
  TradeCircuit,
} from "../components/docs-diagrams";
import { ROBINHOOD_CHAIN_ID, ROBINHOOD_EXPLORER } from "./chains";
import { RH_ETH_FILLER, RH_FEE_VAULT, RH_LIQUIDITY_GATE, RH_ZORP } from "./addresses";
import { NETWORKS, RH_WETH } from "./networks";

const RH_V2_FACTORY = "0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f";
const RH_V3_FACTORY = "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA";
const RH_V4_STATE_VIEW = "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b";
const RH_V3_NPM = "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3";
const RH_V3_QUOTER = "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7";
const RH_SWAP_ROUTER = "0xCaf681a66D020601342297493863E78C959E5cb2";

export function docsBody(slug: string): ReactNode {
  switch (slug) {
    case "overview":
      return <Overview />;
    case "liquidity":
      return <Liquidity />;
    case "trades":
      return <Trades />;
    case "markets":
      return <Markets />;
    case "fees":
      return <Fees />;
    case "risks":
      return <Risks />;
    case "network":
      return <Network />;
    case "contracts":
      return <Contracts />;
    case "events":
      return <Events />;
    case "support":
      return <Support />;
    case "terms":
      return <Terms />;
    default:
      return null;
  }
}

function Overview() {
  return (
    <>
      <Lead>
        Launch coins and pair them with any meme, stock, or custom token at{" "}
        <Link to="/launch" className="font-medium text-ink underline underline-offset-2">
          zorpdotfun.com/launch
        </Link>
        . Launch coins paired with any other token.
      </Lead>
      <Lead>
        No curve. No migrate. The factory opens a locked Uniswap v4 book at
        $3,000 FDV. An optional first buy fills in that same transaction.
      </Lead>
      <Architecture />
      <Rules
        title="Launch rules"
        items={[
          { label: "Supply", value: "1,000,000,000" },
          { label: "Open", value: "$3,000 FDV" },
          { label: "Seed", value: "Token only · no pair deposit" },
          { label: "First buy", value: "Optional · same launch tx" },
          { label: "Venue", value: "Official Uniswap v4" },
        ]}
      />
    </>
  );
}

function Liquidity() {
  return (
    <>
      <Lead>
        A pair is allowed when its official Uniswap book versus ETH, WETH, or
        USDG is real: v2, v3, or v4. After launch the new TOKEN / PAIR pool
        lives on its own.
      </Lead>
      <LiquidityCircuit />
      <Rules
        items={[
          { label: "ETH / WETH / USDG", value: "Always pairable" },
          { label: "Any other token", value: "Uni v2 / v3 / v4 vs ETH · WETH · USDG ≥ $5,000" },
          { label: "Price", value: "Must quote a USD mark" },
          { label: "After launch", value: "Gate is not re-checked" },
        ]}
      />
    </>
  );
}

function Trades() {
  return (
    <>
      <Lead>
        Buys and sells hit the same v4 pool. Pair-side inventory arrives from
        buyers. An optional creator first buy fills in the launch transaction.
      </Lead>
      <TradeCircuit />
    </>
  );
}

function Markets() {
  return (
    <>
      <Lead>
        Zorp does not keep a private book. Every route that can see Uniswap v4
        can see the launch.
      </Lead>
      <MarketsHub />
      <Rules
        items={[
          { label: "Zorp", value: "Quotes and swaps the launch pool" },
          { label: "Uniswap / wallets", value: "Standard v4 · auto-allowlist hook" },
          { label: "Dexscreener", value: "Index the v4 pool, not a clone" },
          { label: "Aggregators", value: "Same pool id · same depth" },
        ]}
      />
    </>
  );
}

function Fees() {
  return (
    <>
      <Lead>
        No token tax. Protocol is a fixed 1% and pays the treasury when fees
        are collected. Creator picks 0-10% and claims on Zorp. Holder mode
        pushes the pair cut to whoever is holding once the pot hits $50.
      </Lead>
      <FeeSplit />
      <Rules
        items={[
          { label: "Protocol", value: "1% · paid to treasury on collect" },
          { label: "Creator", value: "0-10% · Claim on Zorp collects and pays" },
          { label: "Holders", value: "Same 0-10% · pushed to current holders at $50" },
          { label: "Uniswap", value: "Official book · no extra Zorp tax" },
        ]}
      />
    </>
  );
}

function Risks() {
  return (
    <>
      <Lead>Experimental tokens. Price can go to zero. Review the pool before sizing.</Lead>
      <Rules
        items={[
          { label: "Open mark", value: "A starting print, not a valuation" },
          { label: "One-sided book", value: "Early sells have thin pair-side" },
          { label: "Pair book", value: "Can dry up after launch" },
          { label: "Custody", value: "Zorp never holds user funds" },
        ]}
      />
    </>
  );
}

function Network() {
  const factory = NETWORKS.robinhood.protocol.factory;
  const live = NETWORKS.robinhood.protocol.deployed;
  return (
    <>
      <Lead>Robinhood Chain. ETH gas. Official Uniswap v4.</Lead>
      <Rules
        items={[
          { label: "Chain", value: String(ROBINHOOD_CHAIN_ID) },
          { label: "RPC", value: "Zorp · Robinhood" },
          { label: "Explorer", value: ROBINHOOD_EXPLORER },
          {
            label: "Factory",
            value: live ? factory : "Pending deploy",
          },
        ]}
      />
    </>
  );
}

function Contracts() {
  const factory = NETWORKS.robinhood.protocol.factory;
  const locker = NETWORKS.robinhood.protocol.locker;
  const hook = NETWORKS.robinhood.protocol.hook;
  const live = NETWORKS.robinhood.protocol.deployed;
  const rows: [string, string, boolean][] = [
    ["ZORP", RH_ZORP, true],
    ["RhLaunchFactory", live ? factory : "-", live],
    [
      "RhLocker",
      live && locker !== "0x0000000000000000000000000000000000000000"
        ? locker
        : "-",
      live && locker !== "0x0000000000000000000000000000000000000000",
    ],
    ["RhHook", live ? hook : "-", live],
    ["RhFeeVault", live ? RH_FEE_VAULT : "-", live],
    ["LiquidityGate", live ? RH_LIQUIDITY_GATE : "-", live],
    ["RhEthFiller", live ? RH_ETH_FILLER : "-", live],
    ["ETH", "Native (address zero)", true],
    ["WETH", RH_WETH, true],
    ["v4 PoolManager", "0x8366a39CC670B4001A1121B8F6A443A643e40951", true],
    ["v4 PositionManager", "0x58daec3116aae6D93017bAAea7749052E8a04fA7", true],
    ["v2 Factory (pair gate)", RH_V2_FACTORY, true],
    ["v3 Factory (pair gate)", RH_V3_FACTORY, true],
    ["v4 StateView (pair gate)", RH_V4_STATE_VIEW, true],
    ["Universal Router", "0x8876789976dEcBfCbBbe364623C63652db8C0904", true],
  ];
  return (
    <>
      <Lead>
        Official Uniswap addresses plus the live Zorp factory on 4663.
      </Lead>
      <div className="mt-5 overflow-x-auto rounded-3xl bg-raised ring-1 ring-line">
        <table className="w-full min-w-[520px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-muted">
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Address</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([role, address, linked]) => (
              <tr key={role} className="border-b border-line/70 last:border-0">
                <td className="px-4 py-3 text-ink">{role}</td>
                <td className="px-4 py-3">
                  {linked && address.startsWith("0x") ? (
                    <a
                      href={`${ROBINHOOD_EXPLORER}/address/${address}`}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all text-muted hover:text-ink"
                    >
                      {address}
                    </a>
                  ) : (
                    <span className="text-muted">{address}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Events() {
  return (
    <>
      <Lead>Index the factory. Route volume from the v4 pool.</Lead>
      <Rules
        items={[
          { label: "Factory", value: "TokenLaunched · firstBuySpent · firstBuyTokens" },
          { label: "Locker", value: "Locked(token, poolId)" },
          { label: "Token", value: "metadata · PoolBound" },
          { label: "Pool", value: "Uniswap v4 Swap on the launch pair" },
        ]}
      />
    </>
  );
}

function Support() {
  return (
    <>
      <Lead>Status on X. No desk can reverse a swap.</Lead>
      <Rules
        items={[
          {
            label: "App",
            value: (
              <a href="https://zorpdotfun.com" target="_blank" rel="noreferrer">
                zorpdotfun.com
              </a>
            ),
          },
          {
            label: "ZORP CA",
            value: (
              <a
                href={`${ROBINHOOD_EXPLORER}/address/${RH_ZORP}`}
                target="_blank"
                rel="noreferrer"
              >
                {RH_ZORP}
              </a>
            ),
          },
          {
            label: "X",
            value: (
              <a href="https://x.com/zorpdotfun" target="_blank" rel="noreferrer">
                @zorpdotfun
              </a>
            ),
          },
          {
            label: "Explorer",
            value: (
              <a href={ROBINHOOD_EXPLORER} target="_blank" rel="noreferrer">
                robinhoodchain.blockscout.com
              </a>
            ),
          },
          {
            label: "Source",
            value: (
              <a
                href="https://github.com/ZorpDotFun"
                target="_blank"
                rel="noreferrer"
              >
                github.com/ZorpDotFun
              </a>
            ),
          },
        ]}
      />
    </>
  );
}

function Terms() {
  return (
    <>
      <Lead>
        Not an offer. Not advice. Uniswap addresses come from the official
        deployments feed. Yellowell and the marks are Zorp.
      </Lead>
    </>
  );
}
