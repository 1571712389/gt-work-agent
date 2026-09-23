import './env'
import http from 'node:http'
import fs from 'node:fs'
import nodePath from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { seedIfEmpty } from './seed'
import {
  createSession,
  entitlements,
  grantPackage,
  hashPassword,
  publicPackage,
  userFromToken,
  verifyPassword,
  many,
  one,
  run,
  now,
  id,
  type PackageRow,
  type SessionUser,
} from './auth'
import { applyCoupon, createOrder, createRechargeOrder, creditTokens, markPaid, parseRechargeFen, rechargeQuote, refundOrder } from './billing'
import { proxyChat } from './gateway'
import { normalizeProviderKey } from './provider-key'
import { buildVendorMonitor, clearVendorBalanceCache, startVendorBalanceWatch, topUpUrlFor } from './provider-balance'
import { consumeSmsCode, isCnMobile, issueSmsCode, normalizePhone } from './sms'
import { consumeEmailCode, isEmail, isQqMailbox, issueEmailCode, normalizeEmail } from './mail'
import { approveDesktopAuth, pollDesktopAuth, startDesktopAuth } from './desktop-auth'
import { applySuggestedMultipliers, buildPricingReport, MODEL_CATALOG, quotaFromProfit, type ModelPricing, type ProfitMode } from './pricing'
import { getGeneration, listGenerations, quoteGeneration, startGeneration } from './generate'
import {
  deleteUserConnector,
  ensureConnectorTables,
  finishConnectorOAuth,
  getUserConnector,
  listOauthApps,
  listUserConnectors,
  publicConnectorCatalog,
  saveOauthApp,
  saveUserConnector,
  startConnectorOAuth,
} from './connectors'

seedIfEmpty()
ensureConnectorTables()

const PORT = Number(process.env.GT_API_PORT || 8787)
const HOST = process.env.GT_API_HOST || '127.0.0.1'
const SHOP = process.env.GT_SHOP_URL || `http://127.0.0.1:${PORT}`
const PUBLIC = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '../public')

function serveStatic(res: http.ServerResponse, filePath: string, contentType: string, extra: Record<string, string> = {}): boolean {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false
  res.writeHead(200, { 'Content-Type': contentType, ...CORS, ...extra })
  res.end(fs.readFileSync(filePath))
  return true
}
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Task-Id',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...CORS })
  res.end(JSON.stringify(body))
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function auth(req: http.IncomingMessage): SessionUser | null {
  return userFromToken(req.headers.authorization)
}

function requireUser(req: http.IncomingMessage, res: http.ServerResponse): SessionUser | null {
  const user = auth(req)
  if (!user) {
    json(res, 401, { error: { message: '请先登录' } })
    return null
  }
  return user
}

function requireAdmin(req: http.IncomingMessage, res: http.ServerResponse): SessionUser | null {
  const user = requireUser(req, res)
  if (!user) return null
  if (user.role !== 'admin') {
    json(res, 403, { error: { message: '需要管理员权限' } })
    return null
  }
  return user
}

function shopMailbox(res: http.ServerResponse, raw: unknown): string | null {
  const email = normalizeEmail(String(raw || ''))
  if (!isQqMailbox(email)) {
    json(res, 400, { error: { message: '当前验证码只发到 QQ 邮箱。请填写 QQ 号，将自动补全 @qq.com' } })
    return null
  }
  return email
}

function loadProfitConfig(): { mode: ProfitMode; value: number } {
  const mode = one<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', ['profit_mode'])?.value
  const value = one<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', ['profit_value'])?.value
  return {
    mode: mode === 'markup_x' ? 'markup_x' : 'margin_pct',
    value: Number(value) || 50,
  }
}

function saveProfitConfig(mode: ProfitMode, value: number): void {
  run(`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('profit_mode', ?)`, [mode])
  run(`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('profit_value', ?)`, [String(value)])
}

function loadPricingReport() {
  const paid = one<{ s: number }>('SELECT COALESCE(SUM(amount_fen),0) as s FROM orders WHERE status = ?', ['paid'])
  const tokens = one<{ s: number }>('SELECT COALESCE(SUM(billed_tokens),0) as s FROM usage_logs')
  const cost = one<{ s: number }>('SELECT COALESCE(SUM(cost_fen),0) as s FROM usage_logs')
  return buildPricingReport({
    packages: many<PackageRow>('SELECT * FROM packages ORDER BY sort'),
    models: many<ModelPricing>('SELECT * FROM models'),
    revenueFen: paid?.s || 0,
    costFen: cost?.s || 0,
    billedTokens: tokens?.s || 0,
    profitConfig: loadProfitConfig(),
  })
}

async function pipeFetch(res: http.ServerResponse, fr: Response, signal?: AbortSignal): Promise<void> {
  const headers: Record<string, string> = { ...CORS }
  fr.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'content-length') return
    headers[key] = value
  })
  res.writeHead(fr.status, headers)
  if (!fr.body) {
    res.end()
    return
  }
  const reader = fr.body.getReader()
  const stop = () => {
    void reader.cancel().catch(() => undefined)
  }
  signal?.addEventListener('abort', stop, { once: true })
  res.on('close', stop)
  try {
    while (!signal?.aborted && !res.writableEnded) {
      const { done, value } = await reader.read()
      if (done || signal?.aborted || res.writableEnded) break
      if (!res.write(Buffer.from(value))) {
        await new Promise((resolve) => res.once('drain', resolve))
      }
    }
  } catch {
    /* 客户端已断开 */
  } finally {
    signal?.removeEventListener('abort', stop)
    if (!res.writableEnded) res.end()
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const path = url.pathname
  const method = req.method || 'GET'
  if (method === 'OPTIONS') {
    res.writeHead(204, CORS)
    res.end()
    return
  }

  try {
    if (method === 'GET' && path === '/health') {
      json(res, 200, { ok: true })
      return
    }
    if (method === 'GET' && path === '/updates/latest.yml') {
      res.writeHead(200, { 'Content-Type': 'text/yaml; charset=utf-8', ...CORS })
      res.end(
        `version: 0.1.0\nfiles:\n  - url: 光途Work-Setup-0.1.0.exe\npath: 光途Work-Setup-0.1.0.exe\nsha512: pending\nreleaseDate: ${new Date().toISOString()}\n`,
      )
      return
    }
    if (method === 'GET') {
      const files: Record<string, [string, string]> = {
        '/': ['index.html', 'text/html; charset=utf-8'],
        '/index.html': ['index.html', 'text/html; charset=utf-8'],
        '/admin': ['admin.html', 'text/html; charset=utf-8'],
        '/admin.html': ['admin.html', 'text/html; charset=utf-8'],
        '/legal.html': ['legal.html', 'text/html; charset=utf-8'],
        '/terms.html': ['terms.html', 'text/html; charset=utf-8'],
        '/privacy.html': ['privacy.html', 'text/html; charset=utf-8'],
        '/site.css': ['site.css', 'text/css; charset=utf-8'],
        '/ops.css': ['ops.css', 'text/css; charset=utf-8'],
        '/robots.txt': ['robots.txt', 'text/plain; charset=utf-8'],
        '/logo.jpg': ['logo.jpg', 'image/jpeg'],
        '/vendor/chart.umd.min.js': ['vendor/chart.umd.min.js', 'application/javascript; charset=utf-8'],
      }
      const hit = files[path]
      if (hit) {
        const extra =
          hit[0] === 'admin.html'
            ? { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store, max-age=0' }
            : { 'Cache-Control': 'no-cache' }
        if (serveStatic(res, nodePath.join(PUBLIC, hit[0]), hit[1], extra)) return
      }
    }

    if (method === 'POST' && path === '/v1/auth/email/send') {
      const body = await readJson(req)
      const email = shopMailbox(res, body.email)
      if (!email) return
      const purpose = body.purpose === 'register' ? 'register' : body.purpose === 'reset' ? 'reset' : 'login'
      try {
        const sent = await issueEmailCode(email, purpose)
        json(res, 200, {
          ok: true,
          retryAfter: 60,
          mock: sent.mock || false,
          message: sent.mock ? '未配置邮箱 SMTP，验证码已写在 API 日志里（仅开发）。' : '验证码已发送到邮箱',
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        json(res, /频繁|上限/.test(message) ? 429 : 400, { error: { message } })
      }
      return
    }

    if (method === 'POST' && path === '/v1/auth/email/login') {
      const body = await readJson(req)
      const email = shopMailbox(res, body.email)
      if (!email) return
      if (!consumeEmailCode(email, 'login', String(body.code || ''))) {
        json(res, 401, { error: { message: '验证码无效或已过期' } })
        return
      }
      const user = one<{ id: string; email: string; name: string; phone: string | null; role: 'user' | 'admin'; status: string }>(
        'SELECT * FROM users WHERE email = ?',
        [email],
      )
      if (!user) {
        json(res, 404, { error: { message: '该邮箱尚未注册，请先注册' } })
        return
      }
      if (user.status !== 'active') {
        json(res, 403, { error: { message: '账号已被停用' } })
        return
      }
      json(res, 200, {
        token: createSession(user.id),
        user: { id: user.id, email: user.email, name: user.name, phone: user.phone, role: user.role },
      })
      return
    }

    if (method === 'POST' && path === '/v1/auth/email/register') {
      const body = await readJson(req)
      const email = shopMailbox(res, body.email)
      if (!email) return
      if (!consumeEmailCode(email, 'register', String(body.code || ''))) {
        json(res, 400, { error: { message: '请先获取并填写正确的邮箱验证码' } })
        return
      }
      if (one('SELECT id FROM users WHERE email = ?', [email])) {
        json(res, 409, { error: { message: '该邮箱已注册，请直接登录' } })
        return
      }
      const password = String(body.password || '')
      if (password.length < 6) {
        json(res, 400, { error: { message: '请设置至少 6 位登录密码' } })
        return
      }
      const userId = id('usr_')
      const name = String(body.name || '').trim() || email.split('@')[0] || '用户'
      run(
        `INSERT INTO users (id, email, name, password_hash, password_set, role, status, created_at) VALUES (?, ?, ?, ?, 1, 'user', 'active', ?)`,
        [userId, email, name, hashPassword(password), now()],
      )
      json(res, 201, {
        token: createSession(userId),
        user: { id: userId, email, name, role: 'user' },
      })
      return
    }

    if (method === 'POST' && path === '/v1/auth/sms/send') {
      const body = await readJson(req)
      const phone = normalizePhone(String(body.phone || ''))
      const purpose = body.purpose === 'register' ? 'register' : 'login'
      if (!isCnMobile(phone)) {
        json(res, 400, { error: { message: '请输入有效的中国大陆手机号' } })
        return
      }
      try {
        const sent = await issueSmsCode(phone, purpose)
        json(res, 200, {
          ok: true,
          retryAfter: 60,
          mock: sent.mock || false,
          message: sent.mock ? '未配置阿里云短信，验证码已写在 API 日志里（仅开发）。' : '验证码已发送',
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        json(res, /频繁|上限/.test(message) ? 429 : 400, { error: { message } })
      }
      return
    }

    if (method === 'POST' && path === '/v1/auth/sms/login') {
      const body = await readJson(req)
      const phone = normalizePhone(String(body.phone || ''))
      if (!isCnMobile(phone) || !consumeSmsCode(phone, 'login', String(body.code || ''))) {
        json(res, 401, { error: { message: '验证码无效或已过期' } })
        return
      }
      const user = one<{ id: string; email: string; name: string; phone: string; role: 'user' | 'admin'; status: string }>(
        'SELECT * FROM users WHERE phone = ?',
        [phone],
      )
      if (!user) {
        json(res, 404, { error: { message: '该手机号尚未注册，请先注册' } })
        return
      }
      if (user.status !== 'active') {
        json(res, 403, { error: { message: '账号已被停用' } })
        return
      }
      json(res, 200, {
        token: createSession(user.id),
        user: { id: user.id, email: user.email, name: user.name, phone: user.phone, role: user.role },
      })
      return
    }

    if (method === 'POST' && path === '/v1/auth/sms/register') {
      const body = await readJson(req)
      const phone = normalizePhone(String(body.phone || ''))
      if (!isCnMobile(phone)) {
        json(res, 400, { error: { message: '请输入有效的中国大陆手机号' } })
        return
      }
      if (!consumeSmsCode(phone, 'register', String(body.code || ''))) {
        json(res, 400, { error: { message: '请先获取并填写正确的短信验证码' } })
        return
      }
      if (one('SELECT id FROM users WHERE phone = ?', [phone])) {
        json(res, 409, { error: { message: '该手机号已注册，请直接登录' } })
        return
      }
      const userId = id('usr_')
      const name = String(body.name || '').trim() || `用户${phone.slice(-4)}`
      const email = `p${phone}@phone.local`
      run(
        `INSERT INTO users (id, email, name, phone, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, 'user', 'active', ?)`,
        [userId, email, name, phone, hashPassword(randomBytes(18).toString('hex')), now()],
      )
      json(res, 201, {
        token: createSession(userId),
        user: { id: userId, email, name, phone, role: 'user' },
      })
      return
    }

    if (method === 'POST' && path === '/v1/auth/register') {
      json(res, 400, { error: { message: '请前往官网使用邮箱验证码注册，并设置登录密码' } })
      return
    }

    if (method === 'POST' && path === '/v1/auth/login') {
      const body = await readJson(req)
      const typed = String(body.email || '').trim().toLowerCase()
      const staffEmails = ['admin', 'admin@local', 'admin@qq.com']
      const staffHit = staffEmails.includes(typed)
        ? one<{ email: string }>(
            'SELECT email FROM users WHERE role = ? AND email IN (?, ?, ?)',
            ['admin', ...staffEmails],
          )
        : null
      const rawEmail = staffHit?.email || normalizeEmail(typed)
      const existingRole = one<{ role: string }>('SELECT role FROM users WHERE email = ?', [rawEmail])
      const email = existingRole?.role === 'admin' ? rawEmail : shopMailbox(res, body.email)
      if (!email) return
      const user = one<{
        id: string
        email: string
        name: string
        password_hash: string
        password_set: number
        role: 'user' | 'admin'
        status: string
      }>('SELECT * FROM users WHERE email = ?', [email])
      if (!user || user.status !== 'active') {
        json(res, 401, { error: { message: '邮箱或密码错误' } })
        return
      }
      if (!user.password_set) {
        json(res, 400, { error: { message: '该账号尚未设置密码，请用邮箱验证码登录后在账户页设置' } })
        return
      }
      if (!verifyPassword(String(body.password || ''), user.password_hash)) {
        json(res, 401, { error: { message: '邮箱或密码错误' } })
        return
      }
      json(res, 200, {
        token: createSession(user.id),
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
      })
      return
    }

    if (method === 'POST' && path === '/v1/auth/forgot') {
      const body = await readJson(req)
      const email = shopMailbox(res, body.email)
      if (!email) return
      const user = one('SELECT id FROM users WHERE email = ?', [email])
      if (user) {
        try {
          const sent = await issueEmailCode(email, 'reset')
          json(res, 200, {
            ok: true,
            mock: sent.mock || false,
            message: sent.mock ? '未配置邮箱 SMTP，验证码已写在 API 日志里（仅开发）。' : '如果该邮箱已注册，验证码将在几分钟内送达',
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          json(res, /频繁|上限/.test(message) ? 429 : 400, { error: { message } })
        }
        return
      }
      json(res, 200, { ok: true, message: '如果该邮箱已注册，验证码将在几分钟内送达' })
      return
    }

    if (method === 'POST' && path === '/v1/auth/reset') {
      const body = await readJson(req)
      const email = shopMailbox(res, body.email)
      if (!email) return
      const password = String(body.password || '')
      if (!consumeEmailCode(email, 'reset', String(body.code || ''))) {
        json(res, 400, { error: { message: '验证码无效或已过期' } })
        return
      }
      if (password.length < 6) {
        json(res, 400, { error: { message: '请设置至少 6 位新密码' } })
        return
      }
      run(`UPDATE users SET password_hash = ?, password_set = 1 WHERE email = ?`, [hashPassword(password), email])
      json(res, 200, { ok: true })
      return
    }

    if (method === 'POST' && path === '/v1/auth/desktop/start') {
      const shop = process.env.GT_SHOP_URL || `http://${req.headers.host || '127.0.0.1:8787'}`
      json(res, 200, startDesktopAuth(shop))
      return
    }

    if (method === 'POST' && path === '/v1/auth/desktop/approve') {
      const user = requireUser(req, res)
      if (!user) return
      const body = await readJson(req)
      try {
        approveDesktopAuth(String(body.deviceId || ''), user.id)
        json(res, 200, { ok: true })
      } catch (err) {
        json(res, 400, { error: { message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (method === 'POST' && path === '/v1/auth/desktop/poll') {
      const body = await readJson(req)
      try {
        const result = pollDesktopAuth(String(body.deviceId || ''), String(body.userCode || ''))
        json(res, 200, result)
      } catch (err) {
        json(res, 400, { error: { message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (method === 'GET' && path === '/v1/connectors') {
      json(res, 200, { list: publicConnectorCatalog() })
      return
    }

    {
      const skillMatch = path.match(/^\/v1\/skills\/([^/]+)$/)
      if (method === 'GET' && skillMatch) {
        const skill = readPublicSkill(decodeURIComponent(skillMatch[1]))
        if (!skill) {
          json(res, 404, { error: { message: '技能不存在' } })
          return
        }
        json(res, 200, skill)
        return
      }
    }

    {
      const startMatch = path.match(/^\/v1\/connectors\/([^/]+)\/oauth\/start$/)
      if (method === 'POST' && startMatch) {
        const user = requireUser(req, res)
        if (!user) return
        const connectorId = decodeURIComponent(startMatch[1])
        const apiOrigin = process.env.GT_API_PUBLIC_URL || `http://${req.headers.host || '127.0.0.1:8787'}`
        json(res, 200, startConnectorOAuth(user.id, connectorId, apiOrigin))
        return
      }
      const cbMatch = path.match(/^\/v1\/connectors\/([^/]+)\/oauth\/callback$/)
      if (method === 'GET' && cbMatch) {
        const connectorId = decodeURIComponent(cbMatch[1])
        const code = url.searchParams.get('code') || url.searchParams.get('authCode') || ''
        const state = url.searchParams.get('state') || ''
        const apiOrigin = process.env.GT_API_PUBLIC_URL || `http://${req.headers.host || '127.0.0.1:8787'}`
        const done = (ok: boolean, message: string) => {
          const deep = `gtwork://oauth/connector?id=${encodeURIComponent(connectorId)}&ok=${ok ? '1' : '0'}`
          const safe = message.replace(/[&<>"']/g, (ch) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] || ch,
          )
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(`<!doctype html>
<meta charset="utf-8">
<title>光途Work 授权</title>
<p>${safe}</p>
<p>请回到桌面客户端，连接会自动完成。</p>
<script>location.replace(${JSON.stringify(deep)})</script>`)
        }
        try {
          await finishConnectorOAuth(connectorId, code, state, apiOrigin)
          done(true, '已完成授权，正在返回光途Work…')
        } catch (err) {
          done(false, err instanceof Error ? err.message : '授权失败')
        }
        return
      }
    }

    if (method === 'GET' && path === '/v1/me/connectors') {
      const user = requireUser(req, res)
      if (!user) return
      json(res, 200, { list: listUserConnectors(user.id, false) })
      return
    }

    {
      const meOne = path.match(/^\/v1\/me\/connectors\/([^/]+)$/)
      if (meOne) {
        const user = requireUser(req, res)
        if (!user) return
        const connectorId = decodeURIComponent(meOne[1])
        if (method === 'GET') {
          const row = getUserConnector(user.id, connectorId)
          if (!row) {
            json(res, 404, { error: { message: '尚未授权该连接器' } })
            return
          }
          json(res, 200, { connectorId, accessToken: row.access_token, refreshToken: row.refresh_token })
          return
        }
        if (method === 'DELETE') {
          deleteUserConnector(user.id, connectorId)
          json(res, 200, { ok: true })
          return
        }
      }
      const meToken = path.match(/^\/v1\/me\/connectors\/([^/]+)\/token$/)
      if (method === 'POST' && meToken) {
        const user = requireUser(req, res)
        if (!user) return
        const body = await readJson(req)
        const token = String(body.token || '').trim()
        if (!token) {
          json(res, 400, { error: { message: '请填写访问令牌' } })
          return
        }
        saveUserConnector(user.id, decodeURIComponent(meToken[1]), token)
        json(res, 200, { ok: true })
        return
      }
    }

    if (method === 'POST' && path === '/v1/me/password/code') {
      const user = requireUser(req, res)
      if (!user) return
      if (!isEmail(user.email)) {
        json(res, 400, { error: { message: '当前账号没有可用邮箱，无法发送验证码' } })
        return
      }
      try {
        const sent = await issueEmailCode(user.email, 'reset')
        json(res, 200, {
          ok: true,
          mock: sent.mock || false,
          message: sent.mock ? '未配置邮箱 SMTP，验证码已写在 API 日志里（仅开发）。' : '验证码已发送到邮箱',
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        json(res, /频繁|上限/.test(message) ? 429 : 400, { error: { message } })
      }
      return
    }

    if (method === 'POST' && path === '/v1/me/password') {
      const user = requireUser(req, res)
      if (!user) return
      const body = await readJson(req)
      const password = String(body.newPassword || body.password || '')
      if (password.length < 6) {
        json(res, 400, { error: { message: '请设置至少 6 位新密码' } })
        return
      }
      const current = String(body.currentPassword || '')
      const code = String(body.code || '')
      const row = one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [user.id])
      if (!row) {
        json(res, 404, { error: { message: '用户不存在' } })
        return
      }
      const byCode = Boolean(code) && consumeEmailCode(user.email, 'reset', code)
      const byCurrent = Boolean(current) && verifyPassword(current, row.password_hash)
      if (!byCode && !byCurrent) {
        json(res, 400, { error: { message: '请填写当前密码，或先获取邮箱验证码' } })
        return
      }
      run(`UPDATE users SET password_hash = ?, password_set = 1 WHERE id = ?`, [hashPassword(password), user.id])
      json(res, 200, { ok: true, passwordSet: true })
      return
    }

    if (method === 'GET' && path === '/v1/me') {
      const user = requireUser(req, res)
      if (!user) return
      json(res, 200, entitlements(user))
      return
    }

    if (method === 'GET' && path === '/v1/me/entitlements') {
      const user = requireUser(req, res)
      if (!user) return
      json(res, 200, entitlements(user))
      return
    }

    if (method === 'GET' && path === '/v1/tasks') {
      const user = requireUser(req, res)
      if (!user) return
      const rows = many<{ payload: string }>(
        'SELECT payload FROM client_tasks WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200',
        [user.id],
      )
      const list = rows.flatMap((row) => {
        try {
          return [JSON.parse(row.payload)]
        } catch {
          return []
        }
      })
      json(res, 200, { list })
      return
    }

    if (method === 'PUT' && path.match(/^\/v1\/tasks\/[^/]+$/)) {
      const user = requireUser(req, res)
      if (!user) return
      const taskId = decodeURIComponent(path.split('/')[3] || '')
      const body = await readJson(req)
      const payload = JSON.stringify({ ...body, id: taskId })
      if (payload.length > 1_500_000) {
        json(res, 413, { error: { message: '这条对话太长，暂时无法同步到账号' } })
        return
      }
      const existing = one<{ user_id: string }>('SELECT user_id FROM client_tasks WHERE id = ?', [taskId])
      if (existing && existing.user_id !== user.id) {
        json(res, 403, { error: { message: '不能修改别人的对话' } })
        return
      }
      const updatedAt = Number(body.updatedAt || now())
      run(
        `INSERT INTO client_tasks (id, user_id, payload, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
        [taskId, user.id, payload, updatedAt],
      )
      json(res, 200, { ok: true })
      return
    }

    if (method === 'DELETE' && path.match(/^\/v1\/tasks\/[^/]+$/)) {
      const user = requireUser(req, res)
      if (!user) return
      const taskId = decodeURIComponent(path.split('/')[3] || '')
      run('DELETE FROM client_tasks WHERE id = ? AND user_id = ?', [taskId, user.id])
      json(res, 200, { ok: true })
      return
    }

    if (method === 'GET' && path === '/v1/packages') {
      json(
        res,
        200,
        { list: many<PackageRow>('SELECT * FROM packages WHERE enabled = 1 ORDER BY sort').map(publicPackage) },
      )
      return
    }

    if (method === 'POST' && path === '/v1/recharge/preview') {
      const user = requireUser(req, res)
      if (!user) return
      const body = await readJson(req)
      try {
        const amountFen = parseRechargeFen(body.yuan)
        const quote = rechargeQuote(user.id, amountFen)
        json(res, 200, { amountFen: quote.amountFen, restorePercent: quote.restorePercent, hint: quote.hint })
      } catch (err) {
        json(res, 400, { error: { message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (method === 'POST' && path === '/v1/orders') {
      const user = requireUser(req, res)
      if (!user) return
      const body = await readJson(req)
      if (body.rechargeYuan != null && String(body.rechargeYuan) !== '') {
        try {
          const listFen = parseRechargeFen(body.rechargeYuan)
          const payFen = applyCoupon(body.coupon ? String(body.coupon) : undefined, listFen).amountFen
          const quote = rechargeQuote(user.id, listFen)
          const priced = { ...quote, amountFen: payFen }
          if (payFen === 0) {
            const orderId = createRechargeOrder(user.id, priced, String(body.payMethod || 'mock'))
            markPaid(orderId)
            json(res, 200, { id: orderId, status: 'paid', amountFen: 0 })
            return
          }
          const orderId = createRechargeOrder(user.id, priced, String(body.payMethod || 'mock'))
          json(res, 201, {
            id: orderId,
            status: 'pending',
            amountFen: payFen,
            payMethod: body.payMethod || 'mock',
            checkoutUrl: `${SHOP}/#/pay/${orderId}`,
          })
        } catch (err) {
          json(res, 400, { error: { message: err instanceof Error ? err.message : String(err) } })
        }
        return
      }
      const pkg = one<PackageRow>('SELECT * FROM packages WHERE id = ? AND enabled = 1', [String(body.packageId || '')])
      if (!pkg) {
        json(res, 404, { error: { message: '套餐不存在' } })
        return
      }
      if (pkg.price_fen === 0) {
        const claimed = one(
          `SELECT id FROM subscriptions WHERE user_id = ? AND package_id = ? LIMIT 1`,
          [user.id, pkg.id],
        )
        if (claimed) {
          json(res, 409, { error: { message: '已领取体验套餐' } })
          return
        }
        grantPackage(user.id, pkg)
        json(res, 200, { id: 'free', status: 'paid', amountFen: 0 })
        return
      }
      let amountFen = pkg.price_fen
      try {
        const applied = applyCoupon(body.coupon ? String(body.coupon) : undefined, pkg.price_fen)
        amountFen = applied.amountFen
      } catch (err) {
        json(res, 400, { error: { message: err instanceof Error ? err.message : String(err) } })
        return
      }
      if (amountFen === 0) {
        const orderId = createOrder(user.id, pkg, String(body.payMethod || 'mock'), 0)
        markPaid(orderId)
        json(res, 200, { id: orderId, status: 'paid', amountFen: 0 })
        return
      }
      const orderId = createOrder(user.id, pkg, String(body.payMethod || 'mock'), amountFen)
      json(res, 201, {
        id: orderId,
        status: 'pending',
        amountFen,
        payMethod: body.payMethod || 'mock',
        checkoutUrl: `${SHOP}/#/pay/${orderId}`,
      })
      return
    }

    if (method === 'POST' && path.match(/^\/v1\/orders\/[^/]+\/pay$/)) {
      const user = requireUser(req, res)
      if (!user) return
      const orderId = path.split('/')[3]
      const order = one<{ user_id: string; amount_fen: number }>('SELECT user_id, amount_fen FROM orders WHERE id = ?', [orderId])
      if (!order || (order.user_id !== user.id && user.role !== 'admin')) {
        json(res, 404, { error: { message: '订单不存在' } })
        return
      }
      const body = await readJson(req)
      const methodName = String(body.method || 'mock')
      if (methodName !== 'mock' && methodName !== 'alipay' && methodName !== 'wechat') {
        json(res, 400, { error: { message: '暂不支持该支付方式' } })
        return
      }
      markPaid(orderId)
      json(res, 200, { id: orderId, status: 'paid', note: '开发环境模拟支付已到账。生产请替换为支付宝/微信回调。' })
      return
    }

    if (method === 'GET' && path === '/v1/orders') {
      const user = requireUser(req, res)
      if (!user) return
      json(
        res,
        200,
        {
          list: many(
            `SELECT o.*, CASE WHEN o.credit_tokens > 0 THEN '自定义充值' ELSE p.name END as package_name
             FROM orders o JOIN packages p ON p.id = o.package_id WHERE o.user_id = ? ORDER BY o.created_at DESC`,
            [user.id],
          ),
        },
      )
      return
    }

    if (method === 'GET' && path === '/v1/usage') {
      const user = requireUser(req, res)
      if (!user) return
      json(
        res,
        200,
        {
          list: many<{ created_at: number; model: string }>(
            `SELECT created_at, model FROM usage_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`,
            [user.id],
          ),
          usagePercent: entitlements(user).subscription?.usagePercent ?? null,
        },
      )
      return
    }

    if (method === 'POST' && path === '/v1/invoices') {
      const user = requireUser(req, res)
      if (!user) return
      const body = await readJson(req)
      const invoiceId = id('inv_')
      run(
        `INSERT INTO invoices (id, user_id, order_id, title, tax_no, email, amount_fen, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [
          invoiceId,
          user.id,
          body.orderId ? String(body.orderId) : null,
          String(body.title || ''),
          String(body.taxNo || ''),
          String(body.email || user.email),
          Number(body.amountFen || 0),
          now(),
        ],
      )
      json(res, 201, { id: invoiceId, status: 'pending' })
      return
    }

    if (method === 'GET' && path === '/v1/invoices') {
      const user = requireUser(req, res)
      if (!user) return
      json(res, 200, { list: many(`SELECT * FROM invoices WHERE user_id = ? ORDER BY created_at DESC`, [user.id]) })
      return
    }

    if (method === 'GET' && path === '/v1/models') {
      const user = requireUser(req, res)
      if (!user) return
      json(res, 200, { data: entitlements(user).models })
      return
    }

    if (method === 'POST' && path === '/v1/chat/completions') {
      const user = requireUser(req, res)
      if (!user) return
      const body = await readJson(req)
      const ac = new AbortController()
      const stop = () => {
        if (!res.writableEnded) ac.abort()
      }
      res.on('close', stop)
      req.socket?.on('close', stop)
      try {
        const result = await proxyChat({
          user,
          body,
          taskId: String(req.headers['x-task-id'] || ''),
          signal: ac.signal,
        })
        await pipeFetch(res, result.response, ac.signal)
      } catch (err) {
        if (!ac.signal.aborted) throw err
      } finally {
        req.socket?.off('close', stop)
      }
      return
    }

    if (method === 'GET' && path === '/v1/generate/quote') {
      const user = requireUser(req, res)
      if (!user) return
      const result = quoteGeneration(user, {
        kind: url.searchParams.get('kind') || 'image',
        model: url.searchParams.get('model') || '',
        size: url.searchParams.get('size') || undefined,
        resolution: url.searchParams.get('resolution') || undefined,
        duration: url.searchParams.get('duration') ? Number(url.searchParams.get('duration')) : undefined,
      })
      json(res, result.status, result.body)
      return
    }

    if (method === 'GET' && path === '/v1/generate') {
      const user = requireUser(req, res)
      if (!user) return
      const result = listGenerations(user, Number(url.searchParams.get('limit') || 30))
      json(res, result.status, result.body)
      return
    }

    if (method === 'POST' && path === '/v1/generate') {
      const user = requireUser(req, res)
      if (!user) return
      const body = await readJson(req)
      const result = await startGeneration(user, {
        kind: String(body.kind || 'image'),
        model: String(body.model || ''),
        prompt: String(body.prompt || ''),
        size: body.size ? String(body.size) : undefined,
        resolution: body.resolution ? String(body.resolution) : undefined,
        duration: body.duration != null ? Number(body.duration) : undefined,
        ratio: body.ratio ? String(body.ratio) : undefined,
        image: body.image ? String(body.image) : undefined,
      })
      json(res, result.status, result.body)
      return
    }

    if (method === 'GET' && path.match(/^\/v1\/generate\/[^/]+$/)) {
      const user = requireUser(req, res)
      if (!user) return
      const result = await getGeneration(user, path.split('/')[3])
      json(res, result.status, result.body)
      return
    }

    if (method === 'GET' && path === '/v1/admin/overview') {
      const admin = requireAdmin(req, res)
      if (!admin) return
      const users = one<{ c: number }>('SELECT COUNT(*) as c FROM users')
      const report = loadPricingReport()
      json(res, 200, {
        users: users?.c || 0,
        revenueFen: report.realized.revenueFen,
        billedTokens: report.realized.billedTokens,
        costFen: report.realized.costFen,
        marginFen: report.realized.marginFen,
        marginPct: report.realized.marginPct,
        marginNote: report.note,
      })
      return
    }

    if (method === 'GET' && path === '/v1/admin/pricing') {
      if (!requireAdmin(req, res)) return
      json(res, 200, loadPricingReport())
      return
    }

    if (method === 'POST' && path === '/v1/admin/pricing/profit-config') {
      if (!requireAdmin(req, res)) return
      const body = await readJson(req)
      const mode: ProfitMode = body.mode === 'markup_x' ? 'markup_x' : 'margin_pct'
      const value = mode === 'markup_x' ? Math.max(1.05, Number(body.value) || 3) : Math.min(90, Math.max(0, Number(body.value) || 50))
      saveProfitConfig(mode, value)
      const apply = body.apply !== false
      const changed: Array<{ id: string; quota: number }> = []
      if (apply) {
        const report = loadPricingReport()
        const mix = report.baseOfficial?.mixFenPerM || 0
        for (const pkg of many<PackageRow>('SELECT * FROM packages')) {
          if (pkg.price_fen <= 0) continue
          const quota = quotaFromProfit(pkg.price_fen, mix, mode, value)
          if (quota <= 0) continue
          const daily = pkg.daily_quota > 0 && pkg.token_quota > 0
            ? Math.max(0, Math.round((pkg.daily_quota * quota) / pkg.token_quota))
            : pkg.daily_quota
          run(`UPDATE packages SET token_quota = ?, daily_quota = ? WHERE id = ?`, [quota, daily, pkg.id])
          changed.push({ id: pkg.id, quota })
        }
      }
      json(res, 200, { ok: true, mode, value, changed, report: loadPricingReport() })
      return
    }

    if (method === 'POST' && path === '/v1/admin/pricing/sync-catalog') {
      if (!requireAdmin(req, res)) return
      for (const item of MODEL_CATALOG) {
        run(
          `UPDATE models SET input_fen_per_m = ?, output_fen_per_m = ?, cache_hit_fen_per_m = ?, display_name = COALESCE(NULLIF(display_name, ''), ?), kind = ?, unit_fen = ?, upstream_model = ? WHERE id = ?`,
          [item.input, item.output, item.cacheHit, item.displayName, item.kind || 'chat', item.unitFen || 0, item.upstreamModel, item.id],
        )
      }
      json(res, 200, { ok: true, updated: MODEL_CATALOG.length })
      return
    }

    if (method === 'POST' && path === '/v1/admin/pricing/sync-multipliers') {
      if (!requireAdmin(req, res)) return
      const models = many<ModelPricing>('SELECT * FROM models')
      const rows = applySuggestedMultipliers(models)
      for (const row of rows) {
        run(`UPDATE models SET multiplier = ? WHERE id = ?`, [row.multiplier, row.id])
      }
      json(res, 200, { ok: true, list: rows })
      return
    }

    if (method === 'POST' && path === '/v1/admin/providers') {
      if (!requireAdmin(req, res)) return
      const body = await readJson(req)
      const pid = String(body.id || id('prov_'))
      if (one('SELECT id FROM providers WHERE id = ?', [pid])) {
        json(res, 409, { error: '供应商已存在' })
        return
      }
      run(`INSERT INTO providers (id, name, base_url, api_key, enabled, priority) VALUES (?, ?, ?, ?, 1, ?)`, [
        pid,
        String(body.name || pid),
        String(body.base_url || ''),
        normalizeProviderKey(String(body.api_key || '')),
        Number(body.priority || 50),
      ])
      json(res, 201, { id: pid })
      return
    }

    if (method === 'POST' && path === '/v1/admin/models') {
      if (!requireAdmin(req, res)) return
      const body = await readJson(req)
      const mid = String(body.id || '').trim()
      if (!mid) {
        json(res, 400, { error: '需要模型 ID' })
        return
      }
      if (one('SELECT id FROM models WHERE id = ?', [mid])) {
        json(res, 409, { error: '模型已存在' })
        return
      }
      const providerId = String(body.provider_id || '')
      if (!one('SELECT id FROM providers WHERE id = ?', [providerId])) {
        json(res, 400, { error: '供应商不存在' })
        return
      }
      const inputFen = Math.max(0, Math.round(Number(body.input_fen_per_m || 0)))
      const outputFen = Math.max(0, Math.round(Number(body.output_fen_per_m || 0)))
      const cacheFen = Math.max(0, Math.round(Number(body.cache_hit_fen_per_m || 0)))
      const draft: ModelPricing = {
        id: mid,
        provider_id: providerId,
        display_name: String(body.display_name || mid),
        multiplier: 1,
        enabled: 1,
        input_fen_per_m: inputFen,
        output_fen_per_m: outputFen,
        cache_hit_fen_per_m: cacheFen,
      }
      const models = many<ModelPricing>('SELECT * FROM models')
      const suggested = applySuggestedMultipliers([...models, draft]).find((r) => r.id === mid)?.multiplier || 1
      const multiplier = body.multiplier != null ? Number(body.multiplier) : suggested
      run(
        `INSERT INTO models (id, provider_id, upstream_model, display_name, tools, multiplier, enabled, fallback_model_id, input_fen_per_m, output_fen_per_m, cache_hit_fen_per_m)
         VALUES (?, ?, ?, ?, 1, ?, 1, ?, ?, ?, ?)`,
        [
          mid,
          providerId,
          String(body.upstream_model || mid),
          draft.display_name,
          multiplier,
          body.fallback_model_id ? String(body.fallback_model_id) : null,
          inputFen,
          outputFen,
          cacheFen,
        ],
      )
      json(res, 201, { id: mid, multiplier })
      return
    }

    if (method === 'PUT' && path.match(/^\/v1\/admin\/models\/[^/]+$/)) {
      if (!requireAdmin(req, res)) return
      const modelId = path.split('/')[4]
      const body = await readJson(req)
      const existing = one<{ id: string }>('SELECT id FROM models WHERE id = ?', [modelId])
      if (!existing) {
        json(res, 404, { error: '模型不存在' })
        return
      }
      run(
        `UPDATE models SET display_name = COALESCE(?, display_name), multiplier = COALESCE(?, multiplier),
          input_fen_per_m = COALESCE(?, input_fen_per_m), output_fen_per_m = COALESCE(?, output_fen_per_m),
          cache_hit_fen_per_m = COALESCE(?, cache_hit_fen_per_m), enabled = COALESCE(?, enabled),
          upstream_model = COALESCE(?, upstream_model) WHERE id = ?`,
        [
          body.display_name != null ? String(body.display_name) : null,
          body.multiplier != null ? Number(body.multiplier) : null,
          body.input_fen_per_m != null ? Math.max(0, Math.round(Number(body.input_fen_per_m))) : null,
          body.output_fen_per_m != null ? Math.max(0, Math.round(Number(body.output_fen_per_m))) : null,
          body.cache_hit_fen_per_m != null ? Math.max(0, Math.round(Number(body.cache_hit_fen_per_m))) : null,
          body.enabled === undefined ? null : body.enabled ? 1 : 0,
          body.upstream_model != null && String(body.upstream_model).trim() ? String(body.upstream_model).trim() : null,
          modelId,
        ],
      )
      json(res, 200, { ok: true })
      return
    }

    if (method === 'GET' && path === '/v1/admin/users') {
      if (!requireAdmin(req, res)) return
      json(res, 200, { list: many(`SELECT id, email, phone, name, role, status, created_at FROM users ORDER BY created_at DESC`) })
      return
    }

    if (method === 'POST' && path.match(/^\/v1\/admin\/users\/[^/]+\/ban$/)) {
      if (!requireAdmin(req, res)) return
      run(`UPDATE users SET status = 'disabled' WHERE id = ?`, [path.split('/')[4]])
      json(res, 200, { ok: true })
      return
    }

    if (method === 'GET' && path === '/v1/admin/packages') {
      if (!requireAdmin(req, res)) return
      json(res, 200, { list: many<PackageRow>('SELECT * FROM packages ORDER BY sort') })
      return
    }

    if (method === 'PUT' && path.match(/^\/v1\/admin\/packages\/[^/]+$/)) {
      if (!requireAdmin(req, res)) return
      const pkgId = path.split('/')[4]
      const body = await readJson(req)
      run(
        `UPDATE packages SET name=?, description=?, price_fen=?, period_days=?, token_quota=?, models_json=?, allow_mcp=?, allow_team=?, seats=?, enabled=? WHERE id=?`,
        [
          String(body.name || ''),
          String(body.description || ''),
          Number(body.price_fen || 0),
          Number(body.period_days || 30),
          Number(body.token_quota || 0),
          JSON.stringify(body.models || ['deepseek-chat']),
          body.allow_mcp ? 1 : 0,
          body.allow_team ? 1 : 0,
          Number(body.seats || 1),
          body.enabled === false ? 0 : 1,
          pkgId,
        ],
      )
      json(res, 200, { ok: true })
      return
    }

    if (method === 'GET' && path === '/v1/admin/connector-apps') {
      if (!requireAdmin(req, res)) return
      const apiOrigin = process.env.GT_API_PUBLIC_URL || `http://${req.headers.host || '127.0.0.1:8787'}`
      json(res, 200, { list: listOauthApps(apiOrigin) })
      return
    }

    if (method === 'PUT' && path === '/v1/admin/connector-apps') {
      if (!requireAdmin(req, res)) return
      const body = await readJson(req)
      const connectorId = String(body.id || '')
      try {
        saveOauthApp(connectorId, String(body.clientId || ''), body.clientSecret == null ? undefined : String(body.clientSecret))
      } catch (err) {
        json(res, 400, { error: err instanceof Error ? err.message : '保存失败' })
        return
      }
      json(res, 200, { ok: true })
      return
    }

    if (method === 'GET' && path === '/v1/admin/providers') {
      if (!requireAdmin(req, res)) return
      json(
        res,
        200,
        {
          list: many(`SELECT id, name, base_url, enabled, priority, CASE WHEN trim(api_key) = '' THEN 0 ELSE 1 END as has_key FROM providers`).map(
            (p: { id: string; name: string; base_url: string; enabled: number; priority: number; has_key: number }) => ({
              ...p,
              top_up_url: topUpUrlFor(p.id),
              can_query_balance: p.id === 'prov_deepseek',
            }),
          ),
          models: many(`SELECT * FROM models`),
        },
      )
      return
    }

    if (method === 'GET' && path === '/v1/admin/vendor-monitor') {
      if (!requireAdmin(req, res)) return
      json(res, 200, await buildVendorMonitor({ refresh: url.searchParams.get('refresh') === '1' }))
      return
    }

    if (method === 'PUT' && path.match(/^\/v1\/admin\/providers\/[^/]+$/)) {
      if (!requireAdmin(req, res)) return
      const pid = path.split('/')[4]
      const body = await readJson(req)
      if (body.api_key !== undefined) {
        run(`UPDATE providers SET api_key = ?, base_url = COALESCE(?, base_url), enabled = COALESCE(?, enabled) WHERE id = ?`, [
          String(body.api_key).trim() ? normalizeProviderKey(String(body.api_key)) : '',
          body.base_url ? String(body.base_url) : null,
          body.enabled === undefined ? null : body.enabled ? 1 : 0,
          pid,
        ])
        clearVendorBalanceCache(pid)
      } else {
        run(`UPDATE providers SET base_url = COALESCE(?, base_url), enabled = COALESCE(?, enabled) WHERE id = ?`, [
          body.base_url ? String(body.base_url) : null,
          body.enabled === undefined ? null : body.enabled ? 1 : 0,
          pid,
        ])
      }
      json(res, 200, { ok: true })
      return
    }

    if (method === 'GET' && path === '/v1/admin/usage') {
      if (!requireAdmin(req, res)) return
      json(res, 200, { list: many(`SELECT * FROM usage_logs ORDER BY created_at DESC LIMIT 300`) })
      return
    }

    if (method === 'GET' && path === '/v1/admin/orders') {
      if (!requireAdmin(req, res)) return
      json(res, 200, { list: many(`SELECT * FROM orders ORDER BY created_at DESC LIMIT 200`) })
      return
    }

    if (method === 'POST' && path.match(/^\/v1\/admin\/users\/[^/]+\/grant$/)) {
      if (!requireAdmin(req, res)) return
      const uid = path.split('/')[4]
      const body = await readJson(req)
      const pkg = one<PackageRow>('SELECT * FROM packages WHERE id = ?', [String(body.packageId || '')])
      if (!pkg) {
        json(res, 404, { error: { message: '套餐不存在' } })
        return
      }
      grantPackage(uid, pkg)
      json(res, 200, { ok: true })
      return
    }

    if (method === 'POST' && path.match(/^\/v1\/admin\/users\/[^/]+\/credit$/)) {
      if (!requireAdmin(req, res)) return
      const uid = path.split('/')[4]
      const body = await readJson(req)
      const remaining = creditTokens(uid, Number(body.delta || 0))
      json(res, 200, { ok: true, remaining })
      return
    }

    if (method === 'POST' && path.match(/^\/v1\/admin\/orders\/[^/]+\/refund$/)) {
      if (!requireAdmin(req, res)) return
      refundOrder(path.split('/')[4])
      json(res, 200, { ok: true })
      return
    }

    if (method === 'GET' && path === '/v1/admin/invoices') {
      if (!requireAdmin(req, res)) return
      json(res, 200, { list: many(`SELECT * FROM invoices ORDER BY created_at DESC LIMIT 200`) })
      return
    }

    if (method === 'POST' && path.match(/^\/v1\/admin\/invoices\/[^/]+\/issue$/)) {
      if (!requireAdmin(req, res)) return
      run(`UPDATE invoices SET status = 'issued' WHERE id = ?`, [path.split('/')[4]])
      json(res, 200, { ok: true })
      return
    }

    if (method === 'GET' && path === '/v1/admin/coupons') {
      if (!requireAdmin(req, res)) return
      json(res, 200, { list: many(`SELECT * FROM coupons ORDER BY code`) })
      return
    }

    if (method === 'POST' && path === '/v1/admin/coupons') {
      if (!requireAdmin(req, res)) return
      const body = await readJson(req)
      const cid = id('cpn_')
      run(`INSERT INTO coupons (id, code, percent_off, expires_at, enabled) VALUES (?, ?, ?, ?, 1)`, [
        cid,
        String(body.code || '').trim().toUpperCase(),
        Number(body.percentOff || 0),
        body.expiresAt ? Number(body.expiresAt) : null,
      ])
      json(res, 201, { id: cid })
      return
    }

    if (method === 'POST' && path === '/v1/admin/packages') {
      if (!requireAdmin(req, res)) return
      const body = await readJson(req)
      const pkgId = id('pkg_')
      run(
        `INSERT INTO packages (id, slug, name, description, price_fen, period_days, token_quota, daily_quota, models_json, skill_ids_json, max_concurrency, allow_mcp, allow_team, seats, sort, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          pkgId,
          String(body.slug || pkgId),
          String(body.name || '新套餐'),
          String(body.description || ''),
          Number(body.price_fen || 0),
          Number(body.period_days || 30),
          Number(body.token_quota || 0),
          Number(body.daily_quota || 0),
          JSON.stringify(body.models || ['deepseek-chat']),
          JSON.stringify(body.skills || ['*']),
          Number(body.max_concurrency || 1),
          body.allow_mcp ? 1 : 0,
          body.allow_team ? 1 : 0,
          Number(body.seats || 1),
          Number(body.sort || 99),
        ],
      )
      json(res, 201, { id: pkgId })
      return
    }

    json(res, 404, { error: { message: 'not found' } })
  } catch (err) {
    json(res, 500, { error: { message: err instanceof Error ? err.message : String(err) } })
  }
})

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用，说明 API 已经在运行：http://127.0.0.1:${PORT}`)
    console.error('不必再执行一次 npm run api。若要重启，先关掉旧终端，或结束占用该端口的进程。')
    process.exit(1)
  }
  console.error(err)
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  console.log(`光途Work API http://${HOST}:${PORT}`)
  console.log('工作人员账号 admin，密码来自 GT_ADMIN_PASSWORD')
  startVendorBalanceWatch()
})
