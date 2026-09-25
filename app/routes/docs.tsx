import { Navigate, useParams } from "react-router";
import type { Route } from "./+types/docs";
import { DocsShell } from "../components/docs-shell";
import { DEFAULT_DOCS_SLUG, docsItem, resolveDocsSlug } from "../lib/docs";
import { docsBody } from "../lib/docs-pages";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Docs : Zorp" },
    {
      name: "description",
      content: "How Zorp launches any-pair tokens on Robinhood Chain.",
    },
  ];
}

export default function DocsIndex() {
  return <Navigate to={`/docs/${DEFAULT_DOCS_SLUG}`} replace />;
}

export function DocsArticlePage() {
  const { slug = DEFAULT_DOCS_SLUG } = useParams();
  const item = docsItem(slug);
  if (item && resolveDocsSlug(slug) !== item.slug) {
    return <Navigate to={`/docs/${item.slug}`} replace />;
  }
  if (!item) {
    return (
      <DocsShell slug="overview" title="Not found">
        <p>That docs page does not exist.</p>
      </DocsShell>
    );
  }
  return (
    <DocsShell slug={item.slug} title={item.title}>
      {docsBody(item.slug)}
    </DocsShell>
  );
}
