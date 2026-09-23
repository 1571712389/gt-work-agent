import { Sparkles, Plug, X } from 'lucide-react'
import { useApp } from '../lib/store'
import ExpertAvatar, { TeamAvatars } from './ExpertAvatar'

export default function ContextBar() {
  const current = useApp((s) => s.tasks.find((t) => t.id === s.currentId) || null)
  const skills = useApp((s) => s.skills)
  const experts = useApp((s) => s.experts)
  const teams = useApp((s) => s.teams)
  const mcp = useApp((s) => s.mcp)
  const setView = useApp((s) => s.setView)
  const expert = experts.find((item) => item.id === current?.selectedExpert)
  const team = teams.find((item) => item.id === current?.selectedTeam)
  const selected = skills.filter((skill) => current?.selectedSkills.includes(skill.id))
  const connected = mcp.filter((item) => item.approved && !item.disabled)
  const empty = !selected.length && !expert && !team

  const patch = async (next: Partial<typeof current>) => {
    if (!current) return
    const row = await window.gt.tasks.patch(current.id, next)
    if (row) useApp.getState().upsertTask(row)
  }

  return (
    <div className="mb-2 rounded-xl border border-line bg-ink px-3 py-2">
      <div className="mb-1.5 text-[11px] text-muted">当前对话将使用</div>
      {empty ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>还没选技能或专家。输入 / 选择已下载技能，或去市场下载。</span>
          <button
            type="button"
            className="text-primary transition-colors duration-200 hover:text-accent"
            onClick={() => setView('skills')}
          >
            去下载技能
          </button>
          <button
            type="button"
            className="text-primary transition-colors duration-200 hover:text-accent"
            onClick={() => setView('experts')}
          >
            去专家市场
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {expert && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-white py-0.5 pl-0.5 pr-2 text-[11px] text-primary">
              <ExpertAvatar id={expert.id} name={expert.name} size={18} />
              {expert.name}
              <button
                type="button"
                aria-label={`移除专家 ${expert.name}`}
                className="text-muted hover:text-text"
                onClick={() => void patch({ selectedExpert: null })}
              >
                <X size={11} />
              </button>
            </span>
          )}
          {team && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-white py-0.5 pl-1 pr-2 text-[11px] text-accent">
              <TeamAvatars
                memberIds={team.memberIds}
                names={Object.fromEntries(experts.map((item) => [item.id, item.name]))}
                size={16}
              />
              {team.name}
              <button
                type="button"
                aria-label={`移除专家团 ${team.name}`}
                className="text-muted hover:text-text"
                onClick={() => void patch({ selectedTeam: null })}
              >
                <X size={11} />
              </button>
            </span>
          )}
          {selected.map((skill) => (
            <span
              key={skill.id}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2 py-0.5 text-[11px]"
            >
              <Sparkles size={11} className="text-primary" />
              {skill.name}
              <button
                type="button"
                aria-label={`移除技能 ${skill.name}`}
                className="text-muted hover:text-text"
                onClick={() =>
                  void patch({ selectedSkills: current!.selectedSkills.filter((id) => id !== skill.id) })
                }
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <button
        type="button"
        className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted transition-colors duration-200 hover:text-primary"
        onClick={() => setView('mcp')}
      >
        <Plug size={11} />
        {connected.length ? `已连接 ${connected.length} 个连接器` : '未启用连接器 · 去市场添加'}
      </button>
    </div>
  )
}
