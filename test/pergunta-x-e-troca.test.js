'use strict';
/* Rodada 2 da leva 5h, item 1: o X do cartao + uma troca no chip engolia a mensagem seguinte.
   Painel do Claude LOCAL com a pergunta do MCP "perguntar" (a que o INSTRUCOES_COCKPIT manda o Claude usar): o X guarda a pergunta como
   "esperando resposta por texto" (selo + dica) e a proxima mensagem viraria a resposta. So' que as trocas do chip (modelo, esforco, Sonnet
   reserva e motor, tambem pelo Ctrl+Shift+M) param o Claude: o 'pane:stop' chama claudeStop -> limparPerguntasDoPainel, que apagava o pedido
   do disco SEM avisar a tela. O selo ficava vivo, e a mensagem seguinte ia como textoLivre de uma pergunta morta: o main gravava a resposta
   numa pasta que ninguem mais le e devolvia { ok: true } - a mensagem sumia, o motor novo nunca a recebia.

   Aqui os dois lados rodam com o codigo de verdade, ligados um ao outro como no app (o emit do main cai no tratarEventoDoPainel da tela, o
   perguntaResponder da tela cai no handler do main):
   - main: varrerPerguntasAgora (o pedido vira 'pergunta'), 'pane:stop' -> claudeStop, 'pergunta:responder';
   - tela: desenharPergunta, o X, send -> responderPerguntaPelaCaixa, tratarEventoDoPainel e as quatro trocas.
   O que a spec pede: "Se a pergunta expirar ou for cancelada enquanto ele escreve: o selo some, e a mensagem vai como mensagem normal". */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');
const interacao = require('../src/claude-interacao');
const proto = require('../src/codex-protocol');

const APP = lerFonte('renderer', 'app.js');
const MAIN = lerFonte('main.js');

/* ---------------- DOM pequeno (o mesmo de perguntas-em-paginas.test.js) ---------------- */
class El {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase(); this.doc = doc;
    this.filhos = []; this.pai = null; this._classes = []; this.attrs = {}; this.eventos = {};
    this.style = {}; this.dataset = {}; this._texto = ''; this._html = '';
    this.value = ''; this.placeholder = ''; this.disabled = false; this.type = ''; this.title = '';
    this.onkeydown = null;
  }
  get className() { return this._classes.join(' '); }
  set className(v) { this._classes = String(v || '').split(/\s+/).filter(Boolean); }
  get classList() {
    const eu = this;
    return {
      add: (...c) => c.forEach((x) => { if (!eu._classes.includes(x)) eu._classes.push(x); }),
      remove: (...c) => { eu._classes = eu._classes.filter((x) => !c.includes(x)); },
      contains: (c) => eu._classes.includes(c),
      toggle: (c, f) => { const on = f === undefined ? !eu._classes.includes(c) : !!f; if (on) eu.classList.add(c); else eu.classList.remove(c); return on; },
    };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  get textContent() { return this._texto + this._html.replace(/<[^>]*>/g, '') + this.filhos.map((f) => f.textContent).join(''); }
  set textContent(v) { this.filhos = []; this._html = ''; this._texto = String(v); }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this.filhos = []; this._texto = ''; this._html = String(v); }
  appendChild(c) { if (c.pai) c.remove(); c.pai = this; this.filhos.push(c); return c; }
  remove() { if (this.pai) this.pai.filhos = this.pai.filhos.filter((f) => f !== this); this.pai = null; }
  contains(n) { for (let x = n; x; x = x.pai) if (x === this) return true; return false; }
  addEventListener(t, fn) { (this.eventos[t] = this.eventos[t] || []).push(fn); }
  disparar(t, extra) {
    const ev = { type: t, target: this, parou: false, padrao: false, isComposing: false, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
      preventDefault() { this.padrao = true; }, stopPropagation() { this.parou = true; }, ...(extra || {}) };
    for (let x = this; x && !ev.parou; x = x.pai) {
      for (const f of (x.eventos[t] || [])) f.call(x, ev);
      if (!ev.parou && typeof x['on' + t] === 'function') x['on' + t].call(x, ev);
    }
    return ev;
  }
  click() { return this.disabled ? null : this.disparar('click'); }
  focus() { this.doc.activeElement = this; }
  todos() { const r = []; const ir = (e) => { for (const f of e.filhos) { r.push(f); ir(f); } }; ir(this); return r; }
  achar(cls) { return this.todos().find((e) => e._classes.includes(cls)) || null; }
  acharTodos(cls) { return this.todos().filter((e) => e._classes.includes(cls)); }
  querySelectorAll(sel) { const m = /^\.([\w-]+)$/.exec(sel); if (!m) throw new Error('seletor que o teste nao conhece: ' + sel); return this.acharTodos(m[1]); }
}
const visivel = (el) => { for (let x = el; x; x = x.pai) if (x._classes.includes('hidden')) return false; return true; };
function acharPorSeletor(raiz, sel) {
  const m = /^\.([\w-]+)(?:\[data-([\w-]+)\])?$/.exec(sel);
  if (!m) throw new Error('seletor que o teste nao conhece: ' + sel);
  return raiz.todos().find((e) => e._classes.includes(m[1]) && (!m[2] || e.dataset[m[2]] !== undefined)) || null;
}

/* ---------------- recortes do fonte ---------------- */
const funcao = (nome) => { const a = 'function ' + nome + '('; const i = APP.indexOf(a); if (i < 0) throw new Error('sem ' + nome); return (APP.slice(i - 6, i) === 'async ' ? 'async ' : '') + pegarBloco(APP, a, nome); };
const constante = (nome) => { const m = new RegExp('^const ' + nome + ' = ', 'm').exec(APP); return APP.slice(m.index, APP.indexOf('\n', m.index)).replace(/^const /, 'var '); };
const funcaoMain = (nome) => pegarBloco(MAIN, 'function ' + nome + '(', nome);
const handlerDe = (nome) => { const i = MAIN.indexOf("ipcMain.handle('" + nome + "'"); const resto = MAIN.slice(i); return resto.slice(0, resto.indexOf('=> {')) + pegarBloco(resto, '=> {', nome) + ');'; };

/* O cenario: o Claude pergunta (mcp__cockpit__perguntar), ele clica no X, faz a troca e escreve a instrucao seguinte. `troca` e' a funcao da tela
   que o menuzinho do chip chama. Devolve tudo o que o teste quer olhar. */
async function cenario(troca, { motorDaPergunta = 'claude' } = {}) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'x-e-troca-'));
  /* ---------- main ---------- */
  const emitidos = [];
  let R = null;   // o contexto da tela (abaixo)
  const M = vm.createContext({
    console, JSON, String, Array, Object, Map, Set, RegExp, Math, Date, Error, Number, fs, path, proto, interacao,
    handlers: {}, ipcMain: { handle: (n, fn) => { M.handlers[n] = fn; } },
    PASTA_PERGUNTAS: () => pasta, perguntasVistas: new Set(), VIDA_MAX_PEDIDO: 35 * 60 * 1000,
    claudePanes: new Map(), pedidosClaude: new Map(), pendingApprovals: new Map(), autoLiberadas: new Map(), perguntasCodex: new Map(),
    remoteEngines: { questionOwns: () => false, answer: () => false }, remotePaneTargets: new Map(),
    interactionBroker: { cancelScope() {} }, esquecerMudancasDoPainel() {}, vigiaTurno: { desligar() {} },
    observabilidade: { encerrarPainel() {} }, limparAnexosClaudeRemotos() {}, limparSeq() {}, claudeRemoto: new Map(), claudeCwd: new Map(),
    zumbis: new Set(), acp: { parar() {}, responderPermissao() {} }, ehCli: () => false, cliParar() {},
    codex: { paneToThread: new Map(), paneTurn: new Map(), paneMsgId: new Map(), threadToPane: new Map() }, codexReq: async () => ({}), codexReply() {},
    escreverRespostaClaude: () => true,
    // o que o main manda para a tela cai direto no tratarEventoDoPainel de verdade
    emit: (paneId, kind, data) => { emitidos.push({ paneId, kind, ...(data || {}) }); if (R) R.tratarEventoDoPainel({ paneId, kind, ...(data || {}) }); },
  });
  vm.runInContext([funcaoMain('podarVistas'), funcaoMain('lerPedido'), funcaoMain('varrerPerguntasAgora'), funcaoMain('limparPerguntasDoPainel'),
    funcaoMain('descartarPerguntasCodex'), funcaoMain('descartarPedidosClaude'), funcaoMain('descartarPermissoes'), funcaoMain('claudeStop'),
    handlerDe('pergunta:responder'), handlerDe('pane:stop')].join('\n'), M);

  /* ---------- tela ---------- */
  const doc = { activeElement: null }; doc.createElement = (t) => new El(t, doc);
  const mk = (tag, cls) => { const e = new El(tag, doc); if (cls) e.className = cls; return e; };
  const raiz = mk('body'); doc.body = raiz;
  const el = raiz.appendChild(mk('section', 'pane'));
  const chat = el.appendChild(mk('div', 'pane-chat'));
  const caixa = el.appendChild(mk('div', 'pane-perg hidden'));
  const selo = el.appendChild(mk('div', 'p-resp hidden'));
  const campo = el.appendChild(mk('textarea', 'p-input')); campo.placeholder = 'Escreva aqui…';
  const P = { id: 'p1', el, chat, engine: motorDaPergunta, busy: true, started: true, anexos: [], hist: [], abaId: 'pc', model: 'claude-sonnet-5', effort: 'high', blocks: new Set(), mode: 'auto' };
  const reg = { respostas: [], resultados: [], notas: [], avisos: [], paneSend: [], paneStart: [], paneStop: [], normal: null };
  R = vm.createContext({
    console, Map, Set, Promise, JSON, Math, String, Number, Array, Object, RegExp, Error, Date,
    setTimeout: () => 0, clearTimeout() {}, document: doc, reg, cfg: { fallbackClaude: false },
    $: (sel, r) => acharPorSeletor(r || raiz, sel), ico: (n) => '<svg data-ico="' + n + '"></svg>',
    panes: new Map([[P.id, P]]), panesFundo: new Map(), acharPainel: (id) => (id === P.id ? P : null), focusPane: P,
    note: (p, texto) => { reg.notas.push(texto); }, quadro: null, avisarNoQuadro() {},
    avisarPainel() {}, piscar() {}, scroll() {}, pintarAbasLocal() {}, sincronizarPendencias() {}, irAoPainel() {},
    contaEmAlteracao: () => false, pararBuscaDeArquivos() {}, soltarNavArquivos() {}, pintarAnexos() {},
    limparCitacao: (p) => { p.citacao = null; }, devolverCitacao() {}, userMsg: () => ({}), desfazerEnvio() {},
    juntarNaFila: (p, t) => t, pintarFila() {}, avisoEnvio: (p, t) => { reg.avisos.push(t); return null; },
    // o que as trocas do chip chamam alem do paneStop: pintura do painel
    esforcosDe: () => [{ id: 'high' }, { id: 'max' }], fillModels() {}, pintarModo() {}, antesDaTroca: () => ({}), avisarTroca() {},
    guardarConversaPraVoltar() {}, setDot() {}, savePanes() {}, cancelarReligar() {}, esconderPermissao() {}, pararTrabalho() {}, limparPassos() {},
    // o caminho normal de uma mensagem termina aqui (o teste so' quer saber se ELA chegou, nao o resto do envio)
    voltarDaFila: (p, q) => q, guardarPrompt: (t) => { reg.normal = t; throw new Error('PAROU-AQUI'); }, RESERVA_CLAUDE: 'claude-sonnet-5',
    // o que o trocarMotor chama alem do paneStop
    remotoDoPane: () => null, motorDisponivel: { claude: true, codex: true }, COMO_INSTALAR: {}, capacidadeRemota: async () => true, guardarEstadoDoMotor() {},
    restaurarEstadoDoMotor: () => false, esquecerPassos() {}, limparPlano() {}, limparAuditoria() {}, zerarTurno() {}, mostrarPastaNoPainel() {}, paintEngine() {},
    modoValido: (e, m) => m, marcaTroca() {}, nomeDoMotor: (e) => e, pintarTokens() {},
    window: {
      api: {
        perguntaResponder: async (a) => { reg.respostas.push(JSON.parse(JSON.stringify(a))); const r = await M.handlers['pergunta:responder'](null, a); reg.resultados.push(JSON.parse(JSON.stringify(r))); return r; },
        paneStop: async (o) => { reg.paneStop.push(o); return M.handlers['pane:stop'](null, o); },
        paneSend: async (o) => { reg.paneSend.push(o); return true; }, paneStart: async (o) => { reg.paneStart.push(o); return true; },
        setConfig() {},
      },
      CockpitUI: { layers: [], closeLayer() {}, cancelResume() {}, refresh() {} },
    },
  });
  vm.runInContext([constante('DICA_DA_RESPOSTA'), constante('CITACAO_ABRE'), funcao('comCitacao'), funcao('esconderPergunta'), funcao('mostrarPergunta'),
    funcao('proximaPergunta'), funcao('desenharPergunta'), funcao('responderPerguntaPelaCaixa'), funcao('tratarEventoDoPainel'), funcao('estadoDoPainel'),
    funcao('send'), funcao('destravarPainel'), funcao('trocarModeloDoPainel'), funcao('alternarFallbackClaude'), funcao('trocarEsforco'), funcao('trocarMotor'),
    funcao('montarContexto')].join('\n'), R);

  /* 1) o Claude chama mcp__cockpit__perguntar: o pergunta-mcp.js grava o pedido (mesmo formato do perguntarEEsperar) e o main o leva a tela */
  const id = 'p1-mgk1-1';
  fs.writeFileSync(path.join(pasta, id + '.pedido.json'), JSON.stringify({ id, painel: 'p1', criado: Date.now(), perguntas: [
    { pergunta: 'Qual caminho?', opcoes: [{ rotulo: 'A' }, { rotulo: 'B' }] }] }));
  M.varrerPerguntasAgora();
  const linha = {};
  linha.cartaoAbriu = visivel(caixa) && !!P.perguntaAberta;
  /* 2) o X: "a minha proxima mensagem vira a resposta" */
  caixa.achar('perg-x').click();
  linha.seloDepoisDoX = visivel(selo);
  /* 3) a troca no chip: o main para o Claude de proposito */
  const antes = emitidos.length;
  await troca(R, P);
  linha.eventosDoMainNaTroca = emitidos.slice(antes).map((e) => e.kind);
  linha.pedidoAindaNaPasta = fs.existsSync(path.join(pasta, id + '.pedido.json'));
  linha.seloDepoisDaTroca = visivel(selo);
  linha.respostaPorTextoDepoisDaTroca = !!P.respostaPorTexto;
  linha.dica = campo.placeholder;
  linha.estadoNaTorre = R.estadoDoPainel(P).txt;
  /* 4) ele escreve a proxima instrucao, para o motor */
  campo.value = 'Agora troca o titulo da pagina para Contato';
  try { await R.send(P); } catch (e) { if (!String(e && e.message).includes('PAROU-AQUI')) throw e; }
  linha.perguntaResponderComTextoLivre = reg.respostas.map((r) => r.textoLivre || null);
  linha.foiComoMensagemNormal = reg.normal;
  linha.notas = reg.notas.slice();
  linha.arquivosNaPasta = fs.readdirSync(pasta);
  fs.rmSync(pasta, { recursive: true, force: true });
  return linha;
}

const TEXTO = 'Agora troca o titulo da pagina para Contato';
function confere(l, onde) {
  assert.equal(l.cartaoAbriu, true, onde + ': o pedido do MCP virou o cartao na tela');
  assert.equal(l.seloDepoisDoX, true, onde + ': o X mostrou o selo "respondendo a pergunta"');
  assert.equal(l.pedidoAindaNaPasta, false, onde + ': a troca para o Claude e apaga o pedido (isto ja era assim)');
  assert.ok(l.eventosDoMainNaTroca.includes('pergunta-cancelada'), onde + ': o main AVISA a tela que a pergunta acabou (antes: ' + JSON.stringify(l.eventosDoMainNaTroca) + ')');
  assert.equal(l.seloDepoisDaTroca, false, onde + ': o selo some');
  assert.equal(l.respostaPorTextoDepoisDaTroca, false, onde + ': a tela nao espera mais resposta por texto');
  assert.equal(l.dica, 'Escreva aqui…', onde + ': a dica da caixa volta');
  assert.notEqual(l.estadoNaTorre, 'esperando sua resposta por texto', onde + ': a Torre nao diz que espera resposta');
  assert.deepEqual(l.perguntaResponderComTextoLivre, [], onde + ': a mensagem seguinte NAO vira textoLivre de pergunta morta');
  assert.equal(l.foiComoMensagemNormal, TEXTO, onde + ': ela segue o caminho de sempre, para o motor');
  assert.deepEqual(l.arquivosNaPasta, [], onde + ': nenhuma resposta orfa na pasta de perguntas');
  assert.ok(l.notas.some((n) => /foi encerrada|expirou/.test(n)), onde + ': a conversa conta que a pergunta acabou');
}

test('✕ + trocar o modelo (menuzinho do modelo): o selo some e a mensagem seguinte vai ao motor', async () => {
  confere(await cenario((R, P) => R.trocarModeloDoPainel(P, { id: 'claude-opus-5' })), 'troca de modelo');
});

test('✕ + trocar o esforco (barrinhas do menuzinho do modelo): idem', async () => {
  confere(await cenario((R, P) => R.trocarEsforco(P, 'max')), 'troca de esforco');
});

test('✕ + ligar o Sonnet reserva (escudo do menuzinho do modelo): idem', async () => {
  confere(await cenario((R, P) => R.alternarFallbackClaude(P)), 'Sonnet reserva');
});

test('✕ + trocar de motor (menuzinho do motor ou Ctrl+Shift+M): idem', async () => {
  confere(await cenario((R, P) => R.trocarMotor(P, 'codex')), 'troca de motor');
});

test('sem troca nenhuma o X continua igual: a proxima mensagem vira a resposta e o pedido some da pasta', async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'x-sem-troca-'));
  try {
    const M = vm.createContext({ console, JSON, String, Array, Object, Map, Set, Date, fs, path, proto, interacao, handlers: {}, ipcMain: { handle: (n, fn) => { M.handlers[n] = fn; } },
      PASTA_PERGUNTAS: () => pasta, perguntasVistas: new Set(), remoteEngines: { questionOwns: () => false }, pedidosClaude: new Map(), perguntasCodex: new Map(),
      escreverRespostaClaude: () => true, codexReply() {} });
    vm.runInContext(handlerDe('pergunta:responder'), M);
    fs.writeFileSync(path.join(pasta, 'p1-mgk1-1.pedido.json'), '{}');
    assert.deepEqual({ ...(await M.handlers['pergunta:responder'](null, { id: 'p1-mgk1-1', textoLivre: TEXTO })) }, { ok: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(pasta, 'p1-mgk1-1.resposta.json'), 'utf8')), { textoLivre: TEXTO });
    assert.equal(fs.existsSync(path.join(pasta, 'p1-mgk1-1.pedido.json')), false);
  } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});
