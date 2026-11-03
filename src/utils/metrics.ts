import type { AuditLog, Campaign } from '../types';
import { weiToEth } from './format';

/**
 * 全站统计口径的唯一出口。
 * 之前仪表盘和架构图各自写了一份汇总逻辑，同一个「总善款」在两个页面差出 4 倍，
 * 所以统一收到这里：任何页面要显示汇总数字，都调这里，不要自己 reduce。
 */

/** 总善款池：各项目已筹金额之和（不含已驳回项目，它们不接收资金） */
export function totalRaisedEth(campaigns: Campaign[]): number {
  return campaigns
    .filter((campaign) => campaign.status !== 'REJECTED')
    .reduce((sum, campaign) => sum + weiToEth(campaign.raisedAmount), 0);
}

/** 已拨付总额：审计台账里所有拨付记录之和 */
export function totalReleasedEth(auditLogs: AuditLog[]): number {
  return auditLogs
    .filter((log) => log.operationType === 'WITHDRAWAL')
    .reduce((sum, log) => sum + weiToEth(log.amount), 0);
}

/**
 * 审计覆盖率：已经产生链上凭证的记录占比。
 * 异常冻结（FLAGGED）也算已覆盖——它们已经在链上留痕，只是内容被标记可疑；
 * 真正没覆盖的是还没拿到区块确认的 PENDING。
 */
export function auditCoverageRate(auditLogs: AuditLog[]): number {
  if (!auditLogs.length) return 0;
  const covered = auditLogs.filter((log) => log.status !== 'PENDING').length;
  return (covered / auditLogs.length) * 100;
}

/** 异常冻结的审计记录，用于预警卡片 */
export function flaggedLogs(auditLogs: AuditLog[]): AuditLog[] {
  return auditLogs.filter((log) => log.status === 'FLAGGED');
}

/** 按状态统计项目数量 */
export function activeCampaignCount(campaigns: Campaign[]): number {
  return campaigns.filter((campaign) => campaign.status === 'ACTIVE').length;
}
