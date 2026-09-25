import { HomeHero } from "../components/home-hero";
import { HowItWorks } from "../components/how-it-works";
import { TrendingTokens } from "../components/trending-tokens";
import { useLaunches } from "../lib/use-launches";

export function HomePage() {
  const launches = useLaunches();

  return (
    <div className="relative flex flex-col gap-8 sm:gap-10">
      <HomeHero />
      <TrendingTokens
        tokens={launches.tokens}
        loading={launches.loading && launches.tokens.length === 0}
        error={launches.error}
      />
      <HowItWorks />
    </div>
  );
}
