import { ExternalLink, LockKeyhole, PlayCircle, Timer, Vote } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useCountdown } from '../../hooks/useCountdown';
import { useGovernanceParams, useNow } from '../../hooks/useGovernanceParams';
import { explorerTxUrl, IS_ONCHAIN } from '../../contracts/config';
import type { Proposal } from '../../types';
import { formatEth, proposalTypeLabel, shortAddress } from '../../utils/format';
import { Address } from '../ui/Address';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

/** 把剩余毫秒格式化成 mm:ss / hh:mm:ss */
function formatRemain(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function ProposalCard({ proposal, onVote }: { proposal: Proposal; onVote: (proposal: Proposal) => void }) {
  const { executeProposal, settleProposals, permissions, roleProfiles, currentRole } = useApp();
  const [executing, setExecuting] = useState(false);
  const countdown = useCountdown(proposal.endTime, settleProposals);
  const govParams = useGovernanceParams();
  const now = useNow();
  const totalVotes = proposal.votesFor + proposal.votesAgainst;
  const forRatio = totalVotes ? (proposal.votesFor / totalVotes) * 100 : 0;
  const isActive = proposal.status === 'ACTIVE';
  const roleLabel = roleProfiles[currentRole].label;

  const hasOnchainId = typeof proposal.onchainId === 'number';
  // 真实链模式下，没有链上编号的提案只是展示用的示例数据，不能投票也不能执行
  const isDemo = IS_ONCHAIN && !hasOnchainId;

  // 提案判定通过后还要等时间锁走完才能执行，留出异议窗口
  const timelockMs = (govParams?.timelockSeconds ?? 0) * 1000;
  const timelockLeftMs = Math.max(0, proposal.endTime + timelockMs - now);
  const timelockPending = proposal.status === 'PASSED' && !isDemo && timelockLeftMs > 0;
  const canExecute = proposal.status === 'PASSED' && !isDemo && !timelockPending;

  const handleExecute = async () => {
    setExecuting(true);
    await executeProposal(proposal.id);
    setExecuting(false);
  };

  return (
    <div className={`glass-card grid gap-5 rounded-xl p-5 transition hover:border-line-gold hover:bg-card-hover lg:grid-cols-[150px_1fr_300px] ${isDemo ? 'opacity-80' : ''}`}>
      <div>
        <div className="font-mono text-3xl font-bold text-gold-light">
          {hasOnchainId ? `#${proposal.onchainId}` : proposal.id.replace('prop-', '#')}
        </div>
        <div className="mt-2 text-xs text-zinc-500">{proposalTypeLabel(proposal.type)}</div>
        {hasOnchainId ? <div className="mt-1 text-[11px] text-emerald-400">已上链</div> : null}
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold text-zinc-100">{proposal.title}</h3>
          <Badge kind={proposal.type} />
          <Badge kind={proposal.status} />
        </div>
        <p className="text-sm text-zinc-500">{proposal.description}</p>
        <div className="flex flex-wrap gap-4 text-sm text-zinc-500">
          <span>发起人 <Address value={proposal.proposerAddress} /></span>
          <span>
            目标 <span className="font-mono text-zinc-300">{proposal.targetId.startsWith('0x') ? shortAddress(proposal.targetId, 10, 6) : proposal.targetId}</span>
          </span>
          {isActive && !isDemo ? (
            <span>
              倒计时 <span className="font-mono text-emerald-300">{countdown.days}d {countdown.hours}h {countdown.minutes}m {countdown.seconds}s</span>
            </span>
          ) : null}
        </div>
        {proposal.type === 'FUND_RELEASE' && proposal.amountWei ? (
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-black/20 px-3 py-2 text-sm">
            <span className="text-zinc-500">拨付金额 <span className="font-mono text-gold-light">{formatEth(proposal.amountWei, 6)}</span></span>
            {proposal.recipientAddress ? <span className="text-zinc-500">收款方 <Address value={proposal.recipientAddress} /></span> : null}
          </div>
        ) : null}
        {proposal.executionTxHash ? (
          <a
            href={explorerTxUrl(proposal.executionTxHash)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-xs text-emerald-400 transition hover:text-emerald-300"
          >
            执行交易 {shortAddress(proposal.executionTxHash, 12, 8)} <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </div>
      <div className="space-y-4">
        <div>
          <div className="mb-2 flex justify-between text-xs text-zinc-500">
            <span>赞成 {proposal.votesFor}</span>
            <span>反对 {proposal.votesAgainst}</span>
          </div>
          <div className="flex h-3 overflow-hidden rounded-full bg-zinc-800">
            <div className="bg-emerald-500 shadow-emerald transition-all duration-500" style={{ width: `${forRatio}%` }} />
            <div className="bg-red-500 transition-all duration-500" style={{ width: `${100 - forRatio}%` }} />
          </div>
          <div className="mt-2 text-xs text-zinc-500">投票权重合计 <span className="font-mono text-zinc-300">{totalVotes}</span></div>
        </div>
        {canExecute ? (
          <div>
            <Button className="w-full" loading={executing} disabled={!permissions.canExecuteProposal} icon={permissions.canExecuteProposal ? <PlayCircle className="h-4 w-4" /> : <LockKeyhole className="h-4 w-4" />} onClick={handleExecute}>
              {proposal.type === 'FUND_RELEASE' ? '执行拨付' : '执行'}
            </Button>
            {!permissions.canExecuteProposal ? <div className="mt-2 text-xs text-zinc-600">当前角色：{roleLabel}，无执行权限</div> : null}
          </div>
        ) : timelockPending ? (
          <div className="rounded-xl border border-gold/30 bg-gold/[0.06] px-3 py-3 text-center">
            <div className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
              <Timer className="h-3.5 w-3.5" /> 执行时间锁
            </div>
            <div className="mt-1 font-mono text-2xl text-gold-light">{formatRemain(timelockLeftMs)}</div>
            <div className="mt-1 text-[11px] leading-relaxed text-zinc-500">
              已通过，等待异议窗口结束
            </div>
          </div>
        ) : isActive ? (
          <div>
            <Button className="w-full" icon={permissions.canVote ? <Vote className="h-4 w-4" /> : <LockKeyhole className="h-4 w-4" />} disabled={!isActive || !permissions.canVote || isDemo} onClick={() => onVote(proposal)}>
              投票
            </Button>
            {!isDemo && isActive && !permissions.canVote ? <div className="mt-2 text-xs text-zinc-600">当前角色：{roleLabel}，无投票权限</div> : null}
          </div>
        ) : (
          <div className="rounded-xl border border-line bg-black/20 px-3 py-3 text-center">
            <div className="text-sm text-zinc-400">
              {proposal.status === 'EXECUTED' ? '提案已执行' : proposal.status === 'REJECTED' ? '提案未通过' : '投票已结束'}
            </div>
            <div className="mt-1 text-[11px] leading-relaxed text-zinc-600">
              {proposal.status === 'EXECUTED'
                ? '执行结果已同步写入链上审计台账'
                : proposal.status === 'REJECTED'
                  ? '未达法定人数或反对票不少于赞成票'
                  : '等待结算'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
