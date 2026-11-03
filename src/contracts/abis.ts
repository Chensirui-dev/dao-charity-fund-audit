/**
 * 合约 ABI（human-readable 格式，由 ethers v6 解析）。
 * 与 chain/contracts 下的 Solidity 源码保持一一对应。
 */

export const DONATION_VAULT_ABI = [
  'function donate(bytes32 campaignId, string message) payable returns (bytes32 donationId)',
  'function releaseFunds(bytes32 campaignId, uint256 requestId) returns (bool)',
  'function registerCampaign(bytes32 campaignId, address recipient, uint256 targetAmount, uint256 deadline, uint8 milestoneCount)',
  'function requestFunds(bytes32 campaignId, uint256 amount, bytes32 evidenceHash) returns (uint256 requestId)',
  'function cancelRequest(uint256 requestId)',
  'function refund(bytes32 campaignId) returns (uint256 amount)',
  'function setGovernor(address governor_)',
  'function campaignBalance(bytes32 campaignId) view returns (uint256)',
  'function campaignRecipient(bytes32 campaignId) view returns (address)',
  'function milestoneCap(bytes32 campaignId) view returns (uint256)',
  'function contributions(bytes32 campaignId, address donor) view returns (uint256)',
  'function fundRequestCount() view returns (uint256)',
  'function fundRequests(uint256 requestId) view returns (bytes32 campaignId, uint256 amount, bytes32 evidenceHash, address requester, uint256 createdAt, uint8 status)',
  'function campaignAccounts(bytes32 campaignId) view returns (uint256 raised, uint256 released, address recipient, uint256 targetAmount, uint256 deadline, uint8 milestoneCount, uint8 milestonesReleased, bool registered, bool frozen)',
  'function freezeCampaign(bytes32 campaignId, bytes32 reasonHash)',
  'function unfreezeCampaign(bytes32 campaignId)',
  'function isFrozen(bytes32 campaignId) view returns (bool)',
  'function auditor() view returns (address)',
  'function setAuditor(address auditor_)',
  'function totalRaised() view returns (uint256)',
  'function governor() view returns (address)',
  'event CampaignRegistered(bytes32 indexed campaignId, address indexed recipient, uint256 targetAmount, uint256 deadline, uint8 milestoneCount)',
  'event DonationReceived(bytes32 indexed campaignId, address indexed donor, uint256 amount, bytes32 donationId)',
  'event FundRequested(uint256 indexed requestId, bytes32 indexed campaignId, address indexed requester, uint256 amount, bytes32 evidenceHash)',
  'event FundsReleased(uint256 indexed requestId, bytes32 indexed campaignId, address indexed recipient, uint256 amount, uint8 milestone)',
  'event RequestCancelled(uint256 indexed requestId)',
  'event Refunded(bytes32 indexed campaignId, address indexed donor, uint256 amount)',
  'event CampaignFrozen(bytes32 indexed campaignId, address indexed auditor, bytes32 reasonHash)',
  'event CampaignUnfrozen(bytes32 indexed campaignId)',
] as const;

export const DAO_GOVERNOR_ABI = [
  'function proposeCampaign(string name, string metadataURI, uint256 targetAmount, address recipient, uint256 fundraisingDays, uint8 milestoneCount) returns (uint256 proposalId)',
  'function createProposal(uint8 proposalType, bytes32 targetId, string title, string description) returns (uint256 proposalId)',
  'function createFundReleaseProposal(uint256 requestId, bytes32 evidenceHash, string title) returns (uint256 proposalId)',
  'function createVotingPowerProposal(address member, uint256 power, string title) returns (uint256 proposalId)',
  'function castVote(uint256 proposalId, bool support) returns (uint256 votingPower)',
  'function tallyProposal(uint256 proposalId)',
  'function executeProposal(uint256 proposalId) returns (bytes32 executionHash)',
  'function executionDelay(uint256 proposalId) view returns (uint256)',
  'function votingPeriod() view returns (uint256)',
  'function quorumBps() view returns (uint256)',
  'function timelockDuration() view returns (uint256)',
  'function votingPowerSeeded() view returns (bool)',
  'function requestProposed(uint256 requestId) view returns (bool)',
  'function proposalCount() view returns (uint256)',
  'function getProposal(uint256 proposalId) view returns (tuple(uint256 id, uint8 proposalType, bytes32 targetId, string title, string description, address proposer, uint256 forVotes, uint256 againstVotes, uint256 startTime, uint256 endTime, uint8 status, address recipient, uint256 amount, uint256 requestId))',
  'function votingPower(address member) view returns (uint256)',
  'function totalVotingPower() view returns (uint256)',
  'event CampaignProposed(uint256 indexed proposalId, bytes32 indexed campaignId, address indexed proposer)',
  'event ProposalCreated(uint256 indexed proposalId, uint8 proposalType, bytes32 indexed targetId)',
  'event VoteCast(uint256 indexed proposalId, address indexed voter, bool support, uint256 votingPower)',
  'event ProposalExecuted(uint256 indexed proposalId, bytes32 executionHash)',
  'event VotingPowerChanged(address indexed member, uint256 previous, uint256 current)',
  'event ConflictOfInterestBlocked(uint256 indexed proposalId, address indexed voter)',
] as const;

export const AUDIT_REGISTRY_ABI = [
  'function appendAuditLog(bytes32 txHash, uint8 operationType, bytes32 merkleRoot, string metadataURI) returns (bytes32 auditId)',
  'function anchorBatch(bytes32 merkleRoot, uint256 fromIndex, uint256 toIndex) returns (uint256 anchorId)',
  'function verifyProof(bytes32 leaf, bytes32[] proof, bytes32 root) view returns (bool)',
  'function recordCount() view returns (uint256)',
  'function anchorCount() view returns (uint256)',
  'function MAX_BATCH_SIZE() view returns (uint256)',
  'function getAnchor(uint256 anchorId) view returns (tuple(bytes32 merkleRoot, uint256 fromIndex, uint256 toIndex, address anchorer, uint256 timestamp))',
  'function getRecord(uint256 index) view returns (tuple(bytes32 txHash, uint8 operationType, bytes32 merkleRoot, string metadataURI, address reporter, uint256 timestamp))',
  'event AuditLogAppended(bytes32 indexed auditId, bytes32 indexed txHash, bytes32 merkleRoot)',
  'event BatchAnchored(uint256 indexed anchorId, bytes32 merkleRoot, uint256 fromIndex, uint256 toIndex, address indexed anchorer)',
] as const;

/**
 * 合约 ABI 摘要（保留原有对外结构，供架构页展示合约接口）。
 */
export const CONTRACT_ABI = {
  donationVault: DONATION_VAULT_ABI,
  daoGovernor: DAO_GOVERNOR_ABI,
  auditRegistry: AUDIT_REGISTRY_ABI,
} as const;
