'use strict';
/* Leva 1, Tarefa 5 (R2-01): a proxima pergunta da fila nao pode sumir.
   A pergunta aberta e' sempre filaPerg[0]. Quando ela expira (teto de 30 min) ou
   o motor a cancela, o 'pergunta-cancelada' ja' a tira da fila (filter) - e o
   proximaPergunta() ainda fazia um shift(), que jogava fora a PROXIMA: a caixa
   sumia, a 2a pergunta nunca aparecia e o agente ficava parado esperando.
   As funcoes de verdade do app.js (tratarEventoDoPainel, mostrarPergunta,
   desenharPergunta, proximaPergunta, esconderPergunta) rodam num vm com um DOM
   pequeno (molde: test/nomes-agentes.test.js e testes/teste-pendencias-pergunta.js). */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');

const APP = lerFonte('renderer', 'app.js');

/* ---------------- DOM pequeno ---------------- */
class El {
  constructor() {
    this.filhos = []; this._classes = new Set(); this._html = ''; this._texto = '';
    this.dataset = {}; this.attrs = {}; this.eventos = {}; this.style = {};
    this.disabled = false; this.type = ''; this.title = ''; this.placeholder = ''; this.value = '';
  }
  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  get classList() {
    const eu = this;
    return {
      add: (...c) => c.forEach((x) => eu._classes.add(x)),
      remove: (...c) => c.forEach((x) => eu._classes.delete(x)),
      contains: (c) => eu._classes.has(c),
      toggle: (c, on) => { const liga = on === undefined ? !eu._classes.has(c) : !!on; if (liga) eu._classes.add(c); else eu._classes.delete(c); return liga; },
    };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.filhos = []; this._texto = ''; }
  get textContent() { return this._texto + this.filhos.map((f) => f.textContent).join(''); }
  set textContent(v) { this._texto = String(v); this.filhos = []; }
  appendChild(c) { this.filhos.push(c); return c; }
  addEventListener(tipo, fn) { (this.eventos[tipo] = this.eventos[tipo] || []).push(fn); }
  descendentes() { return this.filhos.flatMap((f) => [f, ...f.descendentes()]); }
  querySelectorAll(sel) { const cls = sel.replace(/^\./, ''); return this.descendentes().filter((e) => e._classes.has(cls)); }
  clicar() { if (this.disabled) return; for (const fn of (this.eventos.click || [])) fn({ stopPropagation() {}, preventDefault() {} }); }
}

/* Um painel com a caixa de perguntas escondida, e as funcoes reais do app.js. */
function montar() {
  const caixa = new El();
  caixa.classList.add('hidden');                 // nasce escondida, como no HTML
  const P = { id: 'p1', el: {} };
  const notas = [], respostas = [], cont = { abas: 0, pendencias: 0 };
  const ctx = vm.createContext({
    console, setTimeout: () => 0,
    document: { createElement: () => new El() },
    // leva 5h: o cartao agora desenha o ✕ (e as setas, quando ha mais de uma pergunta) com ico(); aqui o desenho nao importa
    ico: (nome) => '<svg data-ico="' + nome + '"></svg>',
    $: (sel) => (sel === '.pane-perg' ? caixa : null),
    panes: new Map([[P.id, P]]), panesFundo: new Map(),
    acharPainel: (id) => (id === P.id ? P : null),
    note: (p, texto, erro, fixo) => { notas.push({ texto, erro: !!erro, fixo: !!fixo }); },
    avisarPainel: () => {}, piscar: () => {}, scroll: () => {}, avisarNoQuadro: () => {}, quadro: null,
    pintarAbasLocal: () => { cont.abas++; },
    sincronizarPendencias: () => { cont.pendencias++; },
    // copia pro reino de fora: assert.deepEqual compara prototipo e o vm tem os proprios
    window: { api: { perguntaResponder: (a) => { respostas.push(JSON.parse(JSON.stringify(a))); } } },
  });
  for (const f of ['tratarEventoDoPainel', 'mostrarPergunta', 'desenharPergunta', 'proximaPergunta', 'esconderPergunta']) {
    vm.runInContext(pegarBloco(APP, 'function ' + f + '(', f), ctx);
  }
  const evento = (ev) => ctx.tratarEventoDoPainel({ paneId: P.id, ...ev });
  const botoes = (cls) => caixa.querySelectorAll('.' + cls);
  return {
    P, caixa, notas, respostas, cont,
    // o agente pergunta: a 1a abre a caixa, as outras esperam na fila
    pergunta: (id, texto) => evento({ kind: 'pergunta', id, bloqueante: true,
      perguntas: [{ pergunta: texto, opcoes: [{ rotulo: 'sim' }, { rotulo: 'não' }] }] }),
    // o .cancelar do MCP (teto de 30 min) chega sem texto
    expira: (id) => evento({ kind: 'pergunta-cancelada', id }),
    // o motor cancela (turno acabou, painel parou) e manda o motivo
    cancela: (id) => evento({ kind: 'pergunta-cancelada', id, texto: 'A pergunta foi encerrada: o turno acabou ou o painel parou.' }),
    // o usuario clica na opcao e em Responder / em "Decide voce"
    responder: (rotulo) => {
      botoes('perg-op').find((b) => b.textContent.includes(rotulo)).clicar();
      botoes('perg-ok')[0].clicar();
    },
    decideVoce: () => botoes('perg-nao')[0].clicar(),
    fila: () => Array.from(P.filaPerg || [], (q) => q.id),
    aberta: () => (P.perguntaAberta ? P.perguntaAberta.id : null),
    visivel: () => !caixa.classList.contains('hidden'),
  };
}

test('A expira com B na fila: B aparece na caixa, segue na fila e responde ao agente', () => {
  const t = montar();
  t.pergunta('A', 'Qual pasta?'); t.pergunta('B', 'Posso publicar?');
  assert.deepEqual(t.fila(), ['A', 'B']);
  assert.equal(t.aberta(), 'A');
  assert.match(t.caixa.textContent, /Qual pasta\?/);

  t.expira('A');

  assert.deepEqual(t.fila(), ['B'], 'a B continua na fila: nao pode ir embora junto com a A');
  assert.equal(t.aberta(), 'B');
  assert.equal(t.visivel(), true, 'a caixa segue aberta, agora com a B');
  assert.match(t.caixa.textContent, /Posso publicar\?/);
  assert.doesNotMatch(t.caixa.textContent, /Qual pasta\?/);
  assert.match(t.notas.at(-1).texto, /expirou/);
  assert.equal(t.notas.at(-1).erro, true);

  t.responder('sim');
  assert.deepEqual(t.respostas, [{ id: 'B', respostas: ['sim'] }], 'o agente recebe a resposta da B');
  assert.deepEqual(t.fila(), []);
  assert.equal(t.visivel(), false);
});

test('o motor cancela A com B na fila: B aparece com o motivo na conversa; aviso repetido nao derruba a B', () => {
  const t = montar();
  t.pergunta('A', 'Qual pasta?'); t.pergunta('B', 'Posso publicar?');

  t.cancela('A');

  assert.deepEqual(t.fila(), ['B']);
  assert.equal(t.aberta(), 'B');
  assert.equal(t.visivel(), true);
  assert.match(t.caixa.textContent, /Posso publicar\?/);
  assert.match(t.notas.at(-1).texto, /foi encerrada/);

  // o motor as vezes avisa duas vezes (descarte do turno + processo que cai depois)
  t.cancela('A');
  assert.deepEqual(t.fila(), ['B']);
  assert.equal(t.aberta(), 'B');
  assert.equal(t.visivel(), true);
});

test('fila de tres: cada expiracao abre a proxima e so a ultima fecha a caixa', () => {
  const t = montar();
  t.pergunta('A', 'Pergunta A?'); t.pergunta('B', 'Pergunta B?'); t.pergunta('C', 'Pergunta C?');

  t.expira('A');
  assert.deepEqual(t.fila(), ['B', 'C']);
  assert.equal(t.aberta(), 'B');
  assert.match(t.caixa.textContent, /Pergunta B\?/);

  t.expira('B');
  assert.deepEqual(t.fila(), ['C']);
  assert.equal(t.aberta(), 'C');
  assert.match(t.caixa.textContent, /Pergunta C\?/);

  t.expira('C');
  assert.deepEqual(t.fila(), []);
  assert.equal(t.aberta(), null);
  assert.equal(t.visivel(), false);
});

test('so a ultima pergunta expira: a caixa fecha e a aba e as Pendencias sao atualizadas', () => {
  const t = montar();
  t.pergunta('A', 'Qual pasta?');
  const abas = t.cont.abas, pendencias = t.cont.pendencias;

  t.expira('A');

  assert.deepEqual(t.fila(), []);
  assert.equal(t.aberta(), null);
  assert.equal(t.visivel(), false);
  assert.ok(t.cont.abas > abas, 'a bolinha ambar da aba apaga');
  assert.ok(t.cont.pendencias > pendencias, 'a lista de Pendencias atualiza');
});

test('pergunta que esperava na fila e e cancelada: a caixa aberta nao muda', () => {
  const t = montar();
  t.pergunta('A', 'Qual pasta?'); t.pergunta('B', 'Posso publicar?');
  const notasAntes = t.notas.length;

  t.expira('B');

  assert.deepEqual(t.fila(), ['A']);
  assert.equal(t.aberta(), 'A');
  assert.equal(t.visivel(), true);
  assert.match(t.caixa.textContent, /Qual pasta\?/);
  assert.equal(t.notas.length, notasAntes, 'nenhum aviso: a caixa que esta aberta e a mesma');
});

test('responder a aberta (ou "Decide voce") continua abrindo a proxima; aviso de expiracao atrasado nao a derruba', () => {
  const t = montar();
  t.pergunta('A', 'Qual pasta?'); t.pergunta('B', 'Posso publicar?'); t.pergunta('C', 'Pode apagar?');

  t.responder('sim');
  assert.deepEqual(t.respostas, [{ id: 'A', respostas: ['sim'] }]);
  assert.deepEqual(t.fila(), ['B', 'C']);
  assert.equal(t.aberta(), 'B');
  assert.match(t.caixa.textContent, /Posso publicar\?/);

  // o teto de 30 min da A estourou justo depois da resposta: a B nao tem nada a ver com isso
  t.expira('A');
  assert.deepEqual(t.fila(), ['B', 'C']);
  assert.equal(t.aberta(), 'B');

  t.decideVoce();
  assert.deepEqual(t.respostas.at(-1), { id: 'B', cancelado: true });
  assert.deepEqual(t.fila(), ['C']);
  assert.equal(t.aberta(), 'C');
  assert.match(t.caixa.textContent, /Pode apagar\?/);
});

/* Leva 3, Tarefa 6 (R2-07): a .pane-perg é fixa (vem do modelo do painel) e nunca é recriada. Cada pergunta desenhada
   somava um addEventListener('keydown') nela, que guardava os botões e as respostas antigas até o painel fechar.
   Medida: ouvintes de teclado na caixa depois de 5 perguntas, a quinta aberta (antes 5; depois 1). */
const ouvintesDeTecla = (cx) => (cx.eventos.keydown || []).length + (typeof cx.onkeydown === 'function' ? 1 : 0);

test('cinco perguntas seguidas, a quinta ABERTA, deixam exatamente UM ouvinte de teclado na caixa fixa (R2-07)', () => {
  const t = montar();
  for (const id of ['A', 'B', 'C', 'D']) { t.pergunta(id, 'Pergunta ' + id + '?'); t.responder('sim'); }
  // a quinta fica aberta: com a pergunta aberta o ouvinte existe, e é um só (nem 0, que o <= 1 deixava passar, nem 5 acumulados).
  // Desde a leva 4 o esconderPergunta solta o ouvinte; com a caixa escondida são 0, no teste abaixo.
  t.pergunta('E', 'Pergunta E?');
  assert.equal(t.visivel(), true, 'a quinta pergunta está aberta');
  assert.equal(ouvintesDeTecla(t.caixa), 1, 'ouvintes de keydown na caixa com a 5ª pergunta aberta: ' + ouvintesDeTecla(t.caixa));
});

test('cinco perguntas respondidas e a caixa escondida: não sobra ouvinte de teclado nenhum (R2-07 + leva 4)', () => {
  const t = montar();
  for (const id of ['A', 'B', 'C', 'D', 'E']) { t.pergunta(id, 'Pergunta ' + id + '?'); t.responder('sim'); }
  assert.equal(t.visivel(), false, 'a caixa está escondida');
  assert.equal(ouvintesDeTecla(t.caixa), 0, 'ouvintes de keydown na caixa escondida: ' + ouvintesDeTecla(t.caixa));
});

test('o Enter na caixa responde só a pergunta aberta (R2-07)', () => {
  const t = montar();
  t.pergunta('A', 'Primeira?'); t.responder('sim');
  t.pergunta('B', 'Segunda?');
  t.caixa.querySelectorAll('.perg-op').find((b) => b.textContent.includes('não')).clicar();
  const tecla = { key: 'Enter', shiftKey: false, preventDefault() {}, stopPropagation() {} };
  if (typeof t.caixa.onkeydown === 'function') t.caixa.onkeydown(tecla);
  for (const fn of t.caixa.eventos.keydown || []) fn(tecla);
  assert.deepEqual(t.respostas, [{ id: 'A', respostas: ['sim'] }, { id: 'B', respostas: ['não'] }]);
});

/* Leva 4, T1 (pendências da T6 da leva 3): esconder a caixa solta o ouvinte (o resíduo guardava a última pergunta), e o
   Enter sem resposta escolhida segue adiante (não é engolido). Medida: ouvintes com a caixa escondida (antes 1; depois 0). */
test('caixa escondida não guarda ouvinte de teclado (leva 4)', () => {
  const t = montar();
  t.pergunta('A', 'Única?'); t.responder('sim');
  assert.equal(t.visivel(), false);
  assert.equal(ouvintesDeTecla(t.caixa), 0, 'ouvintes com a caixa escondida: ' + ouvintesDeTecla(t.caixa));
});

test('Enter sem resposta escolhida não é engolido nem responde (leva 4)', () => {
  const t = montar();
  t.pergunta('A', 'Qual?');
  let engoliu = 0;
  const tecla = { key: 'Enter', shiftKey: false, preventDefault() { engoliu++; }, stopPropagation() { engoliu++; } };
  t.caixa.onkeydown(tecla);
  assert.equal(engoliu, 0, 'o Enter seguiu adiante');
  assert.deepEqual(t.respostas, []);
});

/* Leva 4, T6 (R2-06): o resumo do que você respondeu (e o "Decide você") fica na conversa para reler. */
test('"Você respondeu" e "Você deixou a decisão com ele" vão como nota fixa (R2-06)', () => {
  const t = montar();
  t.pergunta('A', 'Qual?'); t.responder('sim');
  assert.match(t.notas.at(-1).texto, /^Você respondeu:/);
  assert.equal(t.notas.at(-1).fixo, true);
  t.pergunta('B', 'Posso?'); t.decideVoce();
  assert.equal(t.notas.at(-1).texto, 'Você deixou a decisão com ele.');
  assert.equal(t.notas.at(-1).fixo, true);
});
