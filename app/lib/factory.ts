import {
  createWalletClient,
  custom,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  isAddress,
  parseEventLogs,
  parseUnits,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { rhTokenFactories, TARGET_FDV_USD } from "./addresses";
import { ARC_RPC_PRIMARY, ROBINHOOD_PUBLIC_RPC } from "./chains";
import { PROTOCOL_SWAP_FEE_BPS, presetFees, validateFees, type FeeConfig } from "./fee-models";
import { getNetworkId } from "./active-network";
import { getNetwork, getPublicClient, protocolOf } from "./networks";
import { toIpfsUri } from "./token-image";
import type { Token } from "./tokens";
import { verifyLaunchToken } from "./verify-launch-token";
import { ETH, RH_USDG, isNativeEth, knownPairSymbol } from "./quote-tokens";

export { getPublicClient };
export const publicClient = new Proxy({} as ReturnType<typeof getPublicClient>, {
  get(_target, prop, _receiver) {
    const client = getPublicClient() as unknown as Record<PropertyKey, unknown>;
    const value = client[prop];
    return typeof value === "function" ? (value as Function).bind(client) : value;
  },
});

const launchCache = new Map<string, Token>();

export function peekLaunch(address: string): Token | undefined {
  return launchCache.get(address.toLowerCase());
}

export function rememberLaunch(token: Token) {
  launchCache.set(token.address.toLowerCase(), token);
}

export const LAUNCH_LIST_EVENT = "zorp:launch-list";

export function launchListKey() {
  return `zorp-launch-list-v3-${getNetworkId()}`;
}

export function readLaunchListCache(): Token[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(launchListKey());
    const rows = raw ? (JSON.parse(raw) as Token[]) : [];
    for (const row of rows) rememberLaunch(row);
    return rows;
  } catch {
    return [];
  }
}

export function writeLaunchListCache(tokens: Token[]) {
  if (typeof window === "undefined") return;
  const raw = JSON.stringify(tokens);
  try {
    window.localStorage.setItem(launchListKey(), raw);
  } catch {
    /* quota / private */
  }
  try {
    window.sessionStorage.setItem(launchListKey(), raw);
  } catch {
    /* private mode */
  }
}

export function publishLaunch(token: Token) {
  rememberLaunch(token);
  if (typeof window === "undefined") return;
  const key = token.address.toLowerCase();
  const next = [
    token,
    ...readLaunchListCache().filter((row) => row.address.toLowerCase() !== key),
  ].sort((a, b) => b.launchedAt - a.launchedAt);
  writeLaunchListCache(next);
  window.dispatchEvent(new CustomEvent(LAUNCH_LIST_EVENT, { detail: token }));
}

export const launchFactoryAbi = [
  {
    type: "function",
    name: "wired",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "launchEnabled",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "usdQuote",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "pairUsdPrice6",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approvedPairAssets",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "hook",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "buyback",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "distributor",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "locker",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "poolManager",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "launchCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allTokens",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "launches",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      { name: "token", type: "address" },
      { name: "creator", type: "address" },
      { name: "pairAsset", type: "address" },
      { name: "tributeRecipient", type: "address" },
      { name: "supply", type: "uint256" },
      { name: "openingPrice", type: "uint256" },
      { name: "launchedAt", type: "uint256" },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "tokenIsCurrency0", type: "bool" },
      { name: "exists", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "launchToken",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          {
            name: "metadata",
            type: "tuple",
            components: [
              { name: "image", type: "string" },
              { name: "description", type: "string" },
              { name: "twitter", type: "string" },
              { name: "telegram", type: "string" },
              { name: "website", type: "string" },
            ],
          },
          { name: "creator", type: "address" },
          { name: "tributeRecipient", type: "address" },
          { name: "salt", type: "bytes32" },
          {
            name: "config",
            type: "tuple",
            components: [
              { name: "pairAsset", type: "address" },
              {
                name: "fees",
                type: "tuple",
                components: [
                  { name: "buyTaxBps", type: "uint16" },
                  { name: "sellTaxBps", type: "uint16" },
                  { name: "creatorBps", type: "uint16" },
                  { name: "dividendBps", type: "uint16" },
                  { name: "buybackBps", type: "uint16" },
                  { name: "autoLpBps", type: "uint16" },
                  { name: "tributeBps", type: "uint16" },
                  { name: "protocolBps", type: "uint16" },
                ],
              },
              { name: "firstBuyCap", type: "uint256" },
            ],
          },
        ],
      },
    ],
    outputs: [
      { name: "token", type: "address" },
      { name: "firstBuyTokens", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "TokenMetadataSet",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "symbol", type: "string", indexed: false },
      { name: "image", type: "string", indexed: false },
      { name: "description", type: "string", indexed: false },
      { name: "twitter", type: "string", indexed: false },
      { name: "telegram", type: "string", indexed: false },
      { name: "website", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TokenLaunched",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "pairAsset", type: "address", indexed: true },
      { name: "supply", type: "uint256", indexed: false },
      { name: "openingPrice", type: "uint256", indexed: false },
      { name: "firstBuySpent", type: "uint256", indexed: false },
      { name: "firstBuyTokens", type: "uint256", indexed: false },
    ],
  },
] as const;

export const rhLaunchFactoryAbi = [
  {
    type: "function",
    name: "launchEnabled",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "locker",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "hook",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "poolManager",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "weth",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "protocolFeeBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    type: "function",
    name: "launchCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allTokens",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "ethForFirstBuy",
    stateMutability: "view",
    inputs: [
      { name: "pairAsset", type: "address" },
      { name: "cap", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "pairable",
    stateMutability: "view",
    inputs: [{ name: "pairAsset", type: "address" }],
    outputs: [
      { name: "ok", type: "bool" },
      { name: "usd6", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "ethUsd6",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "gate",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "vault",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "collectFees",
    stateMutability: "nonpayable",
    inputs: [{ name: "token", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "launches",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      { name: "token", type: "address" },
      { name: "creator", type: "address" },
      { name: "pairAsset", type: "address" },
      { name: "poolId", type: "bytes32" },
      { name: "fee", type: "uint24" },
      { name: "creatorFeeBps", type: "uint16" },
      { name: "feeTo", type: "uint8" },
      { name: "launchedAt", type: "uint256" },
      { name: "exists", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "launch",
    stateMutability: "payable",
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "image", type: "string" },
          { name: "description", type: "string" },
          { name: "twitter", type: "string" },
          { name: "telegram", type: "string" },
          { name: "website", type: "string" },
          { name: "pairAsset", type: "address" },
          { name: "creatorFeeBps", type: "uint16" },
          { name: "feeTo", type: "uint8" },
          { name: "salt", type: "bytes32" },
          { name: "firstBuyCap", type: "uint256" },
        ],
      },
    ],
    outputs: [
      { name: "token", type: "address" },
      { name: "poolId", type: "bytes32" },
    ],
  },
  {
    type: "event",
    name: "TokenLaunched",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "pairAsset", type: "address", indexed: true },
      { name: "poolId", type: "bytes32", indexed: false },
      { name: "fee", type: "uint24", indexed: false },
      { name: "creatorFeeBps", type: "uint16", indexed: false },
      { name: "feeTo", type: "uint8", indexed: false },
      { name: "firstBuySpent", type: "uint256", indexed: false },
      { name: "firstBuyTokens", type: "uint256", indexed: false },
    ],
  },
] as const;

const rhTokenAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "image", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "description", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "twitter", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "telegram", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "website", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "creator", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "pairAsset", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
] as const;

export const buybackAbi = [
  {
    type: "function",
    name: "protocolFeeBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
] as const;

export const launchTokenAbi = [
  {
    type: "function",
    name: "getTokenInfo",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "tokenCreator", type: "address" },
      { name: "tokenName", type: "string" },
      { name: "tokenSymbol", type: "string" },
      { name: "tokenImage", type: "string" },
      { name: "tokenDescription", type: "string" },
      { name: "tokenTwitter", type: "string" },
      { name: "tokenTelegram", type: "string" },
      { name: "tokenWebsite", type: "string" },
    ],
  },
  {
    type: "function",
    name: "image",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "imageUri",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

export const creatorBackedFees = presetFees("creator");

export type LaunchResult = {
  token: Address;
  hash: Hex;
  poolId?: Hex;
};

function sameAddress(left: Address, right: Address) {
  return left.toLowerCase() === right.toLowerCase();
}

function isRh() {
  return getNetwork().id === "robinhood";
}

type RhPad = {
  factory: Address;
  vault: Address;
  locker: Address;
  launch: readonly [
    Address,
    Address,
    Address,
    Hex,
    number,
    number,
    number,
    bigint,
    boolean,
  ];
};

const rhPadCache = new Map<string, RhPad>();

export async function loadRhPad(token: Address, factory: Address): Promise<RhPad | null> {
  try {
    const launch = await publicClient.readContract({
      address: factory,
      abi: rhLaunchFactoryAbi,
      functionName: "launches",
      args: [token],
    });
    if (!launch[8]) return null;
    const protocol = protocolOf();
    const current = sameAddress(factory, protocol.factory);
    const [vault, locker] = await Promise.all([
      current
        ? Promise.resolve(protocol.vault)
        : publicClient
            .readContract({
              address: factory,
              abi: rhLaunchFactoryAbi,
              functionName: "vault",
            })
            .catch(() => protocol.vault),
      current
        ? Promise.resolve(protocol.locker)
        : publicClient
            .readContract({
              address: factory,
              abi: rhLaunchFactoryAbi,
              functionName: "locker",
            })
            .catch(() => protocol.locker),
    ]);
    const pad = { factory, vault, locker, launch };
    rhPadCache.set(token.toLowerCase(), pad);
    return pad;
  } catch {
    return null;
  }
}

export async function resolveRhLaunchFactory(token: Address) {
  const cached = rhPadCache.get(token.toLowerCase());
  if (cached) return cached;
  const protocol = protocolOf();
  for (const factory of rhTokenFactories(protocol.factory)) {
    const pad = await loadRhPad(token, factory);
    if (pad) return pad;
  }
  return null;
}

export async function readProtocolFeeBps() {
  const protocol = protocolOf();
  if (!protocol.deployed) return isRh() ? 100 : PROTOCOL_SWAP_FEE_BPS;
  try {
    if (isRh()) {
      return Number(
        await publicClient.readContract({
          address: protocol.factory,
          abi: rhLaunchFactoryAbi,
          functionName: "protocolFeeBps",
        }),
      );
    }
    return Number(
      await publicClient.readContract({
        address: protocol.buyback,
        abi: buybackAbi,
        functionName: "protocolFeeBps",
      }),
    );
  } catch {
    return isRh() ? 100 : PROTOCOL_SWAP_FEE_BPS;
  }
}

export async function readPairable(pairAsset: Address): Promise<{ ok: boolean; usd6: bigint }> {
  const protocol = protocolOf();
  if (!protocol.deployed) return { ok: false, usd6: 0n };
  const [ok, usd6] = await publicClient.readContract({
    address: protocol.factory,
    abi: rhLaunchFactoryAbi,
    functionName: "pairable",
    args: [pairAsset],
  });
  return { ok, usd6 };
}

export type PairTokenInfo = {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
};

const rhGateUsdAbi = [
  {
    type: "function",
    name: "pairUsd6",
    stateMutability: "view",
    inputs: [
      { name: "pairAsset", type: "address" },
      { name: "ethUsdMark", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

async function readPairUsd6(pair: Address) {
  const protocol = protocolOf();
  const ethUsd6 = await publicClient.readContract({
    address: protocol.factory,
    abi: rhLaunchFactoryAbi,
    functionName: "ethUsd6",
  });
  if (sameAddress(pair, RH_USDG)) return { ethUsd6, pairUsd6: 1_000_000n };
  if (isNativeEth(pair) || sameAddress(pair, protocol.pairAsset)) {
    return { ethUsd6, pairUsd6: ethUsd6 };
  }
  const gate = await publicClient.readContract({
    address: protocol.factory,
    abi: rhLaunchFactoryAbi,
    functionName: "gate",
  });
  const pairUsd6 = await publicClient.readContract({
    address: gate,
    abi: rhGateUsdAbi,
    functionName: "pairUsd6",
    args: [pair, ethUsd6],
  });
  return { ethUsd6, pairUsd6 };
}

/** How much ETH `pairAmount` is worth at the live mark. */
export async function ethFromPair(
  pair: Address,
  pairAmount: bigint,
  decimals: number,
) {
  if (pairAmount === 0n) return 0n;
  if (isNativeEth(pair) || sameAddress(pair, protocolOf().pairAsset)) return pairAmount;
  const { ethUsd6, pairUsd6 } = await readPairUsd6(pair);
  if (ethUsd6 === 0n || pairUsd6 === 0n) {
    throw new Error("Could not price this pair in ETH.");
  }
  let scaled = pairAmount;
  if (decimals < 18) scaled *= 10n ** BigInt(18 - decimals);
  if (decimals > 18) scaled /= 10n ** BigInt(decimals - 18);
  const eth = (scaled * pairUsd6) / ethUsd6;
  if (eth === 0n) throw new Error("Pair amount is too small to price in ETH.");
  return eth;
}

/** How much pair `ethWei` buys at the live mark. */
export async function pairCapFromEth(
  pair: Address,
  ethWei: bigint,
  decimals: number,
) {
  if (ethWei === 0n) return 0n;
  if (isNativeEth(pair) || sameAddress(pair, protocolOf().pairAsset)) return ethWei;
  const { ethUsd6, pairUsd6 } = await readPairUsd6(pair);
  if (ethUsd6 === 0n || pairUsd6 === 0n) {
    throw new Error("Could not price this pair in ETH.");
  }
  let cap = (ethWei * ethUsd6) / pairUsd6;
  if (decimals < 18) cap /= 10n ** BigInt(18 - decimals);
  if (decimals > 18) cap *= 10n ** BigInt(decimals - 18);
  if (cap === 0n) throw new Error("ETH amount is too small to buy this pair.");
  return cap;
}

export async function previewEthFirstBuy(
  pair: Address,
  ethAmount: string,
  pairDecimals: number,
  pairSymbol: string,
) {
  try {
    const ethWei = parseUnits(ethAmount || "0", 18);
    if (ethWei === 0n) return null;
    const cap = await pairCapFromEth(pair, ethWei, pairDecimals);
    const pairAmt = Number(formatUnits(cap, pairDecimals));
    const qty = pairAmt.toLocaleString("en-US", {
      maximumFractionDigits: pairAmt >= 100 ? 2 : 4,
    });
    return `${ethAmount} ETH → ~${qty} ${pairSymbol} → your token`;
  } catch {
    return null;
  }
}

export async function readPairToken(pairAsset: Address): Promise<PairTokenInfo> {
  if (isNativeEth(pairAsset)) {
    return {
      address: pairAsset,
      name: ETH.name,
      symbol: ETH.symbol,
      decimals: 18,
    };
  }
  const [name, symbol, decimals] = await Promise.all([
    publicClient.readContract({ address: pairAsset, abi: erc20Abi, functionName: "name" }),
    publicClient.readContract({ address: pairAsset, abi: erc20Abi, functionName: "symbol" }),
    publicClient.readContract({ address: pairAsset, abi: erc20Abi, functionName: "decimals" }),
  ]);
  return {
    address: pairAsset,
    name: name.trim() || "Token",
    symbol: symbol.trim() || shortenPair(pairAsset),
    decimals: Number(decimals),
  };
}

function shortenPair(address: Address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export async function assertLaunchReady() {
  const protocol = protocolOf();
  if (!protocol.deployed) {
    throw new Error(
      `Zorp is not live on ${getNetwork().name} yet. Set VITE_RH_LAUNCH_FACTORY, VITE_RH_LAUNCH_HOOK, and VITE_RH_LAUNCH_LOCKER.`,
    );
  }
  if (isRh()) {
    const [enabled, locker, hook, poolManager] = await Promise.all([
      publicClient.readContract({
        address: protocol.factory,
        abi: rhLaunchFactoryAbi,
        functionName: "launchEnabled",
      }),
      publicClient.readContract({
        address: protocol.factory,
        abi: rhLaunchFactoryAbi,
        functionName: "locker",
      }),
      publicClient.readContract({
        address: protocol.factory,
        abi: rhLaunchFactoryAbi,
        functionName: "hook",
      }),
      publicClient.readContract({
        address: protocol.factory,
        abi: rhLaunchFactoryAbi,
        functionName: "poolManager",
      }),
    ]);
    if (!enabled) throw new Error("Launches are disabled.");
    if (locker === "0x0000000000000000000000000000000000000000") {
      throw new Error("Factory is not wired.");
    }
    if (!sameAddress(locker, protocol.locker)) throw new Error("Factory locker address mismatch.");
    if (!sameAddress(hook, protocol.hook)) throw new Error("Factory hook address mismatch.");
    if (!sameAddress(poolManager, protocol.v4PoolManager)) {
      throw new Error("Factory PoolManager address mismatch.");
    }
    return;
  }
  const [wired, enabled, quote, pairOk, hook, buyback, distributor, locker, poolManager] =
    await Promise.all([
      publicClient.readContract({
        address: protocol.factory,
        abi: launchFactoryAbi,
        functionName: "wired",
      }),
      publicClient.readContract({
        address: protocol.factory,
        abi: launchFactoryAbi,
        functionName: "launchEnabled",
      }),
      publicClient.readContract({
        address: protocol.factory,
        abi: launchFactoryAbi,
        functionName: "usdQuote",
      }),
      publicClient.readContract({
        address: protocol.factory,
        abi: launchFactoryAbi,
        functionName: "approvedPairAssets",
        args: [protocol.pairAsset],
      }),
      publicClient.readContract({
        address: protocol.factory,
        abi: launchFactoryAbi,
        functionName: "hook",
      }),
      publicClient.readContract({
        address: protocol.factory,
        abi: launchFactoryAbi,
        functionName: "buyback",
      }),
      publicClient.readContract({
        address: protocol.factory,
        abi: launchFactoryAbi,
        functionName: "distributor",
      }),
      publicClient.readContract({
        address: protocol.factory,
        abi: launchFactoryAbi,
        functionName: "locker",
      }),
      publicClient.readContract({
        address: protocol.factory,
        abi: launchFactoryAbi,
        functionName: "poolManager",
      }),
    ]);

  if (!wired) throw new Error("Factory is not wired.");
  if (!enabled) throw new Error("Launches are disabled.");
  if (!pairOk) throw new Error(`${protocol.pairSymbol} is not an approved pair.`);
  if (protocol.pairSymbol === "USDC" && !sameAddress(quote, protocol.pairAsset)) {
    throw new Error("Factory usdQuote is not USDC.");
  }
  if (!sameAddress(hook, protocol.hook)) throw new Error("Factory hook address mismatch.");
  if (!sameAddress(buyback, protocol.buyback)) throw new Error("Factory buyback address mismatch.");
  if (!sameAddress(distributor, protocol.distributor)) {
    throw new Error("Factory distributor address mismatch.");
  }
  if (!sameAddress(locker, protocol.locker)) throw new Error("Factory locker address mismatch.");
  if (!sameAddress(poolManager, protocol.v4PoolManager)) {
    throw new Error("Factory PoolManager address mismatch.");
  }
}

function revertText(error: unknown) {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  const walk = (value: unknown) => {
    if (value == null || seen.has(value)) return;
    if (typeof value === "string") {
      parts.push(value);
      return;
    }
    if (typeof value !== "object") return;
    seen.add(value);
    const row = value as Record<string, unknown>;
    for (const key of ["shortMessage", "message", "details", "data", "raw"]) {
      const item = row[key];
      if (typeof item === "string") parts.push(item);
    }
    walk(row.cause);
    if (Array.isArray(row.errors)) {
      for (const item of row.errors) walk(item);
    }
  };
  walk(error);
  return parts.join(" ");
}

export function asError(error: unknown) {
  const text = revertText(error) || (error instanceof Error ? error.message : "");
  if (/rate limit|exceeds defined limit/i.test(text)) {
    return `${getNetwork().name} RPC is rate limited. Wait a few seconds and try again.`;
  }
  if (/arc-scan|could not complete this request|No answer was obtained|Failed to fetch|eth_getTransactionCount|eth_gasPrice/i.test(text)) {
    const network = getNetwork();
    const rpc = network.id === "arc" ? ARC_RPC_PRIMARY : ROBINHOOD_PUBLIC_RPC;
    return `Wallet RPC did not respond. In Rabby or MetaMask, edit ${network.name} and set RPC URL to ${rpc}.`;
  }
  if (/PairRejected|0xacc9d39b/i.test(text)) {
    return "This pair needs at least $5,000 of Uniswap liquidity versus ETH, WETH, or USDG (v2, v3, or v4).";
  }
  if (/FillFailed|0x91e5cb7e/i.test(text)) {
    return "ETH could not buy that pair in the same transaction. Pay with the pair token, or try a smaller first buy.";
  }
  if (/underflow or overflow|0x4e487b71|0x11\b/i.test(text)) {
    return "This pair’s live price is too extreme for the current factory math. Try again after the next factory deploy, or pair against ETH / WETH / USDG.";
  }
  if (/user rejected|denied transaction|rejected the request/i.test(text)) {
    return "Signature was cancelled. Confirm the wallet popup, or switch the connected wallet to MetaMask.";
  }
  if (/0xf4d678b8|InsufficientBalance/i.test(text)) {
    return "Collect cannot swap token-side pool fees. The live vault never moves those tokens to the locker first. Pair-only collects (like 1234/DELTA) still work.";
  }
  if (/0x969bf728|NothingToClaim/i.test(text)) {
    return "Nothing is booked to claim yet. Collect the pool first, then claim.";
  }
  if (/https?:\/\/|quiknode|Request body:|Raw Call Arguments|Contract Call:/i.test(text)) {
    return "Transaction failed. Try again.";
  }
  return text || "Transaction failed.";
}

export async function writePrepared({
  wallet,
  address,
  abi,
  functionName,
  args,
  value,
  gasFallback = 250_000n,
}: {
  wallet: ConnectedWallet;
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  gasFallback?: bigint;
}): Promise<Hex> {
  const network = getNetwork();
  await wallet.switchChain(network.chainId);
  const provider = await wallet.getEthereumProvider();
  const account = wallet.address as Address;
  const walletClient = createWalletClient({
    account,
    chain: network.chain,
    transport: custom(provider),
  });

  const data = encodeFunctionData({
    abi,
    functionName,
    args: args as never,
  });

  const [nonce, rpcGasPrice] = await Promise.all([
    publicClient.getTransactionCount({ address: account }),
    publicClient.getGasPrice(),
  ]);

  let gas: bigint | undefined;
  try {
    const estimated = await publicClient.estimateGas({
      account,
      to: address,
      data,
      value,
    });
    gas = (estimated * 12n) / 10n;
  } catch (error) {
    if (network.id === "robinhood") throw new Error(asError(error));
    gas = gasFallback;
  }

  // RH base fee is ~0.05 gwei. Pin it. Rabby otherwise prices 2–5M gas at 1 gwei ($7–$12)
  // while the chain only charges cents.
  if (network.id === "robinhood") {
    const maxFeePerGas = rpcGasPrice > 200_000_000n ? 200_000_000n : rpcGasPrice;
    return walletClient.sendTransaction({
      account,
      chain: network.chain,
      to: address,
      data,
      value,
      nonce,
      ...(gas != null ? { gas } : {}),
      maxFeePerGas,
      maxPriorityFeePerGas: 1n,
      type: "eip1559",
    });
  }

  return walletClient.sendTransaction({
    account,
    chain: network.chain,
    to: address,
    data,
    value,
    nonce,
    ...(gas != null ? { gas } : {}),
    gasPrice: rpcGasPrice,
    type: "legacy",
  });
}

export function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function hueFromAddress(address: string) {
  return Number.parseInt(address.slice(2, 8), 16) % 360;
}

export function formatTwitter(raw: string) {
  const value = raw.trim();
  if (!value) return "";
  const stripped = value.replace(/^https?:\/\//i, "").replace(/^@/, "");
  if (stripped.startsWith("x.com/") || stripped.startsWith("twitter.com/")) {
    return stripped.slice(0, 256);
  }
  return `x.com/${stripped}`.slice(0, 256);
}

export function formatTelegram(raw: string) {
  const value = raw.trim();
  if (!value) return "";
  const stripped = value.replace(/^https?:\/\//i, "").replace(/^@/, "");
  if (stripped.startsWith("t.me/")) return stripped.slice(0, 256);
  return `t.me/${stripped}`.slice(0, 256);
}

function toToken(
  address: Address,
  info: readonly [
    Address,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ],
  launchedAt: bigint,
  pairAsset: Address,
  tokenIsCurrency0: boolean,
): Token {
  return {
    id: address,
    name: info[1],
    ticker: info[2],
    address,
    image: info[3],
    description: info[4],
    twitter: info[5],
    telegram: info[6],
    website: info[7],
    creator: info[0],
    mcap: TARGET_FDV_USD,
    fdv: TARGET_FDV_USD,
    ath: TARGET_FDV_USD,
    volume: 0,
    price: TARGET_FDV_USD / 1_000_000_000,
    change24h: 0,
    launchedAt: Number(launchedAt) * 1000,
    pair: protocolOf().pairSymbol,
    pairAsset,
    hue: hueFromAddress(address),
    recentBuys: 0,
    tokenIsCurrency0,
  };
}

export async function pairLabel(pairAsset: Address): Promise<string> {
  const known = knownPairSymbol(pairAsset);
  if (known) return known;
  const protocol = protocolOf();
  if (sameAddress(pairAsset, protocol.pairAsset)) return protocol.pairSymbol;
  try {
    const symbol = await publicClient.readContract({
      address: pairAsset,
      abi: erc20Abi,
      functionName: "symbol",
    });
    if (symbol.trim()) return symbol.trim().slice(0, 12);
  } catch {
    /* fall through */
  }
  return `${pairAsset.slice(0, 6)}…${pairAsset.slice(-4)}`;
}

const RH_META = [
  "name",
  "symbol",
  "image",
  "description",
  "twitter",
  "telegram",
  "website",
  "creator",
] as const;

async function readRhTokenMeta(address: Address) {
  try {
    const rows = await publicClient.multicall({
      allowFailure: false,
      contracts: RH_META.map((functionName) => ({
        address,
        abi: rhTokenAbi,
        functionName,
      })),
    });
    return rows as [string, string, string, string, string, string, string, Address];
  } catch {
    const rows = await Promise.all(
      RH_META.map((functionName) =>
        publicClient.readContract({
          address,
          abi: rhTokenAbi,
          functionName,
        }),
      ),
    );
    return rows as [string, string, string, string, string, string, string, Address];
  }
}

function tokenFromRhPad(
  address: Address,
  pad: RhPad,
  meta: readonly [string, string, string, string, string, string, string, Address],
  pairName: string,
) {
  const launch = pad.launch;
  const pairAsset = launch[2];
  const token = toToken(
    address,
    [meta[7], meta[0], meta[1], meta[2], meta[3], meta[4], meta[5], meta[6]],
    launch[7],
    pairAsset,
    address.toLowerCase() < pairAsset.toLowerCase(),
  );
  token.pair = pairName;
  token.pairAsset = pairAsset;
  token.poolId = launch[3];
  token.poolFee = Number(launch[4]);
  rememberLaunch(token);
  return token;
}

async function readRhLaunch(address: Address): Promise<Token | null> {
  const resolved = await resolveRhLaunchFactory(address);
  if (!resolved) return null;
  const pairAsset = resolved.launch[2];
  const [meta, pairName] = await Promise.all([
    readRhTokenMeta(address),
    pairLabel(pairAsset),
  ]);
  return tokenFromRhPad(address, resolved, meta, pairName);
}

export async function readLaunch(address: Address): Promise<Token | null> {
  if (isRh()) return readRhLaunch(address);
  const factory = protocolOf().factory;
  const [info, launch] = await Promise.all([
    publicClient.readContract({
      address,
      abi: launchTokenAbi,
      functionName: "getTokenInfo",
    }),
    publicClient.readContract({
      address: factory,
      abi: launchFactoryAbi,
      functionName: "launches",
      args: [address],
    }),
  ]);
  if (!launch[10]) return null;
  const image = info[3].trim() || (await readOnchainImage(address));
  const token = toToken(
    address,
    [info[0], info[1], info[2], image, info[4], info[5], info[6], info[7]],
    launch[6],
    launch[2],
    launch[9],
  );
  rememberLaunch(token);
  return token;
}

async function readOnchainImage(address: Address): Promise<string> {
  for (const functionName of ["image", "imageUri"] as const) {
    try {
      const image = await publicClient.readContract({
        address,
        abi: launchTokenAbi,
        functionName,
      });
      if (image.trim()) return image.trim();
    } catch {
      /* try the next getter — live tokens only have `image` */
    }
  }
  return "";
}

function factoryCountAbi() {
  return isRh() ? rhLaunchFactoryAbi : launchFactoryAbi;
}

export async function readLaunchCount(): Promise<number> {
  const protocol = protocolOf();
  if (!protocol.deployed) return 0;
  if (isRh()) {
    const counts = await Promise.all(
      rhTokenFactories(protocol.factory).map(async (factory) => {
        try {
          return Number(
            await publicClient.readContract({
              address: factory,
              abi: rhLaunchFactoryAbi,
              functionName: "launchCount",
            }),
          );
        } catch {
          return 0;
        }
      }),
    );
    return counts.reduce((sum, n) => sum + n, 0);
  }
  const count = await publicClient.readContract({
    address: protocol.factory,
    abi: factoryCountAbi(),
    functionName: "launchCount",
  });
  return Number(count);
}

export async function readRhFactoryTokens(factory: Address): Promise<Address[]> {
  try {
    const count = await publicClient.readContract({
      address: factory,
      abi: rhLaunchFactoryAbi,
      functionName: "launchCount",
    });
    const n = Number(count);
    if (!Number.isFinite(n) || n <= 0) return [];
    const indexes = Array.from({ length: Math.min(n, 64) }, (_, i) => BigInt(i));
    try {
      const rows = await publicClient.multicall({
        allowFailure: false,
        contracts: indexes.map((index) => ({
          address: factory,
          abi: rhLaunchFactoryAbi,
          functionName: "allTokens" as const,
          args: [index],
        })),
      });
      return rows as Address[];
    } catch {
      return Promise.all(
        indexes.map((index) =>
          publicClient.readContract({
            address: factory,
            abi: rhLaunchFactoryAbi,
            functionName: "allTokens",
            args: [index],
          }),
        ),
      );
    }
  } catch {
    return [];
  }
}

export async function readCurrentRhLaunches(): Promise<Token[]> {
  const protocol = protocolOf();
  if (!protocol.deployed || !isRh()) return [];
  return readRhLaunches([protocol.factory]);
}

async function loadRhPads(factory: Address, tokens: Address[]) {
  if (tokens.length === 0) return;
  try {
    const launches = await publicClient.multicall({
      allowFailure: true,
      contracts: tokens.map((token) => ({
        address: factory,
        abi: rhLaunchFactoryAbi,
        functionName: "launches" as const,
        args: [token],
      })),
    });
    const protocol = protocolOf();
    const current = sameAddress(factory, protocol.factory);
    const [vault, locker] = await Promise.all([
      current
        ? Promise.resolve(protocol.vault)
        : publicClient
            .readContract({
              address: factory,
              abi: rhLaunchFactoryAbi,
              functionName: "vault",
            })
            .catch(() => protocol.vault),
      current
        ? Promise.resolve(protocol.locker)
        : publicClient
            .readContract({
              address: factory,
              abi: rhLaunchFactoryAbi,
              functionName: "locker",
            })
            .catch(() => protocol.locker),
    ]);
    tokens.forEach((token, index) => {
      const row = launches[index];
      if (row.status !== "success" || !row.result[8]) return;
      rhPadCache.set(token.toLowerCase(), {
        factory,
        vault,
        locker,
        launch: row.result,
      });
    });
  } catch {
    await Promise.all(tokens.map((token) => loadRhPad(token, factory)));
  }
}

async function pairLabelsFor(assets: Address[]) {
  const unique = [...new Set(assets.map((asset) => asset.toLowerCase()))];
  const rows = await Promise.all(
    unique.map(async (key) => {
      const asset = assets.find((row) => row.toLowerCase() === key);
      return [key, asset ? await pairLabel(asset) : key.slice(0, 8)] as const;
    }),
  );
  return new Map(rows);
}

async function readRhLaunchRows(addresses: Address[]): Promise<Token[]> {
  if (addresses.length === 0) return [];
  await Promise.all(addresses.map((address) => resolveRhLaunchFactory(address)));

  let metas: { status: "success" | "failure"; result?: unknown }[];
  try {
    metas = await publicClient.multicall({
      allowFailure: true,
      contracts: addresses.flatMap((address) =>
        RH_META.map((functionName) => ({
          address,
          abi: rhTokenAbi,
          functionName,
        })),
      ),
    });
  } catch {
    const rows = await Promise.all(
      addresses.map(async (address) => {
        try {
          return await readRhLaunch(address);
        } catch {
          return null;
        }
      }),
    );
    return rows.filter((row): row is Token => row !== null);
  }

  const pairAssets = addresses
    .map((address) => rhPadCache.get(address.toLowerCase())?.launch[2])
    .filter((asset): asset is Address => Boolean(asset));
  const labels = await pairLabelsFor(pairAssets);

  const rows = await Promise.all(
    addresses.map(async (address, index) => {
      const pad = rhPadCache.get(address.toLowerCase());
      const slice = metas.slice(index * RH_META.length, (index + 1) * RH_META.length);
      if (pad?.launch[8] && slice.every((row) => row.status === "success")) {
        const meta = slice.map((row) => row.result) as [
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          Address,
        ];
        const pairAsset = pad.launch[2];
        return tokenFromRhPad(
          address,
          pad,
          meta,
          labels.get(pairAsset.toLowerCase()) ?? "WETH",
        );
      }
      try {
        return await readRhLaunch(address);
      } catch {
        return null;
      }
    }),
  );
  return rows.filter((row): row is Token => row !== null);
}

async function readRhLaunches(factories: Address[]): Promise<Token[]> {
  const seen = new Set<string>();
  const addresses: Address[] = [];
  const groups = await Promise.all(
    factories.map(async (factory) => ({
      factory,
      tokens: await readRhFactoryTokens(factory),
    })),
  );
  await Promise.all(
    groups.map(({ factory, tokens }) => loadRhPads(factory, tokens)),
  );
  for (const { tokens } of groups) {
    for (const token of tokens) {
      const key = token.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      addresses.push(token);
    }
  }
  const rows = await readRhLaunchRows(addresses);
  return rows.sort((a, b) => b.launchedAt - a.launchedAt);
}

export async function readLaunches(): Promise<Token[]> {
  const protocol = protocolOf();
  if (!protocol.deployed) return [];
  if (isRh()) {
    return readRhLaunches(rhTokenFactories(protocol.factory));
  }
  const count = await publicClient.readContract({
    address: protocol.factory,
    abi: factoryCountAbi(),
    functionName: "launchCount",
  });
  if (count === 0n) return [];

  const indexes = Array.from({ length: Number(count) }, (_, i) => BigInt(i));
  const addresses = await readAllTokenAddresses(indexes);
  const rows = await readLaunchRows(addresses);

  return rows.sort((a, b) => b.launchedAt - a.launchedAt);
}

async function readAllTokenAddresses(indexes: bigint[]): Promise<Address[]> {
  try {
    const rows = await publicClient.multicall({
      allowFailure: false,
      contracts: indexes.map((index) => ({
        address: protocolOf().factory,
        abi: factoryCountAbi(),
        functionName: "allTokens" as const,
        args: [index],
      })),
    });
    return rows as Address[];
  } catch {
    return Promise.all(
      indexes.map((index) =>
        publicClient.readContract({
          address: protocolOf().factory,
          abi: factoryCountAbi(),
          functionName: "allTokens",
          args: [index],
        }),
      ),
    );
  }
}

async function readLaunchRows(addresses: Address[]): Promise<Token[]> {
  if (isRh()) {
    return readRhLaunchRows(addresses);
  }
  try {
    const [infos, launches] = await Promise.all([
      publicClient.multicall({
        allowFailure: true,
        contracts: addresses.map((address) => ({
          address,
          abi: launchTokenAbi,
          functionName: "getTokenInfo" as const,
        })),
      }),
      publicClient.multicall({
        allowFailure: true,
        contracts: addresses.map((address) => ({
          address: protocolOf().factory,
          abi: launchFactoryAbi,
          functionName: "launches" as const,
          args: [address],
        })),
      }),
    ]);
    const rows: Token[] = [];
    for (let index = 0; index < addresses.length; index += 1) {
      const info = infos[index];
      const launch = launches[index];
      if (info.status !== "success" || launch.status !== "success") continue;
      if (!launch.result[10]) continue;
      const image = info.result[3].trim();
      const token = toToken(
        addresses[index],
        [
          info.result[0],
          info.result[1],
          info.result[2],
          image,
          info.result[4],
          info.result[5],
          info.result[6],
          info.result[7],
        ],
        launch.result[6],
        launch.result[2],
        launch.result[9],
      );
      rememberLaunch(token);
      rows.push(token);
    }
    return rows;
  } catch {
    const rows = await Promise.all(
      addresses.map(async (address) => {
        try {
          return await readLaunch(address);
        } catch {
          return null;
        }
      }),
    );
    return rows.filter((row): row is Token => row !== null);
  }
}

async function launchRhToken({
  wallet,
  name,
  symbol,
  description,
  image,
  twitter,
  telegram,
  website,
  firstBuyUsdc,
  fees,
  pairAsset,
  payWithEth,
}: {
  wallet: ConnectedWallet;
  name: string;
  symbol: string;
  description: string;
  image: string;
  twitter: string;
  telegram: string;
  website: string;
  firstBuyUsdc: string;
  fees: FeeConfig;
  pairAsset?: Address;
  payWithEth?: boolean;
}): Promise<LaunchResult> {
  const protocol = protocolOf();
  const pair = pairAsset && isAddress(pairAsset) ? getAddress(pairAsset) : protocol.pairAsset;
  const { ok } = await readPairable(pair);
  if (!ok) {
    throw new Error("This pair needs at least $5,000 of Uniswap liquidity versus ETH, WETH, or USDG (v2, v3, or v4).");
  }

  const account = wallet.address as Address;
  const pairInfo = await readPairToken(pair);
  const nativeEth = isNativeEth(pair);
  const payEth = nativeEth || Boolean(payWithEth);
  const ethSized = Boolean(payWithEth) && !nativeEth;
  const firstBuyCap = ethSized
    ? await pairCapFromEth(pair, parseUnits(firstBuyUsdc || "0", 18), pairInfo.decimals)
    : parseUnits(firstBuyUsdc || "0", pairInfo.decimals);

  if (firstBuyCap > 0n && !payEth) {
    const allowance = await publicClient.readContract({
      address: pair,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account, protocol.factory],
    });
    if (allowance < firstBuyCap) {
      const approveHash = await writePrepared({
        wallet,
        address: pair,
        abi: erc20Abi,
        functionName: "approve",
        args: [protocol.factory, 2n ** 256n - 1n],
        gasFallback: 60_000n,
      });
      const approved = await publicClient.waitForTransactionReceipt({ hash: approveHash });
      if (approved.status !== "success") {
        throw new Error(`${pairInfo.symbol} approve reverted.`);
      }
    }
  }

  let value = 0n;
  if (firstBuyCap > 0n && payEth) {
    try {
      value = await publicClient.readContract({
        address: protocol.factory,
        abi: rhLaunchFactoryAbi,
        functionName: "ethForFirstBuy",
        args: [pair, firstBuyCap],
      });
    } catch (error) {
      throw new Error(asError(error));
    }
  }

  let hash: Hex;
  try {
    hash = await writePrepared({
      wallet,
      address: protocol.factory,
      abi: rhLaunchFactoryAbi,
      functionName: "launch",
      args: [
        {
          name: name.slice(0, 64),
          symbol: symbol.slice(0, 16),
          image: toIpfsUri(image).slice(0, 512),
          description: description.slice(0, 2048),
          twitter: formatTwitter(twitter),
          telegram: formatTelegram(telegram),
          website: website.trim().slice(0, 256),
          pairAsset: pair,
          creatorFeeBps: fees.buyTaxBps,
          feeTo: fees.dividendBps > 0 ? 1 : 0,
          salt: randomSalt(),
          firstBuyCap,
        },
      ],
      value,
      gasFallback: 5_000_000n,
    });
  } catch (error) {
    throw new Error(asError(error));
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error("Launch transaction reverted.");
  }

  const launched = parseEventLogs({
    abi: rhLaunchFactoryAbi,
    eventName: "TokenLaunched",
    logs: receipt.logs,
  })[0];
  const token = launched?.args.token;
  if (!token) {
    throw new Error("Launch succeeded but TokenLaunched was not found.");
  }
  const pairUsed = launched.args.pairAsset ?? pair;
  publishLaunch({
    id: token,
    name,
    ticker: symbol,
    address: token,
    image: toIpfsUri(image),
    description,
    twitter: formatTwitter(twitter),
    telegram: formatTelegram(telegram),
    website: website.trim(),
    creator: account,
    mcap: TARGET_FDV_USD,
    fdv: TARGET_FDV_USD,
    ath: TARGET_FDV_USD,
    volume: 0,
    price: TARGET_FDV_USD / 1_000_000_000,
    change24h: 0,
    launchedAt: Date.now(),
    pair: knownPairSymbol(pairUsed) ?? "TOKEN",
    pairAsset: pairUsed,
    poolId: launched.args.poolId,
    poolFee: Number(launched.args.fee ?? 0),
    hue: hueFromAddress(token),
    recentBuys:
      launched.args.firstBuyTokens && launched.args.firstBuyTokens > 0n ? 1 : 0,
    tokenIsCurrency0: token.toLowerCase() < pairUsed.toLowerCase(),
  });
  void readRhLaunch(token)
    .then((row) => {
      if (row) publishLaunch(row);
    })
    .catch(() => {
      /* tape already has the optimistic row */
    });
  await verifyLaunchToken({
    address: token,
    hash,
    chainId: getNetwork().chainId,
    constructorArgs: encodeAbiParameters(
      [
        { type: "string" },
        { type: "string" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint16" },
        { type: "uint8" },
      ],
      [
        name.slice(0, 64),
        symbol.slice(0, 16),
        protocol.factory,
        account,
        pair,
        fees.buyTaxBps,
        fees.dividendBps > 0 ? 1 : 0,
      ],
    ),
  });
  return { token, hash, poolId: launched.args.poolId };
}

export async function launchToken({
  wallet,
  name,
  symbol,
  description,
  image,
  twitter,
  telegram,
  website,
  firstBuyUsdc,
  fees = creatorBackedFees,
  tributeRecipient,
  pairAsset,
  payWithEth,
}: {
  wallet: ConnectedWallet;
  name: string;
  symbol: string;
  description: string;
  image: string;
  twitter: string;
  telegram: string;
  website: string;
  firstBuyUsdc: string;
  fees?: FeeConfig;
  tributeRecipient?: string;
  pairAsset?: Address;
  payWithEth?: boolean;
}): Promise<LaunchResult> {
  const account = wallet.address as Address;
  const feeError = validateFees(fees);
  if (feeError) throw new Error(feeError);
  const tribute = tributeRecipient?.trim();
  if (tribute && !isAddress(tribute)) {
    throw new Error("Tribute recipient must be a valid address.");
  }

  await assertLaunchReady();
  if (isRh()) {
    return launchRhToken({
      wallet,
      name,
      symbol,
      description,
      image,
      twitter,
      telegram,
      website,
      firstBuyUsdc,
      fees,
      pairAsset,
      payWithEth,
    });
  }

  const protocol = protocolOf();
  const firstBuyCap = parseUnits(firstBuyUsdc || "0", protocol.pairDecimals);
  if (firstBuyCap > 0n) {
    if (protocol.pairSymbol === "WETH") {
      await ensureWeth(wallet, account, firstBuyCap);
    }
    const allowance = await publicClient.readContract({
      address: protocol.pairAsset,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account, protocol.factory],
    });
    if (allowance < firstBuyCap) {
      let approveHash: Hex;
      try {
        approveHash = await writePrepared({
          wallet,
          address: protocol.pairAsset,
          abi: erc20Abi,
          functionName: "approve",
          args: [protocol.factory, firstBuyCap],
          gasFallback: 80_000n,
        });
      } catch (error) {
        throw new Error(asError(error));
      }
      const approved = await publicClient.waitForTransactionReceipt({
        hash: approveHash,
      });
      if (approved.status !== "success") {
        throw new Error(`${protocol.pairSymbol} approve reverted.`);
      }
    }
  }

  let hash: Hex;
  try {
    hash = await writePrepared({
      wallet,
      address: protocol.factory,
      abi: launchFactoryAbi,
      functionName: "launchToken",
      args: [
        {
          name: name.slice(0, 64),
          symbol: symbol.slice(0, 16),
          metadata: {
            image: toIpfsUri(image).slice(0, 512),
            description: description.slice(0, 2048),
            twitter: formatTwitter(twitter),
            telegram: formatTelegram(telegram),
            website: website.trim().slice(0, 256),
          },
          creator: account,
          tributeRecipient: (tribute || account) as Address,
          salt: randomSalt(),
          config: {
            pairAsset: protocol.pairAsset,
            fees: {
              buyTaxBps: fees.buyTaxBps,
              sellTaxBps: fees.sellTaxBps,
              creatorBps: fees.creatorBps,
              dividendBps: fees.dividendBps,
              buybackBps: fees.buybackBps,
              autoLpBps: fees.autoLpBps,
              tributeBps: fees.tributeBps,
              protocolBps: fees.protocolBps,
            },
            firstBuyCap,
          },
        },
      ],
      gasFallback: 3_500_000n,
    });
  } catch (error) {
    throw new Error(asError(error));
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error("Launch transaction reverted.");
  }

  const launched = parseEventLogs({
    abi: launchFactoryAbi,
    eventName: "TokenLaunched",
    logs: receipt.logs,
  })[0];

  const token = launched?.args.token;
  if (!token) {
    throw new Error("Launch succeeded but TokenLaunched was not found.");
  }

  await verifyLaunchToken({
    address: token,
    hash,
    chainId: getNetwork().chainId,
  });
  return { token, hash };
}

export const feeDistributorAbi = [
  {
    type: "function",
    name: "launches",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      { name: "registered", type: "bool" },
      { name: "pairAsset", type: "address" },
      { name: "creator", type: "address" },
      { name: "tributeRecipient", type: "address" },
      {
        name: "fees",
        type: "tuple",
        components: [
          { name: "buyTaxBps", type: "uint16" },
          { name: "sellTaxBps", type: "uint16" },
          { name: "creatorBps", type: "uint16" },
          { name: "dividendBps", type: "uint16" },
          { name: "buybackBps", type: "uint16" },
          { name: "autoLpBps", type: "uint16" },
          { name: "tributeBps", type: "uint16" },
          { name: "protocolBps", type: "uint16" },
        ],
      },
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      { name: "tokenIsCurrency0", type: "bool" },
      { name: "pendingBuyback", type: "uint256" },
      { name: "pendingAutoLp", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "claimable",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "asset", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "amount", type: "uint256" }],
  },
] as const;

const pendingRewardsAbi = [
  {
    type: "function",
    name: "pendingRewards",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export async function readLaunchFees(token: Address): Promise<FeeConfig | null> {
  try {
    if (isRh()) {
      const resolved = await resolveRhLaunchFactory(token);
      if (!resolved) return null;
      const launch = resolved.launch;
      const toHolders = launch[6] === 1;
      return {
        buyTaxBps: launch[5],
        sellTaxBps: launch[5],
        creatorBps: toHolders ? 0 : 10_000,
        dividendBps: toHolders ? 10_000 : 0,
        buybackBps: 0,
        autoLpBps: 0,
        tributeBps: 0,
        protocolBps: 0,
      };
    }
    const launch = await publicClient.readContract({
      address: protocolOf().distributor,
      abi: feeDistributorAbi,
      functionName: "launches",
      args: [token],
    });
    if (!launch[0]) return null;
    return launch[4];
  } catch {
    return null;
  }
}

const rhFeeVaultAbi = [
  {
    type: "function",
    name: "claimable",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "asset", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [],
  },
] as const;

export async function collectLaunchFees(wallet: ConnectedWallet, token: Address) {
  const resolved = isRh() ? await resolveRhLaunchFactory(token) : null;
  const factory = resolved?.factory ?? protocolOf().factory;
  const hash = await writePrepared({
    wallet,
    address: factory,
    abi: rhLaunchFactoryAbi,
    functionName: "collectFees",
    args: [token],
    gasFallback: 400_000n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Fee collect reverted.");
  return hash;
}

export async function readCreatorFees(token: Address, creator: Address) {
  const protocol = protocolOf();
  if (isRh()) {
    const { readRhFeeEstimate } = await import("./uncollected-fees");
    const estimate = await readRhFeeEstimate(token, creator);
    if (!estimate) return 0n;
    return estimate.claimablePair + estimate.creatorPair;
  }
  const [claimableUsdc, dividends] = await Promise.all([
    publicClient.readContract({
      address: protocol.distributor,
      abi: feeDistributorAbi,
      functionName: "claimable",
      args: [creator, protocol.pairAsset],
    }),
    publicClient
      .readContract({
        address: token,
        abi: pendingRewardsAbi,
        functionName: "pendingRewards",
        args: [creator],
      })
      .catch(() => 0n),
  ]);
  return claimableUsdc + dividends;
}

export async function claimCreatorFees({
  wallet,
  token,
}: {
  wallet: ConnectedWallet;
  token: Address;
}): Promise<Hex> {
  try {
    if (isRh()) {
      const resolved = await resolveRhLaunchFactory(token);
      if (!resolved) throw new Error("Token is not a Zorp launch.");
      const pairAsset = resolved.launch[2] as Address;
      const readBooked = () =>
        publicClient.readContract({
          address: resolved.vault,
          abi: rhFeeVaultAbi,
          functionName: "claimable",
          args: [wallet.address as Address, pairAsset],
        });
      // Working claims (0x58878107) were vault.claim only — never collect.
      let booked = await readBooked();
      if (booked === 0n) {
        await collectLaunchFees(wallet, token);
        booked = await readBooked();
      }
      if (booked === 0n) {
        throw new Error("Fees were collected but nothing was booked for your wallet.");
      }
      const hash = await writePrepared({
        wallet,
        address: resolved.vault,
        abi: rhFeeVaultAbi,
        functionName: "claim",
        args: [pairAsset],
        gasFallback: 120_000n,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Claim reverted.");
      return hash;
    }
    const hash = await writePrepared({
      wallet,
      address: protocolOf().distributor,
      abi: feeDistributorAbi,
      functionName: "claim",
      args: [token],
      gasFallback: 180_000n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("Claim reverted.");
    return hash;
  } catch (error) {
    throw new Error(asError(error));
  }
}

export function explorerAddress(address: string) {
  return `${getNetwork().explorer}/address/${address}`;
}

export function explorerTx(hash: string) {
  return `${getNetwork().explorer}/tx/${hash}`;
}

const wethAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
] as const;

export async function ensureWeth(
  wallet: ConnectedWallet,
  account: Address,
  needed: bigint,
) {
  const weth = protocolOf().pairAsset;
  const balance = await publicClient.readContract({
    address: weth,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account],
  });
  if (balance >= needed) return;
  const wrap = needed - balance;
  const native = await publicClient.getBalance({ address: account });
  if (native <= wrap) {
    throw new Error("Not enough ETH to wrap into WETH for this buy.");
  }
  const hash = await writePrepared({
    wallet,
    address: weth,
    abi: wethAbi,
    functionName: "deposit",
    value: wrap,
    gasFallback: 80_000n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("WETH wrap reverted.");
}
