import { useEffect, useState, type ComponentType } from "react";
import { usePrivyReady } from "./app-privy-provider";

export function ConnectWallet() {
  const privyReady = usePrivyReady();
  const [Button, setButton] = useState<ComponentType | null>(null);

  useEffect(() => {
    if (!privyReady) {
      setButton(null);
      return;
    }
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
        disabled
        className="h-9 rounded-full bg-yellowell px-4 text-[13px] font-bold text-black opacity-70"
      >
        Connect wallet
      </button>
    );
  }

  return <Button />;
}
