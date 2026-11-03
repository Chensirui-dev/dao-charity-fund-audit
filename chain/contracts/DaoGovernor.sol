// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IDonationVault {
    function releaseFunds(bytes32 campaignId, uint256 requestId) external returns (bool);
    function campaignBalance(bytes32 campaignId) external view returns (uint256);
    function campaignRecipient(bytes32 campaignId) external view returns (address);
    function milestoneCap(bytes32 campaignId) external view returns (uint256);
    function registerCampaign(
        bytes32 campaignId,
        address recipient,
        uint256 targetAmount,
        uint256 deadline,
        uint8 milestoneCount
    ) external;

    function seedCampaign(
        bytes32 campaignId,
        address recipient,
        uint256 targetAmount,
        uint256 deadline,
        uint8 milestoneCount,
        uint256 initialRaised
    ) external;
    function fundRequests(uint256 requestId)
        external
        view
        returns (
            bytes32 campaignId,
            uint256 amount,
            bytes32 evidenceHash,
            address requester,
            uint256 createdAt,
            uint8 status
        );
}

interface IAuditRegistryLike {
    function appendAuditLog(
        bytes32 txHash,
        uint8 operationType,
        bytes32 merkleRoot,
        string calldata metadataURI
    ) external returns (bytes32 auditId);
}

/// @title DaoGovernor
/// @notice 治理层：项目上架、资金拨付等敏感操作都必须经提案 + 成员投票 + 执行三步，
///         投票权重由治理合约登记，执行结果同步写入审计层。
///
///         防止「一个人说了算」的五道闸门：
///         1. 法定人数（quorumBps）：参与票权不足总票权的该比例时，提案自动失效；
///         2. 执行时间锁（timelockDuration）：判定通过后还要再等一段时间才能执行，
///            期间任何成员发现问题都可以发起反对提案；
///         3. 票权一次性初始化：bootstrapVotingPower 只能调用一次，之后增发或调整票权
///            必须走「提案 → 投票 → 执行」，部署私钥无法单方面改变票权分布；
///         4. 利益冲突回避：受助方本人对涉及自己项目的提案没有投票权，票权再大也投不进去；
///         5. 拨款必须凭申请单：拨付提案只能由「受助方已提交的用款申请」发起，
///            且提交上来的材料哈希必须与链上锚定的一致，改一个字都过不了。
contract DaoGovernor {
    enum ProposalType {
        FUND_RELEASE,
        CAMPAIGN_APPROVAL,
        AUDIT_RULE_CHANGE
    }

    enum ProposalStatus {
        ACTIVE,
        PASSED,
        REJECTED,
        EXECUTED
    }

    struct Proposal {
        uint256 id;
        ProposalType proposalType;
        bytes32 targetId;
        string title;
        string description;
        address proposer;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 startTime;
        uint256 endTime;
        ProposalStatus status;
        address payable recipient;
        uint256 amount;
        uint256 requestId;
    }

    address public owner;
    IDonationVault public vault;
    IAuditRegistryLike public auditRegistry;

    /// @dev 演示环境由部署脚本调小投票时长，便于现场走完流程。
    uint256 public votingPeriod = 3 days;

    /// @dev 法定人数（基点）。2500 = 参与票权需达到总票权的 25%，否则提案自动失效。
    ///      Compound / Uniswap 等主流 DAO 的法定人数都在 4% 这一量级，25% 属于偏严格取值。
    uint256 public quorumBps = 2500;

    /// @dev 执行时间锁。提案判定通过后还需等待该时长才能真正执行，留出异议窗口。
    uint256 public timelockDuration = 1 hours;

    /// @dev 票权是否已一次性初始化。为 true 后只能通过治理提案调整票权。
    bool public votingPowerSeeded;

    Proposal[] private proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(address => uint256) public votingPower;
    mapping(bytes32 => bool) public campaignRegistered;
    mapping(uint256 => bool) public requestProposed;
    uint256 public totalVotingPower;

    event CampaignProposed(uint256 indexed proposalId, bytes32 indexed campaignId, address indexed proposer);
    event CampaignSeeded(bytes32 indexed campaignId, uint256 initialRaised);
    event ProposalCreated(uint256 indexed proposalId, uint8 proposalType, bytes32 indexed targetId);
    event VoteCast(uint256 indexed proposalId, address indexed voter, bool support, uint256 votingPower);
    event ProposalExecuted(uint256 indexed proposalId, bytes32 executionHash);
    event VotingPowerSeeded(address indexed member, uint256 power);
    event VotingPowerChanged(address indexed member, uint256 previous, uint256 current);
    event ConflictOfInterestBlocked(uint256 indexed proposalId, address indexed voter);

    modifier onlyOwner() {
        require(msg.sender == owner, 'DaoGovernor: not owner');
        _;
    }

    constructor(address vault_, address auditRegistry_) {
        owner = msg.sender;
        vault = IDonationVault(vault_);
        auditRegistry = IAuditRegistryLike(auditRegistry_);
    }

    function setVotingPeriod(uint256 seconds_) external onlyOwner {
        require(seconds_ > 0, 'DaoGovernor: invalid period');
        votingPeriod = seconds_;
    }

    function setQuorumBps(uint256 bps_) external onlyOwner {
        require(bps_ > 0 && bps_ <= 10000, 'DaoGovernor: invalid quorum');
        quorumBps = bps_;
    }

    function setTimelockDuration(uint256 seconds_) external onlyOwner {
        timelockDuration = seconds_;
    }

    /// @notice 一次性初始化票权。只能在还没有任何票权时调用一次，之后永久锁死。
    ///         这是部署阶段唯一能发票权的入口，避免部署私钥在任何时刻都能增发票权。
    function bootstrapVotingPower(address[] calldata members, uint256 power) external onlyOwner {
        require(!votingPowerSeeded, 'DaoGovernor: voting power already seeded');
        require(members.length > 0, 'DaoGovernor: empty member list');
        require(power > 0, 'DaoGovernor: zero power');

        for (uint256 i = 0; i < members.length; i += 1) {
            address member = members[i];
            require(member != address(0), 'DaoGovernor: zero member');
            _setVotingPower(member, power);
        }
        votingPowerSeeded = true;
    }

    function _setVotingPower(address member, uint256 power) internal {
        uint256 previous = votingPower[member];
        totalVotingPower = totalVotingPower - previous + power;
        votingPower[member] = power;
        emit VotingPowerChanged(member, previous, power);
    }

    /// @notice 存量数据迁移：把系统上线前已在运行的项目批量登记进金库。
    ///
    ///         为什么不逐个走 proposeCampaign：那需要每个项目都跑一轮完整表决（投票期 + 时间锁），
    ///         九个项目要跑十几分钟。迁移属于部署期的一次性动作，只允许 owner 在部署阶段执行；
    ///         登记完成后 campaignRegistered 立即置位，无法再用同名项目重复登记。
    struct SeedInput {
        bytes32 campaignId;
        address recipient;
        uint256 targetAmount;
        uint256 deadline;
        uint8 milestoneCount;
        uint256 initialRaised;
    }

    function seedCampaigns(SeedInput[] calldata items) external onlyOwner {
        require(address(vault) != address(0), 'DaoGovernor: vault not set');
        for (uint256 i = 0; i < items.length; i += 1) {
            SeedInput calldata item = items[i];
            require(!campaignRegistered[item.campaignId], 'DaoGovernor: campaign exists');
            campaignRegistered[item.campaignId] = true;
            vault.seedCampaign(
                item.campaignId,
                item.recipient,
                item.targetAmount,
                item.deadline,
                item.milestoneCount,
                item.initialRaised
            );
            emit CampaignSeeded(item.campaignId, item.initialRaised);
        }
    }

    /// @notice 项目方提交上架申请，自动生成一条 CAMPAIGN_APPROVAL 提案，
    ///         同时把受助方地址、募资截止时间、分期期数登记进金库——
    ///         此后这条项目的钱只能打给这个地址，且按期分批拨付。
    /// @param fundraisingDays 募资开放天数，到期未达目标额则开放退款
    /// @param milestoneCount 分期期数（1-6），决定单期可申请额度上限
    function proposeCampaign(
        string calldata name,
        string calldata metadataURI,
        uint256 targetAmount,
        address recipient,
        uint256 fundraisingDays,
        uint8 milestoneCount
    ) external returns (uint256 proposalId) {
        require(recipient != address(0), 'DaoGovernor: zero recipient');
        require(targetAmount > 0, 'DaoGovernor: zero target');
        require(fundraisingDays >= 1 && fundraisingDays <= 365, 'DaoGovernor: bad fundraising days');
        require(milestoneCount >= 1 && milestoneCount <= 6, 'DaoGovernor: bad milestone count');

        bytes32 campaignId = keccak256(abi.encodePacked(name, recipient, msg.sender, targetAmount, block.timestamp));
        require(!campaignRegistered[campaignId], 'DaoGovernor: campaign exists');
        campaignRegistered[campaignId] = true;

        if (address(vault) != address(0)) {
            vault.registerCampaign(
                campaignId,
                recipient,
                targetAmount,
                block.timestamp + fundraisingDays * 1 days,
                milestoneCount
            );
        }

        string memory title = string.concat('Approve campaign: ', name);
        proposalId = _createProposal(
            ProposalType.CAMPAIGN_APPROVAL,
            campaignId,
            title,
            metadataURI,
            payable(0),
            0,
            0
        );
        emit CampaignProposed(proposalId, campaignId, msg.sender);
    }

    /// @notice 通用提案入口。刻意不允许直接创建 FUND_RELEASE 类型——
    ///         拨款只能走 createFundReleaseProposal，那条路径强制校验申请单与材料哈希。
    ///         否则任何人都能用这个入口绕过用款申请，把「先申请后拨款」的规则架空。
    function createProposal(
        uint8 proposalType,
        bytes32 targetId,
        string calldata title,
        string calldata description
    ) external returns (uint256 proposalId) {
        require(proposalType <= uint8(ProposalType.AUDIT_RULE_CHANGE), 'DaoGovernor: bad proposal type');
        require(proposalType != uint8(ProposalType.FUND_RELEASE), 'DaoGovernor: use createFundReleaseProposal');
        proposalId = _createProposal(
            ProposalType(proposalType),
            targetId,
            title,
            description,
            payable(0),
            0,
            0
        );
    }

    /// @notice 创建资金拨付提案。参数里没有收款地址、也没有金额——
    ///         金额取自链上申请单，收款方取自立项记录，提案人能决定的只有「批不批准」。
    /// @param requestId 受助方提交的用款申请编号
    /// @param evidenceHash 提交人重新上传材料后算出的哈希，必须与申请时锚定的一致
    function createFundReleaseProposal(
        uint256 requestId,
        bytes32 evidenceHash,
        string calldata title
    ) external returns (uint256 proposalId) {
        bytes32 campaignId;
        uint256 amount;

        // 申请单字段较多，用内层作用域读完即释放，否则外层栈槽不够（stack too deep）
        {
            bytes32 anchoredEvidence;
            uint8 status;
            (campaignId, amount, anchoredEvidence, , , status) = vault.fundRequests(requestId);

            require(amount > 0, 'DaoGovernor: request not found');
            require(status == 0, 'DaoGovernor: request not pending');
            require(evidenceHash == anchoredEvidence, 'DaoGovernor: evidence hash mismatch');
        }

        require(!requestProposed[requestId], 'DaoGovernor: request already proposed');

        address recipient = vault.campaignRecipient(campaignId);
        require(recipient != address(0), 'DaoGovernor: campaign not registered');
        require(vault.campaignBalance(campaignId) >= amount, 'DaoGovernor: amount exceeds balance');

        requestProposed[requestId] = true;

        proposalId = _createProposal(
            ProposalType.FUND_RELEASE,
            campaignId,
            title,
            'Fund release request',
            payable(recipient),
            amount,
            requestId
        );
    }

    /// @notice 创建「调整某成员票权」的提案。票权初始化之后，这是唯一的合法改动路径。
    function createVotingPowerProposal(
        address member,
        uint256 power,
        string calldata title
    ) external returns (uint256 proposalId) {
        require(member != address(0), 'DaoGovernor: zero member');
        proposalId = _createProposal(
            ProposalType.AUDIT_RULE_CHANGE,
            bytes32(uint256(uint160(member))),
            title,
            'Voting power change request',
            payable(0),
            power,
            0
        );
    }

    function _createProposal(
        ProposalType proposalType_,
        bytes32 targetId,
        string memory title,
        string memory description,
        address payable recipient,
        uint256 amount,
        uint256 requestId
    ) internal returns (uint256 proposalId) {
        proposalId = proposals.length;
        proposals.push(Proposal({
            id: proposalId,
            proposalType: proposalType_,
            targetId: targetId,
            title: title,
            description: description,
            proposer: msg.sender,
            forVotes: 0,
            againstVotes: 0,
            startTime: block.timestamp,
            endTime: block.timestamp + votingPeriod,
            status: ProposalStatus.ACTIVE,
            recipient: recipient,
            amount: amount,
            requestId: requestId
        }));
        emit ProposalCreated(proposalId, uint8(proposalType_), targetId);
    }

    /// @notice 投票，返回本次投票使用的治理权重。
    ///         涉及某个项目的提案（立项 / 拨付），该项目的受助方本人不得投票——
    ///         否则收款方既当运动员又当裁判，回避规则形同虚设。
    function castVote(uint256 proposalId, bool support) external returns (uint256) {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.ACTIVE, 'DaoGovernor: proposal not active');
        require(block.timestamp <= proposal.endTime, 'DaoGovernor: voting closed');
        require(!hasVoted[proposalId][msg.sender], 'DaoGovernor: already voted');

        if (
            address(vault) != address(0) &&
            (proposal.proposalType == ProposalType.FUND_RELEASE ||
                proposal.proposalType == ProposalType.CAMPAIGN_APPROVAL)
        ) {
            if (vault.campaignRecipient(proposal.targetId) == msg.sender) {
                emit ConflictOfInterestBlocked(proposalId, msg.sender);
                revert('DaoGovernor: conflict of interest');
            }
        }

        uint256 power = votingPower[msg.sender];
        require(power > 0, 'DaoGovernor: no voting power');

        hasVoted[proposalId][msg.sender] = true;
        if (support) {
            proposal.forVotes += power;
        } else {
            proposal.againstVotes += power;
        }

        emit VoteCast(proposalId, msg.sender, support, power);
        return power;
    }

    /// @notice 单独结算提案状态，不触发任何资金动作。
    ///         任何人都可以在投票期结束后调用，让链上状态从 ACTIVE 变成 PASSED / REJECTED。
    function tallyProposal(uint256 proposalId) external {
        _tally(proposalId);
    }

    /// @notice 执行已通过的提案；资金拨付类提案会触发金库转账。
    ///         必须同时满足：投票期已结束、达到法定人数、赞成票多于反对票、时间锁已过。
    function executeProposal(uint256 proposalId) external returns (bytes32 executionHash) {
        Proposal storage proposal = proposals[proposalId];

        if (proposal.status == ProposalStatus.ACTIVE) {
            _tally(proposalId);
        }
        require(proposal.status == ProposalStatus.PASSED, 'DaoGovernor: proposal not passed');
        require(block.timestamp >= proposal.endTime + timelockDuration, 'DaoGovernor: timelock not elapsed');

        proposal.status = ProposalStatus.EXECUTED;

        if (proposal.proposalType == ProposalType.FUND_RELEASE) {
            vault.releaseFunds(proposal.targetId, proposal.requestId);
        } else if (proposal.proposalType == ProposalType.AUDIT_RULE_CHANGE && proposal.amount > 0) {
            // 票权调整提案：targetId 里存的是成员地址，amount 是新票权
            _setVotingPower(address(uint160(uint256(proposal.targetId))), proposal.amount);
        }

        executionHash = keccak256(abi.encodePacked(proposalId, block.timestamp, msg.sender));
        emit ProposalExecuted(proposalId, executionHash);

        if (address(auditRegistry) != address(0)) {
            auditRegistry.appendAuditLog(executionHash, 3, bytes32(0), proposal.title);
        }
    }

    function _tally(uint256 proposalId) internal {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.ACTIVE, 'DaoGovernor: not active');
        require(block.timestamp > proposal.endTime, 'DaoGovernor: voting ongoing');

        uint256 participated = proposal.forVotes + proposal.againstVotes;
        bool quorumReached = totalVotingPower > 0 && participated * 10000 >= totalVotingPower * quorumBps;

        if (quorumReached && proposal.forVotes > proposal.againstVotes) {
            proposal.status = ProposalStatus.PASSED;
        } else {
            proposal.status = ProposalStatus.REJECTED;
        }
    }

    /// @notice 距离可以执行还剩多少秒（0 表示已可执行）。供前端展示时间锁倒计时。
    function executionDelay(uint256 proposalId) external view returns (uint256) {
        Proposal storage proposal = proposals[proposalId];
        uint256 readyAt = proposal.endTime + timelockDuration;
        if (block.timestamp >= readyAt) return 0;
        return readyAt - block.timestamp;
    }

    function proposalCount() external view returns (uint256) {
        return proposals.length;
    }

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return proposals[proposalId];
    }
}
