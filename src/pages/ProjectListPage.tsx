import { LockKeyhole, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CreateCampaignModal } from '../components/projects/CreateCampaignModal';
import { DonateModal } from '../components/projects/DonateModal';
import { ProjectCard } from '../components/projects/ProjectCard';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { useApp } from '../context/AppContext';
import type { Campaign, CampaignStatus } from '../types';

const filters: Array<{ label: string; value: 'ALL' | CampaignStatus }> = [
  { label: '全部', value: 'ALL' },
  { label: '进行中', value: 'ACTIVE' },
  { label: '已完成', value: 'COMPLETED' },
  { label: '待审核', value: 'PENDING' },
];

export function ProjectListPage() {
  const { campaigns, permissions, roleProfiles, currentRole } = useApp();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'ALL' | CampaignStatus>('ALL');
  const [donating, setDonating] = useState<Campaign | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(
    () =>
      campaigns.filter((campaign) => {
        const keyword = `${campaign.name}${campaign.description}`.toLowerCase();
        return keyword.includes(query.toLowerCase()) && (status === 'ALL' || campaign.status === status);
      }),
    [campaigns, query, status],
  );

  const createDisabled = !permissions.canCreateCampaign;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm text-zinc-500">链上项目池</p>
          <h1 className="mt-2 text-3xl font-bold gold-text">公益项目</h1>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <Button icon={createDisabled ? <LockKeyhole className="h-4 w-4" /> : <Plus className="h-4 w-4" />} disabled={createDisabled} onClick={() => setCreating(true)}>
            申请上架项目
          </Button>
          {createDisabled ? <span className="text-xs text-zinc-600">当前角色：{roleProfiles[currentRole].label}，无项目上架权限</span> : null}
        </div>
      </div>
      <div className="glass-card rounded-xl p-4">
        <div className="flex flex-col gap-3 lg:flex-row">
          <label className="flex min-h-11 flex-1 items-center gap-2 rounded-xl border border-line bg-black/30 px-3 focus-within:border-gold/60">
            <Search className="h-4 w-4 text-zinc-500" />
            <input className="w-full bg-transparent outline-none" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目名称、描述" />
          </label>
          <div className="flex flex-wrap gap-2">
            {filters.map((filter) => (
              <Button key={filter.value} variant={status === filter.value ? 'outline' : 'ghost'} onClick={() => setStatus(filter.value)}>
                {filter.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
      {filtered.length ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((campaign) => (
            <ProjectCard key={campaign.id} campaign={campaign} onDonate={setDonating} />
          ))}
        </div>
      ) : (
        <EmptyState title="没有匹配项目" />
      )}
      <DonateModal campaign={donating} onClose={() => setDonating(null)} />
      <CreateCampaignModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
