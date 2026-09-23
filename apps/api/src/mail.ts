import './env'
import { createHmac, randomInt } from 'node:crypto'
import { one, run, now, id } from './db'
import { sendSmtpMail } from './smtp'

const SECRET = process.env.GT_API_SECRET || 'gt-workbench-dev-secret'

export function completeQqEmail(input: string): string {
  let value = String(input || '').trim().toLowerCase().replace(/\s+/g, '')
  if (!value) return value
  if (!value.includes('@')) return `${value}@qq.com`
  if (value.endsWith('@')) return `${value}qq.com`
  return value
}

export function normalizeEmail(input: string): string {
  return completeQqEmail(input)
}

export function isEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.endsWith('@phone.local')
}

export function isQqMailbox(email: string): boolean {
  return isEmail(email) && email.endsWith('@qq.com')
}

function hashCode(email: string, code: string): string {
  return createHmac('sha256', SECRET).update(`email:${email}:${code}`).digest('hex')
}

export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && (process.env.SMTP_FROM || process.env.SMTP_USER))
}

export type EmailPurpose = 'login' | 'register' | 'reset'

export async function issueEmailCode(email: string, purpose: EmailPurpose): Promise<{ mock?: boolean }> {
  const recent = one<{ sent_at: number }>(
    `SELECT sent_at FROM email_codes WHERE email = ? ORDER BY sent_at DESC LIMIT 1`,
    [email],
  )
  if (recent && now() - recent.sent_at < 60_000) {
    throw new Error('验证码发送过于频繁，请 60 秒后再试')
  }
  const dayAgo = now() - 24 * 60 * 60_000
  const daily = one<{ c: number }>(`SELECT COUNT(*) as c FROM email_codes WHERE email = ? AND sent_at > ?`, [email, dayAgo])
  if ((daily?.c || 0) >= 10) {
    throw new Error('今日发送次数已达上限')
  }
  const code = String(randomInt(100000, 1000000))
  run(
    `INSERT INTO email_codes (id, email, purpose, code_hash, expires_at, sent_at, attempts, consumed) VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
    [id('eml_'), email, purpose, hashCode(email, code), now() + 5 * 60_000, now()],
  )
  if (mailConfigured()) {
    await sendSmtpMail({
      to: email,
      subject: '光途Work 验证码',
      text: `您的验证码是 ${code}，5 分钟内有效。如非本人操作请忽略。`,
    })
    return {}
  }
  if (process.env.GT_MAIL_ALLOW_MOCK === '0') {
    throw new Error('尚未配置邮箱 SMTP，无法发送验证码')
  }
  console.warn(`[mail mock] ${email} ${purpose} code=${code}`)
  return { mock: true }
}

export function consumeEmailCode(email: string, purpose: EmailPurpose, code: string): boolean {
  const row = one<{ id: string; code_hash: string; expires_at: number; attempts: number; consumed: number }>(
    `SELECT id, code_hash, expires_at, attempts, consumed FROM email_codes WHERE email = ? AND purpose = ? ORDER BY sent_at DESC LIMIT 1`,
    [email, purpose],
  )
  if (!row || row.consumed || row.expires_at < now()) return false
  if (row.attempts >= 5) return false
  run(`UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?`, [row.id])
  if (row.code_hash !== hashCode(email, String(code || '').trim())) return false
  run(`UPDATE email_codes SET consumed = 1 WHERE id = ?`, [row.id])
  return true
}
