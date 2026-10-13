'use strict';

// Testes de integração do main substituem o Electron inteiro. Esta fixture
// fornece a identidade da janela principal que antes era um evento vazio.
// A autorização de produção continua sendo executada, sem flag de bypass.
const realSecurity = require('../src/cockpit-ipc-security');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function criarIpcConfiavel() {
  let options;
  const fallback = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send() {} } };
  function principal() {
    const window = options?.getMainWindow() || fallback;
    window.isDestroyed ||= () => false;
    window.webContents ||= {};
    window.webContents.isDestroyed ||= () => false;
    window.webContents.mainFrame ||= {
      parent: null, detached: false, processId: 1, routingId: 1,
      url: pathToFileURL(options?.mainFile || path.resolve(__dirname, '../src/renderer/index.html')).href,
    };
    return window;
  }
  return {
    modulo: { ...realSecurity, createIpcSecurity(input) {
      options = input;
      return realSecurity.createIpcSecurity({ ...input, getMainWindow: principal });
    } },
    evento() {
      const window = principal();
      return { sender: window.webContents, senderFrame: window.webContents.mainFrame };
    },
  };
}

module.exports = { criarIpcConfiavel };
