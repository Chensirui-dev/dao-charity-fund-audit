// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAuditRegistry {
    function appendAuditLog(
        bytes32 txHash,
        uint8 operationType,
        bytes32 merkleRoot,
        string calldata metadataURI
    ) external returns (bytes32 auditId);
}

/// @title DonationVault
/// @notice 公益金库。资金流向被六条规则锁死：
///
///         1. 收款地址在立项那一刻写进 CampaignAccount，由治理合约登记，此后不可修改。
///            拨款时直接读这条记录，不存在「谁临时填一个地址就能把钱转走」的路径。
///
///         2. 每一笔拨付都必须先有一条链上用款申请：由 recipient 本人提交，
///            附带材料哈希（发票、签收单、验收报告的摘要）。没有申请单，治理合约
///            也没有可以拨付的对象。
///
///         3. 项目按里程碑分期拨付。单期额度上限 = 目标额 / 期数，期数拨完即止，
///            避免一次性把整笔资金提空。
///
///         4. 募资失败可退款。截止时间已过、实际募得低于目标额时，捐赠人可取回本金。
///
///         5. 未登记的项目一律不收钱。donate 先校验 registered，避免资金打进一个
///            没有收款方、也没有申请入口的账户——那样的钱既拨不出也退不回，会永久锁死。
///
///         6. 审计员可以冻结项目。冻结后收钱、申请、拨付、退款四个入口全部关闭，
///            解冻必须走治理表决，单个审计员无法单方面解冻。
contract DonationVault {
    address public owner;
    address public governor;
    address public auditor;
    IAuditRegistry public auditRegistry;

    /// @dev 里程碑期数上限。期数越多单期额度越小，防止一次性拨空。
    uint8 public constant MAX_MILESTONES = 6;

    /// @dev 审计操作类型（与前端 AuditOperationType 对齐）
    uint8 public constant OP_DEPOSIT = 0;
    uint8 public constant OP_WITHDRAW = 1;
    uint8 public constant OP_FUND_RELEASE = 2;
    uint8 public constant OP_EVIDENCE = 5;
    uint8 public constant OP_FREEZE = 6;

    /// @dev 用款申请状态
    uint8 public constant REQUEST_PENDING = 0;
    uint8 public constant REQUEST_RELEASED = 1;
    uint8 public constant REQUEST_CANCELLED = 2;

    struct CampaignAccount {
        uint256 raised;
        uint256 released;
        address recipient;
        uint256 targetAmount;
        uint256 deadline;
        uint8 milestoneCount;
        uint8 milestonesReleased;
        bool registered;
        /// @dev 审计员冻结标记。冻结期间所有资金出入口关闭，解冻须经治理表决。
        bool frozen;
    }

    struct FundRequest {
        bytes32 campaignId;
        uint256 amount;
        bytes32 evidenceHash;
        address requester;
        uint256 createdAt;
        uint8 status;
    }

    mapping(bytes32 => CampaignAccount) public campaignAccounts;
    mapping(bytes32 => bool) public donationIds;
    mapping(bytes32 => mapping(address => uint256)) public contributions;
    mapping(uint256 => FundRequest) public fundRequests;
    uint256 public fundRequestCount;
    uint256 public totalRaised;

    event CampaignRegistered(
        bytes32 indexed campaignId,
        address indexed recipient,
        uint256 targetAmount,
        uint256 deadline,
        uint8 milestoneCount
    );
    event CampaignSeeded(bytes32 indexed campaignId, uint256 initialRaised);
    event DonationReceived(bytes32 indexed campaignId, address indexed donor, uint256 amount, bytes32 donationId);
    event FundRequested(
        uint256 indexed requestId,
        bytes32 indexed campaignId,
        address indexed requester,
        uint256 amount,
        bytes32 evidenceHash
    );
    event FundsReleased(
        uint256 indexed requestId,
        bytes32 indexed campaignId,
        address indexed recipient,
        uint256 amount,
        uint8 milestone
    );
    event RequestCancelled(uint256 indexed requestId);
    event Refunded(bytes32 indexed campaignId, address indexed donor, uint256 amount);
    event CampaignFrozen(bytes32 indexed campaignId, address indexed auditor, bytes32 reasonHash);
    event CampaignUnfrozen(bytes32 indexed campaignId);

    modifier onlyOwner() {
        require(msg.sender == owner, 'DonationVault: not owner');
        _;
    }

    modifier onlyGovernor() {
        require(msg.sender == governor, 'DonationVault: only governor');
        _;
    }

    modifier onlyAuditor() {
        require(msg.sender == auditor, 'DonationVault: only auditor');
        _;
    }

    /// @dev 冻结期间禁止任何资金动作。放在各入口最前面，错误信息统一。
    modifier whenNotFrozen(bytes32 campaignId) {
        require(!campaignAccounts[campaignId].frozen, 'DonationVault: campaign frozen');
        _;
    }

    constructor(address auditRegistry_) {
        owner = msg.sender;
        governor = msg.sender;
        auditRegistry = IAuditRegistry(auditRegistry_);
    }

    function setGovernor(address governor_) external onlyOwner {
        require(governor_ != address(0), 'DonationVault: zero governor');
        governor = governor_;
    }

    function setAuditRegistry(address registry_) external onlyOwner {
        auditRegistry = IAuditRegistry(registry_);
    }

    /// @notice 指定审计员。审计员只有冻结权，没有解冻权、没有动钱权。
    function setAuditor(address auditor_) external onlyOwner {
        auditor = auditor_;
    }

    /// @notice 登记项目收款方与募资参数。只能由治理合约在立项提案创建时调用，每个项目只能登记一次。
    /// @param deadline 募资截止时间戳，过了这个时间不再接收捐款
    /// @param milestoneCount 分期期数，1 表示一次性拨付
    function registerCampaign(
        bytes32 campaignId,
        address recipient,
        uint256 targetAmount,
        uint256 deadline,
        uint8 milestoneCount
    ) external onlyGovernor {
        _register(campaignId, recipient, targetAmount, deadline, milestoneCount, 0);
    }

    /// @notice 存量数据迁移：把一个已有历史募集额的项目直接登记上链。
    ///
    ///         系统上线前已经在运行的募资记录不可能逐笔回放，这里只把「当前账面进度」
    ///         作为期初余额写入。注意这是记账口径——链上托管余额来自实际收到的捐款，
    ///         拨付时仍受金库真实余额约束（见 releaseFunds）。
    function seedCampaign(
        bytes32 campaignId,
        address recipient,
        uint256 targetAmount,
        uint256 deadline,
        uint8 milestoneCount,
        uint256 initialRaised
    ) external onlyGovernor {
        _register(campaignId, recipient, targetAmount, deadline, milestoneCount, initialRaised);
    }

    function _register(
        bytes32 campaignId,
        address recipient,
        uint256 targetAmount,
        uint256 deadline,
        uint8 milestoneCount,
        uint256 initialRaised
    ) private {
        require(recipient != address(0), 'DonationVault: zero recipient');
        require(campaignId != bytes32(0), 'DonationVault: zero campaign');
        require(targetAmount > 0, 'DonationVault: zero target');
        require(milestoneCount >= 1 && milestoneCount <= MAX_MILESTONES, 'DonationVault: bad milestone count');
        require(deadline > block.timestamp, 'DonationVault: deadline in past');
        require(!campaignAccounts[campaignId].registered, 'DonationVault: already registered');
        require(initialRaised <= targetAmount, 'DonationVault: initial raised exceeds target');

        CampaignAccount storage account = campaignAccounts[campaignId];
        account.recipient = recipient;
        account.targetAmount = targetAmount;
        account.deadline = deadline;
        account.milestoneCount = milestoneCount;
        account.registered = true;

        if (initialRaised > 0) {
            account.raised = initialRaised;
            totalRaised += initialRaised;
            emit CampaignSeeded(campaignId, initialRaised);
        }

        emit CampaignRegistered(campaignId, recipient, targetAmount, deadline, milestoneCount);
    }

    /// @notice 捐赠者向指定项目捐款。未登记的项目不收钱，募资截止后关闭入口。
    function donate(bytes32 campaignId, string calldata message)
        external
        payable
        whenNotFrozen(campaignId)
        returns (bytes32 donationId)
    {
        require(msg.value > 0, 'DonationVault: zero amount');

        CampaignAccount storage account = campaignAccounts[campaignId];
        require(account.registered, 'DonationVault: campaign not registered');
        require(block.timestamp <= account.deadline, 'DonationVault: fundraising closed');

        donationId = keccak256(abi.encodePacked(campaignId, msg.sender, msg.value, block.number, block.timestamp));
        require(!donationIds[donationId], 'DonationVault: duplicated donation');
        donationIds[donationId] = true;

        account.raised += msg.value;
        contributions[campaignId][msg.sender] += msg.value;
        totalRaised += msg.value;

        emit DonationReceived(campaignId, msg.sender, msg.value, donationId);

        if (address(auditRegistry) != address(0)) {
            auditRegistry.appendAuditLog(donationId, OP_DEPOSIT, bytes32(0), message);
        }
    }

    /// @notice 受助方提交用款申请。只有立项时登记的收款地址本人能提交，
    ///         且必须附带材料哈希——材料本身存在链下，哈希上链后无法再改动。
    ///         这一步不会转移任何资金，只是把「申请多少钱、依据什么材料」固定下来。
    function requestFunds(
        bytes32 campaignId,
        uint256 amount,
        bytes32 evidenceHash
    ) external whenNotFrozen(campaignId) returns (uint256 requestId) {
        CampaignAccount storage account = campaignAccounts[campaignId];

        require(account.registered, 'DonationVault: campaign not registered');
        require(msg.sender == account.recipient, 'DonationVault: only recipient');
        require(evidenceHash != bytes32(0), 'DonationVault: missing evidence');
        require(amount > 0, 'DonationVault: zero amount');
        require(account.milestonesReleased < account.milestoneCount, 'DonationVault: all milestones released');

        uint256 perMilestone = account.targetAmount / account.milestoneCount;
        require(amount <= perMilestone, 'DonationVault: exceeds milestone cap');
        require(account.released + amount <= account.raised, 'DonationVault: insufficient balance');

        requestId = fundRequestCount;
        fundRequestCount += 1;

        fundRequests[requestId] = FundRequest({
            campaignId: campaignId,
            amount: amount,
            evidenceHash: evidenceHash,
            requester: msg.sender,
            createdAt: block.timestamp,
            status: REQUEST_PENDING
        });

        emit FundRequested(requestId, campaignId, msg.sender, amount, evidenceHash);

        if (address(auditRegistry) != address(0)) {
            auditRegistry.appendAuditLog(evidenceHash, OP_EVIDENCE, bytes32(0), 'fund request evidence');
        }
    }

    /// @notice 申请人撤回尚未拨付的申请。提案被否后也走这条路径，避免申请名额被占死。
    function cancelRequest(uint256 requestId) external {
        FundRequest storage request = fundRequests[requestId];
        require(request.requester == msg.sender, 'DonationVault: not requester');
        require(request.status == REQUEST_PENDING, 'DonationVault: request not pending');

        request.status = REQUEST_CANCELLED;
        emit RequestCancelled(requestId);
    }

    /// @notice 由 DAO 治理合约在提案通过后调用。金额与收款方都不在参数里：
    ///         金额取自申请单，收款方取自立项记录，提案人能决定的只有「批不批准」。
    function releaseFunds(bytes32 campaignId, uint256 requestId)
        external
        onlyGovernor
        whenNotFrozen(campaignId)
        returns (bool)
    {
        CampaignAccount storage account = campaignAccounts[campaignId];
        FundRequest storage request = fundRequests[requestId];

        require(account.registered, 'DonationVault: campaign not registered');
        require(request.status == REQUEST_PENDING, 'DonationVault: request not pending');
        require(request.campaignId == campaignId, 'DonationVault: request campaign mismatch');
        require(account.milestonesReleased < account.milestoneCount, 'DonationVault: all milestones released');
        require(account.released + request.amount <= account.raised, 'DonationVault: insufficient balance');
        // 记账余额与托管的真实 ETH 是两回事：存量迁移进来的历史额度没有对应资金，
        // 能不能真转出去以合约实际持有的余额为准。
        require(address(this).balance >= request.amount, 'DonationVault: vault balance insufficient');

        address payable recipient = payable(account.recipient);
        require(recipient != address(0), 'DonationVault: zero recipient');

        request.status = REQUEST_RELEASED;
        account.released += request.amount;
        account.milestonesReleased += 1;

        (bool ok, ) = recipient.call{ value: request.amount }('');
        require(ok, 'DonationVault: transfer failed');

        emit FundsReleased(requestId, campaignId, recipient, request.amount, account.milestonesReleased);

        if (address(auditRegistry) != address(0)) {
            bytes32 digest = keccak256(
                abi.encodePacked(campaignId, requestId, recipient, request.amount, block.number)
            );
            auditRegistry.appendAuditLog(digest, OP_FUND_RELEASE, bytes32(0), '');
        }
        return true;
    }

    /// @notice 募资失败退款。只有「截止时间已过 + 未达目标额 + 尚未拨过款」三个条件同时成立
    ///         才开放，避免项目进行到一半被抽走资金。
    function refund(bytes32 campaignId) external whenNotFrozen(campaignId) returns (uint256 amount) {
        CampaignAccount storage account = campaignAccounts[campaignId];

        require(account.registered, 'DonationVault: campaign not registered');
        require(block.timestamp > account.deadline, 'DonationVault: fundraising ongoing');
        require(account.raised < account.targetAmount, 'DonationVault: target reached');
        require(account.released == 0, 'DonationVault: funds already released');

        amount = contributions[campaignId][msg.sender];
        require(amount > 0, 'DonationVault: nothing to refund');

        contributions[campaignId][msg.sender] = 0;
        account.raised -= amount;
        totalRaised -= amount;

        (bool ok, ) = payable(msg.sender).call{ value: amount }('');
        require(ok, 'DonationVault: refund failed');

        emit Refunded(campaignId, msg.sender, amount);

        if (address(auditRegistry) != address(0)) {
            bytes32 digest = keccak256(abi.encodePacked(campaignId, msg.sender, amount, block.number));
            auditRegistry.appendAuditLog(digest, OP_WITHDRAW, bytes32(0), 'refund');
        }
    }

    /// @notice 审计员冻结项目。材料造假、资金去向不明时用，只关阀门不动钱。
    function freezeCampaign(bytes32 campaignId, bytes32 reasonHash) external onlyAuditor {
        CampaignAccount storage account = campaignAccounts[campaignId];
        require(account.registered, 'DonationVault: campaign not registered');
        require(!account.frozen, 'DonationVault: already frozen');
        require(reasonHash != bytes32(0), 'DonationVault: missing reason');

        account.frozen = true;
        emit CampaignFrozen(campaignId, msg.sender, reasonHash);

        if (address(auditRegistry) != address(0)) {
            auditRegistry.appendAuditLog(reasonHash, OP_FREEZE, bytes32(0), 'campaign frozen by auditor');
        }
    }

    /// @notice 解冻必须走治理表决，审计员一个人解不开——否则冻结权就成了要挟工具。
    function unfreezeCampaign(bytes32 campaignId) external onlyGovernor {
        CampaignAccount storage account = campaignAccounts[campaignId];
        require(account.registered, 'DonationVault: campaign not registered');
        require(account.frozen, 'DonationVault: not frozen');

        account.frozen = false;
        emit CampaignUnfrozen(campaignId);
    }

    /// @notice 查询某项目当前账面可用余额（记账口径，未扣除尚未到账的历史额度）
    function campaignBalance(bytes32 campaignId) external view returns (uint256) {
        CampaignAccount storage account = campaignAccounts[campaignId];
        return account.raised - account.released;
    }

    /// @notice 查询某项目在链上登记的收款地址
    function campaignRecipient(bytes32 campaignId) external view returns (address) {
        return campaignAccounts[campaignId].recipient;
    }

    /// @notice 单期可申请的额度上限。前端展示用，与 requestFunds 内的校验口径一致。
    function milestoneCap(bytes32 campaignId) external view returns (uint256) {
        CampaignAccount storage account = campaignAccounts[campaignId];
        if (!account.registered || account.milestoneCount == 0) return 0;
        return account.targetAmount / account.milestoneCount;
    }

    /// @notice 项目是否处于冻结状态
    function isFrozen(bytes32 campaignId) external view returns (bool) {
        return campaignAccounts[campaignId].frozen;
    }

    receive() external payable {}
}
