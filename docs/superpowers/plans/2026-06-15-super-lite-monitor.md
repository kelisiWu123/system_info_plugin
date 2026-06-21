# Super Lite Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a uTools `hardwareWatchSuperLite` entry that opens the existing hardware watch window directly in a `200x200` super-lite rendering mode.

**Architecture:** Keep `src/components/Watch/index.vue` as the only owner of hardware service calls, timers, metric history, pinned state, and floating-mode persistence. Add a second rendering surface inside that owner for `standard` vs `super-lite`, and pass readonly derived metric data into super-lite view components. The independent plugin entry must travel through `plugin.json -> utools/preload.js -> utools/services/window.js -> App.vue -> Watch` without first rendering the standard view.

**Tech Stack:** Vue 3 + TypeScript + Less, uTools preload exports, Electron/uTools child window bridge, Node source tests, existing `npm run build`.

---

## File Structure

- Modify: `plugin.json`
  Add a `hardwareWatchSuperLite` feature with search commands for the direct super-lite entry.
- Modify: `utools/preload.js`
  Add `a_watch_super_lite` preset and `window.exports.hardwareWatchSuperLite`.
- Modify: `utools/services/window.js`
  Treat `a_watch_super_lite` as a watch window and pass `#watch?floatingMode=super-lite&entry=hardwareWatchSuperLite` into the renderer.
- Modify: `scripts/generate-utools-entry-pages.mjs`
  Generate the `a_watch_super_lite` distribution entry as a `watch` page alias with query parameters, not as a separate app.
- Modify: `src/App.vue`
  Parse `#watch?...` correctly, expose initial floating mode, and pass it to `Watch` before first render.
- Modify: `src/type/interface.d.ts`
  Add `FloatingMonitorMode`, `FloatingMonitorSettingsData`, and optional service APIs for floating monitor settings if implemented through the service bridge.
- Modify: `utools/services/system.js`
  Add `getFloatingMonitorSettings` / `updateFloatingMonitorSettings` using the same `dbStorage` + `localStorage` pattern as sensor and refresh settings.
- Modify: `src/components/Watch/index.vue`
  Add outer floating mode state, mode persistence, size switching, super-lite overview/detail rendering, and keep all service calls in this file.
- Create: `src/components/Watch/SuperLiteMonitorView.vue`
  Pure presentational component for the super-lite shell, rows, status bar, and lightweight detail pages.
- Create: `src/utils/superLiteMonitor.ts`
  Pure helpers for metric mapping, status thresholds, footer refresh label, and fixed detail rows.
- Create: `tests/superLiteEntrySource.test.cjs`
  Source-level tests for `plugin.json`, preload export, window classification, hash parameters, and generated entry aliases.
- Create: `tests/superLiteSource.test.cjs`
  Source-level tests for `Watch` ownership boundaries and super-lite component restrictions.
- Create: `tests/superLiteMonitor.test.cjs`
  Pure helper tests for thresholds, refresh labels, and detail row mapping.

---

### Task 1: Lock The Direct Entry Contract

**Files:**
- Modify: `plugin.json`
- Modify: `utools/preload.js`
- Modify: `utools/services/window.js`
- Modify: `scripts/generate-utools-entry-pages.mjs`
- Test: `tests/superLiteEntrySource.test.cjs`

- [ ] **Step 1: Write the failing source test**

Create `tests/superLiteEntrySource.test.cjs`:

```js
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('plugin.json exposes an independent super-lite watch entry', () => {
  const plugin = JSON.parse(readSource('plugin.json'))
  const feature = plugin.features.find((item) => item.code === 'hardwareWatchSuperLite')

  assert.ok(feature)
  assert.equal(feature.explain, '超级轻量硬件监控')
  assert.deepEqual(feature.cmds, ['超级轻量监控', '轻量监控', '硬件轻量监控'])
})

test('preload maps hardwareWatchSuperLite to a 200x200 watch preset', () => {
  const source = readSource('utools/preload.js')

  assert.match(source, /a_watch_super_lite:\s*{[\s\S]*prod:\s*{\s*height:\s*200,\s*width:\s*200,\s*backgroundColor:\s*0\s*}/)
  assert.match(source, /hardwareWatchSuperLite:\s*{[\s\S]*openPresetWindow\('a_watch_super_lite'\)/)
})

test('window service treats a_watch_super_lite as a watch window and passes launch query', () => {
  const source = readSource('utools/services/window.js')

  assert.match(source, /\['a_watch',\s*'watch',\s*'a_watch_super_lite'\]\.includes\(fileName\)/)
  assert.match(source, /floatingMode=super-lite/)
  assert.match(source, /entry=hardwareWatchSuperLite/)
  assert.match(source, /transparent:\s*isWatchWindow/)
  assert.match(source, /alwaysOnTop:\s*isWatchWindow/)
})

test('build script generates a super-lite watch alias rather than a second app', () => {
  const source = readSource('scripts/generate-utools-entry-pages.mjs')

  assert.match(source, /\['a_watch_super_lite',\s*'watch\?floatingMode=super-lite&entry=hardwareWatchSuperLite'\]/)
  assert.doesNotMatch(source, /super-lite\.html/)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/superLiteEntrySource.test.cjs
```

Expected: FAIL because `hardwareWatchSuperLite`, `a_watch_super_lite`, and launch query handling are not implemented yet.

- [ ] **Step 3: Implement the minimal entry changes**

In `plugin.json`, add the feature after `hardwareWatch`:

```json
{
  "code": "hardwareWatchSuperLite",
  "explain": "超级轻量硬件监控",
  "cmds": [
    "超级轻量监控",
    "轻量监控",
    "硬件轻量监控"
  ]
}
```

In `utools/preload.js`, add the preset:

```js
a_watch_super_lite: {
  prod: { height: 200, width: 200, backgroundColor: 0 },
  dev: { height: 200, width: 200, backgroundColor: 0 },
},
```

Add the export:

```js
hardwareWatchSuperLite: {
  mode: 'none',
  args: {
    enter: () => {
      openPresetWindow('a_watch_super_lite')
    },
  },
},
```

In `utools/services/window.js`, introduce helpers near `isDevMode()`:

```js
function isWatchWindowName(fileName) {
  return ['a_watch', 'watch', 'a_watch_super_lite'].includes(fileName)
}

function getWindowHash(fileName) {
  if (fileName === 'a_watch_super_lite') return 'watch?floatingMode=super-lite&entry=hardwareWatchSuperLite'
  return isWatchWindowName(fileName) ? 'watch' : 'computer'
}
```

Then change `createWindow` to use:

```js
const isWatchWindow = isWatchWindowName(fileName)
const windowHash = getWindowHash(fileName)
const windowUrl = runtimeUtools.isDev()
  ? `http://localhost:9000/index.html#${windowHash}`
  : isWatchWindow
    ? `watch.html#${windowHash}`
    : 'computer.html'
```

Keep the existing `transparent`, `frame`, `alwaysOnTop`, `resizable`, and `fullscreenable` settings based on `isWatchWindow`.

In `scripts/generate-utools-entry-pages.mjs`, include the alias:

```js
for (const [entryName, pageName] of [
  ['a_computer', 'computer'],
  ['a_watch', 'watch'],
  ['a_watch_super_lite', 'watch?floatingMode=super-lite&entry=hardwareWatchSuperLite'],
]) {
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
node --test tests/superLiteEntrySource.test.cjs
```

Expected: PASS.

- [ ] **Step 5: Commit the entry contract**

Run:

```bash
git add plugin.json utools/preload.js utools/services/window.js scripts/generate-utools-entry-pages.mjs tests/superLiteEntrySource.test.cjs
git commit -m "feat: add super-lite watch entry"
```

---

### Task 2: Pass Initial Floating Mode Before First Render

**Files:**
- Modify: `src/App.vue`
- Modify: `src/components/Watch/index.vue`
- Test: `tests/superLiteEntrySource.test.cjs`

- [ ] **Step 1: Extend the failing test**

Append to `tests/superLiteEntrySource.test.cjs`:

```js
test('App parses watch query parameters and passes initial floating mode into Watch', () => {
  const app = readSource('src/App.vue')
  const watch = readSource('src/components/Watch/index.vue')

  assert.match(app, /new URLSearchParams\(/)
  assert.match(app, /floatingMode/)
  assert.match(app, /resolvePageName/)
  assert.match(app, /<Watch[\s\S]*:initial-floating-mode="initialFloatingMode"/)
  assert.match(watch, /initialFloatingMode\?:\s*'standard' \| 'super-lite'/)
  assert.match(watch, /data-floating-mode/)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/superLiteEntrySource.test.cjs
```

Expected: FAIL because `App.vue` still treats `watch?floatingMode=...` as a non-watch page and `Watch` has no initial floating mode prop.

- [ ] **Step 3: Implement URL parsing and prop passing**

In `src/App.vue`, add:

```ts
type FloatingMonitorMode = 'standard' | 'super-lite'

function getHashRoute(hash: string) {
  const normalized = hash.replace(/^#\/?/, '')
  const [pageName, query = ''] = normalized.split('?')

  return {
    pageName,
    query: new URLSearchParams(query),
  }
}

function resolvePageName(hash: string): PageName {
  return getHashRoute(hash).pageName === 'watch' ? 'watch' : 'computer'
}

function resolveInitialFloatingMode(hash: string): FloatingMonitorMode {
  return getHashRoute(hash).query.get('floatingMode') === 'super-lite' ? 'super-lite' : 'standard'
}
```

Replace `resolvePage` usage with `resolvePageName`:

```ts
const currentPage = computed<PageName>(() => resolvePageName(currentHash.value))
const initialFloatingMode = computed<FloatingMonitorMode>(() => resolveInitialFloatingMode(currentHash.value))
```

Change the template:

```vue
<Watch :active="true" :initial-floating-mode="initialFloatingMode" />
```

In `src/components/Watch/index.vue`, change props:

```ts
type FloatingMonitorMode = 'standard' | 'super-lite'

const props = defineProps<{
  active?: boolean
  initialFloatingMode?: FloatingMonitorMode
}>()

const floatingMode = ref<FloatingMonitorMode>(props.initialFloatingMode || 'standard')
```

Add a stable root attribute:

```vue
<div class="watch-container" :data-floating-mode="floatingMode">
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
node --test tests/superLiteEntrySource.test.cjs
```

Expected: PASS.

- [ ] **Step 5: Commit first-render mode routing**

Run:

```bash
git add src/App.vue src/components/Watch/index.vue tests/superLiteEntrySource.test.cjs
git commit -m "feat: route initial floating mode"
```

---

### Task 3: Add Pure Super-Lite Mapping And Status Helpers

**Files:**
- Create: `src/utils/superLiteMonitor.ts`
- Test: `tests/superLiteMonitor.test.cjs`

- [ ] **Step 1: Write the failing helper tests**

Create `tests/superLiteMonitor.test.cjs`:

```js
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { pathToFileURL } = require('node:url')
const { buildSync } = require('esbuild')

function loadSuperLiteMonitor() {
  const outfile = path.join(os.tmpdir(), `super-lite-monitor-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`)

  buildSync({
    entryPoints: [path.join(__dirname, '../src/utils/superLiteMonitor.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  })

  return import(pathToFileURL(outfile).href)
}

test('resolveSuperLiteOverallStatus promotes warning and danger thresholds', async () => {
  const { resolveSuperLiteOverallStatus } = await loadSuperLiteMonitor()

  assert.deepEqual(resolveSuperLiteOverallStatus({ cpuUsage: 10, gpuUsage: 20, memoryUsage: 40 }), {
    level: 'normal',
    label: '良好',
  })
  assert.deepEqual(resolveSuperLiteOverallStatus({ cpuUsage: 85, gpuUsage: 20, memoryUsage: 40 }), {
    level: 'warning',
    label: '注意',
  })
  assert.deepEqual(resolveSuperLiteOverallStatus({ cpuUsage: 20, gpuTemperature: 95, memoryUsage: 40 }), {
    level: 'danger',
    label: '高温',
  })
  assert.deepEqual(resolveSuperLiteOverallStatus({ cpuUsage: 20, gpuUsage: 20, memoryUsage: 95 }), {
    level: 'danger',
    label: '内存紧张',
  })
})

test('formatSuperLiteRefreshLabel uses the active poll interval', async () => {
  const { formatSuperLiteRefreshLabel } = await loadSuperLiteMonitor()

  assert.equal(formatSuperLiteRefreshLabel(2500), '↻2.5s')
  assert.equal(formatSuperLiteRefreshLabel(1000), '↻1s')
  assert.equal(formatSuperLiteRefreshLabel(0), '↻--')
})
```

- [ ] **Step 2: Run the helper tests to verify they fail**

Run:

```bash
node --test tests/superLiteMonitor.test.cjs
```

Expected: FAIL because `src/utils/superLiteMonitor.ts` does not exist.

- [ ] **Step 3: Implement the pure helpers**

Create `src/utils/superLiteMonitor.ts`:

```ts
export type SuperLiteStatusLevel = 'normal' | 'warning' | 'danger'

export interface SuperLiteStatusInput {
  cpuUsage: number
  gpuUsage: number
  memoryUsage: number
  cpuTemperature?: number | null
  gpuTemperature?: number | null
  memoryPressure?: 'normal' | 'warning' | 'critical' | 'unknown'
}

export interface SuperLiteStatus {
  level: SuperLiteStatusLevel
  label: string
}

function atLeast(value: number | null | undefined, threshold: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= threshold
}

export function resolveSuperLiteOverallStatus(input: SuperLiteStatusInput): SuperLiteStatus {
  const highTemperature = atLeast(input.cpuTemperature, 95) || atLeast(input.gpuTemperature, 95)
  const highLoad = atLeast(input.cpuUsage, 95) || atLeast(input.gpuUsage, 95)
  const highMemory = atLeast(input.memoryUsage, 95) || input.memoryPressure === 'critical'

  if (highTemperature) return { level: 'danger', label: '高温' }
  if (highLoad) return { level: 'danger', label: '高负载' }
  if (highMemory) return { level: 'danger', label: '内存紧张' }

  const warning =
    atLeast(input.cpuTemperature, 85) ||
    atLeast(input.gpuTemperature, 85) ||
    atLeast(input.cpuUsage, 85) ||
    atLeast(input.gpuUsage, 85) ||
    atLeast(input.memoryUsage, 90) ||
    input.memoryPressure === 'warning'

  if (warning) return { level: 'warning', label: '注意' }
  return { level: 'normal', label: '良好' }
}

export function formatSuperLiteRefreshLabel(intervalMs: number) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return '↻--'
  const seconds = intervalMs / 1000
  return `↻${Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1)}s`
}
```

- [ ] **Step 4: Run the helper tests to verify they pass**

Run:

```bash
node --test tests/superLiteMonitor.test.cjs
```

Expected: PASS.

- [ ] **Step 5: Commit pure super-lite helpers**

Run:

```bash
git add src/utils/superLiteMonitor.ts tests/superLiteMonitor.test.cjs
git commit -m "feat: add super-lite monitor helpers"
```

---

### Task 4: Add Floating Settings Persistence

**Files:**
- Modify: `utools/services/system.js`
- Modify: `src/type/interface.d.ts`
- Test: `tests/superLiteSource.test.cjs`

- [ ] **Step 1: Write the failing source test**

Create `tests/superLiteSource.test.cjs`:

```js
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('floating monitor settings are exposed through the service bridge', () => {
  const system = readSource('utools/services/system.js')
  const types = readSource('src/type/interface.d.ts')

  assert.match(system, /FLOATING_MONITOR_SETTINGS_STORAGE_KEY/)
  assert.match(system, /function getFloatingMonitorSettings\(\)/)
  assert.match(system, /function updateFloatingMonitorSettings\(patch = {}\)/)
  assert.match(system, /getFloatingMonitorSettings:\s*async/)
  assert.match(system, /updateFloatingMonitorSettings:\s*async/)

  assert.match(types, /type FloatingMonitorMode = 'standard' \| 'super-lite'/)
  assert.match(types, /interface FloatingMonitorSettingsData/)
  assert.match(types, /getFloatingMonitorSettings: \(\) => Promise<FloatingMonitorSettingsData>/)
  assert.match(types, /updateFloatingMonitorSettings: \(patch: Partial<FloatingMonitorSettingsData>\) => Promise<FloatingMonitorSettingsData>/)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/superLiteSource.test.cjs
```

Expected: FAIL because floating monitor settings do not exist.

- [ ] **Step 3: Implement persistence with the existing storage pattern**

In `utools/services/system.js`, add near the existing storage keys:

```js
const FLOATING_MONITOR_SETTINGS_STORAGE_KEY = 'floatingMonitorSettings'
const DEFAULT_FLOATING_MONITOR_SETTINGS = {
  mode: 'standard',
  pinned: true,
  standardSize: { width: 432, height: 398 },
  superLiteSize: { width: 200, height: 200 },
}
```

Add storage read/write helpers following `readMonitoringRefreshSettingsRaw`:

```js
function readFloatingMonitorSettingsRaw() {
  const storage = getHardwareSensorSettingsStorage()

  if (storage?.getItem) {
    return storage.getItem(FLOATING_MONITOR_SETTINGS_STORAGE_KEY)
  }

  if (typeof localStorage !== 'undefined') {
    try {
      const value = localStorage.getItem(FLOATING_MONITOR_SETTINGS_STORAGE_KEY)
      return value ? JSON.parse(value) : null
    } catch {
      return null
    }
  }

  return null
}

function writeFloatingMonitorSettingsRaw(value) {
  const storage = getHardwareSensorSettingsStorage()

  if (storage?.setItem) {
    storage.setItem(FLOATING_MONITOR_SETTINGS_STORAGE_KEY, value)
    return
  }

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(FLOATING_MONITOR_SETTINGS_STORAGE_KEY, JSON.stringify(value))
    } catch {
      // ignore storage fallback failures
    }
  }
}
```

Add normalization and service methods:

```js
function normalizeFloatingMonitorSettings(input = {}) {
  const mode = input?.mode === 'super-lite' ? 'super-lite' : 'standard'

  return {
    ...DEFAULT_FLOATING_MONITOR_SETTINGS,
    ...input,
    mode,
    pinned: typeof input?.pinned === 'boolean' ? input.pinned : DEFAULT_FLOATING_MONITOR_SETTINGS.pinned,
    standardSize: DEFAULT_FLOATING_MONITOR_SETTINGS.standardSize,
    superLiteSize: DEFAULT_FLOATING_MONITOR_SETTINGS.superLiteSize,
  }
}

function getFloatingMonitorSettings() {
  return normalizeFloatingMonitorSettings(readFloatingMonitorSettingsRaw() || {})
}

function updateFloatingMonitorSettings(patch = {}) {
  const next = normalizeFloatingMonitorSettings({
    ...getFloatingMonitorSettings(),
    ...patch,
  })
  writeFloatingMonitorSettingsRaw(next)
  return next
}
```

Export through `systemService`:

```js
getFloatingMonitorSettings: async () => getFloatingMonitorSettings(),
updateFloatingMonitorSettings: async (patch) => updateFloatingMonitorSettings(patch),
```

In `src/type/interface.d.ts`, add:

```ts
type FloatingMonitorMode = 'standard' | 'super-lite'

interface FloatingMonitorSettingsData {
  mode: FloatingMonitorMode
  pinned: boolean
  standardSize: {
    width: number
    height: number
  }
  superLiteSize: {
    width: number
    height: number
  }
  position?: {
    x: number
    y: number
  }
  opacity?: number
}
```

Add service signatures:

```ts
getFloatingMonitorSettings: () => Promise<FloatingMonitorSettingsData>
updateFloatingMonitorSettings: (patch: Partial<FloatingMonitorSettingsData>) => Promise<FloatingMonitorSettingsData>
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
node --test tests/superLiteSource.test.cjs
```

Expected: PASS.

- [ ] **Step 5: Commit floating monitor persistence**

Run:

```bash
git add utools/services/system.js src/type/interface.d.ts tests/superLiteSource.test.cjs
git commit -m "feat: persist floating monitor mode"
```

---

### Task 5: Introduce The Super-Lite Presentational Component

**Files:**
- Create: `src/components/Watch/SuperLiteMonitorView.vue`
- Modify: `src/components/Watch/index.vue`
- Test: `tests/superLiteSource.test.cjs`

- [ ] **Step 1: Extend the source test for rendering boundaries**

Append to `tests/superLiteSource.test.cjs`:

```js
test('super-lite view is presentational and Watch owns services and timers', () => {
  const watch = readSource('src/components/Watch/index.vue')
  const superLite = readSource('src/components/Watch/SuperLiteMonitorView.vue')

  assert.match(watch, /import SuperLiteMonitorView/)
  assert.match(watch, /window\.services\.getCpuFullLoad/)
  assert.match(watch, /window\.setInterval/)
  assert.match(watch, /history\.cpu/)

  assert.doesNotMatch(superLite, /window\.services/)
  assert.doesNotMatch(superLite, /setInterval/)
  assert.doesNotMatch(superLite, /localStorage|dbStorage/)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/superLiteSource.test.cjs
```

Expected: FAIL because the super-lite component does not exist.

- [ ] **Step 3: Create the presentational component**

Create `src/components/Watch/SuperLiteMonitorView.vue` with props only:

```vue
<script setup lang="ts">
import type { SuperLiteStatus } from '../../utils/superLiteMonitor'

type DetailPage = 'overview' | 'cpu' | 'gpu' | 'memory'

interface MetricRow {
  key: 'cpu' | 'gpu' | 'memory'
  label: string
  usageLabel: string
  primaryExtra: string
  secondaryExtra: string
  trend: number[]
  tone: 'cpu' | 'gpu' | 'memory'
  status: 'normal' | 'warning' | 'danger'
}

const props = defineProps<{
  page: DetailPage
  status: SuperLiteStatus
  metrics: MetricRow[]
  footerLeft: string
  footerRight: string
  pinned: boolean
}>()

const emit = defineEmits<{
  (event: 'set-page', page: DetailPage): void
  (event: 'toggle-pin'): void
  (event: 'switch-standard'): void
}>()

function barCount(values: number[]) {
  return values.slice(-5).map((value) => Math.max(1, Math.min(5, Math.ceil((value || 0) / 20))))
}
</script>

<template>
  <section class="super-lite-monitor" :data-super-lite-page="page">
    <header class="super-lite-header">
      <button type="button" class="super-lite-status" @click="emit('set-page', 'overview')">
        <span :class="['super-lite-dot', `super-lite-dot--${status.level}`]" />
        <span>{{ status.label }}</span>
      </button>
      <nav class="super-lite-switcher" aria-label="超级轻量模式页面">
        <button type="button" @click="emit('set-page', 'overview')">概览</button>
        <button type="button" @click="emit('set-page', 'cpu')">CPU</button>
        <button type="button" @click="emit('set-page', 'gpu')">GPU</button>
      </nav>
      <button type="button" class="super-lite-pin" :aria-pressed="pinned" @click="emit('toggle-pin')">📌</button>
    </header>

    <main v-if="page === 'overview'" class="super-lite-body">
      <button
        v-for="metric in metrics"
        :key="metric.key"
        type="button"
        :class="['super-lite-row', `super-lite-row--${metric.tone}`, `super-lite-row--${metric.status}`]"
        @click="emit('set-page', metric.key === 'memory' ? 'memory' : metric.key)"
      >
        <span class="super-lite-row__top">
          <strong>{{ metric.label }}</strong>
          <em>{{ metric.usageLabel }}</em>
          <span class="super-lite-bars" aria-hidden="true">
            <i v-for="(height, index) in barCount(metric.trend)" :key="index" :style="{ height: `${height * 3}px` }" />
          </span>
          <span>{{ metric.primaryExtra }}</span>
        </span>
        <span class="super-lite-row__bottom">
          <small>{{ metric.secondaryExtra }}</small>
          <span class="super-lite-progress"><i :style="{ width: metric.usageLabel }" /></span>
        </span>
      </button>
    </main>

    <main v-else class="super-lite-detail">
      <button type="button" class="super-lite-back" @click="emit('set-page', 'overview')">‹ {{ page.toUpperCase() }}详情</button>
      <dl>
        <template v-for="metric in metrics.filter((item) => item.key === page || (page === 'memory' && item.key === 'memory'))" :key="metric.key">
          <dt>使用率</dt>
          <dd>{{ metric.usageLabel }}</dd>
          <dt>主要指标</dt>
          <dd>{{ metric.primaryExtra }}</dd>
          <dt>辅助指标</dt>
          <dd>{{ metric.secondaryExtra }}</dd>
        </template>
      </dl>
    </main>

    <footer class="super-lite-footer">
      <span>{{ footerLeft }}</span>
      <span>{{ footerRight }}</span>
    </footer>
  </section>
</template>
```

Add compact Less in the same file. Keep it scoped and do not import services:

```less
.super-lite-monitor {
  display: flex;
  flex-direction: column;
  width: 200px;
  height: 200px;
  padding: 8px;
  border: 1px solid rgba(210, 223, 248, 0.22);
  border-radius: 18px;
  background: rgba(10, 18, 30, 0.54);
  backdrop-filter: blur(24px);
  color: rgba(244, 248, 255, 0.94);
}
```

In `src/components/Watch/index.vue`, import the component and render it when `floatingMode === 'super-lite'`. The full data wiring happens in Task 6.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
node --test tests/superLiteSource.test.cjs
```

Expected: PASS.

- [ ] **Step 5: Commit the presentational view**

Run:

```bash
git add src/components/Watch/SuperLiteMonitorView.vue src/components/Watch/index.vue tests/superLiteSource.test.cjs
git commit -m "feat: add super-lite monitor view"
```

---

### Task 6: Wire Super-Lite State, Switching, Details, And Resize

**Files:**
- Modify: `src/components/Watch/index.vue`
- Modify: `src/components/Watch/SuperLiteMonitorView.vue`
- Test: `tests/superLiteSource.test.cjs`

- [ ] **Step 1: Extend the source test for mode switching and resize**

Append to `tests/superLiteSource.test.cjs`:

```js
test('Watch switches floating modes, resizes the window, and persists mode and pinned state', () => {
  const watch = readSource('src/components/Watch/index.vue')

  assert.match(watch, /const floatingMode = ref<FloatingMonitorMode>/)
  assert.match(watch, /switchFloatingMode/)
  assert.match(watch, /window\.services\.resizeWindow\(200,\s*200\)/)
  assert.match(watch, /updateFloatingMonitorSettings/)
  assert.match(watch, /SuperLiteMonitorView/)
  assert.match(watch, /formatSuperLiteRefreshLabel\(getCurrentPollProfile\(\)\.fast\)/)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/superLiteSource.test.cjs
```

Expected: FAIL because switching and resize are not wired yet.

- [ ] **Step 3: Implement mode switching in `Watch`**

In `src/components/Watch/index.vue`, import:

```ts
import SuperLiteMonitorView from './SuperLiteMonitorView.vue'
import {
  formatSuperLiteRefreshLabel,
  resolveSuperLiteOverallStatus,
} from '../../utils/superLiteMonitor'
```

Add state:

```ts
type SuperLitePage = 'overview' | 'cpu' | 'gpu' | 'memory'

const superLitePage = ref<SuperLitePage>('overview')
```

Add derived values:

```ts
const superLiteStatus = computed(() => resolveSuperLiteOverallStatus({
  cpuUsage: cpuPercent.value,
  gpuUsage: gpuPercent.value,
  memoryUsage: memoryPercent.value,
  cpuTemperature: cpuTempValue.value,
  gpuTemperature: gpuTempValue.value,
  memoryPressure: memoData.pressure?.level,
}))

const superLiteFooterLeft = computed(() => formatSuperLiteRefreshLabel(getCurrentPollProfile().fast))
const superLiteFooterRight = computed(() => `⏱${formatWatchRuntime(timeInfo.value?.uptime)}`)
```

Build metrics from existing refs and computed values:

```ts
const superLiteMetrics = computed(() => [
  {
    key: 'cpu' as const,
    label: 'CPU',
    usageLabel: formatPercent(cpuPercent.value),
    primaryExtra: cpuTemperatureDisplay.value,
    secondaryExtra: formatPower(cpuPowerValue.value),
    trend: history.cpu,
    tone: 'cpu' as const,
    status: superLiteStatus.value.level,
  },
  {
    key: 'gpu' as const,
    label: 'GPU',
    usageLabel: formatPercent(gpuPercent.value),
    primaryExtra: formatTemperature(gpuTempValue.value),
    secondaryExtra: formatPower(gpuPowerValue.value),
    trend: history.gpu,
    tone: 'gpu' as const,
    status: superLiteStatus.value.level,
  },
  {
    key: 'memory' as const,
    label: 'MEM',
    usageLabel: formatPercent(memoryPercent.value),
    primaryExtra: formatGigabytesFromBytes(getDisplayMemoryUsedBytes(memoData)),
    secondaryExtra: memoData.normalizedPlatform === 'darwin' ? memoryPressureLabel.value : '正常',
    trend: history.memory,
    tone: 'memory' as const,
    status: superLiteStatus.value.level,
  },
])
```

Add switching:

```ts
async function persistFloatingMonitorSettings(patch: Partial<FloatingMonitorSettingsData>) {
  try {
    await window.services.updateFloatingMonitorSettings?.(patch)
  } catch (error) {
    console.warn('悬浮监控设置持久化失败:', error)
  }
}

function switchFloatingMode(mode: FloatingMonitorMode) {
  if (floatingMode.value === mode) return
  floatingMode.value = mode
  superLitePage.value = 'overview'

  if (mode === 'super-lite') {
    window.services.resizeWindow(200, 200)
  } else {
    window.services.resizeWindow(432, 398)
  }

  void persistFloatingMonitorSettings({ mode })
}
```

Update `togglePin()`:

```ts
function togglePin() {
  pinned.value = !pinned.value
  window.services.alwaysOnTop(pinned.value)
  void persistFloatingMonitorSettings({ pinned: pinned.value })
}
```

Render at the top of `.watch-container`:

```vue
<SuperLiteMonitorView
  v-if="floatingMode === 'super-lite'"
  :page="superLitePage"
  :status="superLiteStatus"
  :metrics="superLiteMetrics"
  :footer-left="superLiteFooterLeft"
  :footer-right="superLiteFooterRight"
  :pinned="pinned"
  @set-page="superLitePage = $event"
  @toggle-pin="togglePin"
  @switch-standard="switchFloatingMode('standard')"
/>
```

Wrap the existing standard shell with:

```vue
<div v-else class="monitor-shell">
```

Add a small standard-mode shortcut button in the existing action group:

```vue
<button type="button" class="monitor-action" title="进入超级轻量模式" @click="switchFloatingMode('super-lite')">
  轻
</button>
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
node --test tests/superLiteSource.test.cjs
```

Expected: PASS.

- [ ] **Step 5: Commit super-lite mode wiring**

Run:

```bash
git add src/components/Watch/index.vue src/components/Watch/SuperLiteMonitorView.vue tests/superLiteSource.test.cjs
git commit -m "feat: wire super-lite floating mode"
```

---

### Task 7: Keep Existing Watch Behavior Stable

**Files:**
- Modify: `src/components/Watch/index.vue`
- Test: `tests/superLiteSource.test.cjs`
- Test: existing watch/source tests

- [ ] **Step 1: Add regression assertions for standard mode**

Append to `tests/superLiteSource.test.cjs`:

```js
test('standard watch mode keeps existing modes and actions', () => {
  const watch = readSource('src/components/Watch/index.vue')

  assert.match(watch, /monitorMode = ref<'overview' \| 'cpu' \| 'gpu'>\('overview'\)/)
  assert.match(watch, /@click="setMonitorMode\('overview'\)"/)
  assert.match(watch, /@click="setMonitorMode\('cpu'\)"/)
  assert.match(watch, /@click="setMonitorMode\('gpu'\)"/)
  assert.match(watch, /window\.services\.alwaysOnTop\(pinned\.value\)/)
  assert.match(watch, /window\.services\.closeWindow\(\)/)
})
```

- [ ] **Step 2: Run targeted source tests**

Run:

```bash
node --test tests/superLiteSource.test.cjs tests/superLiteEntrySource.test.cjs tests/watchTheme.test.ts
```

Expected: PASS.

- [ ] **Step 3: Fix only regressions caused by this feature**

If a standard-mode assertion fails, restore the original standard mode markup or method while preserving only the new lightweight shortcut button.

- [ ] **Step 4: Re-run targeted source tests**

Run:

```bash
node --test tests/superLiteSource.test.cjs tests/superLiteEntrySource.test.cjs tests/watchTheme.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit standard mode regression coverage**

Run:

```bash
git add src/components/Watch/index.vue tests/superLiteSource.test.cjs
git commit -m "test: cover watch standard mode regression"
```

---

### Task 8: Build Verification

**Files:**
- All modified implementation and test files

- [ ] **Step 1: Run all Node source tests relevant to this feature**

Run:

```bash
node --test tests/superLiteEntrySource.test.cjs tests/superLiteMonitor.test.cjs tests/superLiteSource.test.cjs tests/p0ExperienceSource.test.cjs tests/monitoringVisibility.test.cjs tests/serviceReader.test.cjs
```

Expected: PASS.

- [ ] **Step 2: Run the production build**

Run:

```bash
npm run build
```

Expected: PASS with `vue-tsc`, `vite build`, and entry page generation completing successfully.

- [ ] **Step 3: Inspect generated entry coverage if build succeeds**

Run:

```bash
test -f dist/a_watch_super_lite/index.html && test -f dist/watch.html
```

Expected: exit code 0.

- [ ] **Step 4: Report any verification gaps**

If no browser/electron manual run is performed, explicitly report that the implementation passed source tests and build, but was not manually opened in uTools/Electron.

- [ ] **Step 5: Commit final verification fixes if needed**

If Step 1 or Step 2 required fixes, run:

```bash
git add plugin.json utools/preload.js utools/services/window.js scripts/generate-utools-entry-pages.mjs src/App.vue src/type/interface.d.ts utools/services/system.js src/components/Watch/index.vue src/components/Watch/SuperLiteMonitorView.vue src/utils/superLiteMonitor.ts tests/superLiteEntrySource.test.cjs tests/superLiteMonitor.test.cjs tests/superLiteSource.test.cjs
git commit -m "fix: stabilize super-lite monitor verification"
```

If no fixes were needed, skip this commit.

---

## Self-Review Checklist

- PRD coverage:
  - Direct `plugin.json` entry: Task 1.
  - `a_watch_super_lite` watch classification and launch query: Task 1.
  - First-render `super-lite`: Task 2.
  - Single采集 owner in `Watch`: Tasks 5 and 6.
  - Mode/pinned persistence: Task 4 and Task 6.
  - `200x200` resize and standard resize: Task 6.
  - Lightweight details and no full sensor panel: Task 5 and Task 6.
  - Static abnormal status thresholds: Task 3 and Task 6.
  - Build and generated entry verification: Task 8.
- Placeholder scan:
  - No `TBD`, `TODO`, or “fill in later” steps.
- Type consistency:
  - `FloatingMonitorMode` is consistently `'standard' | 'super-lite'`.
  - Entry code is consistently `hardwareWatchSuperLite`.
  - Preset name is consistently `a_watch_super_lite`.
  - Launch query is consistently `floatingMode=super-lite&entry=hardwareWatchSuperLite`.
