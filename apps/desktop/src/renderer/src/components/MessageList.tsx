import MarkdownView from './MarkdownView'
import type { MessageAttachment, TaskMessage } from '@shared/protocol'
import { Plug, Sparkles, UserRound, Wrench, FileText } from 'lucide-react'
import { useApp } from '../lib/store'
import BrandMark from './BrandMark'
import { useActivityLabel } from '../lib/agent-status'
import {
  humanizeMessageContent,
  summarizeToolResult,
  toolContextLine,
  toolDoneLabel,
  toolProgressLabel,
} from '../lib/tool-display'
import { memo, useEffect, useState } from 'react'

function ThinkingStatus({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-2 rounded-2xl border border-line bg-panel px-4 py-2.5 text-sm text-muted shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <span className="inline-flex items-center gap-1" aria-hidden>
        <span className="thinking-dot" />
        <span className="thinking-dot" />
        <span className="thinking-dot" />
      </span>
      <span>{label}</span>
    </div>
  )
}

function ToolCard({ msg }: { msg: TaskMessage }) {
  const tool = msg.tool!
  const done = Boolean(tool.result)
  const title = done ? toolDoneLabel(tool) : toolProgressLabel(tool)
  const context = toolContextLine(tool.args)
  const summary = done ? summarizeToolResult(tool.name, tool.result) : null

  return (
    <div className="rounded-xl border border-line bg-panel px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-2 text-xs text-primary">
        <Wrench size={14} className="shrink-0" />
        <span className="min-w-0 truncate font-medium">{title}</span>
        {!done ? (
          <span className="inline-flex shrink-0 items-center gap-1" aria-hidden>
            <span className="thinking-dot" />
            <span className="thinking-dot" />
            <span className="thinking-dot" />
          </span>
        ) : null}
      </div>
      {context ? <p className="mt-1 truncate text-[11px] text-muted">{context}</p> : null}
      {summary ? <p className="mt-1.5 text-xs text-muted">{summary}</p> : null}
    </div>
  )
}

function AttachmentGallery({ items, invert }: { items: MessageAttachment[]; invert?: boolean }) {
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {items.map((item) =>
        item.kind === 'image' ? (
          <ImageThumb key={`${item.path}-${item.name}`} path={item.path} name={item.name} />
        ) : (
          <span
            key={`${item.path}-${item.name}`}
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] ${
              invert ? 'bg-white/15 text-white' : 'bg-raised text-muted'
            }`}
          >
            <FileText size={12} />
            {item.name}
          </span>
        ),
      )}
    </div>
  )
}

function ImageThumb({ path, name }: { path: string; name: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let alive = true
    if (!window.gt?.files?.dataUrl) return
    void window.gt.files.dataUrl(path).then((url) => {
      if (alive) setSrc(url)
    })
    return () => {
      alive = false
    }
  }, [path])
  if (!src) {
    return <span className="rounded-lg bg-white/15 px-2 py-1 text-[11px]">{name}</span>
  }
  return <img src={src} alt={name} className="max-h-40 max-w-full rounded-lg object-contain" />
}

const ChatTurn = memo(function ChatTurn({ msg, streaming }: { msg: TaskMessage; streaming: boolean }) {
  if (msg.tool) return <ToolCard msg={msg} />
  if (msg.role === 'assistant' && !msg.content.trim()) return null
  const mine = msg.role === 'user'
  const body = mine || streaming ? msg.content : humanizeMessageContent(msg.content || '…')
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`rounded-2xl px-4 py-3 text-sm leading-6 ${
          mine
            ? 'max-w-[min(100%,42rem)] bg-primary text-white'
            : 'w-full border border-line bg-panel text-text shadow-[0_1px_2px_rgba(15,23,42,0.04)]'
        }`}
      >
        {mine ? (
          <div>
            {msg.attachments?.length ? <AttachmentGallery items={msg.attachments} invert /> : null}
            <div className="whitespace-pre-wrap break-words">{body}</div>
          </div>
        ) : streaming ? (
          <div className="whitespace-pre-wrap break-words">{body}</div>
        ) : (
          <MarkdownView content={body} />
        )}
      </div>
    </div>
  )
})

export default function MessageList({
  messages,
  running = false,
}: {
  messages: TaskMessage[]
  running?: boolean
}) {
  const setView = useApp((s) => s.setView)
  const current = useApp((s) => s.tasks.find((t) => t.id === s.currentId))
  const skills = useApp((s) => s.skills)
  const experts = useApp((s) => s.experts)
  const teams = useApp((s) => s.teams)
  const status = useActivityLabel(messages, running)
  const lastId = messages.at(-1)?.id
  if (!messages.length && !status) {
    const expert = experts.find((item) => item.id === current?.selectedExpert)
    const team = teams.find((item) => item.id === current?.selectedTeam)
    const picked = skills.filter((skill) => current?.selectedSkills.includes(skill.id))
    return (
      <div className="flex min-h-full flex-col items-center justify-center px-6 text-center">
        <BrandMark size={72} rounded="rounded-[22px]" />
        <p className="mt-5 text-lg font-semibold tracking-tight text-text">你好，我是光途Work</p>
        <p className="mt-2 max-w-md text-sm text-muted">用一句话说目标，我会按下方已选技能和专家在工作空间里交付。</p>
        <p className="mt-2 text-xs text-muted">
          {expert || team || picked.length
            ? `当前：${[expert?.name, team?.name, ...picked.map((s) => s.name)].filter(Boolean).join(' · ')}`
            : '还没选技能或专家，会按通用助手处理。'}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-text transition-colors duration-200 hover:border-primary/50 hover:text-primary"
            onClick={() => setView('skills')}
          >
            <Sparkles size={12} /> 添加技能
          </button>
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-text transition-colors duration-200 hover:border-primary/50 hover:text-primary"
            onClick={() => setView('experts')}
          >
            <UserRound size={12} /> 召唤专家
          </button>
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-text transition-colors duration-200 hover:border-primary/50 hover:text-primary"
            onClick={() => setView('mcp')}
          >
            <Plug size={12} /> 启用连接器
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-3 pb-2">
      {messages.map((msg) => (
        <ChatTurn key={msg.id} msg={msg} streaming={running && msg.id === lastId && msg.role === 'assistant' && !msg.tool} />
      ))}
      {status ? (
        <div className="sticky bottom-0 z-10 bg-ink py-2">
          <ThinkingStatus label={status} />
        </div>
      ) : null}
    </div>
  )
}

export { ThinkingStatus }
