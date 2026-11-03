import { ChevronDown, ChevronRight, LockKeyhole, Plus, Vote } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ProposalCard } from '../components/governance/ProposalCard';
import { VoteModal } from '../components/governance/VoteModal';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { useApp } from '../context/AppContext';
import type { Proposal } from '../types';

export function GovernancePage() {
  const { proposals, permissions, currentRole, roleProfiles } = useApp();
  const [tab, setTab] = useState<'ACTIVE' | 'ENDED'>('ACTIVE');
  const [voting, setVoting] = useState<Proposal | null>(null);
  const [showDemo, setShowDemo] = useState(false);
  // 「进行中」包含已通过但还没执行的提案，否则投票一结束提案就从视野里消失，执行按钮找不到了
  const visible = proposals.filter((proposal) => (
    tab === 'ACTIVE'
      ? proposal.status === 'ACTIVE' || proposal.status === 'PASSED'
      : proposal.status === 'EXECUTED' || proposal.status === 'REJECTED'
  ));
  const onchainList = visible.filter((proposal) => typeof proposal.onchainId === 'number');
  const demoList = visible.filter((proposal) => typeof proposal.onchainId !== 'number');
  const createDisabled = !permissions.canCreateProposal;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-zinc-500">多签金库与成员投票</p>
          <h1 className="mt-2 text-3xl font-bold gold-text">DAO治理</h1>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          {createDisabled ? (
            <Button disabled icon={<LockKeyhole className="h-4 w-4" />}>创建提案</Button>
          ) : (
            <Link to="/governance/create">
              <Button icon={<Plus className="h-4 w-4" />}>创建提案</Button>
            </Link>
          )}
          {createDisabled ? <span className="text-xs text-zinc-600">当前角色：{roleProfiles[currentRole].label}，无创建提案权限</span> : null}
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant={tab === 'ACTIVE' ? 'outline' : 'ghost'} onClick={() => setTab('ACTIVE')}>进行中</Button>
        <Button variant={tab === 'ENDED' ? 'outline' : 'ghost'} onClick={() => setTab('ENDED')}>已结束</Button>
      </div>
      {visible.length ? (
        <div className="space-y-6">
          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold text-emerald-300">链上提案</h2>
              <span className="text-xs text-zinc-600">编号、票数、金额与状态都从合约读取，四个浏览器看到的是同一份数据</span>
            </div>
            {onchainList.length ? (
              onchainList.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} onVote={setVoting} />)
            ) : (
              <div className="rounded-xl border border-dashed border-line bg-card/40 px-6 py-12 text-center">
                <Vote className="mx-auto h-8 w-8 text-zinc-700" />
                <p className="mt-3 text-sm text-zinc-400">
                  {tab === 'ACTIVE' ? '当前没有正在投票的链上提案' : '还没有已结束的链上提案'}
                </p>
                <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-zinc-600">
                  {tab === 'ACTIVE'
                    ? '点右上角「创建提案」发起一条，四个浏览器会同时出现，并进入链上投票期'
                    : '提案执行完成后会归档到这里，并写入审计台账'}
                </p>
              </div>
            )}
          </section>

          {/* 示例提案默认收起：12 条全铺开会把真实链上提案挤下去，也让人误以为系统里都是假数据 */}
          {demoList.length ? (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-sm font-semibold text-zinc-400">历史演示数据</h2>
                <span className="text-xs text-zinc-600">{demoList.length} 条，用于图表统计，未上链、不可投票</span>
                <Button variant="ghost" onClick={() => setShowDemo((value) => !value)}>
                  {showDemo ? '收起' : `展开查看`}
                  {showDemo ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </Button>
              </div>
              {showDemo
                ? demoList.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} onVote={setVoting} />)
                : null}
            </section>
          ) : null}
        </div>
      ) : (
        <EmptyState title={tab === 'ACTIVE' ? '暂无活跃提案' : '暂无已结束提案'} />
      )}
      <VoteModal proposal={voting} onClose={() => setVoting(null)} />
    </div>
  );
}
