import type { CampaignStatus, OperationType, ProposalType } from '../types';

export const ETH_DECIMALS = 18n;
export const WEI_PER_ETH = 10n ** ETH_DECIMALS;

export function ethToWei(eth: number): string {
  const scaled = BigInt(Math.round(eth * 1_000_000));
  return (scaled * 10n ** 12n).toString();
}

export function weiToEth(wei: string): number {
  return Number(BigInt(wei)) / Number(WEI_PER_ETH);
}

export function formatEth(wei: string, digits = 2): string {
  return `${weiToEth(wei).toFixed(digits)} ETH`;
}

export function shortAddress(address: string, head = 6, tail = 4): string {
  return `${address.slice(0, head)}...${address.slice(-tail)}`;
}

export function relativeTime(timestamp: number): string {
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  return `${Math.floor(days / 30)}个月前`;
}

export function progressPercent(raised: string, target: string): number {
  const targetValue = weiToEth(target);
  if (!targetValue) return 0;
  return Math.min(100, (weiToEth(raised) / targetValue) * 100);
}

export function addWei(a: string, b: string): string {
  return (BigInt(a) + BigInt(b)).toString();
}

/** 把对象数组转成 CSV 文本，字段内的逗号与引号自动转义 */
export function toCsv(rows: Record<string, string | number>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (value: string | number) => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(',')),
  ].join('\n');
}

/**
 * 由种子生成稳定的伪哈希，用于种子数据里的交易哈希 / Merkle 根。
 *
 * 注意不能用「字符求和 + LCG」那种写法：字符和相同的种子会生成完全一样的哈希，
 * 列表里就会出现两条不同流水挂着同一个交易哈希。这里先做 FNV-1a 把种子摊开，
 * 再用 xorshift 逐字节扩展，只要种子不同结果就不同。
 */
export function randomHash(seed: string): string {
  const alphabet = '0123456789abcdef';
  let state = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    state ^= seed.charCodeAt(i);
    state = Math.imul(state, 16777619) >>> 0;
  }
  let hash = '0x';
  for (let i = 0; i < 64; i += 1) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    hash += alphabet[state % 16];
  }
  return hash;
}

export function statusLabel(status: CampaignStatus): string {
  return {
    ACTIVE: '进行中',
    PENDING: '待审核',
    FUNDED: '已筹满',
    COMPLETED: '已完成',
    REJECTED: '已拒绝',
  }[status];
}

export function proposalTypeLabel(type: ProposalType): string {
  return {
    FUND_RELEASE: '资金拨付',
    CAMPAIGN_APPROVAL: '项目上架',
    AUDIT_RULE_CHANGE: '审计规则',
  }[type];
}

export function operationLabel(type: OperationType): string {
  return {
    DEPOSIT: '捐款入池',
    WITHDRAWAL: '资金拨付',
    GAS_FEE: 'Gas费用',
    REFUND: '退款',
    PROPOSAL_EXECUTION: '提案执行',
    EVIDENCE: '材料存证',
    FREEZE: '项目冻结',
  }[type];
}
