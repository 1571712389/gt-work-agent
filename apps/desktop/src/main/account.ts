import { shell } from 'electron'
import { loadSettings, saveSettings } from './settings'
import type { Entitlements } from '../shared/protocol'

function origin(apiBase: string): string {
  return apiBase.replace(/\/v1\/?$/, '')
}

function controlPlane(): string {
  const settings = loadSettings()
  const fixed = saveSettings({
    ...settings,
    apiBase: settings.apiBase,
    shopUrl: settings.shopUrl,
  })
  return origin(fixed.apiBase)
}

async function readJson<T>(resp: Response, fallback: string): Promise<T> {
  const text = await resp.text()
  if (!text) throw new Error(`${fallback}（HTTP ${resp.status}，空响应）`)
  try {
    return JSON.parse(text) as T
  } catch {
    const hint = text.slice(0, 80).replace(/\s+/g, ' ')
    throw new Error(
      `${fallback}。当前网关 ${resp.url} 返回的不是账号接口（${hint}）。请把设置里的网关改为 http://127.0.0.1:8787/v1，并先运行 npm run api。`,
    )
  }
}

async function applyEntitlements(token: string, email: string) {
  const settings = loadSettings()
  const resp = await fetch(`${origin(settings.apiBase)}/v1/me/entitlements`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const ent = resp.ok ? await readJson<Entitlements>(resp, '拉取权益失败') : null
  const allowed = ent?.models?.map((m) => m.id) || []
  const chatIds = (ent?.models || []).filter((m) => (m.kind || 'chat') === 'chat').map((m) => m.id)
  const model = chatIds.includes(settings.model)
    ? settings.model
    : chatIds[0] || (allowed.includes(settings.model) ? settings.model : allowed[0]) || settings.model
  return saveSettings({
    ...settings,
    apiKey: token,
    userEmail: ent?.user.email || email,
    shopUrl: ent?.shopUrl || settings.shopUrl,
    model,
  })
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('已取消'))
      return
    }
    const timer = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('已取消'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export async function loginWithWebsite(signal: AbortSignal) {
  const base = controlPlane()
  const settings = loadSettings()
  const startResp = await fetch(`${base}/v1/auth/desktop/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }).catch((err) => {
    throw new Error(`连不上控制面 ${base}。请先在本机执行 npm run api。${err instanceof Error ? err.message : ''}`)
  })
  const start = await readJson<{
    deviceId?: string
    userCode?: string
    expiresIn?: number
    interval?: number
    error?: { message?: string }
  }>(startResp, '无法发起官网授权')
  if (!startResp.ok || !start.deviceId || !start.userCode) {
    throw new Error(start.error?.message || '无法发起官网授权')
  }
  const shop = (settings.shopUrl || base).replace(/\/+$/, '')
  const verifyUrl = `${shop}/#/authorize/${start.deviceId}`
  await shell.openExternal(verifyUrl)
  const deadline = Date.now() + (start.expiresIn || 600) * 1000
  const interval = Math.max(2, start.interval || 2) * 1000
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error('已取消')
    const pollResp = await fetch(`${base}/v1/auth/desktop/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: start.deviceId, userCode: start.userCode }),
    })
    const poll = await readJson<{ status?: string; token?: string; error?: { message?: string } }>(
      pollResp,
      '等待授权失败',
    )
    if (poll.status === 'approved' && poll.token) {
      return applyEntitlements(poll.token, '')
    }
    if (poll.status === 'expired') throw new Error('授权已过期，请重试')
    if (poll.status === 'consumed') throw new Error('授权已被使用，请回到客户端重新登录')
    if (poll.status !== 'pending' && !pollResp.ok) throw new Error(poll.error?.message || '等待授权失败')
    await sleep(interval, signal)
  }
  throw new Error('授权超时，请重试')
}

export async function logout() {
  const settings = loadSettings()
  return saveSettings({ ...settings, apiKey: '', userEmail: '' })
}

export async function fetchEntitlements() {
  const settings = loadSettings()
  if (!settings.apiKey) return null
  const resp = await fetch(`${origin(settings.apiBase)}/v1/me/entitlements`, {
    headers: { Authorization: `Bearer ${settings.apiKey}` },
  })
  if (!resp.ok) return null
  return resp.json() as Promise<Entitlements>
}

export async function checkUpdate() {
  const settings = loadSettings()
  const resp = await fetch(`${origin(settings.apiBase)}/updates/latest.yml`).catch(() => null)
  if (!resp || !resp.ok) return { ok: false, message: '暂无更新源。打好安装包后把 latest.yml 放到 API /updates。' }
  const text = await resp.text()
  const version = /version:\s*([^\s]+)/.exec(text)?.[1] || ''
  return { ok: true, version, feed: text }
}
