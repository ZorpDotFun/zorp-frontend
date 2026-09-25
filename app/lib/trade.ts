import {
  encodeAbiParameters,
  encodePacked,
  erc20Abi,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import type { ConnectedWallet } from "@privy-io/react-auth";
import {
  asError,
  ensureWeth,
  ethFromPair,
  pairCapFromEth,
  publicClient,
  writePrepared,
} from "./factory";
import { getNetwork, protocolOf, RH_WETH } from "./networks";
import { launchPoolId, launchPoolIdFor, launchPoolKey, launchPoolKeyFor, quoteWeiFromSqrt } from "./pool-price";
import { isNativeEth, RH_USDG } from "./quote-tokens";

const RH_V2_FACTORY = "0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f" as Address;
const RH_V2_ROUTER = "0x89e5DB8B5aA49aA85AC63f691524311AEB649eba" as Address;
const RH_V3_ROUTER = "0xCaf681a66D020601342297493863E78C959E5cb2" as Address;
const SLIPPAGE_HAIRCUT_BPS = 150n;

export type SwapPool = {
  pairAsset: Address;
  fee: number;
  tickSpacing: number;
  hook: Address;
};

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

export function swapPoolForToken(token: {
  pairAsset?: string;
  poolFee?: number;
}): SwapPool | undefined {
  if (!token.pairAsset) return undefined;
  return {
    pairAsset: token.pairAsset as Address,
    fee: token.poolFee ?? 0,
    tickSpacing: getNetwork().id === "robinhood" ? 200 : 60,
    hook: protocolOf().hook,
  };
}

function resolvePoolKey(token: Address, pool?: SwapPool) {
  if (!pool) return launchPoolKey(token);
  return launchPoolKeyFor(token, pool.pairAsset, pool.hook, pool.fee, pool.tickSpacing);
}

export async function quoteExactIn({
  token,
  tokenIsCurrency0,
  buying,
  amountIn,
  pool,
}: {
  token: Address;
  tokenIsCurrency0: boolean;
  buying: boolean;
  amountIn: bigint;
  pool?: SwapPool;
}): Promise<bigint> {
  if (amountIn <= 0n) return 0n;
  const poolKey = resolvePoolKey(token, pool);
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
  return quoteFromSpot(token, tokenIsCurrency0, buying, amountIn, pool);
}

export async function swapExactIn({
  wallet,
  token,
  tokenIsCurrency0,
  buying,
  amountIn,
  amountOutMin,
  pool,
}: {
  wallet: ConnectedWallet;
  token: Address;
  tokenIsCurrency0: boolean;
  buying: boolean;
  amountIn: bigint;
  amountOutMin: bigint;
  pool?: SwapPool;
}): Promise<Hex> {
  if (amountIn <= 0n) throw new Error("Enter an amount.");
  const account = wallet.address as Address;
  const pair = pool?.pairAsset ?? protocolOf().pairAsset;
  const input = buying ? pair : token;
  const output = buying ? token : pair;
  const zeroForOne = buying ? buyZeroForOne(tokenIsCurrency0) : tokenIsCurrency0;
  const poolKey = resolvePoolKey(token, pool);

  const nativeIn = buying && isNativeEth(pair);
  if (buying && !nativeIn && pair.toLowerCase() === protocolOf().pairAsset.toLowerCase()) {
    await ensureWeth(wallet, account, amountIn);
  }
  if (!nativeIn) {
    await ensurePermit2(wallet, account, input, amountIn);
  }

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
      value: nativeIn ? amountIn : 0n,
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
  pool?: SwapPool,
) {
  const poolId = pool
    ? launchPoolIdFor(token, pool.pairAsset, pool.hook, pool.fee, pool.tickSpacing)
    : launchPoolId(token);
  const slot0 = await publicClient.readContract({
    address: protocolOf().v4StateView,
    abi: stateViewAbi,
    functionName: "getSlot0",
    args: [poolId],
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

export async function readErc20Balance(token: Address, account: Address) {
  return publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account],
  });
}

export function parseTradeAmount(value: string, buying: boolean, decimals?: number) {
  const trimmed = value.trim();
  if (!trimmed || Number(trimmed) <= 0) return 0n;
  return parseUnits(
    trimmed,
    decimals ?? (buying ? protocolOf().pairDecimals : TOKEN_DECIMALS),
  );
}

export async function quoteEthToPair(
  pair: Address,
  ethWei: bigint,
  pairDecimals: number,
) {
  if (ethWei <= 0n) return 0n;
  const spend = (ethWei * (10_000n - SLIPPAGE_HAIRCUT_BPS)) / 10_000n;
  return pairCapFromEth(pair, spend, pairDecimals);
}

export async function quotePairToEth(
  pair: Address,
  pairAmount: bigint,
  pairDecimals: number,
) {
  if (pairAmount <= 0n) return 0n;
  return ethFromPair(pair, pairAmount, pairDecimals);
}

const fillerAbi = [
  {
    type: "function",
    name: "exactOut",
    stateMutability: "payable",
    inputs: [
      { name: "pair", type: "address" },
      { name: "amountOut", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const wethAbi = [
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "wad", type: "uint256" }],
    outputs: [],
  },
] as const;

const v2FactoryAbi = [
  {
    type: "function",
    name: "getPair",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
    ],
    outputs: [{ name: "pair", type: "address" }],
  },
] as const;

const v2RouterAbi = [
  {
    type: "function",
    name: "swapExactTokensForETH",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
] as const;

const v3RouterAbi = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

export async function fillEthToPair({
  wallet,
  pair,
  pairOut,
  ethIn,
}: {
  wallet: ConnectedWallet;
  pair: Address;
  pairOut: bigint;
  ethIn: bigint;
}) {
  const filler = protocolOf().filler;
  if (!filler || filler === "0x0000000000000000000000000000000000000000") {
    throw new Error("ETH filler is not configured.");
  }
  const hash = await writePrepared({
    wallet,
    address: filler,
    abi: fillerAbi,
    functionName: "exactOut",
    args: [pair, pairOut],
    value: ethIn,
    gasFallback: 1_400_000n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("ETH fill reverted.");
}

async function approveSpend(
  wallet: ConnectedWallet,
  token: Address,
  spender: Address,
  amount: bigint,
) {
  const account = wallet.address as Address;
  const allowance = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account, spender],
  });
  if (allowance >= amount) return;
  const hash = await writePrepared({
    wallet,
    address: token,
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, amount],
    gasFallback: 80_000n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Approve reverted.");
}

async function v2PairExists(tokenA: Address, tokenB: Address) {
  try {
    const pair = await publicClient.readContract({
      address: RH_V2_FACTORY,
      abi: v2FactoryAbi,
      functionName: "getPair",
      args: [tokenA, tokenB],
    });
    return pair !== "0x0000000000000000000000000000000000000000";
  } catch {
    return false;
  }
}

async function unwrapWeth(wallet: ConnectedWallet, amount: bigint) {
  const hash = await writePrepared({
    wallet,
    address: RH_WETH,
    abi: wethAbi,
    functionName: "withdraw",
    args: [amount],
    gasFallback: 80_000n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("WETH unwrap reverted.");
}

export async function unwindPairToEth({
  wallet,
  pair,
  amountIn,
  pairDecimals = 18,
}: {
  wallet: ConnectedWallet;
  pair: Address;
  amountIn: bigint;
  pairDecimals?: number;
}) {
  if (amountIn <= 0n || isNativeEth(pair)) return;
  const account = wallet.address as Address;
  if (pair.toLowerCase() === RH_WETH.toLowerCase()) {
    await unwrapWeth(wallet, amountIn);
    return;
  }

  const minOut = (await quotePairToEth(pair, amountIn, pairDecimals) * 8500n) / 10_000n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 180);
  const paths: Address[][] = [];
  if (await v2PairExists(pair, RH_WETH)) paths.push([pair, RH_WETH]);
  if (await v2PairExists(pair, RH_USDG) && (await v2PairExists(RH_USDG, RH_WETH))) {
    paths.push([pair, RH_USDG, RH_WETH]);
  }

  for (const path of paths) {
    try {
      await approveSpend(wallet, pair, RH_V2_ROUTER, amountIn);
      const hash = await writePrepared({
        wallet,
        address: RH_V2_ROUTER,
        abi: v2RouterAbi,
        functionName: "swapExactTokensForETH",
        args: [amountIn, minOut, path, account, deadline],
        gasFallback: 500_000n,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === "success") return;
    } catch {
      // try the next venue
    }
  }

  await approveSpend(wallet, pair, RH_V3_ROUTER, amountIn);
  const before = await publicClient.getBalance({ address: account });
  const wethBefore = await readErc20Balance(RH_WETH, account);
  for (const fee of [100, 500, 3000, 10_000, 20_000, 30_000, 50_000]) {
    try {
      const hash = await writePrepared({
        wallet,
        address: RH_V3_ROUTER,
        abi: v3RouterAbi,
        functionName: "exactInputSingle",
        args: [
          {
            tokenIn: pair,
            tokenOut: RH_WETH,
            fee,
            recipient: account,
            amountIn,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0n,
          },
        ],
        gasFallback: 400_000n,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") continue;
      const wethAfter = await readErc20Balance(RH_WETH, account);
      if (wethAfter > wethBefore) await unwrapWeth(wallet, wethAfter - wethBefore);
      const after = await publicClient.getBalance({ address: account });
      if (after > before || wethAfter > wethBefore) return;
    } catch {
      // try the next fee
    }
  }

  throw new Error("Could not swap the pair back to ETH.");
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
