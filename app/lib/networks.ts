import { createPublicClient, getAddress, type Address, type Chain } from "viem";
import { getNetworkId, type NetworkId } from "./active-network";
import {
  COUNCIL,
  FEE_DISTRIBUTOR,
  LAUNCH_FACTORY,
  LAUNCH_HOOK,
  LAUNCH_LOCKER,
  PERMIT2,
  TIMELOCK,
  USDC,
  USDC_DECIMALS,
  V4_POOL_MANAGER,
  V4_POSITION_MANAGER,
  V4_QUOTER,
  V4_STATE_VIEW,
  V4_UNIVERSAL_ROUTER,
  ZORP_BUYBACK,
} from "./addresses";
import {
  ARC_CHAIN_ID,
  ARC_EXPLORER,
  ARC_RPCS,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_EXPLORER,
  ROBINHOOD_RPCS,
  arcChain,
  robinhoodChain,
  rpcTransport,
} from "./chains";

export type PairSymbol = "USDC" | "WETH";

export type ProtocolAddresses = {
  factory: Address;
  hook: Address;
  buyback: Address;
  distributor: Address;
  locker: Address;
  council: Address;
  timelock: Address;
  pairAsset: Address;
  pairSymbol: PairSymbol;
  pairDecimals: number;
  pairHint: string;
  v4PoolManager: Address;
  v4PositionManager: Address;
  v4StateView: Address;
  v4Quoter: Address;
  v4UniversalRouter: Address;
  permit2: Address;
  deployed: boolean;
};

export type Network = {
  id: NetworkId;
  chain: Chain;
  chainId: number;
  name: string;
  shortName: string;
  explorer: string;
  dexSlug: string;
  protocol: ProtocolAddresses;
  apiEnabled: boolean;
};

const ZERO = getAddress("0x0000000000000000000000000000000000000000");

function envAddr(value: string | undefined, fallback: Address): Address {
  if (!value) return fallback;
  try {
    return getAddress(value);
  } catch {
    return fallback;
  }
}

function isLive(address: Address) {
  return address.toLowerCase() !== ZERO.toLowerCase();
}

export const RH_WETH = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");

const rhFactory = envAddr(import.meta.env.VITE_RH_LAUNCH_FACTORY, ZERO);

export const NETWORKS: Record<NetworkId, Network> = {
  arc: {
    id: "arc",
    chain: arcChain,
    chainId: ARC_CHAIN_ID,
    name: "Arc",
    shortName: "Arc",
    explorer: ARC_EXPLORER,
    dexSlug: "arc",
    apiEnabled: true,
    protocol: {
      factory: LAUNCH_FACTORY,
      hook: LAUNCH_HOOK,
      buyback: ZORP_BUYBACK,
      distributor: FEE_DISTRIBUTOR,
      locker: LAUNCH_LOCKER,
      council: COUNCIL,
      timelock: TIMELOCK,
      pairAsset: USDC,
      pairSymbol: "USDC",
      pairDecimals: USDC_DECIMALS,
      pairHint: "Arc native pair",
      v4PoolManager: V4_POOL_MANAGER,
      v4PositionManager: V4_POSITION_MANAGER,
      v4StateView: V4_STATE_VIEW,
      v4Quoter: V4_QUOTER,
      v4UniversalRouter: V4_UNIVERSAL_ROUTER,
      permit2: PERMIT2,
      deployed: true,
    },
  },
  robinhood: {
    id: "robinhood",
    chain: robinhoodChain,
    chainId: ROBINHOOD_CHAIN_ID,
    name: "Robinhood Chain",
    shortName: "Robinhood",
    explorer: ROBINHOOD_EXPLORER,
    dexSlug: "robinhoodchain",
    apiEnabled: false,
    protocol: {
      factory: rhFactory,
      hook: envAddr(import.meta.env.VITE_RH_LAUNCH_HOOK, ZERO),
      buyback: envAddr(import.meta.env.VITE_RH_BUYBACK, ZERO),
      distributor: envAddr(import.meta.env.VITE_RH_FEE_DISTRIBUTOR, ZERO),
      locker: envAddr(import.meta.env.VITE_RH_LAUNCH_LOCKER, ZERO),
      council: envAddr(import.meta.env.VITE_RH_COUNCIL, ZERO),
      timelock: envAddr(import.meta.env.VITE_RH_TIMELOCK, ZERO),
      pairAsset: RH_WETH,
      pairSymbol: "WETH",
      pairDecimals: 18,
      pairHint: "Official Uniswap WETH",
      v4PoolManager: getAddress("0x8366a39CC670B4001A1121B8F6A443A643e40951"),
      v4PositionManager: getAddress("0x58daec3116aae6D93017bAAea7749052E8a04fA7"),
      v4StateView: getAddress("0xF3334192D15450CdD385c8B70e03f9A6bD9E673b"),
      v4Quoter: getAddress("0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94"),
      v4UniversalRouter: getAddress("0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99"),
      permit2: PERMIT2,
      deployed: isLive(rhFactory),
    },
  },
};

const clients = {
  arc: createPublicClient({
    chain: arcChain,
    transport: rpcTransport(ARC_RPCS),
  }),
  robinhood: createPublicClient({
    chain: robinhoodChain,
    transport: rpcTransport(ROBINHOOD_RPCS),
  }),
};

export function getNetwork(id: NetworkId = getNetworkId()): Network {
  return NETWORKS[id];
}

type AppClient = (typeof clients)["arc"];

export function getPublicClient(id: NetworkId = getNetworkId()): AppClient {
  return clients[id] as AppClient;
}

export function protocolOf(id: NetworkId = getNetworkId()) {
  return getNetwork(id).protocol;
}
