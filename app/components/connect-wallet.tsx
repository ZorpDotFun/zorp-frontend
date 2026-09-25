import { useEffect, useState, type ComponentType } from "react";
import { loadPrivyRoot, usePrivyReady } from "./app-privy-provider";

type WalletButton = ComponentType<{ compact?: boolean; autoOpen?: boolean }>;

const buttonClass = (compact: boolean) =>
  `h-10 rounded-full bg-yellowell text-[15px] font-bold text-black transition hover:brightness-110 ${
    compact ? "px-3.5" : "px-5"
  }`;

let buttonLoad: Promise<WalletButton> | null = null;

function loadWalletButton() {
  buttonLoad ??= import("./connect-wallet-button")
    .then((mod) => mod.ConnectWalletButton)
    .catch((error) => {
      buttonLoad = null;
      throw error;
    });
  return buttonLoad;
}

export function ConnectWallet({ compact = false }: { compact?: boolean }) {
  const privyReady = usePrivyReady();
  const [Button, setButton] = useState<WalletButton | null>(null);
  const [queued, setQueued] = useState(false);

  useEffect(() => {
    if (!privyReady) return;
    let cancelled = false;
    void loadWalletButton()
      .then((Loaded) => {
        if (!cancelled) setButton(() => Loaded);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [privyReady]);

  if (!Button) {
    return (
      <button
        type="button"
        onClick={() => {
          setQueued(true);
          void loadPrivyRoot();
        }}
        className={buttonClass(compact)}
      >
        {compact ? "Connect" : "Connect wallet"}
      </button>
    );
  }

  return <Button compact={compact} autoOpen={queued} />;
}
