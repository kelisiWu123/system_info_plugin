const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('composables and Watch reuse the shared service reader helpers', () => {
  const files = [
    'src/composables/useHardwareData.ts',
    'src/composables/useGraphicsHardwareData.ts',
    'src/composables/useOverviewHardwareData.ts',
    'src/composables/useProcessorHardwareData.ts',
    'src/components/Watch/index.vue',
  ]

  for (const file of files) {
    const source = readSource(file)
    assert.match(source, /from ['"].*serviceReader['"]/)
    assert.doesNotMatch(source, /function withTimeout/)
    assert.doesNotMatch(source, /async function readService/)
  }
})

test('only the shared service reader defines timeout, retry, and error normalization helpers', () => {
  const source = readSource('src/utils/serviceReader.ts')

  assert.match(source, /export function withTimeout/)
  assert.match(source, /export async function readService/)
  assert.match(source, /export function normalizeErrorMessage/)
})
