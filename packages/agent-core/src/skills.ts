import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import type { SkillMeta } from './types'

export function loadSkillsFromDir(root: string): SkillMeta[] {
  if (!fs.existsSync(root)) return []
  const out: SkillMeta[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(abs)
        continue
      }
      if (entry.name.toLowerCase() !== 'skill.md') continue
      const raw = fs.readFileSync(abs, 'utf8')
      const parsed = matter(raw)
      const id = String(parsed.data.id || path.basename(path.dirname(abs)))
      out.push({
        id,
        name: String(parsed.data.name || id),
        description: String(parsed.data.description || ''),
        tags: Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String) : [],
        body: parsed.content.trim(),
        path: abs,
      })
    }
  }
  walk(root)
  return out.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}
