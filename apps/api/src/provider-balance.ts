import crypto from 'node:crypto'
import { many, one, run, now } from './db'
import { mixFenPerMillion, BASE_MODEL_ID, type ModelPricing } from './pricing'
import { normalizeProviderKey } from './provider-key'

export interface VendorAccount {
  id: string
  name: string
  base_url: string
  api_key: string
  access_key?: string
  secret_key?: string
}

export interface VendorBalance {
  supported: boolean
  available?: boolean
  currency?: string
  total?: number
  granted?: number
  toppedUp?: number
  topUpUrl: string
  error?: string
  checkedAt?: number
}

export interface ModelRemain {
  id: string
  displayName: string
  providerId: string
  multiplier: number
  mixFenPerM: number
  usedTokens: number
  usedShares: number
  usedCostFen: number
  todayTokens: number
  todayShares: number
  todayCostFen: number
}

export interface ModelTrend {
  id: string
  displayName: string
  tokens: number[]
  shares: number[]
  costFen: number[]
}

export interface MonitorPayload {
  list: ProviderMonitor[]
  checkedAt: number
  trend: { days: string[]; models: ModelTrend[] }
}

export interface ProviderMonitor {
  id: string
  name: string
  hasKey: boolean
  enabled: boolean
  canQueryBalance: boolean
  topUpUrl: string
  balance: VendorBalance
  remainYuan: number | null
  remainShares: number | null
  usedTokens: number
  usedShares: number
  usedCostFen: number
  todayTokens: number
  todayShares: number
  todayCostFen: number
  models: ModelRemain[]
}

const TOP_UP: Record<string, string> = {
  prov_deepseek: 'https://platform.deepseek.com/top_up',
  prov_doubao: 'https://console.volcengine.com/ark',
  prov_kimi: 'https://platform.moonshot.cn',
  prov_openai: 'https://platform.openai.com/settings/organization/billing',
}

export function topUpUrlFor(providerId: string): string {
  return TOP_UP[providerId] || ''
}

export function canQueryVendorBalance(providerId: string): boolean {
  return providerId === 'prov_deepseek' || providerId === 'prov_kimi' || providerId === 'prov_doubao'
}

function unsupportedBalanceMessage(providerId: string): string {
  if (providerId === 'prov_doubao') return '请在供应商页填写火山 Access Key 和 Secret Key'
  return '该厂商未开放余额查询接口'
}

function cacheKey(providerId: string): string {
  return `vendor_balance_${providerId}`
}

export function readCachedVendorBalance(providerId: string): VendorBalance | null {
  const raw = one<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', [cacheKey(providerId)])?.value
  if (!raw) return null
  try {
    return JSON.parse(raw) as VendorBalance
  } catch {
    return null
  }
}

export function cacheVendorBalance(providerId: string, balance: VendorBalance): void {
  run(`INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)`, [
    cacheKey(providerId),
    JSON.stringify({ ...balance, checkedAt: balance.checkedAt || now() }),
  ])
}

export function clearVendorBalanceCache(providerId: string): void {
  run(`DELETE FROM app_meta WHERE key = ?`, [cacheKey(providerId)])
}

const BALANCE_STALE_MS = 2 * 60 * 1000

function needsLiveBalance(balance: VendorBalance | null, force?: boolean): boolean {
  if (force) return true
  if (!balance) return true
  // 上游 402 后会把余额写成 0；充值后必须重新拉，不能一直读旧缓存
  if (balance.available === false) return true
  if (typeof balance.total === 'number' && balance.total <= 0 && !balance.error) return true
  if (!balance.checkedAt || now() - balance.checkedAt > BALANCE_STALE_MS) return true
  return false
}

function apiOrigin(baseUrl: string): string {
  return String(baseUrl || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v\d+$/i, '')
}

function money(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function kimiBalanceUrl(baseUrl: string): string {
  const base = String(baseUrl || 'https://api.moonshot.cn/v1').trim().replace(/\/+$/, '')
  if (/\/v\d+$/i.test(base)) return `${base}/users/me/balance`
  return `${base}/v1/users/me/balance`
}

function kimiCurrency(baseUrl: string): string {
  return /moonshot\.ai/i.test(baseUrl) ? 'USD' : 'CNY'
}

function hmac(key: Buffer | string, content: string): Buffer {
  return crypto.createHmac('sha256', key).update(content, 'utf8').digest()
}

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex')
}

function volcHeaders(ak: string, sk: string, body: string): Record<string, string> {
  const host = 'billing.volcengineapi.com'
  const xDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const shortDate = xDate.slice(0, 8)
  const bodyHash = sha256(body)
  const query = 'Action=QueryBalanceAcct&Version=2022-01-01'
  const headerMap: Record<string, string> = {
    'content-type': 'application/json',
    host,
    'x-content-sha256': bodyHash,
    'x-date': xDate,
  }
  const names = Object.keys(headerMap).sort()
  const canonical = [
    'POST',
    '/',
    query,
    names.map((name) => `${name}:${headerMap[name]}`).join('\n') + '\n',
    names.join(';'),
    bodyHash,
  ].join('\n')
  const scope = `${shortDate}/cn-north-1/billing/request`
  const stringToSign = ['HMAC-SHA256', xDate, scope, sha256(canonical)].join('\n')
  const signing = hmac(hmac(hmac(hmac(sk, shortDate), 'cn-north-1'), 'billing'), 'request')
  const signature = crypto.createHmac('sha256', signing).update(stringToSign, 'utf8').digest('hex')
  return {
    'Content-Type': 'application/json',
    Host: host,
    'X-Date': xDate,
    'X-Content-Sha256': bodyHash,
    Authorization: `HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
  }
}

async function fetchVolcBalance(provider: VendorAccount, topUpUrl: string): Promise<VendorBalance> {
  const ak = String(provider.access_key || '').trim()
  const sk = String(provider.secret_key || '').trim()
  if (!ak || !sk) {
    return { supported: true, topUpUrl, error: '请填写火山 Access Key 和 Secret Key', checkedAt: now() }
  }
  const body = '{}'
  try {
    const res = await fetch('https://billing.volcengineapi.com/?Action=QueryBalanceAcct&Version=2022-01-01', {
      method: 'POST',
      headers: volcHeaders(ak, sk, body),
      body,
    })
    const data = (await res.json().catch(() => ({}))) as {
      ResponseMetadata?: { Error?: { Message?: string; Code?: string } }
      Result?: { AvailableBalance?: string | number; CashBalance?: string | number }
    }
    const message = data.ResponseMetadata?.Error?.Message || data.ResponseMetadata?.Error?.Code
    const total = money(data.Result?.AvailableBalance)
    if (!res.ok || message || data.Result?.AvailableBalance == null) {
      return { supported: true, topUpUrl, error: message || `查询失败 ${res.status}`, checkedAt: now() }
    }
    return {
      supported: true,
      available: total > 0,
      currency: 'CNY',
      total,
      granted: 0,
      toppedUp: money(data.Result?.CashBalance),
      topUpUrl,
      checkedAt: now(),
    }
  } catch (err) {
    return { supported: true, topUpUrl, error: err instanceof Error ? err.message : String(err), checkedAt: now() }
  }
}

export async function fetchVendorBalance(provider: VendorAccount): Promise<VendorBalance> {
  const topUpUrl = topUpUrlFor(provider.id)
  const key = normalizeProviderKey(provider.api_key)
  if (provider.id === 'prov_doubao') return fetchVolcBalance(provider, topUpUrl)
  if (!key) return { supported: false, topUpUrl, error: '未配置 Key', checkedAt: now() }
  if (provider.id === 'prov_kimi') return fetchKimiBalance(provider, key, topUpUrl)
  if (!canQueryVendorBalance(provider.id)) {
    return { supported: false, topUpUrl, error: unsupportedBalanceMessage(provider.id), checkedAt: now() }
  }
  try {
    const res = await fetch(`${apiOrigin(provider.base_url)}/user/balance`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    })
    const data = (await res.json().catch(() => ({}))) as {
      is_available?: boolean
      balance_infos?: Array<{
        currency?: string
        total_balance?: string
        granted_balance?: string
        topped_up_balance?: string
      }>
      error?: { message?: string }
    }
    if (!res.ok) {
      return { supported: true, topUpUrl, error: data.error?.message || `查询失败 ${res.status}`, checkedAt: now() }
    }
    const cny = data.balance_infos?.find((row) => row.currency === 'CNY') || data.balance_infos?.[0]
    return {
      supported: true,
      available: Boolean(data.is_available),
      currency: cny?.currency || 'CNY',
      total: money(cny?.total_balance),
      granted: money(cny?.granted_balance),
      toppedUp: money(cny?.topped_up_balance),
      topUpUrl,
      checkedAt: now(),
    }
  } catch (err) {
    return { supported: true, topUpUrl, error: err instanceof Error ? err.message : String(err), checkedAt: now() }
  }
}

async function fetchKimiBalance(provider: VendorAccount, key: string, topUpUrl: string): Promise<VendorBalance> {
  try {
    const res = await fetch(kimiBalanceUrl(provider.base_url), {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    })
    const data = (await res.json().catch(() => ({}))) as {
      code?: number
      status?: boolean
      message?: string
      error?: { message?: string }
      data?: { available_balance?: number; voucher_balance?: number; cash_balance?: number }
      available_balance?: number
      voucher_balance?: number
      cash_balance?: number
    }
    const row = data.data && typeof data.data === 'object' ? data.data : data
    if (!res.ok || data.status === false || (typeof data.code === 'number' && data.code !== 0) || typeof row.available_balance !== 'number') {
      return {
        supported: true,
        topUpUrl,
        error: data.error?.message || data.message || `查询失败 ${res.status}`,
        checkedAt: now(),
      }
    }
    const total = money(row.available_balance)
    return {
      supported: true,
      available: total > 0,
      currency: kimiCurrency(provider.base_url),
      total,
      granted: money(row.voucher_balance),
      toppedUp: money(row.cash_balance),
      topUpUrl,
      checkedAt: now(),
    }
  } catch (err) {
    return { supported: true, topUpUrl, error: err instanceof Error ? err.message : String(err), checkedAt: now() }
  }
}

export async function refreshVendorBalance(provider: VendorAccount): Promise<VendorBalance> {
  const balance = await fetchVendorBalance(provider)
  cacheVendorBalance(provider.id, balance)
  return balance
}

export function markVendorEmpty(provider: VendorAccount): void {
  const prev = readCachedVendorBalance(provider.id)
  cacheVendorBalance(provider.id, {
    supported: canQueryVendorBalance(provider.id),
    available: false,
    currency: prev?.currency || 'CNY',
    total: 0,
    granted: prev?.granted || 0,
    toppedUp: prev?.toppedUp || 0,
    topUpUrl: topUpUrlFor(provider.id),
    checkedAt: now(),
  })
}

function dayStart(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function lastDays(n: number): string[] {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const days: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(start)
    x.setDate(start.getDate() - i)
    days.push(isoDay(x))
  }
  return days
}

function buildTrend(models: Array<ModelPricing & { display_name: string }>): { days: string[]; models: ModelTrend[] } {
  const days = lastDays(14)
  const from = dayStart() - 13 * 24 * 60 * 60_000
  const rows = many<{ day: string; model: string; tokens: number; shares: number; cost: number }>(
    `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime') as day, model,
            COALESCE(SUM(total_tokens), 0) as tokens, COALESCE(SUM(billed_tokens), 0) as shares, COALESCE(SUM(cost_fen), 0) as cost
     FROM usage_logs WHERE created_at >= ? GROUP BY day, model`,
    [from],
  )
  const byModel = new Map<string, Map<string, { tokens: number; shares: number; cost: number }>>()
  for (const row of rows) {
    if (!byModel.has(row.model)) byModel.set(row.model, new Map())
    byModel.get(row.model)!.set(row.day, row)
  }
  const withData = models.filter((m) => byModel.has(m.id))
  const picked = (withData.length ? withData : models).slice(0, 8)
  return {
    days,
    models: picked.map((model) => {
      const series = byModel.get(model.id)
      return {
        id: model.id,
        displayName: model.display_name || model.id,
        tokens: days.map((day) => series?.get(day)?.tokens || 0),
        shares: days.map((day) => series?.get(day)?.shares || 0),
        costFen: days.map((day) => series?.get(day)?.cost || 0),
      }
    }),
  }
}

function remainFromVendor(
  balance: VendorBalance,
  baseMixFenPerM: number,
): { yuan: number | null; shares: number | null } {
  if (!balance.supported || balance.error || typeof balance.total !== 'number') {
    return { yuan: null, shares: null }
  }
  const total = Math.max(0, balance.total)
  const yuan = (balance.currency || 'CNY') === 'USD' ? total * 7.2 : total
  if (baseMixFenPerM <= 0) return { yuan, shares: null }
  const shares = Math.floor(((yuan * 100) / baseMixFenPerM) * 1e6)
  return { yuan, shares }
}

export async function buildVendorMonitor(opts: { refresh?: boolean } = {}): Promise<MonitorPayload> {
  const providers = many<VendorAccount & { enabled: number }>(
    `SELECT id, name, base_url, api_key, access_key, secret_key, enabled FROM providers ORDER BY priority, id`,
  )
  const models = many<ModelPricing & { display_name: string }>(
    `SELECT id, provider_id, display_name, multiplier, enabled, input_fen_per_m, output_fen_per_m, cache_hit_fen_per_m FROM models ORDER BY id`,
  )
  const usage = many<{ model: string; tokens: number; shares: number; cost: number }>(
    `SELECT model, COALESCE(SUM(total_tokens), 0) as tokens, COALESCE(SUM(billed_tokens), 0) as shares, COALESCE(SUM(cost_fen), 0) as cost FROM usage_logs GROUP BY model`,
  )
  const today = many<{ model: string; tokens: number; shares: number; cost: number }>(
    `SELECT model, COALESCE(SUM(total_tokens), 0) as tokens, COALESCE(SUM(billed_tokens), 0) as shares, COALESCE(SUM(cost_fen), 0) as cost FROM usage_logs WHERE created_at >= ? GROUP BY model`,
    [dayStart()],
  )
  const used = new Map(usage.map((row) => [row.model, row]))
  const usedToday = new Map(today.map((row) => [row.model, row]))

  let latest = 0
  const list: ProviderMonitor[] = []
  for (const provider of providers) {
    const hasKey = Boolean(normalizeProviderKey(provider.api_key))
    const hasBalanceKey = provider.id === 'prov_doubao'
      ? Boolean(String(provider.access_key || '').trim() && String(provider.secret_key || '').trim())
      : hasKey
    let balance = readCachedVendorBalance(provider.id)
    const queryable = canQueryVendorBalance(provider.id)
    if (hasBalanceKey && queryable && (needsLiveBalance(balance, opts.refresh) || balance?.supported === false)) {
      balance = await refreshVendorBalance(provider)
    }
    if (!balance) {
      balance = {
        supported: queryable,
        topUpUrl: topUpUrlFor(provider.id),
        error: hasBalanceKey
          ? queryable
            ? '尚未查询'
            : unsupportedBalanceMessage(provider.id)
          : provider.id === 'prov_doubao'
            ? '请填写火山 Access Key 和 Secret Key'
            : '未配置 Key',
      }
    }
    if (balance.checkedAt) latest = Math.max(latest, balance.checkedAt)
    const rows = models.filter((m) => m.provider_id === provider.id)
    const base = models.find((m) => m.id === BASE_MODEL_ID) || rows[0]
    const remain = remainFromVendor(balance, base ? mixFenPerMillion(base) : 0)
    const modelRows = rows.map((model) => {
      const all = used.get(model.id)
      const day = usedToday.get(model.id)
      return {
        id: model.id,
        displayName: model.display_name || model.id,
        providerId: model.provider_id,
        multiplier: model.multiplier || 1,
        mixFenPerM: Math.round(mixFenPerMillion(model)),
        usedTokens: all?.tokens || 0,
        usedShares: all?.shares || 0,
        usedCostFen: all?.cost || 0,
        todayTokens: day?.tokens || 0,
        todayShares: day?.shares || 0,
        todayCostFen: day?.cost || 0,
      }
    })
    list.push({
      id: provider.id,
      name: provider.name,
      hasKey,
      enabled: Boolean(provider.enabled),
      canQueryBalance: queryable,
      topUpUrl: topUpUrlFor(provider.id),
      balance,
      remainYuan: remain.yuan,
      remainShares: remain.shares,
      usedTokens: modelRows.reduce((s, m) => s + m.usedTokens, 0),
      usedShares: modelRows.reduce((s, m) => s + m.usedShares, 0),
      usedCostFen: modelRows.reduce((s, m) => s + m.usedCostFen, 0),
      todayTokens: modelRows.reduce((s, m) => s + m.todayTokens, 0),
      todayShares: modelRows.reduce((s, m) => s + m.todayShares, 0),
      todayCostFen: modelRows.reduce((s, m) => s + m.todayCostFen, 0),
      models: modelRows,
    })
  }
  return { list, checkedAt: latest || now(), trend: buildTrend(models) }
}

export async function pollVendorBalances(): Promise<void> {
  const rows = many<VendorAccount>(
    `SELECT id, name, base_url, api_key, access_key, secret_key FROM providers WHERE enabled = 1`,
  )
  for (const row of rows) {
    if (!canQueryVendorBalance(row.id)) continue
    if (row.id === 'prov_doubao' && (!String(row.access_key || '').trim() || !String(row.secret_key || '').trim())) continue
    if (row.id !== 'prov_doubao' && !normalizeProviderKey(row.api_key)) continue
    try {
      await refreshVendorBalance(row)
    } catch (err) {
      console.warn('查询上游余额失败', row.id, err)
    }
  }
}

export function startVendorBalanceWatch(): void {
  const tick = () => {
    void pollVendorBalances()
  }
  setTimeout(tick, 8_000)
  setInterval(tick, 5 * 60_000)
}
