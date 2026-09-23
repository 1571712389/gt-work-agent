import { useMemo, useState } from 'react'
import { Download, Plus, Trash2 } from 'lucide-react'
import { useApp } from '../lib/store'
import { notify, gtCall } from '../lib/market'
import PageShell from '../components/PageShell'
import ItemMark from '../components/ItemMark'

const TAGS = [
  { id: 'all', label: '全部' },
  { id: 'custom', label: '自定义' },
  { id: 'office', label: '办公' },
  { id: 'writing', label: '写作' },
  { id: 'communication', label: '沟通' },
  { id: 'research', label: '调研' },
  { id: 'hr', label: '人事' },
  { id: 'engineering', label: '研发' },
  { id: 'data', label: '数据' },
  { id: 'product', label: '产品' },
]

type Draft = { key: string; id: string; name: string; description: string; body: string }

function nextCustomId(used: string[]) {
  const set = new Set(used)
  let i = 1
  while (set.has(`my-skill-${i}`)) i += 1
  return `my-skill-${i}`
}

function emptyDraft(used: string[]): Draft {
  return {
    key: crypto.randomUUID(),
    id: nextCustomId(used),
    name: '',
    description: '',
    body: '1. 先阅读工作空间\n2. 按步骤产出文件\n3. 最后写一份说明',
  }
}

export default function SkillsPage() {
  const skills = useApp((s) => s.skills)
  const entitlements = useApp((s) => s.entitlements)
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('all')
  const [drafts, setDrafts] = useState<Draft[]>(() => [emptyDraft([])])
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const allowed = entitlements?.subscription?.skills || []
  const allSkills = allowed.includes('*') || !entitlements
  const customSkills = skills.filter((skill) => skill.source === 'custom' || skill.tags.includes('custom'))
  const installedCount = skills.filter((skill) => skill.installed).length

  const filtered = useMemo(
    () =>
      skills.filter((skill) => {
        const hit =
          !q.trim() ||
          skill.name.includes(q) ||
          skill.description.includes(q) ||
          skill.id.includes(q)
        const tagHit = tag === 'all' || skill.tags.includes(tag)
        return hit && tagHit
      }),
    [skills, q, tag],
  )

  const install = async (skillId: string, skillName: string) => {
    setBusy(skillId)
    try {
      const list = await gtCall<typeof skills>('skills:install', skillId)
      useApp.setState({ skills: list })
      notify(`已下载「${skillName}」到本机。在对话输入 / 即可选用。`, 'ok')
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'warn')
    } finally {
      setBusy(null)
    }
  }

  const uninstall = async (skillId: string, skillName: string) => {
    setBusy(skillId)
    try {
      const list = await gtCall<typeof skills>('skills:uninstall', skillId)
      useApp.setState({ skills: list })
      notify(`已从本机移除「${skillName}」`, 'info')
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'warn')
    } finally {
      setBusy(null)
    }
  }

  const patchDraft = (key: string, patch: Partial<Draft>) => {
    setDrafts((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  const saveDrafts = async () => {
    const payload = drafts
      .map((row) => ({
        id: row.id.trim(),
        name: row.name.trim(),
        description: row.description.trim(),
        body: row.body.trim(),
      }))
      .filter((row) => row.id && row.name)
    if (!payload.length) {
      notify('请至少填写一条自定义技能的标识和名称', 'warn')
      return
    }
    setSaving(true)
    try {
      const list = await window.gt.skills.save(payload)
      useApp.setState({ skills: list })
      const used = list.map((item) => item.id)
      setDrafts([emptyDraft(used)])
      notify(`已保存 ${payload.length} 条自定义技能到本机，可在对话里用 / 选择`, 'ok')
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'warn')
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageShell
      title="技能市场"
      subtitle="下载到本机后，在对话输入框输入 / 多选技能。这里不会把技能加入当前会话。"
    >
      <div className="flex flex-wrap gap-2">
        <input
          className="gt-input w-64"
          placeholder="搜索技能"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="搜索技能"
        />
        {TAGS.map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => setTag(item.id)}
            className={`rounded-full px-3 py-1 text-xs transition-colors duration-200 ${
              tag === item.id ? 'bg-primary text-white' : 'bg-raised text-muted hover:text-text'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="mt-2 text-xs text-muted">
        共 {filtered.length} 个 · 已下载 {installedCount} 个 · 自定义 {customSkills.length} 个
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-3">
        {filtered.map((skill) => {
          const custom = skill.source === 'custom' || skill.tags.includes('custom')
          const locked = Boolean(entitlements) && !allSkills && !custom && !allowed.includes(skill.id)
          const on = Boolean(skill.installed)
          return (
            <div
              key={skill.id}
              className={`rounded-2xl border p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors duration-200 ${
                locked
                  ? 'opacity-50'
                  : on
                    ? 'border-primary bg-primary/5'
                    : 'border-line bg-panel'
              }`}
            >
              <div className="flex items-start gap-3">
                <ItemMark kind="skill" id={skill.id} name={skill.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium">{skill.name}</div>
                    {on ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-primary">已下载</span>
                    ) : null}
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs text-muted">{skill.description}</div>
                  <div className="mt-2 text-[11px] text-muted">
                    {locked ? '当前套餐未包含' : custom ? '自定义 · 已在本机' : skill.tags.join(' / ')}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    {locked ? (
                      <span className="text-[11px] text-muted">需升级</span>
                    ) : on ? (
                      <button
                        type="button"
                        disabled={busy === skill.id}
                        className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[11px] text-muted transition-colors duration-200 hover:text-warn"
                        onClick={() => void uninstall(skill.id, skill.name)}
                      >
                        <Trash2 size={12} />
                        {busy === skill.id ? '处理中…' : '移除'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy === skill.id}
                        className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] text-white transition-colors duration-200 hover:bg-primary/90 disabled:opacity-60"
                        onClick={() => void install(skill.id, skill.name)}
                      >
                        <Download size={12} />
                        {busy === skill.id ? '下载中…' : '下载到本机'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <div className="gt-card mt-8 max-w-3xl space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium">新建自定义技能</div>
            <p className="mt-0.5 text-xs text-muted">保存后即下载到本机技能库，随后都能在 / 里选中。</p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-xl border border-line px-3 py-1.5 text-xs text-primary transition-colors duration-200 hover:border-primary/40"
            onClick={() =>
              setDrafts((rows) => [
                ...rows,
                emptyDraft([...skills.map((s) => s.id), ...rows.map((r) => r.id)]),
              ])
            }
          >
            <Plus size={14} /> 再加一条
          </button>
        </div>
        {drafts.map((draft, index) => (
          <div key={draft.key} className="space-y-3 rounded-2xl border border-line bg-ink p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted">自定义技能 {index + 1}</div>
              {drafts.length > 1 && (
                <button
                  type="button"
                  className="text-muted transition-colors duration-200 hover:text-warn"
                  aria-label={`删除第 ${index + 1} 条`}
                  onClick={() => setDrafts((rows) => rows.filter((row) => row.key !== draft.key))}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs text-muted">
                标识
                <input className="gt-input mt-1" value={draft.id} onChange={(e) => patchDraft(draft.key, { id: e.target.value })} />
              </label>
              <label className="block text-xs text-muted">
                名称
                <input className="gt-input mt-1" value={draft.name} onChange={(e) => patchDraft(draft.key, { name: e.target.value })} />
              </label>
            </div>
            <label className="block text-xs text-muted">
              简介
              <input className="gt-input mt-1" value={draft.description} onChange={(e) => patchDraft(draft.key, { description: e.target.value })} />
            </label>
            <label className="block text-xs text-muted">
              技能说明
              <textarea className="gt-input mt-1 min-h-24" value={draft.body} onChange={(e) => patchDraft(draft.key, { body: e.target.value })} />
            </label>
          </div>
        ))}
        <button
          type="button"
          disabled={saving}
          className="rounded-lg bg-primary px-3 py-2 text-sm text-white transition-colors duration-200 hover:bg-primary/90 disabled:opacity-60"
          onClick={() => void saveDrafts()}
        >
          {saving ? '保存中…' : `保存 ${drafts.length} 条到本机技能库`}
        </button>
      </div>
    </PageShell>
  )
}
