import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let activeTrayProcess = null
let activeTrayOwnerToken = ''
let trayConfiguredPluginRoot = ''

const TRAY_STATE_DIRECTORY = path.join(os.tmpdir(), 'system-info-plugin', 'windows-tray')
const TRAY_OWNER_RECORD_PATH = path.join(TRAY_STATE_DIRECTORY, 'owner.json')
const TRAY_TELEMETRY_PATH = path.join(TRAY_STATE_DIRECTORY, 'telemetry.json')
const TRAY_COMMAND_PATH = path.join(TRAY_STATE_DIRECTORY, 'command.json')
const TRAY_LOCK_PATH = path.join(TRAY_STATE_DIRECTORY, 'helper.lock')
const TRAY_PROTOCOL_VERSION = 1
const TRAY_OWNER_STARTING_TTL_MS = 5000

function isWindows() {
  return typeof process !== 'undefined' && process.platform === 'win32'
}

function isAsarPath(targetPath = '') {
  return /(^|[\\/])[^\\/]+\.asar([\\/]|$)/i.test(targetPath)
}

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function createTrayOwnerToken() {
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

function readTrayOwnerRecord() {
  try {
    const parsed = JSON.parse(fs.readFileSync(TRAY_OWNER_RECORD_PATH, 'utf8'))
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

function isTrayOwnerRecordLive(record) {
  if (!record || typeof record !== 'object') return false
  if (Number(record.protocolVersion) !== TRAY_PROTOCOL_VERSION) return false

  if (record.state === 'starting') {
    const createdAt = Number(record.createdAt) || 0
    return Boolean(
      createdAt
      && Date.now() - createdAt < TRAY_OWNER_STARTING_TTL_MS
      && isProcessAlive(record.ownerPid)
    )
  }

  return record.state === 'running' && isProcessAlive(record.helperPid)
}

function isKnownTrayOwnerRecord(record) {
  return Boolean(
    record
    && record.telemetryPath === TRAY_TELEMETRY_PATH
    && record.lockPath === TRAY_LOCK_PATH
  )
}

function terminateStaleTrayHelper(record) {
  const helperPid = Number(record?.helperPid)
  if (!isKnownTrayOwnerRecord(record) || !isProcessAlive(helperPid)) return

  try {
    process.kill(helperPid, 'SIGTERM')
  } catch {
    // The stale helper may already be exiting.
  }
}

function removeTrayOwnerRecord(expectedToken = '') {
  try {
    const current = readTrayOwnerRecord()
    if (expectedToken && current?.token !== expectedToken) return false
    fs.unlinkSync(TRAY_OWNER_RECORD_PATH)
    return true
  } catch {
    return false
  }
}

function claimTrayOwner() {
  try {
    fs.mkdirSync(TRAY_STATE_DIRECTORY, { recursive: true })
  } catch {
    return { acquired: false, record: null }
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = createTrayOwnerToken()
    let descriptor

    try {
      descriptor = fs.openSync(TRAY_OWNER_RECORD_PATH, 'wx')
      fs.writeFileSync(descriptor, JSON.stringify({
        state: 'starting',
        token,
        protocolVersion: TRAY_PROTOCOL_VERSION,
        ownerPid: process.pid,
        createdAt: Date.now(),
      }), 'utf8')
      return { acquired: true, token }
    } catch (error) {
      if (error?.code !== 'EEXIST') return { acquired: false, record: null }

      const current = readTrayOwnerRecord()
      if (isTrayOwnerRecordLive(current)) {
        return { acquired: false, record: current }
      }

      terminateStaleTrayHelper(current)

      try {
        fs.unlinkSync(TRAY_OWNER_RECORD_PATH)
      } catch {
        return { acquired: false, record: current }
      }
    } finally {
      if (typeof descriptor === 'number') fs.closeSync(descriptor)
    }
  }

  return { acquired: false, record: readTrayOwnerRecord() }
}

function publishTrayOwner(token, helperPid) {
  const current = readTrayOwnerRecord()
  if (!current || current.token !== token) return false

  return writeJsonAtomically(TRAY_OWNER_RECORD_PATH, {
    ...current,
    state: 'running',
    protocolVersion: TRAY_PROTOCOL_VERSION,
    helperPid,
    telemetryPath: TRAY_TELEMETRY_PATH,
    lockPath: TRAY_LOCK_PATH,
    startedAt: Date.now(),
  })
}

function writeTrayTelemetry(payload) {
  return writeJsonAtomically(TRAY_TELEMETRY_PATH, {
    ...payload,
    writerPid: process.pid,
    updatedAt: Date.now(),
  })
}

function getTrayHostPid() {
  const hostPid = Number(process.ppid)
  return Number.isInteger(hostPid) && hostPid > 1 ? hostPid : process.pid
}

function normalizeTelemetryNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function configureWindowsTrayContext({ pluginRoot } = {}) {
  if (typeof pluginRoot === 'string' && pluginRoot.trim()) {
    trayConfiguredPluginRoot = path.resolve(pluginRoot)
  }
}

export function resolveWindowsTrayBinaryPath(pluginRoot = trayConfiguredPluginRoot) {
  if (typeof pluginRoot === 'string' && pluginRoot.trim()) {
    const candidates = [
      path.resolve(pluginRoot, 'vendor/windows/HWInfoXTrayHelper.exe'),
      path.resolve(pluginRoot, 'dist/vendor/windows/HWInfoXTrayHelper.exe'),
    ]
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate
    }
  }

  const defaultCandidates = [
    path.resolve(__dirname, 'vendor/windows/HWInfoXTrayHelper.exe'),
    path.resolve(__dirname, '../vendor/windows/HWInfoXTrayHelper.exe'),
    path.resolve(__dirname, '../../vendor/windows/HWInfoXTrayHelper.exe'),
  ]
  for (const candidate of defaultCandidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  return path.resolve(__dirname, '../vendor/windows/HWInfoXTrayHelper.exe')
}

function ensurePhysicalTrayBinary(binaryPath) {
  if (!fs.existsSync(binaryPath)) {
    return null
  }

  if (!isAsarPath(binaryPath)) {
    return binaryPath
  }

  let binaryFingerprint
  try {
    binaryFingerprint = sha256File(binaryPath)
  } catch {
    return null
  }

  const runtimeDir = path.join(os.tmpdir(), 'system-info-plugin', 'vendor', 'windows', binaryFingerprint)
  const runtimeBinary = path.join(runtimeDir, 'HWInfoXTrayHelper.exe')

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
    return runtimeBinary
  } catch {
    return null
  }
}

export function getWindowsTrayStatus() {
  if (!isWindows()) {
    return { running: false, supported: false, reason: 'PLATFORM_NOT_WINDOWS' }
  }

  const localRunning = Boolean(
    activeTrayProcess
    && !activeTrayProcess.killed
    && activeTrayProcess.exitCode === null
  )
  const sharedOwner = readTrayOwnerRecord()
  const sharedRunning = !localRunning && isTrayOwnerRecordLive(sharedOwner)

  return {
    running: localRunning || sharedRunning,
    supported: true,
    pid: localRunning ? activeTrayProcess.pid : sharedRunning ? Number(sharedOwner.helperPid) : null,
    shared: sharedRunning,
  }
}

export function startWindowsTrayHelper(options = {}) {
  if (!isWindows()) {
    return { ok: false, running: false, reason: 'PLATFORM_NOT_WINDOWS' }
  }

  const currentStatus = getWindowsTrayStatus()
  if (currentStatus.running) {
    return {
      ok: true,
      running: true,
      pid: currentStatus.pid,
      shared: currentStatus.shared,
    }
  }

  const rawPath = options.binaryPath || resolveWindowsTrayBinaryPath(options.pluginRoot || trayConfiguredPluginRoot)
  const executablePath = ensurePhysicalTrayBinary(rawPath)

  if (!executablePath) {
    return {
      ok: false,
      running: false,
      reason: 'TRAY_HELPER_NOT_FOUND',
      message: `未找到 Windows 系统托盘辅助程序: ${rawPath}`,
    }
  }

  const ownerClaim = claimTrayOwner()
  if (!ownerClaim.acquired) {
    const sharedPid = Number(ownerClaim.record?.helperPid)
    if (isTrayOwnerRecordLive(ownerClaim.record)) {
      return { ok: true, running: true, pid: Number.isInteger(sharedPid) ? sharedPid : null, shared: true }
    }
    return { ok: false, running: false, reason: 'TRAY_START_IN_PROGRESS' }
  }

  try {
    const child = spawn(executablePath, [], {
      env: {
        ...process.env,
        HWINFOX_TRAY_TELEMETRY_PATH: TRAY_TELEMETRY_PATH,
        HWINFOX_TRAY_COMMAND_PATH: TRAY_COMMAND_PATH,
        HWINFOX_TRAY_LOCK_PATH: TRAY_LOCK_PATH,
        HWINFOX_TRAY_PARENT_PID: String(getTrayHostPid()),
      },
      stdio: ['ignore', 'ignore', 'ignore'],
      detached: false,
      windowsHide: false,
    })

    activeTrayOwnerToken = ownerClaim.token
    activeTrayProcess = child
    publishTrayOwner(ownerClaim.token, child.pid)

    child.on('error', (err) => {
      console.warn('[windowsTrayHelper] process error:', err)
      if (activeTrayProcess === child) {
        activeTrayProcess = null
      }
      removeTrayOwnerRecord(ownerClaim.token)
    })

    child.on('exit', () => {
      if (activeTrayProcess === child) {
        activeTrayProcess = null
      }
      if (activeTrayOwnerToken === ownerClaim.token) {
        activeTrayOwnerToken = ''
      }
      removeTrayOwnerRecord(ownerClaim.token)
    })

    return { ok: true, running: true, pid: child.pid }
  } catch (error) {
    removeTrayOwnerRecord(ownerClaim.token)
    return {
      ok: false,
      running: false,
      reason: 'TRAY_HELPER_SPAWN_FAILED',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export function stopWindowsTrayHelper() {
  const proc = activeTrayProcess
  const owner = readTrayOwnerRecord()
  const helperPid = Number(owner?.helperPid)
  activeTrayProcess = null
  activeTrayOwnerToken = ''

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
      removeTrayOwnerRecord(owner?.token || '')
    }
  }, 200)

  try {
    if (fs.existsSync(TRAY_COMMAND_PATH)) {
      fs.unlinkSync(TRAY_COMMAND_PATH)
    }
  } catch {
  }

  return { ok: true, running: false }
}

let trayCommandHandler = null
let commandWatcher = null
let commandPollTimer = null
let lastHandledCommandId = ''

export function setWindowsTrayCommandHandler(handler) {
  trayCommandHandler = typeof handler === 'function' ? handler : null
  if (trayCommandHandler && isWindows()) {
    startWindowsTrayCommandListener()
  } else {
    stopWindowsTrayCommandListener()
  }
}

function processPendingTrayCommand() {
  if (!fs.existsSync(TRAY_COMMAND_PATH)) return

  try {
    const raw = fs.readFileSync(TRAY_COMMAND_PATH, 'utf8')
    if (!raw || !raw.trim()) return

    const clean = raw.trim().replace(/^\uFEFF/, '')
    let command
    try {
      command = JSON.parse(clean)
    } catch {
      return
    }

    if (!command || typeof command !== 'object') return
    if (command.id && command.id === lastHandledCommandId) return

    try {
      fs.unlinkSync(TRAY_COMMAND_PATH)
    } catch {
      return
    }

    lastHandledCommandId = command.id || String(Date.now())

    if (typeof trayCommandHandler === 'function') {
      try {
        trayCommandHandler(command)
      } catch (err) {
        console.error('[windowsTrayHelper] error handling tray command:', err)
      }
    }
  } catch {
    // Ignore read / unlink races
  }
}

export function startWindowsTrayCommandListener() {
  if (commandPollTimer || !isWindows()) return

  commandPollTimer = setInterval(() => {
    processPendingTrayCommand()
  }, 100)

  try {
    fs.mkdirSync(TRAY_STATE_DIRECTORY, { recursive: true })
    commandWatcher = fs.watch(TRAY_STATE_DIRECTORY, (eventType, filename) => {
      if (!filename || filename === 'command.json') {
        processPendingTrayCommand()
      }
    })
    commandWatcher.on('error', () => {
    })
  } catch {
  }
}

export function stopWindowsTrayCommandListener() {
  if (commandPollTimer) {
    clearInterval(commandPollTimer)
    commandPollTimer = null
  }
  if (commandWatcher) {
    try {
      commandWatcher.close()
    } catch {
    }
    commandWatcher = null
  }
}

export function updateWindowsTrayTelemetry(telemetry = {}) {
  processPendingTrayCommand()
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

  return writeTrayTelemetry(payload) && getWindowsTrayStatus().running
}
