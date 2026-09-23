import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Eye } from 'lucide-react'
import { useApp } from '../lib/store'

export default function ModelPicker() {
  const settings = useApp((s) => s.settings)
  const entitlements = useApp((s) => s.entitlements)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  const models = useMemo(() => {
    const list = entitlements?.models?.length
      ? entitlements.models
      : settings?.model
        ? [{ id: settings.model, name: settings.model, tools: true, vision: false, kind: 'chat' as const, provider: '' }]
        : []
    return list.filter((m) => (m.kind || 'chat') === 'chat')
  }, [entitlements?.models, settings?.model])

  const current = models.find((m) => m.id === settings?.model) || models[0]
  const groups = useMemo(() => {
    const map = new Map<string, typeof models>()
    for (const model of models) {
      const key = model.provider || '可用模型'
      const list = map.get(key) || []
      list.push(model)
      map.set(key, list)
    }
    return [...map.entries()]
  }, [models])

  useEffect(() => {
    if (!open) return
    const onDoc = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = async (id: string) => {
    if (!settings) return
    const next = { ...settings, model: id }
    useApp.setState({ settings: next })
    await window.gt.settings.set(next)
    setOpen(false)
  }

  if (!current) {
    return <span className="text-[11px] text-muted">未登录，无可用模型</span>
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`当前模型 ${current.name}`}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex max-w-56 items-center gap-1 rounded-lg px-2 py-1 text-left text-[12px] text-muted transition-colors duration-200 hover:bg-white hover:text-text"
      >
        <span className="truncate font-medium text-text">{current.name}</span>
        {current.vision ? <Eye size={12} className="shrink-0 text-primary" aria-hidden /> : null}
        <ChevronDown size={12} className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="选择模型"
          className="absolute bottom-[calc(100%+8px)] left-0 z-30 w-72 overflow-hidden rounded-xl border border-line bg-white shadow-[0_8px_24px_rgba(15,23,42,0.08)]"
        >
          <div className="border-b border-line px-3 py-2 text-[11px] text-muted">已开通的模型</div>
          <div className="max-h-72 overflow-auto p-1">
            {groups.map(([provider, list]) => (
              <div key={provider} className="mb-1 last:mb-0">
                <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted">{provider}</div>
                {list.map((model) => {
                  const selected = model.id === current.id
                  return (
                    <button
                      key={model.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => void pick(model.id)}
                      className={`flex w-full cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-200 ${
                        selected ? 'bg-primary/10 text-primary' : 'text-text hover:bg-raised'
                      }`}
                    >
                      <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center">
                        {selected ? <Check size={12} /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-medium">{model.name}</span>
                        <span className="mt-0.5 flex flex-wrap gap-1 text-[10px] text-muted">
                          {model.vision ? <span>识图</span> : null}
                          {model.tools ? null : <span>无工具</span>}
                          <span className="truncate">{model.id}</span>
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}
            {models.length === 0 && <div className="px-3 py-4 text-xs text-muted">当前套餐没有可用模型</div>}
          </div>
        </div>
      )}
    </div>
  )
}
