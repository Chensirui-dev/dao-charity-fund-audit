/**
 * 系统架构图（纯 SVG，不带外部依赖）。
 * 用 SVG 而不是 div 拼版，是为了能直接截图放进论文，且缩放不失真。
 * 五层从上到下：用户角色 → 前端应用 → 钱包 → 智能合约 → 链上存储。
 */

const W = 1080;
const H = 700;

const GOLD = '#D4A853';
const GREEN = '#10B981';
const BLUE = '#3B82F6';
const PURPLE = '#A78BFA';
const TEXT = '#E4E4E7';
const MUTED = '#8B8B94';
const FAINT = '#5A5A63';
const PANEL = '#111111';
const BORDER = '#2A2A2A';

interface Role {
  name: string;
  desc: string;
  color: string;
}

const ROLES: Role[] = [
  { name: '捐赠人', desc: '浏览项目 · 发起捐款交易', color: GOLD },
  { name: '项目方', desc: '提交立项 · 发起上架提案', color: BLUE },
  { name: 'DAO 理事', desc: '投票表决 · 执行拨款', color: GREEN },
  { name: '审计员', desc: '核验批次 · 查验证明', color: PURPLE },
];

const PAGES = ['仪表盘', '公益项目', 'DAO 治理', '审计追踪'];

interface Contract {
  name: string;
  duty: string;
  fns: string[];
  color: string;
}

const CONTRACTS: Contract[] = [
  {
    name: 'DaoGovernor',
    duty: '提案 · 投票 · 执行',
    fns: ['proposeCampaign', 'castVote', 'executeProposal'],
    color: GOLD,
  },
  {
    name: 'DonationVault',
    duty: '募资 · 拨付',
    fns: ['donate', 'releaseFunds', 'campaignAccounts'],
    color: GREEN,
  },
  {
    name: 'AuditRegistry',
    duty: '留痕 · 锚定 · 验真',
    fns: ['appendAuditLog', 'anchorBatch', 'verifyProof'],
    color: BLUE,
  },
];

const STORAGE = [
  { title: '项目元数据', detail: 'metadataURI 内嵌 meta:{…}，跨窗口可复原' },
  { title: '资金账户', detail: 'campaignAccounts{raised, released}，拨付前校验余额' },
  { title: '审计批次', detail: '流水哈希 → Merkle 根 → 上链锚定' },
];

/** 层与层之间的连接箭头，带一句协议说明 */
function Flow({ x, y1, y2, label, both }: { x: number; y1: number; y2: number; label: string; both?: boolean }) {
  const midY = (y1 + y2) / 2;
  return (
    <g>
      <line x1={x} y1={y1} x2={x} y2={y2 - 6} stroke={BORDER} strokeWidth={1.5} />
      <path d={`M${x - 4},${y2 - 8} L${x},${y2} L${x + 4},${y2 - 8}`} fill={BORDER} />
      {both && <path d={`M${x - 4},${y1 + 8} L${x},${y1} L${x + 4},${y1 + 8}`} fill={BORDER} />}
      <rect x={x - 96} y={midY - 9} width={192} height={18} rx={9} fill="#0B0B0B" stroke={BORDER} />
      <text x={x} y={midY + 4} textAnchor="middle" fontSize={10.5} fill={MUTED}>
        {label}
      </text>
    </g>
  );
}

export function ArchitectureDiagram() {
  return (
    <div className="glass-card rounded-xl p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">系统分层架构</h2>
        <span className="text-xs text-zinc-500">四个角色 · 三个合约 · 一条不可篡改的审计链</span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="去中心化公益资金审计系统分层架构图">
        <defs>
          <linearGradient id="diagramBg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#141414" />
            <stop offset="100%" stopColor="#0B0B0B" />
          </linearGradient>
        </defs>
        <rect x={0} y={0} width={W} height={H} fill="url(#diagramBg)" rx={10} />

        {/* ── 第一层：用户角色 ───────────────────────────────── */}
        <text x={40} y={30} fontSize={11} fill={FAINT} letterSpacing={1}>
          01 用户角色
        </text>
        {ROLES.map((role, index) => {
          const x = 40 + index * 256;
          return (
            <g key={role.name}>
              <rect x={x} y={42} width={232} height={72} rx={10} fill={PANEL} stroke={BORDER} />
              <rect x={x} y={42} width={4} height={72} rx={2} fill={role.color} />
              <circle cx={x + 24} cy={66} r={5} fill={role.color} />
              <text x={x + 40} y={71} fontSize={14} fontWeight={600} fill={TEXT}>
                {role.name}
              </text>
              <text x={x + 40} y={94} fontSize={11} fill={MUTED}>
                {role.desc}
              </text>
            </g>
          );
        })}

        <Flow x={W / 2} y1={114} y2={150} label="浏览器内操作" />

        {/* ── 第二层：前端应用 ───────────────────────────────── */}
        <text x={40} y={166} fontSize={11} fill={FAINT} letterSpacing={1}>
          02 前端应用层
        </text>
        <rect x={40} y={178} width={1000} height={96} rx={10} fill={PANEL} stroke={BORDER} />
        <text x={60} y={204} fontSize={12} fontWeight={600} fill={TEXT}>
          React 18 + Vite + Tailwind · 单页应用
        </text>
        <text x={60} y={222} fontSize={10.5} fill={FAINT}>
          四个角色共用同一套页面，权限由角色决定；跨窗口唯一共享通道是合约，靠 10 秒轮询 + 切页即时同步对齐
        </text>
        {PAGES.map((page, index) => {
          const x = 60 + index * 245;
          return (
            <g key={page}>
              <rect x={x} y={236} width={225} height={26} rx={6} fill="#1A1A1A" stroke={BORDER} />
              <text x={x + 112} y={253} textAnchor="middle" fontSize={11} fill="#C4C4CC">
                {page}
              </text>
            </g>
          );
        })}

        <Flow x={W / 2} y1={274} y2={310} label="EIP-1193 账户授权与签名" both />

        {/* ── 第三层：钱包 ───────────────────────────────────── */}
        <text x={40} y={326} fontSize={11} fill={FAINT} letterSpacing={1}>
          03 钱包与签名
        </text>
        <rect x={300} y={338} width={480} height={62} rx={10} fill="#161410" stroke="#3A2F18" />
        <text x={540} y={362} textAnchor="middle" fontSize={13} fontWeight={600} fill={GOLD}>
          MetaMask
        </text>
        <text x={540} y={384} textAnchor="middle" fontSize={10.5} fill={MUTED}>
          私钥不离开浏览器，交易在本地签名后广播
        </text>

        <Flow x={W / 2} y1={400} y2={436} label="已签名交易" both />

        {/* ── 第四层：智能合约 ───────────────────────────────── */}
        <text x={40} y={452} fontSize={11} fill={FAINT} letterSpacing={1}>
          04 智能合约层 · Sepolia (chainId 11155111)
        </text>
        {CONTRACTS.map((contract, index) => {
          const contractWidth = 304;
          const gap = 40;
          const x = 40 + index * (contractWidth + gap);
          return (
            <g key={contract.name}>
              <rect x={x} y={464} width={contractWidth} height={116} rx={10} fill={PANEL} stroke={BORDER} />
              <rect x={x} y={464} width={contractWidth} height={3} rx={2} fill={contract.color} />
              <text x={x + 18} y={492} fontSize={13} fontWeight={600} fill={TEXT}>
                {contract.name}
              </text>
              <text x={x + 18} y={510} fontSize={10.5} fill={contract.color}>
                {contract.duty}
              </text>
              {contract.fns.map((fn, fnIndex) => (
                <text key={fn} x={x + 18} y={532 + fnIndex * 15} fontSize={10} fill={MUTED} fontFamily="ui-monospace, Menlo, monospace">
                  {fn}()
                </text>
              ))}
              {/* 合约之间的调用箭头：治理执行 → 资金拨付 → 审计留痕 */}
              {index < 2 && (
                <g>
                  <line x1={x + contractWidth} y1={524} x2={x + contractWidth + gap - 6} y2={524} stroke="#4A4A52" strokeWidth={1.5} />
                  <path
                    d={`M${x + contractWidth + gap - 10},${519} L${x + contractWidth + gap - 2},${524} L${x + contractWidth + gap - 10},${529}`}
                    fill="#4A4A52"
                  />
                  <text x={x + contractWidth + gap / 2} y={514} textAnchor="middle" fontSize={9} fill={FAINT}>
                    {index === 0 ? '调用' : '写入'}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        <Flow x={W / 2} y1={580} y2={614} label="状态落链，不可篡改" />

        {/* ── 第五层：链上存储 ───────────────────────────────── */}
        <text x={40} y={630} fontSize={11} fill={FAINT} letterSpacing={1}>
          05 链上存储
        </text>
        {STORAGE.map((item, index) => {
          const x = 40 + index * 344;
          return (
            <g key={item.title}>
              <rect x={x} y={640} width={304} height={46} rx={8} fill="#0F0F0F" stroke={BORDER} strokeDasharray="4 3" />
              <text x={x + 16} y={660} fontSize={11} fontWeight={600} fill="#C4C4CC">
                {item.title}
              </text>
              <text x={x + 16} y={676} fontSize={9.5} fill={FAINT}>
                {item.detail}
              </text>
            </g>
          );
        })}
      </svg>

      <p className="mt-3 text-xs leading-5 text-zinc-500">
        链上与链下的边界：项目介绍、封面等描述性内容以 JSON 形式编码进
        <span className="font-mono text-zinc-400"> metadataURI </span>
        随立项交易一起上链；资金余额、投票结果、审计记录则直接存在合约状态里，
        前端只负责读取和发起交易，不持有任何权威数据。
      </p>
    </div>
  );
}
