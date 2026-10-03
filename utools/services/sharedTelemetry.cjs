const fs = require('node:fs')
const path = require('node:path')

/** One elected sampler per plugin runtime, shared by every renderer and the tray. */
function createSharedTelemetry({ directory, pid, isAlive, readers, intervals, now = Date.now, initialBackground = false }) {
  fs.mkdirSync(directory, { recursive: true })
  const token = `${pid}-${now()}-${Math.random().toString(36).slice(2)}`
  const ownerPath = path.join(directory, 'owner.json')
  const recoveryPath = path.join(directory, 'recovery.lock')
  const snapshotPath = path.join(directory, 'snapshot.json')
  const demandPath = path.join(directory, `demand-${token}.json`)
  const listeners = new Map()
  const requestedUntil = new Map()
  const pending = new Map()
  const waiters = new Map()
  const refreshRequests = new Map()
  let refreshIdsCache = new Map()
  let refreshSequence = 0
  const jsonCache = new Map()
  let cachedSnapshot = null
  let snapshotCheckedAt = -Infinity
  let requestedKeysCache = new Map()
  let background = Boolean(initialBackground)
  let intervalValues = typeof intervals === 'function' ? intervals() : intervals
  let requestedKeysCheckedAt = -Infinity
  let demandsChanged = true
  let samples = {}
  let sequence = 0
  let lastDemandAt = 0
  let lastDemandKeys = ''
  let disposed = false

  function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
  }
  function writeJson(file, value) {
    const temporary = `${file}.${token}.tmp`
    try {
      fs.writeFileSync(temporary, JSON.stringify(value))
      fs.renameSync(temporary, file)
    } finally {
      try { fs.unlinkSync(temporary) } catch { /* Already renamed. */ }
    }
  }
  function readCachedJson(file) {
    try {
      const stat = fs.statSync(file)
      const signature = `${stat.ino}:${stat.mtimeMs}:${stat.size}`
      const cached = jsonCache.get(file)
      if (cached?.signature === signature) return cached.value
      const value = readJson(file)
      jsonCache.set(file, { signature, value })
      return value
    } catch {
      jsonCache.delete(file)
      return null
    }
  }
  function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)) }
  function isOwner() { return readJson(ownerPath)?.token === token }
  function elect() {
    const owner = readJson(ownerPath)
    if (owner?.token === token) return true
    if (owner && isAlive(owner.pid)) return false
    let recovery
    let staleReservation = false
    try {
      staleReservation = !owner && now() - fs.statSync(ownerPath).mtimeMs > 10000
    } catch { /* No reservation yet. */ }
    try {
      if (owner || staleReservation) {
        // Serialize stale eviction so two successors cannot unlink each other's reservation.
        recovery = fs.openSync(recoveryPath, 'wx')
        fs.writeFileSync(recovery, JSON.stringify({ pid }))
        const latest = readJson(ownerPath)
        if (latest && isAlive(latest.pid)) return false
        if (latest || staleReservation) fs.unlinkSync(ownerPath)
      }
      const fd = fs.openSync(ownerPath, 'wx')
      try { fs.writeFileSync(fd, JSON.stringify({ pid, token })) } finally { fs.closeSync(fd) }
      samples = {}
      cachedSnapshot = null
      snapshotCheckedAt = -Infinity
      demandsChanged = true
      return true
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const recoveryOwner = readJson(recoveryPath)
      if (recoveryOwner && !isAlive(recoveryOwner.pid)) {
        try { fs.unlinkSync(recoveryPath) } catch { /* Another successor reclaimed it. */ }
      }
      return false
    } finally {
      if (recovery !== undefined) {
        fs.closeSync(recovery)
        try { fs.unlinkSync(recoveryPath) } catch { /* Concurrent shutdown. */ }
      }
    }
  }
  function demand() {
    const keys = new Set()
    const foregroundKeys = new Set()
    for (const entry of listeners.values()) for (const key of entry.keys) {
      keys.add(key)
      if (entry.foreground || !background) foregroundKeys.add(key)
    }
    for (const [key, until] of requestedUntil) {
      if (until > now()) { keys.add(key); if (!background) foregroundKeys.add(key) }
      else requestedUntil.delete(key)
    }
    const forceRequests = Object.fromEntries([...refreshRequests].map(([key, ids]) => [key, [...ids]]))
    const signature = `${[...keys].sort().join(',')}|${[...foregroundKeys].sort().join(',')}|${JSON.stringify(forceRequests)}`
    if (signature === lastDemandKeys && now() - lastDemandAt < 10000) return
    writeJson(demandPath, { pid, keys: [...keys], foregroundKeys: [...foregroundKeys], forceRequests, expiresAt: now() + 45000 })
    demandsChanged = true
    lastDemandAt = now()
    lastDemandKeys = signature
  }
  function requestedKeys() {
    if (!demandsChanged && now() - requestedKeysCheckedAt < 1000) return requestedKeysCache
    demandsChanged = false
    requestedKeysCheckedAt = now()
    const keys = new Map()
    refreshIdsCache = new Map()
    for (const file of fs.readdirSync(directory)) {
      if (!file.startsWith('demand-') || !file.endsWith('.json')) continue
      const record = readJson(path.join(directory, file))
      if (!record || record.expiresAt <= now() || !isAlive(record.pid)) {
        try { fs.unlinkSync(path.join(directory, file)) } catch { /* Concurrent disposal. */ }
        continue
      }
      for (const key of record.keys || []) if (readers[key]) {
        const hidden = Array.isArray(record.foregroundKeys) ? !record.foregroundKeys.includes(key) : false
        keys.set(key, keys.has(key) ? keys.get(key) && hidden : hidden)
        if (Array.isArray(record.forceRequests?.[key])) {
          if (!refreshIdsCache.has(key)) refreshIdsCache.set(key, new Set())
          for (const id of record.forceRequests[key]) if (typeof id === 'string') refreshIdsCache.get(key).add(id)
        }
      }
    }
    requestedKeysCache = keys
    return keys
  }
  function current(force = false) {
    if (!force && now() - snapshotCheckedAt < 250) {
      const owner = readCachedJson(ownerPath)
      if (owner && owner.token === cachedSnapshot?.token && isAlive(owner.pid)) return cachedSnapshot
      if (!cachedSnapshot && owner) return null
    }
    snapshotCheckedAt = now()
    const owner = readCachedJson(ownerPath)
    const snapshot = readCachedJson(snapshotPath)
    const valid = snapshot && typeof snapshot.revision === 'string'
      && snapshot.samples && typeof snapshot.samples === 'object' && !Array.isArray(snapshot.samples)
    cachedSnapshot = owner && isAlive(owner.pid) && valid && snapshot.token === owner.token ? snapshot : null
    return cachedSnapshot
  }
  function intervalFor(key) {
    const values = requestedKeysCache.get(key) && intervalValues.background ? intervalValues.background : intervalValues
    return values[key] ?? 5000
  }
  function freshRecord(snapshot, key) {
    const record = snapshot?.samples[key]
    const age = now() - record?.checkedAt
    return record && ['ok', 'error'].includes(record.status) && Number.isFinite(age) && age >= 0
      && age < Math.max(10000, intervalFor(key) * 3) ? record : null
  }
  function resolveWaiters(snapshot) {
    for (const [key, waiting] of waiters) {
      const record = freshRecord(snapshot, key)
      if (!record) continue
      for (const waiter of waiting) {
        if (waiter.requestId && !record.requestIds?.includes(waiter.requestId)) continue
        waiting.delete(waiter)
        clearTimeout(waiter.timer)
        if (record.status === 'error') waiter.reject(new Error(record.error))
        else waiter.resolve(clone(record.value))
      }
      if (!waiting.size) waiters.delete(key)
    }
  }
  function selectForListener(snapshot, entry) {
    return Object.fromEntries(entry.keys.filter((key) => snapshot.samples[key]).map((key) => {
      const record = snapshot.samples[key]
      const paused = background && !entry.foreground
      const wasStale = entry.versions.get(key) === `${record.sampleId}:stale`
      const stale = record.status === 'ok' && (wasStale || (!paused && !freshRecord(snapshot, key)))
      return [key, stale ? { ...record, status: 'stale', error: '数据暂未更新，显示上次读数', sampleId: `${record.sampleId}:stale` } : record]
    }))
  }
  function notify(force = false) {
    const snapshot = current(force)
    resolveWaiters(snapshot)
    if (!snapshot) return
    for (const entry of listeners.values()) {
      const { listener, versions } = entry
      const selected = selectForListener(snapshot, entry)
      if (!Object.entries(selected).some(([key, record]) => versions.get(key) !== record.sampleId)) continue
      for (const [key, record] of Object.entries(selected)) versions.set(key, record.sampleId)
      try { listener(clone(selected)) } catch (error) { console.warn('[sharedTelemetry] subscriber failed', error) }
    }
  }
  function sample(key) {
    if (pending.has(key)) return pending.get(key)
    const requestIds = [...(refreshIdsCache.get(key) || [])]
    const promise = (async () => {
      let record
      try {
        const value = await readers[key]()
        record = { status: 'ok', value, sampledAt: value?.sampledAt ?? (Array.isArray(value) ? value[0]?.sampledAt : undefined) ?? now(), checkedAt: now() }
      } catch (error) {
        record = { status: 'error', error: error?.message || String(error), value: samples[key]?.value, sampledAt: samples[key]?.sampledAt, checkedAt: now() }
      }
      if (disposed || !isOwner()) return
      record.requestIds = requestIds
      record.sampleId = `${token}:${sequence + 1}`
      samples[key] = record
      const snapshot = { token, revision: `${token}:${++sequence}`, samples: { ...samples } }
      writeJson(snapshotPath, snapshot)
      cachedSnapshot = snapshot
      snapshotCheckedAt = now()
      jsonCache.delete(snapshotPath)
      notify()
    })().finally(() => pending.delete(key))
    pending.set(key, promise)
    return promise
  }
  function tick() {
    if (disposed) return
    try {
      intervalValues = typeof intervals === 'function' ? intervals() : intervals
      demand()
      if (elect()) {
        for (const [key] of requestedKeys()) {
          const interval = intervalFor(key)
          const forced = [...(refreshIdsCache.get(key) || [])].some((id) => !samples[key]?.requestIds?.includes(id))
          if (forced || (interval > 0 && (!samples[key] || now() - samples[key].checkedAt >= interval))) {
            void sample(key).catch((error) => console.warn('[sharedTelemetry] publish failed', error))
          }
        }
      }
      notify()
    } catch (error) { console.warn('[sharedTelemetry] refresh failed', error) }
  }
  let watcher
  try {
    watcher = fs.watch(directory, { persistent: false }, (_, file) => {
      const name = String(file)
      if (name.startsWith('demand-') && name.endsWith('.json')) demandsChanged = true
      if (name === 'snapshot.json' || name === 'owner.json') {
        notify(true)
      }
    })
    watcher.on('error', () => { watcher?.close(); watcher = undefined })
  } catch { /* Polling below also delivers commits when OS watch resources are unavailable. */ }
  const timer = setInterval(tick, 250)
  timer.unref?.()

  async function read(key, timeout = 20000) {
    if (disposed) throw new Error('TELEMETRY_STOPPED')
    if (!readers[key]) throw new Error(`Unknown telemetry metric: ${key}`)
    const firstRequest = !requestedUntil.has(key) || requestedUntil.get(key) <= now()
    requestedUntil.set(key, now() + 60000)
    if (firstRequest) tick()
    const record = freshRecord(current(), key)
    if (record) {
      if (record.status === 'error') throw new Error(record.error)
      return clone(record.value)
    }
    return waitForRecord(key, timeout)
  }
  function waitForRecord(key, timeout, requestId) {
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, requestId, timer: undefined }
      let waiting = waiters.get(key)
      if (!waiting) { waiting = new Set(); waiters.set(key, waiting) }
      waiting.add(waiter)
      waiter.timer = setTimeout(() => {
        waiting.delete(waiter)
        if (!waiting.size) waiters.delete(key)
        reject(new Error(`TELEMETRY_UNAVAILABLE: ${key}`))
      }, timeout)
      notify()
    })
  }
  async function refresh(keys, timeout = 20000) {
    if (disposed) throw new Error('TELEMETRY_STOPPED')
    const requests = [...new Set(keys)].filter((key) => readers[key]).map((key) => {
      const id = `${token}:refresh:${++refreshSequence}`
      if (!refreshRequests.has(key)) refreshRequests.set(key, new Set())
      refreshRequests.get(key).add(id)
      requestedUntil.set(key, now() + 60000)
      return { key, id }
    })
    const waiting = requests.map(({ key, id }) => waitForRecord(key, timeout, id))
    tick()
    try {
      const results = await Promise.allSettled(waiting)
      const failed = results.find((result) => result.status === 'rejected')
      if (failed) throw failed.reason
    } finally {
      for (const { key, id } of requests) {
        const ids = refreshRequests.get(key)
        ids?.delete(id)
        if (!ids?.size) refreshRequests.delete(key)
      }
      if (!disposed) {
        for (const { key } of requests) {
          const used = [...listeners.values()].some((entry) => entry.keys.includes(key))
          if (!used && !waiters.has(key)) requestedUntil.delete(key)
        }
        demand()
      }
    }
  }
  function subscribe(keys, listener, options = {}) {
    notify()
    const id = Symbol()
    const selectedKeys = keys.filter((key) => readers[key])
    const versions = new Map()
    const entry = { keys: selectedKeys, listener, versions, foreground: options.foreground === true }
    listeners.set(id, entry)
    const snapshot = current()
    if (snapshot) {
      const selected = selectForListener(snapshot, entry)
      for (const [key, record] of Object.entries(selected)) versions.set(key, record.sampleId)
      listener(clone(selected))
    }
    tick()
    return () => {
      listeners.delete(id)
      if (disposed) return
      for (const key of selectedKeys) {
        const used = [...listeners.values()].some((entry) => entry.keys.includes(key))
        if (!used && !waiters.has(key)) requestedUntil.delete(key)
      }
      demand()
    }
  }
  function dispose() {
    disposed = true
    clearInterval(timer)
    watcher?.close()
    listeners.clear()
    for (const waiting of waiters.values()) for (const waiter of waiting) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error('TELEMETRY_STOPPED'))
    }
    waiters.clear()
    jsonCache.clear()
    try { fs.unlinkSync(demandPath) } catch { /* Already removed. */ }
    if (isOwner()) try { fs.unlinkSync(ownerPath) } catch { /* Concurrent shutdown. */ }
  }
  function setBackground(value) {
    if (disposed) return
    background = Boolean(value)
    demand()
    tick()
  }
  return { read, refresh, subscribe, dispose, setBackground }
}
module.exports = { createSharedTelemetry }
