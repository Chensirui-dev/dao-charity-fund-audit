import { AlertTriangle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { formatEth, operationLabel, relativeTime, shortAddress } from '../../utils/format';

export function AuditAlerts() {
  const { auditLogs } = useApp();
  const flagged = auditLogs.filter((log) => log.status === 'FLAGGED');
  return (
    <div className="glass-card rounded-xl p-5">
      <h2 className="mb-4 text-lg font-semibold">审计预警</h2>
      <div className="space-y-3">
        {flagged.map((log) => (
          <div key={log.id} className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 transition hover:bg-red-500/15">
            <div className="flex items-center gap-2 text-red-300">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-mono text-xs">{shortAddress(log.txHash, 10, 6)}</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-zinc-500">金额</div>
                <div className="font-mono text-gold-light">{formatEth(log.amount)}</div>
              </div>
              <div>
                <div className="text-zinc-500">类型</div>
                <div>{operationLabel(log.operationType)}</div>
              </div>
              <div>
                <div className="text-zinc-500">时间</div>
                <div>{relativeTime(log.timestamp)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
