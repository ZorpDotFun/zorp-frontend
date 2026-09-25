export type DocsGroup = {
  id: string;
  label: string;
  items: DocsItem[];
};

export type DocsItem = {
  slug: string;
  title: string;
};

export const DOCS_NAV: DocsGroup[] = [
  {
    id: "how",
    label: "How it works",
    items: [
      { slug: "overview", title: "Overview" },
      { slug: "liquidity", title: "Liquidity" },
      { slug: "trades", title: "Trades" },
      { slug: "markets", title: "Markets" },
      { slug: "fees", title: "Fees" },
      { slug: "risks", title: "Risks" },
    ],
  },
  {
    id: "builders",
    label: "Builders",
    items: [
      { slug: "network", title: "Network" },
      { slug: "contracts", title: "Contracts" },
      { slug: "events", title: "Events" },
      { slug: "support", title: "Support" },
      { slug: "terms", title: "Terms" },
    ],
  },
];

const LEGACY: Record<string, string> = {
  "launch-mechanism": "liquidity",
  "trading-and-pricing": "trades",
  "fees-and-burns": "fees",
  "protocol-revenue": "fees",
  "community-takeovers": "overview",
  "risk-disclosures": "risks",
  "onchain-events": "events",
  "reading-token-state": "contracts",
  "pricing-and-graduation": "trades",
  "reference-token": "contracts",
  "terms-and-attribution": "terms",
  graduation: "liquidity",
};

export const DEFAULT_DOCS_SLUG = "overview";

export function resolveDocsSlug(slug: string) {
  return LEGACY[slug] ?? slug;
}

export function docsItems() {
  return DOCS_NAV.flatMap((group) => group.items);
}

export function docsItem(slug: string) {
  const resolved = resolveDocsSlug(slug);
  return docsItems().find((item) => item.slug === resolved) ?? null;
}

export function docsNeighbors(slug: string) {
  const items = docsItems();
  const resolved = resolveDocsSlug(slug);
  const index = items.findIndex((item) => item.slug === resolved);
  return {
    prev: index > 0 ? items[index - 1] : null,
    next: index >= 0 && index < items.length - 1 ? items[index + 1] : null,
  };
}
