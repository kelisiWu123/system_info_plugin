const { ipcRenderer } = require('electron')
import { resolveUtoolsRuntime } from '../runtime'

let parentWindowId
const runtimeUtools = resolveUtoolsRuntime(typeof utools !== 'undefined' ? utools : undefined)

function isDevMode() {
  return typeof process !== 'undefined' && process.env.NODE_ENV === 'development'
}

function isWatchWindowName(fileName) {
  return ['a_watch', 'watch', 'a_watch_super_lite'].includes(fileName)
}

function getWindowHash(fileName) {
  if (fileName === 'a_watch_super_lite') return 'watch?floatingMode=super-lite&entry=hardwareWatchSuperLite'
  return isWatchWindowName(fileName) ? 'watch?floatingMode=standard&entry=hardwareWatch' : 'computer'
}

function buildChildWindowOptions(fileName, height, width, backgroundColor) {
  const isWatchWindow = isWatchWindowName(fileName)

  return {
    title: 'system info',
    height,
    width,
    useContentSize: true,
    skipTaskbar: false,
    backgroundColor: isWatchWindow ? `rgba(255, 255, 255, ${backgroundColor})` : '#0f1722',
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
    hash: getWindowHash(fileName),
    options: buildChildWindowOptions(fileName, height, width, backgroundColor),
  }
}

export function setupWindowBridge() {
  ipcRenderer.on('init', (event) => {
    parentWindowId = event.senderId
  })
}

function bindChildWindowEvents(childWindow) {
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
  ipcRenderer.on('minimize-window', handleMinimizeWindow)
  ipcRenderer.on('toggle-maximize-window', handleToggleMaximizeWindow)
  ipcRenderer.on('resize-window', handleResizeWindow)

  childWindow.on('closed', () => {
    ipcRenderer.removeListener('alwaysOnTop', handleAlwaysOnTop)
    ipcRenderer.removeListener('close-window', handleCloseWindow)
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
    }
  },

  closeWindow: () => {
    if (parentWindowId) {
      ipcRenderer.sendTo(parentWindowId, 'close-window')
      return
    }

    window.close()
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

    if (typeof window.resizeTo === 'function') {
      window.resizeTo(Math.round(width), Math.round(height))
    }
  },

  createWindow: (fileName, height = 300, width = 300, backgroundColor = 0.3) => {
    const isWatchWindow = isWatchWindowName(fileName)
    const childWindowConfig = buildChildWindowConfig(fileName, height, width, backgroundColor)
    const windowHash = childWindowConfig.hash
    const windowUrl = runtimeUtools.isDev()
      ? `http://localhost:9000/index.html#${windowHash}`
      : isWatchWindow
        ? `watch.html#${windowHash}`
        : 'computer.html'

    if (typeof runtimeUtools.createBrowserWindow !== 'function') {
      ipcRenderer.invoke('createChildWindow', buildChildWindowConfig(fileName, height, width, backgroundColor))
      return
    }

    const childWindow = runtimeUtools.createBrowserWindow(
      windowUrl,
      {
        ...childWindowConfig.options,
        webPreferences: {
          preload: 'preload.js',
          devTools: true,
        },
      },
      () => {
        if (isWatchWindow) {
          childWindow.setAlwaysOnTop?.(true)
        }

        childWindow.show?.()
        childWindow.focus?.()
        childWindow.moveTop?.()

        if (isDevMode()) {
          childWindow.webContents.openDevTools()
        }

        ipcRenderer.sendTo(childWindow.webContents.id, 'init')
        bindChildWindowEvents(childWindow)
      }
    )
  },

  creatSomething: (fileName, height, width, backgroundColor) => {
    windowService.createWindow(fileName, height, width, backgroundColor)
  },
}
