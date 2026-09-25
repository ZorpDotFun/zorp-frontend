export const PROFILE_AVATARS = [
  "/assets/profiles/cat-01.png",
  "/assets/profiles/cat-02.png",
  "/assets/profiles/cat-03.png",
  "/assets/profiles/cat-04.png",
  "/assets/profiles/cat-05.png",
  "/assets/profiles/cat-06.png",
  "/assets/profiles/cat-07.png",
  "/assets/profiles/cat-08.png",
] as const;

export function profileAvatarSrc(address?: string | null) {
  if (!address) return PROFILE_AVATARS[0];
  const key = address.toLowerCase();
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return PROFILE_AVATARS[hash % PROFILE_AVATARS.length];
}
