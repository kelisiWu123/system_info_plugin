export type SuperLiteStatusLevel = 'normal' | 'warning' | 'danger'

export interface SuperLiteStatusInput {
  cpuUsage: number
  gpuUsage: number
  memoryUsage: number
  cpuTemperature?: number | null
  gpuTemperature?: number | null
  memoryPressure?: 'normal' | 'warning' | 'critical' | 'unknown'
}

export interface SuperLiteStatus {
  level: SuperLiteStatusLevel
  label: string
}

export type SuperLiteMetricKey = 'cpu' | 'gpu' | 'memory'

export interface SuperLiteMetricStatusInput {
  usage: number
  temperature?: number | null
  pressure?: 'normal' | 'warning' | 'critical' | 'unknown'
}

function atLeast(value: number | null | undefined, threshold: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= threshold
}

function resolveMemoryStatus(
  usage: number,
  pressure?: SuperLiteMetricStatusInput['pressure']
): SuperLiteStatusLevel {
  if (pressure === 'critical') return 'danger'
  if (pressure === 'warning') return 'warning'
  if (pressure === 'normal') return 'normal'
  if (atLeast(usage, 95)) return 'danger'
  if (atLeast(usage, 90)) return 'warning'
  return 'normal'
}

export function resolveSuperLiteMetricStatus(
  metric: SuperLiteMetricKey,
  input: SuperLiteMetricStatusInput
): SuperLiteStatusLevel {
  if (metric === 'memory') {
    return resolveMemoryStatus(input.usage, input.pressure)
  }

  if (atLeast(input.temperature, 95) || atLeast(input.usage, 95)) return 'danger'
  if (atLeast(input.temperature, 85) || atLeast(input.usage, 85)) return 'warning'
  return 'normal'
}

export function resolveSuperLiteOverallStatus(input: SuperLiteStatusInput): SuperLiteStatus {
  const highTemperature = atLeast(input.cpuTemperature, 95) || atLeast(input.gpuTemperature, 95)
  const highLoad = atLeast(input.cpuUsage, 95) || atLeast(input.gpuUsage, 95)
  const memoryStatus = resolveMemoryStatus(input.memoryUsage, input.memoryPressure)

  if (highTemperature) return { level: 'danger', label: '高温' }
  if (highLoad) return { level: 'danger', label: '高负载' }
  if (memoryStatus === 'danger') return { level: 'danger', label: '内存紧张' }

  const warning =
    atLeast(input.cpuTemperature, 85) ||
    atLeast(input.gpuTemperature, 85) ||
    atLeast(input.cpuUsage, 85) ||
    atLeast(input.gpuUsage, 85) ||
    memoryStatus === 'warning'

  if (warning) return { level: 'warning', label: '注意' }
  return { level: 'normal', label: '良好' }
}

export function formatSuperLiteRefreshLabel(intervalMs: number) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return '↻--'
  const seconds = intervalMs / 1000
  return `↻${Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1)}s`
}
