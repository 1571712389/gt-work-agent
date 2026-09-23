export type ViewId = 'workbench' | 'studio' | 'settings' | 'skills' | 'experts' | 'mcp' | 'projects' | 'account'
export type AgentMode = 'ask' | 'craft' | 'plan'
export type PermissionMode = 'default' | 'acceptEdits' | 'bypass'
export type PermissionDecision = 'allow' | 'deny' | 'allow_always'

export interface AppSettings {
  apiBase: string
  apiKey: string
  model: string
  defaultWorkspace: string
  permissionMode: PermissionMode
  closeToTray: boolean
  shopUrl: string
  userEmail: string
}

export interface Entitlements {
  user: { id: string; email: string; name: string; role: string; passwordSet?: boolean }
  shopUrl: string
  subscription: {
    packageId: string
    packageName: string
    packageSlug?: string
    expiresAt: number
    usagePercent: number
    allowMcp: boolean
    allowTeam: boolean
    skills: string[]
    seats: number
  } | null
  models: Array<{
    id: string
    name: string
    tools: boolean
    vision?: boolean
    kind?: 'chat' | 'image' | 'video'
    sizes?: string[]
    resolutions?: string[]
    durations?: number[]
    ratios?: string[]
    provider?: string
  }>
}

export interface MessageAttachment {
  path: string
  name: string
  kind: 'image' | 'file'
}

export interface TaskMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  thinking?: string
  name?: string
  tool?: { id: string; name: string; args?: unknown; result?: string }
  attachments?: MessageAttachment[]
  createdAt: number
}

export interface TaskRecord {
  id: string
  title: string
  workspace: string
  mode: AgentMode
  status: string
  createdAt: number
  updatedAt: number
  selectedSkills: string[]
  selectedExpert: string | null
  selectedTeam: string | null
  planMarkdown?: string
  instruction?: string
  messages: TaskMessage[]
}

export type AgentEvent =
  | { type: 'status'; status: string }
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool.start'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool.result'; id: string; name: string; result: { ok: boolean; title?: string; content: string } }
  | {
      type: 'permission.request'
      request: {
        requestId: string
        taskId: string
        tool: string
        args: Record<string, unknown>
        reason: string
        risk: 'low' | 'medium' | 'high'
      }
    }
  | {
      type: 'ask_user'
      question: {
        requestId: string
        taskId: string
        title: string
        questions: Array<{ id: string; prompt: string; options?: string[]; allowFreeText?: boolean }>
      }
    }
  | {
      type: 'plan'
      plan: { title: string; steps: string[]; filesToTouch: string[]; markdown: string }
    }
  | { type: 'usage'; promptTokens: number; completionTokens: number; totalTokens: number }
  | { type: 'error'; message: string }
  | { type: 'done' }

export interface AgentIpcEvent {
  taskId: string
  event: AgentEvent
  runId?: number
}

export interface CreateTaskInput {
  title?: string
  workspace?: string
  mode: AgentMode
  selectedSkills?: string[]
  selectedExpert?: string | null
  selectedTeam?: string | null
  instruction?: string
}

export interface SkillInfo {
  id: string
  name: string
  description: string
  tags: string[]
  installed?: boolean
  source?: 'market' | 'custom'
}

export interface ExpertInfo {
  id: string
  name: string
  title: string
  description: string
  skillIds: string[]
}

export interface TeamInfo {
  id: string
  name: string
  description: string
  leaderId: string
  memberIds: string[]
}

export interface McpInfo {
  id: string
  command: string
  args?: string[]
  env?: Record<string, string>
  scope: 'user' | 'project' | 'local'
  approved?: boolean
  disabled?: boolean
}

export interface ConnectorConnectResult {
  mcp: McpInfo[]
  needToken?: boolean
  needSetup?: boolean
  setupUrl?: string
  tokenUrl?: string
  tokenLabel?: string
  hint?: string
}

export interface ProjectInfo {
  id: string
  name: string
  workspace: string
  instruction: string
  skillIds: string[]
  expertIds: string[]
  mcpIds: string[]
}

export interface GenerateJob {
  id: string
  kind: 'image' | 'video'
  model: string
  prompt: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | string
  error?: string | null
  billedTokens?: number
  costFen?: number
  createdAt: number
  updatedAt?: number
  size?: string | null
  resolution?: string | null
  duration?: number | null
  ratio?: string | null
  urls?: string[]
  stored?: boolean
  localPath?: string
}

export interface GenerateQuote {
  model: string
  kind: string
  fen: number
  shares: number
  percent: number | null
  remaining: number
  enough: boolean
  note?: string
}

export interface GenerateStartInput {
  kind: 'image' | 'video'
  model: string
  prompt: string
  size?: string
  resolution?: string
  duration?: number
  ratio?: string
  imagePath?: string
}

export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'] as const
export const TEXT_EXTS = [
  '.md',
  '.txt',
  '.json',
  '.csv',
  '.tsv',
  '.xml',
  '.html',
  '.css',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.env',
  '.log',
  '.sql',
  '.svg',
  '.sh',
  '.bat',
  '.ps1',
] as const
export const WORKSPACE_DRAG_MIME = 'application/x-gt-paths'

export function extOf(file: string): string {
  const base = file.split(/[\\/]/).pop() || file
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot).toLowerCase() : ''
}

export function isImageName(file: string): boolean {
  return (IMAGE_EXTS as readonly string[]).includes(extOf(file))
}

export function isTextName(file: string): boolean {
  const ext = extOf(file)
  if ((TEXT_EXTS as readonly string[]).includes(ext)) return true
  const base = (file.split(/[\\/]/).pop() || '').toLowerCase()
  return base === 'makefile' || base === 'dockerfile' || base === 'license'
}

export interface WorkspaceEntry {
  name: string
  path: string
  dir: boolean
  relative?: string
  depth?: number
}
