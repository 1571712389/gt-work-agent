import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { McpInfo, ProjectInfo, TaskRecord } from '../shared/protocol'
import { loadSettings } from './settings'

function root(): string {
  return app.getPath('userData')
}

function taskScope(): string {
  const settings = loadSettings()
  if (!settings.apiKey) return ''
  const raw = (settings.userEmail || 'signed-in').trim().toLowerCase()
  return raw.replace(/[^a-z0-9@._-]+/g, '_').slice(0, 80) || 'signed-in'
}

function migrateLegacyTasks(userDir: string): void {
  const parent = path.join(root(), 'tasks')
  if (!fs.existsSync(parent)) return
  for (const name of fs.readdirSync(parent)) {
    const abs = path.join(parent, name)
    if (!name.endsWith('.json')) continue
    try {
      if (!fs.statSync(abs).isFile()) continue
      fs.mkdirSync(userDir, { recursive: true })
      fs.renameSync(abs, path.join(userDir, name))
    } catch {
      /* ignore incomplete moves */
    }
  }
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

export function tasksDir(): string {
  const scope = taskScope()
  const dir = path.join(root(), 'tasks', scope || '_guest')
  fs.mkdirSync(dir, { recursive: true })
  if (scope) migrateLegacyTasks(dir)
  return dir
}

export function listTasks(): TaskRecord[] {
  if (!loadSettings().apiKey) return []
  const dir = tasksDir()
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson<TaskRecord | null>(path.join(dir, f), null))
    .filter((t): t is TaskRecord => Boolean(t))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getTask(id: string): TaskRecord | null {
  if (!loadSettings().apiKey) return null
  return readJson<TaskRecord | null>(path.join(tasksDir(), `${id}.json`), null)
}

export function saveTask(task: TaskRecord): void {
  if (!loadSettings().apiKey) return
  const file = path.join(tasksDir(), `${task.id}.json`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(task))
}

export function deleteTask(id: string): void {
  const file = path.join(tasksDir(), `${id}.json`)
  if (fs.existsSync(file)) fs.unlinkSync(file)
}

function migrateMcpList(list: McpInfo[]): McpInfo[] {
  let changed = false
  const next = list.map((item) => {
    const args = item.args || []
    const puppeteerIdx = args.findIndex((a) => /@modelcontextprotocol\/server-puppeteer/.test(a))
    if (puppeteerIdx < 0 && item.id !== 'puppeteer') return item
    changed = true
    const patchedArgs = [...args]
    if (puppeteerIdx >= 0) patchedArgs[puppeteerIdx] = '@playwright/mcp@latest'
    else if (!patchedArgs.includes('@playwright/mcp@latest')) {
      patchedArgs.splice(0, patchedArgs.length, '-y', '@playwright/mcp@latest')
    }
    return {
      ...item,
      id: item.id === 'puppeteer' ? 'playwright' : item.id,
      args: patchedArgs,
    }
  })
  if (changed) writeJson(path.join(root(), 'mcp.json'), next)
  return next
}

export function loadMcp(): McpInfo[] {
  return migrateMcpList(readJson(path.join(root(), 'mcp.json'), []))
}

export function saveMcp(list: McpInfo[]): void {
  writeJson(path.join(root(), 'mcp.json'), list)
}

export function loadProjects(): ProjectInfo[] {
  return readJson(path.join(root(), 'projects.json'), [])
}

export function saveProjects(list: ProjectInfo[]): void {
  writeJson(path.join(root(), 'projects.json'), list)
}

export function defaultWorkspaceFor(id: string): string {
  const dir = path.join(root(), 'workspaces', id)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
