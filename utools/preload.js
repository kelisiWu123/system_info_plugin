import path from 'node:path'
import { configureSystemServiceContext, systemService } from './services/system'
import { setupWindowBridge, windowService } from './services/window'

setupWindowBridge()

const pluginRoot = utools.isDev() ? path.resolve(__dirname, '..') : __dirname

configureSystemServiceContext({
  pluginRoot,
  utools,
})

const windowPresets = {
  a_watch: {
    prod: { height: 398, width: 432, backgroundColor: 0 },
    dev: { height: 420, width: 456, backgroundColor: 0 },
  },
  a_computer: {
    prod: { height: 860, width: 1380, backgroundColor: 1 },
    dev: { height: 900, width: 1440, backgroundColor: 1 },
  },
}

function openPresetWindow(name) {
  const presetGroup = windowPresets[name] || {}
  const preset = utools.isDev() ? presetGroup.dev || presetGroup.prod : presetGroup.prod || presetGroup.dev

  if (!preset) {
    window.services.createWindow(name)
    utools.outPlugin()
    return
  }

  window.services.createWindow(name, preset.height, preset.width, preset.backgroundColor)
  utools.outPlugin()
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
  hardware: {
    mode: 'none',
    args: {
      enter: () => {
        openPresetWindow('a_computer')
      },
    },
  },
}
