import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { builtinTools, loadExpertsFromDir, loadSkillsFromDir, resolveWorkspacePath, SandboxError, toolsForMode } from './index.ts'

const ws = path.join(os.tmpdir(), `gt-verify-${Date.now()}`)
fs.mkdirSync(ws, { recursive: true })
fs.writeFileSync(path.join(ws, 'a.md'), '# A\nhello')
fs.writeFileSync(path.join(ws, 'b.md'), '# B\nworld')

let failed = 0
function check(name: string, cond: boolean): void {
  if (!cond) {
    failed += 1
    console.error(`FAIL ${name}`)
  } else console.log(`ok   ${name}`)
}

check('sandbox relative', resolveWorkspacePath('summary.md', { workspace: ws }).startsWith(ws))
try {
  resolveWorkspacePath('../outside.txt', { workspace: ws })
  check('sandbox traversal blocked', false)
} catch (err) {
  check('sandbox traversal blocked', err instanceof SandboxError)
}

const ask = toolsForMode(builtinTools(), 'ask', false).map((t) => t.spec.function.name)
check('ask has Read', ask.includes('Read'))
check('ask no Write', !ask.includes('Write'))

const plan = toolsForMode(builtinTools(), 'plan', true).map((t) => t.spec.function.name)
check('plan has SubmitPlan', plan.includes('SubmitPlan'))
check('plan no Write', !plan.includes('Write'))

const craft = toolsForMode(builtinTools(), 'craft', false).map((t) => t.spec.function.name)
check('craft has Write', craft.includes('Write'))

const write = builtinTools().find((t) => t.spec.function.name === 'Write')!
const ctx = {
  taskId: 'verify',
  workspace: ws,
  extraAllowDirs: [],
  mode: 'craft' as const,
  permissionMode: 'bypass' as const,
  onEvent: () => undefined,
  requestPermission: async () => 'allow' as const,
  askUser: async () => ({}),
}
await write.execute({ path: 'summary.md', content: '# 汇总\n- hello\n- world\n' }, ctx)
check('craft write created file', fs.existsSync(path.join(ws, 'summary.md')))
check('craft write content', fs.readFileSync(path.join(ws, 'summary.md'), 'utf8').includes('汇总'))

try {
  await write.execute({ path: '../escape.md', content: 'nope' }, ctx)
  check('write cannot escape workspace', false)
} catch (err) {
  check('write cannot escape workspace', err instanceof SandboxError)
}

const here = path.dirname(fileURLToPath(import.meta.url))
const skills = loadSkillsFromDir(path.resolve(here, '../../skills'))
check('skills loaded', skills.some((s) => s.id === 'weekly-report'))
const experts = loadExpertsFromDir(path.resolve(here, '../../experts'))
check('experts loaded', experts.experts.some((e) => e.id === 'writer'))
check('expert team loaded', experts.teams.some((t) => t.id === 'delivery-team'))

if (failed) {
  console.error(`verify failed: ${failed}`)
  process.exit(1)
}
console.log('Wave 1 本地规则验收通过')
