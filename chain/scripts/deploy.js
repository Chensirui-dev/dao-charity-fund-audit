/**
 * 一键部署三个合约到 Sepolia，并自动把地址回填到前端 .env.local。
 *
 * 使用方式：
 *   1. 复制 chain/.env.example 为 chain/.env，填写 DEPLOYER_PRIVATE_KEY 等
 *   2. cd chain && npm run deploy:sepolia
 */
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { createProvider, withRetry, sleep } = require('./provider');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const ARTIFACT_FILE = path.resolve(__dirname, '..', 'deployments', 'artifacts.json');
const ROOT_ENV = path.resolve(__dirname, '..', '..', '.env.local');
const OUT_DIR = path.resolve(__dirname, '..', 'deployments');

const SEPOLIA_CHAIN_ID = 11155111;
const DEFAULT_SEPOLIA_RPC = 'https://sepolia.gateway.tenderly.co';
const RPC_URL = process.env.SEPOLIA_RPC_URL || DEFAULT_SEPOLIA_RPC;
const DEMO_VOTING_PERIOD = Number(process.env.DEMO_VOTING_PERIOD || 120);
/** 演示用执行时间锁（秒）。生产部署建议 3600（1 小时）以上。 */
const DEMO_TIMELOCK = Number(process.env.DEMO_TIMELOCK || 45);
/**
 * 法定人数（基点）。2500 = 参与票权需达到总票权的 25% 才算有效。
 * 配 4 个演示账户、每人 100 票时，只投一票刚好达标，投两票能稳妥通过。
 */
const DEMO_QUORUM_BPS = Number(process.env.DEMO_QUORUM_BPS || 2500);
/** 每个演示账户的初始票权 */
const DEMO_VOTING_POWER = Number(process.env.DEMO_VOTING_POWER || 100);

/**
 * 关于 gasLimit：不能硬编码，原因见下。
 *
 * Sepolia 已激活以太坊 2026 年的 Glamsterdam 重定价（EIP-8037/8038）：
 * 新增链上状态从「按操作收费」改为「按字节收费」，每新增 1 字节状态收 1,530 gas。
 * 部署合约就是在创建永久状态，所以成本暴涨——实测：
 *   • 空合约（runtime 约 50 字节）       需 309,066 gas
 *   • AuditRegistry（runtime 2068 字节） 需 3,433,384 gas
 * 一个 24KB 的合约，部署 gas 可从约 495 万涨到约 3,780 万。
 * 结果就是：写死一个「看起来很大」的 gasLimit 反而会 out of gas。
 *
 * 所以这里改成按实际估算值 +30% 余量。估算失败才退回下面的兜底值。
 * 好在 gas 价格极低（约 0.001 gwei），gas 数涨 7 倍，实际花费仍可忽略。
 */
const DEPLOY_GAS_FALLBACK = 12_000_000n;
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

function upsertEnv(content, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(content)) return content.replace(pattern, line);
  const trimmed = content.replace(/\s*$/, '');
  return `${trimmed}${trimmed ? '\n' : ''}${line}\n`;
}

async function deployContract(name, wallet, args = []) {
  const artifact = artifacts[name];
  if (!artifact) throw new Error(`缺少合约产物：${name}，请先执行 npm run compile`);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

  // 按实际估算给 gasLimit（Glamsterdam 之后按字节收 1530 gas，硬编码极易写小）
  const deployTx = await factory.getDeployTransaction(...args);
  let gasLimit = DEPLOY_GAS_FALLBACK;
  try {
    const estimate = await withRetry(
      `估算 ${name} 部署 Gas`,
      () => wallet.provider.estimateGas({
        from: wallet.address,
        data: deployTx.data,
        value: deployTx.value ?? 0n,
      }),
      5,
      4000,
    );
    gasLimit = (estimate * 13n) / 10n;
    console.log(`      预估 ${estimate.toLocaleString()} gas，上限设为 ${gasLimit.toLocaleString()}`);
  } catch (error) {
    console.log(`      估算失败（${error.shortMessage || error.message}），改用兜底上限 ${gasLimit.toLocaleString()}`);
  }

  const contract = await factory.deploy(...args, {
    ...FEE_OVERRIDES,
    gasLimit,
  });
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const txHash = contract.deploymentTransaction()?.hash;
  console.log(`      -> ${address}`);
  if (txHash) console.log(`         部署交易 ${txHash}`);
  return { contract, address };
}

const artifacts = fs.existsSync(ARTIFACT_FILE)
  ? JSON.parse(fs.readFileSync(ARTIFACT_FILE, 'utf8'))
  : {};

async function main() {
  const privateKey = (process.env.DEPLOYER_PRIVATE_KEY || '').trim();
  if (!privateKey || privateKey === '0x') {
    throw new Error('未配置 DEPLOYER_PRIVATE_KEY，请先在 chain/.env 中填写部署账户私钥');
  }

  // 多节点自动切换：公共网关部署时容易限流，一个被限就换另一个
  const provider = createProvider();
  const wallet = new ethers.Wallet(privateKey, provider);

  const network = await provider.getNetwork();
  const balance = await provider.getBalance(wallet.address);
  const nonce = await provider.getTransactionCount(wallet.address, 'latest');

  console.log('=== 部署信息 ===');
  console.log(`RPC        : ${RPC_URL}`);
  console.log('             （已挂备用节点，遇到限流会自动切换）');
  console.log(`网络       : chainId ${network.chainId}`);
  console.log(`部署账户   : ${wallet.address}`);
  console.log(`账户余额   : ${ethers.formatEther(balance)} ETH`);
  console.log(`已发出交易 : ${nonce} 笔`);

  if (balance === 0n) {
    throw new Error('部署账户余额为 0，请先到 Sepolia 水龙头领取测试币后再部署');
  }

  console.log('\n[1/4] 部署 AuditRegistry（可信审计层）...');
  const registry = await deployContract('AuditRegistry', wallet);

  await sleep(2500);
  console.log('[2/4] 部署 DonationVault（公益金库）...');
  const vault = await deployContract('DonationVault', wallet, [registry.address]);

  await sleep(2500);
  console.log('[3/4] 部署 DaoGovernor（治理层）...');
  const governor = await deployContract('DaoGovernor', wallet, [vault.address, registry.address]);

  await sleep(2500);
  console.log('[4/4] 建立合约间授权与演示参数...');
  const setGovernorTx = await vault.contract.setGovernor(governor.address, {
    ...FEE_OVERRIDES,
    gasLimit: CALL_GAS_LIMIT,
  });
  await setGovernorTx.wait();
  console.log(`      DonationVault.governor = ${governor.address}`);

  await sleep(2000);
  const votingPeriodTx = await governor.contract.setVotingPeriod(DEMO_VOTING_PERIOD, {
    ...FEE_OVERRIDES,
    gasLimit: CALL_GAS_LIMIT,
  });
  await votingPeriodTx.wait();
  console.log(`      DaoGovernor.votingPeriod = ${DEMO_VOTING_PERIOD} 秒`);

  await sleep(2000);
  await (await governor.contract.setQuorumBps(DEMO_QUORUM_BPS, {
    ...FEE_OVERRIDES,
    gasLimit: CALL_GAS_LIMIT,
  })).wait();
  console.log(`      DaoGovernor.quorumBps = ${DEMO_QUORUM_BPS}（${DEMO_QUORUM_BPS / 100}% 票权参与才算有效）`);

  await sleep(2000);
  await (await governor.contract.setTimelockDuration(DEMO_TIMELOCK, {
    ...FEE_OVERRIDES,
    gasLimit: CALL_GAS_LIMIT,
  })).wait();
  console.log(`      DaoGovernor.timelockDuration = ${DEMO_TIMELOCK} 秒`);

  const members = (process.env.DAO_MEMBERS || wallet.address)
    .split(',')
    .map((item) => item.trim())
    .filter((item) => ethers.isAddress(item));

  if (members.length === 0) {
    throw new Error('DAO_MEMBERS 里没有合法地址，无法初始化票权');
  }

  // 票权只能一次性初始化（bootstrap），之后任何调整都必须走治理提案
  await sleep(2000);
  await (await governor.contract.bootstrapVotingPower(members, DEMO_VOTING_POWER, {
    ...FEE_OVERRIDES,
    gasLimit: CALL_GAS_LIMIT,
  })).wait();
  members.forEach((member) => {
    console.log(`      DaoGovernor.bootstrapVotingPower(${member}, ${DEMO_VOTING_POWER})`);
  });
  console.log('      票权已锁死：之后再改票权必须发起治理提案');

  console.log('\n=== 回填前端配置 .env.local ===');
  let env = fs.existsSync(ROOT_ENV) ? fs.readFileSync(ROOT_ENV, 'utf8') : '';
  env = upsertEnv(env, 'VITE_CHAIN_MODE', 'sepolia');
  env = upsertEnv(env, 'VITE_CHAIN_ID', String(SEPOLIA_CHAIN_ID));
  env = upsertEnv(env, 'VITE_CHAIN_NAME', 'Sepolia');
  env = upsertEnv(env, 'VITE_RPC_URL', RPC_URL);
  env = upsertEnv(env, 'VITE_EXPLORER_URL', 'https://sepolia.etherscan.io');
  env = upsertEnv(env, 'VITE_DONATION_VAULT_ADDRESS', vault.address);
  env = upsertEnv(env, 'VITE_DAO_GOVERNOR_ADDRESS', governor.address);
  env = upsertEnv(env, 'VITE_AUDIT_REGISTRY_ADDRESS', registry.address);
  fs.writeFileSync(ROOT_ENV, env, 'utf8');
  console.log(`      已写入 ${ROOT_ENV}`);

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const recordPath = path.join(OUT_DIR, `sepolia-${Date.now()}.json`);
  fs.writeFileSync(recordPath, JSON.stringify({
    network: 'sepolia',
    chainId: SEPOLIA_CHAIN_ID,
    rpcUrl: RPC_URL,
    deployer: wallet.address,
    demoVotingPeriodSeconds: DEMO_VOTING_PERIOD,
    demoTimelockSeconds: DEMO_TIMELOCK,
    quorumBps: DEMO_QUORUM_BPS,
    votingPowerPerMember: DEMO_VOTING_POWER,
    daoMembers: members,
    contracts: {
      auditRegistry: registry.address,
      donationVault: vault.address,
      daoGovernor: governor.address,
    },
    deployedAt: new Date().toISOString(),
  }, null, 2), 'utf8');
  console.log(`      部署记录已保存到 ${recordPath}`);

  console.log('\n=== 部署完成 ===');
  console.log(`金库地址：https://sepolia.etherscan.io/address/${vault.address}`);
  console.log('重启前端（npm run dev）后即可发出真实 Sepolia 交易。');
}

main().catch((error) => {
  console.error('\n部署失败：', error.message || error);
  process.exitCode = 1;
});
