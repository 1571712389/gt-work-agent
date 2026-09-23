import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.env.GT_UPDATES_DIR || path.join(process.env.GT_API_DATA || 'data', 'updates'))

export type DownloadAsset = {
  platform: 'windows' | 'mac'
  version: string
  file: string
  size: number
  url: string
}

export type DownloadCatalog = {
  version: string
  windows: DownloadAsset | null
  mac: DownloadAsset | null
}

const shaCache = new Map<string, string>()

function ensureDir(): void {
  fs.mkdirSync(ROOT, { recursive: true })
}

function versionOf(name: string): string {
  const hit = /(\d+\.\d+\.\d+)/.exec(name)
  return hit?.[1] || '0.0.0'
}

function cmpVersion(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff) return diff
  }
  return 0
}

function platformOf(name: string): 'windows' | 'mac' | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.exe')) return 'windows'
  if (lower.endsWith('.dmg') || lower.endsWith('.zip')) return 'mac'
  return null
}

export function updatesRoot(): string {
  ensureDir()
  return ROOT
}

export function resolveUpdateFile(name: string): string | null {
  if (!name || name !== path.basename(name)) return null
  if (!/^[\w.\-]+$/.test(name)) return null
  const root = path.resolve(updatesRoot())
  const full = path.resolve(root, name)
  const rel = path.relative(root, full)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null
  return full
}

function pick(files: string[], platform: 'windows' | 'mac'): DownloadAsset | null {
  const ranked = files
    .filter((name) => platformOf(name) === platform)
    .map((name) => ({ name, version: versionOf(name) }))
    .sort((a, b) => {
      const byVersion = cmpVersion(b.version, a.version)
      if (byVersion) return byVersion
      if (platform === 'mac') {
        const aDmg = a.name.toLowerCase().endsWith('.dmg') ? 0 : 1
        const bDmg = b.name.toLowerCase().endsWith('.dmg') ? 0 : 1
        return aDmg - bDmg
      }
      return a.name.localeCompare(b.name)
    })
  const best = ranked[0]
  if (!best) return null
  const full = resolveUpdateFile(best.name)
  if (!full) return null
  return {
    platform,
    version: best.version,
    file: best.name,
    size: fs.statSync(full).size,
    url: `/updates/${encodeURIComponent(best.name)}`,
  }
}

export function listDownloads(): DownloadCatalog {
  ensureDir()
  const files = fs.readdirSync(ROOT)
  const windows = pick(files, 'windows')
  const mac = pick(files, 'mac')
  const version = [windows?.version, mac?.version].filter(Boolean).sort((a, b) => cmpVersion(b || '0', a || '0'))[0] || '0.0.0'
  return { version, windows, mac }
}

export async function updateYaml(kind: 'windows' | 'mac'): Promise<string | null> {
  const catalog = listDownloads()
  const asset = kind === 'windows' ? catalog.windows : catalog.mac
  if (!asset) return null
  const full = resolveUpdateFile(asset.file)
  if (!full) return null
  const stat = fs.statSync(full)
  const key = `${full}:${stat.mtimeMs}:${stat.size}`
  let sha = shaCache.get(key)
  if (!sha) {
    sha = await new Promise<string>((resolve, reject) => {
      const hash = createHash('sha512')
      fs.createReadStream(full)
        .on('error', reject)
        .on('data', (chunk) => hash.update(chunk))
        .on('end', () => resolve(hash.digest('base64')))
    })
    shaCache.set(key, sha)
  }
  return [
    `version: ${asset.version}`,
    'files:',
    `  - url: ${asset.file}`,
    `    sha512: ${sha}`,
    `    size: ${asset.size}`,
    `path: ${asset.file}`,
    `sha512: ${sha}`,
    `releaseDate: ${stat.mtime.toISOString()}`,
    '',
  ].join('\n')
}
