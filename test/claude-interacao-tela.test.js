'use strict';
/* Tarefa 8 (26/09/2026): a tela do plano pronto do Claude.
   As funcoes de verdade do app.js (cartao, Executar/Ajustar, desvio do send,
   trava da troca de modo, Pendencias) recortadas e rodadas num vm com um DOM
   pequeno (molde: "pedidos antigos nao aprovam..." de test/cockpit-ui.test.js).
   O que se prova: chave velha nao responde; dois cliques = um panePlano; "ok"
   executa e "ok mas ..." vira ajuste; Shift+Tab com plano esperando nao troca
   o modo; o Executar volta pro modo de antes SEM religar o motor. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');
const UI = require('../src/renderer/cockpit-ui.js');

const APP = lerFonte('renderer', 'app.js');

function funcao(nome) {
  const assinatura = 'function ' + nome + '(';
  const i = APP.indexOf(assinatura);
  assert.notEqual(i, -1, 'funcao nao encontrada: ' + nome);
  return (APP.slice(i - 6, i) === 'async ' ? 'async ' : '') + pegarBloco(APP, assinatura, nome);
}
function constante(nome) {
  const m = new RegExp('^const ' + nome + ' = ', 'm').exec(APP);
  assert.ok(m, 'constante nao encontrada: ' + nome);
  return APP.slice(m.index, APP.indexOf('\n', m.index)).replace(/^const /, 'var ');
}

/* ---------------- DOM pequeno ---------------- */
class El {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase(); this.doc = doc;
    this.filhos = []; this.pai = null; this._classes = []; this.attrs = {}; this.eventos = {};
    this.style = {}; this.dataset = {}; this._texto = ''; this._html = '';
    this.value = ''; this.placeholder = ''; this.disabled = false; this.type = ''; this.title = ''; this.href = '';
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
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  remove() { if (this.pai) this.pai.filhos = this.pai.filhos.filter((f) => f !== this); this.pai = null; }
  contains(n) { for (let x = n; x; x = x.pai) if (x === this) return true; return false; }
  get isConnected() { let x = this; while (x.pai) x = x.pai; return x === this.doc.raiz; }
  addEventListener(t, fn) { (this.eventos[t] = this.eventos[t] || []).push(fn); }
  disparar(t, extra) {
    const ev = { type: t, target: this, parou: false, padrao: false, isComposing: false,
      preventDefault() { this.padrao = true; }, stopPropagation() { this.parou = true; }, ...(extra || {}) };
    for (let x = this; x && !ev.parou; x = x.pai) {
      for (const f of (x.eventos[t] || [])) f.call(x, ev);
      if (t === 'click' && typeof x.onclick === 'function' && x === this) x.onclick(ev);
    }
    return ev;
  }
  click() { return this.disabled ? null : this.disparar('click'); }
  focus() { this.doc.activeElement = this; }
  todos() { const r = []; const ir = (e) => { for (const f of e.filhos) { r.push(f); ir(f); } }; ir(this); return r; }
  achar(cls) { return this.todos().find((e) => e._classes.includes(cls)) || null; }
  acharTodos(cls) { return this.todos().filter((e) => e._classes.includes(cls)); }
}
function documento() {
  const doc = { activeElement: null };
  doc.raiz = new El('body', doc);
  doc.createElement = (t) => new El(t, doc);
  return doc;
}

const PLANO = ['constante:PALAVRAS_DE_LIBERAR', 'constante:DICA_DO_PLANO', 'mostrarPlanoPronto', 'cartaoDoPlano', 'pintarPlanoEsperando',
  'fecharPlanoPronto', 'responderPlano', 'modoDepoisDoPlano', 'responderPlanoPelaCaixa'];

function tela(extras) {
  const doc = documento();
  const reg = { planos: [], pendentes: [], notas: [], avisos: [], paradas: [], salvou: 0, pintouModo: 0, baloes: [], desfeitos: [], md: [] };
  const api = {
    panePlano: (o) => { reg.planos.push(o); return reg.respostaDoPlano ? reg.respostaDoPlano(o) : Promise.resolve({ ok: true, modo: 'bypass' }); },
    paneStop: async (o) => { reg.paradas.push(o); return true; },
  };
  const ctx = vm.createContext({
    console, Map, Set, Promise, JSON, Math, String, Number, Array, Object, RegExp, Error, Date,
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; }, clearTimeout: () => {},
    document: doc, reg, window: { api },
    $: (sel, r) => (r || doc.raiz).achar(sel.replace(/^\./, '')),
    ico: (n) => '<svg data-ico="' + n + '"></svg>',
    mdSeguro: (t) => { reg.md.push(t); return '<p>' + String(t).replace(/</g, '&lt;') + '</p>'; },
    linkarArquivos() {}, verArquivo() {}, remotoDoPane: () => null,
    clearEmpty() {}, piscar() {}, scroll() {}, pintarAbasLocal() {}, sincronizarPendencias() {},
    note: (P, t) => reg.notas.push(t), avisoEnvio: (P, t) => { reg.avisos.push(t); return null; },
    pintarModo: () => { reg.pintouModo++; }, savePanes: () => { reg.salvou++; },
    MODOS: { claude: [
      { id: 'manual', nome: 'Manual', desc: 'Pergunta antes de cada ação' },
      { id: 'auto-edit', nome: 'Editar automaticamente', desc: 'Mexe nos arquivos sozinho' },
      { id: 'plan', nome: 'Plano', desc: 'Só estuda e mostra o plano' },
      { id: 'auto', nome: 'Auto', desc: 'Segue sozinho no que é seguro' },
      { id: 'bypass', nome: 'Sem pedir permissão', desc: 'Faz tudo sem perguntar' },
    ] },
    // o envio (send) ate' o desvio do plano
    contaEmAlteracao: () => false, pararBuscaDeArquivos() {}, soltarNavArquivos() {}, pintarAnexos() {},
    limparCitacao: (P) => { P.citacao = null; }, devolverCitacao: (P, t) => { if (!P.citacao) P.citacao = t; },
    userMsg: (P, texto, anexos) => { const b = { texto, anexos }; reg.baloes.push(b); return { balao: b, entrada: null, citacao: null }; },
    desfazerEnvio: (P, escrito, texto) => { reg.desfeitos.push(texto); const c = P.el.achar('p-input'); if (c && !c.value) c.value = texto; },
    ...(extras || {}),
  });
  const pecas = PLANO.map((n) => (n.startsWith('constante:') ? constante(n.slice(10)) : funcao(n)));
  vm.runInContext(pecas.join('\n') + '\n' + [constante('CITACAO_ABRE'), funcao('comCitacao'), funcao('send'),
    funcao('girarModo'), funcao('mudarModoDoPainel'), funcao('estadoDoPainel'), funcao('montarCorpoDaPendencia')].join('\n'), ctx);
  const h = {
    ctx, reg, doc,
    painel(extra) {
      const el = doc.raiz.appendChild(new El('section', doc));
      const chat = el.appendChild(new El('div', doc)); chat.className = 'pane-chat';
      const inp = el.appendChild(new El('textarea', doc)); inp.className = 'p-input'; inp.placeholder = 'Escreva aqui…';
      return { id: 'p1', el, chat, engine: 'claude', mode: 'plan', modoAntesDoPlano: 'bypass', modoReal: 'plan',
        busy: true, started: true, anexos: [], hist: [], abaId: 'pc', ...(extra || {}) };
    },
    campo: (P) => P.el.achar('p-input'),
    cartao: (P) => P.chat.achar('ck-plano-pronto'),
  };
  return h;
}
const esperar = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
const EV = { chave: 'claude_p_1_req-1', plano: '## Plano\n1. Ler o app.js\n2. Trocar o botão', arquivoDoPlano: 'C:\\plano.md' };

test('o cartao entra na conversa com o plano em markdown seguro, role=group e sem roubar o foco', () => {
  const h = tela();
  const P = h.painel();
  h.doc.activeElement = h.campo(P);
  h.ctx.mostrarPlanoPronto(P, EV);
  const d = h.cartao(P);
  assert.ok(d, 'cartao .ck-plano-pronto na conversa');
  assert.equal(d.getAttribute('role'), 'group');
  assert.equal(d.getAttribute('aria-label'), 'Plano pronto');
  assert.deepEqual(h.reg.md, [EV.plano], 'o plano passa pelo mdSeguro');
  assert.equal(d.achar('ck-plx-estado').getAttribute('aria-live'), 'polite');
  assert.equal(d.achar('ck-plx-executar').textContent, 'Executar');
  assert.equal(d.achar('ck-plx-ajustar').textContent, 'Ajustar');
  assert.equal(h.doc.activeElement, h.campo(P), 'o foco continua na caixa de escrever');
  assert.equal(P.planoPendente.chave, EV.chave);
  assert.equal(h.campo(P).placeholder, vm.runInContext('DICA_DO_PLANO', h.ctx));
  // nenhuma classe .pl-* (a checklist de 132 px de altura)
  assert.ok(d.todos().concat(d).every((x) => !x._classes.some((c) => /^pl-/.test(c))));
  // o mesmo pedido de novo nao duplica o cartao
  h.ctx.mostrarPlanoPronto(P, EV);
  assert.equal(P.chat.acharTodos('ck-plano-pronto').length, 1);
});

test('plano vazio com arquivo: o cartao aponta pro arquivo em vez de um corpo em branco', () => {
  const h = tela();
  const P = h.painel();
  h.ctx.mostrarPlanoPronto(P, { chave: 'k', plano: '   ', arquivoDoPlano: 'C:\\Users\\qa\\.claude\\plans\\x.md' });
  const a = h.cartao(P).achar('arquivo');
  assert.ok(a, 'link para o arquivo do plano');
  assert.equal(a.textContent, 'C:\\Users\\qa\\.claude\\plans\\x.md');
  assert.deepEqual(h.reg.md, [], 'nada de markdown vazio');
});

test('Executar: um panePlano, volta pro modo de antes sem religar o motor e grava o painel', async () => {
  const h = tela();
  const P = h.painel();
  h.ctx.mostrarPlanoPronto(P, EV);
  const bt = h.cartao(P).achar('ck-plx-executar');
  bt.focus();   // clicou no botao: o foco esta' nele
  bt.click(); bt.click();   // dois cliques
  await esperar();
  assert.equal(h.doc.activeElement, h.campo(P), 'o botao sumiu: o foco volta pra caixa de escrever');
  assert.equal(h.reg.planos.length, 1, 'dois cliques = um envio');
  assert.deepEqual({ ...h.reg.planos[0] }, { paneId: 'p1', chave: EV.chave, aprovar: true, texto: '' });
  assert.equal(P.mode, 'bypass');
  assert.equal(P.modoReal, null);
  assert.equal(P.modoAntesDoPlano, null);
  assert.ok(h.reg.pintouModo >= 1);
  assert.ok(h.reg.salvou >= 1);
  assert.equal(h.reg.paradas.length, 0, 'sem paneStop: o motor segue na mesma sessao');
  assert.equal(P.planoPendente, null);
  const d = h.cartao(P);
  assert.equal(d.achar('ck-plx-executar'), null, 'os botoes saem do cartao respondido');
  assert.match(d.achar('ck-plx-estado').textContent, /Sem pedir permissão/);
  assert.equal(h.campo(P).placeholder, 'Escreva aqui…', 'a dica da caixa volta ao normal');
});

test('chave velha nao responde: cartao encerrado ou trocado por um plano novo ignora o clique', async () => {
  const h = tela();
  const P = h.painel();
  h.ctx.mostrarPlanoPronto(P, EV);
  const velho = h.cartao(P).achar('ck-plx-executar');
  // o main desistiu deste (fim do turno): cancelamento de OUTRA chave nao fecha o atual
  h.ctx.fecharPlanoPronto(P, 'outra-chave', 'x');
  assert.equal(P.planoPendente.chave, EV.chave);
  h.ctx.fecharPlanoPronto(P, EV.chave, 'O plano não está mais esperando resposta.');
  h.ctx.mostrarPlanoPronto(P, { chave: 'claude_p_2_req-2', plano: '## Outro' });
  velho.disparar('click');   // o botao solto do cartao velho
  await esperar();
  assert.equal(h.reg.planos.length, 0, 'o clique velho nao respondeu o plano novo');
  // a resposta atrasada de um plano que ja foi encerrado tambem nao mexe no modo
  let solta;
  h.reg.respostaDoPlano = () => new Promise((r) => { solta = r; });
  P.chat.acharTodos('ck-plano-pronto')[1].achar('ck-plx-executar').click();
  assert.equal(h.reg.planos.length, 1);
  h.ctx.fecharPlanoPronto(P, 'claude_p_2_req-2', 'O plano não está mais esperando resposta.');
  solta({ ok: true, modo: 'bypass' });
  await esperar();
  assert.equal(P.mode, 'plan', 'plano encerrado no meio do envio: o modo nao muda');
});

test('Ajustar abre um campo curto no cartao; Enter manda o texto e o Esc dali nao para o painel', async () => {
  const h = tela();
  const P = h.painel();
  h.ctx.mostrarPlanoPronto(P, EV);
  const d = h.cartao(P);
  const ajuste = d.achar('ck-plx-ajuste');
  assert.ok(ajuste.classList.contains('hidden'));
  d.achar('ck-plx-ajustar').click();
  assert.equal(ajuste.classList.contains('hidden'), false);
  const campo = d.achar('ck-plx-campo');
  assert.equal(h.doc.activeElement, campo, 'o foco vai pro campo so porque voce clicou em Ajustar');
  const esc = campo.disparar('keydown', { key: 'Escape' });
  assert.equal(esc.parou, true, 'o Esc do campo nao sobe (nao interrompe o turno)');
  assert.ok(ajuste.classList.contains('hidden'));
  d.achar('ck-plx-ajustar').click();
  campo.value = '';
  campo.disparar('keydown', { key: 'Enter' });
  await esperar();
  assert.equal(h.reg.planos.length, 0, 'ajuste vazio nao vai');
  campo.value = '  troca o passo 2  ';
  campo.disparar('input');
  const enter = campo.disparar('keydown', { key: 'Enter' });
  assert.equal(enter.parou, true);
  await esperar();
  assert.deepEqual({ ...h.reg.planos[0] }, { paneId: 'p1', chave: EV.chave, aprovar: false, texto: 'troca o passo 2' });
  assert.equal(P.mode, 'plan', 'ajuste nao muda o modo');
  assert.equal(P.planoPendente, null);
});

test('erro na resposta: o cartao continua, destrava e diz o motivo; plano encerrado fecha', async () => {
  const h = tela();
  const P = h.painel();
  h.reg.respostaDoPlano = () => Promise.resolve({ error: 'O motor caiu.' });
  h.ctx.mostrarPlanoPronto(P, EV);
  h.cartao(P).achar('ck-plx-executar').click();
  await esperar();
  assert.equal(P.planoPendente && P.planoPendente.chave, EV.chave);
  assert.equal(h.cartao(P).achar('ck-plx-executar').disabled, false);
  assert.match(h.cartao(P).achar('ck-plx-estado').textContent, /O motor caiu/);
  h.reg.respostaDoPlano = () => Promise.resolve({ error: 'Este plano não está mais esperando resposta.', encerrado: true });
  h.cartao(P).achar('ck-plx-executar').click();
  await esperar();
  assert.equal(P.planoPendente, null);
  assert.equal(P.mode, 'plan');
});

test('com o plano esperando, a caixa responde: "ok" executa e "ok mas troca o passo 2" vira ajuste (antes da fila)', async () => {
  for (const [texto, aprovar] of [['ok', true], ['Pode executar!', true], ['sim.', true], ['manda ver', true], ['LIBERADO', true], ['executa', true], ['pode', true],
    ['ok mas troca o passo 2', false], ['não, refaz', false], ['okay', false]]) {
    const h = tela();
    const P = h.painel();
    h.ctx.mostrarPlanoPronto(P, EV);
    h.campo(P).value = texto;
    await h.ctx.send(P);
    assert.equal(h.reg.planos.length, 1, texto);
    assert.equal(h.reg.planos[0].aprovar, aprovar, texto);
    assert.equal(h.reg.planos[0].texto, aprovar ? '' : texto, texto);
    assert.equal(P.queued, undefined, texto + ': nao foi pra fila');
    assert.equal(h.campo(P).value, '', texto);
    assert.deepEqual(h.reg.baloes.map((b) => b.texto), [texto], 'o que voce escreveu fica na conversa');
    assert.equal(P.mode, aprovar ? 'bypass' : 'plan', texto);
  }
});

test('ajuste pela caixa leva o trecho preso e os anexos; "ok" com trecho vira ajuste, nunca aprova', async () => {
  const h = tela();
  const P = h.painel({ citacao: '2. Trocar o botão', anexos: [{ path: 'C:\\print.png', ext: 'png' }] });
  h.ctx.mostrarPlanoPronto(P, EV);
  h.campo(P).value = 'ok';
  await h.ctx.send(P);
  assert.equal(h.reg.planos.length, 1);
  assert.equal(h.reg.planos[0].aprovar, false);
  assert.equal(h.reg.planos[0].texto, h.ctx.comCitacao('2. Trocar o botão', 'ok')
    + '\n\nArquivos que anexei (abra cada um antes de responder):\n- C:\\print.png');
  assert.equal(P.citacao, null);
  assert.equal(P.anexos.length, 0, 'os anexos foram junto com o ajuste');
});

test('resposta pela caixa que nao chegou devolve o texto ao campo', async () => {
  const h = tela();
  const P = h.painel();
  h.reg.respostaDoPlano = () => Promise.resolve({ error: 'Este plano não está mais esperando resposta.', encerrado: true });
  h.ctx.mostrarPlanoPronto(P, EV);
  h.campo(P).value = 'troca o passo 2';
  await h.ctx.send(P);
  assert.deepEqual(h.reg.desfeitos, ['troca o passo 2']);
  assert.equal(h.campo(P).value, 'troca o passo 2');
});

test('enquanto a resposta do plano vai, Enter na caixa nao manda outra nem apaga o texto', async () => {
  const h = tela();
  const P = h.painel();
  let solta;
  h.reg.respostaDoPlano = () => new Promise((r) => { solta = r; });
  h.ctx.mostrarPlanoPronto(P, EV);
  h.cartao(P).achar('ck-plx-executar').click();
  h.campo(P).value = 'troca o passo 2';
  await h.ctx.send(P);
  assert.equal(h.reg.planos.length, 1, 'Executar + Enter = um envio');
  assert.equal(h.campo(P).value, 'troca o passo 2');
  assert.equal(h.reg.avisos.length, 1);
  solta({ ok: true, modo: 'bypass' });
  await esperar();
});

test('Shift+Tab e o menu nao trocam o modo com plano ou pergunta esperando', async () => {
  const h = tela({ antesDaTroca: () => ({}), avisarTroca() {}, guardarConversaPraVoltar() {}, destravarPainel() {}, setDot() {},
    cfg: {}, });
  h.ctx.window.api.setConfig = () => {};
  h.ctx.window.CockpitUI = { cancelResume() {} };
  const P = h.painel({ mode: 'auto-edit', modoAntesDoPlano: null, busy: true });
  P.planoPendente = { chave: 'k' };
  await h.ctx.girarModo(P);
  assert.equal(P.mode, 'auto-edit');
  assert.equal(h.reg.paradas.length, 0, 'nao mata o turno');
  assert.deepEqual(h.reg.avisos, ['Responda o plano ou a pergunta antes de trocar o modo.']);
  await h.ctx.mudarModoDoPainel(P, { id: 'bypass', nome: 'Sem pedir permissão', desc: 'x' });
  assert.equal(P.mode, 'auto-edit');
  assert.equal(h.reg.paradas.length, 0);
  // pergunta bloqueante esperando: tambem nao troca
  P.planoPendente = null;
  P.perguntaAberta = { id: 'claude_q_1_x', bloqueante: true };
  await h.ctx.girarModo(P);
  assert.equal(P.mode, 'auto-edit');
  assert.equal(h.reg.paradas.length, 0);
  // Leva final: o aviso agora explicita plano OU pergunta; o bloqueio e' o mesmo.
  assert.deepEqual(h.reg.avisos, Array(3).fill('Responda o plano ou a pergunta antes de trocar o modo.'));
  // os outros motores seguem como eram: o Codex com pergunta aberta ainda troca
  const C = h.painel({ engine: 'codex', mode: 'manual', busy: false, perguntaAberta: { id: 'codex_q_1', bloqueante: true } });
  h.ctx.MODOS.codex = [{ id: 'manual', nome: 'Manual', desc: 'x' }, { id: 'auto', nome: 'Auto', desc: 'y' }];
  await h.ctx.girarModo(C);
  assert.equal(C.mode, 'auto');
});

test('entrar no Plano guarda o modo de antes (Shift+Tab e menu); o Plano nunca vira padrao dos chats novos', async () => {
  const cfg = { defMode: 'bypass' };
  const h = tela({ antesDaTroca: () => ({}), avisarTroca() {}, guardarConversaPraVoltar() {}, destravarPainel() {}, setDot() {}, cfg });
  h.ctx.window.api.setConfig = () => {};
  h.ctx.window.CockpitUI = { cancelResume() {} };
  const P = h.painel({ mode: 'auto-edit', modoAntesDoPlano: null, busy: false });
  await h.ctx.girarModo(P);   // auto-edit -> plan
  assert.equal(P.mode, 'plan');
  assert.equal(P.modoAntesDoPlano, 'auto-edit');
  await h.ctx.girarModo(P);   // plan -> auto: saiu do Plano, o "de antes" some
  assert.equal(P.mode, 'auto');
  assert.equal(P.modoAntesDoPlano, null);
  const Q = h.painel({ mode: 'bypass', modoAntesDoPlano: null, busy: false });
  await h.ctx.mudarModoDoPainel(Q, { id: 'plan', nome: 'Plano', desc: 'x' });
  assert.equal(Q.mode, 'plan');
  assert.equal(Q.modoAntesDoPlano, 'bypass');
  assert.equal(cfg.defMode, 'bypass', 'o Plano nao virou o padrao');
  await h.ctx.mudarModoDoPainel(Q, { id: 'plan', nome: 'Plano', desc: 'x' });
  assert.equal(Q.modoAntesDoPlano, 'bypass', 'escolher Plano de novo nao apaga o de antes');
  await h.ctx.mudarModoDoPainel(Q, { id: 'auto', nome: 'Auto', desc: 'x' });
  assert.equal(cfg.defMode, 'auto');
  assert.equal(Q.modoAntesDoPlano, null);
});

test('Torre e Pendencias: plano esperando e "Sua vez", e o cartao das Pendencias usa a mesma trava', async () => {
  assert.equal(UI.stateOf({ planoPendente: {} }), 'attention');
  assert.equal(UI.stateOf({ busy: true, planoPendente: { chave: 'k' } }), 'attention');
  const h = tela();
  const P = h.painel();
  h.ctx.mostrarPlanoPronto(P, EV);
  assert.equal(h.ctx.estadoDoPainel(P).cls, 'espera');
  assert.match(h.ctx.estadoDoPainel(P).txt, /plano/);
  const corpo = h.doc.raiz.appendChild(new El('div', h.doc));
  h.ctx.montarCorpoDaPendencia(P, corpo);
  const copia = corpo.achar('ck-plano-pronto');
  assert.ok(copia, 'o cartao aparece nas Pendencias');
  let solta;
  h.reg.respostaDoPlano = () => new Promise((r) => { solta = r; });
  copia.achar('ck-plx-executar').click();
  h.cartao(P).achar('ck-plx-executar').click();
  assert.equal(h.reg.planos.length, 1, 'copia + cartao da conversa = um envio');
  solta({ ok: true, modo: 'bypass' });
  await esperar();
  assert.equal(copia.achar('ck-plx-executar'), null, 'a copia tambem fecha');
  assert.equal(h.cartao(P).achar('ck-plx-executar'), null);
});

for (const texto of ['ok', '  sim!  ', 'pode executar', 'LIBERADO', 'manda ver']) {
  test('rascunho anterior ao plano nao aprova: ' + texto, async () => {
    const h = tela(); const P = h.painel();
    h.campo(P).value = texto;
    h.ctx.mostrarPlanoPronto(P, EV);
    await h.ctx.send(P);
    assert.equal(h.reg.planos.length, 0);
    assert.equal(h.campo(P).value, texto);
    assert.equal(P.mode, 'plan');
    assert.equal(h.reg.baloes.length, 0);
    assert.match(h.reg.avisos[0], /Leia o plano e confirme/);
    h.campo(P).value = 'executa';
    await h.ctx.send(P);
    assert.equal(h.reg.planos.length, 1);
    assert.equal(h.reg.planos[0].aprovar, true);
  });
}
test('rascunho antigo permite ajuste com anexos e confirmacao explicita pelo botao', async () => {
  const h = tela(); const P = h.painel();
  h.campo(P).value = 'ok'; h.ctx.mostrarPlanoPronto(P, EV);
  h.cartao(P).achar('ck-plx-executar').click(); await esperar();
  assert.equal(h.reg.planos[0].aprovar, true);
  const Q = h.painel({ anexos: [{ path: 'c:/a.txt' }] });
  h.campo(Q).value = 'ok'; h.ctx.mostrarPlanoPronto(Q, EV);
  await h.ctx.send(Q);
  assert.equal(h.reg.planos[1].aprovar, false);
});

test('Limpar a tela repoe o mesmo plano, preserva trava e rascunho e nao acumula cartoes', async () => {
  const h = tela({ esquecerPassos() {} }); const P = h.painel({ blocks: new Map(), tools: new Map() });
  vm.runInContext(funcao('limparTelaDoPainel'), h.ctx);
  assert.match(funcao('menuSkills'), /nome: 'Limpar a tela'[^\n]*act: \(\) => limparTelaDoPainel\(P\)/);
  h.campo(P).value = 'ok'; h.ctx.mostrarPlanoPronto(P, EV);
  const est = P.planoPendente;
  const copia = h.doc.raiz.appendChild(h.ctx.cartaoDoPlano(P, est, true));
  h.ctx.limparTelaDoPainel(P); h.ctx.limparTelaDoPainel(P);
  assert.equal(P.planoPendente, est);
  assert.equal(P.chat.acharTodos('ck-plano-pronto').length, 1);
  assert.equal(est.cartoes.length, 2, 'so o cartao atual e a copia conectada');
  assert.equal(h.cartao(P).achar('ck-plx-corpo').textContent.includes('Ler o app.js'), true);
  await h.ctx.send(P);
  assert.equal(h.reg.planos.length, 0, 'limpar nao transforma rascunho velho em consentimento');
  let solta; h.reg.respostaDoPlano = () => new Promise(r => { solta = r; });
  copia.achar('ck-plx-executar').click();
  h.ctx.limparTelaDoPainel(P);
  assert.equal(h.cartao(P).achar('ck-plx-executar').disabled, true);
  h.cartao(P).achar('ck-plx-executar').click();
  assert.equal(h.reg.planos.length, 1);
  solta({ ok: true, modo: 'bypass' }); await esperar();
  assert.equal(P.planoPendente, null);
  assert.equal(h.cartao(P).achar('ck-plx-executar'), null);
  h.ctx.limparTelaDoPainel(P);
  assert.equal(h.cartao(P), null, 'plano respondido nao volta');
});

for (const plano of [undefined, '', ' \n\t ']) {
  test('Limpar a tela recusa apagar a resposta que contem o plano sem texto proprio: ' + JSON.stringify(plano), async () => {
    let esquecidos = 0;
    const h = tela({ esquecerPassos() { esquecidos++; } });
    const P = h.painel({ blocks: new Map([['resposta', 'plano']]), tools: new Map([['passo', 'ler']]) });
    vm.runInContext(funcao('limparTelaDoPainel'), h.ctx);
    const resposta = P.chat.appendChild(new El('div', h.doc));
    resposta.textContent = 'PLANO ORIGINAL: mudar so o arquivo A';
    h.campo(P).value = 'ok';
    h.ctx.mostrarPlanoPronto(P, { chave: 'sem-texto-sem-arquivo', plano });
    const est = P.planoPendente;
    const cartao = h.cartao(P);
    const copia = h.doc.raiz.appendChild(h.ctx.cartaoDoPlano(P, est, true));
    h.ctx.limparTelaDoPainel(P); h.ctx.limparTelaDoPainel(P);
    assert.ok(P.chat.contains(resposta), 'a resposta original continua consultavel');
    assert.match(P.chat.textContent, /PLANO ORIGINAL: mudar so o arquivo A/);
    assert.equal(h.cartao(P), cartao, 'o mesmo cartao e seus campos permanecem');
    assert.equal(P.planoPendente, est);
    assert.equal(est.cartoes.length, 2);
    assert.equal(P.blocks.get('resposta'), 'plano');
    assert.equal(P.tools.get('passo'), 'ler');
    assert.equal(esquecidos, 0, 'a recusa acontece antes de apagar passos');
    assert.match(h.reg.avisos[0], /Responda o plano antes de limpar a tela.*resposta anterior/);
    await h.ctx.send(P);
    assert.equal(h.reg.planos.length, 0, 'rascunho anterior continua sem autorizar');
    let solta;
    h.reg.respostaDoPlano = () => new Promise(r => { solta = r; });
    copia.achar('ck-plx-executar').click();
    h.ctx.limparTelaDoPainel(P);
    assert.ok(P.chat.contains(resposta), 'preserva tambem enquanto a resposta esta em envio');
    assert.equal(cartao.achar('ck-plx-executar').disabled, true);
    cartao.achar('ck-plx-executar').click();
    assert.equal(h.reg.planos.length, 1, 'a trava continua compartilhada com Pendencias');
    assert.equal(h.reg.planos[0].chave, 'sem-texto-sem-arquivo');
    assert.equal(h.reg.planos[0].aprovar, true);
    solta({ ok: true, modo: 'bypass' }); await esperar();
    assert.equal(P.planoPendente, null);
    h.ctx.limparTelaDoPainel(P);
    assert.equal(P.chat.textContent, '', 'depois de responder, a limpeza funciona');
    assert.equal(P.blocks.size, 0);
    assert.equal(P.tools.size, 0);
    assert.equal(esquecidos, 1);
  });
}

test('Limpar a tela permite plano com apenas arquivo e preserva o acesso a ele', () => {
  const h = tela({ esquecerPassos() {} });
  const P = h.painel({ blocks: new Map(), tools: new Map() });
  vm.runInContext(funcao('limparTelaDoPainel'), h.ctx);
  const resposta = P.chat.appendChild(new El('div', h.doc));
  resposta.textContent = 'Resposta anterior';
  h.ctx.mostrarPlanoPronto(P, { chave: 'so-arquivo', arquivoDoPlano: 'C:/plano.md' });
  const est = P.planoPendente;
  h.ctx.limparTelaDoPainel(P);
  assert.equal(P.chat.textContent.includes('Resposta anterior'), false);
  assert.equal(P.planoPendente, est);
  assert.equal(h.cartao(P).achar('arquivo').textContent, 'C:/plano.md');
  assert.equal(h.cartao(P).achar('ck-plx-executar').disabled, false);
  assert.equal(h.reg.avisos.length, 0);
});

test('Executar mostra o modo de destino visivel e acessivel, inclusive nas Pendencias', () => {
  const h = tela();
  for (const [antes, nome] of [['manual', 'Manual'], ['auto-edit', 'Editar automaticamente'], ['auto', 'Auto'],
    ['bypass', 'Sem pedir permissão'], [null, 'Manual'], ['plan', 'Manual'], ['invalido', 'Manual']]) {
    const P = h.painel({ modoAntesDoPlano: antes }); h.ctx.mostrarPlanoPronto(P, EV);
    for (const d of [h.cartao(P), h.ctx.cartaoDoPlano(P, P.planoPendente, true)]) {
      assert.equal(d.achar('ck-plx-destino').textContent, 'Vai rodar em: ' + nome);
      assert.equal(d.achar('ck-plx-executar').title, 'Executar em: ' + nome);
      assert.equal(d.achar('ck-plx-executar').getAttribute('aria-label'), 'Executar em: ' + nome);
    }
  }
  const css = lerFonte('renderer', 'cockpit-ui.css');
  assert.match(css, /\.ck-app \.ck-plx-destino,[\s\S]*?color: var\(--ink-muted\)/);
});
