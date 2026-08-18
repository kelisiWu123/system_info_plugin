import { getUtoolsPluginRoot, resolveUtoolsRuntime } from './runtime'
import { configureSystemServiceContext, systemService } from './services/system'
import { setupWindowBridge, windowService } from './services/window'

setupWindowBridge()

const runtimeUtools = resolveUtoolsRuntime(typeof utools !== 'undefined' ? utools : undefined)
const pluginRoot = getUtoolsPluginRoot(runtimeUtools, __dirname)

configureSystemServiceContext({
  pluginRoot,
  utools: runtimeUtools,
})

const windowPresets = {
  a_watch: {
    prod: { height: 398, width: 432, backgroundColor: 0 },
    dev: { height: 420, width: 456, backgroundColor: 0 },
  },
  a_watch_super_lite: {
    prod: { height: 200, width: 200, backgroundColor: 0 },
    dev: { height: 200, width: 200, backgroundColor: 0 },
  },
  a_monitor: {
    prod: { height: 820, width: 1180, backgroundColor: 1 },
    dev: { height: 860, width: 1240, backgroundColor: 1 },
  },
  a_computer: {
    prod: { height: 860, width: 1380, backgroundColor: 1 },
    dev: { height: 900, width: 1440, backgroundColor: 1 },
  },
  a_specs_lite: {
    prod: { height: 720, width: 1080, backgroundColor: 1 },
    dev: { height: 760, width: 1120, backgroundColor: 1 },
  },
}

async function openPresetWindow(name) {
  const presetGroup = windowPresets[name] || {}
  const preset = runtimeUtools.isDev() ? presetGroup.dev || presetGroup.prod : presetGroup.prod || presetGroup.dev

  try {
    if (!preset) {
      await window.services.createWindow(name)
      return
    }

    await window.services.createWindow(name, preset.height, preset.width, preset.backgroundColor)
  } finally {
    runtimeUtools.outPlugin()
  }
}

window.services = {
  ...systemService,
  ...windowService,
}

window.exports = {
  hardwareWatch: {
    mode: 'none',
    args: {
      enter: () => {
        openPresetWindow('a_monitor')
      },
    },
  },
  hardwareWatchSuperLite: {
    mode: 'none',
    args: {
      enter: () => {
        openPresetWindow('a_watch_super_lite')
      },
    },
  },
  hardware: {
    mode: 'none',
    args: {
      enter: () => {
        openPresetWindow('a_computer')
      },
    },
  },
  hardwareSpecsLite: {
    mode: 'none',
    args: {
      enter: () => {
        openPresetWindow('a_specs_lite')
      },
    },
  },
}
