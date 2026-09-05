const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { pathToFileURL } = require('node:url')

const { buildSync } = require('esbuild')

function loadPresentation() {
  const outfile = path.join(
    os.tmpdir(),
    `system-info-presentation-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`
  )

  buildSync({
    entryPoints: [path.join(__dirname, '../src/utils/presentation.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  })

  return import(pathToFileURL(outfile).href)
}

function restoreGlobal(name, descriptor) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor)
  } else {
    delete globalThis[name]
  }
}

test('clipboard falls back to document copy when the Clipboard API rejects', async () => {
  const { writeClipboardText } = await loadPresentation()
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const appended = []
  const textarea = {
    value: '',
    style: {},
    setAttribute() {},
    select() {},
  }
  const documentMock = {
    createElement(tag) {
      assert.equal(tag, 'textarea')
      return textarea
    },
    body: {
      appendChild(node) {
        appended.push(node)
      },
      removeChild(node) {
        assert.equal(node, textarea)
      },
    },
    execCommand(command) {
      assert.equal(command, 'copy')
      return true
    },
  }

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: async () => { throw new Error('permission denied') } } },
  })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentMock })

  try {
    await writeClipboardText('报告内容')
    assert.equal(textarea.value, '报告内容')
    assert.deepEqual(appended, [textarea])
  } finally {
    restoreGlobal('navigator', navigatorDescriptor)
    restoreGlobal('document', documentDescriptor)
  }
})
