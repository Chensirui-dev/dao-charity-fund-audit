import { useState } from 'react';
import type { Campaign } from '../../types';
import { useApp } from '../../context/AppContext';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

/**
 * 演示常用小额档位。
 * 真实链模式下捐款会携带 ETH 真实转账，钱包余额必须大于捐款金额（还要留一点 Gas），
 * 而测试币水龙头单次只发 0.05 ETH 左右，所以默认取最小档，避免现场演示时余额不足。
 */
const DONATION_PRESETS = ['0.005', '0.01', '0.02', '0.05'];

export function DonateModal({ campaign, onClose }: { campaign: Campaign | null; onClose: () => void }) {
  const { donate, permissions, currentRole, roleProfiles } = useApp();
  const [amount, setAmount] = useState('0.01');
  const [message, setMessage] = useState('支持透明公益');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!campaign) return;
    setLoading(true);
    await donate(campaign.id, Number(amount), message);
    setLoading(false);
    if (permissions.canDonate) onClose();
  };

  return (
    <Modal open={!!campaign} title={`向「${campaign?.name ?? ''}」捐款`} onClose={onClose}>
      <div className="space-y-4">
        {!permissions.canDonate ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            当前角色：{roleProfiles[currentRole].label}，无捐款权限。请切换为捐赠者或 DAO 成员演示该流程。
          </div>
        ) : null}
        <label className="block">
          <span className="text-sm text-zinc-500">捐款金额</span>
          <div className="mt-2 flex items-center rounded-xl border border-line bg-black/30 px-4 focus-within:border-gold/60">
            <input className="w-full bg-transparent py-4 font-mono text-3xl text-gold-light outline-none" value={amount} onChange={(event) => setAmount(event.target.value)} />
            <span className="font-mono text-zinc-500">ETH</span>
          </div>
        </label>
        <div className="flex flex-wrap gap-2">
          {DONATION_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`rounded-lg border px-3 py-1.5 font-mono text-xs transition ${
                amount === preset ? 'border-gold/60 bg-gold/10 text-gold-light' : 'border-line text-zinc-400 hover:border-gold/40 hover:text-gold-light'
              }`}
              onClick={() => setAmount(preset)}
            >
              {preset} ETH
            </button>
          ))}
        </div>
        <label className="block">
          <span className="text-sm text-zinc-500">留言</span>
          <textarea className="mt-2 min-h-24 w-full rounded-xl border border-line bg-black/30 p-3 text-zinc-200 outline-none transition focus:border-gold/60" value={message} onChange={(event) => setMessage(event.target.value)} />
        </label>
        <div className="rounded-xl border border-line bg-card p-3 text-sm text-zinc-400">
          本次将向金库合约真实转入 <span className="font-mono text-gold-light">{amount || '0'} ETH</span>，另付测试网 Gas 费（Sepolia 极低，通常不足 0.0001 ETH）。钱包余额需大于该金额，否则交易会被拒绝。
        </div>
        <Button className="w-full" loading={loading} onClick={submit} disabled={!permissions.canDonate || !Number(amount) || Number(amount) <= 0}>
          提交链上交易
        </Button>
      </div>
    </Modal>
  );
}
