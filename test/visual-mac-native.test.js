'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { nativeSourceFor, systemAppearance, windowOptions, themeColors, badgeBitmap, createVisualMacNative } = require('../src/visual-mac-native');

function fixture(platform = 'win32', initial = { tema: 'jornal', visualMac: false, abas: [{ id: 7 }] }, nativeOverride) {
  let saved = structuredClone(initial), current;
  const calls = [], handlers = new Map();
  const nativeTheme = nativeOverride || Object.assign(new EventEmitter(), { shouldUseDarkColors: false });
  const systemPreferences = Object.assign(new EventEmitter(), { getAccentColor: () => '2468acff' });
  const ipcMain = Object.assign(new EventEmitter(), { handle: (channel, handler) => handlers.set(channel, handler) });
  const app = { dock: { setBadge: value => calls.push(['dock', value]) } };
  function makeWindow() {
    const webContents = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false,
      send: (...args) => calls.push(['send', ...args]) });
    const window = Object.assign(new EventEmitter(), { webContents, isDestroyed: () => false });
    for (const method of ['setBackgroundMaterial', 'setVibrancy', 'setBackgroundColor', 'setTitleBarOverlay', 'setAutoHideMenuBar', 'setMenuBarVisibility', 'setOverlayIcon']) {
      window[method] = (...args) => calls.push([method, ...args]);
    }
    return window;
  }
  current = makeWindow();
  const deps = { app, ipcMain, nativeTheme, systemPreferences, platform,
    nativeImage: { createFromBitmap: (pixels, size) => ({ pixels, size }) },
    Menu: { getApplicationMenu: () => ({ popup: options => calls.push(['popup', options]) }) },
    getWindow: () => current, loadConfig: () => saved,
    saveConfig: value => { saved = structuredClone(value); calls.push(['save', saved]); return true; },
  };
  const control = createVisualMacNative(deps);
  control.install();
  const event = () => ({ sender: current.webContents, senderFrame: current.webContents.mainFrame });
  return { control, calls, handlers, deps, nativeTheme, systemPreferences, ipcMain, app,
    saved: () => saved, window: () => current,
    replaceWindow: () => { current = makeWindow(); return current; },
    call: (channel, value, source = event()) => handlers.get('visual-mac:' + channel)(source, value),
    initial: () => { const e = event(); ipcMain.emit('visual-mac:initial', e); return e.returnValue; },
  };
}

function systemTheme(dark) {
  const theme = new EventEmitter();
  let systemDark = dark, source = 'system';
  theme.writes = [];
  Object.defineProperties(theme, {
    themeSource: { get: () => source, set: value => { theme.writes.push(value); source = value; theme.emit('updated'); } },
    shouldUseDarkColors: { get: () => source === 'system' ? systemDark : source === 'dark' },
  });
  theme.changeSystem = value => { systemDark = value; theme.emit('updated'); };
  return theme;
}

test('Claro/Jornal forçam material claro mesmo com SO escuro; Automático devolve controle ao SO', () => {
  const native = systemTheme(true);
  const f = fixture('win32', { tema: 'claro', visualMac: true }, native);
  assert.equal(native.themeSource, 'light');
  assert.equal(native.shouldUseDarkColors, false);
  assert.equal(f.control.windowOptions().backgroundMaterial, 'mica');
  f.control.attachWindow();
  f.control.syncConfig({ tema: 'jornal', visualMac: true });
  assert.equal(native.shouldUseDarkColors, false);
  assert.deepEqual(native.writes, ['light'], 'mesmo lado claro não reatribui nem gera ciclo');
  f.control.syncConfig({ tema: 'automatico', visualMac: true });
  assert.equal(native.themeSource, 'system');
  assert.equal(f.call('appearance').dark, true, 'volta ao SO escuro real, não ao Claro anterior');
  assert.deepEqual(native.writes, ['light', 'system']);
});

test('Automático acompanha mudança do SO e evento updated não reescreve themeSource', () => {
  const native = systemTheme(true);
  const f = fixture('win32', { tema: 'escuro', visualMac: true }, native);
  f.control.attachWindow();
  native.changeSystem(false);
  assert.equal(native.shouldUseDarkColors, true, 'tema Preto permanece escuro quando SO clareia');
  f.control.syncConfig({ tema: 'automatico', visualMac: true });
  assert.equal(f.call('appearance').dark, false, 'Automático consulta estado atual do SO');
  const writes = native.writes.length;
  for (let n = 0; n < 5; n++) native.emit('updated');
  assert.equal(native.writes.length, writes, 'eventos repetidos não disparam nova atribuição');
  native.changeSystem(true);
  assert.equal(f.call('appearance').dark, true);
  assert.equal(native.themeSource, 'system');
  assert.equal(native.writes.length, writes);
  assert.equal(nativeSourceFor({ tema: 'azul' }), 'dark');
  assert.equal(nativeSourceFor({ tema: 'motti' }), 'dark');
});

test('Windows conserva botões nativos, Snap e menu sem reaparecer pelo Alt', () => {
  const colors = { color: '#fdf6e3', symbolColor: '#242424' };
  const options = windowOptions('win32', false, colors);
  assert.equal(options.titleBarStyle, 'hidden');
  assert.deepEqual(options.titleBarOverlay, { ...colors, height: 40 });
  assert.equal(options.autoHideMenuBar, false);
  assert.equal(options.backgroundMaterial, 'none');
  assert.equal(options.frame, undefined);
  assert.equal(options.trafficLightPosition, undefined);
  const f = fixture(); f.control.attachWindow();
  assert.ok(f.calls.some(c => c[0] === 'setAutoHideMenuBar' && c[1] === false));
  assert.ok(f.calls.some(c => c[0] === 'setMenuBarVisibility' && c[1] === false));
});

test('Mac usa semáforo nativo e vibrancy; Linux não recebe API de Windows/Mac', () => {
  assert.deepEqual(windowOptions('darwin', true, {}), { titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 16 }, vibrancy: 'sidebar', backgroundColor: '#00000000' });
  assert.deepEqual(windowOptions('linux', true, {}), {});
  const f = fixture('darwin'); f.control.attachWindow();
  assert.equal(f.calls.some(c => c[0] === 'setAutoHideMenuBar'), false);
});

test('Automático acompanha claro/escuro e recebe destaque RGBA sem permitir CSS arbitrário', () => {
  assert.deepEqual(systemAppearance({ shouldUseDarkColors: true }, { getAccentColor: () => 'ABCDEF90' }, 'win32'),
    { dark: true, accent: '#abcdef', platform: 'win32' });
  for (const invalid of ['url(x)', '#abcdef', '<script>', null]) {
    assert.equal(systemAppearance({}, { getAccentColor: () => invalid }, 'linux').accent, '#007aff');
  }
  assert.equal(systemAppearance({ shouldUseDarkColors: true }, { getAccentColor: () => { throw Error(); } }, 'linux').accent, '#0a84ff');
  assert.equal(themeColors({ tema: 'automatico' }, { dark: false }).color, '#f5f5f7');
  assert.equal(themeColors({ tema: 'automatico' }, { dark: true }).color, '#1c1c1e');
  assert.equal(themeColors({ tema: 'jornal' }, { dark: true }).color, '#fdf6e3');
});

test('chave Visual Mac salva só a preferência e alterna Mica sem perder abas', () => {
  const f = fixture(); f.control.attachWindow(); f.calls.length = 0;
  assert.deepEqual(f.call('set', true), { ok: true, visualMac: true });
  assert.deepEqual(f.saved(), { tema: 'jornal', visualMac: true, abas: [{ id: 7 }] });
  assert.ok(f.calls.some(c => c[0] === 'setBackgroundMaterial' && c[1] === 'mica'));
  assert.ok(f.calls.some(c => c[0] === 'setBackgroundColor' && c[1] === '#00000000'));
  assert.deepEqual(f.call('set', false), { ok: true, visualMac: false });
  assert.deepEqual(f.calls.at(-1), ['setBackgroundColor', '#fdf6e3']);
  assert.ok(f.call('set', 'false').error);
  assert.equal(f.saved().visualMac, false);
});

test('salvar Ajustes também aplica tema/material, sem reaplicar em cada gravação de conversa', () => {
  const f = fixture(); f.control.attachWindow(); f.calls.length = 0;
  f.control.syncConfig({ tema: 'jornal', visualMac: false, abas: [] });
  assert.equal(f.calls.length, 0);
  f.control.syncConfig({ tema: 'claro', visualMac: true });
  assert.ok(f.calls.some(c => c[0] === 'setTitleBarOverlay' && c[1].color === '#ffffff'));
  assert.equal(f.control.windowOptions().backgroundMaterial, 'mica');
});

test('o material Mac pode ser removido sem reiniciar a janela', () => {
  const f = fixture('darwin'); f.control.attachWindow(); f.calls.length = 0;
  f.call('set', true); f.call('set', false);
  assert.deepEqual(f.calls.filter(c => c[0] === 'setVibrancy'), [['setVibrancy', 'sidebar'], ['setVibrancy', null]]);
});

test('IPC só aceita a janela principal, sem permitir iframe, janela de recorte ou janela fechada', () => {
  const f = fixture();
  for (const source of [{}, { sender: {} }, { sender: f.window().webContents, senderFrame: {} }]) {
    for (const [channel, value] of [['set', true], ['window-theme', {}], ['attention', 8], ['menu'], ['appearance']]) {
      assert.ok(f.call(channel, value, source).error, channel);
    }
    f.ipcMain.emit('visual-mac:initial', source);
    assert.deepEqual(source.returnValue, { visualMac: false, appearance: null });
  }
  assert.equal(f.calls.length, 0);
  f.window().isDestroyed = () => true;
  assert.ok(f.call('set', true).error);
});

test('cores da moldura aceitam somente hex e ignoram propriedades extras', () => {
  const f = fixture();
  for (const value of [null, {}, { color: '#fff', symbolColor: '#ffffff' }, { color: 'url(file)', symbolColor: '#000000' }]) {
    assert.ok(f.call('window-theme', value).error);
  }
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.call('window-theme', { color: '#AABBCC', symbolColor: '#112233', height: 900 }), { ok: true });
  assert.deepEqual(f.calls[0], ['setTitleBarOverlay', { color: '#aabbcc', symbolColor: '#112233', height: 40 }]);
});

test('botão ⋯ abre o mesmo menu nativo, limita coordenadas e não permite trocar de janela', () => {
  const f = fixture();
  for (const value of [null, [], { x: NaN }, { x: -1 }, { y: Infinity }, { y: 100001 }]) assert.ok(f.call('menu', value).error);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.call('menu', { x: 9.6, y: 20.1, window: {} }), { ok: true });
  assert.deepEqual(f.calls[0], ['popup', { window: f.window(), x: 10, y: 20 }]);
  assert.deepEqual(f.call('menu'), { ok: true });
});

test('selo Windows rejeita contagem inválida, evita redesenho e some no zero', () => {
  const f = fixture();
  for (const value of [-1, 1.5, '5', NaN, Infinity, 1000001, null]) assert.ok(f.call('attention', value).error);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.call('attention', 7), { ok: true, count: 7 });
  assert.equal(f.calls[0][0], 'setOverlayIcon');
  assert.equal(f.calls[0][1].pixels.length, 32 * 32 * 4);
  assert.equal(f.calls[0][2], '7 sessões esperam você');
  f.call('attention', 7); assert.equal(f.calls.length, 1);
  f.call('attention', 0); assert.deepEqual(f.calls[1], ['setOverlayIcon', null, '']);
});

test('selo tem transparência nas bordas e desenhos distintos para número e 99+', () => {
  const one = badgeBitmap(1), two = badgeBitmap(2), many = badgeBitmap(1000);
  assert.equal(one.pixels[3], 0);
  assert.equal(one.pixels[(16 * 32 + 16) * 4 + 3], 255);
  assert.notDeepEqual(one.pixels, two.pixels);
  assert.notDeepEqual(two.pixels, many.pixels);
  assert.deepEqual(many.pixels, badgeBitmap(101).pixels);
});

test('selo Mac usa Dock e é limpo ao recarregar, fechar ou reabrir janela', () => {
  const f = fixture('darwin'); f.control.attachWindow(); f.calls.length = 0;
  f.call('attention', 2);
  f.window().webContents.emit('did-start-loading');
  f.call('attention', 2);
  f.window().emit('closed');
  assert.deepEqual(f.calls, [['dock', '2'], ['dock', ''], ['dock', '2'], ['dock', '']]);
  f.replaceWindow(); f.control.attachWindow();
  assert.deepEqual(f.calls.at(-1), ['dock', '']);
});

test('mudanças do sistema são enviadas à tela uma vez e limpam assinaturas ao sair', () => {
  const f = fixture('win32', { tema: 'automatico', visualMac: true });
  f.control.attachWindow(); f.calls.length = 0;
  assert.deepEqual(f.initial(), { visualMac: true, appearance: { dark: false, accent: '#2468ac', platform: 'win32' } });
  f.nativeTheme.shouldUseDarkColors = true; f.nativeTheme.emit('updated');
  f.nativeTheme.emit('updated');
  const sent = f.calls.filter(c => c[0] === 'send');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], ['send', 'visual-mac:appearance', { dark: true, accent: '#2468ac', platform: 'win32' }]);
  assert.ok(f.calls.some(c => c[0] === 'setTitleBarOverlay' && c[1].color === '#1c1c1e'));
  f.systemPreferences.getAccentColor = () => 'ee1122ff';
  f.systemPreferences.emit('accent-color-changed');
  assert.equal(f.calls.at(-1)[2].accent, '#ee1122');
  f.control.dispose();
  assert.equal(f.nativeTheme.listenerCount('updated'), 0);
  assert.equal(f.systemPreferences.listenerCount('accent-color-changed'), 0);
});

test('preload entrega estado antes do boot, esconde o evento IPC e remove assinatura', () => {
  const ipc = new EventEmitter(); const calls = []; let api;
  ipc.sendSync = channel => channel === 'visual-mac:initial'
    ? { visualMac: true, appearance: { dark: true, accent: '#112233', platform: 'win32' } } : 'automatico';
  ipc.invoke = (...args) => { calls.push(args); return Promise.resolve({ ok: true }); };
  const source = fs.readFileSync(path.join(__dirname, '../src/preload.js'), 'utf8');
  vm.runInNewContext(source, { process: { platform: 'win32' }, require: () => ({ ipcRenderer: ipc,
    webUtils: {}, contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } } }) });
  assert.equal(api.visualMacInicial, true); assert.equal(api.systemAppearanceInicial.dark, true);
  let got;
  const unsubscribe = api.onSystemAppearance(value => { got = value; });
  const appearance = { dark: false }; ipc.emit('visual-mac:appearance', { secret: 'never' }, appearance);
  assert.equal(got, appearance); unsubscribe(); assert.equal(ipc.listenerCount('visual-mac:appearance'), 0);
  api.setVisualMac(false); api.setAttentionBadge(5); api.showWindowMenu(); api.getSystemAppearance();
  assert.deepEqual(calls, [['visual-mac:set', false], ['visual-mac:attention', 5], ['visual-mac:menu', undefined], ['visual-mac:appearance']]);
});
