// copy from https://github.com/electron-vite/electron-vite-vue/blob/main/electron/main/index.ts
import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { release } from 'node:os'
import { join } from 'node:path'

// The built directory structure
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron-Main
// │ └─┬ preload
// │   └── index.js    > Preload-Scripts
// ├─┬ dist
// │ └── index.html    > Electron-Renderer
//
process.env.DIST_ELECTRON = join(__dirname, '..')
process.env.DIST = join(process.env.DIST_ELECTRON, '../dist')
process.env.VITE_PUBLIC = process.env.VITE_DEV_SERVER_URL
    ? join(process.env.DIST_ELECTRON, '../public')
    : process.env.DIST

const electronDebugPort = Number(process.env.VITE_ELECTRON_DEBUG_PORT)
if (Number.isInteger(electronDebugPort) && electronDebugPort > 0 && electronDebugPort < 65536) {
    app.commandLine.appendSwitch('remote-debugging-port', String(electronDebugPort))
}

// Disable GPU Acceleration for Windows 7
if (release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
    app.quit()
    process.exit(0)
}

// Remove electron security warnings
// This warning only shows in development mode
// Read more on https://www.electronjs.org/docs/latest/tutorial/security
// process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true'

let win: BrowserWindow | null = null
let watchPreviewWin: BrowserWindow | null = null
const childWindowsBySingletonKey = new Map<string, BrowserWindow>()
// Here, you can also use other preload
const preload = join(__dirname, '../preload/preload.js')
const url = process.env.VITE_DEV_SERVER_URL
const watchPreviewEnabled = process.env.VITE_ELECTRON_WATCH_PREVIEW === '1'
const indexHtml = join(process.env.DIST, 'index.html')
const childWindowLoadTimeoutMs = 12000

function loadWindow(window: BrowserWindow, hash: string) {
    if (url) {
        window.loadURL(`${url}#${hash}`)
        return
    }

    window.loadFile(indexHtml, { hash })
}

function normalizeChildWindowDimension(value: unknown, fallback: number) {
    const numericValue = Number(value)
    return Number.isFinite(numericValue) && numericValue > 0 ? Math.round(numericValue) : fallback
}

function getChildWindowHash(arg: unknown) {
    if (typeof arg === 'string') return arg
    if (arg && typeof arg === 'object' && typeof (arg as { hash?: unknown }).hash === 'string') {
        return (arg as { hash: string }).hash
    }

    return 'computer'
}

function getChildWindowSingletonKey(arg: unknown) {
    if (arg && typeof arg === 'object' && typeof (arg as { singletonKey?: unknown }).singletonKey === 'string') {
        const singletonKey = (arg as { singletonKey: string }).singletonKey.trim()
        if (singletonKey) return singletonKey
    }

    return getChildWindowHash(arg)
}

function activateBrowserWindow(targetWindow: BrowserWindow) {
    if (targetWindow.isDestroyed()) return
    if (targetWindow.isMinimized()) targetWindow.restore()
    targetWindow.show()
    targetWindow.focus()
    targetWindow.moveTop()
}

function normalizeChildWindowOptions(arg: unknown) {
    const rawOptions = arg && typeof arg === 'object'
        ? (arg as { options?: Record<string, unknown> }).options || {}
        : {}
    const options = {
        title: typeof rawOptions.title === 'string' ? rawOptions.title : 'system info',
        width: normalizeChildWindowDimension(rawOptions.width, 300),
        height: normalizeChildWindowDimension(rawOptions.height, 300),
        useContentSize: rawOptions.useContentSize !== false,
        skipTaskbar: Boolean(rawOptions.skipTaskbar),
        backgroundColor: typeof rawOptions.backgroundColor === 'string' ? rawOptions.backgroundColor : '#0f1722',
        minimizable: rawOptions.minimizable !== false,
        maximizable: rawOptions.maximizable !== false,
        resizable: rawOptions.resizable !== false,
        fullscreenable: rawOptions.fullscreenable !== false,
        transparent: Boolean(rawOptions.transparent),
        frame: rawOptions.frame !== false,
        alwaysOnTop: Boolean(rawOptions.alwaysOnTop),
    }

    return {
        title: options.title,
        width: options.width,
        height: options.height,
        useContentSize: options.useContentSize,
        skipTaskbar: options.skipTaskbar,
        backgroundColor: options.backgroundColor,
        minimizable: options.minimizable,
        maximizable: options.maximizable,
        resizable: options.resizable,
        fullscreenable: options.fullscreenable,
        transparent: Boolean(options.transparent),
        frame: options.frame,
        alwaysOnTop: Boolean(options.alwaysOnTop),
        ...(Number.isFinite(rawOptions.x) ? { x: Math.round(Number(rawOptions.x)) } : {}),
        ...(Number.isFinite(rawOptions.y) ? { y: Math.round(Number(rawOptions.y)) } : {}),
        webPreferences: {
            preload,
            nodeIntegration: true,
            contextIsolation: false,
            nodeIntegrationInWorker: true,
        },
    }
}

function createMainWindow() {
    win = new BrowserWindow({
        title: 'Main window',
        width: 1440,
        height: 900,
        minWidth: 1180,
        minHeight: 760,
        frame: false,
        backgroundColor: '#0f1722',
        webPreferences: {
            preload,
            // Warning: Enable nodeIntegration and disable contextIsolation is not secure in production
            // Consider using contextBridge.exposeInMainWorld
            // Read more on https://www.electronjs.org/docs/latest/tutorial/context-isolation
            nodeIntegration: true,
            contextIsolation: false,
            nodeIntegrationInWorker: true,
        },
    })

    loadWindow(win, 'computer')
    win.show()
    win.focus()

    if (url) { // electron-vite-vue#298
        win.webContents.openDevTools({ mode: 'detach' })
    }

    // Pipe renderer console messages to terminal stdout
    win.webContents.on('console-message', (_event, _level, message, _line, _sourceId) => {
        console.log(`[Renderer Log] ${message}`)
    })

    // Test actively push message to the Electron-Renderer
    win.webContents.on('did-finish-load', () => {
        win?.webContents.send('main-process-message', new Date().toLocaleString())
    })

    // Make all links open with the browser, not with the application
    win.webContents.setWindowOpenHandler(({ url: externalUrl }) => {
        if (externalUrl.startsWith('https:')) shell.openExternal(externalUrl)
        return { action: 'deny' }
    })
    // win.webContents.on('will-navigate', (event, url) => { }) #344

    win.on('closed', () => {
        win = null
    })
}

function createWatchPreviewWindow() {
    watchPreviewWin = new BrowserWindow({
        title: 'Watch preview',
        width: 380,
        height: 320,
        useContentSize: true,
        skipTaskbar: false,
        backgroundColor: '#14FFFFFF',
        transparent: true,
        frame: false,
        resizable: false,
        maximizable: false,
        minimizable: false,
        fullscreenable: false,
        webPreferences: {
            preload,
            nodeIntegration: true,
            contextIsolation: false,
            nodeIntegrationInWorker: true,
        },
    })

    loadWindow(watchPreviewWin, 'watch')

    watchPreviewWin.on('closed', () => {
        watchPreviewWin = null
    })
}

async function createWindow() {
    createMainWindow()

    if (url && watchPreviewEnabled) {
        createWatchPreviewWindow()
    }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
    win = null
    watchPreviewWin = null
    if (process.platform !== 'darwin') app.quit()
})

app.on('second-instance', () => {
    if (win) {
        // Focus on the main window if the user tried to open another
        if (win.isMinimized()) win.restore()
        win.focus()
    }
})

app.on('activate', () => {
    const allWindows = BrowserWindow.getAllWindows()
    if (allWindows.length) {
        allWindows[0].focus()
    } else {
        createWindow()
    }
})

ipcMain.on('window-action', (event, action, payload) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender)
    if (!targetWindow || targetWindow.isDestroyed()) return

    if (action === 'close') {
        targetWindow.close()
        return
    }

    if (action === 'resize') {
        const width = Number(payload?.width)
        const height = Number(payload?.height)
        if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
            const nextWidth = Math.round(width)
            const nextHeight = Math.round(height)
            targetWindow.setContentSize(nextWidth, nextHeight)

            // Transparent frameless windows can ignore setContentSize on some
            // Electron/Windows combinations. Apply the outer bounds as a
            // fallback so the lightweight monitor is actually 200x200.
            const [contentWidth, contentHeight] = targetWindow.getContentSize()
            if (contentWidth !== nextWidth || contentHeight !== nextHeight) {
                targetWindow.setSize(nextWidth, nextHeight)
            }
        }
        return
    }

    if (action === 'always-on-top') {
        targetWindow.setAlwaysOnTop(Boolean(payload?.flag))
        return
    }

    if (action === 'minimize') {
        targetWindow.minimize()
        return
    }

    if (action === 'focus') {
        activateBrowserWindow(targetWindow)
        return
    }

    if (action === 'toggle-maximize') {
        if (targetWindow.isMaximized()) {
            targetWindow.unmaximize()
        } else {
            targetWindow.maximize()
        }
    }
})

// New window example arg: new windows url
ipcMain.handle('createChildWindow', async (_, arg) => {
    const singletonKey = getChildWindowSingletonKey(arg)
    const existingWindow = childWindowsBySingletonKey.get(singletonKey)

    if (existingWindow && !existingWindow.isDestroyed()) {
        activateBrowserWindow(existingWindow)
        return {
            created: false,
            reused: true,
            webContentsId: existingWindow.webContents.id,
        }
    }

    if (existingWindow?.isDestroyed()) {
        childWindowsBySingletonKey.delete(singletonKey)
    }

    const options = normalizeChildWindowOptions(arg)
    const childWindow = new BrowserWindow(options)
    const hash = getChildWindowHash(arg)
    childWindowsBySingletonKey.set(singletonKey, childWindow)

    childWindow.on('closed', () => {
        if (childWindowsBySingletonKey.get(singletonKey) === childWindow) {
            childWindowsBySingletonKey.delete(singletonKey)
        }
    })

    let loadSettled = false
    let settleLoad: (error?: Error) => void = () => undefined
    const loadPromise = new Promise<void>((resolve, reject) => {
        settleLoad = (error) => {
            if (loadSettled) return
            loadSettled = true
            if (error) reject(error)
            else resolve()
        }

        const timeoutId = setTimeout(() => {
            settleLoad(new Error(`Electron 子窗口加载超时: ${singletonKey}`))
        }, childWindowLoadTimeoutMs)

        childWindow.webContents.once('did-finish-load', () => {
            clearTimeout(timeoutId)
            if (!childWindow.isDestroyed()) {
                childWindow.webContents.send('init', { fromMain: true, singletonKey })
            }
            settleLoad()
        })

        childWindow.webContents.once('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
            if (!isMainFrame) return
            clearTimeout(timeoutId)
            settleLoad(new Error(`Electron 子窗口加载失败 (${errorCode}): ${errorDescription || validatedURL}`))
        })

        childWindow.once('closed', () => {
            clearTimeout(timeoutId)
            settleLoad(new Error(`Electron 子窗口在加载完成前关闭: ${singletonKey}`))
        })
    })

    if (options.alwaysOnTop) {
        childWindow.setAlwaysOnTop(true)
    }

    try {
        if (process.env.VITE_DEV_SERVER_URL) {
            await childWindow.loadURL(`${url}#${hash}`)
        } else {
            await childWindow.loadFile(indexHtml, { hash })
        }
        await loadPromise
    } catch (error) {
        if (!childWindow.isDestroyed()) childWindow.close()
        throw error
    }

    return {
        created: true,
        reused: false,
        webContentsId: childWindow.webContents.id,
    }
})
