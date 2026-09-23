import { useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import { useApp } from '../lib/store'
import { ensureCurrentTask, goChat, notify } from '../lib/market'
import PageShell from '../components/PageShell'
import ExpertAvatar, { TeamAvatars } from '../components/ExpertAvatar'

export default function ExpertsPage() {
  const experts = useApp((s) => s.experts)
  const teams = useApp((s) => s.teams)
  const skills = useApp((s) => s.skills)
  const entitlements = useApp((s) => s.entitlements)
  const current = useApp((s) => s.tasks.find((t) => t.id === s.currentId))
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'experts' | 'teams'>('experts')
  const [tag, setTag] = useState('all')
  const teamLocked = Boolean(entitlements) && !entitlements?.subscription?.allowTeam
  const skillName = (id: string) => skills.find((item) => item.id === id)?.name || id
  const expertNames = useMemo(
    () => Object.fromEntries(experts.map((item) => [item.id, item.name])),
    [experts],
  )

  const titles = useMemo(() => Array.from(new Set(experts.map((item) => item.title))), [experts])

  const filteredExperts = useMemo(
    () =>
      experts.filter((item) => {
        const hit =
          !q.trim() ||
          item.name.includes(q) ||
          item.title.includes(q) ||
          item.description.includes(q)
        const tagHit = tag === 'all' || item.title === tag || item.skillIds.some((id) => skillName(id).includes(tag))
        return hit && tagHit
      }),
    [experts, q, tag, skills],
  )

  const filteredTeams = useMemo(
    () => teams.filter((item) => !q.trim() || item.name.includes(q) || item.description.includes(q)),
    [teams, q],
  )

  const pickExpert = async (expertId: string, expertName: string) => {
    const task = await ensureCurrentTask()
    const off = task.selectedExpert === expertId
    const next = await window.gt.tasks.patch(task.id, { selectedExpert: off ? null : expertId })
    if (next) useApp.getState().upsertTask(next)
    notify(off ? `已取消专家「${expertName}」` : `已召唤「${expertName}」，对话将按该人设工作`, off ? 'info' : 'ok', goChat)
  }

  const pickTeam = async (teamId: string, teamName: string) => {
    const task = await ensureCurrentTask()
    const off = task.selectedTeam === teamId
    const next = await window.gt.tasks.patch(task.id, { selectedTeam: off ? null : teamId })
    if (next) useApp.getState().upsertTask(next)
    notify(off ? `已解散专家团「${teamName}」` : `已组建「${teamName}」，发送后会拆任务并行`, off ? 'info' : 'ok', goChat)
  }

  return (
    <PageShell title="专家市场" subtitle="点选后立即出现在对话框上方。再点一次取消。专家团会拆解并用 Task 并行。">
      <div className="flex flex-wrap items-center gap-6 border-b border-line">
        <button
          type="button"
          className={`-mb-px border-b-2 pb-2 text-sm transition-colors duration-200 ${
            tab === 'experts' ? 'border-primary font-semibold text-text' : 'border-transparent text-muted hover:text-text'
          }`}
          onClick={() => setTab('experts')}
        >
          专家
        </button>
        <button
          type="button"
          className={`-mb-px border-b-2 pb-2 text-sm transition-colors duration-200 ${
            tab === 'teams' ? 'border-primary font-semibold text-text' : 'border-transparent text-muted hover:text-text'
          }`}
          onClick={() => setTab('teams')}
        >
          专家团
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          className="gt-input w-64"
          placeholder={tab === 'experts' ? '搜索专家' : '搜索专家团'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={tab === 'experts' ? '搜索专家' : '搜索专家团'}
        />
        {tab === 'experts' && (
          <>
            <button
              type="button"
              onClick={() => setTag('all')}
              className={`rounded-full px-3 py-1 text-xs transition-colors duration-200 ${
                tag === 'all' ? 'bg-primary text-white' : 'bg-raised text-muted hover:text-text'
              }`}
            >
              全部
            </button>
            {titles.map((item) => (
              <button
                type="button"
                key={item}
                onClick={() => setTag(item)}
                className={`rounded-full px-3 py-1 text-xs transition-colors duration-200 ${
                  tag === item ? 'bg-primary text-white' : 'bg-raised text-muted hover:text-text'
                }`}
              >
                {item}
              </button>
            ))}
          </>
        )}
      </div>

      {tab === 'experts' ? (
        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredExperts.map((expert) => {
            const on = current?.selectedExpert === expert.id
            return (
              <button
                key={expert.id}
                aria-pressed={on}
                onClick={() => void pickExpert(expert.id, expert.name)}
                className={`rounded-2xl border p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors duration-200 ${
                  on ? 'border-primary bg-primary/5' : 'border-line bg-panel hover:border-primary/50'
                }`}
              >
                <div className="flex items-start gap-3">
                  <ExpertAvatar id={expert.id} name={expert.name} size={52} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{expert.name}</div>
                        <div className="mt-0.5 text-xs text-muted">{expert.title}</div>
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-primary">
                        {on && <Check size={12} />}
                        {on ? '使用中' : '召唤'}
                      </span>
                    </div>
                    <div className="mt-2 line-clamp-2 text-xs text-muted">{expert.description}</div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {expert.skillIds.slice(0, 3).map((id) => (
                        <span key={id} className="rounded-md bg-raised px-2 py-0.5 text-[11px] text-muted">
                          {skillName(id)}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      ) : (
        <>
          {teamLocked && <p className="mt-4 text-xs text-warn">专家团需要团队套餐。点账户页升级后解锁。</p>}
          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filteredTeams.map((team) => {
              const on = current?.selectedTeam === team.id
              return (
                <button
                  key={team.id}
                  disabled={teamLocked}
                  aria-pressed={on}
                  onClick={() => void pickTeam(team.id, team.name)}
                  className={`rounded-2xl border p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors duration-200 ${
                    teamLocked
                      ? 'cursor-not-allowed opacity-50'
                      : on
                        ? 'border-primary bg-primary/5'
                        : 'border-line bg-panel hover:border-primary/50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <TeamAvatars memberIds={team.memberIds} names={expertNames} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="truncate font-medium">{team.name}</div>
                        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-primary">
                          {on && <Check size={12} />}
                          {on ? '使用中' : '组团'}
                        </span>
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs text-muted">{team.description}</div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {team.memberIds.map((id) => (
                          <span key={id} className="rounded-md bg-raised px-2 py-0.5 text-[11px] text-muted">
                            {expertNames[id] || id}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}
    </PageShell>
  )
}
