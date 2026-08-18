const { ipcRenderer } = require('electron')
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveUtoolsRuntime } from '../runtime'

let parentWindowId
let currentWindowSingletonKey
let windowBridgeSetup = false
const singletonActivationWaiters = new Map()
const runtimeUtools = resolveUtoolsRuntime(typeof utools !== 'undefined' ? utools : undefined)
const WINDOW_SINGLETON_DIRECTORY = path.join(os.tmpdir(), 'hwinfox-utools-window-singletons-v1')
const WINDOW_SINGLETON_PENDING_TTL_MS = 8000
const WINDOW_SINGLETON_PENDING_WAIT_MS = 3000
const WINDOW_SINGLETON_ACTIVATION_TIMEOUT_MS = 240

function isDevMode() {
  return typeof process !== 'undefined' && process.env.NODE_ENV === 'development'
}

function isWatchWindowName(fileName) {
  return ['a_watch', 'watch', 'a_watch_super_lite'].includes(fileName)
}

function getWindowSingletonKey(fileName) {
  if (fileName === 'watch') return 'a_watch'
  if (fileName === 'computer') return 'a_computer'
  return typeof fileName === 'string' && fileName.trim() ? fileName.trim() : 'window'
}

function getWindowSingletonRecordPath(singletonKey) {
  const safeKey = singletonKey.replace(/[^a-z0-9_-]/gi, '_')
  return path.join(WINDOW_SINGLETON_DIRECTORY, `${safeKey}.json`)
}

function createWindowSingletonToken() {
  return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function readWindowSingletonRecord(singletonKey) {
  try {
    const recordPath = getWindowSingletonRecordPath(singletonKey)
    const parsed = JSON.parse(fs.readFileSync(recordPath, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function removeWindowSingletonRecord(singletonKey, expectedToken) {
  const recordPath = getWindowSingletonRecordPath(singletonKey)

  try {
    const current = readWindowSingletonRecord(singletonKey)
    if (expectedToken && current?.token !== expectedToken) return false
    fs.unlinkSync(recordPath)
    return true
  } catch {
    return false
  }
}

function claimWindowSingleton(singletonKey) {
  fs.mkdirSync(WINDOW_SINGLETON_DIRECTORY, { recursive: true })
  const recordPath = getWindowSingletonRecordPath(singletonKey)
  const token = createWindowSingletonToken()
  let descriptor

  try {
    descriptor = fs.openSync(recordPath, 'wx')
    fs.writeFileSync(descriptor, JSON.stringify({
      state: 'pending',
      token,
      createdAt: Date.now(),
    }))
    return { token, recordPath }
  } catch (error) {
    if (error?.code === 'EEXIST') return null
    throw error
  } finally {
    if (typeof descriptor === 'number') fs.closeSync(descriptor)
  }
}

function publishWindowSingleton(singletonKey, token, webContentsId) {
  const current = readWindowSingletonRecord(singletonKey)
  if (!current || current.token !== token) return false

  try {
    fs.writeFileSync(getWindowSingletonRecordPath(singletonKey), JSON.stringify({
      state: 'ready',
      token,
      webContentsId,
      createdAt: current.createdAt || Date.now(),
      readyAt: Date.now(),
    }), 'utf8')
    return true
  } catch {
    return false
  }
}

function waitForWindowSingletonDelay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function requestCurrentWindowActivation() {
  try {
    globalThis?.focus?.()
  } catch {
    // BrowserWindow focus below remains the authoritative path when available.
  }

  if (parentWindowId) {
    try {
      ipcRenderer.sendTo(parentWindowId, 'focus-window')
      return
    } catch {
      // Fall back to the Electron main-process bridge if the original parent is gone.
    }
  }

  ipcRenderer.send('window-action', 'focus')
}

function activateWindowSingletonRecord(singletonKey, record) {
  const webContentsId = Number(record?.webContentsId)
  if (!Number.isFinite(webContentsId) || webContentsId <= 0) return Promise.resolve(false)

  return new Promise((resolve) => {
    const requestId = createWindowSingletonToken()
    const timeoutId = setTimeout(() => {
      singletonActivationWaiters.delete(requestId)
      resolve(false)
    }, WINDOW_SINGLETON_ACTIVATION_TIMEOUT_MS)

    singletonActivationWaiters.set(requestId, {
      resolve: (activated) => {
        clearTimeout(timeoutId)
        singletonActivationWaiters.delete(requestId)
        resolve(activated)
      },
    })

    try {
      ipcRenderer.sendTo(webContentsId, 'singleton-activate', { singletonKey, requestId })
    } catch {
      clearTimeout(timeoutId)
      singletonActivationWaiters.delete(requestId)
      resolve(false)
    }
  })
}

async function reuseOrWaitForWindowSingleton(singletonKey) {
  let record = readWindowSingletonRecord(singletonKey)
  if (!record) return false

  if (record.state === 'ready') {
    const activated = await activateWindowSingletonRecord(singletonKey, record)
    if (activated) return true
    removeWindowSingletonRecord(singletonKey, record.token)
    return false
  }

  if (record.state !== 'pending') {
    removeWindowSingletonRecord(singletonKey, record.token)
    return false
  }

  const createdAt = Number(record.createdAt) || 0
  if (!createdAt || Date.now() - createdAt >= WINDOW_SINGLETON_PENDING_TTL_MS) {
    removeWindowSingletonRecord(singletonKey, record.token)
    return false
  }

  const pendingToken = record.token
  const deadline = Date.now() + WINDOW_SINGLETON_PENDING_WAIT_MS
  while (Date.now() < deadline) {
    await waitForWindowSingletonDelay(60)
    record = readWindowSingletonRecord(singletonKey)

    if (!record) return false
    if (record.token !== pendingToken) return reuseOrWaitForWindowSingleton(singletonKey)
    if (record.state === 'ready') {
      const activated = await activateWindowSingletonRecord(singletonKey, record)
      if (activated) return true
      removeWindowSingletonRecord(singletonKey, record.token)
      return false
    }
  }

  // A fresh pending record means another preload is still creating the window.
  // Do not create a duplicate just because the first BrowserWindow has not finished loading yet.
  record = readWindowSingletonRecord(singletonKey)
  if (record?.state === 'pending' && record.token === pendingToken) {
    const latestCreatedAt = Number(record.createdAt) || 0
    if (latestCreatedAt && Date.now() - latestCreatedAt < WINDOW_SINGLETON_PENDING_TTL_MS) return true
    removeWindowSingletonRecord(singletonKey, pendingToken)
  }

  return false
}

function getInitialOpaqueWindowBackgroundColor() {
  let preference = 'system'

  try {
    const mirroredPreference = globalThis?.localStorage?.getItem?.('appThemePreferenceMirror')
    if (mirroredPreference === 'light' || mirroredPreference === 'dark') {
      preference = mirroredPreference
    }
  } catch {
    // Fall through to the system preference when renderer storage is unavailable.
  }

  if (preference === 'light') return '#f3f6fa'
  if (preference === 'dark') return '#0f1722'

  try {
    return globalThis?.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? '#0f1722' : '#f3f6fa'
  } catch {
    return '#0f1722'
  }
}

function getWindowHash(fileName) {
  if (fileName === 'a_watch_super_lite') return 'watch?floatingMode=super-lite&entry=hardwareWatchSuperLite'
  if (fileName === 'a_monitor') return 'monitor'
  if (fileName === 'a_specs_lite') return 'deviceSpecs'
  return isWatchWindowName(fileName) ? 'watch?floatingMode=standard&entry=hardwareWatch' : 'computer'
}

function getProductionWindowUrl(fileName) {
  if (fileName === 'a_watch_super_lite') return 'a_watch_super_lite/index.html'
  if (fileName === 'a_monitor') return 'a_monitor/index.html'
  if (fileName === 'a_specs_lite') return 'a_specs_lite/index.html'
  if (isWatchWindowName(fileName)) return 'watch.html'
  return 'computer.html'
}

function buildChildWindowOptions(fileName, height, width, backgroundColor) {
  const isWatchWindow = isWatchWindowName(fileName)

  return {
    title: 'system info',
    height,
    width,
    useContentSize: true,
    skipTaskbar: false,
    backgroundColor: isWatchWindow
      ? `rgba(255, 255, 255, ${backgroundColor})`
      : getInitialOpaqueWindowBackgroundColor(),
    minimizable: !isWatchWindow,
    maximizable: !isWatchWindow,
    resizable: !isWatchWindow,
    fullscreenable: !isWatchWindow,
    transparent: isWatchWindow,
    frame: false,
    alwaysOnTop: isWatchWindow,
  }
}

function buildChildWindowConfig(fileName, height, width, backgroundColor) {
  return {
    singletonKey: getWindowSingletonKey(fileName),
    hash: getWindowHash(fileName),
    options: buildChildWindowOptions(fileName, height, width, backgroundColor),
  }
}

export function setupWindowBridge() {
  if (windowBridgeSetup) return
  windowBridgeSetup = true

  ipcRenderer.on('init', (event, payload = {}) => {
    parentWindowId = payload?.fromMain ? undefined : event.senderId
    currentWindowSingletonKey = typeof payload?.singletonKey === 'string'
      ? payload.singletonKey
      : currentWindowSingletonKey
  })

  ipcRenderer.on('singleton-activate', (event, payload = {}) => {
    const singletonKey = typeof payload?.singletonKey === 'string' ? payload.singletonKey : ''
    const requestId = typeof payload?.requestId === 'string' ? payload.requestId : ''
    if (!singletonKey || singletonKey !== currentWindowSingletonKey || !requestId) return

    requestCurrentWindowActivation()
    ipcRenderer.sendTo(event.senderId, 'singleton-activated', { singletonKey, requestId })
  })

  ipcRenderer.on('singleton-activated', (_event, payload = {}) => {
    const requestId = typeof payload?.requestId === 'string' ? payload.requestId : ''
    if (!requestId) return
    singletonActivationWaiters.get(requestId)?.resolve?.(true)
  })
}

function activateChildWindow(childWindow) {
  if (!childWindow || childWindow.isDestroyed?.()) return
  if (childWindow.isMinimized?.()) childWindow.restore?.()
  childWindow.show?.()
  childWindow.focus?.()
  childWindow.moveTop?.()
}

function bindChildWindowEvents(childWindow, singletonKey, singletonToken) {
  const childWindowId = childWindow.webContents.id

  const handleAlwaysOnTop = (event, { flag }) => {
    if (event.senderId === childWindowId && !childWindow.isDestroyed()) {
      childWindow.setAlwaysOnTop(Boolean(flag))
    }
  }

  const handleCloseWindow = (event) => {
    if (event.senderId === childWindowId && !childWindow.isDestroyed()) {
      childWindow.close()
    }
  }

  const handleFocusWindow = (event) => {
    if (event.senderId === childWindowId && !childWindow.isDestroyed()) {
      activateChildWindow(childWindow)
    }
  }

  const handleMinimizeWindow = (event) => {
    if (event.senderId === childWindowId && !childWindow.isDestroyed()) {
      childWindow.minimize()
    }
  }

  const handleToggleMaximizeWindow = (event) => {
    if (event.senderId === childWindowId && !childWindow.isDestroyed()) {
      if (childWindow.isMaximized()) {
        childWindow.unmaximize()
      } else {
        childWindow.maximize()
      }
    }
  }

  const handleResizeWindow = (event, { width, height }) => {
    if (event.senderId === childWindowId && !childWindow.isDestroyed()) {
      if (Number.isFinite(width) && Number.isFinite(height)) {
        childWindow.setContentSize(Math.round(width), Math.round(height))
      }
    }
  }

  ipcRenderer.on('alwaysOnTop', handleAlwaysOnTop)
  ipcRenderer.on('close-window', handleCloseWindow)
  ipcRenderer.on('focus-window', handleFocusWindow)
  ipcRenderer.on('minimize-window', handleMinimizeWindow)
  ipcRenderer.on('toggle-maximize-window', handleToggleMaximizeWindow)
  ipcRenderer.on('resize-window', handleResizeWindow)

  childWindow.on('closed', () => {
    removeWindowSingletonRecord(singletonKey, singletonToken)
    ipcRenderer.removeListener('alwaysOnTop', handleAlwaysOnTop)
    ipcRenderer.removeListener('close-window', handleCloseWindow)
    ipcRenderer.removeListener('focus-window', handleFocusWindow)
    ipcRenderer.removeListener('minimize-window', handleMinimizeWindow)
    ipcRenderer.removeListener('toggle-maximize-window', handleToggleMaximizeWindow)
    ipcRenderer.removeListener('resize-window', handleResizeWindow)
  })
}

export const windowService = {
  getWinId: () => (parentWindowId ? String(parentWindowId) : undefined),

  alwaysOnTop: (flag) => {
    if (parentWindowId) {
      ipcRenderer.sendTo(parentWindowId, 'alwaysOnTop', { flag })
      return
    }

    ipcRenderer.send('window-action', 'always-on-top', { flag })
  },

  closeWindow: () => {
    if (parentWindowId) {
      ipcRenderer.sendTo(parentWindowId, 'close-window')
      return
    }

    ipcRenderer.send('window-action', 'close')
  },

  minimizeWindow: () => {
    if (parentWindowId) {
      ipcRenderer.sendTo(parentWindowId, 'minimize-window')
      return
    }

    ipcRenderer.send('window-action', 'minimize')
  },

  toggleMaximizeWindow: () => {
    if (parentWindowId) {
      ipcRenderer.sendTo(parentWindowId, 'toggle-maximize-window')
      return
    }

    ipcRenderer.send('window-action', 'toggle-maximize')
  },

  resizeWindow: (width, height) => {
    if (parentWindowId) {
      ipcRenderer.sendTo(parentWindowId, 'resize-window', { width, height })
      return
    }

    ipcRenderer.send('window-action', 'resize', { width, height })
  },

  createWindow: async (fileName, height = 300, width = 300, backgroundColor = 0.3) => {
    const isWatchWindow = isWatchWindowName(fileName)
    const childWindowConfig = buildChildWindowConfig(fileName, height, width, backgroundColor)
    const singletonKey = childWindowConfig.singletonKey
    const windowHash = childWindowConfig.hash
    const windowUrl = runtimeUtools.isDev()
      ? `http://localhost:9000/index.html#${windowHash}`
      : getProductionWindowUrl(fileName)

    if (typeof runtimeUtools.createBrowserWindow !== 'function') {
      await ipcRenderer.invoke('createChildWindow', childWindowConfig)
      return
    }

    if (await reuseOrWaitForWindowSingleton(singletonKey)) return

    let singletonClaim = claimWindowSingleton(singletonKey)
    if (!singletonClaim) {
      if (await reuseOrWaitForWindowSingleton(singletonKey)) return
      singletonClaim = claimWindowSingleton(singletonKey)
      if (!singletonClaim) return
    }

    let childWindow
    try {
      childWindow = runtimeUtools.createBrowserWindow(
        windowUrl,
        {
          ...childWindowConfig.options,
          webPreferences: {
            preload: 'preload.js',
            devTools: true,
          },
        },
        () => {
          const childWindowId = Number(childWindow?.webContents?.id)
          if (!Number.isFinite(childWindowId) || childWindowId <= 0) {
            removeWindowSingletonRecord(singletonKey, singletonClaim.token)
            return
          }

          bindChildWindowEvents(childWindow, singletonKey, singletonClaim.token)
          ipcRenderer.sendTo(childWindowId, 'init', { singletonKey })
          publishWindowSingleton(singletonKey, singletonClaim.token, childWindowId)

          if (isWatchWindow) {
            childWindow.setAlwaysOnTop?.(true)
          }

          activateChildWindow(childWindow)

          if (isDevMode()) {
            childWindow.webContents.openDevTools()
          }
        }
      )
    } catch (error) {
      removeWindowSingletonRecord(singletonKey, singletonClaim.token)
      throw error
    }
  },

  creatSomething: (fileName, height, width, backgroundColor) => {
    windowService.createWindow(fileName, height, width, backgroundColor)
  },
}
