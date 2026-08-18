const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('theme preference is persisted as system, light, or dark through the shared service bridge', () => {
  const system = readSource('utools/services/system.js')
  const types = readSource('src/type/interface.d.ts')

  assert.match(system, /APP_THEME_SETTINGS_STORAGE_KEY = 'appThemeSettings'/)
  assert.match(system, /DEFAULT_APP_THEME_SETTINGS = \{\s*preference: 'system'/)
  assert.match(system, /function normalizeAppThemeSettings/)
  assert.match(system, /input\?\.preference === 'light' \|\| input\?\.preference === 'dark'/)
  assert.match(system, /getAppThemeSettings: async/)
  assert.match(system, /updateAppThemeSettings: async/)

  assert.match(types, /type AppThemePreference = 'system' \| 'light' \| 'dark'/)
  assert.match(types, /getAppThemeSettings: \(\) => Promise<AppThemeSettingsData>/)
  assert.match(types, /updateAppThemeSettings: \(patch: Partial<AppThemeSettingsData>\)/)
})

test('renderer resolves system appearance live and synchronizes theme changes across open windows', () => {
  const theme = readSource('src/composables/useAppTheme.ts')
  const main = readSource('src/main.ts')

  assert.match(theme, /matchMedia\('\(prefers-color-scheme: dark\)'\)/)
  assert.match(theme, /mediaQuery\.addEventListener\('change'/)
  assert.match(theme, /document\.documentElement\.dataset\.theme = theme/)
  assert.match(theme, /document\.documentElement\.style\.colorScheme = theme/)
  assert.match(theme, /new BroadcastChannel\(THEME_BROADCAST_CHANNEL\)/)
  assert.match(theme, /window\.addEventListener\('storage'/)
  assert.match(theme, /updateAppThemeSettings\(\{ preference: next \}\)/)
  assert.match(main, /await initializeAppTheme\(\)[\s\S]*app\.mount\('#app'\)/)
})

test('users can explicitly choose system, light, or dark from normal hardware and standalone windows', () => {
  const control = readSource('src/components/common/ThemeControl.vue')
  const app = readSource('src/App.vue')

  assert.match(control, /value: 'system', label: '系统'/)
  assert.match(control, /value: 'light', label: '浅色'/)
  assert.match(control, /value: 'dark', label: '深色'/)
  assert.match(control, /@click="setAppThemePreference\(option\.value\)"/)
  assert.match(app, /<div class="sidebar-footer">[\s\S]*<ThemeControl \/>/)
  assert.ok((app.match(/<ThemeControl compact \/>/g) || []).length >= 2)
})

test('light theme defines real surface and text tokens used by main pages and floating monitors', () => {
  const style = readSource('src/style.css')
  const app = readSource('src/App.vue')
  const overview = readSource('src/components/Computer/index.vue')
  const watch = readSource('src/components/Watch/index.vue')
  const watchRow = readSource('src/components/Watch/WatchRow/index.vue')
  const superLite = readSource('src/components/Watch/SuperLiteMonitorView.vue')

  assert.match(style, /html\[data-theme='light'\]/)
  assert.match(style, /--app-background: #f3f6fa/)
  assert.match(style, /--text-primary: #172033/)
  assert.match(style, /--sidebar-background:/)
  assert.match(style, /--surface-card-background:/)
  assert.match(style, /--watch-shell-background:/)
  assert.match(style, /--watch-card-background:/)

  assert.match(app, /background: var\(--sidebar-background\)/)
  assert.match(app, /background: var\(--titlebar-background\)/)
  assert.match(overview, /background: var\(--surface-card-background\)/)
  assert.match(watch, /background: var\(--watch-shell-background\)/)
  assert.match(watchRow, /background: var\(--watch-card-background\)/)
  assert.match(superLite, /background: var\(--surface-watch\)/)
})

test('dark-only component surfaces stay tokenized while semantic accent colors remain independent', () => {
  const storage = readSource('src/components/StoragePage/index.vue')
  const memory = readSource('src/components/MemoryPage/index.vue')
  const processor = readSource('src/components/Processor/index.vue')
  const graphics = readSource('src/components/GraphicsPage/index.vue')
  const overview = readSource('src/components/Computer/index.vue')
  const dashboard = readSource('src/components/MonitoringDashboard/index.vue')

  assert.doesNotMatch(storage, /background: rgba\((?:29, 42, 59|13, 20, 29)/)
  assert.match(storage, /background: var\(--surface-selected-background\)/)
  assert.match(storage, /background: var\(--panel-background-strong\)/)

  assert.doesNotMatch(memory, /background: rgba\(28, 52, 84, 0\.42\)/)
  assert.match(memory, /background: var\(--control-active-bg\)/)
  assert.match(memory, /background: var\(--surface-track-background\)/)

  assert.doesNotMatch(processor, /background: rgba\((?:31, 60, 105|41, 80, 30|32, 44, 61)/)
  assert.match(processor, /background: var\(--state-info-bg\)/)
  assert.match(processor, /background: var\(--state-good-bg\)/)
  assert.match(processor, /color: var\(--text-on-accent\)/)
  assert.match(graphics, /color: var\(--text-on-accent\)/)
  assert.match(overview, /var\(--status-halo-background\)/)
  assert.match(dashboard, /background: var\(--state-danger-bg\)/)
})

test('opaque child windows choose their native first-frame background from the current theme preference', () => {
  const windowService = readSource('utools/services/window.js')

  assert.match(windowService, /function getInitialOpaqueWindowBackgroundColor\(\)/)
  assert.match(windowService, /localStorage\?\.getItem\?\.\('appThemePreferenceMirror'\)/)
  assert.match(windowService, /matchMedia\?\.\('\(prefers-color-scheme: dark\)'\)/)
  assert.match(windowService, /preference === 'light'\) return '#f3f6fa'/)
  assert.match(windowService, /preference === 'dark'\) return '#0f1722'/)
  assert.match(windowService, /: getInitialOpaqueWindowBackgroundColor\(\)/)
})
