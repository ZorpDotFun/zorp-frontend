import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (env.BLOCKSCOUT_API_KEY) {
    process.env.BLOCKSCOUT_API_KEY = env.BLOCKSCOUT_API_KEY;
  }
  if (env.ETHERSCAN_API_KEY) {
    process.env.ETHERSCAN_API_KEY = env.ETHERSCAN_API_KEY;
  }
  if (env.ALCHEMY_API_KEY) {
    process.env.ALCHEMY_API_KEY = env.ALCHEMY_API_KEY;
  }
  if (env.ALCHEMY_HTTPS) {
    process.env.ALCHEMY_HTTPS = env.ALCHEMY_HTTPS;
  }
  const privyAppId = env.VITE_PRIVY_APP_ID || env.PRIVY_APP_ID || "";
  const privyClientId = env.VITE_PRIVY_CLIENT_ID || env.PRIVY_CLIENT_ID || "";

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
