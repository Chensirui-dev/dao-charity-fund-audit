import { Copy } from 'lucide-react';
import { MouseEvent } from 'react';
import { useApp } from '../../context/AppContext';
import { useClipboard } from '../../hooks/useClipboard';
import { shortAddress } from '../../utils/format';

export function Address({ value, className = '' }: { value: string; className?: string }) {
  const { copied, copyToClipboard } = useClipboard();
  const { notifyCopied } = useApp();

  const handleCopy = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    await copyToClipboard(value);
    notifyCopied(value);
  };

  return (
    <button
      className={`group relative inline-flex items-center gap-1 rounded-lg px-1.5 py-1 font-mono text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-gold ${className}`}
      onClick={handleCopy}
      title={value}
      type="button"
    >
      {shortAddress(value)}
      <Copy className="h-3 w-3 opacity-0 transition group-hover:opacity-100" />
      <span className="pointer-events-none absolute -top-9 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-zinc-950 px-2 py-1 text-xs text-zinc-200 shadow-lg group-hover:block">
        {copied ? '已复制' : value}
      </span>
    </button>
  );
}
