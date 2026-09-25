import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const privyAppId = env.VITE_PRIVY_APP_ID || env.PRIVY_APP_ID || "";
  const privyClientId = env.VITE_PRIVY_CLIENT_ID || env.PRIVY_CLIENT_ID || "";
  if (env.QUICKNODE_HTTPS) process.env.QUICKNODE_HTTPS = env.QUICKNODE_HTTPS;
  if (env.VITE_RH_RPC) process.env.VITE_RH_RPC = env.VITE_RH_RPC;

  return {
    plugins: [tailwindcss(), reactRouter()],
    resolve: {
      tsconfigPaths: true,
    },
    define: {
      "import.meta.env.VITE_PRIVY_APP_ID": JSON.stringify(privyAppId),
      "import.meta.env.VITE_PRIVY_CLIENT_ID": JSON.stringify(privyClientId),
    },
    server: {
      proxy: {
        "/zorp-api": {
          target: "http://127.0.0.1:8787",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/zorp-api/, ""),
        },
      },
    },
  };
});
