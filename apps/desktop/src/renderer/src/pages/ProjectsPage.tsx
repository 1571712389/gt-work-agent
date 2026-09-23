import { useMemo, useState } from 'react'
import { FolderKanban, FolderOpen, Pencil, Plus, Trash2 } from 'lucide-react'
import { MCP_MARKET } from '@shared/mcp-market'
import type { ProjectInfo } from '@shared/protocol'
import { useApp } from '../lib/store'
import { goChat, notify } from '../lib/market'
import { toneFor } from '../lib/catalog-icons'
import PageShell from '../components/PageShell'

type Draft = {
  id: string | null
  name: string
  instruction: string
  workspace: string
  skillIds: string[]
  expertId: string
  mcpIds: string[]
}

const emptyDraft = (): Draft => ({
  id: null,
  name: '',
  instruction: '',
  workspace: '',
  skillIds: [],
  expertId: '',
  mcpIds: [],
})

function ProjectMark({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${toneFor(name)}`}
    >
      <FolderKanban size={18} strokeWidth={1.75} />
    </span>
  )
}

function Chip({
  on,
  label,
  onClick,
}: {
  on: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`cursor-pointer rounded-full px-2.5 py-1 text-[11px] transition-colors duration-200 ${
        on ? 'bg-primary text-white' : 'bg-raised text-muted hover:text-text'
      }`}
    >
      {label}
    </button>
  )
}

export default function ProjectsPage() {
  const projects = useApp((s) => s.projects)
  const skills = useApp((s) => s.skills)
  const experts = useApp((s) => s.experts)
  const mcp = useApp((s) => s.mcp)
  const [q, setQ] = useState('')
  const [openForm, setOpenForm] = useState(false)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const key = q.trim()
    if (!key) return projects
    return projects.filter(
      (p) => p.name.includes(key) || p.workspace.includes(key) || p.instruction.includes(key),
    )
  }, [projects, q])

  const skillName = (id: string) => skills.find((s) => s.id === id)?.name || id
  const expertName = (id: string) => experts.find((e) => e.id === id)?.name || id
  const mcpName = (id: string) => MCP_MARKET.find((m) => m.id === id)?.name || id

  const persist = async (list: ProjectInfo[]) => {
    const next = await window.gt.projects.save(list)
    useApp.setState({ projects: next })
    return next
  }

  const startCreate = () => {
    setDraft(emptyDraft())
    setOpenForm(true)
  }

  const startEdit = (p: ProjectInfo) => {
    setDraft({
      id: p.id,
      name: p.name,
      instruction: p.instruction,
      workspace: p.workspace,
      skillIds: p.skillIds,
      expertId: p.expertIds[0] || '',
      mcpIds: p.mcpIds,
    })
    setOpenForm(true)
  }

  const pickDir = async () => {
    const dir = await window.gt.settings.pickDir()
    if (dir) setDraft((d) => ({ ...d, workspace: dir, name: d.name || dir.split(/[/\\]/).pop() || '' }))
  }

  const saveDraft = async () => {
    const name = draft.name.trim()
    if (!name) {
      notify('请填写项目名称', 'warn')
      return
    }
    if (!draft.workspace) {
      notify('请选择工作目录', 'warn')
      return
    }
    setSaving(true)
    try {
      const row: ProjectInfo = {
        id: draft.id || crypto.randomUUID(),
        name,
        workspace: draft.workspace,
        instruction: draft.instruction.trim(),
        skillIds: draft.skillIds,
        expertIds: draft.expertId ? [draft.expertId] : [],
        mcpIds: draft.mcpIds,
      }
      const list = draft.id ? projects.map((p) => (p.id === draft.id ? row : p)) : [...projects, row]
      await persist(list)
      setOpenForm(false)
      setDraft(emptyDraft())
      notify(draft.id ? `已更新项目「${name}」` : `已保存项目「${name}」`, 'ok')
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'warn')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (p: ProjectInfo) => {
    if (!window.confirm(`删除项目「${p.name}」？工作目录里的文件不会被删除。`)) return
    await persist(projects.filter((row) => row.id !== p.id))
    if (draft.id === p.id) {
      setOpenForm(false)
      setDraft(emptyDraft())
    }
    notify(`已删除项目「${p.name}」`, 'info')
  }

  const openTask = async (p: ProjectInfo) => {
    setBusyId(p.id)
    try {
      const task = await window.gt.tasks.create({
        title: `${p.name} · 任务`,
        mode: 'craft',
        workspace: p.workspace,
        selectedSkills: p.skillIds,
        selectedExpert: p.expertIds[0] || null,
        instruction: p.instruction,
      })
      useApp.getState().upsertTask(task)
      useApp.getState().setView('workbench')
      notify(`已在「${p.name}」新建任务`, 'ok', goChat)
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'warn')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <PageShell title="项目空间" subtitle="把指令、技能、专家绑到一个工作目录。之后新建任务会直接套用，不用每次重选。">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="gt-input w-64"
          placeholder="搜索项目"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="搜索项目"
        />
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-1 rounded-xl bg-primary px-3 py-2 text-sm text-white transition-colors duration-200 hover:bg-primary/90"
          onClick={startCreate}
        >
          <Plus size={14} /> 新建项目
        </button>
        <span className="text-xs text-muted">共 {filtered.length} 个</span>
      </div>

      {openForm && (
        <div className="gt-card mt-5 max-w-3xl space-y-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium">{draft.id ? '编辑项目' : '新建项目'}</div>
              <p className="mt-0.5 text-xs text-muted">目录是产出落点。技能和专家会在从这个项目开任务时自动带上。</p>
            </div>
            <button
              type="button"
              className="cursor-pointer text-xs text-muted transition-colors duration-200 hover:text-text"
              onClick={() => {
                setOpenForm(false)
                setDraft(emptyDraft())
              }}
            >
              取消
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-muted">
              名称
              <input
                className="gt-input mt-1"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="例如：周报工作区"
              />
            </label>
            <label className="block text-xs text-muted">
              工作目录
              <span className="mt-1 flex gap-2">
                <input className="gt-input" readOnly value={draft.workspace} placeholder="尚未选择" />
                <button
                  type="button"
                  className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-xl border border-line px-3 text-xs text-primary transition-colors duration-200 hover:border-primary/40"
                  onClick={() => void pickDir()}
                >
                  <FolderOpen size={14} /> 选择
                </button>
              </span>
            </label>
          </div>
          <label className="block text-xs text-muted">
            项目指令
            <textarea
              className="gt-input mt-1 min-h-24"
              value={draft.instruction}
              onChange={(e) => setDraft((d) => ({ ...d, instruction: e.target.value }))}
              placeholder="例如：所有产出使用简体中文，先给结论再给过程。"
            />
          </label>
          <div>
            <div className="text-xs text-muted">绑定技能</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {skills.filter((skill) => skill.installed).length === 0 && (
                <span className="text-xs text-muted">还没有下载技能，可去技能市场下载。</span>
              )}
              {skills
                .filter((skill) => skill.installed)
                .map((skill) => (
                <Chip
                  key={skill.id}
                  on={draft.skillIds.includes(skill.id)}
                  label={skill.name}
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      skillIds: d.skillIds.includes(skill.id)
                        ? d.skillIds.filter((id) => id !== skill.id)
                        : [...d.skillIds, skill.id],
                    }))
                  }
                />
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted">绑定专家（可选，单选）</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Chip on={!draft.expertId} label="不指定" onClick={() => setDraft((d) => ({ ...d, expertId: '' }))} />
              {experts.map((expert) => (
                <Chip
                  key={expert.id}
                  on={draft.expertId === expert.id}
                  label={expert.name}
                  onClick={() =>
                    setDraft((d) => ({ ...d, expertId: d.expertId === expert.id ? '' : expert.id }))
                  }
                />
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted">关联连接器（备忘，需在连接器市场启用）</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {mcp.length === 0 && <span className="text-xs text-muted">还没有已安装的连接器。</span>}
              {mcp.map((item) => (
                <Chip
                  key={item.id}
                  on={draft.mcpIds.includes(item.id)}
                  label={mcpName(item.id)}
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      mcpIds: d.mcpIds.includes(item.id)
                        ? d.mcpIds.filter((id) => id !== item.id)
                        : [...d.mcpIds, item.id],
                    }))
                  }
                />
              ))}
            </div>
          </div>
          <button
            type="button"
            disabled={saving}
            className="cursor-pointer rounded-xl bg-primary px-3 py-2 text-sm text-white transition-colors duration-200 hover:bg-primary/90 disabled:opacity-60"
            onClick={() => void saveDraft()}
          >
            {saving ? '保存中…' : draft.id ? '保存修改' : '保存项目'}
          </button>
        </div>
      )}

      {filtered.length === 0 && !openForm ? (
        <div className="mt-16 flex flex-col items-center text-center">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <FolderKanban size={26} />
          </span>
          <p className="mt-4 text-sm font-medium">还没有项目</p>
          <p className="mt-1 max-w-sm text-xs text-muted">
            {q.trim() ? '没有匹配的项目。换个关键词，或新建一个。' : '选一个本地目录，绑上常用指令和技能，之后开任务会自动套用。'}
          </p>
          <button
            type="button"
            className="mt-4 inline-flex cursor-pointer items-center gap-1 rounded-xl bg-primary px-3 py-2 text-sm text-white transition-colors duration-200 hover:bg-primary/90"
            onClick={startCreate}
          >
            <Plus size={14} /> 新建项目
          </button>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => (
            <article
              key={p.id}
              className="flex flex-col rounded-2xl border border-line bg-panel p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors duration-200 hover:border-primary/40"
            >
              <div className="flex items-start gap-3">
                <ProjectMark name={p.name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="mt-0.5 truncate text-[11px] text-muted" title={p.workspace}>
                    {p.workspace}
                  </div>
                </div>
              </div>
              {p.instruction ? (
                <p className="mt-3 line-clamp-2 text-xs text-muted">{p.instruction}</p>
              ) : (
                <p className="mt-3 text-xs text-muted">未设置项目指令</p>
              )}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {p.skillIds.slice(0, 4).map((id) => (
                  <span key={id} className="rounded-md bg-raised px-2 py-0.5 text-[11px] text-muted">
                    {skillName(id)}
                  </span>
                ))}
                {p.skillIds.length > 4 ? (
                  <span className="rounded-md bg-raised px-2 py-0.5 text-[11px] text-muted">+{p.skillIds.length - 4}</span>
                ) : null}
                {p.expertIds[0] ? (
                  <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                    {expertName(p.expertIds[0])}
                  </span>
                ) : null}
                {p.mcpIds.slice(0, 2).map((id) => (
                  <span key={id} className="rounded-md bg-raised px-2 py-0.5 text-[11px] text-muted">
                    {mcpName(id)}
                  </span>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  disabled={busyId === p.id}
                  className="cursor-pointer rounded-lg bg-primary px-3 py-1.5 text-xs text-white transition-colors duration-200 hover:bg-primary/90 disabled:opacity-60"
                  onClick={() => void openTask(p)}
                >
                  {busyId === p.id ? '创建中…' : '在此新建任务'}
                </button>
                <button
                  type="button"
                  className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted transition-colors duration-200 hover:text-primary"
                  onClick={() => startEdit(p)}
                >
                  <Pencil size={12} /> 编辑
                </button>
                <button
                  type="button"
                  className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted transition-colors duration-200 hover:text-warn"
                  onClick={() => void remove(p)}
                >
                  <Trash2 size={12} /> 删除
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </PageShell>
  )
}
