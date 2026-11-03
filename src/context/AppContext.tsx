import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { auditLogs as initialAuditLogs, campaigns as initialCampaigns, donations as initialDonations, members, proposals as initialProposals } from '../data';
import { coverLibrary } from '../data/campaigns';
import type { AuditLog, Campaign, Donation, Proposal, ProposalStatus, ProposalType, RolePermission, RoleProfile, ToastMessage, UserRole } from '../types';
import { addWei, ethToWei, formatEth, randomHash } from '../utils/format';
import { hashText } from '../utils/evidence';
import { addresses, block } from '../utils/mock';
import { DEMO_ACCOUNT_ROLES, IS_ONCHAIN } from '../contracts/config';
import {
  campaignIdFromKey,
  campaignKeyOf,
  castVoteOnchain,
  createCampaignOnchain,
  createFundReleaseProposalOnchain,
  createProposalOnchain,
  donateOnchain,
  executeProposalOnchain,
  parseCampaignMetadata,
  readableDescription,
  readAllAuditRecordsOnchain,
  readAllProposalsOnchain,
  readCampaignAccountOnchain,
  freezeCampaignOnchain,
  readCampaignBalanceOnchain,
  readProposalOnchain,
  refundDonationOnchain,
  requestFundsOnchain,
  toBytes32,
  type ChainAuditRecord,
  type ChainProposal,
} from '../contracts/chainAdapter';
import { CHAIN_ID, CHAIN_NAME, getEthereum, parseChainId, switchToChain } from '../contracts/wallet';

const delay = (ms: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, ms);
});

const shortHash = (hash: string) => `${hash.slice(0, 14)}...${hash.slice(-6)}`;

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    const withReason = error as Error & { shortMessage?: string; reason?: string };
    return withReason.shortMessage ?? withReason.reason ?? withReason.message;
  }
  return '交易未完成，请检查钱包网络与余额后重试。';
};

const CHAIN_PROPOSAL_TYPES: ProposalType[] = ['FUND_RELEASE', 'CAMPAIGN_APPROVAL', 'AUDIT_RULE_CHANGE'];
const CHAIN_PROPOSAL_STATUS: ProposalStatus[] = ['ACTIVE', 'PASSED', 'REJECTED', 'EXECUTED'];
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * 链上提案 → 前端提案。
 *
 * 合约里只存了 bytes32 的项目标识，没有项目名之类的业务字段，
 * 所以这里用种子项目的 keccak256 标识反查回本地项目 ID，查不到就原样保留哈希。
 */
function fromChainProposal(chain: ChainProposal, campaignByKey: Map<string, string>, knownCampaignIds: Set<string>): Proposal {
  const type = CHAIN_PROPOSAL_TYPES[chain.typeCode] ?? 'AUDIT_RULE_CHANGE';
  // 上架提案的 targetId 本身就是链上 campaignId，按统一规则派生成本地项目 ID；
  // 拨付类提案的 targetId 先按种子项目反查，再按派生规则匹配链上新项目，都不中才保留哈希。
  const derivedId = campaignIdFromKey(chain.targetIdHex);
  const targetId = type === 'CAMPAIGN_APPROVAL'
    ? derivedId
    : campaignByKey.get(chain.targetIdHex.toLowerCase()) ?? (knownCampaignIds.has(derivedId) ? derivedId : chain.targetIdHex);

  return {
    id: `chain-${chain.proposalId}`,
    onchainId: chain.proposalId,
    title: chain.title.replace(/^Approve campaign:\s*/, '批准项目上架：') || `提案 #${chain.proposalId}`,
    description: readableDescription(chain.description),
    type,
    proposerAddress: chain.proposer,
    targetId,
    startTime: chain.startTime,
    endTime: chain.endTime + 2000,
    votesFor: chain.forVotes,
    votesAgainst: chain.againstVotes,
    totalVotingPower: 0,
    status: CHAIN_PROPOSAL_STATUS[chain.statusCode] ?? 'ACTIVE',
    recipientAddress: chain.recipient === ZERO_ADDRESS ? undefined : chain.recipient,
    amountWei: chain.amountWei === '0' ? undefined : chain.amountWei,
  };
}

/** 链上提案 → 本地项目。只有承载了项目元数据的上架提案才会被还原成项目卡片。 */
function campaignFromChainProposal(chain: ChainProposal): Campaign | null {
  if (chain.typeCode !== 1) return null;
  const meta = parseCampaignMetadata(chain.description);
  if (!meta) return null;

  // 提案没执行前项目处于「待审批」，执行后才真正上线
  const status: Campaign['status'] = chain.statusCode === 3
    ? 'ACTIVE'
    : chain.statusCode === 2
      ? 'REJECTED'
      : 'PENDING';

  // 链上 metadataURI 里的 cover 可能是图片路径，也可能是早期版本写下的渐变类名
  const cover = meta.cover || '';
  const coverIsPhoto = /^(https?:)?\/\//.test(cover) || cover.startsWith('/');

  return {
    id: campaignIdFromKey(chain.targetIdHex),
    name: meta.name,
    description: meta.description,
    coverImage: coverIsPhoto ? cover : '',
    coverGradient: coverIsPhoto || !cover ? 'from-gold/30 via-emerald-500/20 to-blue-500/25' : cover,
    targetAmount: ethToWei(meta.targetEth || 0),
    raisedAmount: ethToWei(0),
    recipientAddress: meta.recipient,
    multiSigAddress: addresses[32],
    status,
    creatorAddress: chain.proposer,
    createTimestamp: meta.createdAt || chain.startTime,
    proposalId: `chain-${chain.proposalId}`,
    onchainId: chain.targetIdHex,
  };
}

/** 种子项目在链上对应的 bytes32 标识 → 本地项目 ID */
const campaignKeyMap = new Map(initialCampaigns.map((campaign) => [toBytes32(campaign.id).toLowerCase(), campaign.id]));

const roleProfiles: Record<UserRole, RoleProfile> = {
  DONOR: {
    role: 'DONOR',
    label: '捐赠者',
    address: addresses[25],
    description: '发起捐款并追踪善款流向。',
    permissions: {
      canDonate: true,
      canCreateCampaign: false,
      canCreateProposal: false,
      canVote: false,
      canExecuteProposal: false,
      canViewAuditProofs: false,
    },
  },
  PROJECT_OWNER: {
    role: 'PROJECT_OWNER',
    label: '项目方',
    address: addresses[18],
    description: '提交公益项目与资金使用材料。',
    permissions: {
      canDonate: false,
      canCreateCampaign: true,
      canCreateProposal: false,
      canVote: false,
      canExecuteProposal: false,
      canViewAuditProofs: false,
    },
  },
  DAO_MEMBER: {
    role: 'DAO_MEMBER',
    label: 'DAO成员',
    address: addresses[0],
    description: '参与治理投票、创建和执行提案。',
    permissions: {
      canDonate: true,
      canCreateCampaign: true,
      canCreateProposal: true,
      canVote: true,
      canExecuteProposal: true,
      canViewAuditProofs: true,
    },
  },
  AUDITOR: {
    role: 'AUDITOR',
    label: '审计员',
    address: addresses[22],
    description: '查看审计明细、交易哈希和 Merkle Proof。',
    permissions: {
      canDonate: false,
      canCreateCampaign: false,
      canCreateProposal: false,
      canVote: false,
      canExecuteProposal: false,
      canViewAuditProofs: true,
    },
  },
};

interface AppState {
  campaigns: Campaign[];
  donations: Donation[];
  proposals: Proposal[];
  auditLogs: AuditLog[];
  members: typeof members;
  totalPoolAmount: string;
  connectedWallet: string;
  currentRole: UserRole;
  roleProfiles: Record<UserRole, RoleProfile>;
  permissions: RolePermission;
  toasts: ToastMessage[];
  walletConnected: boolean;
  walletChainId: number | null;
  /** 钱包对本站点授权的账户数：少于演示账户总数时，切到未授权账户前端感知不到 */
  authorizedAccountCount: number;
  /** 链上审计台账：四个窗口共享的同一份不可篡改记录，只读 */
  onchainRecords: ChainAuditRecord[];
}

type Action =
  | { type: 'ADD_TOAST'; payload: ToastMessage }
  | { type: 'REMOVE_TOAST'; payload: string }
  | { type: 'COPY_TOAST'; payload: string }
  | { type: 'SWITCH_ROLE'; payload: UserRole }
  | { type: 'DONATE_CONFIRMED'; payload: { donation: Donation; auditLog: AuditLog } }
  | { type: 'CREATE_CAMPAIGN_CONFIRMED'; payload: { campaign: Campaign; proposal: Proposal } }
  | { type: 'CAST_VOTE_CONFIRMED'; payload: { proposalId: string; support: boolean; power: number; votesFor?: number; votesAgainst?: number } }
  | { type: 'CREATE_PROPOSAL_CONFIRMED'; payload: Proposal }
  | {
      type: 'SYNC_ONCHAIN';
      payload: {
        proposals: Proposal[];
        campaigns: Campaign[];
        records?: ChainAuditRecord[];
        /** 按链上项目标识索引的账面快照，用于覆盖本地种子项目的募集额与冻结状态 */
        balances?: Record<string, { raised: string; frozen: boolean }>;
      };
    }
  | { type: 'SYNC_ONCHAIN_PROPOSALS'; payload: Proposal[] }
  | { type: 'EXECUTE_PROPOSAL_CONFIRMED'; payload: { proposalId: string; txHash: string; blockNumber?: number } }
  | { type: 'CAMPAIGN_FROZEN'; payload: { campaignId: string } }
  | { type: 'TICK_PROPOSALS' }
  | { type: 'WALLET_CONNECTED'; payload: { address: string; chainId: number } }
  | { type: 'WALLET_DISCONNECTED' }
  | { type: 'WALLET_CHAIN_CHANGED'; payload: number }
  | { type: 'WALLET_ACCOUNTS_SYNCED'; payload: number };

const initialRole: UserRole = 'DAO_MEMBER';

const initialState: AppState = {
  campaigns: initialCampaigns,
  donations: initialDonations,
  proposals: initialProposals,
  auditLogs: initialAuditLogs,
  members,
  totalPoolAmount: initialDonations.reduce((sum, donation) => addWei(sum, donation.amount), '0'),
  connectedWallet: roleProfiles[initialRole].address,
  currentRole: initialRole,
  roleProfiles,
  permissions: roleProfiles[initialRole].permissions,
  toasts: [],
  walletConnected: false,
  walletChainId: null,
  authorizedAccountCount: 0,
  onchainRecords: [],
};

function updateProposalLifecycle(state: AppState): AppState {
  const proposals = state.proposals.map((proposal) => {
    if (proposal.status !== 'ACTIVE' || proposal.endTime > Date.now()) return proposal;
    // 与合约 _tally 保持一致的判定：投票期结束后，赞成票多于反对票即通过（演示环境法定人数为 0）
    const nextStatus: ProposalStatus = proposal.votesFor > proposal.votesAgainst ? 'PASSED' : 'REJECTED';
    return { ...proposal, status: nextStatus };
  });

  // 注意：通过 ≠ 上架。提案通过后只是变成「待执行」，项目要等 executeProposal 落链
  // 才转为 ACTIVE（见 EXECUTE_PROPOSAL_CONFIRMED 与 SYNC_ONCHAIN）。
  // 这里如果顺手把项目置为 ACTIVE，就会出现「还没执行就能捐款」的漏洞。
  return { ...state, proposals };
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'ADD_TOAST':
      return { ...state, toasts: [...state.toasts, action.payload] };
    case 'REMOVE_TOAST':
      return { ...state, toasts: state.toasts.filter((toast) => toast.id !== action.payload) };
    case 'COPY_TOAST':
      return {
        ...state,
        toasts: [
          ...state.toasts,
          {
            id: `toast-copy-${Date.now()}`,
            type: 'success',
            title: '已复制',
            description: action.payload,
          },
        ],
      };
    case 'SWITCH_ROLE': {
      const next = state.roleProfiles[action.payload];
      return { ...state, currentRole: action.payload, connectedWallet: state.walletConnected ? state.connectedWallet : next.address, permissions: next.permissions };
    }
    case 'WALLET_CONNECTED': {
      // 钱包账户在演示账户表里登记过，就把界面角色对齐过去：
      // 单窗口演示时只需要在 MetaMask 里切账户，不用再手动切「演示角色」，两者永远不会错位。
      const mappedRole = DEMO_ACCOUNT_ROLES[action.payload.address.toLowerCase()] as UserRole | undefined;
      const nextRole = mappedRole ?? state.currentRole;
      return {
        ...state,
        walletConnected: true,
        connectedWallet: action.payload.address,
        walletChainId: action.payload.chainId,
        currentRole: nextRole,
        permissions: state.roleProfiles[nextRole].permissions,
      };
    }
    case 'WALLET_DISCONNECTED':
      return { ...state, walletConnected: false, walletChainId: null, connectedWallet: state.roleProfiles[state.currentRole].address };
    case 'WALLET_CHAIN_CHANGED':
      return { ...state, walletChainId: action.payload };
    case 'WALLET_ACCOUNTS_SYNCED':
      return { ...state, authorizedAccountCount: action.payload };
    case 'DONATE_CONFIRMED': {
      const { donation, auditLog } = action.payload;
      return {
        ...state,
        donations: [donation, ...state.donations],
        auditLogs: [auditLog, ...state.auditLogs],
        totalPoolAmount: addWei(state.totalPoolAmount, donation.amount),
        campaigns: state.campaigns.map((campaign) => {
          if (campaign.id !== donation.campaignId) return campaign;
          const raisedAmount = addWei(campaign.raisedAmount, donation.amount);
          const funded = BigInt(raisedAmount) >= BigInt(campaign.targetAmount);
          return { ...campaign, raisedAmount, status: funded ? 'FUNDED' : campaign.status };
        }),
      };
    }
    case 'CREATE_CAMPAIGN_CONFIRMED':
      return {
        ...state,
        campaigns: [action.payload.campaign, ...state.campaigns],
        proposals: [action.payload.proposal, ...state.proposals],
      };
    case 'CAST_VOTE_CONFIRMED':
      return {
        ...state,
        proposals: state.proposals.map((proposal) => {
          if (proposal.id !== action.payload.proposalId) return proposal;
          // 链上投票成功后以链上累计票数为准，避免本地权重与合约权重不一致
          if (typeof action.payload.votesFor === 'number' && typeof action.payload.votesAgainst === 'number') {
            return { ...proposal, votesFor: action.payload.votesFor, votesAgainst: action.payload.votesAgainst };
          }
          return {
            ...proposal,
            votesFor: proposal.votesFor + (action.payload.support ? action.payload.power : 0),
            votesAgainst: proposal.votesAgainst + (!action.payload.support ? action.payload.power : 0),
          };
        }),
      };
    case 'SYNC_ONCHAIN': {
      const incoming = action.payload.proposals;
      const chainById = new Map<number, Proposal>();
      incoming.forEach((proposal) => {
        if (typeof proposal.onchainId === 'number') chainById.set(proposal.onchainId, proposal);
      });

      const matched = new Set<number>();
      const merged = state.proposals.map((proposal) => {
        if (typeof proposal.onchainId !== 'number') return proposal;
        const chain = chainById.get(proposal.onchainId);
        if (!chain) return proposal;
        matched.add(proposal.onchainId);
        // 合约只有在执行时才结算状态，本地已判定出的 PASSED/REJECTED 不能被链上的 ACTIVE 覆盖
        const status = chain.status === 'ACTIVE' && proposal.status !== 'ACTIVE' ? proposal.status : chain.status;
        return {
          ...proposal,
          votesFor: chain.votesFor,
          votesAgainst: chain.votesAgainst,
          status,
          endTime: chain.endTime + 2000,
          recipientAddress: proposal.recipientAddress ?? chain.recipientAddress,
          amountWei: proposal.amountWei ?? chain.amountWei,
        };
      });

      const added = incoming.filter(
        (proposal) =>
          typeof proposal.onchainId === 'number'
          && !matched.has(proposal.onchainId)
          && !state.proposals.some((item) => item.onchainId === proposal.onchainId),
      );

      // 项目：链上发现的补进本地列表；已存在的跟随链上审批结果推进状态。
      // 这是「一个窗口创建、其余窗口可见」的关键——窗口之间只有合约是共享的。
      const campaigns = [...state.campaigns];

      // 先把链上账面快照盖到本地项目上。种子项目的募集额是迁移脚本写进金库的，
      // 不从这里覆盖的话，界面数字会一直停在写死的那一版，和区块浏览器对不上。
      if (action.payload.balances) {
        const balances = action.payload.balances;
        for (let index = 0; index < campaigns.length; index += 1) {
          const entry = balances[campaignKeyOf(campaigns[index])];
          if (!entry) continue;
          campaigns[index] = { ...campaigns[index], raisedAmount: entry.raised, frozen: entry.frozen };
        }
      }
      action.payload.campaigns.forEach((chainCampaign) => {
        const index = campaigns.findIndex((item) => item.id === chainCampaign.id);
        if (index === -1) {
          // 新项目排在最前，其他窗口一刷新就能看到刚提交的项目
          campaigns.unshift(chainCampaign);
          return;
        }
        // 待审批状态不回压，避免本地刚推进的状态被链上的旧提案状态覆盖
        if (chainCampaign.status === 'PENDING') return;
        campaigns[index] = {
          ...campaigns[index],
          status: chainCampaign.status,
          onchainId: campaigns[index].onchainId ?? chainCampaign.onchainId,
        };
      });

      return {
        ...state,
        proposals: [...added, ...merged],
        campaigns,
        onchainRecords: action.payload.records ?? state.onchainRecords,
      };
    }
    case 'CAMPAIGN_FROZEN':
      return {
        ...state,
        campaigns: state.campaigns.map((campaign) =>
          campaign.id === action.payload.campaignId ? { ...campaign, frozen: true } : campaign,
        ),
      };
    case 'CREATE_PROPOSAL_CONFIRMED':
      return { ...state, proposals: [action.payload, ...state.proposals] };
    case 'EXECUTE_PROPOSAL_CONFIRMED': {
      const proposal = state.proposals.find((item) => item.id === action.payload.proposalId);
      return {
        ...state,
        proposals: state.proposals.map((item) =>
          item.id === action.payload.proposalId ? { ...item, status: 'EXECUTED', executionTxHash: action.payload.txHash } : item,
        ),
        campaigns: proposal
          ? state.campaigns.map((campaign) => {
              if (campaign.id !== proposal.targetId) return campaign;
              if (proposal.type === 'CAMPAIGN_APPROVAL') return { ...campaign, status: 'ACTIVE' };
              if (proposal.type === 'FUND_RELEASE') return { ...campaign, status: 'COMPLETED' };
              return campaign;
            })
          : state.campaigns,
        auditLogs: [
          {
            id: `audit-exec-${Date.now()}`,
            campaignId: proposal?.targetId && proposal.targetId !== 'global' ? proposal.targetId : '',
            txHash: action.payload.txHash,
            operationType: 'PROPOSAL_EXECUTION',
            fromAddress: state.connectedWallet,
            toAddress: proposal?.targetId === 'global' ? addresses[30] : state.campaigns.find((item) => item.id === proposal?.targetId)?.multiSigAddress ?? addresses[30],
            amount: ethToWei(0),
            gasUsed: '82110',
            blockNumber: action.payload.blockNumber ?? block(state.auditLogs.length + 400),
            timestamp: Date.now(),
            merkleRoot: randomHash(`exec-merkle-${Date.now()}`),
            signatureCount: 3,
            status: 'CONFIRMED',
          },
          ...state.auditLogs,
        ],
      };
    }
    case 'TICK_PROPOSALS':
      return updateProposalLifecycle(state);
    default:
      return state;
  }
}

interface AppActions {
  donate: (campaignId: string, amountEth: number, message: string) => Promise<string>;
  createCampaign: (input: {
    name: string;
    description: string;
    targetEth: number;
    recipientAddress: string;
    cover?: string;
    /** 募资开放天数，到期未达目标额则开放退款 */
    fundraisingDays?: number;
    /** 分期期数，决定单期可申请的额度上限 */
    milestoneCount?: number;
  }) => Promise<void>;
  castVote: (proposalId: string, support: boolean) => Promise<void>;
  createProposal: (input: {
    type: ProposalType;
    title: string;
    description: string;
    targetId: string;
    amountEth?: number;
    /** 拨付类提案必须指明用款申请单号与材料哈希 */
    requestId?: number;
    evidenceHash?: string;
  }) => Promise<void>;
  executeProposal: (proposalId: string) => Promise<void>;
  /** 受助方提交用款申请，返回链上申请单号；演示模式返回 null */
  requestFunds: (input: { campaignId: string; amountEth: number; evidenceHash: string }) => Promise<number | null>;
  /** 募资失败后，捐赠人取回本金 */
  refundDonation: (campaignId: string) => Promise<void>;
  /** 审计员冻结项目。只关阀门不动账，解冻须走治理表决 */
  freezeCampaign: (input: { campaignId: string; reason: string }) => Promise<void>;
  switchRole: (role: UserRole) => void;
  settleProposals: () => void;
  notifyCopied: (value: string) => void;
  removeToast: (id: string) => void;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
}

const AppContext = createContext<(AppState & AppActions) | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const location = useLocation();
  const syncRef = useRef<(() => void) | null>(null);
  const lastSyncAt = useRef(0);
  // 同步任务在 effect 闭包里跑，拿不到最新 state，用 ref 兜住
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const timer = window.setInterval(() => dispatch({ type: 'TICK_PROPOSALS' }), 1000);
    return () => window.clearInterval(timer);
  }, []);

  /**
   * 链上状态水合。
   *
   * 分屏演示时每个浏览器窗口各是一份独立的前端状态，只有合约是共同事实来源。
   * 所以定时把「提案 + 项目 + 审计台账」整体拉回来合并：
   * 项目方在 A 窗口提交的项目、捐赠者在 B 窗口捐的款、DAO 在 C 窗口投的票，
   * 在 D 窗口都能看到一致的结果。
   */
  useEffect(() => {
    if (!IS_ONCHAIN) return;
    let cancelled = false;

    const sync = async () => {
      lastSyncAt.current = Date.now();
      try {
        const list = await readAllProposalsOnchain();
        if (cancelled) return;

        const campaigns: Campaign[] = [];
        for (const item of list) {
          const campaign = campaignFromChainProposal(item);
          if (campaign) campaigns.push(campaign);
        }
        const knownCampaignIds = new Set(campaigns.map((campaign) => campaign.id));
        const proposals = list.map((item) => fromChainProposal(item, campaignKeyMap, knownCampaignIds));

        // 已筹金额来自金库分户账，捐款窗口之外的其他窗口也能看到进度推进
        const balances: Record<string, { raised: string; frozen: boolean }> = {};
        const pendingKeys = new Set<string>();
        stateRef.current.campaigns.forEach((item) => pendingKeys.add(campaignKeyOf(item)));

        for (const campaign of campaigns) {
          if (!campaign.onchainId) continue;
          pendingKeys.delete(campaign.onchainId);
          try {
            const account = await readCampaignAccountOnchain(campaign.onchainId);
            campaign.raisedAmount = account.raised;
            campaign.frozen = account.frozen;
          } catch {
            // 单个项目读失败不影响整体同步
          }
        }

        // 本地种子项目不在链上提案列表里，但迁移后它们在金库有独立分户账，
        // 必须单独读一次，否则界面会一直显示写死的旧数字。
        for (const key of pendingKeys) {
          try {
            const account = await readCampaignAccountOnchain(key);
            if (account.registered) balances[key] = { raised: account.raised, frozen: account.frozen };
          } catch {
            // 忽略单个项目的读取失败
          }
        }

        let records: ChainAuditRecord[] | undefined;
        try {
          records = await readAllAuditRecordsOnchain();
        } catch {
          records = undefined; // 读失败时保留上一轮结果，不清空
        }

        if (cancelled) return;
        dispatch({ type: 'SYNC_ONCHAIN', payload: { proposals, campaigns, records, balances } });
      } catch {
        // 公共网关偶发抖动时静默跳过，下一轮自动重试
      }
    };

    void sync();
    syncRef.current = () => void sync();
    const timer = window.setInterval(sync, 10000);
    return () => {
      cancelled = true;
      syncRef.current = null;
      window.clearInterval(timer);
    };
  }, []);

  /**
   * 切换页面时补一次同步。
   *
   * 演示时切窗口、切标签页是最自然的动作，等满 10 秒会显得卡。
   * 加上 2.5 秒节流，避免来回点页面时把公共网关打爆。
   */
  useEffect(() => {
    if (!IS_ONCHAIN) return;
    if (Date.now() - lastSyncAt.current < 2500) return;
    syncRef.current?.();
  }, [location.pathname]);

  /** 钱包状态的最新快照，给轮询用：闭包里的 state 会过期，读它才准 */
  const walletSnapshot = useRef({ address: '', connected: false, role: '' as string, count: 0, chainId: null as number | null });
  useEffect(() => {
    walletSnapshot.current = {
      address: state.connectedWallet,
      connected: state.walletConnected,
      role: state.currentRole,
      count: state.authorizedAccountCount,
      chainId: state.walletChainId,
    };
  }, [state.connectedWallet, state.walletConnected, state.currentRole, state.authorizedAccountCount, state.walletChainId]);

  useEffect(() => {
    const provider = getEthereum();
    if (!provider?.on) return;

    const syncAccounts = (accounts: string[]) => {
      if (accounts.length !== walletSnapshot.current.count) {
        dispatch({ type: 'WALLET_ACCOUNTS_SYNCED', payload: accounts.length });
      }
      if (!accounts[0]) {
        if (walletSnapshot.current.connected) dispatch({ type: 'WALLET_DISCONNECTED' });
        return;
      }
      const sameAddress = walletSnapshot.current.connected
        && accounts[0].toLowerCase() === walletSnapshot.current.address.toLowerCase();
      const expected = DEMO_ACCOUNT_ROLES[accounts[0].toLowerCase()];
      if (sameAddress && (!expected || expected === walletSnapshot.current.role)) return;
      dispatch({ type: 'WALLET_CONNECTED', payload: { address: accounts[0], chainId: walletSnapshot.current.chainId ?? CHAIN_ID } });
    };

    void provider.request({ method: 'eth_accounts' }).then(async (result) => {
      const accounts = Array.isArray(result) ? result as string[] : [];
      if (!accounts[0]) return;
      const chainId = parseChainId(await provider.request({ method: 'eth_chainId' }));
      dispatch({ type: 'WALLET_ACCOUNTS_SYNCED', payload: accounts.length });
      dispatch({ type: 'WALLET_CONNECTED', payload: { address: accounts[0], chainId } });
    }).catch(() => undefined);

    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? args[0] as string[] : [];
      syncAccounts(accounts);
    };
    const handleChainChanged = (...args: unknown[]) => {
      dispatch({ type: 'WALLET_CHAIN_CHANGED', payload: parseChainId(args[0]) });
    };
    provider.on('accountsChanged', handleAccountsChanged);
    provider.on('chainChanged', handleChainChanged);

    /**
     * 账户轮询兜底。
     *
     * MetaMask 的授权是**按账户**的，不是按站点。只勾了一个账户时，切到没勾的账户，
     * 钱包会认为本站点"未连接"，于是不再广播 accountsChanged —— 页面就永远停在旧账户上。
     * 这里每 2.5 秒自己问一次 eth_accounts，兼着同步"授权了几个账户"。
     */
    const pollAccounts = window.setInterval(async () => {
      try {
        const accounts = await provider.request({ method: 'eth_accounts' }) as string[];
        syncAccounts(Array.isArray(accounts) ? accounts : []);
      } catch {
        // 钱包锁屏、未解锁时会抛错，忽略，下一轮再试
      }
    }, 2500);

    return () => {
      window.clearInterval(pollAccounts);
      provider.removeListener?.('accountsChanged', handleAccountsChanged);
      provider.removeListener?.('chainChanged', handleChainChanged);
    };
  }, [state.walletChainId]);

  const addToast = (toast: Omit<ToastMessage, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    dispatch({ type: 'ADD_TOAST', payload: { id, ...toast } });
    window.setTimeout(() => dispatch({ type: 'REMOVE_TOAST', payload: id }), 4200);
  };

  const rejectByRole = (title: string) => {
    addToast({ type: 'error', title, description: `当前角色：${state.roleProfiles[state.currentRole].label}` });
  };

  const actions = useMemo<AppActions>(
    () => ({
      donate: async (campaignId, amountEth, message) => {
        if (!state.permissions.canDonate) {
          rejectByRole('当前角色无捐款权限');
          return '';
        }

        const campaign = state.campaigns.find((item) => item.id === campaignId);
        const amount = ethToWei(amountEth);
        let txHash: string;
        let blockNumber: number;

        if (IS_ONCHAIN) {
          try {
            addToast({ type: 'info', title: '请在钱包中确认捐款交易', description: '交易已提交，等待 Sepolia 出块确认…' });
            const receipt = await donateOnchain(campaignKeyOf(campaign ?? { id: campaignId }), amountEth, message);
            txHash = receipt.txHash;
            blockNumber = receipt.blockNumber;
          } catch (error) {
            addToast({ type: 'error', title: '链上捐款失败', description: errorMessage(error) });
            return '';
          }
        } else {
          await delay(800);
          txHash = randomHash(`donate-${campaignId}-${Date.now()}`);
          blockNumber = block(state.donations.length + 600);
        }

        const donation: Donation = {
          id: `don-${Date.now()}`,
          txHash,
          campaignId,
          donorAddress: state.connectedWallet,
          amount,
          message,
          timestamp: Date.now(),
          blockNumber,
        };
        const auditLog: AuditLog = {
          id: `audit-don-${Date.now()}`,
          campaignId,
          txHash,
          operationType: 'DEPOSIT',
          fromAddress: state.connectedWallet,
          toAddress: campaign?.multiSigAddress ?? addresses[31],
          amount,
          gasUsed: '64520',
          blockNumber,
          timestamp: donation.timestamp,
          merkleRoot: randomHash(`merkle-don-${txHash}`),
          signatureCount: 2,
          status: 'CONFIRMED',
        };

        dispatch({ type: 'DONATE_CONFIRMED', payload: { donation, auditLog } });
        addToast({ type: 'success', title: '捐款交易成功', description: `txHash: ${shortHash(txHash)}` });
        return txHash;
      },

      createCampaign: async (input) => {
        if (!state.permissions.canCreateCampaign) {
          rejectByRole('当前角色无项目上架权限');
          return;
        }

        // 项目 ID 由链上 campaignId 派生，四个窗口算出来是同一个，提案的 targetId 才指得回项目
        let id = `camp-${Date.now()}`;
        const proposalId = `prop-${Date.now()}`;
        // 封面上链：没选就随机挑一张内置实拍图，避免列表里出现纯色块
        const coverImage = input.cover || coverLibrary[Math.floor(Math.random() * coverLibrary.length)];
        let onchainId: string | undefined;
        let proposalOnchainId: number | undefined;
        let startTime = Date.now();
        // 未上链时退回 48 小时占位；真实链模式下用链上投票期覆盖
        let endTime = Date.now() + 48 * 60 * 60 * 1000;

        if (IS_ONCHAIN) {
          try {
            addToast({ type: 'info', title: '请在钱包中确认上架交易', description: '将生成一条 DAO 审批提案…' });
            const result = await createCampaignOnchain({
              name: input.name,
              description: input.description,
              targetEth: input.targetEth,
              recipientAddress: input.recipientAddress,
              cover: coverImage,
              fundraisingDays: input.fundraisingDays ?? 30,
              milestoneCount: input.milestoneCount ?? 3,
            });
            onchainId = result.campaignIdHex;
            proposalOnchainId = result.proposalId;
            id = campaignIdFromKey(result.campaignIdHex);

            const chainProposal = await readProposalOnchain(result.proposalId);
            startTime = chainProposal.startTime;
            endTime = chainProposal.endTime + 2000;
          } catch (error) {
            addToast({ type: 'error', title: '链上提案提交失败', description: errorMessage(error) });
            return;
          }
        } else {
          await delay(800);
        }

        const campaign: Campaign = {
          id,
          name: input.name,
          description: input.description,
          coverImage,
          coverGradient: 'from-gold/30 via-emerald-500/20 to-blue-500/25',
          targetAmount: ethToWei(input.targetEth),
          raisedAmount: ethToWei(0),
          recipientAddress: input.recipientAddress,
          multiSigAddress: addresses[32],
          status: 'PENDING',
          creatorAddress: state.connectedWallet,
          createTimestamp: Date.now(),
          proposalId,
          onchainId,
        };
        const proposal: Proposal = {
          id: proposalId,
          title: `批准项目上架：${input.name}`,
          description: input.description,
          type: 'CAMPAIGN_APPROVAL',
          proposerAddress: state.connectedWallet,
          targetId: id,
          startTime,
          endTime,
          votesFor: 0,
          votesAgainst: 0,
          totalVotingPower: state.members.reduce((sum, member) => sum + member.votingPower, 0),
          status: 'ACTIVE',
          onchainId: proposalOnchainId,
        };

        dispatch({ type: 'CREATE_CAMPAIGN_CONFIRMED', payload: { campaign, proposal } });
        addToast({ type: 'success', title: '项目已提交，等待DAO投票' });
      },

      castVote: async (proposalId, support) => {
        if (!state.permissions.canVote) {
          rejectByRole('当前角色无DAO投票权限');
          return;
        }

        const proposal = state.proposals.find((item) => item.id === proposalId);
        const hasOnchainId = typeof proposal?.onchainId === 'number';

        if (IS_ONCHAIN && !hasOnchainId) {
          addToast({ type: 'error', title: '示例提案无法投票', description: '这些是未上链的展示数据，请先创建一条真实提案。' });
          return;
        }

        let power = state.members.find((member) => member.address === state.connectedWallet)?.votingPower ?? 1;
        let votesFor: number | undefined;
        let votesAgainst: number | undefined;

        if (IS_ONCHAIN && proposal && hasOnchainId) {
          try {
            addToast({ type: 'info', title: '请在钱包中确认投票交易', description: '投票上链中…' });
            const result = await castVoteOnchain(proposal.onchainId as number, support);
            if (result.votingPower > 0) power = result.votingPower;
            // 票数以链上累计值为准：合约里每个账户的治理权重是 100，和本地演示权重不同
            const chainProposal = await readProposalOnchain(proposal.onchainId as number);
            votesFor = chainProposal.forVotes;
            votesAgainst = chainProposal.againstVotes;
          } catch (error) {
            addToast({ type: 'error', title: '链上投票失败', description: errorMessage(error) });
            return;
          }
        } else {
          await delay(800);
        }

        dispatch({ type: 'CAST_VOTE_CONFIRMED', payload: { proposalId, support, power, votesFor, votesAgainst } });
        addToast({
          type: 'success',
          title: support ? '已投赞成票' : '已投反对票',
          description: typeof votesFor === 'number' && typeof votesAgainst === 'number' ? `链上票数 赞成 ${votesFor} / 反对 ${votesAgainst}` : undefined,
        });
      },

      createProposal: async (input) => {
        if (!state.permissions.canCreateProposal) {
          rejectByRole('当前角色无创建提案权限');
          return;
        }

        const isFundRelease = input.type === 'FUND_RELEASE';
        const campaign = state.campaigns.find((item) => item.id === input.targetId);
        let amountWei: string | undefined;
        let recipientAddress: string | undefined;

        // 拨款类提案只需金额。收款方不由提案人指定——链上由金库从立项记录读回，
        // 本地展示用的地址也取自项目的受助方，界面上没有可以改它的入口。
        if (isFundRelease) {
          if (!campaign) {
            addToast({ type: 'error', title: '请选择要拨付的项目', description: '拨款提案必须关联一个具体项目。' });
            return;
          }
          // 拨款不能凭空发起：必须先有受助方提交的用款申请单，且材料哈希与之匹配
          if (input.requestId === undefined || !input.evidenceHash) {
            addToast({
              type: 'error',
              title: '缺少用款申请单',
              description: '拨付提案只能由受助方已提交的用款申请发起，请先在项目详情页提交申请。',
            });
            return;
          }
          if (!input.amountEth || input.amountEth <= 0) {
            addToast({ type: 'error', title: '拨付金额不合法', description: '请输入大于 0 的拨付金额。' });
            return;
          }
          amountWei = ethToWei(input.amountEth);
          recipientAddress = campaign.recipientAddress;
        }

        let onchainId: number | undefined;
        let startTime = Date.now();
        // 未上链时退回 48 小时占位；真实链模式下会用合约返回的投票时间覆盖
        let endTime = Date.now() + 48 * 60 * 60 * 1000;

        if (IS_ONCHAIN) {
          try {
            addToast({ type: 'info', title: '请在钱包中确认提案交易', description: '提案创建中…' });

            if (isFundRelease && campaign) {
              // 金额与收款方都不再传给合约：合约从申请单读金额、从立项记录读收款方，
              // 这里传的材料哈希会与链上锚定的值做比对，不一致直接回滚。
              const result = await createFundReleaseProposalOnchain({
                requestId: input.requestId as number,
                evidenceHash: input.evidenceHash as string,
                title: input.title,
              });
              onchainId = result.proposalId;
            } else {
              const result = await createProposalOnchain({
                typeCode: { FUND_RELEASE: 0, CAMPAIGN_APPROVAL: 1, AUDIT_RULE_CHANGE: 2 }[input.type],
                targetKey: input.targetId,
                title: input.title,
                description: input.description,
              });
              onchainId = result.proposalId;
            }

            // 投票起止时间以链上为准，倒计时才不会和合约判定打架
            if (typeof onchainId === 'number') {
              const chainProposal = await readProposalOnchain(onchainId);
              startTime = chainProposal.startTime;
              // 本地比链上晚 2 秒结束，避免本地显示「已通过」时合约还判 voting ongoing
              endTime = chainProposal.endTime + 2000;
            }
          } catch (error) {
            addToast({ type: 'error', title: '链上提案创建失败', description: errorMessage(error) });
            return;
          }
        } else {
          await delay(800);
        }

        const proposal: Proposal = {
          id: `prop-${Date.now()}`,
          title: input.title,
          description: input.description,
          type: input.type,
          proposerAddress: state.connectedWallet,
          targetId: input.targetId,
          startTime,
          endTime,
          votesFor: 0,
          votesAgainst: 0,
          totalVotingPower: state.members.reduce((sum, member) => sum + member.votingPower, 0),
          status: 'ACTIVE',
          onchainId,
          amountWei,
          recipientAddress,
          requestId: input.requestId,
        };

        dispatch({ type: 'CREATE_PROPOSAL_CONFIRMED', payload: proposal });
        addToast({
          type: 'success',
          title: '提案已创建',
          description: typeof onchainId === 'number' ? `链上提案编号 #${onchainId}，投票期至 ${new Date(endTime).toLocaleTimeString()}` : undefined,
        });
      },

      executeProposal: async (proposalId) => {
        if (!state.permissions.canExecuteProposal) {
          rejectByRole('当前角色无执行提案权限');
          return;
        }

        const proposal = state.proposals.find((item) => item.id === proposalId);

        if (IS_ONCHAIN && typeof proposal?.onchainId !== 'number') {
          addToast({ type: 'error', title: '示例提案无法执行', description: '这些是未上链的展示数据，请先创建一条真实提案走完投票流程。' });
          return;
        }

        let txHash: string;
        let blockNumber: number | undefined;

        if (IS_ONCHAIN && typeof proposal?.onchainId === 'number') {
          try {
            addToast({ type: 'info', title: '请在钱包中确认执行交易', description: '提案执行中…' });
            const result = await executeProposalOnchain(proposal.onchainId);
            txHash = result.txHash;
            blockNumber = result.blockNumber;
          } catch (error) {
            addToast({ type: 'error', title: '链上执行失败', description: errorMessage(error) });
            return;
          }
        } else {
          await delay(800);
          txHash = randomHash(`execute-${proposalId}-${Date.now()}`);
        }

        dispatch({ type: 'EXECUTE_PROPOSAL_CONFIRMED', payload: { proposalId, txHash, blockNumber } });
        addToast({
          type: 'success',
          title: proposal?.type === 'FUND_RELEASE' ? '拨款已执行' : '提案已执行',
          description: proposal?.type === 'FUND_RELEASE' && proposal.amountWei
            ? `${formatEth(proposal.amountWei, 6)} 已由金库转给收款方，txHash: ${shortHash(txHash)}`
            : `txHash: ${shortHash(txHash)}`,
        });
      },

      requestFunds: async (input) => {
        const campaign = state.campaigns.find((item) => item.id === input.campaignId);
        if (!campaign) {
          addToast({ type: 'error', title: '项目不存在', description: '请刷新页面后重试。' });
          return null;
        }
        if (input.amountEth <= 0) {
          addToast({ type: 'error', title: '申请金额不合法', description: '请输入大于 0 的申请金额。' });
          return null;
        }
        if (!input.evidenceHash) {
          addToast({ type: 'error', title: '缺少材料', description: '用款申请必须附上发票或验收材料。' });
          return null;
        }

        if (!IS_ONCHAIN) {
          await delay(600);
          addToast({
            type: 'success',
            title: '用款申请已提交（演示）',
            description: '演示模式下不上链，真实链模式下材料哈希会写入审计台账。',
          });
          return null;
        }

        try {
          addToast({ type: 'info', title: '请在钱包中确认用款申请', description: '材料哈希将写入链上审计台账…' });
          const result = await requestFundsOnchain({
            campaignKeyHex: campaignKeyOf(campaign),
            amountEth: input.amountEth,
            evidenceHash: input.evidenceHash,
          });
          addToast({
            type: 'success',
            title: `用款申请 #${result.requestId} 已上链`,
            description: `材料哈希 ${shortHash(input.evidenceHash)} 已锚定，等待理事会表决。`,
          });
          return result.requestId;
        } catch (error) {
          addToast({ type: 'error', title: '用款申请提交失败', description: errorMessage(error) });
          return null;
        }
      },

      refundDonation: async (campaignId) => {
        const campaign = state.campaigns.find((item) => item.id === campaignId);
        if (!campaign) {
          addToast({ type: 'error', title: '项目不存在', description: '请刷新页面后重试。' });
          return;
        }

        if (!IS_ONCHAIN) {
          await delay(600);
          addToast({ type: 'success', title: '退款已受理（演示）', description: '演示模式下不发起真实转账。' });
          return;
        }

        try {
          addToast({ type: 'info', title: '请在钱包中确认退款交易', description: '本金将原路退回你的钱包地址…' });
          const result = await refundDonationOnchain(campaignKeyOf(campaign));
          addToast({
            type: 'success',
            title: '本金已退回',
            description: `txHash: ${shortHash(result.txHash)}`,
          });
        } catch (error) {
          addToast({ type: 'error', title: '退款失败', description: errorMessage(error) });
        }
      },

      freezeCampaign: async (input) => {
        const campaign = state.campaigns.find((item) => item.id === input.campaignId);
        if (!campaign) {
          addToast({ type: 'error', title: '项目不存在', description: '请刷新页面后重试。' });
          return;
        }
        const reason = input.reason.trim();
        if (!reason) {
          addToast({ type: 'error', title: '请填写冻结理由', description: '理由摘要会写进链路，事后可追溯。' });
          return;
        }

        if (!IS_ONCHAIN) {
          await delay(600);
          dispatch({ type: 'CAMPAIGN_FROZEN', payload: { campaignId: campaign.id } });
          addToast({ type: 'success', title: '项目已冻结（演示）', description: '演示模式下只改界面状态。' });
          return;
        }

        try {
          addToast({ type: 'info', title: '请在钱包中确认冻结', description: '冻结后该项目的捐款、申请、拨付、退款全部关闭。' });
          const reasonHash = await hashText(reason);
          const result = await freezeCampaignOnchain(campaignKeyOf(campaign), reasonHash);
          dispatch({ type: 'CAMPAIGN_FROZEN', payload: { campaignId: campaign.id } });
          addToast({
            type: 'success',
            title: '项目已冻结',
            description: `理由摘要 ${shortHash(reasonHash)} 已上链，解冻须由理事会表决。`,
          });
          void result;
        } catch (error) {
          addToast({ type: 'error', title: '冻结失败', description: errorMessage(error) });
        }
      },

      switchRole: (role) => {
        dispatch({ type: 'SWITCH_ROLE', payload: role });
        addToast({ type: 'info', title: `已切换为${state.roleProfiles[role].label}`, description: state.roleProfiles[role].description });
      },
      settleProposals: () => dispatch({ type: 'TICK_PROPOSALS' }),
      notifyCopied: (value) => {
        addToast({ type: 'success', title: '已复制', description: value });
      },
      removeToast: (id) => dispatch({ type: 'REMOVE_TOAST', payload: id }),
      connectWallet: async () => {
        const provider = getEthereum();
        if (!provider) {
          addToast({ type: 'error', title: '未检测到 MetaMask', description: '请先安装 MetaMask 扩展后重试。' });
          return;
        }
        try {
          // 先走一次权限请求，让钱包弹出「选择账户」；已连接时它会直接返回当前授权集合
          try {
            await provider.request({
              method: 'wallet_requestPermissions',
              params: [{ eth_accounts: {} }],
            });
          } catch {
            // 旧版本钱包不支持该方法，忽略，继续走 eth_requestAccounts
          }
          const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
          if (!accounts?.[0]) return;
          const chainId = parseChainId(await provider.request({ method: 'eth_chainId' }));
          if (chainId !== CHAIN_ID) {
            await switchToChain(provider);
          }
          dispatch({ type: 'WALLET_ACCOUNTS_SYNCED', payload: accounts.length });
          dispatch({ type: 'WALLET_CONNECTED', payload: { address: accounts[0], chainId: CHAIN_ID } });

          if (accounts.length === 1) {
            addToast({
              type: 'info',
              title: '只授权了 1 个账户',
              description: '切换其他账户时页面收不到通知。请在 MetaMask 里点站点旁的「连接」→「选择账户」，把演示账户全部勾选。',
            });
            return;
          }
          addToast({ type: 'success', title: 'MetaMask 已连接', description: `${CHAIN_NAME} 测试网 (${CHAIN_ID})` });
        } catch (error) {
          addToast({ type: 'error', title: 'MetaMask 连接失败', description: errorMessage(error) });
        }
      },
      disconnectWallet: () => {
        dispatch({ type: 'WALLET_DISCONNECTED' });
        addToast({ type: 'info', title: '已断开本页连接' });
      },
    }),
    [state],
  );

  return <AppContext.Provider value={{ ...state, ...actions }}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
