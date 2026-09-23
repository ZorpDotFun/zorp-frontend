import { useWallets } from "@privy-io/react-auth";
import { useEffect } from "react";
import { NETWORKS } from "../lib/networks";
import { useNetwork } from "../lib/use-network";
import { usePrivyReady } from "./app-privy-provider";
import type { NetworkId } from "../lib/active-network";

const OPTIONS: { id: NetworkId; label: string }[] = [
  { id: "robinhood", label: "Robinhood" },
  { id: "arc", label: "Arc" },
];

export function ChainSwitch() {
  const { id, setNetwork } = useNetwork();
  const privyReady = usePrivyReady();

  return (
    <div
      className="flex h-9 items-center rounded-full bg-surface p-0.5 ring-1 ring-line"
      role="group"
      aria-label="Network"
    >
      {privyReady ? <WalletChainSync chainId={NETWORKS[id].chainId} /> : null}
      {OPTIONS.map((option) => {
        const active = id === option.id;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => {
              if (option.id !== id) setNetwork(option.id);
            }}
            className={`h-8 rounded-full px-2.5 text-[11px] font-medium tracking-wide transition sm:px-3 sm:text-[12px] ${
              active ? "bg-yellowell text-black" : "text-ink/70 hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
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
