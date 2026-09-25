import type { Route } from "./+types/explore";
import { ExploreSection } from "../components/explore-section";
import { useLaunches } from "../lib/use-launches";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Explore : Zorp" },
    {
      name: "description",
      content: "Browse live Zorp launches on Robinhood. Search, filter, and trade from block one.",
    },
  ];
}

export default function ExplorePage() {
  const launches = useLaunches();

  return (
    <main className="pt-8 sm:pt-10">
      <ExploreSection
        tokens={launches.tokens}
        loading={launches.loading && launches.tokens.length === 0}
        error={launches.error}
      />
    </main>
  );
}
