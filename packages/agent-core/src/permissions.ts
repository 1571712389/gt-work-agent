import type { AgentMode, ExecutableTool, PermissionDecision, PermissionMode, PermissionRequest } from './types'

const WRITE_TOOLS = new Set([
  'Write',
  'Edit',
  'Bash',
  'GenerateXlsx',
  'GeneratePptx',
  'SubmitPlan',
])

const ASK_TOOLS = new Set(['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'AskUserQuestion', 'LoadSkill', 'DingTalkReportTemplates'])

export function isReadonlyTool(tool: ExecutableTool | string): boolean {
  if (typeof tool === 'string') return ASK_TOOLS.has(tool) && !WRITE_TOOLS.has(tool)
  return tool.readonly
}

export function toolAllowedInMode(name: string, mode: AgentMode, planning: boolean): boolean {
  if (mode === 'ask') return ASK_TOOLS.has(name) || name.startsWith('mcp__')
  if (mode === 'plan' && planning) {
    return ASK_TOOLS.has(name) || name === 'SubmitPlan' || name.startsWith('mcp__')
  }
  return true
}

export function needsConfirmation(
  name: string,
  risk: PermissionRequest['risk'],
  permissionMode: PermissionMode,
  outsideWorkspace: boolean,
): boolean {
  if (permissionMode === 'bypass') return false
  if (outsideWorkspace) return true
  if (name === 'Bash' || risk === 'high') return permissionMode !== 'bypass'
  if (WRITE_TOOLS.has(name)) return permissionMode === 'default'
  return false
}

export async function gateTool(opts: {
  tool: ExecutableTool
  args: Record<string, unknown>
  taskId: string
  mode: AgentMode
  planning: boolean
  permissionMode: PermissionMode
  outsideWorkspace: boolean
  requestPermission: (req: PermissionRequest) => Promise<PermissionDecision>
}): Promise<boolean> {
  const { tool, args, taskId, mode, planning, permissionMode, outsideWorkspace, requestPermission } = opts
  const name = tool.spec.function.name
  if (!toolAllowedInMode(name, mode, planning)) {
    return false
  }
  if (!needsConfirmation(name, tool.risk, permissionMode, outsideWorkspace)) return true
  const decision = await requestPermission({
    requestId: crypto.randomUUID(),
    taskId,
    tool: name,
    args,
    reason: outsideWorkspace ? '操作超出当前工作空间' : `工具 ${name} 需要确认`,
    risk: outsideWorkspace ? 'high' : tool.risk,
  })
  return decision === 'allow' || decision === 'allow_always'
}
