import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import https from 'node:https'
import { basename, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const OPEN_HARDWARE_MONITOR_LIBRARY_ID = 'OpenHardwareMonitorLib'
const OPEN_HARDWARE_MONITOR_LIBRARY_VERSION = '1.0.9513'
const TARGET_FRAMEWORK = 'net472'
const NUGET_SOURCE = 'https://api.nuget.org/v3/index.json'
const NUGET_EXE_URL = 'https://dist.nuget.org/win-x86-commandline/latest/nuget.exe'
const FRAMEWORK_PRIORITY = [
  'net472',
  'net471',
  'net47',
  'net462',
  'net461',
  'net46',
  'net452',
  'net451',
  'net45',
  'netstandard2.0',
]

if (process.platform !== 'win32') {
  console.error('Windows sensor helper regeneration requires Windows. Normal release builds use the prebuilt helper from vendor/openhardwaremonitor/sensor-helper/.')
  process.exit(1)
}

const source = resolve('native/windows-sensor-helper/Program.cs')
const appManifest = resolve('native/windows-sensor-helper/app.manifest')
const cacheRoot = resolve('native/windows-sensor-helper/.cache')
const nugetExe = join(cacheRoot, 'nuget.exe')
const packagesRoot = join(cacheRoot, 'packages')
const compileResponseFile = join(cacheRoot, 'compile.rsp')
const runtimeDirectory = resolve('vendor/openhardwaremonitor/sensor-helper')
const output = join(runtimeDirectory, 'HWInfoXSensorHelper.exe')
const runtimeManifestFile = join(runtimeDirectory, 'runtime-manifest.json')
const fingerprintFile = join(runtimeDirectory, 'HWInfoXSensorHelper.source.sha256')
const windowsDir = process.env.WINDIR || 'C:\\Windows'
const compilerCandidates = [
  resolve(windowsDir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  resolve(windowsDir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
]
const compiler = compilerCandidates.find(existsSync)

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function canonicalizeFingerprintText(value) {
  return String(value).replace(/\r\n|\r/g, '\n')
}

function downloadFile(url, destination, redirectCount = 0) {
  if (redirectCount > 6) {
    return Promise.reject(new Error(`Too many redirects while downloading ${url}`))
  }

  return new Promise((resolveDownload, rejectDownload) => {
    const request = https.get(url, (response) => {
      const status = response.statusCode || 0
      const location = response.headers.location

      if (status >= 300 && status < 400 && location) {
        response.resume()
        const nextUrl = new URL(location, url).toString()
        resolveDownload(downloadFile(nextUrl, destination, redirectCount + 1))
        return
      }

      if (status !== 200) {
        response.resume()
        rejectDownload(new Error(`Download failed (${status}) for ${url}`))
        return
      }

      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        writeFileSync(destination, Buffer.concat(chunks))
        resolveDownload()
      })
      response.on('error', rejectDownload)
    })

    request.on('error', rejectDownload)
  })
}

function run(command, args, errorMessage) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    windowsHide: true,
  })

  if ((result.status ?? 1) !== 0) {
    throw new Error(`${errorMessage} (exit ${result.status ?? 'unknown'})`)
  }
}

function selectFrameworkDirectory(rootDirectory) {
  if (!existsSync(rootDirectory)) return null
  const directories = readdirSync(rootDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  const byLowerName = new Map(directories.map((name) => [name.toLowerCase(), name]))

  for (const preferred of FRAMEWORK_PRIORITY) {
    const actualName = byLowerName.get(preferred)
    if (actualName) return join(rootDirectory, actualName)
  }

  return null
}

function listFiles(directoryPath, predicate = () => true) {
  if (!directoryPath || !existsSync(directoryPath)) return []
  return readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .map((entry) => join(directoryPath, entry.name))
}

function readPackageMetadata(packageDirectory) {
  const nuspecName = readdirSync(packageDirectory).find((name) => name.toLowerCase().endsWith('.nuspec'))
  if (!nuspecName) {
    return {
      id: basename(packageDirectory),
      version: '',
      license: '',
    }
  }

  const nuspec = readFileSync(join(packageDirectory, nuspecName), 'utf8')
  const id = nuspec.match(/<id>([^<]+)<\/id>/i)?.[1]?.trim() || basename(packageDirectory)
  const version = nuspec.match(/<version>([^<]+)<\/version>/i)?.[1]?.trim() || ''
  const license = nuspec.match(/<license[^>]*>([^<]+)<\/license>/i)?.[1]?.trim()
    || nuspec.match(/<licenseUrl>([^<]+)<\/licenseUrl>/i)?.[1]?.trim()
    || ''

  return { id, version, license }
}

function registerAsset(assetMap, sourcePath, packageMetadata, kind, priority) {
  const name = basename(sourcePath)
  const existing = assetMap.get(name.toLowerCase())

  if (existing && existing.priority === priority && sha256File(existing.sourcePath) !== sha256File(sourcePath)) {
    throw new Error(`Conflicting Windows sensor runtime asset: ${name}`)
  }

  if (!existing || priority >= existing.priority) {
    assetMap.set(name.toLowerCase(), {
      name,
      sourcePath,
      packageMetadata,
      kind,
      priority,
    })
  }
}

function collectPackageAssets(packageDirectory, runtimeAssets, compileReferences) {
  const packageMetadata = readPackageMetadata(packageDirectory)
  const libraryDirectory = selectFrameworkDirectory(join(packageDirectory, 'lib'))
  const libraryDlls = listFiles(libraryDirectory, (name) => name.toLowerCase().endsWith('.dll'))

  for (const dll of libraryDlls) {
    registerAsset(runtimeAssets, dll, packageMetadata, 'lib', 10)
    registerAsset(compileReferences, dll, packageMetadata, 'lib', 10)
  }

  const runtimeRoots = [
    { root: join(packageDirectory, 'runtimes', 'win', 'lib'), priority: 20, kind: 'runtime-win' },
    { root: join(packageDirectory, 'runtimes', 'win-x64', 'lib'), priority: 30, kind: 'runtime-win-x64' },
  ]

  for (const runtimeRoot of runtimeRoots) {
    const frameworkDirectory = selectFrameworkDirectory(runtimeRoot.root)
    const dlls = listFiles(frameworkDirectory, (name) => name.toLowerCase().endsWith('.dll'))
    for (const dll of dlls) {
      registerAsset(runtimeAssets, dll, packageMetadata, runtimeRoot.kind, runtimeRoot.priority)
      if (!compileReferences.has(basename(dll).toLowerCase())) {
        registerAsset(compileReferences, dll, packageMetadata, runtimeRoot.kind, runtimeRoot.priority)
      }
    }
  }

  const nativeRoots = [
    { root: join(packageDirectory, 'runtimes', 'win', 'native'), priority: 40, kind: 'native-win' },
    { root: join(packageDirectory, 'runtimes', 'win-x64', 'native'), priority: 50, kind: 'native-win-x64' },
  ]

  for (const nativeRoot of nativeRoots) {
    for (const filePath of listFiles(nativeRoot.root)) {
      registerAsset(runtimeAssets, filePath, packageMetadata, nativeRoot.kind, nativeRoot.priority)
    }
  }
}

function findNetStandardFacade() {
  const programFilesX86 = process.env['ProgramFiles(x86)'] || process.env.ProgramFiles || 'C:\\Program Files (x86)'
  const candidates = [
    join(programFilesX86, 'Reference Assemblies', 'Microsoft', 'Framework', '.NETFramework', 'v4.7.2', 'Facades', 'netstandard.dll'),
    join(programFilesX86, 'Reference Assemblies', 'Microsoft', 'Framework', '.NETFramework', 'v4.8', 'Facades', 'netstandard.dll'),
    join(windowsDir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'Facades', 'netstandard.dll'),
    join(windowsDir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'Facades', 'netstandard.dll'),
  ]
  return candidates.find(existsSync)
}

function responseFileQuote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`
}

function buildRuntimeManifest(runtimeAssets) {
  const packages = new Map()
  const files = [...runtimeAssets.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((asset) => {
      const metadata = asset.packageMetadata
      packages.set(`${metadata.id}@${metadata.version}`, metadata)
      return {
        name: asset.name,
        sha256: sha256File(join(runtimeDirectory, asset.name)),
        packageId: metadata.id,
        packageVersion: metadata.version,
        kind: asset.kind,
      }
    })

  return {
    schemaVersion: 1,
    targetFramework: TARGET_FRAMEWORK,
    library: {
      id: OPEN_HARDWARE_MONITOR_LIBRARY_ID,
      version: OPEN_HARDWARE_MONITOR_LIBRARY_VERSION,
    },
    helper: {
      file: basename(output),
      sha256: sha256File(output),
    },
    packages: [...packages.values()].sort((left, right) => left.id.localeCompare(right.id)),
    files,
  }
}

function computeSourceFingerprint(runtimeManifestContent) {
  const hash = createHash('sha256')
  for (const filePath of [source, appManifest]) {
    hash.update(canonicalizeFingerprintText(readFileSync(filePath, 'utf8')))
  }
  hash.update(canonicalizeFingerprintText(runtimeManifestContent))
  return hash.digest('hex')
}

async function main() {
  for (const requiredPath of [source, appManifest]) {
    if (!existsSync(requiredPath)) {
      throw new Error(`Windows sensor helper build input missing: ${requiredPath}`)
    }
  }

  if (!compiler) {
    throw new Error('Windows .NET Framework C# compiler was not found. Expected csc.exe under Microsoft.NET/Framework[64]/v4.0.30319.')
  }

  mkdirSync(cacheRoot, { recursive: true })
  if (!existsSync(nugetExe)) {
    console.log('Downloading NuGet CLI for Windows sensor helper restore...')
    await downloadFile(NUGET_EXE_URL, nugetExe)
  }

  rmSync(packagesRoot, { recursive: true, force: true })
  mkdirSync(packagesRoot, { recursive: true })
  run(nugetExe, [
    'install',
    OPEN_HARDWARE_MONITOR_LIBRARY_ID,
    '-Version', OPEN_HARDWARE_MONITOR_LIBRARY_VERSION,
    '-OutputDirectory', packagesRoot,
    '-Framework', TARGET_FRAMEWORK,
    '-DependencyVersion', 'Lowest',
    '-NonInteractive',
    '-Source', NUGET_SOURCE,
  ], 'Failed to restore OpenHardwareMonitorLib NuGet runtime')

  const packageDirectories = readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesRoot, entry.name))
    .sort((left, right) => left.localeCompare(right))

  const runtimeAssets = new Map()
  const compileReferences = new Map()
  for (const packageDirectory of packageDirectories) {
    collectPackageAssets(packageDirectory, runtimeAssets, compileReferences)
  }

  const libraryReference = compileReferences.get('openhardwaremonitorlib.dll')
  if (!libraryReference) {
    throw new Error(`NuGet restore completed but ${OPEN_HARDWARE_MONITOR_LIBRARY_ID}.dll was not found for ${TARGET_FRAMEWORK}.`)
  }

  rmSync(runtimeDirectory, { recursive: true, force: true })
  mkdirSync(runtimeDirectory, { recursive: true })
  for (const asset of runtimeAssets.values()) {
    copyFileSync(asset.sourcePath, join(runtimeDirectory, asset.name))
  }

  const responseLines = [
    '/nologo',
    '/target:exe',
    '/platform:x64',
    '/optimize+',
    `/win32manifest:${responseFileQuote(appManifest)}`,
    '/reference:System.dll',
    '/reference:System.Core.dll',
    '/reference:System.Web.Extensions.dll',
  ]

  const usesNetStandardAsset = [...compileReferences.values()].some((asset) => /[\\/]netstandard2\.0[\\/]/i.test(asset.sourcePath))
  if (usesNetStandardAsset) {
    const netstandardFacade = findNetStandardFacade()
    if (!netstandardFacade) {
      throw new Error('A restored Windows sensor dependency requires netstandard2.0, but netstandard.dll was not found. Install the .NET Framework 4.7.2/4.8 Developer Pack and retry.')
    }
    responseLines.push(`/reference:${responseFileQuote(netstandardFacade)}`)
  }

  for (const reference of [...compileReferences.values()].sort((left, right) => left.name.localeCompare(right.name))) {
    responseLines.push(`/reference:${responseFileQuote(reference.sourcePath)}`)
  }
  responseLines.push(`/out:${responseFileQuote(output)}`)
  responseLines.push(responseFileQuote(source))
  writeFileSync(compileResponseFile, `${responseLines.join('\r\n')}\r\n`, 'utf8')

  run(compiler, [`@${compileResponseFile}`], 'Windows sensor helper C# compilation failed')

  const runtimeManifest = buildRuntimeManifest(runtimeAssets)
  const runtimeManifestContent = `${JSON.stringify(runtimeManifest, null, 2)}\n`
  writeFileSync(runtimeManifestFile, runtimeManifestContent, 'utf8')
  writeFileSync(fingerprintFile, `${computeSourceFingerprint(runtimeManifestContent)}\n`, 'utf8')

  console.log(`Built Windows sensor helper: ${output}`)
  console.log(`Bundled ${runtimeAssets.size} managed/native runtime assets from ${OPEN_HARDWARE_MONITOR_LIBRARY_ID} ${OPEN_HARDWARE_MONITOR_LIBRARY_VERSION}.`)
  console.log(`Wrote runtime manifest: ${runtimeManifestFile}`)
  console.log(`Wrote source fingerprint: ${fingerprintFile}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
