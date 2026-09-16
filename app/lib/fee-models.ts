export type FeeConfig = {
  buyTaxBps: number;
  sellTaxBps: number;
  creatorBps: number;
  dividendBps: number;
  buybackBps: number;
  autoLpBps: number;
  tributeBps: number;
  protocolBps: number;
};

export type FeeModelId =
  | "creator"
  | "diamond"
  | "buyback"
  | "autolp"
  | "tribute"
  | "custom";

export const MAX_TAX_BPS = 1_000;
export const SPLIT_BPS = 10_000;
/** On-chain `ZorpBuyback.protocolFeeBps`. Taken in USDC on every trade, on top of the launch tax. */
export const PROTOCOL_SWAP_FEE_BPS = 50;

export const FEE_MODELS: {
  id: FeeModelId;
  label: string;
  blurb: string;
  taxBps: number;
  split: Omit<FeeConfig, "buyTaxBps" | "sellTaxBps">;
}[] = [
  {
    id: "creator",
    label: "Creator backed",
    blurb: "Tax goes to the token creator.",
    taxBps: 100,
    split: {
      creatorBps: 10_000,
      dividendBps: 0,
      buybackBps: 0,
      autoLpBps: 0,
      tributeBps: 0,
      protocolBps: 0,
    },
  },
  {
    id: "diamond",
    label: "Diamond hands",
    blurb: "Tax is paid to holders as USDC dividends.",
    taxBps: 300,
    split: {
      creatorBps: 0,
      dividendBps: 10_000,
      buybackBps: 0,
      autoLpBps: 0,
      tributeBps: 0,
      protocolBps: 0,
    },
  },
  {
    id: "buyback",
    label: "Deflationary",
    blurb: "Tax buys the token back and burns it.",
    taxBps: 300,
    split: {
      creatorBps: 0,
      dividendBps: 0,
      buybackBps: 10_000,
      autoLpBps: 0,
      tributeBps: 0,
      protocolBps: 0,
    },
  },
  {
    id: "autolp",
    label: "Auto-LP",
    blurb: "Tax is added back into the locked pool.",
    taxBps: 300,
    split: {
      creatorBps: 0,
      dividendBps: 0,
      buybackBps: 0,
      autoLpBps: 10_000,
      tributeBps: 0,
      protocolBps: 0,
    },
  },
  {
    id: "tribute",
    label: "Tribute",
    blurb: "Tax is sent to a wallet you choose.",
    taxBps: 300,
    split: {
      creatorBps: 0,
      dividendBps: 0,
      buybackBps: 0,
      autoLpBps: 0,
      tributeBps: 10_000,
      protocolBps: 0,
    },
  },
  {
    id: "custom",
    label: "Custom",
    blurb: "Split the tax across destinations. Must total 100%.",
    taxBps: 100,
    split: {
      creatorBps: 10_000,
      dividendBps: 0,
      buybackBps: 0,
      autoLpBps: 0,
      tributeBps: 0,
      protocolBps: 0,
    },
  },
];

export const DEFAULT_FEE_MODEL: FeeModelId = "creator";

export function feeModel(id: FeeModelId) {
  return FEE_MODELS.find((model) => model.id === id) ?? FEE_MODELS[0];
}

export function presetFees(id: FeeModelId): FeeConfig {
  const model = feeModel(id);
  return {
    buyTaxBps: model.taxBps,
    sellTaxBps: model.taxBps,
    ...model.split,
  };
}

export function splitTotal(fees: FeeConfig) {
  return (
    fees.creatorBps +
    fees.dividendBps +
    fees.buybackBps +
    fees.autoLpBps +
    fees.tributeBps +
    fees.protocolBps
  );
}

export function validateFees(fees: FeeConfig) {
  if (fees.buyTaxBps < 0 || fees.buyTaxBps > MAX_TAX_BPS) {
    return "Buy tax must be between 0% and 10%.";
  }
  if (fees.sellTaxBps < 0 || fees.sellTaxBps > MAX_TAX_BPS) {
    return "Sell tax must be between 0% and 10%.";
  }
  if (splitTotal(fees) !== SPLIT_BPS) {
    return "Fee split must add up to 100%.";
  }
  return null;
}

export function formatTax(bps: number) {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
}

export function formatSplit(bps: number) {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
}

export function feeSummary(fees: FeeConfig, protocolSwapBps = PROTOCOL_SWAP_FEE_BPS) {
  const destinations = (
    [
      ["Creator", fees.creatorBps],
      ["Holders", fees.dividendBps],
      ["Buyback", fees.buybackBps],
      ["Auto LP", fees.autoLpBps],
      ["Tribute", fees.tributeBps],
      ["Protocol share", fees.protocolBps],
    ] as const
  ).filter(([, bps]) => bps > 0);

  return {
    tax: `${formatTax(fees.buyTaxBps)} buy / ${formatTax(fees.sellTaxBps)} sell`,
    protocol: `${formatTax(protocolSwapBps)} USDC on every trade`,
    effective: `${formatTax(fees.buyTaxBps + protocolSwapBps)} buy / ${formatTax(fees.sellTaxBps + protocolSwapBps)} sell`,
    split:
      destinations.length === 0
        ? "None"
        : destinations.map(([label, bps]) => `${label} ${formatSplit(bps)}`).join(" · "),
  };
}

export function clampTaxBps(value: string) {
  const pct = Number(value);
  if (!Number.isFinite(pct) || pct < 0) return 0;
  return Math.min(MAX_TAX_BPS, Math.round(pct * 100));
}

export function feeDestinationLine(fees: FeeConfig) {
  const label = feeModelLabel(fees);
  if (label === "Auto-LP") {
    return "All fees are directed to liquidity.";
  }
  if (label === "Creator backed") {
    return "All fees are directed to the creator.";
  }
  if (label === "Diamond hands") {
    return "All fees are directed to holders as USDC dividends.";
  }
  if (label === "Deflationary") {
    return "All fees are directed to buyback and burn.";
  }
  if (label === "Tribute") {
    return "All fees are directed to the tribute wallet.";
  }
  const parts = (
    [
      fees.creatorBps ? "the creator" : null,
      fees.dividendBps ? "holders" : null,
      fees.buybackBps ? "buyback and burn" : null,
      fees.autoLpBps ? "liquidity" : null,
      fees.tributeBps ? "tribute" : null,
    ] as const
  ).filter(Boolean);
  if (parts.length === 0) return "Launch tax is off. The 0.5% protocol fee still applies.";
  if (parts.length === 1) return `All fees are directed to ${parts[0]}.`;
  return `Fees are split across ${parts.join(", ")}.`;
}

export function feeModelLabel(fees: FeeConfig) {
  const match = FEE_MODELS.find(
    (model) =>
      model.taxBps === fees.buyTaxBps &&
      model.taxBps === fees.sellTaxBps &&
      model.split.creatorBps === fees.creatorBps &&
      model.split.dividendBps === fees.dividendBps &&
      model.split.buybackBps === fees.buybackBps &&
      model.split.autoLpBps === fees.autoLpBps &&
      model.split.tributeBps === fees.tributeBps &&
      model.split.protocolBps === fees.protocolBps,
  );
  return match?.label ?? "Custom";
}

export function paysCreator(fees: FeeConfig) {
  return fees.creatorBps > 0 || fees.tributeBps > 0;
}

export function clampSplitBps(value: string) {
  const pct = Number(value);
  if (!Number.isFinite(pct) || pct < 0) return 0;
  return Math.min(SPLIT_BPS, Math.round(pct * 100));
}
