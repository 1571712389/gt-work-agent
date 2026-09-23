import { parseArgs, streamChat } from './llm'
import { gateTool } from './permissions'
import { buildSystemPrompt } from './prompt'
import { listTree, SandboxError } from './sandbox'
import { builtinTools, toolsForMode } from './tools'
import {
  chatContentText,
  type ChatMessage,
  type ExecutableTool,
  type RunAgentInput,
  type SkillMeta,
  type ToolCall,
  type ToolResult,
} from './types'

function isAbortError(err: unknown): boolean {
  if (!err) return false
  if (typeof err === 'object' && err !== null && 'name' in err && (err as { name?: string }).name === 'AbortError') {
    return true
  }
  if (err instanceof Error) {
    return /abort|aborted|已中断|已取消/i.test(err.message)
  }
  return /abort|aborted|已中断|已取消/i.test(String(err))
}

export async function runAgent(input: RunAgentInput): Promise<{ messages: ChatMessage[]; paused?: 'awaiting_plan' }> {
  const planning = input.mode === 'plan' && !input.extraSystem?.includes('【已确认方案】')
  const tools = toolsForMode([...(input.mcpTools || []), ...builtinTools()], input.mode, planning)
  const toolMap = new Map(tools.map((t) => [t.spec.function.name, t]))
  const tree = listTree(input.workspace)
  const enabledSkills = [] as SkillMeta[]

  const system = buildSystemPrompt({
    workspace: input.workspace,
    mode: input.mode,
    planning,
    tree,
    skills: enabledSkills,
    extraSystem: input.extraSystem,
  })

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    ...input.messages.filter((m) => m.role !== 'system'),
  ]

  if (input.selectedSkills?.length && input.loadSkillBody) {
    const bodies: string[] = []
    for (const id of input.selectedSkills) {
      const body = await input.loadSkillBody(id)
      if (body) bodies.push(body)
    }
    if (bodies.length) {
      messages[0] = {
        role: 'system',
        content: `${chatContentText(messages[0].content)}\n\n已启用技能：\n${bodies.join('\n\n')}`,
      }
    }
  }

  const ctxBase = {
    taskId: input.taskId,
    workspace: input.workspace,
    extraAllowDirs: input.extraAllowDirs || [],
    mode: input.mode,
    permissionMode: input.permissionMode,
    signal: input.signal,
    onEvent: input.onEvent,
    requestPermission: input.requestPermission,
    askUser: input.askUser,
    spawnSubagent: input.spawnSubagent,
  }

  const maxTurns = input.maxTurns ?? 28
  input.onEvent({ type: 'status', status: 'running' })

  const stopClean = () => {
    input.onEvent({ type: 'status', status: 'stopped' })
    return { messages }
  }

  for (let turn = 0; turn < maxTurns; turn += 1) {
    if (input.signal?.aborted) return stopClean()

    let text = ''
    let reasoning = ''
    let collected: ToolCall[] = []
    let finishReason: string | null = null

    try {
      await streamChat({
        model: input.model,
        messages,
        tools: tools.map((t) => t.spec),
        signal: input.signal,
        onChunk(chunk) {
          if (input.signal?.aborted) return
          if (chunk.content) {
            text += chunk.content
            input.onEvent({ type: 'text', delta: chunk.content })
          }
          if (chunk.reasoning) {
            reasoning += chunk.reasoning
            input.onEvent({ type: 'reasoning', delta: chunk.reasoning })
          }
          if (chunk.toolCalls?.length) collected = chunk.toolCalls
          if (chunk.finishReason) finishReason = chunk.finishReason
          if (chunk.usage) {
            input.onEvent({
              type: 'usage',
              promptTokens: chunk.usage.prompt_tokens || 0,
              completionTokens: chunk.usage.completion_tokens || 0,
              totalTokens: chunk.usage.total_tokens || 0,
            })
          }
        },
      })
    } catch (err) {
      if (input.signal?.aborted || isAbortError(err)) return stopClean()
      const message = err instanceof Error ? err.message : String(err)
      input.onEvent({ type: 'error', message })
      input.onEvent({ type: 'status', status: 'failed' })
      messages.push({ role: 'assistant', content: `调用模型失败：${message}` })
      return { messages }
    }

    if (input.signal?.aborted) return stopClean()

    if (!collected.length) {
      if (text) messages.push({ role: 'assistant', content: text })
      else if (reasoning) messages.push({ role: 'assistant', content: text || '（无文本输出）' })
      input.onEvent({ type: 'status', status: 'completed' })
      input.onEvent({ type: 'done' })
      return { messages }
    }

    const toolCalls = collected.map((call, index) => ({
      ...call,
      id: call.id || `call_${index}_${crypto.randomUUID().slice(0, 8)}`,
    }))
    messages.push({
      role: 'assistant',
      content: text,
      tool_calls: toolCalls,
    })

    for (const call of toolCalls) {
      if (input.signal?.aborted) return stopClean()
      const name = call.function.name
      const args = parseArgs(call.function.arguments)
      input.onEvent({ type: 'tool.start', id: call.id, name, args })
      const tool = toolMap.get(name)
      let result: ToolResult

      if (!tool) {
        result = { ok: false, content: `未知工具：${name}` }
      } else {
        try {
          const outside = typeof args.path === 'string' && looksOutside(String(args.path), input.workspace)
          const allowed = await gateTool({
            tool,
            args,
            taskId: input.taskId,
            mode: input.mode,
            planning,
            permissionMode: input.permissionMode,
            outsideWorkspace: outside,
            requestPermission: async (req) => {
              if (input.signal?.aborted) throw new Error('已中断')
              input.onEvent({ type: 'status', status: 'awaiting_permission' })
              input.onEvent({ type: 'permission.request', request: req })
              const decision = await input.requestPermission(req)
              if (input.signal?.aborted) throw new Error('已中断')
              input.onEvent({ type: 'status', status: 'running' })
              return decision
            },
          })
          if (input.signal?.aborted) return stopClean()
          if (!allowed) {
            result = { ok: false, content: `当前模式或权限不允许执行 ${name}。` }
          } else {
            result = await tool.execute(args, ctxBase)
          }
        } catch (err) {
          if (input.signal?.aborted || isAbortError(err)) return stopClean()
          const message = err instanceof SandboxError || err instanceof Error ? err.message : String(err)
          result = { ok: false, content: message }
        }
      }

      if (result.extra?._loadSkill && input.loadSkillBody) {
        const body = await input.loadSkillBody(String(result.extra._loadSkill))
        result = { ok: Boolean(body), content: body || '未找到该技能' }
      }

      input.onEvent({ type: 'tool.result', id: call.id, name, result })
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name,
        content: result.content,
      })

      if (result.extra?._pause === 'awaiting_plan') {
        return { messages, paused: 'awaiting_plan' }
      }
    }

    if (finishReason === 'stop' && !collected.length) break
  }

  input.onEvent({ type: 'error', message: '达到最大步数，已停止以免空转。' })
  input.onEvent({ type: 'status', status: 'failed' })
  return { messages }
}

function looksOutside(inputPath: string, workspace: string): boolean {
  if (!inputPath) return false
  const trimmed = inputPath.trim()
  if (/^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\')) {
    const lower = trimmed.toLowerCase()
    return !lower.startsWith(workspace.toLowerCase())
  }
  return trimmed.startsWith('..')
}

export function findTool(name: string): ExecutableTool | undefined {
  return builtinTools().find((t) => t.spec.function.name === name)
}
