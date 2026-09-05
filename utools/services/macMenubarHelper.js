import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let activeMenubarProcess = null
let activeMenubarOwnerToken = ''
let menubarConfiguredPluginRoot = ''

const MENUBAR_STATE_DIRECTORY = path.join(os.tmpdir(), 'system-info-plugin', 'macos-menubar')
const MENUBAR_OWNER_RECORD_PATH = path.join(MENUBAR_STATE_DIRECTORY, 'owner.json')
const MENUBAR_TELEMETRY_PATH = path.join(MENUBAR_STATE_DIRECTORY, 'telemetry.json')
const MENUBAR_LOCK_PATH = path.join(MENUBAR_STATE_DIRECTORY, 'helper.lock')
const MENUBAR_PROTOCOL_VERSION = 4
const MENUBAR_OWNER_STARTING_TTL_MS = 5000

function isMacOS() {
  return typeof process !== 'undefined' && process.platform === 'darwin'
}

function isAsarPath(targetPath = '') {
  return /(^|[\\/])[^\\/]+\.asar([\\/]|$)/i.test(targetPath)
}

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function createMenubarOwnerToken() {
  return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function writeJsonAtomically(filePath, value) {
  const directoryPath = path.dirname(filePath)
  const temporaryPath = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`

  try {
    fs.mkdirSync(directoryPath, { recursive: true })
    fs.writeFileSync(temporaryPath, JSON.stringify(value), 'utf8')
    fs.renameSync(temporaryPath, filePath)
    return true
  } catch {
    try {
      fs.unlinkSync(temporaryPath)
    } catch {
      // Ignore cleanup errors.
    }
    return false
  }
}

function readMenubarOwnerRecord() {
  try {
    const parsed = JSON.parse(fs.readFileSync(MENUBAR_OWNER_RECORD_PATH, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function isProcessAlive(pid) {
  const numericPid = Number(pid)
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false

  try {
    process.kill(numericPid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function isMenubarOwnerRecordLive(record) {
  if (!record || typeof record !== 'object') return false
  if (Number(record.protocolVersion) !== MENUBAR_PROTOCOL_VERSION) return false

  if (record.state === 'starting') {
    const createdAt = Number(record.createdAt) || 0
    return Boolean(
      createdAt
      && Date.now() - createdAt < MENUBAR_OWNER_STARTING_TTL_MS
      && isProcessAlive(record.ownerPid)
    )
  }

  return record.state === 'running' && isProcessAlive(record.helperPid)
}

function isKnownMenubarOwnerRecord(record) {
  return Boolean(
    record
    && record.telemetryPath === MENUBAR_TELEMETRY_PATH
    && record.lockPath === MENUBAR_LOCK_PATH
  )
}

function terminateStaleMenubarHelper(record) {
  const helperPid = Number(record?.helperPid)
  if (!isKnownMenubarOwnerRecord(record) || !isProcessAlive(helperPid)) return

  try {
    process.kill(helperPid, 'SIGTERM')
  } catch {
    // The stale helper may already be exiting.
  }
}

function removeMenubarOwnerRecord(expectedToken = '') {
  try {
    const current = readMenubarOwnerRecord()
    if (expectedToken && current?.token !== expectedToken) return false
    fs.unlinkSync(MENUBAR_OWNER_RECORD_PATH)
    return true
  } catch {
    return false
  }
}

function claimMenubarOwner() {
  try {
    fs.mkdirSync(MENUBAR_STATE_DIRECTORY, { recursive: true })
  } catch {
    return { acquired: false, record: null }
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = createMenubarOwnerToken()
    let descriptor

    try {
      descriptor = fs.openSync(MENUBAR_OWNER_RECORD_PATH, 'wx')
      fs.writeFileSync(descriptor, JSON.stringify({
        state: 'starting',
        token,
        protocolVersion: MENUBAR_PROTOCOL_VERSION,
        ownerPid: process.pid,
        createdAt: Date.now(),
      }), 'utf8')
      return { acquired: true, token }
    } catch (error) {
      if (error?.code !== 'EEXIST') return { acquired: false, record: null }

      const current = readMenubarOwnerRecord()
      if (isMenubarOwnerRecordLive(current)) {
        return { acquired: false, record: current }
      }

      terminateStaleMenubarHelper(current)

      try {
        fs.unlinkSync(MENUBAR_OWNER_RECORD_PATH)
      } catch {
        return { acquired: false, record: current }
      }
    } finally {
      if (typeof descriptor === 'number') fs.closeSync(descriptor)
    }
  }

  return { acquired: false, record: readMenubarOwnerRecord() }
}

function publishMenubarOwner(token, helperPid) {
  const current = readMenubarOwnerRecord()
  if (!current || current.token !== token) return false

  return writeJsonAtomically(MENUBAR_OWNER_RECORD_PATH, {
    ...current,
    state: 'running',
    protocolVersion: MENUBAR_PROTOCOL_VERSION,
    helperPid,
    telemetryPath: MENUBAR_TELEMETRY_PATH,
    lockPath: MENUBAR_LOCK_PATH,
    startedAt: Date.now(),
  })
}

function writeMenubarTelemetry(payload) {
  return writeJsonAtomically(MENUBAR_TELEMETRY_PATH, {
    ...payload,
    writerPid: process.pid,
    updatedAt: Date.now(),
  })
}

function getMenubarHostPid() {
  const hostPid = Number(process.ppid)
  return Number.isInteger(hostPid) && hostPid > 1 ? hostPid : process.pid
}

function normalizeTelemetryNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
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

  let binaryFingerprint
  try {
    binaryFingerprint = sha256File(binaryPath)
  } catch {
    return null
  }

  const runtimeDir = path.join(os.tmpdir(), 'system-info-plugin', 'vendor', 'macos', binaryFingerprint)
  const runtimeBinary = path.join(runtimeDir, 'hwinfox-menubar-helper')

  try {
    fs.mkdirSync(runtimeDir, { recursive: true })
    let runtimeMatches = false
    if (fs.existsSync(runtimeBinary)) {
      try {
        runtimeMatches = sha256File(runtimeBinary) === binaryFingerprint
      } catch {
        runtimeMatches = false
      }
    }
    if (!runtimeMatches) {
      fs.copyFileSync(binaryPath, runtimeBinary)
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

  const localRunning = Boolean(
    activeMenubarProcess
    && !activeMenubarProcess.killed
    && activeMenubarProcess.exitCode === null
  )
  const sharedOwner = readMenubarOwnerRecord()
  const sharedRunning = !localRunning && isMenubarOwnerRecordLive(sharedOwner)

  return {
    running: localRunning || sharedRunning,
    supported: true,
    pid: localRunning ? activeMenubarProcess.pid : sharedRunning ? Number(sharedOwner.helperPid) : null,
    shared: sharedRunning,
  }
}

export function startMacMenubarHelper(options = {}) {
  if (!isMacOS()) {
    return { ok: false, running: false, reason: 'PLATFORM_NOT_DARWIN' }
  }

  const currentStatus = getMacMenubarStatus()
  if (currentStatus.running) {
    return {
      ok: true,
      running: true,
      pid: currentStatus.pid,
      shared: currentStatus.shared,
    }
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

  const ownerClaim = claimMenubarOwner()
  if (!ownerClaim.acquired) {
    const sharedPid = Number(ownerClaim.record?.helperPid)
    if (isMenubarOwnerRecordLive(ownerClaim.record)) {
      return { ok: true, running: true, pid: Number.isInteger(sharedPid) ? sharedPid : null, shared: true }
    }
    return { ok: false, running: false, reason: 'MENUBAR_START_IN_PROGRESS' }
  }

  try {
    const child = spawn(executablePath, [], {
      env: {
        ...process.env,
        HWINFOX_MENUBAR_TELEMETRY_PATH: MENUBAR_TELEMETRY_PATH,
        HWINFOX_MENUBAR_LOCK_PATH: MENUBAR_LOCK_PATH,
        HWINFOX_MENUBAR_SCHEDULER_PATH: path.join(MENUBAR_STATE_DIRECTORY, 'scheduler.json'),
        HWINFOX_MENUBAR_STOP_PATH: path.join(MENUBAR_STATE_DIRECTORY, 'runtime-stop.json'),
        HWINFOX_MENUBAR_PROTOCOL_VERSION: String(MENUBAR_PROTOCOL_VERSION),
        // Renderer processes are short-lived when uTools switches pages. The
        // uTools host process is the stable lifetime boundary for the tray.
        HWINFOX_MENUBAR_PARENT_PID: String(getMenubarHostPid()),
      },
      stdio: ['ignore', 'ignore', 'ignore'],
      detached: false,
    })

    activeMenubarOwnerToken = ownerClaim.token
    activeMenubarProcess = child
    publishMenubarOwner(ownerClaim.token, child.pid)

    child.on('error', (err) => {
      console.warn('[macMenubarHelper] process error:', err)
      if (activeMenubarProcess === child) {
        activeMenubarProcess = null
      }
      removeMenubarOwnerRecord(ownerClaim.token)
    })

    child.on('exit', () => {
      if (activeMenubarProcess === child) {
        activeMenubarProcess = null
      }
      if (activeMenubarOwnerToken === ownerClaim.token) {
        activeMenubarOwnerToken = ''
      }
      removeMenubarOwnerRecord(ownerClaim.token)
    })

    return { ok: true, running: true, pid: child.pid }
  } catch (error) {
    removeMenubarOwnerRecord(ownerClaim.token)
    return {
      ok: false,
      running: false,
      reason: 'MENUBAR_HELPER_SPAWN_FAILED',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export function stopMacMenubarHelper() {
  const proc = activeMenubarProcess
  const owner = readMenubarOwnerRecord()
  const helperPid = Number(owner?.helperPid)
  activeMenubarProcess = null
  activeMenubarOwnerToken = ''

  try {
    if (proc?.stdin && proc.stdin.writable) {
      proc.stdin.write('QUIT\n')
      proc.stdin.end()
    }
  } catch {
    // Ignore pipe write error
  }

  if (Number.isInteger(helperPid) && helperPid > 0 && isProcessAlive(helperPid)) {
    try {
      process.kill(helperPid, 'SIGTERM')
    } catch {
      // Ignore process exit races.
    }
  }

  setTimeout(() => {
    try {
      if (proc && proc.exitCode === null && !proc.killed) {
        proc.kill('SIGTERM')
      }
    } catch {
      // Ignore kill error
    }
    if (!isProcessAlive(helperPid)) {
      removeMenubarOwnerRecord(owner?.token || '')
    }
  }, 200)

  return { ok: true, running: false }
}

export function updateMacMenubarTelemetry(telemetry = {}) {
  const sourceMetrics = telemetry.metrics && typeof telemetry.metrics === 'object' ? telemetry.metrics : {}
  const payload = {
    temp: normalizeTelemetryNumber(telemetry.temp),
    load: normalizeTelemetryNumber(telemetry.load),
    speed: normalizeTelemetryNumber(telemetry.speed),
    fanSpeed: normalizeTelemetryNumber(telemetry.fanSpeed),
    memoryUsedBytes: normalizeTelemetryNumber(telemetry.memoryUsedBytes),
    memoryTotalBytes: normalizeTelemetryNumber(telemetry.memoryTotalBytes),
    memoryPercent: normalizeTelemetryNumber(telemetry.memoryPercent),
    diskReadBytesPerSec: normalizeTelemetryNumber(telemetry.diskReadBytesPerSec),
    diskWriteBytesPerSec: normalizeTelemetryNumber(telemetry.diskWriteBytesPerSec),
    networkDownloadBytesPerSec: normalizeTelemetryNumber(telemetry.networkDownloadBytesPerSec),
    networkUploadBytesPerSec: normalizeTelemetryNumber(telemetry.networkUploadBytesPerSec),
    showIcon: telemetry.showIcon !== false,
    showTemp: telemetry.showTemp !== false,
    showLoad: telemetry.showLoad !== false,
    metrics: {
      cpuTemperature: typeof sourceMetrics.cpuTemperature === 'boolean' ? sourceMetrics.cpuTemperature : telemetry.showTemp !== false,
      cpuLoad: typeof sourceMetrics.cpuLoad === 'boolean' ? sourceMetrics.cpuLoad : telemetry.showLoad !== false,
      cpuFrequency: sourceMetrics.cpuFrequency === true,
      fanSpeed: sourceMetrics.fanSpeed === true,
      memoryUsage: sourceMetrics.memoryUsage === true,
      diskIo: sourceMetrics.diskIo === true || sourceMetrics.diskRead === true || sourceMetrics.diskWrite === true,
      networkIo: sourceMetrics.networkIo === true,
    },
  }

  return writeMenubarTelemetry(payload) && getMacMenubarStatus().running
}
