import {
  useConnectWallet,
  useLinkAccount,
  useLogin,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";
import { useState } from "react";
import { Link } from "react-router";
import { explorerAddress, explorerTx, launchToken } from "../lib/factory";
import { validateFees, type FeeConfig } from "../lib/fee-models";
import { openWalletAuth } from "../lib/privy-wallet";
import { shortenAddress } from "../lib/tokens";
import { usePrivyReady } from "./app-privy-provider";

const buttonClass =
  "h-12 w-full rounded-full bg-yellowell text-[15px] font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";

export type LaunchSubmitProps = {
  name: string;
  ticker: string;
  description: string;
  image: string;
  twitter: string;
  telegram: string;
  website: string;
  firstBuyUsdc: string;
  fees: FeeConfig;
  tributeRecipient: string;
};

export function LaunchSubmit(props: LaunchSubmitProps) {
  const privyReady = usePrivyReady();
  if (!privyReady) {
    return (
      <button type="button" disabled className={buttonClass}>
        Connect wallet
      </button>
    );
  }
  return <LaunchSubmitLive {...props} />;
}

function LaunchSubmitLive({
  name,
  ticker,
  description,
  image,
  twitter,
  telegram,
  website,
  firstBuyUsdc,
  fees,
  tributeRecipient,
}: LaunchSubmitProps) {
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { login } = useLogin();
  const { connectWallet } = useConnectWallet();
  const { linkWallet } = useLinkAccount();
  const [status, setStatus] = useState<"idle" | "pending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ token: string; hash: string } | null>(
    null,
  );

  async function onLaunch() {
    const wallet =
      wallets.find((item) => item.walletClientType === "metamask") ?? wallets[0];
    if (!authenticated || !wallet) {
      openWalletAuth({
        authenticated,
        hasWallet: Boolean(wallet),
        login,
        connectWallet,
        linkWallet,
      });
      return;
    }
    if (!name.trim() || !ticker.trim()) {
      setError("Name and ticker are required.");
      return;
    }
    const feeError = validateFees(fees);
    if (feeError) {
      setError(feeError);
      return;
    }

    setStatus("pending");
    setError(null);
    try {
      const launched = await launchToken({
        wallet,
        name: name.trim(),
        symbol: ticker.trim().toUpperCase(),
        description: description.trim(),
        image: image.trim(),
        twitter: twitter.trim(),
        telegram: telegram.trim(),
        website: website.trim(),
        firstBuyUsdc,
        fees,
        tributeRecipient,
      });
      setResult(launched);
      setStatus("done");
    } catch (cause) {
      setStatus("idle");
      setError(cause instanceof Error ? cause.message : "Launch failed.");
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={!ready || status === "pending"}
        onClick={() => void onLaunch()}
        className={buttonClass}
      >
        {!authenticated
          ? "Connect wallet"
          : status === "pending"
            ? "Launching…"
            : status === "done"
              ? "Launched"
              : "Launch token"}
      </button>
      {error ? <p className="text-[13px] text-down">{error}</p> : null}
      {result ? (
        <div className="space-y-2 text-[13px] text-ink">
          <p>
            {ticker.toUpperCase()} is live. Token{" "}
            <a
              href={explorerAddress(result.token)}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-yellowell/50 underline-offset-2 hover:text-yellowell"
            >
              {shortenAddress(result.token)}
            </a>
            {" · "}
            <a
              href={explorerTx(result.hash)}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-yellowell/50 underline-offset-2 hover:text-yellowell"
            >
              tx
            </a>
          </p>
          <Link
            to={`/token/${result.token}`}
            className="inline-flex h-10 items-center rounded-full bg-ink px-4 text-[13px] font-bold text-canvas"
          >
            Open token page
          </Link>
        </div>
      ) : null}
    </div>
  );
}
