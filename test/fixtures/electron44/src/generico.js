'use strict';
if (require.main === module) return; // FIXTURE: lida como TEXTO pelo inventario.cjs; nunca roda

/* FIXTURE: "app" e "shell" aqui são objetos do próprio exemplo, não o Electron. Nome genérico
   sozinho (sem ipcMain, Menu, nativeTheme... ao lado) não pode virar uso de API. */
function descrever({ app, shell }) {
  return app.nome + ' ' + shell.tipo; // @generico
}

module.exports = { descrever };
