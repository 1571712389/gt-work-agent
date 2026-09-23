import type { Entitlements } from '@shared/protocol'

export const QUOTA_HINT = '账户额度已用完，对话、创作和连接已暂停。请到官网充值，回来后在账户页点「刷新额度」。'
export const NO_QUOTA_HINT = '当前账号还没有额度，对话、创作和连接已暂停。请到官网充值后再使用。'

export function quotaExhausted(entitlements: Entitlements | null | undefined): boolean {
  if (!entitlements?.user) return false
  const sub = entitlements.subscription
  if (!sub || sub.expiresAt < Date.now()) return true
  return (sub.usagePercent ?? 0) >= 100
}

export function quotaHint(entitlements: Entitlements | null | undefined): string {
  const sub = entitlements?.subscription
  if (!sub || sub.expiresAt < Date.now()) return NO_QUOTA_HINT
  return QUOTA_HINT
}
