'use strict';
/* Leva 5h (08/10/2026), passo 2: as perguntas em paginas e o X que transforma a proxima mensagem em resposta.
   As funcoes de verdade do app.js (desenharPergunta, proximaPergunta, o desvio do send, a Torre) recortadas e rodadas num vm com
   um DOM pequeno (molde: test/pergunta-fila.test.js e test/claude-interacao-tela.test.js).

   O que se prova:
   - uma pergunta por pagina, com o topo "1 de N", os pontinhos, o ‹ e o › e o ✕; a escolha unica MARCA (nao envia) e a pagina avanca
     sozinha para a proxima pergunta sem resposta; multipla escolha e campo livre avancam com › e com o Enter no campo; Responder e
     "Decide voce" so' na ultima pagina; com uma pergunta so' fica como antes (sem setas nem pontinhos), mas com o ✕;
   - o ✕ fecha o cartao SEM responder, guarda a pergunta como "esperando resposta por texto" (P.respostaPorTexto), poe o foco na caixa
     de escrever (dica nova), mostra o selo "respondendo a pergunta" com um × para desistir; a proxima mensagem vai por
     perguntaResponder({ id, textoLivre }) e NAO como mensagem normal; desistir = "Decide voce"; expirar/cancelar devolve a caixa ao normal;
   - na Torre o ✕ fecha o cartao da Torre e o da sessao, leva ao painel (irAoPainel) e poe o foco na caixa dele.

   Teclado: Enter manda quando ja da; Esc NAO responde; as setas trocam de pagina com Alt ou com o foco nos botoes ‹ ›. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');

const APP = lerFonte('renderer', 'app.js');
const HTML = lerFonte('renderer', 'index.html');

function funcao(nome, opcional) {
  const assinatura = 'function ' + nome + '(';
  const i = APP.indexOf(assinatura);
  if (i < 0) { assert.ok(opcional, 'funcao nao encontrada: ' + nome); return ''; }
  return (APP.slice(i - 6, i) === 'async ' ? 'async ' : '') + pegarBloco(APP, assinatura, nome);
}
function constante(nome, opcional) {
  const m = new RegExp('^const ' + nome + ' = ', 'm').exec(APP);
  if (!m) { assert.ok(opcional, 'constante nao encontrada: ' + nome); return ''; }
  return APP.slice(m.index, APP.indexOf('\n', m.index)).replace(/^const /, 'var ');
}

/* ---------------- DOM pequeno ---------------- */
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
  /* sobe pelos pais como o navegador: os ouvintes do elemento, depois o on<tipo> dele, ate' alguem parar a propagacao */
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
  // o app.js usa querySelectorAll('.perg-op') pra tirar a marcacao anterior: so' seletor de uma classe
  querySelectorAll(sel) { const m = /^\.([\w-]+)$/.exec(sel); if (!m) throw new Error('seletor que o teste nao conhece: ' + sel); return this.acharTodos(m[1]); }
}
const visivel = (el) => { for (let x = el; x; x = x.pai) if (x._classes.includes('hidden')) return false; return true; };

/* o $ do app.js so' com os seletores que o cartao usa: .classe e .classe[data-x] */
function acharPorSeletor(raiz, sel) {
  const m = /^\.([\w-]+)(?:\[data-([\w-]+)\])?$/.exec(sel);
  if (!m) throw new Error('seletor que o teste nao conhece: ' + sel);
  return raiz.todos().find((e) => e._classes.includes(m[1]) && (!m[2] || e.dataset[m[2]] !== undefined)) || null;
}

const TRES = [
  { titulo: 'Pasta', pergunta: 'Qual pasta?', opcoes: [{ rotulo: 'src' }, { rotulo: 'dist' }] },
  { titulo: 'Telas', pergunta: 'Quais telas?', varias: true, opcoes: [{ rotulo: 'Início' }, { rotulo: 'Torre' }, { rotulo: 'Ajustes' }] },
  { pergunta: 'Posso apagar?', opcoes: [{ rotulo: 'sim' }, { rotulo: 'não' }] },
];
const QUATRO = ['A', 'B', 'C', 'D'].map((l) => ({ pergunta: 'Pergunta ' + l + '?', opcoes: [{ rotulo: l + '1' }, { rotulo: l + '2' }] }));
const UMA = [{ pergunta: 'Posso publicar?', opcoes: [{ rotulo: 'sim' }, { rotulo: 'não' }] }];

function montar(extras) {
  const doc = { activeElement: null };
  doc.createElement = (t) => new El(t, doc);
  const mk = (tag, cls) => { const e = new El(tag, doc); if (cls) e.className = cls; return e; };
  const raiz = mk('body'); doc.raiz = raiz; doc.body = raiz;
  const el = raiz.appendChild(mk('section', 'pane'));
  const chat = el.appendChild(mk('div', 'pane-chat'));
  const caixa = el.appendChild(mk('div', 'pane-perg hidden'));
  const selo = el.appendChild(mk('div', 'p-resp hidden'));
  const campo = el.appendChild(mk('textarea', 'p-input')); campo.placeholder = 'Escreva aqui…';
  const P = { id: 'p1', el, chat, engine: 'claude', busy: true, started: true, anexos: [], hist: [], abaId: 'pc' };
  const reg = { respostas: [], notas: [], avisos: [], irAoPainel: [], camadasFechadas: [], baloes: [], paneSend: [], pendencias: 0, abas: 0 };
  const timers = [];
  const camadas = [];
  const ctx = vm.createContext({
    console, Map, Set, Promise, JSON, Math, String, Number, Array, Object, RegExp, Error, Date,
    setTimeout: (fn, ms) => timers.push({ fn, ms, vivo: true }), clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].vivo = false; },
    document: doc, reg,
    $: (sel, r) => acharPorSeletor(r || raiz, sel),
    ico: (n) => '<svg data-ico="' + n + '"></svg>',
    panes: new Map([[P.id, P]]), panesFundo: new Map(), acharPainel: (id) => (id === P.id ? P : null),
    note: (p, texto, erro, fixo) => { reg.notas.push({ texto, erro: !!erro, fixo: !!fixo }); },
    avisarPainel() {}, piscar() {}, scroll() {}, avisarNoQuadro() {}, quadro: null,
    pintarAbasLocal: () => { reg.abas++; }, sincronizarPendencias: () => { reg.pendencias++; },
    irAoPainel: (Q) => { reg.irAoPainel.push(Q.id); const c = acharPorSeletor(Q.el, '.p-input'); if (c) c.focus(); },
    // o envio (send) ate' o desvio da pergunta, e o caminho normal de um painel ocupado (a fila)
    contaEmAlteracao: () => false, pararBuscaDeArquivos() {}, soltarNavArquivos() {}, pintarAnexos() {},
    limparCitacao: (p) => { p.citacao = null; }, devolverCitacao: (p, tr) => { if (!p.citacao) p.citacao = tr; },
    userMsg: (p, texto) => { reg.baloes.push(texto); return {}; }, desfazerEnvio() {},
    juntarNaFila: (p, texto) => texto, pintarFila() {}, avisoEnvio: (p, texto) => { reg.avisos.push(texto); return null; },
    window: {
      api: {
        perguntaResponder: (a) => { reg.respostas.push(JSON.parse(JSON.stringify(a))); return reg.resultado ? reg.resultado(a) : Promise.resolve({ ok: true }); },
        paneSend: async (o) => { reg.paneSend.push(o); return true; },
      },
      CockpitUI: { layers: camadas, closeLayer: (l) => { reg.camadasFechadas.push(l); }, cancelResume() {}, refresh() {} },
    },
    ...(extras || {}),
  });
  vm.runInContext([
    constante('DICA_DA_RESPOSTA', true), constante('CITACAO_ABRE'), funcao('comCitacao'),
    funcao('esconderPergunta'), funcao('mostrarPergunta'), funcao('proximaPergunta'), funcao('desenharPergunta'),
    funcao('responderPerguntaPelaCaixa', true), funcao('tratarEventoDoPainel'), funcao('estadoDoPainel'), funcao('montarCorpoDaPendencia'),
    funcao('send'),
  ].join('\n'), ctx);

  const t = {
    ctx, doc, raiz, P, el, caixa, selo, campo, reg, timers, camadas, mk,
    evento: (ev) => ctx.tratarEventoDoPainel({ paneId: P.id, ...ev }),
    /* o agente pergunta: a 1a abre a caixa, as outras esperam na fila */
    abrir: (perguntas, id, extra) => t.evento({ kind: 'pergunta', id: id || 'q1', bloqueante: true, perguntas, ...(extra || {}) }),
    /* os timers (o foco inicial, o avanco depois de marcar) correm todos, na ordem em que foram pedidos */
    passar: () => { for (let i = 0; i < 50; i++) { const x = timers.find((tm) => tm.vivo); if (!x) return; x.vivo = false; x.fn(); } },
    itens: () => caixa.acharTodos('perg-item'),
    pos: () => caixa.achar('perg-pos').textContent,
    pontos: () => caixa.acharTodos('perg-ponto'),
    ant: () => caixa.achar('perg-ant'), prox: () => caixa.achar('perg-prox'), x: () => caixa.achar('perg-x'),
    ok: () => caixa.achar('perg-ok'), nao: () => caixa.achar('perg-nao'), pe: () => caixa.achar('perg-pe'),
    /* a opcao da pagina n que tem esse rotulo */
    opcao: (n, rotulo) => t.itens()[n].acharTodos('perg-op').find((b) => b.textContent.includes(rotulo)),
    livre: (n) => t.itens()[n].achar('perg-livre'),
    escreve: (n, texto) => { const l = t.livre(n); l.value = texto; l.disparar('input'); },
    tecla: (alvo, key, extra) => alvo.disparar('keydown', { key, ...(extra || {}) }),
    ultimaNota: () => reg.notas.at(-1),
    fila: () => Array.from(P.filaPerg || [], (q) => q.id),
  };
  return t;
}
const esperar = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

/* ======================= as paginas ======================= */

test('tres perguntas: uma por pagina; o topo diz "1 de 3" e traz os pontinhos, o ‹ e o › e o ✕', () => {
  const t = montar();
  t.abrir(TRES);
  assert.equal(t.itens().length, 3, 'uma pagina por pergunta');
  assert.deepEqual(t.itens().map(visivel), [true, false, false], 'so a primeira pergunta aparece');
  assert.equal(t.pos(), '1 de 3');
  assert.equal(t.pontos().length, 3, 'um pontinho por pagina');
  assert.equal(t.ant().disabled, true, 'na primeira nao ha anterior');
  assert.equal(t.prox().disabled, false);
  assert.match(t.ant().innerHTML, /data-ico="chevron-left"/);
  assert.match(t.prox().innerHTML, /data-ico="chevron-right"/);
  assert.equal(t.ant().getAttribute('aria-label'), 'Pergunta anterior');
  assert.equal(t.prox().getAttribute('aria-label'), 'Próxima pergunta');
  assert.equal(visivel(t.pe()), false, 'Responder e "Decide você" ficam so na ultima pagina');
  assert.deepEqual(t.reg.respostas, []);
});

test('o ✕ do topo: ícone x, nome acessível "Recusar e responder por texto" e um title que explica', () => {
  const t = montar();
  t.abrir(TRES);
  const x = t.x();
  assert.ok(x, 'o cartao tem o ✕');
  assert.equal(x.tagName, 'BUTTON');
  assert.equal(x.type, 'button');
  assert.equal(x.getAttribute('aria-label'), 'Recusar e responder por texto');
  assert.match(x.title, /sua próxima mensagem vira a resposta/);
  assert.match(x.innerHTML, /data-ico="x"/);
});

test('‹ e › andam entre as paginas; Responder e "Decide você" aparecem so na ultima; andar nao envia nada', () => {
  const t = montar();
  t.abrir(TRES);
  t.prox().click();
  assert.equal(t.pos(), '2 de 3');
  assert.deepEqual(t.itens().map(visivel), [false, true, false]);
  assert.equal(t.ant().disabled, false);
  assert.equal(visivel(t.pe()), false);
  t.prox().click();
  assert.equal(t.pos(), '3 de 3');
  assert.equal(t.prox().disabled, true, 'na ultima nao ha proxima');
  assert.equal(visivel(t.pe()), true);
  assert.ok(visivel(t.ok()) && visivel(t.nao()));
  t.ant().click();
  assert.equal(t.pos(), '2 de 3');
  assert.equal(visivel(t.pe()), false);
  assert.deepEqual(t.reg.respostas, []);
});

test('os pontinhos levam a pagina, mostram a atual e o que ja tem resposta', () => {
  const t = montar();
  t.abrir(TRES);
  const [a, b, c] = t.pontos();
  assert.ok(a.classList.contains('atual') && !b.classList.contains('atual'));
  assert.equal(a.getAttribute('aria-current'), 'step');
  assert.ok(!a.classList.contains('feito'), 'ainda sem resposta');
  c.click();
  assert.equal(t.pos(), '3 de 3');
  assert.ok(c.classList.contains('atual') && !a.classList.contains('atual'));
  t.opcao(2, 'sim').click();
  assert.ok(c.classList.contains('feito'), 'respondida');
  assert.match(c.getAttribute('aria-label'), /Pergunta 3 de 3/);
  assert.match(c.getAttribute('aria-label'), /respondida/);
  assert.match(a.getAttribute('aria-label'), /sem resposta/);
  a.click();
  assert.equal(t.pos(), '1 de 3');
});

test('escolha unica: clicar MARCA e nao envia; a pagina avanca sozinha para a proxima pergunta sem resposta', () => {
  const t = montar();
  t.abrir(TRES);
  const src = t.opcao(0, 'src');
  src.click();
  assert.equal(src.getAttribute('aria-pressed'), 'true');
  assert.ok(src.classList.contains('marcada'));
  assert.deepEqual(t.reg.respostas, [], 'clicar marca, nao envia');
  assert.equal(t.pos(), '1 de 3', 'o avanco espera um instante: da pra ver a marca');
  t.passar();
  assert.equal(t.pos(), '2 de 3', 'avancou sozinha');
  assert.deepEqual(t.itens().map(visivel), [false, true, false]);
  assert.deepEqual(t.reg.respostas, []);
  // trocar a escolha na pagina 1 nao envia nada tambem
  t.ant().click();
  t.opcao(0, 'dist').click();
  assert.equal(t.opcao(0, 'src').getAttribute('aria-pressed'), 'false');
  assert.equal(t.opcao(0, 'dist').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(t.reg.respostas, []);
});

test('o duplo clique na mesma opcao nao pula uma pergunta: um avanco so', () => {
  const t = montar();
  t.abrir(QUATRO);
  t.opcao(0, 'A1').click();
  t.opcao(0, 'A1').click();      // o segundo clique chega antes da pagina mudar
  t.passar();
  assert.equal(t.pos(), '2 de 4');
  assert.equal(t.opcao(1, 'B1').getAttribute('aria-pressed'), 'false', 'a pergunta 2 nao foi respondida pelo segundo clique');
});

test('ir para outra pagina antes do avanco cancela o avanco', () => {
  const t = montar();
  t.abrir(QUATRO);
  t.opcao(0, 'A1').click();
  t.pontos()[2].click();         // voce mesmo foi para a 3
  t.passar();
  assert.equal(t.pos(), '3 de 4', 'o avanco velho nao te tira de la');
});

test('avanca para a proxima SEM resposta: pula a que ja foi respondida', () => {
  const t = montar();
  t.abrir(QUATRO);
  t.pontos()[1].click();
  t.opcao(1, 'B2').click();      // responde a 2 primeiro
  t.passar();
  assert.equal(t.pos(), '3 de 4', 'e a 2 respondeu e foi para a 3');
  t.pontos()[0].click();
  t.opcao(0, 'A1').click();      // agora a 1: a proxima sem resposta e' a 3, nao a 2
  t.passar();
  assert.equal(t.pos(), '3 de 4');
});

test('na ultima pagina a escolha unica marca e FICA nela', () => {
  const t = montar();
  t.abrir(TRES);
  t.pontos()[2].click();
  t.opcao(2, 'sim').click();
  t.passar();
  assert.equal(t.pos(), '3 de 3');
  assert.equal(t.opcao(2, 'sim').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(t.reg.respostas, []);
});

test('sem pergunta sem resposta adiante, volta para a primeira que falta; sem nenhuma, vai para a ultima', () => {
  const t = montar();
  t.abrir(QUATRO);
  t.pontos()[3].click();
  t.opcao(3, 'D1').click();      // responde a ultima
  t.pontos()[2].click();
  t.opcao(2, 'C1').click();      // da 3: adiante so' a 4, ja respondida; a 1 e a 2 faltam
  t.passar();
  assert.equal(t.pos(), '1 de 4', 'volta para a primeira que falta');
  t.opcao(0, 'A1').click();      // adiante: a 2 falta
  t.passar();
  assert.equal(t.pos(), '2 de 4');
  t.opcao(1, 'B1').click();      // agora esta tudo respondido
  t.passar();
  assert.equal(t.pos(), '4 de 4', 'tudo respondido: vai para o fim, onde esta o Responder');
  assert.equal(t.ok().disabled, false);
});

test('multipla escolha e campo livre NAO avancam sozinhos; avancam com › e com o Enter no campo', () => {
  const t = montar();
  t.abrir(TRES);
  t.prox().click();
  t.opcao(1, 'Início').click();
  t.opcao(1, 'Torre').click();
  t.passar();
  assert.equal(t.pos(), '2 de 3', 'multipla: nao avanca');
  assert.equal(t.opcao(1, 'Início').getAttribute('aria-pressed'), 'true');
  assert.equal(t.opcao(1, 'Torre').getAttribute('aria-pressed'), 'true');
  t.opcao(1, 'Início').click();  // desmarca
  assert.equal(t.opcao(1, 'Início').getAttribute('aria-pressed'), 'false');
  t.escreve(1, 'e mais uma tela');
  t.passar();
  assert.equal(t.pos(), '2 de 3', 'escrever no campo livre nao avanca');
  const ev = t.tecla(t.livre(1), 'Enter');
  assert.equal(ev.padrao, true);
  assert.equal(t.pos(), '3 de 3', 'o Enter no campo livre avanca');
  assert.deepEqual(t.reg.respostas, [], 'e nao envia: ainda falta a ultima');
  t.pontos()[1].click();
  t.prox().click();
  assert.equal(t.pos(), '3 de 3', 'o › tambem avanca');
});

test('Enter no campo livre da ULTIMA pagina envia; faltando alguma, leva a primeira que falta', () => {
  const t = montar();
  t.abrir(TRES);
  t.pontos()[2].click();
  t.escreve(2, 'sim, pode');
  t.tecla(t.livre(2), 'Enter');
  assert.deepEqual(t.reg.respostas, [], 'faltam a 1 e a 2: nao envia');
  assert.equal(t.pos(), '1 de 3', 'e leva a primeira que falta');
  assert.equal(t.ok().disabled, true);
  t.opcao(0, 'src').click();
  t.passar();                    // avanca para a 2
  t.opcao(1, 'Torre').click();
  t.pontos()[2].click();
  t.tecla(t.livre(2), 'Enter');
  assert.deepEqual(t.reg.respostas, [{ id: 'q1', respostas: ['src', ['Torre'], 'sim, pode'] }]);
});

test('Responder so habilita com tudo respondido; ate la mostra quantas faltam', () => {
  const t = montar();
  t.abrir(TRES);
  t.pontos()[2].click();
  assert.equal(t.ok().disabled, true);
  assert.equal(t.ok().textContent, 'Responder');
  t.opcao(2, 'não').click();
  assert.equal(t.ok().disabled, true);
  assert.equal(t.ok().textContent, 'Falta 2');
  t.pontos()[0].click();
  t.opcao(0, 'dist').click();
  t.passar();
  assert.equal(t.ok().textContent, 'Falta 1');
  t.opcao(1, 'Ajustes').click();
  assert.equal(t.ok().disabled, false);
  assert.equal(t.ok().textContent, 'Responder');
});

test('as respostas de todas as paginas vao juntas, por posicao, e a conversa guarda o resumo', () => {
  const t = montar();
  t.abrir(TRES);
  t.opcao(0, 'dist').click(); t.passar();
  t.opcao(1, 'Início').click(); t.opcao(1, 'Ajustes').click();
  t.prox().click();
  t.opcao(2, 'não').click();
  t.ok().click();
  assert.deepEqual(t.reg.respostas, [{ id: 'q1', respostas: ['dist', ['Início', 'Ajustes'], 'não'] }]);
  assert.equal(t.ultimaNota().texto, 'Você respondeu:\n• Qual pasta?  →  dist\n• Quais telas?  →  Início + Ajustes\n• Posso apagar?  →  não');
  assert.equal(t.ultimaNota().fixo, true);
  assert.equal(visivel(t.caixa), false, 'a caixa fecha: era a unica da fila');
  assert.equal(t.P.perguntaAberta, null);
});

test('"Decide você" continua igual: cancelado, nota fixa e a fila anda', () => {
  const t = montar();
  t.abrir(TRES);
  t.abrir(UMA, 'q2');
  t.pontos()[2].click();
  t.nao().click();
  assert.deepEqual(t.reg.respostas, [{ id: 'q1', cancelado: true }]);
  assert.equal(t.ultimaNota().texto, 'Você deixou a decisão com ele.');
  assert.equal(t.P.perguntaAberta.id, 'q2');
  assert.match(t.caixa.textContent, /Posso publicar\?/);
});

test('uma pergunta so: fica como hoje (sem setas nem pontinhos), com o ✕ e o Responder a vista', () => {
  const t = montar();
  t.abrir(UMA);
  assert.equal(t.itens().length, 1);
  assert.equal(t.pontos().length, 0);
  assert.equal(t.ant(), null);
  assert.equal(t.prox(), null);
  assert.equal(t.pos(), 'Uma pergunta antes de seguir');
  assert.ok(t.x(), 'o ✕ existe mesmo com uma pergunta so');
  assert.equal(visivel(t.pe()), true);
  t.opcao(0, 'sim').click();
  t.passar();
  assert.deepEqual(t.reg.respostas, [], 'clicar marca, nao envia');
  assert.equal(t.ok().disabled, false);
  t.ok().click();
  assert.deepEqual(t.reg.respostas, [{ id: 'q1', respostas: ['sim'] }]);
  // pergunta nao bloqueante: o texto do topo continua o de antes
  const u = montar();
  u.abrir(UMA, 'n1', { bloqueante: false });
  assert.equal(u.pos(), 'Uma pergunta');
});

test('o foco acompanha a pagina: depois do avanco sozinho vai para a 1a opcao da nova; ‹ › nao roubam o foco', () => {
  const t = montar();
  t.abrir(TRES);
  t.passar();
  assert.equal(t.doc.activeElement, t.opcao(0, 'src'), 'ao abrir o foco vem para a primeira opcao');
  t.opcao(0, 'src').focus();
  t.opcao(0, 'src').click();
  t.passar();
  assert.equal(t.pos(), '2 de 3');
  assert.equal(t.doc.activeElement, t.opcao(1, 'Início'), 'o foco estava na pagina que saiu da tela: vai para o comeco da nova');
  t.prox().focus();
  t.prox().click();
  assert.equal(t.pos(), '3 de 3');
  assert.equal(t.doc.activeElement, t.ant(), 'o › ficou desabilitado na ultima: o foco passa para o ‹, nao se perde');
  t.ant().click();
  assert.equal(t.doc.activeElement, t.ant(), 'andar pelos botoes mantem o foco neles');
});

test('Enter manda quando ja da (de qualquer pagina); Esc NAO responde; Enter nos botoes do topo faz o que o botao faz', () => {
  const t = montar();
  t.abrir(TRES);
  let ev = t.tecla(t.opcao(0, 'src'), 'Escape');
  assert.equal(ev.padrao, true, 'o Esc e engolido, como hoje');
  assert.deepEqual(t.reg.respostas, [], 'e nao responde');
  assert.equal(visivel(t.caixa), true);
  // faltando resposta: o Enter nao e' engolido (a opcao focada se marca como botao que e')
  ev = t.tecla(t.opcao(0, 'src'), 'Enter');
  assert.equal(ev.padrao, false);
  assert.deepEqual(t.reg.respostas, []);
  // tudo respondido: o Enter, de qualquer pagina, manda
  t.opcao(0, 'src').click(); t.passar();
  t.opcao(1, 'Torre').click();
  t.pontos()[2].click(); t.opcao(2, 'sim').click();
  t.pontos()[0].click();
  // ...mas nao sobre os botoes do topo (‹ › pontinhos e ✕): la o Enter e' do botao
  for (const botao of [t.prox(), t.pontos()[1], t.x()]) {
    ev = t.tecla(botao, 'Enter');
    assert.equal(ev.padrao, false, 'o Enter no botao do topo nao e engolido');
  }
  assert.deepEqual(t.reg.respostas, []);
  t.pontos()[0].click();
  ev = t.tecla(t.opcao(0, 'src'), 'Enter');
  assert.equal(ev.padrao, true);
  assert.deepEqual(t.reg.respostas, [{ id: 'q1', respostas: ['src', ['Torre'], 'sim'] }]);
});

test('as setas trocam de pagina com Alt, ou soltas quando o foco esta em ‹ ›; sem isso nao fazem nada', () => {
  const t = montar();
  t.abrir(TRES);
  t.tecla(t.opcao(0, 'src'), 'ArrowRight');
  assert.equal(t.pos(), '1 de 3', 'seta solta numa opcao nao troca');
  let ev = t.tecla(t.opcao(0, 'src'), 'ArrowRight', { altKey: true });
  assert.equal(ev.padrao, true);
  assert.equal(t.pos(), '2 de 3');
  t.tecla(t.opcao(1, 'Início'), 'ArrowLeft', { altKey: true });
  assert.equal(t.pos(), '1 de 3');
  t.tecla(t.opcao(0, 'src'), 'ArrowLeft', { altKey: true });
  assert.equal(t.pos(), '1 de 3', 'na primeira nao passa do comeco');
  t.prox().focus();
  t.tecla(t.prox(), 'ArrowRight');
  assert.equal(t.pos(), '2 de 3', 'com o foco no › a seta solta troca');
  t.tecla(t.ant(), 'ArrowLeft');
  assert.equal(t.pos(), '1 de 3');
  // dentro do campo livre a seta solta e' do texto; Alt+seta troca de pagina
  t.tecla(t.livre(0), 'ArrowRight');
  assert.equal(t.pos(), '1 de 3');
  ev = t.tecla(t.livre(0), 'ArrowRight', { altKey: true });
  assert.equal(ev.padrao, true);
  assert.equal(t.pos(), '2 de 3');
  // Ctrl+Alt (AltGr) nao e' atalho
  t.tecla(t.livre(1), 'ArrowRight', { altKey: true, ctrlKey: true });
  assert.equal(t.pos(), '2 de 3');
});

test('resposta secreta: campo de senha, sem opcao pronta, e oculta no resumo da conversa', () => {
  const t = montar();
  t.abrir([
    { pergunta: 'Qual a chave?', titulo: 'Chave', segredo: true, opcoes: [{ rotulo: 'publica' }] },
    { pergunta: 'Posso seguir?', opcoes: [{ rotulo: 'sim' }, { rotulo: 'não' }] },
  ]);
  assert.equal(t.livre(0).type, 'password');
  assert.equal(t.itens()[0].acharTodos('perg-op').length, 0, 'segredo nao mostra opcao pronta');
  t.escreve(0, 'abc-123-SEGREDO');
  t.tecla(t.livre(0), 'Enter');
  assert.equal(t.pos(), '2 de 2', 'o Enter no campo secreto tambem avanca');
  t.opcao(1, 'sim').click();
  t.ok().click();
  assert.deepEqual(t.reg.respostas, [{ id: 'q1', respostas: ['abc-123-SEGREDO', 'sim'] }], 'o motor recebe a chave');
  assert.match(t.ultimaNota().texto, /Qual a chave\?  →  \(resposta oculta\)/);
  assert.doesNotMatch(t.ultimaNota().texto, /SEGREDO/);
});

/* ======================= o ✕: a proxima mensagem vira a resposta ======================= */

test('✕: fecha o cartao SEM responder, guarda a pergunta como esperando por texto, poe o foco na caixa e mostra o selo', () => {
  const t = montar();
  t.abrir(TRES);
  const ev = t.P.filaPerg[0];
  const avisosAntes = t.reg.pendencias;
  t.x().click();
  assert.equal(visivel(t.caixa), false, 'o cartao fecha');
  assert.equal(t.caixa.filhos.length, 0, 'e nao guarda o cartao velho');
  assert.equal(t.caixa.onkeydown, null, 'nem o ouvinte de teclado dele');
  assert.equal(t.P.respostaPorTexto, ev);
  assert.equal(t.P.perguntaAberta, ev, 'a pergunta segue aberta: o motor continua esperando');
  assert.deepEqual(t.fila(), ['q1']);
  assert.deepEqual(t.reg.respostas, [], 'nada foi respondido ainda');
  assert.equal(ev._uiAnswered, undefined);
  assert.equal(t.doc.activeElement, t.campo, 'o foco vai para a caixa de escrever');
  assert.equal(t.campo.placeholder, 'Escreva a sua resposta para ele…');
  assert.equal(visivel(t.selo), true, 'o selo aparece perto da caixa');
  assert.match(t.selo.textContent, /respondendo à pergunta/);
  assert.match(t.selo.achar('pr-ic').innerHTML, /data-ico="reply"/, 'o ↩');
  const xDoSelo = t.selo.achar('pr-x');
  assert.ok(xDoSelo, 'o selo tem um × para desistir');
  assert.match(xDoSelo.innerHTML, /data-ico="x"/);
  assert.ok(xDoSelo.getAttribute('aria-label'));
  assert.ok(t.reg.pendencias > avisosAntes, 'a lista de Pendencias e o resto da tela sao avisados (o estado mudou para "por texto")');
});

test('a proxima mensagem vira a resposta: perguntaResponder({ id, textoLivre }), e NAO vai como mensagem normal', async () => {
  const t = montar();
  t.abrir(TRES);
  t.x().click();
  t.campo.value = '  Nenhuma das duas: faz do meu jeito  ';
  await t.ctx.send(t.P);
  assert.deepEqual(t.reg.respostas, [{ id: 'q1', textoLivre: 'Nenhuma das duas: faz do meu jeito' }]);
  assert.equal(t.P.queued, undefined, 'nao entrou na fila de mensagens');
  assert.deepEqual(t.reg.paneSend, [], 'nao foi ao motor como mensagem');
  assert.deepEqual(t.reg.baloes, [], 'nao virou balao de mensagem normal');
  assert.equal(t.campo.value, '', 'a caixa esvazia');
  assert.equal(t.ultimaNota().texto, 'Você respondeu por texto: Nenhuma das duas: faz do meu jeito');
  assert.equal(t.ultimaNota().fixo, true, 'fica na conversa para reler');
  assert.equal(t.ultimaNota().erro, false);
  assert.equal(visivel(t.selo), false, 'o selo some');
  assert.equal(t.selo.filhos.length, 0);
  assert.equal(t.campo.placeholder, 'Escreva aqui…', 'a dica volta');
  assert.equal(t.P.respostaPorTexto, null);
  assert.equal(t.P.perguntaAberta, null, 'a fila andou: era a unica');
  assert.equal(visivel(t.caixa), false);
});

test('depois da resposta por texto a fila anda: a proxima pergunta abre num cartao novo, sem selo', async () => {
  const t = montar();
  t.abrir(TRES, 'A');
  t.abrir(UMA, 'B');
  assert.deepEqual(t.fila(), ['A', 'B']);
  t.x().click();
  t.campo.value = 'resposta da A';
  await t.ctx.send(t.P);
  assert.deepEqual(t.reg.respostas, [{ id: 'A', textoLivre: 'resposta da A' }]);
  assert.deepEqual(t.fila(), ['B']);
  assert.equal(t.P.perguntaAberta.id, 'B');
  assert.equal(visivel(t.caixa), true);
  assert.match(t.caixa.textContent, /Posso publicar\?/);
  assert.equal(visivel(t.selo), false);
  assert.equal(t.P.respostaPorTexto, null);
  // e a pergunta seguinte responde pelas opcoes, como sempre
  t.opcao(0, 'sim').click();
  t.ok().click();
  assert.deepEqual(t.reg.respostas.at(-1), { id: 'B', respostas: ['sim'] });
});

test('o × do selo desiste: igual ao "Decide você" (cancelado), a dica volta e a fila anda', () => {
  const t = montar();
  t.abrir(TRES, 'A');
  t.abrir(UMA, 'B');
  t.x().click();
  t.selo.achar('pr-x').click();
  assert.deepEqual(t.reg.respostas, [{ id: 'A', cancelado: true }]);
  assert.equal(t.ultimaNota().texto, 'Você deixou a decisão com ele.');
  assert.equal(t.ultimaNota().fixo, true);
  assert.equal(t.campo.placeholder, 'Escreva aqui…');
  assert.equal(visivel(t.selo), false);
  assert.equal(t.P.respostaPorTexto, null);
  assert.equal(t.P.perguntaAberta.id, 'B', 'a fila anda');
  assert.equal(visivel(t.caixa), true);
});

test('a pergunta expira enquanto ele escreve: o selo some e a mensagem vai como mensagem normal', async () => {
  const t = montar();
  t.abrir(TRES);
  t.x().click();
  t.campo.value = 'rascunho que ele estava escrevendo';
  t.evento({ kind: 'pergunta-cancelada', id: 'q1' });
  assert.equal(visivel(t.selo), false);
  assert.equal(t.campo.placeholder, 'Escreva aqui…');
  assert.equal(t.P.respostaPorTexto, null);
  assert.equal(t.P.perguntaAberta, null);
  assert.match(t.ultimaNota().texto, /expirou/);
  assert.equal(t.campo.value, 'rascunho que ele estava escrevendo', 'o que ele escrevia continua la');
  await t.ctx.send(t.P);
  assert.deepEqual(t.reg.respostas, [], 'nao foi para a pergunta que acabou');
  assert.equal(t.P.queued, 'rascunho que ele estava escrevendo', 'seguiu o caminho normal (aqui a fila, porque o painel esta ocupado)');
  assert.equal(t.reg.baloes.length, 1);
});

test('o motor cancela (com o motivo) enquanto ele escreve: idem; a proxima da fila abre e o selo nao volta', async () => {
  const t = montar();
  t.abrir(TRES, 'A');
  t.abrir(UMA, 'B');
  t.x().click();
  t.evento({ kind: 'pergunta-cancelada', id: 'A', texto: 'A pergunta foi encerrada: o turno acabou ou o painel parou.' });
  assert.equal(visivel(t.selo), false);
  assert.equal(t.P.respostaPorTexto, null);
  assert.match(t.ultimaNota().texto, /foi encerrada/);
  assert.equal(t.P.perguntaAberta.id, 'B');
  assert.equal(visivel(t.caixa), true, 'a B abre no cartao');
  t.campo.value = 'oi';
  await t.ctx.send(t.P);
  assert.deepEqual(t.reg.respostas, [], 'a B so responde pelo cartao ou pelo X dela');
  assert.equal(t.P.queued, 'oi');
});

test('cancelamento de OUTRA pergunta (a que esperava na fila) nao mexe no selo', () => {
  const t = montar();
  t.abrir(TRES, 'A');
  t.abrir(UMA, 'B');
  t.x().click();
  t.evento({ kind: 'pergunta-cancelada', id: 'B' });
  assert.equal(visivel(t.selo), true);
  assert.equal(t.P.respostaPorTexto.id, 'A');
  assert.deepEqual(t.fila(), ['A']);
});

test('o painel fechou ou o turno acabou: o closePane, o turn-end e o engine-down tambem soltam a pergunta esperando por texto', () => {
  const fecha = pegarBloco(APP, 'async function closePane(', 'closePane');
  assert.match(fecha, /P\.filaPerg = null; P\.perguntaAberta = null; P\.respostaPorTexto = null;/);
  const fim = APP.slice(APP.indexOf("case 'turn-end':"), APP.indexOf("case 'engine-down':"));
  assert.match(fim, /if \(P\.respostaPorTexto && P\.respostaPorTexto\.bloqueante !== false\)/);
  assert.match(fim, /proximaPergunta\(P\)/);
  const caiu = APP.slice(APP.indexOf("case 'engine-down':"), APP.indexOf("case 'approval':"));
  assert.match(caiu, /if \(P\.respostaPorTexto && P\.respostaPorTexto\.bloqueante !== false\)/);
  assert.match(caiu, /proximaPergunta\(P\)/);
});

/* o main devolve { error } (Claude, Codex, arquivos) e o remoto devolve false quando ja nao acha a pergunta */
for (const [quem, falha] of [['{ error }', { error: 'Esta pergunta já foi encerrada.' }], ['false (o remoto)', false]]) {
  test('a resposta nao chegou, ' + quem + ' (a pergunta ja tinha sido encerrada): o texto volta para a caixa, o selo some e a fila anda', async () => {
    const t = montar();
    t.abrir(TRES, 'A');
    t.abrir(UMA, 'B');
    t.x().click();
    t.reg.resultado = () => Promise.resolve(falha);
    t.campo.value = 'meu texto';
    await t.ctx.send(t.P);
    await esperar();
    assert.equal(t.campo.value, 'meu texto', 'nada se perde: o texto volta');
    assert.equal(t.ultimaNota().erro, true);
    assert.match(t.ultimaNota().texto, /já não estava esperando/);
    assert.equal(visivel(t.selo), false);
    assert.equal(t.campo.placeholder, 'Escreva aqui…');
    assert.equal(t.P.perguntaAberta.id, 'B', 'a pergunta morta sai e a proxima abre');
    assert.equal(t.P.respostaPorTexto, null);
  });
}

test('o motor cancela enquanto a resposta por texto ia: a fila anda UMA vez so (a proxima pergunta nao se perde)', async () => {
  const t = montar();
  t.abrir(TRES, 'A');
  t.abrir(UMA, 'B');
  t.x().click();
  let solta;
  t.reg.resultado = () => new Promise((r) => { solta = r; });
  t.campo.value = 'texto';
  const enviando = t.ctx.send(t.P);                       // a resposta esta indo...
  await esperar();
  t.evento({ kind: 'pergunta-cancelada', id: 'A' });      // ...e o motor cancela: a B abre
  assert.equal(t.P.perguntaAberta.id, 'B');
  solta({ ok: true });
  await enviando;
  assert.equal(t.P.perguntaAberta.id, 'B', 'a resposta que chegou depois NAO joga fora a B');
  assert.deepEqual(t.fila(), ['B']);
  assert.equal(visivel(t.caixa), true);
});

test('dois Enter seguidos na resposta por texto: o segundo nao manda de novo, o texto fica no campo', async () => {
  const t = montar();
  t.abrir(UMA);
  t.x().click();
  let solta;
  t.reg.resultado = () => new Promise((r) => { solta = r; });
  t.campo.value = 'primeiro';
  const primeiro = t.ctx.send(t.P);
  await esperar();
  t.campo.value = 'segundo';
  await t.ctx.send(t.P);
  assert.equal(t.reg.respostas.length, 1, 'uma resposta so');
  assert.equal(t.campo.value, 'segundo', 'o que ele digitou depois continua no campo');
  assert.match(t.reg.avisos.at(-1), /ainda está indo/);
  solta({ ok: true });
  await primeiro;
  assert.equal(t.ultimaNota().texto, 'Você respondeu por texto: primeiro');
});

test('pergunta secreta respondida por texto: a conversa nao mostra o que ele escreveu', async () => {
  const t = montar();
  t.abrir([{ pergunta: 'Qual a chave?', segredo: true, opcoes: [] }]);
  /* rodada 2 da leva 5h, item 3: o cartao de pergunta secreta nao tem mais o X (testes logo abaixo), entao a tela nao chega mais aqui sozinha.
     Fica de rede de seguranca: se um dia a pergunta esperar por texto, o que ele escreveu continua fora da conversa. */
  t.P.respostaPorTexto = t.P.perguntaAberta;
  t.campo.value = 'chave-SUPER-secreta';
  await t.ctx.send(t.P);
  assert.deepEqual(t.reg.respostas, [{ id: 'q1', textoLivre: 'chave-SUPER-secreta' }], 'o motor recebe o texto');
  assert.equal(t.ultimaNota().texto, 'Você respondeu por texto: (resposta oculta)');
  assert.doesNotMatch(t.reg.notas.map((n) => n.texto).join('\n'), /SUPER/);
});

/* Rodada 2 da leva 5h, item 3: o X de uma pergunta SECRETA levava a chave para a caixa de escrever comum (textarea sem mascara), e o rascunho
   dela vai para o config.json (e para o .bak) 900 ms depois de cada tecla (fichaDoPainel -> rascunho). Sem X nessas perguntas: o campo de senha
   do proprio cartao e' o unico lugar onde o segredo se digita. Nada aqui poe um no do DOM de mentira como actual/expected: se o assert
   falhar, a mensagem de erro nao pode expandir a arvore do DOM (foi assim que um node.exe inchou ate' 37 GB em 08/10). */
const SECRETAS = [
  [{ pergunta: 'Qual a chave?', titulo: 'Chave', segredo: true, opcoes: [] }],
  [{ pergunta: 'Qual pasta?', opcoes: [{ rotulo: 'src' }] }, { pergunta: 'Qual a senha?', segredo: true, opcoes: [] }, { pergunta: 'Posso seguir?', opcoes: [{ rotulo: 'sim' }] }],
];

for (const [i, perguntas] of SECRETAS.entries()) {
  test('pergunta secreta (' + (i ? 'a 2a de 3' : 'a unica') + '): o cartao NAO mostra o ✕; o campo de senha segue sendo o unico lugar da chave', () => {
    const t = montar();
    t.abrir(perguntas);
    assert.ok(!t.x(), 'sem ✕: a resposta por texto cairia na caixa comum, que e\' gravada como rascunho');
    const senha = t.caixa.acharTodos('perg-livre').find((c) => c.dataset.segredo === '1');
    assert.ok(senha && senha.tagName === 'INPUT' && senha.type === 'password', 'o campo oculto continua la');
    assert.equal(senha.placeholder, 'digite aqui (fica oculto)');
    assert.ok(!t.P.respostaPorTexto, 'nada ficou esperando por texto');
    assert.equal(visivel(t.selo), false);
    assert.equal(t.campo.placeholder, 'Escreva aqui…', 'a caixa de escrever nao muda de dica');
    // o resto do topo continua (a navegacao, e o "Decide voce" no rodape, que e' o jeito de recusar)
    if (perguntas.length > 1) assert.ok(t.ant() && t.prox() && t.pontos().length === perguntas.length);
    assert.ok(t.nao(), 'o "Decide voce" continua');
  });
}

test('pergunta secreta: o Enter no campo, as paginas e o Responder continuam como eram (so o ✕ saiu do topo)', () => {
  const t = montar();
  t.abrir(SECRETAS[1]);
  t.escreve(1, 'abc-123-SEGREDO');
  t.opcao(0, 'src').click(); t.passar();
  t.pontos()[1].click();
  const ev = t.tecla(t.livre(1), 'Enter');
  assert.equal(ev.padrao, true);
  assert.equal(t.pos(), '3 de 3', 'o Enter no campo secreto avanca, como sempre');
  t.opcao(2, 'sim').click();
  t.ok().click();
  assert.deepEqual(t.reg.respostas, [{ id: 'q1', respostas: ['src', 'abc-123-SEGREDO', 'sim'] }], 'responde pelo cartao, como sempre');
  assert.doesNotMatch(t.ultimaNota().texto, /SEGREDO/);
  assert.match(t.ultimaNota().texto, /Qual a senha\?  →  \(resposta oculta\)/);
});

test('pergunta secreta tambem na Torre: o cartao da Torre nao tem o ✕', () => {
  const t = montar();
  t.abrir(SECRETAS[1]);
  const torre = cartaoDaTorre(t);
  assert.ok(!torre.achar('perg-x'), 'a Torre nao tem o ✕');
  assert.ok(!t.x(), 'a sessao tambem nao');
  assert.equal(torre.acharTodos('perg-item').length, 3, 'o cartao da Torre e\' o mesmo, em paginas');
});

test('so o pedido com pergunta secreta perde o ✕: a pergunta seguinte da fila, sem segredo, volta a ter', () => {
  const t = montar();
  t.abrir(SECRETAS[0], 'A');
  t.abrir(UMA, 'B');
  assert.ok(!t.x());
  t.escreve(0, 'chave');
  t.ok().click();
  assert.equal(t.P.perguntaAberta.id, 'B');
  assert.ok(t.x(), 'a B (sem segredo) tem o ✕');
});

test('a pergunta secreta pode estar alem das 4 que o cartao mostra: o pedido inteiro conta para tirar o ✕', () => {
  const t = montar();
  const cinco = [...QUATRO, { pergunta: 'Qual a senha?', segredo: true, opcoes: [] }];
  t.abrir(cinco);
  assert.equal(t.itens().length, 4, 'o cartao mostra so 4');
  assert.ok(!t.x(), 'mas o pedido tem um segredo: sem ✕');
});

test('pergunta secreta e o ✕: a regra mora num lugar so (temSegredo) e o recusar tambem a respeita', () => {
  const corpo = pegarBloco(APP, 'function desenharPergunta(', 'desenharPergunta');
  assert.match(corpo, /const temSegredo = /, 'a regra mora num lugar so');
  assert.match(corpo, /const recusar = \(\) => \{\s*if \(temSegredo \|\| /, 'e o recusar tambem a respeita');
});

test('trecho preso e anexos vao juntos no texto livre (nada se perde em silencio)', async () => {
  const t = montar();
  t.abrir(UMA);
  t.x().click();
  t.P.citacao = 'um trecho da resposta';
  t.P.anexos = [{ path: 'C:\\fotos\\tela.png', ext: '.png' }];
  t.campo.value = 'e esta aqui';
  await t.ctx.send(t.P);
  assert.equal(t.reg.respostas.length, 1);
  const enviado = t.reg.respostas[0].textoLivre;
  assert.match(enviado, /^Sobre este trecho da sua resposta:\n> um trecho da resposta\n\ne esta aqui/);
  assert.match(enviado, /Arquivos que anexei/);
  assert.match(enviado, /C:\\fotos\\tela\.png/);
  assert.equal(t.P.citacao, null);
  assert.equal(t.P.anexos.length, 0, 'o anexo foi junto e saiu da barra');   // length, e nao deepEqual: o [] nasceu dentro do vm
  assert.equal(t.ultimaNota().texto, 'Você respondeu por texto: e esta aqui');
});

test('sem o ✕, escrever na caixa continua sendo mensagem normal (nada foi desviado)', async () => {
  const t = montar();
  t.abrir(TRES);
  t.campo.value = 'uma mensagem qualquer';
  await t.ctx.send(t.P);
  assert.deepEqual(t.reg.respostas, []);
  assert.equal(t.P.queued, 'uma mensagem qualquer');
});

test('depois de responder por texto, um clique atrasado no ✕ ou no × velhos nao faz nada', async () => {
  const t = montar();
  t.abrir(UMA);
  const x = t.x();
  x.click();
  const xDoSelo = t.selo.achar('pr-x');
  t.campo.value = 'texto';
  await t.ctx.send(t.P);
  x.click();           // clique atrasado no ✕ do cartao que ja saiu
  xDoSelo.click();     // e no × do selo que ja saiu
  assert.deepEqual(t.reg.respostas, [{ id: 'q1', textoLivre: 'texto' }], 'uma resposta so, e nada de cancelado depois');
  assert.equal(t.P.respostaPorTexto, null);
  assert.equal(visivel(t.selo), false);
  assert.equal(t.campo.placeholder, 'Escreva aqui…');
});

test('o ✕ vale uma vez so: clicar de novo no que ja esta esperando por texto nao faz nada', () => {
  const t = montar();
  t.abrir(TRES);
  const x = t.x();
  x.click();
  const ev = t.P.respostaPorTexto;
  t.campo.placeholder = 'outra dica';       // se o segundo clique rodasse, a "dica de antes" viraria esta
  x.click();
  assert.equal(t.P.respostaPorTexto, ev);
  assert.equal(ev._dicaAntes, 'Escreva aqui…', 'a dica de antes continua a original');
  assert.equal(t.campo.placeholder, 'outra dica');
});

/* ======================= a Torre ======================= */

function cartaoDaTorre(t) {
  const corpo = t.raiz.appendChild(t.mk('div', 'pendencias-card-body'));
  const cx = corpo.appendChild(t.mk('div', 'pane-perg'));
  t.ctx.desenharPergunta(t.P, cx);
  return cx;
}

test('Torre: o ✕ do cartao da Torre fecha o da Torre E o da sessao, leva ao painel e poe o foco na caixa dele', () => {
  const t = montar();
  t.abrir(TRES);
  const torre = cartaoDaTorre(t);
  assert.equal(visivel(torre), true);
  assert.equal(visivel(t.caixa), true, 'o cartao da sessao tambem esta aberto');
  assert.equal(torre.acharTodos('perg-item').length, 3, 'o da Torre tambem e em paginas');
  torre.achar('perg-x').click();
  assert.equal(visivel(torre), false, 'fechou o da Torre');
  assert.equal(torre.filhos.length, 0);
  assert.equal(visivel(t.caixa), false, 'e o da sessao');
  assert.deepEqual(t.reg.irAoPainel, ['p1'], 'foi ao painel pelo mesmo caminho do "ir ate la" da Torre');
  assert.equal(t.doc.activeElement, t.campo, 'com o foco na caixa dele');
  assert.equal(t.P.respostaPorTexto, t.P.filaPerg[0]);
  assert.equal(t.campo.placeholder, 'Escreva a sua resposta para ele…');
  assert.equal(visivel(t.selo), true);
  assert.deepEqual(t.reg.respostas, [], 'ainda nao respondeu');
});

test('Torre aberta como camada (Pendencias do chip de atencao): o ✕ fecha a camada tambem', () => {
  const t = montar();
  t.abrir(TRES);
  const camada = { panel: t.raiz.appendChild(t.mk('section', 'ck-layer ck-pending')) };
  const corpo = camada.panel.appendChild(t.mk('div', 'ck-pending-body'));
  const cx = corpo.appendChild(t.mk('div', 'pane-perg'));
  t.ctx.desenharPergunta(t.P, cx);
  t.camadas.push({ panel: t.mk('section', 'ck-layer outra') }, camada);
  cx.achar('perg-x').click();
  assert.equal(t.reg.camadasFechadas.length, 1, 'fechou uma camada so');
  assert.equal(t.reg.camadasFechadas[0], camada, 'a que continha o cartao');
  assert.deepEqual(t.reg.irAoPainel, ['p1']);
  assert.equal(t.doc.activeElement, t.campo);
});

test('Torre: no painel o ✕ nao mexe em camada nem vai a lugar nenhum (ja esta no painel)', () => {
  const t = montar();
  t.abrir(TRES);
  t.camadas.push({ panel: t.mk('section', 'ck-layer') });
  t.x().click();
  assert.deepEqual(t.reg.camadasFechadas, []);
  assert.deepEqual(t.reg.irAoPainel, []);
});

test('Torre: esperando por texto, a lista de Pendencias nao desenha o cartao; ela avisa, e o estado diz isso', () => {
  const t = montar();
  t.abrir(TRES);
  assert.equal(t.ctx.estadoDoPainel(t.P).txt, 'esperando sua resposta');
  t.x().click();
  const estado = t.ctx.estadoDoPainel(t.P);
  assert.equal(estado.txt, 'esperando sua resposta por texto');
  assert.equal(estado.cls, 'espera', 'continua pedindo voce: o motor segue parado');
  const corpo = t.raiz.appendChild(t.mk('div', 'pendencias-card-body'));
  t.ctx.montarCorpoDaPendencia(t.P, corpo);
  assert.equal(corpo.achar('pane-perg'), null, 'sem cartao');
  assert.match(corpo.textContent, /responder por texto/);
  assert.doesNotMatch(corpo.textContent, /Isso acabou de se resolver/);
  // sem o ✕, a Torre continua desenhando o cartao
  const u = montar();
  u.abrir(TRES);
  const corpo2 = u.raiz.appendChild(u.mk('div', 'pendencias-card-body'));
  u.ctx.montarCorpoDaPendencia(u.P, corpo2);
  assert.ok(corpo2.achar('pane-perg'));
  assert.equal(corpo2.acharTodos('perg-item').length, 3);
});

test('Torre: responder pelo cartao da Torre (sem ✕) continua igual: fecha a sessao e a Torre juntas', () => {
  const t = montar();
  t.abrir(UMA);
  const torre = cartaoDaTorre(t);
  torre.acharTodos('perg-op')[0].click();
  torre.achar('perg-ok').click();
  assert.deepEqual(t.reg.respostas, [{ id: 'q1', respostas: ['sim'] }]);
  assert.equal(visivel(t.caixa), false);
});

/* ======================= tela, icones e estilo ======================= */

test('o painel ganha o selo .p-resp (escondido, role=status) logo depois do trecho preso, e o ICONES ganha o chevron-left', () => {
  assert.match(HTML, /<div class="p-citacao hidden"><\/div>\s*<div class="p-resp hidden" role="status"><\/div>/);
  assert.match(APP, /'chevron-left': '<path d="m15 18-6-6 6-6"\/>'/);
  assert.match(APP, /"chevron-right": /);
  for (const nome of ['x', 'chevron-left', 'chevron-right', 'reply']) assert.ok(APP.includes("ico('" + nome + "')"), "o app usa ico('" + nome + "')");
});

test('send: o desvio da pergunta vem ANTES do plano, da fila e do trecho preso', () => {
  const corpo = pegarBloco(APP, 'async function send(', 'send');
  const desvio = corpo.indexOf('P.respostaPorTexto && !continuaSozinho');
  assert.ok(desvio > 0, 'falta o desvio no send');
  assert.ok(desvio > corpo.indexOf('if (!text) return;'), 'depois de saber que ha texto');
  assert.ok(desvio < corpo.indexOf('P.planoPendente && !continuaSozinho'), 'antes do plano');
  assert.ok(desvio < corpo.indexOf('if (P.busy || P.ligando)'), 'antes da fila');
  assert.ok(desvio < corpo.indexOf('const citacaoDoEnvio'), 'antes do trecho preso');
});

/* ---------- o estilo: so' as cores do tema, nos 6 jeitos de pintar, com e sem o visual Mac ---------- */
const { ler, hex, contraste, temas } = require('../testes/contraste');

test('CSS: o ‹ › o X, os pontinhos e o selo existem no style.css, no cockpit-ui.css e no visual Mac, so com cores do tema', () => {
  const base = ler('style.css'), ui = ler('cockpit-ui.css'), mac = ler('visual-mac.css');
  for (const classe of ['perg-pos', 'perg-nav', 'perg-ant', 'perg-prox', 'perg-x', 'perg-ponto', 'p-resp', 'pr-ic', 'pr-txt', 'pr-x']) {
    assert.ok(base.includes('.' + classe), '.' + classe + ' no style.css');
  }
  assert.ok(ui.includes('.ck-app .p-resp {'), 'o selo no cockpit-ui.css');
  assert.ok(mac.includes('html.visual-mac .ck-app .pane-perg :is(.perg-ant, .perg-prox, .perg-x)'), 'o visual Mac do ‹ › e do X');
  const pedaco = (css, de, ate) => { const i = css.indexOf(de); assert.ok(i >= 0, 'falta ' + de); const j = css.indexOf(ate, i); assert.ok(j > i, 'falta ' + ate); return css.slice(i, j); };
  const blocos = [
    pedaco(base, '/* leva 5h: o cartao em paginas', '.pane-perg:has(> .perg-pe.hidden) .perg-item{margin-bottom:0}'),
    pedaco(base, '/* leva 5h: o selo', '.pr-x .ic{width:10px;height:10px}'),
    pedaco(ui, '/* Leva 5h: o selo', '.ck-app .p-resp .pr-x .ic {'),
    pedaco(mac, '/* Leva 5h: o cartao em paginas no visual Mac', ':is(.perg-ant, .perg-prox, .perg-ponto, .perg-x):focus-visible'),
  ];
  for (const b of blocos) {
    assert.doesNotMatch(b, /#[0-9a-fA-F]{3,8}\b/, 'cor fixa (hexadecimal) fora dos tokens');
    assert.doesNotMatch(b, /\brgba?\(|\bhsla?\(/, 'cor fixa fora dos tokens');
    assert.match(b, /var\(--/, 'usa os tokens do tema');
  }
  // a pagina atual e os focos usam o --focus do tema (o --accent tem override no cockpit-ui.css)
  assert.match(blocos[0], /\.perg-ponto\.atual::before\{border-color:var\(--focus\)\}/);
  assert.match(blocos[0], /\.pr-x:focus-visible\{outline:2px solid var\(--focus\)/);
  // alvos de 24 px (WCAG 2.5.8): o ‹, o ›, o X, a area do pontinho (nao o desenho) e o × do selo
  assert.match(blocos[0], /\.perg-ant,\.perg-prox,\.perg-x\{[^}]*width:24px;height:24px/);
  assert.match(blocos[0], /\.perg-ponto\{[^}]*height:24px/);
  assert.match(blocos[1], /\.pr-x\{[^}]*width:24px;height:24px;margin:-4px -4px -4px 0/);
  assert.match(blocos[2], /\.pr-x \{[^}]*width: 24px;[^}]*height: 24px;/);
});

test('CSS: pontinhos, ‹ › e X legiveis no cartao (--attention-soft) e o selo legivel (--raised) nos 6 jeitos de pintar', () => {
  for (const [tema, b] of Object.entries(temas())) {
    const fundoDoCartao = hex(b, '--attention-soft'), fundoDoSelo = hex(b, '--raised');
    assert.ok(fundoDoCartao && fundoDoSelo, tema);
    const dim = hex(b, '--ink-muted'), foco = hex(b, '--focus'), tinta = hex(b, '--ink');
    assert.ok(contraste(dim, fundoDoCartao) >= 4.5, tema + ': --ink-muted (‹ › X, pontinhos) sobre o cartao = ' + contraste(dim, fundoDoCartao).toFixed(2));
    assert.ok(contraste(foco, fundoDoCartao) >= 3, tema + ': --focus (pagina atual, foco) sobre o cartao = ' + contraste(foco, fundoDoCartao).toFixed(2));
    assert.ok(contraste(foco, fundoDoSelo) >= 3, tema + ': --focus (borda e ↩ do selo) sobre --raised = ' + contraste(foco, fundoDoSelo).toFixed(2));
    assert.ok(contraste(tinta, fundoDoSelo) >= 4.5, tema + ': --ink do selo sobre --raised');
    assert.ok(contraste(dim, fundoDoSelo) >= 4.5, tema + ': --ink-muted do × do selo sobre --raised');
  }
});
