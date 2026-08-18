const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { pathToFileURL } = require('node:url')

const { buildSync } = require('esbuild')

function loadUtils() {
  const outfile = path.join(
    os.tmpdir(),
    `system-info-storage-health-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`
  )

  buildSync({
    entryPoints: [path.join(__dirname, '../src/utils.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  })

  return import(pathToFileURL(outfile).href)
}

test('placeholder SMART statuses do not count as disk health telemetry', async () => {
  const { hasDiskHealthTelemetry } = await loadUtils()

  assert.equal(hasDiskHealthTelemetry({ smartStatus: 'unknown' }), false)
  assert.equal(hasDiskHealthTelemetry({ smartStatus: 'N/A' }), false)
  assert.equal(hasDiskHealthTelemetry({ smartStatus: '--' }), false)
})

test('real nested SMART or NVMe health fields remain valid even when top-level status is unknown', async () => {
  const { hasDiskHealthTelemetry } = await loadUtils()

  assert.equal(
    hasDiskHealthTelemetry({
      smartStatus: 'unknown',
      smartData: { smart_status: { passed: true } },
    }),
    true
  )

  assert.equal(
    hasDiskHealthTelemetry({
      smartStatus: 'unknown',
      smartData: { nvme_smart_health_information_log: { critical_warning: 0 } },
    }),
    true
  )
})

test('storage UI never exposes raw unknown health and omits unavailable health or temperature from reports', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/components/StoragePage/index.vue'), 'utf8')

  assert.match(source, /const criticalWarning = disk\.smartData\?\.nvme_smart_health_information_log\?\.critical_warning/)
  assert.match(source, /\['ok', 'passed', 'healthy', 'good'\]/)
  assert.doesNotMatch(source, /return \{ text: cleanText\(disk\.smartStatus\)/)
  assert.match(source, /\.\.\.\(disk\.healthText \? \[`健康：\$\{disk\.healthText\}`\] : \[\]\)/)
  assert.match(source, /typeof disk\.temperature === 'number' && disk\.temperature > 0 \? \[`温度：/)
  assert.match(source, /const hasDiskHealthStatus = computed/)
  assert.match(source, /<section v-if="selectedDisk\?\.smartRows\.length" class="storage-section">/)
})
