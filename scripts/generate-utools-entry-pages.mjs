import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const distDir = join(process.cwd(), 'dist')
const assetsDir = join(distDir, 'assets')
const helperSourceDir = join(process.cwd(), 'native', 'hwmon-helper', 'bin', 'win32-x64')
const sourceHtml = readFileSync(join(distDir, 'index.html'), 'utf8')

const scriptMatch = sourceHtml.match(/<script[^>]*src="\.\/([^"]+)"[^>]*><\/script>/i)
const styleMatch = sourceHtml.match(/<link[^>]*href="\.\/([^"]+)"[^>]*>/i)

if (!scriptMatch || !styleMatch) {
  throw new Error('无法从 dist/index.html 提取构建资源路径')
}

const scriptPath = `../${scriptMatch[1]}`
const stylePath = `../${styleMatch[1]}`

function buildEntryHtml(pageName) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>HWInfoX</title>
    <script>
      if (!window.location.hash) {
        window.location.hash = '${pageName}';
      }
    </script>
    <script type="module" crossorigin src="${scriptPath}"></script>
    <link rel="stylesheet" crossorigin href="${stylePath}">
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>
`
}

function buildStandaloneEntryHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>HWInfoX</title>
    <script type="module" crossorigin src="./assets/${scriptMatch[1].split('/').pop()}"></script>
    <link rel="stylesheet" crossorigin href="./assets/${styleMatch[1].split('/').pop()}">
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>
`
}

function writePageEntry(filePath, pageName) {
  writeFileSync(
    filePath,
    buildStandaloneEntryHtml().replace('</head>', `    <script>\n      if (!window.location.hash) {\n        window.location.hash = '${pageName}';\n      }\n    </script>\n  </head>`),
    'utf8'
  )
}

for (const [entryName, pageName] of [
  ['a_computer', 'computer'],
  ['a_watch', 'watch'],
]) {
  const entryDir = join(distDir, entryName)
  rmSync(entryDir, { recursive: true, force: true })
  mkdirSync(entryDir, { recursive: true })
  cpSync(assetsDir, join(entryDir, 'assets'), { recursive: true, force: true })
  writePageEntry(join(entryDir, 'index.html'), pageName)
}

writePageEntry(join(distDir, 'computer.html'), 'computer')
writePageEntry(join(distDir, 'watch.html'), 'watch')

if (existsSync(helperSourceDir)) {
  const helperTargetDir = join(distDir, 'native', 'hwmon-helper', 'bin', 'win32-x64')
  rmSync(helperTargetDir, { recursive: true, force: true })
  mkdirSync(helperTargetDir, { recursive: true })
  cpSync(helperSourceDir, helperTargetDir, { recursive: true, force: true })
}

rmSync(join(distDir, 'index.html'), { force: true })
