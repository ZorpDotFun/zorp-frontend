import { useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router";
import { DOCS_NAV, docsNeighbors } from "../lib/docs";

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
    <main className="mx-auto max-w-[1180px] px-4 py-8 sm:px-6 lg:py-10">
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="mb-5 flex h-10 items-center rounded-full bg-raised px-4 text-[13px] font-medium text-ink ring-1 ring-line"
        >
          {open ? "Hide contents" : "Contents"}
        </button>
        {open ? (
          <div className="mb-8 rounded-3xl bg-raised p-4 ring-1 ring-line">
            <DocsNav slug={slug} onPick={() => setOpen(false)} />
          </div>
        ) : null}
      </div>

      <div className="grid items-start gap-10 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden lg:sticky lg:top-24 lg:block">
          <DocsNav slug={slug} />
        </aside>

        <article className="min-w-0 pb-10">
          <p className="text-[12px] font-medium tracking-[0.16em] text-muted uppercase">
            Docs
          </p>
          <h1 className="mt-2 font-display text-[32px] tracking-wide text-ink sm:text-[36px]">
            {title}
          </h1>
          <div className="docs-prose mt-6">{children}</div>
          <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6">
            {prev ? (
              <Link
                to={`/docs/${prev.slug}`}
                className="text-[13px] text-muted hover:text-ink"
              >
                ← {prev.title}
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link
                to={`/docs/${next.slug}`}
                className="text-[13px] text-muted hover:text-ink"
              >
                {next.title} →
              </Link>
            ) : (
              <span />
            )}
          </div>
        </article>
      </div>
    </main>
  );
}

function DocsNav({ slug, onPick }: { slug: string; onPick?: () => void }) {
  return (
    <nav aria-label="Docs">
      {DOCS_NAV.map((group) => (
        <div key={group.id} className="mb-7 last:mb-0">
          <p className="px-3 text-[12px] font-medium tracking-[0.14em] text-muted uppercase">
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
                    className={`flex rounded-lg px-3 py-1.5 text-[14px] ${
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
