import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import { getUtoolsPluginRoot, resolveUtoolsRuntime } from '../utools/runtime'

test('creates a safe dev runtime stub when utools is unavailable', () => {
  const runtime = resolveUtoolsRuntime(undefined, {})

  assert.equal(runtime.isDev(), true)
  assert.doesNotThrow(() => runtime.outPlugin())
  assert.equal(typeof runtime.createBrowserWindow, 'undefined')
})

test('prefers the provided utools runtime when available', () => {
  const runtime = resolveUtoolsRuntime({
    isDev: () => false,
    outPlugin: () => 'noop',
  }, {})

  assert.equal(runtime.isDev(), false)
})

test('derives plugin root from dev mode safely', () => {
  const preloadDir = path.join('/tmp', 'project', 'dist-electron', 'preload')
  const devRoot = getUtoolsPluginRoot({
    isDev: () => true,
    outPlugin: () => undefined,
  }, preloadDir)
  const prodRoot = getUtoolsPluginRoot({
    isDev: () => false,
    outPlugin: () => undefined,
  }, preloadDir)

  assert.equal(devRoot, path.resolve(preloadDir, '..'))
  assert.equal(prodRoot, preloadDir)
})
