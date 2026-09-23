import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/create";
import { usePrivyReady } from "../components/app-privy-provider";
import {
  GRADUATION_MC_USD,
  TARGET_FDV_USD,
  TOTAL_SUPPLY,
} from "../lib/addresses";
import { explorerAddress, readProtocolFeeBps } from "../lib/factory";
import { useNetwork } from "../lib/use-network";
import {
  FEE_MODELS,
  PROTOCOL_SWAP_FEE_BPS,
  clampSplitBps,
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
import { PercentSlider } from "../components/percent-slider";
import type { LaunchSubmitProps } from "../components/launch-submit";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Create on Zorp" },
    {
      name: "description",
      content:
        "Launch a token on Arc or Robinhood. 1B supply into a locked Uniswap v4 pool, live from block one.",
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [feeModel, setFeeModel] = useState<FeeModelId>("creator");
  const [fees, setFees] = useState<FeeConfig>(() => presetFees("creator"));
  const [tributeRecipient, setTributeRecipient] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [protocolBps, setProtocolBps] = useState(PROTOCOL_SWAP_FEE_BPS);
  const summary = feeSummary(fees, protocolBps);
  const feeError = validateFees(fees);
  const splitPct = splitTotal(fees) / 100;

  useEffect(() => {
    void readProtocolFeeBps().then(setProtocolBps);
  }, []);

  useEffect(() => {
    return () => {
      if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
    };
  }, [preview]);

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
    <main className="mx-auto grid max-w-[1180px] gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:py-14">
      <section>
        <Link
          to="/"
          className="inline-flex h-9 items-center rounded-full bg-surface px-3.5 text-[13px] font-medium text-ink ring-1 ring-line hover:bg-raised"
        >
          ← Back to homepage
        </Link>
        <p className="mt-5 text-[12px] font-medium tracking-[0.16em] text-muted uppercase">
          /create
        </p>
        <h1 className="mt-3 font-display text-[32px] tracking-wide text-ink sm:text-[40px]">
          Launch token
        </h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
          Every launch mints 1,000,000,000 tokens into a locked Uniswap v4{" "}
          {pair} pool on {network.shortName} at a $3,000 FDV. Tradable from
          the first block. Graduation market cap is $40,000.
        </p>
        {network.protocol.deployed ? null : (
          <p className="mt-4 rounded-2xl bg-surface px-4 py-3 text-[13px] text-muted ring-1 ring-line">
            Zorp is not live on Robinhood yet. Broadcast{" "}
            <span className="text-ink">script/DeployRobinhood.s.sol</span>, then
            set the <span className="text-ink">VITE_RH_*</span> addresses.
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

          <Field label="Paired asset">
            <div className="mt-2 flex h-11 items-center justify-between rounded-2xl bg-surface px-4 text-[13px] text-ink ring-1 ring-line">
              <span>{pair}</span>
              <span className="text-muted">{network.protocol.pairHint}</span>
            </div>
          </Field>

          <div className="block">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-medium tracking-[0.16em] text-muted uppercase">
                Dev first buy · optional
              </span>
              <UsdcBalanceGate />
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
                {pair}
              </span>
            </div>
            <p className="mt-2 text-[12px] text-muted">
              Leave at 0 to only deploy. A first buy pulls {pair} from your
              wallet after an approve
              {pair === "WETH" ? " (ETH is wrapped if needed)" : ""}.
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
                  Buy/sell tax is 0–10%. The split of that tax must add to
                  100%. These values are written on-chain at launch.
                </p>
                <div className="rounded-2xl bg-canvas px-3 py-3 ring-1 ring-line">
                  <p className="text-[12px] font-medium text-ink">
                    Zorp protocol fee · {formatTax(protocolBps)} {pair}
                  </p>
                  <p className="mt-1 text-[12px] leading-5 text-muted">
                    Charged on every buy and sell, in the pair asset, on top of
                    the tax you set. It is not taken from your split. Traders
                    pay your tax plus this {formatTax(protocolBps)}.
                    The Custom “Protocol” slider is a separate optional share
                    of your tax, not this fee.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {FEE_MODELS.map((model) => {
                    const active = feeModel === model.id;
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
                          {model.blurb}
                        </p>
                      </button>
                    );
                  })}
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <PercentSlider
                    label="Buy tax"
                    max={10}
                    step={0.1}
                    value={fees.buyTaxBps / 100}
                    onChange={(value) =>
                      setFees((current) => ({
                        ...current,
                        buyTaxBps: clampTaxBps(value),
                      }))
                    }
                  />
                  <PercentSlider
                    label="Sell tax"
                    max={10}
                    step={0.1}
                    value={fees.sellTaxBps / 100}
                    onChange={(value) =>
                      setFees((current) => ({
                        ...current,
                        sellTaxBps: clampTaxBps(value),
                      }))
                    }
                  />
                </div>

                {feeModel === "custom" ? (
                  <div className="grid gap-5 sm:grid-cols-2">
                    <PercentSlider
                      label="Creator"
                      max={100}
                      value={fees.creatorBps / 100}
                      onChange={(value) =>
                        setFees((current) => ({
                          ...current,
                          creatorBps: clampSplitBps(value),
                        }))
                      }
                    />
                    <PercentSlider
                      label="Holders"
                      max={100}
                      value={fees.dividendBps / 100}
                      onChange={(value) =>
                        setFees((current) => ({
                          ...current,
                          dividendBps: clampSplitBps(value),
                        }))
                      }
                    />
                    <PercentSlider
                      label="Buyback"
                      max={100}
                      value={fees.buybackBps / 100}
                      onChange={(value) =>
                        setFees((current) => ({
                          ...current,
                          buybackBps: clampSplitBps(value),
                        }))
                      }
                    />
                    <PercentSlider
                      label="Auto LP"
                      max={100}
                      value={fees.autoLpBps / 100}
                      onChange={(value) =>
                        setFees((current) => ({
                          ...current,
                          autoLpBps: clampSplitBps(value),
                        }))
                      }
                    />
                    <PercentSlider
                      label="Tribute"
                      max={100}
                      value={fees.tributeBps / 100}
                      onChange={(value) =>
                        setFees((current) => ({
                          ...current,
                          tributeBps: clampSplitBps(value),
                        }))
                      }
                    />
                    <PercentSlider
                      label="Protocol share of tax"
                      max={100}
                      value={fees.protocolBps / 100}
                      onChange={(value) =>
                        setFees((current) => ({
                          ...current,
                          protocolBps: clampSplitBps(value),
                        }))
                      }
                    />
                  </div>
                ) : null}

                {fees.tributeBps > 0 ? (
                  <Field label="Tribute recipient">
                    <input
                      value={tributeRecipient}
                      onChange={(event) =>
                        setTributeRecipient(event.target.value)
                      }
                      placeholder="0x… (defaults to your wallet)"
                      className={inputClass}
                    />
                  </Field>
                ) : null}

                <p
                  className={`text-[12px] ${feeError ? "text-down" : "text-muted"}`}
                >
                  {feeError
                    ? feeError
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
            tributeRecipient={tributeRecipient}
          />
        </form>
      </section>

      <aside className="h-fit self-start rounded-3xl bg-raised p-6 ring-1 ring-line lg:sticky lg:top-24">
        <div className="flex items-center gap-3">
          {preview || tokenImageDisplaySrc(image) ? (
            <img
              src={preview || tokenImageDisplaySrc(image)}
              alt=""
              className="size-12 rounded-xl object-cover"
            />
          ) : (
            <div className="grid size-12 place-items-center rounded-xl bg-canvas text-muted ring-1 ring-line">
              +
            </div>
          )}
          <div>
            <p className="text-[11px] font-medium tracking-[0.16em] text-muted uppercase">
              Your token
            </p>
            <h2 className="font-display text-[22px] tracking-wide text-ink">
              {ticker || "TICKER"}
            </h2>
          </div>
        </div>
        <p className="mt-3 text-[14px] text-muted">{name || "Token name"}</p>
        {description ? (
          <p className="mt-2 text-[13px] leading-6 text-muted">{description}</p>
        ) : null}

        <dl className="mt-6 space-y-0">
          <Row label="Supply" value={TOTAL_SUPPLY.toLocaleString()} />
          <Row label="Opening FDV" value={`$${TARGET_FDV_USD.toLocaleString()}`} />
          <Row
            label="Graduation MC"
            value={`$${GRADUATION_MC_USD.toLocaleString()}`}
          />
          <Row label="Paired with" value={pair} />
          <Row label="Network" value={network.shortName} />
          <Row label="Fee model" value={FEE_MODELS.find((model) => model.id === feeModel)?.label ?? "Custom"} />
          <Row label="Your tax" value={summary.tax} />
          <Row label="Zorp protocol" value={summary.protocol} />
          <Row label="Trader pays" value={summary.effective} />
          <Row label="Tax split" value={summary.split} />
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

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="block">
      <span className="text-[11px] font-medium tracking-[0.16em] text-muted uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-2.5 text-[13px]">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );
}

