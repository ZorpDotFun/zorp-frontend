import { ExploreSection } from "../components/explore-section";
import { GraduatedSection } from "../components/graduated-section";
import { tokenHasGraduated } from "../lib/tokens";
import { useLaunches } from "../lib/use-launches";

export function HomePage() {
  const launches = useLaunches();
  const exploring = launches.tokens.filter((token) => !tokenHasGraduated(token));
  const graduated = launches.tokens.filter((token) => tokenHasGraduated(token));

  return (
    <div className="relative">
      <div className="relative space-y-14 pt-8">
        <GraduatedSection
          tokens={graduated}
          loading={launches.loading && launches.tokens.length === 0}
          error={launches.error}
        />
        <ExploreSection
          tokens={exploring}
          loading={launches.loading && launches.tokens.length === 0}
          error={launches.error}
        />
      </div>
    </div>
  );
}
