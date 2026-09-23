import './env'
import { createHmac, randomInt } from 'node:crypto'
import { many, one, run, now, id } from './db'

const SECRET = process.env.GT_API_SECRET || 'gt-workbench-dev-secret'

export function normalizePhone(input: string): string {
  const digits = String(input || '').replace(/\D/g, '')
  if (digits.startsWith('86') && digits.length === 13) return digits.slice(2)
  return digits
}

export function isCnMobile(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone)
}

function hashCode(phone: string, code: string): string {
  return createHmac('sha256', SECRET).update(`${phone}:${code}`).digest('hex')
}

export function smsConfigured(): boolean {
  return Boolean(
    process.env.ALIYUN_SMS_ACCESS_KEY_ID &&
      process.env.ALIYUN_SMS_ACCESS_KEY_SECRET &&
      process.env.ALIYUN_SMS_SIGN_NAME &&
      process.env.ALIYUN_SMS_TEMPLATE_CODE,
  )
}

function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(/\+/g, '%20').replace(/\*/g, '%2A').replace(/%7E/g, '~')
}

async function sendAliyunSms(phone: string, code: string): Promise<void> {
  const accessKeyId = process.env.ALIYUN_SMS_ACCESS_KEY_ID || ''
  const accessKeySecret = process.env.ALIYUN_SMS_ACCESS_KEY_SECRET || ''
  const signName = process.env.ALIYUN_SMS_SIGN_NAME || ''
  const templateCode = process.env.ALIYUN_SMS_TEMPLATE_CODE || ''
  const paramName = process.env.ALIYUN_SMS_TEMPLATE_PARAM || 'code'
  const params: Record<string, string> = {
    AccessKeyId: accessKeyId,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: phone,
    RegionId: process.env.ALIYUN_SMS_REGION || 'cn-hangzhou',
    SignName: signName,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: `${Date.now()}-${randomInt(1e9)}`,
    SignatureVersion: '1.0',
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify({ [paramName]: code }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2017-05-25',
  }
  const canonical = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&')
  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonical)}`
  const signature = createHmac('sha1', `${accessKeySecret}&`).update(stringToSign).digest('base64')
  const url = `https://dysmsapi.aliyuncs.com/?${canonical}&Signature=${percentEncode(signature)}`
  const res = await fetch(url)
  const data = (await res.json()) as { Code?: string; Message?: string }
  if (data.Code !== 'OK') {
    throw new Error(data.Message || `短信发送失败（${data.Code || res.status}）`)
  }
}

export async function issueSmsCode(phone: string, purpose: 'login' | 'register'): Promise<{ mock?: boolean }> {
  const recent = one<{ sent_at: number }>(
    `SELECT sent_at FROM sms_codes WHERE phone = ? ORDER BY sent_at DESC LIMIT 1`,
    [phone],
  )
  if (recent && now() - recent.sent_at < 60_000) {
    throw new Error('验证码发送过于频繁，请 60 秒后再试')
  }
  const dayAgo = now() - 24 * 60 * 60_000
  const daily = one<{ c: number }>(`SELECT COUNT(*) as c FROM sms_codes WHERE phone = ? AND sent_at > ?`, [phone, dayAgo])
  if ((daily?.c || 0) >= 10) {
    throw new Error('今日发送次数已达上限')
  }
  const code = String(randomInt(100000, 1000000))
  run(
    `INSERT INTO sms_codes (id, phone, purpose, code_hash, expires_at, sent_at, attempts, consumed) VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
    [id('sms_'), phone, purpose, hashCode(phone, code), now() + 5 * 60_000, now()],
  )
  if (smsConfigured()) {
    await sendAliyunSms(phone, code)
    return {}
  }
  if (process.env.GT_SMS_ALLOW_MOCK === '0') {
    throw new Error('尚未配置阿里云短信，无法发送验证码')
  }
  console.warn(`[sms mock] ${phone} ${purpose} code=${code}`)
  return { mock: true }
}

export function consumeSmsCode(phone: string, purpose: 'login' | 'register', code: string): boolean {
  const row = one<{ id: string; code_hash: string; expires_at: number; attempts: number; consumed: number }>(
    `SELECT id, code_hash, expires_at, attempts, consumed FROM sms_codes WHERE phone = ? AND purpose = ? ORDER BY sent_at DESC LIMIT 1`,
    [phone, purpose],
  )
  if (!row || row.consumed || row.expires_at < now()) return false
  if (row.attempts >= 5) return false
  run(`UPDATE sms_codes SET attempts = attempts + 1 WHERE id = ?`, [row.id])
  if (row.code_hash !== hashCode(phone, String(code || '').trim())) return false
  run(`UPDATE sms_codes SET consumed = 1 WHERE id = ?`, [row.id])
  return true
}
