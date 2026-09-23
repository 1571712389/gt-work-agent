import type { SkillInfo } from '@shared/protocol'

const INSTALLED_KEY = 'gt.installedSkills'

export function readInstalledIds(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(INSTALLED_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((id) => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function markInstalled(id: string, on: boolean): string[] {
  const next = new Set(readInstalledIds())
  if (on) next.add(id)
  else next.delete(id)
  const list = [...next]
  try {
    localStorage.setItem(INSTALLED_KEY, JSON.stringify(list))
  } catch {
    /* ignore quota */
  }
  return list
}

export function withInstalledFlag(skills: SkillInfo[]): SkillInfo[] {
  const extra = new Set(readInstalledIds())
  return skills.map((skill) => ({
    ...skill,
    installed:
      Boolean(skill.installed) ||
      extra.has(skill.id) ||
      skill.source === 'custom' ||
      skill.tags.includes('custom'),
  }))
}
