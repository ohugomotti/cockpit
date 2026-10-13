'use strict';

/* A moldura continua sendo nativa: o Windows conserva Snap e seus botões;
   só o Mac usa o semáforo. Sem Electron no escopo do módulo para testar sem
   abrir o app, ler contas ou iniciar motores. */
const WINDOW_BAR_HEIGHT = 40;
const COLOR = /^#[0-9a-f]{6}$/i;
const THEMES = { escuro: '#1e1e1e', claro: '#ffffff', jornal: '#fdf6e3', azul: '#07182f', motti: '#07182f' };

function nativeSourceFor(config) {
  if (config?.tema === 'automatico') return 'system';
  return config?.tema === 'claro' || config?.tema === 'jornal' ? 'light' : 'dark';
}

function systemAppearance(nativeTheme, systemPreferences, platform) {
  const dark = !!nativeTheme?.shouldUseDarkColors;
  let accent = dark ? '#0a84ff' : '#007aff';
  try {
    const raw = systemPreferences?.getAccentColor();
    if (typeof raw === 'string' && /^[0-9a-f]{8}$/i.test(raw)) accent = '#' + raw.slice(0, 6).toLowerCase();
  } catch { /* Sem cor nativa (Linux ou sistema antigo): azul do Automático. */ }
  return { dark, accent, platform };
}

function themeColors(config, appearance) {
  const color = THEMES[config?.tema] || (config?.tema === 'automatico'
    ? appearance.dark ? '#1c1c1e' : '#f5f5f7' : THEMES.escuro);
  const light = config?.tema === 'claro' || config?.tema === 'jornal'
    || (config?.tema === 'automatico' && !appearance.dark);
  return { color, symbolColor: light ? '#242424' : '#f5f5f7' };
}

function windowOptions(platform, visualMac, colors) {
  const options = {};
  if (platform === 'win32') {
    options.titleBarStyle = 'hidden';
    options.titleBarOverlay = { ...colors, height: WINDOW_BAR_HEIGHT };
    options.autoHideMenuBar = false;
    options.backgroundMaterial = visualMac ? 'mica' : 'none';
  } else if (platform === 'darwin') {
    options.titleBarStyle = 'hiddenInset';
    options.trafficLightPosition = { x: 14, y: 16 };
    if (visualMac) options.vibrancy = 'sidebar';
  }
  if (visualMac && (platform === 'win32' || platform === 'darwin')) options.backgroundColor = '#00000000';
  return options;
}

/* BGRA, o bitmap nativo do Windows. Desenhado aqui em vez de aceitar SVG,
   HTML ou caminhos do renderer. O desenho é pequeno e feito só ao mudar o
   número; não há captura de tela nem uma janela escondida para cada selo. */
const DIGITS = {
  0: ['111','101','101','101','111'], 1: ['010','110','010','010','111'],
  2: ['111','001','111','100','111'], 3: ['111','001','111','001','111'],
  4: ['101','101','111','001','001'], 5: ['111','100','111','001','111'],
  6: ['111','100','111','101','111'], 7: ['111','001','010','010','010'],
  8: ['111','101','111','101','111'], 9: ['111','101','111','001','111'],
  '+': ['000','010','111','010','000'],
};
function badgeBitmap(count) {
  const size = 32;
  const pixels = Buffer.alloc(size * size * 4);
  const paint = (x, y, blue, green, red) => {
    const at = (y * size + x) * 4;
    pixels[at] = blue; pixels[at + 1] = green; pixels[at + 2] = red; pixels[at + 3] = 255;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if ((x - 15.5) ** 2 + (y - 15.5) ** 2 <= 15.5 ** 2) paint(x, y, 0, 149, 255);
  }
  const label = count > 99 ? '99+' : String(count);
  const scale = label.length === 1 ? 3 : 2;
  const width = label.length * 3 * scale + (label.length - 1) * scale;
  const x0 = Math.floor((size - width) / 2), y0 = Math.floor((size - 5 * scale) / 2);
  for (let n = 0; n < label.length; n++) for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
    if (DIGITS[label[n]][y][x] !== '1') continue;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      paint(x0 + n * 4 * scale + x * scale + dx, y0 + y * scale + dy, 255, 255, 255);
    }
  }
  return { pixels, width: size, height: size };
}

function createVisualMacNative({ app, ipcMain, Menu, nativeTheme, systemPreferences, nativeImage,
  platform = process.platform, getWindow, loadConfig, saveConfig, log = () => {} }) {
  // o main entrega o logMain; sem logger, ou com um que lança, nada muda
  const registrar = (contexto, erro) => { try { log(contexto, erro); } catch {} };
  let config = loadConfig() || {};
  // Mica, menus e a moldura precisam seguir a COR escolhida. Manter sempre
  // "system" deixava o material escuro atrás do Claro/Jornal no Windows.
  // Automático remove de verdade a substituição e volta a consultar o SO.
  // Nunca chamado por "updated": a própria atribuição emite esse evento.
  function applyNativeSource() {
    const source = nativeSourceFor(config);
    if (nativeTheme && nativeTheme.themeSource !== source) nativeTheme.themeSource = source;
  }
  applyNativeSource();
  let appearance = systemAppearance(nativeTheme, systemPreferences, platform);
  let visualMac = config.visualMac === true;
  let colors = themeColors(config, appearance);
  let lastBadge = null;
  let boundWindow = null;
  let unsubscribeMac = null;
  const listeners = [];

  function currentWindow() {
    const window = getWindow();
    return window && !window.isDestroyed() ? window : null;
  }
  function authorized(event) {
    const window = currentWindow();
    return !!window && event?.sender === window.webContents
      && event.senderFrame === window.webContents.mainFrame;
  }
  function guarded(action) {
    return (event, value) => {
      if (!authorized(event)) return { error: 'Esta ação pertence à janela principal.' };
      try { return action(value); }
      catch { return { error: 'Não foi possível atualizar a janela.' }; }
    };
  }
  function getAppearance() {
    appearance = systemAppearance(nativeTheme, systemPreferences, platform);
    return { ...appearance };
  }
  function applyMaterial() {
    const window = currentWindow();
    if (!window) return;
    if (platform === 'win32') {
      // Em um Windows antigo pode não haver Mica; a janela segue utilizável.
      try { window.setBackgroundMaterial(visualMac ? 'mica' : 'none'); } catch (e) { registrar('visual-mac:mica', e); }
    } else if (platform === 'darwin') {
      try { window.setVibrancy(visualMac ? 'sidebar' : null); } catch (e) { registrar('visual-mac:vibrancy', e); }
    }
    window.setBackgroundColor?.(visualMac && (platform === 'win32' || platform === 'darwin') ? '#00000000' : colors.color);
  }
  function applyColors() {
    const window = currentWindow();
    if (!window) return;
    if (platform === 'win32') window.setTitleBarOverlay?.({ ...colors, height: WINDOW_BAR_HEIGHT });
    window.setBackgroundColor?.(visualMac && (platform === 'win32' || platform === 'darwin') ? '#00000000' : colors.color);
  }
  function syncConfig(value) {
    const next = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const changedVisual = visualMac !== (next.visualMac === true);
    const changedTheme = next.tema !== config.tema;
    config = { ...next };
    visualMac = config.visualMac === true;
    if (changedTheme) {
      applyNativeSource();
      colors = themeColors(config, getAppearance());
    }
    if (changedVisual) applyMaterial();
    if (changedTheme) applyColors();
  }
  function updateAppearance() {
    const before = JSON.stringify(appearance);
    const state = getAppearance();
    if (JSON.stringify(state) === before) return;
    if (config.tema === 'automatico') { colors = themeColors(config, state); applyColors(); }
    const window = currentWindow();
    if (window && !window.webContents.isDestroyed()) window.webContents.send('visual-mac:appearance', state);
  }
  function setVisualMac(value) {
    if (typeof value !== 'boolean') return { error: 'Visual Mac precisa ser ligado ou desligado.' };
    const next = { ...(loadConfig() || {}), visualMac: value };
    if (saveConfig(next) === false) return { error: 'Não foi possível salvar a aparência.' };
    syncConfig(next);
    return { ok: true, visualMac };
  }
  function setWindowTheme(value) {
    if (!value || !COLOR.test(value.color) || !COLOR.test(value.symbolColor)) return { error: 'Cores da janela inválidas.' };
    colors = { color: value.color.toLowerCase(), symbolColor: value.symbolColor.toLowerCase() };
    applyColors();
    return { ok: true };
  }
  function showWindowMenu(value) {
    const options = { window: currentWindow() };
    if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) return { error: 'Posição do menu inválida.' };
    for (const key of ['x', 'y']) {
      if (value?.[key] === undefined) continue;
      if (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > 100000) return { error: 'Posição do menu inválida.' };
      options[key] = Math.round(value[key]);
    }
    const menu = Menu.getApplicationMenu();
    if (!menu) return { error: 'Menu ainda não disponível.' };
    menu.popup(options);
    return { ok: true };
  }
  function setAttentionBadge(count) {
    if (!Number.isSafeInteger(count) || count < 0 || count > 1000000) return { error: 'Contagem de pendências inválida.' };
    if (count === lastBadge) return { ok: true, count };
    const window = currentWindow();
    if (platform === 'win32' && window) {
      let icon = null;
      if (count) {
        const { pixels, width, height } = badgeBitmap(count);
        icon = nativeImage.createFromBitmap(pixels, { width, height, scaleFactor: 1 });
      }
      window.setOverlayIcon?.(icon, count ? `${count} ${count === 1 ? 'sessão espera' : 'sessões esperam'} você` : '');
    } else if (platform === 'darwin' && app.dock) {
      app.dock.setBadge(count ? String(count) : '');
    }
    lastBadge = count;
    return { ok: true, count };
  }
  function attachWindow() {
    const window = currentWindow();
    if (!window || boundWindow === window) return;
    boundWindow = window;
    lastBadge = null;
    if (platform !== 'darwin') {
      // autoHide=true permitiria ao Alt trazer de volta a faixa inteira.
      // Não removemos o menu: seus aceleradores continuam registrados.
      window.setAutoHideMenuBar?.(false);
      window.setMenuBarVisibility?.(false);
    }
    applyMaterial();
    applyColors();
    setAttentionBadge(0);
    window.on('focus', updateAppearance); // também cobre mudança do destaque no Mac
    window.webContents.on('did-start-loading', () => { lastBadge = null; setAttentionBadge(0); });
    window.once?.('closed', () => { if (platform === 'darwin') app.dock?.setBadge(''); });
  }
  function watch(emitter, name) {
    if (!emitter?.on) return;
    emitter.on(name, updateAppearance);
    listeners.push(() => emitter.removeListener(name, updateAppearance));
  }
  function install() {
    ipcMain.on('visual-mac:initial', event => {
      event.returnValue = authorized(event) ? { visualMac, appearance: getAppearance() } : { visualMac: false, appearance: null };
    });
    for (const [channel, action] of [
      ['appearance', getAppearance], ['set', setVisualMac], ['window-theme', setWindowTheme],
      ['menu', showWindowMenu], ['attention', setAttentionBadge],
    ]) ipcMain.handle('visual-mac:' + channel, guarded(action));
    watch(nativeTheme, 'updated');
    watch(systemPreferences, 'accent-color-changed');
    watch(systemPreferences, 'color-changed');
    if (platform === 'darwin' && systemPreferences?.subscribeNotification) {
      try {
        const id = systemPreferences.subscribeNotification('AppleColorPreferencesChangedNotification', updateAppearance);
        unsubscribeMac = () => systemPreferences.unsubscribeNotification(id);
      } catch (e) { registrar('visual-mac:cor-do-sistema', e); }
    }
  }
  function dispose() { for (const remove of listeners.splice(0)) remove(); unsubscribeMac?.(); unsubscribeMac = null; }
  return { install, dispose, attachWindow, syncConfig, getAppearance,
    windowOptions: () => windowOptions(platform, visualMac, colors) };
}

module.exports = { WINDOW_BAR_HEIGHT, nativeSourceFor, systemAppearance, themeColors, windowOptions, badgeBitmap, createVisualMacNative };
