import type { Donation } from '../types';
import { ethToWei, randomHash } from '../utils/format';
import { addresses, block, daysAgo } from '../utils/mock';

const campaignIds = ['camp-001', 'camp-002', 'camp-003', 'camp-004', 'camp-006', 'camp-008', 'camp-009'];
const messages = [
  '愿每一笔善款都被看见',
  '支持透明公益',
  '给孩子们更多可能',
  '持续关注项目执行',
  '小额也能汇成河',
  '期待审计报告',
  '请把温暖送到现场',
  'DAO治理很酷',
];

export const donations: Donation[] = Array.from({ length: 38 }, (_, index) => {
  const campaignId = campaignIds[index % campaignIds.length];
  const amount = [0.18, 0.35, 0.5, 0.72, 1.2, 2.4, 3.6, 5.5][index % 8] + (index % 3) * 0.07;
  return {
    id: `don-${String(index + 1).padStart(3, '0')}`,
    txHash: randomHash(`donation-${index}`),
    campaignId,
    donorAddress: addresses[(index * 5 + 6) % addresses.length],
    amount: ethToWei(amount),
    message: messages[index % messages.length],
    timestamp: daysAgo((index * 2) % 86) - (index % 6) * 60 * 60 * 1000,
    blockNumber: block(index),
  };
}).sort((a, b) => b.timestamp - a.timestamp);
