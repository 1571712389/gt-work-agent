import { isValidElement, memo, useState, type ComponentProps, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy } from 'lucide-react'

function isPipeRow(line: string): boolean {
  const t = line.trim()
  return t.startsWith('|') && t.includes('|', 1)
}

function isSepRow(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
}

function pipeCols(line: string): number {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').length
}

function normalizeMarkdown(src: string): string {
  const lines = src.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const next = lines[i + 1]
    if (isPipeRow(line) && next && isPipeRow(next) && !isSepRow(next) && (i === 0 || !isPipeRow(lines[i - 1]))) {
      out.push(line)
      const cols = Math.max(pipeCols(line), pipeCols(next), 1)
      out.push(`|${Array.from({ length: cols }, () => ' --- ').join('|')}|`)
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}
function nodeText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children)
  return ''
}

function CodeFrame({ lang, code }: { lang?: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* ignore */
    }
  }
  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span className="md-code-lang">{lang || 'code'}</span>
        <button
          type="button"
          className="md-code-copy"
          onClick={() => void copy()}
          aria-label={copied ? '已复制' : '复制代码'}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  )
}

function MdCode({ className, children, ...props }: ComponentProps<'code'>) {
  const text = nodeText(children).replace(/\n$/, '')
  const lang = /language-([\w+-]+)/.exec(className || '')?.[1]
  const block = Boolean(lang) || text.includes('\n')
  if (!block) {
    return (
      <code className="md-inline" {...props}>
        {children}
      </code>
    )
  }
  return <CodeFrame lang={lang} code={text} />
}

const MarkdownView = memo(function MarkdownView({ content, compact }: { content: string; compact?: boolean }) {
  return (
    <div className={`markdown-body${compact ? ' markdown-compact' : ''}`}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: MdCode,
          table: ({ children }) => (
            <div className="md-table-wrap">
              <table>{children}</table>
            </div>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          img: ({ src, alt }) => <img src={src} alt={alt || ''} loading="lazy" />,
        }}
      >
        {normalizeMarkdown(content)}
      </Markdown>
    </div>
  )
})

export default MarkdownView

/** Workspace file preview only — chat timeline must not route through this for tool payloads. */
export function FormattedBlock({ text }: { text: string }) {
  const trimmed = text.trim()
  if (!trimmed) return <div className="text-xs text-muted">（空）</div>
  if (/```/.test(trimmed) || /\|.+\|/.test(trimmed) || /^#{1,6}\s/m.test(trimmed)) {
    return <MarkdownView content={trimmed} compact />
  }
  // Pretty-print JSON only when previewing a .json workspace file, not in conversation.
  if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && looksJson(trimmed)) {
    try {
      return <CodeFrame lang="json" code={JSON.stringify(JSON.parse(trimmed), null, 2)} />
    } catch {
      return <CodeFrame lang="json" code={trimmed} />
    }
  }
  return <CodeFrame lang="text" code={trimmed} />
}

function looksJson(value: string): boolean {
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}
