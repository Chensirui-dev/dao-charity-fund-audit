import type { AuditLog, AuditStatus, OperationType } from '../types';
import { ethToWei, randomHash } from '../utils/format';
import { addresses, block } from '../utils/mock';
import { campaigns } from './campaigns';

/**
 * 每条流水都要落到具体项目上。
 *
 * 审计页如果只按操作类型平铺记录，看的人无法回答"这笔钱是哪个项目的"，
 * 也没法和项目详情页对上。所以这里按项目生成：发送方 / 接收方直接取自项目的
 * 多签库与受助方地址，再按项目筛选时金额与地址都能自洽。
 *
 * 金额不是随手编的：所有"捐款入账"加起来正好等于该项目的已筹金额，
 * "资金拨付"则按项目状态给出——已结项的项目全额拨完，进行中的项目拨一部分。
 * 这样审计页的资金流入 / 已拨付与项目列表的筹款进度能对得上账。
 */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * 各项目流水条数。没有上线的项目（待审批 / 已拒绝）不会产生资金流水，
 * 这一点必须和治理页对得上：项目没通过表决，钱就不该进来。
 */
const SIZE_BY_CAMPAIGN: Record<string, number> = {
  'camp-001': 12,
  'camp-002': 11,
  'camp-003': 9,
  'camp-004': 10,
  'camp-006': 8,
  'camp-008': 11,
};

/** 项目内第 i 条记录的操作类型，让每个项目都有完整的资金生命周期 */
const OPERATION_CYCLE: OperationType[] = [
  'DEPOSIT',
  'DEPOSIT',
  'GAS_FEE',
  'DEPOSIT',
  'WITHDRAWAL',
  'DEPOSIT',
  'PROPOSAL_EXECUTION',
  'GAS_FEE',
];

/** 每笔捐款的权重，用来把项目已筹金额拆成金额不等的若干笔，但合计精确 */
const DEPOSIT_WEIGHTS = [1, 0.6, 1.4, 0.8, 1.2, 0.5, 1.1, 0.9, 1.3, 0.7];

/** 指定哪几条属于异常记录，用于演示审计预警 */
const FLAGGED = new Set(['camp-003:5', 'camp-006:3']);

/** 仍未获得区块确认的记录，只在个别项目的最新一笔上出现，避免整页都是"待审核" */
const PENDING = new Set(['camp-001:0', 'camp-004:0']);

/** 把总额按权重拆成若干份，尾差给最后一份，保证求和与总额完全相等 */
function splitWei(total: string, count: number): string[] {
  const totalWei = BigInt(total);
  if (!count || totalWei === 0n) return Array.from({ length: count }, () => '0');

  const weights = Array.from({ length: count }, (_, index) => DEPOSIT_WEIGHTS[index % DEPOSIT_WEIGHTS.length]);
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const parts = weights.map((weight) => (totalWei * BigInt(Math.round(weight * 100))) / BigInt(Math.round(weightSum * 100)));
  const allocated = parts.reduce((sum, part) => sum + part, 0n);
  parts[parts.length - 1] += totalWei - allocated;
  return parts.map((part) => part.toString());
}

export const auditLogs: AuditLog[] = campaigns
  .flatMap((campaign, campaignIndex) => {
    const size = SIZE_BY_CAMPAIGN[campaign.id] ?? 0;
    if (!size) return [];

    const operations = Array.from({ length: size }, (_, index) => OPERATION_CYCLE[index % OPERATION_CYCLE.length]);
    const depositCount = operations.filter((item) => item === 'DEPOSIT').length;
    const depositAmounts = splitWei(campaign.raisedAmount, depositCount);

    // 已结项的项目把钱拨完了，进行中的项目只拨了一部分，与项目状态保持一致
    const withdrawalAmount = campaign.status === 'COMPLETED'
      ? campaign.raisedAmount
      : ((BigInt(campaign.raisedAmount) * 4n) / 10n).toString();

    let depositCursor = 0;

    return operations.map((operationType, itemIndex) => {
      const sequence = campaignIndex * 8 + itemIndex;

      const amount = operationType === 'DEPOSIT'
        ? (depositAmounts[depositCursor++] ?? '0')
        : operationType === 'WITHDRAWAL'
          ? withdrawalAmount
          : operationType === 'GAS_FEE'
            ? ethToWei(0.006)
            : '0';

      const status: AuditStatus = FLAGGED.has(`${campaign.id}:${itemIndex}`)
        ? 'FLAGGED'
        : PENDING.has(`${campaign.id}:${itemIndex}`)
          ? 'PENDING'
          : 'CONFIRMED';

      // 时间按「项目 × 序号」交叉铺开：全站台账里不同项目的流水是交错的，
      // 而不是一段一段地聚在一起；同时不早于项目立项时间。
      const ageHours = (itemIndex * 7 + campaignIndex * 3) * 6;
      const timestamp = Math.max(
        campaign.createTimestamp,
        Date.now() - ageHours * 3_600_000 - (campaignIndex + 1) * 40 * 60_000,
      );

      // 捐赠人不能正好是项目自己的专户地址，否则一条记录里发送方和接收方会是同一个
      const donorIndex = (sequence * 3 + 5) % addresses.length;
      const donor = addresses[donorIndex].toLowerCase() === campaign.multiSigAddress.toLowerCase()
        ? addresses[(donorIndex + 1) % addresses.length]
        : addresses[donorIndex];

      return {
        id: `audit-${campaign.id}-${String(itemIndex + 1).padStart(2, '0')}`,
        campaignId: campaign.id,
        txHash: randomHash(`${campaign.id}-${itemIndex}`),
        operationType,
        fromAddress: operationType === 'DEPOSIT' ? donor : campaign.multiSigAddress,
        toAddress: operationType === 'DEPOSIT'
          ? campaign.multiSigAddress
          : operationType === 'GAS_FEE'
            ? ZERO_ADDRESS
            : campaign.recipientAddress,
        amount,
        gasUsed: `${48_000 + sequence * 921}`,
        blockNumber: block(120 + sequence),
        timestamp,
        merkleRoot: randomHash(`merkle-${campaign.id}-${itemIndex}`),
        signatureCount: status === 'CONFIRMED' ? 2 + (itemIndex % 3) : 1,
        status,
      } satisfies AuditLog;
    });
  })
  .sort((a, b) => b.timestamp - a.timestamp);
