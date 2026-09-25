import type { Address } from "viem";
import {
  readBlockscoutHolders,
  readBlockscoutTrades,
  blockscoutSupported,
} from "./blockscout-market.server";
import {
  readEtherscanHolders,
  readEtherscanTrades,
} from "./etherscan.server";
import type { MarketHolder, MarketTrade } from "./token-market";

type MarketInput = {
  token: Address;
  creator?: string;
  poolId?: string;
  pairAsset?: string;
  tokenIsCurrency0: boolean;
  chainId: number;
};

/** Etherscan first. Blockscout immediately if that fails or is empty. */
export async function readIndexedHolders(input: MarketInput): Promise<MarketHolder[]> {
  try {
    const rows = await withDeadline(readEtherscanHolders(input), 3_500);
    if (rows.length > 0) return rows;
  } catch {
    /* Blockscout is the instant backup */
  }
  if (!blockscoutSupported(input.chainId)) return [];
  return readBlockscoutHolders(input);
}

export async function readIndexedTrades(input: MarketInput): Promise<MarketTrade[]> {
  try {
    const rows = await withDeadline(readEtherscanTrades(input), 3_500);
    if (rows.length > 0) return rows;
  } catch {
    /* Blockscout is the instant backup */
  }
  if (!blockscoutSupported(input.chainId)) return [];
  return readBlockscoutTrades(input);
}

function withDeadline<T>(promise: Promise<T>, ms: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("deadline")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
