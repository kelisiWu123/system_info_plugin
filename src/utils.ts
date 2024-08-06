function bytesToGB(bytes: number): string {
  const BYTES_IN_GB = 1024 * 1024 * 1024
  const gb = bytes / BYTES_IN_GB
  return gb.toFixed(2)
}
function mbToGB(megabytes: number): string {
  // 1 GB = 1024 MB
  const gigabytes = megabytes / 1024;
  return gigabytes.toFixed(2); // 保留两位小数
}

function bytesToMB(bytes: number): number {
  return bytes / (1024 * 1024);
}

function bytesToKB(bytes: number): number {
  return bytes /  1024;
}
export { bytesToGB ,mbToGB,bytesToMB,bytesToKB}
