import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function skillsRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, '../../../packages/skills'),
    path.resolve(process.cwd(), '../../packages/skills'),
  ]
  return candidates.find((dir) => fs.existsSync(dir)) || candidates[0]
}

function parseSkill(raw: string, fallbackId: string) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  const fm = match?.[1] || ''
  const body = (match?.[2] || raw).trim()
  const grab = (key: string) =>
    fm.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '') || ''
  return {
    id: grab('id') || fallbackId,
    name: grab('name') || fallbackId,
    description: grab('description') || '',
    body,
  }
}

export function readPublicSkill(id: string) {
  const safe = id.replace(/[^\w-]/g, '')
  if (!safe) return null
  const file = path.join(skillsRoot(), safe, 'SKILL.md')
  if (!fs.existsSync(file)) return null
  return parseSkill(fs.readFileSync(file, 'utf8'), safe)
}
