import { profileAvatarSrc } from "../lib/profile-avatar";

export function ProfileAvatar({
  address,
  className = "size-6",
}: {
  address?: string | null;
  className?: string;
}) {
  return (
    <img
      src={profileAvatarSrc(address)}
      alt=""
      className={`shrink-0 rounded-full object-cover ${className}`}
    />
  );
}
