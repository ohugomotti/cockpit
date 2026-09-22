const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('terminalQA',{run:o=>ipcRenderer.invoke('qa:run',o),input:o=>ipcRenderer.invoke('qa:input',o),kill:o=>ipcRenderer.invoke('qa:kill',o),onEvent:fn=>ipcRenderer.on('qa:event',(_e,x)=>fn(x))});
