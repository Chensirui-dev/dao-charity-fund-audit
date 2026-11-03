import { ShieldCheck, Users, Vault, Waves } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAnimatedNumber } from '../../hooks/useAnimatedNumber';
import { activeCampaignCount, auditCoverageRate, totalRaisedEth } from '../../utils/metrics';

function StatCard({ label, value, suffix, icon: Icon, hint }: { label: string; value: number; suffix?: string; icon: typeof Vault; hint?: string }) {
  const animated = useAnimatedNumber(value);
  return (
    <div className="glass-card rounded-xl p-5 transition-all duration-300 hover:border-line-gold hover:bg-card-hover">
      <div className="flex items-center justify-between">
        <div className="rounded-xl border border-line-gold bg-gold/10 p-3 text-gold">
          <Icon className="h-5 w-5" />
        </div>
        <span className="text-xs text-zinc-500">{label}</span>
      </div>
      <div className="mt-5 font-mono text-3xl font-bold gold-text">
        {animated.toLocaleString('zh-CN', { maximumFractionDigits: 1 })}
        {suffix}
      </div>
      {hint ? <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-600">{hint}</p> : null}
    </div>
  );
}

export function StatsOverview() {
  const { campaigns, members, auditLogs } = useApp();
  // 汇总口径统一走 utils/metrics，避免和架构图各算一套
  const poolAmount = totalRaisedEth(campaigns);
  const coverage = auditCoverageRate(auditLogs);
  const activeCampaigns = activeCampaignCount(campaigns);
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="总善款池"
        value={poolAmount}
        suffix=" ETH"
        icon={Vault}
        hint="取金库分户账余额，与区块浏览器一致"
      />
      <StatCard label="活跃项目数" value={activeCampaigns} icon={Waves} hint="含已迁移的历史项目" />
      <StatCard label="DAO成员数" value={members.length} icon={Users} hint="票权由治理合约登记" />
      <StatCard
        label="审计覆盖率"
        value={coverage}
        suffix="%"
        icon={ShieldCheck}
        hint="业务台账中已取得链上凭证的占比"
      />
    </div>
  );
}
