import { useLayoutEffect } from "react";

/** Privy allowlists localhost, not 127.0.0.1 — they are different origins. */
export function PrivyDevOrigin() {
  useLayoutEffect(() => {
    if (!import.meta.env.DEV) return;
    if (window.location.hostname !== "127.0.0.1") return;
    const next = new URL(window.location.href);
    next.hostname = "localhost";
    window.location.replace(next.toString());
  }, []);
  return null;
}
