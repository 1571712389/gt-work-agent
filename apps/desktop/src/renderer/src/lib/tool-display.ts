/** Consumer-facing labels for agent tools — never dump raw JSON to the chat UI. */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function baseFileName(path: string): string {
  if (!path) return ''
  return path.split(/[/\\]/).pop() || path
}

function pickPath(args: Record<string, unknown>): string {
  return (
    asString(args.path) ||
    asString(args.file) ||
    asString(args.filename) ||
    asString(args.target) ||
    asString(args.filePath) ||
    ''
  )
}

function looksJson(text: string): boolean {
  const t = text.trim()
  if (!(t.startsWith('{') || t.startsWith('['))) return false
  try {
    JSON.parse(t)
    return true
  } catch {
    return false
  }
}

function shortQuote(value: string, max = 36): string {
  const one = value.replace(/\s+/g, ' ').trim()
  if (!one) return ''
  return one.length > max ? `${one.slice(0, max)}…` : one
}

function friendlyToolName(name: string): string {
  const bare = name.replace(/^mcp[_:]/i, '').replace(/__/g, ' · ')
  const map: Record<string, string> = {
    Read: '读取文件',
    Write: '写入文件',
    Edit: '修改文件',
    Glob: '查找文件',
    Grep: '搜索内容',
    Bash: '执行命令',
    WebSearch: '搜索网页',
    WebFetch: '打开网页',
    AskUserQuestion: '向你提问',
    SubmitPlan: '提交方案',
    Task: '子任务',
    LoadSkill: '加载技能',
    GenerateXlsx: '生成表格',
    GeneratePptx: '生成演示文稿',
  }
  if (map[name]) return map[name]
  if (/search/i.test(bare)) return '搜索'
  if (/browser|navigate|page/i.test(bare)) return '浏览器操作'
  if (/email|mail/i.test(bare)) return '邮件'
  if (/calendar|schedule/i.test(bare)) return '日程'
  if (/drive|file|upload|download/i.test(bare)) return '文件'
  return bare.replace(/[_-]+/g, ' ') || '操作'
}

export function toolProgressLabel(tool: { name: string; args?: unknown }): string {
  const args = asRecord(tool.args)
  const file = baseFileName(pickPath(args))
  const query = asString(args.query) || asString(args.q) || asString(args.pattern)
  const url = asString(args.url)
  const command = asString(args.command)
  const skill = asString(args.id) || asString(args.skill)

  switch (tool.name) {
    case 'Write':
      return file ? `正在写入 ${file}` : '正在写入文件'
    case 'Edit':
      return file ? `正在修改 ${file}` : '正在修改文件'
    case 'Read':
      return file ? `正在读取 ${file}` : '正在读取文件'
    case 'Glob':
      return query ? `正在查找 ${shortQuote(query)}` : '正在查找文件'
    case 'Grep':
      return query ? `正在搜索「${shortQuote(query)}」` : '正在搜索内容'
    case 'Bash':
      return command ? `正在执行命令` : '正在执行命令'
    case 'WebSearch':
      return query ? `正在搜索「${shortQuote(query)}」` : '正在搜索网页'
    case 'WebFetch':
      return url ? `正在打开网页` : '正在打开网页'
    case 'GenerateXlsx':
      return '正在生成表格'
    case 'GeneratePptx':
      return '正在生成演示文稿'
    case 'LoadSkill':
      return skill ? `正在加载技能 ${skill}` : '正在加载技能'
    case 'DingTalkReportTemplates':
      return '正在查看钉钉日志模板'
    case 'DingTalkSubmitReport':
      return '正在提交钉钉日志'
    case 'SubmitPlan':
      return '正在整理方案'
    case 'AskUserQuestion':
      return '等待你的回答'
    case 'Task':
      return '正在处理子任务'
    default:
      return `正在${friendlyToolName(tool.name)}`
  }
}

export function toolDoneLabel(tool: { name: string; args?: unknown }): string {
  const args = asRecord(tool.args)
  const file = baseFileName(pickPath(args))
  const query = asString(args.query) || asString(args.q) || asString(args.pattern)
  const skill = asString(args.id) || asString(args.skill)

  switch (tool.name) {
    case 'Write':
      return file ? `已写入 ${file}` : '已写入文件'
    case 'Edit':
      return file ? `已修改 ${file}` : '已修改文件'
    case 'Read':
      return file ? `已读取 ${file}` : '已读取文件'
    case 'Glob':
      return '已完成文件查找'
    case 'Grep':
      return query ? `已搜索「${shortQuote(query)}」` : '已完成内容搜索'
    case 'Bash':
      return '命令已执行'
    case 'WebSearch':
      return query ? `已搜索「${shortQuote(query)}」` : '已完成网页搜索'
    case 'WebFetch':
      return '已打开网页'
    case 'GenerateXlsx':
      return '表格已生成'
    case 'GeneratePptx':
      return '演示文稿已生成'
    case 'LoadSkill':
      return skill ? `已加载技能 ${skill}` : '已加载技能'
    case 'DingTalkReportTemplates':
      return '已查看钉钉日志模板'
    case 'DingTalkSubmitReport':
      return '已提交钉钉日志'
    case 'SubmitPlan':
      return '方案已提交'
    case 'AskUserQuestion':
      return '已收到你的回答'
    case 'Task':
      return '子任务已完成'
    default:
      return `已完成${friendlyToolName(tool.name)}`
  }
}

/** Optional path / URL under the title — never JSON or raw args. */
export function toolContextLine(args: unknown): string {
  const rec = asRecord(args)
  const path = pickPath(rec)
  if (path) return path
  const url = asString(rec.url)
  if (url) return shortQuote(url, 72)
  return ''
}

/**
 * Human summary of a tool result for the chat timeline.
 * Returns null when nothing useful should be shown (avoid dumping payloads).
 */
export function summarizeToolResult(name: string, result: string | undefined): string | null {
  if (!result?.trim()) return null
  const text = result.trim()

  if (looksJson(text)) {
    try {
      const data = JSON.parse(text) as unknown
      if (Array.isArray(data)) return `已返回 ${data.length} 条结果`
      if (data && typeof data === 'object') {
        const keys = Object.keys(data as object)
        if (keys.includes('error') || keys.includes('message')) {
          const msg = asString((data as Record<string, unknown>).message) || asString((data as Record<string, unknown>).error)
          if (msg) return shortQuote(msg, 120)
        }
        return '操作已完成'
      }
    } catch {
      return '操作已完成'
    }
    return '操作已完成'
  }

  if (name === 'Read') {
    const lines = text.split('\n').length
    return lines > 3 ? `已读取内容（约 ${lines} 行）` : shortQuote(text, 100)
  }

  if (name === 'Bash') {
    if (text === '(无输出)' || text === '(empty)') return '命令已执行（无输出）'
    const lines = text.split('\n').filter(Boolean).length
    return lines > 2 ? `命令已执行（${lines} 行输出）` : shortQuote(text, 100)
  }

  if (name === 'WebFetch') {
    const m = /^HTTP\s+(\d+)/i.exec(text)
    if (m) return Number(m[1]) < 400 ? `网页已打开（状态 ${m[1]}）` : `打开网页失败（状态 ${m[1]}）`
    return '网页内容已获取'
  }

  if (name === 'Grep' || name === 'Glob') {
    if (text.startsWith('(无') || text.includes('无匹配')) return '未找到匹配项'
    const lines = text.split('\n').filter(Boolean).length
    return lines ? `找到 ${lines} 处结果` : '已完成搜索'
  }

  if (name === 'AskUserQuestion' && looksJson(text)) return '已记录你的选择'
  if (/^已/.test(text) || /^请求/.test(text) || /^错误/.test(text) || /^当前模式/.test(text) || /^未知工具/.test(text)) {
    return shortQuote(text, 140)
  }

  if (text.length > 160 || text.includes('\n')) {
    const first = text.split('\n').find((line) => line.trim()) || text
    return shortQuote(first, 100)
  }
  return shortQuote(text, 140)
}

/** Permission dialog: readable rows instead of JSON blob. */
export function permissionDetailRows(args: unknown): Array<{ label: string; value: string }> {
  const rec = asRecord(args)
  const rows: Array<{ label: string; value: string }> = []
  const path = pickPath(rec)
  if (path) rows.push({ label: '文件', value: path })
  const url = asString(rec.url)
  if (url) rows.push({ label: '链接', value: url })
  const command = asString(rec.command)
  if (command) rows.push({ label: '命令', value: shortQuote(command, 120) })
  const query = asString(rec.query) || asString(rec.q) || asString(rec.pattern)
  if (query) rows.push({ label: '内容', value: shortQuote(query, 120) })
  const title = asString(rec.title)
  if (title) rows.push({ label: '标题', value: title })
  if (!rows.length) {
    const entries = Object.entries(rec).filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    for (const [key, value] of entries.slice(0, 4)) {
      rows.push({ label: key, value: shortQuote(String(value), 100) })
    }
  }
  return rows
}

export function friendlyPermissionTool(name: string): string {
  return friendlyToolName(name)
}

/** If an assistant message is accidentally pure JSON, show a short note instead. */
export function humanizeMessageContent(content: string): string {
  const trimmed = content.trim()
  if (!trimmed || !looksJson(trimmed)) return content
  try {
    const data = JSON.parse(trimmed) as unknown
    if (Array.isArray(data)) return `（已处理，共 ${data.length} 项）`
    if (data && typeof data === 'object') {
      const msg = asString((data as Record<string, unknown>).message) || asString((data as Record<string, unknown>).content)
      if (msg) return msg
    }
  } catch {
    /* fallthrough */
  }
  return '（已完成相关处理）'
}
