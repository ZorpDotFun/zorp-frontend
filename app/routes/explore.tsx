import type { Route } from "./+types/explore";
import { ExploreSection } from "../components/explore-section";
import { readCachedRhTape } from "../lib/launch-tape.server";
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

export async function loader() {
  try {
    return { tokens: await readCachedRhTape() };
  } catch {
    return { tokens: [] };
  }
}

export default function ExplorePage({ loaderData }: Route.ComponentProps) {
  const launches = useLaunches(loaderData.tokens);

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
