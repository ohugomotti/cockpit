'use strict';
if (require.main === module) return; // FIXTURE: lida como TEXTO pelo inventario.cjs; nunca roda

/* FIXTURE: aqui o Electron NÃO vem de require('electron'): chega por PARÂMETRO, o jeito de
   src/cockpit-ipc-security.js (ipcMain: nativeIpc), src/cockpit-experiments.js (safeStorage)
   e src/visual-mac-native.js (nativeTheme). O inventário tem que reconhecer os três. */
function criarExemplo({ ipcMain: nativeIpc, safeStorage, nativeTheme, getJanela }) {
  nativeIpc.handle('exemplo:ping', () => 'pong'); // @ping
  const cifrado = safeStorage.encryptString('segredo'); // @cifrar
  const escuro = nativeTheme.shouldUseDarkColors; // @escuro
  if (getJanela()) nativeTheme.themeSource = escuro ? 'dark' : 'light'; // @escrita
  return { cifrado };
}

module.exports = { criarExemplo };
