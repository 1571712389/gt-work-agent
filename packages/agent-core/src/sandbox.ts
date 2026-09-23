import fs from 'node:fs'
import path from 'node:path'

const WINDOWS_ROOT = /^[a-zA-Z]:[\\/]/

export function normalizePath(p: string): string {
  return path.normalize(p)
}

export function isPathInside(parent: string, child: string): boolean {
  const root = path.resolve(parent)
  const target = path.resolve(child)
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export class SandboxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SandboxError'
  }
}

export interface ResolveOptions {
  workspace: string
  extraAllowDirs?: string[]
  allowOutside?: boolean
}

export function resolveWorkspacePath(input: string, opts: ResolveOptions): string {
  if (!input || typeof input !== 'string') {
    throw new SandboxError('路径不能为空')
  }
  const trimmed = input.trim().replace(/^["']|["']$/g, '')
  const workspace = path.resolve(opts.workspace)
  const extra = (opts.extraAllowDirs || []).map((d) => path.resolve(d))
  const abs = path.isAbsolute(trimmed) || WINDOWS_ROOT.test(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(workspace, trimmed)

  if (opts.allowOutside) return abs

  const allowed = [workspace, ...extra]
  if (allowed.some((root) => isPathInside(root, abs))) return abs
  throw new SandboxError(`路径超出工作空间：${abs}`)
}

export function assertNotTraversal(input: string): void {
  if (input.includes('\0')) throw new SandboxError('非法路径')
}

export function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

export function fileLooksBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 4096))
  let suspicious = 0
  for (const byte of sample) {
    if (byte === 0) return true
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious += 1
  }
  return suspicious / sample.length > 0.3
}

export function listTree(root: string, maxEntries = 200, maxDepth = 4): string {
  const lines: string[] = []
  const walk = (dir: string, depth: number) => {
    if (lines.length >= maxEntries || depth > maxDepth) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (lines.length >= maxEntries) break
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue
      const rel = path.relative(root, path.join(dir, entry.name)).replaceAll('\\', '/')
      lines.push(entry.isDirectory() ? `${rel}/` : rel)
      if (entry.isDirectory()) walk(path.join(dir, entry.name), depth + 1)
    }
  }
  walk(root, 0)
  if (lines.length >= maxEntries) lines.push('…（已截断）')
  return lines.join('\n') || '(空目录)'
}

export const DANGEROUS_SHELL =
  /\b(format-volume|remove-item\s+-recurse|rm\s+-rf\s+[\\/]|del\s+\/s|rmdir\s+\/s|shutdown|stop-computer|restart-computer|reg\s+delete|bcdedit|diskpart|cipher\s+\/w|format\s+[a-z]:)/i

export function isDangerousShell(command: string): boolean {
  return DANGEROUS_SHELL.test(command)
}
