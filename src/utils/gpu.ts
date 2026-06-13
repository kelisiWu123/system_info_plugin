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

export function getPrimaryGpuSelectionScore(gpu: GpuData) {
  const haystack = `${gpu.vendor || ''} ${gpu.model || ''} ${gpu.name || ''}`.toLowerCase()
  const memory = gpu.memoryTotal || gpu.vram || 0
  let score = 0

  if (gpu.utilizationGpu !== null && gpu.utilizationGpu !== undefined) score += 120
  if (gpu.temperatureGpu !== null && gpu.temperatureGpu !== undefined) score += 60
  if (gpu.powerDraw !== null && gpu.powerDraw !== undefined) score += 40
  if (gpu.bus) score += 20
  if (haystack.includes('nvidia') || haystack.includes('geforce') || haystack.includes('rtx') || haystack.includes('gtx')) score += 400
  if (haystack.includes('amd') || haystack.includes('radeon') || haystack.includes('rx ')) score += 320
  if (haystack.includes('apple')) score += 280
  if (haystack.includes('intel')) score -= 180
  if (haystack.includes('uhd') || haystack.includes('iris') || haystack.includes('vega')) score -= 90
  if (memory >= 4096) score += 220
  else if (memory >= 2048) score += 120
  else if (memory > 0) score += 40
  if (gpu.vramDynamic) score -= 80

  return score
}

export function selectPrimaryGpu(gpuData: GpuData[]) {
  if (!gpuData.length) return undefined
  return [...gpuData].sort((left, right) => getPrimaryGpuSelectionScore(right) - getPrimaryGpuSelectionScore(left))[0]
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
