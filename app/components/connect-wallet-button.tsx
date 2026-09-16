import {
  useConnectWallet,
  useLinkAccount,
  useLogin,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";
import { openWalletAuth } from "../lib/privy-wallet";
import { shortenAddress } from "../lib/tokens";

export function ConnectWalletButton() {
  const { authenticated, logout } = usePrivy();
  const { login } = useLogin({
    onError: (error) => {
      console.error("Privy login failed", error);
    },
  });
  const { connectWallet } = useConnectWallet();
  const { linkWallet } = useLinkAccount();
  const { wallets } = useWallets();
  const address = wallets[0]?.address;

  if (authenticated && address) {
    return (
      <button
        type="button"
        onClick={() => void logout()}
        className="h-9 rounded-full bg-surface px-3.5 text-[13px] font-medium text-ink ring-1 ring-line transition hover:ring-yellowell"
      >
        {shortenAddress(address)}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() =>
        openWalletAuth({
          authenticated,
          hasWallet: Boolean(address),
          login,
          connectWallet,
          linkWallet,
        })
      }
      className="h-9 rounded-full bg-yellowell px-4 text-[13px] font-bold text-black transition hover:brightness-110"
    >
      Connect wallet
    </button>
  );
}
