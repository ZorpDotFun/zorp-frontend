import { useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router";
import { DOCS_NAV, docsNeighbors } from "../lib/docs";
import { PageWash } from "./page-wash";

export function DocsShell({
  slug,
  title,
  children,
}: {
  slug: string;
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { prev, next } = docsNeighbors(slug);

  return (
    <PageWash>
      <main className="mx-auto max-w-[1180px] px-4 pb-16 pt-6 sm:px-6">
        <div className="lg:hidden">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="page-cta mb-5"
          >
            {open ? "Hide contents" : "Contents"}
          </button>
          {open ? (
            <div className="mb-8 rounded-3xl bg-raised p-4 ring-1 ring-line">
              <DocsNav slug={slug} onPick={() => setOpen(false)} />
            </div>
          ) : null}
        </div>

        <div className="grid items-start gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <DocsNav slug={slug} />
          </aside>

          <article className="min-w-0">
            <p className="page-lede text-[13px] tracking-[0.16em] uppercase">
              Docs
            </p>
            <h1 className="page-title page-title-lg mt-2">{title}</h1>
            <div className="docs-prose mt-6">{children}</div>
            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6">
              {prev ? (
                <Link to={`/docs/${prev.slug}`} className="page-cta">
                  ← {prev.title}
                </Link>
              ) : (
                <span />
              )}
              {next ? (
                <Link to={`/docs/${next.slug}`} className="page-cta">
                  {next.title} →
                </Link>
              ) : (
                <span />
              )}
            </div>
          </article>
        </div>
      </main>
    </PageWash>
  );
}

function DocsNav({ slug, onPick }: { slug: string; onPick?: () => void }) {
  return (
    <nav aria-label="Docs">
      {DOCS_NAV.map((group) => (
        <div key={group.id} className="mb-7 last:mb-0">
          <p className="page-lede px-3 text-[12px] tracking-[0.14em] uppercase">
            {group.label}
          </p>
          <ul className="mt-2 space-y-0.5">
            {group.items.map((item) => {
              const active = item.slug === slug;
              return (
                <li key={item.slug}>
                  <NavLink
                    to={`/docs/${item.slug}`}
                    onClick={onPick}
                    className={`page-title flex rounded-lg px-3 py-1.5 text-[15px] ${
                      active
                        ? "bg-yellowell/20 font-medium text-ink shadow-[inset_2px_0_0_#7BEC1E]"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    {item.title}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
