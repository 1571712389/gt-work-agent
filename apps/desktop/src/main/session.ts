import { app, BrowserWindow, dialog, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {
  expertExtraSystem,
  loadExpertsFromDir,
  loadSkillsFromDir,
  runAgent,
  type ChatContentPart,
  type ChatMessage,
  type PermissionDecision,
} from '@gt-workbench/agent-core'
import { McpHost, type McpServerConfig } from '@gt-workbench/mcp-host'
import type { AgentEvent, CreateTaskInput, MessageAttachment, TaskRecord } from '../shared/protocol'
import { isImageName } from '../shared/protocol'
import { loadSettings } from './settings'
import { dingTalkTools } from './dingtalk-tools'
import { defaultWorkspaceFor, deleteTask, getTask, listTasks, loadMcp, saveMcp, saveTask } from './store'

const mcpHost = new McpHost()

interface Waiter<T> {
  resolve: (value: T) => void
  reject: (err: Error) => void
}

const running = new Map<
  string,
  {
    abort: AbortController
    permissions: Map<string, Waiter<PermissionDecision>>
    questions: Map<string, Waiter<Record<string, string>>>
  }
>()

function packRoot(rel: string): string {
  const candidates = [
    path.join(process.resourcesPath || '', 'packages', rel),
    path.resolve(__dirname, '../../../../packages', rel),
    path.resolve(process.cwd(), 'packages', rel),
    path.resolve(app.getAppPath(), '../../packages', rel),
  ]
  return candidates.find((p) => fs.existsSync(p)) || candidates[0]
}

function skillRoot(): string {
  return packRoot('skills')
}

function userSkillRoot(): string {
  const dir = path.join(app.getPath('userData'), 'skills')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function expertRoot(): string {
  return packRoot('experts')
}

const runTokens = new Map<string, number>()
const liveTasks = new Map<string, TaskRecord>()
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

function rememberTask(task: TaskRecord): TaskRecord {
  liveTasks.set(task.id, task)
  return task
}

function loadTask(id: string): TaskRecord | null {
  return liveTasks.get(id) || getTask(id)
}

function persistTask(task: TaskRecord, immediate = false): void {
  rememberTask(task)
  const pending = saveTimers.get(task.id)
  if (pending) clearTimeout(pending)
  if (immediate) {
    saveTimers.delete(task.id)
    saveTask(task)
    return
  }
  saveTimers.set(
    task.id,
    setTimeout(() => {
      saveTimers.delete(task.id)
      const current = liveTasks.get(task.id)
      if (current) saveTask(current)
    }, 1200),
  )
}

function bumpRun(taskId: string): number {
  const next = (runTokens.get(taskId) || 0) + 1
  runTokens.set(taskId, next)
  return next
}

type HotBroadcast = {
  type: 'text' | 'reasoning'
  delta: string
  win: BrowserWindow | null
  runId?: number
  timer: ReturnType<typeof setTimeout>
}

const hotBroadcasts = new Map<string, HotBroadcast>()

function sendBroadcast(win: BrowserWindow | null, taskId: string, event: AgentEvent, runId?: number): void {
  if (runId != null && runTokens.get(taskId) !== runId) return
  const payload = { taskId, event, runId }
  const windows = win && !win.isDestroyed() ? [win] : BrowserWindow.getAllWindows()
  for (const item of windows) {
    if (!item.isDestroyed()) item.webContents.send('agent:event', payload)
  }
}

function flushHotBroadcast(taskId: string): void {
  const slot = hotBroadcasts.get(taskId)
  if (!slot) return
  clearTimeout(slot.timer)
  hotBroadcasts.delete(taskId)
  if (!slot.delta) return
  sendBroadcast(slot.win, taskId, { type: slot.type, delta: slot.delta }, slot.runId)
}

function broadcast(win: BrowserWindow | null, taskId: string, event: AgentEvent, runId?: number): void {
  if (event.type !== 'text' && event.type !== 'reasoning') {
    flushHotBroadcast(taskId)
    sendBroadcast(win, taskId, event, runId)
    return
  }
  const slot = hotBroadcasts.get(taskId)
  if (slot && slot.type === event.type) {
    slot.delta += event.delta
    slot.win = win
    slot.runId = runId
    return
  }
  if (slot) flushHotBroadcast(taskId)
  const timer = setTimeout(() => flushHotBroadcast(taskId), 32)
  hotBroadcasts.set(taskId, { type: event.type, delta: event.delta, win, runId, timer })
}

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

function imageMime(file: string): string | null {
  return IMAGE_MIME[path.extname(file).toLowerCase()] || null
}

function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 6) {
    const head = buf.toString('ascii', 0, 6)
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif'
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

function fileToImagePart(abs: string): ChatContentPart | null {
  try {
    const stat = fs.statSync(abs)
    if (!stat.isFile() || !stat.size || stat.size > MAX_IMAGE_BYTES) return null
    const buf = fs.readFileSync(abs)
    const mime = imageMime(abs) || sniffImageMime(buf)
    if (!mime) return null
    return { type: 'image_url', image_url: { url: `data:${mime};base64,${buf.toString('base64')}` } }
  } catch {
    return null
  }
}

function toAttachments(files: string[]): MessageAttachment[] {
  return files.map((file) => ({
    path: file,
    name: path.basename(file),
    kind: isImageName(file) || fileToImagePart(file) ? 'image' : 'file',
  }))
}

function userPrompt(text: string, attachments: MessageAttachment[]): string {
  const trimmed = text.trim()
  if (trimmed) return trimmed
  if (attachments.some((item) => item.kind === 'image')) return '请识别这些图片里的内容，并说明关键信息。'
  if (attachments.length) return '请查看我放入工作空间的附件。'
  return ''
}

function toCoreMessages(task: TaskRecord): ChatMessage[] {
  const userIndexes = task.messages.map((m, i) => (m.role === 'user' ? i : -1)).filter((i) => i >= 0)
  const visionIndexes = new Set(userIndexes.slice(-2))
  return task.messages.flatMap((m, i) => {
    if (m.role === 'assistant' && !m.tool && m.content.trim()) {
      return [{ role: 'assistant' as const, content: m.content }]
    }
    if (m.role !== 'user') return []
    const attachments = m.attachments || []
    const images: MessageAttachment[] = []
    const files: MessageAttachment[] = []
    for (const item of attachments) {
      if (item.kind === 'image' || isImageName(item.path || item.name) || fileToImagePart(item.path)) images.push(item)
      else files.push(item)
    }
    const notes: string[] = []
    if (m.content.trim()) notes.push(m.content.trim())
    if (files.length) {
      notes.push(`附件已放入工作空间 inbox，可用工具读取：\n${files.map((item) => `- ${item.path}`).join('\n')}`)
    }
    const includeImages = visionIndexes.has(i)
    if (images.length && !includeImages) {
      notes.push(`此前发送过图片：${images.map((item) => item.name).join('、')}`)
    }
    const parts: ChatContentPart[] = []
    if (notes.length) parts.push({ type: 'text', text: notes.join('\n\n') })
    if (includeImages) {
      for (const img of images) {
        const part = fileToImagePart(img.path)
        if (part) parts.push(part)
        else parts.push({ type: 'text', text: `（无法读取图片 ${img.name}）` })
      }
    }
    if (!parts.length) return []
    if (parts.length === 1 && parts[0].type === 'text') {
      return [{ role: 'user' as const, content: parts[0].text || '' }]
    }
    return [{ role: 'user' as const, content: parts }]
  })
}

function applyEvent(task: TaskRecord, event: AgentEvent): void {
  task.updatedAt = Date.now()
  if (event.type === 'status') task.status = event.status
  if (event.type === 'plan') task.planMarkdown = event.plan.markdown
  if (event.type === 'text') {
    const last = task.messages.at(-1)
    if (last?.role === 'assistant' && !last.tool) last.content += event.delta
    else {
      task.messages.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: event.delta,
        createdAt: Date.now(),
      })
    }
  }
  if (event.type === 'reasoning') {
    const last = task.messages.at(-1)
    if (last?.role === 'assistant' && !last.tool) last.thinking = (last.thinking || '') + event.delta
    else {
      task.messages.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        thinking: event.delta,
        createdAt: Date.now(),
      })
    }
  }
  if (event.type === 'tool.start') {
    task.messages.push({
      id: event.id,
      role: 'tool',
      name: event.name,
      content: '',
      tool: { id: event.id, name: event.name, args: event.args },
      createdAt: Date.now(),
    })
  }
  if (event.type === 'tool.result') {
    const row = task.messages.find((m) => m.tool?.id === event.id)
    if (row) {
      row.content = event.result.content
      row.tool = { ...row.tool!, result: event.result.content }
    }
  }
  if (event.type === 'error') {
    task.messages.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: `错误：${event.message}`,
      createdAt: Date.now(),
    })
    task.status = 'failed'
  }
  if (event.type === 'done' && task.status === 'running') task.status = 'completed'
}

export function stopAllTasks(): void {
  for (const [id, session] of running) {
    bumpRun(id)
    for (const waiter of session.permissions.values()) waiter.reject(new Error('已退出登录'))
    session.permissions.clear()
    for (const waiter of session.questions.values()) waiter.reject(new Error('已退出登录'))
    session.questions.clear()
    session.abort.abort()
    running.delete(id)
    const task = loadTask(id)
    if (task && (task.status === 'running' || task.status === 'awaiting_permission' || task.status === 'awaiting_question')) {
      task.status = 'stopped'
      persistTask(task, true)
    }
  }
}

export async function createTask(input: CreateTaskInput): Promise<TaskRecord> {
  const settings = loadSettings()
  if (!settings.apiKey) throw new Error('请先登录后再使用对话')
  const id = crypto.randomUUID()
  const workspace = input.workspace || settings.defaultWorkspace || defaultWorkspaceFor(id)
  fs.mkdirSync(workspace, { recursive: true })
  const task: TaskRecord = {
    id,
    title: input.title || '新任务',
    workspace,
    mode: input.mode,
    status: 'idle',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    selectedSkills: input.selectedSkills || [],
    selectedExpert: input.selectedExpert || null,
    selectedTeam: input.selectedTeam || null,
    instruction: input.instruction?.trim() || undefined,
    messages: [],
  }
  saveTask(task)
  return task
}

export function allTasks(): TaskRecord[] {
  return listTasks()
}

export function patchTask(id: string, patch: Partial<TaskRecord>): TaskRecord | null {
  const task = loadTask(id)
  if (!task) return null
  Object.assign(task, patch, { id: task.id, updatedAt: Date.now() })
  persistTask(task, true)
  return task
}

export async function pickDirectory(win: BrowserWindow | null): Promise<string | null> {
  const result = await dialog.showOpenDialog(win || undefined!, {
    properties: ['openDirectory', 'createDirectory'],
  })
  return result.canceled ? null : result.filePaths[0]
}

export function listWorkspace(taskId: string) {
  const task = getTask(taskId)
  if (!task) return []
  const root = task.workspace
  if (!fs.existsSync(root)) return []
  const out: Array<{ name: string; path: string; dir: boolean; relative: string; depth: number }> = []
  const skip = new Set(['node_modules', '.git', '.DS_Store'])
  const walk = (dir: string, depth: number) => {
    if (depth > 5 || out.length >= 400) return
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort(
      (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, 'zh'),
    )
    for (const entry of entries) {
      if (skip.has(entry.name) || entry.name.startsWith('.')) continue
      const abs = path.join(dir, entry.name)
      out.push({
        name: entry.name,
        path: abs,
        dir: entry.isDirectory(),
        relative: path.relative(root, abs).replaceAll('\\', '/'),
        depth,
      })
      if (entry.isDirectory()) walk(abs, depth + 1)
      if (out.length >= 400) return
    }
  }
  walk(root, 0)
  return out
}

export function readWorkspaceFile(abs: string, taskId: string): string {
  const task = getTask(taskId)
  if (!task) throw new Error('任务不存在')
  const rel = path.relative(task.workspace, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('超出工作空间')
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) throw new Error('不是文件')
  return fs.readFileSync(abs, 'utf8').slice(0, 200_000)
}

export async function openWorkspacePath(abs: string, taskId: string): Promise<string> {
  const task = getTask(taskId)
  if (!task) throw new Error('任务不存在')
  const rel = path.relative(task.workspace, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('超出工作空间')
  return shell.openPath(abs)
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(from, to)
    else fs.copyFileSync(from, to)
  }
}

export function catalog() {
  const bundled = loadSkillsFromDir(skillRoot())
  const user = loadSkillsFromDir(userSkillRoot())
  const userById = new Map(user.map((skill) => [skill.id, skill]))
  const bundledIds = new Set(bundled.map((skill) => skill.id))
  const skills = [
    ...bundled.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tags: skill.tags,
      installed: userById.has(skill.id),
      source: 'market' as const,
    })),
    ...user
      .filter((skill) => !bundledIds.has(skill.id))
      .map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        tags: skill.tags.includes('custom') ? skill.tags : [...skill.tags, 'custom'],
        installed: true,
        source: 'custom' as const,
      })),
  ]
  return {
    skills,
    ...(() => {
      const { experts, teams } = loadExpertsFromDir(expertRoot())
      return {
        experts: experts.map(({ id, name, title, description, skillIds }) => ({
          id,
          name,
          title,
          description,
          skillIds,
        })),
        teams,
      }
    })(),
    mcp: loadMcp().map(({ env: _env, ...rest }) => rest),
  }
}

export async function connectApprovedMcp(): Promise<void> {
  for (const item of loadMcp().filter((m) => m.approved && !m.disabled)) {
    try {
      await mcpHost.connect(item as McpServerConfig)
    } catch (err) {
      console.error('MCP connect failed', item.id, err)
    }
  }
}

export async function upsertMcp(info: McpServerConfig, approve: boolean): Promise<McpServerConfig[]> {
  const list = loadMcp()
  const prev = list.find((m) => m.id === info.id)
  const next = { ...info, env: info.env || prev?.env, approved: approve || info.approved }
  const idx = list.findIndex((m) => m.id === info.id)
  if (idx >= 0) list[idx] = next
  else list.push(next)
  saveMcp(list)
  if (next.approved && !next.disabled) {
    try {
      await mcpHost.connect(next)
    } catch (err) {
      console.error('MCP connect failed', next.id, err)
    }
  } else await mcpHost.disconnect(next.id)
  return list.map(({ env: _env, ...rest }) => rest)
}

export async function removeMcp(id: string): Promise<McpServerConfig[]> {
  await mcpHost.disconnect(id)
  const list = loadMcp().filter((m) => m.id !== id)
  saveMcp(list)
  return list.map(({ env: _env, ...rest }) => rest)
}

function failTask(win: BrowserWindow | null, task: TaskRecord, message: string): void {
  applyEvent(task, { type: 'error', message })
  task.status = 'failed'
  persistTask(task, true)
  broadcast(win, task.id, { type: 'error', message })
  broadcast(win, task.id, { type: 'status', status: 'failed' })
}

export async function sendMessage(
  win: BrowserWindow | null,
  taskId: string,
  text: string,
  attachments: string[] = [],
  executePlan = false,
): Promise<void> {
  const task = loadTask(taskId)
  if (!task) throw new Error('任务不存在')
  rememberTask(task)
  const settings = loadSettings()
  if (!settings.apiKey) {
    failTask(win, task, '请先登录账户。打开「账户」页注册或登录后即可使用，无需填写厂商 API Key。')
    return
  }

  const copied = attachments.length ? copyIntoWorkspace(taskId, attachments) : []
  const atts = toAttachments(copied)
  const prompt = userPrompt(text, atts)
  if (prompt || atts.length) {
    task.messages.push({
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
      attachments: atts.length ? atts : undefined,
      createdAt: Date.now(),
    })
    if (task.title === '新任务') task.title = prompt.slice(0, 24) || task.title
  }
  task.status = 'running'
  persistTask(task, true)
  const runId = bumpRun(taskId)
  broadcast(win, task.id, { type: 'status', status: 'running' }, runId)

  const abort = new AbortController()
  const session = {
    abort,
    permissions: new Map<string, Waiter<PermissionDecision>>(),
    questions: new Map<string, Waiter<Record<string, string>>>(),
  }
  running.get(taskId)?.abort.abort()
  running.set(taskId, session)

  const { experts, teams } = loadExpertsFromDir(expertRoot())
  const expert = experts.find((e) => e.id === task.selectedExpert)
  const team = teams.find((t) => t.id === task.selectedTeam)
  const extra: string[] = []
  const expertSys = expertExtraSystem(expert, team)
  if (expertSys) extra.push(expertSys)
  if (task.instruction?.trim()) extra.push(`【项目指令】\n${task.instruction.trim()}`)
  if (executePlan && task.planMarkdown) extra.push(`【已确认方案】\n${task.planMarkdown}\n严格按该方案执行。`)
  if (atts.some((item) => item.kind === 'image')) {
    extra.push('用户消息含图片。请直接识别图像内容并据此回答，不要说看不到图片。')
  }
  const dingTalkOn = loadMcp().some((item) => item.id === 'dingtalk' && item.approved)
  if (dingTalkOn) {
    extra.push(
      '用户已在本机登录自己企业的钉钉。提交或查询钉钉日志时，只能调用 DingTalkReportTemplates 和 DingTalkSubmitReport。禁止向用户索要 AppKey、AppSecret、userid、access_token，禁止让用户创建企业内部应用或自己调用钉钉接口。日志会提交到该用户当前登录的企业。',
    )
  }

  const mcpTools = await mcpHost.asTools().catch(() => [])
  const tools = dingTalkOn ? [...mcpTools, ...dingTalkTools()] : mcpTools

  try {
    const result = await runAgent({
      taskId,
      workspace: task.workspace,
      mode: executePlan ? 'craft' : task.mode,
      permissionMode: settings.permissionMode,
      model: {
        apiBase: settings.apiBase,
        apiKey: settings.apiKey,
        model: settings.model,
        extraHeaders: { 'X-Task-Id': taskId },
      },
      messages: toCoreMessages(task),
      extraSystem: extra.join('\n'),
      selectedSkills: task.selectedSkills,
      mcpTools: tools,
      signal: abort.signal,
      loadSkillBody: async (id) => {
        const skill =
          loadSkillsFromDir(userSkillRoot()).find((s) => s.id === id) ||
          loadSkillsFromDir(skillRoot()).find((s) => s.id === id)
        return skill ? `# ${skill.name}\n${skill.body}` : null
      },
      onEvent: (event) => {
        if (runTokens.get(taskId) !== runId) return
        applyEvent(task, event as AgentEvent)
        const hot = event.type === 'text' || event.type === 'reasoning'
        persistTask(task, !hot)
        broadcast(win, taskId, event as AgentEvent, runId)
      },
      requestPermission: (req) =>
        new Promise<PermissionDecision>((resolve, reject) => {
          session.permissions.set(req.requestId, { resolve, reject })
        }),
      askUser: (q) =>
        new Promise<Record<string, string>>((resolve, reject) => {
          broadcast(win, taskId, { type: 'ask_user', question: q }, runId)
          broadcast(win, taskId, { type: 'status', status: 'awaiting_question' }, runId)
          session.questions.set(q.requestId, { resolve, reject })
        }),
      spawnSubagent: async ({ prompt, readonly }) => {
        const subMessages: ChatMessage[] = [{ role: 'user', content: prompt }]
        let acc = ''
        await runAgent({
          taskId: `${taskId}-sub`,
          workspace: task.workspace,
          mode: readonly ? 'ask' : 'craft',
          permissionMode: settings.permissionMode,
          model: {
        apiBase: settings.apiBase,
        apiKey: settings.apiKey,
        model: settings.model,
        extraHeaders: { 'X-Task-Id': taskId },
      },
          messages: subMessages,
          extraSystem: extra.join('\n'),
          signal: abort.signal,
          onEvent: (event) => {
            if (runTokens.get(taskId) !== runId) return
            if (event.type === 'text') acc += event.delta
            broadcast(win, taskId, event as AgentEvent, runId)
          },
          requestPermission: (req) =>
            new Promise((resolve, reject) => session.permissions.set(req.requestId, { resolve, reject })),
          askUser: async () => ({}),
        })
        return acc || '子任务完成'
      },
    })
    if (result.paused === 'awaiting_plan') {
      task.status = 'awaiting_plan'
      persistTask(task, true)
    }
  } catch (err) {
    if (abort.signal.aborted || runTokens.get(taskId) !== runId) {
      task.status = 'stopped'
      persistTask(task, true)
      broadcast(win, taskId, { type: 'status', status: 'stopped' }, runId)
    } else {
      failTask(win, task, err instanceof Error ? err.message : String(err))
    }
  } finally {
    running.delete(taskId)
    if (runTokens.get(taskId) === runId && task.status === 'running') {
      task.status = 'completed'
      broadcast(win, taskId, { type: 'status', status: 'completed' }, runId)
    } else if (task.status === 'stopped' && runTokens.get(taskId) === runId) {
      broadcast(win, taskId, { type: 'status', status: 'stopped' }, runId)
    }
    persistTask(task, true)
    liveTasks.delete(taskId)
  }
}

export function stopTask(taskId: string): void {
  flushHotBroadcast(taskId)
  const runId = bumpRun(taskId)
  const session = running.get(taskId)
  if (session) {
    for (const waiter of session.permissions.values()) waiter.reject(new Error('已中断'))
    session.permissions.clear()
    for (const waiter of session.questions.values()) waiter.reject(new Error('已中断'))
    session.questions.clear()
    session.abort.abort()
  }
  const task = loadTask(taskId)
  if (task) {
    task.status = 'stopped'
    persistTask(task, true)
  }
  broadcast(null, taskId, { type: 'status', status: 'stopped' }, runId)
}

export function removeTask(taskId: string): void {
  stopTask(taskId)
  const timer = saveTimers.get(taskId)
  if (timer) clearTimeout(timer)
  saveTimers.delete(taskId)
  liveTasks.delete(taskId)
  deleteTask(taskId)
}

export function resolvePermission(requestId: string, decision: PermissionDecision): void {
  for (const session of running.values()) {
    const waiter = session.permissions.get(requestId)
    if (waiter) {
      waiter.resolve(decision)
      session.permissions.delete(requestId)
    }
  }
}

export function resolveQuestion(requestId: string, answers: Record<string, string>): void {
  for (const session of running.values()) {
    const waiter = session.questions.get(requestId)
    if (waiter) {
      waiter.resolve(answers)
      session.questions.delete(requestId)
    }
  }
}

export function copyIntoWorkspace(taskId: string, files: string[]): string[] {
  const task = getTask(taskId)
  if (!task) return []
  const destDir = path.join(task.workspace, 'inbox')
  fs.mkdirSync(destDir, { recursive: true })
  const copied: string[] = []
  for (const file of files) {
    if (!file || !fs.existsSync(file)) continue
    const rel = path.relative(task.workspace, file)
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      copied.push(file)
      continue
    }
    let dest = path.join(destDir, path.basename(file))
    if (path.resolve(file) === path.resolve(dest)) {
      copied.push(dest)
      continue
    }
    if (fs.existsSync(dest)) {
      const ext = path.extname(file)
      dest = path.join(destDir, `${path.basename(file, ext)}-${Date.now()}${ext}`)
    }
    fs.copyFileSync(file, dest)
    copied.push(dest)
  }
  return copied
}

export function writeTempBytes(name: string, data: Uint8Array | ArrayBuffer): string {
  const dir = path.join(app.getPath('temp'), 'gt-inbox')
  fs.mkdirSync(dir, { recursive: true })
  const safe = (name || 'file').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_').slice(0, 80) || 'file'
  const dest = path.join(dir, `${Date.now()}-${safe}`)
  fs.writeFileSync(dest, Buffer.from(data))
  return dest
}

export function fileDataUrl(abs: string): string {
  if (!abs || !fs.existsSync(abs)) return ''
  const mime = imageMime(abs)
  if (!mime) return ''
  const buf = fs.readFileSync(abs)
  if (!buf.length || buf.length > 12 * 1024 * 1024) return ''
  return `data:${mime};base64,${buf.toString('base64')}`
}

export function fileBytes(abs: string): Uint8Array {
  if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return new Uint8Array()
  const size = fs.statSync(abs).size
  if (!size || size > 96 * 1024 * 1024) return new Uint8Array()
  return fs.readFileSync(abs)
}

export function saveUserSkill(input: { id: string; name: string; description: string; body: string }) {
  const id = input.id.trim().replace(/[^\w-]/g, '-') || `skill-${Date.now()}`
  const dir = path.join(userSkillRoot(), id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nid: ${id}\nname: ${input.name}\ndescription: ${input.description}\ntags: [custom]\n---\n\n${input.body}\n`,
  )
  return catalog().skills
}

export function saveUserSkills(inputs: Array<{ id: string; name: string; description: string; body: string }>) {
  for (const input of inputs) saveUserSkill(input)
  return catalog().skills
}

export function installSkill(skillId: string) {
  const bundled = loadSkillsFromDir(skillRoot()).find((skill) => skill.id === skillId)
  if (!bundled) throw new Error('技能市场中没有该技能')
  const dest = path.join(userSkillRoot(), skillId)
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
  copyDir(path.dirname(bundled.path), dest)
  return catalog().skills
}

export function uninstallSkill(skillId: string) {
  const dest = path.join(userSkillRoot(), skillId)
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
  return catalog().skills
}

export { getTask }
