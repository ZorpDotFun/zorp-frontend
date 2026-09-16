Arc public mainnet (5042). Official Uniswap Arc row + `eth_getCode` on a live RPC.

- https://developers.uniswap.org/deployments.json
- https://developers.uniswap.org/docs/protocols/v4/deployments

- USDC: `0x3600000000000000000000000000000000000000` (Arc predeploy, 6 decimals)
- V4 PoolManager: `0x8366a39CC670B4001A1121B8F6A443A643e40951`
- V4 PositionManager: `0x6049c9a0e26405C0985f9E3685C87d0aE917f82B`
- V4 StateView: `0xF3334192D15450CdD385c8B70e03f9A6bD9E673b`
- V4 Quoter: `0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94`
- V4 Universal Router: `0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1`
- Permit2: `0x000000000022D473030F116dDEE9F6B43aC78BA3`
- Multicall3: `0xcA11bde05977b3631167028862bE2a173976CA11`

## Zorp (Deploy.s.sol, 16 Sep 2026 — imageUri stack)

Broadcast: `contracts/broadcast/Deploy.s.sol/5042/run-latest.json`. Live `eth_call` confirms `wired() == true`, `usdQuote` is USDC, USDC is an approved pair, factory owner is the 2-of-3 council, hook/buyback owners are the timelock. New tokens expose `image()` and `imageUri()` (same string).

- Deployer: `0x91ac26b715185D91aE361fef5ACB24743210EfF7`
- Council (TwoOfThree): `0xF31187E8CF988d3d04e829D55675ec4935159a3E`
- Timelock: `0xc45075D2bA792e2A57Ccbcc31A9FaDdC130F039A`
- LaunchHook: `0x92DB322cF5d29F7a8CaAc361e42A591C3c622ACC`
- ZorpBuyback: `0xB5E0F4075609db420701DF423d63851Eb5766513`
- FeeDistributor: `0xffd0cDE2B363B132b5f3F833a0a0D2D33059bF9e`
- LaunchLocker: `0x64C2Fe2525a1bAAEa4833595041642E23ADeADf6`
- LaunchFactory: `0x04712d21D2883A00bEB387D38B99f7010501baAe`
- USDC / usdQuote: `0x3600000000000000000000000000000000000000`

Previous factory (TEST1 / TEST2, no `imageUri()`): `0xef36b4BD007A35A5058adB60230fF69A39003938`
