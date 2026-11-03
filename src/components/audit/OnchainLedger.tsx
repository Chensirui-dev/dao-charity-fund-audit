import { ShieldCheck } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { CONTRACT_ADDRESSES, IS_ONCHAIN } from '../../contracts/config';
import type { ChainAuditRecord } from '../../contracts/chainAdapter';
import { Address } from '../ui/Address';

/** 与合约里的 operationType 编码对齐（AuditRegistry.sol 注释） */
const OPERATION_LABEL: Record<number, string> = {
  0: '捐款入账',
  1: '资金支取',
  2: '资金拨付',
  3: '提案执行',
  5: '材料存证',
  6: '项目冻结',
};

const OPERATION_TONE: Record<number, string> = {
  0: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  1: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  2: 'border-gold/40 bg-gold/10 text-gold-light',
  3: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
  5: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  6: 'border-red-500/40 bg-red-500/10 text-red-300',
};

function reporterName(address: string): string {
  const lower = address.toLowerCase();
  if (lower === CONTRACT_ADDRESSES.donationVault.toLowerCase()) return 'DonationVault';
  if (lower === CONTRACT_ADDRESSES.daoGovernor.toLowerCase()) return 'DaoGovernor';
  if (lower === CONTRACT_ADDRESSES.auditRegistry.toLowerCase()) return 'AuditRegistry';
  return '外部账户';
}

function timeText(timestamp: number): string {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function memoText(memo: string): string {
  if (!memo) return '';
  // 合约生成的提案标题是英文（Approve campaign: xxx），展示层做本地化，链上原文不动
  return memo.replace(/^Approve campaign:\s*/, '批准项目上架：');
}

function Row({ record }: { record: ChainAuditRecord }) {
  const tone = OPERATION_TONE[record.operationCode] ?? 'border-line bg-white/5 text-zinc-300';
  const memo = memoText(record.memo);
  return (
    <tr className="border-t border-line/60 align-top">
      <td className="py-3 pr-3 font-mono text-xs text-zinc-500">#{record.index}</td>
      <td className="py-3 pr-3">
        <span className={`inline-flex whitespace-nowrap rounded-lg border px-2 py-1 text-xs ${tone}`}>
          {OPERATION_LABEL[record.operationCode] ?? `类型 ${record.operationCode}`}
        </span>
      </td>
      <td className="py-3 pr-3">
        <Address value={record.digest} />
      </td>
      <td className="max-w-[16rem] py-3 pr-3 text-xs text-zinc-400">
        {memo ? <span className="line-clamp-2 break-all">{memo}</span> : <span className="text-zinc-600">—</span>}
      </td>
      <td className="whitespace-nowrap py-3 pr-3 text-xs text-zinc-400">{reporterName(record.reporter)}</td>
      <td className="whitespace-nowrap py-3 font-mono text-xs text-zinc-500">{timeText(record.timestamp)}</td>
    </tr>
  );
}

/**
 * 链上审计台账。
 *
 * 这里的数据不是本地模拟的：直接读 AuditRegistry 合约的 records 数组，
 * 四个浏览器窗口拿到的是同一份，写入之后谁也改不了。
 * 演示时它用来回答一个问题——「刚才那几笔操作，凭什么说留过痕？」
 */
export function OnchainLedger() {
  const { onchainRecords } = useApp();
  if (!IS_ONCHAIN) return null;

  return (
    <div className="glass-card rounded-xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <h2 className="text-lg font-semibold text-zinc-100">链上审计台账</h2>
            <span className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">
              {onchainRecords.length} 条
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            实时读取自 Sepolia 的 AuditRegistry 合约，所有窗口看到的是同一份记录；写入后不可修改。
          </p>
        </div>
        <span className="rounded-lg border border-line bg-black/20 px-2 py-1 font-mono text-[11px] text-zinc-500">
          {CONTRACT_ADDRESSES.auditRegistry.slice(0, 10)}…{CONTRACT_ADDRESSES.auditRegistry.slice(-6)}
        </span>
      </div>

      {onchainRecords.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-line py-6 text-center text-sm text-zinc-500">
          链上还没有审计记录。完成一笔捐款或一次资金拨付后，这里会自动出现对应条目。
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[46rem] text-left">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-zinc-500">
                <th className="pb-2 pr-3 font-normal">序号</th>
                <th className="pb-2 pr-3 font-normal">操作</th>
                <th className="pb-2 pr-3 font-normal">业务摘要</th>
                <th className="pb-2 pr-3 font-normal">备注</th>
                <th className="pb-2 pr-3 font-normal">写入方</th>
                <th className="pb-2 font-normal">链上时间</th>
              </tr>
            </thead>
            <tbody>
              {onchainRecords.map((record) => (
                <Row key={record.index} record={record} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
