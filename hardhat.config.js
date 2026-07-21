require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "paris",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      forking: {
        url: process.env.RPC_URL || "https://coston2-api.flare.network/ext/C/rpc",
        enabled: false,
      },
    },
    coston2: {
      url: process.env.RPC_URL || "https://coston2-api.flare.network/ext/C/rpc",
      chainId: 114,
      accounts: process.env.PRIVATE_KEY
        ? [process.env.PRIVATE_KEY]
        : [],
      gasPrice: 100_000_000, // 100 gwei (Coston2 minimum)
      gas: "auto",
      timeout: 60000,
      httpHeaders: {
        "User-Agent": "FlareIntel/v0.1.0",
      },
    },
    songbird: {
      url: "https://songbird-api.flare.network/ext/C/rpc",
      chainId: 19,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: 30_000_000_000, // 30 gwei
    },
    flare: {
      url: process.env.MAINNET_RPC_URL || "https://flare-api.flare.network/ext/C/rpc",
      chainId: 14,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: 100_000_000_000, // 100 gwei
    },
  },
  etherscan: {
    apiKey: {
      coston2: "placeholder",
      songbird: "placeholder",
      flare: process.env.FLUERSCAN_API_KEY || "placeholder",
    },
    customChains: [
      {
        network: "coston2",
        chainId: 114,
        urls: {
          apiURL: "https://coston2-explorer.flare.network/api",
          browserURL: "https://coston2-explorer.flare.network",
        },
      },
      {
        network: "songbird",
        chainId: 19,
        urls: {
          apiURL: "https://songbird-explorer.flare.network/api",
          browserURL: "https://songbird-explorer.flare.network",
        },
      },
      {
        network: "flare",
        chainId: 14,
        urls: {
          apiURL: "https://flare-explorer.flare.network/api",
          browserURL: "https://flare-explorer.flare.network",
        },
      },
    ],
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  mocha: {
    timeout: 40000,
    grep: undefined,
  },
  // Flare-specific: some contracts use assembly that needs this
  namedAccounts: {
    deployer: {
      default: 0,
    },
  },
};