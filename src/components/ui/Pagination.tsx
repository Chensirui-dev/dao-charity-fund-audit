import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';

export function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (page: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
      <span className="text-sm text-zinc-500">
        第 <span className="font-mono text-zinc-200">{page}</span> / <span className="font-mono text-zinc-200">{totalPages}</span> 页
      </span>
      <div className="flex gap-2">
        <Button variant="ghost" icon={<ChevronLeft className="h-4 w-4" />} disabled={page === 1} onClick={() => onPage(page - 1)}>
          上一页
        </Button>
        <Button variant="ghost" icon={<ChevronRight className="h-4 w-4" />} disabled={page === totalPages} onClick={() => onPage(page + 1)}>
          下一页
        </Button>
      </div>
    </div>
  );
}
