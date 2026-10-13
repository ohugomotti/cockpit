'use strict';
/* UI 6.1 (leva 1, task 15): a faixa fina entre colunas tinha
   title="Solte aqui para esta conversa virar uma coluna só dela". Bastava o mouse
   parar no vao entre colunas e o Windows desenhava a caixa nativa por cima do
   texto. Agora a dica mora num data-dica e o CSS so' a mostra, estilizada, quando
   a faixa e' o alvo de um arraste de sessao (.alvo: a classe que o proprio
   dragover da faixa ja' aplica, e so' com sessao na mao). */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');

const APP = lerFonte('renderer', 'app.js');
const CSS = lerFonte('renderer', 'style.css');
const TEXTO = 'Solte aqui para esta conversa virar uma coluna só dela';

/* Elemento de mentira que reflete como o DOM de verdade: element.title e
   dataset.x viram atributos (title / data-x). Assim o teste vale para qualquer
   jeito de escrever (title=, setAttribute, dataset) e falha so' por comportamento. */
function elementoFalso() {
  const attrs = {};
  const classes = new Set();
  const ouvintes = {};
  const nomeData = (k) => 'data-' + String(k).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
  const dataset = new Proxy({}, {
    get: (_, k) => attrs[nomeData(k)],
    set: (_, k, v) => { attrs[nomeData(k)] = String(v); return true; },
  });
  return {
    attrs, classes, ouvintes, dataset, className: '',
    get title() { return attrs.title === undefined ? '' : attrs.title; },
    set title(v) { attrs.title = String(v); },
    setAttribute: (k, v) => { attrs[k] = String(v); },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    addEventListener: (tipo, fn) => { (ouvintes[tipo] ||= []).push(fn); },
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
  };
}

function montar() {
  const ctx = {
    arrastando: null,
    panes: new Map(),
    document: { createElement: () => elementoFalso(), querySelectorAll: () => [] },
    montarColunas() {}, savePanes() {}, note() {},
  };
  vm.runInNewContext(pegarBloco(APP, 'function faixaDeColunaNova(', 'faixaDeColunaNova'), ctx);
  return ctx;
}

test('a faixa entre colunas nasce sem title (nem propriedade, nem atributo) e guarda a dica em data-dica', () => {
  const f = montar().faixaDeColunaNova(1);
  assert.equal(f.className, 'faixa-nova');
  assert.equal(f.title, '', 'title nativo faz o Windows abrir a caixa feia com o mouse parado no vao');
  assert.equal(f.getAttribute('title'), null);
  assert.equal(f.getAttribute('data-dica'), TEXTO, 'o texto da dica nao muda, so muda onde ele mora');
});

test('o arraste da faixa segue igual: acende so com sessao na mao e apaga ao sair', () => {
  const ctx = montar();
  const f = ctx.faixaDeColunaNova(2);
  const evento = () => ({ aceitou: false, preventDefault() { this.aceitou = true; }, dataTransfer: {} });

  const semSessao = evento();
  f.ouvintes.dragover[0](semSessao);
  assert.ok(!f.classes.has('alvo') && !semSessao.aceitou, 'arraste de aba ou arquivo nao acende a faixa');

  ctx.arrastando = 'p1';
  const comSessao = evento();
  f.ouvintes.dragover[0](comSessao);
  assert.ok(f.classes.has('alvo') && comSessao.aceitou, 'com sessao na mao a faixa vira alvo e aceita o drop');

  f.ouvintes.dragleave[0]();
  assert.ok(!f.classes.has('alvo'), 'saiu da faixa, apaga');
});

/* ---- CSS: regras da dica (comentarios fora, cada regra vira {seletor, corpo}) ---- */
const regras = [...CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ seletor: m[1].trim().replace(/\s+/g, ' '), corpo: m[2].replace(/\s+/g, ' ').trim() }));
const partes = (r) => r.seletor.split(',').map((s) => s.trim());
const regrasDaDica = regras.filter((r) => partes(r).some((s) => /\.faixa-nova\S*::after/.test(s)));
const decl = (r, prop) => {
  const m = r.corpo.match(new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)'));
  return m ? m[1].trim() : null;
};
const regraBase = regrasDaDica.find((r) => decl(r, 'content'));

test('CSS: a dica e o ::after da faixa e so existe quando ela e o alvo do arraste (.alvo), nunca no hover parado', () => {
  assert.ok(regraBase, 'falta .faixa-nova...::after com content:attr(data-dica)');
  assert.match(decl(regraBase, 'content'), /^attr\(\s*data-dica\s*\)$/);
  for (const r of regrasDaDica.filter((x) => decl(x, 'content'))) {
    for (const s of partes(r)) {
      assert.match(s, /\.alvo/, 'dica fora do estado de arraste: ' + s);
      assert.doesNotMatch(s, /:hover/, 'dica no hover reabre o problema do title: ' + s);
    }
  }
  assert.ok(!regras.some((r) => partes(r).some((s) => /\.faixa-nova\S*:hover/.test(s))), 'a faixa nao reage a hover parado');
});

test('CSS: a dica usa so tokens do tema, fica fora da faixa de 7px e nao rouba o drop das colunas', () => {
  assert.ok(regraBase, 'falta .faixa-nova...::after com content:attr(data-dica)');
  const todas = regrasDaDica.map((r) => r.corpo).join(';');
  assert.doesNotMatch(todas, /#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\(/i, 'cor fixa no lugar de token do tema');
  for (const prop of ['background', 'color', 'border', 'box-shadow']) {
    assert.match(decl(regraBase, prop) || '', /var\(--/, prop + ' tem que vir de token do tema');
  }
  assert.equal(decl(regraBase, 'position'), 'absolute', 'a faixa tem 7px: a dica sai dela');
  assert.equal(decl(regraBase, 'pointer-events'), 'none',
    'sem isso o balao vira parte da faixa e engole o drop que era da coluna embaixo');
  const faixa = regras.find((r) => r.seletor === '.faixa-nova');
  assert.equal(decl(faixa, 'position'), 'relative', 'a faixa e a ancora da dica');
});

test('CSS: nas pontas a dica ancora por dentro (centrada, metade sairia do #panes e seria cortada)', () => {
  const ponta = (pseudo) => regrasDaDica.find((r) => partes(r).some((s) => s.includes(pseudo + '::after')));
  const primeira = ponta(':first-child');
  const ultima = ponta(':last-child');
  assert.ok(primeira && ultima, 'faltam as regras :first-child / :last-child da dica');
  assert.equal(decl(primeira, 'left'), '0', 'primeira faixa: dica nasce na borda esquerda e cresce pra dentro');
  assert.equal(decl(ultima, 'right'), '0', 'ultima faixa: dica nasce na borda direita e cresce pra dentro');
});

/* ---- Leva 1, "Pequenos" 15b: o separador vizinho (makeSplitter), 5px colado na faixa de 7px ----
   Tinha o mesmo defeito da faixa: title="Arraste para ajustar..." e o Windows desenhava a caixa
   nativa no vao. O texto vira aria-label: o leitor de tela continua com o nome, a caixa some. */
const DICA_SEPARADOR = 'Arraste para ajustar · clique duas vezes para deixar todos do mesmo tamanho';

function montarSeparador() {
  const colunas = [{ style: { flex: '0 0 420px' } }, { style: { flex: '0 0 380px' } }];
  const ctx = {
    colunas,
    panes: new Map([['p1', { larguraColuna: 420 }], ['p2', { larguraColuna: 380 }]]),
    document: { createElement: () => elementoFalso(), querySelectorAll: () => colunas },
    salvou: 0,
    savePanes() { ctx.salvou++; },
  };
  vm.runInNewContext(pegarBloco(APP, 'function makeSplitter(', 'makeSplitter'), ctx);
  return ctx;
}

test('o separador entre colunas nasce sem title (nem propriedade, nem atributo) e guarda o nome em aria-label', () => {
  const s = montarSeparador().makeSplitter();
  assert.equal(s.className, 'pane-split');
  assert.equal(s.title, '', 'title nativo faz o Windows abrir a caixa feia com o mouse parado no vao');
  assert.equal(s.getAttribute('title'), null);
  assert.equal(s.getAttribute('aria-label'), DICA_SEPARADOR, 'o texto nao muda, so muda onde ele mora');
});

test('o separador segue ligado: duplo clique devolve as colunas ao mesmo tamanho e o arraste continua no mousedown', () => {
  const ctx = montarSeparador();
  const s = ctx.makeSplitter();
  assert.equal(s.ouvintes.mousedown.length, 1, 'sem o mousedown o separador nao arrasta mais');
  const evento = { prevenido: false, parou: false, preventDefault() { this.prevenido = true; }, stopPropagation() { this.parou = true; } };
  s.ouvintes.dblclick[0](evento);
  assert.ok(evento.prevenido && evento.parou, 'o duplo clique nao pode vazar para o que esta embaixo');
  assert.deepEqual(ctx.colunas.map((c) => c.style.flex), ['', ''], 'larguras travadas em pixel sao soltas');
  assert.deepEqual([...ctx.panes.values()].map((p) => p.larguraColuna), [0, 0], 'a largura guardada de cada conversa volta ao padrao');
  assert.equal(ctx.salvou, 1, 'e a tela salva o novo estado');
});

/* ---- Leva 1, ajustes finais, item 5: o separador HORIZONTAL (makeSplitterH), entre duas sessoes da mesma coluna ----
   Ficou de fora do "Pequenos" 15b: tinha o mesmo title="Arraste para ajustar a altura..." e o Windows desenhava a
   mesma caixa nativa com o mouse parado na linha de 5px. Mesmo conserto: o texto vira aria-label. */
const DICA_SEPARADOR_H = 'Arraste para ajustar a altura · clique duas vezes para dividir igual';

function montarSeparadorH() {
  const paineis = [{ style: { flex: '0 0 300px' } }, { style: { flex: '0 0 500px' } }];
  const ctx = {
    paineis,
    document: { createElement: () => elementoFalso() },
    salvou: 0,
    savePanes() { ctx.salvou++; },
  };
  vm.runInNewContext(pegarBloco(APP, 'function makeSplitterH(', 'makeSplitterH'), ctx);
  return ctx;
}

test('o separador entre sessoes da coluna nasce sem title (nem propriedade, nem atributo) e guarda o nome em aria-label', () => {
  const s = montarSeparadorH().makeSplitterH();
  assert.equal(s.className, 'pane-split-h');
  assert.equal(s.title, '', 'title nativo faz o Windows abrir a caixa feia com o mouse parado na linha');
  assert.equal(s.getAttribute('title'), null);
  assert.equal(s.getAttribute('aria-label'), DICA_SEPARADOR_H, 'o texto nao muda, so muda onde ele mora');
});

test('o separador horizontal segue ligado: duplo clique solta as alturas e o arraste continua no mousedown', () => {
  const ctx = montarSeparadorH();
  const s = ctx.makeSplitterH();
  s.parentElement = { querySelectorAll: (seletor) => (seletor === '.pane' ? ctx.paineis : []) };
  assert.equal(s.ouvintes.mousedown.length, 1, 'sem o mousedown o separador nao arrasta mais');
  const evento = { prevenido: false, parou: false, preventDefault() { this.prevenido = true; }, stopPropagation() { this.parou = true; } };
  s.ouvintes.dblclick[0](evento);
  assert.ok(evento.prevenido && evento.parou, 'o duplo clique nao pode vazar para o que esta embaixo');
  assert.deepEqual(ctx.paineis.map((p) => p.style.flex), ['', ''], 'alturas travadas em pixel sao soltas');
  assert.equal(ctx.salvou, 1, 'e a tela salva o novo estado');
});
