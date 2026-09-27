const GATEWAYS = [
  "https://gateway.pinata.cloud/ipfs/",
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://dweb.link/ipfs/",
];

const CID_RE =
  /(?:ipfs:\/\/|\/ipfs\/)?(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z2-7]{50,}|bafk[a-z2-7]{50,})/i;

export function tokenImageCid(raw?: string | null): string | undefined {
  return raw?.trim().match(CID_RE)?.[1];
}

/** Canonical on-chain pointer. Leaves non-IPFS https URLs untouched. */
export function toIpfsUri(raw?: string | null): string {
  const value = raw?.trim() ?? "";
  if (!value) return "";
  const cid = tokenImageCid(value);
  return cid ? `ipfs://${cid}` : value;
}

export function tokenImageSrcs(raw?: string | null): string[] {
  const value = raw?.trim() ?? "";
  if (!value) return [];
  const cid = tokenImageCid(value);
  const urls: string[] = [];
  if (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("/")
  ) {
    urls.push(value);
  }
  if (cid) {
    for (const gateway of GATEWAYS) urls.push(`${gateway}${cid}`);
  }
  return [...new Set(urls)];
}

export function tokenImageDisplaySrc(raw?: string | null): string | undefined {
  return tokenImageSrcs(raw)[0];
}
