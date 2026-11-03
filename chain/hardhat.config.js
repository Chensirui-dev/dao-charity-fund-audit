require('@nomicfoundation/hardhat-ethers');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const SEPOLIA_CHAIN_ID = 11155111;
const DEFAULT_SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';

const accounts = process.env.DEPLOYER_PRIVATE_KEY
  ? [process.env.DEPLOYER_PRIVATE_KEY.trim()]
  : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'paris',
    },
  },
  networks: {
    // 说明：这里的 hardhat 网络仅用于本地编译检查，不作为系统的运行链。
    // 系统的真实运行链是 Sepolia（chainId 11155111）。
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || DEFAULT_SEPOLIA_RPC,
      chainId: SEPOLIA_CHAIN_ID,
      accounts,
    },
  },
};
