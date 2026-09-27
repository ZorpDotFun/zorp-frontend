import {
  createWalletClient,
  custom,
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
const RH_V3_FACTORY = "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA" as Address;
const RH_V3_ROUTER = "0xCaf681a66D020601342297493863E78C959E5cb2" as Address;
const RH_V3_QUOTER = "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7" as Address;
const PONS_HOOK = "0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044" as Address;
const NATIVE_ETH = "0x0000000000000000000000000000000000000000" as Address;
const V3_FEES: number[] = [100, 500, 3_000, 10_000, 20_000, 30_000, 50_000];
const SLIPPAGE_HAIRCUT_BPS = 150n;

export type SwapPool = {
  pairAsset: Address;
  fee: number;
  tickSpacing: number;
  hook: Address;
};

const TOKEN_DECIMALS = 18;
const TOKEN_DECIMALS_UNIT = 10n ** 18n;
const V3_SWAP_EXACT_IN = 0x00;
const V2_SWAP_EXACT_IN = 0x08;
const PERMIT2_PERMIT = 0x0a;
const UNWRAP_WETH = 0x0c;
const V4_SWAP = 0x10;
const SWAP_EXACT_IN_SINGLE = 0x06;
const SETTLE = 0x0b;
const TAKE = 0x0e;
const TAKE_ALL = 0x0f;
const MSG_SENDER = "0x0000000000000000000000000000000000000001" as Address;
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002" as Address;
const CONTRACT_BALANCE = 1n << 255n;
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
  {
    type: "function",
    name: "getLiquidity",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ name: "liquidity", type: "uint128" }],
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
  receiveEth = false,
  pairDecimals: _pairDecimals = 18,
}: {
  wallet: ConnectedWallet;
  token: Address;
  tokenIsCurrency0: boolean;
  buying: boolean;
  amountIn: bigint;
  amountOutMin: bigint;
  pool?: SwapPool;
  receiveEth?: boolean;
  pairDecimals?: number;
}): Promise<Hex> {
  if (amountIn <= 0n) throw new Error("Enter an amount.");
  const account = wallet.address as Address;
  const pair = pool?.pairAsset ?? protocolOf().pairAsset;
  const input = buying ? pair : token;
  const output = buying ? token : pair;
  const zeroForOne = buying ? buyZeroForOne(tokenIsCurrency0) : tokenIsCurrency0;
  const poolKey = resolvePoolKey(token, pool);
  const hopToEth = Boolean(
    receiveEth && !buying && !isNativeEth(pair),
  );
  const hop = hopToEth ? await encodeEthHop(pair, amountOutMin) : null;
  if (hopToEth && !hop) {
    throw new Error("No Uniswap route from this pair to ETH. Receive the pair token instead.");
  }

  const nativeIn = buying && isNativeEth(pair);
  if (buying && !nativeIn && pair.toLowerCase() === protocolOf().pairAsset.toLowerCase()) {
    await ensureWeth(wallet, account, amountIn);
  }
  const permitInput = nativeIn
    ? null
    : await preparePermit2(wallet, account, input, amountIn);

  const v4Input = encodeV4Swap({
    poolKey,
    zeroForOne,
    amountIn,
    amountOutMin,
    input,
    output,
    takeTo: hopToEth ? ADDRESS_THIS : MSG_SENDER,
  });

  const commands: number[] = [];
  const inputs: Hex[] = [];
  if (permitInput) {
    commands.push(PERMIT2_PERMIT);
    inputs.push(permitInput);
  }
  commands.push(V4_SWAP);
  inputs.push(v4Input);
  if (hop) {
    commands.push(...hop.commands);
    inputs.push(...hop.inputs);
  }

  try {
    return await executeRouter(wallet, commands, inputs, nativeIn ? amountIn : 0n);
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
    name: "getAmountsOut",
    stateMutability: "view",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "path", type: "address[]" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
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

const v3FactoryAbi = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
] as const;

const v3QuoterAbi = [
  {
    type: "function",
    name: "quoteExactInput",
    stateMutability: "nonpayable",
    inputs: [
      { name: "path", type: "bytes" },
      { name: "amountIn", type: "uint256" },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96AfterList", type: "uint160[]" },
      { name: "initializedTicksCrossedList", type: "uint32[]" },
      { name: "gasEstimate", type: "uint256" },
    ],
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

function encodeV4Swap({
  poolKey,
  zeroForOne,
  amountIn,
  amountOutMin,
  input,
  output,
  takeTo,
}: {
  poolKey: ReturnType<typeof resolvePoolKey>;
  zeroForOne: boolean;
  amountIn: bigint;
  amountOutMin: bigint;
  input: Address;
  output: Address;
  takeTo: Address;
}): Hex {
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
    [output, takeTo, 0n],
  );
  const leftoverParams = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [input, 0n],
  );
  return encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    [actions, [swapParams, settleParams, takeParams, leftoverParams]],
  );
}

type EthHop = { commands: number[]; inputs: Hex[] };

const V4_ETH_CANDIDATES = [
  { fee: 0, tickSpacing: 200, hook: PONS_HOOK },
  { fee: 0, tickSpacing: 200, hook: NATIVE_ETH },
  { fee: 3_000, tickSpacing: 60, hook: NATIVE_ETH },
  { fee: 500, tickSpacing: 10, hook: NATIVE_ETH },
  { fee: 100, tickSpacing: 1, hook: NATIVE_ETH },
  { fee: 10_000, tickSpacing: 200, hook: NATIVE_ETH },
  { fee: 500, tickSpacing: 60, hook: NATIVE_ETH },
  { fee: 3_000, tickSpacing: 200, hook: PONS_HOOK },
  { fee: 0, tickSpacing: 60, hook: NATIVE_ETH },
  { fee: 20_000, tickSpacing: 200, hook: NATIVE_ETH },
] as const;

async function encodeEthHop(pair: Address, stockAmount: bigint): Promise<EthHop | null> {
  if (stockAmount <= 0n) return null;
  if (pair.toLowerCase() === RH_WETH.toLowerCase()) {
    return unwrapHop(haircut(stockAmount));
  }

  const [v2Weth, v3Weth, v2Usdg, v3Usdg] = await Promise.all([
    quoteV2Path([pair, RH_WETH], stockAmount),
    bestV3Path([pair, RH_WETH], stockAmount),
    quoteV2Path([pair, RH_USDG, RH_WETH], stockAmount),
    bestV3Path([pair, RH_USDG, RH_WETH], stockAmount),
  ]);

  const scored: { quoted: bigint; hop: EthHop }[] = [];
  if (v2Weth > 0n) scored.push({ quoted: v2Weth, hop: v2Hop([pair, RH_WETH], haircut(v2Weth)) });
  if (v3Weth) scored.push({ quoted: v3Weth.quoted, hop: v3Hop(v3Weth.path, haircut(v3Weth.quoted)) });
  if (v2Usdg > 0n) scored.push({ quoted: v2Usdg, hop: v2Hop([pair, RH_USDG, RH_WETH], haircut(v2Usdg)) });
  if (v3Usdg) scored.push({ quoted: v3Usdg.quoted, hop: v3Hop(v3Usdg.path, haircut(v3Usdg.quoted)) });
  const bestBook = pickHop(scored);
  if (bestBook) return bestBook;

  const [v4Native, v4Weth, v4Usdg] = await Promise.all([
    bestV4Hop(pair, NATIVE_ETH, stockAmount),
    bestV4Hop(pair, RH_WETH, stockAmount),
    bestV4Hop(pair, RH_USDG, stockAmount),
  ]);
  if (v4Native) {
    scored.push({
      quoted: v4Native.quoted,
      hop: {
        commands: [V4_SWAP],
        inputs: [
          encodeV4HopFromRouter({
            poolKey: v4Native.key,
            zeroForOne: v4Native.zeroForOne,
            amountOutMin: haircut(v4Native.quoted),
            input: pair,
            output: NATIVE_ETH,
            takeTo: MSG_SENDER,
          }),
        ],
      },
    });
  }
  if (v4Weth) {
    scored.push({
      quoted: v4Weth.quoted,
      hop: {
        commands: [V4_SWAP, UNWRAP_WETH],
        inputs: [
          encodeV4HopFromRouter({
            poolKey: v4Weth.key,
            zeroForOne: v4Weth.zeroForOne,
            amountOutMin: haircut(v4Weth.quoted),
            input: pair,
            output: RH_WETH,
            takeTo: ADDRESS_THIS,
          }),
          unwrapInput(haircut(v4Weth.quoted)),
        ],
      },
    });
  }
  if (v4Usdg) {
    const usdgOut = v4Usdg.quoted;
    const [v2Tail, v3Tail] = await Promise.all([
      quoteV2Path([RH_USDG, RH_WETH], usdgOut),
      bestV3Path([RH_USDG, RH_WETH], usdgOut),
    ]);
    if (v2Tail > 0n) {
      scored.push({
        quoted: v2Tail,
        hop: {
          commands: [V4_SWAP, V2_SWAP_EXACT_IN, UNWRAP_WETH],
          inputs: [
            encodeV4HopFromRouter({
              poolKey: v4Usdg.key,
              zeroForOne: v4Usdg.zeroForOne,
              amountOutMin: haircut(usdgOut),
              input: pair,
              output: RH_USDG,
              takeTo: ADDRESS_THIS,
            }),
            encodeV2Hop([RH_USDG, RH_WETH], haircut(v2Tail)),
            unwrapInput(haircut(v2Tail)),
          ],
        },
      });
    }
    if (v3Tail) {
      scored.push({
        quoted: v3Tail.quoted,
        hop: {
          commands: [V4_SWAP, V3_SWAP_EXACT_IN, UNWRAP_WETH],
          inputs: [
            encodeV4HopFromRouter({
              poolKey: v4Usdg.key,
              zeroForOne: v4Usdg.zeroForOne,
              amountOutMin: haircut(usdgOut),
              input: pair,
              output: RH_USDG,
              takeTo: ADDRESS_THIS,
            }),
            encodeV3Hop(v3Tail.path, haircut(v3Tail.quoted)),
            unwrapInput(haircut(v3Tail.quoted)),
          ],
        },
      });
    }
  }
  return pickHop(scored);
}

function pickHop(rows: { quoted: bigint; hop: EthHop }[]) {
  let best: { quoted: bigint; hop: EthHop } | null = null;
  for (const row of rows) {
    if (row.quoted > 0n && (!best || row.quoted > best.quoted)) best = row;
  }
  return best?.hop ?? null;
}

function haircut(amount: bigint) {
  return (amount * (10_000n - SLIPPAGE_HAIRCUT_BPS)) / 10_000n;
}

function unwrapInput(minEth: bigint): Hex {
  return encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [MSG_SENDER, minEth],
  );
}

function unwrapHop(minEth: bigint): EthHop {
  return { commands: [UNWRAP_WETH], inputs: [unwrapInput(minEth)] };
}

function v2Hop(path: Address[], minEth: bigint): EthHop {
  return {
    commands: [V2_SWAP_EXACT_IN, UNWRAP_WETH],
    inputs: [encodeV2Hop(path, minEth), unwrapInput(minEth)],
  };
}

function v3Hop(path: Hex, minEth: bigint): EthHop {
  return {
    commands: [V3_SWAP_EXACT_IN, UNWRAP_WETH],
    inputs: [encodeV3Hop(path, minEth), unwrapInput(minEth)],
  };
}

function encodeV3Hop(path: Hex, minEth: bigint): Hex {
  return encodeAbiParameters(
    [
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "bytes" },
      { type: "bool" },
    ],
    [ADDRESS_THIS, CONTRACT_BALANCE, minEth, path, false],
  );
}

function encodeV3Path(tokens: Address[], fees: number[]): Hex {
  const types: ("address" | "uint24")[] = [];
  const values: (Address | number)[] = [];
  for (let i = 0; i < fees.length; i++) {
    types.push("address", "uint24");
    values.push(tokens[i] as Address, fees[i] as number);
  }
  types.push("address");
  values.push(tokens[tokens.length - 1] as Address);
  return encodePacked(types, values);
}

async function quoteV2Path(path: Address[], amountIn: bigint) {
  if (amountIn <= 0n) return 0n;
  for (let i = 0; i < path.length - 1; i++) {
    if (!(await v2PairExists(path[i] as Address, path[i + 1] as Address))) return 0n;
  }
  try {
    const amounts = await publicClient.readContract({
      address: RH_V2_ROUTER,
      abi: v2RouterAbi,
      functionName: "getAmountsOut",
      args: [amountIn, path],
    });
    return amounts[amounts.length - 1] ?? 0n;
  } catch {
    return 0n;
  }
}

async function v3PoolExists(tokenA: Address, tokenB: Address, fee: number) {
  try {
    const pool = await publicClient.readContract({
      address: RH_V3_FACTORY,
      abi: v3FactoryAbi,
      functionName: "getPool",
      args: [tokenA, tokenB, fee],
    });
    return pool !== NATIVE_ETH;
  } catch {
    return false;
  }
}

async function quoteV3Path(path: Hex, amountIn: bigint) {
  if (amountIn <= 0n) return 0n;
  try {
    const { result } = await publicClient.simulateContract({
      address: RH_V3_QUOTER,
      abi: v3QuoterAbi,
      functionName: "quoteExactInput",
      args: [path, amountIn],
    });
    return result[0];
  } catch (error) {
    return quoteFromRevert(error);
  }
}

async function bestV3Path(tokens: Address[], amountIn: bigint) {
  if (tokens.length === 2) {
    let best: { path: Hex; quoted: bigint } | null = null;
    const rows = await Promise.all(
      V3_FEES.map(async (fee) => {
        if (!(await v3PoolExists(tokens[0] as Address, tokens[1] as Address, fee))) {
          return null;
        }
        const path = encodeV3Path(tokens, [fee]);
        const quoted = await quoteV3Path(path, amountIn);
        return quoted > 0n ? { path, quoted } : null;
      }),
    );
    for (const row of rows) {
      if (row && (!best || row.quoted > best.quoted)) best = row;
    }
    return best;
  }

  const mid = tokens[1] as Address;
  const last = tokens[2] as Address;
  const tails = await Promise.all(
    V3_FEES.map(async (fee) =>
      (await v3PoolExists(mid, last, fee)) ? fee : null,
    ),
  );
  const liveTails = tails.filter((fee): fee is number => fee != null);
  if (liveTails.length === 0) return null;

  let best: { path: Hex; quoted: bigint } | null = null;
  const heads = await Promise.all(
    V3_FEES.map(async (fee) =>
      (await v3PoolExists(tokens[0] as Address, mid, fee)) ? fee : null,
    ),
  );
  const liveHeads = heads.filter((fee): fee is number => fee != null);
  const quotes = await Promise.all(
    liveHeads.flatMap((head) =>
      liveTails.map(async (tail) => {
        const path = encodeV3Path(tokens, [head, tail]);
        const quoted = await quoteV3Path(path, amountIn);
        return quoted > 0n ? { path, quoted } : null;
      }),
    ),
  );
  for (const row of quotes) {
    if (row && (!best || row.quoted > best.quoted)) best = row;
  }
  return best;
}

async function bestV4Hop(pair: Address, quote: Address, amountIn: bigint) {
  let best: {
    key: ReturnType<typeof resolvePoolKey>;
    zeroForOne: boolean;
    quoted: bigint;
  } | null = null;
  const rows = await Promise.all(
    V4_ETH_CANDIDATES.map(async (cand) => {
      const key = launchPoolKeyFor(pair, quote, cand.hook, cand.fee, cand.tickSpacing);
      const poolId = launchPoolIdFor(pair, quote, cand.hook, cand.fee, cand.tickSpacing);
      try {
        const slot0 = await publicClient.readContract({
          address: protocolOf().v4StateView,
          abi: stateViewAbi,
          functionName: "getSlot0",
          args: [poolId],
        });
        if (slot0[0] === 0n) return null;
        const liquidity = await publicClient.readContract({
          address: protocolOf().v4StateView,
          abi: stateViewAbi,
          functionName: "getLiquidity",
          args: [poolId],
        });
        if (liquidity === 0n) return null;
      } catch {
        return null;
      }
      const tokenIs0 = pair.toLowerCase() < quote.toLowerCase();
      const quoted = await quoteExactIn({
        token: pair,
        tokenIsCurrency0: tokenIs0,
        buying: false,
        amountIn,
        pool: {
          pairAsset: quote,
          fee: cand.fee,
          tickSpacing: cand.tickSpacing,
          hook: cand.hook,
        },
      });
      if (quoted <= 0n) return null;
      return { key, zeroForOne: tokenIs0, quoted };
    }),
  );
  for (const row of rows) {
    if (row && (!best || row.quoted > best.quoted)) best = row;
  }
  return best;
}

function encodeV4HopFromRouter({
  poolKey,
  zeroForOne,
  amountOutMin,
  input,
  output,
  takeTo,
}: {
  poolKey: ReturnType<typeof resolvePoolKey>;
  zeroForOne: boolean;
  amountOutMin: bigint;
  input: Address;
  output: Address;
  takeTo: Address;
}): Hex {
  const actions = encodePacked(
    ["uint8", "uint8", "uint8"],
    [SETTLE, SWAP_EXACT_IN_SINGLE, TAKE],
  );
  const settleParams = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }, { type: "bool" }],
    [input, CONTRACT_BALANCE, false],
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
        amountIn: 0n,
        amountOutMinimum: amountOutMin,
        sqrtPriceLimitX96: 0n,
        hookData: "0x",
      },
    ],
  );
  const takeParams = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint256" }],
    [output, takeTo, 0n],
  );
  return encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    [actions, [settleParams, swapParams, takeParams]],
  );
}

function encodeV2Hop(path: Address[], minEth: bigint): Hex {
  return encodeAbiParameters(
    [
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "address[]" },
      { type: "bool" },
    ],
    [ADDRESS_THIS, CONTRACT_BALANCE, minEth, path, false],
  );
}

async function executeRouter(
  wallet: ConnectedWallet,
  commands: number[],
  inputs: Hex[],
  value: bigint,
) {
  if (commands.length === 0 || commands.length !== inputs.length) {
    throw new Error("Invalid router commands.");
  }
  const packed = encodePacked(
    commands.map(() => "uint8" as const),
    commands as never,
  );
  const hash = await writePrepared({
    wallet,
    address: protocolOf().v4UniversalRouter,
    abi: routerAbi,
    functionName: "execute",
    args: [packed, inputs, BigInt(Math.floor(Date.now() / 1000) + 180)],
    value,
    gasFallback: 2_000_000n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Swap reverted.");
  return hash;
}

async function preparePermit2(
  wallet: ConnectedWallet,
  account: Address,
  token: Address,
  needed: bigint,
): Promise<Hex | null> {
  const protocol = protocolOf();
  const allowance = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account, protocol.permit2],
  });
  if (allowance < needed) {
    const hash = await writePrepared({
      wallet,
      address: token,
      abi: erc20Abi,
      functionName: "approve",
      args: [protocol.permit2, PERMIT2_MAX],
      gasFallback: 80_000n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("Approve reverted.");
  }

  const permit = await publicClient.readContract({
    address: protocol.permit2,
    abi: permit2Abi,
    functionName: "allowance",
    args: [account, token, protocol.v4UniversalRouter],
  });
  const now = Math.floor(Date.now() / 1000);
  if (permit[0] >= needed && Number(permit[1]) > now + 60) return null;

  const signed = await signPermit2(wallet, account, token, Number(permit[2]));
  if (signed) return signed;

  const hash = await writePrepared({
    wallet,
    address: protocol.permit2,
    abi: permit2Abi,
    functionName: "approve",
    args: [token, protocol.v4UniversalRouter, PERMIT2_MAX, now + 30 * 24 * 60 * 60],
    gasFallback: 80_000n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Permit2 approve reverted.");
  return null;
}

async function signPermit2(
  wallet: ConnectedWallet,
  account: Address,
  token: Address,
  nonce: number,
): Promise<Hex | null> {
  const protocol = protocolOf();
  const network = getNetwork();
  const now = Math.floor(Date.now() / 1000);
  const expiration = now + 30 * 24 * 60 * 60;
  const sigDeadline = BigInt(now + 30 * 60);
  const message = {
    details: {
      token,
      amount: PERMIT2_MAX,
      expiration,
      nonce,
    },
    spender: protocol.v4UniversalRouter,
    sigDeadline,
  };
  try {
    await wallet.switchChain(network.chainId);
    const provider = await wallet.getEthereumProvider();
    const walletClient = createWalletClient({
      account,
      chain: network.chain,
      transport: custom(provider),
    });
    const signature = await walletClient.signTypedData({
      account,
      domain: {
        name: "Permit2",
        chainId: network.chainId,
        verifyingContract: protocol.permit2,
      },
      types: {
        PermitDetails: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint160" },
          { name: "expiration", type: "uint48" },
          { name: "nonce", type: "uint48" },
        ],
        PermitSingle: [
          { name: "details", type: "PermitDetails" },
          { name: "spender", type: "address" },
          { name: "sigDeadline", type: "uint256" },
        ],
      },
      primaryType: "PermitSingle",
      message,
    });
    return encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            {
              name: "details",
              type: "tuple",
              components: [
                { name: "token", type: "address" },
                { name: "amount", type: "uint160" },
                { name: "expiration", type: "uint48" },
                { name: "nonce", type: "uint48" },
              ],
            },
            { name: "spender", type: "address" },
            { name: "sigDeadline", type: "uint256" },
          ],
        },
        { type: "bytes" },
      ],
      [message, signature],
    );
  } catch {
    return null;
  }
}
