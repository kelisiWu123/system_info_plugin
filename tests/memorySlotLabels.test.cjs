const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { buildSync } = require('esbuild')

function loadMemoryUtils() {
  const outfile = path.join(os.tmpdir(), `system-info-memory-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`)
  buildSync({
    entryPoints: [path.join(__dirname, '../src/utils/memory.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  return require(outfile)
}

test('normalizes empty memory slot names consistently across channel layouts', () => {
  const { buildMemorySlotLabels } = loadMemoryUtils()
  const labels = buildMemorySlotLabels(4, [
    { bank: 'P0 CHANNEL A/1', size: 16 * 1024 ** 3 },
    { bank: 'P0 CHANNEL B/3', size: 16 * 1024 ** 3 },
    { bank: 'DIMM_B1', size: 0 },
    { bank: 'DIMM_B2', size: 0 },
  ])

  assert.deepEqual(labels, [
    'P0 CHANNEL A/1',
    'P0 CHANNEL B/3',
    'DIMM_A2',
    'DIMM_B2',
  ])
})
