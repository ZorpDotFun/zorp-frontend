import {
  useConnectWallet,
  useLinkAccount,
  useLogin,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { formatUnits, type Address } from "viem";
import { USDC_DECIMALS } from "../lib/addresses";
import { explorerTx } from "../lib/factory";
import { openWalletAuth } from "../lib/privy-wallet";
import { requestMarketRefresh, type MarketTrade } from "../lib/token-market";
import { formatUsd, formatUsdPrice } from "../lib/tokens";
import { minOut, parseTradeAmount, quoteExactIn, swapExactIn } from "../lib/trade";
import { useErc20Balance, useUsdcBalance } from "../lib/use-usdc-balance";
import { usePrivyReady } from "./app-privy-provider";

const TOKEN_DECIMALS = 18;

export function TokenTrade({
  token,
  ticker,
  tokenIsCurrency0,
  priceUsd,
}: {
  token: string;
  ticker: string;
  tokenIsCurrency0: boolean;
  priceUsd: number;
}) {
  const privyReady = usePrivyReady();
  const [buying, setBuying] = useState(true);
  const [pay, setPay] = useState("");
  const [quoted, setQuoted] = useState<bigint | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [success, setSuccess] = useState<TradeSuccess | null>(null);

  const amountIn = useMemo(() => {
    try {
      return parseTradeAmount(pay, buying);
    } catch {
      return 0n;
    }
  }, [pay, buying]);

  useEffect(() => {
    if (amountIn <= 0n) {
      setQuoted(null);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    const timer = window.setTimeout(() => {
      void quoteExactIn({
        token: token as Address,
        tokenIsCurrency0,
        buying,
        amountIn,
      })
        .then((out) => {
          if (!cancelled) setQuoted(out);
        })
        .catch(() => {
          if (!cancelled) setQuoted(null);
        })
        .finally(() => {
          if (!cancelled) setQuoting(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [amountIn, buying, token, tokenIsCurrency0]);

  const receive = quoted
    ? Number(formatUnits(quoted, buying ? TOKEN_DECIMALS : USDC_DECIMALS))
    : 0;
  const payUsd = buying
    ? Number(pay || 0)
    : Number(pay || 0) * priceUsd;
  const receiveUsd = buying ? receive * priceUsd : receive;

  return (
    <div className="mt-6 space-y-3">
      <TradeLeg
        label={buying ? "You pay" : "You sell"}
        value={pay}
        onChange={setPay}
        usd={payUsd}
        symbol={buying ? "USDC" : ticker}
        balanceSlot={
          privyReady ? (
            <PayBalance
              buying={buying}
              token={token}
              onMax={(next) => setPay(next)}
            />
          ) : (
            <span className="text-[12px] text-muted">Connect to see balance</span>
          )
        }
      />

      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => {
            setBuying((value) => !value);
            setPay("");
            setQuoted(null);
          }}
          className="grid size-9 place-items-center rounded-full bg-surface text-muted ring-1 ring-line hover:text-ink"
          aria-label="Switch buy and sell"
        >
          ↕
        </button>
      </div>

      <TradeLeg
        label={buying ? "You receive" : "You get"}
        value={quoting ? "…" : receive ? formatReceive(receive, buying) : "0"}
        usd={receiveUsd}
        symbol={buying ? ticker : "USDC"}
        readOnly
        balanceSlot={
          privyReady ? (
            <ReceiveBalance buying={buying} token={token} ticker={ticker} />
          ) : (
            <span className="text-[12px] text-muted">Connect to see balance</span>
          )
        }
      />

      {privyReady ? (
        <TradeSubmit
          token={token}
          ticker={ticker}
          tokenIsCurrency0={tokenIsCurrency0}
          buying={buying}
          amountIn={amountIn}
          quoted={quoted}
          onSuccess={(row) => {
            setSuccess(row);
            setPay("");
            setQuoted(null);
          }}
        />
      ) : (
        <button
          type="button"
          disabled
          className="flex h-12 w-full items-center justify-center rounded-full bg-yellowell text-[15px] font-bold text-black opacity-60"
        >
          Connect wallet
        </button>
      )}
      {success ? (
        <TradeSuccessModal {...success} onClose={() => setSuccess(null)} />
      ) : null}
    </div>
  );
}

function TradeLeg({
  label,
  value,
  onChange,
  usd,
  symbol,
  balanceSlot,
  readOnly,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  usd: number;
  symbol: string;
  balanceSlot: ReactNode;
  readOnly?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-surface px-4 py-4 ring-1 ring-line">
      <p className="text-[11px] font-medium tracking-[0.16em] text-muted uppercase">
        {label}
      </p>
      <input
        inputMode="decimal"
        readOnly={readOnly}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder="0"
        className="mt-2 w-full bg-transparent font-display text-[32px] tracking-wide text-ink outline-none"
      />
      <p className="text-[13px] text-muted">{formatUsd(Math.max(usd, 0))}</p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="rounded-full bg-raised px-3 py-1 text-[12px] font-medium text-ink ring-1 ring-line">
          {symbol}
        </span>
        {balanceSlot}
      </div>
    </div>
  );
}

function PayBalance({
  buying,
  token,
  onMax,
}: {
  buying: boolean;
  token: string;
  onMax: (value: string) => void;
}) {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const address = wallets[0]?.address as Address | undefined;
  const usdc = useUsdcBalance(authenticated && buying ? address : undefined);
  const launch = useErc20Balance(
    buying ? undefined : (token as Address),
    authenticated && !buying ? address : undefined,
    TOKEN_DECIMALS,
  );
  const formatted = buying ? usdc.formatted : launch.formatted;
  const raw = buying ? usdc.raw : launch.raw;

  if (!authenticated || !address) {
    return <span className="text-[12px] text-muted">Connect to see balance</span>;
  }
  return (
    <button
      type="button"
      onClick={() => {
        if (raw == null) return;
        onMax(formatUnits(raw, buying ? USDC_DECIMALS : TOKEN_DECIMALS));
      }}
      className="text-[12px] text-muted hover:text-ink"
    >
      {formatted ?? "…"} · Max
    </button>
  );
}

function ReceiveBalance({
  buying,
  token,
  ticker,
}: {
  buying: boolean;
  token: string;
  ticker: string;
}) {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const address = wallets[0]?.address as Address | undefined;
  const usdc = useUsdcBalance(authenticated && !buying ? address : undefined);
  const launch = useErc20Balance(
    buying ? (token as Address) : undefined,
    authenticated && buying ? address : undefined,
    TOKEN_DECIMALS,
  );
  const formatted = buying ? launch.formatted : usdc.formatted;
  if (!authenticated || !address) {
    return <span className="text-[12px] text-muted">Connect to see balance</span>;
  }
  return (
    <span className="text-[12px] text-muted">
      {formatted ?? "…"} {buying ? ticker : "USDC"}
    </span>
  );
}

type TradeSuccess = {
  buying: boolean;
  ticker: string;
  paid: string;
  received: string;
  hash: string;
};

function TradeSubmit({
  token,
  ticker,
  tokenIsCurrency0,
  buying,
  amountIn,
  quoted,
  onSuccess,
}: {
  token: string;
  ticker: string;
  tokenIsCurrency0: boolean;
  buying: boolean;
  amountIn: bigint;
  quoted: bigint | null;
  onSuccess: (row: TradeSuccess) => void;
}) {
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { login } = useLogin();
  const { connectWallet } = useConnectWallet();
  const { linkWallet } = useLinkAccount();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wallet =
    wallets.find((item) => item.walletClientType === "metamask") ?? wallets[0];

  async function onSubmit() {
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
    if (amountIn <= 0n || quoted == null || quoted === 0n) {
      setError("Enter an amount.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const tx = await swapExactIn({
        wallet,
        token: token as Address,
        tokenIsCurrency0,
        buying,
        amountIn,
        amountOutMin: minOut(quoted),
      });
      const paid = Number(
        formatUnits(amountIn, buying ? USDC_DECIMALS : TOKEN_DECIMALS),
      );
      const received = Number(
        formatUnits(quoted, buying ? TOKEN_DECIMALS : USDC_DECIMALS),
      );
      const trade: MarketTrade = {
        hash: tx,
        trader: wallet.address,
        buy: buying,
        tokenAmount: buying ? received : paid,
        usdcAmount: buying ? paid : received,
        price: 0,
        time: Date.now(),
      };
      requestMarketRefresh({ token, hash: tx, trade });
      onSuccess({
        buying,
        ticker,
        paid: formatTradeQty(paid, !buying),
        received: formatReceive(received, buying),
        hash: tx,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Swap failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={!ready || pending}
        onClick={() => void onSubmit()}
        className="flex h-12 w-full items-center justify-center rounded-full bg-yellowell text-[15px] font-bold text-black disabled:opacity-60"
      >
        {!authenticated
          ? "Connect wallet"
          : pending
            ? "Swapping…"
            : buying
              ? `Buy ${ticker}`
              : `Sell ${ticker}`}
      </button>
      {error ? <p className="text-[12px] text-down">{error}</p> : null}
    </div>
  );
}

function TradeSuccessModal({
  buying,
  ticker,
  paid,
  received,
  hash,
  onClose,
}: TradeSuccess & { onClose: () => void }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
        aria-label="Close"
      />
      <div className="relative w-full max-w-[360px] rounded-[28px] bg-raised px-6 py-8 text-center ring-1 ring-line">
        <div className="mx-auto grid size-16 place-items-center rounded-full bg-yellowell text-[28px] font-bold text-black">
          ✓
        </div>
        <h2 className="mt-5 font-display text-[22px] tracking-wide text-ink">
          {buying ? "Buy successful" : "Sell successful"}
        </h2>
        <p className="mt-2 text-[15px] font-medium text-ink">
          {buying
            ? `You bought ${received} ${ticker}`
            : `You sold ${paid} ${ticker}`}
        </p>
        <p className="mt-1 text-[13px] text-muted">
          {buying ? `Paid ${paid} USDC` : `Received ${received} USDC`}
        </p>
        <a
          href={explorerTx(hash)}
          target="_blank"
          rel="noreferrer"
          className="mt-6 flex h-11 items-center justify-center rounded-full bg-yellowell text-[14px] font-bold text-black"
        >
          View transaction
        </a>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 flex h-11 w-full items-center justify-center rounded-full bg-surface text-[14px] font-medium text-ink ring-1 ring-line"
        >
          Done
        </button>
      </div>
    </div>,
    document.body,
  );
}

function formatReceive(value: number, buying: boolean) {
  if (buying) return formatTradeQty(value, true);
  return formatUsdPrice(value).replace(/^\$/, "");
}

function formatTradeQty(value: number, tokenQty: boolean) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (!tokenQty) {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  if (value >= 1) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return value.toFixed(4);
}
