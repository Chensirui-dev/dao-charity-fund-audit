import { useSearchParams } from 'react-router-dom';
import { AuditTable } from '../components/audit/AuditTable';
import { MerkleBatchPanel } from '../components/audit/MerkleBatchPanel';
import { OnchainLedger } from '../components/audit/OnchainLedger';
import { useApp } from '../context/AppContext';

export function AuditPage() {
  const { auditLogs } = useApp();
  const [params] = useSearchParams();
  // 项目详情页可以带着项目 ID 跳进来，直接落到该项目的台账
  const campaignId = params.get('campaign') ?? undefined;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-zinc-500">区块链浏览器式资金追踪 · 支持按项目拆分台账</p>
        <h1 className="mt-2 text-3xl font-bold gold-text">资金审计追踪</h1>
      </div>
      <OnchainLedger />
      <MerkleBatchPanel logs={auditLogs} />
      <AuditTable key={campaignId ?? 'ALL'} logs={auditLogs} initialCampaignId={campaignId} />
    </div>
  );
}
