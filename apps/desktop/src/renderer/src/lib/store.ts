import { create } from 'zustand'
import type {
  AgentEvent,
  AgentMode,
  AppSettings,
  Entitlements,
  ExpertInfo,
  McpInfo,
  ProjectInfo,
  SkillInfo,
  TaskRecord,
  TeamInfo,
  ViewId,
} from '@shared/protocol'
import { withInstalledFlag } from './installed'

interface AppState {
  view: ViewId
  settings: AppSettings | null
  entitlements: Entitlements | null
  tasks: TaskRecord[]
  currentId: string | null
  skills: SkillInfo[]
  experts: ExpertInfo[]
  teams: TeamInfo[]
  mcp: McpInfo[]
  projects: ProjectInfo[]
  pendingPermission: Extract<AgentEvent, { type: 'permission.request' }>['request'] | null
  pendingQuestion: Extract<AgentEvent, { type: 'ask_user' }>['question'] | null
  toast: { id: string; message: string; kind: 'ok' | 'warn' | 'info'; actionLabel?: string; actionView?: ViewId } | null
  pendingAttach: string[]
  halted: Record<string, true>
  runSeen: Record<string, number>
  setView: (view: ViewId) => void
  notify: (toast: AppState['toast']) => void
  hydrate: () => Promise<void>
  setCurrent: (id: string | null) => void
  applyEvent: (taskId: string, event: AgentEvent, runId?: number) => void
  haltTask: (taskId: string) => void
  clearHalt: (taskId: string) => void
  upsertTask: (task: TaskRecord) => void
  queueAttach: (paths: string[]) => void
}

const defaultSettings: AppSettings = {
  apiBase: 'http://127.0.0.1:8787/v1',
  apiKey: '',
  model: 'deepseek-chat',
  defaultWorkspace: '',
  permissionMode: 'default',
  closeToTray: true,
  shopUrl: 'http://127.0.0.1:8787',
  userEmail: '',
}

type QueuedEvent = { taskId: string; event: AgentEvent; runId?: number }

type LiveText = { taskId: string; messageId: string; content: string; thinking: string }

let live: LiveText | null = null
let liveTimer = 0
const liveListeners = new Set<() => void>()

export function readLiveText(): LiveText | null {
  return live
}

export function subscribeLiveText(listener: () => void): () => void {
  liveListeners.add(listener)
  return () => {
    liveListeners.delete(listener)
  }
}

function notifyLive(): void {
  for (const listener of liveListeners) listener()
}

export function flushLiveText(): void {
  if (liveTimer) window.clearTimeout(liveTimer)
  commitLive()
}

let commitEvents: (batch: QueuedEvent[]) => void = () => {}
let commitLive: () => void = () => {}

export const useApp = create<AppState>((set, get) => {
  commitLive = () => {
    liveTimer = 0
    const snap = live
    if (!snap) return
    let changed = false
    const tasks = get().tasks.map((task) => {
      if (task.id !== snap.taskId) return task
      const index = task.messages.findIndex((msg) => msg.id === snap.messageId)
      if (index < 0) return task
      const msg = task.messages[index]
      if (msg.content === snap.content && (msg.thinking || '') === snap.thinking) return task
      changed = true
      const messages = task.messages.slice()
      messages[index] = { ...msg, content: snap.content, thinking: snap.thinking || undefined }
      return { ...task, messages }
    })
    if (changed) set({ tasks })
  }

  commitEvents = (batch) => {
    let tasks = get().tasks
    let runSeen = get().runSeen
    let pendingPermission = get().pendingPermission
    let pendingQuestion = get().pendingQuestion
    let dirty = false
    for (const item of batch) {
      const seen = runSeen[item.taskId] || 0
      if (typeof item.runId === 'number' && item.runId < seen) continue
      const halted = Boolean(get().halted[item.taskId])
      if (halted && item.event.type !== 'status') continue
      if (halted && item.event.type === 'status' && item.event.status !== 'stopped' && item.event.status !== 'failed') continue
      if (typeof item.runId === 'number' && item.runId !== seen) runSeen = { ...runSeen, [item.taskId]: item.runId }
      const event = item.event
      const hot = event.type === 'text' || event.type === 'reasoning'
      tasks = tasks.map((task) => {
        if (task.id !== item.taskId) return task
        const next: TaskRecord = { ...task, messages: [...task.messages], updatedAt: hot ? task.updatedAt : Date.now() }
        if (event.type === 'status') next.status = event.status
        if (event.type === 'plan') next.planMarkdown = event.plan.markdown
        if (event.type === 'text') {
          const last = next.messages.at(-1)
          if (last?.role === 'assistant' && !last.tool) {
            next.messages[next.messages.length - 1] = { ...last, content: last.content + event.delta }
          } else {
            next.messages.push({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: event.delta,
              createdAt: Date.now(),
            })
          }
        }
        if (event.type === 'reasoning') {
          const last = next.messages.at(-1)
          if (last?.role === 'assistant' && !last.tool) {
            next.messages[next.messages.length - 1] = { ...last, thinking: (last.thinking || '') + event.delta }
          } else {
            next.messages.push({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: '',
              thinking: event.delta,
              createdAt: Date.now(),
            })
          }
        }
        if (event.type === 'tool.start') {
          next.messages.push({
            id: event.id,
            role: 'tool',
            name: event.name,
            content: '',
            tool: { id: event.id, name: event.name, args: event.args },
            createdAt: Date.now(),
          })
        }
        if (event.type === 'tool.result') {
          next.messages = next.messages.map((m) =>
            m.tool?.id === event.id
              ? { ...m, content: event.result.content, tool: { ...m.tool, result: event.result.content } }
              : m,
          )
        }
        if (event.type === 'error') {
          next.status = 'failed'
          next.messages.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `错误：${event.message}`,
            createdAt: Date.now(),
          })
        }
        return next
      })
      if (event.type === 'permission.request') pendingPermission = event.request
      else if (event.type === 'status' && (event.status === 'stopped' || event.status === 'completed' || event.status === 'failed')) {
        pendingPermission = null
      }
      if (event.type === 'ask_user') pendingQuestion = event.question
      else if (event.type === 'status' && (event.status === 'stopped' || event.status === 'completed' || event.status === 'failed')) {
        pendingQuestion = null
      }
      dirty = true
    }
    if (dirty) set({ tasks, runSeen, pendingPermission, pendingQuestion })
  }

  return {
  view: 'account',
  settings: defaultSettings,
  entitlements: null,
  tasks: [],
  currentId: null,
  skills: [],
  experts: [],
  teams: [],
  mcp: [],
  projects: [],
  pendingPermission: null,
  pendingQuestion: null,
  toast: null,
  pendingAttach: [],
  halted: {},
  runSeen: {},
  setView: (view) => set({ view }),
  haltTask: (taskId) => set({ halted: { ...get().halted, [taskId]: true } }),
  clearHalt: (taskId) => {
    const halted = { ...get().halted }
    delete halted[taskId]
    set({ halted })
  },
  queueAttach: (paths) => {
    const next = paths.filter(Boolean)
    if (!next.length) return
    set({ pendingAttach: next })
  },
  notify: (toast) => set({ toast }),
  hydrate: async () => {
    try {
      const [settings, tasks, catalog, projects, entitlements] = await Promise.all([
        window.gt.settings.get(),
        window.gt.tasks.list().catch(() => []),
        window.gt.catalog.get().catch(() => ({ skills: [], experts: [], teams: [], mcp: [] })),
        window.gt.projects.list().catch(() => []),
        window.gt.account.entitlements().catch(() => null),
      ])
      const resolved = settings || defaultSettings
      const visibleTasks = resolved.apiKey
        ? tasks.map((task) =>
            task.status === 'running' || task.status === 'awaiting_permission' || task.status === 'awaiting_question'
              ? { ...task, status: 'idle' as const }
              : task,
          )
        : []
      set({
        settings: resolved,
        entitlements,
        view: resolved.apiKey ? 'workbench' : 'account',
        tasks: visibleTasks,
        currentId: visibleTasks[0]?.id || null,
        skills: withInstalledFlag(catalog.skills || []),
        experts: catalog.experts || [],
        teams: catalog.teams || [],
        mcp: catalog.mcp || [],
        projects,
      })
    } catch (err) {
      console.error('hydrate failed', err)
      set({ settings: defaultSettings, view: 'account', tasks: [], currentId: null })
    }
  },
  setCurrent: (id) => set({ currentId: id }),
  upsertTask: (task) => {
    const tasks = get().tasks.filter((t) => t.id !== task.id)
    set({ tasks: [task, ...tasks], currentId: task.id })
  },
  applyEvent: (taskId, event, runId) => {
    if (event.type === 'text' || event.type === 'reasoning') {
      const seen = get().runSeen[taskId] || 0
      if (typeof runId === 'number' && runId < seen) return
      if (get().halted[taskId]) return
      if (typeof runId === 'number' && runId !== seen) set({ runSeen: { ...get().runSeen, [taskId]: runId } })
      let task = get().tasks.find((item) => item.id === taskId)
      if (!task) return
      let last = task.messages.at(-1)
      if (!(last?.role === 'assistant' && !last.tool)) {
        const created = {
          id: crypto.randomUUID(),
          role: 'assistant' as const,
          content: '',
          createdAt: Date.now(),
        }
        const messages = [...task.messages, created]
        task = { ...task, messages }
        set({ tasks: get().tasks.map((item) => (item.id === taskId ? task! : item)) })
        last = created
      }
      if (!live || live.taskId !== taskId || live.messageId !== last.id) {
        live = { taskId, messageId: last.id, content: last.content || '', thinking: last.thinking || '' }
      }
      if (event.type === 'reasoning') {
        live.thinking += event.delta
        return
      }
      const firstVisible = live.content.length === 0
      live.content += event.delta
      notifyLive()
      if (firstVisible) {
        if (liveTimer) window.clearTimeout(liveTimer)
        liveTimer = 0
        commitLive()
        return
      }
      if (!liveTimer) liveTimer = window.setTimeout(commitLive, 120)
      return
    }
    if (liveTimer) {
      window.clearTimeout(liveTimer)
      commitLive()
    }
    commitEvents([{ taskId, event, runId }])
  },
  }
})

export const MODES: Array<{ id: AgentMode; label: string; hint: string }> = [
  { id: 'ask', label: '问一问', hint: '只读问答，不改文件' },
  { id: 'craft', label: '做一做', hint: '直接执行并交付' },
  { id: 'plan', label: '想一想', hint: '先方案，确认后再做' },
]
