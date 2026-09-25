import { useEffect, useRef, useState, type ComponentType } from "react";
import { usePrivyReady } from "./app-privy-provider";

type WalletButton = ComponentType<{ compact?: boolean; autoOpen?: boolean }>;

export function ConnectWallet({ compact = false }: { compact?: boolean }) {
  const privyReady = usePrivyReady();
  const [Button, setButton] = useState<WalletButton | null>(null);
  const queued = useRef(false);

  useEffect(() => {
    if (!privyReady) return;
    let cancelled = false;
    void import("./connect-wallet-button").then((mod) => {
      if (!cancelled) setButton(() => mod.ConnectWalletButton);
    });
    return () => {
      cancelled = true;
    };
  }, [privyReady]);

  if (!Button) {
    return (
      <button
        type="button"
        onClick={() => {
          queued.current = true;
        }}
        className={`h-9 rounded-full bg-yellowell text-[13px] font-bold text-black transition hover:brightness-110 ${
          compact ? "px-3" : "px-4"
        }`}
      >
        {compact ? "Connect" : "Connect wallet"}
      </button>
    );
  }

  return <Button compact={compact} autoOpen={queued.current} />;
}
