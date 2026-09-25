import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

const PrivyReadyContext = createContext(false);

export function usePrivyReady() {
  return useContext(PrivyReadyContext);
}

function MarkReady({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    onReady();
  }, [onReady]);
  return null;
}

type PrivyRootProps = { children: ReactNode };

let privyRootLoad: Promise<ComponentType<PrivyRootProps>> | null = null;

export function loadPrivyRoot() {
  privyRootLoad ??= import("./privy-root")
    .then((mod) => mod.default)
    .catch((error) => {
      privyRootLoad = null;
      throw error;
    });
  return privyRootLoad;
}

export function AppPrivyProvider({ children }: { children: ReactNode }) {
  const appId = import.meta.env.VITE_PRIVY_APP_ID;
  const [Root, setRoot] = useState<ComponentType<PrivyRootProps> | null>(null);
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);

  useEffect(() => {
    if (!appId) return;
    let cancelled = false;
    let attempt = 0;
    let timer = 0;

    function mount() {
      void loadPrivyRoot()
        .then((Loaded) => {
          if (!cancelled) setRoot(() => Loaded);
        })
        .catch(() => {
          attempt += 1;
          if (cancelled) return;
          timer = window.setTimeout(mount, Math.min(2000, 300 * attempt));
        });
    }

    function onWake() {
      if (!cancelled) mount();
    }

    mount();
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [appId]);

  if (!Root) {
    return (
      <PrivyReadyContext.Provider value={false}>{children}</PrivyReadyContext.Provider>
    );
  }

  return (
    <Root>
      <MarkReady onReady={onReady} />
      <PrivyReadyContext.Provider value={ready}>{children}</PrivyReadyContext.Provider>
    </Root>
  );
}
