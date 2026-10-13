'use strict';
/* R4-03 / UI 5.3: um motor sem lista de conversas (hoje o Grok, que nem esta
   instalado) mandava um aviso tecnico ("A lista de conversas do Grok ainda nao
   foi ligada aqui...") que ficava PARA SEMPRE no rodape do Historico da lateral
   e no fim de toda busca (Ctrl+K). Agora o main devolve a lista vazia marcada
   (semLista) e sem texto de aviso. Falha de leitura de verdade (servidor caido,
   pagina parcial) continua aparecendo.

   Tudo aqui roda o codigo de verdade: o handler sessions:cli do main.js, o
   loadHist e o preparo da resposta do app.js, o rodape do Historico e a paleta
   do cockpit-ui.js. So o andaime em volta (DOM, ponte window.api) e' falso. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const UI = require('../src/renderer/cockpit-ui');
const HistoricoLista = require('../src/renderer/historico-lista');
const { lerFonte, pegarBloco, registroDeMotores } = require('../testes/raiz');

const MAIN = lerFonte('main.js');
const APP = lerFonte('renderer', 'app.js');
const UI_SRC = lerFonte('renderer', 'cockpit-ui.js');
const { MOTORES, nomeDoMotor } = registroDeMotores();
const AVISO_DO_MOTOR = /Grok|ainda n[ãa]o foi ligada|lista de conversas/i;
const comoJson = (valor) => JSON.parse(JSON.stringify(valor));

function trecho(fonte, comeco, fim) {
  const i = fonte.indexOf(comeco);
  assert.notEqual(i, -1, 'nao achei no fonte: ' + comeco);
  const f = fonte.indexOf(fim, i);
  assert.notEqual(f, -1, 'nao achei o fim do trecho: ' + fim);
  return fonte.slice(i, f + fim.length);
}

/* ---------- o handler de verdade do main.js, com o minimo em volta ---------- */
function handlerDoMain(extra = {}) {
  const i = MAIN.indexOf("ipcMain.handle('sessions:cli'");
  assert.notEqual(i, -1, 'nao achei o handler sessions:cli');
  const bloco = MAIN.slice(i, MAIN.indexOf('\n});', i) + 4);
  const handlers = {};
  const ctx = vm.createContext({
    ipcMain: { handle: (nome, fn) => { handlers[nome] = fn; } },
    CLIS: {
      gemini: { nome: 'Gemini', conversas: true },
      grok: { nome: 'Grok', conversas: false },
    },
    acp: { sessoes: () => [] },
    remoteEngines: { sessions: async (_engine, remoto) => ({ error: 'Servidor indisponível: ' + remoto.host }) },
    lerNomes: () => ({}),
    tituloAuto: { aplicarNome: (s) => s },
    cliSessions: () => [],
    ...extra,
  });
  vm.runInContext(bloco, ctx);
  return handlers['sessions:cli'];
}

test('main: motor sem lista devolve a lista vazia marcada e sem texto de aviso', async () => {
  const lista = handlerDoMain();
  for (const pedido of ['grok', { engine: 'grok' }]) {
    const r = comoJson(await lista(null, pedido));
    assert.equal(r.semLista, true, 'a lista vem marcada');
    assert.deepEqual(r.itens, []);
    assert.equal('aviso' in r, false, 'o aviso fixo nao volta');
    assert.equal('error' in r, false, 'nao e falha: o motor so nao tem lista');
  }
});

test('main: motor com lista segue igual e falha de leitura de verdade continua voltando como erro', async () => {
  let quebrado = false;
  const lista = handlerDoMain({
    cliSessions: () => { if (quebrado) throw new Error('arquivo ilegível'); return [{ id: 'g1', title: 'Conversa' }]; },
  });
  assert.deepEqual(comoJson(await lista(null, 'gemini')), [{ id: 'g1', title: 'Conversa' }]);
  quebrado = true;
  assert.deepEqual(comoJson(await lista(null, 'gemini')), { error: 'arquivo ilegível' });
  // o servidor remoto nem passa por aqui: a resposta dele chega sem ser tocada
  assert.deepEqual(comoJson(await lista(null, { engine: 'grok', remoto: { host: 'vps-a' } })), { error: 'Servidor indisponível: vps-a' });
});

/* ---------- Historico da lateral: loadHist de verdade + o rodape de verdade ---------- */
function montarLateral({ ativa, api = {} } = {}) {
  const lista = handlerDoMain({ cliSessions: () => [{ id: 'g1', title: 'Conversa do Gemini', cwd: 'C:/A', when: 1 }] });
  class Elemento {
    constructor() { this.filhos = []; this._texto = ''; }
    set innerHTML(_) { this.filhos = []; this._texto = ''; }
    get innerHTML() { return ''; }
    set textContent(valor) { this._texto = String(valor); }
    get textContent() { return this._texto; }
    appendChild(filho) { this.filhos.push(filho); return filho; }
  }
  const porMotor = (valor) => Object.fromEntries(MOTORES.map((m) => [m, valor]));
  const aba = ativa || { id: 'a', tipo: 'local', caminho: 'C:/A' };
  const ctx = vm.createContext({
    document: { createElement: () => new Elemento() },
    window: { api: {
      sessionsClaude: async () => [{ id: 'c1', title: 'Conversa do Claude', cwd: 'C:/A', when: 2 }],
      sessionsCodex: async () => [],
      sessionsCli: (engine) => lista(null, engine),
      sessionsRemoto: async () => [],
      ...api,
    } },
    MOTORES, nomeDoMotor,
    histGen: porMotor(0), pintaGen: porMotor(0), histCache: porMotor(null), historicoCancelar: porMotor(null),
    escondidasPorFiltro: porMotor(0), semPastaFiltrou: porMotor(false), verTodasAsConversas: porMotor(false),
    listaProgressivaSeq: 0, cfg: { verRobos: false, tituloAuto: false },
    HistoricoLista, filaNomesDoHistorico: { adicionar() {} },
    chaveDoLugar: (destino) => destino?.host || 'local', mostrarAviso() {},
    caixaDoMotor: () => new Elemento(),
    abaAtual: () => aba, abasLocais: () => [aba],
    pastasDaAba: () => [], remotoDoAba: (a) => ({ host: a.host }), mesmaPasta: (a, b) => a === b,
    paintHist: async () => {},   // a pintura da lista de cada motor nao entra: o que vale e' o histCache
  });
  vm.runInContext(
    pegarBloco(APP, 'function prepararRespostaHistorico(') + '\n' +
    pegarBloco(APP, 'async function listarSessoesComProgresso(') + '\n' +
    pegarBloco(APP, 'function filtrarHistoricoDaAba(') + '\n' +
    pegarBloco(APP, 'async function loadHist('), ctx);
  // a expressao do rodape, recortada do cockpit-ui.js (renderNavigator)
  const expressao = trecho(UI_SRC, 'const avisosHistorico = ', '}))];');
  return {
    ctx,
    carregar: () => Promise.all(MOTORES.map((engine) => ctx.loadHist(engine))),
    rodape: () => Array.from(vm.runInContext('(function () {' + expressao + ' return avisosHistorico; })()', ctx)),
  };
}

test('Historico: o motor sem lista nao deixa aviso nenhum no rodape e os outros motores seguem normais', async () => {
  const lateral = montarLateral();
  await lateral.carregar();
  assert.deepEqual(lateral.rodape(), [], 'o rodape nao mostra nada');
  assert.equal(lateral.ctx.histCache.grok.length, 0, 'o Grok fica com a lista vazia, sem quebrar');
  assert.equal(lateral.ctx.histCache.claude.length, 1);
  assert.equal(lateral.ctx.histCache.gemini.length, 1);
});

test('Historico: falha de leitura de verdade continua no rodape, e so ela', async () => {
  const lateral = montarLateral({ api: { sessionsClaude: async () => ({ error: 'Disco ilegível' }) } });
  await lateral.carregar();
  assert.deepEqual(lateral.rodape(), ['Claude: Não consegui ler: Disco ilegível']);
});

test('Historico: servidor caido continua aparecendo no rodape, sem trazer o Grok junto', async () => {
  const lateral = montarLateral({
    ativa: { id: 'ssh', tipo: 'ssh', host: 'vps-a' },
    api: { sessionsRemoto: async ({ engine }) => engine === 'claude' ? { error: 'Servidor indisponível' } : [] },
  });
  await lateral.carregar();
  assert.deepEqual(lateral.rodape(), ['Claude: Não consegui ler: Servidor indisponível']);
});

test('Historico: lista parcial continua avisando no rodape', async () => {
  const lateral = montarLateral({
    api: { sessionsClaude: async () => ({ itens: [{ id: 'c1', title: 'Conversa', cwd: 'C:/A' }], aviso: 'A segunda página falhou' }) },
  });
  await lateral.carregar();
  assert.deepEqual(lateral.rodape(), ['Claude: A segunda página falhou']);
});

/* ---------- o rodape so' regrava o texto quando ele muda ---------- */
test('Historico: o aviso do rodape (role=status) so regrava o texto quando ele muda', () => {
  const bloco = trecho(UI_SRC, 'if (avisosHistorico.length) {', "else q('.ck-history-limit', sessionList)?.remove();");
  const escritas = [];
  const aviso = {
    className: 'ck-search-status ck-history-limit', papel: null, _texto: '',
    get textContent() { return this._texto; },
    set textContent(valor) { escritas.push(valor); this._texto = valor; },
    setAttribute(nome, valor) { if (nome === 'role') this.papel = valor; },
    remove() { lateral.children = lateral.children.filter((c) => c !== this); },
  };
  const lateral = { children: [], append(no) { this.children.push(no); } };
  const ctx = vm.createContext({
    avisosHistorico: [],
    sessionList: lateral,
    q: (seletor, pai) => pai.children.find((c) => c.className.includes('ck-history-limit')),
    node: () => aviso,
  });
  const pintar = (avisos) => { ctx.avisosHistorico = avisos; vm.runInContext('(function () {' + bloco + '})()', ctx); };
  pintar(['Claude: Não consegui ler: Servidor indisponível']);
  pintar(['Claude: Não consegui ler: Servidor indisponível']);   // repintura igual: nada de reanunciar
  pintar(['Claude: Não consegui ler: Servidor indisponível']);
  assert.deepEqual(escritas, ['Claude: Não consegui ler: Servidor indisponível']);
  assert.equal(aviso.papel, 'status');
  pintar(['Claude: Não consegui ler: Servidor indisponível', 'Codex: A segunda página falhou']);
  assert.equal(escritas.length, 2, 'texto novo grava');
  assert.equal(aviso.textContent, 'Claude: Não consegui ler: Servidor indisponível · Codex: A segunda página falhou');
  pintar([]);
  assert.equal(lateral.children.length, 0, 'sem aviso, a linha some');
});

/* ---------- busca (Ctrl+K): a paleta de verdade ---------- */
const PALETA = trecho(UI_SRC, '  function palette() {', '\n  async function agentLayer').replace(/\n  async function agentLayer$/, '');
const PREPARO = pegarBloco(APP, 'function prepararRespostaHistorico(') + '\n' + pegarBloco(APP, 'async function listarSessoesComProgresso(');
const assentar = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function montarPaleta(api) {
  const lista = handlerDoMain();
  const nos = [], timers = new Map();
  let idTimer = 0, opcoesDaCamada;
  const no = (tag, cls = '', texto = '') => {
    const n = { tag, className: cls, textContent: texto, children: [], attrs: {}, dataset: {}, handlers: {}, value: '',
      setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; },
      append(...filhos) { this.children.push(...filhos); }, replaceChildren(...filhos) { this.children = [...filhos]; },
      addEventListener(tipo, fn) { this.handlers[tipo] = fn; }, focus() {}, scrollIntoView() {} };
    nos.push(n); return n;
  };
  const camada = { id: 1, closed: false, body: no('div') };
  const botao = (_icone, titulo, acao, cls) => { const n = no('button', cls, titulo); n.handlers.click = acao; return n; };
  const pasta = { id: 'direito', nome: 'Previdência', caminhos: ['C:/Projetos/Previdência'] };
  const ctx = {
    node: no, button: botao, labelled: (titulo, acao, cls) => botao('', titulo, acao, cls),
    q: (_seletor, pai) => pai.children.find((n) => n.attrs['aria-selected'] === 'true'),
    openLayer: (_titulo, opcoes) => { opcoesDaCamada = opcoes; return camada; },
    closeLayer: () => { camada.closed = true; opcoesDaCamada.onClose(); },
    setTimeout: (fn) => { timers.set(++idTimer, fn); return idTimer; }, clearTimeout: (id) => timers.delete(id), queueMicrotask: (fn) => fn(),
    searchSeq: 0, listaProgressivaSeq: 0, searchKind: UI.searchKind, searchText: UI.searchText, STATES: UI.STATES,
    liveRows: () => [], abasLocais: () => [pasta], abaAtual: () => pasta,
    commands: () => [], activate() {}, trocarAbaLocal() {},
    detalheDaPasta: (a) => a.caminhos?.[0] || '', iconeDaPasta: () => 'folder', nomeDoMotor,
    focusPane: { cwd: 'C:/Projeto' }, cfg: { abaAtiva: pasta.id, defCwd: 'C:/Projeto', tituloAuto: false }, HOME: 'C:/QA', HistoricoLista,
    remotoDoPane: () => null, remotoDoAba: () => null, faltaConfigurarServidor: () => false,
    MOTORES, verArquivo() {}, openSession() {}, abrirModalAbaLocal() {},
    window: { api: {
      listDir: async () => ({ entries: [] }), buscarArquivos: async () => [],
      sessionsClaude: async () => [{ id: 'saved', title: 'Revisão da previdência' }],
      sessionsCodex: async () => [],
      sessionsCli: (engine) => lista(null, engine),
      ...api,
    } },
  };
  vm.runInNewContext(PREPARO + '\n' + PALETA + '\nthis.abrir = palette;', ctx);
  ctx.abrir();
  const campo = nos.find((n) => n.className === 'ck-search');
  const resultados = nos.find((n) => n.className === 'ck-results');
  const status = nos.find((n) => n.className === 'ck-search-status');
  return {
    status, resultados: () => resultados.children.filter((n) => n.attrs.role === 'option'),
    async buscar(termo) {
      nos.find((n) => n.dataset.scope === 'agents').handlers.click();
      campo.value = termo; campo.handlers.input();
      const vencidos = [...timers.values()]; timers.clear();
      await Promise.all(vencidos.map((fn) => fn())); await assentar();
    },
  };
}

test('busca: o motor sem lista nao deixa aviso nenhum no fim da pesquisa', async () => {
  const paleta = montarPaleta();
  await paleta.buscar('previdencia');
  assert.equal(paleta.resultados().length, 1, 'a busca segue achando a conversa do Claude');
  assert.match(paleta.status.textContent, /\b1 resultado/);
  assert.doesNotMatch(paleta.status.textContent, AVISO_DO_MOTOR);
});

test('busca: falha de leitura de verdade continua aparecendo no fim da pesquisa', async () => {
  const paleta = montarPaleta({ sessionsClaude: async () => ({ error: 'Servidor indisponível' }) });
  await paleta.buscar('previdencia');
  assert.match(paleta.status.textContent, /Servidor indisponível/);
  assert.doesNotMatch(paleta.status.textContent, AVISO_DO_MOTOR);
});
