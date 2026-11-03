import { SearchX } from 'lucide-react';

export function EmptyState({ title = '暂无数据', description = '调整筛选条件后再试试。' }: { title?: string; description?: string }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-line bg-card/50 p-8 text-center">
      <SearchX className="h-10 w-10 text-zinc-600" />
      <div className="mt-3 font-semibold text-zinc-200">{title}</div>
      <div className="mt-1 text-sm text-zinc-500">{description}</div>
    </div>
  );
}
