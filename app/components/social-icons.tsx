import { socialHref } from "../lib/tokens";

type SocialIconsProps = {
  twitter?: string;
  telegram?: string;
  website?: string;
  className?: string;
};

export function SocialIcons({
  twitter,
  telegram,
  website,
  className = "",
}: SocialIconsProps) {
  const links = [
    telegram ? { label: "Telegram", href: socialHref(telegram), icon: TelegramIcon } : null,
    twitter ? { label: "X", href: socialHref(twitter), icon: XIcon } : null,
    website ? { label: "Website", href: socialHref(website), icon: GlobeIcon } : null,
  ].filter((link): link is { label: string; href: string; icon: typeof XIcon } =>
    Boolean(link),
  );

  if (links.length === 0) return null;

  return (
    <div className={`flex items-center gap-2.5 text-muted ${className}`}>
      {links.map(({ label, href, icon: Icon }) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noreferrer"
          aria-label={label}
          className="transition hover:text-ink"
          onClick={(event) => event.stopPropagation()}
        >
          <Icon />
        </a>
      ))}
    </div>
  );
}

function TelegramIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21.2 4.3 3.6 11c-1.2.4-1.2 1.1-.2 1.4l4.5 1.4 1.7 5.3c.2.6.1.8.8.8.4 0 .6-.2.8-.4l2.4-2.3 5 3.7c.9.5 1.6.2 1.8-.9l3.3-15.6c.3-1.3-.5-1.8-1.5-1.4Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function XIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M17.6 2.3h3.4l-7.4 8.5 8.7 11H16l-5.1-6.7-5.8 6.7H1.6l7.9-9L1 2.3h6.4l4.6 6.1 5.6-6.1Zm-1.2 17.4h1.9L7.7 4.2H5.7l10.7 15.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M3.5 12h17M12 3c2.4 2.6 3.8 5.7 3.8 9s-1.4 6.4-3.8 9c-2.4-2.6-3.8-5.7-3.8-9s1.4-6.4 3.8-9Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
    </svg>
  );
}
