import { useEffect, useState } from "react";
import {
  useConnectWallet,
  useLinkAccount,
  useLogin,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";
import { openWalletAuth } from "../lib/privy-wallet";
import { shortenAddress } from "../lib/tokens";
import { ProfileAvatar } from "./profile-avatar";

export function ConnectWalletButton({
  compact = false,
  autoOpen = false,
}: {
  compact?: boolean;
  autoOpen?: boolean;
}) {
  const { authenticated, logout, ready } = usePrivy();
  const { login } = useLogin({
    onError: (error) => {
      console.error("Privy login failed", error);
    },
  });
  const { connectWallet } = useConnectWallet();
  const { linkWallet } = useLinkAccount();
  const { wallets } = useWallets();
  const address = wallets[0]?.address;
  const [openWhenReady, setOpenWhenReady] = useState(autoOpen);

  useEffect(() => {
    if (autoOpen) setOpenWhenReady(true);
  }, [autoOpen]);

  useEffect(() => {
    if (!openWhenReady || !ready || (authenticated && address)) return;
    setOpenWhenReady(false);
    openWalletAuth({
      authenticated,
      hasWallet: Boolean(address),
      login,
      connectWallet,
      linkWallet,
    });
  }, [
    openWhenReady,
    ready,
    authenticated,
    address,
    login,
    connectWallet,
    linkWallet,
  ]);

  if (authenticated && address) {
    return (
      <button
        type="button"
        onClick={() => void logout()}
        className="inline-flex h-10 max-w-[10rem] items-center gap-2 truncate rounded-full bg-surface px-3 text-[15px] font-medium text-ink ring-1 ring-line transition hover:ring-yellowell sm:max-w-none sm:px-4"
      >
        <ProfileAvatar address={address} className="size-5" />
        {shortenAddress(address)}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (!ready) {
          setOpenWhenReady(true);
          return;
        }
        openWalletAuth({
          authenticated,
          hasWallet: Boolean(address),
          login,
          connectWallet,
          linkWallet,
        });
      }}
      className={`h-10 rounded-full bg-yellowell text-[15px] font-bold text-black transition hover:brightness-110 ${
        compact ? "px-3.5" : "px-5"
      }`}
    >
      {compact ? "Connect" : "Connect wallet"}
    </button>
  );
}
