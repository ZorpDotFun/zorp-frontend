export function apiUrl(path: string) {
  const base = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "/zorp-api" : "");
  if (!base) return "";
  return `${base.replace(/\/$/, "")}${path}`;
}

export async function fetchApiJson<T>(path: string): Promise<T | null> {
  const url = apiUrl(path);
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
