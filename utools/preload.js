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
  a_computer: {
    prod: { height: 860, width: 1380, backgroundColor: 1 },
    dev: { height: 900, width: 1440, backgroundColor: 1 },
  },
  a_specs_lite: {
    prod: { height: 640, width: 960, backgroundColor: 1 },
    dev: { height: 660, width: 1000, backgroundColor: 1 },
  },
}

function openPresetWindow(name) {
  const presetGroup = windowPresets[name] || {}
  const preset = runtimeUtools.isDev() ? presetGroup.dev || presetGroup.prod : presetGroup.prod || presetGroup.dev

  if (!preset) {
    window.services.createWindow(name)
    runtimeUtools.outPlugin()
    return
  }

  window.services.createWindow(name, preset.height, preset.width, preset.backgroundColor)
  runtimeUtools.outPlugin()
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
        openPresetWindow('a_watch')
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
