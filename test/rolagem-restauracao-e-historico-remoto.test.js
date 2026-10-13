'use strict';
/* 28/09/2026, dois defeitos que o Hugo viu depois de instalar o visual Mac:

   1. "Todas as sessões estão sendo abertas no topo da conversa." Na restauração
      em lote (comMontagemAdiada) o painel é montado FORA da tela e o irProFim
      desistia calado (isConnected === false). O montarColunas só devolve a
      rolagem de quem JÁ estava na tela, então o painel restaurado entrava no
      topo. Agora o pedido fica pendente e o montarColunas cumpre.

   2. "Minha VPS não carrega nenhuma sessão." A lateral só repintava depois que
      os CINCO motores terminavam; um motor lento na VPS (1a conexão do Codex
      pode ir até o prazo) escondia as conversas do Claude que já tinham
      chegado. Agora cada motor que chega já pinta. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(RAIZ, 'src/renderer/app.js'), 'utf8');
const UI = fs.readFileSync(path.join(RAIZ, 'src/renderer/cockpit-ui.js'), 'utf8').replace(/\r\n/g, '\n');

function funcaoDe(fonte, nome, fechamento) {
  const inicio = fonte.search(new RegExp('(?:async )?function ' + nome + '\\('));
  assert.notEqual(inicio, -1, 'função não encontrada: ' + nome);
  return fonte.slice(inicio, fonte.indexOf(fechamento, inicio) + fechamento.length);
}

function painel(ligado) {
  return { id: 'p1', chat: { isConnected: ligado, scrollTop: 0, scrollHeight: 5000, querySelectorAll: () => [] } };
}

function ambienteDoIrProFim() {
  const ctx = vm.createContext({ requestAnimationFrame: (f) => f(), setTimeout: () => 0, clearTimeout: () => {} });
  vm.runInContext(funcaoDe(APP, 'pararIrProFim', '\n}') + '\n' + funcaoDe(APP, 'irProFim', '\n}'), ctx);
  return ctx;
}

test('irProFim com o painel fora da tela deixa o pedido pendente em vez de desistir', () => {
  const ctx = ambienteDoIrProFim();
  const P = painel(false);
  ctx.irProFim(P);
  assert.equal(P._fimPendente, true, 'o pedido de ir pro fim tem que ficar anotado');
  assert.equal(P.chat.scrollTop, 0, 'fora da tela nao rola');
});

test('irProFim com o painel na tela rola até o fim e limpa a pendência', () => {
  const ctx = ambienteDoIrProFim();
  const P = painel(true);
  P._fimPendente = true;
  ctx.irProFim(P);
  assert.equal(P.chat.scrollTop, 5000);
  assert.equal(P._fimPendente, false);
});

test('montarColunas cumpre o ir pro fim pendente de quem entrou na tela agora', () => {
  const corpo = funcaoDe(APP, 'montarColunas', '\n}');
  assert.match(corpo, /if \(!r\) \{ if \(P\._fimPendente\) irProFim\(P\); continue; \}/,
    'painel sem rolagem guardada (estava fora da tela) e com fim pendente tem que ir pro fim');
});

test('a lateral pinta cada motor que chega, sem esperar o mais lento', async () => {
  const chamadas = [];
  let libera;
  const lento = new Promise((r) => { libera = r; });
  const ctx = vm.createContext({
    MOTORES: ['claude', 'codex'],
    abaAtual: () => ({ id: 'vps' }),
    loadHist: (engine) => (engine === 'claude' ? Promise.resolve() : lento),
    refresh: () => chamadas.push('refresh'),
    setTimeout: () => 0,
    clearTimeout: () => {},
    Date,
  });
  vm.runInContext('let historyPlace = "", historyLoading = false, historyTried = 0, historyTimer = 0;\n'
    + funcaoDe(UI, 'loadPlaceHistory', '\n  }') + '\nthis.carregar = loadPlaceHistory;', ctx);
  const fim = ctx.carregar();
  await new Promise((r) => setImmediate(r));
  assert.ok(chamadas.length >= 1, 'o Claude chegou: a lista tem que repintar mesmo com o Codex ainda carregando');
  libera();
  await fim;
});
