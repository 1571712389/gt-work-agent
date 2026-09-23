import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import type { ExpertMeta, ExpertTeamMeta } from './types'

export function loadExpertsFromDir(root: string): { experts: ExpertMeta[]; teams: ExpertTeamMeta[] } {
  const experts: ExpertMeta[] = []
  const teams: ExpertTeamMeta[] = []
  if (!fs.existsSync(root)) return { experts, teams }

  const expertDir = path.join(root, 'cards')
  const teamDir = path.join(root, 'teams')
  if (fs.existsSync(expertDir)) {
    for (const file of fs.readdirSync(expertDir)) {
      if (!file.endsWith('.md')) continue
      const parsed = matter(fs.readFileSync(path.join(expertDir, file), 'utf8'))
      experts.push({
        id: String(parsed.data.id || file.replace(/\.md$/, '')),
        name: String(parsed.data.name || file),
        title: String(parsed.data.title || ''),
        description: String(parsed.data.description || ''),
        methodology: String(parsed.data.methodology || ''),
        skillIds: Array.isArray(parsed.data.skillIds) ? parsed.data.skillIds.map(String) : [],
        systemPrompt: parsed.content.trim(),
      })
    }
  }
  if (fs.existsSync(teamDir)) {
    for (const file of fs.readdirSync(teamDir)) {
      if (!file.endsWith('.md') && !file.endsWith('.json')) continue
      if (file.endsWith('.json')) {
        const data = JSON.parse(fs.readFileSync(path.join(teamDir, file), 'utf8')) as ExpertTeamMeta
        teams.push(data)
        continue
      }
      const parsed = matter(fs.readFileSync(path.join(teamDir, file), 'utf8'))
      teams.push({
        id: String(parsed.data.id || file.replace(/\.md$/, '')),
        name: String(parsed.data.name || file),
        description: String(parsed.data.description || ''),
        leaderId: String(parsed.data.leaderId || ''),
        memberIds: Array.isArray(parsed.data.memberIds) ? parsed.data.memberIds.map(String) : [],
      })
    }
  }
  return { experts, teams }
}

export function expertExtraSystem(expert: ExpertMeta | undefined, team: ExpertTeamMeta | undefined): string {
  const parts: string[] = []
  if (expert) {
    parts.push(`以专家「${expert.name} · ${expert.title}」身份工作。${expert.systemPrompt}\n方法论：${expert.methodology}`)
  }
  if (team) {
    parts.push(`你是专家团「${team.name}」团长。先拆任务，用 Task 并行分给成员（${team.memberIds.join('、')}），再汇总。`)
  }
  return parts.join('\n')
}
