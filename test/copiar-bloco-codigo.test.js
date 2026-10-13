'use strict';
/* Leva 1, Task 9 -- botao "copiar" dos blocos de codigo (R1-04, R1-08).

   Tres defeitos no mesmo botao:
   1) Copiava o <pre> inteiro. O botao mora DENTRO do <pre> (opacity:0 nao tira o
      texto dele do innerText), entao a palavra "copiar" ia junto no fim do codigo:
      o terminal recebia "npm install\ncopiar" e tentava rodar um comando "copiar".
   2) Dois cliques em menos de 1,4 s: o 2o clique guardava o "copiado" que ja estava
      na tela como rotulo de antes, e o botao ficava preso em "copiado" pra sempre.
   3) Dizia "copiado" sem esperar a area de transferencia. O writeText devolve uma
      promessa e, se ela recusa (janela sem foco), o botao mentia.

   As funcoes de verdade saem do app.js e rodam num vm, com DOM, relogio e area de
   transferencia de mentira. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { pegarBloco, lerFonte } = require('../testes/raiz');

const APP = lerFonte('renderer', 'app.js');
const tique = () => new Promise((r) => setImmediate(r));
// promessa recusada ja' "tratada": o app antigo nao a espera e isso nao pode virar
// erro solto do processo, o teste tem de falhar pelo rotulo
const recusa = (erro) => { const p = Promise.reject(erro); p.catch(() => {}); return p; };

/* ---------- DOM de mentira: so' o que o botao e o ajudante usam ---------- */
class No {
  constructor(tag, texto = '') { this.tag = tag; this.texto = texto; this.filhos = []; this.classes = new Set(); this.ouvintes = {}; }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  get classList() {
    const c = this.classes;
    return { add: (x) => c.add(x), remove: (x) => c.delete(x), contains: (x) => c.has(x) };
  }
  appendChild(f) { this.filhos.push(f); return f; }
  get childNodes() { return this.filhos; }
  get textContent() { return this.texto + this.filhos.map((f) => f.textContent).join(''); }
  set textContent(v) { this.texto = String(v); this.filhos = []; }
  // no navegador o botao (so' com opacity:0) continua no innerText do <pre>
  get innerText() { return this.textContent; }
  addEventListener(tipo, fn) { (this.ouvintes[tipo] = this.ouvintes[tipo] || []).push(fn); }
  clicar() { for (const fn of this.ouvintes.click || []) fn({ stopPropagation() {} }); }
  descendentes() { return this.filhos.flatMap((f) => [f, ...f.descendentes()]); }
  querySelectorAll(sel) { return this.descendentes().filter((n) => (sel[0] === '.' ? n.classes.has(sel.slice(1)) : n.tag === sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

function palco({ clipboard, semClipboard } = {}) {
  const copiados = [];
  const relogio = new Map();
  let seq = 0;
  const aceita = { writeText: (t) => { copiados.push(t); return Promise.resolve(); } };
  const ctx = vm.createContext({
    console,
    navigator: semClipboard ? {} : { clipboard: clipboard || aceita },
    document: { createElement: (tag) => new No(tag) },
    setTimeout: (fn, ms) => { relogio.set(++seq, { fn, ms }); return seq; },
    clearTimeout: (id) => { relogio.delete(id); },
  });
  const fonte = (nome) => pegarBloco(APP, (APP.includes('async function ' + nome + '(') ? 'async ' : '') + 'function ' + nome + '(', nome);
  vm.runInContext(fonte('copiarTexto') + '\n' + fonte('botoesDeCodigo'), ctx);
  return {
    ctx, copiados,
    // um bloco de codigo como o marked entrega: <pre><code>...</code></pre>, com o botao dentro do <pre>
    bloco(codigo) {
      const corpo = new No('div');
      const pre = corpo.appendChild(new No('pre'));
      const code = pre.appendChild(new No('code', codigo));
      ctx.botoesDeCodigo(corpo);
      return { corpo, pre, code, botao: pre.querySelector('.cod-copiar') };
    },
    pendentes: () => relogio.size,
    // passa o tempo: dispara os relogios que ainda estao armados
    passarTempo() { const fns = [...relogio.values()]; relogio.clear(); for (const t of fns) t.fn(); },
  };
}

/* =====================================================================
   R1-04: o texto copiado e' so' o codigo
   ===================================================================== */
test('copia so o codigo: o texto e exatamente o do <code>, sem o "copiar" do botao (R1-04)', async () => {
  const p = palco();
  const codigo = 'npm install\nnpm run build\n';
  const { pre, botao } = p.bloco(codigo);
  assert.ok(botao, 'o bloco ganhou o botao');
  assert.equal(botao.textContent, 'copiar');
  assert.ok(pre.filhos.includes(botao), 'o botao continua dentro do <pre> (o CSS o posiciona la)');
  botao.clicar(); await tique();
  assert.deepEqual(p.copiados, [codigo]);
});

test('bloco sem <code> (HTML solto na resposta): copia o texto do <pre> sem o botao (R1-04)', async () => {
  const p = palco();
  const corpo = new No('div');
  const pre = corpo.appendChild(new No('pre'));
  pre.appendChild(new No('#text', 'echo oi\n'));
  p.ctx.botoesDeCodigo(corpo);
  const botao = pre.querySelector('.cod-copiar');
  botao.clicar(); await tique();
  assert.deepEqual(p.copiados, ['echo oi\n']);
});

/* =====================================================================
   R1-08: dois cliques seguidos nao prendem o botao em "copiado"
   ===================================================================== */
const DOIS_CLIQUES = [
  ['com a copia do 1o ja concluida', async (bt) => { bt.clicar(); await tique(); bt.clicar(); await tique(); }],
  ['os dois antes da area de transferencia responder', async (bt) => { bt.clicar(); bt.clicar(); await tique(); }],
];
for (const [quando, clicar2x] of DOIS_CLIQUES) {
  test('dois cliques seguidos (' + quando + '): depois do tempo o rotulo volta para "copiar" (R1-08)', async () => {
    const p = palco();
    const { botao } = p.bloco('ls -la');
    await clicar2x(botao);
    assert.equal(botao.textContent, 'copiado');
    assert.ok(botao.classList.contains('copiou'));
    const armados = p.pendentes();
    p.passarTempo();
    assert.equal(botao.textContent, 'copiar', 'nao fica preso em "copiado"');
    assert.ok(!botao.classList.contains('copiou'));
    assert.equal(armados, 1, 'o relogio do 1o clique cai quando o 2o arma o dele (senao ele devolve o rotulo cedo demais)');
    // e o botao segue vivo: um clique novo copia e volta ao normal de novo
    botao.clicar(); await tique();
    assert.equal(botao.textContent, 'copiado');
    p.passarTempo();
    assert.equal(botao.textContent, 'copiar');
    assert.deepEqual(p.copiados, ['ls -la', 'ls -la', 'ls -la']);
  });
}

/* =====================================================================
   R1-08: so' diz "copiado" quando a area de transferencia aceitou
   ===================================================================== */
test('so diz "copiado" depois que a area de transferencia aceitou (R1-08)', async () => {
  let aceitar;
  const p = palco({ clipboard: { writeText: () => new Promise((ok) => { aceitar = ok; }) } });
  const { botao } = p.bloco('ls');
  botao.clicar(); await tique();
  assert.equal(botao.textContent, 'copiar', 'enquanto a copia nao terminou, nada de "copiado"');
  assert.ok(!botao.classList.contains('copiou'));
  aceitar(); await tique();
  assert.equal(botao.textContent, 'copiado');
  assert.ok(botao.classList.contains('copiou'));
});

test('writeText recusando: o rotulo NAO diz "copiado" e depois volta para "copiar" (R1-08)', async () => {
  const p = palco({ clipboard: { writeText: () => recusa(new Error('Document is not focused.')) } });
  const { botao } = p.bloco('ls');
  botao.clicar(); await tique();
  assert.notEqual(botao.textContent, 'copiado');
  assert.equal(botao.textContent, 'não copiou');
  assert.ok(!botao.classList.contains('copiou'), 'a cor de sucesso e' + " so' do sucesso");
  // falhou duas vezes seguidas: o rotulo de antes continua sendo o "copiar"
  botao.clicar(); await tique();
  assert.equal(botao.textContent, 'não copiou');
  p.passarTempo();
  assert.equal(botao.textContent, 'copiar');
});

test('sem area de transferencia (navigator.clipboard ausente): tambem nao diz "copiado" (R1-08)', async () => {
  const p = palco({ semClipboard: true });
  const { botao } = p.bloco('ls');
  botao.clicar(); await tique();
  assert.equal(botao.textContent, 'não copiou');
  p.passarTempo();
  assert.equal(botao.textContent, 'copiar');
});

/* =====================================================================
   o ajudante e' o mesmo do "copiar" da resposta inteira e do "copiar comando":
   o contrato dele continua igual
   ===================================================================== */
test('copiarTexto sem botao so copia; com rotuloOk usa o rotulo pedido', async () => {
  const p = palco();
  assert.equal(await p.ctx.copiarTexto('abc'), true);
  assert.equal(await p.ctx.copiarTexto(null), true);
  assert.deepEqual(p.copiados, ['abc', '']);
  const bt = new No('button', 'copiar comando');
  assert.equal(await p.ctx.copiarTexto('x', bt, 'copiei!'), true);
  assert.equal(bt.textContent, 'copiei!');
  p.passarTempo();
  assert.equal(bt.textContent, 'copiar comando');
  // a falha so' avisa: nao lanca e devolve false
  const q = palco({ semClipboard: true });
  assert.equal(await q.ctx.copiarTexto('x'), false);
});
