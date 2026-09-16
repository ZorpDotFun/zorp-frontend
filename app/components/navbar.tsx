import { useEffect, useId, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { ConnectWallet } from "./connect-wallet";
import { useTheme } from "../lib/theme";

const NAV_LINKS = [
  { to: "/", label: "Home", end: true },
  { to: "/create", label: "Create" },
  { to: "/docs", label: "Docs" },
  { to: "/analytics", label: "Analytics" },
] as const;

export function Navbar() {
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const menuId = useId();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  function openMenu() {
    setShown(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setOpen(true));
    });
  }

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-50 bg-transparent px-3 pt-3 sm:px-6">
      <div className="nav-shell relative z-50 mx-auto flex h-14 max-w-[1180px] items-center justify-between rounded-2xl px-4 ring-1 ring-line sm:px-5">
        <Link to="/" className="relative z-10 flex items-center gap-1.5">
          <img
            src="/assets/logos/logomark-10x.png"
            alt="Zorp"
            className="size-9 rounded-lg object-cover"
          />
          <span className="font-display text-[18px] leading-none tracking-[0.16em] text-ink">
            ZORP
          </span>
        </Link>

        <nav
          className="relative z-10 hidden items-center gap-5 lg:flex"
          aria-label="Primary"
        >
          {NAV_LINKS.map((link) => (
            <NavItem key={link.to} {...link} />
          ))}
        </nav>

        <div className="relative z-10 flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={toggle}
            className="relative flex h-9 w-[68px] items-center rounded-full bg-surface ring-1 ring-line transition-colors"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            <span
              className={`absolute top-1 left-1 grid size-7 place-items-center rounded-full bg-ink text-canvas shadow-sm transition-transform duration-300 ${
                theme === "light" ? "translate-x-[30px]" : "translate-x-0"
              }`}
            >
              {theme === "dark" ? <MoonIcon /> : <SunIcon />}
            </span>
          </button>

          <ConnectWallet />

          <button
            type="button"
            className="grid size-9 place-items-center rounded-full bg-surface text-ink ring-1 ring-line lg:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => {
              if (open) setOpen(false);
              else openMenu();
            }}
          >
            <HamburgerIcon open={open} />
          </button>
        </div>
      </div>

      {shown ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className={`absolute inset-0 bg-black/50 transition-opacity duration-300 ease-out ${
              open ? "opacity-100" : "opacity-0"
            }`}
            onClick={() => setOpen(false)}
          />
          <nav
            id={menuId}
            aria-label="Mobile"
            onTransitionEnd={(event) => {
              if (event.target !== event.currentTarget) return;
              if (!open) setShown(false);
            }}
            className={`absolute inset-y-0 right-0 flex w-[min(20rem,86vw)] flex-col gap-1 bg-black px-5 pt-24 pb-8 shadow-[-24px_0_48px_rgba(0,0,0,0.45)] ring-1 ring-white/10 transition-transform duration-300 ease-out motion-reduce:transition-none ${
              open ? "translate-x-0" : "translate-x-full"
            }`}
          >
            {NAV_LINKS.map((link) => (
              <NavItem key={link.to} {...link} mobile />
            ))}
          </nav>
        </div>
      ) : null}
    </header>
  );
}

function NavItem({
  to,
  label,
  end,
  mobile,
}: {
  to: string;
  label: string;
  end?: boolean;
  mobile?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        mobile
          ? `rounded-xl px-3 py-3 text-[16px] font-medium text-white transition ${
              isActive ? "bg-white/10" : "hover:bg-white/10"
            }`
          : `text-[13px] font-medium transition ${
              isActive ? "text-ink" : "text-ink/80 hover:text-ink"
            }`
      }
    >
      {label}
    </NavLink>
  );
}

function HamburgerIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d={open ? "M3 3.5L13 13.5M13 3.5L3 13.5" : "M2.5 4.5h11M2.5 8h11M2.5 11.5h11"}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M16.5 13.2A7.2 7.2 0 0 1 10.8 4.2 7.4 7.4 0 1 0 19.8 13.2a7.1 7.1 0 0 1-3.3 0Z"
        fill="currentColor"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <path
        d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.1 5.1l1.6 1.6M17.3 17.3l1.6 1.6M18.9 5.1l-1.6 1.6M6.7 17.3l-1.6 1.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
