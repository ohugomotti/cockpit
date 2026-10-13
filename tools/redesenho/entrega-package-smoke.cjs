'use strict';
/* Executar com Electron, nunca com node. Main/preload/renderer vêm do ASAR
   verificado. Todas as janelas ficam ocultas; contas, disco de trabalho e
   dados são fictícios. Não chama motores, SSH, rede nem a instalação. */
const electron = require('electron');
const { app, BrowserWindow, session } = electron;
const fs = require('node:fs');
const physicalFs = require('original-fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const Module = require('node:module');
const childProcess = require('node:child_process');
const EventEmitter = require('node:events');
const root = path.resolve(__dirname, '../..');
const argument = key => process.argv.find(value => value.startsWith('--' + key + '='))?.slice(key.length + 3);
const hash = file => crypto.createHash('sha256').update(physicalFs.readFileSync(file)).digest('hex').toUpperCase();
const expect = (value, message) => { if (!value) throw Error(message); };
const manifest = JSON.parse(fs.readFileSync(path.resolve(argument('manifest') || path.join(root, 'artifacts/visual-mac-package.json')), 'utf8'));
expect(manifest.status === 'verified' && path.resolve(manifest.workspace) === root, 'Manifesto não pertence a este checkout verificado.');
expect(path.resolve(manifest.package).startsWith(path.join(root, 'artifacts') + path.sep), 'Pacote fora da pasta de artefatos.');
expect(hash(manifest.package) === manifest.packageHash, 'Hash do pacote diferente do manifesto.');
if (argument('expected-hash')) expect(manifest.packageHash === argument('expected-hash').toUpperCase(), 'Este não é o pacote autorizado para o teste.');
function verifySources() {
  expect(manifest.sourceHashes && Object.keys(manifest.sourceHashes).length, 'Manifesto sem hashes dos fontes.');
  for (const [relative, expected] of Object.entries(manifest.sourceHashes)) {
    const file = path.resolve(root, 'src', relative);
    expect(file.startsWith(path.join(root, 'src') + path.sep) && hash(file) === expected, 'Fonte mudou desde o empacotamento: ' + relative);
  }
}
verifySources();
// Capturar só o caminho/hash da instalação antes de isolar os diretórios.
const installedAsar = path.join(process.env.LOCALAPPDATA, 'Programs/Cockpit/resources/app.asar');
const installedHash = hash(installedAsar);
expect(installedHash === manifest.baselineHash, 'A instalação mudou desde o empacotamento.');
const run = path.join(root, 'artifacts', 'entrega-package-smoke-' + Date.now() + '-' + crypto.randomUUID().slice(0, 8));
const home = path.join(run, 'home'), data = path.join(run, 'dados'), work = path.join(run, 'documentos');
const roaming = path.join(run, 'roaming'), local = path.join(run, 'local'), temp = path.join(run, 'temp');
for (const dir of [home, data, work, roaming, local, temp, path.join(run, 'crashes'), path.join(run, 'logs'), path.join(home, '.codex'), path.join(home, '.claude')]) fs.mkdirSync(dir, { recursive: true });
// Não herdar tokens, perfis, portas de inspeção ou endereços de serviços.
for (const key of Object.keys(process.env)) {
  if (/TOKEN|SECRET|PASSWORD|API_KEY|AUTHORIZATION|^(CODEX|CLAUDE|ANTHROPIC|OPENAI|GEMINI|GROK|COCKPIT|SSH|AWS|AZURE|GOOGLE)_/i.test(key)) delete process.env[key];
}
os.homedir = () => home;
Object.assign(process.env, { USERPROFILE: home, HOME: home, HOMEDRIVE: path.parse(home).root.slice(0, -1),
  HOMEPATH: home.slice(path.parse(home).root.length - 1), APPDATA: roaming, LOCALAPPDATA: local,
  CODEX_HOME: path.join(home, '.codex'), CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
  TEMP: temp, TMP: temp, XDG_CONFIG_HOME: path.join(home, '.config'), XDG_CACHE_HOME: path.join(home, '.cache') });
app.setPath('home', home); app.setPath('appData', roaming); app.setPath('userData', data); app.setPath('sessionData', data); app.setPath('temp', temp);
app.setPath('crashDumps', path.join(run, 'crashes'));
app.setAppLogsPath(path.join(run, 'logs'));
app.commandLine.appendSwitch('user-data-dir', data);
for (const flag of ['disable-background-networking', 'disable-component-update', 'disable-renderer-backgrounding', 'disable-background-timer-throttling']) app.commandLine.appendSwitch(flag);
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
process.chdir(work);
fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ visualMac: true, tema: 'jornal', tituloAuto: false,
  atalhosGlobais: false, sugestoes: false, defCwd: work, abaAtiva: 'entrega-smoke',
  abas: [{ id: 'entrega-smoke', nome: 'Teste oculto e isolado', tipo: 'local', caminhos: [work], paineis: [] }] }));
const documentPath = path.join(work, 'plano.md');
const documentText = '# Plano de teste\n\nConferir o histórico antes de ativar.\n';
fs.writeFileSync(documentPath, documentText);
const checks = [], errors = [], blocked = [], windowAttempts = [], windows = new Set();
let expectedBlockedConsoleErrors = 0, productionMain = false, productionPreload = false;
const originalConsoleError = console.error.bind(console);
console.error = (...args) => {
  const message = args.map(value => value?.message || String(value)).join(' ');
  if (message.includes('Efeito externo bloqueado pelo smoke:')) expectedBlockedConsoleErrors++;
  else errors.push('Console main: ' + message);
  originalConsoleError(...args);
};
const recordBlock = method => { blocked.push(method); };
const block = method => () => { recordBlock(method); throw Error('Efeito externo bloqueado pelo smoke: ' + method); };
const reject = method => async () => { recordBlock(method); throw Error('Efeito externo bloqueado pelo smoke: ' + method); };
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = block('child_process.' + name);
global.fetch = reject('fetch');
for (const protocol of ['http', 'https']) {
  const transport = require('node:' + protocol);
  transport.request = block(protocol + '.request'); transport.get = block(protocol + '.get');
}
const nodeNet = require('node:net');
nodeNet.connect = block('net.connect'); nodeNet.createConnection = block('net.createConnection');
nodeNet.Socket.prototype.connect = block('net.Socket.connect');
require('node:tls').connect = block('tls.connect');
require('node:dgram').createSocket = block('dgram.createSocket');
function hide(window) {
  if (windows.has(window)) return;
  windows.add(window);
  for (const method of ['show', 'showInactive', 'focus', 'restore', 'moveTop']) window[method] = () => windowAttempts.push(method);
  window.on('show', () => { errors.push('Uma janela ficou visível.'); window.hide(); });
  window.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push('Renderer: ' + message); });
  window.webContents.on('preload-error', (_event, _file, error) => errors.push('Preload: ' + error.message));
  window.webContents.on('render-process-gone', (_event, details) => errors.push('Renderer encerrou: ' + details.reason));
}
const HiddenBrowserWindow = new Proxy(BrowserWindow, {
  construct(target, args) {
    const win = Reflect.construct(target, [{ ...args[0], show: false, skipTaskbar: true, focusable: false,
      webPreferences: { ...args[0]?.webPreferences, backgroundThrottling: false } }]);
    hide(win); return win;
  },
});
class QuietNotification extends EventEmitter {
  static isSupported() { return false; }
  show() { recordBlock('Notification.show'); }
  close() {}
}
const realLoad = Module._load;
const shim = { ...electron, BrowserWindow: HiddenBrowserWindow, Notification: QuietNotification,
  net: { ...electron.net, fetch: reject('electron.net.fetch'), request: block('electron.net.request') },
  shell: { ...electron.shell, openExternal: reject('shell.openExternal'), openPath: reject('shell.openPath'),
    showItemInFolder: block('shell.showItemInFolder'), trashItem: reject('shell.trashItem') },
  globalShortcut: { ...electron.globalShortcut, register: () => false, registerAll: () => {}, unregister: () => {}, unregisterAll: () => {} },
  dialog: { ...electron.dialog, showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true }), showMessageBox: async () => ({ response: 0 }),
    showOpenDialogSync: () => undefined, showSaveDialogSync: () => undefined,
    showMessageBoxSync: () => 0, showErrorBox: () => recordBlock('dialog.showErrorBox') },
};
Module._load = function (name, parent, isMain) {
  if (name === 'electron') return shim;
  if (name === '@lydell/node-pty' || name === 'node-pty') return { spawn: block('node-pty.spawn') };
  return realLoad.call(this, name, parent, isMain);
};
app.on('browser-window-created', (_event, window) => hide(window));
app.setLoginItemSettings = () => recordBlock('app.setLoginItemSettings');
process.on('unhandledRejection', error => errors.push('Main: ' + (error?.message || String(error))));
process.stdout.on('error', () => {}); process.stderr.on('error', () => {});
const reportPath = path.join(root, 'artifacts', 'entrega-package-smoke.json');
let finished = false;
function finish(fatal) {
  if (finished) return;
  finished = true;
  if (fatal) errors.push(fatal.message || String(fatal));
  let unchanged = false;
  try { unchanged = hash(installedAsar) === installedHash; } catch (error) { errors.push(error.message); }
  if (!unchanged) errors.push('Hash da instalação mudou durante o teste.');
  const hidden = [...windows].every(window => window.isDestroyed() || (!window.isVisible() && !window.isFocused()));
  if (!hidden) errors.push('Uma janela do teste ficou visível ou recebeu foco.');
  const passed = !errors.length && checks.length > 0 && checks.every(check => check.passed);
  const report = { status: passed ? 'passed' : 'failed', createdAt: new Date().toISOString(), runtime: process.versions, executable: process.execPath,
    package: manifest.package, packageHash: manifest.packageHash, installedHash,
    installedModified: !unchanged, hidden, isolatedDirectory: run, checks, errors,
    blockedEffects: [...new Set(blocked)], preventedWindowActions: windowAttempts,
    productionMain, productionPreload, expectedBlockedConsoleErrors,
    networkAllowed: false, enginesStarted: false };
  fs.writeFileSync(path.join(run, 'resultado.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, passed: checks.filter(check => check.passed).length,
    total: checks.length, errors: errors.length, hidden, installedModified: !unchanged, report: reportPath }));
  app.exit(passed ? 0 : 1);
}
const watchdog = setTimeout(() => finish(Error('Smoke excedeu 55 segundos.')), 55000);
watchdog.unref();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function check(name, action) {
  try { await action(); checks.push({ name, passed: true }); }
  catch (error) { checks.push({ name, passed: false, error: error.message }); throw error; }
}
app.whenReady().then(() => {
  const installNetworkGuard = target => {
    target.webRequest.onBeforeRequest((details, callback) => {
      const cancel = !/^(file:|data:|devtools:|about:)/.test(details.url);
      if (cancel) recordBlock('chromium.network');
      callback({ cancel });
    });
    target.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  };
  installNetworkGuard(session.defaultSession);
  app.on('session-created', installNetworkGuard);
});
try { require(path.join(manifest.package, 'main.js')); productionMain = true; }
catch (error) { finish(error); }
(async () => {
  await app.whenReady();
  let window;
  await check('Main e renderer reais abrem ocultos', async () => {
    for (let i = 0; i < 100; i++) {
      window = BrowserWindow.getAllWindows().find(value => !value.isDestroyed());
      if (window && !window.webContents.isLoading()) {
        const ready = await window.webContents.executeJavaScript('!!window.VisualMac && !!document.querySelector(".mac-window-bar")').catch(() => false);
        if (ready) break;
      }
      await wait(100);
    }
    expect(window && !window.isVisible() && !window.isFocused(), 'Janela oculta não ficou pronta.');
    expect(await window.webContents.executeJavaScript('!!window.VisualMac && !!document.querySelector(".mac-window-bar")'), 'Renderer não terminou o carregamento.');
    expect(window.webContents.getURL().startsWith('file:') && decodeURIComponent(window.webContents.getURL()).includes(path.basename(path.dirname(manifest.package))), 'Renderer veio de outro pacote.');
  });
  const invoke = (method, ...args) => window.webContents.executeJavaScript('window.api[' + JSON.stringify(method) + '](...' + JSON.stringify(args) + ')');
  await check('Atualização de motores fica desativada no perfil isolado', async () => {
    const status = await invoke('motoresAtualizacoes');
    expect(status.enabled === false && status.running === false && Object.keys(status.engines).length === 0, 'A prévia tentou atualizar motores reais.');
  });
  let document, originalVersion;
  await check('Preload real lê MD com identidade e versão', async () => {
    const value = await invoke('verArquivo', documentPath);
    productionPreload = true;
    expect(value.tipo === 'texto' && value.dados === documentText, 'Leitura do Markdown não corresponde ao arquivo temporário.');
    document = value.document; originalVersion = document?.version;
    expect(/^[a-f0-9]{64}$/.test(document?.id) && /^[a-f0-9]{64}$/.test(originalVersion) && document.origin.kind === 'local', 'Descriptor de anotações ausente.');
  });
  let persisted;
  await check('Comentários, rascunho e preferências persistem via IPC', async () => {
    const empty = await invoke('readerCommentsGet', document);
    expect(empty.ok && empty.state.revision === 0 && empty.state.comments.length === 0, 'Documento novo não começa vazio.');
    const anchor = { text: 'Conferir antes de aplicar.', quote: 'Conferir o histórico antes de ativar.', prefix: '# Plano de teste\n\n', suffix: '\n',
      section: 'Plano de teste', start: 18, end: 54, version: originalVersion, mode: 'code' };
    const comment = { ...anchor, id: 'qa_comment_1', resolved: false, createdAt: Date.now(), updatedAt: Date.now() };
    const saved = await invoke('readerCommentsSave', { document, expectedRevision: 0, comments: [comment],
      draft: { ...anchor, text: 'Rascunho não concluído.' },
      view: { mode: 'code', fontSize: 18, wrap: true, scrollTop: 42, panel: 'comments', search: 'histórico', filter: 'open' } });
    expect(saved.ok && saved.state.revision === 1, 'Não foi possível salvar comentário.');
    const read = await invoke('readerCommentsGet', document);
    expect(read.ok && read.state.comments[0]?.text === comment.text && read.state.draft?.text === 'Rascunho não concluído.' && read.state.view.scrollTop === 42, 'Dados não reapareceram na leitura.');
    persisted = read.state;
    const onDisk = JSON.parse(fs.readFileSync(path.join(data, 'reader-comments', document.id + '.json'), 'utf8'));
    expect(onDisk.state?.revision === 1 && onDisk.state.comments[0]?.id === comment.id, 'Persistência no disco não corresponde ao IPC.');
    expect(fs.readFileSync(documentPath, 'utf8') === documentText, 'Salvar comentário alterou o Markdown original.');
  });
  await check('Conflito de revisão preserva o conteúdo salvo', async () => {
    const stale = await invoke('readerCommentsSave', { document, expectedRevision: 0, comments: [], draft: null });
    expect(!stale.ok && stale.code === 'CONFLICT', 'Revisão desatualizada não foi recusada.');
    const value = await invoke('readerCommentsGet', document);
    expect(value.ok && JSON.stringify(value.state) === JSON.stringify(persisted), 'Conflito alterou os comentários.');
  });
  await check('Reabrir arquivo alterado mantém anotações na versão antiga', async () => {
    fs.writeFileSync(documentPath, documentText + '\n## Nova seção\n');
    const value = await invoke('verArquivo', documentPath);
    expect(value.document.id === document.id && value.document.version !== originalVersion, 'Identidade/versão não acompanham o documento.');
    const notes = await invoke('readerCommentsGet', value.document);
    expect(notes.ok && notes.state.comments[0].version === originalVersion && notes.state.comments[0].id === 'qa_comment_1', 'Mudança do MD perdeu a anotação anterior.');
  });
  await check('Troca Codex usa somente credenciais fictícias e confirma destino', async () => {
    const auth = path.join(home, '.codex', 'auth.json');
    const fixture = id => JSON.stringify({ tokens: { account_id: 'qa-account-' + id, access_token: 'qa-access-' + id, refresh_token: 'qa-refresh-' + id } });
    fs.writeFileSync(auth, fixture('A'));
    expect((await invoke('contasSalvar', { engine: 'codex', apelido: 'QA A' })).ok, 'Não salvou a conta fictícia A.');
    fs.writeFileSync(auth, fixture('B'));
    expect((await invoke('contasSalvar', { engine: 'codex', apelido: 'QA B' })).ok, 'Não salvou a conta fictícia B.');
    expect((await invoke('codexReiniciar')).ok, 'Parada do Codex isolado não confirmou estado inativo.');
    expect((await invoke('contasTrocar', { engine: 'codex', apelido: 'QA A' })).ok, 'Troca para a conta fictícia A falhou.');
    expect(JSON.parse(fs.readFileSync(auth, 'utf8')).tokens.account_id === 'qa-account-A', 'Credencial fictícia ativa não mudou para o destino.');
    const profiles = await invoke('contasListar', 'codex');
    expect(Array.isArray(profiles) && profiles.find(value => value.apelido === 'QA A')?.atual && !profiles.find(value => value.apelido === 'QA B')?.atual, 'Lista não confirmou a identidade ativa.');
  });
  await wait(1700); // inclui a tentativa automática de arrancar Codex, bloqueada.
  await check('Sem erros inesperados de console, rede liberada, foco ou alteração do principal', async () => {
    expect(errors.length === 0, 'Erros durante o boot: ' + errors.join(' | '));
    expect([...windows].every(value => value.isDestroyed() || (!value.isVisible() && !value.isFocused())), 'Janela ganhou visibilidade/foco.');
    expect(app.getPath('userData') === data && os.homedir() === home, 'Isolamento de perfil foi alterado.');
    verifySources();
    expect(hash(installedAsar) === installedHash, 'Instalação foi modificada.');
  });
  finish();
})().catch(finish);
