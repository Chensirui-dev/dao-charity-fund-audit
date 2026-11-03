import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  Database,
  Download,
  ExternalLink,
  Info,
  Layers,
  X,
} from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useClipboard } from '../../hooks/useClipboard';
import { usePagination } from '../../hooks/usePagination';
import { useSortable } from '../../hooks/useSortable';
import type { AuditLog, AuditStatus, OperationType } from '../../types';
import { addWei, formatEth, operationLabel, relativeTime, toCsv, weiToEth } from '../../utils/format';
import { Address } from '../ui/Address';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Pagination } from '../ui/Pagination';
import { MerkleProofCard } from './MerkleProofCard';
import { explorerTxUrl } from '../../contracts/config';

const operationOptions: OperationType[] = ['DEPOSIT', 'WITHDRAWAL', 'GAS_FEE', 'REFUND', 'PROPOSAL_EXECUTION', 'EVIDENCE', 'FREEZE'];
const statusOptions: AuditStatus[] = ['PENDING', 'CONFIRMED', 'FLAGGED'];

/** 每条记录用一句业务语言解释，避免详情区只有编号没有含义 */
const OPERATION_HINT: Record<OperationType, string> = {
  DEPOSIT: '捐赠资金直接进入项目专户，不经过任何个人账户，专款专用。',
  WITHDRAWAL: '理事会表决通过后，资金从专户转出到立项时登记的收款地址。',
  GAS_FEE: '链上交易手续费，由发起交易的账户承担，不计入项目资金。',
  REFUND: '项目终止或未达目标时，按原捐赠比例退回给捐赠人。',
  PROPOSAL_EXECUTION: '治理提案执行产生的资金或状态变更，附带表决结果。',
  EVIDENCE: '受助方提交用款申请时，材料文件的 SHA-256 摘要写入链上，原件留存在链下。',
  FREEZE: '审计员发现材料造假或资金去向异常时冻结项目，冻结理由摘要一并写入链上。',
};

function StatusIcon({ status }: { status: AuditStatus }) {
  if (status === 'CONFIRMED') return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  if (status === 'FLAGGED') return <AlertCircle className="h-4 w-4 text-red-400" />;
  return <Clock className="h-4 w-4 text-gold" />;
}

export function AuditTable({ logs, initialCampaignId }: { logs: AuditLog[]; initialCampaignId?: string }) {
  const [selectedOps, setSelectedOps] = useState<OperationType[]>([]);
  const [status, setStatus] = useState<'ALL' | AuditStatus>('ALL');
  const [campaignId, setCampaignId] = useState<string>(initialCampaignId && initialCampaignId !== 'ALL' ? initialCampaignId : 'ALL');
  const [expanded, setExpanded] = useState<string | null>(null);
  const { permissions, roleProfiles, currentRole, notifyCopied, campaigns } = useApp();
  const { copyToClipboard } = useClipboard();

  const copyHash = async (value: string) => {
    await copyToClipboard(value);
    notifyCopied(value);
  };

  /** 每个项目的流水条数，给选择器带上数量，避免空点 */
  const countByCampaign = useMemo(() => {
    const map = new Map<string, number>();
    logs.forEach((log) => map.set(log.campaignId, (map.get(log.campaignId) ?? 0) + 1));
    return map;
  }, [logs]);

  const activeCampaign = campaigns.find((item) => item.id === campaignId);

  const filtered = useMemo(
    () =>
      logs.filter((log) => {
        const campaignMatch = campaignId === 'ALL' || log.campaignId === campaignId;
        const opMatch = selectedOps.length === 0 || selectedOps.includes(log.operationType);
        const statusMatch = status === 'ALL' || log.status === status;
        return campaignMatch && opMatch && statusMatch;
      }),
    [logs, campaignId, selectedOps, status],
  );
  const { sortedData, toggleSort } = useSortable(filtered);
  const pagination = usePagination(sortedData, 12);

  /** 当前台账的资金概览：只看本项目，不看全站 */
  const summary = useMemo(() => {
    const inflow = filtered
      .filter((log) => log.operationType === 'DEPOSIT')
      .reduce((sum, log) => addWei(sum, log.amount), '0');
    const outflow = filtered
      .filter((log) => log.operationType === 'WITHDRAWAL' || log.operationType === 'REFUND')
      .reduce((sum, log) => addWei(sum, log.amount), '0');
    return {
      inflow,
      outflow,
      pending: filtered.filter((log) => log.status === 'PENDING').length,
      flagged: filtered.filter((log) => log.status === 'FLAGGED').length,
    };
  }, [filtered]);

  const toggleOp = (operation: OperationType) => {
    setSelectedOps((current) => (current.includes(operation) ? current.filter((item) => item !== operation) : [...current, operation]));
  };

  const exportCsv = () => {
    const rows = sortedData.map((log) => ({
      项目: campaigns.find((item) => item.id === log.campaignId)?.name ?? log.campaignId ?? '未归属',
      交易哈希: log.txHash,
      操作类型: operationLabel(log.operationType),
      金额ETH: weiToEth(log.amount).toFixed(4),
      发送方: log.fromAddress,
      接收方: log.toAddress,
      Gas用量: log.gasUsed,
      区块号: log.blockNumber,
      时间: new Date(log.timestamp).toLocaleString('zh-CN', { hour12: false }),
      状态: log.status,
    }));
    const csv = toCsv(rows);
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `审计台账-${activeCampaign?.name ?? '全部项目'}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-xl px-3 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
              <Layers className="h-3.5 w-3.5" /> 台账范围
            </span>
            <select
              className="min-h-10 rounded-xl border border-line bg-black/30 px-3 text-sm outline-none focus:border-gold/60"
              value={campaignId}
              onChange={(event) => {
                setCampaignId(event.target.value);
                setExpanded(null);
              }}
            >
              <option value="ALL">全部项目（{logs.length} 笔）</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}（{countByCampaign.get(campaign.id) ?? 0} 笔）
                </option>
              ))}
            </select>
            {campaignId !== 'ALL' ? (
              <button
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-gold"
                type="button"
                onClick={() => setCampaignId('ALL')}
              >
                <X className="h-3 w-3" /> 返回全站台账
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <select className="min-h-10 rounded-xl border border-line bg-black/30 px-3 text-sm outline-none focus:border-gold/60" value={status} onChange={(event) => setStatus(event.target.value as 'ALL' | AuditStatus)}>
              <option value="ALL">全部状态</option>
              {statusOptions.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={!sortedData.length}>
              导出CSV
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 border-t border-line/60 pt-3">
          {operationOptions.map((operation) => (
            <Button key={operation} variant={selectedOps.includes(operation) ? 'outline' : 'ghost'} onClick={() => toggleOp(operation)}>
              {operationLabel(operation)}
            </Button>
          ))}
        </div>
      </div>

      {campaignId !== 'ALL' && activeCampaign ? (
        <div className="glass-card rounded-xl px-3 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-sm text-zinc-500">项目台账</span>
              <span className="font-semibold text-zinc-100">{activeCampaign.name}</span>
              <Badge kind={activeCampaign.status} />
            </div>
            <span className="text-xs text-zinc-600">仅展示该项目流水，合计 {filtered.length} 笔</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCell label="资金流入" value={`${formatEth(summary.inflow)}`} icon={<ArrowDownLeft className="h-3.5 w-3.5 text-emerald-400" />} />
            <SummaryCell label="已拨付" value={`${formatEth(summary.outflow)}`} icon={<ArrowUpRight className="h-3.5 w-3.5 text-gold" />} />
            <SummaryCell label="待确认" value={`${summary.pending} 笔`} icon={<Clock className="h-3.5 w-3.5 text-gold" />} />
            <SummaryCell label="异常预警" value={`${summary.flagged} 笔`} icon={<AlertCircle className="h-3.5 w-3.5 text-red-400" />} />
          </div>
        </div>
      ) : null}

      {!filtered.length ? (
        <EmptyState title="没有匹配审计记录" />
      ) : (
        <div className="glass-card overflow-x-auto rounded-xl scrollbar-thin">
          <table className="w-full min-w-[1140px] text-left text-sm">
            <thead className="bg-zinc-950 text-xs text-zinc-500">
              <tr>
                <th className="w-10 px-3 py-4" />
                <th className="px-3 py-4">{campaignId === 'ALL' ? '项目' : '序号'}</th>
                {[
                  ['txHash', '交易哈希'],
                  ['operationType', '操作类型'],
                  ['amount', '金额'],
                  ['fromAddress', '发送方'],
                  ['toAddress', '接收方'],
                  ['gasUsed', 'Gas费'],
                  ['timestamp', '时间'],
                  ['status', '状态'],
                ].map(([key, label]) => (
                  <th key={key} className="cursor-pointer whitespace-nowrap px-3 py-4 transition hover:text-gold" onClick={() => toggleSort(key as keyof AuditLog)}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagination.pageData.map((log) => (
                <Fragment key={log.id}>
                  <tr className="cursor-pointer border-t border-line transition hover:bg-card-hover" onClick={() => setExpanded(expanded === log.id ? null : log.id)}>
                    <td className="px-3 py-4">
                      <ChevronRight className={`h-4 w-4 text-zinc-500 transition ${expanded === log.id ? 'rotate-90 text-gold' : ''}`} />
                    </td>
                    <td className="px-3 py-4">
                      {campaignId === 'ALL' ? (
                        <button
                          type="button"
                          className="max-w-[150px] truncate text-left text-xs text-zinc-300 underline-offset-4 transition hover:text-gold hover:underline"
                          title="只看该项目的台账"
                          onClick={(event) => {
                            event.stopPropagation();
                            setCampaignId(log.campaignId);
                            setExpanded(null);
                          }}
                        >
                          {campaigns.find((item) => item.id === log.campaignId)?.name ?? '未归属'}
                        </button>
                      ) : (
                        <span className="font-mono text-[11px] text-zinc-500">
                          #{String(filtered.findIndex((item) => item.id === log.id) + 1).padStart(2, '0')}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-4"><Address value={log.txHash} /></td>
                    <td className="px-3 py-4"><Badge kind={log.operationType} /></td>
                    <td className="px-3 py-4 font-mono text-gold-light">{formatEth(log.amount)}</td>
                    <td className="px-3 py-4"><Address value={log.fromAddress} /></td>
                    <td className="px-3 py-4"><Address value={log.toAddress} /></td>
                    <td className="px-3 py-4 font-mono text-zinc-400">{log.gasUsed}</td>
                    <td className="px-3 py-4 text-zinc-500">{relativeTime(log.timestamp)}</td>
                    <td className="px-3 py-4">
                      <span className="inline-flex items-center gap-2"><StatusIcon status={log.status} /><Badge kind={log.status} /></span>
                    </td>
                  </tr>
                  {expanded === log.id ? (
                    <tr className="border-t border-line bg-black/25">
                      <td colSpan={10} className="p-5">
                        {!permissions.canViewAuditProofs ? (
                          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-4 text-sm text-red-200">
                            当前角色：{roleProfiles[currentRole].label}，无审计证明查看权限。请切换为审计员或 DAO 成员查看完整 TX Hash、区块高度与 Merkle Proof。
                          </div>
                        ) : (
                        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_352px] lg:items-start">
                          <div className="space-y-2.5">
                            <div className="overflow-hidden rounded-xl border border-line bg-card">
                              <div className="border-b border-line px-3 py-2">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-[11px] tracking-wider text-zinc-500">交易哈希</span>
                                  <div className="flex items-center gap-0.5">
                                    <button
                                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-zinc-400 transition hover:bg-zinc-800 hover:text-gold"
                                      type="button"
                                      onClick={() => void copyHash(log.txHash)}
                                    >
                                      <Copy className="h-3 w-3" /> 复制
                                    </button>
                                    <a
                                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-zinc-400 transition hover:bg-zinc-800 hover:text-gold"
                                      href={explorerTxUrl(log.txHash)}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      <ExternalLink className="h-3 w-3" /> 区块浏览器
                                    </a>
                                  </div>
                                </div>
                                <div className="mt-1 break-all font-mono text-[11px] leading-[1.45] text-zinc-300">{log.txHash}</div>
                              </div>

                              <div className="divide-y divide-line/60">
                                <DetailRow label="所属项目">
                                  <span className="text-zinc-200">{campaigns.find((item) => item.id === log.campaignId)?.name ?? '未归属项目'}</span>
                                </DetailRow>
                                <DetailRow label="区块号"><span className="font-mono text-zinc-200">{log.blockNumber}</span></DetailRow>
                                <DetailRow label="Gas 用量"><span className="font-mono text-zinc-200">{log.gasUsed}</span></DetailRow>
                                <DetailRow label="签名数">
                                  <span className="inline-flex items-center gap-2">
                                    <span className="font-mono text-zinc-200">{log.signatureCount}/3</span>
                                    <span className="flex gap-1">
                                      {[0, 1, 2].map((index) => (
                                        <span
                                          key={index}
                                          className={`h-1.5 w-1.5 rounded-full ${index < log.signatureCount ? 'bg-emerald-400' : 'bg-zinc-700'}`}
                                        />
                                      ))}
                                    </span>
                                  </span>
                                </DetailRow>
                                <DetailRow label="确认时间"><span className="font-mono text-zinc-200">{absoluteTime(log.timestamp)}</span></DetailRow>
                                <DetailRow label="操作类型"><Badge kind={log.operationType} /></DetailRow>
                                <DetailRow label="金额"><span className="font-mono text-zinc-200">{formatEth(log.amount)}</span></DetailRow>
                                <DetailRow label="发送方"><Address value={log.fromAddress} /></DetailRow>
                                <DetailRow label="接收方"><Address value={log.toAddress} /></DetailRow>
                                <DetailRow label="批次位置">
                                  <span className="font-mono text-[11px] text-zinc-400">
                                    #{logs.findIndex((item) => item.id === log.id) + 1} / {logs.length}
                                  </span>
                                </DetailRow>
                                <DetailRow label="锚定状态">
                                  <span className="inline-flex items-center gap-1 text-emerald-400">
                                    <CheckCircle2 className="h-3 w-3" /> 已纳入批次锚定
                                  </span>
                                </DetailRow>
                              </div>
                            </div>

                            <div className="rounded-xl border border-line bg-card px-3 py-2.5">
                              <div className="flex items-center gap-1.5 text-[11px] tracking-wider text-zinc-500">
                                <Info className="h-3 w-3" /> 这笔记录意味着什么
                              </div>
                              <p className="mt-1 text-xs leading-5 text-zinc-400">{OPERATION_HINT[log.operationType]}</p>
                              <div className="mt-2 flex items-start gap-1.5 border-t border-line/60 pt-2 text-[10px] leading-4 text-zinc-600">
                                <Database className="mt-0.5 h-3 w-3 flex-none" />
                                <span>明细存于链下索引以便逐条展示，批次根已锚定上链，两者可用 Merkle 证明对账。</span>
                              </div>
                            </div>
                          </div>
                          <MerkleProofCard log={log} logs={logs} />
                        </div>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
          <Pagination page={pagination.page} totalPages={pagination.totalPages} onPage={pagination.setPage} />
        </div>
      )}
    </div>
  );
}

function SummaryCell({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-card px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">{icon}{label}</div>
      <div className="mt-1 font-mono text-sm text-zinc-100">{value}</div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-3 py-[9px] text-xs">
      <span className="w-16 flex-none text-zinc-500">{label}</span>
      <div className="flex min-w-0 flex-1 items-center justify-end text-right">{children}</div>
    </div>
  );
}

function absoluteTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
