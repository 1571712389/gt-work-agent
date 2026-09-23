import type { ChatMessage, ModelSettings, ToolCall, ToolSpec } from './types'
import { chatContentText } from './types'

export interface StreamChunk {
  content?: string
  reasoning?: string
  toolCalls?: ToolCall[]
  finishReason?: string | null
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

export function sanitizeChatMessages(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const message of messages) {
    if (message.role === 'system' || message.role === 'user') {
      out.push({ role: message.role, content: message.content ?? '' })
      continue
    }
    if (message.role === 'assistant') {
      const row: ChatMessage = { role: 'assistant', content: message.content || '' }
      if (message.tool_calls?.length) {
        row.tool_calls = message.tool_calls.map((call, index) => ({
          id: call.id || `call_${index}`,
          type: 'function',
          function: {
            name: call.function?.name || 'unknown',
            arguments: call.function?.arguments || '{}',
          },
        }))
      }
      out.push(row)
      continue
    }
    if (message.role !== 'tool') continue
    const toolCallId = message.tool_call_id?.trim()
    if (!toolCallId) continue
    const paired = out.some(
      (item) => item.role === 'assistant' && item.tool_calls?.some((call) => call.id === toolCallId),
    )
    if (!paired) continue
    out.push({
      role: 'tool',
      tool_call_id: toolCallId,
      name: message.name,
      content: message.content || '',
    })
  }

  const cleaned: ChatMessage[] = []
  for (let i = 0; i < out.length; i += 1) {
    const message = out[i]
    if (message.role !== 'assistant' || !message.tool_calls?.length) {
      if (message.role !== 'tool') cleaned.push(message)
      continue
    }
    const group: ChatMessage[] = []
    let j = i + 1
    while (j < out.length && out[j].role === 'tool') {
      group.push(out[j])
      j += 1
    }
    const wanted = new Set(message.tool_calls.map((call) => call.id))
    const got = new Set(group.map((item) => item.tool_call_id))
    const complete = wanted.size === got.size && [...wanted].every((id) => got.has(id))
    if (complete) cleaned.push(message, ...group)
    else if (chatContentText(message.content).trim()) cleaned.push({ role: 'assistant', content: chatContentText(message.content) })
    i = j - 1
  }
  return cleaned
}

function mergeToolCallDeltas(acc: Map<number, ToolCall>, deltas: Array<{
  index?: number
  id?: string
  type?: 'function'
  function?: { name?: string; arguments?: string }
}>): void {
  for (const delta of deltas) {
    const index = delta.index ?? 0
    const current = acc.get(index) || {
      id: delta.id || `call_${index}_${crypto.randomUUID().slice(0, 8)}`,
      type: 'function' as const,
      function: { name: '', arguments: '' },
    }
    if (delta.id) current.id = delta.id
    if (!current.id) current.id = `call_${index}_${crypto.randomUUID().slice(0, 8)}`
    if (delta.function?.name) current.function.name += delta.function.name
    if (delta.function?.arguments) current.function.arguments += delta.function.arguments
    acc.set(index, current)
  }
}

export async function streamChat(opts: {
  model: ModelSettings
  messages: ChatMessage[]
  tools: ToolSpec[]
  signal?: AbortSignal
  onChunk: (chunk: StreamChunk) => void
}): Promise<void> {
  const url = joinUrl(opts.model.apiBase, 'chat/completions')
  const payload = {
    model: opts.model.model,
    messages: sanitizeChatMessages(opts.messages).map((m) => {
      const row: Record<string, unknown> = { role: m.role, content: m.content ?? '' }
      if (m.role === 'tool') row.tool_call_id = m.tool_call_id
      if (m.name) row.name = m.name
      if (m.tool_calls?.length) {
        row.tool_calls = m.tool_calls
        if (!m.content || (typeof m.content === 'string' && !m.content)) row.content = null
      }
      return row
    }),
    tools: opts.tools.length ? opts.tools : undefined,
    tool_choice: opts.tools.length ? 'auto' : undefined,
    stream: true,
    stream_options: { include_usage: true },
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.model.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(opts.model.extraHeaders || {}),
    },
    body: JSON.stringify(payload),
    signal: opts.signal,
  })

  if (!resp.ok) {
    const raw = await resp.text().catch(() => '')
    let message = `HTTP ${resp.status}`
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string } }
      message = parsed.error?.message || raw || message
    } catch {
      if (raw) message = raw
    }
    throw new Error(message)
  }
  if (!resp.body) throw new Error('流响应为空')

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  const toolAcc = new Map<number, ToolCall>()
  let buf = ''

  const abortErr = () => {
    const err = new Error('Aborted')
    err.name = 'AbortError'
    return err
  }

  const onAbort = () => {
    void reader.cancel().catch(() => undefined)
  }
  if (opts.signal) {
    if (opts.signal.aborted) {
      onAbort()
      throw abortErr()
    }
    opts.signal.addEventListener('abort', onAbort, { once: true })
  }

  const readChunk = () => {
    if (!opts.signal) return reader.read()
    if (opts.signal.aborted) return Promise.reject(abortErr())
    return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
      const fail = () => {
        onAbort()
        reject(abortErr())
      }
      if (opts.signal?.aborted) {
        fail()
        return
      }
      const timer = opts.signal
      timer?.addEventListener('abort', fail, { once: true })
      reader.read().then(
        (result) => {
          timer?.removeEventListener('abort', fail)
          if (opts.signal?.aborted) reject(abortErr())
          else resolve(result)
        },
        (err) => {
          timer?.removeEventListener('abort', fail)
          reject(err)
        },
      )
    })
  }

  const flushToolCalls = () => {
    if (!toolAcc.size) return
    opts.onChunk({ toolCalls: [...toolAcc.values()] })
  }

  try {
    while (true) {
      if (opts.signal?.aborted) {
        throw abortErr()
      }
      const { value, done } = await readChunk()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const parts = buf.split('\n')
      buf = parts.pop() || ''
      for (const line of parts) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (data === '[DONE]') {
          flushToolCalls()
          return
        }
        let json: {
          choices?: Array<{
            delta?: {
              content?: string | null
              reasoning_content?: string | null
              tool_calls?: Array<{
                index?: number
                id?: string
                type?: 'function'
                function?: { name?: string; arguments?: string }
              }>
            }
            finish_reason?: string | null
          }>
          usage?: StreamChunk['usage']
        }
        try {
          json = JSON.parse(data)
        } catch {
          continue
        }
        const choice = json.choices?.[0]
        const delta = choice?.delta
        if (delta?.tool_calls?.length) mergeToolCallDeltas(toolAcc, delta.tool_calls)
        opts.onChunk({
          content: delta?.content || undefined,
          reasoning: delta?.reasoning_content || undefined,
          finishReason: choice?.finish_reason,
          usage: json.usage,
        })
      }
    }
    flushToolCalls()
  } finally {
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

export function parseArgs(raw: string): Record<string, unknown> {
  if (!raw?.trim()) return {}
  try {
    const value = JSON.parse(raw) as unknown
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
    return { value }
  } catch {
    return { _raw: raw }
  }
}
