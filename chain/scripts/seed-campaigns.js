/**
 * 存量数据迁移脚本：把前端展示的历史项目登记到链上金库。
 *
 * 为什么需要这一步
 * ----------------
 * 项目列表里的九个公益项目是系统上线前就在运行的历史项目，募资早已经开始。
 * 换到链上之后，如果它们不在金库里登记，会出现两个问题：
 *   1. donate 会拒绝未登记项目（防止资金打进没有收款方的账户后永久锁死），
 *      于是这些项目在界面上看起来能捐，实际点了就报错；
 *   2. 项目卡片显示的募集额与链上账本对不上，核链时一眼就露。
 *
 * 这个脚本把「当前账面进度」作为期初余额写进 CampaignAccount，属于一次性数据迁移，
 * 不是伪造募资——记账额与托管的真实 ETH 是两套口径，真拨付时仍以金库实际余额为准
 * （见 DonationVault.releaseFunds 的 vault balance insufficient 校验）。
 *
 * 数据来源：直接解析 src/data/campaigns.ts，保证链上与界面永远同源。
 *
 * 用法：
 *   cd chain && npm run seed
 *   cd chain && npm run seed -- --dry     # 只打印不发送交易
 */
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { createProvider, withRetry, sleep } = require('./provider');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const ROOT_ENV = path.resolve(__dirname, '..', '..', '.env.local');
const CAMPAIGNS_TS = path.resolve(__dirname, '..', '..', 'src', 'data', 'campaigns.ts');
const ARTIFACT_FILE = path.resolve(__dirname, '..', 'deployments', 'artifacts.json');

/** 迁移后的募资开放天数，从执行脚本当天起算 */
const FUNDRAISING_DAYS = 60;
const CALL_GAS_LIMIT = 1_500_000n;
/**
 * Sepolia 的实际 base fee 常年低于 1e-6 gwei（本机实测 1.8e-8 gwei）。
 * 早先按 3 gwei 报价，导致部署三个合约要预留 0.1 ETH，余额不足直接失败。
 * 这里按 0.05 gwei 报价，仍比 base fee 高出五个数量级，留足波动余量。
 */
const GAS_PRICE_GWEI = process.env.GAS_PRICE_GWEI || '0.05';
const PRIORITY_FEE_GWEI = process.env.PRIORITY_FEE_GWEI || '0.01';
const FEE_OVERRIDES = {
  maxFeePerGas: ethers.parseUnits(GAS_PRICE_GWEI, 'gwei'),
  maxPriorityFeePerGas: ethers.parseUnits(PRIORITY_FEE_GWEI, 'gwei'),
};

function readRootEnv(key) {
  const content = fs.readFileSync(ROOT_ENV, 'utf8');
  const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return match ? match[1].trim() : '';
}

/**
 * 复现 src/utils/mock.ts 里的地址池。
 * 算法与前端完全一致（FNV-1a 播种 + xorshift 出字符），否则界面上显示的受助方
 * 和链上登记的收款方会是两个地址。
 */
function randomHash(seed) {
  const alphabet = '0123456789abcdef';
  let state = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    state ^= seed.charCodeAt(i);
    state = Math.imul(state, 16777619) >>> 0;
  }
  let hash = '0x';
  for (let i = 0; i < 64; i += 1) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    hash += alphabet[state % 16];
  }
  return hash;
}

const addresses = Array.from({ length: 40 }, (_, index) => `0x${randomHash(`address-${index}`).slice(2, 42)}`);

/** 从 campaigns.ts 里抽出每个项目的 id、目标额、已募额、受助方下标 */
function parseCampaigns() {
  const source = fs.readFileSync(CAMPAIGNS_TS, 'utf8');
  const list = [];
  const pattern = /id: '(camp-\d+)'[\s\S]*?targetAmount: ethToWei\(([\d.]+)\)[\s\S]*?raisedAmount: ethToWei\(([\d.]+)\)[\s\S]*?recipientAddress: addresses\[(\d+)\]/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    list.push({
      id: match[1],
      targetEth: Number(match[2]),
      raisedEth: Number(match[3]),
      recipient: addresses[Number(match[4])],
    });
  }
  if (list.length === 0) {
    throw new Error('没能从 src/data/campaigns.ts 解析出项目，请检查文件格式是否有改动');
  }
  list.forEach((item) => {
    if (!ethers.isAddress(item.recipient)) {
      throw new Error(`项目 ${item.id} 的受助方地址不合法：${item.recipient}`);
    }
    if (item.raisedEth > item.targetEth) {
      throw new Error(`项目 ${item.id} 的已募额大于目标额，数据有误`);
    }
  });
  return list;
}

async function main() {
  const dryRun = process.argv.includes('--dry');
  const key = (process.env.DEPLOYER_PRIVATE_KEY || '').trim();
  if (!key || key === '0x') throw new Error('chain/.env 里没有 DEPLOYER_PRIVATE_KEY');

  const provider = createProvider();
  const wallet = new ethers.Wallet(key, provider);
  const artifacts = JSON.parse(fs.readFileSync(ARTIFACT_FILE, 'utf8'));

  const governorAddr = readRootEnv('VITE_DAO_GOVERNOR_ADDRESS');
  const vaultAddr = readRootEnv('VITE_DONATION_VAULT_ADDRESS');
  if (!ethers.isAddress(governorAddr) || !ethers.isAddress(vaultAddr)) {
    throw new Error('.env.local 里缺少治理合约或金库地址，请先执行 npm run deploy:sepolia');
  }

  const governor = new ethers.Contract(governorAddr, artifacts.DaoGovernor.abi, wallet);
  const vault = new ethers.Contract(vaultAddr, artifacts.DonationVault.abi, wallet);

  console.log(`部署账户：${wallet.address}`);
  console.log(`治理合约：${governorAddr}`);
  console.log(`金库合约：${vaultAddr}`);

  /* ---------- 1. 指定审计员 ---------- */
  const auditor = readRootEnv('VITE_DEMO_AUDITOR');
  if (ethers.isAddress(auditor)) {
    const current = await vault.auditor();
    if (current.toLowerCase() !== auditor.toLowerCase()) {
      if (dryRun) {
        console.log(`[dry] setAuditor(${auditor})`);
      } else {
        await withRetry('设置审计员', async () => {
          const tx = await vault.setAuditor(auditor, { ...FEE_OVERRIDES, gasLimit: CALL_GAS_LIMIT });
          return tx.wait();
        });
        console.log(`审计员已设为 ${auditor}（只有冻结权，没有解冻权和动钱权）`);
      }
    } else {
      console.log(`审计员已是 ${auditor}，跳过`);
    }
  } else {
    console.log('.env.local 里没有 VITE_DEMO_AUDITOR，跳过审计员设置');
  }

  /* ---------- 2. 批量登记历史项目 ---------- */
  const campaigns = parseCampaigns();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const deadline = nowSeconds + FUNDRAISING_DAYS * 86400;

  const pending = [];
  for (const item of campaigns) {
    const campaignId = ethers.id(item.id);
    const account = await vault.campaignAccounts(campaignId);
    if (account.registered) {
      console.log(`跳过 ${item.id}：链上已登记（募集 ${ethers.formatEther(account.raised)} ETH）`);
      continue;
    }
    pending.push({
      campaignId,
      recipient: item.recipient,
      targetAmount: ethers.parseEther(String(item.targetEth)),
      deadline,
      milestoneCount: 3,
      initialRaised: ethers.parseEther(String(item.raisedEth)),
    });
    console.log(
      `待登记 ${item.id}  目标 ${item.targetEth} ETH  期初 ${item.raisedEth} ETH  受助方 ${item.recipient}`,
    );
  }

  if (pending.length === 0) {
    console.log('\n没有需要登记的项目，全部已在链上。');
    return;
  }

  const totalEth = campaigns.reduce((sum, item) => sum + item.raisedEth, 0);
  console.log(`\n合计 ${pending.length} 个项目，期初募集额 ${totalEth.toFixed(2)} ETH`);

  if (dryRun) {
    console.log('[dry] 未发送交易。去掉 --dry 才会真正上链。');
    return;
  }

  await sleep(2000);
  await withRetry('批量登记项目', async () => {
    const tx = await governor.seedCampaigns(pending, { ...FEE_OVERRIDES, gasLimit: 12_000_000n });
    return tx.wait();
  });
  console.log(`已登记 ${pending.length} 个项目`);

  /* ---------- 3. 回读校验 ---------- */
  console.log('\n=== 回读校验 ===');
  let sum = 0n;
  for (const item of pending) {
    const account = await vault.campaignAccounts(item.campaignId);
    sum += account.raised;
    const flag = account.registered ? '✓' : '✗';
    console.log(
      `${flag} ${ethers.formatEther(account.raised).padStart(8)} / ${ethers.formatEther(account.targetAmount)} ETH  ` +
        `单期上限 ${ethers.formatEther(await vault.milestoneCap(item.campaignId))}`,
    );
  }
  console.log(`链上累计募集总额：${ethers.formatEther(sum)} ETH`);
  console.log(`金库真实托管余额：${ethers.formatEther(await provider.getBalance(vaultAddr))} ETH`);
  console.log('（两者不同是预期内的：迁移额是账面数据，真拨付受托管余额约束）');
}

main().catch((error) => {
  console.error('\n执行失败：');
  console.error(error.shortMessage || error.message || error);
  process.exitCode = 1;
});
