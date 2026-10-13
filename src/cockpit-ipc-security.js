'use strict';

const path = require('node:path');
const { fileURLToPath } = require('node:url');

const CAPTURE_CHANNELS = new Set(['recorte:dados', 'recorte:pronto', 'recorte:cancelar']);
const PERMISSIONS = new Set(['media', 'notifications', 'clipboard-sanitized-write']);
const DENIED = 'Esta janela não pode acessar este recurso do Cockpit.';

function pathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function localDocument(url, filename) {
  try {
    if (typeof url !== 'string' || !url || /[\x00-\x20]/.test(url)) return false;
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:' || parsed.search || parsed.username || parsed.password) return false;
    return pathKey(fileURLToPath(parsed)) === pathKey(filename);
  } catch { return false; }
}

function sameFrame(frame, mainFrame) {
  if (!frame || !mainFrame || frame.parent !== null || frame.detached === true) return false;
  if (frame.isDestroyed?.() || mainFrame.isDestroyed?.()) return false;
  return frame === mainFrame || (Number.isInteger(frame.processId) && Number.isInteger(frame.routingId)
    && frame.processId === mainFrame.processId && frame.routingId === mainFrame.routingId);
}

function createIpcSecurity({ ipcMain: nativeIpc, getMainWindow, getCaptureWindow, mainFile, captureFile, log = () => {} }) {
  const installedSessions = new WeakSet();
  const listeners = new Map();
  // O main entrega o logMain. Erro interno continua virando recusa (false); o motivo vai para o log.
  // Sem logger, ou com um que lança, nada muda: a recusa não pode depender do log.
  const registrar = (contexto, erro) => { try { log(contexto, erro); } catch {} };

  function trustedContents(contents, window, filename) {
    try {
      return !!(window && !window.isDestroyed() && contents && !contents.isDestroyed()
        && contents === window.webContents && sameFrame(contents.mainFrame, contents.mainFrame)
        && localDocument(contents.mainFrame.url, filename));
    } catch (e) { registrar('ipc:janela-confiavel', e); return false; }
  }

  function authorize(channel, event) {
    try {
      const capture = CAPTURE_CHANNELS.has(channel);
      // Um canal futuro recorte:* não ganha acesso por compartilhar o prefixo.
      if (channel.startsWith('recorte:') && !capture) return false;
      const window = capture ? getCaptureWindow() : getMainWindow();
      const filename = capture ? captureFile : mainFile;
      return trustedContents(event?.sender, window, filename)
        && sameFrame(event.senderFrame, event.sender.mainFrame)
        && localDocument(event.senderFrame.url, filename);
    } catch (e) { registrar('ipc:autorizar', e); return false; }
  }

  function guarded(channel, listener, synchronous = false, once = false) {
    return function (event, ...args) {
      if (!authorize(channel, event)) {
        // sendSync precisa de uma resposta para não prender o renderer.
        if (synchronous) { try { event.returnValue = null; } catch {} return; }
        throw new Error(DENIED);
      }
      if (once) {
        if (synchronous) facade.removeListener(channel, listener);
        else nativeIpc.removeHandler(channel);
      }
      return listener(event, ...args);
    };
  }

  function addListener(channel, listener, once) {
    if (typeof listener !== 'function') throw new TypeError('O ouvinte IPC precisa ser uma função.');
    const wrapper = guarded(channel, listener, true, once);
    const entries = listeners.get(channel) || [];
    entries.push({ listener, wrapper }); listeners.set(channel, entries);
    nativeIpc.on(channel, wrapper);
    return facade;
  }

  // Não modifica o singleton do Electron: somente os módulos do Cockpit
  // recebem esta fachada. Não oferece emit nem um caminho para o IPC cru.
  const facade = Object.freeze({
    handle(channel, listener) { nativeIpc.handle(channel, guarded(channel, listener)); },
    handleOnce(channel, listener) { nativeIpc.handle(channel, guarded(channel, listener, false, true)); },
    on(channel, listener) { return addListener(channel, listener, false); },
    once(channel, listener) { return addListener(channel, listener, true); },
    removeHandler(channel) { nativeIpc.removeHandler(channel); },
    removeListener(channel, listener) {
      const entries = listeners.get(channel) || [];
      const index = entries.findLastIndex(entry => entry.listener === listener);
      if (index >= 0) { nativeIpc.removeListener(channel, entries[index].wrapper); entries.splice(index, 1); }
      if (!entries.length) listeners.delete(channel);
      return facade;
    },
    removeAllListeners(channel) {
      const channels = channel === undefined ? [...listeners.keys()] : [channel];
      for (const name of channels) {
        for (const entry of listeners.get(name) || []) nativeIpc.removeListener(name, entry.wrapper);
        listeners.delete(name);
      }
      return facade;
    },
  });

  function permissionAllowed(contents, permission, details = {}, requestingOrigin) {
    try {
      if (!PERMISSIONS.has(permission) || !trustedContents(contents, getMainWindow(), mainFile)) return false;
      // getURL do webContents sozinho também aprovaria um iframe. Exigimos
      // os dados do documento solicitante fornecidos pelo próprio Electron.
      if (details.isMainFrame !== true || !localDocument(details.requestingUrl, mainFile)) return false;
      if (requestingOrigin && !['file://', 'file:///', 'null'].includes(requestingOrigin)
        && !localDocument(requestingOrigin, mainFile)) return false;
      if (permission === 'media') {
        if (details.mediaType && !['audio', 'video', 'unknown'].includes(details.mediaType)) return false;
        if (details.mediaTypes && (!Array.isArray(details.mediaTypes) || !details.mediaTypes.length
          || details.mediaTypes.some(type => !['audio', 'video'].includes(type)))) return false;
      }
      return true;
    } catch { return false; }
  }

  function installSession(session) {
    if (!session || installedSessions.has(session)) return;
    if (typeof session.setPermissionCheckHandler !== 'function' || typeof session.setPermissionRequestHandler !== 'function') {
      throw new Error('Esta versão do Electron não oferece os controles de permissão necessários.');
    }
    session.setPermissionCheckHandler((contents, permission, origin, details) => permissionAllowed(contents, permission, details, origin));
    session.setPermissionRequestHandler((contents, permission, callback, details) => callback(permissionAllowed(contents, permission, details)));
    session.setDevicePermissionHandler?.(() => false);
    // Recorte usa desktopCapturer no main, protegido pelo IPC; a página não
    // precisa de getDisplayMedia nem recebe uma captura contínua da tela.
    session.setDisplayMediaRequestHandler?.((_request, callback) => callback({}));
    installedSessions.add(session);
  }

  function protectCaptureWindow(window) {
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-frame-navigate', event => event.preventDefault());
    window.webContents.on('will-attach-webview', event => event.preventDefault());
  }

  return Object.freeze({ ipcMain: facade, authorize, installSession, permissionAllowed, protectCaptureWindow });
}

module.exports = { createIpcSecurity, localDocument, sameFrame, DENIED };
