import {
  createWalletClient,
  custom,
  encodeFunctionData,
  erc20Abi,
  isAddress,
  parseEventLogs,
  parseUnits,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { TARGET_FDV_USD } from "./addresses";
import { ARC_RPC_PRIMARY } from "./chains";
import { PROTOCOL_SWAP_FEE_BPS, presetFees, validateFees, type FeeConfig } from "./fee-models";
import { getNetwork, getPublicClient, protocolOf } from "./networks";
import { toIpfsUri } from "./token-image";
import type { Token } from "./tokens";
import { requestTokenVerification } from "./verify-launch-token";

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
};

function sameAddress(left: Address, right: Address) {
  return left.toLowerCase() === right.toLowerCase();
}

export async function readProtocolFeeBps() {
  const protocol = protocolOf();
  if (!protocol.deployed) return PROTOCOL_SWAP_FEE_BPS;
  try {
    return Number(
      await publicClient.readContract({
        address: protocol.buyback,
        abi: buybackAbi,
        functionName: "protocolFeeBps",
      }),
    );
  } catch {
    return PROTOCOL_SWAP_FEE_BPS;
  }
}

export async function assertLaunchReady() {
  const protocol = protocolOf();
  if (!protocol.deployed) {
    throw new Error(
      `Zorp is not live on ${getNetwork().name} yet. Deploy with DeployRobinhood.s.sol, then set VITE_RH_* addresses.`,
    );
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

export function asError(error: unknown) {
  const parts: string[] = [];
  if (error && typeof error === "object") {
    const row = error as {
      shortMessage?: string;
      message?: string;
      details?: string;
      cause?: { details?: string; message?: string };
    };
    if (row.shortMessage) parts.push(row.shortMessage);
    if (row.message) parts.push(row.message);
    if (row.details) parts.push(row.details);
    if (row.cause?.details) parts.push(row.cause.details);
    if (row.cause?.message) parts.push(row.cause.message);
  } else if (error instanceof Error) {
    parts.push(error.message);
  }
  const text = parts.join(" ");
  if (/rate limit|exceeds defined limit/i.test(text)) {
    return `${getNetwork().name} RPC is rate limited. Wait a few seconds and try again.`;
  }
  if (/arc-scan|could not complete this request|No answer was obtained|Failed to fetch|eth_getTransactionCount|eth_gasPrice/i.test(text)) {
    const network = getNetwork();
    const rpc =
      network.id === "arc" ? ARC_RPC_PRIMARY : network.chain.rpcUrls.default.http[0];
    return `Wallet RPC did not respond. In Rabby or MetaMask, edit ${network.name} and set RPC URL to ${rpc}.`;
  }
  if (/user rejected|denied transaction|rejected the request/i.test(text)) {
    return "Signature was cancelled. Confirm the wallet popup, or switch the connected wallet to MetaMask.";
  }
  if (parts[0]) return parts[0];
  return "Transaction failed.";
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

  const [nonce, gasPrice] = await Promise.all([
    publicClient.getTransactionCount({ address: account }),
    publicClient.getGasPrice(),
  ]);

  let gas = gasFallback;
  try {
    const estimated = await publicClient.estimateGas({
      account,
      to: address,
      data,
      value,
    });
    gas = (estimated * 13n) / 10n;
  } catch {
    // Wallet RPCs often fail here; a padded fallback is enough to send.
  }

  return walletClient.sendTransaction({
    account,
    chain: network.chain,
    to: address,
    data,
    value,
    nonce,
    gas,
    gasPrice,
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
    hue: hueFromAddress(address),
    recentBuys: 0,
    tokenIsCurrency0,
  };
}

export async function readLaunch(address: Address): Promise<Token | null> {
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

export async function readLaunchCount(): Promise<number> {
  const protocol = protocolOf();
  if (!protocol.deployed) return 0;
  const count = await publicClient.readContract({
    address: protocol.factory,
    abi: launchFactoryAbi,
    functionName: "launchCount",
  });
  return Number(count);
}

export async function readLaunches(): Promise<Token[]> {
  const protocol = protocolOf();
  if (!protocol.deployed) return [];
  const count = await publicClient.readContract({
    address: protocol.factory,
    abi: launchFactoryAbi,
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
        abi: launchFactoryAbi,
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
          abi: launchFactoryAbi,
          functionName: "allTokens",
          args: [index],
        }),
      ),
    );
  }
}

async function readLaunchRows(addresses: Address[]): Promise<Token[]> {
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
}): Promise<LaunchResult> {
  const account = wallet.address as Address;
  const feeError = validateFees(fees);
  if (feeError) throw new Error(feeError);
  const tribute = tributeRecipient?.trim();
  if (tribute && !isAddress(tribute)) {
    throw new Error("Tribute recipient must be a valid address.");
  }

  await assertLaunchReady();

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

  requestTokenVerification({ address: token, hash });
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

export async function readCreatorFees(token: Address, creator: Address) {
  const protocol = protocolOf();
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
