import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { coverLibrary } from '../../data/campaigns';
import { addresses } from '../../utils/mock';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

export function CreateCampaignModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { createCampaign, permissions, currentRole, roleProfiles } = useApp();
  const [name, setName] = useState('社区透明食物银行');
  const [description, setDescription] = useState('通过链上凭证追踪食品采购、仓储、配送和受助签收。');
  const [targetEth, setTargetEth] = useState('18');
  const [recipientAddress, setRecipientAddress] = useState(addresses[18]);
  const [cover, setCover] = useState(coverLibrary[0]);
  const [fundraisingDays, setFundraisingDays] = useState('30');
  const [milestoneCount, setMilestoneCount] = useState('3');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    await createCampaign({
      name,
      description,
      targetEth: Number(targetEth),
      recipientAddress,
      cover,
      fundraisingDays: Number(fundraisingDays) || 30,
      milestoneCount: Number(milestoneCount) || 3,
    });
    setLoading(false);
    if (permissions.canCreateCampaign) onClose();
  };

  return (
    <Modal open={open} title="申请上架项目" onClose={onClose}>
      <div className="space-y-4">
        {!permissions.canCreateCampaign ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            当前角色：{roleProfiles[currentRole].label}，无项目上架权限。请切换为项目方或 DAO 成员演示该流程。
          </div>
        ) : null}
        <input className="w-full rounded-xl border border-line bg-black/30 p-3 outline-none focus:border-gold/60" value={name} onChange={(event) => setName(event.target.value)} placeholder="项目名称" />
        <textarea className="min-h-28 w-full rounded-xl border border-line bg-black/30 p-3 outline-none focus:border-gold/60" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="项目描述" />
        <div>
          <div className="mb-2 text-sm text-zinc-500">项目封面</div>
          <div className="grid grid-cols-5 gap-2">
            {coverLibrary.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setCover(item)}
                className={`h-14 overflow-hidden rounded-lg border transition ${cover === item ? 'border-gold ring-1 ring-gold/50' : 'border-line opacity-60 hover:opacity-100'}`}
              >
                <img src={item} alt="封面候选" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <input className="rounded-xl border border-line bg-black/30 p-3 font-mono outline-none focus:border-gold/60" value={targetEth} onChange={(event) => setTargetEth(event.target.value)} placeholder="目标 ETH" />
          <input className="rounded-xl border border-line bg-black/30 p-3 font-mono text-xs outline-none focus:border-gold/60" value={recipientAddress} onChange={(event) => setRecipientAddress(event.target.value)} placeholder="受助方地址" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs text-zinc-500">募资开放天数（到期未达标即开放退款）</span>
            <input
              className="mt-1 w-full rounded-xl border border-line bg-black/30 p-3 font-mono outline-none focus:border-gold/60"
              value={fundraisingDays}
              onChange={(event) => setFundraisingDays(event.target.value)}
              placeholder="30"
            />
          </label>
          <label className="block">
            <span className="text-xs text-zinc-500">分期期数（1-6，决定单期用款上限）</span>
            <input
              className="mt-1 w-full rounded-xl border border-line bg-black/30 p-3 font-mono outline-none focus:border-gold/60"
              value={milestoneCount}
              onChange={(event) => setMilestoneCount(event.target.value)}
              placeholder="3"
            />
          </label>
        </div>
        <div className="rounded-xl border border-line bg-card p-3 text-xs leading-relaxed text-zinc-500">
          单期用款上限 ≈ 目标额 ÷ 期数。分 3 期时，受助方每次最多申请三分之一的资金，
          拨完一期才能申请下一期——避免把整笔钱一次性提走。
        </div>
        <Button className="w-full" loading={loading} disabled={!permissions.canCreateCampaign || !name || !description || !Number(targetEth)} onClick={submit}>
          提交DAO审核
        </Button>
      </div>
    </Modal>
  );
}
