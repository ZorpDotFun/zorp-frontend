import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("create", "routes/create.tsx"),
  route("token/:address", "routes/token.$address.tsx"),
  route("docs", "routes/docs.tsx"),
  route("docs/:slug", "routes/docs.$slug.tsx"),
  route("analytics", "routes/analytics.tsx"),
  route("api/upload", "routes/api.upload.ts"),
  route("api/verify", "routes/api.verify.ts"),
] satisfies RouteConfig;
