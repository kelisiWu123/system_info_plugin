# Monitoring Performance Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a first-stage monitoring scheduler that lowers plugin CPU usage by refreshing only the active page's data, slowing down automatically in the background, and letting users pick a global refresh profile.

**Architecture:** Keep the existing shared hardware store for now, but add a pure scheduling layer that maps active page scopes plus window visibility to dynamic metric requirements and intervals. Persist user refresh settings in the existing runtime service storage, then surface a lightweight global control panel in the overview page so users can switch between energy-saving, balanced, and realtime modes.

**Tech Stack:** Vue 3, TypeScript, Node test runner, Electron/uTools bridge services, existing `systeminformation` service wrappers

---

## File Map

- Create: `src/utils/monitoring.ts`
  - Pure scheduling constants and helpers for refresh profiles, active page requirements, and background throttling behavior.
- Create: `tests/monitoringScheduler.test.ts`
  - Regression tests for refresh profile defaults, background throttling, and page-to-metric requirement mapping.
- Modify: `src/type/interface.d.ts`
  - Shared types for monitoring refresh settings and new bridge methods.
- Modify: `utools/services/system.js`
  - Persistent storage for monitoring refresh settings with normalize/read/update helpers.
- Modify: `src/composables/useHardwareData.ts`
  - First-stage scheduler integration: scope-based activation, background-aware polling, settings loading, and global refresh setting update helpers.
- Modify: `src/components/Computer/index.vue`
  - Add a lightweight refresh settings panel that lets users choose the global profile and see background throttling state.
- Modify: `src/components/Processor/index.vue`
  - Pass the processor scope into store activation so only processor metrics stay live while the page is active.
- Modify: `src/components/GraphicsPage/index.vue`
  - Pass the graphics scope into store activation.
- Modify: `src/components/MemoryPage/index.vue`
  - Pass the memory scope into store activation.
- Modify: `src/components/StoragePage/index.vue`
  - Pass the storage scope into store activation.
- Modify: `src/components/BoardPage/index.vue`
  - Pass the board scope into store activation.

## Task 1: Add Scheduler Utilities

**Files:**
- Create: `src/utils/monitoring.ts`
- Test: `tests/monitoringScheduler.test.ts`

- [ ] **Step 1: Write the failing scheduler tests**

```ts
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_MONITORING_REFRESH_SETTINGS,
  getDynamicMetricRequirementsForScopes,
  getMonitoringRefreshIntervals,
} from '../src/utils/monitoring'

test('uses balanced refresh settings by default', () => {
  assert.deepEqual(DEFAULT_MONITORING_REFRESH_SETTINGS, {
    profile: 'balanced',
    backgroundThrottleEnabled: true,
  })
})

test('maps active scopes to only the dynamic metrics they need', () => {
  assert.deepEqual(getDynamicMetricRequirementsForScopes(['overview']), {
    cpuTemp: true,
    cpuLoad: true,
    cpuLoadDetail: false,
    cpuSpeed: true,
    cpuAux: false,
    gpu: true,
    memory: true,
    disk: true,
    time: true,
  })

  assert.deepEqual(getDynamicMetricRequirementsForScopes(['processor']), {
    cpuTemp: true,
    cpuLoad: true,
    cpuLoadDetail: true,
    cpuSpeed: true,
    cpuAux: true,
    gpu: false,
    memory: false,
    disk: false,
    time: true,
  })
})

test('applies stronger throttling when the window is in the background', () => {
  const foreground = getMonitoringRefreshIntervals('balanced', false)
  const background = getMonitoringRefreshIntervals('balanced', true)

  assert.equal(foreground.base, 4000)
  assert.equal(background.base, 12000)
  assert.equal(background.gpu, 0)
  assert.equal(background.cpuAux, 0)
  assert.equal(background.cpuLoadDetail, 0)
})
```

- [ ] **Step 2: Run the scheduler test to verify it fails**

Run: `node --test tests/monitoringScheduler.test.ts`

Expected: FAIL with module or export errors because `src/utils/monitoring.ts` does not exist yet.

- [ ] **Step 3: Write the minimal scheduler utility**

```ts
export type HardwareMonitorScope = 'overview' | 'processor' | 'graphics' | 'board' | 'memory' | 'storage'
export type MonitoringRefreshProfile = 'eco' | 'balanced' | 'realtime'

export interface MonitoringRefreshSettingsData {
  profile: MonitoringRefreshProfile
  backgroundThrottleEnabled: boolean
}

export interface DynamicMetricRequirements {
  cpuTemp: boolean
  cpuLoad: boolean
  cpuLoadDetail: boolean
  cpuSpeed: boolean
  cpuAux: boolean
  gpu: boolean
  memory: boolean
  disk: boolean
  time: boolean
}

export const DEFAULT_MONITORING_REFRESH_SETTINGS: MonitoringRefreshSettingsData = {
  profile: 'balanced',
  backgroundThrottleEnabled: true,
}

export function getDynamicMetricRequirementsForScopes(scopes: HardwareMonitorScope[]): DynamicMetricRequirements {
  // merge the per-scope requirements here
}

export function getMonitoringRefreshIntervals(profile: MonitoringRefreshProfile, isBackground: boolean) {
  // return per-metric intervals; use 0 to pause heavy metrics in the background
}
```

- [ ] **Step 4: Run the scheduler test to verify it passes**

Run: `node --test tests/monitoringScheduler.test.ts`

Expected: PASS with all scheduler tests green.

## Task 2: Persist Refresh Settings in the Runtime Service

**Files:**
- Modify: `src/type/interface.d.ts`
- Modify: `utools/services/system.js`
- Test: `tests/monitoringScheduler.test.ts`

- [ ] **Step 1: Extend the failing test with settings normalization expectations**

```ts
import { normalizeMonitoringRefreshSettings } from '../src/utils/monitoring'

test('normalizes invalid refresh settings back to safe defaults', () => {
  assert.deepEqual(
    normalizeMonitoringRefreshSettings({
      profile: 'turbo',
      backgroundThrottleEnabled: 'yes',
    }),
    {
      profile: 'balanced',
      backgroundThrottleEnabled: true,
    }
  )
})
```

- [ ] **Step 2: Run the scheduler test to verify it fails**

Run: `node --test tests/monitoringScheduler.test.ts`

Expected: FAIL because `normalizeMonitoringRefreshSettings` is not exported yet.

- [ ] **Step 3: Add the normalization helper and bridge methods**

```ts
// src/utils/monitoring.ts
export function normalizeMonitoringRefreshSettings(input: Partial<MonitoringRefreshSettingsData> | null | undefined): MonitoringRefreshSettingsData {
  const profile = input?.profile === 'eco' || input?.profile === 'balanced' || input?.profile === 'realtime'
    ? input.profile
    : DEFAULT_MONITORING_REFRESH_SETTINGS.profile

  return {
    profile,
    backgroundThrottleEnabled:
      typeof input?.backgroundThrottleEnabled === 'boolean'
        ? input.backgroundThrottleEnabled
        : DEFAULT_MONITORING_REFRESH_SETTINGS.backgroundThrottleEnabled,
  }
}
```

```js
// utools/services/system.js
const MONITORING_REFRESH_SETTINGS_STORAGE_KEY = 'monitoringRefreshSettings'

function getMonitoringRefreshSettingsStorage() {
  return getHardwareSensorSettingsStorage()
}

function readMonitoringRefreshSettingsRaw() {
  const storage = getMonitoringRefreshSettingsStorage()
  return storage?.getItem ? storage.getItem(MONITORING_REFRESH_SETTINGS_STORAGE_KEY) : null
}

function writeMonitoringRefreshSettingsRaw(value) {
  const storage = getMonitoringRefreshSettingsStorage()
  if (storage?.setItem) storage.setItem(MONITORING_REFRESH_SETTINGS_STORAGE_KEY, value)
}

function normalizeMonitoringRefreshSettings(input) {
  return {
    profile: ['eco', 'balanced', 'realtime'].includes(input?.profile) ? input.profile : 'balanced',
    backgroundThrottleEnabled: typeof input?.backgroundThrottleEnabled === 'boolean' ? input.backgroundThrottleEnabled : true,
  }
}

function getMonitoringRefreshSettings() {
  return normalizeMonitoringRefreshSettings(readMonitoringRefreshSettingsRaw() || {})
}

function updateMonitoringRefreshSettings(patch = {}) {
  const next = normalizeMonitoringRefreshSettings({
    ...getMonitoringRefreshSettings(),
    ...patch,
  })
  writeMonitoringRefreshSettingsRaw(next)
  return next
}
```

```ts
// src/type/interface.d.ts
interface MonitoringRefreshSettingsData {
  profile: 'eco' | 'balanced' | 'realtime'
  backgroundThrottleEnabled: boolean
}
```

- [ ] **Step 4: Run the scheduler test to verify it passes**

Run: `node --test tests/monitoringScheduler.test.ts`

Expected: PASS with normalization coverage included.

## Task 3: Integrate Scope-Based Scheduling into the Shared Hardware Store

**Files:**
- Modify: `src/composables/useHardwareData.ts`
- Test: `tests/monitoringScheduler.test.ts`

- [ ] **Step 1: Add a failing test for scope unions and paused background metrics**

```ts
test('merges multiple active scopes without enabling unrelated heavy metrics in the background', () => {
  const requirements = getDynamicMetricRequirementsForScopes(['overview', 'storage'])
  assert.equal(requirements.cpuLoad, true)
  assert.equal(requirements.disk, true)
  assert.equal(requirements.cpuAux, false)

  const background = getMonitoringRefreshIntervals('realtime', true)
  assert.equal(background.cpuAux, 0)
  assert.equal(background.gpu, 0)
})
```

- [ ] **Step 2: Run the scheduler test to verify it passes before store wiring**

Run: `node --test tests/monitoringScheduler.test.ts`

Expected: PASS, confirming the scheduler helpers are safe to use in the store refactor.

- [ ] **Step 3: Refactor the store to activate by scope and poll only needed metrics**

```ts
// src/composables/useHardwareData.ts
const activeScopeCounts = reactive<Record<HardwareMonitorScope, number>>({
  overview: 0,
  processor: 0,
  graphics: 0,
  board: 0,
  memory: 0,
  storage: 0,
})

const monitoringRefreshSettings = ref<MonitoringRefreshSettingsData>(DEFAULT_MONITORING_REFRESH_SETTINGS)
const windowVisible = ref(typeof document === 'undefined' ? true : !document.hidden)

function getActiveScopes(): HardwareMonitorScope[] {
  return (Object.keys(activeScopeCounts) as HardwareMonitorScope[]).filter((scope) => activeScopeCounts[scope] > 0)
}

function getDynamicRequirements() {
  return getDynamicMetricRequirementsForScopes(getActiveScopes())
}

function isBackgroundThrottled() {
  return monitoringRefreshSettings.value.backgroundThrottleEnabled && !windowVisible.value
}

export async function activateHardwareStore(scope: HardwareMonitorScope = 'overview') {
  activeScopeCounts[scope] += 1
  // init store + load settings once, then start adaptive polling
}

export function deactivateHardwareStore(scope: HardwareMonitorScope = 'overview') {
  activeScopeCounts[scope] = Math.max(0, activeScopeCounts[scope] - 1)
  // stop polling if all scopes are inactive
}
```

- [ ] **Step 4: Run focused type verification**

Run: `npx vue-tsc --noEmit`

Expected: PASS, confirming the refactor did not break component typing.

## Task 4: Add a Global Refresh Settings Panel in the Overview Page

**Files:**
- Modify: `src/components/Computer/index.vue`
- Modify: `src/composables/useHardwareData.ts`

- [ ] **Step 1: Write the failing UI wiring by referencing the new store settings**

```ts
const {
  monitoringRefreshSettings,
  backgroundThrottled,
} = hardwareStore
```

Expected failure: the store does not yet expose these fields.

- [ ] **Step 2: Run type verification to watch it fail**

Run: `npx vue-tsc --noEmit`

Expected: FAIL because the new store fields and update helper are not exposed yet.

- [ ] **Step 3: Expose the settings in the store and render a lightweight control panel**

```ts
// src/composables/useHardwareData.ts
export async function updateHardwareMonitorRefreshSettings(patch: Partial<MonitoringRefreshSettingsData>) {
  monitoringRefreshSettings.value = await window.services.updateMonitoringRefreshSettings(patch)
  restartPolling()
  return monitoringRefreshSettings.value
}
```

```vue
<!-- src/components/Computer/index.vue -->
<section class="performance-panel">
  <div class="panel-heading">
    <h3>刷新策略</h3>
    <span>{{ backgroundThrottled ? '后台已自动降频' : '前台正常刷新' }}</span>
  </div>

  <div class="performance-profile-group">
    <button
      v-for="profile in refreshProfiles"
      :key="profile.id"
      type="button"
      :class="['profile-chip', { 'profile-chip--active': monitoringRefreshSettings.profile === profile.id }]"
      @click="applyRefreshProfile(profile.id)"
    >
      <strong>{{ profile.label }}</strong>
      <span>{{ profile.description }}</span>
    </button>
  </div>
</section>
```

- [ ] **Step 4: Run type verification to verify the UI passes**

Run: `npx vue-tsc --noEmit`

Expected: PASS with the overview page using the new global settings.

## Task 5: Wire Page Scopes and Run Full Verification

**Files:**
- Modify: `src/components/Processor/index.vue`
- Modify: `src/components/GraphicsPage/index.vue`
- Modify: `src/components/MemoryPage/index.vue`
- Modify: `src/components/StoragePage/index.vue`
- Modify: `src/components/BoardPage/index.vue`
- Test: `tests/monitoringScheduler.test.ts`

- [ ] **Step 1: Update each page to activate the store with an explicit scope**

```ts
await activateHardwareStore('processor')
deactivateHardwareStore('processor')
```

```ts
await activateHardwareStore('graphics')
deactivateHardwareStore('graphics')
```

```ts
await activateHardwareStore('memory')
deactivateHardwareStore('memory')
```

```ts
await activateHardwareStore('storage')
deactivateHardwareStore('storage')
```

```ts
await activateHardwareStore('board')
deactivateHardwareStore('board')
```

- [ ] **Step 2: Run the scheduler tests**

Run: `node --test tests/monitoringScheduler.test.ts`

Expected: PASS.

- [ ] **Step 3: Run the targeted existing regression suites**

Run: `node --test tests/watchTheme.test.ts tests/processorSensorEnhancementPlatform.test.ts tests/storageMacPlatform.test.ts tests/macSensors.test.cjs`

Expected: PASS with 0 failures.

- [ ] **Step 4: Run the project type check and build**

Run: `npx vue-tsc --noEmit`

Expected: PASS.

Run: `npm run build`

Expected: PASS with the normal build output and generated entry pages.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-06-13-monitoring-performance-phase1.md tests/monitoringScheduler.test.ts src/utils/monitoring.ts src/type/interface.d.ts utools/services/system.js src/composables/useHardwareData.ts src/components/Computer/index.vue src/components/Processor/index.vue src/components/GraphicsPage/index.vue src/components/MemoryPage/index.vue src/components/StoragePage/index.vue src/components/BoardPage/index.vue
git commit -m "feat: add adaptive monitoring refresh scheduler"
```

## Self-Review

- Spec coverage: this phase covers refresh profile selection, background throttling, active-page-only dynamic polling, and service persistence for the profile setting. It intentionally does not complete the later `overview-lite` / `page-full store` split yet.
- Placeholder scan: no `TODO`, `TBD`, or task references without paths.
- Type consistency: use `MonitoringRefreshSettingsData`, `HardwareMonitorScope`, and `activateHardwareStore(scope)` consistently across the plan.
