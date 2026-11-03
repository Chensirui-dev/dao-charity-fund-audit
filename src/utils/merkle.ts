/**
 * Merkle 树工具：构建、生成证明、验真。
 *
 * 算法与链上 `AuditRegistry.verifyProof` 严格一致：
 *   computed = computed <= node ? keccak256(computed ‖ node) : keccak256(node ‖ computed)
 * 也就是「兄弟节点按字节序排序后再哈希」。这样验证结果与节点位于左还是右无关，
 * 前端算出的证明可以直接交给链上合约验证。
 */
import { concat, keccak256, toUtf8Bytes } from 'ethers';
import type { AuditLog } from '../types';

export const EMPTY_ROOT = `0x${'0'.repeat(64)}`;

/** 叶子节点：把一条审计记录的关键字段规范化后取哈希 */
export function auditLeaf(log: AuditLog): string {
  const payload = [log.id, log.txHash, log.operationType, log.amount, String(log.blockNumber)].join('|');
  return keccak256(toUtf8Bytes(payload));
}

/** 合并两个节点：按字节序排序后哈希（与链上实现一致） */
export function hashPair(a: string, b: string): string {
  const [left, right] = a.toLowerCase() <= b.toLowerCase() ? [a, b] : [b, a];
  return keccak256(concat([left, right]));
}

export interface MerkleTree {
  /** layers[0] 是叶子层，最后一层只有一个根节点 */
  layers: string[][];
  root: string;
}

/**
 * 构建 Merkle 树。节点数为奇数时，落单的节点直接提升到上一层（不再与自身配对），
 * 这样生成的证明更短，且与链上 verifyProof 的折叠方式天然兼容。
 */
export function buildMerkleTree(leaves: string[]): MerkleTree {
  if (leaves.length === 0) return { layers: [[]], root: EMPTY_ROOT };

  const layers: string[][] = [leaves.slice()];
  let current = leaves.slice();

  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      next.push(i + 1 < current.length ? hashPair(current[i], current[i + 1]) : current[i]);
    }
    layers.push(next);
    current = next;
  }

  return { layers, root: current[0] };
}

/** 取第 index 个叶子的 Merkle 证明（叶子 → 根沿途的兄弟节点） */
export function getMerkleProof(leaves: string[], index: number): string[] {
  if (index < 0 || index >= leaves.length) return [];

  const { layers } = buildMerkleTree(leaves);
  const proof: string[] = [];
  let cursor = index;

  for (let level = 0; level < layers.length - 1; level += 1) {
    const layer = layers[level];
    const sibling = cursor % 2 === 0 ? cursor + 1 : cursor - 1;
    if (sibling < layer.length) proof.push(layer[sibling]);
    cursor = Math.floor(cursor / 2);
  }

  return proof;
}

/** 本地验真：沿证明把叶子折叠回根，与目标根比对 */
export function verifyMerkleProof(leaf: string, proof: string[], root: string): boolean {
  let computed = leaf;
  for (const node of proof) {
    computed = hashPair(computed, node);
  }
  return computed.toLowerCase() === root.toLowerCase();
}

/** 演示用：翻转叶子哈希的最后一位，模拟「数据被篡改」 */
export function tamperLeaf(leaf: string): string {
  const last = leaf.slice(-1);
  return leaf.slice(0, -1) + (last === '0' ? '1' : '0');
}

export interface AuditCommitment {
  leaves: string[];
  root: string;
  count: number;
}

/** 对一批审计记录建立承诺（叶子集合 + Merkle 根） */
export function buildAuditCommitment(logs: AuditLog[]): AuditCommitment {
  const leaves = logs.map(auditLeaf);
  return { leaves, root: buildMerkleTree(leaves).root, count: leaves.length };
}

export interface AuditProof {
  index: number;
  leaf: string;
  proof: string[];
  root: string;
  valid: boolean;
}

/** 为某一条审计记录生成证明，并立刻在本地验一次 */
export function proveAuditLog(logs: AuditLog[], index: number): AuditProof | null {
  if (index < 0 || index >= logs.length) return null;

  const leaves = logs.map(auditLeaf);
  const { root } = buildMerkleTree(leaves);
  const leaf = leaves[index];
  const proof = getMerkleProof(leaves, index);

  return { index, leaf, proof, root, valid: verifyMerkleProof(leaf, proof, root) };
}
