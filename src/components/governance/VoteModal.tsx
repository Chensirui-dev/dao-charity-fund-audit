import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import type { Proposal } from '../../types';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

export function VoteModal({ proposal, onClose }: { proposal: Proposal | null; onClose: () => void }) {
  const { castVote, permissions, currentRole, roleProfiles } = useApp();
  const [loading, setLoading] = useState<'for' | 'against' | null>(null);

  const vote = async (support: boolean) => {
    if (!proposal || !permissions.canVote) return;
    setLoading(support ? 'for' : 'against');
    await castVote(proposal.id, support);
    setLoading(null);
    onClose();
  };

  const isDemo = !!proposal && typeof proposal.onchainId !== 'number';

  return (
    <Modal open={!!proposal} title="DAO投票" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <div className="font-semibold text-zinc-100">{proposal?.title}</div>
          <p className="mt-2 text-sm text-zinc-500">{proposal?.description}</p>
        </div>
        {isDemo ? (
          <div className="rounded-xl border border-zinc-600/50 bg-zinc-500/10 p-3 text-sm text-zinc-300">
            这是一条未上链的示例提案，仅用于统计展示，不能真实投票。请先在「创建提案」里发起一条真实提案。
          </div>
        ) : null}
        {!permissions.canVote ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            当前角色：{roleProfiles[currentRole].label}，无 DAO 投票权限。请切换为 DAO 成员演示该流程。
          </div>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <button disabled={!permissions.canVote || !!loading || isDemo} className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-left transition hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => vote(true)}>
            <ThumbsUp className="h-8 w-8 text-emerald-400" />
            <div className="mt-3 text-lg font-semibold text-emerald-200">赞成</div>
            <div className="text-sm text-zinc-500">支持执行该提案</div>
          </button>
          <button disabled={!permissions.canVote || !!loading || isDemo} className="rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-left transition hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => vote(false)}>
            <ThumbsDown className="h-8 w-8 text-red-400" />
            <div className="mt-3 text-lg font-semibold text-red-200">反对</div>
            <div className="text-sm text-zinc-500">拒绝执行该提案</div>
          </button>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="outline" disabled={!permissions.canVote || isDemo} loading={loading === 'for'} icon={<ThumbsUp className="h-4 w-4" />} onClick={() => vote(true)}>投赞成</Button>
          <Button variant="danger" disabled={!permissions.canVote || isDemo} loading={loading === 'against'} icon={<ThumbsDown className="h-4 w-4" />} onClick={() => vote(false)}>投反对</Button>
        </div>
      </div>
    </Modal>
  );
}
