import type { Route } from "./+types/home";
import { HomePage } from "../home/home-page";
import { socialImageMeta, siteOrigin } from "../lib/site-meta";

const SITE_TITLE = "Zorp : The native launchpad";
const SITE_DESCRIPTION =
  "The native launchpad on Arc and Robinhood. Non-custodial tokens, live from block one.";

export function meta({}: Route.MetaArgs) {
  return [
    { title: SITE_TITLE },
    { name: "description", content: SITE_DESCRIPTION },
    { property: "og:title", content: SITE_TITLE },
    { property: "og:description", content: SITE_DESCRIPTION },
    { property: "og:type", content: "website" },
    { name: "twitter:title", content: SITE_TITLE },
    { name: "twitter:description", content: SITE_DESCRIPTION },
    ...socialImageMeta(siteOrigin()),
  ];
}

export default function Home() {
  return <HomePage />;
}
