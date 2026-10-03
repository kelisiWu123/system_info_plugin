const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

function compile(relativePath) {
  return ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, allowJs: true },
  }).outputText
}
const helperCode = compile('utools/services/macMenubarHelper.js')

function harness(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-menubar-command-'))
  const state = path.join(directory, 'system-info-plugin/macos-menubar')
  fs.mkdirSync(state, { recursive: true })
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.writeFileSync(path.join(state, 'owner.json'), JSON.stringify({
    state: 'running', protocolVersion: 6, helperPid: 9000, ownerPid: 1001, token: 'helper-owner',
    telemetryPath: path.join(state, 'telemetry.json'), lockPath: path.join(state, 'helper.lock'),
  }))
  const polls = []
  const handled = []
  for (const pid of [1001, 1002]) {
    const exports = {}
    new Function('require', 'exports', 'process', 'setInterval', 'clearInterval', '__dirname', helperCode)(
      (id) => {
        if (id === 'node:fs') return { default: fs }
        if (id === 'node:os') return { default: { ...os, tmpdir: () => directory } }
        if (id === 'node:path') return { default: path }
        return require(id)
      }, exports, { pid, platform: 'darwin', kill(target) { if (target !== 9000) throw new Error('not alive') } },
      (callback) => { polls.push(callback); return { unref() {} } }, () => {}, __dirname,
    )
    exports.setMacMenubarCommandHandler((command) => handled.push({ pid, command }))
  }
  const write = (patch = {}) => fs.writeFileSync(path.join(state, 'command.json'), JSON.stringify({
    id: 'command-1', action: 'openPreset', preset: 'a_computer', createdAt: Date.now(), helperPid: 9000, ...patch,
  }))
  return { state, write, polls, handled }
}

test('one macOS tray command is claimed by exactly one preload context', (t) => {
  const h = harness(t)
  h.write()
  for (const poll of h.polls) poll()
  for (const poll of h.polls) poll()
  assert.equal(h.handled.length, 1)
  assert.equal(h.handled[0].command.preset, 'a_computer')
  assert.equal(fs.existsSync(path.join(h.state, 'command.json')), false)
  assert.equal(fs.readdirSync(h.state).some((file) => file.endsWith('.claimed')), false)
})

test('settings command opens the dedicated settings preset', (t) => {
  const h = harness(t)
  h.write({ preset: 'a_menubar_settings' })
  for (const poll of h.polls) poll()
  assert.equal(h.handled.length, 1)
  assert.equal(h.handled[0].command.preset, 'a_menubar_settings')
})

for (const patch of [
  { createdAt: Date.now() - 60000 }, { createdAt: Date.now() + 60000 },
  { helperPid: 9999 }, { preset: 'unexpected' }, { action: 'execute' },
]) {
  test(`invalid or stale macOS tray command is ignored: ${JSON.stringify(patch)}`, (t) => {
    const h = harness(t)
    h.write(patch)
    for (const poll of h.polls) poll()
    assert.equal(h.handled.length, 0)
  })
}

test('macOS tray open-main command calls the same preset window bridge as the hardware entry', async () => {
  let handle
  const opened = []
  const runtime = { isDev: () => false, outPlugin() {} }
  const window = {}
  new Function('require', 'exports', 'window', 'utools', '__dirname', compile('utools/preload.js'))(
    (id) => {
      if (id === './runtime') return { resolveUtoolsRuntime: () => runtime, getUtoolsPluginRoot: () => '/plugin' }
      if (id === './services/system') return { configureSystemServiceContext() {}, systemService: {
        setMacMenubarCommandHandler: (callback) => { handle = callback },
      } }
      if (id === './services/window') return { setupWindowBridge() {}, windowService: {
        createWindow: async (preset) => opened.push(preset),
      } }
      throw new Error(`Unexpected import: ${id}`)
    }, {}, window, runtime, '/plugin',
  )
  await handle({ action: 'openPreset', preset: 'a_computer' })
  await handle({ action: 'openPreset', preset: 'a_menubar_settings' })
  assert.deepEqual(opened, ['a_computer', 'a_menubar_settings'])
})


test('native open-main action writes the expected command instead of opening a plugin URL', { skip: process.platform !== 'darwin' }, (t) => {
  const { execFileSync } = require('node:child_process')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-menubar-open-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const source = path.join(directory, 'open-command.m')
  const binary = path.join(directory, 'open-command')
  const commandPath = path.join(directory, 'command.json')
  const settingsPath = path.join(directory, 'settings.json')
  const nativeSource = path.join(__dirname, '../native/macos-menubar-helper/main.m')
  fs.writeFileSync(source, `#define main original_menubar_main
#import "${nativeSource}"
#undef main
int main(void) { @autoreleasepool { MenubarAppDelegate *app = [MenubarAppDelegate new]; [app openMainApp]; setenv("HWINFOX_MENUBAR_COMMAND_PATH", "${settingsPath}", 1); [app openMenubarSettings]; } return 0; }
`)
  execFileSync('clang', [source, '-fobjc-arc', '-framework', 'Cocoa', '-o', binary])
  execFileSync(binary, [], { env: { ...process.env, HWINFOX_MENUBAR_COMMAND_PATH: commandPath } })
  const command = JSON.parse(fs.readFileSync(commandPath, 'utf8'))
  assert.equal(command.action, 'openPreset')
  assert.equal(command.preset, 'a_computer')
  assert.equal(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).preset, 'a_menubar_settings')
  assert.ok(command.id)
  assert.ok(command.helperPid > 0)
  assert.ok(Math.abs(Date.now() - command.createdAt) < 10000)
})
