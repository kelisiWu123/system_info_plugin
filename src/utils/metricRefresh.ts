/** Apply each metric as soon as it settles, without waiting for slower readers. */
export async function settleMetric<T>(
  promise: Promise<T>,
  apply: (result: PromiseSettledResult<T>) => void | Promise<void>,
): Promise<PromiseSettledResult<T>> {
  const result = await promise.then<PromiseSettledResult<T>, PromiseSettledResult<T>>(
    (value) => ({ status: 'fulfilled', value }),
    (reason: unknown) => ({ status: 'rejected', reason }),
  )
  await apply(result)
  return result
}

const historySamples = new WeakMap<number[], number>()

/** A reused snapshot is one observation, even if several UI refreshes read it. */
export function isNewMetricSample(history: number[], sampledAt?: number): boolean {
  if (sampledAt === undefined || !Number.isFinite(sampledAt)) return true
  const previous = historySamples.get(history)
  if (history.length && previous !== undefined && sampledAt <= previous) return false
  historySamples.set(history, sampledAt)
  return true
}

export function hasSharedHardwareTelemetry(): boolean {
  return window.services?.sharedHardwareTelemetrySupported === true && typeof window.services.subscribeHardwareTelemetry === 'function'
}

export async function refreshSharedHardwareMetrics(keys: HardwareTelemetryKey[]): Promise<void> {
  if (hasSharedHardwareTelemetry()) await window.services.refreshHardwareTelemetry?.(keys)
}

export type HardwareTelemetryHandlers = Partial<{
  [K in HardwareTelemetryKey]: (value: HardwareTelemetryValues[K], sampledAt: number) => void
}>

let visibilitySubscribers = 0
function trackHardwareVisibility(): () => void {
  const update = window.services.setHardwareTelemetryVisibility
  if (!update || typeof document === 'undefined') return () => {}
  const sync = () => update(document.hidden || document.visibilityState === 'hidden')
  // One listener per window; the final page subscription releases it.
  visibilitySubscribers++
  if (visibilitySubscribers === 1) document.addEventListener('visibilitychange', syncHardwareVisibility)
  sync()
  return () => {
    visibilitySubscribers--
    if (!visibilitySubscribers) {
      document.removeEventListener('visibilitychange', syncHardwareVisibility)
      update(true)
    }
  }
}
function syncHardwareVisibility() {
  window.services.setHardwareTelemetryVisibility?.(document.hidden || document.visibilityState === 'hidden')
}

/** All windows react to the same committed sample instead of their own poll phase. */
export function subscribeHardwareMetrics(
  handlers: HardwareTelemetryHandlers,
  onError?: (key: HardwareTelemetryKey, error: string) => void,
  onSuccess?: (key: HardwareTelemetryKey) => void,
): () => void {
  if (!Object.keys(handlers).length) return () => {}
  const subscribe = window.services.subscribeHardwareTelemetry
  if (!subscribe) return () => {}
  const versions = new Map<HardwareTelemetryKey, string>()
  function apply<K extends HardwareTelemetryKey>(key: K, snapshot: HardwareTelemetrySnapshot) {
    const version = snapshot.sampleId ?? String(snapshot.checkedAt)
    if (versions.get(key) === version) return
    versions.set(key, version)

    if (snapshot.status === 'stale') {
      if (snapshot.value !== undefined) {
        handlers[key]?.(snapshot.value as HardwareTelemetryValues[K], snapshot.sampledAt ?? snapshot.checkedAt)
      }
      return
    }

    if (snapshot.status === 'error') {
      if (snapshot.value !== undefined) handlers[key]?.(snapshot.value as HardwareTelemetryValues[K], snapshot.sampledAt ?? snapshot.checkedAt)
      onError?.(key, snapshot.error || '读取失败')
      return
    }
    handlers[key]?.(snapshot.value as HardwareTelemetryValues[K], snapshot.sampledAt ?? snapshot.checkedAt)
    onSuccess?.(key)
  }
  const stopVisibility = trackHardwareVisibility()
  const stop = subscribe(Object.keys(handlers) as HardwareTelemetryKey[], (snapshots) => {
    for (const key of Object.keys(snapshots) as HardwareTelemetryKey[]) {
      const snapshot = snapshots[key]
      if (snapshot) apply(key, snapshot)
    }
  })
  let released = false
  return () => {
    if (released) return
    released = true
    stop()
    stopVisibility()
  }
}

export function getMetricSampledAt(candidate: unknown): number | undefined {
  const data: unknown = Array.isArray(candidate) ? candidate[0] : candidate
  if (!data || typeof data !== 'object' || !('sampledAt' in data)) return undefined
  return typeof data.sampledAt === 'number' ? data.sampledAt : undefined
}

export function isOlderMetricSample(value: unknown, current: unknown): boolean {
  const incoming = getMetricSampledAt(value)
  const existing = getMetricSampledAt(current)
  return incoming !== undefined && existing !== undefined && incoming < existing
}


export function getHardwareMetricState(key: HardwareTelemetryKey, value: unknown): { status: 'ok' | 'missing'; note: string } {
  const missing = (note: string) => ({ status: 'missing' as const, note })
  if (!value) return missing('暂未提供数据')
  if (key === 'gpu' || key === 'storage') return Array.isArray(value) && value.length
    ? { status: 'ok', note: '' } : missing('未检测到设备')
  if (typeof value !== 'object') return missing('暂未提供数据')
  const data = value as Record<string, unknown>
  const reason = typeof data.message === 'string' ? data.message : typeof data.reason === 'string' ? data.reason : '当前设备未提供此项数据'
  if (data.source === 'unsupported') return missing(reason)
  const finite = (candidate: unknown) => typeof candidate === 'number' && Number.isFinite(candidate)
  let valid = true
  if (key === 'cpuTemperature') valid = finite(data.value ?? data.main) && Number(data.value ?? data.main) > 0
  if (key === 'cpuFrequency') {
    const speeds = [data.displayGHz, data.max, data.avg, ...(Array.isArray(data.cores) ? data.cores : [])]
    valid = speeds.some((speed: unknown) => finite(speed) && Number(speed) > 0)
  }
  if (['cpuPower', 'cpuVoltage', 'fanSpeed'].includes(key)) valid = finite(data.value) && Number(data.value) >= 0
  if (key === 'cpuLoad') valid = finite(data.currentLoad)
  if (key === 'memoryUsage') valid = finite(data.total) && Number(data.total) > 0
  if (key === 'networkIo') valid = typeof data.defaultInterface === 'string' && Boolean(data.defaultInterface)
  if (key === 'diskIo') valid = finite(data.readBytesPerSec) || finite(data.writeBytesPerSec)
  return valid ? { status: 'ok', note: '' } : missing(reason)
}
