export function withTimeout<T>(promise: Promise<T>, timeout = 8000): Promise<T> {
  let timerId: ReturnType<typeof globalThis.setTimeout> | undefined
  const timedPromise = Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timerId = globalThis.setTimeout(() => reject(new Error('读取超时')), timeout)
    }),
  ])

  return timedPromise.finally(() => {
    if (timerId !== undefined) globalThis.clearTimeout(timerId)
  })
}

export async function readService<T>(reader: () => Promise<T>, timeout = 8000, retries = 0): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await withTimeout(reader(), timeout)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('读取失败')
}

export function normalizeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : '未知错误'
}

export function getServiceErrorDescription(message: string | undefined, fallback: string) {
  const normalized = message?.trim().toLowerCase() || ''
  if (!normalized) return fallback

  if (normalized.includes('读取超时') || normalized.includes('timeout')) {
    return `${fallback} 本次读取超时，请稍后重试。`
  }

  if (/(permission denied|access is denied|not authorized|eacces|没有权限|权限不足)/.test(normalized)) {
    return '没有读取此信息的系统权限，请检查授权后重试。'
  }

  if (/(cannot read properties|is not a function|typeerror|referenceerror|window\.services|undefined|null)/.test(normalized)) {
    return '插件运行环境暂未就绪，请关闭后重新打开插件再试。'
  }

  return fallback
}
