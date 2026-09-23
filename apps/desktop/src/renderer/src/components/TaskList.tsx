import { Plus, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { MODES, useApp } from '../lib/store'
import type { TaskRecord } from '@shared/protocol'

function statusLabel(task: TaskRecord): string {
  if (task.status === 'running') return '进行中'
  if (task.status === 'completed') return '已完成'
  if (task.status === 'failed') return '失败'
  if (task.status === 'awaiting_plan') return '待确认'
  if (task.status === 'awaiting_permission') return '待授权'
  if (task.status === 'awaiting_question') return '待回答'
  return MODES.find((m) => m.id === task.mode)?.label || task.mode
}

export default function TaskList() {
  const tasks = useApp((s) => s.tasks)
  const currentId = useApp((s) => s.currentId)
  const setCurrent = useApp((s) => s.setCurrent)
  const upsertTask = useApp((s) => s.upsertTask)
  const [q, setQ] = useState('')

  const create = async (mode: 'ask' | 'craft' | 'plan') => {
    const task = await window.gt.tasks.create({ mode })
    upsertTask(task)
  }

  const filtered = useMemo(
    () => tasks.filter((task) => !q.trim() || task.title.includes(q.trim())),
    [tasks, q],
  )

  return (
    <section className="flex w-72 flex-col border-r border-line bg-panel">
      <div className="px-4 pb-3 pt-4">
        <div className="text-[15px] font-semibold tracking-tight">光途Work</div>
        <div className="mt-0.5 text-xs text-muted">每个任务独立工作空间</div>
        <button
          type="button"
          className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-primary/90"
          onClick={() => void create('craft')}
        >
          <Plus size={16} /> 新建任务
        </button>
        <label className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-ink px-3 py-2 text-sm">
          <Search size={14} className="text-muted" />
          <input
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
            placeholder="搜索任务"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </div>
      <div className="flex gap-1 px-3 pb-3">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            title={m.hint}
            onClick={() => void create(m.id)}
            className="flex-1 rounded-lg bg-raised px-2 py-1 text-[11px] text-muted transition-colors duration-200 hover:bg-primary/10 hover:text-primary"
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto px-2 pb-3">
        {filtered.length === 0 && <div className="px-2 py-8 text-center text-sm text-muted">还没有任务</div>}
        {filtered.map((task) => {
          const active = task.id === currentId
          return (
            <div
              key={task.id}
              className={`group mb-1 flex items-start gap-2 rounded-xl px-3 py-2.5 transition-colors duration-200 ${
                active ? 'bg-primary/10' : 'hover:bg-raised'
              }`}
            >
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setCurrent(task.id)}>
                <div className={`truncate text-sm ${active ? 'font-medium text-primary' : 'text-text'}`}>
                  {task.title}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                  <span className={task.status === 'running' ? 'text-primary' : ''}>{statusLabel(task)}</span>
                </div>
              </button>
              <button
                type="button"
                aria-label={`删除任务 ${task.title}`}
                className="hidden text-muted transition-colors duration-200 hover:text-warn group-hover:block"
                onClick={() => {
                  void window.gt.tasks.remove(task.id).then(() => {
                    useApp.setState({
                      tasks: useApp.getState().tasks.filter((t) => t.id !== task.id),
                      currentId: useApp.getState().currentId === task.id ? null : useApp.getState().currentId,
                    })
                  })
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}
