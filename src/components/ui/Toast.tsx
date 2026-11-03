import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export function ToastViewport() {
  const { toasts, removeToast } = useApp();
  return (
    <div className="fixed right-4 top-4 z-[60] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-3">
      {toasts.map((toast) => {
        const Icon = toast.type === 'success' ? CheckCircle2 : toast.type === 'error' ? XCircle : Info;
        return (
          <div key={toast.id} className="glass-card animate-slideIn rounded-xl p-4">
            <div className="flex gap-3">
              <Icon className={`mt-0.5 h-5 w-5 ${toast.type === 'success' ? 'text-emerald-400' : toast.type === 'error' ? 'text-red-400' : 'text-blue-400'}`} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-zinc-100">{toast.title}</div>
                {toast.description ? <div className="mt-1 break-all font-mono text-xs text-zinc-400">{toast.description}</div> : null}
              </div>
              <button className="text-zinc-500 transition hover:text-zinc-100" onClick={() => removeToast(toast.id)} aria-label="关闭通知">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
