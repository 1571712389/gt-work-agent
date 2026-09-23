import { activeSub, one, quotaExhausted, QUOTA_EXHAUSTED_MESSAGE, type SessionUser } from './auth'
import { deductTokens, todayUsed } from './billing'
import { costFenForUsage, isChatModel, type ModelPricing } from './pricing'
import { normalizeProviderKey } from './provider-key'
import { markVendorEmpty } from './provider-balance'

interface ProviderRow {
  id: string
  name: string
  base_url: string
  api_key: string
  enabled: number
  priority: number
}

interface ModelRow extends ModelPricing {
  upstream_model: string
  tools: number
  fallback_model_id: string | null
  kind?: string
}

const hits = new Map<string, number[]>()

function rateLimited(userId: string): boolean {
  const t = Date.now()
  const next = (hits.get(userId) || []).filter((x) => t - x < 60_000)
  next.push(t)
  hits.set(userId, next)
  return next.length > 90
}

function allowedModels(user: SessionUser): string[] {
  if (!activeSub(user.id)) return []
  return ['*']
}

function resolveRoute(modelId: string, allow: string[]): { model: ModelRow; provider: ProviderRow } | null {
  if (!allow.includes('*') && !allow.includes(modelId)) return null
  const model = one<ModelRow>('SELECT * FROM models WHERE id = ? AND enabled = 1', [modelId])
  if (!model) return null
  const provider = one<ProviderRow>('SELECT * FROM providers WHERE id = ? AND enabled = 1', [model.provider_id])
  if (!provider) return null
  if (!normalizeProviderKey(provider.api_key)) return null
  return { model, provider }
}

function fallbackOf(model: ModelRow, allow: string[]): { model: ModelRow; provider: ProviderRow } | null {
  if (!model.fallback_model_id) {
    const next = many<ModelRow>(
      `SELECT m.* FROM models m JOIN providers p ON p.id = m.provider_id
       WHERE m.enabled = 1 AND p.enabled = 1 AND trim(p.api_key) != '' AND m.id != ?
         AND COALESCE(m.kind, 'chat') = 'chat' ORDER BY p.priority ASC LIMIT 1`,
      [model.id],
    )[0]
    return next ? resolveRoute(next.id, allow.includes('*') ? ['*'] : allow.concat(next.id)) : null
  }
  return resolveRoute(model.fallback_model_id, allow.includes('*') ? ['*'] : allow.concat(model.fallback_model_id))
}

function jsonError(message: string, status: number, type = 'billing') {
  return {
    response: new Response(JSON.stringify({ error: { message, type } }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  }
}

function mapUpstreamError(status: number, provider: ProviderRow) {
  if (status === 401) {
    return jsonError(
      '上游认证失败：厂商认为 API Key 无效。请到内部控制台「供应商」重新粘贴完整 Key（DeepSeek 以 sk- 开头，不要带上 Key、Bearer 等文字）。',
      401,
      'upstream_auth',
    )
  }
  if (status === 402) {
    markVendorEmpty(provider)
    return jsonError(
      `上游「${provider.name}」账户余额不足。请工作人员到厂商官网充值后再试。本系统不能代为付款。`,
      503,
      'upstream_balance',
    )
  }
  return null
}

function bodyHasImage(body: Record<string, unknown>): boolean {
  const messages = body.messages
  if (!Array.isArray(messages)) return false
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue
    const content = (message as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    if (content.some((part) => part && typeof part === 'object' && (part as { type?: string }).type === 'image_url')) {
      return true
    }
  }
  return false
}

function visionUpstream(route: { model: ModelRow; provider: ProviderRow }, body: Record<string, unknown>): string {
  const current = route.model.upstream_model
  const deepseek = /deepseek/i.test(route.provider.base_url) || route.provider.id.includes('deepseek')
  if (deepseek && bodyHasImage(body) && current !== 'deepseek-v4-flash-vision-exp') {
    return 'deepseek-v4-flash-vision-exp'
  }
  return current
}

async function callUpstream(
  route: { model: ModelRow; provider: ProviderRow },
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  const payload: Record<string, unknown> = { ...body, model: visionUpstream(route, body) }
  if (payload.stream && !payload.stream_options) payload.stream_options = { include_usage: true }
  if (!route.model.tools) {
    delete payload.tools
    delete payload.tool_choice
  }
  return fetch(`${route.provider.base_url.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${normalizeProviderKey(route.provider.api_key)}`,
      'Content-Type': 'application/json',
      Accept: body.stream ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify(payload),
    signal,
  })
}

function parseUsage(raw: unknown): { prompt: number; completion: number; total: number; cacheHit: number } {
  const usage = (raw || {}) as {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    prompt_cache_hit_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
  }
  const prompt = usage.prompt_tokens || 0
  const completion = usage.completion_tokens || 0
  const cacheHit = usage.prompt_cache_hit_tokens || usage.prompt_tokens_details?.cached_tokens || 0
  return { prompt, completion, total: usage.total_tokens || prompt + completion, cacheHit }
}

export async function proxyChat(opts: {
  user: SessionUser
  body: Record<string, unknown>
  taskId?: string
  signal?: AbortSignal
}): Promise<{ response: Response; after?: () => void }> {
  if (rateLimited(opts.user.id)) return jsonError('请求过于频繁，请稍后再试。', 429, 'rate_limit')

  const sub = activeSub(opts.user.id)
  if (!sub) return jsonError('没有有效套餐，请先在官网购买。', 402)
  if (quotaExhausted(sub.tokens_remaining, sub.pkg.token_quota)) return jsonError(QUOTA_EXHAUSTED_MESSAGE, 402)
  if (sub.pkg.daily_quota > 0 && todayUsed(opts.user.id) >= sub.pkg.daily_quota) {
    return jsonError('今日额度已用尽，明天再试或升级套餐。', 402)
  }

  const messages = Array.isArray(opts.body.messages) ? (opts.body.messages as unknown[]) : []
  if (JSON.stringify(messages).length > 16_000_000) {
    return jsonError('上下文过长，请缩短对话或减少附件后再试。', 400, 'context_limit')
  }

  const requested = String(opts.body.model || '')
  if (requested && !isChatModel(requested)) {
    return jsonError('该模型用于图片或视频生成，请到客户端「创作」页使用。', 400, 'wrong_endpoint')
  }
  const allow = allowedModels(opts.user)
  if (!allow.includes('*') && !allow.includes(requested)) {
    return jsonError(`模型 ${requested || '未选择'} 未接入或已停用。`, 403, 'forbidden_model')
  }

  const requestedModel = one<ModelRow>('SELECT * FROM models WHERE id = ?', [requested])
  const requestedProvider = requestedModel
    ? one<ProviderRow>('SELECT * FROM providers WHERE id = ?', [requestedModel.provider_id])
    : null
  if (requestedProvider && !String(requestedProvider.api_key || '').trim()) {
    return jsonError(
      `上游「${requestedProvider.name}」还没有配置 API Key。请到内部控制台「供应商」粘贴并保存后再用。不要填进桌面客户端或官网。`,
      503,
      'missing_upstream_key',
    )
  }

  let route = resolveRoute(requested, allow)
  if (!route) {
    const fallbackId = allow.includes('*') ? 'deepseek-chat' : allow.find((id) => isChatModel(id)) || allow[0]
    route = fallbackId ? resolveRoute(fallbackId, allow.includes('*') ? ['*'] : allow) : null
  }
  if (!route) {
    return jsonError(`模型 ${requested} 未接入或已下架。`, 403, 'forbidden_model')
  }

  let upstream = await callUpstream(route, opts.body, opts.signal)
  if (!upstream.ok && !bodyHasImage(opts.body) && route.model.fallback_model_id !== route.model.id) {
    const fb = fallbackOf(route.model, allow)
    if (fb && fb.model.id !== route.model.id) {
      route = fb
      upstream = await callUpstream(route, opts.body, opts.signal)
    }
  }

  const modelId = route.model.id
  const providerId = route.provider.id
  const multiplier = route.model.multiplier || 1
  const userId = opts.user.id
  const taskId = opts.taskId

  const bill = (usage: { prompt: number; completion: number; total: number; cacheHit: number }) => {
    const billed = Math.max(1, Math.ceil((usage.total || 1) * multiplier))
    return deductTokens(userId, billed, {
      model: modelId,
      providerId,
      prompt: usage.prompt,
      completion: usage.completion,
      total: usage.total,
      costFen: costFenForUsage(route.model, usage),
      taskId,
    })
  }

  if (!opts.body.stream) {
    const json = (await upstream.json()) as { usage?: unknown; error?: { message?: string } }
    if (!upstream.ok) {
      const mapped = mapUpstreamError(upstream.status, route.provider)
      if (mapped) return mapped
      return {
        response: new Response(JSON.stringify(json), {
          status: upstream.status,
          headers: { 'Content-Type': 'application/json' },
        }),
      }
    }
    try {
      bill(parseUsage(json.usage))
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : String(err), 402)
    }
    return {
      response: new Response(JSON.stringify(json), { headers: { 'Content-Type': 'application/json' } }),
    }
  }

  if (!upstream.ok || !upstream.body) {
    const mapped = mapUpstreamError(upstream.status, route.provider)
    if (mapped) return mapped
    const raw = await upstream.text()
    return { response: new Response(raw, { status: upstream.status, headers: { 'Content-Type': 'application/json' } }) }
  }

  let usage = { prompt: 0, completion: 0, total: 0, cacheHit: 0 }
  const ts = new TransformStream<Uint8Array, Uint8Array>()
  const writer = ts.writable.getWriter()
  const reader = upstream.body.getReader()
  const stopUpstream = () => {
    void reader.cancel().catch(() => undefined)
    void writer.close().catch(() => undefined)
  }
  if (opts.signal) {
    if (opts.signal.aborted) stopUpstream()
    else opts.signal.addEventListener('abort', stopUpstream, { once: true })
  }
  const decoder = new TextDecoder()
  let buf = ''
  void (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n')
        buf = parts.pop() || ''
        for (const line of parts) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data) as { usage?: unknown }
            if (parsed.usage) usage = parseUsage(parsed.usage)
          } catch {
            /* ignore */
          }
        }
        await writer.write(value)
      }
      if (usage.total === 0) usage = { prompt: 0, completion: 0, total: 1, cacheHit: 0 }
      try {
        bill(usage)
      } catch {
        /* already streamed */
      }
    } finally {
      await writer.close().catch(() => undefined)
    }
  })()

  return {
    response: new Response(ts.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    }),
  }
}
