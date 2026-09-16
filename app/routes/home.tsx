import type { Route } from "./+types/home";
import { HomePage } from "../home/home-page";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Zorp — Launch on Arc" },
    {
      name: "description",
      content: "Non-custodial token launchpad on Arc. Live from block one.",
    },
  ];
}

export default function Home() {
  return <HomePage />;
}
