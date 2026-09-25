import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";
import { arcChain, robinhoodChain } from "../lib/chains";
import { evmWallets } from "../lib/evm-wallets";

export default function PrivyRoot({ children }: { children: ReactNode }) {
  const appId = import.meta.env.VITE_PRIVY_APP_ID;
  const clientId = import.meta.env.VITE_PRIVY_CLIENT_ID;
  if (!appId) return children;

  return (
    <PrivyProvider
      appId={appId}
      {...(clientId ? { clientId } : {})}
      config={{
        defaultChain: robinhoodChain,
        supportedChains: [robinhoodChain, arcChain],
        loginMethods: ["wallet"],
        appearance: {
          theme: "light",
          accentColor: "#7BEC1E",
          showWalletLoginFirst: true,
          walletChainType: "ethereum-only",
          walletList: [...evmWallets],
        },
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "off" },
          showWalletUIs: false,
        },
        externalWallets: {
          walletConnect: { enabled: true },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
