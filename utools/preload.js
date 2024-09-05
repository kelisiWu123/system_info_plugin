// 您可以在进行窗口交互
// utools文档
import si from 'systeminformation'
// promises style - new since version 3

// https://www.u.tools/docs/developer/api.html#%E7%AA%97%E5%8F%A3%E4%BA%A4%E4%BA%92

  window.services = {
    getCpuInfo: async ()=> {
      try {
        const cpuData = await si.cpu()
        return cpuData
      }catch(e) {
      }
    },
    getNetworkInfo: async ()=> {
      try {
        const [networkInterfaces] = await si.networkStats()
        console.log(networkInterfaces)
        return networkInterfaces;
      }catch (e){

      }

    },
    getMemInfo:async ()=> {
      try {
        const data = await si.mem()
        return data
      }catch (e){
      }
    },
    getMemoryLayout: async () =>{
      try {
        const memoryLayout=  await  si.memLayout()
        return memoryLayout
      }catch (e){

      }

    },
    getGpuInfo: async ()=> {
      try {
        const graphics = await si.graphics()
        const gpu= graphics.controllers.filter((ctr) => {
          return ctr.vram >= 1
        })
        console.log(gpu)
        return gpu
      }catch (e){
      }

    },
    getCpuFullLoad: async ()=> {
      try {
        const current = await si.currentLoad()
        const percent = Math.round(current.currentLoad)
        return percent
      }catch (e){
      }
    },
    getDiskData: async ()=> {
      try {
        const data = await si.diskLayout()
        return data
      }catch (e){

      }
    },
    getBoardData: async() =>{
      try {
        const board = await si.baseboard()
        return board
      }catch (e){
      }
    },

    creatSomething:(fileName,height=300,width = 300)=>{
      const watchWin = utools.createBrowserWindow(`${fileName}/index.html`, {
        title:'watch',
        // height:height,
        // width:width,
        useContentSize: true,
        skipTaskbar: false,
        backgroundColor: 'rgba(255, 255, 255, 0.7)',
        //不能最大最小化
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        //背景透明，防止放大缩小时出现白框})
        transparent: true,
        // backgroundColor: '#424242',
        frame: false,
        alwaysOnTop: false,
        webPreferences: {
          preload: 'preload.js',
          devTools: true
        }
      },()=>{
        watchWin.webContents.openDevTools();
      })
    },
}


window.exports = {
  hardwareWatch: {
    mode: "none",
    args: {
      enter: (action) => {
        console.log(action);
        window.services.creatSomething("a_watch");
        utools.outPlugin();
      },
    },
  },
  hardware: {
    mode: "none",
    args: {
      enter: (action) => {
        console.log(action);
        window.services.creatSomething("a_computer", 600, 450);
        utools.outPlugin();
      },
    },
  },
};

