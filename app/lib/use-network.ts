import { useEffect, useState } from "react";
import {
  NETWORK_EVENT,
  getNetworkId,
  setNetworkId,
  type NetworkId,
} from "./active-network";
import { NETWORKS, getNetwork } from "./networks";

export function useNetwork() {
  const [id, setId] = useState<NetworkId>(getNetworkId);

  useEffect(() => {
    const sync = () => setId(getNetworkId());
    window.addEventListener(NETWORK_EVENT, sync);
    return () => window.removeEventListener(NETWORK_EVENT, sync);
  }, []);

  return {
    id,
    network: getNetwork(id),
    networks: NETWORKS,
    setNetwork: setNetworkId,
  };
}
