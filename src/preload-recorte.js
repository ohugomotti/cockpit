/* Ponte minima da janela de recorte de tela: ela so' precisa da foto, de
   devolver o retangulo escolhido e de cancelar. Nada do window.api grande
   entra aqui - esta janela mostra a tela inteira do computador. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('recorte', {
  dados: () => ipcRenderer.invoke('recorte:dados'),
  pronto: (r) => ipcRenderer.invoke('recorte:pronto', r),
  cancelar: () => ipcRenderer.invoke('recorte:cancelar'),
});
