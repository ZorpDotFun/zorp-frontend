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
import { TOTAL_SUPPLY } from "../lib/addresses";
import { useNetwork } from "../lib/use-network";
import { explorerTx, readPairToken } from "../lib/factory";
import { openWalletAuth } from "../lib/privy-wallet";
import { requestMarketRefresh, type MarketTrade } from "../lib/token-market";
import { formatUsd, formatUsdPrice } from "../lib/tokens";
import { isNativeEth } from "../lib/quote-tokens";
import {
  fillEthToPair,
  minOut,
  parseTradeAmount,
  quoteEthToPair,
  quoteExactIn,
  quotePairToEth,
  swapExactIn,
  swapPoolForToken,
} from "../lib/trade";
import { useErc20Balance, useNativeBalance } from "../lib/use-usdc-balance";
import { usePrivyReady } from "./app-privy-provider";

const TOKEN_DECIMALS = 18;

export function TokenTrade({
  token,
  ticker,
  pair,
  pairAsset,
  poolFee,
  tokenIsCurrency0,
  priceUsd,
  details,
}: {
  token: string;
  ticker: string;
  pair?: string;
  pairAsset?: string;
  poolFee?: number;
  tokenIsCurrency0: boolean;
  priceUsd: number;
  details?: ReactNode;
}) {
  const { network } = useNetwork();
  const [pairDecimals, setPairDecimals] = useState(network.protocol.pairDecimals);
  const pairSymbol = pair || network.protocol.pairSymbol;
  const pool = useMemo(
    () => swapPoolForToken({ pairAsset, poolFee }),
    [pairAsset, poolFee],
  );
  const privyReady = usePrivyReady();
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const [buying, setBuying] = useState(true);
  const [useEth, setUseEth] = useState(false);
  const [pay, setPay] = useState("");
  const [quoted, setQuoted] = useState<bigint | null>(null);
  const [quotedEth, setQuotedEth] = useState<bigint | null>(null);
  const [pairFromEth, setPairFromEth] = useState<bigint | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [success, setSuccess] = useState<TradeSuccess | null>(null);
  const [openDetails, setOpenDetails] = useState(false);
  const walletAddress = wallets[0]?.address as Address | undefined;
  const nativePair = Boolean(pairAsset && isNativeEth(pairAsset));
  const canUseEth =
    network.id === "robinhood" && Boolean(pairAsset) && !nativePair;
  const payEth = canUseEth && useEth;
  const pairBal = useErc20Balance(
    buying && pairAsset && !nativePair && !payEth ? (pairAsset as Address) : undefined,
    authenticated && buying && !nativePair && !payEth ? walletAddress : undefined,
    pairDecimals,
  );
  const nativeBal = useNativeBalance(
    authenticated && buying && (nativePair || payEth) ? walletAddress : undefined,
  );
  const tokenBal = useErc20Balance(
    !buying ? (token as Address) : undefined,
    authenticated && !buying ? walletAddress : undefined,
    TOKEN_DECIMALS,
  );
  const maxRaw = buying
    ? nativePair || payEth
      ? nativeBal.raw
      : pairBal.raw
    : tokenBal.raw;
  const payDecimals = buying ? (payEth ? 18 : pairDecimals) : TOKEN_DECIMALS;
  const paySymbol = buying ? (payEth ? "ETH" : pairSymbol) : ticker;
  const receiveSymbol = buying ? ticker : payEth ? "ETH" : pairSymbol;

  useEffect(() => {
    if (!pairAsset || isNativeEth(pairAsset)) {
      setPairDecimals(network.protocol.pairDecimals);
      return;
    }
    let cancelled = false;
    void readPairToken(pairAsset as Address).then((info) => {
      if (!cancelled) setPairDecimals(info.decimals);
    });
    return () => {
      cancelled = true;
    };
  }, [pairAsset, network.protocol.pairDecimals]);

  const amountIn = useMemo(() => {
    try {
      return parseTradeAmount(pay, buying, payDecimals);
    } catch {
      return 0n;
    }
  }, [pay, buying, payDecimals]);

  useEffect(() => {
    if (amountIn <= 0n) {
      setQuoted(null);
      setQuotedEth(null);
      setPairFromEth(null);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          let poolIn = amountIn;
          if (buying && payEth && pairAsset) {
            poolIn = await quoteEthToPair(pairAsset as Address, amountIn, pairDecimals);
            if (cancelled) return;
            setPairFromEth(poolIn);
          } else {
            setPairFromEth(null);
          }
          const out = await quoteExactIn({
            token: token as Address,
            tokenIsCurrency0,
            buying,
            amountIn: poolIn,
            pool,
          });
          if (cancelled) return;
          setQuoted(out);
          if (!buying && payEth && pairAsset && out > 0n) {
            setQuotedEth(await quotePairToEth(pairAsset as Address, out, pairDecimals));
          } else {
            setQuotedEth(null);
          }
        } catch {
          if (!cancelled) {
            setQuoted(null);
            setQuotedEth(null);
            setPairFromEth(null);
          }
        } finally {
          if (!cancelled) setQuoting(false);
        }
      })();
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [amountIn, buying, payEth, pairAsset, pairDecimals, token, tokenIsCurrency0, pool]);

  const receive = buying
    ? quoted
      ? Number(formatUnits(quoted, TOKEN_DECIMALS))
      : 0
    : payEth
      ? quotedEth
        ? Number(formatUnits(quotedEth, 18))
        : 0
      : quoted
        ? Number(formatUnits(quoted, pairDecimals))
        : 0;
  const rate =
    amountIn > 0n && receive > 0
      ? buying
        ? receive / Number(pay || 0)
        : Number(pay || 0) / receive
      : 0;
  const chips = buying
    ? pairChips(payEth ? "ETH" : pairSymbol)
    : [
        { label: "25%", value: "pct:25" },
        { label: "50%", value: "pct:50" },
        { label: "75%", value: "pct:75" },
        { label: "Max", value: "max" },
      ];
  const owned = tokenBal.raw != null ? Number(formatUnits(tokenBal.raw, TOKEN_DECIMALS)) : 0;
  const ownedShare = TOTAL_SUPPLY > 0 ? (owned / TOTAL_SUPPLY) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 rounded-full bg-canvas p-1 ring-1 ring-line">
        <button
          type="button"
          onClick={() => {
            setBuying(true);
            setPay("");
            setQuoted(null);
            setQuotedEth(null);
          }}
          className={`h-9 rounded-full text-[14px] font-semibold ${
            buying ? "bg-ink text-canvas" : "text-muted"
          }`}
        >
          Buy
        </button>
        <button
          type="button"
          onClick={() => {
            setBuying(false);
            setPay("");
            setQuoted(null);
            setQuotedEth(null);
          }}
          className={`h-9 rounded-full text-[14px] font-semibold ${
            !buying ? "bg-down text-ink" : "text-muted"
          }`}
        >
          Sell
        </button>
      </div>

      {buying && payEth ? (
        <p className="text-[12px] text-muted">
          {(nativeBal.formatted ?? "0")} ETH available
        </p>
      ) : null}
      {!buying ? (
        <p className="text-[12px] text-muted">
          {(tokenBal.formatted ?? "0")} {ticker} available
        </p>
      ) : null}

      <label className="block rounded-2xl bg-canvas px-4 py-3 ring-1 ring-line">
        <span className="text-[12px] text-muted">
          {buying ? "Buy" : "Sell"}
        </span>
        <div className="mt-1 flex items-end gap-2">
          <input
            inputMode="decimal"
            value={pay}
            onChange={(event) => setPay(event.target.value)}
            placeholder="0"
            className="min-w-0 flex-1 bg-transparent text-[32px] font-semibold tracking-tight text-ink outline-none"
          />
          {buying ? (
            <AssetSelect
              value={payEth ? "eth" : "pair"}
              disabled={!canUseEth}
              pairLabel={pairSymbol}
              onChange={(next) => {
                setUseEth(next === "eth");
                setPay("");
                setQuoted(null);
                setQuotedEth(null);
              }}
            />
          ) : (
            <span className="pb-1 text-[14px] font-semibold text-muted">{ticker}</span>
          )}
        </div>
        {!buying && Number(pay) > 0 && priceUsd > 0 ? (
          <p className="mt-1 text-[12px] text-muted">
            {formatUsd(Number(pay) * priceUsd)}
          </p>
        ) : null}
      </label>

      <div className="grid grid-cols-4 gap-2">
        {chips.map((chip) => (
          <button
            key={chip.label}
            type="button"
            onClick={() => {
              if (chip.value === "max" || chip.value.startsWith("pct:")) {
                if (maxRaw == null || maxRaw <= 0n) return;
                const pct = chip.value === "max" ? 100 : Number(chip.value.slice(4));
                const cut = (maxRaw * BigInt(pct)) / 100n;
                setPay(formatUnits(cut, payDecimals));
                return;
              }
              setPay(chip.value);
            }}
            className="h-9 rounded-xl bg-canvas text-[12px] font-semibold text-ink ring-1 ring-line hover:ring-yellowell"
          >
            {chip.label}
          </button>
        ))}
      </div>

      {!buying ? (
        <div className="rounded-2xl bg-canvas px-4 py-3 ring-1 ring-line">
          <span className="text-[12px] text-muted">Receive</span>
          <div className="mt-1 flex items-end gap-2">
            <p className="min-w-0 flex-1 text-[32px] font-semibold tracking-tight text-ink">
              {quoting
                ? "…"
                : receive > 0
                  ? formatReceive(receive, payEth)
                  : "0"}
            </p>
            <AssetSelect
              value={payEth ? "eth" : "pair"}
              disabled={!canUseEth}
              pairLabel={pairSymbol}
              onChange={(next) => {
                setUseEth(next === "eth");
                setQuotedEth(null);
              }}
            />
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between text-[13px]">
        <span className="text-muted">Slippage</span>
        <span className="text-ink">1.5%</span>
      </div>

      {privyReady ? (
        <TradeSubmit
          token={token}
          ticker={ticker}
          pairSymbol={pairSymbol}
          receiveSymbol={receiveSymbol}
          pairAsset={pairAsset}
          poolFee={poolFee}
          tokenIsCurrency0={tokenIsCurrency0}
          buying={buying}
          useEth={payEth}
          pairDecimals={pairDecimals}
          amountIn={amountIn}
          pairFromEth={pairFromEth}
          quoted={quoted}
          quotedEth={quotedEth}
          onSuccess={(row) => {
            setSuccess(row);
            setPay("");
            setQuoted(null);
            setQuotedEth(null);
          }}
        />
      ) : (
        <button
          type="button"
          disabled
          className="flex h-12 w-full items-center justify-center rounded-full bg-ink text-[15px] font-bold text-canvas opacity-60"
        >
          Connect wallet to trade
        </button>
      )}

      {quoting || receive > 0 || rate > 0 ? (
        <dl className="space-y-1.5 text-[12px]">
          <div className="flex items-start justify-between gap-3">
            <dt className="text-muted">Pricing</dt>
            <dd className="text-right text-ink">
              {quoting
                ? "…"
                : rate > 0
                  ? buying
                    ? `1 ${paySymbol} ≈ ${formatTradeQty(rate, true)} ${ticker}`
                    : `1 ${ticker} ≈ ${formatReceive(1 / rate, payEth)} ${receiveSymbol}`
                  : "Enter an amount"}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="text-muted">You receive</dt>
            <dd className="text-right text-ink">
              {quoting
                ? "…"
                : receive > 0
                  ? `${formatReceive(receive, buying || payEth)} ${receiveSymbol}`
                  : `0 ${receiveSymbol}`}
            </dd>
          </div>
        </dl>
      ) : null}

      {details ? (
        <div>
          <button
            type="button"
            onClick={() => setOpenDetails((open) => !open)}
            className="flex w-full items-center justify-between text-[13px] text-muted hover:text-ink"
          >
            Details
            <span className={`text-[10px] ${openDetails ? "rotate-180" : ""}`}>▾</span>
          </button>
          {openDetails ? (
            <div className="mt-2 space-y-2 text-[12px] leading-5 text-muted">{details}</div>
          ) : null}
        </div>
      ) : null}

      {!buying ? (
        <p className="text-[12px] text-muted">
          You own {formatTradeQty(owned, true)} {ticker} (
          {ownedShare.toFixed(2)}% of supply)
        </p>
      ) : null}

      {success ? (
        <TradeSuccessModal {...success} onClose={() => setSuccess(null)} />
      ) : null}
    </div>
  );
}

function AssetSelect({
  value,
  pairLabel,
  onChange,
  disabled = false,
}: {
  value: "pair" | "eth";
  pairLabel: string;
  onChange: (next: "pair" | "eth") => void;
  disabled?: boolean;
}) {
  if (disabled) {
    return <span className="pb-1 text-[14px] font-semibold text-muted">{pairLabel}</span>;
  }
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value === "eth" ? "eth" : "pair")}
      className="rounded-full bg-raised px-2.5 py-1 text-[13px] font-semibold text-ink ring-1 ring-line outline-none"
    >
      <option value="pair">{pairLabel}</option>
      <option value="eth">ETH</option>
    </select>
  );
}

function pairChips(pairSymbol: string) {
  if (pairSymbol === "ETH") {
    return [
      { label: "0.01", value: "0.01" },
      { label: "0.05", value: "0.05" },
      { label: "0.1", value: "0.1" },
      { label: "Max", value: "max" },
    ];
  }
  if (pairSymbol === "USDG" || pairSymbol === "USDC") {
    return [
      { label: "$10", value: "10" },
      { label: "$50", value: "50" },
      { label: "$100", value: "100" },
      { label: "$1000", value: "1000" },
    ];
  }
  return [
    { label: "0.01", value: "0.01" },
    { label: "0.05", value: "0.05" },
    { label: "0.1", value: "0.1" },
    { label: "Max", value: "max" },
  ];
}


type TradeSuccess = {
  buying: boolean;
  ticker: string;
  paid: string;
  received: string;
  hash: string;
  paySymbol: string;
  receiveSymbol: string;
};

function TradeSubmit({
  token,
  ticker,
  pairSymbol,
  receiveSymbol,
  pairAsset,
  poolFee,
  tokenIsCurrency0,
  buying,
  useEth,
  pairDecimals,
  amountIn,
  pairFromEth,
  quoted,
  quotedEth,
  onSuccess,
}: {
  token: string;
  ticker: string;
  pairSymbol: string;
  receiveSymbol: string;
  pairAsset?: string;
  poolFee?: number;
  tokenIsCurrency0: boolean;
  buying: boolean;
  useEth: boolean;
  pairDecimals: number;
  amountIn: bigint;
  pairFromEth: bigint | null;
  quoted: bigint | null;
  quotedEth: bigint | null;
  onSuccess: (row: TradeSuccess) => void;
}) {
  const pool = swapPoolForToken({ pairAsset, poolFee });
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
      const pair = pairAsset as Address | undefined;
      let poolIn = amountIn;
      if (buying && useEth) {
        if (!pair || !pairFromEth || pairFromEth <= 0n) {
          throw new Error("Could not price this buy in ETH.");
        }
        poolIn = pairFromEth;
        await fillEthToPair({
          wallet,
          pair,
          pairOut: pairFromEth,
          ethIn: amountIn,
        });
      }
      const tx = await swapExactIn({
        wallet,
        token: token as Address,
        tokenIsCurrency0,
        buying,
        amountIn: poolIn,
        amountOutMin: minOut(quoted),
        pool,
        receiveEth: !buying && useEth,
        pairDecimals,
      });

      const payDecimals = buying ? (useEth ? 18 : pairDecimals) : TOKEN_DECIMALS;
      const outAmount =
        buying ? quoted : useEth && quotedEth != null && quotedEth > 0n ? quotedEth : quoted;
      const outDecimals = buying || useEth ? 18 : pairDecimals;
      const paid = Number(formatUnits(amountIn, payDecimals));
      const received = Number(formatUnits(outAmount, outDecimals));
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
        paid: formatTradeQty(paid, !buying || useEth),
        received: formatReceive(received, buying || useEth),
        hash: tx,
        paySymbol: buying ? (useEth ? "ETH" : pairSymbol) : ticker,
        receiveSymbol,
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
        className={`flex h-12 w-full items-center justify-center rounded-full text-[15px] font-bold disabled:opacity-60 ${
          !authenticated
            ? "bg-ink text-canvas"
            : buying
              ? "bg-yellowell text-black"
              : "bg-down text-ink"
        }`}
      >
        {!authenticated
          ? "Connect wallet to trade"
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
  paySymbol,
  receiveSymbol,
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
          {buying
            ? `Paid ${paid} ${paySymbol}`
            : `Received ${received} ${receiveSymbol}`}
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
