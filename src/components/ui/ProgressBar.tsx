export function ProgressBar({ value, className = '', large = false }: { value: number; className?: string; large?: boolean }) {
  return (
    <div className={`w-full overflow-hidden rounded-full bg-zinc-800 ${large ? 'h-4' : 'h-2.5'} ${className}`}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 shadow-emerald transition-all duration-700"
        style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
      />
    </div>
  );
}
