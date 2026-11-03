import { useMemo } from 'react';
import { ResponsiveContainer, Sankey, Tooltip } from 'recharts';
import { useApp } from '../../context/AppContext';
import { weiToEth } from '../../utils/format';

/** 节点层级，决定颜色与标签朝哪一侧摆 */
type NodeKind = 'source' | 'pool' | 'project' | 'recipient';

interface SankeyNodeMeta {
  name: string;
  kind: NodeKind;
  /** 节点主金额：源头/池子是总额，项目是已筹，受助方是已拨付 */
  amount: number;
  /** 项目节点额外显示已拨付金额 */
  released?: number;
}

interface SankeyLinkMeta {
  source: number;
  target: number;
  value: number;
  flowName: string;
  projectName: string;
  amount: number;
}

const NODE_COLOR: Record<NodeKind, { fill: string; glow: string }> = {
  source: { fill: '#D4A853', glow: 'rgba(212,168,83,0.55)' },
  pool: { fill: '#10B981', glow: 'rgba(16,185,129,0.5)' },
  project: { fill: '#3B82F6', glow: 'rgba(59,130,246,0.45)' },
  recipient: { fill: '#E8C87A', glow: 'rgba(232,200,122,0.5)' },
};

/** 标签排版：最右一列的节点把文字摆到左侧，其余摆到右侧，避免画出画布 */
function labelOnLeft(x: number, width: number, containerWidth: number) {
  return x + width > containerWidth * 0.78;
}

/**
 * 自定义节点：recharts 默认只画矩形不画文字，必须自己渲染，
 * 否则整张图只剩色带、没有任何可读信息。
 */
function FlowNode(props: any) {
  const { x, y, width, height, payload, containerWidth } = props as {
    x: number;
    y: number;
    width: number;
    height: number;
    payload: SankeyNodeMeta & { value?: number };
    containerWidth: number;
  };

  const kind: NodeKind = payload.kind ?? 'project';
  const color = NODE_COLOR[kind];
  const amount = payload.amount ?? 0;
  const centerY = y + height / 2;
  const onLeft = labelOnLeft(x, width, containerWidth);
  const textX = onLeft ? x - 12 : x + width + 12;
  const anchor = onLeft ? 'end' : 'start';

  // 参与度很小的节点高度会很矮，两行文字塞不下就只留名称
  const twoLines = height >= 32;

  // 项目列的标签左右都会压在色带上，给文字加一圈深色描边保证可读
  const textStyle = { paintOrder: 'stroke' as const, stroke: '#0B0B0B', strokeWidth: 3, strokeLinejoin: 'round' as const };

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={3}
        fill={color.fill}
        style={{ filter: `drop-shadow(0 0 6px ${color.glow})` }}
      />
      <text
        x={textX}
        y={twoLines ? centerY - 7 : centerY}
        textAnchor={anchor}
        dominantBaseline="middle"
        fill="#E4E4E7"
        fontSize={12}
        fontWeight={600}
        style={textStyle}
      >
        {payload.name}
      </text>
      {twoLines && (
        <text
          x={textX}
          y={centerY + 10}
          textAnchor={anchor}
          dominantBaseline="middle"
          fill={color.fill}
          fontSize={11}
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          style={textStyle}
        >
          {amount.toFixed(2)} ETH
        </text>
      )}
    </g>
  );
}

function FlowLink(props: any) {
  const { sourceX, targetX, sourceY, targetY, linkWidth, payload } = props;
  const curvature = 0.5;
  const xi = (targetX - sourceX) * curvature;
  const path = `M${sourceX},${sourceY}C${sourceX + xi},${sourceY} ${targetX - xi},${targetY} ${targetX},${targetY}`;

  return (
    <path
      d={path}
      stroke="url(#sankeyGradient)"
      strokeOpacity={0.38}
      strokeWidth={Math.max(1.5, linkWidth)}
      fill="none"
      className="transition-all duration-200 hover:opacity-90"
      style={{ cursor: 'pointer' }}
      aria-label={`${payload?.flowName ?? '资金流'} ${Number(payload?.value ?? 0).toFixed(2)} ETH`}
    />
  );
}

interface TooltipEntry {
  payload?: {
    payload?: SankeyLinkMeta | SankeyNodeMeta;
  } & Partial<SankeyLinkMeta & SankeyNodeMeta>;
}

function FlowTooltip({ active, payload }: { active?: boolean; payload?: TooltipEntry[] }) {
  if (!active || !payload?.length) return null;

  const item = payload[0];
  const activeElement = item.payload;
  const data = activeElement?.payload ?? activeElement;
  if (!data) return null;

  const isLink = 'flowName' in data && !!data.flowName;
  const amount = Number(data.amount ?? (data as SankeyLinkMeta).value ?? 0);
  const title = isLink ? (data as SankeyLinkMeta).flowName : (data as SankeyNodeMeta).name;
  const subtitle = isLink ? (data as SankeyLinkMeta).projectName : '资金流节点汇总';

  return (
    <div className="rounded-xl border border-line-gold bg-card p-3 shadow-gold">
      <div className="text-sm font-semibold text-zinc-100">{title}</div>
      <div className="mt-2 font-mono text-lg text-gold-light">{amount.toFixed(2)} ETH</div>
      <div className="mt-1 text-xs text-emerald-300">{subtitle}</div>
    </div>
  );
}

/** 展示的资金链路最多铺开的项目数，太多标签会互相压字 */
const MAX_PROJECTS = 3;

export function FlowSankey() {
  const { campaigns, auditLogs } = useApp();

  const model = useMemo(() => {
    // 每个项目已经真正拨给受助方多少：以审计台账里的拨付记录为准，
    // 不用「已筹 × 某个固定比例」这种拍脑袋的假设
    const releasedByCampaign = new Map<string, number>();
    auditLogs
      .filter((log) => log.operationType === 'WITHDRAWAL')
      .forEach((log) => {
        const current = releasedByCampaign.get(log.campaignId) ?? 0;
        releasedByCampaign.set(log.campaignId, current + weiToEth(log.amount));
      });

    // 只画真的有钱进来的项目。已筹为 0 的项目如果也画，会被压成一条看不见的细线，
    // 看起来像渲染错误，实际是没有资金流可画
    const flowCampaigns = campaigns
      .filter((campaign) => campaign.status !== 'REJECTED' && weiToEth(campaign.raisedAmount) > 0)
      .sort((a, b) => weiToEth(b.raisedAmount) - weiToEth(a.raisedAmount))
      .slice(0, MAX_PROJECTS);

    if (!flowCampaigns.length) {
      return {
        nodes: [] as SankeyNodeMeta[],
        links: [] as SankeyLinkMeta[],
        totalRaised: 0,
        totalReleased: 0,
        allRaised: 0,
        allCount: 0,
      };
    }

    const allRaised = campaigns
      .filter((campaign) => campaign.status !== 'REJECTED')
      .reduce((sum, campaign) => sum + weiToEth(campaign.raisedAmount), 0);

    const totalRaised = flowCampaigns.reduce((sum, item) => sum + weiToEth(item.raisedAmount), 0);
    const releasedList = flowCampaigns.map((campaign) => ({
      campaign,
      released: Math.min(weiToEth(campaign.raisedAmount), releasedByCampaign.get(campaign.id) ?? 0),
    }));
    const totalReleased = releasedList.reduce((sum, item) => sum + item.released, 0);

    const recipientIndex = flowCampaigns.length + 2;
    const nodes: SankeyNodeMeta[] = [
      { name: '个人捐款', kind: 'source', amount: totalRaised },
      { name: '公益资金池', kind: 'pool', amount: totalRaised },
      ...flowCampaigns.map((campaign) => ({
        name: campaign.name,
        kind: 'project' as NodeKind,
        amount: weiToEth(campaign.raisedAmount),
        released: releasedByCampaign.get(campaign.id) ?? 0,
      })),
      { name: '受助方', kind: 'recipient', amount: totalReleased },
    ];

    const links: SankeyLinkMeta[] = [
      {
        source: 0,
        target: 1,
        value: totalRaised,
        flowName: '个人捐款 → 公益资金池',
        projectName: `${flowCampaigns.length} 个在募集项目合计`,
        amount: totalRaised,
      },
      ...flowCampaigns.map((campaign, index) => ({
        source: 1,
        target: index + 2,
        value: weiToEth(campaign.raisedAmount),
        flowName: `公益资金池 → ${campaign.name}`,
        projectName: campaign.name,
        amount: weiToEth(campaign.raisedAmount),
      })),
      // 没有拨付过的项目不画最后一跳，否则会出现一条 0 值细线
      ...releasedList
        .map((item, index) => ({ ...item, index }))
        .filter((item) => item.released > 0)
        .map((item) => ({
          source: item.index + 2,
          target: recipientIndex,
          value: item.released,
          flowName: `${item.campaign.name} → 受助方`,
          projectName: 'DAO 表决通过后按批次拨付',
          amount: item.released,
        })),
    ];

    return { nodes, links, totalRaised, totalReleased, allRaised, allCount: flowCampaigns.length };
  }, [campaigns, auditLogs]);

  const pendingRelease = model.totalRaised - model.totalReleased;

  if (!model.nodes.length) {
    return (
      <div className="glass-card rounded-xl p-5">
        <h2 className="mb-2 text-lg font-semibold">资金流向桑基图</h2>
        <p className="py-16 text-center text-sm text-zinc-500">还没有项目募集到资金，暂无可展示的资金流</p>
      </div>
    );
  }

  return (
    <div className="glass-card flex flex-col rounded-xl p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">资金流向桑基图</h2>
        <span className="text-xs text-zinc-500">捐款上链 → 资金池 → 项目 → 受助方</span>
      </div>
      <p className="mb-2 text-xs text-zinc-500">
        展开余额最高的 {model.allCount} 个项目 ｜ 已筹{' '}
        <span className="font-mono text-gold-light">{model.totalRaised.toFixed(2)}</span> · 已拨付{' '}
        <span className="font-mono text-emerald-300">{model.totalReleased.toFixed(2)}</span> · 待表决{' '}
        <span className="font-mono text-zinc-300">{pendingRelease.toFixed(2)}</span> ETH ｜ 全部项目累计{' '}
        <span className="font-mono text-zinc-400">{model.allRaised.toFixed(2)}</span> ETH
      </p>

      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <Sankey
            data={{ nodes: model.nodes, links: model.links }}
            nodePadding={16}
            nodeWidth={10}
            margin={{ top: 26, right: 108, bottom: 26, left: 70 }}
            link={<FlowLink />}
            node={<FlowNode />}
          >
            <defs>
              <linearGradient id="sankeyGradient" x1="0" x2="1">
                <stop offset="0%" stopColor="#D4A853" />
                <stop offset="55%" stopColor="#10B981" />
                <stop offset="100%" stopColor="#3B82F6" />
              </linearGradient>
            </defs>
            <Tooltip content={<FlowTooltip />} />
          </Sankey>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line/60 pt-3 text-xs text-zinc-500">
        {(
          [
            ['source', '捐款人'],
            ['pool', '资金池'],
            ['project', '项目专户'],
            ['recipient', '受助方'],
          ] as [NodeKind, string][]
        ).map(([kind, label]) => (
          <span key={kind} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: NODE_COLOR[kind].fill }} />
            {label}
          </span>
        ))}
        <span className="ml-auto text-zinc-600">项目色块未铺满的部分＝尚未表决拨付的余额</span>
      </div>
    </div>
  );
}
