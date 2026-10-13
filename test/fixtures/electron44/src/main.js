'use strict';
if (require.main === module) return; // FIXTURE: o inventario.cjs lê este arquivo como TEXTO; ele nunca roda

/* FIXTURE de test/electron44-inventario.test.js.
   Imita o jeito do src/main.js do Cockpit (require('electron') com apelido, clipboard
   com e sem await, catch vazio em volta de API, new BrowserWindow com webPreferences)
   SEM depender do src/ vivo: a leva 1 vai corrigir o colar e trocar os catch por
   logMain, e o teste do inventário não pode quebrar por causa disso.
   Cada linha que o teste confere leva uma marca "@nome" num comentário no fim. */
const path = require('node:path');
const { app, BrowserWindow, ipcMain: ipcPrincipal, dialog, clipboard, nativeTheme } = require('electron');
const ajudante = require('./janela-opcoes');

function logMain() {}

/* ---- colar: o que o Electron 44 quebrou ---- */
function arquivosColados() {
  const achados = [];
  try {
    const buf = clipboard.readBuffer('FileNameW'); // @buffer
    if (buf && buf.length) {
      const s = buf.toString('ucs2').replace(/\0+$/, '').trim();
      if (s) achados.push(s);
    }
  } catch {} // @catch-buffer
  return achados;
}
ipcPrincipal.handle('clipboard:anexos', () => { // @canal-anexos
  const arquivos = arquivosColados();
  if (arquivos.length) return { arquivos };
  try {
    const img = clipboard.readImage(); // @imagem
    if (img && !img.isEmpty()) return { arquivos: [img.toPNG()] }; // @png
  } catch (e) {} // @catch-imagem
  return { arquivos: [] };
});
async function lerTexto() {
  const t = await clipboard.readText(); // @texto-await
  return t || '';
}
function lerTextoSemEsperar() {
  return clipboard.readText(); // @texto-sem-await
}
ipcPrincipal.handle('clipboard:copiar', async (_e, t) => {
  try { await clipboard.writeText(t); return true; } catch (_) { return false; } // @copiar
});

/* ---- aguardado: await antes ou .then( depois ---- */
app.whenReady().then(() => criarJanela()); // @pronto
function salvarSemEsperar(win) {
  return dialog.showSaveDialog(win, { defaultPath: 'imagem.png' }); // @salvar-sem-await
}
async function salvarEsperando(win) {
  const r = await dialog.showSaveDialog(win, { defaultPath: 'imagem.png' }); // @salvar-await
  return r.filePath;
}
function abrirComThen(win) {
  return dialog.showOpenDialog(win, {}).then((r) => r.filePaths); // @abrir-then
}

/* ---- janela, webContents, sessão e imagem (instâncias) ---- */
function criarJanela() {
  const win = new BrowserWindow({
    title: 'Fixture',
    width: 1200, height: 800,
    ...ajudante.opcoesDaJanela(process.platform),
    ...(app.isPackaged ? { show: false } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setAppDetails({ appId: 'br.exemplo.fixture' }); // @detalhes
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); // @abrir-handler
  win.webContents.session.setPermissionCheckHandler(() => false); // @permissao
  win.loadFile(path.join(__dirname, 'renderer/app.js')); // @aspas-app
  setTimeout(() => { try { if (!win.isDestroyed()) win.webContents.reload(); } catch (_) {} }, 800); // @catch-reload
  return win;
}

/* ---- eventos e escrita de propriedade ---- */
app.on('before-quit', () => {}); // @evento-quit
app.on('child-process-gone', () => {}); // @evento-child
nativeTheme.themeSource = 'dark'; // @tema-escrita
const escuro = nativeTheme.shouldUseDarkColors; // @tema-leitura

/* ---- texto que PARECE API mas não é: comentário, aspas, template e regex ---- */
// antes se copiava com clipboard.writeHTML('<b>x</b>') aqui
/* e o app.relaunch() ficava no fim */
const dicaAspas = 'use dialog.showMessageBox(janela) para perguntar'; // @aspas-dialog
const dicaTemplate = `${path.sep} clipboard.readRTF() ${path.sep}`; // @template-rtf
const reFalsa = /clipboard.readFindText()/; // @regex
const depoisDoTexto = 'https://exemplo.com/a'; clipboard.availableFormats(); // @depois-das-aspas

/* ---- catch em volta de API: o que é achado e o que não é ---- */
function achadosDeCatch(win) {
  try { dialog.showErrorBox('x', 'y'); } catch { /* sem janela ainda */ } // @catch-comentario
  try { app.setAppUserModelId('br.exemplo.fixture'); } catch (e) { logMain('appid', e); } // @catch-loga
  try { app.getPath('userData'); } catch (e) { return { error: e.message }; } // @catch-repassa
  try { return JSON.parse('{}'); } catch {} // @catch-sem-api
  return win;
}

/* ---- .catch() de promessa: só vale perto de uma API do Electron ---- */
dialog.showOpenDialog({ properties: ['openFile'] }).catch(() => {}); // @promessa-vazia
clipboard.read().catch(() => null); // @promessa-null




fetch('https://exemplo.com/longe').catch(() => {}); // @promessa-longe
