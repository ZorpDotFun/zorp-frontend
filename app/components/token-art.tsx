import { useEffect, useMemo, useState } from "react";
import { tokenImageSrcs } from "../lib/token-image";

type TokenArtProps = {
  ticker: string;
  hue: number;
  image?: string;
  className?: string;
};

export function TokenArt({
  ticker,
  hue,
  image,
  className = "",
}: TokenArtProps) {
  const srcs = useMemo(() => tokenImageSrcs(image), [image]);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setIndex(0);
    setFailed(false);
  }, [image]);

  const src = !failed ? srcs[index] : undefined;
  const letter = ticker.slice(0, 1);

  if (src) {
    return (
      <div className={`relative overflow-hidden bg-canvas ${className}`}>
        <img
          src={src}
          alt=""
          className="absolute inset-0 size-full object-cover"
          onError={() => {
            setIndex((current) => {
              if (current + 1 < srcs.length) return current + 1;
              setFailed(true);
              return current;
            });
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{
        background: `linear-gradient(145deg, hsl(${hue} 72% 14%) 0%, hsl(${(hue + 40) % 360} 48% 8%) 55%, #040468 100%)`,
      }}
      aria-hidden
    >
      <span
        className="absolute inset-0 flex items-center justify-center font-display text-[3.5rem] leading-none sm:text-[7rem]"
        style={{ color: `hsl(${hue} 90% 62%)` }}
      >
        {letter}
      </span>
    </div>
  );
}
