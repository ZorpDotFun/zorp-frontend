export async function uploadTokenImage(file: File): Promise<string> {
  if (file.size > 2_000_000) {
    throw new Error("Image must be under 2MB.");
  }
  const body = new FormData();
  body.append("file", file);
  const response = await fetch("/api/upload", { method: "POST", body });
  const payload = (await response.json()) as { url?: string; error?: string };
  if (!response.ok || !payload.url) {
    throw new Error(payload.error || "Image upload failed.");
  }
  return payload.url;
}
