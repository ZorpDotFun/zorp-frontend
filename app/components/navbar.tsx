import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router";
import { RobinhoodWalletSync } from "./chain-switch";
import { ConnectWallet } from "./connect-wallet";
import { ZorpMark } from "./zorp-mark";
import { useTheme } from "../lib/theme";

const NAV_LINKS = [
  { to: "/", label: "Home", end: true },
  { to: "/explore", label: "Explore" },
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
    <header className="relative z-[100] px-3 pt-6 sm:px-6">
      <div className="nav-shell relative z-50 mx-auto flex h-16 w-full max-w-[1180px] items-center justify-between gap-2 overflow-visible px-1 sm:gap-3 sm:px-2">
        <Link to="/" className="relative z-10 flex min-w-0 shrink items-center gap-2.5">
          <ZorpMark className="size-11 shrink-0 sm:size-12" />
          <span className="hidden font-display text-[22px] leading-none font-semibold tracking-wide text-ink sm:inline">
            ZORP
          </span>
        </Link>

        <nav
          className="relative z-10 hidden items-center gap-8 lg:flex"
          aria-label="Primary"
        >
          {NAV_LINKS.map((link) => (
            <NavItem key={link.to} {...link} />
          ))}
        </nav>

        <div className="relative z-10 flex shrink-0 items-center gap-1 sm:gap-3">
          <RobinhoodWalletSync />
          <button
            type="button"
            onClick={toggle}
            className="relative hidden h-10 w-[76px] items-center rounded-full bg-surface ring-1 ring-line transition-colors md:flex"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            <span
              className={`absolute top-1 left-1 grid size-8 place-items-center rounded-full bg-ink text-canvas shadow-sm transition-transform duration-300 ${
                theme === "light" ? "translate-x-[34px]" : "translate-x-0"
              }`}
            >
              {theme === "dark" ? <MoonIcon /> : <SunIcon />}
            </span>
          </button>

          <span className="md:hidden">
            <ConnectWallet compact />
          </span>
          <span className="hidden md:inline-flex">
            <ConnectWallet />
          </span>

          <button
            type="button"
            onClick={toggle}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-surface text-ink ring-1 ring-line md:hidden"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? <MoonIcon /> : <SunIcon />}
          </button>

          <button
            type="button"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-surface text-ink ring-1 ring-line lg:hidden"
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

      {shown
        ? createPortal(
            <div className="fixed inset-0 z-[80] lg:hidden">
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
                className={`absolute inset-y-0 right-0 flex w-[min(20rem,86vw)] flex-col gap-1 bg-canvas px-5 pt-6 pb-8 shadow-[-24px_0_48px_rgba(0,0,0,0.45)] ring-1 ring-line transition-transform duration-300 ease-out motion-reduce:transition-none ${
                  open ? "translate-x-0" : "translate-x-full"
                }`}
              >
                <div className="mb-6 flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-muted">Menu</span>
                  <button
                    type="button"
                    className="grid size-9 place-items-center rounded-full bg-surface text-ink ring-1 ring-line"
                    aria-label="Close menu"
                    onClick={() => setOpen(false)}
                  >
                    <HamburgerIcon open />
                  </button>
                </div>
                {NAV_LINKS.map((link) => (
                  <NavItem key={link.to} {...link} mobile />
                ))}
              </nav>
            </div>,
            document.body,
          )
        : null}
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
  const location = useLocation();
  const active = end
    ? location.pathname === to
    : to === "/"
      ? location.pathname === "/"
      : location.pathname === to || location.pathname.startsWith(`${to}/`);

  return (
    <Link
      to={to}
      reloadDocument={to === "/analytics"}
      className={
        mobile
          ? `relative z-[110] rounded-xl px-3 py-3 text-[16px] font-medium text-ink transition ${
              active ? "bg-surface" : "hover:bg-surface"
            }`
          : `relative z-[110] text-[16px] font-semibold transition ${
              active ? "text-ink" : "text-ink/55 hover:text-ink"
            }`
      }
    >
      {label}
    </Link>
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
