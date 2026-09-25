import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Link } from "react-router";
import { getAddress, isAddress, type Address } from "viem";
import type { Route } from "./+types/create";
import { usePrivyReady } from "../components/app-privy-provider";
import {
  TARGET_FDV_USD,
  TOTAL_SUPPLY,
} from "../lib/addresses";
import {
  explorerAddress,
  previewEthFirstBuy,
  readPairToken,
  readPairable,
  readProtocolFeeBps,
  type PairTokenInfo,
} from "../lib/factory";
import { useNetwork } from "../lib/use-network";
import {
  FEE_MODELS,
  PROTOCOL_SWAP_FEE_BPS,
  clampTaxBps,
  feeSummary,
  formatTax,
  presetFees,
  splitTotal,
  validateFees,
  type FeeConfig,
  type FeeModelId,
} from "../lib/fee-models";
import { tokenImageDisplaySrc } from "../lib/token-image";
import { shortenAddress } from "../lib/tokens";
import { uploadTokenImage } from "../lib/upload-image";
import type { LaunchSubmitProps } from "../components/launch-submit";
import { QuoteTokenPicker } from "../components/quote-token-picker";
import {
  MIN_QUOTE_LIQUIDITY_USD,
  RH_NATIVE_ETH,
  RH_USDG,
  isNativeEth,
  readUniswapBookUsd,
  type QuoteSectionId,
} from "../lib/quote-tokens";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Create on Zorp" },
    {
      name: "description",
      content:
        "Launch a token on Robinhood. 1B supply into a locked Uniswap v4 pool, live from block one.",
    },
  ];
}

export default function CreatePage() {
  const { network } = useNetwork();
  const pair = network.protocol.pairSymbol;
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [website, setWebsite] = useState("");
  const [firstBuyUsdc, setFirstBuyUsdc] = useState("0");
  const [payWithEth, setPayWithEth] = useState(false);
  const [ethBuyPreview, setEthBuyPreview] = useState<string | null>(null);
  const [quoteSection, setQuoteSection] = useState<QuoteSectionId>("currencies");
  const [pickedPair, setPickedPair] = useState<Address>(RH_NATIVE_ETH);
  const [customPair, setCustomPair] = useState("");
  const [pairGate, setPairGate] = useState<{ ok: boolean; usd6: bigint } | "checking" | null>(
    null,
  );
  const [uniBookUsd, setUniBookUsd] = useState<number | null>(null);
  const [pairMeta, setPairMeta] = useState<PairTokenInfo | null>(null);
  const [pairMetaError, setPairMetaError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [feeModel, setFeeModel] = useState<FeeModelId>("creator");
  const [fees, setFees] = useState<FeeConfig>(() => presetFees("creator"));
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [protocolBps, setProtocolBps] = useState(
    network.id === "robinhood" ? 100 : PROTOCOL_SWAP_FEE_BPS,
  );
  const summary = feeSummary(fees, protocolBps);
  const feeError = validateFees(fees);
  const splitPct = splitTotal(fees) / 100;
  const rh = network.id === "robinhood";
  const selectedPair: Address | null = !rh
    ? network.protocol.pairAsset
    : quoteSection === "custom"
      ? isAddress(customPair)
        ? getAddress(customPair)
        : null
      : pickedPair;
  const pairLabel =
    pairMeta?.symbol ??
    (selectedPair ? shortenAddress(selectedPair) : "Token");
  const newTicker = ticker.trim() || "TICKER";
  const onChainBook =
    pairGate && pairGate !== "checking"
      ? Math.round(Number(pairGate.usd6) / 1e6)
      : 0;
  const bookUsd = Math.max(onChainBook, Math.round(uniBookUsd ?? 0));
  const dexEligible = (uniBookUsd ?? 0) >= MIN_QUOTE_LIQUIDITY_USD;

  useEffect(() => {
    if (network.id === "robinhood") {
      setProtocolBps(100);
      return;
    }
    void readProtocolFeeBps().then(setProtocolBps);
  }, [network.id]);

  useEffect(() => {
    return () => {
      if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  useEffect(() => {
    if (!rh) {
      setPairGate(null);
      setPairMeta(null);
      setPairMetaError(null);
      setUniBookUsd(null);
      return;
    }
    if (!selectedPair) {
      setPairGate(null);
      setPairMeta(null);
      setPairMetaError(null);
      setUniBookUsd(null);
      return;
    }
    let cancelled = false;
    const isEthPair =
      isNativeEth(selectedPair) ||
      selectedPair.toLowerCase() === network.protocol.pairAsset.toLowerCase() ||
      selectedPair.toLowerCase() === RH_USDG.toLowerCase();
    if (isEthPair) {
      setPairGate({ ok: true, usd6: 0n });
    } else {
      setPairGate("checking");
    }
    setPairMeta(null);
    setPairMetaError(null);
    setUniBookUsd(null);
    const timer = window.setTimeout(() => {
      void Promise.all([
        isNativeEth(selectedPair)
          ? Promise.resolve({
              address: selectedPair,
              name: "Ether",
              symbol: "ETH",
              decimals: 18,
            })
          : readPairToken(selectedPair),
        isEthPair ? Promise.resolve({ ok: true, usd6: 0n }) : readPairable(selectedPair),
        isEthPair ? Promise.resolve(0) : readUniswapBookUsd(selectedPair),
      ])
        .then(([meta, gate, uniUsd]) => {
          if (cancelled) return;
          setPairMeta(meta);
          setPairGate(gate);
          setUniBookUsd(uniUsd);
        })
        .catch(() => {
          if (cancelled) return;
          setPairMeta(null);
          setPairMetaError("Could not read this token.");
          if (!isEthPair) setPairGate({ ok: false, usd6: 0n });
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [rh, selectedPair, network.protocol.pairAsset]);

  useEffect(() => {
    if (selectedPair && isNativeEth(selectedPair)) setPayWithEth(false);
  }, [selectedPair]);

  const ethFirstBuy =
    Boolean(rh && payWithEth && selectedPair && !isNativeEth(selectedPair));
  const firstBuyUnit = ethFirstBuy ? "ETH" : rh ? pairLabel : pair;

  useEffect(() => {
    if (!ethFirstBuy || !selectedPair || !pairMeta || Number(firstBuyUsdc) <= 0) {
      setEthBuyPreview(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void previewEthFirstBuy(
        selectedPair,
        firstBuyUsdc,
        pairMeta.decimals,
        pairMeta.symbol,
      ).then((line) => {
        if (!cancelled) setEthBuyPreview(line);
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [ethFirstBuy, selectedPair, pairMeta, firstBuyUsdc]);

  async function onImage(file: File | undefined) {
    if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
    setUploadError(null);
    if (!file) {
      setPreview(null);
      setImage("");
      return;
    }
    setPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      setImage(await uploadTokenImage(file));
    } catch (cause) {
      setImage("");
      setUploadError(cause instanceof Error ? cause.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="mx-auto grid w-full max-w-[1180px] gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_16.5rem] lg:items-start lg:gap-10 lg:py-12">
      <section>
        <Link
          to="/"
          className="inline-flex h-9 items-center rounded-full bg-surface px-3.5 text-[13px] font-medium text-ink ring-1 ring-line hover:bg-raised"
        >
          ← Back to homepage
        </Link>
        <p className="mt-5 text-[13px] font-bold tracking-[0.16em] text-muted uppercase">
          /create
        </p>
        <h1 className="mt-3 font-display text-[28px] leading-snug font-semibold text-ink sm:text-[36px]">
          Launch token
        </h1>
        {network.protocol.deployed ? null : (
          <p className="mt-4 rounded-2xl bg-surface px-4 py-3 text-[13px] text-muted ring-1 ring-line">
            Zorp is not live on Robinhood yet. Set{" "}
            <span className="text-ink">VITE_RH_LAUNCH_FACTORY</span>,{" "}
            <span className="text-ink">VITE_RH_LAUNCH_HOOK</span>, and{" "}
            <span className="text-ink">VITE_RH_LAUNCH_LOCKER</span>.
          </p>
        )}

        <form
          className="mt-8 space-y-5"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Token name"
                maxLength={64}
                className={inputClass}
                required
              />
            </Field>
            <Field label="Ticker">
              <input
                value={ticker}
                onChange={(event) => setTicker(event.target.value.toUpperCase())}
                placeholder="SYMBOL"
                maxLength={16}
                className={inputClass}
                required
              />
            </Field>
          </div>

          <Field label="Description">
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="A short description of the token"
              maxLength={2048}
              rows={4}
              className={`${inputClass} resize-y`}
            />
          </Field>

          <Field label="Token image">
            <label className="mt-2 flex cursor-pointer items-center gap-3 rounded-2xl bg-surface px-4 py-5 ring-1 ring-line transition hover:ring-yellowell">
              {preview || tokenImageDisplaySrc(image) ? (
                <img
                  src={preview || tokenImageDisplaySrc(image)}
                  alt=""
                  className="size-12 rounded-xl object-cover"
                />
              ) : (
                <span className="grid size-12 place-items-center rounded-xl bg-canvas text-muted ring-1 ring-line">
                  +
                </span>
              )}
              <span className="text-[13px] text-muted">
                {uploading
                  ? "Uploading…"
                  : preview || image
                    ? "Replace image"
                    : "Choose image"}
              </span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                onChange={(event) => void onImage(event.target.files?.[0])}
              />
            </label>
            {uploadError ? (
              <p className="mt-2 text-[12px] text-down">{uploadError}</p>
            ) : null}
            <input
              value={image}
              onChange={(event) => {
                setImage(event.target.value);
                if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
                setPreview(null);
              }}
              placeholder="or paste an ipfs:// CID or https image URL"
              maxLength={512}
              className={inputClass}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="X profile">
              <input
                value={twitter}
                onChange={(event) => setTwitter(event.target.value)}
                placeholder="x.com/handle"
                maxLength={256}
                className={inputClass}
              />
            </Field>
            <Field label="Telegram">
              <input
                value={telegram}
                onChange={(event) => setTelegram(event.target.value)}
                placeholder="t.me/community"
                maxLength={256}
                className={inputClass}
              />
            </Field>
            <Field label="Website">
              <input
                type="url"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
                placeholder="https://yoursite.com"
                maxLength={256}
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="Quote token">
            {rh ? (
              <div className="mt-2 space-y-3">
                <QuoteTokenPicker
                  selected={selectedPair}
                  onSelect={(token) => {
                    setPickedPair(token.address);
                    setQuoteSection(token.section);
                  }}
                  customValue={customPair}
                  onCustomChange={(value) => {
                    setCustomPair(value);
                    setQuoteSection("custom");
                  }}
                  section={quoteSection}
                  onSectionChange={setQuoteSection}
                />
                {selectedPair ? (
                  <PairPreview
                    pairMeta={pairMeta}
                    pairMetaError={pairMetaError}
                    pairGate={pairGate}
                    pairLabel={pairLabel}
                    newTicker={newTicker}
                    pairAddress={selectedPair}
                    isWeth={
                      isNativeEth(selectedPair) ||
                      selectedPair.toLowerCase() ===
                        network.protocol.pairAsset.toLowerCase() ||
                      selectedPair.toLowerCase() === RH_USDG.toLowerCase()
                    }
                    bookUsd={bookUsd}
                    dexEligible={dexEligible}
                    explorer={
                      isNativeEth(selectedPair)
                        ? "https://app.uniswap.org/explore/tokens/robinhood/NATIVE"
                        : explorerAddress(selectedPair)
                    }
                  />
                ) : (
                  <p className="text-[12px] text-muted">
                    Paste a token address. The new pool will be {newTicker} / that
                    token — not WETH.
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-2 flex h-11 items-center justify-between rounded-2xl bg-surface px-4 text-[13px] text-ink ring-1 ring-line">
                <span>{pair}</span>
                <span className="text-muted">{network.protocol.pairHint}</span>
              </div>
            )}
          </Field>

          <div className="block">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-medium tracking-[0.16em] text-muted uppercase">
                Dev first buy · in {firstBuyUnit}
              </span>
              {rh ? (
                <span className="text-[12px] text-muted">{firstBuyUnit}</span>
              ) : (
                <UsdcBalanceGate />
              )}
            </div>
            <div className="relative">
              <input
                type="number"
                min="0"
                step="0.01"
                value={firstBuyUsdc}
                onChange={(event) => setFirstBuyUsdc(event.target.value)}
                className={`${inputClass} pr-16`}
              />
              <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-[13px] text-muted">
                {firstBuyUnit}
              </span>
            </div>
            {rh && selectedPair && !isNativeEth(selectedPair) ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPayWithEth(false)}
                  className={`rounded-2xl px-3 py-2.5 text-left ring-1 transition ${
                    !payWithEth
                      ? "bg-yellowell/15 ring-yellowell"
                      : "bg-canvas ring-line hover:ring-yellowell/50"
                  }`}
                >
                  <p className="text-[13px] font-bold text-ink">Pay with {pairLabel}</p>
                  <p className="mt-0.5 text-[12px] text-muted">
                    Spend {pairLabel} you already hold.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setPayWithEth(true)}
                  className={`rounded-2xl px-3 py-2.5 text-left ring-1 transition ${
                    payWithEth
                      ? "bg-yellowell/15 ring-yellowell"
                      : "bg-canvas ring-line hover:ring-yellowell/50"
                  }`}
                >
                  <p className="text-[13px] font-bold text-ink">Pay with ETH</p>
                  <p className="mt-0.5 text-[12px] text-muted">
                    Enter ETH. The launch buys {pairLabel}, then buys your token.
                  </p>
                </button>
              </div>
            ) : null}
            {ethBuyPreview ? (
              <p className="mt-2 text-[12px] text-ink">{ethBuyPreview}</p>
            ) : null}
            <p className="mt-2 text-[12px] text-muted">
              {rh
                ? selectedPair && isNativeEth(selectedPair)
                  ? "Optional. Leave at 0 to only deploy. First buy is ETH in the same launch transaction."
                  : payWithEth
                    ? `Optional. Amount is ETH. Same tx: ETH → ${pairLabel} → your token. Leftover ETH comes back.`
                    : `Optional. Amount is ${pairLabel}. The launch pulls ${pairLabel} from your wallet and buys in the same transaction.`
                : `Leave at 0 to only deploy. A first buy pulls ${pair} from your wallet after an approve${
                    pair === "WETH" ? " (ETH is wrapped if needed)" : ""
                  }.`}
            </p>
          </div>

          <div className="rounded-3xl bg-surface ring-1 ring-line">
            <button
              type="button"
              onClick={() => setAdvancedOpen((open) => !open)}
              className="flex h-12 w-full items-center justify-between px-4 text-[13px] font-medium text-ink"
            >
              Advanced
              <span className="text-muted">{advancedOpen ? "▴" : "▾"}</span>
            </button>
            {advancedOpen ? (
              <div className="space-y-4 border-t border-line px-4 pb-4 pt-3">
                <p className="text-[12px] text-muted">
                  {network.id === "robinhood"
                    ? `Fees are the Uniswap pool fee in ${pairLabel}. Protocol is a fixed 1%. Your cut is 0–10% on top. Token tax is 0.`
                    : "Buy/sell tax is 0–10%. The split of that tax must add to 100%. These values are written on-chain at launch."}
                </p>
                <div className="rounded-2xl bg-canvas px-3 py-3 ring-1 ring-line">
                  <p className="text-[12px] font-medium text-ink">
                    Zorp protocol fee · {formatTax(protocolBps)} {rh ? pairLabel : pair}
                  </p>
                  <p className="mt-1 text-[12px] leading-5 text-muted">
                    {network.id === "robinhood"
                      ? `Fixed 1% of the pool, paid in ${pairLabel}. Not a token tax. Cannot be changed after deploy.`
                      : `Charged on every buy and sell, in the pair asset, on top of the tax you set. It is not taken from your split. Traders pay your tax plus this ${formatTax(protocolBps)}.`}
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {FEE_MODELS.map((model) => {
                    const active = feeModel === model.id;
                    const ethHolders =
                      model.id === "holders" &&
                      Boolean(selectedPair && isNativeEth(selectedPair));
                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => {
                          setFeeModel(model.id);
                          setFees(presetFees(model.id));
                        }}
                        className={`rounded-2xl px-3 py-3 text-left ring-1 transition ${
                          active
                            ? "bg-yellowell/15 ring-yellowell"
                            : "bg-canvas ring-line hover:ring-yellowell/50"
                        }`}
                      >
                        <p className="text-[13px] font-bold text-ink">
                          {model.label}
                        </p>
                        <p className="mt-1 text-[12px] text-muted">
                          {ethHolders
                            ? "Pool fees are ETH. Your cut is wrapped to WETH and pushed to current holders at $50."
                            : model.blurb}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {network.id === "robinhood" ? (
                  <PercentField
                    label={
                      feeModel === "holders"
                        ? `Holders cut of pool fees (in ${
                            selectedPair && isNativeEth(selectedPair)
                              ? "WETH"
                              : pairLabel
                          })`
                        : `Creator cut of pool fees (in ${pairLabel})`
                    }
                    valueBps={fees.buyTaxBps}
                    onChange={(value) => {
                      const bps = clampTaxBps(value);
                      setFees((current) => ({
                        ...current,
                        buyTaxBps: bps,
                        sellTaxBps: bps,
                      }));
                    }}
                  />
                ) : (
                  <div className="grid gap-5 sm:grid-cols-2">
                    <PercentField
                      label="Buy tax"
                      valueBps={fees.buyTaxBps}
                      onChange={(value) =>
                        setFees((current) => ({
                          ...current,
                          buyTaxBps: clampTaxBps(value),
                        }))
                      }
                    />
                    <PercentField
                      label="Sell tax"
                      valueBps={fees.sellTaxBps}
                      onChange={(value) =>
                        setFees((current) => ({
                          ...current,
                          sellTaxBps: clampTaxBps(value),
                        }))
                      }
                    />
                  </div>
                )}

                <p
                  className={`text-[12px] ${feeError ? "text-down" : "text-muted"}`}
                >
                  {feeError
                    ? feeError
                    : network.id === "robinhood"
                      ? `Traders pay 1% protocol + your ${formatTax(fees.buyTaxBps)}${feeModel === "holders" ? " to holders" : " to you"}, in ${pairLabel}.`
                      : `Split total ${splitPct}% · ${summary.split}`}
                </p>
              </div>
            ) : null}
          </div>

          <LaunchSubmitGate
            name={name}
            ticker={ticker}
            description={description}
            image={image}
            twitter={twitter}
            telegram={telegram}
            website={website}
            firstBuyUsdc={firstBuyUsdc}
            fees={fees}
            tributeRecipient=""
            pairAsset={selectedPair ?? undefined}
            payWithEth={
              Boolean(rh && selectedPair && !isNativeEth(selectedPair) && payWithEth)
            }
            pairReady={
              !rh ||
              (selectedPair !== null &&
                pairMeta !== null &&
                (isNativeEth(selectedPair) ||
                  selectedPair.toLowerCase() ===
                    network.protocol.pairAsset.toLowerCase() ||
                  selectedPair.toLowerCase() === RH_USDG.toLowerCase() ||
                  dexEligible ||
                  (pairGate !== "checking" &&
                    pairGate !== null &&
                    pairGate.ok)))
            }
          />
        </form>
      </section>

      <aside className="h-fit self-start rounded-2xl bg-raised p-3 ring-1 ring-line lg:sticky lg:top-24">
        <div className="flex items-center gap-2">
          {preview || tokenImageDisplaySrc(image) ? (
            <img
              src={preview || tokenImageDisplaySrc(image)}
              alt=""
              className="size-9 rounded-lg object-cover"
            />
          ) : (
            <div className="grid size-9 place-items-center rounded-lg bg-canvas text-muted ring-1 ring-line">
              +
            </div>
          )}
          <div>
            <p className="text-[10px] font-medium tracking-[0.16em] text-muted uppercase">
              Your token
            </p>
            <h2 className="font-display text-[16px] tracking-wide text-ink">
              {ticker || "TICKER"}
            </h2>
          </div>
        </div>
        <p className="mt-2 text-[12px] text-muted">{name || "Token name"}</p>
        {description ? (
          <p className="mt-2 text-[13px] leading-6 text-muted">{description}</p>
        ) : null}

        <dl className="mt-3 space-y-0">
          <Row label="Supply" value={TOTAL_SUPPLY.toLocaleString()} />
          <Row label="Opening FDV" value={`$${TARGET_FDV_USD.toLocaleString()}`} />
          <Row label="Paired with" value={pairLabel} />
          <Row label="New pool" value={`${newTicker} / ${pairLabel}`} />
          <Row label="Network" value={network.shortName} />
          <Row label="Fee model" value={FEE_MODELS.find((model) => model.id === feeModel)?.label ?? "Custom"} />
          {rh ? (
            <>
              <Row label="Your cut" value={formatTax(fees.buyTaxBps)} />
              <Row label="Zorp protocol" value="1%" />
              <Row
                label="Trader pays"
                value={`${formatTax(protocolBps + fees.buyTaxBps)} pool fee`}
              />
              <Row
                label="Goes to"
                value={feeModel === "holders" ? "Holders" : "You"}
              />
            </>
          ) : (
            <>
              <Row label="Your tax" value={summary.tax} />
              <Row label="Zorp protocol" value={summary.protocol} />
              <Row label="Trader pays" value={summary.effective} />
              <Row label="Tax split" value={summary.split} />
            </>
          )}
          {Number(firstBuyUsdc) > 0 ? (
            <Row
              label="First buy"
              value={
                ethFirstBuy
                  ? `${firstBuyUsdc} ETH → ${pairLabel}`
                  : `${firstBuyUsdc} ${rh ? pairLabel : pair}`
              }
            />
          ) : null}
          <Row label="Liquidity" value="Locked" />
          <Row label="Trading" value="Live from block one" />
          <Row
            label="Factory"
            value={
              <a
                href={explorerAddress(network.protocol.factory)}
                target="_blank"
                rel="noreferrer"
                className="hover:text-yellowell"
              >
                {shortenAddress(network.protocol.factory)}
              </a>
            }
          />
        </dl>
      </aside>
    </main>
  );
}

function UsdcBalanceGate() {
  const { network } = useNetwork();
  const privyReady = usePrivyReady();
  const [Balance, setBalance] = useState<ComponentType | null>(null);

  useEffect(() => {
    if (!privyReady) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    void import("../components/wallet-usdc-balance").then((mod) => {
      if (!cancelled) setBalance(() => mod.WalletUsdcBalance);
    });
    return () => {
      cancelled = true;
    };
  }, [privyReady]);

  if (!Balance) {
    return <span className="text-[12px] text-muted">{network.protocol.pairSymbol}</span>;
  }
  return <Balance />;
}

function LaunchSubmitGate(props: LaunchSubmitProps) {
  const privyReady = usePrivyReady();
  const [Submit, setSubmit] = useState<ComponentType<LaunchSubmitProps> | null>(
    null,
  );

  useEffect(() => {
    if (!privyReady) {
      setSubmit(null);
      return;
    }
    let cancelled = false;
    void import("../components/launch-submit").then((mod) => {
      if (!cancelled) setSubmit(() => mod.LaunchSubmit);
    });
    return () => {
      cancelled = true;
    };
  }, [privyReady]);

  if (!Submit) {
    return (
      <button
        type="button"
        disabled
        className="h-12 w-full rounded-full bg-yellowell text-[15px] font-bold text-black opacity-60"
      >
        Connect wallet
      </button>
    );
  }

  return <Submit {...props} />;
}

const inputClass =
  "mt-2 h-11 w-full rounded-2xl bg-surface px-4 text-[14px] text-ink outline-none ring-1 ring-line placeholder:text-muted focus:ring-yellowell";

function PairPreview({
  pairMeta,
  pairMetaError,
  pairGate,
  pairLabel,
  newTicker,
  pairAddress,
  isWeth,
  bookUsd,
  dexEligible,
  explorer,
}: {
  pairMeta: PairTokenInfo | null;
  pairMetaError: string | null;
  pairGate: { ok: boolean; usd6: bigint } | "checking" | null;
  pairLabel: string;
  newTicker: string;
  pairAddress: Address;
  isWeth: boolean;
  bookUsd: number | null;
  dexEligible: boolean;
  explorer: string;
}) {
  return (
    <div className="rounded-2xl bg-canvas px-4 py-3 ring-1 ring-line">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-[18px] tracking-wide text-ink">
            {pairMeta?.symbol ?? pairLabel}
          </p>
          <p className="mt-0.5 text-[13px] text-muted">
            {pairMetaError
              ? pairMetaError
              : pairMeta
                ? pairMeta.name
                : pairGate === "checking"
                  ? "Reading token…"
                  : "Token"}
          </p>
        </div>
        <a
          href={explorer}
          target="_blank"
          rel="noreferrer"
          className="text-[12px] text-muted hover:text-yellowell"
        >
          {shortenAddress(pairAddress)}
        </a>
      </div>
      <p className="mt-3 text-[13px] text-ink">
        New book · {newTicker} / {pairMeta?.symbol ?? pairLabel}
      </p>
      <p className="mt-1 text-[12px] leading-5 text-muted">
        Locked Uniswap v4 pool. Traders buy and sell against{" "}
        {pairMeta?.symbol ?? pairLabel}
        {isWeth ? "." : " — not WETH."} Fees are paid in{" "}
        {pairMeta?.symbol ?? pairLabel}.
      </p>
      <p className="mt-2 text-[12px] text-muted">
        {isWeth
          ? `${pairMeta?.symbol ?? pairLabel} is always allowed.`
          : pairGate === "checking"
            ? "Checking if this token already trades on Uniswap…"
            : pairGate?.ok || dexEligible
              ? `Eligible to pair.${bookUsd && bookUsd > 0 ? ` Uniswap depth ≈ $${bookUsd.toLocaleString("en-US")}.` : ""}`
              : "Not eligible yet. This token needs at least $5,000 of Uniswap liquidity versus ETH, WETH, or USDG."}
      </p>
    </div>
  );
}

function formatPctDraft(bps: number) {
  return (bps / 100).toFixed(bps % 100 === 0 ? 0 : 1);
}

function PercentField({
  label,
  valueBps,
  onChange,
}: {
  label: string;
  valueBps: number;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(() => formatPctDraft(valueBps));

  useEffect(() => {
    setDraft(formatPctDraft(valueBps));
  }, [valueBps]);

  return (
    <label className="block">
      <span className="text-[11px] font-medium tracking-[0.16em] text-muted uppercase">
        {label}
      </span>
      <div className="relative">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={10}
          step={0.1}
          value={draft}
          aria-label={label}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            if (next === "" || next === "." || next.endsWith(".")) return;
            onChange(next);
          }}
          onBlur={() => {
            const bps = clampTaxBps(draft);
            onChange(formatPctDraft(bps));
            setDraft(formatPctDraft(bps));
          }}
          className={`${inputClass} pr-12`}
        />
        <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-[13px] text-muted">
          %
        </span>
      </div>
    </label>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="block">
      <span className="text-[13px] font-bold tracking-[0.16em] text-ink uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line py-1.5 text-[11px]">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );
}

