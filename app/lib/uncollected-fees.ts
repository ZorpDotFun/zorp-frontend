import { formatUnits, type Address, type Hex } from "viem";
import { rhTokenFactories } from "./addresses";
import { resolveRhLaunchFactory } from "./factory";
import { getPublicClient, protocolOf } from "./networks";
import { pairMark, quoteWeiFromSqrt } from "./pool-price";
import { isNativeEth } from "./quote-tokens";

const factoryViewAbi = [
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
] as const;

const Q128 = 2n ** 128n;
const TOKEN_UNIT = 10n ** 18n;
const LOCKER_SALT =
  "0x0000000000000000000000000000000000000000000000000000000000000001" as Hex;

const lockerAbi = [
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      { name: "locked", type: "bool" },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "token", type: "address" },
      { name: "pairAsset", type: "address" },
      { name: "currency0", type: "address" },
      { name: "currency1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickSpacing", type: "int24" },
      { name: "hooks", type: "address" },
      { name: "liquidity", type: "uint128" },
    ],
  },
] as const;

const stateViewFeeAbi = [
  {
    type: "function",
    name: "getSlot0",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
  {
    type: "function",
    name: "getPositionInfo",
    stateMutability: "view",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "owner", type: "address" },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [
      { name: "liquidity", type: "uint128" },
      { name: "feeGrowthInside0LastX128", type: "uint256" },
      { name: "feeGrowthInside1LastX128", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getFeeGrowthInside",
    stateMutability: "view",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
    ],
    outputs: [
      { name: "feeGrowthInside0X128", type: "uint256" },
      { name: "feeGrowthInside1X128", type: "uint256" },
    ],
  },
] as const;

export type RhFeeEstimate = {
  token: Address;
  pairAsset: Address;
  pairDecimals: number;
  potPair: bigint;
  protocolPair: bigint;
  creatorPair: bigint;
  protocolUsd: number;
  creatorUsd: number;
  feeTo: number;
  claimablePair: bigint;
};

function owedFromGrowth(liquidity: bigint, inside: bigint, last: bigint) {
  if (liquidity === 0n || inside <= last) return 0n;
  return (liquidity * (inside - last)) / Q128;
}

function usdOf(amount: bigint, decimals: number, usd: number) {
  if (amount === 0n || !(usd > 0)) return 0;
  const value = Number(formatUnits(amount, decimals)) * usd;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export async function readRhFeeEstimate(
  token: Address,
  creator?: Address,
): Promise<RhFeeEstimate | null> {
  const protocol = protocolOf();
  if (!protocol.deployed || protocol.locker === protocol.factory) return null;
  const client = getPublicClient();

  try {
    const pad = await resolveRhLaunchFactory(token);
    if (!pad) return null;
    const launch = pad.launch;
    const position = await client.readContract({
      address: pad.locker,
      abi: lockerAbi,
      functionName: "positions",
      args: [token],
    });
    if (!position[0]) return null;

    const pairAsset = launch[2] as Address;
    const poolId = launch[3] as Hex;
    const creatorBps = Number(launch[5]);
    const feeTo = Number(launch[6]);
    const tickLower = position[1];
    const tickUpper = position[2];

    const [slot0, posInfo, growth, mark, protoBps, claimable] = await Promise.all([
      client.readContract({
        address: protocol.v4StateView,
        abi: stateViewFeeAbi,
        functionName: "getSlot0",
        args: [poolId],
      }),
      client.readContract({
        address: protocol.v4StateView,
        abi: stateViewFeeAbi,
        functionName: "getPositionInfo",
        args: [poolId, pad.locker, tickLower, tickUpper, LOCKER_SALT],
      }),
      client.readContract({
        address: protocol.v4StateView,
        abi: stateViewFeeAbi,
        functionName: "getFeeGrowthInside",
        args: [poolId, tickLower, tickUpper],
      }),
      pairMark(pairAsset),
      client
        .readContract({
          address: pad.factory,
          abi: factoryViewAbi,
          functionName: "protocolFeeBps",
        })
        .catch(() => 100),
      creator
        ? client
            .readContract({
              address: pad.vault,
              abi: [
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
              ] as const,
              functionName: "claimable",
              args: [creator, pairAsset],
            })
            .catch(() => 0n)
        : Promise.resolve(0n),
    ]);

    const liquidity = posInfo[0];
    const owed0 = owedFromGrowth(liquidity, growth[0], posInfo[1]);
    const owed1 = owedFromGrowth(liquidity, growth[1], posInfo[2]);
    const tokenIsCurrency0 = (position[5] as string).toLowerCase() === token.toLowerCase();
    const tokenOwed = tokenIsCurrency0 ? owed0 : owed1;
    const pairOwed = tokenIsCurrency0 ? owed1 : owed0;
    const pairPerToken = quoteWeiFromSqrt(slot0[0], tokenIsCurrency0);
    const tokenAsPair =
      pairPerToken === 0n ? 0n : (tokenOwed * pairPerToken) / TOKEN_UNIT;
    const potPair = pairOwed + tokenAsPair;

    const proto = Number(protoBps);
    const totalBps = proto + creatorBps;
    const protocolPair = totalBps === 0 ? potPair : (potPair * BigInt(proto)) / BigInt(totalBps);
    const creatorPair = feeTo === 1 ? 0n : potPair - protocolPair;
    const decimals = isNativeEth(pairAsset) ? 18 : mark.decimals;

    return {
      token,
      pairAsset,
      pairDecimals: decimals,
      potPair,
      protocolPair,
      creatorPair,
      protocolUsd: usdOf(protocolPair, decimals, mark.usd),
      creatorUsd: usdOf(creatorPair + claimable, decimals, mark.usd),
      feeTo,
      claimablePair: claimable,
    };
  } catch {
    return null;
  }
}

export async function readAllRhFeeEstimates() {
  const protocol = protocolOf();
  const client = getPublicClient();
  const tokens: Address[] = [];
  const seen = new Set<string>();
  for (const factory of rhTokenFactories(protocol.factory)) {
    try {
      const count = Number(
        await client.readContract({
          address: factory,
          abi: factoryViewAbi,
          functionName: "launchCount",
        }),
      );
      for (let i = 0; i < count; i += 1) {
        const token = await client.readContract({
          address: factory,
          abi: factoryViewAbi,
          functionName: "allTokens",
          args: [BigInt(i)],
        });
        const key = token.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        tokens.push(token);
      }
    } catch {
      /* skip a dead pad */
    }
  }
  const rows = await Promise.all(tokens.map((token) => readRhFeeEstimate(token)));
  return rows.filter((row): row is RhFeeEstimate => row != null);
}
