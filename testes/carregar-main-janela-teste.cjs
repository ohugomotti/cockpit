// Carrega o src/main.js DE VERDADE com um Electron falso e imprime (uma linha JSON) o que a janela de teste muda (rodada 2 da leva 5i).
// Roda num processo a parte, uma vez com COCKPIT_JANELA_TESTE=1 e outra sem: o main.js guarda estado de modulo (a constante JANELA_DE_TESTE e os
// ouvintes do ipcMain) e dois carregamentos no mesmo processo se misturariam. Quem chama: test/janela-de-teste.test.js.
// Nada aqui sobe motor nem abre janela: o child_process.spawn e' falso e o Electron tambem.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-janela-teste-'));
const HOME = path.join(RAIZ, 'home'), USERDATA = path.join(RAIZ, 'userdata');
fs.mkdirSync(HOME, { recursive: true }); fs.mkdirSync(USERDATA, { recursive: true });

const handlers = new Map();
const janelas = [];
const spawns = [];
const ipcConfiavel = require('./ipc-confiavel').criarIpcConfiavel();

class JanelaFalsa {
  constructor(opcoes) {
    janelas.push({ opcoes, ouvintes: this.ouvintes = {} });
    this.webContents = { on() {}, send() {}, setWindowOpenHandler() {}, reload() {}, isDestroyed: () => false };
  }
  static getAllWindows() { return []; }
  on(evento, fn) { (this.ouvintes[evento] = this.ouvintes[evento] || []).push(fn); }
  loadFile() {} isDestroyed() { return false; } isMinimized() { return false; } setTitle() {}
}
const eletronFalso = {
  app: {
    getPath: (q) => (q === 'userData' ? USERDATA : HOME), whenReady: () => Promise.resolve(), on() {},
    setName() {}, quit() {}, disableHardwareAcceleration() {}, setPath() {}, requestSingleInstanceLock: () => true, setAppUserModelId() {},
    commandLine: { appendSwitch() {}, getSwitchValue: () => '' }, isPackaged: false, getVersion: () => '1.0.0',
  },
  BrowserWindow: JanelaFalsa,
  ipcMain: { handle: (canal, fn) => handlers.set(canal, fn), on() {} },
  dialog: { showOpenDialog: async () => ({ canceled: true }) },
  shell: { openExternal() {}, openPath() {}, showItemInFolder() {} },
  Menu: { setApplicationMenu() {}, buildFromTemplate: () => ({}) },
  nativeTheme: { on() {} },
  clipboard: { readText: async () => '', writeText: async () => {}, read: async () => [], has: async () => false },
  globalShortcut: { register() {}, unregisterAll() {} },
  session: { defaultSession: { webRequest: { onHeadersReceived() {} }, setPermissionRequestHandler() {} } },
  crashReporter: { start() {} },
};
const intervaloReal = global.setInterval;
global.setInterval = (...a) => { const t = intervaloReal(...a); if (t && t.unref) t.unref(); return t; };
const watchReal = fs.watch;
fs.watch = (...a) => { const w = watchReal(...a); if (w && w.unref) w.unref(); return w; };

const cpReal = require('node:child_process');
const requireOriginal = Module.prototype.require;
Module.prototype.require = function (nome) {
  if (nome === 'electron') return eletronFalso;
  if (nome === './cockpit-ipc-security') return ipcConfiavel.modulo;
  if (nome === 'os') return new Proxy(requireOriginal.call(this, 'os'), { get: (alvo, k) => (k === 'homedir' ? () => HOME : alvo[k]) });
  if (nome === 'child_process') {
    // nenhum processo de verdade: o que o main tentar subir fica anotado e sai na hora
    return new Proxy(requireOriginal.call(this, 'child_process'), { get: (alvo, k) => (k === 'spawn' ? (bin, args) => {
      spawns.push(String(bin) + ' ' + (Array.isArray(args) ? args.join(' ') : ''));
      return cpReal.spawn(process.execPath, ['-e', 'process.exit(127)'], { stdio: ['pipe', 'pipe', 'pipe'] });
    } : alvo[k]) });
  }
  return requireOriginal.apply(this, arguments);
};

const resumo = (valor) => { try { return JSON.parse(JSON.stringify(valor === undefined ? null : valor)); } catch { return String(valor); } };
async function chamar(canal, pedido) {
  const h = handlers.get(canal);
  if (!h) return { ausente: true };
  try { return { retorno: resumo(await h(ipcConfiavel.evento(), pedido)) }; }
  catch (e) { return { lancou: String((e && e.message) || e) }; }
}

(async () => {
  require(path.join(__dirname, '..', 'src', 'main.js'));
  // o whenReady().then(...) do main (menu, createWindow) roda numa microtarefa
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  const janela = janelas[0] || { opcoes: {}, ouvintes: {} };
  const preservou = (janela.ouvintes['page-title-updated'] || []).map((fn) => { const e = { barrado: false, preventDefault() { this.barrado = true; } }; fn(e, 'Cockpit'); return e.barrado; });
  const canais = {
    'pane:send': await chamar('pane:send', { paneId: 'p1', engine: 'claude', text: 'oi', anexos: [] }),
    'pane:steer': await chamar('pane:steer', { paneId: 'p1', engine: 'claude', text: 'oi' }),
    'pane:compactar': await chamar('pane:compactar', { paneId: 'p1', engine: 'claude' }),
    'debate:start': await chamar('debate:start', { paneId: 'p1', cwd: HOME, topic: 'oi' }),
    'debate:continue': await chamar('debate:continue', { id: 'nao-existe', message: 'oi' }),
    'detalhe:perguntar': await chamar('detalhe:perguntar', {}),
  };
  console.log('RESULTADO ' + JSON.stringify({
    janelasCriadas: janelas.length,
    titulo: janela.opcoes.title,
    argumentos: (janela.opcoes.webPreferences || {}).additionalArguments || null,
    sandbox: (janela.opcoes.webPreferences || {}).sandbox,
    tituloBarrado: preservou,
    canais, spawns,
  }));
  try { fs.rmSync(RAIZ, { recursive: true, force: true }); } catch {}
  process.exit(0);
})().catch((e) => { console.log('FALHOU ' + ((e && e.stack) || e)); process.exit(1); });
