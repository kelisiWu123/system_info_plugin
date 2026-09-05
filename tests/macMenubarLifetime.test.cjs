const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { once } = require('node:events')
const { setTimeout: delay } = require('node:timers/promises')
const test = require('node:test')

test('native menubar lifetime follows plugin sampling processes', { skip: process.platform !== 'darwin', timeout: 20000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hwinfox-lifetime-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const binary = path.join(directory, 'watchdog')
  const build = spawnSync('clang', ['-fobjc-arc', '-Wall', '-Wextra', '-Werror',
    path.join(__dirname, 'fixtures/menubarLifetime.m'), '-framework', 'Foundation', '-o', binary], { encoding: 'utf8' })
  assert.equal(build.status, 0, build.stderr)

  async function fixture(t) {
    const state = fs.mkdtempSync(path.join(directory, 'state-'))
    const scheduler = path.join(state, 'scheduler.json')
    const stop = path.join(state, 'runtime-stop.json')
    const children = []
    t.after(async () => {
      for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill()
      await Promise.all(children.map((child) => child.done))
    })
    function track(child) {
      child.done = once(child, 'exit')
      children.push(child)
      return child
    }
    async function owner() {
      const child = track(spawn(process.execPath, ['-e', 'console.log("ready");setInterval(()=>{},1000)']))
      await once(child.stdout, 'data')
      return child
    }
    function publish(child) {
      fs.writeFileSync(`${scheduler}.tmp`, JSON.stringify({ pid: child.pid, token: 'test', heartbeat: 1 }))
      fs.renameSync(`${scheduler}.tmp`, scheduler)
    }
    async function watchdog() {
      const child = track(spawn(binary, [scheduler, stop]))
      await once(child.stdout, 'data')
      return child
    }
    async function exited(child) {
      const result = await Promise.race([child.done, delay(2500).then(() => 'timeout')])
      assert.notEqual(result, 'timeout', 'helper must exit even while the test host stays alive')
      assert.deepEqual(result, [0, null])
    }
    return { owner, publish, watchdog, exited, scheduler, stop }
  }

  await t.test('forced plugin death exits the native watchdog without any JS exit callback', async (t) => {
    const f = await fixture(t)
    const owner = await f.owner()
    f.publish(owner)
    const helper = await f.watchdog()
    await delay(900)
    assert.equal(helper.exitCode, null, 'old sample timestamps alone must not stop a live plugin')
    owner.kill('SIGKILL')
    await owner.done
    await f.exited(helper)
  })

  await t.test('a new sampling window takes over without restarting the watchdog', async (t) => {
    const f = await fixture(t)
    const first = await f.owner()
    const second = await f.owner()
    f.publish(first)
    const helper = await f.watchdog()
    first.kill()
    await first.done
    fs.unlinkSync(f.scheduler)
    await delay(150)
    f.publish(second)
    await delay(900)
    assert.equal(helper.exitCode, null)
    second.kill()
    await second.done
    await f.exited(helper)
  })

  await t.test('explicit plugin stop exits even while the owner process is still alive', async (t) => {
    const f = await fixture(t)
    const owner = await f.owner()
    f.publish(owner)
    const helper = await f.watchdog()
    fs.writeFileSync(f.stop, JSON.stringify({ stoppedAt: Date.now() }))
    await f.exited(helper)
    assert.equal(owner.exitCode, null)
  })

  await t.test('missing or corrupt ownership records cannot leave a frozen tray indefinitely', async (t) => {
    const f = await fixture(t)
    fs.writeFileSync(f.scheduler, '{broken')
    const helper = await f.watchdog()
    await f.exited(helper)
  })
})
