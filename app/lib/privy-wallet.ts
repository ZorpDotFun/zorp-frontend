type WalletAuth = {
  authenticated: boolean;
  hasWallet: boolean;
  login: (options: {
    loginMethods: ["wallet"];
    walletChainType: "ethereum-only";
  }) => void;
  connectWallet: (options: { walletChainType: "ethereum-only" }) => void;
  linkWallet: (options: { walletChainType: "ethereum-only" }) => void;
};

const walletOnly = {
  walletChainType: "ethereum-only" as const,
};

export function openWalletAuth({
  authenticated,
  hasWallet,
  login,
  connectWallet,
  linkWallet,
}: WalletAuth) {
  if (!authenticated) {
    login({ loginMethods: ["wallet"], ...walletOnly });
    return;
  }
  if (!hasWallet) {
    linkWallet(walletOnly);
    return;
  }
  connectWallet(walletOnly);
}
