import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { AppSettings } from '../shared/protocol'

const FILE = () => path.join(app.getPath('userData'), 'settings.json')

const LOCAL_ORIGIN = 'http://127.0.0.1:8787'
const TEST_ORIGIN = 'http://43.139.61.253:8787'

function serviceOrigin(): string {
  return app.isPackaged ? TEST_ORIGIN : LOCAL_ORIGIN
}

function defaults(): AppSettings {
  const base = serviceOrigin()
  return {
    apiBase: `${base}/v1`,
    apiKey: '',
    model: 'deepseek-chat',
    defaultWorkspace: '',
    permissionMode: 'default',
    closeToTray: true,
    shopUrl: base,
    userEmail: '',
  }
}

interface Persisted extends Omit<AppSettings, 'apiKey'> {
  apiKeyEnc?: string
}

function decodeKey(enc?: string): string {
  if (!enc) return ''
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      return enc
    }
  }
  return enc
}

function encodeKey(key: string): string {
  if (!key) return ''
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(key).toString('base64')
  }
  return key
}

const UPSTREAM_HOST =
  /(?:^|\.)(?:deepseek\.com|openai\.com|xunjie\.ai|anthropic\.com|openrouter\.ai)$/i

function hostnameOf(url: string): string {
  try {
    return new URL(url.includes('://') ? url : `http://${url}`).hostname
  } catch {
    return ''
  }
}

export function isUpstreamGateway(url: string): boolean {
  return UPSTREAM_HOST.test(hostnameOf(url))
}

export function isLoopbackUrl(url: string): boolean {
  const host = hostnameOf(url)
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

function migrateApiBase(value?: string): string {
  const next = (value || '').trim()
  const fallback = defaults().apiBase
  if (!app.isPackaged) {
    if (!next || isUpstreamGateway(next) || !isLoopbackUrl(next)) return fallback
    return next
  }
  if (!next || isUpstreamGateway(next) || isLoopbackUrl(next)) return fallback
  return next
}

function migrateShopUrl(value?: string, apiBase?: string): string {
  const next = (value || '').trim()
  const fallback = defaults().shopUrl
  if (!app.isPackaged) {
    if (!next || isUpstreamGateway(next) || !isLoopbackUrl(next)) return fallback
    return next
  }
  if (!next || isUpstreamGateway(next) || isLoopbackUrl(next)) {
    return migrateApiBase(apiBase).replace(/\/v1\/?$/, '') || fallback
  }
  return next
}

export function loadSettings(): AppSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE(), 'utf8')) as Persisted
    const apiBase = migrateApiBase(raw.apiBase)
    const shopUrl = migrateShopUrl(raw.shopUrl, apiBase)
    const migrated = apiBase !== (raw.apiBase || '') || shopUrl !== (raw.shopUrl || '')
    const settings: AppSettings = {
      ...defaults(),
      model: raw.model || defaults().model,
      defaultWorkspace: raw.defaultWorkspace || defaults().defaultWorkspace,
      permissionMode: raw.permissionMode || defaults().permissionMode,
      closeToTray: raw.closeToTray ?? defaults().closeToTray,
      apiBase,
      apiKey: decodeKey(raw.apiKeyEnc),
      shopUrl,
      userEmail: raw.userEmail || '',
    }
    if (migrated) {
      fs.writeFileSync(
        FILE(),
        JSON.stringify(
          {
            apiBase: settings.apiBase,
            model: settings.model,
            defaultWorkspace: settings.defaultWorkspace,
            permissionMode: settings.permissionMode,
            closeToTray: settings.closeToTray,
            shopUrl: settings.shopUrl,
            userEmail: settings.userEmail,
            apiKeyEnc: raw.apiKeyEnc,
          },
          null,
          2,
        ),
      )
    }
    return settings
  } catch {
    return defaults()
  }
}

export function saveSettings(next: AppSettings): AppSettings {
  const dir = path.dirname(FILE())
  fs.mkdirSync(dir, { recursive: true })
  const persisted: Persisted = {
    apiBase: migrateApiBase(next.apiBase),
    model: next.model.trim() || defaults().model,
    defaultWorkspace: next.defaultWorkspace,
    permissionMode: next.permissionMode,
    closeToTray: next.closeToTray,
    shopUrl: migrateShopUrl(next.shopUrl, next.apiBase),
    userEmail: next.userEmail || '',
    apiKeyEnc: encodeKey(next.apiKey.trim()),
  }
  fs.writeFileSync(FILE(), JSON.stringify(persisted, null, 2))
  return loadSettings()
}
