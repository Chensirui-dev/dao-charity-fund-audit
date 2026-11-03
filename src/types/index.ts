export type CampaignStatus = 'PENDING' | 'ACTIVE' | 'FUNDED' | 'COMPLETED' | 'REJECTED';
export type ProposalType = 'FUND_RELEASE' | 'CAMPAIGN_APPROVAL' | 'AUDIT_RULE_CHANGE';
export type ProposalStatus = 'ACTIVE' | 'PASSED' | 'REJECTED' | 'EXECUTED';
export type OperationType = 'DEPOSIT' | 'WITHDRAWAL' | 'GAS_FEE' | 'REFUND' | 'PROPOSAL_EXECUTION' | 'EVIDENCE' | 'FREEZE';
export type AuditStatus = 'PENDING' | 'CONFIRMED' | 'FLAGGED';
export type UserRole = 'DONOR' | 'PROJECT_OWNER' | 'DAO_MEMBER' | 'AUDITOR';

export interface RolePermission {
  canDonate: boolean;
  canCreateCampaign: boolean;
  canCreateProposal: boolean;
  canVote: boolean;
  canExecuteProposal: boolean;
  canViewAuditProofs: boolean;
}

export interface RoleProfile {
  role: UserRole;
  label: string;
  address: string;
  description: string;
  permissions: RolePermission;
}

export interface Campaign {
  id: string;
  name: string;
  description: string;
  /** 封面：实拍图路径（/covers/x.jpg），旧数据或链上老记录可能是渐变类名 */
  coverImage: string;
  /** 封面图缺失或加载失败时的兜底渐变 */
  coverGradient?: string;
  targetAmount: string;
  raisedAmount: string;
  recipientAddress: string;
  multiSigAddress: string;
  status: CampaignStatus;
  creatorAddress: string;
  createTimestamp: number;
  proposalId?: string;
  /** 链上 bytes32 项目标识，真实交易时由 CampaignProposed 事件返回 */
  onchainId?: string;
  /** 审计员冻结标记。冻结后捐款/申请/拨付/退款全部关闭，解冻须经治理表决 */
  frozen?: boolean;
}

export interface Donation {
  id: string;
  txHash: string;
  campaignId: string;
  donorAddress: string;
  amount: string;
  message: string;
  timestamp: number;
  blockNumber: number;
}

export interface Proposal {
  id: string;
  title: string;
  description: string;
  type: ProposalType;
  proposerAddress: string;
  targetId: string;
  startTime: number;
  endTime: number;
  votesFor: number;
  votesAgainst: number;
  totalVotingPower: number;
  status: ProposalStatus;
  executionTxHash?: string;
  /** 链上提案编号（uint256），真实交易时由 ProposalCreated 事件返回 */
  onchainId?: number;
  /** 拨款收款地址（链上 recipient），仅资金拨付类提案有值 */
  recipientAddress?: string;
  /** 拨款金额（wei 十进制字符串，链上 uint256 amount） */
  amountWei?: string;
  /** 拨付类提案对应的用款申请单号；非拨付类为空 */
  requestId?: number;
}

export interface AuditLog {
  id: string;
  /** 该笔流水所属项目（本地项目 ID），审计页据此按项目拆分台账 */
  campaignId: string;
  txHash: string;
  operationType: OperationType;
  fromAddress: string;
  toAddress: string;
  amount: string;
  gasUsed: string;
  blockNumber: number;
  timestamp: number;
  merkleRoot: string;
  signatureCount: number;
  status: AuditStatus;
}

export interface DAOMember {
  address: string;
  votingPower: number;
  joinTimestamp: number;
  totalVotesParticipated: number;
  delegatedTo?: string;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  description?: string;
}
