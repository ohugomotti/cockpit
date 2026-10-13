'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { createIpcSecurity, localDocument, DENIED } = require('../src/cockpit-ipc-security');

function harness() {
  const mainFile = path.resolve('src/renderer/index.html');
  const captureFile = path.resolve('src/renderer/recorte.html');
  let seq = 0;
  const makeWindow = filename => {
    const frame = { parent: null, detached: false, url: pathToFileURL(filename).href, processId: 1, routingId: ++seq };
    const contents = Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => false });
    contents.setWindowOpenHandler = handler => { contents.openHandler = handler; };
    return { webContents: contents, isDestroyed: () => false };
  };
  const state = { main: makeWindow(mainFile), capture: makeWindow(captureFile) };
  const native = Object.assign(new EventEmitter(), { handlers: new Map(),
    handle(channel, listener) { if (this.handlers.has(channel)) throw Error('duplicado'); this.handlers.set(channel, listener); },
    removeHandler(channel) { this.handlers.delete(channel); },
  });
  const security = createIpcSecurity({ ipcMain: native, mainFile, captureFile,
    getMainWindow: () => state.main, getCaptureWindow: () => state.capture });
  const event = window => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  const main = event(state.main), capture = event(state.capture);
  const invoke = async (channel, evt, ...args) => native.handlers.get(channel)(evt, ...args);
  return { security, ipc: security.ipcMain, native, state, main, capture, event, invoke, makeWindow, mainFile, captureFile };
}

test('origem exige arquivo exato e recusa prefixos, query, remotos e URLs inválidas', () => {
  const h = harness(), url = h.main.senderFrame.url;
  assert.equal(localDocument(url, h.mainFile), true);
  assert.equal(localDocument(url + '#secao', h.mainFile), true);
  for (const value of [url + '.outro', url + '?file=1', 'https://example.org/index.html', 'about:blank', 'data:text/html,x', '', null, url + '\n']) {
    assert.equal(localDocument(value, h.mainFile), false, String(value));
  }
});

test('invoke preserva contrato e só chama o handler depois de validar janela e frame', async () => {
  const h = harness(); let calls = 0;
  h.ipc.handle('config:get', (_event, x) => { calls++; return { value: x }; });
  assert.deepEqual(await h.invoke('config:get', h.main, 7), { value: 7 });
  const other = h.event(h.makeWindow(h.mainFile));
  const iframe = { ...h.main, senderFrame: { ...h.main.senderFrame, parent: h.main.senderFrame, routingId: 90 } };
  for (const evt of [{}, { sender: h.main.sender }, { ...h.main, senderFrame: null }, h.capture, other, iframe]) {
    await assert.rejects(h.invoke('config:get', evt, 8), new RegExp(DENIED));
  }
  assert.equal(calls, 1);
});

test('frame nativo equivalente é aceito; ids antigos, frame destacado e janela destruída são recusados', () => {
  const h = harness();
  assert.equal(h.security.authorize('config:get', { ...h.main, senderFrame: { ...h.main.senderFrame } }), true);
  for (const changes of [{ routingId: 999 }, { processId: 999 }, { detached: true }, { url: h.capture.senderFrame.url }]) {
    assert.equal(h.security.authorize('config:get', { ...h.main, senderFrame: { ...h.main.senderFrame, ...changes } }), false);
  }
  h.state.main.isDestroyed = () => true;
  assert.equal(h.security.authorize('config:get', h.main), false);
});

test('navegação da janela legítima para outro documento revoga o acesso e reload aceita o frame novo', () => {
  const h = harness();
  h.main.senderFrame.url = pathToFileURL(path.resolve('outro.html')).href;
  assert.equal(h.security.authorize('config:get', h.main), false);
  const old = h.main.senderFrame;
  h.main.sender.mainFrame = { ...old, url: pathToFileURL(h.mainFile).href, routingId: 33 };
  assert.equal(h.security.authorize('config:get', h.main), false);
  assert.equal(h.security.authorize('config:get', h.event(h.state.main)), true);
});

test('recorte recebe só os três canais explícitos; principal não recebe a foto do recorte', async () => {
  const h = harness();
  for (const channel of ['recorte:dados', 'recorte:pronto', 'recorte:cancelar']) {
    h.ipc.handle(channel, () => ({ ok: true }));
    assert.deepEqual(await h.invoke(channel, h.capture), { ok: true });
    await assert.rejects(h.invoke(channel, h.main));
  }
  for (const channel of ['recorte:outro', 'fs:read', 'contas:listar', 'pane:start', 'experiments:key']) {
    assert.equal(h.security.authorize(channel, h.capture), false);
  }
  h.state.capture = null;
  assert.equal(h.security.authorize('recorte:dados', h.capture), false);
});

test('sendSync não bloqueia remetente recusado e nunca chama código privilegiado', () => {
  const h = harness(); let calls = 0;
  h.ipc.on('config:tema', event => { calls++; event.returnValue = 'azul'; });
  h.native.emit('config:tema', h.main);
  assert.equal(h.main.returnValue, 'azul');
  h.native.emit('config:tema', h.capture);
  assert.equal(h.capture.returnValue, null);
  assert.equal(calls, 1);
});

test('once e handleOnce não podem ser consumidos por uma origem recusada', async () => {
  const h = harness(); let calls = 0;
  h.ipc.once('once', () => { calls++; });
  h.native.emit('once', h.capture); h.native.emit('once', h.main); h.native.emit('once', h.main);
  assert.equal(calls, 1);
  h.ipc.handleOnce('once-invoke', () => ++calls);
  await assert.rejects(h.invoke('once-invoke', h.capture));
  assert.equal(await h.invoke('once-invoke', h.main), 2);
  assert.equal(h.native.handlers.has('once-invoke'), false);
});

test('removeListener remove somente o callback correto e removeAllListeners não altera ouvintes externos', () => {
  const h = harness(); let calls = 0;
  const one = () => { calls++; }, two = () => { calls += 10; }, external = () => {};
  h.native.on('change', external);
  h.ipc.on('change', one).on('change', two);
  h.ipc.removeListener('change', one);
  h.native.emit('change', h.main);
  assert.equal(calls, 10);
  h.ipc.removeAllListeners();
  assert.deepEqual(h.native.listeners('change'), [external]);
});

test('permissões locais mínimas preservam microfone/câmera e negam dispositivos, tela contínua e localização', () => {
  const h = harness();
  const details = { isMainFrame: true, requestingUrl: h.main.senderFrame.url };
  for (const permission of ['media', 'notifications', 'clipboard-sanitized-write']) {
    assert.equal(h.security.permissionAllowed(h.main.sender, permission, details, 'file://'), true);
  }
  for (const permission of ['usb', 'serial', 'hid', 'display-capture', 'geolocation', 'clipboard-read', 'openExternal', 'unknown']) {
    assert.equal(h.security.permissionAllowed(h.main.sender, permission, details), false);
  }
  for (const mediaTypes of [['audio'], ['video'], ['audio', 'video']]) {
    assert.equal(h.security.permissionAllowed(h.main.sender, 'media', { ...details, mediaTypes }), true);
  }
  for (const mediaTypes of [[], ['screen'], ['audio', 'screen'], 'audio']) {
    assert.equal(h.security.permissionAllowed(h.main.sender, 'media', { ...details, mediaTypes }), false);
  }
});

test('permissões exigem documento principal; negar subframe, outra janela, worker e dados incompletos', () => {
  const h = harness(), details = { isMainFrame: true, requestingUrl: h.main.senderFrame.url };
  for (const value of [{}, { ...details, isMainFrame: false }, { ...details, requestingUrl: 'https://example.org' }, { ...details, requestingUrl: h.capture.senderFrame.url }]) {
    assert.equal(h.security.permissionAllowed(h.main.sender, 'media', value), false);
  }
  for (const contents of [null, h.capture.sender, h.makeWindow(h.mainFile).webContents]) {
    assert.equal(h.security.permissionAllowed(contents, 'notifications', details), false);
  }
  assert.equal(h.security.permissionAllowed(h.main.sender, 'media', details, 'https://example.org'), false);
});

test('política instala check/request e device/display uma vez por sessão e sempre chama callback', () => {
  const h = harness(), calls = [], handlers = {};
  const session = {};
  for (const name of ['PermissionCheck', 'PermissionRequest', 'DevicePermission', 'DisplayMediaRequest']) {
    session['set' + name + 'Handler'] = fn => { calls.push(name); handlers[name] = fn; };
  }
  h.security.installSession(session); h.security.installSession(session);
  assert.equal(calls.length, 4);
  const details = { isMainFrame: true, requestingUrl: h.main.senderFrame.url, mediaTypes: ['audio'] };
  assert.equal(handlers.PermissionCheck(h.main.sender, 'media', 'file://', details), true);
  const answers = [];
  handlers.PermissionRequest(h.main.sender, 'media', value => answers.push(value), details);
  handlers.PermissionRequest(h.capture.sender, 'media', value => answers.push(value), details);
  assert.deepEqual(answers, [true, false]);
  assert.equal(handlers.DevicePermission({}), false);
  handlers.DisplayMediaRequest({}, value => assert.deepEqual(value, {}));
});

test('janela de recorte barra navegação, subframes, webviews e novas janelas', () => {
  const h = harness();
  h.security.protectCaptureWindow(h.state.capture);
  let stopped = 0;
  for (const channel of ['will-navigate', 'will-frame-navigate', 'will-attach-webview']) {
    h.capture.sender.emit(channel, { preventDefault() { stopped++; } });
  }
  assert.equal(stopped, 3);
  assert.deepEqual(h.capture.sender.openHandler({ url: 'https://example.org' }), { action: 'deny' });
});

test('main liga a fachada antes do primeiro registro e não oferece ipcMain cru aos módulos', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  assert.match(source, /ipcMain: electronIpcMain/);
  assert.ok(source.indexOf('const ipcMain = ipcSecurity.ipcMain;') < source.indexOf("ipcMain.handle('"));
  assert.equal((source.match(/electronIpcMain/g) || []).length, 2);
  assert.match(source, /ipcSecurity\.installSession\(win\.webContents\.session\)/);
  assert.match(source, /ipcSecurity\.protectCaptureWindow\(janela\)/);
});
