import type { LucideIcon } from 'lucide-react'
import { firstGlyph, MCP_ICONS, SKILL_ICONS, toneFor } from '../lib/catalog-icons'

export default function ItemMark({
  id,
  name,
  kind,
}: {
  id: string
  name: string
  kind: 'skill' | 'mcp'
}) {
  const Icon: LucideIcon | undefined = kind === 'skill' ? SKILL_ICONS[id] : MCP_ICONS[id]
  const tone = toneFor(id || name)
  return (
    <span
      aria-hidden
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold ${tone}`}
    >
      {Icon ? <Icon size={18} strokeWidth={1.75} /> : firstGlyph(name)}
    </span>
  )
}
