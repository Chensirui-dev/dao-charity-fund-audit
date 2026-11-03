// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AuditRegistry
/// @notice 可信审计层：把每一次资金操作的关键摘要（交易哈希、操作类型、Merkle 根）固化到链上，
///         形成不可篡改的审计台账，并支持 Merkle Proof 验真。
contract AuditRegistry {
    struct AuditRecord {
        bytes32 txHash;
        uint8 operationType;
        bytes32 merkleRoot;
        string metadataURI;
        address reporter;
        uint256 timestamp;
    }

    /// @dev 操作类型编码，与前端 OperationType 对齐
    /// 0 = DEPOSIT, 1 = WITHDRAWAL, 2 = FUND_RELEASE,
    /// 3 = PROPOSAL_EXECUTION, 4 = CAMPAIGN_APPROVAL, 5 = EVIDENCE（用款材料哈希锚定）
    AuditRecord[] private records;
    mapping(bytes32 => uint256) public recordIndex;

    event AuditLogAppended(bytes32 indexed auditId, bytes32 indexed txHash, bytes32 merkleRoot);

    /// @notice 追加一条审计记录
    function appendAuditLog(
        bytes32 txHash,
        uint8 operationType,
        bytes32 merkleRoot,
        string calldata metadataURI
    ) external returns (bytes32 auditId) {
        auditId = keccak256(abi.encodePacked(txHash, operationType, block.timestamp, records.length, msg.sender));
        records.push(AuditRecord({
            txHash: txHash,
            operationType: operationType,
            merkleRoot: merkleRoot,
            metadataURI: metadataURI,
            reporter: msg.sender,
            timestamp: block.timestamp
        }));
        recordIndex[auditId] = records.length;
        emit AuditLogAppended(auditId, txHash, merkleRoot);
    }

    function recordCount() external view returns (uint256) {
        return records.length;
    }

    function getRecord(uint256 index) external view returns (AuditRecord memory) {
        return records[index];
    }

    /// @notice 校验 Merkle Proof，用于审计页面演示“链上可验真”
    function verifyProof(bytes32 leaf, bytes32[] calldata proof, bytes32 root) external pure returns (bool) {
        bytes32 computed = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 node = proof[i];
            computed = computed <= node
                ? keccak256(abi.encodePacked(computed, node))
                : keccak256(abi.encodePacked(node, computed));
        }
        return computed == root;
    }

    struct AuditAnchor {
        bytes32 merkleRoot;
        uint256 fromIndex;
        uint256 toIndex;
        address anchorer;
        uint256 timestamp;
    }

    AuditAnchor[] private anchors;

    event BatchAnchored(
        uint256 indexed anchorId,
        bytes32 merkleRoot,
        uint256 fromIndex,
        uint256 toIndex,
        address indexed anchorer
    );

    /// @dev 单批次可锚定的记录数上限，纯属健全性检查，避免写入无意义的巨大区间。
    uint256 public constant MAX_BATCH_SIZE = 4096;

    /// @notice 把某个区间的审计记录所构成的 Merkle 根锚定到链上，形成不可篡改的批次承诺。
    ///         之后任何一条记录都可以用 verifyProof 对着这个根做验真。
    ///
    ///         注意：本函数不校验区间是否落在链上已有的 records 之内。因为被审计的日志集合
    ///         既可能来自链上记录，也可能来自链下聚合后提交的日志；链上只负责不可篡改地
    ///         保存这个承诺（根 + 区间），叶子本身的来源由 verifyProof 的证明来约束。
    function anchorBatch(
        bytes32 merkleRoot,
        uint256 fromIndex,
        uint256 toIndex
    ) external returns (uint256 anchorId) {
        require(merkleRoot != bytes32(0), 'AuditRegistry: empty root');
        require(fromIndex <= toIndex, 'AuditRegistry: bad range');
        require(toIndex - fromIndex + 1 <= MAX_BATCH_SIZE, 'AuditRegistry: batch too large');

        anchorId = anchors.length;
        anchors.push(AuditAnchor({
            merkleRoot: merkleRoot,
            fromIndex: fromIndex,
            toIndex: toIndex,
            anchorer: msg.sender,
            timestamp: block.timestamp
        }));

        emit BatchAnchored(anchorId, merkleRoot, fromIndex, toIndex, msg.sender);
    }

    function anchorCount() external view returns (uint256) {
        return anchors.length;
    }

    function getAnchor(uint256 anchorId) external view returns (AuditAnchor memory) {
        return anchors[anchorId];
    }
}
