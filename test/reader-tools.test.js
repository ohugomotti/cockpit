'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { locateAnchor, makeAnchor, occurrences } = require('../src/renderer/reader-tools.js');
test('busca literal preserva offsets com acentos, HTML e metacaracteres', () => {
  assert.deepEqual(occurrences('Ação ação AÇÃO', 'AÇÃO'), [{start:0,end:4},{start:5,end:9},{start:10,end:14}]);
  assert.deepEqual(occurrences('a.b a*b [x] <script>', 'a.b'), [{start:0,end:3}]);
  assert.deepEqual(occurrences('a.b a*b [x] <script>', '[x]'), [{start:8,end:11}]);
  assert.deepEqual(occurrences('texto', ''), []);
});
test('ancora valida posição apenas quando versão e citação correspondem', () => {
  const anchor = makeAnchor('Antes trecho Depois', 6, 12, 'v1', 'preview');
  assert.equal(anchor.quote, 'trecho'); assert.equal(anchor.mode, 'preview');
  assert.deepEqual(locateAnchor('Antes trecho Depois', anchor, 'v1'), {status:'found',start:6,end:12});
  assert.deepEqual(locateAnchor('Novo Antes trecho Depois', anchor, 'v2'), {status:'found',start:11,end:17});
  assert.deepEqual(locateAnchor('Antes removido Depois', anchor, 'v2'), {status:'changed'});
});
test('arquivo alterado não desloca comentário para trecho repetido ambíguo', () => {
  const anchor = makeAnchor('trecho', 0, 6, 'v1', 'code');
  assert.deepEqual(locateAnchor('trecho trecho', anchor, 'v2'), {status:'ambiguous'});
  const contextual = makeAnchor('Antes trecho Depois', 6, 12, 'v1', 'preview');
  assert.deepEqual(locateAnchor('trecho externo. Antes trecho Depois', contextual, 'v2'), {status:'found',start:22,end:28});
  assert.equal(locateAnchor('Antes trecho Depois. Antes trecho Depois', contextual, 'v2').status, 'ambiguous');
});
test('comentário geral não cria ancoragem artificial', () => assert.deepEqual(locateAnchor('texto', {quote:''}, 'v1'), {status:'general'}));
test('citação curta única com contexto diferente não muda comentário de parágrafo', () => {
  const anchor = makeAnchor('Não excluir arquivo de teste', 4, 11, 'v1', 'preview');
  assert.deepEqual(locateAnchor('Agora excluir banco de produção', anchor, 'v2'), {status:'changed'});
  assert.deepEqual(locateAnchor('Contexto completamente novo trecho', makeAnchor('trecho',0,6,'v1','preview'), 'v2'), {status:'changed'});
});
