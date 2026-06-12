import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'darwin') {
  console.log('Skipping mac-smc-sensors build on non-macOS platform.')
  process.exit(0)
}

const source = resolve('native/mac-smc-sensors/mac-smc-sensors.c')
const output = resolve('vendor/macos/mac-smc-sensors')
const helperSource = resolve('native/macos-powermetrics-helper/hwinfox-powermetrics-helper.c')
const helperOutput = resolve('vendor/macos/hwinfox-powermetrics-helper')
const nativePackageSource = resolve('node_modules/macos-temperature-sensor')
const nativePackageOutput = resolve('vendor/macos/node_modules/macos-temperature-sensor')

mkdirSync(dirname(output), { recursive: true })
mkdirSync(dirname(nativePackageOutput), { recursive: true })

function runClang(args) {
  return spawnSync('clang', args, { stdio: 'inherit' })
}

const smcResult = runClang([
  source,
  '-Wall',
  '-Wextra',
  '-O2',
  '-framework',
  'IOKit',
  '-framework',
  'CoreFoundation',
  '-o',
  output,
])

if ((smcResult.status ?? 1) !== 0) {
  process.exit(smcResult.status ?? 1)
}

const helperResult = runClang([
  helperSource,
  '-Wall',
  '-Wextra',
  '-O2',
  '-o',
  helperOutput,
])

if ((helperResult.status ?? 1) !== 0) {
  process.exit(helperResult.status ?? 1)
}

if (!existsSync(nativePackageSource)) {
  console.error('macos-temperature-sensor is not installed. Please run npm install on macOS/Apple Silicon first.')
  process.exit(1)
}

rmSync(nativePackageOutput, { recursive: true, force: true })
cpSync(nativePackageSource, nativePackageOutput, {
  recursive: true,
  force: true,
})

process.exit(0)
