import {
  useConnectWallet,
  useLinkAccount,
  useLogin,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";
import { useEffect, useState } from "react";
import { formatUnits, type Address } from "viem";
import { protocolOf } from "../lib/networks";
import {
  claimCreatorFees,
  explorerAddress,
  explorerTx,
  readCreatorFees,
  readLaunchFees,
} from "../lib/factory";
import { paysCreator } from "../lib/fee-models";
import { openWalletAuth } from "../lib/privy-wallet";
import { shortenAddress } from "../lib/tokens";
import { usePrivyReady } from "./app-privy-provider";

export function CreatorFees({
  token,
  creator,
}: {
  token: string;
  creator: string;
}) {
  const privyReady = usePrivyReady();
  const { wallets } = useWallets();
  const wallet =
    wallets.find((item) => item.walletClientType === "metamask") ?? wallets[0];
  const isCreator =
    Boolean(wallet?.address) &&
    wallet.address.toLowerCase() === creator.toLowerCase();
  const [raw, setRaw] = useState<bigint | null>(null);
  const [creatorShare, setCreatorShare] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [value, fees] = await Promise.all([
          readCreatorFees(token as Address, creator as Address),
          readLaunchFees(token as Address),
        ]);
        if (cancelled) return;
        setRaw(value);
        setCreatorShare(fees ? paysCreator(fees) : value > 0n);
      } catch {
        if (!cancelled) {
          setRaw(0n);
          setCreatorShare(false);
        }
      }
    }
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [token, creator]);

  if (!privyReady || !isCreator) return null;
  if (creatorShare === false && (raw == null || raw === 0n)) return null;
  if (creatorShare === null && raw == null) return null;

  const amount = formatClaimable(raw);

  return (
    <section className="rounded-3xl bg-raised px-5 py-5 ring-1 ring-line">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-medium tracking-[0.16em] text-muted uppercase">
          Creator fees
        </p>
        <CreatorClaim
          token={token}
          creator={creator}
          raw={raw}
          onClaimed={() => setRaw(0n)}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="font-display text-[22px] tracking-wide text-ink">{amount}</p>
          <p className="mt-1 text-[13px] text-muted">
            Unclaimed creator tax for ${shortenAddress(token)}
          </p>
        </div>
        <div className="sm:text-right">
          <p className="font-display text-[22px] tracking-wide text-ink">{amount}</p>
          <p className="mt-1 text-[13px] text-muted">
            Claimable now, paid to{" "}
            <a
              href={explorerAddress(creator)}
              target="_blank"
              rel="noreferrer"
              className="hover:text-yellowell"
            >
              {shortenAddress(creator)}
            </a>
          </p>
        </div>
      </div>

      <p className="mt-4 text-[13px] text-muted">
        Payable to {shortenAddress(creator)}. Connect that wallet to claim.
      </p>
    </section>
  );
}

function CreatorClaim({
  token,
  creator,
  raw,
  onClaimed,
}: {
  token: string;
  creator: string;
  raw: bigint | null;
  onClaimed: () => void;
}) {
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { login } = useLogin();
  const { connectWallet } = useConnectWallet();
  const { linkWallet } = useLinkAccount();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  const wallet =
    wallets.find((item) => item.walletClientType === "metamask") ?? wallets[0];
  const isCreator =
    Boolean(wallet?.address) &&
    wallet.address.toLowerCase() === creator.toLowerCase();

  if (!isCreator) return null;

  async function onClaim() {
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
    if (!raw || raw === 0n) {
      setError("Nothing to claim.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const tx = await claimCreatorFees({
        wallet,
        token: token as Address,
      });
      setHash(tx);
      onClaimed();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Claim failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={!ready || pending || raw == null || raw === 0n}
        onClick={() => void onClaim()}
        className="h-9 rounded-full bg-yellowell px-4 text-[13px] font-bold text-black disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Claiming…" : "Claim"}
      </button>
      {error ? <p className="text-[12px] text-down">{error}</p> : null}
      {hash ? (
        <a
          href={explorerTx(hash)}
          target="_blank"
          rel="noreferrer"
          className="text-[12px] text-yellowell"
        >
          Claimed
        </a>
      ) : null}
    </div>
  );
}

function formatClaimable(raw: bigint | null) {
  if (raw == null) return "…";
  const protocol = protocolOf();
  return `${Number(formatUnits(raw, protocol.pairDecimals)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: protocol.pairDecimals > 6 ? 6 : 2,
  })} ${protocol.pairSymbol}`;
}
