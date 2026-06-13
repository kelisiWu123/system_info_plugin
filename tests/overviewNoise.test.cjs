const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { pathToFileURL } = require('node:url')

const { buildSync } = require('esbuild')

function loadOverviewUtils() {
  const outfile = path.join(
    os.tmpdir(),
    `system-info-overview-utils-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`
  )

  buildSync({
    entryPoints: [path.join(__dirname, '../src/utils/overview.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  })

  return import(pathToFileURL(outfile).href)
}

test('omits built-in GPU bus labels and unknown memory from overview GPU lines', async () => {
  const { getOverviewGpuLines } = await loadOverviewUtils()

  assert.deepEqual(
    getOverviewGpuLines({
      model: 'Apple M4',
      bus: 'Built-In',
      memoryTotal: 0,
      vram: 0,
    }),
    ['Apple M4']
  )
})

test('filters virtual audio devices when user-facing devices are present', async () => {
  const { getOverviewAudioLines } = await loadOverviewUtils()

  assert.deepEqual(
    getOverviewAudioLines([
      { id: 'speaker', name: 'Mac mini扬声器', manufacturer: 'Apple' },
      { id: 'virtual', name: 'OrayVirtualAudioDevice', manufacturer: 'Oray' },
    ]),
    ['Mac mini扬声器']
  )
})

test('filters noisy virtual network interfaces and keeps active physical links', async () => {
  const { getOverviewNetworkLines } = await loadOverviewUtils()

  assert.deepEqual(
    getOverviewNetworkLines([
      { iface: 'anpi0', ifaceName: 'anpi0', internal: false, speed: null },
      { iface: 'utun2', ifaceName: 'utun2', internal: false, speed: null },
      { iface: 'bridge0', ifaceName: 'bridge0', internal: false, speed: null },
      { iface: 'en0', ifaceName: 'en0', internal: false, speed: 1000 },
      { iface: 'awdl0', ifaceName: 'awdl0', internal: false, speed: null },
    ]),
    ['已连接（千兆连接）']
  )
})

test('prefers the default network interface and includes its IPv4 address in overview lines', async () => {
  const { getOverviewNetworkLines } = await loadOverviewUtils()

  assert.deepEqual(
    getOverviewNetworkLines([
      { iface: 'en5', ifaceName: 'en5', internal: false, speed: 1000, ip4: '10.0.0.21', default: false },
      { iface: 'en0', ifaceName: 'en0', internal: false, speed: 1000, ip4: '192.168.1.23', default: true },
      { iface: 'utun2', ifaceName: 'utun2', internal: false, speed: null, ip4: '100.64.0.2', default: false },
    ]),
    ['192.168.1.23（千兆连接）']
  )
})
