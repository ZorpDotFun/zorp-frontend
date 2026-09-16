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
    id: "protocol",
    label: "Protocol",
    items: [
      { slug: "overview", title: "Overview" },
      { slug: "launch-mechanism", title: "Launch mechanism" },
      { slug: "trading-and-pricing", title: "Trading and pricing" },
      { slug: "graduation", title: "Graduation" },
      { slug: "fees-and-burns", title: "Fees and burns" },
      { slug: "protocol-revenue", title: "Protocol revenue" },
      { slug: "community-takeovers", title: "Community takeovers" },
      { slug: "risk-disclosures", title: "Risk disclosures" },
    ],
  },
  {
    id: "integration",
    label: "Integration",
    items: [
      { slug: "network", title: "Network" },
      { slug: "contracts", title: "Contracts" },
      { slug: "onchain-events", title: "Onchain events" },
      { slug: "reading-token-state", title: "Reading token state" },
      { slug: "pricing-and-graduation", title: "Pricing and graduation" },
      { slug: "reference-token", title: "Reference token" },
      { slug: "support", title: "Support" },
      { slug: "terms-and-attribution", title: "Terms and attribution" },
    ],
  },
];

export const DEFAULT_DOCS_SLUG = "overview";

export function docsItems() {
  return DOCS_NAV.flatMap((group) => group.items);
}

export function docsItem(slug: string) {
  return docsItems().find((item) => item.slug === slug) ?? null;
}

export function docsNeighbors(slug: string) {
  const items = docsItems();
  const index = items.findIndex((item) => item.slug === slug);
  return {
    prev: index > 0 ? items[index - 1] : null,
    next: index >= 0 && index < items.length - 1 ? items[index + 1] : null,
  };
}
