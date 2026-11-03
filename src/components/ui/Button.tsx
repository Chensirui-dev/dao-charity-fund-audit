import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'gold' | 'ghost' | 'danger' | 'outline';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  icon?: ReactNode;
}

const variants: Record<Variant, string> = {
  gold: 'border-gold/40 bg-gradient-to-r from-gold-dark to-gold-light text-black shadow-gold hover:shadow-gold-strong active:scale-[0.98] disabled:from-zinc-700 disabled:to-zinc-700 disabled:text-zinc-400 disabled:shadow-none',
  ghost: 'border-line bg-card text-zinc-200 hover:bg-card-hover active:scale-[0.98] disabled:text-zinc-600',
  danger: 'border-red-500/40 bg-red-500/15 text-red-200 hover:bg-red-500/25 active:scale-[0.98] disabled:text-zinc-600',
  outline: 'border-line-gold bg-transparent text-gold hover:bg-gold/10 active:scale-[0.98] disabled:text-zinc-600',
};

export function Button({ variant = 'gold', loading = false, icon, children, className = '', disabled, ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-gold/40 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}
