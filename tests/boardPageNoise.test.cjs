const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { pathToFileURL } = require('node:url')

const { buildSync } = require('esbuild')

function loadBoardUtils() {
  const outfile = path.join(
    os.tmpdir(),
    `system-info-board-utils-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`
  )

  buildSync({
    entryPoints: [path.join(__dirname, '../src/utils/board.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  })

  return import(pathToFileURL(outfile).href)
}

test('uses an Apple platform fallback title when macOS baseboard model is unavailable', async () => {
  const { getBoardDisplayName } = await loadBoardUtils()

  assert.equal(
    getBoardDisplayName({
      platform: 'darwin',
      loading: false,
      boardManufacturer: '',
      boardModel: '',
      biosVendor: 'Apple Inc.',
    }),
    'Apple 平台固件'
  )
})

test('does not leak numeric cpu family as chipset on Apple Silicon', async () => {
  const { inferBoardChipsetName } = await loadBoardUtils()

  assert.equal(
    inferBoardChipsetName({
      platform: 'darwin',
      boardModel: '',
      cpuFamily: '1867590060',
      cpuSocket: 'SOC',
    }),
    'SoC 集成'
  )
})

test('labels macOS memory modules as unified memory instead of raw slot indexes', async () => {
  const { getBoardMemorySlotLabel } = await loadBoardUtils()

  assert.equal(
    getBoardMemorySlotLabel({
      platform: 'darwin',
      bank: '0',
      index: 0,
      totalSlots: 1,
    }),
    '统一内存'
  )
})

test('filters placeholder manufacturing rows from board reports', async () => {
  const { filterBoardReportRows } = await loadBoardUtils()

  assert.deepEqual(
    filterBoardReportRows([
      { label: '制造商', value: '--' },
      { label: '官方网站', value: '--' },
      { label: '产品序列号', value: '--' },
      { label: '资产标签', value: '--' },
      { label: '操作系统', value: 'macOS 15.3.2 arm64' },
    ]),
    [{ label: '操作系统', value: 'macOS 15.3.2 arm64' }]
  )
})
