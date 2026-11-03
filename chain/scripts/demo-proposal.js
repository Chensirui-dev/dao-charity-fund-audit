/**
 * 在 Sepolia 上跑通一条真实提案：发起 → 投票 → 结算 → 时间锁 → 执行 → 项目上架。
 *
 * 之所以单独写脚本，是因为浏览器里的 MetaMask 只能人工点，
 * 而这套流程需要「发起后等投票期结束再执行」，脚本跑起来更稳。
 *
 * 用法（在 chain 目录下）：
 *   node scripts/demo-proposal.js status              只看状态，不发交易
 *   node scripts/demo-proposal.js create              发起一条项目上架提案
 *   node scripts/demo-proposal.js vote <id> yes        用部署账户投一票
 *   node scripts/demo-proposal.js tally <id>           结算提案（ACTIVE → PASSED/REJECTED）
 *   node scripts/demo-proposal.js wait <id>            等到时间锁结束
 *   node scripts/demo-proposal.js exec <id>            执行已通过的提案
 *   node scripts/demo-proposal.js request <campaignId> <amountEth>   受助方提交用款申请（需 RECIPIENT_PRIVATE_KEY）
 *   node scripts/demo-proposal.js requests <campaignId>            列出该项目的用款申请单
 *   node scripts/demo-proposal.js release <requestId> [标题]        凭申请单发起拨款提案
 *   node scripts/demo-proposal.js fund <地址> [金额]    给演示账户补 Gas
 *   node scripts/demo-proposal.js auto                 创建后自动投票、等待、执行
 */
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { createProvider, withRetry, sleep } = require('./provider');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const SEPOLIA_CHAIN_ID = 11155111;
/** 新建立项的默认募资期（天）与分期期数 */
const FUNDRAISING_DAYS = 30;
const MILESTONE_COUNT = 3;
const ROOT_ENV = path.resolve(__dirname, '..', '..', '.env.local');
const ARTIFACTS = path.resolve(__dirname, '..', 'deployments', 'artifacts.json');

function readRootEnv(key) {
  if (!fs.existsSync(ROOT_ENV)) return '';
  const match = fs.readFileSync(ROOT_ENV, 'utf8').match(new RegExp(`^${key}=(.+)$`, 'm'));
  return match ? match[1].trim() : '';
}

const addresses = {
  governor: readRootEnv('VITE_DAO_GOVERNOR_ADDRESS'),
  vault: readRootEnv('VITE_DONATION_VAULT_ADDRESS'),
  registry: readRootEnv('VITE_AUDIT_REGISTRY_ADDRESS'),
};

const artifacts = JSON.parse(fs.readFileSync(ARTIFACTS, 'utf8'));
const provider = createProvider();

function getSigner() {
  const key = (process.env.DEPLOYER_PRIVATE_KEY || '').trim();
  if (!key || key === '0x') throw new Error('chain/.env 里没有 DEPLOYER_PRIVATE_KEY');
  return new ethers.Wallet(key, provider);
}

/**
 * 受助方账户的签名器。
 *
 * 用款申请在合约里被限定为「只有立项时登记的收款方本人能提交」（require msg.sender == recipient），
 * 所以这一步必须用受助方自己的私钥签名，部署账户代签会被合约直接拒绝。
 * 没配这个私钥时，这一步请在前端用受助方钱包完成。
 */
function getRecipientSigner() {
  const key = (process.env.RECIPIENT_PRIVATE_KEY || '').trim();
  if (!key || key === '0x') {
    throw new Error('chain/.env 里没有 RECIPIENT_PRIVATE_KEY，无法以受助方身份提交用款申请。请在前端用受助方钱包完成，或补上该私钥。');
  }
  return new ethers.Wallet(key, provider);
}

function governorContract(withSigner = false) {
  if (!ethers.isAddress(addresses.governor)) throw new Error('读不到 VITE_DAO_GOVERNOR_ADDRESS');
  return new ethers.Contract(addresses.governor, artifacts.DaoGovernor.abi, withSigner ? getSigner() : provider);
}

/** 项目元数据必须用前端 parseCampaignMetadata 认得的格式，否则治理页能看、项目列表看不到 */
function encodeCampaignMetadata(meta) {
  return `meta:${JSON.stringify(meta)}`;
}

/**
 * 发一笔交易并等回执。
 *
 * 拆成「构造 → 广播 → 等回执」三步分别重试，是因为公共网关会限流：
 * 构造阶段要 estimateGas，等回执阶段要轮询，任一步 429 都会让整笔失败。
 * 广播重试用的是同一份已签名交易（nonce 不变），不会重复上链。
 */
async function send(label, contract, method, args, overrides = {}) {
  const signer = getSigner();
  const populated = await withRetry(`${label}·构造交易`, () => contract[method].populateTransaction(...args, overrides));
  const tx = await withRetry(`${label}·广播`, () => signer.sendTransaction(populated));
  console.log(`${label} 已广播：${tx.hash}`);
  const receipt = await withRetry(`${label}·等待回执`, () => provider.waitForTransaction(tx.hash, 1, 150_000), 4, 5000);
  if (!receipt) throw new Error(`${label} 等待回执超时：${tx.hash}`);
  console.log(`${label} 已上链，区块 ${receipt.blockNumber}，Gas ${receipt.gasUsed}`);
  return receipt;
}

async function status() {
  const governor = governorContract();
  const [count, period, quorum, timelock, totalPower, seeded] = await Promise.all([
    governor.proposalCount(),
    governor.votingPeriod(),
    governor.quorumBps(),
    governor.timelockDuration(),
    governor.totalVotingPower(),
    governor.votingPowerSeeded(),
  ]);

  // 法定人数需要的票数：总票权 × quorumBps / 10000，向上取整
  const needVotes = (BigInt(totalPower) * BigInt(quorum) + 9999n) / 10000n;

  console.log(`合约：${addresses.governor}`);
  console.log(`提案总数：${count}`);
  console.log(`投票期：${period} 秒   执行时间锁：${timelock} 秒`);
  console.log(`法定人数：${Number(quorum) / 100}%（需 ${needVotes} / ${totalPower} 票参与）`);
  console.log(`票权初始化：${seeded ? '已锁死（之后改票权只能走提案）' : '未初始化'}`);

  if (Number(count) === 0) return;

  const latest = Number(count) - 1;
  const ids = [];
  for (let id = 0; id <= latest; id += 1) ids.push(id);

  for (const id of ids) {
    const p = await governor.getProposal(id);
    const [forVotes, againstVotes, startTime, endTime, statusCode, title, proposer] = [
      p.forVotes, p.againstVotes, p.startTime, p.endTime, p.status, p.title, p.proposer,
    ];
    const names = ['ACTIVE', 'PASSED', 'REJECTED', 'EXECUTED'];
    const now = Math.floor(Date.now() / 1000);
    const left = Number(endTime) - now;
    const lockLeft = Number(endTime) + Number(timelock) - now;
    const phase = left > 0
      ? `还剩 ${left} 秒投票`
      : lockLeft > 0
        ? `投票已结束，时间锁还剩 ${lockLeft} 秒`
        : '已可执行';
    console.log(
      `#${id}  ${names[Number(statusCode)] ?? statusCode}  赞成 ${forVotes} / 反对 ${againstVotes}` +
      `  ${phase}  发起人 ${proposer.slice(0, 8)}…  ${title}`,
    );
  }
}

async function create(recipientOverride, nameOverride) {
  const signer = getSigner();
  const governor = governorContract(true);
  const period = Number(await governor.votingPeriod());

  const name = nameOverride || '乡村儿童午餐补给站';
  const description = '为三所乡村小学配置标准化厨房设备与两周食材采购，采购与配送凭证上链，按里程碑分两次拨付。';
  const targetEth = '24';
  const recipient = recipientOverride || readRootEnv('VITE_DEMO_PROJECT_OWNER') || signer.address;
  if (!ethers.isAddress(recipient)) throw new Error(`受助方地址不合法：${recipient}`);
  const cover = '/covers/c1018.jpg';

  const metadataURI = encodeCampaignMetadata({
    v: 1,
    name,
    description,
    targetEth: Number(targetEth),
    recipient,
    cover,
    createdAt: Date.now(),
  });

  console.log(`发起人：${signer.address}`);
  console.log(`项目：${name}  目标 ${targetEth} ETH  受助方 ${recipient}`);
  console.log(`募资期：${FUNDRAISING_DAYS} 天   分期：${MILESTONE_COUNT} 期（单期上限 ${(Number(targetEth) / MILESTONE_COUNT).toFixed(4)} ETH）`);
  console.log(`投票期：${period} 秒`);

  const receipt = await send('发起提案', governor, 'proposeCampaign', [
    name,
    metadataURI,
    ethers.parseEther(targetEth),
    recipient,
    FUNDRAISING_DAYS,
    MILESTONE_COUNT,
  ]);

  const iface = new ethers.Interface(artifacts.DaoGovernor.abi);
  let proposalId = null;
  let campaignIdHex = null;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed.name === 'ProposalCreated') proposalId = Number(parsed.args.proposalId);
      if (parsed.name === 'CampaignProposed') campaignIdHex = parsed.args.campaignId;
    } catch {
      // 不是本合约的事件，跳过
    }
  }
  console.log(`提案编号 #${proposalId}   项目标识 ${campaignIdHex}`);
  console.log(`下一步：node scripts/demo-proposal.js vote ${proposalId} yes`);
  return { proposalId, campaignIdHex, period };
}

async function vote(proposalId, support) {
  const governor = governorContract(true);
  await send(`投票 #${proposalId}`, governor, 'castVote', [Number(proposalId), support === 'yes']);
  const p = await withRetry('读取票数', () => governor.getProposal(Number(proposalId)));
  console.log(`当前 赞成 ${p.forVotes} / 反对 ${p.againstVotes}`);
}

/** 单独结算提案：把 ACTIVE 推进到 PASSED / REJECTED，不动资金 */
async function tally(proposalId) {
  const governor = governorContract(true);
  await send(`结算 #${proposalId}`, governor, 'tallyProposal', [Number(proposalId)]);
  const p = await withRetry('读取状态', () => governor.getProposal(Number(proposalId)));
  const names = ['ACTIVE', 'PASSED', 'REJECTED', 'EXECUTED'];
  const passed = Number(p.status) === 1;
  console.log(
    `提案状态 ${names[Number(p.status)]}（赞成 ${p.forVotes} / 反对 ${p.againstVotes}）` +
    (passed ? '' : '\n未通过原因：可能是法定人数不足，或反对票不少于赞成票'),
  );
  return Number(p.status);
}

/** 等到时间锁结束（不主动发交易，只轮询链上视图） */
async function wait(proposalId) {
  const governor = governorContract();
  for (let i = 0; i < 60; i += 1) {
    const remain = Number(await governor.executionDelay(Number(proposalId)));
    if (remain === 0) {
      console.log(`#${proposalId} 时间锁已结束，可以执行`);
      return;
    }
    console.log(`时间锁还剩 ${remain} 秒…`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(remain + 2, 30) * 1000));
  }
  throw new Error('等待时间锁超时');
}

async function exec(proposalId) {
  const governor = governorContract(true);
  await send(`执行 #${proposalId}`, governor, 'executeProposal', [Number(proposalId)]);
  const p = await withRetry('读取状态', () => governor.getProposal(Number(proposalId)));
  const names = ['ACTIVE', 'PASSED', 'REJECTED', 'EXECUTED'];
  console.log(`提案状态 ${names[Number(p.status)]}`);
}

/** 发起资金拨付提案：只给项目标识和金额，收款方由合约从立项记录里读 */
/**
 * 受助方提交用款申请。
 * 材料原件不上链，只把它的摘要（32 字节）写进链上审计台账，之后比对用。
 */
async function request(campaignKeyHex, amountEth, evidenceText = 'purchase invoice + acceptance report') {
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(campaignKeyHex || ''))) {
    throw new Error('项目标识必须是 0x 开头的 32 字节十六进制');
  }
  const signer = getRecipientSigner();
  const vault = new ethers.Contract(addresses.vault, artifacts.DonationVault.abi, signer);

  // 材料摘要：这里用演示文本的 keccak256 代替文件 SHA-256，链上只认「一个 32 字节的值」
  const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes(String(evidenceText)));
  const amount = ethers.parseEther(String(amountEth));

  const cap = await vault.milestoneCap(campaignKeyHex);
  const account = await vault.campaignAccounts(campaignKeyHex);
  console.log(`受助方：${signer.address}`);
  console.log(`单期额度上限：${ethers.formatEther(cap)} ETH   已拨 ${account.milestonesReleased} / ${account.milestoneCount} 期`);
  console.log(`材料摘要：${evidenceHash}`);

  if (amount > cap) throw new Error(`申请金额 ${amountEth} ETH 超过单期上限 ${ethers.formatEther(cap)} ETH`);

  const populated = await withRetry('用款申请·构造交易', () =>
    vault.requestFunds.populateTransaction(campaignKeyHex, amount, evidenceHash),
  );
  const tx = await withRetry('用款申请·广播', () => signer.sendTransaction(populated));
  console.log(`用款申请 已广播：${tx.hash}`);
  const receipt = await withRetry('用款申请·等待回执', () => provider.waitForTransaction(tx.hash, 1, 150_000), 4, 5000);
  if (!receipt) throw new Error(`用款申请等待回执超时：${tx.hash}`);

  const iface = new ethers.Interface(artifacts.DonationVault.abi);
  let requestId = null;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed.name === 'FundRequested') requestId = Number(parsed.args.requestId);
    } catch {
      // 忽略非本合约事件
    }
  }
  console.log(`申请单号 #${requestId}   状态 PENDING`);
  console.log(`下一步：node scripts/demo-proposal.js release ${requestId}`);
  return { requestId, evidenceHash };
}

/** 列出某个项目的用款申请单 */
async function requests(campaignKeyHex) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(campaignKeyHex || ''))) {
    throw new Error('项目标识必须是 0x 开头的 32 字节十六进制');
  }
  const vault = new ethers.Contract(addresses.vault, artifacts.DonationVault.abi, provider);
  const count = Number(await vault.fundRequestCount());
  const statusText = ['待表决', '已拨付', '已撤回'];
  let found = 0;
  for (let i = 0; i < count; i += 1) {
    const item = await vault.fundRequests(i);
    if (item.campaignId.toLowerCase() !== campaignKeyHex.toLowerCase()) continue;
    found += 1;
    console.log(
      `#${i}  ${ethers.formatEther(item.amount)} ETH  ${statusText[Number(item.status)]}  申请人 ${item.requester}`,
    );
    console.log(`     材料摘要 ${item.evidenceHash}`);
  }
  if (found === 0) console.log('该项目还没有用款申请。先跑：request <campaignId> <amountEth>');
}

/**
 * 凭用款申请单发起拨款提案。
 *
 * 参数里没有金额、也没有收款地址：金额取自申请单，收款方取自立项记录。
 * 传进去的材料摘要会与链上锚定的值比对，不一致合约直接回滚。
 */
async function release(requestId, title) {
  if (requestId === undefined) throw new Error('用法：release <申请单号> [标题]');
  const governor = governorContract(true);
  const vault = new ethers.Contract(addresses.vault, artifacts.DonationVault.abi, provider);

  const req = await vault.fundRequests(Number(requestId));
  if (req.campaignId === ethers.ZeroHash) throw new Error(`申请单 #${requestId} 不存在`);
  if (Number(req.status) !== 0) throw new Error(`申请单 #${requestId} 不是待表决状态（当前 ${req.status}）`);

  const campaignKeyHex = req.campaignId;
  const amountEth = ethers.formatEther(req.amount);
  const evidenceHash = req.evidenceHash;

  const [chainBalance, chainRecipient, cap] = await Promise.all([
    vault.campaignBalance(campaignKeyHex),
    vault.campaignRecipient(campaignKeyHex),
    vault.milestoneCap(campaignKeyHex),
  ]);

  console.log(`申请单 #${requestId}   ${amountEth} ETH   单期上限 ${ethers.formatEther(cap)} ETH`);
  console.log(`该项目可拨付余额 ${ethers.formatEther(chainBalance)} ETH`);
  console.log(`链上登记的收款方：${chainRecipient}（不可由提案人修改）`);
  console.log(`材料摘要：${evidenceHash}`);

  if (req.amount > chainBalance) throw new Error(`申请金额 ${amountEth} ETH 超过可拨付余额`);

  const receipt = await send('发起拨款提案', governor, 'createFundReleaseProposal', [
    Number(requestId),
    evidenceHash,
    title || `拨付第 ${requestId} 号用款申请 ${amountEth} ETH`,
  ]);

  const iface = new ethers.Interface(artifacts.DaoGovernor.abi);
  let proposalId = null;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed.name === 'ProposalCreated') proposalId = Number(parsed.args.proposalId);
    } catch {
      // 忽略非本合约事件
    }
  }
  console.log(`提案编号 #${proposalId}`);
  return proposalId;
}

/** 用部署账户（演示中的捐赠人）向某个项目捐款，让拨款提案有可拨付余额 */
async function donate(campaignKeyHex, amountEth = '0.01', message = '演示捐款') {
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(campaignKeyHex || ''))) {
    throw new Error('项目标识必须是 0x 开头的 32 字节十六进制');
  }
  const vault = new ethers.Contract(addresses.vault, artifacts.DonationVault.abi, getSigner());
  console.log(`向项目 ${campaignKeyHex.slice(0, 12)}… 捐 ${amountEth} ETH`);
  await send('捐款', vault, 'donate', [campaignKeyHex, message], { value: ethers.parseEther(String(amountEth)) });
  const balance = await vault.campaignBalance(campaignKeyHex);
  console.log(`该项目可拨付余额：${ethers.formatEther(balance)} ETH`);
}

/** 给某个演示账户补 Gas。录屏前理事账户余额见底时用 */
async function fund(to, amountEth = '0.01') {
  if (!ethers.isAddress(to)) throw new Error(`地址不合法：${to}`);
  const signer = getSigner();
  const before = await withRetry('读取对方余额', () => provider.getBalance(to));
  console.log(`从 ${signer.address} 转 ${amountEth} ETH 给 ${to}`);
  const tx = await signer.sendTransaction({ to, value: ethers.parseEther(String(amountEth)) });
  console.log(`转账已广播：${tx.hash}`);
  const receipt = await tx.wait();
  const after = await withRetry('读取对方余额', () => provider.getBalance(to));
  console.log(`已上链，区块 ${receipt.blockNumber}`);
  console.log(`对方余额：${ethers.formatEther(before)} → ${ethers.formatEther(after)} ETH`);
}

async function auto() {
  const { proposalId, period } = await create();
  if (proposalId === null) throw new Error('没解析到 proposalId');

  await vote(proposalId, 'yes');

  const waitMs = (period + 20) * 1000;
  console.log(`等待投票期结束（约 ${Math.round(waitMs / 1000)} 秒）…`);
  await new Promise((resolve) => setTimeout(resolve, waitMs));

  await tally(proposalId);
  await wait(proposalId);
  await exec(proposalId);
  await status();
}

const [command = 'status', arg1, arg2, arg3] = process.argv.slice(2);

const run = {
  status,
  create: () => create(arg1, arg2),
  vote: () => vote(arg1, arg2 || 'yes'),
  tally: () => tally(arg1),
  wait: () => wait(arg1),
  exec: () => exec(arg1),
  request: () => request(arg1, arg2, arg3),
  requests: () => requests(arg1),
  release: () => release(arg1, arg2),
  donate: () => donate(arg1, arg2 || '0.01', arg3 || '演示捐款'),
  fund: () => fund(arg1, arg2 || '0.01'),
  auto,
}[command];

if (!run) {
  console.error(`未知命令：${command}（可用：status / create / vote / tally / wait / exec / request / requests / release / donate / fund / auto）`);
  process.exit(1);
}

run().catch((error) => {
  console.error('执行失败：', error.shortMessage || error.message || error);
  process.exitCode = 1;
});
