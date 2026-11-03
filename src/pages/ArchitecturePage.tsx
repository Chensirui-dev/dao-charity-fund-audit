import { Activity, BarChart3, CircleDollarSign, FileCheck2, PieChart as PieIcon, ShieldCheck, TrendingUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArchitectureDiagram } from '../components/architecture/ArchitectureDiagram';
import { useApp } from '../context/AppContext';
import { auditCoverageRate, totalRaisedEth } from '../utils/metrics';

const COLORS = ['#D4A853', '#10B981', '#60A5FA', '#F97316', '#A78BFA'];
const campaignLabels: Record<string, string> = {
  PENDING: '待审核',
  ACTIVE: '进行中',
  FUNDED: '已达标',
  COMPLETED: '已完成',
  REJECTED: '已驳回',
};
const proposalLabels: Record<string, string> = {
  ACTIVE: '投票中',
  PASSED: '已通过',
  REJECTED: '已拒绝',
  EXECUTED: '已执行',
};
const operationLabels: Record<string, string> = {
  DEPOSIT: '捐款入账',
  WITHDRAWAL: '资金拨付',
  GAS_FEE: 'Gas 费用',
  REFUND: '退款',
  PROPOSAL_EXECUTION: '提案执行',
};

const axis = { tick: { fill: '#71717a', fontSize: 11 }, axisLine: false, tickLine: false };
const tooltipStyle = {
  contentStyle: { background: '#141414', border: '1px solid #2A2A2A', borderRadius: 8 },
  labelStyle: { color: '#e5e5e5' },
};
const legendStyle = { fontSize: 11, color: '#a1a1aa', paddingTop: 6 };

function ChartPanel({
  title,
  icon: Icon,
  children,
  className = '',
}: {
  title: string;
  icon: typeof BarChart3;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`glass-card rounded-xl p-5 ${className}`}>
      <div className="mb-5 flex items-center gap-3">
        <div className="rounded-xl bg-gold/10 p-2.5 text-gold-light">
          <Icon className="h-5 w-5" />
        </div>
        <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
      </div>
      <div className="h-72">{children}</div>
    </section>
  );
}

export function ArchitecturePage() {
  const { campaigns, donations, proposals, auditLogs, members } = useApp();

  const metrics = useMemo(() => {
    // 与仪表盘共用同一套口径，否则同一个「累计捐款 / 审计覆盖率」在两个页面对不上
    const total = totalRaisedEth(campaigns);
    const funded = campaigns.filter((item) => ['FUNDED', 'COMPLETED'].includes(item.status)).length;
    const confirmed = auditLogs.filter((item) => item.status === 'CONFIRMED').length;
    return { total, funded, confirmed, rate: auditCoverageRate(auditLogs) };
  }, [campaigns, auditLogs]);

  // 项目名放 Y 轴、金额走 X 轴，名称再长也不会互相压住
  const campaignData = useMemo(
    () =>
      campaigns
        .slice(0, 8)
        .map((item) => ({
          name: item.name.length > 10 ? `${item.name.slice(0, 10)}…` : item.name,
          目标金额: Number(item.targetAmount) / 1e18,
          已筹金额: Number(item.raisedAmount) / 1e18,
        }))
        .reverse(),
    [campaigns],
  );

  // 按天汇总捐款，只保留有数据的日子，避免折线在空白日期上被拉成 0
  const trendData = useMemo(() => {
    const byDay = donations.reduce<Record<string, { timestamp: number; amount: number; count: number }>>((result, item) => {
      const day = new Date(item.timestamp);
      day.setHours(0, 0, 0, 0);
      const key = day.toISOString().slice(0, 10);
      const current = result[key] ?? { timestamp: day.getTime(), amount: 0, count: 0 };
      current.amount += Number(item.amount) / 1e18;
      current.count += 1;
      result[key] = current;
      return result;
    }, {});
    return Object.values(byDay)
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-7)
      .map((item) => {
        const day = new Date(item.timestamp);
        return { name: `${day.getMonth() + 1}/${day.getDate()}`, 金额: Number(item.amount.toFixed(3)), 笔数: item.count };
      });
  }, [donations]);

  const group = (values: string[]) =>
    Object.entries(
      values.reduce<Record<string, number>>((result, value) => {
        result[value] = (result[value] ?? 0) + 1;
        return result;
      }, {}),
    ).map(([name, value]) => ({ name, value }));

  const campaignStatusData = useMemo(
    () => group(campaigns.map((item) => item.status)).map((item) => ({ ...item, name: campaignLabels[item.name] ?? item.name })),
    [campaigns],
  );
  const proposalData = useMemo(
    () => group(proposals.map((item) => item.status)).map((item) => ({ ...item, name: proposalLabels[item.name] ?? item.name })),
    [proposals],
  );
  const auditData = useMemo(
    () => group(auditLogs.map((item) => item.operationType)).map((item) => ({ ...item, name: operationLabels[item.name] ?? item.name })),
    [auditLogs],
  );

  const stats = [
    { label: '累计捐款', value: `${metrics.total.toFixed(2)} ETH`, icon: CircleDollarSign, color: 'text-gold-light' },
    { label: '公益项目', value: `${campaigns.length} 个`, icon: TrendingUp, color: 'text-emerald-400' },
    { label: '已完成或达标', value: `${metrics.funded} 个`, icon: ShieldCheck, color: 'text-blue-400' },
    { label: '审计覆盖率', value: `${metrics.rate.toFixed(1)}%`, icon: FileCheck2, color: 'text-orange-400' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm text-zinc-500">从浏览器到合约的分层结构与运行数据</p>
          <h1 className="mt-2 text-3xl font-bold gold-text">系统架构</h1>
        </div>
        <div className="flex items-center gap-2 text-xs text-emerald-400">
          <Activity className="h-4 w-4" />
          数据随链上状态实时更新
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, icon: Icon, color }: { label: string; value: string; icon: LucideIcon; color: string }) => (
          <div key={label} className="glass-card rounded-xl p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-500">{label}</span>
              <Icon className={`h-5 w-5 ${color}`} />
            </div>
            <div className="mt-3 text-2xl font-bold text-zinc-100">{value}</div>
          </div>
        ))}
      </div>

      <ArchitectureDiagram />

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <ChartPanel title="各公益项目筹款对比（ETH）" icon={BarChart3}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={campaignData} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid stroke="#2A2A2A" strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" {...axis} />
              <YAxis type="category" dataKey="name" width={96} {...axis} />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={legendStyle} />
              <Bar dataKey="目标金额" fill="#3f3f46" radius={[0, 3, 3, 0]} barSize={8} />
              <Bar dataKey="已筹金额" fill="#D4A853" radius={[0, 3, 3, 0]} barSize={8} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="项目状态分布" icon={PieIcon}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={campaignStatusData} dataKey="value" nameKey="name" cx="50%" cy="46%" innerRadius={44} outerRadius={78} paddingAngle={2} stroke="#141414" strokeWidth={2}>
                {campaignStatusData.map((item, index) => (
                  <Cell key={item.name} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={legendStyle} />
            </PieChart>
          </ResponsiveContainer>
        </ChartPanel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <ChartPanel title="每日捐款金额（ETH）" icon={TrendingUp}>
          {trendData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trendData} margin={{ left: -12, right: 8 }}>
                <CartesianGrid stroke="#2A2A2A" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" {...axis} />
                <YAxis {...axis} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="金额" fill="#10B981" radius={[4, 4, 0, 0]} barSize={26} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">暂无捐款数据</div>
          )}
        </ChartPanel>

        <ChartPanel title="DAO 提案状态" icon={PieIcon}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={proposalData} dataKey="value" nameKey="name" cx="50%" cy="46%" innerRadius={44} outerRadius={78} paddingAngle={2} stroke="#141414" strokeWidth={2}>
                {proposalData.map((item, index) => (
                  <Cell key={item.name} fill={COLORS[(index + 2) % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={legendStyle} />
            </PieChart>
          </ResponsiveContainer>
        </ChartPanel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartPanel title="审计操作类型分布" icon={FileCheck2}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={auditData} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid stroke="#2A2A2A" strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" allowDecimals={false} {...axis} />
              <YAxis type="category" dataKey="name" width={72} {...axis} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="value" name="记录数" fill="#60A5FA" radius={[0, 4, 4, 0]} barSize={16} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <section className="glass-card rounded-xl p-5">
          <div className="mb-5 flex items-center gap-3">
            <div className="rounded-xl bg-emerald-500/10 p-2.5 text-emerald-300">
              <BarChart3 className="h-5 w-5" />
            </div>
            <h2 className="text-base font-semibold text-zinc-100">治理参与概览</h2>
          </div>
          <div className="space-y-4">
            {[
              ['DAO 成员数', members.length],
              ['总治理权重', members.reduce((sum, item) => sum + item.votingPower, 0).toLocaleString()],
              ['提案总数', proposals.length],
              ['已确认审计记录', metrics.confirmed],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex items-center justify-between border-b border-line pb-4 last:border-0">
                <span className="text-sm text-zinc-500">{label}</span>
                <span className="font-semibold text-zinc-100">{value}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <p className="text-xs leading-5 text-zinc-600">
        以上图表按应用状态中的项目、捐款、提案与审计记录实时计算；项目、提案、投票结果、资金余额与审计记录均读取自 Sepolia 合约，
        与仪表盘使用同一套统计口径。
      </p>
    </div>
  );
}
