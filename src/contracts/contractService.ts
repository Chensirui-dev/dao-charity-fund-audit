import type { ProposalType } from '../types';
import { CONTRACT_ABI } from './abis';
import { CHAIN_ID, CHAIN_NAME, CONTRACT_ADDRESSES, CONTRACTS_READY, EXPLORER_URL, IS_ONCHAIN } from './config';

export { CONTRACT_ABI, CONTRACT_ADDRESSES, CONTRACTS_READY, CHAIN_ID, CHAIN_NAME, EXPLORER_URL, IS_ONCHAIN };

/** 合约地址在界面上展示时的兜底文案 */
export const UNCONFIGURED_ADDRESS = '未部署（当前为模拟模式）';

export interface ContractCallPlan {
  contract: keyof typeof CONTRACT_ADDRESSES;
  address: string;
  method: string;
  listens: string[];
  description: string;
}

export const CONTRACT_CALL_PLANS: ContractCallPlan[] = [
  {
    contract: 'donationVault',
    address: CONTRACT_ADDRESSES.donationVault,
    method: 'donate(campaignId, message)',
    listens: ['DonationReceived', 'AuditLogAppended'],
    description: '捐赠者签名后将 ETH 打入公益金库，并同步写入审计日志。',
  },
  {
    contract: 'daoGovernor',
    address: CONTRACT_ADDRESSES.daoGovernor,
    method: 'proposeCampaign(name, metadataURI, targetAmount, recipient)',
    listens: ['CampaignProposed', 'ProposalCreated'],
    description: '项目方提交上架申请，自动生成 DAO 审批提案。',
  },
  {
    contract: 'daoGovernor',
    address: CONTRACT_ADDRESSES.daoGovernor,
    method: 'castVote(proposalId, support)',
    listens: ['VoteCast'],
    description: 'DAO 成员根据治理权重投票，票数实时影响提案状态机。',
  },
  {
    contract: 'daoGovernor',
    address: CONTRACT_ADDRESSES.daoGovernor,
    method: 'executeProposal(proposalId)',
    listens: ['ProposalExecuted', 'FundsReleased', 'AuditLogAppended'],
    description: '提案通过后执行链上拨付或项目激活，并形成不可篡改审计记录。',
  },
];

export function proposalTypeToContractCode(type: ProposalType): number {
  const mapping: Record<ProposalType, number> = {
    FUND_RELEASE: 0,
    CAMPAIGN_APPROVAL: 1,
    AUDIT_RULE_CHANGE: 2,
  };
  return mapping[type];
}
