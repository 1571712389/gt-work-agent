import { many, one, run, now } from './db'
import { mixFenPerMillion, BASE_MODEL_ID, type ModelPricing } from './pricing'
import { normalizeProviderKey } from './provider-key'

export interface VendorAccount {
  id: string
  name: string
  base_url: string
  api_key: string
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

export async function fetchVendorBalance(provider: VendorAccount): Promise<VendorBalance> {
  const topUpUrl = topUpUrlFor(provider.id)
  const key = normalizeProviderKey(provider.api_key)
  if (!key) return { supported: false, topUpUrl, error: '未配置 Key', checkedAt: now() }
  if (provider.id !== 'prov_deepseek') {
    return { supported: false, topUpUrl, error: '该厂商未开放余额查询接口', checkedAt: now() }
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

export async function refreshVendorBalance(provider: VendorAccount): Promise<VendorBalance> {
  const balance = await fetchVendorBalance(provider)
  cacheVendorBalance(provider.id, balance)
  return balance
}

export function markVendorEmpty(provider: VendorAccount): void {
  const prev = readCachedVendorBalance(provider.id)
  cacheVendorBalance(provider.id, {
    supported: provider.id === 'prov_deepseek',
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
    `SELECT id, name, base_url, api_key, enabled FROM providers ORDER BY priority, id`,
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
    let balance = readCachedVendorBalance(provider.id)
    if (hasKey && provider.id === 'prov_deepseek' && needsLiveBalance(balance, opts.refresh)) {
      balance = await refreshVendorBalance(provider)
    }
    if (!balance) {
      balance = {
        supported: provider.id === 'prov_deepseek',
        topUpUrl: topUpUrlFor(provider.id),
        error: hasKey ? (provider.id === 'prov_deepseek' ? '尚未查询' : '该厂商未开放余额查询接口') : '未配置 Key',
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
      canQueryBalance: provider.id === 'prov_deepseek',
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
    `SELECT id, name, base_url, api_key FROM providers WHERE enabled = 1 AND trim(api_key) != ''`,
  )
  for (const row of rows) {
    if (row.id !== 'prov_deepseek') continue
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
