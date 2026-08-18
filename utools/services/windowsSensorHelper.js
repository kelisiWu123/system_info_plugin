import net from 'node:net'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const WINDOWS_SENSOR_HELPER_PROCESS_NAME = 'HWInfoXSensorHelper.exe'
export const WINDOWS_SENSOR_HELPER_PIPE_NAME = 'hwinfox-sensor-helper-v1'
export const WINDOWS_SENSOR_HELPER_PIPE_PATH = `\\\\.\\pipe\\${WINDOWS_SENSOR_HELPER_PIPE_NAME}`
export const WINDOWS_SENSOR_HELPER_PROTOCOL_VERSION = 1

const HELPER_REQUEST_TIMEOUT_MS = 1200
const HELPER_START_WAIT_MS = 9000
const HELPER_START_POLL_MS = 300
const VALID_SENSOR_TYPES = new Set(['Temperature', 'Load', 'Power', 'Voltage', 'Fan', 'Clock'])

function isWindows() {
  return typeof process !== 'undefined' && process.platform === 'win32'
}

function quotePowerShellLiteral(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`
}

function normalizeHelperResponse(value) {
  if (!value || typeof value !== 'object') return null
  if (value.protocolVersion !== WINDOWS_SENSOR_HELPER_PROTOCOL_VERSION) return null
  return value
}

export function requestWindowsSensorHelper(command, timeoutMs = HELPER_REQUEST_TIMEOUT_MS) {
  if (!isWindows()) return Promise.resolve(null)

  return new Promise((resolve) => {
    let settled = false
    let buffer = ''
    let timer
    const socket = net.connect(WINDOWS_SENSOR_HELPER_PIPE_PATH)
    socket.setEncoding('utf8')

    const finish = (value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      socket.destroy()
      resolve(value)
    }

    timer = setTimeout(() => finish(null), timeoutMs)

    socket.on('connect', () => {
      socket.write(`${command}\n`)
    })

    socket.on('data', (chunk) => {
      buffer += chunk
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex < 0) return

      const line = buffer.slice(0, newlineIndex).trim()
      if (!line) {
        finish(null)
        return
      }

      try {
        finish(normalizeHelperResponse(JSON.parse(line)))
      } catch {
        finish(null)
      }
    })

    socket.on('error', () => finish(null))
    socket.on('end', () => {
      if (!settled && buffer.trim()) {
        try {
          finish(normalizeHelperResponse(JSON.parse(buffer.trim())))
          return
        } catch {
          // fall through to null
        }
      }
      finish(null)
    })
  })
}

export async function getWindowsSensorHelperStatus() {
  const response = await requestWindowsSensorHelper('ping', 700)
  if (!response?.ok) return null

  return {
    running: true,
    elevated: Boolean(response.elevated),
    helperVersion: typeof response.helperVersion === 'string' ? response.helperVersion : '',
    backend: typeof response.backend === 'string' ? response.backend : 'OpenHardwareMonitorLib',
    processId: Number.isFinite(response.processId) ? response.processId : null,
  }
}

export async function readWindowsSensorHelperSnapshot() {
  const response = await requestWindowsSensorHelper('snapshot')
  if (!response?.ok || !Array.isArray(response.sensors)) return null
  return response
}

export async function getWindowsSensorHelperSensors(sensorType) {
  if (!VALID_SENSOR_TYPES.has(sensorType)) return []

  const snapshot = await readWindowsSensorHelperSnapshot()
  if (!snapshot) return []

  return snapshot.sensors
    .filter((sensor) => sensor?.sensorType === sensorType)
    .map((sensor) => ({
      name: typeof sensor.name === 'string' ? sensor.name : '',
      identifier: typeof sensor.identifier === 'string' ? sensor.identifier : '',
      parent: typeof sensor.parent === 'string' ? sensor.parent : '',
      parentIdentifier: typeof sensor.parentIdentifier === 'string' ? sensor.parentIdentifier : '',
      hardwareType: typeof sensor.hardwareType === 'string' ? sensor.hardwareType : '',
      sensorType,
      value: typeof sensor.value === 'number' && Number.isFinite(sensor.value) ? sensor.value : null,
      source: 'WindowsSensorHelper',
    }))
    .filter((sensor) => sensor.value !== null)
}

export async function waitForWindowsSensorHelper(timeoutMs = HELPER_START_WAIT_MS) {
  const deadline = Date.now() + timeoutMs

  do {
    const status = await getWindowsSensorHelperStatus()
    if (status?.running) return status
    await new Promise((resolve) => setTimeout(resolve, HELPER_START_POLL_MS))
  } while (Date.now() < deadline)

  return null
}

export async function startWindowsSensorHelper({ executablePath, workingDirectory }) {
  if (!isWindows()) {
    return {
      started: false,
      running: false,
      reason: 'NOT_WINDOWS',
    }
  }

  const alreadyRunning = await getWindowsSensorHelperStatus()
  if (alreadyRunning?.running) {
    return {
      started: false,
      ...alreadyRunning,
    }
  }

  if (!executablePath) {
    return {
      started: false,
      running: false,
      reason: 'WINDOWS_SENSOR_HELPER_NOT_FOUND',
      suggestion: 'Windows 传感器增强组件不存在',
    }
  }

  const script = [
    `$p = Start-Process -FilePath ${quotePowerShellLiteral(executablePath)}`,
    `-WorkingDirectory ${quotePowerShellLiteral(workingDirectory || '')}`,
    `-ArgumentList @('--pipe-name', '${WINDOWS_SENSOR_HELPER_PIPE_NAME}')`,
    '-WindowStyle Hidden -Verb RunAs -PassThru',
    '; $p.Id',
  ].join(' ')

  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ], {
      windowsHide: false,
      timeout: 12000,
    })

    const startedPid = Number.parseInt(String(stdout || '').trim(), 10)
    const ready = await waitForWindowsSensorHelper()
    if (!ready?.running) {
      return {
        started: Number.isFinite(startedPid) && startedPid > 0,
        running: false,
        processId: Number.isFinite(startedPid) && startedPid > 0 ? startedPid : null,
        reason: 'WINDOWS_SENSOR_HELPER_START_FAILED',
        suggestion: '增强组件已启动但未能建立本地通信，请重试或检查安全软件拦截',
      }
    }

    return {
      started: true,
      ...ready,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const cancelled = /canceled|cancelled|operation was canceled|操作已被用户取消|用户取消/i.test(message)
    return {
      started: false,
      running: false,
      reason: cancelled ? 'WINDOWS_SENSOR_HELPER_AUTH_CANCELLED' : 'WINDOWS_SENSOR_HELPER_START_FAILED',
      suggestion: cancelled ? '已取消 Windows 管理员授权' : 'Windows 传感器增强组件启动失败，可能被权限或安全软件拦截',
      error: message,
    }
  }
}

export async function stopWindowsSensorHelper() {
  if (!isWindows()) return false
  const response = await requestWindowsSensorHelper('shutdown', 1200)
  return Boolean(response?.ok)
}
