import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'win32') {
  console.error('Windows sensor helper regeneration requires Windows. Normal release builds use the prebuilt helper from vendor/openhardwaremonitor/.')
  process.exit(1)
}

const source = resolve('native/windows-sensor-helper/Program.cs')
const manifest = resolve('native/windows-sensor-helper/app.manifest')
const backendAssembly = resolve('vendor/openhardwaremonitor/OpenHardwareMonitor.exe')
const output = resolve('vendor/openhardwaremonitor/HWInfoXSensorHelper.exe')
const fingerprintFile = resolve('vendor/openhardwaremonitor/HWInfoXSensorHelper.source.sha256')
const windowsDir = process.env.WINDIR || 'C:\\Windows'
const compilerCandidates = [
  resolve(windowsDir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  resolve(windowsDir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
]
const compiler = compilerCandidates.find(existsSync)

for (const requiredPath of [source, manifest, backendAssembly]) {
  if (!existsSync(requiredPath)) {
    console.error(`Windows sensor helper build input missing: ${requiredPath}`)
    process.exit(1)
  }
}

if (!compiler) {
  console.error('Windows .NET Framework C# compiler was not found. Expected csc.exe under Microsoft.NET/Framework[64]/v4.0.30319.')
  process.exit(1)
}

mkdirSync(dirname(output), { recursive: true })

const args = [
  '/nologo',
  '/target:exe',
  '/platform:x64',
  '/optimize+',
  `/win32manifest:${manifest}`,
  '/reference:System.dll',
  '/reference:System.Core.dll',
  '/reference:System.Web.Extensions.dll',
  `/reference:${backendAssembly}`,
  `/out:${output}`,
  source,
]

const result = spawnSync(compiler, args, {
  stdio: 'inherit',
  windowsHide: true,
})

if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1)
}

const hash = createHash('sha256')
for (const filePath of [source, manifest, backendAssembly]) {
  hash.update(readFileSync(filePath))
}
writeFileSync(fingerprintFile, `${hash.digest('hex')}\n`, 'utf8')

console.log(`Built Windows sensor helper: ${output}`)
console.log(`Wrote source fingerprint: ${fingerprintFile}`)
process.exit(0)
