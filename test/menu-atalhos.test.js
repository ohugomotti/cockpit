'use strict';
/* Rodada 2 da leva 5i, achado 1 (CRITICO): o Ctrl+W com o foco na pagina do navegador interno fechava o Cockpit INTEIRO.
   A causa estava no menu do app (src/main.js, menu()): o { role: 'windowMenu' } traz um "Fechar" com o acelerador Ctrl+W
   (CmdOrCtrl+W), e a tabela de atalhos do Electron guarda UM item por acelerador, o ultimo: o "Fechar" da janela ganhava do
   "Fechar painel" do menu Painel.

   O teste e' GENERICO: monta o menu de verdade (o trecho real do main.js, com um Menu falso que so' guarda o modelo), junta o
   acelerador de cada item (os escritos no modelo e os que cada role traz de fabrica) e exige que nenhum acelerador tenha dois
   donos. Assim o proximo item que repetir uma tecla tambem quebra aqui.

   Regra de seguranca da maquina (08/10: um assert sobre no falso inchou um node.exe a 37 GB): nenhum objeto falso do Electron
   entra como actual/expected de assert; so' texto, numero e booleano. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');

const MAIN = lerFonte('main.js');
const copia = (v) => JSON.parse(JSON.stringify(v));   // o que nasce no vm tem outro Object.prototype

/* O acelerador que cada role traz de fabrica no Windows (Electron: lib/browser/api/menu-item-roles.ts). So' entram os que tem
   acelerador; role que nao esta aqui nao traz nenhum (quit no Windows, about, delete...). */
const ATALHO_DO_ROLE = {
  close: 'CmdOrCtrl+W', minimize: 'CmdOrCtrl+M',
  undo: 'CmdOrCtrl+Z', redo: 'Ctrl+Y', cut: 'CmdOrCtrl+X', copy: 'CmdOrCtrl+C', paste: 'CmdOrCtrl+V', pastematchstyle: 'Shift+CmdOrCtrl+V', selectall: 'CmdOrCtrl+A',
  resetzoom: 'CmdOrCtrl+0', zoomin: 'CmdOrCtrl+Plus', zoomout: 'CmdOrCtrl+-',
  toggledevtools: 'Ctrl+Shift+I', reload: 'CmdOrCtrl+R', forcereload: 'Shift+CmdOrCtrl+R', togglefullscreen: 'F11',
};
/* Os roles que sao um MENU INTEIRO: o que o Electron monta dentro deles no Windows. */
const MENU_DO_ROLE = {
  windowmenu: ['minimize', 'zoom', 'close'],
  editmenu: ['undo', 'redo', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'delete', 'selectAll'],
  filemenu: ['quit'],
  viewmenu: ['reload', 'forceReload', 'toggleDevTools', 'resetZoom', 'zoomIn', 'zoomOut', 'toggleFullScreen'],
  appmenu: ['about', 'quit'],
};

// "CmdOrCtrl+Shift+M", "Control+Shift+M" e "Ctrl+Shift+M" sao a mesma tecla no Windows
function normalizar(acelerador) {
  const partes = String(acelerador).split('+').map((p) => p.trim()).filter(Boolean);
  const tecla = partes.pop().toUpperCase();
  const mods = new Set(partes.map((m) => {
    const k = m.toLowerCase();
    if (['cmdorctrl', 'commandorcontrol', 'ctrl', 'control', 'cmd', 'command'].includes(k)) return 'ctrl';
    return k === 'option' ? 'alt' : k;
  }));
  return [...mods].sort().concat(tecla).join('+');
}

/* Todos os donos de acelerador do modelo: { tecla, dono }. Item com registerAccelerator:false so' MOSTRA a combinacao (o Ctrl+Tab do
   Painel pertence a tela), nao e dono de nada. */
function donosDosAtalhos(modelo) {
  const donos = [];
  const visitar = (itens, caminho) => {
    for (const item of itens) {
      const nome = caminho + (item.label || item.role || item.type || '?');
      if (Array.isArray(item.submenu)) visitar(item.submenu, nome + ' > ');
      if (item.type === 'separator') continue;
      const papel = item.role ? String(item.role).toLowerCase() : '';
      if (MENU_DO_ROLE[papel] && !Array.isArray(item.submenu)) {
        for (const filho of MENU_DO_ROLE[papel]) {
          const padrao = ATALHO_DO_ROLE[filho.toLowerCase()];
          if (padrao) donos.push({ tecla: normalizar(padrao), dono: nome + ' > role ' + filho });
        }
      }
      if (item.accelerator && item.registerAccelerator !== false) donos.push({ tecla: normalizar(item.accelerator), dono: nome });
      else if (!item.accelerator && ATALHO_DO_ROLE[papel]) donos.push({ tecla: normalizar(ATALHO_DO_ROLE[papel]), dono: nome + ' (role ' + item.role + ')' });
    }
  };
  visitar(modelo, '');
  return donos;
}
function repetidos(modelo) {
  const porTecla = new Map();
  for (const d of donosDosAtalhos(modelo)) porTecla.set(d.tecla, [...(porTecla.get(d.tecla) || []), d.dono]);
  return [...porTecla].filter(([, lista]) => lista.length > 1).map(([tecla, lista]) => tecla + ' -> ' + lista.join(' | '));
}

// o trecho REAL do main.js: function menu() com um Menu falso que guarda o modelo
function montarMenu({ maximizada = false } = {}) {
  const chamadas = [];
  let modelo = null;
  const win = {
    isDestroyed: () => false, isMaximized: () => maximizada,
    maximize: () => chamadas.push('maximize'), unmaximize: () => chamadas.push('unmaximize'),
    webContents: { send: (canal, acao) => chamadas.push(canal + ':' + acao) },
  };
  const ctx = vm.createContext({ Menu: { buildFromTemplate: (m) => { modelo = m; return {}; }, setApplicationMenu() {} }, win });
  vm.runInContext(pegarBloco(MAIN, 'function menu() {', 'menu') + '\nmenu();', ctx);
  assert.ok(modelo && modelo.length >= 5, 'o menu nao foi montado');
  return { modelo, chamadas, ctx };
}
const achar = (itens, label) => {
  for (const item of itens) {
    if (item.label === label) return item;
    if (Array.isArray(item.submenu)) { const dentro = achar(item.submenu, label); if (dentro) return dentro; }
  }
  return null;
};

test('o menu do app nao tem dois donos para o mesmo acelerador (os escritos e os que cada role traz)', () => {
  const { modelo } = montarMenu();
  const donos = donosDosAtalhos(modelo);
  assert.ok(donos.length > 20, 'a tabela de atalhos veio quase vazia: o teste nao esta lendo o menu de verdade (' + donos.length + ')');
  assert.deepEqual(repetidos(modelo), []);
});

test('Ctrl+W tem UM dono so: o "Fechar painel" (o role windowMenu e o role close ficam de fora, porque trazem o "Fechar" da janela)', () => {
  const { modelo, chamadas } = montarMenu();
  const donosDoCtrlW = donosDosAtalhos(modelo).filter((d) => d.tecla === 'ctrl+W');
  assert.equal(donosDoCtrlW.length, 1, JSON.stringify(donosDoCtrlW));
  assert.equal(donosDoCtrlW[0].dono, 'Painel > Fechar painel');
  // nenhum item (em qualquer nivel) usa o role que fecha a janela
  const papeis = [];
  (function varrer(itens) { for (const i of itens) { if (i.role) papeis.push(String(i.role).toLowerCase()); if (Array.isArray(i.submenu)) varrer(i.submenu); } })(modelo);
  assert.equal(papeis.includes('windowmenu'), false, 'role windowMenu traz o "Fechar" com Ctrl+W');
  assert.equal(papeis.includes('close'), false);
  assert.equal(papeis.includes('filemenu'), false);
  // e o "Fechar painel" continua mandando a acao de fechar o PAINEL para a tela
  achar(modelo, 'Fechar painel').click();
  assert.deepEqual(copia(chamadas), ['menu:closePane']);
});

test('o menu Janela segue com Minimizar e o Zoom da janela (so o "Fechar" saiu); o zoom alterna e nunca lanca com a janela destruida', () => {
  const claro = montarMenu();
  const janela = achar(claro.modelo, 'Janela');
  assert.ok(janela && Array.isArray(janela.submenu), 'o menu Janela sumiu');
  assert.deepEqual(copia(janela.submenu.map((i) => i.label)), ['Minimizar', 'Maximizar ou restaurar']);
  assert.equal(janela.submenu[0].role, 'minimize');
  achar(claro.modelo, 'Maximizar ou restaurar').click();
  assert.deepEqual(copia(claro.chamadas), ['maximize']);
  const maxima = montarMenu({ maximizada: true });
  achar(maxima.modelo, 'Maximizar ou restaurar').click();
  assert.deepEqual(copia(maxima.chamadas), ['unmaximize']);
  // janela ja destruida (ou ainda nao criada): nada acontece
  const destruida = montarMenu();
  destruida.ctx.win = { isDestroyed: () => true, isMaximized: () => { throw new Error('nao devia olhar'); }, maximize() { throw new Error('nao devia agir'); } };
  const clicar = vm.runInContext('(item) => item.click()', destruida.ctx);
  assert.doesNotThrow(() => clicar(achar(destruida.modelo, 'Maximizar ou restaurar')));
  destruida.ctx.win = null;
  assert.doesNotThrow(() => clicar(achar(destruida.modelo, 'Maximizar ou restaurar')));
});

test('o detector acha o defeito antigo: o menu com { role: "windowMenu" } repete o Ctrl+W (e atalho so mostrado nao conta)', () => {
  const antigo = [
    { label: 'Painel', submenu: [{ label: 'Fechar painel', accelerator: 'CmdOrCtrl+W' }, { label: 'Próxima pasta', accelerator: 'Control+Tab', registerAccelerator: false }, { label: 'Outra', accelerator: 'Control+Tab' }] },
    { role: 'windowMenu', label: 'Janela' },
  ];
  assert.equal(repetidos(antigo).length, 1, 'so o Ctrl+W (o Minimizar, Ctrl+M, tem dono unico; o Ctrl+Tab so mostrado nao conta)');
  assert.match(repetidos(antigo)[0], /^ctrl\+W -> Painel > Fechar painel \| Janela > role close$/);
  // a mesma tecla escrita de 3 jeitos e a mesma tecla
  assert.equal(new Set(['CmdOrCtrl+Shift+M', 'Control+Shift+M', 'Ctrl+Shift+M', 'Shift+CommandOrControl+M'].map(normalizar)).size, 1);
  // e quem repete um acelerador de verdade e pego
  assert.equal(repetidos([{ label: 'A', submenu: [{ label: 'x', accelerator: 'CmdOrCtrl+T' }, { label: 'y', accelerator: 'Ctrl+T' }] }]).length, 1);
});
