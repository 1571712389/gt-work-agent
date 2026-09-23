import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { GtApi } from '../shared/api'
import type { AppSettings, AgentIpcEvent, CreateTaskInput, McpInfo, PermissionDecision, ProjectInfo } from '../shared/protocol'

function invoke(channel: string, ...args: unknown[]) {
  return ipcRenderer.invoke(channel, ...args)
}

const api: GtApi = {
  invoke,
  settings: {
    get: () => invoke('settings:get'),
    set: (next: AppSettings) => invoke('settings:set', next),
    pickDir: () => invoke('settings:pickDir'),
  },
  tasks: {
    list: () => invoke('tasks:list'),
    create: (input: CreateTaskInput) => invoke('tasks:create', input),
    patch: (id: string, patch: Partial<import('../shared/protocol').TaskRecord>) => invoke('tasks:patch', id, patch),
    send: (taskId, text, files = [], executePlan = false) => invoke('tasks:send', taskId, text, files, executePlan),
    stop: (id) => invoke('tasks:stop', id),
    remove: (id) => invoke('tasks:remove', id),
    permission: (requestId: string, decision: PermissionDecision) => invoke('tasks:permission', requestId, decision),
    answer: (requestId, answers) => invoke('tasks:answer', requestId, answers),
    attach: (taskId, files) => invoke('tasks:attach', taskId, files),
    onEvent: (cb) => {
      const listener = (_: unknown, payload: AgentIpcEvent) => cb(payload)
      ipcRenderer.on('agent:event', listener)
      return () => ipcRenderer.removeListener('agent:event', listener)
    },
  },
  files: {
    path: (file) => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    },
    saveBytes: (name, data) => invoke('files:saveBytes', name, data),
    dataUrl: (abs) => invoke('files:dataUrl', abs),
    bytes: (abs) => invoke('files:bytes', abs),
    open: (abs) => invoke('files:open', abs),
    show: (abs) => invoke('files:show', abs),
  },
  generate: {
    quote: (input) => invoke('generate:quote', input),
    start: (input) => invoke('generate:start', input),
    status: (id) => invoke('generate:status', id),
    list: () => invoke('generate:list'),
    pickImage: () => invoke('generate:pickImage'),
  },
  workspace: {
    list: (taskId) => invoke('workspace:list', taskId),
    read: (taskId, abs) => invoke('workspace:read', taskId, abs),
    open: (taskId, abs) => invoke('workspace:open', taskId, abs),
  },
  catalog: {
    get: () => invoke('catalog:get'),
  },
  skills: {
    save: (input) => invoke('skills:save', input),
    install: (id: string) => invoke('skills:install', id),
    uninstall: (id: string) => invoke('skills:uninstall', id),
  },
  mcp: {
    upsert: (info: McpInfo, approve) => invoke('mcp:upsert', info, approve),
    remove: (id) => invoke('mcp:remove', id),
    connect: (id: string, token?: string) => invoke('mcp:connect', id, token),
  },
  projects: {
    list: () => invoke('projects:list'),
    save: (list: ProjectInfo[]) => invoke('projects:save', list),
  },
  account: {
    loginWithWebsite: () => invoke('account:loginWebsite'),
    cancelWebLogin: () => invoke('account:cancelWebLogin'),
    logout: () => invoke('account:logout'),
    entitlements: () => invoke('account:entitlements'),
    checkUpdate: () => invoke('app:checkUpdate'),
    downloadUpdate: () => invoke('app:downloadUpdate'),
    onUpdateProgress: (cb) => {
      const listener = (_: unknown, progress: { received: number; total: number }) => cb(progress)
      ipcRenderer.on('update:progress', listener)
      return () => ipcRenderer.removeListener('update:progress', listener)
    },
    openShop: () => invoke('app:openShop'),
    onDeepLink: (cb) => {
      const listener = (
        _: unknown,
        payload: { url: string; host: string; path: string; query: Record<string, string> },
      ) => cb(payload)
      ipcRenderer.on('app:deep-link', listener)
      return () => ipcRenderer.removeListener('app:deep-link', listener)
    },
    openUrl: (url: string) => invoke('app:openUrl', url),
  },
}

try {
  contextBridge.exposeInMainWorld('gt', api)
} catch (err) {
  console.error('expose window.gt failed', err)
  // 兜底：无隔离时直接挂到 window（开发排查用）
  ;(globalThis as { gt?: GtApi }).gt = api
}
