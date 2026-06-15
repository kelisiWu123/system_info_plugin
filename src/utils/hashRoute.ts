export type PageName = 'computer' | 'watch'
export type FloatingMonitorMode = 'standard' | 'super-lite'

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
  return getHashRoute(hash).query.get('floatingMode') === 'super-lite' ? 'super-lite' : 'standard'
}
