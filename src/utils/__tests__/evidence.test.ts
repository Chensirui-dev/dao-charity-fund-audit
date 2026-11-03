import { describe, expect, it } from 'vitest';
import { hashText, shortHash } from '../evidence';

describe('材料摘要', () => {
  it('hashText 输出 0x 开头的 32 字节摘要', async () => {
    const digest = await hashText('发票编号 INV-2026-001');
    expect(digest).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('与标准 SHA-256 测试向量一致（abc）', async () => {
    // NIST 官方测试向量，用来确认摘要算法没有被换掉
    expect(await hashText('abc')).toBe(
      '0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('同样内容得到同样摘要，改一个字立刻不同', async () => {
    const a = await hashText('厨房设备采购发票 + 校方签收单');
    const b = await hashText('厨房设备采购发票 + 校方签收单');
    const c = await hashText('厨房设备采购发票 + 校方签收单（已涂改）');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('摘要长度固定，可直接写入合约的 bytes32', async () => {
    const short = await hashText('a');
    const long = await hashText('a'.repeat(10_000));
    expect(short.length).toBe(66);
    expect(long.length).toBe(66);
    expect(short).not.toBe(long);
  });
});

describe('摘要展示', () => {
  it('短哈希保留首尾并加省略号', () => {
    const hash = '0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(shortHash(hash)).toBe('0xba7816bf…0015ad');
  });

  it('本身就很短的哈希原样返回，不做无意义的截断', () => {
    expect(shortHash('0x1234')).toBe('0x1234');
  });
});
