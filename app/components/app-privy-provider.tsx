import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

const PrivyReadyContext = createContext(false);

export function usePrivyReady() {
  return useContext(PrivyReadyContext);
}

function MarkReady({ onReady }: { onReady: () => void }) {
  useLayoutEffect(() => {
    onReady();
  }, [onReady]);
  return null;
}

type PrivyRootProps = { children: ReactNode };

export function AppPrivyProvider({ children }: { children: ReactNode }) {
  const appId = import.meta.env.VITE_PRIVY_APP_ID;
  const [Root, setRoot] = useState<ComponentType<PrivyRootProps> | null>(null);
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);

  useLayoutEffect(() => {
    if (!appId) return;
    let cancelled = false;
    void import("./privy-root")
      .then((mod) => {
        if (!cancelled) setRoot(() => mod.default);
      })
      .catch(() => {
        if (!cancelled) setRoot(() => ({ children: inner }: PrivyRootProps) => inner);
      });
    return () => {
      cancelled = true;
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
