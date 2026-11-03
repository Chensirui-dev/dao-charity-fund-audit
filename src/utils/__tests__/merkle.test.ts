import { describe, expect, it } from 'vitest';
import type { AuditLog } from '../../types';
import { ethToWei } from '../format';
import {
  EMPTY_ROOT,
  buildAuditCommitment,
  buildMerkleTree,
  getMerkleProof,
  hashPair,
  proveAuditLog,
  tamperLeaf,
  verifyMerkleProof,
} from '../merkle';

/** 造 n 条最小可用的审计记录，只关心参与哈希的字段 */
function makeLogs(n: number): AuditLog[] {
  return Array.from({ length: n }, (_, index) => ({
    id: `log-${index}`,
    txHash: `0x${String(index).padStart(64, '0')}`,
    campaignId: 'camp-001',
    operationType: 'DEPOSIT',
    amount: ethToWei(1),
    blockNumber: 18_542_000 + index,
    timestamp: Date.now() - index * 60_000,
    status: 'CONFIRMED',
    operator: '0x8709927966E3015d5A0f19eAdEa3C2831cB03c0a',
    memo: '',
  })) as unknown as AuditLog[];
}

describe('Merkle 树构建', () => {
  it('空集合返回零根，不抛异常', () => {
    expect(buildMerkleTree([]).root).toBe(EMPTY_ROOT);
  });

  it('单叶子时根等于叶子自身', () => {
    const leaf = `0x${'ab'.repeat(32)}`;
    expect(buildMerkleTree([leaf]).root).toBe(leaf);
  });

  it('叶子数为奇数时落单节点直接提升，层数正确', () => {
    const leaves = ['01', '02', '03'].map((byte) => `0x${byte.repeat(32)}`);
    const { layers } = buildMerkleTree(leaves);
    expect(layers).toHaveLength(3);
    expect(layers[1]).toHaveLength(2);
    expect(layers[2]).toHaveLength(1);
  });

  it('hashPair 与节点顺序无关，保证链上验真不受左右位置影响', () => {
    const a = '0x1111111111111111111111111111111111111111111111111111111111111111';
    const b = '0x2222222222222222222222222222222222222222222222222222222222222222';
    expect(hashPair(a, b)).toBe(hashPair(b, a));
  });
});

describe('Merkle 证明', () => {
  it('每个叶子的证明都能折叠回同一个根', () => {
    const leaves = makeLogs(7).map((log, index) => `0x${String(index + 1).padStart(64, '0')}`);
    const { root } = buildMerkleTree(leaves);
    leaves.forEach((leaf, index) => {
      const proof = getMerkleProof(leaves, index);
      expect(verifyMerkleProof(leaf, proof, root)).toBe(true);
    });
  });

  it('篡改任意一个叶子后验真失败', () => {
    const leaves = ['01', '02', '03', '04'].map((byte) => `0x${byte.repeat(32)}`);
    const { root } = buildMerkleTree(leaves);
    const proof = getMerkleProof(leaves, 1);
    expect(verifyMerkleProof(tamperLeaf(leaves[1]), proof, root)).toBe(false);
  });

  it('越界的下标返回空证明，不崩溃', () => {
    const leaves = ['01', '02'].map((byte) => `0x${byte.repeat(32)}`);
    expect(getMerkleProof(leaves, 5)).toEqual([]);
    expect(getMerkleProof(leaves, -1)).toEqual([]);
  });
});

describe('审计记录承诺', () => {
  it('buildAuditCommitment 的叶子数等于记录数', () => {
    const commitment = buildAuditCommitment(makeLogs(9));
    expect(commitment.count).toBe(9);
    expect(commitment.leaves).toHaveLength(9);
    expect(commitment.root).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('proveAuditLog 生成证明后立即自检通过', () => {
    const logs = makeLogs(6);
    const result = proveAuditLog(logs, 3);
    expect(result).not.toBeNull();
    expect(result?.valid).toBe(true);
  });

  it('越界下标返回 null', () => {
    expect(proveAuditLog(makeLogs(3), 3)).toBeNull();
  });

  it('记录内容变化会改变根，体现链上承诺的防篡改能力', () => {
    const base = makeLogs(5);
    const mutated = base.map((log, index) =>
      index === 2 ? ({ ...log, amount: ethToWei(9) } as AuditLog) : log,
    );
    expect(buildAuditCommitment(mutated).root).not.toBe(buildAuditCommitment(base).root);
  });
});
