export function ZorpMark({
  className = "size-9",
  alt = "Zorp",
}: {
  className?: string;
  alt?: string;
}) {
  return (
    <img
      src="/assets/logos/z-3d.png?v=3"
      alt={alt}
      className={`object-contain ${className}`}
    />
  );
}
