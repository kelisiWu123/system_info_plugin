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
const WINDOW_CREATE_CALLBACK_TIMEOUT_MS = 10000

function isDevMode() {
  return typeof process !== 'undefined' && process.env.NODE_ENV === 'development'
}

function isWatchWindowName(fileName) {
  return ['a_watch', 'watch', 'a_watch_super_lite'].includes(fileName) || fileName === 'a_watch_cpu_cores'
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

  if (typeof runtimeUtools.sendToParent === 'function') {
    runtimeUtools.sendToParent('focus-window')
    return
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
  if (fileName === 'a_watch_cpu_cores') return 'cpuCoresWatch'
  if (fileName === 'a_monitor') return 'monitor'
  if (fileName === 'a_specs_lite') return 'deviceSpecs'
  if (fileName === 'a_menubar_settings') return 'menubarSettings'
  return isWatchWindowName(fileName) ? 'watch?floatingMode=standard&entry=hardwareWatch' : 'computer'
}

function getProductionWindowUrl(fileName) {
  if (fileName === 'a_watch_super_lite') return 'a_watch_super_lite/index.html'
  if (fileName === 'a_watch_cpu_cores') return 'a_watch_cpu_cores/index.html'
  if (fileName === 'a_monitor') return 'a_monitor/index.html'
  if (fileName === 'a_specs_lite') return 'a_specs_lite/index.html'
  if (fileName === 'a_menubar_settings') return 'a_menubar_settings/index.html'
  if (isWatchWindowName(fileName)) return 'watch.html'
  return 'computer.html'
}

function getDevServerUrl() {
  const configuredUrl = typeof process !== 'undefined' && typeof process.env?.VITE_DEV_SERVER_URL === 'string'
    ? process.env.VITE_DEV_SERVER_URL.trim()
    : ''

  return (configuredUrl || 'http://localhost:9000').replace(/\/+$/, '')
}

function buildChildWindowOptions(fileName, height, width, backgroundColor, extraOptions = {}) {
  const isWatchWindow = isWatchWindowName(fileName)

  const options = {
    title: fileName === 'a_menubar_settings' ? '菜单栏显示设置' : 'system info',
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
    closable: true,
    transparent: isWatchWindow,
    frame: false,
    alwaysOnTop: isWatchWindow,
  }

  if (Number.isFinite(extraOptions?.x)) {
    options.x = Math.round(Number(extraOptions.x))
  }
  if (Number.isFinite(extraOptions?.y)) {
    options.y = Math.round(Number(extraOptions.y))
  }

  return options
}

function buildChildWindowConfig(fileName, height, width, backgroundColor, extraOptions = {}) {
  return {
    singletonKey: getWindowSingletonKey(fileName),
    hash: getWindowHash(fileName),
    options: buildChildWindowOptions(fileName, height, width, backgroundColor, extraOptions),
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
  let closeCheckInterval
  let cleanedUp = false

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

  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    clearInterval(closeCheckInterval)
    removeWindowSingletonRecord(singletonKey, singletonToken)
    ipcRenderer.removeListener('alwaysOnTop', handleAlwaysOnTop)
    ipcRenderer.removeListener('close-window', handleCloseWindow)
    ipcRenderer.removeListener('focus-window', handleFocusWindow)
    ipcRenderer.removeListener('minimize-window', handleMinimizeWindow)
    ipcRenderer.removeListener('toggle-maximize-window', handleToggleMaximizeWindow)
    ipcRenderer.removeListener('resize-window', handleResizeWindow)
  }

  // uTools returns a BrowserWindow proxy without Electron instance events.
  // Observe disposal in the owning preload so native closes/crashes also clean up.
  if (typeof childWindow.on === 'function') {
    childWindow.on('closed', cleanup)
  } else {
    closeCheckInterval = setInterval(() => {
      try {
        if (childWindow.isDestroyed()) cleanup()
      } catch {
        // The host no longer has the window represented by this proxy.
        cleanup()
      }
    }, 500)
    closeCheckInterval.unref?.()
  }
}

function getCurrentWindowSingletonKey() {
  if (currentWindowSingletonKey) return currentWindowSingletonKey
  try {
    const href = String(globalThis?.location?.href || '')
    if (href.includes('a_watch_super_lite') || href.includes('floatingMode=super-lite') || href.includes('hardwareWatchSuperLite')) {
      return 'a_watch_super_lite'
    }
    if (href.includes('a_watch_cpu_cores') || href.includes('cpuCoresWatch')) {
      return 'a_watch_cpu_cores'
    }
    if (href.includes('a_watch') || href.includes('watch.html') || href.includes('#watch')) {
      return 'a_watch'
    }
    if (href.includes('a_monitor') || href.includes('monitor')) {
      return 'a_monitor'
    }
    if (href.includes('a_specs_lite') || href.includes('deviceSpecs')) {
      return 'a_specs_lite'
    }
    if (href.includes('a_menubar_settings') || href.includes('menubarSettings')) {
      return 'a_menubar_settings'
    }
    if (href.includes('a_computer') || href.includes('computer')) {
      return 'a_computer'
    }
  } catch {
    // fallback
  }
  return 'window'
}

function sendCurrentWindowAction(parentChannel, mainAction, payload) {
  if (typeof runtimeUtools.sendToParent === 'function') {
    runtimeUtools.sendToParent(parentChannel, payload)
    return
  }

  if (parentWindowId) {
    ipcRenderer.sendTo(parentWindowId, parentChannel, payload)
    return
  }

  if (mainAction === 'resize') {
    const { width, height } = payload || {}
    ipcRenderer.send('window-action', 'resize', { width, height })
    return
  }

  if (mainAction === 'close') {
    ipcRenderer.send('window-action', 'close')
    return
  }

  if (mainAction === 'always-on-top') {
    const { flag } = payload || {}
    ipcRenderer.send('window-action', 'always-on-top', { flag })
    return
  }

  ipcRenderer.send('window-action', mainAction, payload)
}

function calculateHandoffPosition(targetWidth, targetHeight) {
  try {
    const currentX = globalThis.screenX ?? globalThis.screenLeft
    const currentY = globalThis.screenY ?? globalThis.screenTop
    if (!Number.isFinite(currentX) || !Number.isFinite(currentY)) {
      return {}
    }

    const currentWidth = globalThis.outerWidth || (targetWidth === 432 ? 200 : 432)
    const currentHeight = globalThis.outerHeight || (targetHeight === 398 ? 200 : 398)

    const screenObj = globalThis.screen
    const availLeft = Number.isFinite(screenObj?.availLeft) ? screenObj.availLeft : 0
    const availTop = Number.isFinite(screenObj?.availTop) ? screenObj.availTop : 0
    const availWidth = Number.isFinite(screenObj?.availWidth) && screenObj.availWidth > 0
      ? screenObj.availWidth
      : (screenObj?.width || 1920)
    const availHeight = Number.isFinite(screenObj?.availHeight) && screenObj.availHeight > 0
      ? screenObj.availHeight
      : (screenObj?.height || 1080)

    const isWithinReportedScreen = (
      currentX >= availLeft - 100 &&
      currentX <= availLeft + availWidth + 100 &&
      currentY >= availTop - 100 &&
      currentY <= availTop + availHeight + 100
    )

    if (!isWithinReportedScreen) {
      return {
        x: Math.round(currentX),
        y: Math.round(currentY),
      }
    }

    const distLeft = currentX - availLeft
    const distRight = (availLeft + availWidth) - (currentX + currentWidth)
    const distTop = currentY - availTop
    const distBottom = (availTop + availHeight) - (currentY + currentHeight)

    let targetX = distRight < distLeft
      ? (currentX + currentWidth - targetWidth)
      : currentX

    let targetY = distBottom < distTop
      ? (currentY + currentHeight - targetHeight)
      : currentY

    targetX = Math.max(availLeft, Math.min(availLeft + availWidth - targetWidth, targetX))
    targetY = Math.max(availTop, Math.min(availTop + availHeight - targetHeight, targetY))

    return {
      x: Math.round(targetX),
      y: Math.round(targetY),
    }
  } catch {
    return {}
  }
}

export const windowService = {
  getWinId: () => (parentWindowId ? String(parentWindowId) : undefined),

  alwaysOnTop: (flag) => {
    sendCurrentWindowAction('alwaysOnTop', 'always-on-top', { flag })
  },

  closeWindow: () => {
    // Self-close works even before init arrives or after the parent disappears.
    if (runtimeUtools.getWindowType?.() === 'browser') {
      globalThis.close()
      return
    }

    sendCurrentWindowAction('close-window', 'close')
  },

  minimizeWindow: () => {
    sendCurrentWindowAction('minimize-window', 'minimize')
  },

  toggleMaximizeWindow: () => {
    sendCurrentWindowAction('toggle-maximize-window', 'toggle-maximize')
  },

  resizeWindow: (width, height) => {
    if (typeof runtimeUtools.createBrowserWindow === 'function') {
      const currentKey = getCurrentWindowSingletonKey()
      if (currentKey === 'a_watch_super_lite' && width >= 400) {
        const position = calculateHandoffPosition(432, 398)
        void (async () => {
          try {
            await windowService.createWindow('a_watch', 398, 432, 0, position)
            windowService.closeWindow()
          } catch (e) {
            console.error('切换标准监控窗口失败:', e)
          }
        })()
        return
      }

      if (currentKey === 'a_watch' && width <= 250) {
        const position = calculateHandoffPosition(200, 200)
        void (async () => {
          try {
            await windowService.createWindow('a_watch_super_lite', 200, 200, 0, position)
            windowService.closeWindow()
          } catch (e) {
            console.error('切换超轻量监控窗口失败:', e)
          }
        })()
        return
      }
    }

    sendCurrentWindowAction('resize-window', 'resize', { width, height })
  },

  createWindow: async (fileName, height = 300, width = 300, backgroundColor = 0.3, extraOptions = {}) => {
    const isWatchWindow = isWatchWindowName(fileName)
    const childWindowConfig = buildChildWindowConfig(fileName, height, width, backgroundColor, extraOptions)
    const singletonKey = childWindowConfig.singletonKey
    const windowHash = childWindowConfig.hash
    const windowUrl = runtimeUtools.isDev()
      ? `${getDevServerUrl()}/index.html#${windowHash}`
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
      await new Promise((resolve, reject) => {
        let callbackSettled = false
        const callbackTimeoutId = setTimeout(() => {
          if (callbackSettled) return
          callbackSettled = true
          try {
            childWindow?.close?.()
          } catch {
            // The host may already have disposed the half-created window.
          }
          removeWindowSingletonRecord(singletonKey, singletonClaim.token)
          reject(new Error(`uTools 窗口创建回调超时: ${singletonKey}`))
        }, WINDOW_CREATE_CALLBACK_TIMEOUT_MS)

        try {
          childWindow = runtimeUtools.createBrowserWindow(
            windowUrl,
            {
              ...childWindowConfig.options,
              closeable: true,
              webPreferences: {
                preload: 'preload.js',
                devTools: true,
              },
            },
            () => {
              try {
                if (callbackSettled) return
                callbackSettled = true
                clearTimeout(callbackTimeoutId)
                const childWindowId = Number(childWindow?.webContents?.id)
                if (!Number.isFinite(childWindowId) || childWindowId <= 0) {
                  try {
                    childWindow?.close?.()
                  } catch {
                    // Ignore cleanup failures while reporting the invalid window.
                  }
                  removeWindowSingletonRecord(singletonKey, singletonClaim.token)
                  reject(new Error(`uTools 窗口创建后未返回有效 webContents: ${singletonKey}`))
                  return
                }

                bindChildWindowEvents(childWindow, singletonKey, singletonClaim.token)
                childWindow.webContents.send('init', { singletonKey })
                publishWindowSingleton(singletonKey, singletonClaim.token, childWindowId)

                if (Number.isFinite(childWindowConfig.options.x) && Number.isFinite(childWindowConfig.options.y)) {
                  try {
                    childWindow.setPosition?.(childWindowConfig.options.x, childWindowConfig.options.y)
                  } catch {
                    // Ignore if setPosition is not exposed on proxy
                  }
                }

                if (isWatchWindow) {
                  childWindow.setAlwaysOnTop?.(true)
                }

                activateChildWindow(childWindow)

                if (isDevMode()) {
                  childWindow.webContents.openDevTools()
                }
                resolve()
              } catch (error) {
                callbackSettled = true
                clearTimeout(callbackTimeoutId)
                removeWindowSingletonRecord(singletonKey, singletonClaim.token)
                reject(error)
              }
            }
          )
        } catch (error) {
          callbackSettled = true
          clearTimeout(callbackTimeoutId)
          removeWindowSingletonRecord(singletonKey, singletonClaim.token)
          reject(error)
        }
      })
    } catch (error) {
      removeWindowSingletonRecord(singletonKey, singletonClaim.token)
      throw error
    }
  },

  creatSomething: (fileName, height, width, backgroundColor) => {
    return windowService.createWindow(fileName, height, width, backgroundColor)
  },
}
