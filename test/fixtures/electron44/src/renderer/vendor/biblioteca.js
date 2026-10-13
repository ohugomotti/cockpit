'use strict';
if (require.main === module) return; // FIXTURE: lida como TEXTO pelo inventario.cjs; nunca roda

/* FIXTURE: biblioteca de terceiros dentro de vendor/. O inventário NÃO pode listar nada
   daqui, mesmo com uso de API do Electron: se aparecer, a exclusão de vendor quebrou. */
const { clipboard } = require('electron');

clipboard.readBookmark(); // @vendor
module.exports = { copiar: (t) => clipboard.writeText(t) };
