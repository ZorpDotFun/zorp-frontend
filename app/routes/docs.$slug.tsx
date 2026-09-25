import type { Route } from "./+types/docs.$slug";
import { docsItem } from "../lib/docs";
import { DocsArticlePage } from "./docs";

export function meta({ params }: Route.MetaArgs) {
  const item = docsItem(params.slug ?? "");
  return [
    { title: item ? `${item.title} : Zorp docs` : "Docs : Zorp" },
    {
      name: "description",
      content: item
        ? `${item.title} in the Zorp docs.`
        : "How Zorp launches any-pair tokens on Robinhood Chain.",
    },
  ];
}

export default function DocsArticle() {
  return <DocsArticlePage />;
}
