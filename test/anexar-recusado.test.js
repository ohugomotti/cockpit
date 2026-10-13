'use strict';
/* Leva 1, ajustes finais, item 1: anexo recusado nao vira anexo.

   O anexo:ler devolve { erro } quando recusa (caminho de rede, Task 4b) ou quando falha (arquivo que sumiu, sem
   permissao). O anexar() da tela so conferia se veio ALGUMA coisa: o { erro } entrava em P.anexos, a ficha
   aparecia sem miniatura e o caminho recusado ia no texto "Arquivos que anexei". Agora retorno com erro (ou
   error) nao anexa, e o Hugo le o motivo pelo aviso de sempre da tela (note, em vermelho).

   O anexar() e o textoDaNota() sao os de verdade, recortados do app.js e executados num vm. O primeiro teste liga
   o anexar() ao canal REAL anexo:ler do main.js (disco vigiado: qualquer toque lanca), para provar a cadeia
   inteira com o \\servidor que a Task 4b recusa. So o resto da tela (note, pintarAnexos) e de mentira. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');

const APP = lerFonte('renderer', 'app.js');
const MAIN = lerFonte('main.js');
const MENSAGEM_REDE = 'Caminho de rede bloqueado por segurança.';

// "const nome = ...;" em uma linha so
function linhaConst(fonte, nome) {
  const ini = fonte.indexOf('const ' + nome + ' = ');
  assert.ok(ini >= 0, 'nao achei: const ' + nome);
  return fonte.slice(ini, fonte.indexOf('\n', ini));
}

/* O anexar() da tela, com a ponte (window.api.anexoLer) que o teste mandar. note() anota cada aviso; pintarAnexos()
   conta as repinturas da fila de fichas. */
function montarAnexar(anexoLer) {
  const ctx = vm.createContext({
    avisos: [], repintou: 0,
    window: { api: { anexoLer } },
    note: (_P, texto, erro) => ctx.avisos.push({ texto, erro: !!erro }),
    pintarAnexos: () => { ctx.repintou++; },
  });
  vm.runInContext([
    linhaConst(APP, 'baseNome'),
    pegarBloco(APP, 'function textoDaNota(', 'textoDaNota'),
    pegarBloco(APP, 'async function anexar(', 'anexar'),
  ].join('\n'), ctx);
  return ctx;
}

// o canal REAL anexo:ler do main.js; o disco lanca em qualquer toque (num caminho de rede nao pode haver nenhum)
function canalReal() {
  const handlers = {}, toques = [];
  const disco = new Proxy({}, { get: (_, nome) => () => { toques.push(String(nome)); throw new Error('encostou no disco: fs.' + String(nome)); } });
  const ctx = vm.createContext({ path, Buffer, fs: disco, ipcMain: { handle: (canal, fn) => { handlers[canal] = fn; } } });
  for (const nome of ['EXT_IMG', 'MSG_CAMINHO_DE_REDE', 'ehCaminhoDeRede']) vm.runInContext(linhaConst(MAIN, nome), ctx);
  const ini = MAIN.indexOf("ipcMain.handle('anexo:ler'");
  assert.ok(ini >= 0, 'nao achei o canal anexo:ler');
  vm.runInContext(MAIN.slice(ini, MAIN.indexOf('\n});', ini) + 4), ctx);
  return { toques, anexoLer: (arquivo) => handlers['anexo:ler']({}, arquivo) };
}

test('\\\\servidor recusado pelo canal real nao vira anexo: sem ficha, sem caminho na lista, e o Hugo le o motivo', async () => {
  const { toques, anexoLer } = canalReal();
  const tela = montarAnexar(anexoLer), P = { anexos: [] };
  await tela.anexar(P, ['\\\\servidor\\pasta\\a.png']);
  assert.deepEqual(P.anexos, [], 'o { erro } nao entra na lista (dali sairiam a ficha sem miniatura e o texto "Arquivos que anexei")');
  assert.equal(tela.avisos.length, 1, 'um aviso, so um');
  assert.equal(tela.avisos[0].erro, true, 'em vermelho: e o aviso que fica na tela, nao o que some sozinho');
  assert.ok(tela.avisos[0].texto.includes(MENSAGEM_REDE), 'traz a mensagem do erro: ' + tela.avisos[0].texto);
  assert.ok(tela.avisos[0].texto.includes('a.png'), 'e diz qual arquivo foi recusado: ' + tela.avisos[0].texto);
  assert.equal(tela.repintou, 1, 'a fila de fichas e repintada como sempre');
  assert.deepEqual(toques, [], 'e nada encostou no disco');
});

test('retorno so com "error" (o nome que os outros canais usam) tambem nao anexa, e o aviso traz a mensagem', async () => {
  const tela = montarAnexar(async (c) => ({ path: c, nome: 'a.txt', error: 'Sem permissão para ler.' })), P = { anexos: [] };
  await tela.anexar(P, ['C:\\pasta\\a.txt']);
  assert.deepEqual(P.anexos, []);
  assert.deepEqual(tela.avisos, [{ texto: 'Não consegui anexar a.txt: Sem permissão para ler.', erro: true }]);
});

test('numa lista, so o recusado fica de fora: os outros anexam na ordem, e cada recusa ganha o seu aviso', async () => {
  const ok1 = { path: 'C:\\a\\ok1.png', nome: 'ok1.png', ext: 'png', bytes: 5, mini: 'data:image/png;base64,AQIDBAU=' };
  const ok2 = { path: 'C:\\a\\ok2.txt', nome: 'ok2.txt', ext: 'txt', bytes: 12 };
  const retornos = {
    [ok1.path]: ok1,
    '\\\\srv\\x\\ruim.pdf': { path: '\\\\srv\\x\\ruim.pdf', nome: 'ruim.pdf', erro: MENSAGEM_REDE, error: MENSAGEM_REDE },
    'C:\\a\\sumiu.txt': { path: 'C:\\a\\sumiu.txt', nome: 'sumiu.txt', erro: "ENOENT: no such file or directory, stat 'C:\\a\\sumiu.txt'" },
    [ok2.path]: ok2,
  };
  const chamadas = [];
  const tela = montarAnexar(async (c) => { chamadas.push(c); return retornos[c]; }), P = { anexos: [] };
  await tela.anexar(P, [ok1.path, '\\\\srv\\x\\ruim.pdf', 'C:\\a\\sumiu.txt', ok2.path, ok1.path]);
  assert.deepEqual(P.anexos, [ok1, ok2], 'so os bons, na ordem (o repetido continua sendo ignorado)');
  assert.equal(chamadas.filter((c) => c === ok1.path).length, 1, 'o arquivo que ja estava anexado nem e lido de novo');
  assert.deepEqual(tela.avisos, [
    { texto: 'Não consegui anexar ruim.pdf: ' + MENSAGEM_REDE, erro: true },
    { texto: "Não consegui anexar sumiu.txt: ENOENT: no such file or directory, stat 'C:\\a\\sumiu.txt'", erro: true },
  ]);
  assert.equal(tela.repintou, 1);
});

test('o que ja funcionava segue igual: anexo bom entra sem aviso, e retorno vazio continua com o aviso generico', async () => {
  const bom = { path: 'C:\\a\\bom.txt', nome: 'bom.txt', ext: 'txt', bytes: 3 };
  const tela = montarAnexar(async (c) => (c === bom.path ? bom : null)), P = { anexos: [] };
  await tela.anexar(P, [bom.path, 'C:\\a\\x.bin']);
  assert.deepEqual(P.anexos, [bom]);
  assert.deepEqual(tela.avisos, [{
    texto: 'Não consegui anexar x.bin (arquivo grande demais, sem permissão, ou o caminho não existe).', erro: true,
  }]);
  assert.equal(tela.repintou, 1);
});
