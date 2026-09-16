export const SITE_ORIGIN = "https://zorpdotfun.com";
export const OG_IMAGE_PATH = "/assets/brand/space.png";
export const OG_IMAGE_WIDTH = "1024";
export const OG_IMAGE_HEIGHT = "341";
export const OG_IMAGE_ALT = "Zorp : The native Arc Launchpad";

export function siteOrigin(request?: Request) {
  const fromEnv = import.meta.env.VITE_SITE_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (request) {
    try {
      return new URL(request.url).origin;
    } catch {
      /* fall through */
    }
  }
  return SITE_ORIGIN;
}

export function ogImageUrl(origin = SITE_ORIGIN) {
  return `${origin}${OG_IMAGE_PATH}`;
}

export function socialImageMeta(origin = SITE_ORIGIN) {
  const image = ogImageUrl(origin);
  return [
    { property: "og:image", content: image },
    { property: "og:image:secure_url", content: image },
    { property: "og:image:alt", content: OG_IMAGE_ALT },
    { property: "og:image:width", content: OG_IMAGE_WIDTH },
    { property: "og:image:height", content: OG_IMAGE_HEIGHT },
    { property: "og:image:type", content: "image/png" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:image", content: image },
    { name: "twitter:image:alt", content: OG_IMAGE_ALT },
  ];
}
