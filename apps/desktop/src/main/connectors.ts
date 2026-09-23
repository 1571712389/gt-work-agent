import { shell } from 'electron'
import { CONNECTOR_MARKET, templateToMcp } from '../shared/mcp-market'
import type { ConnectorConnectResult, McpInfo } from '../shared/protocol'
import { loginDingTalkCli } from './dws-cli'
import { loadSettings } from './settings'
import { upsertMcp } from './session'

function origin(apiBase: string): string {
  return apiBase.replace(/\/v1\/?$/, '')
}

async function readJson<T>(resp: Response, fallback: string): Promise<T> {
  const text = await resp.text()
  if (!text) throw new Error(`${fallback}（HTTP ${resp.status}）`)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`${fallback}，返回的不是 JSON`)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchMeConnector(id: string): Promise<{ accessToken?: string } | null> {
  const settings = loadSettings()
  const resp = await fetch(`${origin(settings.apiBase)}/v1/me/connectors/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${settings.apiKey}` },
  })
  if (resp.status === 404) return null
  if (!resp.ok) return null
  return readJson(resp, '读取连接授权失败')
}

export async function connectConnector(id: string, token?: string): Promise<ConnectorConnectResult> {
  const item = CONNECTOR_MARKET.find((row) => row.id === id)
  if (!item) throw new Error('连接器不存在')
  const settings = loadSettings()
  if (!settings.apiKey) throw new Error('请先登录后再连接第三方服务')

  const apply = async (env?: Record<string, string>): Promise<McpInfo[]> => {
    const next = templateToMcp(item, env)
    return upsertMcp(next, true)
  }

  if (id === 'dingtalk') {
    await loginDingTalkCli()
    return { mcp: await apply() }
  }

  if (token?.trim()) {
    const env = item.tokenEnv ? { [item.tokenEnv]: token.trim() } : undefined
    await fetch(`${origin(settings.apiBase)}/v1/me/connectors/${encodeURIComponent(id)}/token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token.trim() }),
    }).catch(() => null)
    return { mcp: await apply(env) }
  }

  if (item.auth === 'local') {
    return { mcp: await apply() }
  }

  if (item.auth === 'oauth') {
    const startResp = await fetch(`${origin(settings.apiBase)}/v1/connectors/${encodeURIComponent(id)}/oauth/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    const start = await readJson<{
      mode?: string
      authorizeUrl?: string
      message?: string
      tokenUrl?: string
    }>(startResp, '无法发起授权')
    if (!startResp.ok || start.mode === 'setup' || start.mode === 'token' || !start.authorizeUrl) {
      return {
        mcp: [],
        needSetup: true,
        hint: start.message || '该登录暂未开放，请稍后再试。',
      }
    }
    await shell.openExternal(start.authorizeUrl)
    const deadline = Date.now() + 10 * 60 * 1000
    while (Date.now() < deadline) {
      await sleep(2000)
      const row = await fetchMeConnector(id)
      if (row?.accessToken) {
        const env = item.tokenEnv ? { [item.tokenEnv]: row.accessToken } : undefined
        return { mcp: await apply(env) }
      }
    }
    throw new Error('授权超时。请在浏览器里完成登录后再试一次。')
  }

  if (item.tokenUrl) await shell.openExternal(item.tokenUrl).catch(() => null)
  return {
    mcp: [],
    needToken: true,
    tokenUrl: item.tokenUrl,
    tokenLabel: item.tokenLabel,
    hint: item.hint,
  }
}

export async function bindConnectorToken(id: string, token: string): Promise<ConnectorConnectResult> {
  return connectConnector(id, token)
}
