import { BarChart3, FileSearch, GitPullRequestArrow, HeartHandshake, Menu, Network, ShieldCheck, Wallet, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { SkeletonBlock } from './components/ui/Skeleton';
import { Address } from './components/ui/Address';
import { ToastViewport } from './components/ui/Toast';
import { useApp } from './context/AppContext';
import { ArchitecturePage } from './pages/ArchitecturePage';
import { AuditPage } from './pages/AuditPage';
import { CreateProposalPage } from './pages/CreateProposalPage';
import { DashboardPage } from './pages/DashboardPage';
import { GovernancePage } from './pages/GovernancePage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { ProjectListPage } from './pages/ProjectListPage';
import type { UserRole } from './types';
import { DEMO_ACCOUNT_ROLES, IS_ONCHAIN } from './contracts/config';
import { CHAIN_ID, CHAIN_NAME } from './contracts/wallet';

const navItems = [
  { to: '/', label: '仪表盘', icon: BarChart3 },
  { to: '/projects', label: '公益项目', icon: HeartHandshake },
  { to: '/governance', label: 'DAO治理', icon: GitPullRequestArrow },
  { to: '/audit', label: '审计追踪', icon: FileSearch },
  { to: '/architecture', label: '架构图', icon: Network },
];

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { connectedWallet, currentRole, roleProfiles, switchRole, walletConnected, walletChainId, connectWallet, disconnectWallet, authorizedAccountCount } = useApp();
  const activeRole = roleProfiles[currentRole];
  const onRightChain = walletChainId === CHAIN_ID;
  // 当前 MetaMask 账户是否已登记为演示账户；登记过的话角色会自动跟着账户走
  const mappedRole = walletConnected ? DEMO_ACCOUNT_ROLES[connectedWallet.toLowerCase()] : undefined;
  const roleMatchesWallet = !walletConnected || !mappedRole || mappedRole === currentRole;
  // 只授权了一个账户：切到其他账户时钱包不会通知网页，页面就"跟不上"
  // 不按登记表总数判断，因为每个浏览器环境里只放了部分账户（如 Edge 只有三个）
  const partialAuth = walletConnected && authorizedAccountCount === 1;

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 w-72 border-r border-line bg-black/95 p-4 transition-transform duration-300 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">DAO Charity</div>
          <div className="mt-1 text-xl font-bold gold-text">暗夜金库与绿洲</div>
        </div>
        <button className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-900 lg:hidden" onClick={onClose} aria-label="关闭菜单">
          <X className="h-5 w-5" />
        </button>
      </div>
      <nav className="mt-8 space-y-2">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={onClose}
            className={({ isActive }) =>
              `flex min-h-11 items-center gap-3 rounded-xl border px-3 text-sm font-semibold transition ${
                isActive ? 'border-line-gold bg-gold/10 text-gold-light' : 'border-transparent text-zinc-500 hover:border-line hover:bg-card hover:text-zinc-200'
              }`
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="absolute bottom-4 left-4 right-4 space-y-3">
        <div className="rounded-xl border border-line bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-gold/10 p-2 text-gold-light">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-zinc-500">演示角色权限</div>
              <select
                className={`mt-2 w-full rounded-lg border border-line bg-black/40 px-2 py-2 text-sm text-zinc-100 outline-none focus:border-gold/60 ${mappedRole ? 'cursor-not-allowed text-zinc-400' : ''}`}
                value={currentRole}
                onChange={(event) => switchRole(event.target.value as UserRole)}
                disabled={!!mappedRole}
              >
                {Object.values(roleProfiles).map((profile) => (
                  <option key={profile.role} value={profile.role}>{profile.label}</option>
                ))}
              </select>
              {mappedRole ? (
                <p className="mt-2 text-[11px] leading-5 text-emerald-400">角色跟随钱包账户：在 MetaMask 里切账户即切角色</p>
              ) : null}
              <p className="mt-2 text-xs leading-5 text-zinc-500">{activeRole.description}</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-line bg-card p-4">
          <div className="flex items-center gap-3">
            <div className={`${walletConnected && onRightChain ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-500/10 text-zinc-500'} rounded-xl p-2`}>
              <Wallet className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-zinc-500">{walletConnected ? 'MetaMask 已连接' : 'MetaMask 未连接'}</div>
              <Address value={connectedWallet} className="text-sm text-zinc-200" />
              {walletConnected ? (
                <div className={`mt-1 text-[11px] ${onRightChain ? 'text-emerald-400' : 'text-amber-400'}`}>
                  网络: {onRightChain ? `${CHAIN_NAME} (${CHAIN_ID})` : `链 ID ${walletChainId}`}
                </div>
              ) : null}
              {walletConnected ? (
                mappedRole ? (
                  <div className={`mt-1 text-[11px] ${roleMatchesWallet ? 'text-emerald-400' : 'text-amber-400'}`}>
                    演示账户：{roleProfiles[mappedRole as UserRole].label}{roleMatchesWallet ? '，角色已自动对齐' : '，角色待对齐'}
                  </div>
                ) : (
                  <div className="mt-1 text-[11px] text-amber-400">未登记账户，请手动对齐演示角色</div>
                )
              ) : null}
              {partialAuth ? (
                <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-4 text-amber-300">
                  钱包只授权了 1 个账户。切到其他账户时页面收不到通知，角色就不会变。
                  在 MetaMask 里点站点旁的「连接」→ 勾选全部账户。
                </div>
              ) : null}
            </div>
          </div>
          <div className={`mt-3 rounded-lg border px-3 py-2 text-[11px] leading-5 ${IS_ONCHAIN ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-400' : 'border-amber-500/40 bg-amber-500/5 text-amber-400'}`}>
            {IS_ONCHAIN ? `真实链模式：${CHAIN_NAME} 交易可在区块浏览器查验` : '模拟模式：尚未配置合约地址，链上动作本地模拟'}
          </div>
          <button
            className="mt-3 w-full rounded-lg border border-line-gold px-3 py-2 text-xs font-semibold text-gold transition hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!IS_ONCHAIN}
            onClick={() => (walletConnected && onRightChain ? disconnectWallet() : void connectWallet())}
          >
            {walletConnected && onRightChain ? '断开本页连接' : walletConnected ? `切换到 ${CHAIN_NAME}` : '连接 MetaMask'}
          </button>
        </div>
      </div>
    </aside>
  );
}

export default function App() {
  const [open, setOpen] = useState(false);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setBooting(false), 650);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-app text-zinc-200">
      <div className="lg:grid lg:grid-cols-[288px_1fr]">
        <Sidebar open={open} onClose={() => setOpen(false)} />
        {open ? <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setOpen(false)} /> : null}
        <main className="min-w-0">
          <header className="sticky top-0 z-20 border-b border-line bg-app/85 px-4 py-3 backdrop-blur lg:hidden">
            <button className="rounded-xl border border-line bg-card p-2 text-zinc-200" onClick={() => setOpen(true)} aria-label="打开菜单">
              <Menu className="h-5 w-5" />
            </button>
          </header>
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            {booting ? (
              <AppSkeleton />
            ) : (
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/projects" element={<ProjectListPage />} />
                <Route path="/projects/:id" element={<ProjectDetailPage />} />
                <Route path="/governance" element={<GovernancePage />} />
                <Route path="/governance/create" element={<CreateProposalPage />} />
                <Route path="/audit" element={<AuditPage />} />
                <Route path="/architecture" element={<ArchitecturePage />} />
              </Routes>
            )}
          </div>
        </main>
      </div>
      <ToastViewport />
    </div>
  );
}

function AppSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <SkeletonBlock className="h-4 w-72" />
        <SkeletonBlock className="mt-3 h-10 w-[min(520px,90vw)]" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <SkeletonBlock key={index} className="h-36" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <SkeletonBlock className="h-[360px]" />
        <SkeletonBlock className="h-[360px]" />
      </div>
      <SkeletonBlock className="h-64" />
    </div>
  );
}
