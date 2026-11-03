import { describe, expect, it } from 'vitest';
import {
  addWei,
  ethToWei,
  formatEth,
  operationLabel,
  progressPercent,
  randomHash,
  shortAddress,
  toCsv,
  weiToEth,
} from '../format';

describe('金额换算', () => {
  it('ethToWei 与 weiToEth 互为逆运算', () => {
    const cases = [0, 0.01, 1, 32.6, 284.5];
    cases.forEach((value) => {
      expect(weiToEth(ethToWei(value))).toBeCloseTo(value, 9);
    });
  });

  it('wei 以字符串保存，避免大整数精度丢失', () => {
    const wei = ethToWei(284.5);
    expect(typeof wei).toBe('string');
    expect(wei).toBe('284500000000000000000');
  });

  it('addWei 累加不产生浮点误差', () => {
    // 用 number 直接相加时 0.1 + 0.7 = 0.7999999999999999
    let total = '0';
    ['0.1', '0.7', '0.3'].forEach((value) => {
      total = addWei(total, ethToWei(Number(value)));
    });
    expect(weiToEth(total)).toBeCloseTo(1.1, 12);
  });

  it('formatEth 默认保留两位小数并带单位', () => {
    expect(formatEth(ethToWei(1234.567))).toBe('1234.57 ETH');
    expect(formatEth(ethToWei(0.5), 4)).toBe('0.5000 ETH');
  });
});

describe('进度与地址展示', () => {
  it('progressPercent 按比例换算并保留一位小数', () => {
    expect(progressPercent(ethToWei(32.6), ethToWei(48))).toBeCloseTo(67.9, 1);
  });

  it('目标额为 0 时返回 0，不做除零', () => {
    expect(progressPercent(ethToWei(1), '0')).toBe(0);
  });

  it('超过目标额时封顶 100，避免进度条溢出', () => {
    expect(progressPercent(ethToWei(120), ethToWei(100))).toBe(100);
  });

  it('shortAddress 保留首尾，中间省略', () => {
    expect(shortAddress('0x8709927966E3015d5A0f19eAdEa3C2831cB03c0a')).toBe('0x8709...3c0a');
  });
});

describe('哈希与文案映射', () => {
  it('randomHash 对同一 seed 稳定复现', () => {
    expect(randomHash('address-1')).toBe(randomHash('address-1'));
  });

  it('randomHash 对不同 seed 产生不同结果（旧实现曾因字符和相同而碰撞）', () => {
    // camp-001-0 与 camp-001-10 在原 LCG 实现下会撞成同一个哈希
    expect(randomHash('camp-001-0')).not.toBe(randomHash('camp-001-10'));
    expect(randomHash('address-1')).not.toBe(randomHash('address-2'));
  });

  it('randomHash 输出为 0x 开头的 64 位十六进制', () => {
    expect(randomHash('anything')).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('operationLabel 覆盖全部操作类型，包括材料存证与冻结', () => {
    expect(operationLabel('DEPOSIT')).toBe('捐款入池');
    expect(operationLabel('EVIDENCE')).toBe('材料存证');
    expect(operationLabel('FREEZE')).toBe('项目冻结');
  });
});

describe('CSV 导出', () => {
  it('含逗号的字段自动加引号，避免列错位', () => {
    const csv = toCsv([{ 项目: '净水井, 一期', 金额: 1 }]);
    expect(csv).toContain('"净水井, 一期"');
  });
});
