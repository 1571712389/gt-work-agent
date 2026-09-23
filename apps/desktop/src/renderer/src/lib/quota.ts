import type { Entitlements } from '@shared/protocol'

export const QUOTA_HINT = '账户额度已用完，对话、创作和连接已暂停。请到官网充值，回来后在账户页点「刷新额度」。'

export function quotaExhausted(entitlements: Entitlements | null | undefined): boolean {
  const sub = entitlements?.subscription
  if (!sub || sub.expiresAt < Date.now()) return false
  return (sub.usagePercent ?? 0) >= 100
}
