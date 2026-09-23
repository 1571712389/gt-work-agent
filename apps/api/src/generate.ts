import fs from 'node:fs'
import path from 'node:path'
import { activeSub, many, one, run, now, id, quotaExhausted, QUOTA_EXHAUSTED_MESSAGE, type SessionUser } from './auth'
import { deductTokens, todayUsed } from './billing'
import {
  BASE_MODEL_ID,
  CATALOG_BY_ID,
  estimateGenerationFen,
  mixFenPerMillion,
  modelKind,
  sharesFromOfficialFen,
  type CatalogEntry,
  type ModelKind,
  type ModelPricing,
} from './pricing'
import { normalizeProviderKey } from './provider-key'
import { markVendorEmpty } from './provider-balance'

interface ProviderRow {
  id: string
  name: string
  base_url: string
  api_key: string
  enabled: number
}

interface ModelRow extends ModelPricing {
  upstream_model: string
  kind: string
  unit_fen: number
}

interface JobRow {
  id: string
  user_id: string
  kind: string
  model: string
  provider_id: string | null
  prompt: string
  params_json: string
  status: string
  upstream_id: string | null
  result_json: string | null
  error: string | null
  billed_tokens: number
  cost_fen: number
  created_at: number
  updated_at: number
}

export interface GenerateInput {
  kind?: string
  model?: string
  prompt?: string
  size?: string
  resolution?: string
  duration?: number
  ratio?: string
  image?: string
}

function fail(message: string, status: number, type = 'generate') {
  return { status, body: { error: { message, type } } }
}

function allowedModels(user: SessionUser): string[] {
  if (!activeSub(user.id)) return []
  return ['*']
}

function baseModel(): ModelPricing | undefined {
  return one<ModelPricing>('SELECT * FROM models WHERE id = ?', [BASE_MODEL_ID])
}

function parseParams(job: JobRow): Record<string, unknown> {
  try {
    return JSON.parse(job.params_json || '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

function publicJob(job: JobRow) {
  const params = parseParams(job)
  let result: Record<string, unknown> | null = null
  try {
    result = job.result_json ? (JSON.parse(job.result_json) as Record<string, unknown>) : null
  } catch {
    result = null
  }
  return {
    id: job.id,
    kind: job.kind,
    model: job.model,
    prompt: job.prompt,
    status: job.status,
    error: job.error,
    billedTokens: job.billed_tokens,
    costFen: job.cost_fen,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    size: params.size || null,
    resolution: params.resolution || null,
    duration: params.duration || null,
    ratio: params.ratio || null,
    urls: Array.isArray(result?.urls) ? result.urls : [],
    stored: Boolean(result?.stored) || Boolean(mediaFile(job.user_id, job.id)),
    result,
  }
}

const MEDIA_ROOT = path.resolve(process.env.GT_API_DATA || 'data', 'media')
const MEDIA_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm'])

function mediaDir(userId: string): string {
  return path.join(MEDIA_ROOT, userId.replace(/[^a-zA-Z0-9_-]/g, '_'))
}

export function mediaFile(userId: string, jobId: string): string | null {
  const dir = mediaDir(userId)
  if (!fs.existsSync(dir)) return null
  const safeId = jobId.replace(/[^a-zA-Z0-9_-]/g, '')
  const hit = fs.readdirSync(dir).find((name) => name.startsWith(`${safeId}.`))
  return hit ? path.join(dir, hit) : null
}

export function mediaType(file: string): string {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.webm') return 'video/webm'
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/jpeg'
}

function extOf(url: string, kind: string): string {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase()
    if (MEDIA_EXT.has(ext)) return ext === '.jpeg' ? '.jpg' : ext
  } catch {
    /* ignore */
  }
  return kind === 'video' ? '.mp4' : '.png'
}

export function saveGenerationMedia(userId: string, jobId: string, bytes: Buffer, ext: string): string | null {
  const job = one<JobRow>('SELECT * FROM generation_jobs WHERE id = ? AND user_id = ?', [jobId, userId])
  if (!job || job.status !== 'succeeded') return null
  const safeExt = MEDIA_EXT.has(ext) ? (ext === '.jpeg' ? '.jpg' : ext) : extOf('', job.kind)
  const dir = mediaDir(userId)
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, `${jobId.replace(/[^a-zA-Z0-9_-]/g, '')}${safeExt}`)
  fs.writeFileSync(dest, bytes)
  let result: Record<string, unknown> = {}
  try {
    result = job.result_json ? (JSON.parse(job.result_json) as Record<string, unknown>) : {}
  } catch {
    result = {}
  }
  patchJob(jobId, { result: { ...result, stored: true } })
  return dest
}

async function keepGenerationMedia(job: JobRow): Promise<void> {
  if (job.status !== 'succeeded' || mediaFile(job.user_id, job.id)) return
  let result: Record<string, unknown> = {}
  try {
    result = job.result_json ? (JSON.parse(job.result_json) as Record<string, unknown>) : {}
  } catch {
    return
  }
  if (result.archiveTried) return
  const url = Array.isArray(result.urls) ? String(result.urls[0] || '') : ''
  if (!url.startsWith('http')) {
    patchJob(job.id, { result: { ...result, archiveTried: true } })
    return
  }
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    if (!resp.ok) throw new Error(String(resp.status))
    const bytes = Buffer.from(await resp.arrayBuffer())
    if (bytes.length < 32) throw new Error('empty')
    saveGenerationMedia(job.user_id, job.id, bytes, extOf(url, job.kind))
  } catch {
    patchJob(job.id, { result: { ...result, archiveTried: true } })
  }
}

function quoteFor(modelId: string, input: GenerateInput, user: SessionUser) {
  const sub = activeSub(user.id)
  const cat = CATALOG_BY_ID.get(modelId)
  const fen = estimateGenerationFen(modelId, {
    size: input.size,
    resolution: input.resolution,
    duration: input.duration,
    count: 1,
  })
  const shares = sharesFromOfficialFen(fen, baseModel())
  const quota = sub?.pkg.token_quota || 0
  const remaining = sub?.tokens_remaining || 0
  const percent = quota > 0 ? Math.round((shares / quota) * 1000) / 10 : null
  return {
    model: modelId,
    kind: cat?.kind || modelKind(modelId),
    fen,
    shares,
    percent,
    remaining,
    enough: remaining >= shares,
    note: cat?.priceNote || '',
  }
}

function resolveRoute(modelId: string, allow: string[], expect: ModelKind) {
  if (!allow.includes('*') && !allow.includes(modelId)) return null
  const model = one<ModelRow>('SELECT * FROM models WHERE id = ? AND enabled = 1', [modelId])
  if (!model) return null
  const kind = (model.kind || CATALOG_BY_ID.get(modelId)?.kind || 'chat') as ModelKind
  if (kind !== expect) return null
  const provider = one<ProviderRow>('SELECT * FROM providers WHERE id = ? AND enabled = 1', [model.provider_id])
  if (!provider) return null
  if (!normalizeProviderKey(provider.api_key)) return null
  return { model, provider, kind, catalog: CATALOG_BY_ID.get(modelId) }
}

function upstreamText(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string }; message?: string }
    return parsed.error?.message || parsed.message || raw
  } catch {
    return raw
  }
}

function isMissingUpstreamModel(raw: string): boolean {
  const text = upstreamText(raw)
  return /does not exist or you do not have access|has not activated the model|ModelNotOpen|not found/i.test(text)
}

function mapUpstream(status: number, provider: ProviderRow, raw: string) {
  if (status === 401) {
    return fail(
      '上游认证失败：请到内部控制台「供应商」检查豆包 Key，并在火山方舟开通对应生图 / 生视频模型。',
      401,
      'upstream_auth',
    )
  }
  if (status === 402) {
    markVendorEmpty(provider)
    return fail(`上游「${provider.name}」账户余额不足，请到厂商控制台充值。`, 503, 'upstream_balance')
  }
  const text = upstreamText(raw).trim() || `上游返回 ${status}`
  const activated = text.match(/has not activated the model\s+(\S+)/i)
  if (activated) {
    return fail(
      `火山方舟还没开通模型 ${activated[1].replace(/[。.,]$/, '')}。请到模型广场开通，或改选已开通的 Seedance 1.5 Pro。`,
      403,
      'upstream_model',
    )
  }
  if (/does not exist or you do not have access/i.test(text)) {
    return fail(
      '方舟没有这个模型的调用权限。请到「API Key 管理」把该 Key 授权范围改成全部资源；或打开已开通模型详情，复制模型 ID / 推理接入点（ep- 开头）到内部控制台「差价 → 模型配置 → 上游模型名」。',
      403,
      'upstream_model',
    )
  }
  return fail(text.slice(0, 240), status >= 400 && status < 600 ? status : 502, 'upstream')
}

const VIDEO_MODEL_ALIASES: Record<string, string[]> = {
  'doubao-seedance-1.0-pro': ['doubao-seedance-1-0-pro-250528'],
  'doubao-seedance-1.5-pro': [
    'doubao-seedance-1-5-pro-251215',
    'doubao-seedance-1.5-pro-251215',
    'doubao-seedance-1-0-pro-250528',
  ],
  'doubao-seedance-fast': [
    'doubao-seedance-2-0-fast-260128',
    'doubao-seedance-1-0-pro-250528',
  ],
  'doubao-seedance': [
    'doubao-seedance-2-0-260128',
    'doubao-seedance-1-0-pro-250528',
  ],
}

function isSeedance15Name(name: string): boolean {
  return /seedance-1[.-]5/.test(name)
}

function videoModelCandidates(route: { model: ModelRow }): string[] {
  const aliases = VIDEO_MODEL_ALIASES[route.model.id] || []
  const current = String(route.model.upstream_model || '').trim()
  if (route.model.id === 'doubao-seedance-1.5-pro' && current && !isSeedance15Name(current)) {
    return [...new Set(aliases)]
  }
  return [...new Set([current, ...aliases].filter(Boolean))]
}

function originOf(provider: ProviderRow): string {
  return provider.base_url.replace(/\/+$/, '')
}

function headers(provider: ProviderRow): Record<string, string> {
  return {
    Authorization: `Bearer ${normalizeProviderKey(provider.api_key)}`,
    'Content-Type': 'application/json',
  }
}

function imageUrls(payload: unknown): string[] {
  const data = (payload as { data?: Array<{ url?: string; b64_json?: string }> })?.data || []
  return data
    .map((item) => {
      if (item.url) return item.url
      if (item.b64_json) return `data:image/png;base64,${item.b64_json}`
      return ''
    })
    .filter(Boolean)
}

function videoUrl(payload: unknown): string {
  const body = payload as {
    content?: { video_url?: string }
    output?: { video_url?: string }
    data?: { content?: { video_url?: string } }
  }
  return body.content?.video_url || body.output?.video_url || body.data?.content?.video_url || ''
}

function saveJob(row: {
  id: string
  userId: string
  kind: string
  model: string
  providerId: string
  prompt: string
  params: Record<string, unknown>
  status: string
  upstreamId?: string | null
}) {
  const t = now()
  run(
    `INSERT INTO generation_jobs (id, user_id, kind, model, provider_id, prompt, params_json, status, upstream_id, result_json, error, billed_tokens, cost_fen, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, 0, ?, ?)`,
    [
      row.id,
      row.userId,
      row.kind,
      row.model,
      row.providerId,
      row.prompt,
      JSON.stringify(row.params),
      row.status,
      row.upstreamId || null,
      t,
      t,
    ],
  )
}

function patchJob(
  jobId: string,
  patch: {
    status?: string
    upstreamId?: string | null
    result?: unknown
    error?: string | null
    billed?: number
    costFen?: number
  },
) {
  const job = one<JobRow>('SELECT * FROM generation_jobs WHERE id = ?', [jobId])
  if (!job) return
  run(
    `UPDATE generation_jobs SET status = ?, upstream_id = ?, result_json = ?, error = ?, billed_tokens = ?, cost_fen = ?, updated_at = ? WHERE id = ?`,
    [
      patch.status ?? job.status,
      patch.upstreamId === undefined ? job.upstream_id : patch.upstreamId,
      patch.result === undefined ? job.result_json : JSON.stringify(patch.result),
      patch.error === undefined ? job.error : patch.error,
      patch.billed ?? job.billed_tokens,
      patch.costFen ?? job.cost_fen,
      now(),
      jobId,
    ],
  )
}

function billJob(userId: string, modelId: string, providerId: string, fen: number, jobId: string) {
  const billed = sharesFromOfficialFen(fen, baseModel())
  deductTokens(userId, billed, {
    model: modelId,
    providerId,
    prompt: 0,
    completion: 0,
    total: 0,
    costFen: fen,
    taskId: jobId,
  })
  return billed
}

async function runImage(
  route: { model: ModelRow; provider: ProviderRow; catalog?: CatalogEntry },
  input: GenerateInput,
  jobId: string,
  userId: string,
) {
  const size = String(input.size || route.catalog?.sizes?.[1] || route.catalog?.sizes?.[0] || '2K')
  const body: Record<string, unknown> = {
    model: route.model.upstream_model,
    prompt: input.prompt,
    size,
    watermark: false,
    response_format: 'url',
    sequential_image_generation: 'disabled',
  }
  if (input.image) body.image = input.image
  const resp = await fetch(`${originOf(route.provider)}/images/generations`, {
    method: 'POST',
    headers: headers(route.provider),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  })
  const raw = await resp.text()
  if (!resp.ok) {
    const mapped = mapUpstream(resp.status, route.provider, raw)
    patchJob(jobId, { status: 'failed', error: mapped.body.error.message })
    return mapped
  }
  let payload: unknown = {}
  try {
    payload = JSON.parse(raw)
  } catch {
    patchJob(jobId, { status: 'failed', error: '上游返回无法解析' })
    return fail('上游返回无法解析', 502)
  }
  const urls = imageUrls(payload)
  if (!urls.length) {
    patchJob(jobId, { status: 'failed', error: '上游没有返回图片' })
    return fail('上游没有返回图片', 502)
  }
  const fen = estimateGenerationFen(route.model.id, { size, count: urls.length })
  let billed = 0
  try {
    billed = billJob(userId, route.model.id, route.provider.id, fen, jobId)
  } catch (err) {
    patchJob(jobId, { status: 'failed', error: err instanceof Error ? err.message : String(err) })
    return fail(err instanceof Error ? err.message : String(err), 402)
  }
  patchJob(jobId, { status: 'succeeded', result: { urls }, billed, costFen: fen })
  const job = one<JobRow>('SELECT * FROM generation_jobs WHERE id = ?', [jobId])!
  await keepGenerationMedia(job)
  const saved = one<JobRow>('SELECT * FROM generation_jobs WHERE id = ?', [jobId]) || job
  return { status: 200, body: publicJob(saved) }
}

async function submitVideo(
  route: { model: ModelRow; provider: ProviderRow; catalog?: CatalogEntry },
  input: GenerateInput,
  jobId: string,
) {
  const resolution = String(input.resolution || route.catalog?.resolutions?.[1] || '720p')
  const duration = Number(input.duration || 5)
  const ratio = String(input.ratio || '16:9')
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: input.prompt }]
  if (input.image) {
    const imageItem: Record<string, unknown> = {
      type: 'image_url',
      image_url: { url: input.image },
      role: 'first_frame',
    }
    content.push(imageItem)
  }
  const candidates = videoModelCandidates(route)
  let lastRaw = ''
  let lastStatus = 502
  for (const modelName of candidates) {
    const body: Record<string, unknown> = {
      model: modelName,
      content,
      resolution,
      ratio,
      duration: /seedance-1/.test(modelName) ? Math.min(Math.max(duration, 2), 12) : duration,
      watermark: false,
    }
    if (isSeedance15Name(modelName)) body.generate_audio = true
    const resp = await fetch(`${originOf(route.provider)}/contents/generations/tasks`, {
      method: 'POST',
      headers: headers(route.provider),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    const raw = await resp.text()
    lastRaw = raw
    lastStatus = resp.status
    if (!resp.ok) {
      if (isMissingUpstreamModel(raw) && modelName !== candidates[candidates.length - 1]) continue
      const mapped = mapUpstream(resp.status, route.provider, raw)
      patchJob(jobId, { status: 'failed', error: mapped.body.error.message })
      return mapped
    }
    let payload: { id?: string } = {}
    try {
      payload = JSON.parse(raw) as { id?: string }
    } catch {
      patchJob(jobId, { status: 'failed', error: '上游返回无法解析' })
      return fail('上游返回无法解析', 502)
    }
    const upstreamId = payload.id
    if (!upstreamId) {
      patchJob(jobId, { status: 'failed', error: '上游没有返回任务 ID' })
      return fail('上游没有返回任务 ID', 502)
    }
    if (route.model.id === 'doubao-seedance-1.5-pro' && modelName !== route.model.upstream_model) {
      run(`UPDATE models SET upstream_model = ? WHERE id = ?`, [modelName, route.model.id])
    }
    patchJob(jobId, { status: 'running', upstreamId })
    const job = one<JobRow>('SELECT * FROM generation_jobs WHERE id = ?', [jobId])!
    return { status: 202, body: publicJob(job) }
  }
  const mapped = mapUpstream(lastStatus, route.provider, lastRaw)
  patchJob(jobId, { status: 'failed', error: mapped.body.error.message })
  return mapped
}

async function refreshVideo(job: JobRow, provider: ProviderRow, userId: string) {
  if (!job.upstream_id) return { status: 200, body: publicJob(job) }
  if (job.status === 'succeeded' || job.status === 'failed') return { status: 200, body: publicJob(job) }
  const resp = await fetch(`${originOf(provider)}/contents/generations/tasks/${encodeURIComponent(job.upstream_id)}`, {
    headers: headers(provider),
    signal: AbortSignal.timeout(20_000),
  })
  const raw = await resp.text()
  if (!resp.ok) {
    const mapped = mapUpstream(resp.status, provider, raw)
    patchJob(job.id, { status: 'failed', error: mapped.body.error.message })
    return mapped
  }
  let payload: { status?: string; content?: { video_url?: string }; error?: { message?: string } } = {}
  try {
    payload = JSON.parse(raw) as typeof payload
  } catch {
    return { status: 200, body: publicJob(job) }
  }
  const status = String(payload.status || '').toLowerCase()
  if (status === 'failed' || status === 'expired' || status === 'cancelled') {
    const message = payload.error?.message || '视频生成失败'
    patchJob(job.id, { status: 'failed', error: message })
    const next = one<JobRow>('SELECT * FROM generation_jobs WHERE id = ?', [job.id])!
    return { status: 200, body: publicJob(next) }
  }
  if (status !== 'succeeded' && status !== 'success') {
    patchJob(job.id, { status: 'running' })
    const next = one<JobRow>('SELECT * FROM generation_jobs WHERE id = ?', [job.id])!
    return { status: 200, body: publicJob(next) }
  }
  const url = videoUrl(payload)
  if (!url) {
    patchJob(job.id, { status: 'failed', error: '上游没有返回视频地址' })
    const next = one<JobRow>('SELECT * FROM generation_jobs WHERE id = ?', [job.id])!
    return { status: 200, body: publicJob(next) }
  }
  const latest = one<JobRow>('SELECT * FROM generation_jobs WHERE id = ?', [job.id])
  if (latest?.status === 'succeeded') return { status: 200, body: publicJob(latest) }
  const params = parseParams(job)
  const fen = estimateGenerationFen(job.model, {
    resolution: String(params.resolution || '720p'),
    duration: Number(params.duration || 5),
  })
  let billed = latest?.billed_tokens || 0
  if (!billed) {
    try {
      billed = billJob(userId, job.model, provider.id, fen, job.id)
    } catch (err) {
      patchJob(job.id, { status: 'failed', error: err instanceof Error ? err.message : String(err) })
      return fail(err instanceof Error ? err.message : String(err), 402)
    }
  }
  patchJob(job.id, { status: 'succeeded', result: { urls: [url], raw: payload }, billed, costFen: fen })
  const next = one<JobRow>('SELECT * FROM generation_jobs WHERE id = ?', [job.id])!
  await keepGenerationMedia(next)
  const saved = one<JobRow>('SELECT * FROM generation_jobs WHERE id = ?', [job.id]) || next
  return { status: 200, body: publicJob(saved) }
}

function guardUser(user: SessionUser) {
  if (!activeSub(user.id)) return fail('没有有效套餐，请先在官网购买。', 402)
  const sub = activeSub(user.id)!
  if (quotaExhausted(sub.tokens_remaining, sub.pkg.token_quota)) return fail(QUOTA_EXHAUSTED_MESSAGE, 402)
  if (sub.pkg.daily_quota > 0 && todayUsed(user.id) >= sub.pkg.daily_quota) {
    return fail('今日额度已用尽，明天再试或升级套餐。', 402)
  }
  return null
}

export function quoteGeneration(user: SessionUser, input: GenerateInput) {
  const blocked = guardUser(user)
  if (blocked) return blocked
  const kind = (input.kind === 'video' ? 'video' : 'image') as ModelKind
  const modelId = String(input.model || '')
  const allow = allowedModels(user)
  if (!modelId) return fail('请选择生成模型', 400)
  if (!allow.includes('*') && !allow.includes(modelId)) {
    return fail(`模型 ${modelId} 未接入或已停用。`, 403, 'forbidden_model')
  }
  if (modelKind(modelId) !== kind) return fail('模型类型与当前创作页不匹配。', 400)
  return { status: 200, body: quoteFor(modelId, input, user) }
}

export async function startGeneration(user: SessionUser, input: GenerateInput) {
  const blocked = guardUser(user)
  if (blocked) return blocked
  const kind = (input.kind === 'video' ? 'video' : 'image') as ModelKind
  const prompt = String(input.prompt || '').trim()
  if (!prompt) return fail('请先填写画面描述。', 400)
  if (prompt.length > 2000) return fail('描述过长，请压缩到 2000 字以内。', 400)
  const modelId = String(input.model || '')
  const allow = allowedModels(user)
  if (!allow.includes('*') && !allow.includes(modelId)) {
    return fail(`模型 ${modelId} 未接入或已停用。`, 403, 'forbidden_model')
  }
  const requested = one<ModelRow>('SELECT * FROM models WHERE id = ?', [modelId])
  const provider = requested ? one<ProviderRow>('SELECT * FROM providers WHERE id = ?', [requested.provider_id]) : null
  if (provider && !String(provider.api_key || '').trim()) {
    return fail(
      `上游「${provider.name}」还没有配置 API Key。请到内部控制台「供应商」粘贴并保存。生图 / 生视频要在火山方舟开通对应模型。`,
      503,
      'missing_upstream_key',
    )
  }
  const route = resolveRoute(modelId, allow, kind)
  if (!route) return fail(`模型 ${modelId} 未接入或已停用。`, 403, 'forbidden_model')
  const quote = quoteFor(modelId, input, user)
  if (!quote.enough) {
    return fail(`额度不足：本次约消耗套餐 ${quote.percent}%，请到官网充值后再使用。`, 402)
  }
  const jobId = id('gen_')
  const params = {
    size: input.size || null,
    resolution: input.resolution || null,
    duration: input.duration || null,
    ratio: input.ratio || null,
    hasImage: Boolean(input.image),
  }
  saveJob({
    id: jobId,
    userId: user.id,
    kind,
    model: modelId,
    providerId: route.provider.id,
    prompt,
    params,
    status: 'queued',
  })
  if (kind === 'image') return runImage(route, { ...input, prompt }, jobId, user.id)
  return submitVideo(route, { ...input, prompt }, jobId)
}

export async function getGeneration(user: SessionUser, jobId: string) {
  const job = one<JobRow>('SELECT * FROM generation_jobs WHERE id = ? AND user_id = ?', [jobId, user.id])
  if (!job) return fail('任务不存在', 404)
  if (job.kind === 'video' && (job.status === 'queued' || job.status === 'running')) {
    const provider = job.provider_id
      ? one<ProviderRow>('SELECT * FROM providers WHERE id = ?', [job.provider_id])
      : null
    if (provider && normalizeProviderKey(provider.api_key)) {
      return refreshVideo(job, provider, user.id)
    }
  }
  return { status: 200, body: publicJob(job) }
}

export async function listGenerations(user: SessionUser, limit = 30) {
  const list = many<JobRow>(
    `SELECT * FROM generation_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [user.id, Math.min(80, Math.max(1, limit))],
  )
  await Promise.all(list.map((job) => keepGenerationMedia(job).catch(() => undefined)))
  const fresh = many<JobRow>(
    `SELECT * FROM generation_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [user.id, Math.min(80, Math.max(1, limit))],
  )
  return { status: 200, body: { list: fresh.map(publicJob) } }
}
