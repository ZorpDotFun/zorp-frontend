import { createPublicClient, getAddress, parseAbi, type Address } from "viem";
import { rhTokenFactories } from "./addresses";
import {
  ROBINHOOD_CHAIN_ID,
  robinhoodChain,
  robinhoodTransport,
} from "./chains";
import { rhLaunchFactoryAbi } from "./factory";
import { SITE_ORIGIN } from "./site-meta";
import { tokenImageDisplaySrc } from "./token-image";

const erc20Abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function image() view returns (string)",
]);

export type TokenListToken = {
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  tags?: string[];
};

export type ZorpTokenList = {
  name: string;
  timestamp: string;
  version: { major: number; minor: number; patch: number };
  logoURI: string;
  keywords: string[];
  tags: Record<string, { name: string; description: string }>;
  tokens: TokenListToken[];
};

const client = createPublicClient({
  chain: robinhoodChain,
  transport: robinhoodTransport(),
});

let cache: { at: number; body: ZorpTokenList } | null = null;
const TTL_MS = 60_000;

export async function buildZorpTokenList(): Promise<ZorpTokenList> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.body;

  const addresses: Address[] = [];
  const seen = new Set<string>();
  for (const factory of rhTokenFactories()) {
    try {
      const count = Number(
        await client.readContract({
          address: factory,
          abi: rhLaunchFactoryAbi,
          functionName: "launchCount",
        }),
      );
      if (count === 0) continue;
      const rows = (await client.multicall({
        allowFailure: false,
        contracts: Array.from({ length: count }, (_, i) => ({
          address: factory,
          abi: rhLaunchFactoryAbi,
          functionName: "allTokens" as const,
          args: [BigInt(i)],
        })),
      })) as Address[];
      for (const raw of rows) {
        const key = raw.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        addresses.push(raw);
      }
    } catch {
      /* skip a dead pad */
    }
  }

  const tokens: TokenListToken[] = [];
  for (const raw of addresses) {
    const address = getAddress(raw);
    try {
      const [name, symbol, image] = await client.multicall({
        allowFailure: false,
        contracts: [
          { address, abi: erc20Abi, functionName: "name" },
          { address, abi: erc20Abi, functionName: "symbol" },
          { address, abi: erc20Abi, functionName: "image" },
        ],
      });
      const logoURI = tokenImageDisplaySrc(image);
      tokens.push({
        chainId: ROBINHOOD_CHAIN_ID,
        address,
        name,
        symbol,
        decimals: 18,
        ...(logoURI ? { logoURI } : {}),
        tags: ["zorp"],
      });
    } catch {
      /* skip a broken row */
    }
  }

  const body: ZorpTokenList = {
    name: "Zorp",
    timestamp: new Date().toISOString(),
    version: { major: 1, minor: tokens.length, patch: 0 },
    logoURI: `${SITE_ORIGIN}/assets/logos/z-3d.png`,
    keywords: ["zorp", "robinhood", "launchpad"],
    tags: {
      zorp: {
        name: "Zorp",
        description: "Launched through the Zorp factory on Robinhood Chain.",
      },
    },
    tokens,
  };
  cache = { at: Date.now(), body };
  return body;
}
