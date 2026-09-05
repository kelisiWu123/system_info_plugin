import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let activeMenubarProcess = null
let menubarConfiguredPluginRoot = ''

function isMacOS() {
  return typeof process !== 'undefined' && process.platform === 'darwin'
}

function isAsarPath(targetPath = '') {
  return /(^|[\\/])[^\\/]+\.asar([\\/]|$)/i.test(targetPath)
}

export function configureMacMenubarContext({ pluginRoot } = {}) {
  if (typeof pluginRoot === 'string' && pluginRoot.trim()) {
    menubarConfiguredPluginRoot = path.resolve(pluginRoot)
  }
}

export function resolveMacMenubarBinaryPath(pluginRoot = menubarConfiguredPluginRoot) {
  if (typeof pluginRoot === 'string' && pluginRoot.trim()) {
    return path.resolve(pluginRoot, 'vendor/macos/hwinfox-menubar-helper')
  }

  return path.resolve(__dirname, '../../vendor/macos/hwinfox-menubar-helper')
}

function ensurePhysicalMenubarBinary(binaryPath) {
  if (!fs.existsSync(binaryPath)) {
    return null
  }

  if (!isAsarPath(binaryPath)) {
    try {
      fs.chmodSync(binaryPath, 0o755)
    } catch {
      // Ignore chmod error if not permitted
    }
    return binaryPath
  }

  const runtimeDir = path.join(os.tmpdir(), 'system-info-plugin', 'vendor', 'macos')
  const runtimeBinary = path.join(runtimeDir, 'hwinfox-menubar-helper')

  try {
    fs.mkdirSync(runtimeDir, { recursive: true })
    if (!fs.existsSync(runtimeBinary)) {
      fs.writeFileSync(runtimeBinary, fs.readFileSync(binaryPath))
    }
    fs.chmodSync(runtimeBinary, 0o755)
    return runtimeBinary
  } catch {
    return null
  }
}

export function getMacMenubarStatus() {
  if (!isMacOS()) {
    return { running: false, supported: false, reason: 'PLATFORM_NOT_DARWIN' }
  }

  const running = Boolean(
    activeMenubarProcess
    && !activeMenubarProcess.killed
    && activeMenubarProcess.exitCode === null
  )

  return {
    running,
    supported: true,
    pid: running ? activeMenubarProcess.pid : null,
  }
}

export function startMacMenubarHelper(options = {}) {
  if (!isMacOS()) {
    return { ok: false, running: false, reason: 'PLATFORM_NOT_DARWIN' }
  }

  if (getMacMenubarStatus().running) {
    return { ok: true, running: true, pid: activeMenubarProcess.pid }
  }

  const rawPath = options.binaryPath || resolveMacMenubarBinaryPath(options.pluginRoot || menubarConfiguredPluginRoot)
  const executablePath = ensurePhysicalMenubarBinary(rawPath)

  if (!executablePath) {
    return {
      ok: false,
      running: false,
      reason: 'MENUBAR_HELPER_NOT_FOUND',
      message: `未找到 macOS 菜单栏辅助程序: ${rawPath}`,
    }
  }

  try {
    const child = spawn(executablePath, [], {
      stdio: ['pipe', 'ignore', 'ignore'],
      detached: false,
    })

    child.on('error', (err) => {
      console.warn('[macMenubarHelper] process error:', err)
      if (activeMenubarProcess === child) {
        activeMenubarProcess = null
      }
    })

    child.on('exit', () => {
      if (activeMenubarProcess === child) {
        activeMenubarProcess = null
      }
    })

    activeMenubarProcess = child
    return { ok: true, running: true, pid: child.pid }
  } catch (error) {
    return {
      ok: false,
      running: false,
      reason: 'MENUBAR_HELPER_SPAWN_FAILED',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export function stopMacMenubarHelper() {
  if (!activeMenubarProcess) {
    return { ok: true, running: false }
  }

  const proc = activeMenubarProcess
  activeMenubarProcess = null

  try {
    if (proc.stdin && proc.stdin.writable) {
      proc.stdin.write('QUIT\n')
      proc.stdin.end()
    }
  } catch {
    // Ignore pipe write error
  }

  setTimeout(() => {
    try {
      if (proc.exitCode === null && !proc.killed) {
        proc.kill('SIGTERM')
      }
    } catch {
      // Ignore kill error
    }
  }, 200)

  return { ok: true, running: false }
}

export function updateMacMenubarTelemetry(telemetry = {}) {
  if (!activeMenubarProcess || !activeMenubarProcess.stdin || !activeMenubarProcess.stdin.writable) {
    return false
  }

  try {
    const payload = JSON.stringify({
      temp: typeof telemetry.temp === 'number' && Number.isFinite(telemetry.temp) ? telemetry.temp : null,
      load: typeof telemetry.load === 'number' && Number.isFinite(telemetry.load) ? telemetry.load : null,
      speed: typeof telemetry.speed === 'number' && Number.isFinite(telemetry.speed) ? telemetry.speed : null,
      showIcon: telemetry.showIcon !== false,
      showTemp: telemetry.showTemp !== false,
      showLoad: telemetry.showLoad !== false,
    }) + '\n'

    activeMenubarProcess.stdin.write(payload)
    return true
  } catch {
    return false
  }
}
