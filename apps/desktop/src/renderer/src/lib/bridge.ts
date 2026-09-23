import { CONNECTOR_MARKET, templateToMcp } from '@shared/mcp-market'
import type { ConnectorConnectResult, McpInfo, SkillInfo } from '@shared/protocol'
import { markInstalled, withInstalledFlag } from './installed'
import { useApp } from './store'

function origin(): string {
  const base = useApp.getState().settings?.apiBase || 'http://43.139.61.253:8787/v1'
  return base.replace(/\/v1\/?$/, '')
}

function token(): string {
  return useApp.getState().settings?.apiKey || ''
}

function openPage(url: string) {
  if (typeof window.gt.account.openUrl === 'function') {
    void window.gt.account.openUrl(url)
    return
  }
  window.open(url, '_blank', 'noopener')
}

async function readJson<T>(resp: Response, fallback: string): Promise<T> {
  const text = await resp.text()
  if (!text) throw new Error(`${fallback}（HTTP ${resp.status}）`)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(fallback)
  }
}

export async function installSkillFallback(skillId: string): Promise<SkillInfo[]> {
  const native = window.gt.skills?.install
  if (typeof native === 'function') {
    const list = await native(skillId)
    markInstalled(skillId, true)
    return withInstalledFlag(list)
  }
  const resp = await fetch(`${origin()}/v1/skills/${encodeURIComponent(skillId)}`)
  const skill = await readJson<{ id: string; name: string; description: string; body: string }>(resp, '下载技能失败')
  if (!resp.ok) throw new Error((skill as { error?: { message?: string } }).error?.message || '下载技能失败')
  const list = await window.gt.skills.save({
    id: skill.id || skillId,
    name: skill.name,
    description: skill.description,
    body: skill.body,
  })
  markInstalled(skillId, true)
  return withInstalledFlag(list)
}

export async function uninstallSkillFallback(skillId: string): Promise<SkillInfo[]> {
  const native = window.gt.skills?.uninstall
  if (typeof native === 'function') {
    const list = await native(skillId)
    markInstalled(skillId, false)
    return withInstalledFlag(list)
  }
  markInstalled(skillId, false)
  const catalog = await window.gt.catalog.get()
  return withInstalledFlag(catalog.skills)
}

export async function connectConnectorFallback(id: string, accessToken?: string): Promise<ConnectorConnectResult> {
  const native = window.gt.mcp?.connect
  if (typeof native === 'function') return native(id, accessToken)
  if (id === 'dingtalk') throw new Error('请在桌面客户端里连接钉钉，登录需要在本机浏览器完成。')

  const item = CONNECTOR_MARKET.find((row) => row.id === id)
  if (!item) throw new Error('连接器不存在')
  if (!token()) throw new Error('请先登录后再连接第三方服务')

  const apply = async (env?: Record<string, string>): Promise<McpInfo[]> => {
    return window.gt.mcp.upsert(templateToMcp(item, env), true)
  }

  if (accessToken?.trim()) {
    const env = item.tokenEnv ? { [item.tokenEnv]: accessToken.trim() } : undefined
    await fetch(`${origin()}/v1/me/connectors/${encodeURIComponent(id)}/token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: accessToken.trim() }),
    }).catch(() => null)
    return { mcp: await apply(env) }
  }

  if (item.auth === 'local') {
    return { mcp: await apply() }
  }

  if (item.auth === 'oauth') {
    const startResp = await fetch(`${origin()}/v1/connectors/${encodeURIComponent(id)}/oauth/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    const start = await readJson<{
      mode?: string
      authorizeUrl?: string
      message?: string
      tokenUrl?: string
    }>(startResp, '无法发起授权')
    if (start.authorizeUrl && start.mode !== 'token' && start.mode !== 'setup') {
      openPage(start.authorizeUrl)
      const deadline = Date.now() + 10 * 60 * 1000
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        const poll = await fetch(`${origin()}/v1/me/connectors/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${token()}` },
        })
        if (!poll.ok) continue
        const row = await readJson<{ accessToken?: string }>(poll, '读取授权失败')
        if (row.accessToken) {
          const env = item.tokenEnv ? { [item.tokenEnv]: row.accessToken } : undefined
          return { mcp: await apply(env) }
        }
      }
      throw new Error('授权超时。请在浏览器里完成登录后再试一次。')
    }
    return {
      mcp: [],
      needSetup: true,
      hint: start.message || '该登录暂未开放，请稍后再试。',
    }
  }

  if (item.tokenUrl) openPage(item.tokenUrl)
  return {
    mcp: [],
    needToken: true,
    tokenUrl: item.tokenUrl,
    tokenLabel: item.tokenLabel,
    hint: item.hint,
  }
}
