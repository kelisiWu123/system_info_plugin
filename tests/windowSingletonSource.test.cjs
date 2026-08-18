const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('uTools child windows use a cross-preload singleton record with an atomic pending claim', () => {
  const source = readSource('utools/services/window.js')

  assert.match(source, /function getWindowSingletonKey\(fileName\)/)
  assert.match(source, /if \(fileName === 'watch'\) return 'a_watch'/)
  assert.match(source, /if \(fileName === 'computer'\) return 'a_computer'/)
  assert.match(source, /singletonKey: getWindowSingletonKey\(fileName\)/)
  assert.match(source, /fs\.openSync\(recordPath, 'wx'\)/)
  assert.match(source, /state: 'pending'/)
  assert.match(source, /WINDOW_SINGLETON_PENDING_TTL_MS/)
  assert.match(source, /async function reuseOrWaitForWindowSingleton\(singletonKey\)/)
  assert.match(source, /if \(await reuseOrWaitForWindowSingleton\(singletonKey\)\) return/)
  assert.match(source, /let singletonClaim = claimWindowSingleton\(singletonKey\)/)
})

test('an existing uTools singleton asks its owning parent to restore and focus instead of opening another window', () => {
  const source = readSource('utools/services/window.js')

  assert.match(source, /ipcRenderer\.sendTo\(webContentsId, 'singleton-activate'/)
  assert.match(source, /ipcRenderer\.on\('singleton-activate'/)
  assert.match(source, /ipcRenderer\.sendTo\(parentWindowId, 'focus-window'\)/)
  assert.match(source, /ipcRenderer\.on\('focus-window', handleFocusWindow\)/)
  assert.match(source, /if \(childWindow\.isMinimized\?\.\(\)\) childWindow\.restore\?\.\(\)/)
  assert.match(source, /childWindow\.show\?\.\(\)/)
  assert.match(source, /childWindow\.focus\?\.\(\)/)
  assert.match(source, /childWindow\.moveTop\?\.\(\)/)
  assert.match(source, /removeWindowSingletonRecord\(singletonKey, singletonToken\)/)
})

test('uTools command exits only after the singleton open-or-focus request has been dispatched', () => {
  const preload = readSource('utools/preload.js')
  const types = readSource('src/type/interface.d.ts')

  assert.match(preload, /async function openPresetWindow\(name\)/)
  assert.match(preload, /await window\.services\.createWindow\(name, preset\.height, preset\.width, preset\.backgroundColor\)/)
  assert.match(preload, /finally\s*{\s*runtimeUtools\.outPlugin\(\)/)
  assert.match(types, /createWindow: \(fileName: string, height\?: number, width\?: number, backgroundColor\?: number\) => Promise<void>/)
})

test('Electron fallback keeps one BrowserWindow per singleton key and focuses the existing instance', () => {
  const source = readSource('electron/main/index.ts')

  assert.match(source, /const childWindowsBySingletonKey = new Map<string, BrowserWindow>\(\)/)
  assert.match(source, /const singletonKey = getChildWindowSingletonKey\(arg\)/)
  assert.match(source, /const existingWindow = childWindowsBySingletonKey\.get\(singletonKey\)/)
  assert.match(source, /if \(existingWindow && !existingWindow\.isDestroyed\(\)\)[\s\S]*activateBrowserWindow\(existingWindow\)[\s\S]*reused: true/)
  assert.match(source, /childWindowsBySingletonKey\.set\(singletonKey, childWindow\)/)
  assert.match(source, /childWindowsBySingletonKey\.delete\(singletonKey\)/)
  assert.match(source, /childWindow\.webContents\.send\('init', \{ fromMain: true, singletonKey \}\)/)
  assert.match(source, /if \(action === 'focus'\)[\s\S]*activateBrowserWindow\(targetWindow\)/)
})

test('hardware, monitor, specs, standard watch, and super-lite watch retain distinct singleton keys', () => {
  const preload = readSource('utools/preload.js')
  const source = readSource('utools/services/window.js')

  for (const entry of ['a_computer', 'a_monitor', 'a_specs_lite', 'a_watch', 'a_watch_super_lite']) {
    assert.match(preload, new RegExp(`${entry}:`), entry)
  }

  assert.match(source, /return typeof fileName === 'string' && fileName\.trim\(\) \? fileName\.trim\(\) : 'window'/)
  assert.doesNotMatch(source, /a_watch_super_lite'\) return 'a_watch'/)
})
