import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("explore", "routes/explore.tsx"),
  route("create", "routes/create.tsx"),
  route("token/:address", "routes/token.$address.tsx"),
  route("docs", "routes/docs.tsx"),
  route("docs/:slug", "routes/docs.$slug.tsx"),
  route("analytics", "routes/analytics.tsx"),
  route("api/upload", "routes/api.upload.ts"),
  route("zorp.tokenlist.json", "routes/zorp.tokenlist.json.ts"),
  route("api/verify", "routes/api.verify.ts"),
  route("api/rh-rpc", "routes/api.rh-rpc.ts"),
  route("api/launches", "routes/api.launches.ts"),
  route("api/market", "routes/api.market.ts"),
  route("api/quote-tokens", "routes/api.quote-tokens.ts"),
] satisfies RouteConfig;
