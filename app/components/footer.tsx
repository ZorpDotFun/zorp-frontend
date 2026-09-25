import { Link, NavLink } from "react-router";
import { TelegramIcon, XIcon } from "./social-icons";
import { ZorpMark } from "./zorp-mark";

const SOCIALS = [
  {
    label: "Telegram",
    href: "https://t.me/zorpdotfun",
    icon: TelegramIcon,
  },
  {
    label: "X",
    href: "https://x.com/zorpdotfun",
    icon: XIcon,
  },
] as const;

export function Footer() {
  return (
    <footer className="mt-20 px-3 pb-8 sm:mt-28 sm:px-6">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-5 rounded-2xl px-4 py-5 ring-1 ring-line sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <Link to="/" className="flex items-center gap-2">
            <ZorpMark className="size-9" />
            <span className="font-display text-[18px] leading-none text-ink">
              ZORP
            </span>
          </Link>
          <p className="text-[13px] text-muted">
            Launch coins on Robinhood via zorpdotfun.com
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
            to="/discover"
            className={({ isActive }) =>
              `text-[13px] font-medium transition ${
                isActive ? "text-ink" : "text-muted hover:text-ink"
              }`
            }
          >
            Discover
          </NavLink>
          <NavLink
            to="/launch"
            className={({ isActive }) =>
              `text-[13px] font-medium transition ${
                isActive ? "text-ink" : "text-muted hover:text-ink"
              }`
            }
          >
            Launch
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
          <Link
            to="/analytics"
            reloadDocument
            className="text-[13px] font-medium text-muted transition hover:text-ink"
          >
            Analytics
          </Link>
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
