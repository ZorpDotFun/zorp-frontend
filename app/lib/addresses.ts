import { getAddress, type Address } from "viem";

function addr(value: string): Address {
  return getAddress(value);
}

/** Live Zorp deploy on Arc 5042. Verified against factory getters. */
export const LAUNCH_FACTORY = addr(
  import.meta.env.VITE_LAUNCH_FACTORY ||
    "0x04712d21D2883A00bEB387D38B99f7010501baAe",
);
export const LAUNCH_HOOK = addr("0x92DB322cF5d29F7a8CaAc361e42A591C3c622ACC");
export const ZORP_BUYBACK = addr("0xB5E0F4075609db420701DF423d63851Eb5766513");
export const FEE_DISTRIBUTOR = addr("0xffd0cDE2B363B132b5f3F833a0a0D2D33059bF9e");
export const LAUNCH_LOCKER = addr("0x64C2Fe2525a1bAAEa4833595041642E23ADeADf6");
export const COUNCIL = addr("0xF31187E8CF988d3d04e829D55675ec4935159a3E");
export const TIMELOCK = addr("0xc45075D2bA792e2A57Ccbcc31A9FaDdC130F039A");

export const USDC = addr("0x3600000000000000000000000000000000000000");
export const USDC_DECIMALS = 6;
export const TARGET_FDV_USD = 3000;
export const GRADUATION_MC_USD = 40_000;
export const TOTAL_SUPPLY = 1_000_000_000;

export const V4_POOL_MANAGER = addr("0x8366a39CC670B4001A1121B8F6A443A643e40951");
export const V4_POSITION_MANAGER = addr("0x6049c9a0e26405C0985f9E3685C87d0aE917f82B");
export const V4_STATE_VIEW = addr("0xF3334192D15450CdD385c8B70e03f9A6bD9E673b");
export const V4_QUOTER = addr("0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94");
export const V4_UNIVERSAL_ROUTER = addr("0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1");
export const PERMIT2 = addr("0x000000000022D473030F116dDEE9F6B43aC78BA3");
export const MULTICALL3 = addr("0xcA11bde05977b3631167028862bE2a173976CA11");

/** Live RH pad on 4663. Env overrides; fallbacks match `frontend/addresses.md`. */
export const RH_LAUNCH_FACTORY = addr(
  import.meta.env.VITE_RH_LAUNCH_FACTORY || "0xcca8D6BE7619A328f5f61Af924E5575A0A8F98F3",
);
export const RH_LAUNCH_HOOK = addr(
  import.meta.env.VITE_RH_LAUNCH_HOOK || "0x8fE6C922520E6e16340711f95Ac0779fD0aAEA80",
);
export const RH_LAUNCH_LOCKER = addr(
  import.meta.env.VITE_RH_LAUNCH_LOCKER || "0x7eD74076e9d773568605A372768a894B74940139",
);
export const RH_FEE_VAULT = addr(
  import.meta.env.VITE_RH_FEE_VAULT || "0x7105D89966a2CDAd52801Ca8d23ebf072982236E",
);
export const RH_LIQUIDITY_GATE = addr(
  import.meta.env.VITE_RH_LIQUIDITY_GATE || "0x6eA8Ec83D04409bEDa11c4F9D9631E5670BD2929",
);
export const RH_ETH_FILLER = addr(
  import.meta.env.VITE_RH_FILLER || "0xdC814d88B18912bE11cD5Ed38EcB3Bc959397308",
);
export const RH_REVENUE_TREASURY = addr(
  import.meta.env.VITE_RH_REVENUE_TREASURY || "0xf13be4DB32D226d57cdCa9239f382B76bB5F0e6D",
);

/** Earlier RH pads. Create always uses `RH_LAUNCH_FACTORY`; reads still find these. */
export const RH_PREVIOUS_FACTORIES = [
  addr("0x5Dcc32117EA6cB7E18dD81d4cfBda371FC88193B"),
  addr("0x94A7771Fda51AB22efDc82a038EB279bc36B8f66"),
  addr("0x68b211870E0B3bf420cbD550Be0C7caF691435a4"),
  addr("0xF343FFbAb2e1C52ae1323E5D623be643B8D46471"),
  addr("0x6fd3B7F2E0A3314183557629f1921d026F8F6eb3"),
] as const;

export function rhTokenFactories(current: Address = RH_LAUNCH_FACTORY): Address[] {
  const seen = new Set<string>();
  const out: Address[] = [];
  for (const factory of [current, ...RH_PREVIOUS_FACTORIES]) {
    const key = factory.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(factory);
  }
  return out;
}
