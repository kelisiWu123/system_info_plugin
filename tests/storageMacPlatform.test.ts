import assert from 'node:assert/strict'
import test from 'node:test'

import { getDisplayStorageVolumes, getStorageUsageSummary, hasDiskHealthTelemetry } from '../src/utils'

const sampleMacFsSize = [
  {
    name: '/dev/disk5s2s1',
    fs: '/dev/disk5s2s1',
    type: 'HFS',
    size: 999995129856,
    used: 11154063360,
    available: 386045186048,
    mount: '/',
  },
  {
    name: '/dev/disk5s5',
    fs: '/dev/disk5s5',
    type: 'HFS',
    size: 999995129856,
    used: 2147504128,
    available: 386045186048,
    mount: '/System/Volumes/VM',
  },
  {
    name: '/dev/disk5s3',
    fs: '/dev/disk5s3',
    type: 'HFS',
    size: 999995129856,
    used: 7828717568,
    available: 386045186048,
    mount: '/System/Volumes/Preboot',
  },
  {
    name: '/dev/disk5s1',
    fs: '/dev/disk5s1',
    type: 'HFS',
    size: 999995129856,
    used: 590657085440,
    available: 386045186048,
    mount: '/System/Volumes/Data',
  },
  {
    name: '/dev/disk3s1',
    fs: '/dev/disk3s1',
    type: 'HFS',
    size: 245107195904,
    used: 10976231424,
    available: 105954746368,
    mount: '/Volumes/Macintosh HD',
  },
  {
    name: '/dev/disk5s4',
    fs: '/dev/disk5s4',
    type: 'HFS',
    size: 999995129856,
    used: 1955397632,
    available: 386045186048,
    mount: '/Volumes/Recovery',
  },
] satisfies DiskData[]

test('prefers the macOS Data volume and excludes duplicate APFS helper mounts', () => {
  const volumes = getDisplayStorageVolumes(sampleMacFsSize, 'darwin')

  assert.deepEqual(
    volumes.map((volume) => volume.mount),
    ['/System/Volumes/Data', '/Volumes/Macintosh HD']
  )
})

test('computes macOS storage usage from deduplicated visible volumes', () => {
  const usage = getStorageUsageSummary(sampleMacFsSize, [], 'darwin')

  assert.equal(usage.total, 1245102325760)
  assert.equal(usage.used, 601633316864)
  assert.equal(usage.percent, 48.3)
})

test('treats disks without SMART or NVMe health payload as unsupported for health display', () => {
  assert.equal(
    hasDiskHealthTelemetry({
      device: '/dev/disk0',
      name: 'Apple SSD',
      size: 1000,
      type: 'NVMe',
      interfaceType: 'NVMe',
    } as DiskLayoutData),
    false
  )
})

test('detects disk health support when SMART or NVMe health payload is present', () => {
  assert.equal(
    hasDiskHealthTelemetry({
      smartStatus: 'passed',
    } as DiskLayoutData),
    true
  )

  assert.equal(
    hasDiskHealthTelemetry({
      smartData: {
        nvme_smart_health_information_log: {
          percentage_used: 7,
        },
      },
    } as DiskLayoutData),
    true
  )
})
