import type { ReactNode } from "react";

export function PageWash({ children }: { children: ReactNode }) {
  return (
    <div className="page-wash">
      <div className="home-hero__sky pointer-events-none" aria-hidden="true">
        <span className="home-hero__cloud home-hero__cloud--a" />
        <span className="home-hero__cloud home-hero__cloud--b" />
        <span className="home-hero__cloud home-hero__cloud--c" />
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  );
}
