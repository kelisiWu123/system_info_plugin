export type PageName = 'computer' | 'watch'
export type FloatingMonitorMode = 'standard' | 'super-lite'
export type FloatingMonitorEntry = 'hardwareWatch' | 'hardwareWatchSuperLite' | 'unknown'

export function getHashRoute(hash: string) {
  const normalized = hash.replace(/^#\/?/, '')
  const [pageName, query = ''] = normalized.split('?')
  return {
    pageName,
    query: new URLSearchParams(query),
  }
}

export function resolvePageName(hash: string): PageName {
  return getHashRoute(hash).pageName === 'watch' ? 'watch' : 'computer'
}

export function resolveInitialFloatingMode(hash: string): FloatingMonitorMode {
  const query = getHashRoute(hash).query
  return query.get('floatingMode') === 'super-lite' || query.get('entry') === 'hardwareWatchSuperLite'
    ? 'super-lite'
    : 'standard'
}

export function resolveInitialFloatingEntry(hash: string): FloatingMonitorEntry {
  const entry = getHashRoute(hash).query.get('entry')

  if (entry === 'hardwareWatch') return 'hardwareWatch'
  if (entry === 'hardwareWatchSuperLite') return 'hardwareWatchSuperLite'
  return 'unknown'
}
