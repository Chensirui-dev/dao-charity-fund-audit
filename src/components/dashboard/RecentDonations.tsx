import { HeartHandshake } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Address } from '../ui/Address';
import { formatEth, relativeTime } from '../../utils/format';

export function RecentDonations() {
  const { donations, campaigns } = useApp();
  const recent = donations.slice(0, 10);

  return (
    <div className="glass-card rounded-xl p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">最新捐款</h2>
        <span className="text-xs text-zinc-500">最近 {recent.length} 笔链上捐款，按时间倒序</span>
      </div>
      <div className="space-y-2.5">
        {recent.map((donation, index) => (
          <div
            key={donation.id}
            className="flex items-center gap-3 rounded-xl border border-line bg-card px-3 py-2.5 animate-slideIn transition hover:border-line-gold"
            style={{ animationDelay: `${index * 35}ms` }}
          >
            <div className="shrink-0 rounded-lg bg-emerald-500/10 p-2 text-emerald-400">
              <HeartHandshake className="h-4 w-4" />
            </div>

            {/* 第一列：捐赠人 + 项目。固定宽度，否则项目名长短会让右边的留言列参差不齐 */}
            <div className="w-[196px] shrink-0">
              <Address value={donation.donorAddress} />
              <div className="mt-0.5 truncate text-xs text-zinc-500">
                {campaigns.find((item) => item.id === donation.campaignId)?.name ?? '未知项目'}
              </div>
            </div>

            {/* 第二列：捐款留言 + 区块号，原来这里是空的 */}
            <div className="hidden min-w-0 flex-1 border-l border-line/70 pl-3 sm:block">
              <div className="truncate text-xs italic text-zinc-400">「{donation.message}」</div>
              <div className="mt-0.5 font-mono text-[11px] text-zinc-600">区块 #{donation.blockNumber.toLocaleString('en-US')}</div>
            </div>

            {/* 第三列：金额 + 时间 */}
            <div className="ml-auto shrink-0 text-right">
              <div className="font-mono text-sm font-semibold text-gold-light">{formatEth(donation.amount)}</div>
              <div className="mt-0.5 whitespace-nowrap text-[11px] text-zinc-500">{relativeTime(donation.timestamp)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
