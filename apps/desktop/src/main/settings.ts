import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { AppSettings } from '../shared/protocol'

const FILE = () => path.join(app.getPath('userData'), 'settings.json')

const DEFAULTS: AppSettings = {
  apiBase: 'http://127.0.0.1:8787/v1',
  apiKey: '',
  model: 'deepseek-chat',
  defaultWorkspace: '',
  permissionMode: 'default',
  closeToTray: true,
  shopUrl: 'http://127.0.0.1:8787',
  userEmail: '',
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

function migrateApiBase(value?: string): string {
  const next = (value || '').trim()
  if (!next || isUpstreamGateway(next)) return DEFAULTS.apiBase
  return next
}

function migrateShopUrl(value?: string, apiBase?: string): string {
  const next = (value || '').trim()
  if (!next || isUpstreamGateway(next)) {
    return migrateApiBase(apiBase).replace(/\/v1\/?$/, '') || DEFAULTS.shopUrl
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
      ...DEFAULTS,
      model: raw.model || DEFAULTS.model,
      defaultWorkspace: raw.defaultWorkspace || DEFAULTS.defaultWorkspace,
      permissionMode: raw.permissionMode || DEFAULTS.permissionMode,
      closeToTray: raw.closeToTray ?? DEFAULTS.closeToTray,
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
    return { ...DEFAULTS }
  }
}

export function saveSettings(next: AppSettings): AppSettings {
  const dir = path.dirname(FILE())
  fs.mkdirSync(dir, { recursive: true })
  const persisted: Persisted = {
    apiBase: migrateApiBase(next.apiBase),
    model: next.model.trim() || DEFAULTS.model,
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
