import {
  encodeAbiParameters,
  encodePacked,
  erc20Abi,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { asError, ensureWeth, publicClient, writePrepared } from "./factory";
import { protocolOf } from "./networks";
import { launchPoolId, launchPoolKey, quoteWeiFromSqrt } from "./pool-price";

const TOKEN_DECIMALS = 18;
const TOKEN_DECIMALS_UNIT = 10n ** 18n;
const V4_SWAP = 0x10;
const SWAP_EXACT_IN_SINGLE = 0x06;
const SETTLE = 0x0b;
const TAKE = 0x0e;
const TAKE_ALL = 0x0f;
const MSG_SENDER = "0x0000000000000000000000000000000000000001" as Address;
const SLIPPAGE_BPS = 150n;
const PERMIT2_MAX = (1n << 160n) - 1n;

const quoterAbi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" },
            ],
          },
          { name: "zeroForOne", type: "bool" },
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "QuoteSwap",
    inputs: [{ name: "amount", type: "uint256" }],
  },
] as const;

const stateViewAbi = [
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
] as const;

const routerAbi = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const permit2Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
  },
] as const;

export function buyZeroForOne(tokenIsCurrency0: boolean) {
  return !tokenIsCurrency0;
}

export async function quoteExactIn({
  token,
  tokenIsCurrency0,
  buying,
  amountIn,
}: {
  token: Address;
  tokenIsCurrency0: boolean;
  buying: boolean;
  amountIn: bigint;
}): Promise<bigint> {
  if (amountIn <= 0n) return 0n;
  const poolKey = launchPoolKey(token);
  const zeroForOne = buying ? buyZeroForOne(tokenIsCurrency0) : tokenIsCurrency0;
  try {
    const { result } = await publicClient.simulateContract({
      address: protocolOf().v4Quoter,
      abi: quoterAbi,
      functionName: "quoteExactInputSingle",
      args: [
        {
          poolKey,
          zeroForOne,
          exactAmount: amountIn,
          hookData: "0x",
        },
      ],
    });
    if (result[0] > 0n) return result[0];
  } catch (error) {
    const quoted = quoteFromRevert(error);
    if (quoted > 0n) return quoted;
  }
  return quoteFromSpot(token, tokenIsCurrency0, buying, amountIn);
}

export async function swapExactIn({
  wallet,
  token,
  tokenIsCurrency0,
  buying,
  amountIn,
  amountOutMin,
}: {
  wallet: ConnectedWallet;
  token: Address;
  tokenIsCurrency0: boolean;
  buying: boolean;
  amountIn: bigint;
  amountOutMin: bigint;
}): Promise<Hex> {
  if (amountIn <= 0n) throw new Error("Enter an amount.");
  const account = wallet.address as Address;
  const pair = protocolOf().pairAsset;
  const input = buying ? pair : token;
  const output = buying ? token : pair;
  const zeroForOne = buying ? buyZeroForOne(tokenIsCurrency0) : tokenIsCurrency0;
  const poolKey = launchPoolKey(token);

  if (buying && protocolOf().pairSymbol === "WETH") {
    await ensureWeth(wallet, account, amountIn);
  }
  await ensurePermit2(wallet, account, input, amountIn);

  const commands = encodePacked(["uint8"], [V4_SWAP]);
  const actions = encodePacked(
    ["uint8", "uint8", "uint8", "uint8"],
    [SWAP_EXACT_IN_SINGLE, SETTLE, TAKE, TAKE_ALL],
  );
  const swapParams = encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" },
            ],
          },
          { name: "zeroForOne", type: "bool" },
          { name: "amountIn", type: "uint128" },
          { name: "amountOutMinimum", type: "uint128" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    [
      {
        poolKey,
        zeroForOne,
        amountIn,
        amountOutMinimum: amountOutMin,
        sqrtPriceLimitX96: 0n,
        hookData: "0x",
      },
    ],
  );
  const settleParams = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }, { type: "bool" }],
    [input, amountIn, true],
  );
  const takeParams = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint256" }],
    [output, MSG_SENDER, 0n],
  );
  const leftoverParams = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [input, 0n],
  );
  const v4Input = encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    [actions, [swapParams, settleParams, takeParams, leftoverParams]],
  );

  try {
    const hash = await writePrepared({
      wallet,
      address: protocolOf().v4UniversalRouter,
      abi: routerAbi,
      functionName: "execute",
      args: [commands, [v4Input], BigInt(Math.floor(Date.now() / 1000) + 180)],
      gasFallback: 800_000n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("Swap reverted.");
    return hash;
  } catch (error) {
    throw new Error(asError(error));
  }
}

async function quoteFromSpot(
  token: Address,
  tokenIsCurrency0: boolean,
  buying: boolean,
  amountIn: bigint,
) {
  const slot0 = await publicClient.readContract({
    address: protocolOf().v4StateView,
    abi: stateViewAbi,
    functionName: "getSlot0",
    args: [launchPoolId(token)],
  });
  const quoteWei = quoteWeiFromSqrt(slot0[0], tokenIsCurrency0);
  if (quoteWei === 0n) return 0n;
  if (buying) return (amountIn * TOKEN_DECIMALS_UNIT) / quoteWei;
  return (amountIn * quoteWei) / TOKEN_DECIMALS_UNIT;
}

function quoteFromRevert(error: unknown) {
  if (!error || typeof error !== "object") return 0n;
  const row = error as {
    data?: { errorName?: string; args?: readonly unknown[] };
    cause?: { data?: { errorName?: string; args?: readonly unknown[] } };
    walk?: (fn: (err: unknown) => unknown) => unknown;
  };
  const decoded = row.data ?? row.cause?.data;
  if (decoded?.errorName === "QuoteSwap" && decoded.args?.[0] != null) {
    return BigInt(decoded.args[0] as bigint | string | number);
  }
  return 0n;
}

export function parseTradeAmount(value: string, buying: boolean) {
  const trimmed = value.trim();
  if (!trimmed || Number(trimmed) <= 0) return 0n;
  return parseUnits(trimmed, buying ? protocolOf().pairDecimals : TOKEN_DECIMALS);
}

export function minOut(quoted: bigint) {
  return (quoted * (10_000n - SLIPPAGE_BPS)) / 10_000n;
}

async function ensurePermit2(
  wallet: ConnectedWallet,
  account: Address,
  token: Address,
  needed: bigint,
) {
  const allowance = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account, protocolOf().permit2],
  });
  if (allowance < needed) {
    const hash = await writePrepared({
      wallet,
      address: token,
      abi: erc20Abi,
      functionName: "approve",
      args: [protocolOf().permit2, PERMIT2_MAX],
      gasFallback: 80_000n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("Approve reverted.");
  }

  const permit = await publicClient.readContract({
    address: protocolOf().permit2,
    abi: permit2Abi,
    functionName: "allowance",
    args: [account, token, protocolOf().v4UniversalRouter],
  });
  const now = Math.floor(Date.now() / 1000);
  if (permit[0] >= needed && Number(permit[1]) > now + 60) return;

  const hash = await writePrepared({
    wallet,
    address: protocolOf().permit2,
    abi: permit2Abi,
    functionName: "approve",
    args: [token, protocolOf().v4UniversalRouter, PERMIT2_MAX, now + 30 * 24 * 60 * 60],
    gasFallback: 80_000n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Permit2 approve reverted.");
}
