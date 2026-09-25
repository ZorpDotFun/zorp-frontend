import {
  useConnectWallet,
  useLinkAccount,
  useLogin,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";
import { useEffect, useState } from "react";
import { formatUnits, type Address } from "viem";
import {
  claimCreatorFees,
  explorerAddress,
  explorerTx,
  pairLabel,
  readLaunchFees,
} from "../lib/factory";
import { knownPairSymbol } from "../lib/quote-tokens";
import { readRhFeeEstimate } from "../lib/uncollected-fees";
import { paysCreator } from "../lib/fee-models";
import { openWalletAuth } from "../lib/privy-wallet";
import { shortenAddress } from "../lib/tokens";
import { usePrivyReady } from "./app-privy-provider";

export function CreatorFees({
  token,
  creator,
  pair,
  pairAsset: pairHint,
}: {
  token: string;
  creator: string;
  pair?: string;
  pairAsset?: string;
}) {
  const privyReady = usePrivyReady();
  const { wallets } = useWallets();
  const wallet =
    wallets.find((item) => item.walletClientType === "metamask") ?? wallets[0];
  const isCreator =
    Boolean(wallet?.address) &&
    wallet.address.toLowerCase() === creator.toLowerCase();
  const [raw, setRaw] = useState<bigint | null>(null);
  const [decimals, setDecimals] = useState(18);
  const [pairSymbol, setPairSymbol] = useState(
    () => (pairHint ? knownPairSymbol(pairHint) : null) ?? pair ?? "…",
  );
  const [creatorShare, setCreatorShare] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [estimate, fees] = await Promise.all([
          readRhFeeEstimate(token as Address, creator as Address),
          readLaunchFees(token as Address),
        ]);
        if (cancelled) return;
        const value = estimate ? estimate.claimablePair + estimate.creatorPair : 0n;
        setRaw(value);
        setDecimals(estimate?.pairDecimals ?? 18);
        const asset = estimate?.pairAsset ?? (pairHint as Address | undefined) ?? null;
        if (asset) {
          const known = knownPairSymbol(asset);
          const label = known ?? (await pairLabel(asset));
          if (cancelled) return;
          setPairSymbol(label);
        } else if (pair) {
          setPairSymbol(pair);
        }
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
  }, [token, creator, pair, pairHint]);

  if (!privyReady || !isCreator) return null;
  if (creatorShare === false && (raw == null || raw === 0n)) return null;
  if (creatorShare === null && raw == null) return null;

  const amount = formatClaimable(raw, decimals, pairSymbol);

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

      <div className="mt-4">
        <p className="font-display text-[22px] tracking-wide text-ink">{amount}</p>
        <p className="mt-1 text-[13px] text-muted">
          Your creator share only — not the protocol 1%. Claim collects the
          pool and pays{" "}
          <a
            href={explorerAddress(creator)}
            target="_blank"
            rel="noreferrer"
            className="hover:text-yellowell"
          >
            {shortenAddress(creator)}
          </a>{" "}
          in {pairSymbol}.
        </p>
      </div>
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

function formatClaimable(raw: bigint | null, decimals = 18, symbol: string) {
  if (raw == null) return "…";
  return `${Number(formatUnits(raw, decimals)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals > 6 ? 6 : 2,
  })} ${symbol}`;
}
