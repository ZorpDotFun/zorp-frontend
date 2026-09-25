import { useWallets } from "@privy-io/react-auth";
import { useEffect } from "react";
import { NETWORKS } from "../lib/networks";
import { usePrivyReady } from "./app-privy-provider";

/** Keep a connected wallet on Robinhood. No chain picker — Arc is off. */
export function RobinhoodWalletSync() {
  const privyReady = usePrivyReady();
  if (!privyReady) return null;
  return <WalletChainSync chainId={NETWORKS.robinhood.chainId} />;
}

function WalletChainSync({ chainId }: { chainId: number }) {
  const { wallets } = useWallets();
  const wallet = wallets[0];

  useEffect(() => {
    if (!wallet) return;
    void wallet.switchChain(chainId).catch(() => {});
  }, [chainId, wallet]);

  return null;
}
