import { formatBytes } from '../utils'

type OverviewGpuLike = {
  model?: string
  name?: string
  memoryTotal?: number | null
  vram?: number
  bus?: string
}

type OverviewAudioLike = {
  name?: string
  manufacturer?: string
}

type OverviewNetworkLike = {
  default?: boolean
  iface?: string
  ifaceName?: string
  internal?: boolean
  ip4?: string
  speed?: number | null
}

const GENERIC_GPU_BUS_VALUES = new Set(['built-in', 'builtin', 'integrated', 'shared'])
const VIRTUAL_AUDIO_PATTERNS = [
  /virtual/i,
  /loopback/i,
  /blackhole/i,
  /soundflower/i,
  /vb[- ]?cable/i,
  /aggregate/i,
]
const NOISY_NETWORK_PREFIXES = /^(anpi|ap\d*|awdl|bridge|docker|gif|llw|lo|stf|utun|vboxnet|vmnet|veth|br-|tailscale)/i

function cleanOverviewText(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.trim()
}

export function formatOverviewGpuMemory(primaryGpu?: OverviewGpuLike) {
  if (!primaryGpu) return ''

  const memory = primaryGpu.memoryTotal || primaryGpu.vram || 0
  if (!memory) return ''

  return `${(memory / 1024).toFixed(0)} GB`
}

export function normalizeOverviewGpuBus(bus?: string) {
  const value = cleanOverviewText(bus)
  if (!value) return ''
  if (GENERIC_GPU_BUS_VALUES.has(value.toLowerCase())) return ''
  return value
}

export function getOverviewGpuLines(primaryGpu?: OverviewGpuLike) {
  if (!primaryGpu) return []

  const parts = [
    primaryGpu.model || primaryGpu.name || '',
    formatOverviewGpuMemory(primaryGpu),
    normalizeOverviewGpuBus(primaryGpu.bus),
  ].filter(Boolean)

  return parts.length ? [parts.join(' / ')] : []
}

function formatOverviewAudioLine(item: OverviewAudioLike) {
  return cleanOverviewText(item.name) || cleanOverviewText(item.manufacturer) || '未知音频设备'
}

function isVirtualAudioLine(line: string) {
  return VIRTUAL_AUDIO_PATTERNS.some((pattern) => pattern.test(line))
}

export function getOverviewAudioLines(audioDevices: OverviewAudioLike[], limit = 3) {
  const lines = audioDevices.map(formatOverviewAudioLine).filter(Boolean)
  const uniqueLines = Array.from(new Set(lines))
  const userFacingLines = uniqueLines.filter((line) => !isVirtualAudioLine(line))
  const source = userFacingLines.length ? userFacingLines : uniqueLines

  return source.slice(0, limit)
}

function isNoisyNetworkInterfaceName(value: string) {
  return NOISY_NETWORK_PREFIXES.test(value)
}

function formatOverviewNetworkSpeed(speed?: number | null) {
  if (!speed || speed <= 0) return ''
  if (speed === 100) return '百兆连接'
  if (speed === 1000) return '千兆连接'
  if (speed >= 1000 && speed % 1000 === 0) return `${speed / 1000} Gbps`
  if (speed > 1000) return `${(speed / 1000).toFixed(1)} Gbps`
  return `${speed} Mbps`
}

function formatOverviewNetworkLine(item: OverviewNetworkLike) {
  const ip4Text = cleanOverviewText(item.ip4)
  const speedText = formatOverviewNetworkSpeed(item.speed)

  if (ip4Text && speedText) return `${ip4Text}（${speedText}）`
  if (ip4Text) return `${ip4Text}（已连接）`
  if (speedText) return `已连接（${speedText}）`
  return '网络已连接'
}

function isMeaningfulOverviewNetwork(item: OverviewNetworkLike) {
  const name = cleanOverviewText(item.ifaceName) || cleanOverviewText(item.iface)
  if (!name || item.internal) return false
  return !isNoisyNetworkInterfaceName(name)
}

export function getOverviewNetworkCandidates<T extends OverviewNetworkLike>(networkInterfaces: T[], limit = 3): T[] {
  const candidates = networkInterfaces.filter(isMeaningfulOverviewNetwork)
  const defaultCandidates = candidates.filter((item) => item.default)
  const source = defaultCandidates.length
    ? defaultCandidates
    : candidates.some((item) => (item.speed || 0) > 0)
      ? candidates.filter((item) => (item.speed || 0) > 0)
      : candidates

  return source.slice(0, limit)
}

export function getOverviewNetworkLines(networkInterfaces: OverviewNetworkLike[], limit = 3) {
  const source = getOverviewNetworkCandidates(networkInterfaces, limit)
  const lines = source.map(formatOverviewNetworkLine).filter(Boolean)
  return Array.from(new Set(lines)).slice(0, limit)
}

export function getOverviewStorageLines(summary: { total: number; used: number }) {
  if (!summary.total || summary.total <= 0) return []
  return [`已用 ${formatBytes(summary.used)} / ${formatBytes(summary.total)}`]
}
