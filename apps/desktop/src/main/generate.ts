import { app, dialog, shell, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { loadSettings } from './settings'
import { fileDataUrl } from './session'
import type { GenerateJob, GenerateQuote, GenerateStartInput } from '../shared/protocol'

function origin(apiBase: string): string {
  return apiBase.replace(/\/v1\/?$/, '')
}

function apiError(payload: unknown, fallback: string): string {
  const body = payload as { error?: { message?: string } | string; message?: string }
  if (typeof body?.error === 'string') return body.error
  return body?.error?.message || body?.message || fallback
}

async function readJson<T>(resp: Response, fallback: string): Promise<T> {
  const text = await resp.text()
  let parsed: unknown = {}
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`${fallback}（HTTP ${resp.status}）`)
  }
  if (!resp.ok) throw new Error(apiError(parsed, `${fallback}（HTTP ${resp.status}）`))
  return parsed as T
}

function authHeaders(): Record<string, string> {
  const settings = loadSettings()
  if (!settings.apiKey) throw new Error('请先登录后再使用创作。')
  return { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' }
}

function accountDirs(): string[] {
  const appData = app.getPath('appData')
  const current = path.dirname(historyPath())
  return [
    current,
    path.join(app.getPath('userData'), 'generations'),
    path.join(appData, '@gt-workbench', 'desktop', 'generations'),
    path.join(appData, '光途Work', 'generations'),
  ]
}

function findLocalFile(jobId: string): string {
  const exts = ['.mp4', '.webm', '.png', '.jpg', '.jpeg', '.webp', '.gif']
  for (const dir of accountDirs()) {
    for (const ext of exts) {
      const file = path.join(dir, `${jobId}${ext}`)
      if (fs.existsSync(file)) return file
    }
  }
  return ''
}

async function uploadAccountMedia(jobId: string, file: string): Promise<boolean> {
  const settings = loadSettings()
  const ext = path.extname(file).toLowerCase() || '.bin'
  const bytes = fs.readFileSync(file)
  const resp = await fetch(`${origin(settings.apiBase)}/v1/generate/${encodeURIComponent(jobId)}/media`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/octet-stream', 'X-Media-Ext': ext },
    body: bytes,
  }).catch(() => null)
  return Boolean(resp?.ok)
}

async function downloadAccountMedia(job: GenerateJob): Promise<string> {
  const settings = loadSettings()
  const resp = await fetch(`${origin(settings.apiBase)}/v1/generate/${encodeURIComponent(job.id)}/media`, {
    headers: { Authorization: authHeaders().Authorization },
  }).catch(() => null)
  if (!resp?.ok) return ''
  const type = resp.headers.get('content-type') || ''
  const ext = type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : type.includes('mp4') ? '.mp4' : type.includes('webm') ? '.webm' : job.kind === 'video' ? '.mp4' : '.jpg'
  const dir = path.dirname(historyPath())
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, `${job.id}${ext}`)
  fs.writeFileSync(dest, Buffer.from(await resp.arrayBuffer()))
  return dest
}

function historyPath(): string {
  const settings = loadSettings()
  const scope = (settings.userEmail || 'signed-in').trim().toLowerCase().replace(/[^a-z0-9@._-]+/g, '_').slice(0, 80) || 'signed-in'
  const dir = path.join(app.getPath('userData'), 'generations', scope)
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'history.json')
}

function readHistory(): GenerateJob[] {
  try {
    return JSON.parse(fs.readFileSync(historyPath(), 'utf8')) as GenerateJob[]
  } catch {
    return []
  }
}

function isFailed(job: GenerateJob): boolean {
  return job.status === 'failed'
}

function writeHistory(list: GenerateJob[]): void {
  const visible = list.filter((item) => !isFailed(item)).slice(0, 80)
  fs.writeFileSync(historyPath(), JSON.stringify(visible, null, 2))
}

function upsertHistory(job: GenerateJob): GenerateJob {
  const list = readHistory().filter((item) => item.id !== job.id)
  if (isFailed(job)) {
    writeHistory(list)
    return job
  }
  const merged = { ...list.find((item) => item.id === job.id), ...job }
  writeHistory([merged, ...list])
  return merged
}

function extFromUrl(url: string, kind: string): string {
  try {
    const clean = new URL(url).pathname
    const ext = path.extname(clean).toLowerCase()
    if (ext && ext.length <= 5) return ext
  } catch {
    /* ignore */
  }
  if (url.startsWith('data:image/jpeg')) return '.jpg'
  if (url.startsWith('data:image/webp')) return '.webp'
  return kind === 'video' ? '.mp4' : '.png'
}

async function downloadAsset(url: string, kind: string, jobId: string): Promise<string> {
  const dir = path.join(app.getPath('userData'), 'generations')
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, `${jobId}${extFromUrl(url, kind)}`)
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',')
    fs.writeFileSync(dest, Buffer.from(url.slice(comma + 1), 'base64'))
    return dest
  }
  const resp = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!resp.ok) throw new Error(`下载成品失败（HTTP ${resp.status}）`)
  const buf = Buffer.from(await resp.arrayBuffer())
  fs.writeFileSync(dest, buf)
  return dest
}

function attachLocal(job: GenerateJob): GenerateJob {
  const prev = readHistory().find((item) => item.id === job.id)
  if (prev?.localPath && fs.existsSync(prev.localPath)) return { ...job, localPath: prev.localPath }
  return job
}

async function materialize(job: GenerateJob): Promise<GenerateJob> {
  const found = job.localPath && fs.existsSync(job.localPath) ? job.localPath : findLocalFile(job.id)
  const withLocal = { ...attachLocal(job), ...(found ? { localPath: found } : {}) }
  if (withLocal.status !== 'succeeded') return upsertHistory(withLocal)
  if (withLocal.localPath && fs.existsSync(withLocal.localPath)) {
    if (!withLocal.stored) await uploadAccountMedia(withLocal.id, withLocal.localPath).catch(() => undefined)
    return upsertHistory({ ...withLocal, stored: true })
  }
  if (withLocal.stored) {
    const localPath = await downloadAccountMedia(withLocal).catch(() => '')
    if (localPath) return upsertHistory({ ...withLocal, localPath, stored: true })
  }
  const url = (withLocal.urls || [])[0]
  if (!url) return upsertHistory(withLocal)
  try {
    const localPath = await downloadAsset(url, withLocal.kind, withLocal.id)
    await uploadAccountMedia(withLocal.id, localPath).catch(() => undefined)
    return upsertHistory({ ...withLocal, localPath, stored: true })
  } catch {
    return upsertHistory(withLocal)
  }
}

export async function quoteGeneration(input: Pick<GenerateStartInput, 'kind' | 'model' | 'size' | 'resolution' | 'duration'>) {
  const settings = loadSettings()
  const query = new URLSearchParams({
    kind: input.kind,
    model: input.model,
    ...(input.size ? { size: input.size } : {}),
    ...(input.resolution ? { resolution: input.resolution } : {}),
    ...(input.duration != null ? { duration: String(input.duration) } : {}),
  })
  const resp = await fetch(`${origin(settings.apiBase)}/v1/generate/quote?${query}`, { headers: authHeaders() })
  return readJson<GenerateQuote>(resp, '无法估算本次消耗')
}

export async function startGeneration(input: GenerateStartInput): Promise<GenerateJob> {
  const settings = loadSettings()
  const image = input.imagePath ? fileDataUrl(input.imagePath) : ''
  const resp = await fetch(`${origin(settings.apiBase)}/v1/generate`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      kind: input.kind,
      model: input.model,
      prompt: input.prompt,
      size: input.size,
      resolution: input.resolution,
      duration: input.duration,
      ratio: input.ratio,
      image: image || undefined,
    }),
  })
  const job = await readJson<GenerateJob>(resp, '生成失败')
  return materialize(job)
}

export async function generationStatus(id: string): Promise<GenerateJob> {
  const settings = loadSettings()
  const resp = await fetch(`${origin(settings.apiBase)}/v1/generate/${encodeURIComponent(id)}`, { headers: authHeaders() })
  const job = await readJson<GenerateJob>(resp, '查询生成任务失败')
  return materialize(job)
}

export async function listGenerations(): Promise<GenerateJob[]> {
  const settings = loadSettings()
  if (!settings.apiKey) return []
  try {
    const resp = await fetch(`${origin(settings.apiBase)}/v1/generate?limit=40`, { headers: authHeaders() })
    const body = await readJson<{ list?: GenerateJob[] }>(resp, '读取创作记录失败')
    const localById = new Map(readHistory().map((item) => [item.id, item]))
    const list = await Promise.all(
      (body.list || [])
        .filter((item) => !isFailed(item))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .map((item) => {
          const prev = localById.get(item.id)
          const localPath = (prev?.localPath && fs.existsSync(prev.localPath) ? prev.localPath : '') || findLocalFile(item.id)
          return materialize({ ...item, localPath: localPath || prev?.localPath })
        }),
    )
    writeHistory(list)
    return list
  } catch {
    return []
  }
}

export async function pickGenerateImage(win: BrowserWindow | null): Promise<string | null> {
  const result = await dialog.showOpenDialog(win || undefined, {
    title: '选择参考图',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
  })
  return result.canceled ? null : result.filePaths[0] || null
}

export async function openGenerated(abs: string): Promise<string> {
  if (!abs || !fs.existsSync(abs)) throw new Error('文件不存在')
  const err = await shell.openPath(abs)
  if (err) throw new Error(err)
  return abs
}

export function showGenerated(abs: string): void {
  if (abs && fs.existsSync(abs)) shell.showItemInFolder(abs)
}
