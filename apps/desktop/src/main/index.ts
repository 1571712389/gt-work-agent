// preload 通道：skills.install / mcp.connect
import { app, BrowserWindow, ipcMain, Menu, nativeImage, net, protocol, shell, Tray } from 'electron'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
import { checkUpdate, fetchEntitlements, loginWithWebsite, logout } from './account'
import { loadSettings, saveSettings } from './settings'
import { pullTasks } from './store'
import {
  allTasks,
  catalog,
  connectApprovedMcp,
  copyIntoWorkspace,
  createTask,
  patchTask,
  listWorkspace,
  pickDirectory,
  readWorkspaceFile,
  openWorkspacePath,
  removeMcp,
  removeTask,
  resolvePermission,
  resolveQuestion,
  saveUserSkills,
  installSkill,
  uninstallSkill,
  sendMessage,
  stopTask,
  stopAllTasks,
  upsertMcp,
  writeTempBytes,
  fileDataUrl,
  fileBytes,
} from './session'
import {
  generationStatus,
  listGenerations,
  openGenerated,
  pickGenerateImage,
  quoteGeneration,
  showGenerated,
  startGeneration,
} from './generate'
import { loadProjects, saveProjects } from './store'
import { connectConnector } from './connectors'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'gt-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      bypassCSP: true,
    },
  },
])

function registerMediaProtocol(): void {
  protocol.handle('gt-media', (request) => {
    try {
      const abs = decodeURIComponent(new URL(request.url).searchParams.get('path') || '')
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return new Response('not found', { status: 404 })
      }
      return net.fetch(pathToFileURL(abs).href)
    } catch {
      return new Response('bad request', { status: 400 })
    }
  })
}
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let webLoginAbort: AbortController | null = null

function brandIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../resources/icon.png')
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: '光途Work',
    backgroundColor: '#F4F6FB',
    icon: brandIconPath(),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 保证 preload 先于页面脚本执行，避免 window.gt 未注入
      webSecurity: true,
    },
  })

  mainWindow.on('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.on('close', (event) => {
    const hideToTray = app.isPackaged && loadSettings().closeToTray && !isQuitting
    if (hideToTray) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createTray(): void {
  const icon = nativeImage.createFromPath(brandIconPath())
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('光途Work')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开主窗口', click: () => focusMain() },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true
          app.quit()
        },
      },
    ]),
  )
  tray.on('click', () => focusMain())
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', (_e, next) => saveSettings(next))
  ipcMain.handle('settings:pickDir', () => pickDirectory(mainWindow))
  ipcMain.handle('account:loginWebsite', async () => {
    webLoginAbort?.abort()
    webLoginAbort = new AbortController()
    try {
      return { ok: true, settings: await loginWithWebsite(webLoginAbort.signal) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      webLoginAbort = null
    }
  })
  ipcMain.handle('account:cancelWebLogin', () => {
    webLoginAbort?.abort()
    webLoginAbort = null
    return { ok: true }
  })
  ipcMain.handle('account:logout', () => {
    stopAllTasks()
    return logout()
  })
  ipcMain.handle('account:entitlements', () => fetchEntitlements())
  ipcMain.handle('app:checkUpdate', () => checkUpdate())
  ipcMain.handle('app:openShop', async () => {
    const settings = loadSettings()
    await shell.openExternal(settings.shopUrl || 'http://43.139.61.253:8787')
  })
  ipcMain.handle('app:openUrl', async (_e, raw: string) => {
    const url = String(raw || '')
    if (!/^https?:\/\//i.test(url)) throw new Error('仅允许打开网页链接')
    await shell.openExternal(url)
  })
  ipcMain.handle('tasks:list', async () => {
    await pullTasks()
    return allTasks()
  })
  ipcMain.handle('tasks:create', (_e, input) => createTask(input))
  ipcMain.handle('tasks:patch', (_e, id: string, patch) => patchTask(id, patch))
  ipcMain.handle('tasks:send', async (_e, taskId: string, text: string, files: string[], executePlan?: boolean) => {
    try {
      await sendMessage(mainWindow, taskId, text, files, executePlan)
      return { ok: true }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      return { ok: false, error }
    }
  })
  ipcMain.handle('tasks:stop', (_e, id: string) => stopTask(id))
  ipcMain.handle('tasks:remove', (_e, id: string) => removeTask(id))
  ipcMain.handle('tasks:permission', (_e, requestId: string, decision) => resolvePermission(requestId, decision))
  ipcMain.handle('tasks:answer', (_e, requestId: string, answers) => resolveQuestion(requestId, answers))
  ipcMain.handle('tasks:attach', (_e, taskId: string, files: string[]) => copyIntoWorkspace(taskId, files))
  ipcMain.handle('files:saveBytes', (_e, name: string, data: ArrayBuffer | Uint8Array) => writeTempBytes(name, data))
  ipcMain.handle('files:dataUrl', (_e, abs: string) => fileDataUrl(abs))
  ipcMain.handle('files:bytes', (_e, abs: string) => fileBytes(abs))
  ipcMain.handle('files:open', (_e, abs: string) => openGenerated(abs))
  ipcMain.handle('files:show', (_e, abs: string) => showGenerated(abs))
  ipcMain.handle('generate:quote', (_e, input) => quoteGeneration(input))
  ipcMain.handle('generate:start', (_e, input) => startGeneration(input))
  ipcMain.handle('generate:status', (_e, id: string) => generationStatus(id))
  ipcMain.handle('generate:list', () => listGenerations())
  ipcMain.handle('generate:pickImage', () => pickGenerateImage(mainWindow))
  ipcMain.handle('workspace:list', (_e, taskId: string) => listWorkspace(taskId))
  ipcMain.handle('workspace:read', (_e, taskId: string, abs: string) => readWorkspaceFile(abs, taskId))
  ipcMain.handle('workspace:open', (_e, taskId: string, abs: string) => openWorkspacePath(abs, taskId))
  ipcMain.handle('catalog:get', () => catalog())
  ipcMain.handle('skills:save', (_e, input) => {
    const list = Array.isArray(input) ? input : [input]
    return saveUserSkills(list)
  })
  ipcMain.handle('skills:install', (_e, skillId: string) => installSkill(skillId))
  ipcMain.handle('skills:uninstall', (_e, skillId: string) => uninstallSkill(skillId))
  ipcMain.handle('mcp:upsert', (_e, info, approve: boolean) => upsertMcp(info, approve))
  ipcMain.handle('mcp:remove', (_e, id: string) => removeMcp(id))
  ipcMain.handle('mcp:connect', (_e, id: string, token?: string) => connectConnector(id, token))
  ipcMain.handle('projects:list', () => loadProjects())
  ipcMain.handle('projects:save', (_e, list) => {
    saveProjects(list)
    return list
  })
}

function handleDeepLink(raw: string): void {
  try {
    const parsed = new URL(raw)
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('app:deep-link', {
      url: raw,
      host: parsed.hostname,
      path: parsed.pathname,
      query: Object.fromEntries(parsed.searchParams),
    })
  } catch {
    /* ignore malformed */
  }
}

function windowAlive(win: BrowserWindow | null): win is BrowserWindow {
  if (!win) return false
  try {
    return !win.isDestroyed()
  } catch {
    return false
  }
}

function focusMain(): void {
  const open = (): void => {
    try {
      if (!windowAlive(mainWindow)) {
        mainWindow = null
        createWindow()
        return
      }
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    } catch {
      mainWindow = null
      try {
        createWindow()
      } catch {
        /* 窗口已销毁时忽略，避免主进程弹窗退出 */
      }
    }
  }
  if (app.isReady()) open()
  else void app.whenReady().then(open)
}

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('gtwork', process.execPath, [resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('gtwork')
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const url = argv.find((item) => typeof item === 'string' && item.startsWith('gtwork://'))
    if (url) handleDeepLink(url)
    focusMain()
  })
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleDeepLink(url)
    focusMain()
  })
  app.whenReady().then(async () => {
    app.setAppUserModelId('com.guangtu.workbench')
    registerMediaProtocol()
    registerIpc()
    createWindow()
    createTray()
    const launchUrl = process.argv.find((item) => item.startsWith('gtwork://'))
    if (launchUrl) handleDeepLink(launchUrl)
    await connectApprovedMcp()
    // MCP 子进程日志已过滤 npm 弃用提示，避免误判为启动失败
    app.on('activate', () => {
      focusMain()
    })
  })
}

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return
  if (app.isPackaged && loadSettings().closeToTray && !isQuitting) return
  app.quit()
})
