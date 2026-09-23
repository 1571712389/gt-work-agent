import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

interface DwsRunner {
  file: string
}

export interface ReportField {
  key: string
  sort: string
  type: string
}

export interface ReportTemplate {
  id: string
  name: string
  fields: ReportField[]
}

let runnerPromise: Promise<DwsRunner> | null = null
let loginInflight: Promise<string> | null = null

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function quoteCmd(value: string): string {
  if (!value) return '""'
  if (!/[\s"&|<>^%]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

function installDir(): string {
  return path.join(app.getPath('userData'), 'dws-cli')
}

function whereCommand(name: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `where ${name}`], {
      windowsHide: true,
    })
    let out = ''
    child.stdout?.on('data', (buf: Buffer) => {
      out += buf.toString('utf8')
    })
    child.on('error', () => resolve(null))
    child.on('close', (code) => {
      if (code !== 0) {
        resolve(null)
        return
      }
      const line = out
        .split(/\r?\n/)
        .map((item) => item.trim())
        .find(Boolean)
      resolve(line || null)
    })
  })
}

function locateInstalled(): string | null {
  const root = installDir()
  const pkgFile = path.join(root, 'node_modules', 'dingtalk-workspace-cli', 'package.json')
  if (fs.existsSync(pkgFile)) {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8')) as { bin?: string | Record<string, string> }
    const rel = !pkg.bin ? '' : typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.dws || ''
    const script = rel ? path.join(root, 'node_modules', 'dingtalk-workspace-cli', rel) : ''
    if (script && fs.existsSync(script)) return script
  }
  const bins = ['dws.exe', 'dws.cmd', 'dws'].map((name) => path.join(root, 'node_modules', '.bin', name))
  return bins.find((file) => fs.existsSync(file)) || null
}

function spawnCaptured(file: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const command = [quoteCmd(file), ...args.map(quoteCmd)].join(' ')
    const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
      windowsHide: true,
      windowsVerbatimArguments: true,
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('准备钉钉登录组件超时，请检查网络后重试。'))
    }, timeoutMs)
    child.stdout?.on('data', (buf: Buffer) => {
      stdout = (stdout + buf.toString('utf8')).slice(-8000)
    })
    child.stderr?.on('data', (buf: Buffer) => {
      stderr = (stderr + buf.toString('utf8')).slice(-8000)
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

async function installCli(): Promise<string> {
  const npm = await whereCommand('npm')
  if (!npm) throw new Error('本机还没有 Node.js，暂时无法准备钉钉登录。请安装 Node.js 后重试。')
  const dir = installDir()
  fs.mkdirSync(dir, { recursive: true })
  const installed = await spawnCaptured(
    npm,
    ['install', 'dingtalk-workspace-cli', '--prefix', dir, '--registry', 'https://registry.npmmirror.com', '--no-fund', '--no-audit'],
    5 * 60 * 1000,
  )
  const file = locateInstalled()
  if (installed.code !== 0 || !file) {
    throw new Error('准备钉钉登录组件失败。请检查网络后重试。')
  }
  return file
}

async function resolveRunner(): Promise<DwsRunner> {
  const onPath = await whereCommand('dws')
  if (onPath && fs.existsSync(onPath)) return { file: onPath }
  const bundled = locateInstalled()
  if (bundled) return { file: bundled }
  return { file: await installCli() }
}

function ensureRunner(): Promise<DwsRunner> {
  if (!runnerPromise) {
    runnerPromise = resolveRunner().catch((err) => {
      runnerPromise = null
      throw err
    })
  }
  return runnerPromise
}

function spawnDws(runner: DwsRunner, args: string[], cwd?: string): ChildProcess {
  if (runner.file.endsWith('.js') || runner.file.endsWith('.mjs') || runner.file.endsWith('.cjs')) {
    return spawn(process.execPath, [runner.file, ...args], {
      cwd,
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })
  }
  const command = [quoteCmd(runner.file), ...args.map(quoteCmd)].join(' ')
  return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
    cwd,
    windowsHide: true,
    windowsVerbatimArguments: true,
  })
}

export async function runDws(
  args: string[],
  options?: { timeoutMs?: number; cwd?: string },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const runner = await ensureRunner()
  const timeoutMs = options?.timeoutMs ?? 60_000
  return new Promise((resolve, reject) => {
    const child = spawnDws(runner, args, options?.cwd)
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('钉钉操作超时，请稍后重试。'))
    }, timeoutMs)
    child.stdout?.on('data', (buf: Buffer) => {
      stdout = (stdout + buf.toString('utf8')).slice(-20000)
    })
    child.stderr?.on('data', (buf: Buffer) => {
      stderr = (stderr + buf.toString('utf8')).slice(-8000)
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

function parseCliJson(text: string): unknown {
  const trimmed = text.trim()
  const objAt = trimmed.indexOf('{')
  const arrAt = trimmed.indexOf('[')
  const start =
    objAt < 0 ? arrAt : arrAt < 0 ? objAt : Math.min(objAt, arrAt)
  if (start < 0) throw new Error('钉钉没有返回可识别的结果。')
  return JSON.parse(trimmed.slice(start)) as unknown
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function textOf(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

function readFields(node: unknown): ReportField[] {
  const found: ReportField[] = []
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      const rows = value
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))
      const parsed = rows
        .map((row, index) => {
          const key = textOf(row.field_name) || textOf(row.fieldName) || textOf(row.key)
          if (!key) return null
          return {
            key,
            sort: textOf(row.field_sort) || textOf(row.fieldSort) || textOf(row.sort) || String(index + 1),
            type: textOf(row.field_type) || textOf(row.fieldType) || textOf(row.type) || 'text',
          }
        })
        .filter((item): item is ReportField => Boolean(item))
      if (parsed.length) {
        found.push(...parsed)
        return
      }
      value.forEach(visit)
      return
    }
    const rec = asRecord(value)
    if (!rec) return
    Object.values(rec).forEach(visit)
  }
  visit(node)
  const seen = new Set<string>()
  return found.filter((item) => {
    if (seen.has(item.key)) return false
    seen.add(item.key)
    return true
  })
}

function collectTemplates(node: unknown, out: ReportTemplate[], seen: Set<string>): void {
  if (Array.isArray(node)) {
    node.forEach((item) => collectTemplates(item, out, seen))
    return
  }
  const rec = asRecord(node)
  if (!rec) return
  const name = textOf(rec.name) || textOf(rec.template_name) || textOf(rec.templateName)
  const id =
    textOf(rec.report_template_id) ||
    textOf(rec.reportTemplateId) ||
    textOf(rec.template_id) ||
    textOf(rec.templateId)
  if (name && id && !seen.has(id)) {
    seen.add(id)
    out.push({ id, name, fields: readFields(rec) })
  }
  Object.values(rec).forEach((value) => {
    if (value && typeof value === 'object') collectTemplates(value, out, seen)
  })
}

interface AuthState {
  ok: boolean
  inconclusive: boolean
  label: string
}

function readAuthState(payload: unknown): AuthState {
  let ok = false
  let reason = ''
  let label = ''
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    const rec = asRecord(value)
    if (!rec) return
    if (rec.authenticated === true) ok = true
    if (!reason && typeof rec.reason === 'string') reason = rec.reason
    if (!label) {
      const corp = textOf(rec.corpName) || textOf(rec.orgName) || textOf(rec.corp_name)
      const user = textOf(rec.userName) || textOf(rec.nick) || textOf(rec.name)
      if (corp && user && user !== corp) label = `${corp} / ${user}`
    }
    Object.values(rec).forEach(visit)
  }
  visit(payload)
  return {
    ok,
    inconclusive: !ok && /local_state_requires_repair|local_state_unreadable/.test(reason),
    label,
  }
}

async function readAuth(): Promise<AuthState> {
  const readonly = await runDws(['auth', 'status', '--readonly', '--format', 'json'], { timeoutMs: 20_000 })
  let state: AuthState = { ok: false, inconclusive: true, label: '' }
  try {
    state = readAuthState(parseCliJson(readonly.stdout))
  } catch {
    state = { ok: false, inconclusive: true, label: '' }
  }
  if (!state.inconclusive) return state
  const full = await runDws(['auth', 'status', '--format', 'json'], { timeoutMs: 30_000 })
  if (full.code !== 0) return state
  try {
    return readAuthState(parseCliJson(full.stdout))
  } catch {
    return state
  }
}

function loginFailure(output: string): string {
  if (/cli access|hasn't enabled|未开启|未开通|向管理员|access request|apply now/i.test(output)) {
    return '你的企业还没开通钉钉 CLI。请管理员在钉钉开发者平台打开「CLI 访问管理」，或在登录页向管理员申请，通过后再点一次连接。'
  }
  return '钉钉登录没有完成。请在浏览器里扫码，并选择你自己的企业。若页面提示未开通，让管理员打开「CLI 访问管理」后再试。'
}

async function doLogin(): Promise<string> {
  const runner = await ensureRunner()
  const child = spawnDws(runner, ['auth', 'login'])
  let output = ''
  child.stdout?.on('data', (buf: Buffer) => {
    output = (output + buf.toString('utf8')).slice(-8000)
  })
  child.stderr?.on('data', (buf: Buffer) => {
    output = (output + buf.toString('utf8')).slice(-8000)
  })
  const exitCode = new Promise<number>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? 1))
  })
  let settled = false
  let code = 1
  const finished = exitCode
    .then((value) => {
      settled = true
      code = value
    })
    .catch((err: unknown) => {
      settled = true
      code = 1
      output += err instanceof Error ? err.message : ''
    })
  const deadline = Date.now() + 10 * 60 * 1000
  while (!settled && Date.now() < deadline) {
    await sleep(1000)
  }
  if (!settled) {
    child.kill()
    await finished
    throw new Error('登录超时。请在浏览器里完成扫码后再试一次。')
  }
  await finished
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const state = await readAuth().catch(() => null)
    if (state?.ok) return state.label
    await sleep(1200)
  }
  if (code !== 0) throw new Error(loginFailure(output))
  throw new Error(loginFailure(output))
}

export function loginDingTalkCli(): Promise<string> {
  if (!loginInflight) {
    loginInflight = doLogin().finally(() => {
      loginInflight = null
    })
  }
  return loginInflight
}

function assertOk(result: { code: number; stdout: string; stderr: string }, fallback: string): unknown {
  if (result.code !== 0) throw new Error(fallback)
  try {
    return parseCliJson(result.stdout)
  } catch {
    throw new Error(fallback)
  }
}

function reportFailure(output: string): string {
  if (/auth login|not authenticated|未登录|invalid credential|401/i.test(output)) {
    return '钉钉登录已失效。请到连接器里重新点一次钉钉，在浏览器完成登录。'
  }
  if (/cli access|hasn't enabled|未开通|向管理员/i.test(output)) {
    return '你的企业还没开通钉钉 CLI。请管理员打开「CLI 访问管理」后再试。'
  }
  if (/template|field|模板|栏目/i.test(output)) {
    return '日志模板或填写内容不匹配。请先查看模板，再按栏目分开填写。'
  }
  return '钉钉日志操作失败。请稍后重试，或到连接器里重新登录钉钉。'
}

export async function listReportTemplates(): Promise<ReportTemplate[]> {
  const listed = await runDws(['report', 'template', 'list', '--format', 'json'], { timeoutMs: 45_000 })
  const payload = assertOk(listed, reportFailure(`${listed.stdout}\n${listed.stderr}`))
  const templates: ReportTemplate[] = []
  collectTemplates(payload, templates, new Set())
  return templates
}

function pickTemplate(list: ReportTemplate[], wanted?: string): ReportTemplate | undefined {
  const query = wanted?.trim()
  if (query) {
    return (
      list.find((item) => item.name === query) ||
      list.find((item) => item.name.includes(query) || query.includes(item.name))
    )
  }
  return list.find((item) => /日报|日志/.test(item.name)) || list[0]
}

async function templateDetail(name: string): Promise<ReportTemplate> {
  const result = await runDws(['report', 'template', 'get', '--name', name, '--format', 'json'], { timeoutMs: 45_000 })
  const payload = assertOk(result, reportFailure(`${result.stdout}\n${result.stderr}`))
  const found: ReportTemplate[] = []
  collectTemplates(payload, found, new Set())
  const hit = found.find((item) => item.name === name) || found[0]
  const fields = hit?.fields?.length ? hit.fields : readFields(payload)
  if (!hit && !fields.length) throw new Error(`没有找到日志模板「${name}」。`)
  return {
    id: hit?.id || '',
    name: hit?.name || name,
    fields,
  }
}

function contentTypeFor(field: ReportField, content: string): string {
  if (/markdown|rich/i.test(field.type) || content.includes('\n')) return 'markdown'
  return 'text'
}

export async function submitReport(
  templateName: string | undefined,
  contents: Array<{ key?: string; content: string }>,
): Promise<string> {
  const filled = contents.map((item) => ({ key: item.key?.trim(), content: item.content.trim() })).filter((item) => item.content)
  if (!filled.length) throw new Error('没有可提交的日志内容。')
  const list = await listReportTemplates()
  if (!list.length) throw new Error('当前钉钉账号没有可提交的日志模板。')
  const chosen = pickTemplate(list, templateName)
  if (!chosen) throw new Error(`没有找到日志模板「${templateName || ''}」。可用模板：${list.map((item) => item.name).join('、')}`)
  const detail = await templateDetail(chosen.name)
  const templateId = detail.id || chosen.id
  const fields = detail.fields.length ? detail.fields : chosen.fields
  if (!templateId) throw new Error('这个日志模板暂时不能提交，请换一个模板。')
  if (!fields.length) throw new Error(`模板「${chosen.name}」没有可填写的栏目。`)

  const used = new Set<number>()
  const rows = fields.map((field) => {
    const matched = filled.findIndex((item, index) => !used.has(index) && item.key && (item.key === field.key || field.key.includes(item.key) || item.key.includes(field.key)))
    const index = matched >= 0 ? matched : filled.findIndex((item, itemIndex) => !used.has(itemIndex) && !item.key)
    if (index < 0) return null
    used.add(index)
    return {
      key: field.key,
      sort: field.sort,
      type: field.type,
      content: filled[index].content,
      contentType: contentTypeFor(field, filled[index].content),
    }
  })
  const missing = fields.filter((_, index) => !rows[index])
  if (missing.length) {
    throw new Error(`模板「${chosen.name}」需要分开填写这些栏目：${fields.map((item) => item.key).join('、')}。请按用户已经说过的内容拆开，不要向用户索要密钥。`)
  }

  const dir = path.join(app.getPath('userData'), 'dws-tmp')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `report-${Date.now()}.json`)
  fs.writeFileSync(file, JSON.stringify(rows.filter(Boolean)), 'utf8')
  try {
    const args = ['report', 'entry', 'submit', '--template-id', templateId, '--contents-file', file, '--format', 'json', '--yes']
    let result = await runDws(args, { timeoutMs: 60_000, cwd: dir })
    if (result.code !== 0 && /unknown flag|flag provided but not defined|unknown command/i.test(`${result.stdout}\n${result.stderr}`)) {
      result = await runDws(args.slice(0, -1), { timeoutMs: 60_000, cwd: dir })
    }
    const payload = assertOk(result, reportFailure(`${result.stdout}\n${result.stderr}`))
    const link = findLink(payload)
    return link
      ? `已用当前登录的钉钉账号提交「${chosen.name}」。可以打开：${link}`
      : `已用当前登录的钉钉账号提交「${chosen.name}」。`
  } finally {
    fs.rmSync(file, { force: true })
  }
}

function findLink(payload: unknown): string {
  let link = ''
  const visit = (value: unknown) => {
    if (link) return
    if (typeof value === 'string' && /^https?:\/\//.test(value) && /dingtalk|report/i.test(value)) {
      link = value
      return
    }
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    const rec = asRecord(value)
    if (!rec) return
    const named = textOf(rec.dingtalkOpenMarkdownLink) || textOf(rec.dingtalkOpenUrl) || textOf(rec.url)
    if (named.startsWith('http')) {
      link = named
      return
    }
    Object.values(rec).forEach(visit)
  }
  visit(payload)
  return link
}
