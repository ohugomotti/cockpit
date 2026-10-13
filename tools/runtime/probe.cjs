'use strict';
// Somente runtime, preload e PTY em dados fictícios. Não importa main.js.
const { app, BrowserWindow, ipcMain, desktopCapturer, session, systemPreferences } = require('electron');
const fs = require('node:fs');
const physicalFs = require('original-fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const argument = key => process.argv.find(value => value.startsWith('--' + key + '='))?.slice(key.length + 3);
const hash = file => crypto.createHash('sha256').update(physicalFs.readFileSync(file)).digest('hex').toUpperCase();
const assert = (condition, message) => { if (!condition) throw Error(message); };
const runtimeManifestPath = path.resolve(argument('runtime-manifest') || path.join(root, 'artifacts/runtime-candidate.json'));
const manifest = JSON.parse(fs.readFileSync(runtimeManifestPath, 'utf8'));
assert(path.resolve(manifest.workspace) === root, 'Projeto divergente.');
assert(manifest.directory.startsWith(path.join(root, 'artifacts') + path.sep), 'Runtime fora dos artefatos.');
assert(path.resolve(process.execPath).toLowerCase() === path.resolve(manifest.testExecutable).toLowerCase(), 'Executável de teste divergente.');
assert(hash(process.execPath) === manifest.testExecutableSha256, 'Hash do runtime divergiu.');
assert(hash(manifest.package) === manifest.packageHash, 'Hash do ASAR divergiu.');
for (const entry of manifest.nativeFiles) {
  const nativeRoot = manifest.package + '.unpacked';
  const file = path.resolve(nativeRoot, entry.relative);
  assert(file.startsWith(nativeRoot + path.sep) && hash(file) === entry.sha256, 'Nativo divergente: ' + entry.relative);
}
const installed = path.join(process.env.LOCALAPPDATA, 'Programs/Cockpit/resources/app.asar');
assert(hash(installed) === manifest.baselineHash, 'Instalação divergiu.');
const run = path.join(root, 'artifacts', 'runtime-probe-' + Date.now());
const home = path.join(run, 'home');
for (const part of ['', 'home', 'profile', 'temp', 'roaming', 'local', 'crashes', 'logs']) fs.mkdirSync(path.join(run, part), { recursive: true });
for (const key of Object.keys(process.env)) if (/TOKEN|SECRET|PASSWORD|API_KEY|AUTHORIZATION|^(CODEX|CLAUDE|ANTHROPIC|OPENAI|GEMINI|GROK|COCKPIT|SSH|AWS|AZURE|GOOGLE)_/i.test(key)) delete process.env[key];
Object.assign(process.env, { HOME: home, USERPROFILE: home, APPDATA: path.join(run, 'roaming'), LOCALAPPDATA: path.join(run, 'local'), TEMP: path.join(run, 'temp'), TMP: path.join(run, 'temp'), CODEX_HOME: path.join(home, '.codex'), CLAUDE_CONFIG_DIR: path.join(home, '.claude') });
for (const [key, value] of Object.entries({ home, appData: path.join(run, 'roaming'), userData: path.join(run, 'profile'), sessionData: path.join(run, 'profile'), temp: path.join(run, 'temp'), crashDumps: path.join(run, 'crashes') })) app.setPath(key, value);
app.setAppLogsPath(path.join(run, 'logs'));
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
app.setAppUserModelId('com.homeromotti.cockpit.runtime-qa');
const checks = [], errors = [];
let window;
let result;
const watchdog = setTimeout(() => finish(Error('Prova de runtime excedeu 45 segundos.')), 45000);
function finish(error) {
  if (result) return;
  clearTimeout(watchdog);
  if (error) errors.push(error.stack || String(error));
  const installedModified = hash(installed) !== manifest.baselineHash;
  if (installedModified) errors.push('A instalação mudou.');
  result = { status: errors.length ? 'failed' : 'passed', createdAt: new Date().toISOString(), runtimeManifest: runtimeManifestPath, runtime: process.versions, package: manifest.package, packageHash: manifest.packageHash, checks, errors, installedModified, restarted: false, productionMainLoaded: false, audioRecorded: false, desktopFramesCaptured: false, externalNetworkAllowed: false, run };
  fs.writeFileSync(path.join(run, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'artifacts/runtime-probe.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ status: result.status, runtime: process.versions.electron, checks: checks.length, errors, report: path.join(run, 'result.json') }));
  app.exit(errors.length ? 1 : 0);
}
async function check(name, action) { const details = await action(); checks.push({ name, passed: true, ...(details || {}) }); }
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !/^(file:|data:|about:)/.test(details.url) }));
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  await check('versão estável esperada', () => assert(process.versions.electron === manifest.electron, 'Versão Electron incorreta.'));
  await check('PTY nativo preservado funciona no runtime novo', async () => {
    const pty = require(manifest.package + '/node_modules/@lydell/node-pty');
    const windows = process.env.SystemRoot || 'C:\\Windows';
    const ptyEnv = { SystemRoot: windows, WINDIR: windows, PATH: path.join(windows, 'System32'), TEMP: path.join(run, 'temp'), TMP: path.join(run, 'temp'), HOME: home, USERPROFILE: home };
    const term = pty.spawn(path.join(windows, 'System32/cmd.exe'), ['/d', '/c', 'echo COCKPIT_RUNTIME_PTY_OK'], { cwd: home, env: ptyEnv, cols: 80, rows: 24 });
    const output = await new Promise((resolve, reject) => { let text = ''; const timer = setTimeout(() => { term.kill(); reject(Error('PTY excedeu 10 segundos.')); }, 10000); term.onData(data => { text += data; }); term.onExit(event => { clearTimeout(timer); resolve({ exitCode: event.exitCode, text }); }); });
    assert(output.exitCode === 0 && output.text.includes('COCKPIT_RUNTIME_PTY_OK'), 'PTY não completou o comando.');
    return { exitCode: output.exitCode, module: '@lydell/node-pty@1.2.0-beta.15', nativeFilesUnmodified: true };
  });
  ipcMain.on('visual-mac:initial', event => { event.returnValue = {}; });
  ipcMain.on('config:tema', event => { event.returnValue = 'jornal'; });
  ipcMain.handle('sys:home', () => home);
  ipcMain.handle('sys:versao', () => 'runtime-qa');
  const html = path.join(run, 'probe.html');
  fs.writeFileSync(html, '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'"><title>Runtime QA isolado</title><body>Teste oculto de compatibilidade</body></html>');
  window = new BrowserWindow({ show: false, skipTaskbar: true, focusable: false, webPreferences: { preload: manifest.package + '/preload.js', contextIsolation: true, sandbox: true, nodeIntegration: false } });
  window.webContents.on('preload-error', (_event, _file, error) => errors.push('preload: ' + error.message));
  window.webContents.on('render-process-gone', (_event, details) => errors.push('renderer: ' + details.reason));
  await window.loadFile(html);
  await check('preload de produção com sandbox e isolamento', async () => {
    const value = await window.webContents.executeJavaScript('(async () => ({ api: typeof api, home: await api.home(), version: await api.versao(), hasNode: typeof require !== "undefined" || typeof process !== "undefined", methods: Object.keys(api).length }))()');
    assert(value.api === 'object' && value.home === home && value.version === 'runtime-qa' && !value.hasNode, 'Ponte isolada inválida.');
    return { exposedMethods: value.methods, nodeInRenderer: false, contextIsolation: true, sandbox: true };
  });
  await check('microfone enumerável sem gravar áudio', async () => {
    const info = await window.webContents.executeJavaScript('(async () => { const devices = await navigator.mediaDevices.enumerateDevices(); return { available: typeof navigator.mediaDevices.getUserMedia === "function", audioInputs: devices.filter(d=>d.kind==="audioinput").length, audioOutputs: devices.filter(d=>d.kind==="audiooutput").length }; })()');
    assert(info.available && info.audioInputs > 0, 'Nenhuma entrada de áudio enumerável.');
    return { ...info, permission: systemPreferences.getMediaAccessStatus('microphone'), labelsPersisted: false, captureRequested: false };
  });
  await check('captura de tela enumerável sem capturar imagem', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
    assert(sources.length > 0 && sources.every(source => source.thumbnail.isEmpty()), 'Fontes de tela inválidas ou miniaturas não vazias.');
    return { screens: sources.length, thumbnailsEmpty: true, sourceNamesPersisted: false, captureRequested: false };
  });
  await check('teste permaneceu oculto', () => assert(!window.isVisible() && !window.isFocused(), 'Janela do teste ficou visível.'));
  finish();
}).catch(finish);
