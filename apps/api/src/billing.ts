import { activeSub, one, run, now, id, QUOTA_EXHAUSTED_MESSAGE, type PackageRow } from './auth'
import { grantPackage } from './auth'

const RECHARGE_MIN_FEN = 100
const RECHARGE_MAX_FEN = 1_000_000

export function applyCoupon(code: string | undefined, amountFen: number): { amountFen: number; coupon?: string } {
  if (!code) return { amountFen }
  const c = one<{ code: string; percent_off: number; expires_at: number | null; enabled: number }>(
    'SELECT * FROM coupons WHERE code = ? AND enabled = 1',
    [code.trim().toUpperCase()],
  )
  if (!c) throw new Error('优惠码无效')
  if (c.expires_at && c.expires_at < now()) throw new Error('优惠码已过期')
  return { amountFen: Math.max(0, Math.round((amountFen * (100 - c.percent_off)) / 100)), coupon: c.code }
}

export function createOrder(userId: string, pkg: PackageRow, payMethod: string, amountFen?: number) {
  const orderId = id('ord_')
  run(
    `INSERT INTO orders (id, user_id, package_id, amount_fen, status, pay_method, created_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    [orderId, userId, pkg.id, amountFen ?? pkg.price_fen, payMethod, now()],
  )
  return orderId
}

export function parseRechargeFen(yuan: unknown): number {
  const n = Number(yuan)
  if (!Number.isFinite(n)) throw new Error('请输入充值金额')
  const fen = Math.round(n * 100)
  if (fen < RECHARGE_MIN_FEN || fen > RECHARGE_MAX_FEN) throw new Error('充值金额需在 1 元到 10000 元之间')
  return fen
}

export function rechargeQuote(userId: string, amountFen: number): {
  amountFen: number
  credit: number
  packageId: string
  packageName: string
  restorePercent: number
  hint: string
} {
  const sub = activeSub(userId)
  if (!sub) throw new Error('请先领取体验版或购买套餐，再充值额度。')
  const rate =
    sub.pkg.price_fen > 0 && sub.pkg.token_quota > 0
      ? sub.pkg
      : one<PackageRow>(
          `SELECT * FROM packages WHERE enabled = 1 AND price_fen > 0 AND token_quota > 0 ORDER BY price_fen ASC, sort ASC LIMIT 1`,
        )
  if (!rate) throw new Error('暂时不能充值，请稍后再试。')
  const credit = Math.max(1, Math.round((amountFen * rate.token_quota) / rate.price_fen))
  const restorePercent = Math.min(100, Math.max(1, Math.round((credit / rate.token_quota) * 100)))
  return {
    amountFen,
    credit,
    packageId: rate.id,
    packageName: rate.name,
    restorePercent,
    hint: `按${rate.name}单价补充，大约补回 ${restorePercent}% 额度。当前套餐和到期日不变。`,
  }
}

export function createRechargeOrder(userId: string, quote: { packageId: string; amountFen: number; credit: number }, payMethod: string) {
  const orderId = id('ord_')
  run(
    `INSERT INTO orders (id, user_id, package_id, amount_fen, status, pay_method, created_at, credit_tokens)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [orderId, userId, quote.packageId, quote.amountFen, payMethod, now(), quote.credit],
  )
  return orderId
}

export function markPaid(orderId: string): void {
  const order = one<{ user_id: string; package_id: string; status: string; credit_tokens: number }>(
    'SELECT user_id, package_id, status, credit_tokens FROM orders WHERE id = ?',
    [orderId],
  )
  if (!order) throw new Error('订单不存在')
  if (order.status === 'paid') return
  run(`UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ?`, [now(), orderId])
  if (order.credit_tokens > 0) {
    creditTokens(order.user_id, order.credit_tokens)
    return
  }
  const pkg = one<PackageRow>('SELECT * FROM packages WHERE id = ?', [order.package_id])
  if (!pkg) throw new Error('套餐不存在')
  grantPackage(order.user_id, pkg)
}

export function refundOrder(orderId: string): void {
  const order = one<{ status: string; user_id: string }>('SELECT status, user_id FROM orders WHERE id = ?', [orderId])
  if (!order) throw new Error('订单不存在')
  if (order.status !== 'paid') throw new Error('只能退已支付订单')
  run(`UPDATE orders SET status = 'refunded' WHERE id = ?`, [orderId])
  run(`UPDATE subscriptions SET status = 'expired' WHERE user_id = ? AND status = 'active'`, [order.user_id])
}

export function creditTokens(userId: string, delta: number): number {
  const sub = one<{ id: string; tokens_remaining: number }>(
    `SELECT id, tokens_remaining FROM subscriptions WHERE user_id = ? AND status = 'active' AND expires_at > ? ORDER BY expires_at DESC LIMIT 1`,
    [userId, now()],
  )
  if (!sub) throw new Error('没有有效套餐，无法调额')
  const next = Math.max(0, sub.tokens_remaining + delta)
  run(`UPDATE subscriptions SET tokens_remaining = ? WHERE id = ?`, [next, sub.id])
  return next
}

export function todayUsed(userId: string): number {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const row = one<{ s: number }>(
    `SELECT COALESCE(SUM(billed_tokens),0) as s FROM usage_logs WHERE user_id = ? AND created_at >= ?`,
    [userId, start.getTime()],
  )
  return row?.s || 0
}

export function deductTokens(userId: string, billed: number, usage: {
  model: string
  providerId?: string
  prompt: number
  completion: number
  total: number
  costFen: number
  taskId?: string
}): { remaining: number } {
  const sub = one<{ id: string; tokens_remaining: number }>(
    `SELECT id, tokens_remaining FROM subscriptions WHERE user_id = ? AND status = 'active' AND expires_at > ? ORDER BY expires_at DESC LIMIT 1`,
    [userId, now()],
  )
  if (!sub) throw new Error('没有有效套餐')
  if (sub.tokens_remaining < billed) throw new Error(QUOTA_EXHAUSTED_MESSAGE)
  run(
    `UPDATE subscriptions SET tokens_remaining = tokens_remaining - ?, tokens_used = tokens_used + ? WHERE id = ?`,
    [billed, billed, sub.id],
  )
  run(
    `INSERT INTO usage_logs (id, user_id, model, provider_id, prompt_tokens, completion_tokens, total_tokens, billed_tokens, cost_fen, task_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id('use_'),
      userId,
      usage.model,
      usage.providerId || null,
      usage.prompt,
      usage.completion,
      usage.total,
      billed,
      usage.costFen,
      usage.taskId || null,
      now(),
    ],
  )
  return { remaining: sub.tokens_remaining - billed }
}
