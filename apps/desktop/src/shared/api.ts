import type {
  AgentIpcEvent,
  AppSettings,
  ConnectorConnectResult,
  CreateTaskInput,
  Entitlements,
  ExpertInfo,
  GenerateJob,
  GenerateQuote,
  GenerateStartInput,
  McpInfo,
  PermissionDecision,
  ProjectInfo,
  SkillInfo,
  TaskRecord,
  TeamInfo,
  WorkspaceEntry,
} from './protocol'

export interface GtApi {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  settings: {
    get: () => Promise<AppSettings>
    set: (next: AppSettings) => Promise<AppSettings>
    pickDir: () => Promise<string | null>
  }
  account: {
    loginWithWebsite: () => Promise<{ ok: boolean; settings?: AppSettings; error?: string }>
    cancelWebLogin: () => Promise<{ ok: boolean }>
    logout: () => Promise<AppSettings>
    entitlements: () => Promise<Entitlements | null>
    checkUpdate: () =>
      Promise<{
        ok: boolean
        current: string
        version: string
        available: boolean
        platform: 'windows' | 'mac' | 'other'
        url?: string
        fileName?: string
        size?: number
        message: string
      }>
    downloadUpdate: () => Promise<{ ok: boolean; path?: string; message?: string }>
    onUpdateProgress: (cb: (progress: { received: number; total: number }) => void) => () => void
    openShop: () => Promise<void>
    onDeepLink: (
      cb: (payload: { url: string; host: string; path: string; query: Record<string, string> }) => void,
    ) => () => void
    openUrl: (url: string) => Promise<void>
  }
  tasks: {
    list: () => Promise<TaskRecord[]>
    create: (input: CreateTaskInput) => Promise<TaskRecord>
    patch: (id: string, patch: Partial<TaskRecord>) => Promise<TaskRecord | null>
    send: (taskId: string, text: string, files?: string[], executePlan?: boolean) => Promise<{ ok: boolean; error?: string }>
    stop: (id: string) => Promise<void>
    remove: (id: string) => Promise<void>
    permission: (requestId: string, decision: PermissionDecision) => Promise<void>
    answer: (requestId: string, answers: Record<string, string>) => Promise<void>
    attach: (taskId: string, files: string[]) => Promise<string[]>
    onEvent: (cb: (payload: AgentIpcEvent) => void) => () => void
  }
  files: {
    path: (file: File) => string
    saveBytes: (name: string, data: ArrayBuffer | Uint8Array) => Promise<string>
    dataUrl: (abs) => Promise<string>
    bytes: (abs: string) => Promise<Uint8Array>
    open: (abs: string) => Promise<string>
    show: (abs: string) => Promise<void>
  }
  generate: {
    quote: (input: Pick<GenerateStartInput, 'kind' | 'model' | 'size' | 'resolution' | 'duration'>) => Promise<GenerateQuote>
    start: (input: GenerateStartInput) => Promise<GenerateJob>
    status: (id: string) => Promise<GenerateJob>
    list: () => Promise<GenerateJob[]>
    pickImage: () => Promise<string | null>
  }
  workspace: {
    list: (taskId: string) => Promise<WorkspaceEntry[]>
    read: (taskId: string, abs: string) => Promise<string>
    open: (taskId: string, abs: string) => Promise<string>
  }
  catalog: {
    get: () => Promise<{ skills: SkillInfo[]; experts: ExpertInfo[]; teams: TeamInfo[]; mcp: McpInfo[] }>
  }
  skills: {
    save: (
      input:
        | { id: string; name: string; description: string; body: string }
        | Array<{ id: string; name: string; description: string; body: string }>,
    ) => Promise<SkillInfo[]>
    install: (id: string) => Promise<SkillInfo[]>
    uninstall: (id: string) => Promise<SkillInfo[]>
  }
  mcp: {
    upsert: (info: McpInfo, approve: boolean) => Promise<McpInfo[]>
    remove: (id: string) => Promise<McpInfo[]>
    connect: (id: string, token?: string) => Promise<ConnectorConnectResult>
  }
  projects: {
    list: () => Promise<ProjectInfo[]>
    save: (list: ProjectInfo[]) => Promise<ProjectInfo[]>
  }
}
