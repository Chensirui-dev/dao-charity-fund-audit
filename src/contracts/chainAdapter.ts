/**
 * 链上调用适配层：把前端的业务动作翻译成真实的 Sepolia 合约调用。
 *
 * 读操作走公共 RPC（无需钱包），写操作走浏览器钱包签名。
 * 只有在 CHAIN_MODE=sepolia 且三个合约地址都配置齐全时，上层才会调用这里的方法。
 */
import { BrowserProvider, Contract, Interface, JsonRpcProvider, id, parseEther, type Provider, type Signer } from 'ethers';
import { AUDIT_REGISTRY_ABI, DAO_GOVERNOR_ABI, DONATION_VAULT_ABI } from './abis';
import { CHAIN_ID, CONTRACT_ADDRESSES, IS_ONCHAIN, RPC_URL } from './config';
import { getEthereum } from './wallet';

let readProvider: JsonRpcProvider | null = null;
let browserProvider: BrowserProvider | null = null;

/** 只读 provider：走公共 RPC，不依赖钱包扩展 */
export function getReadProvider(): Provider {
  if (!readProvider) {
    // batchMaxCount: 1 —— 公共网关（tenderly）对 JSON-RPC 批量请求支持不稳定，
    // 一旦并发读多个提案就会超时，这里强制单条发送。
    readProvider = new JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true, batchMaxCount: 1 });
  }
  return readProvider;
}

/** 写入 provider：走浏览器钱包 */
export function getBrowserProvider(): BrowserProvider {
  const ethereum = getEthereum();
  if (!ethereum) {
    throw new Error('未检测到浏览器钱包，请安装 MetaMask 后重试');
  }
  if (!browserProvider) {
    browserProvider = new BrowserProvider(ethereum);
  }
  return browserProvider;
}

export async function getSigner(): Promise<Signer> {
  return getBrowserProvider().getSigner();
}

/** 把业务字符串 ID 映射为链上 bytes32 */
export function toBytes32(value: string): string {
  return /^0x[0-9a-fA-F]{64}$/.test(value) ? value : id(value);
}

/**
 * 求某个项目在链上使用的 bytes32 标识。
 *
 * 项目方新建的项目，标识由合约在 proposeCampaign 里算出来（存在 campaign.onchainId）；
 * 种子项目没有上链，就用项目本地 ID 的 keccak256，保证「捐款」和「拨付」落在同一个账本分户上。
 */
export function campaignKeyOf(campaign: { id: string; onchainId?: string }): string {
  return campaign.onchainId ?? toBytes32(campaign.id);
}

export interface OnchainReceipt {
  txHash: string;
  blockNumber: number;
}

export interface OnchainCampaignResult extends OnchainReceipt {
  /** 链上生成的 bytes32 项目标识 */
  campaignIdHex: string;
  /** 链上生成的提案编号 */
  proposalId: number;
}

export interface OnchainProposalResult extends OnchainReceipt {
  proposalId: number;
}

export interface OnchainVoteResult extends OnchainReceipt {
  votingPower: number;
}

function pickEventArg(receiptLogs: readonly { address: string; topics: readonly string[]; data: string }[], iface: Interface, eventName: string, argName: string, contractAddress: string): unknown {
  for (const log of receiptLogs) {
    if (log.address.toLowerCase() !== contractAddress.toLowerCase()) continue;
    try {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === eventName) return parsed.args[argName];
    } catch {
      // 非本合约事件，忽略
    }
  }
  return undefined;
}

/** 读取链上金库合约的总收款额（ETH 字符串），供只读展示 */
export async function readVaultTotalRaised(): Promise<string> {
  if (!IS_ONCHAIN) return '0';
  const contract = new Contract(CONTRACT_ADDRESSES.donationVault, DONATION_VAULT_ABI, getReadProvider());
  const total = await contract.totalRaised() as bigint;
  return total.toString();
}

/** 读取审计层已固化的记录条数 */
export async function readAuditRecordCount(): Promise<number> {
  if (!IS_ONCHAIN) return 0;
  const contract = new Contract(CONTRACT_ADDRESSES.auditRegistry, AUDIT_REGISTRY_ABI, getReadProvider());
  return Number(await contract.recordCount() as bigint);
}

/** 捐款：携带 ETH 调用 DonationVault.donate，等待链上确认 */
export async function donateOnchain(campaignKey: string, amountEth: number, message: string): Promise<OnchainReceipt> {
  const signer = await getSigner();
  const contract = new Contract(CONTRACT_ADDRESSES.donationVault, DONATION_VAULT_ABI, signer);
  const tx = await contract.donate(toBytes32(campaignKey), message, { value: parseEther(String(amountEth)) });
  const receipt = await tx.wait();
  return { txHash: receipt?.hash ?? tx.hash, blockNumber: receipt?.blockNumber ?? 0 };
}

/* ------------------------------------------------------------------ */
/* 项目元数据：随上架提案一起写进链上，四个浏览器窗口据此还原同一份项目   */
/* ------------------------------------------------------------------ */

/**
 * 项目元数据的链上承载格式。
 *
 * 合约的 proposeCampaign 只接受一个自由字符串（存进提案的 metadataURI），
 * 不新增合约字段也能把项目名、简介、目标金额、受助方一起上链：
 * 把它们序列化成一个带前缀的 JSON 即可。前缀用来把「结构化项目元数据」
 * 和「普通提案的文字说明」区分开。
 */
export interface CampaignMetadata {
  v: 1;
  name: string;
  description: string;
  targetEth: number;
  recipient: string;
  cover: string;
  createdAt: number;
}

const CAMPAIGN_META_PREFIX = 'meta:';

function encodeCampaignMetadata(meta: CampaignMetadata): string {
  return `${CAMPAIGN_META_PREFIX}${JSON.stringify(meta)}`;
}

/** 从链上提案的 description 里还原项目元数据；不是项目元数据则返回 null */
export function parseCampaignMetadata(raw: string): CampaignMetadata | null {
  if (!raw || !raw.startsWith(CAMPAIGN_META_PREFIX)) return null;
  try {
    const parsed = JSON.parse(raw.slice(CAMPAIGN_META_PREFIX.length)) as CampaignMetadata;
    if (!parsed || typeof parsed.name !== 'string' || !parsed.name) return null;
    return {
      v: 1,
      name: parsed.name,
      description: typeof parsed.description === 'string' ? parsed.description : '',
      targetEth: Number(parsed.targetEth) || 0,
      recipient: typeof parsed.recipient === 'string' ? parsed.recipient : '',
      cover: typeof parsed.cover === 'string' ? parsed.cover : '',
      createdAt: Number(parsed.createdAt) || 0,
    };
  } catch {
    return null;
  }
}

/**
 * 由链上 campaignId 派生本地项目 ID。
 *
 * 四个窗口各自独立维护前端状态，只有合约是共同事实来源。
 * 只要 ID 的生成规则一样，A 窗口建的项目在 B 窗口就是同一个 ID，
 * 提案的 targetId 才指得回项目。
 */
export function campaignIdFromKey(campaignKeyHex: string): string {
  return `camp-${campaignKeyHex.replace(/^0x/, '').slice(0, 12)}`;
}

/** 提案描述若承载的是项目元数据，则返回人类可读的简介；否则原样返回 */
export function readableDescription(description: string): string {
  const meta = parseCampaignMetadata(description);
  return meta ? meta.description : description;
}

/** 项目上架：调用 DaoGovernor.proposeCampaign，解析链上项目标识与提案编号 */
export async function createCampaignOnchain(input: {
  name: string;
  description: string;
  targetEth: number;
  recipientAddress: string;
  cover: string;
  /** 募资开放天数，到期未达目标额则开放退款 */
  fundraisingDays: number;
  /** 分期期数，决定单期可申请的额度上限 */
  milestoneCount: number;
}): Promise<OnchainCampaignResult> {
  const signer = await getSigner();
  const contract = new Contract(CONTRACT_ADDRESSES.daoGovernor, DAO_GOVERNOR_ABI, signer);
  const metadataURI = encodeCampaignMetadata({
    v: 1,
    name: input.name,
    description: input.description,
    targetEth: input.targetEth,
    recipient: input.recipientAddress,
    cover: input.cover,
    createdAt: Date.now(),
  });
  const tx = await contract.proposeCampaign(
    input.name,
    metadataURI,
    parseEther(String(input.targetEth)),
    input.recipientAddress,
    input.fundraisingDays,
    input.milestoneCount,
  );
  const receipt = await tx.wait();
  const logs = receipt?.logs ?? [];
  const iface = new Interface(DAO_GOVERNOR_ABI);
  const campaignIdHex = String(pickEventArg(logs, iface, 'CampaignProposed', 'campaignId', CONTRACT_ADDRESSES.daoGovernor) ?? toBytes32(input.name));
  const proposalId = Number(pickEventArg(logs, iface, 'ProposalCreated', 'proposalId', CONTRACT_ADDRESSES.daoGovernor) ?? 0);
  return {
    txHash: receipt?.hash ?? tx.hash,
    blockNumber: receipt?.blockNumber ?? 0,
    campaignIdHex,
    proposalId,
  };
}

/** 创建通用提案 */
export async function createProposalOnchain(input: { typeCode: number; targetKey: string; title: string; description: string }): Promise<OnchainProposalResult> {
  const signer = await getSigner();
  const contract = new Contract(CONTRACT_ADDRESSES.daoGovernor, DAO_GOVERNOR_ABI, signer);
  const tx = await contract.createProposal(input.typeCode, toBytes32(input.targetKey), input.title, input.description);
  const receipt = await tx.wait();
  const iface = new Interface(DAO_GOVERNOR_ABI);
  const proposalId = Number(pickEventArg(receipt?.logs ?? [], iface, 'ProposalCreated', 'proposalId', CONTRACT_ADDRESSES.daoGovernor) ?? 0);
  return { txHash: receipt?.hash ?? tx.hash, blockNumber: receipt?.blockNumber ?? 0, proposalId };
}

/** 投票 */
export async function castVoteOnchain(proposalId: number, support: boolean): Promise<OnchainVoteResult> {
  const signer = await getSigner();
  const contract = new Contract(CONTRACT_ADDRESSES.daoGovernor, DAO_GOVERNOR_ABI, signer);
  const tx = await contract.castVote(proposalId, support);
  const receipt = await tx.wait();
  const iface = new Interface(DAO_GOVERNOR_ABI);
  const power = Number(pickEventArg(receipt?.logs ?? [], iface, 'VoteCast', 'votingPower', CONTRACT_ADDRESSES.daoGovernor) ?? 0);
  return { txHash: receipt?.hash ?? tx.hash, blockNumber: receipt?.blockNumber ?? 0, votingPower: power };
}

/** 执行提案（资金拨付类会真正转账并写审计记录） */
export async function executeProposalOnchain(proposalId: number): Promise<OnchainReceipt> {
  const signer = await getSigner();
  const contract = new Contract(CONTRACT_ADDRESSES.daoGovernor, DAO_GOVERNOR_ABI, signer);
  const tx = await contract.executeProposal(proposalId);
  const receipt = await tx.wait();
  return { txHash: receipt?.hash ?? tx.hash, blockNumber: receipt?.blockNumber ?? 0 };
}

/* ------------------------------------------------------------------ */
/* 用款申请：受助方提交申请 → 治理表决 → 按里程碑拨付                     */
/* ------------------------------------------------------------------ */

/** 链上一张用款申请单的快照 */
export interface ChainFundRequest {
  requestId: number;
  campaignIdHex: string;
  amountWei: string;
  evidenceHash: string;
  requester: string;
  /** 提交时间（毫秒） */
  createdAt: number;
  /** 0=PENDING 1=RELEASED 2=CANCELLED */
  statusCode: number;
}

/** 受助方提交用款申请。材料文件本身不上链，只把它的 SHA-256 摘要写进链上审计层。 */
export async function requestFundsOnchain(input: {
  campaignKeyHex: string;
  amountEth: number;
  evidenceHash: string;
}): Promise<OnchainReceipt & { requestId: number }> {
  const signer = await getSigner();
  const contract = new Contract(CONTRACT_ADDRESSES.donationVault, DONATION_VAULT_ABI, signer);
  const tx = await contract.requestFunds(
    input.campaignKeyHex,
    parseEther(String(input.amountEth)),
    input.evidenceHash,
  );
  const receipt = await tx.wait();
  const iface = new Interface(DONATION_VAULT_ABI);
  const requestId = Number(
    pickEventArg(receipt?.logs ?? [], iface, 'FundRequested', 'requestId', CONTRACT_ADDRESSES.donationVault) ?? 0,
  );
  return { txHash: receipt?.hash ?? tx.hash, blockNumber: receipt?.blockNumber ?? 0, requestId };
}

/** 受助方撤回尚未拨付的申请 */
export async function cancelFundRequestOnchain(requestId: number): Promise<OnchainReceipt> {
  const signer = await getSigner();
  const contract = new Contract(CONTRACT_ADDRESSES.donationVault, DONATION_VAULT_ABI, signer);
  const tx = await contract.cancelRequest(requestId);
  const receipt = await tx.wait();
  return { txHash: receipt?.hash ?? tx.hash, blockNumber: receipt?.blockNumber ?? 0 };
}

/** 募资失败退款：截止时间已过且未达目标额时，捐赠人取回本金 */
export async function refundDonationOnchain(campaignKeyHex: string): Promise<OnchainReceipt> {
  const signer = await getSigner();
  const contract = new Contract(CONTRACT_ADDRESSES.donationVault, DONATION_VAULT_ABI, signer);
  const tx = await contract.refund(campaignKeyHex);
  const receipt = await tx.wait();
  return { txHash: receipt?.hash ?? tx.hash, blockNumber: receipt?.blockNumber ?? 0 };
}

/**
 * 审计员冻结项目。
 *
 * 冻结只关阀门：捐款、申请、拨付、退款四个入口全部关闭，账本一分不动。
 * 解冻不能由审计员自己做，必须走治理表决——否则冻结权就成了要挟工具。
 */
export async function freezeCampaignOnchain(campaignKeyHex: string, reasonHash: string): Promise<OnchainReceipt> {
  const signer = await getSigner();
  const contract = new Contract(CONTRACT_ADDRESSES.donationVault, DONATION_VAULT_ABI, signer);
  const tx = await contract.freezeCampaign(campaignKeyHex, reasonHash);
  const receipt = await tx.wait();
  return { txHash: receipt?.hash ?? tx.hash, blockNumber: receipt?.blockNumber ?? 0 };
}

/** 读取链上登记的审计员地址，用于判断当前钱包是否有冻结权 */
export async function readAuditorOnchain(): Promise<string> {
  if (!IS_ONCHAIN) return '';
  const contract = new Contract(CONTRACT_ADDRESSES.donationVault, DONATION_VAULT_ABI, getReadProvider());
  return (await contract.auditor()) as string;
}

/** 读取某张用款申请单 */
export async function readFundRequestOnchain(requestId: number): Promise<ChainFundRequest | null> {
  if (!IS_ONCHAIN) return null;
  const contract = new Contract(CONTRACT_ADDRESSES.donationVault, DONATION_VAULT_ABI, getReadProvider());
  try {
    const raw = await contract.fundRequests(requestId) as unknown as {
      campaignId: string;
      amount: bigint;
      evidenceHash: string;
      requester: string;
      createdAt: bigint;
      status: bigint;
    };
    return {
      requestId,
      campaignIdHex: raw.campaignId,
      amountWei: raw.amount.toString(),
      evidenceHash: raw.evidenceHash,
      requester: raw.requester,
      createdAt: Number(raw.createdAt) * 1000,
      statusCode: Number(raw.status),
    };
  } catch {
    return null;
  }
}

/** 读取全部用款申请（按编号倒序，最新的在前） */
export async function readAllFundRequestsOnchain(): Promise<ChainFundRequest[]> {
  if (!IS_ONCHAIN) return [];
  const contract = new Contract(CONTRACT_ADDRESSES.donationVault, DONATION_VAULT_ABI, getReadProvider());
  const count = Number(await contract.fundRequestCount() as bigint);
  const list: ChainFundRequest[] = [];
  for (let index = 0; index < count; index += 1) {
    const item = await readFundRequestOnchain(index);
    if (item) list.push(item);
  }
  return list.reverse();
}

/* ------------------------------------------------------------------ */
/* 拨付类提案：金额与收款人必须落到链上，否则执行时无处转账                */
/* ------------------------------------------------------------------ */

/**
 * 创建资金拨付提案。
 *
 * 这里既没有收款地址也没有金额：两者都由金库从「用款申请单 + 立项记录」里读，
 * 提案人能决定的只有「批不批准」。evidenceHash 是提交人重新上传材料后算出的摘要，
 * 必须与受助方申请时锚定的一致——材料被改过一个字节，这里就过不去。
 */
export async function createFundReleaseProposalOnchain(input: {
  requestId: number;
  evidenceHash: string;
  title: string;
}): Promise<OnchainProposalResult> {
  const signer = await getSigner();
  const contract = new Contract(CONTRACT_ADDRESSES.daoGovernor, DAO_GOVERNOR_ABI, signer);
  const tx = await contract.createFundReleaseProposal(input.requestId, input.evidenceHash, input.title);
  const receipt = await tx.wait();
  const iface = new Interface(DAO_GOVERNOR_ABI);
  const proposalId = Number(pickEventArg(receipt?.logs ?? [], iface, 'ProposalCreated', 'proposalId', CONTRACT_ADDRESSES.daoGovernor) ?? 0);
  return { txHash: receipt?.hash ?? tx.hash, blockNumber: receipt?.blockNumber ?? 0, proposalId };
}

/** 读取某项目在链上立项时登记的收款地址（不可由拨款提案修改） */
export async function readCampaignRecipientOnchain(campaignKeyHex: string): Promise<string> {
  if (!IS_ONCHAIN) return '';
  const contract = new Contract(CONTRACT_ADDRESSES.donationVault, DONATION_VAULT_ABI, getReadProvider());
  const recipient = await contract.campaignRecipient(campaignKeyHex) as string;
  return recipient && recipient !== '0x0000000000000000000000000000000000000000' ? recipient : '';
}

/** 读取某个项目在链上金库里的可拨付余额（wei 字符串） */
export async function readCampaignBalanceOnchain(campaignKeyHex: string): Promise<string> {
  if (!IS_ONCHAIN) return '0';
  const contract = new Contract(CONTRACT_ADDRESSES.donationVault, DONATION_VAULT_ABI, getReadProvider());
  const balance = await contract.campaignBalance(campaignKeyHex) as bigint;
  return balance.toString();
}

/** 链上项目账户快照：募集、拨付进度与分期参数 */
export interface ChainCampaignAccount {
  raised: string;
  released: string;
  targetAmount: string;
  /** 募资截止时间（毫秒） */
  deadline: number;
  milestoneCount: number;
  milestonesReleased: number;
  /** 是否已在金库登记。未登记的项目不收钱、不能申请用款 */
  registered: boolean;
  /** 审计员冻结标记。冻结期间所有资金出入口关闭 */
  frozen: boolean;
}

/** 读取某个项目的链上账户状态，用于项目卡片与用款申请提示 */
export async function readCampaignAccountOnchain(campaignKeyHex: string): Promise<ChainCampaignAccount> {
  const empty: ChainCampaignAccount = {
    raised: '0',
    released: '0',
    targetAmount: '0',
    deadline: 0,
    milestoneCount: 0,
    milestonesReleased: 0,
    registered: false,
    frozen: false,
  };
  if (!IS_ONCHAIN) return empty;
  const contract = new Contract(CONTRACT_ADDRESSES.donationVault, DONATION_VAULT_ABI, getReadProvider());
  const account = await contract.campaignAccounts(campaignKeyHex) as unknown as {
    raised: bigint;
    released: bigint;
    targetAmount: bigint;
    deadline: bigint;
    milestoneCount: bigint;
    milestonesReleased: bigint;
    registered: boolean;
    frozen: boolean;
  };
  return {
    raised: account.raised.toString(),
    released: account.released.toString(),
    targetAmount: account.targetAmount.toString(),
    deadline: Number(account.deadline) * 1000,
    milestoneCount: Number(account.milestoneCount),
    milestonesReleased: Number(account.milestonesReleased),
    registered: account.registered,
    frozen: account.frozen,
  };
}

/** 链上提案的完整快照，字段与合约 Proposal 结构一一对应 */
export interface ChainProposal {
  proposalId: number;
  typeCode: number;
  targetIdHex: string;
  title: string;
  description: string;
  proposer: string;
  forVotes: number;
  againstVotes: number;
  /** 投票开始时间（毫秒时间戳，已由链上秒级时间换算） */
  startTime: number;
  /** 投票结束时间（毫秒时间戳） */
  endTime: number;
  /** 0=ACTIVE 1=PASSED 2=REJECTED 3=EXECUTED */
  statusCode: number;
  recipient: string;
  amountWei: string;
  /** 拨付类提案对应的用款申请单号；非拨付类为 0 */
  requestId: number;
}

interface RawProposal {
  proposalType: bigint;
  targetId: string;
  title: string;
  description: string;
  proposer: string;
  forVotes: bigint;
  againstVotes: bigint;
  startTime: bigint;
  endTime: bigint;
  status: bigint;
  recipient: string;
  amount: bigint;
  requestId: bigint;
}

function toChainProposal(proposalId: number, raw: RawProposal): ChainProposal {
  return {
    proposalId,
    typeCode: Number(raw.proposalType),
    targetIdHex: raw.targetId,
    title: raw.title,
    description: raw.description,
    proposer: raw.proposer,
    forVotes: Number(raw.forVotes),
    againstVotes: Number(raw.againstVotes),
    startTime: Number(raw.startTime) * 1000,
    endTime: Number(raw.endTime) * 1000,
    statusCode: Number(raw.status),
    recipient: raw.recipient,
    amountWei: raw.amount.toString(),
    requestId: Number(raw.requestId ?? 0),
  };
}

/** 读取单条链上提案 */
export async function readProposalOnchain(proposalId: number): Promise<ChainProposal> {
  if (!IS_ONCHAIN) throw new Error('当前不是真实链模式');
  const contract = new Contract(CONTRACT_ADDRESSES.daoGovernor, DAO_GOVERNOR_ABI, getReadProvider());
  const raw = await contract.getProposal(proposalId) as unknown as RawProposal;
  return toChainProposal(proposalId, raw);
}

/** 读取链上全部提案（顺序遍历，避免公共网关限流），返回按编号倒序的列表 */
export async function readAllProposalsOnchain(): Promise<ChainProposal[]> {
  if (!IS_ONCHAIN) return [];
  const contract = new Contract(CONTRACT_ADDRESSES.daoGovernor, DAO_GOVERNOR_ABI, getReadProvider());
  const count = Number(await contract.proposalCount() as bigint);
  const list: ChainProposal[] = [];
  for (let index = 0; index < count; index += 1) {
    try {
      const raw = await contract.getProposal(index) as unknown as RawProposal;
      list.push(toChainProposal(index, raw));
    } catch {
      // 单条读取失败不影响其他提案
    }
  }
  return list.reverse();
}

/** 读取治理合约设置的投票时长（秒），前端倒计时应以此为准 */
export async function readVotingPeriodOnchain(): Promise<number> {
  if (!IS_ONCHAIN) return 0;
  const contract = new Contract(CONTRACT_ADDRESSES.daoGovernor, DAO_GOVERNOR_ABI, getReadProvider());
  return Number(await contract.votingPeriod() as bigint);
}

/** 治理参数快照：法定人数、执行时间锁、票权是否已锁死、总票权 */
export interface GovernanceParams {
  quorumBps: number;
  timelockSeconds: number;
  totalVotingPower: number;
  seeded: boolean;
}

export async function readGovernanceParamsOnchain(): Promise<GovernanceParams> {
  if (!IS_ONCHAIN) {
    return { quorumBps: 0, timelockSeconds: 0, totalVotingPower: 0, seeded: false };
  }
  const contract = new Contract(CONTRACT_ADDRESSES.daoGovernor, DAO_GOVERNOR_ABI, getReadProvider());
  const [quorumBps, timelockSeconds, totalVotingPower, seeded] = await Promise.all([
    contract.quorumBps() as Promise<bigint>,
    contract.timelockDuration() as Promise<bigint>,
    contract.totalVotingPower() as Promise<bigint>,
    contract.votingPowerSeeded() as Promise<boolean>,
  ]);
  return {
    quorumBps: Number(quorumBps),
    timelockSeconds: Number(timelockSeconds),
    totalVotingPower: Number(totalVotingPower),
    seeded,
  };
}

/* ------------------------------------------------------------------ */
/* Merkle 批次锚定与验真                                                */
/* ------------------------------------------------------------------ */

export interface OnchainAnchorResult extends OnchainReceipt {
  anchorId: number;
}

export interface OnchainAnchor {
  index: number;
  merkleRoot: string;
  fromIndex: number;
  toIndex: number;
  anchorer: string;
  timestamp: number;
}

/**
 * 把一批审计记录的 Merkle 根锚定到链上（写操作，需要钱包签名）。
 * 锚定后这条承诺不可修改，任何一条记录都能用 verifyProof 对着它验真。
 */
export async function anchorBatchOnchain(merkleRoot: string, fromIndex: number, toIndex: number): Promise<OnchainAnchorResult> {
  const signer = await getSigner();
  const contract = new Contract(CONTRACT_ADDRESSES.auditRegistry, AUDIT_REGISTRY_ABI, signer);
  const tx = await contract.anchorBatch(merkleRoot, fromIndex, toIndex);
  const receipt = await tx.wait();
  const iface = new Interface(AUDIT_REGISTRY_ABI);
  const anchorId = Number(
    pickEventArg(receipt?.logs ?? [], iface, 'BatchAnchored', 'anchorId', CONTRACT_ADDRESSES.auditRegistry) ?? 0,
  );
  return { txHash: receipt?.hash ?? tx.hash, blockNumber: receipt?.blockNumber ?? 0, anchorId };
}

/**
 * 调用链上合约的 verifyProof 做真实验真。
 * 只读调用（eth_call），不需要钱包、不消耗 Gas，因此可以随点随验。
 */
export async function verifyProofOnchain(leaf: string, proof: string[], root: string): Promise<boolean> {
  if (!IS_ONCHAIN) throw new Error('当前不是真实链模式，无法调用链上验真');
  const contract = new Contract(CONTRACT_ADDRESSES.auditRegistry, AUDIT_REGISTRY_ABI, getReadProvider());
  return Boolean(await contract.verifyProof(leaf, proof, root));
}

/** 读取链上最新的一条批次锚定记录；没有则返回 null */
export async function readLatestAnchor(): Promise<OnchainAnchor | null> {
  if (!IS_ONCHAIN) return null;
  const contract = new Contract(CONTRACT_ADDRESSES.auditRegistry, AUDIT_REGISTRY_ABI, getReadProvider());
  const count = Number((await contract.anchorCount()) as bigint);
  if (count === 0) return null;

  const anchor = (await contract.getAnchor(count - 1)) as unknown as [string, bigint, bigint, string, bigint];
  return {
    index: count - 1,
    merkleRoot: anchor[0],
    fromIndex: Number(anchor[1]),
    toIndex: Number(anchor[2]),
    anchorer: anchor[3],
    timestamp: Number(anchor[4]),
  };
}

/** 读取链上已固化的审计记录条数 */
export async function readOnchainRecordCount(): Promise<number> {
  if (!IS_ONCHAIN) return 0;
  const contract = new Contract(CONTRACT_ADDRESSES.auditRegistry, AUDIT_REGISTRY_ABI, getReadProvider());
  return Number((await contract.recordCount()) as bigint);
}

/** 链上审计台账的一条记录，字段与 AuditRegistry.AuditRecord 一一对应 */
export interface ChainAuditRecord {
  index: number;
  /** 业务摘要哈希（捐款落账 / 拨款指令 / 提案执行凭据），不是外层交易哈希 */
  digest: string;
  /** 0=捐款入账 1=资金支取 2=资金拨付 3=提案执行 */
  operationCode: number;
  merkleRoot: string;
  /** 附带的说明文本（捐款留言、提案标题等） */
  memo: string;
  /** 写入方合约地址 */
  reporter: string;
  /** 毫秒时间戳 */
  timestamp: number;
}

/**
 * 读取链上全部审计记录。
 *
 * 顺序逐条读取而不是一次性批量拉，公共网关对并发请求不友好。
 * 记录条数通常只有几十条，代价可以接受。
 */
export async function readAllAuditRecordsOnchain(): Promise<ChainAuditRecord[]> {
  if (!IS_ONCHAIN) return [];
  const contract = new Contract(CONTRACT_ADDRESSES.auditRegistry, AUDIT_REGISTRY_ABI, getReadProvider());
  const count = Number((await contract.recordCount()) as bigint);
  const list: ChainAuditRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    try {
      const raw = (await contract.getRecord(index)) as unknown as {
        txHash: string;
        operationType: bigint;
        merkleRoot: string;
        metadataURI: string;
        reporter: string;
        timestamp: bigint;
      };
      list.push({
        index,
        digest: raw.txHash,
        operationCode: Number(raw.operationType),
        merkleRoot: raw.merkleRoot,
        memo: raw.metadataURI,
        reporter: raw.reporter,
        timestamp: Number(raw.timestamp) * 1000,
      });
    } catch {
      // 单条失败跳过，不影响整体
    }
  }
  return list.reverse();
}
