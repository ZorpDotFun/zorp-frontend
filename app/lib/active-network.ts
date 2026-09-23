export type NetworkId = "arc" | "robinhood";

export const NETWORK_STORAGE_KEY = "zorp-network";
export const NETWORK_EVENT = "zorp-network-change";

export function getNetworkId(): NetworkId {
  if (typeof window === "undefined") return "arc";
  try {
    return window.localStorage.getItem(NETWORK_STORAGE_KEY) === "robinhood"
      ? "robinhood"
      : "arc";
  } catch {
    return "arc";
  }
}

export function setNetworkId(id: NetworkId) {
  try {
    window.localStorage.setItem(NETWORK_STORAGE_KEY, id);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(NETWORK_EVENT));
}
