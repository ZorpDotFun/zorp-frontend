import { Link, NavLink } from "react-router";
import { XIcon } from "./social-icons";

const SOCIALS = [
  {
    label: "X",
    href: "https://x.com/zorpdotfun",
    icon: XIcon,
  },
] as const;

export function Footer() {
  return (
    <footer className="mt-16 px-3 pb-6 sm:px-6">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-5 rounded-2xl px-4 py-5 ring-1 ring-line sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <Link to="/" className="flex items-center gap-1.5">
            <img
              src="/assets/logos/logomark-10x.png"
              alt="Zorp"
              className="size-8 rounded-lg object-cover"
            />
            <span className="font-display text-[16px] leading-none tracking-[0.16em] text-ink">
              ZORP
            </span>
          </Link>
          <p className="text-[13px] text-muted">
            Launch coins on Arc via zorpdotfun.com
          </p>
        </div>

        <div className="flex items-center gap-4">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `text-[13px] font-medium transition ${
                isActive ? "text-ink" : "text-muted hover:text-ink"
              }`
            }
          >
            Home
          </NavLink>
          <NavLink
            to="/create"
            className={({ isActive }) =>
              `text-[13px] font-medium transition ${
                isActive ? "text-ink" : "text-muted hover:text-ink"
              }`
            }
          >
            Create
          </NavLink>
          <NavLink
            to="/docs"
            className={({ isActive }) =>
              `text-[13px] font-medium transition ${
                isActive ? "text-ink" : "text-muted hover:text-ink"
              }`
            }
          >
            Docs
          </NavLink>
          <NavLink
            to="/analytics"
            className={({ isActive }) =>
              `text-[13px] font-medium transition ${
                isActive ? "text-ink" : "text-muted hover:text-ink"
              }`
            }
          >
            Analytics
          </NavLink>
          {SOCIALS.map(({ label, href, icon: Icon }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noreferrer"
              aria-label={`Zorp on ${label}`}
              className="text-muted transition hover:text-ink"
            >
              <Icon />
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
