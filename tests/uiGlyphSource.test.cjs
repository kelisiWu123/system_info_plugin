const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function collectSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(filePath)
    return /\.(vue|ts)$/.test(entry.name) ? [filePath] : []
  })
}

test('renderer does not regress to font-dependent icon glyphs', () => {
  const sourceFiles = collectSourceFiles(path.join(__dirname, '..', 'src'))
  const forbiddenGlyphs = /[⌄⌃▼▲▾▴←→↑↓↔✕✓✔●⏱↻]/

  for (const filePath of sourceFiles) {
    const source = fs.readFileSync(filePath, 'utf8')
    assert.doesNotMatch(source, forbiddenGlyphs, path.relative(path.join(__dirname, '..'), filePath))
  }
})
