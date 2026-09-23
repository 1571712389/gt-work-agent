import { useEffect } from 'react'
import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react'
import { useApp } from '../lib/store'

export default function Toast() {
  const toast = useApp((s) => s.toast)
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => useApp.getState().notify(null), 4000)
    return () => window.clearTimeout(timer)
  }, [toast?.id])
  if (!toast) return null
  const Icon = toast.kind === 'warn' ? CircleAlert : toast.kind === 'info' ? Info : CheckCircle2
  const tone =
    toast.kind === 'warn'
      ? 'border-warn/40 text-warn'
      : toast.kind === 'info'
        ? 'border-primary/40 text-primary'
        : 'border-emerald-500/40 text-emerald-600'
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 w-[min(440px,calc(100%-2rem))] -translate-x-1/2">
      <div
        role="status"
        className={`pointer-events-auto flex items-start gap-3 rounded-2xl border bg-panel px-4 py-3 shadow-[0_16px_40px_rgba(15,23,42,0.12)] ${tone}`}
      >
        <Icon size={18} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1 text-sm text-text">{toast.message}</div>
        {toast.actionView && toast.actionLabel && (
          <button
            type="button"
            className="shrink-0 text-xs text-primary transition-colors duration-200 hover:text-accent"
            onClick={() => {
              useApp.getState().setView(toast.actionView!)
              useApp.getState().notify(null)
            }}
          >
            {toast.actionLabel}
          </button>
        )}
        <button
          type="button"
          aria-label="关闭提示"
          className="shrink-0 text-muted transition-colors duration-200 hover:text-text"
          onClick={() => useApp.getState().notify(null)}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
