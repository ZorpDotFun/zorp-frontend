import { inject } from "@vercel/analytics";
import { useEffect } from "react";

export function VercelAnalytics() {
  useEffect(() => {
    inject();
  }, []);
  return null;
}
