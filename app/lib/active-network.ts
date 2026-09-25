export type NetworkId = "arc" | "robinhood";

export const NETWORK_STORAGE_KEY = "zorp-network";
export const NETWORK_EVENT = "zorp-network-change";

export function getNetworkId(): NetworkId {
  return "robinhood";
}

export function setNetworkId(id: NetworkId) {
  if (id === "arc") return;
  try {
    window.localStorage.setItem(NETWORK_STORAGE_KEY, id);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(NETWORK_EVENT));
}
