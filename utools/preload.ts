// 您可以在进行窗口交互
// utools文档
const si = require('systeminformation')
// promises style - new since version 3

// https://www.u.tools/docs/developer/api.html#%E7%AA%97%E5%8F%A3%E4%BA%A4%E4%BA%92
window.versions = {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron,
}

window.services = {
  getCpuInfo: async function getCpuInfo() {
    const memo = await si.mem()
    const gpu = await si.graphics()
    console.log(gpu)
    console.log(memo)
    const data = await si.currentLoad()
    console.log('CPU Usage:')
    console.log(data)
    return si.cpu().then((data: { brand: string; cores: string; performanceCores: string }) => {
      console.log(data)
      return data
    })
  },
  getMemInfo: async function getMemInfo() {
    const data = await si.mem()
    console.log('Memory Usage:')
    console.log(data)
    return data
  },
}
