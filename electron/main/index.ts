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
// Here, you can also use other preload
const preload = join(__dirname, '../preload/preload.js')
const url = process.env.VITE_DEV_SERVER_URL
const indexHtml = join(process.env.DIST, 'index.html')

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

    if (url) { // electron-vite-vue#298
        win.webContents.openDevTools({ mode: 'detach' })
    }

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

    if (url) {
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

ipcMain.on('window-action', (event, action) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender)
    if (!targetWindow) return

    if (action === 'minimize') {
        targetWindow.minimize()
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
ipcMain.handle('createChildWindow', (_, arg) => {
    const options = normalizeChildWindowOptions(arg)
    const childWindow = new BrowserWindow(options)
    const hash = getChildWindowHash(arg)

    if (options.alwaysOnTop) {
        childWindow.setAlwaysOnTop(true)
    }

    if (process.env.VITE_DEV_SERVER_URL) {
        childWindow.loadURL(`${url}#${hash}`)
    } else {
        childWindow.loadFile(indexHtml, { hash })
    }
})
