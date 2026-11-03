import { useEffect, useMemo, useState } from 'react';
import { formatUnits, parseEther } from 'ethers';
import type { Campaign } from '../../types';
import { useApp } from '../../context/AppContext';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { campaignKeyOf, readCampaignAccountOnchain, type ChainCampaignAccount } from '../../contracts/chainAdapter';
import { IS_ONCHAIN } from '../../contracts/config';
import { hashFile, hashText, shortHash } from '../../utils/evidence';

/**
 * 用款申请弹窗。
 *
 * 这是「资金出口」的前置环节：受助方先说明要多少钱、拿什么材料作依据，
 * 材料摘要写进链上审计台账，之后理事会才可能批出一笔钱。
 * 没有这张申请单，治理合约里连可拨付的对象都不存在。
 */
export function FundRequestModal({
  campaign,
  onClose,
  onSubmitted,
}: {
  campaign: Campaign | null;
  onClose: () => void;
  onSubmitted?: (requestId: number | null) => void;
}) {
  const { requestFunds } = useApp();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('第一期材料：采购发票与验收单');
  const [fileName, setFileName] = useState('');
  const [evidenceHash, setEvidenceHash] = useState('');
  const [hashing, setHashing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [account, setAccount] = useState<ChainCampaignAccount | null>(null);

  const campaignKey = useMemo(() => (campaign ? campaignKeyOf(campaign) : ''), [campaign]);

  useEffect(() => {
    let alive = true;
    if (!campaign || !IS_ONCHAIN) {
      setAccount(null);
      return () => {
        alive = false;
      };
    }
    readCampaignAccountOnchain(campaignKey)
      .then((value) => {
        if (alive) setAccount(value);
      })
      .catch(() => {
        if (alive) setAccount(null);
      });
    return () => {
      alive = false;
    };
  }, [campaign, campaignKey]);

  /** 单期额度上限：目标额 ÷ 期数。合约里 requestFunds 用的是同一口径。 */
  const milestoneCapEth = useMemo(() => {
    if (!account || account.milestoneCount === 0) return null;
    const cap = BigInt(account.targetAmount) / BigInt(account.milestoneCount);
    return Number(formatUnits(cap, 18));
  }, [account]);

  const remainingMilestones = account ? account.milestoneCount - account.milestonesReleased : null;

  const pickFile = async (file: File | null) => {
    if (!file) return;
    setHashing(true);
    try {
      const hash = await hashFile(file);
      setFileName(file.name);
      setEvidenceHash(hash);
    } catch {
      setError('无法读取该文件，请换一个后重试。');
    } finally {
      setHashing(false);
    }
  };

  const useNoteAsEvidence = async () => {
    if (!note.trim()) return;
    setHashing(true);
    try {
      const hash = await hashText(`${campaign?.id ?? ''}|${note.trim()}`);
      setFileName('（仅文字说明）');
      setEvidenceHash(hash);
    } finally {
      setHashing(false);
    }
  };

  const submit = async () => {
    if (!campaign) return;
    const value = Number(amount);
    if (!value || value <= 0) {
      setError('请输入大于 0 的申请金额。');
      return;
    }
    if (!evidenceHash) {
      setError('请上传材料文件，或点击「用说明文字生成摘要」。');
      return;
    }
    if (milestoneCapEth !== null && value > milestoneCapEth) {
      setError(`本项目分 ${account?.milestoneCount} 期，单期上限 ${milestoneCapEth} ETH。`);
      return;
    }
    setError('');

    setLoading(true);
    const requestId = await requestFunds({ campaignId: campaign.id, amountEth: value, evidenceHash });
    setLoading(false);
    onSubmitted?.(requestId);
    onClose();
  };

  return (
    <Modal open={!!campaign} title={`提交用款申请 · ${campaign?.name ?? ''}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-xl border border-line bg-card p-3 text-sm leading-relaxed text-zinc-400">
          用款申请不会直接转账。它把「申请多少、依据什么材料」固定到链上，
          之后由理事会提案表决。材料原件留在你本地，链上只存它的 SHA-256 摘要。
        </div>

        {account && remainingMilestones !== null ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-line bg-black/30 p-3">
              <div className="text-xs text-zinc-500">单期额度上限</div>
              <div className="mt-1 font-mono text-lg text-gold-light">
                {milestoneCapEth === null ? '—' : `${milestoneCapEth} ETH`}
              </div>
            </div>
            <div className="rounded-xl border border-line bg-black/30 p-3">
              <div className="text-xs text-zinc-500">剩余可申请期数</div>
              <div className="mt-1 font-mono text-lg text-zinc-200">{remainingMilestones} / {account.milestoneCount}</div>
            </div>
          </div>
        ) : null}

        <label className="block">
          <span className="text-sm text-zinc-500">申请金额</span>
          <div className="mt-2 flex items-center rounded-xl border border-line bg-black/30 px-4 focus-within:border-gold/60">
            <input
              className="w-full bg-transparent py-4 font-mono text-3xl text-gold-light outline-none"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
            />
            <span className="font-mono text-zinc-500">ETH</span>
          </div>
        </label>

        <label className="block">
          <span className="text-sm text-zinc-500">用款说明</span>
          <textarea
            className="mt-2 min-h-20 w-full rounded-xl border border-line bg-black/30 p-3 text-zinc-200 outline-none transition focus:border-gold/60"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>

        <div className="space-y-2 rounded-xl border border-line bg-card p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-zinc-400">材料文件（发票 / 签收单 / 验收报告）</span>
            <label className="cursor-pointer rounded-lg border border-gold/40 px-3 py-1.5 text-xs text-gold-light transition hover:bg-gold/10">
              选择文件
              <input
                type="file"
                className="hidden"
                onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          {hashing ? <div className="text-xs text-zinc-500">正在计算 SHA-256 摘要…</div> : null}
          {evidenceHash ? (
            <div className="space-y-1">
              <div className="text-xs text-zinc-500">材料摘要（将写入链上审计台账）</div>
              <div className="break-all font-mono text-xs text-emerald-300">{evidenceHash}</div>
              <div className="text-xs text-zinc-500">{fileName}</div>
            </div>
          ) : (
            <button
              type="button"
              className="text-xs text-zinc-500 underline decoration-dotted underline-offset-4 hover:text-gold-light"
              onClick={useNoteAsEvidence}
            >
              没有附件？用说明文字生成摘要
            </button>
          )}
        </div>

        {evidenceHash ? (
          <div className="text-xs text-zinc-500">
            短摘要：<span className="font-mono text-zinc-300">{shortHash(evidenceHash)}</span>
          </div>
        ) : null}

        {!IS_ONCHAIN ? (
          <div className="rounded-xl border border-gold/30 bg-gold/10 p-3 text-xs text-gold-light">
            当前为演示模式，提交后不会写入链上，仅作流程演示。
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>
        ) : null}

        <Button className="w-full" loading={loading} onClick={submit} disabled={!amount || Number(amount) <= 0 || !evidenceHash}>
          提交用款申请
        </Button>
      </div>
    </Modal>
  );
}
