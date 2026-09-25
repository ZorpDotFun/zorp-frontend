import type { Token } from "./tokens";

export async function fetchRhTape(): Promise<Token[] | null> {
  try {
    const res = await fetch("/api/launches");
    if (!res.ok) return null;
    const rows = (await res.json()) as Token[];
    return Array.isArray(rows) && rows.length > 0 ? rows : null;
  } catch {
    return null;
  }
}
