/**
 * 智能合约单元测试
 *
 * 在内存 EVM（ganache）中部署三个合约，逐条验证核心业务规则是否被正确约束。
 * 运行：npm test
 *
 * 特点：不依赖外部网络、不需要测试币、不需要 Hardhat。
 * 编译用 solc-js，执行用 ganache 内存链，因此可以在任何机器上离线跑通。
 *
 * 两个实现细节（踩过的坑，写在前面免得后来人重复踩）：
 * 1. 断言回滚一律走 staticCall（即 eth_call）。直接发交易时 ganache 会在
 *    eth_estimateGas 阶段就失败，只返回笼统的 "transaction execution reverted"；
 *    eth_call 则会把 require 里的原因字符串完整带回。staticCall 不改变状态。
 * 2. 读余额用原始 eth_getBalance，而不是 ethers 的 getBalance。因为 ethers 会缓存
 *    区块号，在内存链里逐笔即时出块的情况下可能读到上一块的状态。
 */
const fs = require('fs');
const path = require('path');
const solc = require('solc');
const ganache = require('ganache');
const { ethers } = require('ethers');

const CONTRACTS_DIR = path.resolve(__dirname, '..', 'contracts');
const CHAIN_ID = 11155111;

/* ------------------------------------------------------------------ */
/* 迷你测试框架：输出中文，逐条显示通过 / 失败                          */
/* ------------------------------------------------------------------ */
let passed = 0;
const failures = [];

function group(title) {
  console.log(`\n${title}`);
}

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  [通过] ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  [失败] ${name}`);
    console.log(`         ${String(error.message || error).split('\n')[0]}`);
  }
}

function ok(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
  const a = typeof actual === 'bigint' ? actual.toString() : String(actual);
  const b = typeof expected === 'bigint' ? expected.toString() : String(expected);
  if (a !== b) throw new Error(`${message}（实际 ${a}，期望 ${b}）`);
}

/** 断言调用会回滚，且回滚原因包含 keyword。参数 makeCall 是一个返回 Promise 的函数 */
async function reverts(makeCall, keyword, message) {
  let succeeded = false;
  try {
    const result = await makeCall();
    if (result && typeof result.wait === 'function') await result.wait();
    succeeded = true;
  } catch (error) {
    const text = [
      error.shortMessage,
      error.reason,
      error.message,
      error.info && error.info.error && error.info.error.message,
    ]
      .filter(Boolean)
      .join(' ');
    if (!keyword || text.includes(keyword)) return;
    throw new Error(`${message}：回滚原因不含「${keyword}」，实际为「${text.slice(0, 200)}」`);
  }
  if (succeeded) throw new Error(`${message}：预期回滚，但调用成功了`);
}

/* ------------------------------------------------------------------ */
/* 编译：与 scripts/compile.js 使用完全相同的编译参数                    */
/* ------------------------------------------------------------------ */
function compileContracts() {
  const sources = {};
  for (const entry of fs.readdirSync(CONTRACTS_DIR)) {
    if (entry.endsWith('.sol')) {
      sources[entry] = { content: fs.readFileSync(path.join(CONTRACTS_DIR, entry), 'utf8') };
    }
  }

  const output = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: 'Solidity',
        sources,
        settings: {
          optimizer: { enabled: true, runs: 200 },
          evmVersion: 'paris',
          outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
        },
      }),
      { import: (importPath) => ({ error: `未找到依赖：${importPath}` }) },
    ),
  );

  const errors = (output.errors || []).filter((item) => item.severity === 'error');
  if (errors.length > 0) {
    errors.forEach((item) => console.error(item.formattedMessage));
    throw new Error('合约编译失败，无法运行测试');
  }

  const artifacts = {};
  for (const contracts of Object.values(output.contracts || {})) {
    for (const [name, data] of Object.entries(contracts)) {
      artifacts[name] = { abi: data.abi, bytecode: `0x${data.evm.bytecode.object}` };
    }
  }
  return artifacts;
}

/* ------------------------------------------------------------------ */
/* 本地 Merkle 工具（与前端 src/utils/merkle.ts 算法一致，用于校验链上实现） */
/* ------------------------------------------------------------------ */
function hashPair(a, b) {
  const [left, right] = a.toLowerCase() <= b.toLowerCase() ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([left, right]));
}

function buildRoot(leaves) {
  let layer = leaves.slice();
  if (layer.length === 0) return ethers.ZeroHash;
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      next.push(i + 1 < layer.length ? hashPair(layer[i], layer[i + 1]) : layer[i]);
    }
    layer = next;
  }
  return layer[0];
}

/** 从回执里找出指定事件 */
function findEvent(receipt, abi, name) {
  const iface = new ethers.Interface(abi);
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === name) return parsed;
    } catch {
      /* 非本合约事件，忽略 */
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */
(async function main() {
  console.log('正在编译合约……');
  const artifacts = compileContracts();
  console.log(`编译完成：${Object.keys(artifacts).join('、')}`);
  console.log('正在启动内存 EVM（ganache）……');

  const provider = new ethers.BrowserProvider(
    ganache.provider({
      chain: { chainId: CHAIN_ID },
      wallet: { totalAccounts: 8 },
      logging: { quiet: true },
      miner: { blockGasLimit: 30_000_000 },
    }),
  );

  /** 直接用原始 RPC 读余额，绕开 ethers 的区块号缓存 */
  const balanceOf = async (address) => BigInt(await provider.send('eth_getBalance', [address, 'latest']));
  const mine = async (seconds) => {
    await provider.send('evm_increaseTime', [seconds]);
    await provider.send('evm_mine', []);
  };

  const signers = [];
  for (let i = 0; i < 8; i += 1) signers.push(await provider.getSigner(i));
  const [deployer, donorA, donorB, member1, member2, outsider, recipient, auditor] = signers;

  const addr = {};
  for (const [key, signer] of Object.entries({ deployer, donorA, donorB, member1, member2, outsider, recipient, auditor })) {
    addr[key] = await signer.getAddress();
  }

  const deploy = async (name, args = []) => {
    const factory = new ethers.ContractFactory(artifacts[name].abi, artifacts[name].bytecode, deployer);
    const contract = await factory.deploy(...args);
    await contract.waitForDeployment();
    return contract;
  };

  const registry = await deploy('AuditRegistry');
  const vault = await deploy('DonationVault', [await registry.getAddress()]);
  const governor = await deploy('DaoGovernor', [await vault.getAddress(), await registry.getAddress()]);

  const registryAddr = await registry.getAddress();
  const vaultAddr = await vault.getAddress();
  const governorAddr = await governor.getAddress();

  const VOTING_PERIOD = 60;
  const TIMELOCK = 300;

  await (await vault.connect(deployer).setGovernor(governorAddr)).wait();
  await (await vault.connect(deployer).setAuditor(addr.auditor)).wait();
  await (await governor.connect(deployer).setVotingPeriod(VOTING_PERIOD)).wait();
  await (await governor.connect(deployer).setQuorumBps(2500)).wait();
  await (await governor.connect(deployer).setTimelockDuration(TIMELOCK)).wait();

  console.log('\n三个合约已在内存链上部署：');
  console.log(`  AuditRegistry ${registryAddr}`);
  console.log(`  DonationVault ${vaultAddr}`);
  console.log(`  DaoGovernor   ${governorAddr}`);

  /* ============================ 审计层 ============================ */
  group('一、AuditRegistry 审计层');

  await test('初始状态没有任何审计记录', async () => {
    equal(await registry.recordCount(), 0n, '初始记录数应为 0');
  });

  await test('appendAuditLog 新增记录并触发 AuditLogAppended 事件', async () => {
    const txHash = ethers.id('tx-001');
    const receipt = await (await registry.appendAuditLog(txHash, 0, ethers.ZeroHash, '首笔捐款')).wait();
    equal(await registry.recordCount(), 1n, '记录数应变为 1');

    const parsed = findEvent(receipt, artifacts.AuditRegistry.abi, 'AuditLogAppended');
    ok(parsed, '应触发 AuditLogAppended 事件');
    equal(parsed.args.txHash, txHash, '事件里的交易哈希应与传入一致');
  });

  await test('verifyProof 对正确证明返回 true', async () => {
    const leaves = ['a', 'b', 'c', 'd'].map((item) => ethers.id(`leaf-${item}`));
    const root = buildRoot(leaves);
    const proof = [leaves[1], hashPair(leaves[2], leaves[3])];
    equal(await registry.verifyProof(leaves[0], proof, root), true, '合法证明应验真通过');
  });

  await test('verifyProof 对篡改的叶子返回 false', async () => {
    const leaves = ['a', 'b', 'c', 'd'].map((item) => ethers.id(`leaf-${item}`));
    const root = buildRoot(leaves);
    const proof = [leaves[1], hashPair(leaves[2], leaves[3])];
    equal(await registry.verifyProof(ethers.id('tampered-leaf'), proof, root), false, '篡改后的叶子应验真失败');
  });

  await test('anchorBatch 拒绝空 Merkle 根', async () => {
    await reverts(
      () => registry.connect(outsider).anchorBatch.staticCall(ethers.ZeroHash, 0, 0),
      'empty root',
      '空根应被拒绝',
    );
  });

  await test('anchorBatch 拒绝起点大于终点的区间', async () => {
    await reverts(
      () => registry.connect(outsider).anchorBatch.staticCall(ethers.id('root'), 5, 3),
      'bad range',
      '起点大于终点应被拒绝',
    );
  });

  await test('anchorBatch 拒绝超过上限的批次区间', async () => {
    await reverts(
      () => registry.connect(outsider).anchorBatch.staticCall(ethers.id('root'), 0, 99999),
      'batch too large',
      '超过单批上限的区间应被拒绝',
    );
  });

  await test('anchorBatch 能把批次根锚定到链上并读回', async () => {
    const root = ethers.id('batch-root-2026');
    const receipt = await (await registry.connect(outsider).anchorBatch(root, 0, 0)).wait();

    equal(await registry.anchorCount(), 1n, '应记录 1 条批次锚定');

    const parsed = findEvent(receipt, artifacts.AuditRegistry.abi, 'BatchAnchored');
    ok(parsed, '应触发 BatchAnchored 事件');

    const anchor = await registry.getAnchor(0);
    equal(anchor.merkleRoot, root, '链上锚定的根应与提交的一致');
    equal(anchor.anchorer, addr.outsider, '锚定者应为调用者');
  });

  /* ====================== 治理层：票权初始化 ====================== */
  group('二、DaoGovernor 票权初始化');

  await test('非 owner 无法初始化票权', async () => {
    await reverts(
      () => governor.connect(outsider).bootstrapVotingPower.staticCall([addr.outsider], 100),
      'not owner',
      '非 owner 初始化票权应被拒绝',
    );
  });

  await test('bootstrap 一次性给五名成员各 100 票权', async () => {
    // recipient 也给了票权：这是为了验证「就算受助方本人持有票权，也不能给自己的项目投票」。
    // 利益冲突回避不能依赖「他本来就没票」这种默认假设。
    await (
      await governor
        .connect(deployer)
        .bootstrapVotingPower([addr.member1, addr.member2, addr.donorA, addr.donorB, addr.recipient], 100)
    ).wait();
    equal(await governor.votingPower(addr.member1), 100n, 'member1 票权应为 100');
    equal(await governor.votingPower(addr.member2), 100n, 'member2 票权应为 100');
    equal(await governor.votingPower(addr.recipient), 100n, 'recipient 票权应为 100');
    equal(await governor.totalVotingPower(), 500n, '总票权应为 500');
    equal(await governor.votingPowerSeeded(), true, '票权应标记为已初始化');
  });

  await test('票权初始化后无法再次 bootstrap（部署私钥不能再发票权）', async () => {
    await reverts(
      () => governor.connect(deployer).bootstrapVotingPower.staticCall([addr.outsider], 100),
      'already seeded',
      '重复初始化票权应被拒绝',
    );
  });

  /* ====================== 治理层：立项与投票 ====================== */
  group('三、DaoGovernor 立项投票与执行');

  let campaignId;
  let campaignProposalId;

  await test('项目方提交上架申请会生成提案并登记收款方与分期参数', async () => {
    const receipt = await (
      await governor
        .connect(member1)
        .proposeCampaign(
          '山村净水井计划',
          'dao-charity://campaign/water-well',
          ethers.parseEther('9'),
          addr.recipient,
          90,
          3,
        )
    ).wait();

    const proposed = findEvent(receipt, artifacts.DaoGovernor.abi, 'CampaignProposed');
    ok(proposed, '应触发 CampaignProposed 事件');
    campaignId = proposed.args.campaignId;
    campaignProposalId = proposed.args.proposalId;

    equal(await governor.proposalCount(), 1n, '提案数应为 1');
    equal(await vault.campaignRecipient(campaignId), addr.recipient, '金库应记下受助方地址');

    const account = await vault.campaignAccounts(campaignId);
    equal(account.milestoneCount, 3n, '应登记 3 期里程碑');
    equal(account.milestonesReleased, 0n, '初始已拨期数应为 0');
    equal(await vault.milestoneCap(campaignId), ethers.parseEther('3'), '单期额度上限应为 3 ETH');
  });

  await test('同一笔捐款不能重复入账', async () => {
    await reverts(
      () => vault.connect(outsider).donate.staticCall(campaignId, '测试', { value: 0 }),
      'zero amount',
      '零金额捐款应被拒绝',
    );
  });

  await test('没有投票权的账户无法投票', async () => {
    await reverts(
      () => governor.connect(outsider).castVote.staticCall(campaignProposalId, true),
      'no voting power',
      '无投票权账户投票应被拒绝',
    );
  });

  await test('投票会按治理权重正确计票', async () => {
    await (await governor.connect(member1).castVote(campaignProposalId, true)).wait();
    const proposal = await governor.getProposal(campaignProposalId);
    equal(proposal.forVotes, 100n, '赞成票应为 100');
    equal(proposal.againstVotes, 0n, '反对票应为 0');
  });

  await test('同一个账户不能重复投票', async () => {
    await reverts(
      () => governor.connect(member1).castVote.staticCall(campaignProposalId, true),
      'already voted',
      '重复投票应被拒绝',
    );
  });

  await test('第二名成员投赞成票，累计票权达到法定人数', async () => {
    // 总票权 500，法定人数 25% = 125 票。单票 100 不够，需要两票。
    await (await governor.connect(member2).castVote(campaignProposalId, true)).wait();
    const proposal = await governor.getProposal(campaignProposalId);
    equal(proposal.forVotes, 200n, '两票赞成合计应为 200');
  });

  await test('投票期未结束时既不能结算也不能执行', async () => {
    await reverts(
      () => governor.connect(member1).executeProposal.staticCall(campaignProposalId),
      'voting ongoing',
      '投票未结束就执行应被拒绝',
    );
    await reverts(
      () => governor.connect(member1).tallyProposal.staticCall(campaignProposalId),
      'voting ongoing',
      '投票未结束就结算应被拒绝',
    );
  });

  await test('投票期结束后结算为 PASSED（达到法定人数且赞成占多数）', async () => {
    await mine(VOTING_PERIOD + 5);
    await (await governor.connect(outsider).tallyProposal(campaignProposalId)).wait();
    const proposal = await governor.getProposal(campaignProposalId);
    equal(proposal.status, 1n, '提案状态应为 PASSED(1)');
  });

  await test('时间锁未过时不能执行提案', async () => {
    await reverts(
      () => governor.connect(outsider).executeProposal.staticCall(campaignProposalId),
      'timelock not elapsed',
      '时间锁未过就执行应被拒绝',
    );
  });

  await test('时间锁倒计时可查询且随区块推进归零', async () => {
    const before = await governor.executionDelay(campaignProposalId);
    ok(before > 0n, `时间锁应还剩时间，实际 ${before}`);
    await mine(TIMELOCK);
    equal(await governor.executionDelay(campaignProposalId), 0n, '时间锁走完后倒计时应归零');
  });

  await test('时间锁结束后执行成功，状态变为 EXECUTED', async () => {
    await (await governor.connect(outsider).executeProposal(campaignProposalId)).wait();
    const proposal = await governor.getProposal(campaignProposalId);
    equal(proposal.status, 3n, '提案状态应为 EXECUTED(3)');
  });

  /* ============================ 金库层 ============================ */
  group('四、DonationVault 捐款与余额');

  await test('捐款正确累加到项目账户与总募资额', async () => {
    await (await vault.connect(donorA).donate(campaignId, '第一笔', { value: ethers.parseEther('1') })).wait();
    await (await vault.connect(donorB).donate(campaignId, '第二笔', { value: ethers.parseEther('0.5') })).wait();
    equal(await vault.campaignBalance(campaignId), ethers.parseEther('1.5'), '该项目余额应为 1.5 ETH');
    equal(await vault.totalRaised(), ethers.parseEther('1.5'), '总募资额应为 1.5 ETH');
  });

  await test('捐款触发 DonationReceived 事件且金额正确', async () => {
    const receipt = await (await vault.connect(donorA).donate(campaignId, '带事件', { value: ethers.parseEther('0.1') })).wait();
    const parsed = findEvent(receipt, artifacts.DonationVault.abi, 'DonationReceived');

    ok(parsed, '应触发 DonationReceived 事件');
    equal(parsed.args.amount, ethers.parseEther('0.1'), '事件金额应为 0.1 ETH');
    equal(String(parsed.args.donor).toLowerCase(), addr.donorA.toLowerCase(), '事件里的捐赠者应为 donorA');
  });

  await test('捐款会自动写入审计层形成留痕', async () => {
    const before = await registry.recordCount();
    await (await vault.connect(donorB).donate(campaignId, '审计留痕', { value: ethers.parseEther('0.2') })).wait();
    equal(await registry.recordCount(), before + 1n, '捐款后审计记录应增加 1 条');
  });

  await test('非治理合约无权调用 releaseFunds 拨付资金', async () => {
    await reverts(
      () => vault.connect(outsider).releaseFunds.staticCall(campaignId, 0),
      'only governor',
      '非治理合约拨付资金应被拒绝',
    );
  });

  /* ====================== 用款申请：材料与额度 ====================== */
  group('五、用款申请：材料哈希与单期额度');

  const evidenceHash = ethers.id('invoice-2026-10-water-well-p1');
  let fundRequestId;

  await test('非受助方无法提交用款申请（申请人必须是立项登记的收款方）', async () => {
    await reverts(
      () => vault.connect(member1).requestFunds.staticCall(campaignId, ethers.parseEther('1'), evidenceHash),
      'only recipient',
      '非受助方提交用款申请应被拒绝',
    );
  });

  await test('缺少材料哈希的用款申请被拒绝', async () => {
    await reverts(
      () => vault.connect(recipient).requestFunds.staticCall(campaignId, ethers.parseEther('1'), ethers.ZeroHash),
      'missing evidence',
      '无材料哈希的申请应被拒绝',
    );
  });

  await test('申请金额超过单期额度上限被拒绝（防止一次性提空）', async () => {
    await reverts(
      () => vault.connect(recipient).requestFunds.staticCall(campaignId, ethers.parseEther('4'), evidenceHash),
      'exceeds milestone cap',
      '超过单期额度的申请应被拒绝',
    );
  });

  await test('受助方提交用款申请成功，材料哈希同步锚定到审计层', async () => {
    const before = await registry.recordCount();
    const receipt = await (
      await vault.connect(recipient).requestFunds(campaignId, ethers.parseEther('1'), evidenceHash)
    ).wait();

    fundRequestId = (await vault.fundRequestCount()) - 1n;

    const requested = findEvent(receipt, artifacts.DonationVault.abi, 'FundRequested');
    ok(requested, '应触发 FundRequested 事件');
    equal(requested.args.amount, ethers.parseEther('1'), '申请金额应为 1 ETH');
    equal(requested.args.evidenceHash, evidenceHash, '事件中的材料哈希应与提交的一致');

    const request = await vault.fundRequests(fundRequestId);
    equal(request.status, 0n, '申请状态应为 PENDING(0)');
    equal(request.requester, addr.recipient, '申请人应为受助方本人');

    equal(await registry.recordCount(), before + 1n, '材料哈希应写入审计层留痕');
    equal(await vault.campaignBalance(campaignId), ethers.parseEther('1.8'), '申请本身不转移任何资金');
  });

  /* ====================== 拨付闭环 ====================== */
  group('六、拨付闭环：申请单 → 提案 → 表决 → 到账');

  let fundProposalId;

  await test('拨款提案不接受收款地址与金额参数（只能凭申请单）', async () => {
    const fragment = artifacts.DaoGovernor.abi.find((item) => item.name === 'createFundReleaseProposal');
    ok(fragment, '合约里应有 createFundReleaseProposal');
    equal(fragment.inputs.length, 3, '入参应为 requestId、evidenceHash、title 三个');
    ok(!fragment.inputs.some((input) => input.type === 'address'), '不应存在 address 类型入参');
    ok(!fragment.inputs.some((input) => input.name === 'amount'), '不应存在 amount 入参');
  });

  await test('通用提案入口不能创建拨款提案（防止绕过申请单）', async () => {
    await reverts(
      () => governor.connect(member1).createProposal.staticCall(0, campaignId, '绕过申请单直接拨款', 'x'),
      'use createFundReleaseProposal',
      '通用入口创建拨款提案应被拒绝',
    );
  });

  await test('材料哈希与链上锚定不一致时提案被拒绝（材料被篡改）', async () => {
    const tampered = ethers.id('invoice-2026-10-water-well-p1-TAMPERED');
    await reverts(
      () => governor.connect(member1).createFundReleaseProposal.staticCall(fundRequestId, tampered, '篡改材料'),
      'evidence hash mismatch',
      '材料哈希不一致应被拒绝',
    );
  });

  await test('不存在的申请单无法发起拨款提案', async () => {
    await reverts(
      () => governor.connect(member1).createFundReleaseProposal.staticCall(9999n, evidenceHash, '幽灵申请'),
      'request not found',
      '不存在的申请单应被拒绝',
    );
  });

  await test('凭申请单创建拨款提案，金额与收款方均由链上记录决定', async () => {
    await (
      await governor.connect(member1).createFundReleaseProposal(fundRequestId, evidenceHash, '拨付第一期打井款')
    ).wait();
    fundProposalId = (await governor.proposalCount()) - 1n;

    const proposal = await governor.getProposal(fundProposalId);
    equal(proposal.recipient, addr.recipient, '收款方应等于立项时登记的地址');
    equal(proposal.amount, ethers.parseEther('1'), '金额应等于申请单金额');
    equal(proposal.requestId, fundRequestId, '提案应记下对应的申请单号');
  });

  await test('同一张申请单不能重复发起拨款提案', async () => {
    await reverts(
      () => governor.connect(member2).createFundReleaseProposal.staticCall(fundRequestId, evidenceHash, '重复提案'),
      'already proposed',
      '重复使用申请单应被拒绝',
    );
  });

  await test('受助方本人对涉及自己项目的提案没有投票权（利益冲突回避）', async () => {
    await reverts(
      () => governor.connect(recipient).castVote.staticCall(fundProposalId, true),
      'conflict of interest',
      '受助方给自己项目投票应被拒绝',
    );
  });

  await test('两名成员联名支持后票数正确累加', async () => {
    await (await governor.connect(member1).castVote(fundProposalId, true)).wait();
    await (await governor.connect(member2).castVote(fundProposalId, true)).wait();

    const proposal = await governor.getProposal(fundProposalId);
    equal(proposal.forVotes, 200n, '两票赞成合计应为 200');
  });

  await test('通过的拨付提案执行后资金到账，并消耗一期里程碑', async () => {
    await mine(VOTING_PERIOD + TIMELOCK + 10);

    const before = await balanceOf(addr.recipient);
    await (await governor.connect(outsider).executeProposal(fundProposalId)).wait();
    const after = await balanceOf(addr.recipient);

    equal(after - before, ethers.parseEther('1'), '收款方余额应增加 1 ETH');

    const account = await vault.campaignAccounts(campaignId);
    equal(account.milestonesReleased, 1n, '已拨期数应变为 1');
    equal(account.released, ethers.parseEther('1'), '累计拨付应为 1 ETH');

    const proposal = await governor.getProposal(fundProposalId);
    equal(proposal.status, 3n, '提案状态应为 EXECUTED(3)');
  });

  await test('申请人可撤回未拨付的申请，撤回后不能再被提案引用', async () => {
    const secondEvidence = ethers.id('invoice-2026-10-water-well-p2');
    await (await vault.connect(recipient).requestFunds(campaignId, ethers.parseEther('0.5'), secondEvidence)).wait();
    const secondId = (await vault.fundRequestCount()) - 1n;

    await (await vault.connect(recipient).cancelRequest(secondId)).wait();
    const request = await vault.fundRequests(secondId);
    equal(request.status, 2n, '撤回后状态应为 CANCELLED(2)');

    await reverts(
      () => governor.connect(member1).createFundReleaseProposal.staticCall(secondId, secondEvidence, '已撤回的申请'),
      'request not pending',
      '已撤回的申请不能发起提案',
    );
  });

  await test('提案执行后会同步写入审计层', async () => {
    const records = await registry.recordCount();
    ok(records >= 8n, `审计记录应随捐款、材料锚定与执行累积，实际 ${records}`);
  });

  /* ====================== 募资失败退款 ====================== */
  group('七、异常场景：募资失败退款');

  let failedCampaignId;
  const DAY = 86400;

  await test('创建一个募资期 1 天、目标 9 ETH、分 2 期的项目', async () => {
    const receipt = await (
      await governor.connect(member1).proposeCampaign(
        '山区图书角计划',
        'dao-charity://campaign/book-corner',
        ethers.parseEther('9'),
        addr.recipient,
        1,
        2,
      )
    ).wait();
    const proposed = findEvent(receipt, artifacts.DaoGovernor.abi, 'CampaignProposed');
    ok(proposed, '应触发 CampaignProposed 事件');
    failedCampaignId = proposed.args.campaignId;
  });

  await test('募资期内可以正常捐款，并按捐赠人记账', async () => {
    await (await vault.connect(donorA).donate(failedCampaignId, '支持图书角', { value: ethers.parseEther('0.3') })).wait();
    equal(await vault.contributions(failedCampaignId, addr.donorA), ethers.parseEther('0.3'), '应记录捐赠人本金');
  });

  await test('募资期未结束时不能退款', async () => {
    await reverts(
      () => vault.connect(donorA).refund.staticCall(failedCampaignId),
      'fundraising ongoing',
      '募资期未结束不能退款',
    );
  });

  await test('募资期结束后未达目标额，捐赠人可取回本金', async () => {
    await mine(DAY + 10);

    const before = await balanceOf(addr.donorA);
    await (await vault.connect(donorA).refund(failedCampaignId)).wait();
    const after = await balanceOf(addr.donorA);

    ok(after > before, '退款后捐赠人余额应增加');
    equal(await vault.contributions(failedCampaignId, addr.donorA), 0n, '退款后本金记录应清零');
    equal(await vault.campaignBalance(failedCampaignId), 0n, '项目余额应归零');
  });

  await test('同一笔捐款不能重复退款', async () => {
    await reverts(
      () => vault.connect(donorA).refund.staticCall(failedCampaignId),
      'nothing to refund',
      '重复退款应被拒绝',
    );
  });

  await test('募资期结束后捐款入口关闭', async () => {
    await reverts(
      () => vault.connect(donorB).donate.staticCall(failedCampaignId, '迟到的捐款', { value: ethers.parseEther('0.1') }),
      'fundraising closed',
      '募资结束后不应再接收捐款',
    );
  });

  await test('已达目标额的项目即便过了募资期也不开放退款', async () => {
    const receipt = await (
      await governor.connect(member1).proposeCampaign(
        '应急药品补给',
        'dao-charity://campaign/medicine',
        ethers.parseEther('0.01'),
        addr.recipient,
        1,
        1,
      )
    ).wait();
    const fundedId = findEvent(receipt, artifacts.DaoGovernor.abi, 'CampaignProposed').args.campaignId;

    await (await vault.connect(donorA).donate(fundedId, '足额', { value: ethers.parseEther('0.02') })).wait();
    await mine(DAY + 10);

    await reverts(
      () => vault.connect(donorA).refund.staticCall(fundedId),
      'target reached',
      '已达标项目不应开放退款',
    );
  });

  /* ====================== 异常场景 ====================== */
  group('八、异常场景：法定人数与票权变更');

  await test('票权已锁死后，部署私钥不能直接改票权（无对外 grantVotingPower）', async () => {
    const hasGrant = artifacts.DaoGovernor.abi.some(
      (item) => item.type === 'function' && item.name === 'grantVotingPower',
    );
    equal(hasGrant, false, '合约不应再暴露 grantVotingPower 入口');
  });

  await test('票权调整只能通过治理提案，执行后票权才变化', async () => {
    const before = await governor.votingPower(addr.outsider);
    equal(before, 0n, 'outsider 初始票权应为 0');

    await (
      await governor.connect(member1).createVotingPowerProposal(addr.outsider, 50, '授予观察员 50 票权')
    ).wait();
    const changeId = (await governor.proposalCount()) - 1n;

    equal(await governor.votingPower(addr.outsider), 0n, '提案未执行前票权不应变化');

    await (await governor.connect(member1).castVote(changeId, true)).wait();
    await (await governor.connect(member2).castVote(changeId, true)).wait();
    await mine(VOTING_PERIOD + TIMELOCK + 10);
    await (await governor.connect(outsider).executeProposal(changeId)).wait();

    equal(await governor.votingPower(addr.outsider), 50n, '提案执行后票权应变为 50');
  });

  await test('法定人数不足时提案被判定为 REJECTED', async () => {
    // 把法定人数临时提到 100%，此时需要全部票权参与
    await (await governor.connect(deployer).setQuorumBps(10000)).wait();

    await (
      await governor.connect(member1).createVotingPowerProposal(addr.member2, 300, '测试法定人数')
    ).wait();
    const id = (await governor.proposalCount()) - 1n;

    // 只有 member1 投一票（100 / 500 = 20%，远低于 100%）
    await (await governor.connect(member1).castVote(id, true)).wait();
    await mine(VOTING_PERIOD + 5);

    await (await governor.connect(outsider).tallyProposal(id)).wait();
    const proposal = await governor.getProposal(id);
    equal(proposal.status, 2n, '参与票权不足时应判为 REJECTED(2)');

    await reverts(
      () => governor.connect(outsider).executeProposal.staticCall(id),
      'not passed',
      '未达法定人数的提案不可执行',
    );

    // 恢复正常法定人数
    await (await governor.connect(deployer).setQuorumBps(2500)).wait();
  });

  await test('反对票多于赞成票时提案被否决', async () => {
    await (
      await governor.connect(member1).createVotingPowerProposal(addr.member2, 999, '测试否决')
    ).wait();
    const id = (await governor.proposalCount()) - 1n;

    // member1 投赞成 100 票，member2 与 outsider 投反对（此时总票权 500）
    await (await governor.connect(member1).castVote(id, true)).wait();
    await (await governor.connect(member2).castVote(id, false)).wait();
    await (await governor.connect(outsider).castVote(id, false)).wait();
    await mine(VOTING_PERIOD + 5);

    await (await governor.connect(outsider).tallyProposal(id)).wait();
    const proposal = await governor.getProposal(id);
    equal(proposal.status, 2n, '反对票占多数时应判为 REJECTED(2)');
  });

  /* ==================== 审计员冻结与解冻 ==================== */
  group('九、审计员冻结：只关阀门，不动钱');

  // 造一个干净的、尚未拨过款的项目，专门用来测冻结。
  // 用 seedCampaigns 显式登记，这样 campaignId 是确定的，不必从提案事件里反查。
  const freezeCampaignId = ethers.id('freeze-target-campaign');
  const freezeDeadline = (await provider.getBlock('latest')).timestamp + 86400;

  await (
    await governor.connect(deployer).seedCampaigns([
      {
        campaignId: freezeCampaignId,
        recipient: addr.recipient,
        targetAmount: ethers.parseEther('6'),
        deadline: freezeDeadline,
        milestoneCount: 3,
        initialRaised: 0,
      },
    ])
  ).wait();

  await test('非审计员调用冻结被拒绝', async () => {
    await reverts(
      () => vault.connect(outsider).freezeCampaign.staticCall(freezeCampaignId, ethers.id('reason')),
      'only auditor',
      '普通成员不能冻结项目',
    );
  });

  await test('冻结必须附带理由哈希', async () => {
    await reverts(
      () => vault.connect(auditor).freezeCampaign.staticCall(freezeCampaignId, ethers.ZeroHash),
      'missing reason',
      '空理由的冻结应被拒绝',
    );
  });

  await test('审计员冻结项目成功，状态置为冻结', async () => {
    await (await vault.connect(auditor).freezeCampaign(freezeCampaignId, ethers.id('invoice-forged'))).wait();
    equal(await vault.isFrozen(freezeCampaignId), true, '项目应处于冻结状态');
  });

  await test('冻结动作写入审计台账，类型为 FREEZE(6)', async () => {
    const total = Number(await registry.recordCount());
    const latest = await registry.getRecord(total - 1);
    equal(Number(latest.operationType), 6, '冻结记录的操作类型应为 6');
  });

  await test('冻结后捐款入口关闭', async () => {
    await reverts(
      () => vault.connect(donorA).donate.staticCall(freezeCampaignId, '冻结期间捐款', { value: ethers.parseEther('0.1') }),
      'campaign frozen',
      '冻结期间不应再收到捐款',
    );
  });

  await test('冻结后受助方无法提交用款申请', async () => {
    await reverts(
      () => vault.connect(recipient).requestFunds.staticCall(freezeCampaignId, ethers.parseEther('1'), ethers.id('ev')),
      'campaign frozen',
      '冻结期间不应再受理用款申请',
    );
  });

  await test('冻结后治理合约也无法拨付（阀门在合约层，不靠前端拦）', async () => {
    let reason = '';
    try {
      await provider.send('eth_call', [
        {
          from: governorAddr,
          to: vaultAddr,
          data: vault.interface.encodeFunctionData('releaseFunds', [freezeCampaignId, 0]),
        },
        'latest',
      ]);
    } catch (error) {
      reason = String(error.message || error);
    }
    ok(reason.includes('campaign frozen'), `治理拨付应被冻结拦住，实际：${reason || '未回滚'}`);
  });

  await test('重复冻结被拒绝', async () => {
    await reverts(
      () => vault.connect(auditor).freezeCampaign.staticCall(freezeCampaignId, ethers.id('again')),
      'already frozen',
      '同一项目不能重复冻结',
    );
  });

  await test('审计员不能自己解冻（否则冻结权变成要挟工具）', async () => {
    await reverts(
      () => vault.connect(auditor).unfreezeCampaign.staticCall(freezeCampaignId),
      'only governor',
      '解冻必须走治理，审计员无权',
    );
  });

  await test('治理合约解冻后捐款入口恢复', async () => {
    // 解冻被限定为只有治理合约能调。测试里把治理身份临时指到部署账户，
    // 走完再切回合约地址，等价于「治理提案执行后解冻」这条路径。
    await (await vault.connect(deployer).setGovernor(addr.deployer)).wait();
    await (await vault.connect(deployer).unfreezeCampaign(freezeCampaignId)).wait();
    await (await vault.connect(deployer).setGovernor(governorAddr)).wait();
    equal(await vault.isFrozen(freezeCampaignId), false, '解冻后状态应复位');
    await (await vault.connect(donorA).donate(freezeCampaignId, '解冻后补捐', { value: ethers.parseEther('0.05') })).wait();
    equal(await vault.campaignBalance(freezeCampaignId), ethers.parseEther('0.05'), '解冻后应能正常收款');
  });

  /* ==================== 存量数据迁移 ==================== */
  group('十、存量迁移：历史募集额上链');

  const legacyId = ethers.id('legacy-campaign-001');
  const legacyDeadline = (await provider.getBlock('latest')).timestamp + 86400;

  await test('未登记的项目一律不收钱（防止资金锁死在幽灵账户）', async () => {
    await reverts(
      () => vault.connect(donorA).donate.staticCall(ethers.id('never-registered'), '打错地址', { value: ethers.parseEther('1') }),
      'campaign not registered',
      '未登记项目不应接收捐款',
    );
  });

  await test('seedCampaigns 把期初募集额写入链上账户', async () => {
    await (
      await governor.connect(deployer).seedCampaigns([
        {
          campaignId: legacyId,
          recipient: addr.recipient,
          targetAmount: ethers.parseEther('50'),
          deadline: legacyDeadline,
          milestoneCount: 5,
          initialRaised: ethers.parseEther('32.6'),
        },
      ])
    ).wait();

    const account = await vault.campaignAccounts(legacyId);
    equal(account.raised, ethers.parseEther('32.6'), '期初募集额应写入账本');
    equal(account.registered, true, '项目应标记为已登记');
    equal(await vault.campaignBalance(legacyId), ethers.parseEther('32.6'), '账面可用余额应等于期初额');
  });

  await test('迁移后单期额度按目标额与期数计算', async () => {
    const cap = await vault.milestoneCap(legacyId);
    equal(cap, ethers.parseEther('10'), '50 ETH 分 5 期，单期上限应为 10 ETH');
  });

  await test('已登记的项目不能重复迁移', async () => {
    await reverts(
      () => governor.connect(deployer).seedCampaigns.staticCall([
        {
          campaignId: legacyId,
          recipient: addr.recipient,
          targetAmount: ethers.parseEther('50'),
          deadline: legacyDeadline,
          milestoneCount: 5,
          initialRaised: 0,
        },
      ]),
      'campaign exists',
      '同一项目不能重复登记',
    );
  });

  await test('期初募集额超过目标额时被拒绝', async () => {
    await reverts(
      () => governor.connect(deployer).seedCampaigns.staticCall([
        {
          campaignId: ethers.id('bad-legacy'),
          recipient: addr.recipient,
          targetAmount: ethers.parseEther('10'),
          deadline: legacyDeadline,
          milestoneCount: 2,
          initialRaised: ethers.parseEther('11'),
        },
      ]),
      'initial raised exceeds target',
      '期初额大于目标额属于脏数据，应拒绝',
    );
  });

  await test('非 owner 不能调用批量迁移入口', async () => {
    await reverts(
      () => governor.connect(outsider).seedCampaigns.staticCall([]),
      'not owner',
      '迁移入口只对部署账户开放',
    );
  });

  await test('记账额超过金库真实余额时拨付被拦住', async () => {
    // 这个项目期初记了 32.6 ETH，但合约里并没有对应的真金白银，单期要拨 10 ETH
    const hugeId = ethers.id('legacy-huge-campaign');
    await (
      await governor.connect(deployer).seedCampaigns([
        {
          campaignId: hugeId,
          recipient: addr.recipient,
          targetAmount: ethers.parseEther('6000'),
          deadline: legacyDeadline,
          milestoneCount: 6,
          initialRaised: ethers.parseEther('6000'),
        },
      ])
    ).wait();

    const cap = await vault.milestoneCap(hugeId);
    const requestReceipt = await (
      await vault.connect(recipient).requestFunds(hugeId, cap, ethers.id('huge-evidence'))
    ).wait();
    const requested = findEvent(requestReceipt, artifacts.DonationVault.abi, 'FundRequested');
    ok(requested, '应触发 FundRequested 事件');
    const requestId = Number(requested.args.requestId);

    let reason = '';
    try {
      await provider.send('eth_call', [
        {
          from: governorAddr,
          to: vaultAddr,
          data: vault.interface.encodeFunctionData('releaseFunds', [hugeId, requestId]),
        },
        'latest',
      ]);
    } catch (error) {
      reason = String(error.message || error);
    }
    ok(
      reason.includes('vault balance insufficient'),
      `记账额虚高时拨付应以真实余额为准被拒，实际：${reason || '未回滚'}`,
    );
  });

  /* ============================ 汇总 ============================ */
  console.log('\n────────────────────────────────────────');
  console.log(`测试完成：通过 ${passed} 条，失败 ${failures.length} 条`);
  if (failures.length > 0) {
    console.log('\n失败明细：');
    failures.forEach((item) => {
      console.log(`  - ${item.name}`);
      console.log(`    ${String(item.error.message || item.error).split('\n')[0]}`);
    });
    process.exitCode = 1;
  } else {
    console.log('全部通过。');
  }
})().catch((error) => {
  console.error('\n测试运行出错：');
  console.error(error);
  process.exitCode = 1;
});
