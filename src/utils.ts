function bytesToGB(bytes: number): string {
  const BYTES_IN_GB = 1024 * 1024 * 1024
  const gb = bytes / BYTES_IN_GB
  return gb.toFixed(2)
}

export { bytesToGB }
