import { describe, expect, it } from 'vitest';
import type { AuditLog, Campaign } from '../../types';
import { ethToWei } from '../format';
import { activeCampaignCount, auditCoverageRate, flaggedLogs, totalRaisedEth, totalReleasedEth } from '../metrics';

function campaign(partial: Partial<Campaign>): Campaign {
  return {
    id: 'camp-x',
    name: '测试项目',
    description: '',
    coverImage: '',
    targetAmount: ethToWei(100),
    raisedAmount: ethToWei(0),
    recipientAddress: '0x058edf932edab0c07aad030e6fc91c8a58d03f3a',
    multiSigAddress: '0x0000000000000000000000000000000000000001',
    status: 'ACTIVE',
    creatorAddress: '0x0000000000000000000000000000000000000002',
    createTimestamp: Date.now(),
    ...partial,
  };
}

function auditLog(partial: Partial<AuditLog>): AuditLog {
  return {
    id: 'log-x',
    txHash: `0x${'0'.repeat(64)}`,
    campaignId: 'camp-x',
    operationType: 'DEPOSIT',
    amount: ethToWei(0),
    blockNumber: 1,
    timestamp: Date.now(),
    status: 'CONFIRMED',
    operator: '0x0000000000000000000000000000000000000003',
    memo: '',
    ...partial,
  } as AuditLog;
}

describe('总善款池', () => {
  it('汇总所有非驳回项目的已筹金额', () => {
    const list = [
      campaign({ raisedAmount: ethToWei(32.6) }),
      campaign({ raisedAmount: ethToWei(77.2) }),
      campaign({ raisedAmount: ethToWei(100), status: 'REJECTED' }),
    ];
    expect(totalRaisedEth(list)).toBeCloseTo(109.8, 6);
  });

  it('被驳回的项目不计入，避免把退回的钱算成善款', () => {
    const list = [campaign({ raisedAmount: ethToWei(10), status: 'REJECTED' })];
    expect(totalRaisedEth(list)).toBe(0);
  });

  it('空列表返回 0', () => {
    expect(totalRaisedEth([])).toBe(0);
  });
});

describe('已拨付总额', () => {
  it('只统计 WITHDRAWAL 类型', () => {
    const logs = [
      auditLog({ operationType: 'WITHDRAWAL', amount: ethToWei(3) }),
      auditLog({ operationType: 'DEPOSIT', amount: ethToWei(50) }),
      auditLog({ operationType: 'WITHDRAWAL', amount: ethToWei(1.5) }),
    ];
    expect(totalReleasedEth(logs)).toBeCloseTo(4.5, 6);
  });
});

describe('审计覆盖率', () => {
  it('PENDING 之外的记录都算已覆盖', () => {
    const logs = [
      auditLog({ status: 'CONFIRMED' }),
      auditLog({ status: 'CONFIRMED' }),
      auditLog({ status: 'FLAGGED' }),
      auditLog({ status: 'PENDING' }),
    ];
    // 3 / 4 = 75%
    expect(auditCoverageRate(logs)).toBeCloseTo(75, 6);
  });

  it('全部确认时为 100%，空台账返回 0 而不是 NaN', () => {
    expect(auditCoverageRate([auditLog({ status: 'CONFIRMED' })])).toBe(100);
    expect(auditCoverageRate([])).toBe(0);
  });
});

describe('异常与项目计数', () => {
  it('flaggedLogs 只挑出被标记异常的记录', () => {
    const logs = [
      auditLog({ id: 'a', status: 'CONFIRMED' }),
      auditLog({ id: 'b', status: 'FLAGGED' }),
    ];
    expect(flaggedLogs(logs).map((log) => log.id)).toEqual(['b']);
  });

  it('activeCampaignCount 只数 ACTIVE 状态', () => {
    const list = [
      campaign({ status: 'ACTIVE' }),
      campaign({ status: 'ACTIVE' }),
      campaign({ status: 'COMPLETED' }),
      campaign({ status: 'PENDING' }),
    ];
    expect(activeCampaignCount(list)).toBe(2);
  });
});
