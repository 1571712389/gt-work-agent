import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { isDangerousShell, isPathInside, resolveWorkspacePath, SandboxError } from './sandbox'
import { toolAllowedInMode } from './permissions'
import { toolsForMode, builtinTools } from './tools'

test('sandbox keeps relative paths inside workspace', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ws-'))
  const resolved = resolveWorkspacePath('notes/a.md', { workspace: ws })
  assert.ok(isPathInside(ws, resolved))
})

test('sandbox rejects path traversal', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ws-'))
  assert.throws(() => resolveWorkspacePath('../secret.txt', { workspace: ws }), SandboxError)
})

test('ask mode forbids write tools', () => {
  assert.equal(toolAllowedInMode('Write', 'ask', false), false)
  assert.equal(toolAllowedInMode('Read', 'ask', false), true)
  const names = toolsForMode(builtinTools(), 'ask', true).map((t) => t.spec.function.name)
  assert.ok(names.includes('Read'))
  assert.ok(!names.includes('Write'))
  assert.ok(!names.includes('Bash'))
})

test('plan mode while planning only allows SubmitPlan as non-readonly', () => {
  const names = toolsForMode(builtinTools(), 'plan', true).map((t) => t.spec.function.name)
  assert.ok(names.includes('SubmitPlan'))
  assert.ok(names.includes('Read'))
  assert.ok(!names.includes('Write'))
  assert.ok(!names.includes('Bash'))
})

test('craft mode exposes write tools', () => {
  const names = toolsForMode(builtinTools(), 'craft', false).map((t) => t.spec.function.name)
  assert.ok(names.includes('Write'))
  assert.ok(names.includes('GenerateXlsx'))
})

test('dangerous shell is blocked', () => {
  assert.equal(isDangerousShell('Remove-Item -Recurse C:\\Windows'), true)
  assert.equal(isDangerousShell('Get-ChildItem'), false)
})
