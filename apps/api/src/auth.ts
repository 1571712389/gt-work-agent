import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto'
import { many, one, run, now, id } from './db'
import { CATALOG_BY_ID } from './pricing'

const SECRET = process.env.GT_API_SECRET || 'gt-workbench-dev-secret'

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 32).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const next = scryptSync(password, salt, 32)
  const prev = Buffer.from(hash, 'hex')
  return prev.length === next.length && timingSafeEqual(prev, next)
}

export function signSession(userId: string): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, n: randomBytes(8).toString('hex') })).toString('base64url')
  const sig = createHmac('sha256', SECRET).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export interface UserRow {
  id: string
  email: string
  name: string
  phone?: string | null
  password_hash: string
  password_set?: number
  role: 'user' | 'admin'
  status: string
}

export interface SessionUser {
  id: string
  email: string
  name: string
  phone?: string | null
  role: 'user' | 'admin'
  passwordSet: boolean
}

export function createSession(userId: string, days = 30): string {
  const token = signSession(userId)
  run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', [
    token,
    userId,
    now() + days * 86400_000,
  ])
  return token
}

export function userFromToken(header?: string | null): SessionUser | null {
  const token = header?.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const row = one<{ user_id: string; expires_at: number }>('SELECT user_id, expires_at FROM sessions WHERE token = ?', [token])
  if (!row || row.expires_at < now()) return null
  const user = one<UserRow>('SELECT * FROM users WHERE id = ? AND status = ?', [row.user_id, 'active'])
  if (!user) return null
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone || null,
    role: user.role,
    passwordSet: user.password_set !== 0,
  }
}

export interface PackageRow {
  id: string
  slug: string
  name: string
  description: string
  price_fen: number
  period_days: number
  token_quota: number
  daily_quota: number
  models_json: string
  skill_ids_json: string
  max_concurrency: number
  allow_mcp: number
  allow_team: number
  seats: number
  sort: number
  enabled: number
}

export interface SubRow {
  id: string
  user_id: string
  package_id: string
  status: string
  started_at: number
  expires_at: number
  tokens_remaining: number
  tokens_used: number
}

export function activeSub(userId: string): (SubRow & { pkg: PackageRow }) | null {
  const sub = one<SubRow>(
    `SELECT * FROM subscriptions WHERE user_id = ? AND status = 'active' AND expires_at > ? ORDER BY expires_at DESC LIMIT 1`,
    [userId, now()],
  )
  if (!sub) return null
  const pkg = one<PackageRow>('SELECT * FROM packages WHERE id = ?', [sub.package_id])
  if (!pkg) return null
  return { ...sub, pkg }
}

export function grantPackage(userId: string, pkg: PackageRow): string {
  run(`UPDATE subscriptions SET status = 'expired' WHERE user_id = ? AND status = 'active'`, [userId])
  const subId = id('sub_')
  const started = now()
  run(
    `INSERT INTO subscriptions (id, user_id, package_id, status, started_at, expires_at, tokens_remaining, tokens_used)
     VALUES (?, ?, ?, 'active', ?, ?, ?, 0)`,
    [subId, userId, pkg.id, started, started + pkg.period_days * 86400_000, pkg.token_quota],
  )
  return subId
}

export function usagePercent(remaining: number, quota: number): number {
  if (!quota || quota <= 0) return remaining > 0 ? 0 : 100
  return Math.max(0, Math.min(100, Math.round(((quota - remaining) / quota) * 100)))
}

export const QUOTA_EXHAUSTED_MESSAGE = '账户额度已用完，请到官网充值后再使用。'

export function quotaExhausted(remaining: number, quota: number): boolean {
  return usagePercent(remaining, quota) >= 100
}

export function publicPackage(p: PackageRow) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    priceFen: p.price_fen,
    periodDays: p.period_days,
    models: JSON.parse(p.models_json) as string[],
    skills: JSON.parse(p.skill_ids_json) as string[],
    maxConcurrency: p.max_concurrency,
    allowMcp: Boolean(p.allow_mcp),
    allowTeam: Boolean(p.allow_team),
    seats: p.seats,
  }
}

export function entitlements(user: SessionUser) {
  const sub = activeSub(user.id)
  const pkg = sub?.pkg
  const models = pkg
    ? many<{ id: string; display_name: string; tools: number; enabled: number; provider_name: string }>(
        `SELECT m.id, m.display_name, m.tools, m.enabled, COALESCE(p.name, '') AS provider_name
         FROM models m LEFT JOIN providers p ON p.id = m.provider_id WHERE m.enabled = 1`,
      ).filter((m) => (JSON.parse(pkg.models_json) as string[]).includes(m.id) || (JSON.parse(pkg.models_json) as string[]).includes('*'))
    : []
  return {
    user,
    shopUrl: process.env.GT_SHOP_URL || 'http://127.0.0.1:8787',
    subscription: sub
      ? {
          packageId: pkg!.id,
          packageName: pkg!.name,
          packageSlug: pkg!.slug,
          expiresAt: sub.expires_at,
          usagePercent: usagePercent(sub.tokens_remaining, pkg!.token_quota),
          allowMcp: Boolean(pkg!.allow_mcp),
          allowTeam: Boolean(pkg!.allow_team),
          skills: JSON.parse(pkg!.skill_ids_json) as string[],
          seats: pkg!.seats,
        }
      : null,
    claimedPackageIds: many<{ package_id: string }>(
      `SELECT DISTINCT package_id FROM subscriptions WHERE user_id = ?`,
      [user.id],
    ).map((r) => r.package_id),
    models: models.map((m) => {
      const cat = CATALOG_BY_ID.get(m.id)
      return {
        id: m.id,
        name: m.display_name,
        tools: Boolean(m.tools),
        vision: Boolean(cat?.vision),
        kind: cat?.kind || 'chat',
        sizes: cat?.sizes || [],
        resolutions: cat?.resolutions || [],
        durations: cat?.durations || [],
        ratios: cat?.ratios || [],
        provider: cat?.providerName || m.provider_name || '其他',
      }
    }),
  }
}

export { many, one, run, now, id }
