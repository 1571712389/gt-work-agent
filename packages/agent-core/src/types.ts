export type AgentMode = 'ask' | 'craft' | 'plan'
export type PermissionMode = 'default' | 'acceptEdits' | 'bypass'
export type TaskStatus =
  | 'idle'
  | 'running'
  | 'awaiting_permission'
  | 'awaiting_plan'
  | 'awaiting_question'
  | 'completed'
  | 'failed'
  | 'stopped'

export interface ChatContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

export type ChatContent = string | ChatContentPart[]

export function chatContentText(content: ChatContent | undefined): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  return content
    .filter((part) => part.type === 'text' && part.text)
    .map((part) => part.text || '')
    .join('\n')
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: ChatContent
  name?: string
  tool_call_id?: string
  tool_calls?: ToolCall[]
}

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ToolSpec {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ToolResult {
  ok: boolean
  title?: string
  content: string
  extra?: Record<string, unknown>
}

export type PermissionDecision = 'allow' | 'deny' | 'allow_always'

export interface PermissionRequest {
  requestId: string
  taskId: string
  tool: string
  args: Record<string, unknown>
  reason: string
  risk: 'low' | 'medium' | 'high'
}

export interface UserQuestion {
  requestId: string
  taskId: string
  title: string
  questions: Array<{
    id: string
    prompt: string
    options?: string[]
    allowFreeText?: boolean
  }>
}

export interface AgentPlan {
  title: string
  steps: string[]
  filesToTouch: string[]
  markdown: string
}

export type AgentEvent =
  | { type: 'status'; status: TaskStatus }
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool.start'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool.result'; id: string; name: string; result: ToolResult }
  | { type: 'permission.request'; request: PermissionRequest }
  | { type: 'ask_user'; question: UserQuestion }
  | { type: 'plan'; plan: AgentPlan }
  | { type: 'usage'; promptTokens: number; completionTokens: number; totalTokens: number }
  | { type: 'error'; message: string }
  | { type: 'done' }

export interface ModelSettings {
  apiBase: string
  apiKey: string
  model: string
  extraHeaders?: Record<string, string>
}

export interface RunAgentInput {
  taskId: string
  workspace: string
  mode: AgentMode
  permissionMode: PermissionMode
  extraAllowDirs?: string[]
  model: ModelSettings
  messages: ChatMessage[]
  extraSystem?: string
  selectedSkills?: string[]
  selectedExpert?: string | null
  selectedTeam?: string | null
  mcpTools?: ExecutableTool[]
  maxTurns?: number
  signal?: AbortSignal
  onEvent: (event: AgentEvent) => void
  requestPermission: (req: PermissionRequest) => Promise<PermissionDecision>
  askUser: (q: UserQuestion) => Promise<Record<string, string>>
  loadSkillBody?: (id: string) => Promise<string | null>
  spawnSubagent?: (input: SubagentInput) => Promise<string>
}

export interface SubagentInput {
  taskId: string
  prompt: string
  label?: string
  readonly?: boolean
}

export interface ExecutableTool {
  spec: ToolSpec
  risk: 'low' | 'medium' | 'high'
  readonly: boolean
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>
}

export interface ToolContext {
  taskId: string
  workspace: string
  extraAllowDirs: string[]
  mode: AgentMode
  permissionMode: PermissionMode
  signal?: AbortSignal
  onEvent: (event: AgentEvent) => void
  requestPermission: (req: PermissionRequest) => Promise<PermissionDecision>
  askUser: (q: UserQuestion) => Promise<Record<string, string>>
  spawnSubagent?: (input: SubagentInput) => Promise<string>
}

export interface SkillMeta {
  id: string
  name: string
  description: string
  tags: string[]
  body: string
  path: string
}

export interface ExpertMeta {
  id: string
  name: string
  title: string
  description: string
  methodology: string
  skillIds: string[]
  systemPrompt: string
}

export interface ExpertTeamMeta {
  id: string
  name: string
  description: string
  leaderId: string
  memberIds: string[]
}
