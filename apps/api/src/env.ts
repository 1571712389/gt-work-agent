import fs from 'node:fs'
import nodePath from 'node:path'
import { fileURLToPath } from 'node:url'

function applyFile(file: string): void {
  if (!fs.existsSync(file)) return
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i <= 0) continue
    const key = line.slice(0, i).trim()
    let value = line.slice(i + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

export function loadEnv(): void {
  const here = nodePath.dirname(fileURLToPath(import.meta.url))
  const cwd = process.cwd()
  applyFile(nodePath.join(cwd, '.env'))
  applyFile(nodePath.join(cwd, 'apps', 'api', '.env'))
  applyFile(nodePath.resolve(here, '../../.env'))
  applyFile(nodePath.resolve(here, '../.env'))
}

loadEnv()

