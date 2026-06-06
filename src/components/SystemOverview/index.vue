<script setup lang="ts">
import { BatteryFull, Bluetooth, Computer, Music, Printer, Thermometer, Usb, Wifi } from '@icon-park/vue-next'
import { computed } from 'vue'

const props = defineProps<{
  loading?: boolean
  temperature?: CpuTemperatureData
  cpuPower?: CpuPowerData
  battery?: BatteryInfoData
  osInfo?: OsInfoData
  usbDevices?: UsbDeviceData[]
  audioDevices?: AudioDeviceData[]
  bluetoothDevices?: BluetoothDeviceData[]
  printerInfo?: PrinterInfoData[]
  wifiInterfaces?: WifiInterfaceData[]
  wifiConnections?: WifiConnectionData[]
}>()

const cpuTemperature = computed(() => {
  const main = props.temperature?.main
  return typeof main === 'number' && main > 0 ? `${main.toFixed(1)} ℃` : '未暴露'
})

const cpuTemperatureMeta = computed(() => {
  if (!props.temperature?.source) return ''
  if (props.temperature.source === 'systeminformation') return '系统传感器'
  return props.temperature.sensorName ? `${props.temperature.source} / ${props.temperature.sensorName}` : props.temperature.source
})

const cpuPower = computed(() => {
  const value = props.cpuPower?.value
  return typeof value === 'number' && value > 0 ? `${value.toFixed(1)} W` : '未暴露'
})

const cpuPowerMeta = computed(() => {
  if (!props.cpuPower?.source) return ''
  return props.cpuPower.sensorName ? `${props.cpuPower.source} / ${props.cpuPower.sensorName}` : props.cpuPower.source
})

const batteryStatus = computed(() => {
  if (!props.battery?.hasBattery) return '未检测到'
  const percent = typeof props.battery.percent === 'number' ? `${Math.round(props.battery.percent)}%` : '未知'
  return props.battery.isCharging ? `${percent} 充电中` : percent
})

const osLabel = computed(() => {
  const distro = props.osInfo?.distro || props.osInfo?.platform || '未知系统'
  const release = props.osInfo?.release ? ` ${props.osInfo.release}` : ''
  return `${distro}${release}`
})

const wifiStatus = computed(() => {
  const connectionCount = props.wifiConnections?.length || 0
  const interfaceCount = props.wifiInterfaces?.length || 0

  if (connectionCount > 0) return `${connectionCount} 个连接`
  if (interfaceCount > 0) return `${interfaceCount} 个接口`
  return '未检测到'
})

const overviewItems = computed(() => [
  {
    label: 'CPU 温度',
    value: cpuTemperature.value,
    icon: Thermometer,
    tone: 'thermal',
  },
  {
    label: 'CPU 功耗',
    value: cpuPower.value,
    icon: BatteryFull,
    tone: 'power',
  },
  {
    label: '电池',
    value: batteryStatus.value,
    icon: BatteryFull,
    tone: 'power',
  },
  {
    label: '系统',
    value: osLabel.value,
    icon: Computer,
    tone: 'system',
  },
  {
    label: 'USB',
    value: `${props.usbDevices?.length || 0} 个设备`,
    icon: Usb,
    tone: 'device',
  },
  {
    label: '音频',
    value: `${props.audioDevices?.length || 0} 个设备`,
    icon: Music,
    tone: 'audio',
  },
  {
    label: '蓝牙',
    value: `${props.bluetoothDevices?.length || 0} 个设备`,
    icon: Bluetooth,
    tone: 'radio',
  },
  {
    label: '打印机',
    value: `${props.printerInfo?.length || 0} 台`,
    icon: Printer,
    tone: 'print',
  },
  {
    label: 'Wi-Fi',
    value: wifiStatus.value,
    icon: Wifi,
    tone: 'network',
  },
])

const hasPeripheralDetails = computed(() => {
  return Boolean(
    props.usbDevices?.length ||
      props.audioDevices?.length ||
      props.bluetoothDevices?.length ||
      props.printerInfo?.length ||
      props.wifiInterfaces?.length ||
      props.wifiConnections?.length
  )
})

function fallback(value: string | number | boolean | null | undefined, emptyText = '未知') {
  if (value === undefined || value === null || value === '') return emptyText
  return String(value)
}

function deviceTitle(primary: string | undefined, secondary?: string) {
  if (primary) return primary
  return secondary || '未知设备'
}

function joinMeta(items: Array<string | number | boolean | null | undefined>) {
  return items
    .map((item) => fallback(item, ''))
    .filter(Boolean)
    .join(' / ')
}

function formatBoolean(value: boolean | undefined, trueText: string, falseText: string) {
  if (value === undefined) return '未知'
  return value ? trueText : falseText
}
</script>

<template>
  <div class="system-overview">
    <div class="overview-head">
      <CardHeader :icon="Computer" title="系统概览" />
      <span v-if="loading" class="subtle-state">外设同步中</span>
    </div>

    <div class="overview-grid">
      <div v-for="item in overviewItems" :key="item.label" :class="['overview-item', item.tone]">
        <div class="icon-shell">
          <component :is="item.icon" theme="outline" size="18" fill="currentColor" :strokeWidth="3" />
        </div>
        <div class="item-content">
          <div class="label">{{ item.label }}</div>
          <div class="value">{{ item.value }}</div>
        </div>
      </div>
    </div>

    <div v-if="cpuTemperatureMeta" class="sensor-source">CPU 温度来源：{{ cpuTemperatureMeta }}</div>
    <div v-if="cpuPowerMeta" class="sensor-source">CPU 功耗来源：{{ cpuPowerMeta }}</div>

    <el-collapse v-if="hasPeripheralDetails" class="device-details">
      <el-collapse-item title="外设详情">
        <div class="detail-section" v-if="wifiConnections?.length || wifiInterfaces?.length">
          <div class="detail-title">Wi-Fi</div>
          <div v-for="item in wifiConnections" :key="`wifi-connection-${item.id || item.iface}`" class="detail-row">
            <div class="detail-name">{{ deviceTitle(item.ssid, item.iface) }}</div>
            <div class="detail-meta">{{ joinMeta([item.iface, item.security, `${item.quality}%`, `${item.txRate} Mbps`]) }}</div>
          </div>
          <div v-for="item in wifiInterfaces" :key="`wifi-interface-${item.id || item.iface}`" class="detail-row muted-row">
            <div class="detail-name">{{ deviceTitle(item.model, item.iface) }}</div>
            <div class="detail-meta">{{ joinMeta([item.vendor, item.iface, item.mac]) }}</div>
          </div>
        </div>

        <div class="detail-section" v-if="usbDevices?.length">
          <div class="detail-title">USB</div>
          <div v-for="item in usbDevices" :key="`usb-${item.id}-${item.deviceId}`" class="detail-row">
            <div class="detail-name">{{ deviceTitle(item.name, item.manufacturer) }}</div>
            <div class="detail-meta">{{ joinMeta([item.manufacturer || item.vendor, item.type, formatBoolean(item.removable, '可移除', '固定设备')]) }}</div>
          </div>
        </div>

        <div class="detail-section" v-if="audioDevices?.length">
          <div class="detail-title">音频</div>
          <div v-for="item in audioDevices" :key="`audio-${item.id}`" class="detail-row">
            <div class="detail-name">{{ deviceTitle(item.name, item.manufacturer) }}</div>
            <div class="detail-meta">{{ joinMeta([item.manufacturer, item.type, item.in ? '输入' : '', item.out ? '输出' : '', item.default ? '默认' : '']) }}</div>
          </div>
        </div>

        <div class="detail-section" v-if="bluetoothDevices?.length">
          <div class="detail-title">蓝牙</div>
          <div v-for="item in bluetoothDevices" :key="`bluetooth-${item.macDevice || item.name}`" class="detail-row">
            <div class="detail-name">{{ deviceTitle(item.name, item.device) }}</div>
            <div class="detail-meta">
              {{ joinMeta([item.manufacturer, item.type, formatBoolean(item.connected, '已连接', '未连接'), item.batteryPercent ? `${item.batteryPercent}%` : '']) }}
            </div>
          </div>
        </div>

        <div class="detail-section" v-if="printerInfo?.length">
          <div class="detail-title">打印机</div>
          <div v-for="item in printerInfo" :key="`printer-${item.id}-${item.name}`" class="detail-row">
            <div class="detail-name">{{ deviceTitle(item.name, item.model) }}</div>
            <div class="detail-meta">{{ joinMeta([item.model, item.status, item.default ? '默认' : '', item.local ? '本地' : '网络']) }}</div>
          </div>
        </div>
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<style scoped lang="less">
.system-overview {
  .overview-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 2px;
  }

  :deep(.card-header) {
    margin-bottom: 12px;
  }

  .subtle-state {
    flex: 0 0 auto;
    margin-bottom: 12px;
    color: #ff6b6b;
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .overview-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .overview-item {
    display: flex;
    align-items: center;
    min-width: 0;
    padding: 11px;
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 6px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.015)),
      #111722;
    color: #ff3f3f;
    box-shadow: inset 3px 0 0 currentColor;

    &.thermal {
      color: #ff3636;
      background: linear-gradient(180deg, rgba(255, 54, 54, 0.16), rgba(255, 54, 54, 0.035));
    }

    &.power {
      color: #8fff65;
      background: linear-gradient(180deg, rgba(143, 255, 101, 0.12), rgba(143, 255, 101, 0.025));
    }

    &.system {
      color: #dce3ee;
      background: linear-gradient(180deg, rgba(220, 227, 238, 0.1), rgba(220, 227, 238, 0.018));
    }

    &.device {
      color: #42d7ff;
      background: linear-gradient(180deg, rgba(66, 215, 255, 0.12), rgba(66, 215, 255, 0.025));
    }

    &.audio {
      color: #c084fc;
      background: linear-gradient(180deg, rgba(192, 132, 252, 0.12), rgba(192, 132, 252, 0.025));
    }

    &.radio {
      color: #2dd4bf;
      background: linear-gradient(180deg, rgba(45, 212, 191, 0.12), rgba(45, 212, 191, 0.025));
    }

    &.print {
      color: #cbd5e1;
      background: linear-gradient(180deg, rgba(203, 213, 225, 0.1), rgba(203, 213, 225, 0.018));
    }

    &.network {
      color: #60a5fa;
      background: linear-gradient(180deg, rgba(96, 165, 250, 0.12), rgba(96, 165, 250, 0.025));
    }
  }

  .icon-shell {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 32px;
    height: 32px;
    margin-right: 10px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.22);
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.06),
      0 0 14px color-mix(in srgb, currentColor 26%, transparent);
  }

  .item-content {
    min-width: 0;
  }

  .label {
    margin-bottom: 4px;
    color: #7f8b9d !important;
    font-size: 12px;
    font-weight: 800;
    line-height: 1.2;
    text-transform: uppercase;
  }

  .value {
    overflow: hidden;
    color: #f7f9fc;
    font-family: 'SF Mono', Consolas, 'Cascadia Mono', monospace;
    font-size: 15px;
    font-weight: 850;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .device-details {
    margin-top: 14px;
  }

  .sensor-source {
    margin-top: 10px;
    padding-left: 10px;
    border-left: 2px solid rgba(255, 45, 45, 0.55);
    color: #8d98a8;
    font-size: 12px;
    line-height: 1.4;
  }

  .detail-section {
    &:not(:last-child) {
      margin-bottom: 14px;
      padding-bottom: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
  }

  .detail-title {
    margin-bottom: 8px;
    color: #ff5a5a;
    font-size: 13px;
    font-weight: 850;
    text-transform: uppercase;
  }

  .detail-row {
    min-width: 0;
    padding: 8px 0;

    &:not(:last-child) {
      border-bottom: 1px dashed rgba(255, 255, 255, 0.08);
    }
  }

  .muted-row {
    opacity: 0.8;
  }

  .detail-name {
    overflow: hidden;
    color: #eef3fa;
    font-size: 13px;
    font-weight: 750;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .detail-meta {
    margin-top: 3px;
    overflow: hidden;
    color: #8d98a8;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 420px) {
    .overview-grid {
      grid-template-columns: 1fr;
    }
  }
}
</style>
