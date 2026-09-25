import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const source = resolve('native/windows-tray-helper/Program.cs')
const appManifest = resolve('native/windows-tray-helper/app.manifest')
const runtimeDirectory = resolve('vendor/windows')
const helperBinary = join(runtimeDirectory, 'HWInfoXTrayHelper.exe')
const runtimeManifestFile = join(runtimeDirectory, 'runtime-manifest.json')
const fingerprintFile = join(runtimeDirectory, 'HWInfoXTrayHelper.source.sha256')

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

for (const requiredPath of [source, appManifest]) {
  if (!existsSync(requiredPath)) {
    console.error(`Windows tray helper source input missing: ${requiredPath}`)
    process.exit(1)
  }
}

for (const requiredPath of [helperBinary, runtimeManifestFile, fingerprintFile]) {
  if (!existsSync(requiredPath)) {
    console.error(`Windows tray helper prebuilt asset is missing: ${requiredPath}`)
    console.error('Run `node scripts/build-windows-tray-helper.mjs` on Windows to generate vendor/windows/ assets.')
    process.exit(1)
  }
}

let runtimeManifest
let runtimeManifestContent
try {
  runtimeManifestContent = readFileSync(runtimeManifestFile, 'utf8')
  runtimeManifest = JSON.parse(runtimeManifestContent)
} catch (error) {
  console.error(`Failed to parse ${runtimeManifestFile}: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

const recordedFingerprint = readFileSync(fingerprintFile, 'utf8').trim()
const expectedFingerprint = computeFingerprint(runtimeManifestContent)

if (recordedFingerprint !== expectedFingerprint) {
  console.error('Windows tray helper source fingerprint mismatch.')
  console.error(`Recorded fingerprint: ${recordedFingerprint}`)
  console.error(`Expected fingerprint: ${expectedFingerprint}`)
  console.error('Run `node scripts/build-windows-tray-helper.mjs` on Windows to refresh prebuilt tray assets.')
  process.exit(1)
}

const helperSha256 = sha256File(helperBinary)
if (runtimeManifest.targetSha256 && runtimeManifest.targetSha256 !== helperSha256) {
  console.error(`Windows tray helper binary checksum mismatch for ${helperBinary}`)
  process.exit(1)
}

console.log('Windows tray helper prebuilt asset verified.')
