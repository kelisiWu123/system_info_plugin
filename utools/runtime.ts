import path from 'node:path'

export interface UtoolsRuntimeLike {
  isDev: () => boolean
  outPlugin: () => void
  createBrowserWindow?: (...args: any[]) => any
  sendToParent?: (channel: string, ...args: unknown[]) => void
  getWindowType?: () => 'main' | 'detach' | 'browser'
  shellOpenPath?: (targetPath: string) => void
  getPath?: (name: string) => string
  dbStorage?: {
    getItem?: (key: string) => unknown
    setItem?: (key: string, value: unknown) => void
    removeItem?: (key: string) => void
  }
}

function isRuntimeLike(value: unknown): value is Partial<UtoolsRuntimeLike> {
  return typeof value === 'object' && value !== null
}

export function createFallbackUtoolsRuntime(): UtoolsRuntimeLike {
  return {
    isDev: () => true,
    outPlugin: () => undefined,
  }
}

export function resolveUtoolsRuntime(
  candidate?: unknown,
  globalObject: Record<string, unknown> = globalThis as Record<string, unknown>
): UtoolsRuntimeLike {
  const runtime = isRuntimeLike(candidate)
    ? candidate
    : isRuntimeLike(globalObject.utools)
      ? (globalObject.utools as Partial<UtoolsRuntimeLike>)
      : undefined

  if (!runtime) {
    return createFallbackUtoolsRuntime()
  }

  return {
    ...runtime,
    createBrowserWindow: runtime.createBrowserWindow?.bind(runtime),
    sendToParent: runtime.sendToParent?.bind(runtime),
    getWindowType: runtime.getWindowType?.bind(runtime),
    isDev: typeof runtime.isDev === 'function' ? runtime.isDev.bind(runtime) : () => true,
    outPlugin: typeof runtime.outPlugin === 'function' ? runtime.outPlugin.bind(runtime) : () => undefined,
  }
}

export function getUtoolsPluginRoot(runtime: UtoolsRuntimeLike, preloadDir: string) {
  try {
    return runtime.isDev() ? path.resolve(preloadDir, '..') : preloadDir
  } catch {
    return preloadDir
  }
}
