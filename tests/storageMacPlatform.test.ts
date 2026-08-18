import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getDisplayStorageVolumes,
  getPhysicalDiskLayout,
  getPhysicalDiskTotalBytes,
  getStorageUsageSummary,
  hasDiskHealthTelemetry,
} from '../src/utils'

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

test('computes macOS storage usage from deduplicated visible volumes when physical layout is unavailable', () => {
  const usage = getStorageUsageSummary(sampleMacFsSize, [], 'darwin')

  assert.equal(usage.total, 1245102325760)
  assert.equal(usage.used, 601633316864)
  assert.equal(usage.percent, 48.3)
})

test('prefers deduplicated physical disk capacity for macOS total storage while keeping mounted-volume usage', () => {
  const disks = [
    {
      device: 'disk0',
      name: 'APPLE SSD AP0256Z',
      size: 251000193024,
      type: 'NVMe',
      interfaceType: 'PCIe',
      serialNum: 'APPLE-SERIAL',
    },
    {
      device: 'disk4',
      name: 'Seagate ZP1000GV30012',
      size: 1000204886016,
      type: 'NVMe',
      interfaceType: 'PCIe x4',
      serialNum: 'D2B00PKR',
      firmwareRevision: 'SUKSY000',
      smartData: { device: { type: 'nvme', protocol: 'NVMe' } },
    },
    {
      device: 'disk5',
      name: 'Seagate ZP1000GV30012',
      size: 999995129856,
      type: 'PCI-Express',
      interfaceType: 'PCI-Express',
      serialNum: '',
      firmwareRevision: '',
      smartData: { device: { type: 'nvme', protocol: 'NVMe' } },
    },
  ] as DiskLayoutData[]

  const usage = getStorageUsageSummary(sampleMacFsSize, disks, 'darwin')

  assert.equal(usage.total, 1251205079040)
  assert.equal(usage.used, 601633316864)
  assert.equal(usage.percent, 48.1)
})

test('deduplicates a sparse macOS PCIe mirror of the same physical NVMe disk', () => {
  const disks = [
    {
      device: 'disk0',
      name: 'APPLE SSD AP0256Z',
      vendor: 'Apple',
      size: 251000193024,
      type: 'NVMe',
      interfaceType: 'PCIe',
      serialNum: '0ba0230281d14a2a',
      firmwareRevision: '2032.80.',
      smartData: { device: { type: 'nvme', protocol: 'NVMe' } },
    },
    {
      device: 'disk4',
      name: 'Seagate ZP1000GV30012',
      vendor: '',
      size: 1000204886016,
      type: 'NVMe',
      interfaceType: 'PCIe x4',
      serialNum: 'D2B00PKR',
      firmwareRevision: 'SUKSY000',
      smartData: { device: { type: 'nvme', protocol: 'NVMe' } },
    },
    {
      device: 'disk5',
      name: 'Seagate ZP1000GV30012',
      vendor: '',
      size: 999995129856,
      type: 'PCI-Express',
      interfaceType: 'PCI-Express',
      serialNum: '',
      firmwareRevision: '',
      smartData: { device: { type: 'nvme', protocol: 'NVMe' } },
    },
  ] as DiskLayoutData[]

  const physical = getPhysicalDiskLayout(disks)

  assert.equal(physical.length, 2)
  assert.deepEqual(physical.map((disk) => disk.device), ['disk0', 'disk4'])
  assert.equal(getPhysicalDiskTotalBytes(disks), 1251205079040)
})

test('keeps two same-model physical disks when both expose different serial numbers', () => {
  const disks = [
    {
      device: 'disk4',
      name: 'Seagate ZP1000GV30012',
      size: 1000204886016,
      type: 'NVMe',
      interfaceType: 'PCIe x4',
      serialNum: 'SERIAL-A',
      firmwareRevision: 'SUKSY000',
      smartData: { device: { type: 'nvme', protocol: 'NVMe' } },
    },
    {
      device: 'disk6',
      name: 'Seagate ZP1000GV30012',
      size: 1000204886016,
      type: 'NVMe',
      interfaceType: 'PCIe x4',
      serialNum: 'SERIAL-B',
      firmwareRevision: 'SUKSY000',
      smartData: { device: { type: 'nvme', protocol: 'NVMe' } },
    },
  ] as DiskLayoutData[]

  assert.equal(getPhysicalDiskLayout(disks).length, 2)
})

test('treats missing or placeholder SMART status as unavailable for health display', () => {
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

  assert.equal(
    hasDiskHealthTelemetry({ smartStatus: 'unknown' } as DiskLayoutData),
    false
  )

  assert.equal(
    hasDiskHealthTelemetry({ smartStatus: 'N/A' } as DiskLayoutData),
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
      smartStatus: 'unknown',
      smartData: {
        smart_status: { passed: true },
      },
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
