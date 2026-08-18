import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = resolve('native/windows-sensor-helper/Program.cs')
const manifest = resolve('native/windows-sensor-helper/app.manifest')
const backendAssembly = resolve('vendor/openhardwaremonitor/OpenHardwareMonitor.exe')
const helperBinary = resolve('vendor/openhardwaremonitor/HWInfoXSensorHelper.exe')
const fingerprintFile = resolve('vendor/openhardwaremonitor/HWInfoXSensorHelper.source.sha256')

function computeFingerprint() {
  const hash = createHash('sha256')
  for (const filePath of [source, manifest, backendAssembly]) {
    hash.update(readFileSync(filePath))
  }
  return hash.digest('hex')
}

for (const requiredPath of [source, manifest, backendAssembly]) {
  if (!existsSync(requiredPath)) {
    console.error(`Windows sensor helper source input missing: ${requiredPath}`)
    process.exit(1)
  }
}

if (!existsSync(helperBinary) || !existsSync(fingerprintFile)) {
  console.error('Windows sensor helper prebuilt asset is missing.')
  console.error('Run `npm run build:windows-helper` once on Windows, then keep HWInfoXSensorHelper.exe and its .source.sha256 file in vendor/openhardwaremonitor/.')
  process.exit(1)
}

const expected = computeFingerprint()
const actual = readFileSync(fingerprintFile, 'utf8').trim().toLowerCase()

if (actual !== expected) {
  console.error('Windows sensor helper prebuilt asset is stale relative to Program.cs/app.manifest/OpenHardwareMonitor.exe.')
  console.error('Regenerate it with `npm run build:windows-helper` on Windows before creating a release build.')
  process.exit(1)
}

console.log('Windows sensor helper prebuilt asset verified.')
