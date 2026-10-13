'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const HistoricoLista = require('../src/renderer/historico-lista');
const { lerFonte, pegarBloco } = require('../testes/raiz');
const APP = lerFonte('renderer', 'app.js').replace(/\r\n/g, '\n');

function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function harness() {
  const htmlWrites = [];
  class Element {
    constructor() { this.children = []; this.parent = null; this._text = ''; }
    set innerHTML(value) { htmlWrites.push(String(value)); this.children = []; this._text = ''; }
    get innerHTML() { return ''; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(c => c.textContent).join('|'); }
    appendChild(child) { this.children.push(child); child.parent = this; return child; }
    replaceChildren(...children) { this.children = []; this._text = ''; children.forEach(child => this.appendChild(child)); }
    insertAdjacentHTML(_where, value) { htmlWrites.push(value); }
    addEventListener() {}
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
  }
  const box = new Element();
  const abaA = { id: 'a', tipo: 'local', caminho: 'C:/A' };
  const abaB = { id: 'b', tipo: 'local', caminho: 'C:/B' };
  const ctx = vm.createContext({
    document: { createElement: () => new Element() },
    window: { api: { sessionsClaude: async () => [], sessionsRemoto: async () => [], buscarConversas: async () => ({ achados: [] }) } },
    histGen: { claude: 0 }, pintaGen: { claude: 0 }, histCache: { claude: null },
    historicoCancelar: { claude: null }, listaProgressivaSeq: 0,
    escondidasPorFiltro: { claude: 0 }, semPastaFiltrou: { claude: false },
    verTodasAsConversas: { claude: false }, buscaAtual: { claude: '' }, filtroGrupo: { claude: null },
    cfg: { verRobos: false, tituloAuto: false }, active: abaA, abas: [abaA, abaB],
    HistoricoLista, filaNomesDoHistorico: { adicionar() {} },
    chaveDoLugar: destino => destino?.host || 'local', mostrarAviso() {},
    caixaDoMotor: () => box,
    pastasDaAba: aba => aba?.caminho ? [aba.caminho] : [],
    remotoDoAba: aba => ({ host: aba.host }),
    mesmaPasta: (a, b) => a === b,
    ehFavorita: () => false, listaGrupos: () => [], grupoDaSessao: s => s.grupo,
    grupoPorId: id => ({ id, nome: '<img src=x onerror=alert(1)>' }),
    grupoDoTempo: () => 'Hoje', linhaGrupo: () => new Element(),
    linhaConversa: s => Object.assign(new Element(), { textContent: s.id, sessionId: s.id }),
  });
  vm.runInContext('function abaAtual() { return active; } function abasLocais() { return abas; }\n' +
    pegarBloco(APP, 'function normalizarBuscaHistorico(') + '\n' +
    pegarBloco(APP, 'function prepararRespostaHistorico(') + '\n' +
    pegarBloco(APP, 'async function listarSessoesComProgresso(') + '\n' +
    pegarBloco(APP, 'function filtrarHistoricoDaAba(') + '\n' +
    pegarBloco(APP, 'async function loadHist(') + '\n' + pegarBloco(APP, 'async function paintHist('), ctx);
  return { ctx, box, htmlWrites, abaA, abaB };
}

test('histórico: resposta antiga não altera a lista nem os contadores da aba atual', async () => {
  const h = harness(), first = deferred(), second = deferred();
  let calls = 0;
  h.ctx.window.api.sessionsClaude = () => ++calls === 1 ? first.promise : second.promise;
  const old = h.ctx.loadHist('claude');
  h.ctx.active = h.abaB;
  const current = h.ctx.loadHist('claude');
  second.resolve([{ id: 'atual', title: 'Atual', cwd: 'C:/B' }]);
  await current;
  first.resolve([{ id: 'antiga', title: 'Antiga', cwd: 'C:/A' }, { id: 'outra', cwd: 'C:/Outro' }]);
  await old;
  assert.equal(h.ctx.escondidasPorFiltro.claude, 0);
  assert.equal(h.ctx.histCache.claude[0].id, 'atual');
  assert.match(h.box.textContent, /atual/);
  assert.doesNotMatch(h.box.textContent, /antiga/);
});

test('histórico unificado: título curto preserva a busca pelo pedido original e nomes manuais', async () => {
  const h = harness(); h.ctx.cfg.tituloAuto = true;
  h.ctx.window.api.sessionsClaude = async () => [
    { id: 'auto', title: 'Quero revisar histórico completo da previdência', cwd: 'C:/A', when: 10 },
    { id: 'manual', title: 'Meu nome longo deve ficar intacto', nome: 'Meu nome longo deve ficar intacto', cwd: 'C:/A', when: 20 },
  ];
  await h.ctx.loadHist('claude');
  const automatic = h.ctx.histCache.claude.find(s => s.id === 'auto');
  assert.equal(automatic.title.split(/\s+/).length, 3);
  assert.equal(automatic.tituloOriginal, 'Quero revisar histórico completo da previdência');
  assert.equal(h.ctx.histCache.claude[0].title, 'Meu nome longo deve ficar intacto');
  h.ctx.buscaAtual.claude = 'previdencia';
  await h.ctx.paintHist('claude', h.ctx.histCache.claude);
  assert.equal(h.box.children.filter(c => c.sessionId).map(c => c.sessionId).join(','), 'auto');
});

test('histórico remoto: aviso parcial mantém fichas, destino explícito e opção de robôs', async () => {
  const h = harness(), warnings = [];
  h.ctx.active = { id: 'ssh', tipo: 'ssh', host: 'vps-a' }; h.ctx.cfg.verRobos = true;
  h.ctx.mostrarAviso = value => warnings.push(value);
  h.ctx.window.api.sessionsRemoto = async request => {
    assert.equal(request.remoto.host, 'vps-a'); assert.equal(request.incluirRobos, true);
    return { itens: [{ id: 'remote', title: 'Conversa remota' }], aviso: 'A segunda página falhou' };
  };
  await h.ctx.loadHist('claude');
  assert.equal(h.ctx.histCache.claude.length, 1);
  assert.equal(h.ctx.histCache.claude[0].remotoDestino.host, 'vps-a');
  assert.equal(h.ctx.histCache.claude.aviso, 'A segunda página falhou');
  assert.match(h.box.textContent, /remote/);
  assert.equal(warnings.length, 1); assert.match(warnings[0].id, /vps-a/);
});

test('histórico remoto: a ficha guarda a cópia do destino no início da consulta', async () => {
  const h = harness(), pending = deferred(), destino = { host: 'vps-a', username: 'usuario' };
  h.ctx.window.api.sessionsRemoto = () => pending.promise;
  const running = h.ctx.listarSessoesComProgresso('claude', { remoto: destino });
  destino.host = 'vps-b';
  pending.resolve([{ id: 'remote', title: 'Histórico remoto' }]);
  const rows = await running;
  assert.equal(rows[0].remotoDestino.host, 'vps-a');
});

test('histórico parcial: o aviso permanece quando lista, grupo ou busca ficam vazios', async () => {
  const h = harness(), list = [{id:'one',title:'Outro título'}];
  list.aviso = 'Página parcial <erro>';
  h.ctx.buscaAtual.claude = 'inexistente';
  await h.ctx.paintHist('claude', list);
  assert.match(h.box.textContent, /Página parcial <erro>/);
  h.ctx.buscaAtual.claude = ''; h.ctx.filtroGrupo.claude = 'vazio';
  await h.ctx.paintHist('claude', list);
  assert.match(h.box.textContent, /Página parcial <erro>/);
  const empty = []; empty.truncated = true;
  await h.ctx.paintHist('claude', empty);
  assert.match(h.box.textContent, /Histórico parcial/);
  assert.match(h.box.textContent, /Nenhuma conversa/);
  assert.ok(h.htmlWrites.every(value=>!value.includes('<erro>')));
});

test('histórico: rejeição do IPC tira o carregamento e apresenta erro como texto', async () => {
  const h = harness();
  h.ctx.window.api.sessionsClaude = async () => { throw new Error('<erro de conexão>'); };
  await h.ctx.loadHist('claude');
  assert.equal(h.box.textContent, 'Não consegui ler: <erro de conexão>');
  assert.equal(h.ctx.histCache.claude.length, 0);
  assert.equal(h.ctx.histCache.claude.aviso, 'Não consegui ler: <erro de conexão>');
  assert.equal(h.ctx.histCache.claude.error, true);
  assert.ok(h.htmlWrites.every(value => !value.includes('<erro de conexão>')));
});

test('histórico: busca pendente não apaga falha de uma nova carga', async () => {
  const h = harness(), search = deferred();
  h.ctx.buscaAtual.claude = 'trecho';
  h.ctx.window.api.buscarConversas = () => search.promise;
  const old = h.ctx.paintHist('claude', [{ id: 'antiga', title: 'Antiga' }]);
  h.ctx.window.api.sessionsClaude = async () => ({ error: 'Servidor indisponível' });
  await h.ctx.loadHist('claude');
  search.resolve({ achados: [{ id: 'antiga', trecho: 'trecho' }] });
  await old;
  assert.equal(h.box.textContent, 'Não consegui ler: Servidor indisponível');
});

test('histórico: entrar em pasta ou SSH não herda o aviso de PC inteiro', async () => {
  const h = harness();
  h.ctx.semPastaFiltrou.claude = true;
  h.ctx.escondidasPorFiltro.claude = 9;
  await h.ctx.loadHist('claude');
  assert.equal(h.ctx.semPastaFiltrou.claude, false);
  h.ctx.semPastaFiltrou.claude = true;
  h.ctx.active = { id: 'ssh', tipo: 'ssh', host: 'servidor' };
  await h.ctx.loadHist('claude');
  assert.equal(h.ctx.semPastaFiltrou.claude, false);
  assert.equal(h.ctx.escondidasPorFiltro.claude, 0);
});

test('busca: falha no conteúdo preserva os resultados pelo nome e termina o indicador', async () => {
  const h = harness();
  h.ctx.buscaAtual.claude = 'teste';
  h.ctx.window.api.buscarConversas = async () => { throw new Error('IPC fora do ar'); };
  await h.ctx.paintHist('claude', [{ id: 'pelo-nome', title: 'Teste' }, { id: 'pelo-corpo', title: 'Outro' }]);
  assert.match(h.box.textContent, /pelo-nome/);
  assert.match(h.box.textContent, /IPC fora do ar/);
  assert.doesNotMatch(h.box.textContent, /procurando dentro/);
});

test('busca: termo e nome do grupo são texto literal mesmo contendo HTML', async () => {
  const h = harness(), attack = '<img src=x onerror=alert(1)>';
  h.ctx.buscaAtual.claude = attack;
  await h.ctx.paintHist('claude', [{ id: 'um', title: 'Outro' }]);
  assert.equal(h.box.textContent, 'Nada com “' + attack + '”.');
  h.ctx.buscaAtual.claude = '';
  h.ctx.filtroGrupo.claude = 'vazio';
  await h.ctx.paintHist('claude', [{ id: 'um', title: 'Outro' }]);
  assert.equal(h.box.textContent, 'Nada em "' + attack + '" ainda.');
  assert.ok(h.htmlWrites.every(value => !value.includes(attack)));
});

test('busca: título ausente não falha e resultados mantêm a ordem retornada pela ponte', async () => {
  const h = harness();
  h.ctx.buscaAtual.claude = 'teste';
  h.ctx.window.api.buscarConversas = async ({ itens }) => {
    assert.equal(itens.length, 2);
    return { achados: [{ id: 'dois' }, { id: 'um' }] };
  };
  await h.ctx.paintHist('claude', [{ id: 'um' }, { id: 'dois', title: null }]);
  assert.equal(h.box.children.filter(c => c.sessionId).map(c => c.sessionId).join(','), 'dois,um');
});

test('busca: quando todos os nomes correspondem, nenhuma leitura de arquivo é pedida', async () => {
  const h = harness();
  h.ctx.buscaAtual.claude = 'teste';
  h.ctx.window.api.buscarConversas = async () => { assert.fail('não há conteúdo restante para buscar'); };
  await h.ctx.paintHist('claude', Array.from({ length: 1000 }, (_, i) => ({ id: String(i), title: 'Teste ' + i })));
  assert.equal(h.box.children.filter(c => c.sessionId).length, 1000);
});

test('campo: liberar painel desconecta observador, cancela quadro e gravação adiada', () => {
  const scheduled = new Map(), frames = new Map(), observers = [];
  let sequence = 0;
  const inp = { style: {}, clientWidth: 200, scrollHeight: 50, value: 'rascunho', isConnected: true, listeners: [],
    addEventListener(event, fn) { this.listeners.push({ event, fn }); } };
  const P = {};
  const ctx = vm.createContext({ P, inp, Math,
    setTimeout: fn => { scheduled.set(++sequence, fn); return sequence; }, clearTimeout: id => scheduled.delete(id),
    requestAnimationFrame: fn => { frames.set(++sequence, fn); return sequence; }, cancelAnimationFrame: id => frames.delete(id),
    savePanes: () => {}, ResizeObserver: class {
      constructor(fn) { this.fn = fn; this.disconnected = false; observers.push(this); }
      observe() {} disconnect() { this.disconnected = true; }
    },
  });
  const start = APP.indexOf('  const grow = () =>');
  const end = APP.indexOf("  inp.addEventListener('keydown'", start);
  vm.runInContext(APP.slice(start, end), ctx);
  observers[0].fn();
  inp.listeners.filter(l => l.event === 'input').forEach(l => l.fn());
  assert.equal(frames.size, 1);
  assert.equal(scheduled.size, 1);
  P._limparCampo();
  assert.equal(observers[0].disconnected, true);
  assert.equal(frames.size, 0);
  assert.equal(scheduled.size, 0);
});

test('fechar painel libera campo e histórico paginado antes de remover a tela', async () => {
  const events = [], P = { id: 'um', el: { remove: () => events.push('remove'), style: {} },
    _limparCampo: () => events.push('campo'), historyPager: { dispose: () => events.push('histórico') } };
  const other = { id: 'dois', el: { style: {} } };
  const ctx = vm.createContext({ P, panes: new Map([[P.id, P], [other.id, other]]),
    window: { api: { paneStop: async () => {} } }, acharPainel: () => P, $: () => null,
    clearInterval() {}, clearTimeout() {}, pararIrProFim() {}, soltarNavArquivos() {},
    soltarPendente() {}, matarTerminaisDoPainel() {}, montarColunas() {}, savePanes() {},
    sincronizarPendencias() {}, quadro: null, focusPane: other,
  });
  vm.runInContext(pegarBloco(APP, 'async function closePane('), ctx);
  await ctx.closePane('um');
  assert.equal(events.join(','), 'campo,histórico,remove');
  assert.equal(P._limparCampo, null);
  assert.equal(P.historyPager, null);
});

test('preferências: falha da ponte mostra aviso persistente com ID único e texto sanitizado', () => {
  const notices = [], listeners = new Map();
  let handler, removed = 0;
  const ctx = vm.createContext({
    mostrarAviso: notice => notices.push(notice),
    window: { api: { onConfigSaveError: fn => { handler = fn; return () => { removed++; }; } },
      addEventListener: (event, fn) => listeners.set(event, fn),
      removeEventListener: event => listeners.delete(event),
    },
  });
  vm.runInContext(pegarBloco(APP, 'function acompanharFalhaAoSalvarConfig('), ctx);
  const cleanup = ctx.acompanharFalhaAoSalvarConfig();
  handler({ error: 'C:/segredo/token', message: '<img src=x>' });
  handler({});
  assert.equal(notices.length, 2);
  assert.equal(notices[0].id, 'config-save-error');
  assert.equal(notices[1].id, notices[0].id);
  assert.equal(notices[0].fixo, true);
  assert.match(notices[0].texto, /Não foi possível salvar/);
  assert.doesNotMatch(notices[0].texto, /segredo|token|<img/);
  assert.ok(notices[1].occurrence > notices[0].occurrence, 'nova falha volta a avisar se o aviso anterior foi dispensado');
  listeners.get('unload')();
  cleanup();
  handler({});
  assert.equal(removed, 1);
  assert.equal(notices.length, 2);
  assert.equal(listeners.size, 0);
  const boot = APP.slice(APP.indexOf('(async function boot()'));
  assert.ok(boot.indexOf('acompanharFalhaAoSalvarConfig();') < boot.indexOf('await window.api.home()'));
});

test('preferências: prévia e preload antigo continuam abrindo sem o evento novo', () => {
  const ctx = vm.createContext({ window: { api: {} } });
  vm.runInContext(pegarBloco(APP, 'function acompanharFalhaAoSalvarConfig('), ctx);
  const cleanup = ctx.acompanharFalhaAoSalvarConfig();
  assert.equal(typeof cleanup, 'function');
  cleanup();
});
