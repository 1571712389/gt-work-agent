import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PanelRight, PanelRightOpen } from 'lucide-react'
import Composer from '../components/Composer'
import MessageList from '../components/MessageList'
import RightPane from '../components/RightPane'
import TaskList from '../components/TaskList'
import { useActivityLabel } from '../lib/agent-status'
import { quotaExhausted } from '../lib/quota'
import { useApp } from '../lib/store'
import type { AgentMode, WorkspaceEntry } from '@shared/protocol'

const PANE_KEY = 'gt.workspaceOpen'

export default function WorkbenchPage() {
  const tasks = useApp((s) => s.tasks)
  const currentId = useApp((s) => s.currentId)
  const entitlements = useApp((s) => s.entitlements)
  const experts = useApp((s) => s.experts)
  const teams = useApp((s) => s.teams)
  const settings = useApp((s) => s.settings)
  const task = tasks.find((t) => t.id === currentId) || null
  const [files, setFiles] = useState<WorkspaceEntry[]>([])
  const [workspaceOpen, setWorkspaceOpen] = useState(() => {
    try {
      return localStorage.getItem(PANE_KEY) !== '0'
    } catch {
      return true
    }
  })
  const upsertTask = useApp((s) => s.upsertTask)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const holdingRef = useRef(false)
  const prevLenRef = useRef(0)
  const lastIdRef = useRef<string | null>(null)
  const lastMsg = task?.messages.at(-1)
  const activity = useActivityLabel(task?.messages || [], task?.status === 'running')

  const scrollToBottom = () => {
    const el = scrollerRef.current
    if (!el || holdingRef.current || !stickRef.current) return
    el.scrollTop = el.scrollHeight
  }

  useLayoutEffect(() => {
    if (lastIdRef.current !== (task?.id || null)) {
      lastIdRef.current = task?.id || null
      prevLenRef.current = task?.messages.length || 0
      stickRef.current = true
      holdingRef.current = false
      const el = scrollerRef.current
      if (el) el.scrollTop = el.scrollHeight
      return
    }
    const len = task?.messages.length || 0
    if (len > prevLenRef.current && lastMsg?.role === 'user') stickRef.current = true
    prevLenRef.current = len
    scrollToBottom()
  }, [task?.id, task?.messages.length, lastMsg?.content?.length, lastMsg?.role])

  const toggleWorkspace = () => {
    setWorkspaceOpen((open) => {
      const next = !open
      try {
        localStorage.setItem(PANE_KEY, next ? '1' : '0')
      } catch {
        /* ignore quota / private mode */
      }
      return next
    })
  }

  useEffect(() => {
    if (!task) return
    void window.gt.workspace.list(task.id).then(setFiles)
  }, [task?.id, task?.status, task?.messages.length])

  useEffect(() => {
    if (!task || (task.status !== 'completed' && task.status !== 'failed' && task.status !== 'stopped')) return
    void window.gt.account.entitlements().then((ent) => {
      if (ent) useApp.setState({ entitlements: ent })
    })
  }, [task?.id, task?.status])

  const changeMode = async (mode: AgentMode) => {
    if (!task) return
    const next = await window.gt.tasks.patch(task.id, { mode })
    if (next) upsertTask(next)
  }

  const sub = entitlements?.subscription
  const expired = Boolean(sub && sub.expiresAt < Date.now())
  const used = Math.max(0, Math.min(100, sub?.usagePercent ?? 0))

  return (
    <div className="flex min-w-0 flex-1 bg-ink">
      <TaskList />
      <section className="chat-stage flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-line bg-panel px-5 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{task?.title || '光途Work'}</div>
            <div className="truncate text-xs text-muted">
              {task
                ? [
                    task.mode === 'ask' ? '问一问' : task.mode === 'plan' ? '想一想' : '做一做',
                    entitlements?.models.find((m) => m.id === settings?.model)?.name || settings?.model,
                    experts.find((item) => item.id === task.selectedExpert)?.name,
                    teams.find((item) => item.id === task.selectedTeam)?.name,
                    task.selectedSkills.length ? `${task.selectedSkills.length} 个技能` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : '输入一句话就会自动新建任务并发出去'}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="w-40 shrink-0 cursor-pointer rounded-xl border border-line bg-ink px-3 py-2 text-left transition-colors duration-200 hover:border-primary/40"
              onClick={() => useApp.getState().setView('account')}
              title="查看套餐与用量"
            >
              {sub && !expired ? (
                <>
                  <div className="mb-1 flex justify-between gap-2 text-[11px] text-muted">
                    <span className="truncate">{sub.packageName}</span>
                    <span className="shrink-0 whitespace-nowrap">已使用 {used}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-raised">
                    <div
                      className={`h-full transition-[width] duration-200 ${used >= 90 ? 'bg-warn' : 'bg-primary'}`}
                      style={{ width: `${used}%` }}
                    />
                  </div>
                </>
              ) : (
                <span className="whitespace-nowrap text-xs text-warn">{expired ? '套餐已到期' : '未登录 / 无套餐'}</span>
              )}
            </button>
            <button
              type="button"
              className="inline-flex shrink-0 cursor-pointer items-center whitespace-nowrap rounded-xl bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors duration-200 hover:bg-primary/90"
              onClick={() => void window.gt.account.openShop()}
            >
              {sub && !expired && used >= 100 ? '去官网充值' : '升级套餐'}
            </button>
            {activity && (
              <span className="max-w-24 truncate text-xs text-primary">{activity}</span>
            )}
            <button
              type="button"
              className="inline-flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-xl border border-line bg-ink px-2.5 py-1.5 text-xs text-muted transition-colors duration-200 hover:border-primary/40 hover:text-primary"
              aria-expanded={workspaceOpen}
              aria-controls="workspace-pane"
              title={workspaceOpen ? '收起工作空间' : '展开工作空间'}
              onClick={toggleWorkspace}
            >
              {workspaceOpen ? <PanelRight size={14} /> : <PanelRightOpen size={14} />}
              工作空间
            </button>
          </div>
        </header>
        <div
          ref={scrollerRef}
          onPointerDown={() => {
            holdingRef.current = true
          }}
          onPointerUp={() => {
            holdingRef.current = false
          }}
          onPointerCancel={() => {
            holdingRef.current = false
          }}
          onWheel={() => {
            holdingRef.current = true
            window.setTimeout(() => {
              const el = scrollerRef.current
              if (!el) return
              if (el.scrollHeight - el.scrollTop - el.clientHeight < 96) holdingRef.current = false
            }, 160)
          }}
          onScroll={() => {
            const el = scrollerRef.current
            if (!el) return
            const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 96
            stickRef.current = nearBottom
            if (nearBottom) holdingRef.current = false
          }}
          className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-6 xl:px-8"
        >
          <div className="chat-column min-h-full">
            <MessageList messages={task?.messages || []} running={task?.status === 'running'} />
          </div>
        </div>
        <div className="px-4 pb-4 sm:px-6 xl:px-8">
          <div className="chat-column">
            <Composer
              taskId={task?.id || null}
              mode={task?.mode || 'craft'}
              running={task?.status === 'running'}
              onMode={(m) => {
                if (task) void changeMode(m)
              }}
            />
          </div>
        </div>
      </section>
      <RightPane
        task={task}
        files={files}
        open={workspaceOpen}
        onToggle={toggleWorkspace}
        onRunPlan={() => {
          if (!task) return
          if (quotaExhausted(entitlements)) {
            void window.gt.account.openShop()
            return
          }
          void window.gt.tasks.send(task.id, '按已确认方案开始执行', [], true)
        }}
      />
    </div>
  )
}
