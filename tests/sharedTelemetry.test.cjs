const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { createSharedTelemetry } = require('../utools/services/sharedTelemetry.cjs')

function harness(t, readers, intervals = { cpuLoad: 1000, memoryUsage: 1000 }, now = Date.now) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-telemetry-test-'))
  const alive = new Set([101, 102, 103])
  const samplers = []
  const create = (pid, overrides = readers) => {
    const sampler = createSharedTelemetry({ directory, pid, readers: overrides, intervals, now, isAlive: (id) => alive.has(id) })
    samplers.push(sampler)
    return sampler
  }
  t.after(() => {
    for (const sampler of samplers) sampler.dispose()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return { create, alive, directory }
}
async function until(predicate) {
  const deadline = Date.now() + 3000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'timed out waiting for a shared commit')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('concurrent windows elect one hardware reader for each metric', async (t) => {
  let reads = 0
  const h = harness(t, { cpuLoad: async () => ({ currentLoad: ++reads, cpus: [] }) })
  const one = h.create(101)
  const two = h.create(102, { cpuLoad: async () => { throw new Error('must not sample locally') } })
  const [a, b] = await Promise.all([one.read('cpuLoad'), two.read('cpuLoad')])
  assert.deepEqual(a, b)
  assert.equal(reads, 1)
})

test('subscribers with different polling phases receive the same committed values', async (t) => {
  let reads = 0
  const h = harness(t, { cpuLoad: async () => ({ currentLoad: ++reads, cpus: [] }) }, { cpuLoad: 250 })
  const a = []
  const b = []
  const one = h.create(101)
  const two = h.create(102)
  const stopOne = one.subscribe(['cpuLoad'], (samples) => { if (samples.cpuLoad) a.push(samples.cpuLoad) })
  await one.read('cpuLoad')
  const stopTwo = two.subscribe(['cpuLoad'], (samples) => { if (samples.cpuLoad) b.push(samples.cpuLoad) })
  await until(() => a.length >= 2 && b.length >= 2)
  assert.equal(a[0].sampleId, b[0].sampleId)
  assert.equal(a[1].sampleId, b[1].sampleId)
  assert.deepEqual(a[1].value, b[1].value)
  stopOne(); stopTwo()
})

test('slow metrics do not block publication or reads of fast metrics', async (t) => {
  let finish
  const h = harness(t, {
    cpuLoad: async () => ({ currentLoad: 35, cpus: [] }),
    memoryUsage: () => new Promise((resolve) => { finish = resolve }),
  })
  const sampler = h.create(101)
  const pending = sampler.read('memoryUsage')
  const cpu = await sampler.read('cpuLoad')
  assert.equal(cpu.currentLoad, 35)
  assert.ok(finish)
  finish({ total: 100, used: 20 })
  assert.equal((await pending).used, 20)
})

test('owner shutdown elects one successor and never mixes old owner snapshots', async (t) => {
  const h = harness(t, { cpuLoad: async () => ({ currentLoad: 10, cpus: [] }) })
  const first = h.create(101)
  assert.equal((await first.read('cpuLoad')).currentLoad, 10)
  first.dispose()
  h.alive.delete(101)
  let successors = 0
  const readers = { cpuLoad: async () => ({ currentLoad: 20 + ++successors, cpus: [] }) }
  const [a, b] = await Promise.all([h.create(102, readers).read('cpuLoad'), h.create(103, readers).read('cpuLoad')])
  assert.equal(a.currentLoad, 21)
  assert.deepEqual(a, b)
  assert.equal(successors, 1)
})

test('a crashed owner is reclaimed while a live owner is never displaced', async (t) => {
  const h = harness(t, { cpuLoad: async () => ({ currentLoad: 10, cpus: [] }) })
  fs.writeFileSync(path.join(h.directory, 'owner.json'), JSON.stringify({ pid: 999, token: 'old' }))
  const a = h.create(101)
  const b = h.create(102)
  assert.deepEqual(await a.read('cpuLoad'), await b.read('cpuLoad'))
  assert.equal(JSON.parse(fs.readFileSync(path.join(h.directory, 'owner.json'))).pid, 101)
})

test('sampling errors are shared and do not start a second independent hardware reader', async (t) => {
  let localReads = 0
  const h = harness(t, { cpuLoad: async () => { throw new Error('sensor failed') } })
  const a = h.create(101)
  const b = h.create(102, { cpuLoad: async () => { localReads++; return {} } })
  await assert.rejects(a.read('cpuLoad'), /sensor failed/)
  await assert.rejects(b.read('cpuLoad'), /sensor failed/)
  assert.equal(localReads, 0)
})

test('an abandoned pending reservation is reclaimed without deleting a fresh reservation', async (t) => {
  const h = harness(t, { cpuLoad: async () => ({ currentLoad: 10, cpus: [] }) })
  const ownerPath = path.join(h.directory, 'owner.json')
  fs.writeFileSync(ownerPath, '')
  fs.utimesSync(ownerPath, new Date(0), new Date(0))
  assert.equal((await h.create(101).read('cpuLoad')).currentLoad, 10)
})

test('real processes share a single sample under concurrent startup', async (t) => {
  const { spawn } = require('node:child_process')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-telemetry-process-'))
  const children = []
  t.after(() => {
    for (const child of children) child.kill()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  const code = `
    const fs = require('node:fs');
    const path = require('node:path');
    const { createSharedTelemetry } = require(process.argv[2]);
    const sampler = createSharedTelemetry({
      directory: process.argv[1], pid: process.pid,
      isAlive: (pid) => { try { process.kill(pid, 0); return true } catch { return false } },
      intervals: { cpuLoad: 5000 },
      readers: { cpuLoad: async () => {
        fs.appendFileSync(path.join(process.argv[1], 'reads.txt'), process.pid + '\\n');
        return { currentLoad: 42, samplerPid: process.pid, cpus: [] };
      } },
    });
    process.stdin.once('data', () => { sampler.dispose(); process.exit(0) });
    sampler.read('cpuLoad').then((value) => process.stdout.write(JSON.stringify(value) + '\\n'));
  `
  const start = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', code, directory, require.resolve('../utools/services/sharedTelemetry.cjs')])
    children.push(child)
    let output = ''
    child.on('error', reject)
    child.on('exit', (status) => { if (!output) reject(new Error(`child exited before a sample: ${status}`)) })
    child.stdout.on('data', (chunk) => {
      output += chunk
      if (output.includes('\n')) resolve(JSON.parse(output.trim()))
    })
  })
  const [one, two] = await Promise.all([start(), start()])
  assert.deepEqual(one, two)
  assert.equal(fs.readFileSync(path.join(directory, 'reads.txt'), 'utf8').trim().split('\n').length, 1)
  await Promise.all(children.map((child) => new Promise((resolve) => {
    child.once('exit', resolve)
    child.stdin.end('done\n')
  })))
})

test('disposing the sampler immediately rejects pending reads', async (t) => {
  const h = harness(t, { cpuLoad: () => new Promise(() => {}) })
  const sampler = h.create(101)
  const pending = sampler.read('cpuLoad')
  sampler.dispose()
  await assert.rejects(pending, /TELEMETRY_STOPPED/)
})

test('waiting reads time out without creating another hardware sampler', async (t) => {
  let reads = 0
  const h = harness(t, { cpuLoad: () => { reads++; return new Promise(() => {}) } })
  await assert.rejects(h.create(101).read('cpuLoad', 20), /TELEMETRY_UNAVAILABLE/)
  assert.equal(reads, 1)
})

test('readers cannot mutate the cached snapshot seen by another consumer', async (t) => {
  const h = harness(t, { cpuLoad: async () => ({ currentLoad: 35, cpus: [{ load: 35 }] }) })
  const sampler = h.create(101)
  const first = await sampler.read('cpuLoad')
  first.currentLoad = 99
  first.cpus[0].load = 99
  const second = await sampler.read('cpuLoad')
  assert.equal(second.currentLoad, 35)
  assert.equal(second.cpus[0].load, 35)
})

test('an unrelated metric commit does not notify a CPU-only subscriber again', async (t) => {
  const h = harness(t, {
    cpuLoad: async () => ({ currentLoad: 35, cpus: [] }),
    memoryUsage: async () => ({ total: 100, used: 20 }),
  })
  const sampler = h.create(101)
  let notifications = 0
  const stop = sampler.subscribe(['cpuLoad'], () => { notifications++ })
  await sampler.read('cpuLoad')
  const before = notifications
  await sampler.read('memoryUsage')
  assert.equal(notifications, before)
  stop()
})

test('a sampling profile change updates the owner schedule without creating another sampler', async (t) => {
  let clock = 1000
  let interval = 10000
  let reads = 0
  const h = harness(t, { cpuLoad: async () => ({ currentLoad: ++reads, cpus: [] }) }, () => ({ cpuLoad: interval }), () => clock)
  const sampler = h.create(101)
  await sampler.read('cpuLoad')
  clock += 2000
  sampler.setBackground(false)
  assert.equal(reads, 1, 'the old slow schedule is respected')
  interval = 1000
  sampler.setBackground(false)
  await until(() => reads === 2)
  assert.equal((await sampler.read('cpuLoad')).currentLoad, 2)
})

test('CPU sampling pauses when every consumer is hidden and resumes for a visible peer', async (t) => {
  let clock = 1000
  let reads = 0
  const h = harness(t, { cpuLoad: async () => ({ currentLoad: ++reads, cpus: [] }) },
    () => ({ cpuLoad: 1000, background: { cpuLoad: 0 } }), () => clock)
  const owner = h.create(101)
  await owner.read('cpuLoad')
  owner.setBackground(true)
  clock += 2000
  owner.setBackground(true)
  assert.equal(reads, 1)
  const visible = h.create(102)
  const peerValues = []
  const stop = visible.subscribe(['cpuLoad'], (records) => { if (records.cpuLoad) peerValues.push(records.cpuLoad.value.currentLoad) })
  clock += 2000
  owner.setBackground(true)
  await until(() => reads === 2 && peerValues.includes(2))
  assert.equal((await visible.read('cpuLoad')).currentLoad, 2)
  stop()
})

test('a tray subscriber keeps its metric live while the hosting page is hidden', async (t) => {
  let clock = 1000
  let reads = 0
  const h = harness(t, { cpuLoad: async () => ({ currentLoad: ++reads, cpus: [] }) },
    () => ({ cpuLoad: 1000, background: { cpuLoad: 0 } }), () => clock)
  const sampler = h.create(101)
  const stop = sampler.subscribe(['cpuLoad'], () => {}, { foreground: true })
  await sampler.read('cpuLoad')
  clock += 2000
  sampler.setBackground(true)
  await until(() => reads === 2)
  stop()
})

test('a stalled sample becomes stale without losing the last value and recovers on the next commit', async (t) => {
  let clock = 1000
  let stalled = false
  let interval = 1000
  let finish
  const statuses = []
  const h = harness(t, { cpuLoad: () => stalled
    ? new Promise((resolve) => { finish = resolve }) : Promise.resolve({ currentLoad: 35, cpus: [] }) },
    () => ({ cpuLoad: interval }), () => clock)
  const sampler = h.create(101)
  const stop = sampler.subscribe(['cpuLoad'], (records) => { if (records.cpuLoad) statuses.push(records.cpuLoad) })
  await sampler.read('cpuLoad')
  stalled = true
  clock += 20000
  sampler.setBackground(false)
  await until(() => statuses.some((record) => record.status === 'stale'))
  assert.equal(statuses.at(-1).value.currentLoad, 35)
  interval = 60000
  sampler.setBackground(false)
  assert.equal(statuses.at(-1).status, 'stale', 'a slower profile is not a successful new sample')
  finish({ currentLoad: 40, cpus: [] })
  await until(() => statuses.at(-1).status === 'ok' && statuses.at(-1).value.currentLoad === 40)
  stop()
})

test('manual refresh bypasses the normal sampling interval and publishes a new shared sample', async (t) => {
  let reads = 0
  const h = harness(t, { cpuLoad: async () => ({ currentLoad: ++reads, cpus: [] }) }, { cpuLoad: 60000 })
  const sampler = h.create(101)
  assert.equal((await sampler.read('cpuLoad')).currentLoad, 1)
  await sampler.refresh(['cpuLoad'])
  assert.equal((await sampler.read('cpuLoad')).currentLoad, 2)
  assert.equal(reads, 2)
})

test('concurrent peer refresh requests are all acknowledged by the elected sampler', async (t) => {
  let reads = 0
  const h = harness(t, { cpuLoad: async () => ({ currentLoad: ++reads, cpus: [] }) }, { cpuLoad: 60000 })
  const owner = h.create(101)
  const peer = h.create(102)
  await owner.read('cpuLoad')
  await Promise.all([peer.refresh(['cpuLoad']), peer.refresh(['cpuLoad'])])
  assert.equal((await peer.read('cpuLoad')).currentLoad, 2)
  assert.equal(reads, 2)
})
