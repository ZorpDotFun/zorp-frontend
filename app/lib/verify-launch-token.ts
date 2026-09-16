const COMPILER = "0.8.26+commit.8a97fa7a";
const IDENTIFIER = "src/LaunchToken.sol:LaunchToken";
const CONTRACT_PATH = "src/LaunchToken.sol";
const CONTRACT_NAME = "LaunchToken";

export function requestTokenVerification(input: {
  address: string;
  hash?: string;
}) {
  void fetch("/api/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).catch(() => {
    /* launch still succeeded */
  });
}

export { COMPILER, IDENTIFIER, CONTRACT_PATH, CONTRACT_NAME };
