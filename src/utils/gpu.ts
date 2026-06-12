export interface GpuTemperatureSensorDisplay {
  name?: string
  identifier?: string
}

export interface GraphicsPlatformPanelVisibility {
  temperatureProbes: boolean
  telemetryDetails: boolean
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isRawAppleSmcGpuLabel(name: string, identifier: string) {
  const normalizedName = name.replace(/\s+/g, '')
  const normalizedIdentifier = identifier.replace(/\s+/g, '')

  return Boolean(
    normalizedIdentifier && /^Tg[0-9A-Za-z]+$/i.test(normalizedIdentifier)
    && (
      !normalizedName
      || /^AppleSMCTg[0-9A-Za-z]+$/i.test(normalizedName)
      || normalizedName.toLowerCase() === normalizedIdentifier.toLowerCase()
    )
  )
}

export function formatGpuTemperatureSensorLabel(sensor: GpuTemperatureSensorDisplay | undefined, index: number) {
  const name = cleanText(sensor?.name)
  const identifier = cleanText(sensor?.identifier)
  const fallback = `GPU 测点 ${index + 1}`
  const haystack = `${name} ${identifier}`.toLowerCase()

  if (!name && !identifier) return fallback
  if (haystack.includes('hotspot') || haystack.includes('hot spot')) return 'GPU 热点'
  if (haystack.includes('cluster')) return `GPU 集群测点 ${index + 1}`
  if (isRawAppleSmcGpuLabel(name, identifier)) return fallback
  if (/^gpu core \d+$/i.test(name)) return name.replace(/^gpu core/i, 'GPU 测点')

  return name || identifier || fallback
}

export function getGraphicsPlatformPanelVisibility(platform?: string): GraphicsPlatformPanelVisibility {
  return {
    temperatureProbes: platform === 'darwin',
    telemetryDetails: platform === 'win32',
  }
}
