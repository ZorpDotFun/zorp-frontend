/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PRIVY_APP_ID: string;
  readonly VITE_PRIVY_CLIENT_ID: string;
  readonly VITE_LAUNCH_FACTORY: string;
  readonly VITE_ARC_RPC: string;
  readonly VITE_ARC_EXPLORER: string;
  readonly VITE_SITE_URL: string;
  readonly VITE_API_URL: string;
  readonly VITE_RH_RPC: string;
  readonly VITE_RH_EXPLORER: string;
  readonly VITE_RH_LAUNCH_FACTORY: string;
  readonly VITE_RH_LAUNCH_HOOK: string;
  readonly VITE_RH_BUYBACK: string;
  readonly VITE_RH_FEE_DISTRIBUTOR: string;
  readonly VITE_RH_LAUNCH_LOCKER: string;
  readonly VITE_RH_COUNCIL: string;
  readonly VITE_RH_TIMELOCK: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
