import { AuditAlerts } from '../components/dashboard/AuditAlerts';
import { FlowSankey } from '../components/dashboard/FlowSankey';
import { RecentDonations } from '../components/dashboard/RecentDonations';
import { StatsOverview } from '../components/dashboard/StatsOverview';

export function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-zinc-500">捐款上链 {'->'} DAO提案投票 {'->'} 资金拨付 {'->'} 审计追踪</p>
        <h1 className="mt-2 text-3xl font-bold gold-text">去中心化公益资金审计系统</h1>
      </div>
      <StatsOverview />
      {/* items-start：否则右侧预警卡会被左侧桑基图撑成等高的空洞 */}
      <div className="grid items-start gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <FlowSankey />
        <AuditAlerts />
      </div>
      <RecentDonations />
    </div>
  );
}
