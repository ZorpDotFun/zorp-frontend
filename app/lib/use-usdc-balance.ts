import { useEffect, useState } from "react";
import { erc20Abi, formatUnits, type Address } from "viem";
import { publicClient } from "./factory";
import { protocolOf } from "./networks";
import { NETWORK_EVENT } from "./active-network";
import { MARKET_REFRESH } from "./token-market";

export function formatUsdcBalance(raw: bigint) {
  const value = Number(formatUnits(raw, protocolOf().pairDecimals));
  if (!Number.isFinite(value)) return "0.00";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function useErc20Balance(
  token: Address | undefined,
  owner: Address | undefined,
  decimals: number,
) {
  const [raw, setRaw] = useState<bigint | null>(null);

  useEffect(() => {
    if (!token || !owner) {
      setRaw(null);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const balance = await publicClient.readContract({
          address: token as Address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [owner as Address],
        });
        if (!cancelled) setRaw(balance);
      } catch {
        if (!cancelled) setRaw(null);
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    window.addEventListener(MARKET_REFRESH, load);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener(MARKET_REFRESH, load);
    };
  }, [token, owner]);

  return {
    raw,
    formatted:
      raw == null
        ? null
        : Number(formatUnits(raw, decimals)).toLocaleString(undefined, {
            maximumFractionDigits: decimals > 6 ? 4 : 2,
          }),
  };
}

export function useUsdcBalance(address: Address | undefined) {
  const [raw, setRaw] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setRaw(null);
      return;
    }
    let cancelled = false;

    async function load() {
      try {
        const balance = await publicClient.readContract({
          address: protocolOf().pairAsset,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address as Address],
        });
        if (!cancelled) {
          setRaw(balance);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Balance unavailable.");
        }
      }
    }

    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    window.addEventListener(MARKET_REFRESH, load);
    window.addEventListener(NETWORK_EVENT, load);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener(MARKET_REFRESH, load);
      window.removeEventListener(NETWORK_EVENT, load);
    };
  }, [address]);

  return {
    raw,
    formatted: raw === null ? null : formatUsdcBalance(raw),
    error,
  };
}
