// 您可以在进行窗口交互
// utools文档
import si from 'systeminformation'
// promises style - new since version 3


// https://www.u.tools/docs/developer/api.html#%E7%AA%97%E5%8F%A3%E4%BA%A4%E4%BA%92
  window.services = {
    getCpuInfo: async function getCpuInfo() {
      try {
        const cpuData = await si.cpu()
        const fsSize = await si.fsSize()
        console.log(fsSize,'fsSize')
        return cpuData
      }catch(e) {
        // console.error("Error getCpuInfo:");
      }
    },
    getMemInfo: async function getMemInfo() {
      try {
        const data = await si.mem()
        console.log('Memory Usage:')
        console.log(data)
        return data
      }catch (e){
        console.error("Error getMemInfo:");
      }
    },
    getMemoryLayout: async function getMemoryLayout() {
      try {
        const memoryLayout=  await  si.memLayout()
        console.log(memoryLayout,'memoryLayout')
        return memoryLayout
      }catch (e){
        console.error("Error getMemoryLayout:");
      }

    },
    getGpuInfo: async function getGpuInfo() {
      try {
        const graphics = await si.graphics()
        const [gpu] = graphics.controllers.filter((ctr) => {
          return ctr.vram > 1
        })
        return gpu
      }catch (e){
        console.error("Error getGpuInfo:");
      }

    },
    getCpuFullLoad: async function getCpuFullLoad() {
      try {
        const data = await si.currentLoad()
        return data.currentLoad.toFixed(2)
      }catch (e){
        console.error("Error getCpuFullLoad:");
      }
    },
    getDiskData: async function getDiskData() {
      try {
        const data = await si.diskLayout()
        return data
      }catch (e){
        console.error('Error getDiskData:')
      }
    },
    getBoardData: async function getBoardData() {
      try {
        const board = await si.baseboard()
        return board
      }catch (e){
        console.error('Error getBoardData:')
      }

    }
}
