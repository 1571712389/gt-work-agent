import { useApp } from './store'
import type { TaskRecord, ViewId } from '@shared/protocol'
import { connectConnectorFallback, installSkillFallback, uninstallSkillFallback } from './bridge'

export async function ensureCurrentTask(): Promise<TaskRecord> {
  if (!requireLogin()) throw new Error('请先登录后再使用对话')
  const state = useApp.getState()
  const existing = state.tasks.find((task) => task.id === state.currentId)
  if (existing) return existing
  const created = await window.gt.tasks.create({ mode: 'craft' })
  useApp.getState().upsertTask(created)
  return created
}

export function notify(
  message: string,
  kind: 'ok' | 'warn' | 'info' = 'ok',
  action?: { label: string; view: ViewId },
): void {
  useApp.getState().notify({
    id: crypto.randomUUID(),
    message,
    kind,
    actionLabel: action?.label,
    actionView: action?.view,
  })
}

export function requireLogin(): boolean {
  if (useApp.getState().settings?.apiKey) return true
  useApp.getState().setView('account')
  notify('请先登录后再使用对话、技能和连接器', 'warn')
  return false
}

export async function gtCall<T>(channel: string, ...args: unknown[]): Promise<T> {
  const invoke = window.gt?.invoke
  if (typeof invoke === 'function') {
    return (await invoke(channel, ...args)) as T
  }
  const [group, method] = channel.split(':')
  const host = (window.gt as unknown as Record<string, Record<string, unknown> | undefined> | undefined)?.[group]
  const fn = host?.[method]
  if (typeof fn === 'function') {
    return (await (fn as (...xs: unknown[]) => Promise<T>)(...args)) as T
  }
  if (channel === 'skills:install') {
    return (await installSkillFallback(String(args[0] || ''))) as T
  }
  if (channel === 'skills:uninstall') {
    return (await uninstallSkillFallback(String(args[0] || ''))) as T
  }
  if (channel === 'mcp:connect') {
    return (await connectConnectorFallback(String(args[0] || ''), args[1] as string | undefined)) as T
  }
  throw new Error('客户端通道未更新。请完全退出光途Work（含右下角托盘图标）后重新启动。')
}

export const goChat = { label: '查看对话', view: 'workbench' as const }
