import { usePrivy, useWallets } from "@privy-io/react-auth";
import type { Address } from "viem";
import { useUsdcBalance } from "../lib/use-usdc-balance";
import { useNetwork } from "../lib/use-network";

export function WalletUsdcBalance() {
  const { network } = useNetwork();
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const address = wallets[0]?.address as Address | undefined;
  const { formatted, error } = useUsdcBalance(authenticated ? address : undefined);

  if (!authenticated || !address) {
    return <span className="text-[12px] text-muted">Connect wallet</span>;
  }
  if (error) {
    return <span className="text-[12px] text-muted">Balance unavailable</span>;
  }
  if (formatted === null) {
    return <span className="text-[12px] text-muted">…</span>;
  }

  return (
    <span className="text-[12px] font-medium text-ink">
      {formatted} <span className="text-muted">{network.protocol.pairSymbol}</span>
    </span>
  );
}
