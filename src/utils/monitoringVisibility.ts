interface MonitoringDocumentLike {
  hidden?: boolean
  visibilityState?: string
  hasFocus?: () => boolean
  addEventListener?: (event: 'visibilitychange', listener: () => void) => void
}

interface MonitoringWindowLike {
  addEventListener?: (event: 'focus' | 'blur', listener: () => void) => void
}

export interface MonitoringVisibilityOptions {
  requireFocus?: boolean
}

export function resolveMonitoringBackgroundThrottled(
  backgroundThrottleEnabled: boolean,
  doc: MonitoringDocumentLike | undefined = typeof document === 'undefined' ? undefined : document,
  options?: MonitoringVisibilityOptions
) {
  if (!doc || !backgroundThrottleEnabled) return false

  const visible = !doc.hidden && doc.visibilityState !== 'hidden'
  const requireFocus = options?.requireFocus ?? true
  const focused = requireFocus && typeof doc.hasFocus === 'function' ? doc.hasFocus() : true
  return !(visible && focused)
}

export function bindMonitoringVisibilityListeners(
  bound: boolean,
  listener: () => void,
  win: MonitoringWindowLike | undefined = typeof window === 'undefined' ? undefined : window,
  doc: MonitoringDocumentLike | undefined = typeof document === 'undefined' ? undefined : document
) {
  if (bound || !win?.addEventListener || !doc?.addEventListener) return bound

  win.addEventListener('focus', listener)
  win.addEventListener('blur', listener)
  doc.addEventListener('visibilitychange', listener)
  return true
}
