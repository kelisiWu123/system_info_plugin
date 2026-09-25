const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('windowsTrayHelper exports and telemetry / command contracts', () => {
  const source = fs.readFileSync(path.join(__dirname, '../utools/services/windowsTrayHelper.js'), 'utf8')
  assert.ok(source.includes('updateWindowsTrayTelemetry'), 'windowsTrayHelper must export updateWindowsTrayTelemetry')
  assert.ok(source.includes('startWindowsTrayHelper'), 'windowsTrayHelper must export startWindowsTrayHelper')
  assert.ok(source.includes('stopWindowsTrayHelper'), 'windowsTrayHelper must export stopWindowsTrayHelper')
  assert.ok(source.includes('getWindowsTrayStatus'), 'windowsTrayHelper must export getWindowsTrayStatus')
  assert.ok(source.includes('setWindowsTrayCommandHandler'), 'windowsTrayHelper must export setWindowsTrayCommandHandler')

  assert.match(source, /TRAY_COMMAND_PATH/)
  assert.match(source, /HWINFOX_TRAY_COMMAND_PATH: TRAY_COMMAND_PATH/)
  assert.match(source, /fs\.unlinkSync\(TRAY_COMMAND_PATH\)/)
  assert.match(source, /trayCommandHandler\(command\)/)
})

test('utools preload wires setWindowsTrayCommandHandler and handles openPreset and exitTray', () => {
  const preloadSource = fs.readFileSync(path.join(__dirname, '../utools/preload.js'), 'utf8')
  assert.match(preloadSource, /systemService\.setWindowsTrayCommandHandler/)
  assert.match(preloadSource, /openPresetWindow\(command\.preset\)/)
  assert.match(preloadSource, /exitTray/)
  assert.match(preloadSource, /updateMacMenubarSettings/)
})

test('systemService exports setWindowsTrayCommandHandler', () => {
  const systemSource = fs.readFileSync(path.join(__dirname, '../utools/services/system.js'), 'utf8')
  assert.match(systemSource, /setWindowsTrayCommandHandler:\s*\(handler\)\s*=>\s*setWindowsTrayCommandHandler\(handler\)/)
})

test('windows tray helper source code uses command dispatch and codepage 65001', () => {
  const programCs = fs.readFileSync(path.join(__dirname, '../native/windows-tray-helper/Program.cs'), 'utf8')
  assert.match(programCs, /_commandPath/)
  assert.match(programCs, /HWINFOX_TRAY_COMMAND_PATH/)
  assert.match(programCs, /OpenUtoolsPreset\("a_watch_cpu_cores"/)
  assert.match(programCs, /OpenUtoolsPreset\("a_monitor"/)
  assert.match(programCs, /OpenUtoolsPreset\("a_computer"/)
  assert.match(programCs, /OpenUtoolsPreset\("a_menubar_settings"/)
  assert.match(programCs, /ExitTray\(\)/)
  assert.match(programCs, /DispatchCommand\("openPreset"/)
  assert.match(programCs, /DispatchCommand\("exitTray"/)

  const buildScript = fs.readFileSync(path.join(__dirname, '../scripts/build-windows-tray-helper.mjs'), 'utf8')
  assert.match(buildScript, /\/codepage:65001/)
})
