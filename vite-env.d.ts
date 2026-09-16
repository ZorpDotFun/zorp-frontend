/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PRIVY_APP_ID: string;
  readonly VITE_PRIVY_CLIENT_ID: string;
  readonly VITE_LAUNCH_FACTORY: string;
  readonly VITE_ARC_RPC: string;
  readonly VITE_ARC_EXPLORER: string;
  readonly VITE_SITE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
