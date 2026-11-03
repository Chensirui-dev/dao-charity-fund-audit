import { Anchor, CheckCircle2, Link2, Loader2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { anchorBatchOnchain, readLatestAnchor, type OnchainAnchor } from '../../contracts/chainAdapter';
import { IS_ONCHAIN, explorerTxUrl } from '../../contracts/config';
import type { AuditLog } from '../../types';
import { shortAddress } from '../../utils/format';
import { buildAuditCommitment, getMerkleProof, verifyMerkleProof } from '../../utils/merkle';

type Status = 'idle' | 'loading' | 'anchoring';

/**
 * 审计批次的 Merkle 根锚定面板。
 *
 * 流程：对当前审计记录集合建树 → 得到批次根 → 把根锚定到链上 → 之后每条记录都能
 * 用证明对着这个根验真。根一旦上链就不可修改，这是「审计结果不可篡改」的技术落点。
 */
export function MerkleBatchPanel({ logs }: { logs: AuditLog[] }) {
  const commitment = useMemo(() => buildAuditCommitment(logs), [logs]);
  const [anchor, setAnchor] = useState<OnchainAnchor | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [txHash, setTxHash] = useState('');
  const [localCheck, setLocalCheck] = useState<{ total: number; passed: number } | null>(null);

  const refreshAnchor = useCallback(async () => {
    if (!IS_ONCHAIN) {
      setAnchor(null);
      return;
    }
    setStatus('loading');
    try {
      setAnchor(await readLatestAnchor());
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? `读取链上锚定状态失败：${error.message}` : '读取链上锚定状态失败');
    } finally {
      setStatus('idle');
    }
  }, []);

  useEffect(() => {
    void refreshAnchor();
  }, [refreshAnchor]);

  const anchorNow = async () => {
    if (commitment.count === 0) return;
    setStatus('anchoring');
    setMessage('');
    setTxHash('');
    try {
      const result = await anchorBatchOnchain(commitment.root, 0, commitment.count - 1);
      setTxHash(result.txHash);
      await refreshAnchor();
      setMessage('锚定成功：批次根已写入链上，任何人都可以对照它验真。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '锚定失败');
    } finally {
      setStatus('idle');
    }
  };

  /** 对全部记录跑一遍证明生成 + 本地验真，确认每条都能还原批次根 */
  const verifyAllLocally = () => {
    let passed = 0;
    commitment.leaves.forEach((leaf, index) => {
      if (verifyMerkleProof(leaf, getMerkleProof(commitment.leaves, index), commitment.root)) passed += 1;
    });
    setLocalCheck({ total: commitment.leaves.length, passed });
  };

  const rootMatchesChain = Boolean(anchor && anchor.merkleRoot.toLowerCase() === commitment.root.toLowerCase());

  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-gold/10 p-2 text-gold-light">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-200">审计批次 Merkle 锚定</div>
            <div className="text-[11px] text-zinc-500">
              对当前 {commitment.count} 条审计记录建树并取根；根上链后不可篡改，任一条记录都能验真
            </div>
          </div>
        </div>
        <span
          className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
            IS_ONCHAIN
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-400'
          }`}
        >
          {IS_ONCHAIN ? '真实链模式' : '模拟模式'}
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-black/25 p-3">
          <div className="text-[10px] text-zinc-500">本地计算的批次 Merkle 根</div>
          <div className="mt-1 break-all font-mono text-[10px] text-gold-light">{commitment.root}</div>
        </div>
        <div className="rounded-xl border border-line bg-black/25 p-3">
          <div className="text-[10px] text-zinc-500">链上最新锚定的批次根</div>
          <div className="mt-1 break-all font-mono text-[10px] text-zinc-300">
            {!IS_ONCHAIN ? (
              <span className="text-zinc-600">模拟模式下不写链</span>
            ) : status === 'loading' ? (
              <span className="text-zinc-500">读取中…</span>
            ) : anchor ? (
              anchor.merkleRoot
            ) : (
              <span className="text-zinc-600">尚未锚定</span>
            )}
          </div>
        </div>
      </div>

      {anchor ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
          <span>锚定编号 #{anchor.index}</span>
          <span>
            区间 {anchor.fromIndex} – {anchor.toIndex}（共 {anchor.toIndex - anchor.fromIndex + 1} 条）
          </span>
          <span>锚定者 {shortAddress(anchor.anchorer)}</span>
          <span>{new Date(anchor.timestamp * 1000).toLocaleString('zh-CN')}</span>
          <span className={`inline-flex items-center gap-1 ${rootMatchesChain ? 'text-emerald-400' : 'text-amber-400'}`}>
            {rootMatchesChain ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
            {rootMatchesChain ? '与本地根一致' : '与当前本地根不一致（记录集已变化，需要重新锚定）'}
          </span>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line-gold px-3 py-2 text-xs font-semibold text-gold transition hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!IS_ONCHAIN || status === 'anchoring' || commitment.count === 0}
          onClick={() => void anchorNow()}
        >
          {status === 'anchoring' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Anchor className="h-3.5 w-3.5" />}
          {status === 'anchoring' ? '等待钱包确认…' : '把批次根锚定到链上'}
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:border-line-gold hover:text-gold disabled:opacity-50"
          disabled={!IS_ONCHAIN || status !== 'idle'}
          onClick={() => void refreshAnchor()}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${status === 'loading' ? 'animate-spin' : ''}`} />
          刷新链上状态
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:border-line-gold hover:text-gold"
          onClick={verifyAllLocally}
        >
          <Link2 className="h-3.5 w-3.5" />
          批量本地验真
        </button>
        {localCheck ? (
          <span className={`text-[11px] ${localCheck.passed === localCheck.total ? 'text-emerald-400' : 'text-red-400'}`}>
            {localCheck.passed}/{localCheck.total} 条记录的证明可还原批次根
          </span>
        ) : null}
      </div>

      {txHash ? (
        <div className="mt-3 text-[11px] text-zinc-500">
          锚定交易：
          <a
            className="ml-1 font-mono text-sky-400 underline-offset-2 hover:underline"
            href={explorerTxUrl(txHash)}
            target="_blank"
            rel="noreferrer"
          >
            {shortAddress(txHash, 12, 10)} ↗
          </a>
        </div>
      ) : null}

      {message ? <div className="mt-3 text-[11px] leading-5 text-zinc-400">{message}</div> : null}
    </div>
  );
}
