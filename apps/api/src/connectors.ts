import { randomBytes } from 'node:crypto'
import { many, one, run, now, id } from './auth'
import { db } from './db'

const TTL_MS = 10 * 60_000

export interface OAuthProvider {
  id: string
  authorizeUrl: string
  tokenUrl: string
  clientIdEnv: string
  clientSecretEnv: string
  scope: string
  extraAuthParams?: Record<string, string>
  tokenStyle: 'form' | 'json' | 'github' | 'feishu' | 'dingtalk'
}

export const OAUTH_PROVIDERS: OAuthProvider[] = [
  {
    id: 'github',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    clientIdEnv: 'GT_GITHUB_CLIENT_ID',
    clientSecretEnv: 'GT_GITHUB_CLIENT_SECRET',
    scope: 'repo read:user',
    tokenStyle: 'github',
  },
  {
    id: 'feishu',
    authorizeUrl: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
    tokenUrl: 'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
    clientIdEnv: 'GT_FEISHU_APP_ID',
    clientSecretEnv: 'GT_FEISHU_APP_SECRET',
    scope: 'auth:user.id:read offline_access',
    tokenStyle: 'feishu',
  },
  {
    id: 'dingtalk',
    authorizeUrl: 'https://login.dingtalk.com/oauth2/auth',
    tokenUrl: 'https://api.dingtalk.com/v1.0/oauth2/userAccessToken',
    clientIdEnv: 'GT_DINGTALK_CLIENT_ID',
    clientSecretEnv: 'GT_DINGTALK_CLIENT_SECRET',
    scope: 'openid corpid',
    extraAuthParams: { prompt: 'consent', response_type: 'code' },
    tokenStyle: 'dingtalk',
  },
  {
    id: 'google-calendar',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientIdEnv: 'GT_GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GT_GOOGLE_CLIENT_SECRET',
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    tokenStyle: 'form',
  },
]

export function ensureConnectorTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS connector_oauth (
      state TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      connector_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_connectors (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      connector_id TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      extra_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, connector_id)
    );
  `)
}

const OAUTH_LABELS: Record<string, string> = {
  github: 'GitHub',
  feishu: '飞书',
  dingtalk: '钉钉',
  'google-calendar': 'Google 日历',
}

function envOf(name: string): string {
  return String(process.env[name] || '').trim()
}

function metaOf(key: string): string {
  return String(one<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', [key])?.value || '').trim()
}

function putMeta(key: string, value: string): void {
  run(`INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)`, [key, value])
}

function credential(provider: OAuthProvider, kind: 'id' | 'secret'): string {
  const metaKey = `oauth_${provider.id}_${kind === 'id' ? 'client_id' : 'client_secret'}`
  const saved = metaOf(metaKey)
  if (saved) return saved
  return envOf(kind === 'id' ? provider.clientIdEnv : provider.clientSecretEnv)
}

export function providerById(id: string): OAuthProvider | undefined {
  return OAUTH_PROVIDERS.find((item) => item.id === id)
}

export function providerReady(provider: OAuthProvider): boolean {
  return Boolean(credential(provider, 'id') && credential(provider, 'secret'))
}

export function listOauthApps(apiOrigin: string) {
  return OAUTH_PROVIDERS.map((item) => ({
    id: item.id,
    name: OAUTH_LABELS[item.id] || item.id,
    clientId: credential(item, 'id'),
    hasSecret: Boolean(credential(item, 'secret')),
    ready: providerReady(item),
    redirectUri: redirectUri(apiOrigin, item.id),
  }))
}

export function oauthCredential(connectorId: string, kind: 'id' | 'secret'): string {
  const provider = providerById(connectorId)
  if (!provider) return ''
  return credential(provider, kind)
}

export function saveOauthApp(connectorId: string, clientId: string, clientSecret?: string): void {
  const provider = providerById(connectorId)
  if (!provider) throw new Error('不支持的连接器')
  putMeta(`oauth_${provider.id}_client_id`, clientId.trim())
  if (clientSecret?.trim()) putMeta(`oauth_${provider.id}_client_secret`, clientSecret.trim())
}

export function redirectUri(apiOrigin: string, connectorId: string): string {
  return `${apiOrigin.replace(/\/+$/, '')}/v1/connectors/${encodeURIComponent(connectorId)}/oauth/callback`
}

export function startConnectorOAuth(userId: string, connectorId: string, apiOrigin: string) {
  const provider = providerById(connectorId)
  if (!provider || !providerReady(provider)) {
    const name = provider ? OAUTH_LABELS[provider.id] || provider.id : connectorId
    return {
      mode: 'setup' as const,
      message: `${name}登录暂未开放，请稍后再试。`,
    }
  }
  const state = randomBytes(24).toString('base64url')
  run(
    `INSERT INTO connector_oauth (state, user_id, connector_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
    [state, userId, connectorId, now(), now() + TTL_MS],
  )
  const url = new URL(provider.authorizeUrl)
  url.searchParams.set('client_id', credential(provider, 'id'))
  url.searchParams.set('redirect_uri', redirectUri(apiOrigin, connectorId))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', provider.scope)
  url.searchParams.set('state', state)
  for (const [key, value] of Object.entries(provider.extraAuthParams || {})) {
    url.searchParams.set(key, value)
  }
  return { mode: 'oauth' as const, authorizeUrl: url.toString(), state, expiresIn: Math.floor(TTL_MS / 1000) }
}

interface TokenResult {
  accessToken: string
  refreshToken?: string
  extra?: Record<string, unknown>
}

async function exchangeToken(provider: OAuthProvider, code: string, apiOrigin: string, connectorId: string): Promise<TokenResult> {
  const clientId = credential(provider, 'id')
  const clientSecret = credential(provider, 'secret')
  const redirect = redirectUri(apiOrigin, connectorId)
  if (provider.tokenStyle === 'github') {
    const resp = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirect,
      }),
    })
    const data = (await resp.json()) as { access_token?: string; error?: string; error_description?: string }
    if (!data.access_token) throw new Error(data.error_description || data.error || 'GitHub 授权失败')
    return { accessToken: data.access_token }
  }
  if (provider.tokenStyle === 'feishu') {
    const resp = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirect,
      }),
    })
    const data = (await resp.json()) as { access_token?: string; refresh_token?: string; code?: number; msg?: string }
    if (!data.access_token) throw new Error(data.msg || '飞书授权失败')
    return { accessToken: data.access_token, refreshToken: data.refresh_token }
  }
  if (provider.tokenStyle === 'dingtalk') {
    const resp = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: clientId,
        clientSecret: clientSecret,
        code,
        grantType: 'authorization_code',
      }),
    })
    const data = (await resp.json()) as { accessToken?: string; refreshToken?: string; message?: string }
    if (!data.accessToken) throw new Error(data.message || '钉钉授权失败')
    return { accessToken: data.accessToken, refreshToken: data.refreshToken }
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirect,
    grant_type: 'authorization_code',
  })
  const resp = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  })
  const data = (await resp.json()) as { access_token?: string; refresh_token?: string; error?: string; error_description?: string }
  if (!data.access_token) throw new Error(data.error_description || data.error || '授权失败')
  return { accessToken: data.access_token, refreshToken: data.refresh_token }
}

export function saveUserConnector(
  userId: string,
  connectorId: string,
  accessToken: string,
  refreshToken?: string,
  extra?: Record<string, unknown>,
): void {
  const existing = one<{ id: string }>(
    `SELECT id FROM user_connectors WHERE user_id = ? AND connector_id = ?`,
    [userId, connectorId],
  )
  const extraJson = extra ? JSON.stringify(extra) : null
  if (existing) {
    run(
      `UPDATE user_connectors SET access_token = ?, refresh_token = ?, extra_json = ?, updated_at = ? WHERE id = ?`,
      [accessToken, refreshToken || null, extraJson, now(), existing.id],
    )
    return
  }
  run(
    `INSERT INTO user_connectors (id, user_id, connector_id, access_token, refresh_token, extra_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id('cnn_'), userId, connectorId, accessToken, refreshToken || null, extraJson, now(), now()],
  )
}

export async function finishConnectorOAuth(connectorId: string, code: string, state: string, apiOrigin: string) {
  const row = one<{ user_id: string; connector_id: string; expires_at: number }>(
    `SELECT user_id, connector_id, expires_at FROM connector_oauth WHERE state = ?`,
    [state],
  )
  if (!row || row.connector_id !== connectorId) throw new Error('授权请求无效')
  if (row.expires_at < now()) throw new Error('授权已过期，请回到客户端重试')
  const provider = providerById(connectorId)
  if (!provider) throw new Error('不支持的连接器')
  const tokens = await exchangeToken(provider, code, apiOrigin, connectorId)
  saveUserConnector(row.user_id, connectorId, tokens.accessToken, tokens.refreshToken, tokens.extra)
  run(`DELETE FROM connector_oauth WHERE state = ?`, [state])
  return { ok: true, connectorId }
}

export function listUserConnectors(userId: string, includeToken = false) {
  const rows = many<{
    connector_id: string
    access_token: string
    refresh_token: string | null
    updated_at: number
  }>(`SELECT connector_id, access_token, refresh_token, updated_at FROM user_connectors WHERE user_id = ?`, [userId])
  return rows.map((row) => ({
    connectorId: row.connector_id,
    updatedAt: row.updated_at,
    connected: true,
    ...(includeToken ? { accessToken: row.access_token, refreshToken: row.refresh_token } : {}),
  }))
}

export function getUserConnector(userId: string, connectorId: string) {
  return one<{ access_token: string; refresh_token: string | null }>(
    `SELECT access_token, refresh_token FROM user_connectors WHERE user_id = ? AND connector_id = ?`,
    [userId, connectorId],
  )
}

export function deleteUserConnector(userId: string, connectorId: string): void {
  run(`DELETE FROM user_connectors WHERE user_id = ? AND connector_id = ?`, [userId, connectorId])
}

export function publicConnectorCatalog() {
  return OAUTH_PROVIDERS.map((item) => ({
    id: item.id,
    oauthReady: providerReady(item),
  }))
}
