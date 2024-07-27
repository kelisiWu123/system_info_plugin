// 您可以在进行窗口交互
// utools文档
import si from 'systeminformation'
// promises style - new since version 3

// https://www.u.tools/docs/developer/api.html#%E7%AA%97%E5%8F%A3%E4%BA%A4%E4%BA%92
  window.services = {
    getCpuInfo: async ()=> {
      try {
        const cpuData = await si.cpu()
        const fsSize = await si.fsSize()
        console.log(fsSize,'fsSize')
        return cpuData
      }catch(e) {
        // console.error("Error getCpuInfo:");
      }
    },
    getMemInfo:async ()=> {
      try {
        const data = await si.mem()
        console.log('Memory Usage:')
        console.log(data)
        return data
      }catch (e){
        console.error("Error getMemInfo:");
      }
    },
    getMemoryLayout: async () =>{
      try {
        const memoryLayout=  await  si.memLayout()
        console.log(memoryLayout,'memoryLayout')
        return memoryLayout
      }catch (e){
        console.error("Error getMemoryLayout:");
      }

    },
    getGpuInfo: async ()=> {
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
    getCpuFullLoad: async ()=> {
      try {
        const data = await si.currentLoad()
        return data.currentLoad.toFixed(2)
      }catch (e){
        console.error("Error getCpuFullLoad:");
      }
    },
    getDiskData: async ()=> {
      try {
        const data = await si.diskLayout()
        return data
      }catch (e){
        console.error('Error getDiskData:')
      }
    },
    getBoardData: async() =>{
      try {
        const board = await si.baseboard()
        return board
      }catch (e){
        console.error('Error getBoardData:')
      }
    },
    creatSomething:()=>{
      utools.createBrowserWindow('test.html', {
        height: 300, width: 300,
        skipTaskbar: true,
        // backgroundColor: 'rgba(255, 255, 255, 0.5)',
        //不能最大最小化
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        //背景透明，防止放大缩小时出现白框})
        transparent: true,
        backgroundColor: 'rgba(255, 255, 255, 0.5)',
        frame: false,
        alwaysOnTop: false,
      })
    },

}
