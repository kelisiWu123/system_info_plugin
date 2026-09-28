export type PageName = 'computer' | 'watch' | 'monitor' | 'deviceSpecs' | 'menubarSettings' | 'cpuCoresWatch'
export type FloatingMonitorMode = 'standard' | 'super-lite'
export type CpuCoresFloatingMode = 'standard' | 'super-lite' | 'game'
export type FloatingMonitorEntry =
  | 'hardwareWatch'
  | 'hardwareWatchSuperLite'
  | 'hardwareWatchCpuCores'
  | 'hardwareWatchCpuCoresSuperLite'
  | 'unknown'

export function getHashRoute(hash: string) {
  const normalized = hash.replace(/^#\/?/, '')
  const [pageName, query = ''] = normalized.split('?')
  return {
    pageName,
    query: new URLSearchParams(query),
  }
}

export function resolvePageName(hash: string): PageName {
  const pageName = getHashRoute(hash).pageName

  if (pageName === 'watch') return 'watch'
  if (pageName === 'monitor') return 'monitor'
  if (pageName === 'deviceSpecs') return 'deviceSpecs'
  if (pageName === 'menubarSettings') return 'menubarSettings'
  if (pageName === 'cpuCoresWatch') return 'cpuCoresWatch'
  return 'computer'
}

export function resolveInitialFloatingMode(hash: string): FloatingMonitorMode {
  const query = getHashRoute(hash).query
  return query.get('floatingMode') === 'super-lite'
    || query.get('entry') === 'hardwareWatchSuperLite'
    || query.get('entry') === 'hardwareWatchCpuCoresSuperLite'
    ? 'super-lite'
    : 'standard'
}

export function resolveInitialCpuCoresFloatingMode(hash: string): CpuCoresFloatingMode {
  const query = getHashRoute(hash).query
  const mode = query.get('floatingMode')
  if (mode === 'game') return 'game'
  if (
    mode === 'super-lite' ||
    query.get('entry') === 'hardwareWatchCpuCoresSuperLite'
  ) {
    return 'super-lite'
  }
  return 'standard'
}

export function resolveInitialFloatingEntry(hash: string): FloatingMonitorEntry {
  const entry = getHashRoute(hash).query.get('entry')

  if (entry === 'hardwareWatch') return 'hardwareWatch'
  if (entry === 'hardwareWatchSuperLite') return 'hardwareWatchSuperLite'
  if (entry === 'hardwareWatchCpuCores') return 'hardwareWatchCpuCores'
  if (entry === 'hardwareWatchCpuCoresSuperLite') return 'hardwareWatchCpuCoresSuperLite'
  return 'unknown'
}
