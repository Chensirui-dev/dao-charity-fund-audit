/**
 * 把 Sepolia 测试币从发币账户分发给其他演示账户。
 *
 * 用途：水龙头（尤其 pk910 PoW）领币麻烦、有额度限制，通常只能往一个账户里领。
 * 而 Sepolia 的 Gas 极低，自己账户之间互转几乎不花钱 —— 所以「领一次 → 分发给其他角色」
 * 比挨个去水龙头领省事得多。
 *
 * 使用方式：
 *   cd chain
 *   npm run fund              # 默认给每个 DAO 成员地址转 0.01 ETH
 *   npm run fund -- 0.02      # 自定义：每个目标地址转 0.02 ETH
 */
const path = require('path');
const { ethers } = require('ethers');
const { createProvider, withRetry, SEPOLIA_CHAIN_ID } = require('./provider');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

/** 每个目标地址的转账金额，可用命令行参数或 FUND_AMOUNT 环境变量覆盖 */
const AMOUNT_ETH = process.argv[2] || process.env.FUND_AMOUNT || '0.01';

/** 轮询等待交易被打包 */
async function waitForReceipt(provider, hash) {
  for (let i = 0; i < 90; i += 1) {
    const receipt = await withRetry('查询回执', () => provider.getTransactionReceipt(hash), 3).catch(() => null);
    if (receipt) return receipt;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`交易 ${hash} 迟迟没有被打包，可以去 https://sepolia.etherscan.io/tx/${hash} 看看它的状态`);
}

async function main() {
  const privateKey = (process.env.DEPLOYER_PRIVATE_KEY || '').trim();
  if (!privateKey || privateKey === '0x') {
    throw new Error('未配置 DEPLOYER_PRIVATE_KEY。请先在 chain/.env 中填写发币账户（账户1）的私钥。');
  }

  const provider = createProvider();
  const wallet = new ethers.Wallet(privateKey, provider);
  const amount = ethers.parseEther(AMOUNT_ETH);

  const targets = (process.env.DAO_MEMBERS || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => ethers.isAddress(item))
    .map((item) => ethers.getAddress(item))
    .filter((item) => item !== wallet.address);

  if (targets.length === 0) {
    throw new Error('DAO_MEMBERS 里没有可转账的目标地址（要么还没填，要么只填了发币账户自己）。');
  }

  const balance = await withRetry('查询余额', () => provider.getBalance(wallet.address));
  const needed = amount * BigInt(targets.length);

  console.log('=== 分发测试币 ===');
  console.log(`发币账户 : ${wallet.address}`);
  console.log(`当前余额 : ${ethers.formatEther(balance)} ETH`);
  console.log(`转账目标 : ${targets.length} 个地址，每个 ${AMOUNT_ETH} ETH`);
  console.log(`合计需要 : ${ethers.formatEther(needed)} ETH（另需极少量 Gas）\n`);

  if (balance < needed) {
    throw new Error(
      `发币账户余额不足：需要约 ${ethers.formatEther(needed)} ETH，当前只有 ${ethers.formatEther(balance)} ETH。请先去水龙头领币。`,
    );
  }

  // 自己维护 nonce，这样「广播」这一步可以安全重试：
  // 原始交易已经签好、哈希固定，重复广播同一笔不会重复扣钱。
  let nonce = await withRetry('查询交易序号', () => provider.getTransactionCount(wallet.address, 'pending'));

  for (const target of targets) {
    const gasLimit = await withRetry('估算 Gas', () => provider.estimateGas({ from: wallet.address, to: target, value: amount }));
    const fee = await withRetry('查询 Gas 价格', () => provider.getFeeData());

    const raw = await wallet.signTransaction({
      to: target,
      value: amount,
      gasLimit: (gasLimit * 12n) / 10n,
      nonce,
      chainId: SEPOLIA_CHAIN_ID,
      type: 2,
      maxFeePerGas: fee.maxFeePerGas ?? 2000000000n,
      maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? 1000000000n,
    });
    const hash = ethers.keccak256(raw);

    console.log(`  -> ${target}`);
    console.log(`     交易 ${hash}`);
    await withRetry('广播交易', () => provider.broadcastTransaction(raw));

    const receipt = await waitForReceipt(provider, hash);
    if (receipt.status !== 1) {
      throw new Error(`交易 ${hash} 在链上执行失败（status = ${receipt.status}）`);
    }
    console.log(`     已确认（区块 ${receipt.blockNumber}）`);
    nonce += 1;
  }

  console.log('\n=== 分发完成，最新余额 ===');
  for (const address of [wallet.address, ...targets]) {
    const value = await withRetry('查询余额', () => provider.getBalance(address));
    const tag = address === wallet.address ? '（发币账户）' : '';
    console.log(`  ${address}  ${ethers.formatEther(value)} ETH ${tag}`);
  }
  console.log('\n现在四个账户都有币了，可以执行：npm run deploy:sepolia');
}

main().catch((error) => {
  console.error('\n分发失败：', error.shortMessage || error.message || error);
  process.exitCode = 1;
});
