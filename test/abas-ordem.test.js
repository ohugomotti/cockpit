'use strict';
/* Leva 41 (B4): reordenar as abas do topo (PC inteiro, VPS, pastas...).

   O que tem que valer:
   1) mover e' uma conta pura (moverNaLista / indiceAoSoltar) - nada de mexer
      no array que outra parte do app pode estar percorrendo;
   2) moverAbaLocal grava cfg.abas na ordem nova, a aba ativa continua a mesma
      e os paineis de TODAS as abas ficam como estavam - inclusive depois do
      savePanes de verdade (ele mescla por paneId; a armadilha antiga era gravar
      por posicao e jogar conversa de uma aba dentro da outra);
   3) a ordem sobrevive a reabrir o app (config -> boot);
   4) Ctrl+Shift+1..9 seguem a ordem NOVA;
   5) "Mover para a esquerda/direita" param nas pontas sem gravar nada;
   6) no meio do arrasto a barra nao e' repintada (senao o botao que voce
      segura some debaixo do mouse), e repinta quando o arrasto acaba;
   7) o arrasto de aba nao conversa com o de arquivo/painel (variavel propria). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');

function funcao(nome) {
  const inicio = APP.indexOf('function ' + nome + '(');
  assert.notEqual(inicio, -1, 'funcao nao encontrada no app.js: ' + nome);
  const abre = APP.indexOf('{', inicio);
  let nivel = 0;
  for (let i = abre; i < APP.length; i++) {
    if (APP[i] === '{') nivel++;
    if (APP[i] === '}' && --nivel === 0) return APP.slice(APP.slice(inicio - 6, inicio) === 'async ' ? inicio - 6 : inicio, i + 1);
  }
  throw new Error('funcao incompleta: ' + nome);
}

/* tres abas, cada uma com conversas guardadas; "Nexfin" e' a ativa */
function cfgDeTeste() {
  return {
    abaAtiva: 'nexfin',
    abas: [
      { id: 'pc', nome: 'PC inteiro', tipo: 'local', caminho: null, paineis: [
        { paneId: 'pA', engine: 'claude', cwd: 'C:/pc', titulo: 'conversa parada do PC', sessaoId: 'sA' },
        { paneId: 'p2', engine: 'claude', cwd: 'C:/pc', titulo: 'PC trabalhando (antes)', sessaoId: 's2' },
      ] },
      { id: 'vps', nome: 'VPS', tipo: 'ssh', host: 'h', usuario: 'u', paineis: [
        { paneId: 'pV', engine: 'claude', cwd: '~', titulo: 'conversa da VPS', sessaoId: 'sV' },
      ] },
      { id: 'nexfin', nome: 'Nexfin', tipo: 'local', caminhos: ['C:/nexfin'], paineis: [
        { paneId: 'p1', engine: 'codex', cwd: 'C:/nexfin', titulo: 'Nexfin (antes)', sessaoId: 's1' },
      ] },
    ],
  };
}

function tela(extras) {
  const gravados = [], trocas = [], pinturas = { n: 0 };
  const ctx = vm.createContext({
    cfg: cfgDeTeste(),
    gravados, trocas, pinturas,
    panes: new Map(), panesFundo: new Map(), fichasPendentes: new Map(),
    window: { api: { setConfig: (c) => { gravados.push(JSON.parse(JSON.stringify(c))); } } },
    pintarAbasLocal: () => { pinturas.n++; },
    trocarAbaLocal: (id) => { trocas.push(id); },
    remotoDoPane: () => null,
    $: () => null,
    arrastandoAba: null,
    abasRepintarDepois: false,
    Map, Set, JSON, Number, Array, Object, String, Math,
    ...(extras || {}),
  });
  vm.runInContext(`
    function abasLocais() { return Array.isArray(cfg.abas) ? cfg.abas : []; }
    function abaPorId(id) { return abasLocais().find(a => a.id === id); }
    function abaAtual() { return abaPorId(cfg.abaAtiva) || abasLocais()[0]; }
  `, ctx);
  vm.runInContext(['moverNaLista', 'indiceAoSoltar', 'moverAbaLocal', 'moverAbaUmaCasa',
    'guardarEstadoDoMotor', 'fichaDoPainel', 'savePanes'].map(funcao).join('\n'), ctx);
  return ctx;
}
const ids = (lista) => lista.map((a) => a.id);
// JSON de ida e volta: as listas nascem dentro do vm (outro "realm") e o deepEqual estrito compara o prototipo
const porId = (cfg) => JSON.parse(JSON.stringify(Object.fromEntries(cfg.abas.map((a) => [a.id, a.paineis.map((f) => f.paneId + ':' + f.titulo)]))));

test('moverNaLista: conta pura, devolve lista NOVA e nao mexe na original', () => {
  const c = tela();
  const L = ['a', 'b', 'c', 'd'];
  assert.deepEqual([...c.moverNaLista(L, 0, 2)], ['b', 'c', 'a', 'd']);
  assert.deepEqual([...c.moverNaLista(L, 3, 0)], ['d', 'a', 'b', 'c']);
  assert.deepEqual([...c.moverNaLista(L, 1, 1)], ['a', 'b', 'c', 'd']);
  assert.deepEqual([...c.moverNaLista(L, 1, 99)], ['a', 'c', 'd', 'b'], 'para alem da ponta = ultima casa');
  assert.deepEqual([...c.moverNaLista(L, 2, -5)], ['c', 'a', 'b', 'd'], 'antes do comeco = primeira casa');
  assert.deepEqual([...c.moverNaLista(L, 7, 0)], ['a', 'b', 'c', 'd'], 'origem que nao existe: nada muda');
  assert.deepEqual(L, ['a', 'b', 'c', 'd'], 'a original ficou intacta');
  assert.notEqual(c.moverNaLista(L, 1, 1), L, 'sempre uma copia');
});

test('indiceAoSoltar: "antes"/"depois" da aba sob o mouse viram a casa final certa', () => {
  const c = tela();
  // [a,b,c,d]
  assert.equal(c.indiceAoSoltar(0, 2, false), 1);   // a antes de c -> [b,a,c,d]
  assert.equal(c.indiceAoSoltar(0, 2, true), 2);    // a depois de c -> [b,c,a,d]
  assert.equal(c.indiceAoSoltar(3, 0, false), 0);   // d antes de a -> [d,a,b,c]
  assert.equal(c.indiceAoSoltar(3, 1, true), 2);    // d depois de b -> [a,b,d,c]
  assert.equal(c.indiceAoSoltar(3, 3, true), 3);    // d depois dela mesma: fica
  // soltar colado nela mesma (dos dois lados) nao muda nada
  assert.equal(c.indiceAoSoltar(1, 1, false), 1);
  assert.equal(c.indiceAoSoltar(1, 0, true), 1);
  assert.equal(c.indiceAoSoltar(1, 2, false), 1);
});

test('moverAbaLocal: grava a ordem nova, a aba ativa continua ativa e nenhum painel muda de aba', () => {
  const c = tela();
  const antes = porId(c.cfg);
  const objetos = Object.fromEntries(c.cfg.abas.map((a) => [a.id, a]));
  // "PC inteiro" nao e' fixa: vai pra ponta direita
  assert.equal(c.moverAbaLocal('pc', 2), true);
  assert.deepEqual(ids(c.cfg.abas), ['vps', 'nexfin', 'pc']);
  assert.equal(c.cfg.abaAtiva, 'nexfin', 'reordenar nao troca de aba');
  assert.deepEqual(porId(c.cfg), antes, 'cada aba com as MESMAS conversas');
  for (const a of c.cfg.abas) assert.equal(a, objetos[a.id], 'mesmo objeto de aba (quem guardou referencia nao se perde)');
  assert.equal(c.gravados.length, 1, 'gravou uma vez');
  assert.deepEqual(ids(c.gravados[0].abas), ['vps', 'nexfin', 'pc'], 'o que foi pro disco ja esta na ordem nova');
  assert.ok(c.pinturas.n >= 1, 'a barra foi repintada');
  // mesma casa ou aba que nao existe: nao grava nada
  assert.equal(c.moverAbaLocal('pc', 2), false);
  assert.equal(c.moverAbaLocal('nao-existe', 0), false);
  assert.equal(c.gravados.length, 1);
});

test('reordenar e depois savePanes de verdade: paineis de TODAS as abas intactos (vivo, de fundo e parados)', () => {
  const c = tela();
  const el = {};
  // na tela: o painel da aba ativa (Nexfin), com titulo novo
  c.panes.set('p1', { id: 'p1', abaId: 'nexfin', engine: 'codex', cwd: 'C:/nexfin', titulo: 'Nexfin (agora)', sessaoId: 's1', el });
  // no segundo plano: um painel do PC que ainda trabalha
  c.panesFundo.set('p2', { id: 'p2', abaId: 'pc', engine: 'claude', cwd: 'C:/pc', titulo: 'PC trabalhando (agora)', sessaoId: 's2', busy: true, el });
  c.moverAbaLocal('pc', 2);
  c.moverAbaLocal('nexfin', 0);
  assert.deepEqual(ids(c.cfg.abas), ['nexfin', 'vps', 'pc']);
  c.savePanes();
  assert.deepEqual(porId(c.cfg), {
    pc: ['pA:conversa parada do PC', 'p2:PC trabalhando (agora)'],
    vps: ['pV:conversa da VPS'],
    nexfin: ['p1:Nexfin (agora)'],
  });
  const ultimo = c.gravados[c.gravados.length - 1];
  assert.deepEqual(ids(ultimo.abas), ['nexfin', 'vps', 'pc'], 'o savePanes seguinte nao desfaz a ordem');
  assert.equal(ultimo.abaAtiva, 'nexfin');
});

test('a ordem sobrevive a reabrir o app (config gravado -> boot)', () => {
  const c = tela();
  c.moverAbaLocal('vps', 0);
  const salvo = JSON.parse(JSON.stringify(c.gravados[c.gravados.length - 1]));
  // o trecho do boot que prepara as abas, do jeito que esta no app.js
  const ini = APP.indexOf('if (!Array.isArray(cfg.abas) || !cfg.abas.length) {');
  const marca = 'cfg.abaAtiva = cfg.abas[0].id;';
  const fim = APP.indexOf(marca, ini) + marca.length;
  assert.ok(ini > 0 && fim > ini, 'achei o boot das abas');
  const b = vm.createContext({ cfg: salvo, abasLocaisPadrao: () => { throw new Error('nao pode semear de novo'); } });
  vm.runInContext(`
    function abasLocais() { return Array.isArray(cfg.abas) ? cfg.abas : []; }
    function abaPorId(id) { return abasLocais().find(a => a.id === id); }
    function abaAtual() { return abaPorId(cfg.abaAtiva) || abasLocais()[0]; }
  ` + APP.slice(ini, fim), b);
  assert.deepEqual(ids(b.cfg.abas), ['vps', 'pc', 'nexfin']);
  assert.equal(b.cfg.abaAtiva, 'nexfin');
  assert.equal(vm.runInContext('abaAtual().id', b), 'nexfin');
  assert.deepEqual(porId(b.cfg), porId(cfgDeTeste()));
});

test('Ctrl+Shift+1..9 seguem a ordem nova', () => {
  const ouvintes = [];
  const c = tela({
    document: { addEventListener: (tipo, fn) => { if (tipo === 'keydown') ouvintes.push(fn); } },
    dialogoAberto: () => false,
    $: () => ({ classList: { contains: () => true } }),
  });
  const ini = APP.indexOf("document.addEventListener('keydown', (e) => {\n  if (!(e.metaKey || e.ctrlKey)) return;");
  assert.ok(ini > 0, 'achei o ouvinte de atalhos');
  let nivel = 0, fim = -1;
  for (let i = APP.indexOf('{', ini); i < APP.length; i++) {
    if (APP[i] === '{') nivel++;
    if (APP[i] === '}' && --nivel === 0) { fim = i + 1; break; }
  }
  vm.runInContext(APP.slice(ini, fim) + ');', c);
  assert.equal(ouvintes.length, 1);
  const tecla = (n) => ouvintes[0]({ ctrlKey: true, shiftKey: true, code: 'Digit' + n, key: '!', preventDefault() {} });
  c.moverAbaLocal('nexfin', 0);   // [nexfin, pc, vps]
  tecla(1); tecla(2); tecla(3); tecla(4);
  assert.deepEqual([...c.trocas], ['nexfin', 'pc', 'vps'], 'a 4a nao existe: nada');
});

test('"Mover para a esquerda/direita": uma casa por vez e nada nas pontas', () => {
  const c = tela();
  assert.equal(c.moverAbaUmaCasa('pc', -1), false, 'a primeira nao vai mais pra esquerda');
  assert.equal(c.moverAbaUmaCasa('nexfin', 1), false, 'a ultima nao vai mais pra direita');
  assert.equal(c.gravados.length, 0, 'nas pontas nao grava nada');
  assert.equal(c.moverAbaUmaCasa('pc', 1), true);
  assert.deepEqual(ids(c.cfg.abas), ['vps', 'pc', 'nexfin']);
  assert.equal(c.moverAbaUmaCasa('nexfin', -1), true);
  assert.deepEqual(ids(c.cfg.abas), ['vps', 'nexfin', 'pc']);
  assert.equal(c.cfg.abaAtiva, 'nexfin');
});

test('no meio do arrasto a barra nao e repintada; repinta quando o arrasto acaba', () => {
  let apagou = 0;
  let atualizouNavigator = 0;
  const box = { set innerHTML(v) { apagou++; }, get innerHTML() { return ''; } };
  const c = vm.createContext({ window:{CockpitUI:{refresh(){atualizouNavigator++;}}}, $: (s) => (s === '#abasLocal' ? box : null), arrastandoAba: 'pc', abasRepintarDepois: false,
    pintarAbasLocalMiolo: () => { apagou++; } });
  vm.runInContext(funcao('pintarAbasLocal'), c);
  c.pintarAbasLocal();
  assert.equal(apagou, 0, 'com a aba na mao, nao troca os botoes');
  assert.equal(atualizouNavigator, 0, 'Navigator também espera o fim do arrasto');
  assert.equal(c.abasRepintarDepois, true, 'fica devendo a pintura');
  c.arrastandoAba = null;
  c.pintarAbasLocal();
  assert.equal(apagou, 1);
  assert.equal(atualizouNavigator, 1);
  assert.equal(c.abasRepintarDepois, false);
});

test('arrasto de aba tem variavel propria e nao cai no soltar de arquivo nem no de painel', () => {
  assert.match(APP, /\nlet arrastandoAba = null;/, 'variavel propria do arrasto de aba');
  // o painel aceita arquivo solto; aba solta em cima dele nao acende nem anexa nada
  const i = APP.indexOf("el.addEventListener('dragover', (e) => {");
  const trecho = APP.slice(i, APP.indexOf("$('.p-send', el)", i));
  assert.ok(i > 0 && trecho.includes('drop'), 'achei o soltar de arquivo do painel');
  /* 21/09/2026: a guarda cresceu. As pastas sairam da lateral e viraram a faixa
     colada nos paineis, entao todo arrasto de pasta cruza a area de painel — e
     o painel acendia o alvo de "solte o arquivo aqui" e aceitava o drop sem
     fazer nada. Agora dragover e drop ignoram os DOIS: a aba de cima e a pasta
     da faixa (pelo tipo no dataTransfer, via arrastaDePasta). */
  assert.equal((trecho.match(/if \(arrastandoAba \|\| arrastaDePasta\(e\)\) return;/g) || []).length, 2,
    'dragover e drop do painel ignoram aba e pasta');
  assert.match(APP, /function arrastaDePasta\(e\) \{/, 'a guarda da pasta existe');
  assert.match(funcao('arrastaDePasta'), /'application\/cockpit-place'/, 'reconhece a pasta pelo tipo do arrasto');
  // o arrasto de aba usa um tipo proprio (nao text/plain: o campo de escrever colaria o id)
  const ini = funcao('comecarArrastoDeAba');
  assert.ok(ini.includes("'application/x-cockpit-aba'"));
  assert.ok(!ini.includes("'text/plain'"));
  // a barra so' reage a aba (arquivo e painel passam reto)
  const barra = funcao('ligarSoltarNaBarraDeAbas');
  assert.ok((barra.match(/if \(!arrastandoAba\) return;/g) || []).length >= 2, 'dragover e drop da barra so com aba na mao');
});
