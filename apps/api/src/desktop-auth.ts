import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createSession, one, run, now, id } from './auth'

const SECRET = process.env.GT_API_SECRET || 'gt-workbench-dev-secret'
const TTL_MS = 10 * 60_000

function hashSecret(value: string): string {
  return createHmac('sha256', SECRET).update(`desktop:${value}`).digest('hex')
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function startDesktopAuth(shopUrl: string) {
  const deviceId = id('dsk_')
  const userCode = randomBytes(24).toString('base64url')
  run(
    `INSERT INTO desktop_auths (id, user_code_hash, status, created_at, expires_at) VALUES (?, ?, 'pending', ?, ?)`,
    [deviceId, hashSecret(userCode), now(), now() + TTL_MS],
  )
  const shop = shopUrl.replace(/\/+$/, '')
  return {
    deviceId,
    userCode,
    expiresIn: Math.floor(TTL_MS / 1000),
    interval: 2,
    verifyUrl: `${shop}/#/authorize/${deviceId}`,
  }
}

export function approveDesktopAuth(deviceId: string, userId: string): void {
  const row = one<{ status: string; expires_at: number }>(
    `SELECT status, expires_at FROM desktop_auths WHERE id = ?`,
    [deviceId],
  )
  if (!row) throw new Error('授权请求不存在')
  if (row.expires_at < now() || row.status === 'expired') {
    run(`UPDATE desktop_auths SET status = 'expired' WHERE id = ?`, [deviceId])
    throw new Error('授权已过期，请回到客户端重试')
  }
  if (row.status !== 'pending') throw new Error('该授权请求已处理')
  const token = createSession(userId)
  run(
    `UPDATE desktop_auths SET status = 'approved', user_id = ?, session_token = ?, approved_at = ? WHERE id = ?`,
    [userId, token, now(), deviceId],
  )
}

export function pollDesktopAuth(deviceId: string, userCode: string): { status: string; token?: string } {
  const row = one<{ user_code_hash: string; status: string; expires_at: number; session_token: string | null }>(
    `SELECT user_code_hash, status, expires_at, session_token FROM desktop_auths WHERE id = ?`,
    [deviceId],
  )
  if (!row || !sameHash(row.user_code_hash, hashSecret(userCode))) {
    throw new Error('授权请求无效')
  }
  if (row.expires_at < now() && row.status === 'pending') {
    run(`UPDATE desktop_auths SET status = 'expired' WHERE id = ?`, [deviceId])
    return { status: 'expired' }
  }
  if (row.status === 'pending') return { status: 'pending' }
  if (row.status === 'approved' && row.session_token) {
    run(`UPDATE desktop_auths SET session_token = NULL WHERE id = ?`, [deviceId])
    return { status: 'approved', token: row.session_token }
  }
  if (row.status === 'approved') return { status: 'consumed' }
  return { status: row.status }
}
