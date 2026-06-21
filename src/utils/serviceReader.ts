export function withTimeout<T>(promise: Promise<T>, timeout = 8000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      globalThis.setTimeout(() => reject(new Error('读取超时')), timeout)
    }),
  ])
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
