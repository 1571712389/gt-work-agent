import fs from 'node:fs/promises'
import path from 'node:path'
import { fileLooksBinary, resolveWorkspacePath, ensureParentDir } from '../sandbox'
import type { ExecutableTool, ToolResult } from '../types'

function str(args: Record<string, unknown>, key: string, fallback = ''): string {
  const value = args[key]
  return typeof value === 'string' ? value : fallback
}

function num(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key]
  return typeof value === 'number' ? value : undefined
}

function bool(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true
}

const MAX_READ = 200_000

export const fsTools: ExecutableTool[] = [
  {
    spec: {
      type: 'function',
      function: {
        name: 'Read',
        description: '读取工作空间内的文本文件。可用 offset/limit 按行截取。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '相对工作空间的路径' },
            offset: { type: 'number', description: '起始行，从 1 开始' },
            limit: { type: 'number', description: '读取行数' },
          },
          required: ['path'],
        },
      },
    },
    risk: 'low',
    readonly: true,
    async execute(args, ctx): Promise<ToolResult> {
      const abs = resolveWorkspacePath(str(args, 'path'), {
        workspace: ctx.workspace,
        extraAllowDirs: ctx.extraAllowDirs,
      })
      const buf = await fs.readFile(abs)
      if (fileLooksBinary(buf)) return { ok: false, content: '该文件看起来是二进制，无法按文本读取。' }
      let text = buf.toString('utf8')
      if (text.length > MAX_READ) text = `${text.slice(0, MAX_READ)}\n…（已截断）`
      const lines = text.split(/\r?\n/)
      const offset = Math.max(1, num(args, 'offset') || 1)
      const limit = num(args, 'limit') || lines.length
      const sliced = lines.slice(offset - 1, offset - 1 + limit)
      const numbered = sliced.map((line, i) => `${String(offset + i).padStart(5, ' ')}|${line}`).join('\n')
      return { ok: true, title: path.relative(ctx.workspace, abs), content: numbered || '(空文件)' }
    },
  },
  {
    spec: {
      type: 'function',
      function: {
        name: 'Write',
        description: '写入（覆盖）工作空间内的文本文件。必要时自动创建父目录。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['path', 'content'],
        },
      },
    },
    risk: 'medium',
    readonly: false,
    async execute(args, ctx): Promise<ToolResult> {
      const abs = resolveWorkspacePath(str(args, 'path'), {
        workspace: ctx.workspace,
        extraAllowDirs: ctx.extraAllowDirs,
      })
      ensureParentDir(abs)
      await fs.writeFile(abs, str(args, 'content'), 'utf8')
      return { ok: true, title: path.relative(ctx.workspace, abs), content: `已写入 ${abs}` }
    },
  },
  {
    spec: {
      type: 'function',
      function: {
        name: 'Edit',
        description: '在文件中精确替换一段文本。old_string 必须在文件中唯一，除非 replace_all 为 true。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            old_string: { type: 'string' },
            new_string: { type: 'string' },
            replace_all: { type: 'boolean' },
          },
          required: ['path', 'old_string', 'new_string'],
        },
      },
    },
    risk: 'medium',
    readonly: false,
    async execute(args, ctx): Promise<ToolResult> {
      const abs = resolveWorkspacePath(str(args, 'path'), {
        workspace: ctx.workspace,
        extraAllowDirs: ctx.extraAllowDirs,
      })
      const original = await fs.readFile(abs, 'utf8')
      const oldStr = str(args, 'old_string')
      const newStr = str(args, 'new_string')
      if (!original.includes(oldStr)) return { ok: false, content: '未找到 old_string，未修改文件。' }
      const next = bool(args, 'replace_all')
        ? original.split(oldStr).join(newStr)
        : original.replace(oldStr, newStr)
      if (!bool(args, 'replace_all') && original.split(oldStr).length > 2) {
        return { ok: false, content: 'old_string 匹配多处，请提供更多上下文或使用 replace_all。' }
      }
      await fs.writeFile(abs, next, 'utf8')
      return { ok: true, title: path.relative(ctx.workspace, abs), content: `已更新 ${abs}` }
    },
  },
  {
    spec: {
      type: 'function',
      function: {
        name: 'Glob',
        description: '按 glob 模式列出工作空间文件，例如 **/*.md。',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string' },
            path: { type: 'string', description: '可选子目录' },
          },
          required: ['pattern'],
        },
      },
    },
    risk: 'low',
    readonly: true,
    async execute(args, ctx): Promise<ToolResult> {
      const root = resolveWorkspacePath(str(args, 'path', '.'), {
        workspace: ctx.workspace,
        extraAllowDirs: ctx.extraAllowDirs,
      })
      const matches: string[] = []
      for await (const entry of fs.glob(str(args, 'pattern', '**/*'), { cwd: root })) {
        matches.push(entry.replaceAll('\\', '/'))
        if (matches.length >= 400) break
      }
      return {
        ok: true,
        title: `${matches.length} files`,
        content: matches.join('\n') || '(无匹配)',
      }
    },
  },
  {
    spec: {
      type: 'function',
      function: {
        name: 'Grep',
        description: '在工作空间文本文件中搜索正则或普通字符串。',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string' },
            path: { type: 'string' },
            glob: { type: 'string' },
            case_insensitive: { type: 'boolean' },
          },
          required: ['pattern'],
        },
      },
    },
    risk: 'low',
    readonly: true,
    async execute(args, ctx): Promise<ToolResult> {
      const root = resolveWorkspacePath(str(args, 'path', '.'), {
        workspace: ctx.workspace,
        extraAllowDirs: ctx.extraAllowDirs,
      })
      const globPat = str(args, 'glob', '**/*.{md,txt,json,ts,tsx,js,jsx,css,html,csv,yml,yaml}')
      let regex: RegExp
      try {
        regex = new RegExp(str(args, 'pattern'), bool(args, 'case_insensitive') ? 'i' : '')
      } catch {
        return { ok: false, content: '无效正则' }
      }
      const hits: string[] = []
      for await (const rel of fs.glob(globPat, { cwd: root })) {
        const abs = path.join(root, rel)
        let text: string
        try {
          const buf = await fs.readFile(abs)
          if (fileLooksBinary(buf)) continue
          text = buf.toString('utf8')
        } catch {
          continue
        }
        const lines = text.split(/\r?\n/)
        lines.forEach((line, i) => {
          if (hits.length >= 200) return
          if (regex.test(line)) hits.push(`${rel.replaceAll('\\', '/')}:${i + 1}:${line.slice(0, 240)}`)
        })
        if (hits.length >= 200) break
      }
      return { ok: true, title: `${hits.length} hits`, content: hits.join('\n') || '(无匹配)' }
    },
  },
]
