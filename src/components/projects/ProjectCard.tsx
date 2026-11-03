import { HandCoins, LockKeyhole, Snowflake } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import type { Campaign } from '../../types';
import { formatEth, progressPercent } from '../../utils/format';
import { Address } from '../ui/Address';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ProgressBar } from '../ui/ProgressBar';

const FALLBACK_GRADIENT = 'from-gold/30 via-emerald-500/20 to-blue-500/25';

export function ProjectCard({ campaign, onDonate }: { campaign: Campaign; onDonate: (campaign: Campaign) => void }) {
  const { permissions } = useApp();
  const percent = progressPercent(campaign.raisedAmount, campaign.targetAmount);
  const disabledReason = campaign.frozen
    ? '项目已被审计员冻结'
    : !permissions.canDonate
      ? '当前角色无捐款权限'
      : campaign.status !== 'ACTIVE'
        ? '项目暂不可捐款'
        : '';

  return (
    <div className="glass-card group overflow-hidden rounded-xl transition-all duration-300 hover:border-line-gold hover:bg-card-hover">
      <Link
        to={`/projects/${campaign.id}`}
        className={`relative block h-40 overflow-hidden bg-gradient-to-br ${campaign.coverGradient || FALLBACK_GRADIENT}`}
      >
        {campaign.coverImage ? (
          <img
            src={campaign.coverImage}
            alt={campaign.name}
            loading="lazy"
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
            onError={(event) => {
              // 图挂了就退回渐变底，避免出现破图图标
              event.currentTarget.style.display = 'none';
            }}
          />
        ) : null}
        {/* 两段遮罩：压暗图片保证徽章可读，底部渐隐让卡片与标题衔接 */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-black/25" />
        {/* 亮色照片上徽章容易糊掉，垫一层半透明底再放 */}
        <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black/45 p-0.5 backdrop-blur-sm">
          {campaign.frozen ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-sky-400/60 bg-sky-500/25 px-2 py-0.5 text-[11px] font-semibold text-sky-100">
              <Snowflake className="h-3 w-3" /> 冻结
            </span>
          ) : null}
          <Badge kind={campaign.status} />
        </div>
        <div className="absolute inset-x-4 bottom-3 flex items-end justify-between gap-3">
          <span className="font-mono text-[11px] tracking-wide text-white/70">{campaign.id.toUpperCase()}</span>
          <span className="font-mono text-[11px] text-white/70">{formatEth(campaign.targetAmount)} 目标</span>
        </div>
      </Link>
      <div className="space-y-4 p-5">
        <div>
          <Link to={`/projects/${campaign.id}`} className="text-lg font-semibold text-zinc-100 transition hover:text-gold-light">
            {campaign.name}
          </Link>
          <div className="mt-1 flex items-center gap-2 text-sm text-zinc-500">
            受助方 <Address value={campaign.recipientAddress} />
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-zinc-500">筹款进度</span>
            <span className="font-mono text-emerald-300">{percent.toFixed(1)}%</span>
          </div>
          <ProgressBar value={percent} />
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="font-mono text-sm">
            <span className="text-gold-light">{formatEth(campaign.raisedAmount)}</span>
            <span className="text-zinc-500"> / {formatEth(campaign.targetAmount)}</span>
          </div>
          <Button
            icon={disabledReason ? <LockKeyhole className="h-4 w-4" /> : <HandCoins className="h-4 w-4" />}
            disabled={!!disabledReason}
            title={disabledReason || '发起捐款'}
            onClick={() => onDonate(campaign)}
          >
            捐款
          </Button>
        </div>
        {disabledReason ? <div className="text-xs text-zinc-600">{disabledReason}</div> : null}
      </div>
    </div>
  );
}
