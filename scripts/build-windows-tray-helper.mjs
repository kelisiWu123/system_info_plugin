import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'win32') {
  console.error('Windows tray helper build requires Windows. Normal release builds use the prebuilt helper from vendor/windows/.')
  process.exit(1)
}

const source = resolve('native/windows-tray-helper/Program.cs')
const appManifest = resolve('native/windows-tray-helper/app.manifest')
const runtimeDirectory = resolve('vendor/windows')
const output = join(runtimeDirectory, 'HWInfoXTrayHelper.exe')
const runtimeManifestFile = join(runtimeDirectory, 'runtime-manifest.json')
const fingerprintFile = join(runtimeDirectory, 'HWInfoXTrayHelper.source.sha256')

const windowsDir = process.env.WINDIR || 'C:\\Windows'
const compilerCandidates = [
  resolve(windowsDir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  resolve(windowsDir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
]
const compiler = compilerCandidates.find(existsSync)

if (!compiler) {
  console.error('csc.exe not found in Microsoft.NET Framework directories.')
  process.exit(1)
}

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function canonicalizeFingerprintText(value) {
  return String(value).replace(/\r\n|\r/g, '\n')
}

mkdirSync(runtimeDirectory, { recursive: true })

console.log('Compiling Windows Tray Helper...')
const compileArgs = [
  '/target:winexe',
  '/optimize+',
  '/platform:anycpu',
  '/codepage:65001',
  `/win32manifest:${appManifest}`,
  '/r:System.dll,System.Windows.Forms.dll,System.Drawing.dll,System.Web.Extensions.dll,System.Core.dll',
  `/out:${output}`,
  source,
]

const result = spawnSync(compiler, compileArgs, { stdio: 'inherit' })
if (result.status !== 0) {
  console.error('Compilation of HWInfoXTrayHelper.exe failed.')
  process.exit(1)
}

const manifest = {
  helperVersion: '1.0.0',
  builtAt: new Date().toISOString(),
  target: 'HWInfoXTrayHelper.exe',
  targetSha256: sha256File(output),
}

const manifestContent = JSON.stringify(manifest, null, 2) + '\n'
writeFileSync(runtimeManifestFile, manifestContent, 'utf8')

const hash = createHash('sha256')
for (const filePath of [source, appManifest]) {
  hash.update(canonicalizeFingerprintText(readFileSync(filePath, 'utf8')))
}
hash.update(canonicalizeFingerprintText(manifestContent))
const fingerprint = hash.digest('hex')

writeFileSync(fingerprintFile, fingerprint + '\n', 'utf8')

console.log(`Windows tray helper built successfully -> ${output}`)
console.log(`Fingerprint written -> ${fingerprintFile}`)
