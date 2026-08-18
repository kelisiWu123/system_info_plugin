const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('systeminformation is upgraded to the 5.33 stable line', () => {
  const pkg = JSON.parse(readProjectFile('package.json'))
  const installed = JSON.parse(readProjectFile('node_modules/systeminformation/package.json'))

  assert.match(pkg.dependencies.systeminformation, /^\^5\.33\./)
  assert.equal(installed.version, '5.33.1')
})

test('storage page consumes fs and disk IO telemetry from systeminformation', () => {
  const service = readProjectFile('utools/services/system.js')
  const storagePage = readProjectFile('src/components/StoragePage/index.vue')

  assert.match(service, /async function getStorageIo\(\)/)
  assert.match(service, /si\.fsStats\(\)/)
  assert.match(service, /si\.disksIO\(\)/)
  assert.match(storagePage, /label:\s*'实时 I\/O'/)
  assert.match(storagePage, /storageIoData\.value\.readBytesPerSec/)
  assert.match(storagePage, /storageIoData\.value\.writeBytesPerSec/)
})

test('macOS disk layout excludes virtual APFS device mirrors before exposing physical disks', () => {
  const service = readProjectFile('utools/services/system.js')
  const boardPage = readProjectFile('src/components/BoardPage/index.vue')
  const monitorStore = readProjectFile('src/composables/useMonitorDashboardData.ts')
  const utils = readProjectFile('src/utils.ts')

  assert.match(service, /function parseMacDiskutilTopology\(stdout\)/)
  assert.match(service, /\/usr\/sbin\/diskutil', \['info', device\.trim\(\)\]/)
  assert.match(service, /Virtual:\\s\*\(Yes\|No\)/)
  assert.match(service, /APFS Physical Store/)
  assert.match(service, /\.filter\(\(\{ topology \}\) => topology\.virtual !== true\)/)
  assert.match(service, /normalizeDiskLayoutForPlatform\(await si\.diskLayout\(\)\)/)

  assert.match(boardPage, /getPhysicalDiskLayout\(diskLayoutData\.value\)/)
  assert.doesNotMatch(boardPage, /diskLayoutData\.value\.map\(/)
  assert.match(monitorStore, /window\.services\.getOsInfo\(\)/)
  assert.match(monitorStore, /getStorageUsageSummary\(diskData\.value, diskLayoutData\.value, platform\)/)
  assert.match(utils, /const physicalTotal = getPhysicalDiskTotalBytes\(disks\)/)
  assert.match(utils, /const total = physicalTotal > 0 \? physicalTotal : mountedTotal/)
})

test('all user-facing physical disk capacity surfaces share the deduplicated disk helpers', () => {
  const storagePage = readProjectFile('src/components/StoragePage/index.vue')
  const deviceSpecs = readProjectFile('src/components/DeviceSpecsLite/index.vue')
  const computer = readProjectFile('src/components/Computer/index.vue')
  const boardPage = readProjectFile('src/components/BoardPage/index.vue')
  const monitorStore = readProjectFile('src/composables/useMonitorDashboardData.ts')

  assert.match(storagePage, /getPhysicalDiskLayout\(diskLayoutData\.value\)/)
  assert.match(storagePage, /getPhysicalDiskTotalBytes\(diskLayoutData\.value\)/)
  assert.match(deviceSpecs, /getPhysicalDiskLayout\(diskLayoutData\.value\)/)
  assert.match(computer, /getPhysicalDiskLayout\(diskLayoutData\.value\)/)
  assert.match(boardPage, /getPhysicalDiskLayout\(diskLayoutData\.value\)/)
  assert.doesNotMatch(boardPage, /diskLayoutData\.value\.map\(/)
  assert.match(monitorStore, /const platform = osInfo\.value\?\.platform\?\.toLowerCase\?\.\(\) \|\| ''/)
  assert.match(monitorStore, /getStorageUsageSummary\(diskData\.value, diskLayoutData\.value, platform\)/)
})

test('overview exposes default network, gateway latency, and live transfer rates', () => {
  const service = readProjectFile('utools/services/system.js')
  const overviewStore = readProjectFile('src/composables/useOverviewHardwareData.ts')
  const computer = readProjectFile('src/components/Computer/index.vue')

  assert.match(service, /si\.networkInterfaceDefault\(\)/)
  assert.match(service, /si\.networkGatewayDefault\(\)/)
  assert.match(service, /si\.inetLatency\(gateway\)/)
  assert.match(service, /si\.networkStats\(defaultInterface\)/)
  assert.match(overviewStore, /window\.services\.getNetworkStatus\(\)/)
  assert.match(computer, /网关延迟/)
  assert.match(computer, /networkStatus\.value\.rxSec/)
  assert.match(computer, /networkStatus\.value\.txSec/)
})

test('monitor dashboard includes both CPU-heavy and memory-heavy process candidates', () => {
  const service = readProjectFile('utools/services/system.js')
  const monitorStore = readProjectFile('src/composables/useMonitorDashboardData.ts')
  const dashboard = readProjectFile('src/components/MonitoringDashboard/index.vue')

  assert.match(service, /si\.processes\(\)/)
  assert.match(service, /const byCpu = \[\.\.\.candidates\]/)
  assert.match(service, /const byMemory = \[\.\.\.candidates\]/)
  assert.match(service, /for \(const item of \[\.\.\.byCpu, \.\.\.byMemory\]\)/)
  assert.match(monitorStore, /window\.services\.getTopProcesses\(\)/)
  assert.match(dashboard, /高占用进程/)
  assert.match(dashboard, /item\.memRss/)
})

test('overview renders progressively and promotes active network information into the first summary row', () => {
  const overviewStore = readProjectFile('src/composables/useOverviewHardwareData.ts')
  const computer = readProjectFile('src/components/Computer/index.vue')

  assert.match(overviewStore, /async function loadOverviewCoreSummary\(\)/)
  assert.match(overviewStore, /async function loadOverviewEarlyEnrichment\(\)/)
  assert.match(overviewStore, /const earlyEnrichmentPromise = loadOverviewEarlyEnrichment\(\)\.catch\(\(\) => undefined\)/)
  assert.match(overviewStore, /await loadOverviewCoreSummary\(\)\s*loading\.value = false\s*await hydrateOverviewDetails\(\)/)
  assert.match(computer, /v-if="!loading && pageStateBlock"/)
  assert.match(computer, /class="overview-progress"/)
  assert.match(computer, /id:\s*'network',[\s\S]*label:\s*'网络',[\s\S]*icon:\s*Wifi/)
  assert.match(computer, /networkSummaryTitle/)
  assert.match(computer, /IPv4/)
  assert.match(computer, /网关/)
  assert.match(computer, /memoryOverviewManufacturer/)
  assert.match(computer, /id:\s*'storage',[\s\S]*label:\s*'硬盘',[\s\S]*icon:\s*HardDisk/)
  assert.match(computer, /formatVendorModel\(primaryOverviewDisk\.value\.vendor, primaryOverviewDisk\.value\.name\)/)
  assert.match(computer, /grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)/)
})

test('macOS GPU temperature prefers systeminformation and keeps native fallbacks', () => {
  const service = readProjectFile('utools/services/system.js')

  assert.match(service, /const systemInformationHasTemperature = isMacOS && typeof controller\.temperatureGpu === 'number'/)
  assert.match(service, /temperatureGpu:\s*isMacOS\s*\? controller\.temperatureGpu \?\? macGpuTemperature\?\.temperatureGpu \?\? null/)
  assert.match(service, /systemInformationHasTemperature\s*\? 'systeminformation'/)
  assert.match(service, /readMacGpuTemperature\(\{ pluginRoot: configuredPluginRoot \}\)/)
  assert.match(service, /readMacSmcGpuTemperature\(\{ pluginRoot: configuredPluginRoot \}\)/)
  assert.match(service, /pickPreferredMacGpuTemperature\(nativeMacGpuTemperature, smcMacGpuTemperature\)/)
})
