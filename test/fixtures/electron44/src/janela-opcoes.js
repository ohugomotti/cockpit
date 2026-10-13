'use strict';
if (require.main === module) return; // FIXTURE: lida como TEXTO pelo inventario.cjs; nunca roda

/* FIXTURE: função cujo retorno o new BrowserWindow espalha (...ajudante.opcoesDaJanela()).
   O inventário tem que achar as chaves pelo "options.<chave> =" e pelo "return options",
   como faz com windowOptions() de src/visual-mac-native.js. */
function opcoesDaJanela(plataforma) {
  const options = {};
  if (plataforma === 'win32') {
    options.titleBarStyle = 'hidden';
    options.titleBarOverlay = { color: '#00000000', height: 36 };
    options.backgroundMaterial = 'mica';
  }
  return options;
}

module.exports = { opcoesDaJanela };
