import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const source = resolve('native/windows-sensor-helper/Program.cs')
const appManifest = resolve('native/windows-sensor-helper/app.manifest')
const runtimeDirectory = resolve('vendor/openhardwaremonitor/sensor-helper')
const helperBinary = join(runtimeDirectory, 'HWInfoXSensorHelper.exe')
const runtimeManifestFile = join(runtimeDirectory, 'runtime-manifest.json')
const fingerprintFile = join(runtimeDirectory, 'HWInfoXSensorHelper.source.sha256')
const requiredLibraryFile = join(runtimeDirectory, 'OpenHardwareMonitorLib.dll')

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function canonicalizeFingerprintText(value) {
  return String(value).replace(/\r\n|\r/g, '\n')
}

function computeFingerprint(runtimeManifestContent) {
  const hash = createHash('sha256')
  for (const filePath of [source, appManifest]) {
    hash.update(canonicalizeFingerprintText(readFileSync(filePath, 'utf8')))
  }
  hash.update(canonicalizeFingerprintText(runtimeManifestContent))
  return hash.digest('hex')
}

function computeLegacyWindowsFingerprint(runtimeManifestContent) {
  const hash = createHash('sha256')
  for (const filePath of [source, appManifest]) {
    const canonicalText = canonicalizeFingerprintText(readFileSync(filePath, 'utf8'))
    hash.update(canonicalText.replace(/\n/g, '\r\n'))
  }
  hash.update(runtimeManifestContent)
  return hash.digest('hex')
}

for (const requiredPath of [source, appManifest]) {
  if (!existsSync(requiredPath)) {
    console.error(`Windows sensor helper source input missing: ${requiredPath}`)
    process.exit(1)
  }
}

for (const requiredPath of [helperBinary, runtimeManifestFile, fingerprintFile, requiredLibraryFile]) {
  if (!existsSync(requiredPath)) {
    console.error(`Windows sensor helper prebuilt asset is missing: ${requiredPath}`)
    console.error('Run `npm run build:windows-helper` once on Windows, then keep vendor/openhardwaremonitor/sensor-helper/ in the project.')
    process.exit(1)
  }
}

let runtimeManifest
let runtimeManifestContent
try {
  runtimeManifestContent = readFileSync(runtimeManifestFile, 'utf8')
  runtimeManifest = JSON.parse(runtimeManifestContent)
} catch (error) {
  console.error(`Windows sensor helper runtime manifest is invalid: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

if (runtimeManifest?.library?.id !== 'OpenHardwareMonitorLib' || runtimeManifest?.library?.version !== '1.0.9513') {
  console.error('Windows sensor helper runtime manifest does not reference OpenHardwareMonitorLib 1.0.9513.')
  process.exit(1)
}

if (runtimeManifest?.helper?.file !== 'HWInfoXSensorHelper.exe' || runtimeManifest.helper.sha256 !== sha256File(helperBinary)) {
  console.error('Windows sensor helper executable hash does not match runtime-manifest.json.')
  process.exit(1)
}

if (!Array.isArray(runtimeManifest.files) || !runtimeManifest.files.some((entry) => entry?.name === 'OpenHardwareMonitorLib.dll')) {
  console.error('Windows sensor helper runtime manifest does not include OpenHardwareMonitorLib.dll.')
  process.exit(1)
}

for (const entry of runtimeManifest.files) {
  if (!entry || typeof entry.name !== 'string' || typeof entry.sha256 !== 'string') {
    console.error('Windows sensor helper runtime manifest contains an invalid file entry.')
    process.exit(1)
  }

  const filePath = join(runtimeDirectory, entry.name)
  if (!existsSync(filePath)) {
    console.error(`Windows sensor helper runtime asset is missing: ${filePath}`)
    process.exit(1)
  }

  if (sha256File(filePath) !== entry.sha256) {
    console.error(`Windows sensor helper runtime asset hash mismatch: ${entry.name}`)
    process.exit(1)
  }
}

const expectedFingerprint = computeFingerprint(runtimeManifestContent)
const legacyWindowsFingerprint = computeLegacyWindowsFingerprint(runtimeManifestContent)
const actualFingerprint = readFileSync(fingerprintFile, 'utf8').trim().toLowerCase()
if (actualFingerprint !== expectedFingerprint && actualFingerprint !== legacyWindowsFingerprint) {
  console.error('Windows sensor helper prebuilt asset is stale relative to Program.cs/app.manifest/runtime-manifest.json.')
  console.error('Regenerate it with `npm run build:windows-helper` on Windows before creating a release build.')
  process.exit(1)
}

if (actualFingerprint === legacyWindowsFingerprint && actualFingerprint !== expectedFingerprint) {
  console.log('Windows sensor helper prebuilt asset verified with legacy CRLF source fingerprint; the next regeneration will write the cross-platform canonical fingerprint.')
} else {
  console.log('Windows sensor helper prebuilt asset verified.')
}
