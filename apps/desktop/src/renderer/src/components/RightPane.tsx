import { useEffect, useMemo, useState, type DragEvent } from 'react'
import MarkdownView, { FormattedBlock } from './MarkdownView'
import {
  isImageName,
  isTextName,
  WORKSPACE_DRAG_MIME,
  type TaskRecord,
  type WorkspaceEntry,
} from '@shared/protocol'
import { useApp } from '../lib/store'
import {
  ExternalLink,
  File,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  MessageSquarePlus,
  PanelRightClose,
  Play,
} from 'lucide-react'

function csvToMarkdown(text: string): string {
  const rows = text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, 80)
  if (rows.length < 2 || !rows[0].includes(',')) return text
  const split = (line: string) => line.split(',').map((cell) => cell.trim().replaceAll('|', '\\|'))
  const header = split(rows[0])
  if (header.length < 2) return text
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.slice(1).map((row) => {
      const cells = split(row)
      while (cells.length < header.length) cells.push('')
      return `| ${cells.slice(0, header.length).join(' | ')} |`
    }),
  ]
  return lines.join('\n')
}

function fileIcon(entry: WorkspaceEntry) {
  if (entry.dir) return FolderOpen
  if (isImageName(entry.name)) return ImageIcon
  if (/\.(xlsx|xls|csv)$/i.test(entry.name)) return FileSpreadsheet
  if (isTextName(entry.name)) return FileText
  return File
}

function collectDragPaths(entry: WorkspaceEntry, files: WorkspaceEntry[]): string[] {
  if (!entry.dir) return [entry.path]
  const prefix = entry.path.replace(/[\\/]+$/, '') + (entry.path.includes('\\') ? '\\' : '/')
  return files.filter((item) => !item.dir && item.path.startsWith(prefix)).map((item) => item.path)
}

function FilePreview({
  taskId,
  entry,
}: {
  taskId: string
  entry: WorkspaceEntry
}) {
  const [image, setImage] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const textFile = isTextName(entry.name)
  const imageFile = isImageName(entry.name)

  useEffect(() => {
    let alive = true
    setImage('')
    setText('')
    setError('')
    if (entry.dir) return
    if (imageFile) {
      void window.gt.files.dataUrl(entry.path).then((url) => {
        if (!alive) return
        if (url) setImage(url)
        else setError('图片过大或无法读取。')
      })
      return () => {
        alive = false
      }
    }
    if (textFile) {
      void window.gt.workspace
        .read(taskId, entry.path)
        .then((body) => {
          if (alive) setText(body)
        })
        .catch((err) => {
          if (alive) setError(err instanceof Error ? err.message : String(err))
        })
    }
    return () => {
      alive = false
    }
  }, [taskId, entry.path, entry.dir, imageFile, textFile])

  if (entry.dir) {
    return <div className="px-3 py-4 text-xs text-muted">文件夹。点开其中的文件预览，或拖到对话框发给模型。</div>
  }
  if (imageFile) {
    if (!image && !error) return <div className="px-3 py-4 text-xs text-muted">正在加载图片…</div>
    if (error) return <div className="px-3 py-4 text-xs text-muted">{error}</div>
    return <img src={image} alt={entry.name} className="max-h-64 max-w-full object-contain" />
  }
  if (textFile) {
    if (!text && !error) return <div className="px-3 py-4 text-xs text-muted">正在加载…</div>
    if (error) return <div className="px-3 py-4 text-xs text-muted">{error}</div>
    if (entry.name.toLowerCase().endsWith('.md')) return <MarkdownView content={text} compact />
    if (entry.name.toLowerCase().endsWith('.csv')) return <MarkdownView content={csvToMarkdown(text)} compact />
    return <FormattedBlock text={text} />
  }
  return (
    <div className="px-3 py-4 text-xs text-muted">
      此格式无法内嵌预览。可拖到对话框作为附件，或用系统应用打开。
    </div>
  )
}

export default function RightPane({
  task,
  files,
  open,
  onToggle,
  onRunPlan,
}: {
  task: TaskRecord | null
  files: WorkspaceEntry[]
  open: boolean
  onToggle: () => void
  onRunPlan: () => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const queueAttach = useApp((s) => s.queueAttach)
  const current = useMemo(
    () => files.find((item) => item.path === selected) || null,
    [files, selected],
  )

  useEffect(() => {
    setSelected(null)
  }, [task?.id])

  const startDrag = (entry: WorkspaceEntry, event: DragEvent) => {
    const paths = collectDragPaths(entry, files)
    if (!paths.length) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(WORKSPACE_DRAG_MIME, JSON.stringify(paths))
    event.dataTransfer.setData('text/plain', paths.join('\n'))
  }

  return (
    <aside
      id="workspace-pane"
      className={`flex shrink-0 flex-col overflow-hidden border-line bg-panel transition-[width] duration-200 ease-out ${
        open ? 'w-96 border-l' : 'w-0 border-l-0'
      }`}
      aria-hidden={!open}
      {...(!open ? { inert: true } : {})}
    >
      <div className="flex w-96 min-h-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <div className="text-xs text-muted">工作空间</div>
            <div className="truncate text-sm" title={task?.workspace || ''}>
              {task?.workspace || '新建任务后显示目录'}
            </div>
          </div>
          <button
            type="button"
            className="cursor-pointer rounded-lg p-1.5 text-muted transition-colors duration-200 hover:bg-raised hover:text-text"
            aria-label="收起工作空间"
            title="收起工作空间"
            onClick={onToggle}
          >
            <PanelRightClose size={16} />
          </button>
        </div>
        {!task ? (
          <div className="p-4 text-xs text-muted">还没有任务。发送一条消息后，产物会出现在这里。</div>
        ) : (
          <>
            {task.planMarkdown && (
              <div className="border-b border-line p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium">方案</span>
                  {task.status === 'awaiting_plan' && (
                    <button
                      type="button"
                      onClick={onRunPlan}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-primary px-2 py-1 text-xs text-white transition-colors duration-200 hover:bg-primary/90"
                    >
                      <Play size={12} /> 开始执行
                    </button>
                  )}
                </div>
                <div className="max-h-40 overflow-auto text-xs">
                  <MarkdownView content={task.planMarkdown} compact />
                </div>
              </div>
            )}
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-auto p-2">
                <div className="mb-1 px-2 text-[11px] text-muted">点选预览 · 拖到对话框发给模型</div>
                {files.length === 0 && <div className="px-2 py-3 text-xs text-muted">空目录</div>}
                {files.map((entry) => {
                  const Icon = fileIcon(entry)
                  const active = selected === entry.path
                  return (
                    <div
                      key={entry.path}
                      draggable
                      onDragStart={(event) => startDrag(entry, event)}
                      onClick={() => setSelected(entry.path)}
                      className={`flex w-full cursor-grab select-none items-center gap-1.5 rounded-lg py-1 pr-2 text-left text-xs transition-colors duration-200 active:cursor-grabbing ${
                        active
                          ? 'border-l-[3px] border-primary bg-primary/10 text-text'
                          : 'border-l-[3px] border-transparent text-text hover:bg-raised'
                      }`}
                      style={{ paddingLeft: 8 + (entry.depth || 0) * 12 }}
                      title={`${entry.relative || entry.name} · 拖到对话框可发送`}
                    >
                      <Icon size={13} className="shrink-0 text-muted" />
                      <span className="truncate">{entry.dir ? `${entry.name}/` : entry.name}</span>
                    </div>
                  )
                })}
              </div>
              <div className="flex min-h-40 flex-1 flex-col border-t border-line">
                {current ? (
                  <>
                    <div className="flex items-center gap-1 border-b border-line px-3 py-2">
                      <div className="min-w-0 flex-1 truncate text-xs font-medium" title={current.relative || current.name}>
                        {current.relative || current.name}
                      </div>
                      {!current.dir && (
                        <>
                          <button
                            type="button"
                            className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] text-primary transition-colors duration-200 hover:bg-primary/10"
                            title="加入对话框"
                            onClick={() => queueAttach(collectDragPaths(current, files))}
                          >
                            <MessageSquarePlus size={12} />
                            加入对话
                          </button>
                          <button
                            type="button"
                            className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] text-muted transition-colors duration-200 hover:bg-raised hover:text-text"
                            title="用系统应用打开"
                            aria-label={`打开 ${current.name}`}
                            onClick={() => void window.gt.workspace.open(task.id, current.path)}
                          >
                            <ExternalLink size={12} />
                          </button>
                        </>
                      )}
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto p-3">
                      <FilePreview taskId={task.id} entry={current} />
                    </div>
                  </>
                ) : (
                  <div className="px-3 py-6 text-xs text-muted">选择文件可预览图片、Markdown、表格和代码。也可直接拖到下方对话框。</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
