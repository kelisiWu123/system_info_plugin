// 您可以在进行窗口交互
// utools文档
import si from 'systeminformation'
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
      console.log(memo, 'memo')


      const data = await si.currentLoad()
      console.log('CPU Usage:', data)

      const sys = await si.osInfo()
      console.log(sys, 'sys')

      const battery = await si.battery()
      const cpuCurrentSpeed = await si.cpuCurrentSpeed()


      const memoryLayout=  await  si.memLayout()
      console.log(memoryLayout,'memoryLayout')
      console.log(cpuCurrentSpeed, 'cpuCurrentSpeed')
      return si.cpu().then((data) => {
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
    getMemoryLayout: async function getMemoryLayout() {
      const memoryLayout=  await  si.memLayout()
      console.log(memoryLayout,'memoryLayout')
      return memoryLayout
    },
    getGpuInfo: async function getGpuInfo() {
      const graphics = await si.graphics()
      const [gpu] = graphics.controllers.filter((ctr) => {
        return ctr.vram > 1
      })
      console.log(gpu)
      return gpu
    },
}
