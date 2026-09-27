import { Link } from "react-router";
import { ZorpCa } from "./zorp-ca";

export function HomeHero() {
  return (
    <section className="home-hero">
      <div className="home-hero__sky" aria-hidden="true">
        <span className="home-hero__cloud home-hero__cloud--a" />
        <span className="home-hero__cloud home-hero__cloud--b" />
        <span className="home-hero__cloud home-hero__cloud--c" />
      </div>
      <div className="home-hero__inner">
        <h1 className="home-hero__title">Launch tokens backed by anything</h1>
        <p className="home-hero__lede">
          Pair a new coin with stocks, memes, ETH, or any liquid token. Locked
          Uniswap v4. Tradable from the first block.
        </p>
        <div className="home-hero__links">
          <Link to="/launch" className="home-hero__cta">
            Launch a token
          </Link>
          <Link to="/discover" className="home-hero__cta">
            Discover tokens
          </Link>
        </div>
        <ZorpCa compact className="home-hero__ca justify-center" />
      </div>
    </section>
  );
}
