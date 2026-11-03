import { CheckCircle2, Cloud, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { verifyProofOnchain } from '../../contracts/chainAdapter';
import { IS_ONCHAIN } from '../../contracts/config';
import type { AuditLog } from '../../types';
import { shortAddress } from '../../utils/format';
import { proveAuditLog, tamperLeaf, verifyMerkleProof } from '../../utils/merkle';

type ChainState = 'idle' | 'checking' | 'pass' | 'fail' | 'error';

/**
 * 单条审计记录的 Merkle 证明与验真。
 *
 * 这里做三件事，全部是真实计算，没有装饰成分：
 * 1. 用该记录生成叶子节点，并取出从叶子到根的证明路径（兄弟节点列表）；
 * 2. 在浏览器里把证明折叠回根，与批次根比对（本地验真）；
 * 3. 把同一份证明交给链上合约的 verifyProof 再验一次（链上验真）。
 * 另外会翻转叶子哈希最后一位，验证「数据被改动后一定验不过」。
 */
export function MerkleProofCard({ log, logs }: { log: AuditLog; logs: AuditLog[] }) {
  const index = useMemo(() => logs.findIndex((item) => item.id === log.id), [logs, log.id]);
  const result = useMemo(() => proveAuditLog(logs, index), [logs, index]);
  const tamperedLeaf = useMemo(() => (result ? tamperLeaf(result.leaf) : ''), [result]);
  const tamperDetected = useMemo(
    () => (result ? verifyMerkleProof(tamperedLeaf, result.proof, result.root) === false : false),
    [result, tamperedLeaf],
  );

  const [chain, setChain] = useState<ChainState>('idle');
  const [chainMessage, setChainMessage] = useState('');
  const [showAllProof, setShowAllProof] = useState(false);

  if (!result) return null;

  const proofPreview = 3;
  const hiddenProofCount = Math.max(0, result.proof.length - proofPreview);

  const runChainVerify = async () => {
    setChain('checking');
    setChainMessage('');
    try {
      const valid = await verifyProofOnchain(result.leaf, result.proof, result.root);
      setChain(valid ? 'pass' : 'fail');
    } catch (error) {
      setChain('error');
      setChainMessage(error instanceof Error ? error.message : '链上验真失败');
    }
  };

  const chainHint = !IS_ONCHAIN
    ? '当前是模拟模式：未配置合约地址，只做本地验真。部署合约后这里会调用链上 AuditRegistry.verifyProof（只读调用，不花 Gas）。'
    : chain === 'idle'
      ? '点击后会用同一份证明调用链上合约，验证结果由合约给出。'
      : chain === 'pass'
        ? '合约返回 true：这份证明与链上锚定的批次根一致。'
        : chain === 'fail'
          ? '合约返回 false：证明与批次根不匹配。'
          : `调用失败：${chainMessage}`;

  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-zinc-200">Merkle 证明与验真</div>
        <span className="font-mono text-[10px] text-zinc-500">批次根 {shortAddress(result.root, 10, 8)}</span>
      </div>

      <div className="space-y-3 text-[11px]">
        <div className="rounded-lg border border-gold/60 bg-gold/10 px-3 py-2">
          <div className="text-[10px] text-gold/80">批次 Merkle 根（覆盖全部 {logs.length} 条记录）</div>
          <div className="mt-1 break-all font-mono text-[10px] text-gold-light">{result.root}</div>
        </div>

        <div className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-3 py-2">
          <div className="text-[10px] text-emerald-400/80">本条记录的叶子哈希</div>
          <div className="mt-1 break-all font-mono text-[10px] text-emerald-200">{result.leaf}</div>
        </div>

        <div>
          <div className="mb-1 text-zinc-500">
            证明路径：{result.proof.length} 个兄弟节点，自底向上折叠即可还原批次根
          </div>
          <div className="space-y-1">
            {result.proof.length === 0 ? (
              <div className="rounded-lg border border-line bg-black/30 px-2 py-1.5 text-zinc-500">
                批次只有这一条记录，根即叶子
              </div>
            ) : (
              result.proof.slice(0, showAllProof ? result.proof.length : proofPreview).map((node, level) => (
                <div
                  key={`${level}-${node}`}
                  className="flex items-center gap-2 rounded-lg border border-line bg-black/30 px-2 py-1.5 font-mono text-[10px] text-zinc-400"
                >
                  <span className="flex-none text-zinc-600">第 {level + 1} 层</span>
                  <span className="min-w-0 flex-1 break-all">{node}</span>
                </div>
              ))
            )}
          </div>
          {result.proof.length > proofPreview ? (
            <button
              type="button"
              className="mt-1.5 w-full rounded-lg border border-line bg-black/20 px-2 py-1 text-[10px] text-zinc-400 transition hover:border-gold/40 hover:text-gold"
              onClick={() => setShowAllProof((current) => !current)}
            >
              {showAllProof ? '收起路径' : `展开其余 ${hiddenProofCount} 个节点`}
            </button>
          ) : null}
        </div>

        <div className="space-y-2 border-t border-line pt-3">
          <VerifyRow
            title="本地验真"
            detail={result.valid ? '证明折叠结果与批次根一致' : '证明无法还原批次根'}
            pass={result.valid}
          />
          <VerifyRow
            title="篡改检测"
            detail={
              tamperDetected
                ? `把叶子末位翻转后（${shortAddress(tamperedLeaf, 10, 8)}）立刻验真失败：数据一旦改动就会被识别`
                : '未能识别被篡改的叶子'
            }
            pass={tamperDetected}
          />

          <div className="rounded-lg border border-line bg-black/25 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-zinc-300">
                <Cloud className="h-3.5 w-3.5 text-sky-400" />
                <span className="text-[11px] font-semibold">链上验真</span>
              </div>
              <button
                type="button"
                className="rounded-lg border border-line-gold px-2.5 py-1 text-[11px] font-semibold text-gold transition hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!IS_ONCHAIN || chain === 'checking'}
                onClick={() => void runChainVerify()}
              >
                {chain === 'checking' ? '验真中…' : '调用合约验真'}
              </button>
            </div>
            <div className="mt-2 text-[10px] leading-5 text-zinc-500">{chainHint}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function VerifyRow({ title, detail, pass }: { title: string; detail: string; pass: boolean }) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        pass ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-red-500/40 bg-red-500/10'
      }`}
    >
      <div className="flex items-center gap-2">
        {pass ? (
          <CheckCircle2 className="h-3.5 w-3.5 flex-none text-emerald-400" />
        ) : (
          <XCircle className="h-3.5 w-3.5 flex-none text-red-400" />
        )}
        <span className={`text-[11px] font-semibold ${pass ? 'text-emerald-300' : 'text-red-300'}`}>{title}</span>
        <span className={`ml-auto text-[10px] ${pass ? 'text-emerald-400' : 'text-red-400'}`}>
          {pass ? '通过' : '未通过'}
        </span>
      </div>
      <div className={`mt-1 text-[10px] leading-5 ${pass ? 'text-emerald-200/70' : 'text-red-200/80'}`}>{detail}</div>
    </div>
  );
}
