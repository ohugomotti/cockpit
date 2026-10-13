'use strict';
/* Leva 1, ajustes finais, item 4: o Grok sem lista de conversas, depois do R4-03.

   O R4-03 (UI 5.3) trocou o aviso fixo do Grok ("A lista de conversas do Grok ainda nao foi ligada aqui...") por
   uma lista VAZIA marcada com semLista, sem texto de aviso. Dois lugares ficaram contando a historia antiga:
   - o comentario do Grok no CLIS do main.js dizia que "a tela diz isso, em vez de mostrar lista sempre vazia";
   - o roteiro ao vivo testes/tela-quatro-motores.js ainda exigia /nao foi ligada/ no painel do Grok.
   O roteiro abre o Cockpit de verdade e nao roda na suite; por isso aqui ele e conferido contra o texto que o
   painel desenha de verdade (o sessions:cli do main.js e o prepararRespostaHistorico/paintHist do app.js, rodando
   num vm; so o DOM e de mentira). Se o painel mudar de texto, o roteiro precisa mudar junto. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');

const MAIN = lerFonte('main.js');
const APP = lerFonte('renderer', 'app.js');
const ROTEIRO = fs.readFileSync(path.join(__dirname, '..', 'testes', 'tela-quatro-motores.js'), 'utf8').replace(/\r\n/g, '\n');

// o Grok do CLIS (o objeto de verdade, conversas: false) e o handler sessions:cli, como o main os declara
function handlerDoMain() {
  const handlers = {};
  const ctx = vm.createContext({ path, HOME: 'C:\\Users\\x', ipcMain: { handle: (nome, fn) => { handlers[nome] = fn; } },
    acp: { sessoes: () => [] }, remoteEngines: {}, lerNomes: () => ({}), tituloAuto: { aplicarNome: (s) => s }, cliSessions: () => [] });
  vm.runInContext(pegarBloco(MAIN, 'const CLIS = {', 'CLIS') + ';', ctx);
  const i = MAIN.indexOf("ipcMain.handle('sessions:cli'");
  assert.notEqual(i, -1, 'nao achei o handler sessions:cli');
  vm.runInContext(MAIN.slice(i, MAIN.indexOf('\n});', i) + 4), ctx);
  return handlers['sessions:cli'];
}

// o texto que o painel do Grok (#histGrok) mostra: resposta do main -> preparo -> pintura, tudo do app.js de verdade
async function textoDoPainelDoGrok() {
  class Elemento {
    constructor() { this.filhos = []; this._texto = ''; }
    set innerHTML(_) { this.filhos = []; this._texto = ''; }
    get innerHTML() { return ''; }
    set textContent(valor) { this._texto = String(valor); }
    get textContent() { return this.filhos.length ? this.filhos.map((f) => f.textContent).join('') : this._texto; }
    appendChild(filho) { this.filhos.push(filho); return filho; }
  }
  const caixa = new Elemento();
  const ctx = vm.createContext({
    document: { createElement: () => new Elemento() }, caixaDoMotor: () => caixa,
    pintaGen: { grok: 0 }, buscaAtual: {}, normalizarBuscaHistorico: (s) => String(s || ''),
  });
  vm.runInContext(pegarBloco(APP, 'function prepararRespostaHistorico(') + '\n' + pegarBloco(APP, 'async function paintHist('), ctx);
  const resposta = await handlerDoMain()(null, 'grok');
  await ctx.paintHist('grok', ctx.prepararRespostaHistorico(resposta, 'grok', null));
  return caixa.textContent.trim();
}

test('o painel do Grok sem lista mostra a lista vazia, sem nenhum aviso do motor', async () => {
  const texto = await textoDoPainelDoGrok();
  assert.equal(texto, 'Nenhuma conversa ainda.');
  assert.doesNotMatch(texto, /Grok|n[ãa]o foi ligada|lista de conversas/i, 'o aviso fixo antigo nao volta');
});

test('o roteiro ao vivo (tela-quatro-motores.js) espera o texto que o painel do Grok mostra hoje', async () => {
  const linha = ROTEIRO.split('\n').find((l) => l.includes('.test(listas.grok)'));
  assert.ok(linha, 'o roteiro nao confere mais o painel do Grok (listas.grok)');
  const literal = /(\/.+\/[a-z]*)\.test\(listas\.grok\)/.exec(linha);
  assert.ok(literal, 'nao achei a expressao regular da conferencia: ' + linha.trim());
  const esperado = vm.runInNewContext(literal[1]);
  assert.equal(esperado.test(await textoDoPainelDoGrok()), true, 'o roteiro espera ' + esperado + ' e o painel mostra outra coisa');
  assert.equal(esperado.test(''), false, 'painel vazio (nada desenhado) nao pode passar na conferencia');
  assert.equal(esperado.test('A lista de conversas do Grok ainda não foi ligada aqui: o formato do arquivo dele não foi conferido nesta máquina.'), false,
    'o aviso antigo nao passa mais: o painel nao o mostra');
  assert.ok(!/nao foi ligada|não foi ligada/.test(ROTEIRO.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')),
    'sobrou no roteiro (fora de comentario) a espera do aviso que o R4-03 tirou');
});

test('o comentario do Grok no CLIS descreve o que o motor sem lista faz hoje (lista vazia, sem aviso)', () => {
  const i = MAIN.indexOf('  grok: {\n    nome: \'Grok\'');
  assert.notEqual(i, -1, 'nao achei o Grok do CLIS');
  const comentario = MAIN.slice(i, MAIN.indexOf('conversas: false', i));
  assert.match(comentario, /semLista/, 'o comentario diz o que o sessions:cli devolve');
  assert.match(comentario, /sem (texto de )?aviso/i, 'e que nao ha aviso');
  assert.doesNotMatch(comentario, /a tela diz isso|lista sempre vazia/i, 'a historia antiga (a tela avisando) saiu do comentario');
});
