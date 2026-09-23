import { useEffect, useMemo, useState, type DragEvent } from 'react'
import { Check, FileText, ImagePlus, Paperclip, Send, Square, X } from 'lucide-react'
import { MODES, useApp } from '../lib/store'
import ContextBar from './ContextBar'
import ModelPicker from './ModelPicker'
import QuotaBanner from './QuotaBanner'
import { ensureCurrentTask } from '../lib/market'
import { quotaExhausted } from '../lib/quota'
import { isImageName, WORKSPACE_DRAG_MIME } from '@shared/protocol'
import type { AgentMode, MessageAttachment, SkillInfo, TaskRecord } from '@shared/protocol'

type PendingFile = {
  id: string
  path: string
  name: string
  kind: 'image' | 'file'
  preview?: string
}

function ipcError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
  return String(err)
}

function userPrompt(text: string, files: PendingFile[]): string {
  const trimmed = text.trim()
  if (trimmed) return trimmed
  if (files.some((item) => item.kind === 'image')) return '请识别这些图片里的内容，并说明关键信息。'
  if (files.length) return '请查看我放入工作空间的附件。'
  return ''
}

function pathsFromDrop(event: DragEvent): Promise<string[]> {
  const custom = event.dataTransfer.getData(WORKSPACE_DRAG_MIME)
  if (custom) {
    try {
      const parsed = JSON.parse(custom) as unknown
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
        return Promise.resolve(parsed)
      }
    } catch {
      /* fall through */
    }
  }
  const listed = [...event.dataTransfer.files]
  if (listed.length) return pathsFromFileList(listed)
  return Promise.resolve([])
}

function imageExt(type: string): string {
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg'
  if (type.includes('webp')) return 'webp'
  if (type.includes('gif')) return 'gif'
  if (type.includes('bmp')) return 'bmp'
  return 'png'
}

function namedFile(file: File): File {
  if (!file.type.startsWith('image/') || isImageName(file.name)) return file
  return new File([file], `paste.${imageExt(file.type)}`, { type: file.type || 'image/png' })
}

function filesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return []
  const listed = [...data.files]
  const source = listed.length
    ? listed
    : [...data.items]
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file))
  return source.map(namedFile)
}

async function pathsFromFileList(list: File[]): Promise<string[]> {
  if (!window.gt?.files) {
    window.alert('客户端通道未就绪，请重启应用后再试。')
    return []
  }
  const out: string[] = []
  for (const file of list.slice(0, 20)) {
    let next = window.gt.files.path(file)
    const image = file.type.startsWith('image/') || isImageName(file.name)
    if (next && image && !isImageName(next)) next = ''
    if (!next) {
      const name = isImageName(file.name)
        ? file.name
        : image
          ? `paste.${imageExt(file.type)}`
          : file.name || 'paste.bin'
      next = await window.gt.files.saveBytes(name, await file.arrayBuffer())
    }
    if (next) out.push(next)
  }
  return out
}

export default function Composer({
  taskId,
  mode,
  running,
  onMode,
}: {
  taskId: string | null
  mode: AgentMode
  running: boolean
  onMode: (mode: AgentMode) => void
}) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<PendingFile[]>([])
  const [drag, setDrag] = useState(false)
  const [sending, setSending] = useState(false)
  const [hint, setHint] = useState('')
  const skills = useApp((s) => s.skills)
  const settings = useApp((s) => s.settings)
  const entitlements = useApp((s) => s.entitlements)
  const current = useApp((s) => s.tasks.find((t) => t.id === s.currentId) || null)
  const longPaste = text.length > 3000
  const busy = running || sending
  const slashOpen = text.startsWith('/')
  const slashQuery = slashOpen ? text.slice(1).trim().toLowerCase() : ''
  const installedSkills = useMemo(() => {
    const allowed = entitlements?.subscription?.skills || []
    const allSkills = allowed.includes('*') || !entitlements
    return skills.filter((s) => {
      if (!s.installed) return false
      if (s.source === 'custom' || s.tags.includes('custom')) return true
      return allSkills || allowed.includes(s.id)
    })
  }, [skills, entitlements])
  const slashSkills = useMemo(() => {
    if (!slashOpen) return []
    const pool = installedSkills
    if (!slashQuery) return pool
    return pool.filter(
      (s) =>
        s.name.toLowerCase().includes(slashQuery) ||
        s.id.toLowerCase().includes(slashQuery) ||
        s.description.toLowerCase().includes(slashQuery),
    )
  }, [installedSkills, slashOpen, slashQuery])

  const currentModel = entitlements?.models?.find((m) => m.id === settings?.model)
  const hasImages = files.some((item) => item.kind === 'image')
  const pendingAttach = useApp((s) => s.pendingAttach)

  const pickSlashSkill = async (skill: SkillInfo) => {
    const task = await ensureCurrentTask()
    const selected = task.selectedSkills.includes(skill.id)
      ? task.selectedSkills.filter((id) => id !== skill.id)
      : [...task.selectedSkills, skill.id]
    const next = await window.gt.tasks.patch(task.id, { selectedSkills: selected })
    if (next) useApp.getState().upsertTask(next)
  }

  const markFailed = (task: TaskRecord, message: string) => {
    useApp.getState().upsertTask({
      ...task,
      status: 'failed',
      messages: [
        ...task.messages,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `错误：${message}`,
          createdAt: Date.now(),
        },
      ],
    })
  }

  const ensureVisionModel = async () => {
    const models = entitlements?.models || []
    if (!models.length || !settings) return
    if (models.find((m) => m.id === settings.model)?.vision) return
    const nextModel = models.find((m) => m.vision && (m.kind || 'chat') === 'chat' && m.id.includes('flash'))
      || models.find((m) => m.vision && (m.kind || 'chat') === 'chat')
    if (!nextModel) {
      setHint('当前套餐模型不支持识图。请升级套餐或改用 DeepSeek Flash / V4 Pro。')
      return
    }
    const next = { ...settings, model: nextModel.id }
    useApp.setState({ settings: next })
    await window.gt.settings.set(next)
    setHint(`已切换到 ${nextModel.name}，以便识别图片。`)
  }

  const addPaths = async (paths: string[]) => {
    if (!paths.length) return
    const incoming: PendingFile[] = []
    for (const filePath of paths) {
      const name = filePath.split(/[\\/]/).pop() || filePath
      const kind: PendingFile['kind'] = isImageName(name) ? 'image' : 'file'
      const preview =
        kind === 'image' && window.gt.files?.dataUrl
          ? await window.gt.files.dataUrl(filePath).catch(() => '')
          : ''
      incoming.push({ id: crypto.randomUUID(), path: filePath, name, kind, preview: preview || undefined })
    }
    setFiles((prev) => [...prev, ...incoming].slice(0, 20))
    if (incoming.some((item) => item.kind === 'image')) void ensureVisionModel()
  }

  useEffect(() => {
    if (!pendingAttach.length) return
    const paths = pendingAttach
    useApp.setState({ pendingAttach: [] })
    void addPaths(paths)
  }, [pendingAttach])

  const send = async () => {
    if (text.startsWith('/')) {
      setText('')
      return
    }
    if ((!text.trim() && !files.length) || busy) return
    if (!settings?.apiKey) {
      useApp.getState().setView('account')
      return
    }
    if (quotaExhausted(entitlements)) return
    if (!window.gt?.tasks?.send) {
      window.alert('客户端通道未就绪，请重启应用后再试。')
      return
    }

    const payload = userPrompt(text, files)
    const attached = files
    const attachmentMeta: MessageAttachment[] = attached.map((item) => ({
      path: item.path,
      name: item.name,
      kind: item.kind,
    }))
    setSending(true)

    try {
      let id = taskId
      if (!id) {
        const created = await window.gt.tasks.create({ mode })
        useApp.getState().upsertTask(created)
        id = created.id
      }
      useApp.getState().clearHalt(id)

      const snapshot = useApp.getState().tasks.find((t) => t.id === id)
      if (snapshot) {
        useApp.getState().upsertTask({
          ...snapshot,
          status: 'running',
          title: snapshot.title === '新任务' && payload ? payload.slice(0, 24) : snapshot.title,
          messages: [
            ...snapshot.messages,
            {
              id: crypto.randomUUID(),
              role: 'user',
              content: payload,
              attachments: attachmentMeta.length ? attachmentMeta : undefined,
              createdAt: Date.now(),
            },
          ],
        })
      }

      setText('')
      setFiles([])
      setHint('')

      const result = await window.gt.tasks.send(
        id,
        payload,
        attached.map((item) => item.path),
      )
      if (result && result.ok === false) {
        const latest = useApp.getState().tasks.find((t) => t.id === id)
        if (latest) markFailed(latest, result.error || '发送失败')
      }
    } catch (err) {
      const latest = useApp.getState().tasks.find((t) => t.id === taskId) || current
      if (latest) markFailed(latest, ipcError(err))
      else window.alert(ipcError(err))
    } finally {
      setSending(false)
    }
  }

  useEffect(() => {
    if (hasImages && currentModel && !currentModel.vision) void ensureVisionModel()
  }, [hasImages, currentModel?.id, currentModel?.vision])

  return (
    <div
      className={`relative bg-ink pt-1 ${drag ? 'bg-primary/5' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        void pathsFromDrop(e).then(addPaths)
      }}
    >
      {!settings?.apiKey && (
        <button
          type="button"
          className="mb-2 w-full cursor-pointer rounded-xl border border-primary/30 bg-white px-3 py-2 text-left text-xs text-primary transition-colors duration-200 hover:bg-primary/5"
          onClick={() => useApp.getState().setView('account')}
        >
          请先登录账户。点这里注册或登录后即可使用，无需填写厂商 API Key。
        </button>
      )}
      {settings?.apiKey ? <QuotaBanner /> : null}
      <div className="relative rounded-[22px] border border-line bg-panel p-3 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
        {drag && (
          <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-[18px] border-2 border-dashed border-primary bg-white/90">
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <ImagePlus size={18} />
              松开即可加入对话框
            </div>
          </div>
        )}
        <ContextBar />
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onMode(m.id)}
              className={`cursor-pointer rounded-full px-3 py-1 text-xs transition-colors duration-200 ${
                mode === m.id ? 'bg-primary text-white' : 'bg-raised text-muted hover:bg-primary/10 hover:text-primary'
              }`}
            >
              {m.label}
            </button>
          ))}
          <span className="text-[11px] text-muted">{MODES.find((m) => m.id === mode)?.hint}</span>
        </div>
        {files.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {files.map((item) => (
              <span
                key={item.id}
                className="relative inline-flex items-center gap-2 overflow-hidden rounded-xl border border-line bg-ink pr-7"
              >
                {item.kind === 'image' && item.preview ? (
                  <img src={item.preview} alt={item.name} className="h-12 w-12 object-cover" />
                ) : (
                  <span className="flex h-12 w-12 items-center justify-center text-muted">
                    {item.kind === 'image' ? <ImagePlus size={16} /> : <FileText size={16} />}
                  </span>
                )}
                <span className="max-w-32 truncate py-1 text-[11px] text-text" title={item.name}>
                  {item.name}
                </span>
                <button
                  type="button"
                  aria-label={`移除 ${item.name}`}
                  className="absolute right-1 top-1 cursor-pointer rounded-full p-0.5 text-muted transition-colors duration-200 hover:bg-white hover:text-text"
                  onClick={() => setFiles((prev) => prev.filter((row) => row.id !== item.id))}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        {hint && (
          <div role="status" className="mb-2 rounded-lg bg-primary/5 px-3 py-2 text-xs text-primary">
            {hint}
          </div>
        )}
        {longPaste && (
          <div className="mb-2 rounded-lg bg-raised px-3 py-2 text-xs text-muted">
            长文本已保留在输入框中，发送后会一并交给 Agent。
          </div>
        )}
        <div className="rounded-2xl border border-line bg-ink px-3 py-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const pasted = filesFromClipboard(e.clipboardData)
              if (!pasted.length) return
              e.preventDefault()
              void pathsFromFileList(pasted).then(addPaths)
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.key === 'Process') return
              if (slashOpen) {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setText('')
                  return
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  return
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder={
              current
                ? '直接说你要做什么… 可拖入或粘贴图片/文件。输入 / 选择已下载技能'
                : '直接输入就会自动新建任务，也可拖入图片。输入 / 选择技能'
            }
            className="max-h-40 min-h-12 w-full resize-none bg-transparent text-sm text-text outline-none placeholder:text-muted"
          />
          <div className="mt-1 flex items-center gap-1">
            <label
              className="cursor-pointer rounded-lg p-1.5 text-muted transition-colors duration-200 hover:bg-white hover:text-primary"
              title="添加文件或图片（拖拽、粘贴也可）"
            >
              <Paperclip size={16} />
              <input
                type="file"
                className="hidden"
                multiple
                accept="image/*,.pdf,.txt,.md,.csv,.xlsx,.docx,.pptx,.json,.zip"
                onChange={(e) => {
                  void pathsFromFileList([...(e.target.files || [])]).then(addPaths)
                  e.target.value = ''
                }}
              />
            </label>
            <ModelPicker />
            <span className="ml-auto" />
            {busy ? (
              <button
                type="button"
                aria-label="停止生成"
                className="cursor-pointer rounded-xl bg-primary px-3 py-2 text-white transition-colors duration-200 hover:bg-primary/90"
                onClick={() => {
                  if (!taskId) return
                  useApp.getState().haltTask(taskId)
                  void window.gt.tasks.stop(taskId)
                  setSending(false)
                  const latest = useApp.getState().tasks.find((t) => t.id === taskId)
                  if (latest) useApp.getState().upsertTask({ ...latest, status: 'stopped' })
                  useApp.setState({ pendingPermission: null, pendingQuestion: null })
                }}
              >
                <Square size={14} />
              </button>
            ) : quotaExhausted(entitlements) ? (
              <button
                type="button"
                className="cursor-pointer rounded-xl bg-primary px-3 py-2 text-xs font-medium text-white transition-colors duration-200 hover:bg-primary/90"
                onClick={() => void window.gt.account.openShop()}
              >
                去官网充值
              </button>
            ) : (
              <button
                type="button"
                aria-label="发送"
                className="cursor-pointer rounded-xl bg-primary px-3 py-2 text-white transition-colors duration-200 hover:bg-primary/90"
                onClick={() => void send()}
              >
                <Send size={14} />
              </button>
            )}
          </div>
        </div>
        {slashOpen && (
          <div className="mt-2 rounded-xl border border-line bg-white p-2 text-xs shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
            <div className="mb-1 flex items-center justify-between gap-2 px-2 text-[11px] text-muted">
              <span>
                已下载技能 {slashSkills.length}/{installedSkills.length} · 点选可多选，Esc 或完成关闭
              </span>
              <button
                type="button"
                className="cursor-pointer text-primary transition-colors duration-200 hover:text-accent"
                onClick={() => setText('')}
              >
                完成
              </button>
            </div>
            <div className="max-h-72 overflow-auto">
              {slashSkills.map((s) => {
                const on = Boolean(current?.selectedSkills.includes(s.id))
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`flex w-full cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-200 ${
                      on ? 'bg-primary/5' : 'hover:bg-raised'
                    }`}
                    onClick={() => void pickSlashSkill(s)}
                  >
                    <span
                      className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        on ? 'border-primary bg-primary text-white' : 'border-line'
                      }`}
                    >
                      {on ? <Check size={10} /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="text-primary">/{s.id}</span>
                      <span className="text-text"> · {s.name}</span>
                      {s.tags.includes('custom') ? <span className="ml-2 text-muted">自定义</span> : null}
                      <div className="line-clamp-1 text-[11px] text-muted">{s.description}</div>
                    </span>
                  </button>
                )
              })}
              {slashSkills.length === 0 && (
                <button
                  type="button"
                  className="w-full cursor-pointer rounded-lg px-2 py-2 text-left text-muted hover:bg-raised"
                  onClick={() => useApp.getState().setView('skills')}
                >
                  没有匹配的已下载技能。去技能市场下载后再用 / 选择。
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
