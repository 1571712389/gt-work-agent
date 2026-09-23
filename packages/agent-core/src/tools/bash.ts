import { spawn } from 'node:child_process'
import { isDangerousShell, resolveWorkspacePath } from '../sandbox'
import type { ExecutableTool } from '../types'

export const bashTool: ExecutableTool = {
  spec: {
    type: 'function',
    function: {
      name: 'Bash',
      description: '在工作空间中执行一条 PowerShell 命令。禁止格式化磁盘、关机、删除系统目录等危险操作。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          timeout_ms: { type: 'number', description: '超时毫秒，默认 30000' },
        },
        required: ['command'],
      },
    },
  },
  risk: 'high',
  readonly: false,
  async execute(args, ctx) {
    const command = String(args.command || '').trim()
    if (!command) return { ok: false, content: '命令为空' }
    if (isDangerousShell(command)) return { ok: false, content: '已拦截危险命令。' }
    resolveWorkspacePath('.', { workspace: ctx.workspace, extraAllowDirs: ctx.extraAllowDirs })
    const timeout = Math.min(Number(args.timeout_ms) || 30_000, 120_000)
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
        cwd: ctx.workspace,
        windowsHide: true,
      })
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error('命令超时'))
      }, timeout)
      child.stdout.on('data', (d) => {
        stdout += d.toString()
        if (stdout.length > 80_000) stdout = `${stdout.slice(0, 80_000)}\n…`
      })
      child.stderr.on('data', (d) => {
        stderr += d.toString()
      })
      child.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve(`exit ${code}\n${stdout}${stderr ? `\nSTDERR:\n${stderr}` : ''}`.trim())
      })
      ctx.signal?.addEventListener('abort', () => {
        child.kill()
      })
    })
    return { ok: true, title: command.slice(0, 80), content: output || '(无输出)' }
  },
}
