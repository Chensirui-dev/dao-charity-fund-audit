/**
 * 查看部署账户与 DAO 成员在 Sepolia 上的地址、余额与治理权重。
 * 使用方式：cd chain && npm run accounts
 */
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const SEPOLIA_CHAIN_ID = 11155111;
const DEFAULT_SEPOLIA_RPC = 'https://sepolia.gateway.tenderly.co';
const RPC_URL = process.env.SEPOLIA_RPC_URL || DEFAULT_SEPOLIA_RPC;
const ROOT_ENV = path.resolve(__dirname, '..', '..', '.env.local');

function readGovernorAddress() {
  if (!fs.existsSync(ROOT_ENV)) return '';
  const match = fs.readFileSync(ROOT_ENV, 'utf8').match(/^VITE_DAO_GOVERNOR_ADDRESS=(.+)$/m);
  return match ? match[1].trim() : '';
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL, SEPOLIA_CHAIN_ID);
  const privateKey = (process.env.DEPLOYER_PRIVATE_KEY || '').trim();
  const deployer = privateKey && privateKey !== '0x' ? new ethers.Wallet(privateKey).address : '';
  const governorAddress = readGovernorAddress();

  const targets = new Set();
  if (deployer) targets.add(deployer);
  (process.env.DAO_MEMBERS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => targets.add(item));

  if (targets.size === 0) {
    console.log('未配置任何地址（DEPLOYER_PRIVATE_KEY / DAO_MEMBERS 均为空）');
    return;
  }

  const network = await provider.getNetwork();
  console.log(`网络：chainId ${network.chainId}  RPC：${RPC_URL}`);

  let governor = null;
  if (governorAddress && ethers.isAddress(governorAddress)) {
    const artifacts = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'deployments', 'artifacts.json'), 'utf8'));
    governor = new ethers.Contract(governorAddress, artifacts.DaoGovernor.abi, provider);
  }

  for (const address of targets) {
    if (!ethers.isAddress(address)) {
      console.log(`${address}  非法地址`);
      continue;
    }
    const balance = await provider.getBalance(address);
    let power = '-';
    if (governor) {
      try {
        power = String(await governor.votingPower(address));
      } catch {
        power = '读取失败';
      }
    }
    const tag = address === deployer ? '（部署账户）' : '（DAO 成员）';
    console.log(`${address}  余额 ${ethers.formatEther(balance)} ETH  投票权 ${power} ${tag}`);
  }
}

main().catch((error) => {
  console.error('查询失败：', error.message || error);
  process.exitCode = 1;
});
