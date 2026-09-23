/** 后台粘贴时可能带上 Key、Bearer、引号等前缀，发给厂商前先清掉。 */
export function normalizeProviderKey(raw: string): string {
  let s = String(raw || '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
  s = s.replace(/^bearer\s+/i, '').trim()
  s = s.replace(/^["'`]+|["'`]+$/g, '').trim()
  s = s.replace(/^(?:api[_-\s]?key|secret[_-\s]?key|access[_-\s]?key|token)\s*[:=]?\s*/i, '').trim()
  s = s.replace(/^["'`]+|["'`]+$/g, '').trim()
  const sk = s.match(/sk-[A-Za-z0-9._-]{8,}/)
  if (sk) return sk[0]
  return s
}
