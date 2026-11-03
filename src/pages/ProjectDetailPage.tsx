import { Activity, ArrowLeft, Coins, FileText, ShieldAlert, Snowflake, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Address } from '../components/ui/Address';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Pagination } from '../components/ui/Pagination';
import { ProgressBar } from '../components/ui/ProgressBar';
import { useApp } from '../context/AppContext';
import { usePagination } from '../hooks/usePagination';
import { useSortable } from '../hooks/useSortable';
import { FundRequestModal } from '../components/projects/FundRequestModal';
import { campaignKeyOf, readAllFundRequestsOnchain, readCampaignAccountOnchain, type ChainCampaignAccount, type ChainFundRequest } from '../contracts/chainAdapter';
import { DEMO_ACCOUNT_ROLES } from '../contracts/config';
import type { AuditLog, Donation } from '../types';
import { shortHash } from '../utils/evidence';
import { formatEth, operationLabel, progressPercent, relativeTime, shortAddress } from '../utils/format';

type Tab = 'donations' | 'requests' | 'proposals' | 'audit';

/** 申请单状态码对应的展示样式，与合约里的 REQUEST_PENDING / RELEASED / CANCELLED 一一对应 */
const REQUEST_STATUS: Record<number, { label: string; className: string }> = {
  0: { label: '待审批', className: 'border-amber-500/50 bg-amber-500/15 text-amber-200' },
  1: { label: '已拨付', className: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200' },
  2: { label: '已撤回', className: 'border-zinc-500/50 bg-zinc-500/15 text-zinc-400' },
};

export function ProjectDetailPage() {
  const { id } = useParams();
  const { campaigns, donations, proposals, auditLogs, connectedWallet, refundDonation, freezeCampaign } = useApp();
  const [tab, setTab] = useState<Tab>('donations');
  const [showFundRequest, setShowFundRequest] = useState(false);
  const [chainAccount, setChainAccount] = useState<ChainCampaignAccount | null>(null);
  const [fundRequests, setFundRequests] = useState<ChainFundRequest[]>([]);
  const [showFreeze, setShowFreeze] = useState(false);
  const [freezeReason, setFreezeReason] = useState('');
  const [freezing, setFreezing] = useState(false);
  const campaign = campaigns.find((item) => item.id === id);

  // 分期进度、募资截止、申请单都在链上，本地 mock 数据里没有，需要单独读一次
  useEffect(() => {
    if (!campaign) return;
    let alive = true;
    const key = campaignKeyOf(campaign);
    Promise.all([
      readCampaignAccountOnchain(key).catch(() => null),
      readAllFundRequestsOnchain().catch(() => [] as ChainFundRequest[]),
    ]).then(([account, all]) => {
      if (!alive) return;
      setChainAccount(account);
      setFundRequests(all.filter((item) => item.campaignIdHex.toLowerCase() === key.toLowerCase()));
    });
    return () => {
      alive = false;
    };
  }, [campaign]);

  const relatedDonations = useMemo(() => donations.filter((item) => item.campaignId === id), [donations, id]);
  const relatedProposals = useMemo(() => proposals.filter((item) => item.targetId === id), [proposals, id]);
  const relatedAuditLogs = useMemo(() => {
    if (!campaign) return [];
    return auditLogs.filter((item) => item.campaignId === campaign.id);
  }, [auditLogs, campaign]);

  if (!campaign) return <Navigate to="/projects" replace />;

  const percent = progressPercent(campaign.raisedAmount, campaign.targetAmount);
  const isRecipient = !!connectedWallet && connectedWallet.toLowerCase() === campaign.recipientAddress.toLowerCase();
  // 审计员身份取自演示账户映射，与链上 setAuditor 指定的地址一致
  const isAuditor = !!connectedWallet && DEMO_ACCOUNT_ROLES[connectedWallet.toLowerCase()] === 'AUDITOR';
  // 冻结状态以链上为准：本地 reducer 只会乐观置真，解冻后靠定时同步回落
  const isFrozen = campaign.frozen === true || chainAccount?.frozen === true;
  // 募资失败才开放退款：截止时间已过、未达目标额、且一期都没拨过
  const canRefund = !!chainAccount
    && chainAccount.deadline > 0
    && Date.now() > chainAccount.deadline
    && BigInt(chainAccount.raised) < BigInt(chainAccount.targetAmount)
    && BigInt(chainAccount.released) === 0n;
  // 已上链但尚未拨付的申请单：金额与材料摘要都已固定，只差一次治理表决
  const pendingRequest = fundRequests.find((item) => item.statusCode === 0);

  return (
    <div className="space-y-6">
      <Link to="/projects" className="inline-flex items-center gap-2 text-sm text-zinc-500 transition hover:text-gold">
        <ArrowLeft className="h-4 w-4" /> 返回项目列表
      </Link>
      <div className={`glass-card overflow-hidden rounded-xl`}>
        <div className={`relative h-56 overflow-hidden bg-gradient-to-br ${campaign.coverGradient || 'from-gold/30 via-emerald-500/20 to-blue-500/25'}`}>
          {campaign.coverImage ? (
            <img
              src={campaign.coverImage}
              alt={campaign.name}
              className="h-full w-full object-cover"
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/10" />
        </div>
        <div className="space-y-5 p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-bold gold-text">{campaign.name}</h1>
                <Badge kind={campaign.status} />
                {isFrozen ? (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-sky-500/50 bg-sky-500/15 px-2 py-1 text-xs font-semibold text-sky-200">
                    <Snowflake className="h-3.5 w-3.5" /> 已冻结
                  </span>
                ) : null}
              </div>
              <p className="mt-3 max-w-3xl text-zinc-400">{campaign.description}</p>
            </div>
            <div className="grid gap-2 text-sm text-zinc-500 sm:grid-cols-2 lg:min-w-96">
              <div>受助方 <Address value={campaign.recipientAddress} /></div>
              <div>多签库 <Address value={campaign.multiSigAddress} /></div>
              <div>创建者 <Address value={campaign.creatorAddress} /></div>
              <div>提案 <span className="font-mono text-zinc-300">{campaign.proposalId}</span></div>
            </div>
          </div>
          <div>
            <div className="mb-2 flex justify-between font-mono text-sm">
              <span className="text-gold-light">{formatEth(campaign.raisedAmount)}</span>
              <span className="text-emerald-300">{percent.toFixed(1)}%</span>
              <span className="text-zinc-500">{formatEth(campaign.targetAmount)}</span>
            </div>
            <ProgressBar value={percent} large />
            {chainAccount && chainAccount.milestoneCount > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-zinc-500">
                <span>
                  分期拨付
                  <span className="ml-1 font-mono text-zinc-300">
                    {chainAccount.milestonesReleased} / {chainAccount.milestoneCount} 期
                  </span>
                </span>
                {chainAccount.deadline > 0 ? (
                  <span>
                    募资截止
                    <span className="ml-1 font-mono text-zinc-300">
                      {new Date(chainAccount.deadline).toLocaleString('zh-CN')}
                    </span>
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              {isRecipient && !isFrozen ? (
                pendingRequest ? (
                  <Button variant="outline" disabled title="同一项目已有一张待审批申请单">
                    <FileText className="mr-2 h-4 w-4" /> 用款申请已提交（待审批）
                  </Button>
                ) : (
                  <Button onClick={() => setShowFundRequest(true)}>
                    <FileText className="mr-2 h-4 w-4" /> 提交用款申请
                  </Button>
                )
              ) : null}
              {canRefund && !isFrozen ? (
                <Button variant="outline" onClick={() => refundDonation(campaign.id)}>
                  <Undo2 className="mr-2 h-4 w-4" /> 申请退款
                </Button>
              ) : null}
              {isAuditor && !isFrozen ? (
                showFreeze ? (
                  <div className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
                    <input
                      className="min-w-64 flex-1 rounded-lg border border-line bg-black/40 px-3 py-2 text-sm outline-none focus:border-red-400/60"
                      placeholder="填写冻结理由，例如：发票与验收单金额不符"
                      value={freezeReason}
                      onChange={(event) => setFreezeReason(event.target.value)}
                    />
                    <Button
                      variant="danger"
                      loading={freezing}
                      onClick={async () => {
                        setFreezing(true);
                        await freezeCampaign({ campaignId: campaign.id, reason: freezeReason });
                        setFreezing(false);
                        setShowFreeze(false);
                        setFreezeReason('');
                      }}
                    >
                      确认冻结
                    </Button>
                    <Button variant="ghost" onClick={() => setShowFreeze(false)}>取消</Button>
                  </div>
                ) : (
                  <Button variant="outline" onClick={() => setShowFreeze(true)}>
                    <ShieldAlert className="mr-2 h-4 w-4" /> 冻结项目
                  </Button>
                )
              ) : null}
            </div>

            {pendingRequest ? (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-200">
                <div className="flex flex-wrap items-center gap-2">
                  <Coins className="h-4 w-4" />
                  <span className="font-semibold">链上已有待审批用款申请单</span>
                  <span className="font-mono text-amber-100">#{pendingRequest.requestId}</span>
                  <span className="font-mono text-amber-100">{formatEth(pendingRequest.amountWei, 4)}</span>
                  <span className="inline-flex items-center rounded-full border border-amber-400/60 bg-amber-400/20 px-2 py-0.5 text-[11px] font-semibold text-amber-100">
                    待审批
                  </span>
                </div>
                <div className="mt-1.5 text-amber-200/80">
                  材料摘要 <span className="font-mono">{shortHash(pendingRequest.evidenceHash)}</span>，
                  由 <span className="font-mono">{shortAddress(pendingRequest.requester)}</span>
                  <span className="mx-1">在</span>
                  {relativeTime(pendingRequest.createdAt)}
                  <span className="ml-1">提交。</span>
                  钱还锁在金库里一分未动，必须在治理页针对这张单子发起拨付提案、表决通过后才会按里程碑转账。
                </div>
              </div>
            ) : null}

            {isFrozen ? (
              <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-3 text-xs leading-relaxed text-sky-200">
                项目已被审计员冻结：捐款、用款申请、资金拨付、退款四个入口全部关闭，账本一分不动。
                解冻不能由审计员自己完成，必须经理事会表决后由治理合约调用 —— 否则冻结权会变成要挟工具。
              </div>
            ) : null}

            {!isFrozen && !isRecipient && !canRefund && !isAuditor ? (
              <div className="text-xs leading-relaxed text-zinc-500">
                {pendingRequest ? (
                  <>
                    这张申请单已由链上登记的收款地址
                    <span className="mx-1 font-mono text-zinc-400">{shortAddress(campaign.recipientAddress)}</span>
                    提交完毕，当前钱包
                    <span className="mx-1 font-mono text-zinc-400">{connectedWallet ? shortAddress(connectedWallet) : '未连接'}</span>
                    是表决方身份：审批走治理页，不在这里重复提交。
                  </>
                ) : (
                  <>
                    本页按钮按钱包身份显示。用款申请只对链上登记的收款地址
                    <span className="mx-1 font-mono text-zinc-400">{shortAddress(campaign.recipientAddress)}</span>
                    开放，当前钱包是
                    <span className="mx-1 font-mono text-zinc-400">{connectedWallet ? shortAddress(connectedWallet) : '未连接'}</span>
                    ；捐款入口在右侧项目卡片。
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {[
          ['donations', '捐款记录'],
          ['requests', `用款申请 (${fundRequests.length})`],
          ['proposals', '关联提案'],
          ['audit', '审计追踪'],
        ].map(([value, label]) => (
          <Button key={value} variant={tab === value ? 'outline' : 'ghost'} onClick={() => setTab(value as Tab)}>
            {label}
          </Button>
        ))}
      </div>
      {tab === 'donations' && <DonationTable donations={relatedDonations} />}
      {tab === 'requests' && <FundRequestTable requests={fundRequests} />}
      {tab === 'proposals' && <ProposalList proposals={relatedProposals} />}
      {tab === 'audit' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-zinc-500">本项目共 {relatedAuditLogs.length} 笔链上流水，明细可与 Merkle 证明逐条对账。</p>
            <Link to={`/audit?campaign=${campaign.id}`}>
              <Button variant="outline" icon={<Activity className="h-4 w-4" />}>查看完整审计台账</Button>
            </Link>
          </div>
          <AuditMiniTable logs={relatedAuditLogs} />
        </div>
      )}
    </div>
  );
}

function DonationTable({ donations }: { donations: Donation[] }) {
  const { sortedData, toggleSort } = useSortable(donations);
  const pagination = usePagination(sortedData, 8);
  if (!donations.length) return <EmptyState title="暂无捐赠记录" />;
  return (
    <div className="glass-card overflow-hidden rounded-xl">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-zinc-950 text-xs text-zinc-500">
          <tr>
            <th className="p-4">交易</th>
            <th className="p-4">捐赠者</th>
            <th className="cursor-pointer p-4" onClick={() => toggleSort('amount')}>金额</th>
            <th className="p-4">留言</th>
            <th className="p-4">时间</th>
          </tr>
        </thead>
        <tbody>
          {pagination.pageData.map((donation) => (
            <tr key={donation.id} className="border-t border-line transition hover:bg-card-hover">
              <td className="p-4 font-mono text-xs text-zinc-400">{shortAddress(donation.txHash, 10, 6)}</td>
              <td className="p-4"><Address value={donation.donorAddress} /></td>
              <td className="p-4 font-mono text-gold-light">{formatEth(donation.amount)}</td>
              <td className="p-4 text-zinc-400">{donation.message}</td>
              <td className="p-4 text-zinc-500">{relativeTime(donation.timestamp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination page={pagination.page} totalPages={pagination.totalPages} onPage={pagination.setPage} />
    </div>
  );
}

function FundRequestTable({ requests }: { requests: ChainFundRequest[] }) {
  if (!requests.length) {
    return (
      <EmptyState
        title="本项目还没有用款申请单"
        description="受助方提交用款申请后，金额与材料摘要会立刻写到链上，任何人可查、提交后不可改。"
      />
    );
  }
  return (
    <div className="glass-card overflow-x-auto rounded-xl scrollbar-thin">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="bg-zinc-950 text-xs text-zinc-500">
          <tr>
            <th className="p-4">单号</th>
            <th className="p-4">申请金额</th>
            <th className="p-4">材料摘要（SHA-256）</th>
            <th className="p-4">申请人</th>
            <th className="p-4">提交时间</th>
            <th className="p-4">状态</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((item) => {
            const status = REQUEST_STATUS[item.statusCode] ?? { label: `未知(${item.statusCode})`, className: 'border-zinc-500/50 bg-zinc-500/15 text-zinc-400' };
            return (
              <tr key={item.requestId} className="border-t border-line transition hover:bg-card-hover">
                <td className="p-4 font-mono text-gold-light">#{item.requestId}</td>
                <td className="p-4 font-mono text-gold-light">{formatEth(item.amountWei, 4)}</td>
                <td className="p-4 font-mono text-xs text-zinc-400">{shortHash(item.evidenceHash)}</td>
                <td className="p-4"><Address value={item.requester} /></td>
                <td className="p-4 text-zinc-500">{relativeTime(item.createdAt)}</td>
                <td className="p-4">
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${status.className}`}>
                    {status.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-line px-4 py-3 text-xs text-zinc-500">
        申请单只固定「要多少钱、依据什么材料」，不移动资金。真正拨款由治理提案表决后调用金库完成，
        且每次只能支取一期额度、累计不超过已募金额。
      </p>
    </div>
  );
}

function ProposalList({ proposals }: { proposals: ReturnType<typeof useApp>['proposals'] }) {
  if (!proposals.length) return <EmptyState title="暂无关联提案" />;
  return (
    <div className="space-y-3">
      {proposals.map((proposal) => (
        <Link key={proposal.id} to="/governance" className="glass-card block rounded-xl p-4 transition hover:border-line-gold hover:bg-card-hover">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-lg text-gold-light">{typeof proposal.onchainId === 'number' ? `#${proposal.onchainId}` : proposal.id}</span>
            <Badge kind={proposal.type} />
            <Badge kind={proposal.status} />
          </div>
          <div className="mt-2 font-semibold text-zinc-100">{proposal.title}</div>
          <p className="mt-1 text-sm text-zinc-500">{proposal.description}</p>
        </Link>
      ))}
    </div>
  );
}

function AuditMiniTable({ logs }: { logs: AuditLog[] }) {
  if (!logs.length) return <EmptyState title="暂无项目审计记录" />;
  return (
    <div className="glass-card overflow-x-auto rounded-xl scrollbar-thin">
      <table className="w-full min-w-[820px] text-left text-sm">
        <thead className="bg-zinc-950 text-xs text-zinc-500">
          <tr>
            <th className="p-4">哈希</th>
            <th className="p-4">操作</th>
            <th className="p-4">金额</th>
            <th className="p-4">区块</th>
            <th className="p-4">状态</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className="border-t border-line transition hover:bg-card-hover">
              <td className="p-4 font-mono text-xs text-zinc-400">{shortAddress(log.txHash, 10, 6)}</td>
              <td className="p-4">{operationLabel(log.operationType)}</td>
              <td className="p-4 font-mono text-gold-light">{formatEth(log.amount)}</td>
              <td className="p-4 font-mono text-zinc-400">{log.blockNumber}</td>
              <td className="p-4"><Badge kind={log.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
