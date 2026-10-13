'use strict';
/* Leva 4, Tarefa 3 (UI 4.1 resto, 4.2, 4.3 e 3.4). Medidas:
   - caminho C:\ visível num passo de terminal fechado (antes sim; depois não);
   - botões "ver saída" em 3 passos com saída (antes 3; depois 0: a linha abre);
   - texto visível do fim do turno (antes "levou 4m18s · 27.0k↑ 22.2k↓ · 205.1k de contexto"; depois "4 min");
   - relógio do "trabalhando…" (antes "52m25s"; depois "· 52 min", com o exato no hover). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');

const APP = lerFonte('renderer', 'app.js');
const CSS = fs.readFileSync(path.join(__dirname, '../src/renderer/style.css'), 'utf8').replace(/\r\n/g, '\n');

class El {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.filhos = []; this.pai = null; this._cls = new Set(); this.dataset = {}; this.attrs = {}; this.ouvintes = {}; this._texto = ''; this.title = ''; this.tabIndex = -1; }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() { const s = this._cls; return { add: (...c) => c.forEach((x) => s.add(x)), remove: (...c) => c.forEach((x) => s.delete(x)), contains: (c) => s.has(c), toggle: (c, on) => { const v = on === undefined ? !s.has(c) : !!on; if (v) s.add(c); else s.delete(c); return v; } }; }
  get children() { return this.filhos; }
  get lastElementChild() { return this.filhos[this.filhos.length - 1] || null; }
  get parentNode() { return this.pai; }
  get parentElement() { return this.pai; }
  set innerHTML(h) { this.filhos = []; this._texto = ''; for (const m of String(h).matchAll(/<span class="([^"]+)">(?:<i><\/i>)*([^<]*)<\/span>/g)) { const s = new El('span'); s.className = m[1]; s._texto = m[2]; this.appendChild(s); } }
  get textContent() { return this._texto + this.filhos.map((f) => f.textContent).join(''); }
  set textContent(v) { this.filhos = []; this._texto = String(v); }
  appendChild(c) { if (c.pai) c.remove(); c.pai = this; this.filhos.push(c); return c; }
  remove() { if (this.pai) this.pai.filhos.splice(this.pai.filhos.indexOf(this), 1); this.pai = null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, f) { (this.ouvintes[t] = this.ouvintes[t] || []).push(f); }
  disparar(t, extra) { const e = { target: this, preventDefault() { this.padrao = true; }, ...(extra || {}) }; for (const f of this.ouvintes[t] || []) f(e); return e; }
  casa(s) { if (/^[a-z]+$/i.test(s)) return this.tagName === s.toUpperCase(); return s.split('.').filter(Boolean).every((c) => this._cls.has(c)); }
  closest(sel) { const cs = sel.split(',').map((s) => s.trim()); for (let x = this; x; x = x.pai) if (cs.some((s) => x.casa(s))) return x; return null; }
  querySelector(sel) { for (const f of this.filhos) { if (f.casa(sel)) return f; const d = f.querySelector(sel); if (d) return d; } return null; }
  querySelectorAll(sel) { const out = []; const anda = (n) => { for (const f of n.filhos) { if (f.casa(sel)) out.push(f); anda(f); } }; anda(this); return out; }
}

function tela() {
  const timers = [];
  const ctx = vm.createContext({
    console, Date, Math, String, window: {},
    document: { createElement: (t) => new El(t) },
    $: (sel, raiz) => (raiz ? raiz.querySelector(sel) : null),
    clearEmpty() {}, scroll() {}, ajustarCaixaDePassos() {}, passoPronto() {}, pintarDesfazer() {}, mostrarPrintsDoPasso() {},
    fmtK: (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n || 0)),
    setInterval: (fn) => { timers.push(fn); return timers.length; }, clearInterval() {},
  });
  vm.runInContext(['tipoDoPasso', 'acharPasso', 'passo', 'toolEnd', 'alternarPasso', 'duracaoCurta', 'duracaoLegivel', 'trabalhando', 'marcarFimDoTurno']
    .map((f) => pegarBloco(APP, 'function ' + f + '(', f)).join('\n'), ctx);
  const P = { id: 'p1', busy: true, chat: new El('div'), el: new El('section'), blocks: new Map() };
  return { ctx, P, timers };
}
const comando = "Set-Location 'C:\\Users\\hugom\\Projetos'; dir";

test('passo de terminal é uma linha: o comando com o caminho só aparece ao abrir (UI 4.1)', () => {
  const { ctx, P } = tela();
  ctx.passo(P, { txt: 'Rodando no terminal', det: comando }, 't1', 'PowerShell', comando);
  const d = P.passosEl.querySelector('.passo');
  assert.doesNotMatch(d.textContent, /C:\\/, 'caminho visível com o passo fechado: ' + d.textContent);
  assert.equal(d.querySelector('.pa-t').textContent, 'Rodando no terminal');
  assert.ok(d.classList.contains('expansivel'));
  assert.equal(d.tabIndex, 0);
  assert.equal(d.getAttribute('role'), 'button');
  assert.equal(d.getAttribute('aria-expanded'), 'false');
  d.disparar('click');
  assert.match(d.querySelector('.pa-saida').textContent, /Set-Location 'C:\\Users\\hugom\\Projetos'; dir/);
  assert.equal(d.getAttribute('aria-expanded'), 'true');
  d.disparar('keydown', { key: 'Enter' });
  assert.equal(d.querySelector('.pa-saida'), null, 'Enter fecha');
});

test('passo de leitura continua mostrando só o nome do arquivo (UI 4.1)', () => {
  const { ctx, P } = tela();
  ctx.passo(P, { txt: 'Lendo', det: 'b.txt' }, 'r1', 'Read', 'C:\\a\\b.txt');
  const d = P.passosEl.querySelector('.passo');
  assert.equal(d.querySelector('.pa-d').textContent, 'b.txt');
  assert.equal(d.classList.contains('expansivel'), false, 'sem saída ainda, nada a abrir');
});

test('saída de comando não vira botão "ver saída": a linha abre o comando e a saída (UI 4.1)', () => {
  const { ctx, P } = tela();
  for (const id of ['a', 'b', 'c']) {
    ctx.passo(P, { txt: 'Rodando no terminal', det: 'dir' }, id, 'Bash', 'dir ' + id);
    ctx.toolEnd(P, id, 'saida ' + id, id === 'c');
  }
  const botoes = P.passosEl.querySelectorAll('button').length;
  assert.equal(botoes, 0, 'botões "ver saída": ' + botoes);
  const c = P.passosEl.querySelectorAll('.passo')[2];
  assert.equal(c.title, 'Ver o erro');
  c.disparar('click');
  assert.equal(c.querySelector('.pa-saida').textContent, 'dir c\n\nsaida c');
  // clique num botão de dentro do passo (o "ver o que mudou") não abre nem fecha
  const interno = new El('button'); c.appendChild(interno);
  c.disparar('click', { target: interno });
  assert.ok(c.querySelector('.pa-saida'), 'o clique no botão de dentro não fechou a saída');
});

test('fim do turno: visível só "4 min"; tokens, contexto e tempo total no hover (UI 4.2 e 3.4)', () => {
  const { ctx, P } = tela();
  Object.assign(P, { t0: Date.now() - 258000, usoTurno: { entrada: 27000, saida: 22200 }, tokens: 205100, _tempoTrabalho: { ms: 3600000 } });
  ctx.marcarFimDoTurno(P);
  const d = P.chat.querySelector('.turno-fim');
  assert.equal(d.textContent, '4 min');
  assert.equal(d.title, 'Levou 4m18s · 27.0k↑ 22.2k↓ · 205.1k de contexto\nTempo total da IA nesta conversa: 1h00');
});

test('relógio do "trabalhando…": "· 52 min" na tela e o exato no hover (UI 3.4)', () => {
  const { ctx, P, timers } = tela();
  P.t0 = Date.now() - (52 * 60 + 25) * 1000;
  ctx.trabalhando(P);
  timers[0]();
  const rel = P.trabEl.querySelector('.trab-rel');
  assert.equal(rel.textContent, '· 52 min');
  assert.equal(rel.title, 'Trabalhando há 52m25s');
  assert.equal(P.trabEl.querySelector('.trab-txt').textContent, 'trabalhando…', 'o rótulo não muda');
});

test('duracaoLegivel: segundos, minutos, horas; acima de um dia, o formato de sempre (UI 3.4)', () => {
  const { ctx } = tela();
  assert.deepEqual([45e3, 258e3, 3900e3, 30 * 3600e3].map(ctx.duracaoLegivel), ['45 s', '4 min', '1 h 05', '30h']);
});

test('"Esc para parar" numa linha só e escondido abaixo de 470 px (UI 4.3)', () => {
  assert.match(CSS, /\.trab-esc\{[^}]*white-space:nowrap/);
  assert.match(CSS, /\.trab-txt\{[^}]*white-space:nowrap/);
  assert.match(CSS, /@container \(max-width: 470px\)\{\s*\.trab-esc\{display:none\}\s*\}/);
});

/* Extras da T3 (além dos 7 do brief): o passo inteiro virou clicável, e o diff aberto (texto selecionável, como a
   saída) mora dentro dele. Medida: clique no texto do diff abrindo a saída (antes, só com 'button, a, .pa-saida': sim;
   depois, com .diff na lista: não) e o › do passo caindo sozinho abaixo do diff (antes sim; depois fica na linha 1). */
test('clique no diff aberto do passo não abre nem fecha a saída; clique na linha continua abrindo (UI 4.1)', () => {
  const { ctx, P } = tela();
  ctx.passo(P, { txt: 'Mexendo no arquivo', det: 'a.js' }, 'e1', 'Edit', 'C:\\p\\a.js');
  ctx.toolEnd(P, 'e1', 'The file a.js has been updated', false);
  const d = P.passosEl.querySelector('.passo');
  const diff = new El('div'); diff.className = 'diff'; d.appendChild(diff);
  const linhaDoDiff = new El('div'); diff.appendChild(linhaDoDiff);
  d.disparar('click', { target: linhaDoDiff });
  assert.equal(d.querySelector('.pa-saida'), null, 'o clique dentro do diff abriu a saída');
  d.disparar('click');
  assert.ok(d.querySelector('.pa-saida'), 'o clique na linha do passo abre a saída');
});

test('o diff aberto e os prints vêm depois do › e a saída por último (senão o › cai numa linha abaixo) (UI 4.1)', () => {
  assert.match(CSS, /\.passo \.diff,\.passo \.pa-imgs\{order:1\}/);
  assert.match(CSS, /\.pa-saida\{order:2;/);
});

/* Fecho dos extras: o diff não alterna o passo, então não pode herdar a mãozinha da linha (o texto dele se seleciona,
   como o da saída, que já tem cursor:text). Medida: cursor sobre o diff (antes: mãozinha herdada; depois: texto). */
test('o diff aberto mostra o cursor de texto, não a mãozinha da linha clicável (UI 4.1)', () => {
  assert.match(CSS, /\.passo\.expansivel\{[^}]*cursor:pointer/);
  assert.match(CSS, /\.passo \.diff\{cursor:text\}/);
  assert.match(CSS, /\.pa-saida\{[^}]*cursor:text\}/);
});

/* Leva 4, onda 1 (correção da revisão): o passo de terminal já abre enquanto roda, e o alternarPasso tira uma foto do _saida. O toolEnd
   não atualizava a caixa aberta: quem abriu para ver o comando ficava sem a saída e sem o erro até fechar e abrir de novo.
   Medida: texto da caixa aberta cedo, depois do fim do comando (antes: só o comando; depois: o comando e a saída ou o erro). */
test('caixa aberta enquanto o comando roda recebe a saída ou o erro quando ele termina (UI 4.1)', () => {
  const { ctx, P } = tela();
  for (const [id, erro, saida] of [['certo', false, 'linha 1\nlinha 2'], ['errado', true, 'Access is denied']]) {
    ctx.passo(P, { txt: 'Rodando no terminal', det: 'dir' }, id, 'Bash', 'dir ' + id);
    const d = ctx.acharPasso(P, id);
    d.disparar('click');
    assert.equal(d.querySelector('.pa-saida').textContent, 'dir ' + id, id + ': aberta cedo, só o comando');
    ctx.toolEnd(P, id, saida, erro);
    assert.equal(d.querySelector('.pa-saida').textContent, 'dir ' + id + '\n\n' + saida, id + ': a caixa aberta cedo ficou com a foto de antes do fim');
    assert.equal(d.getAttribute('aria-expanded'), 'true', id + ': segue aberta');
    d.disparar('click');
    assert.equal(d.querySelector('.pa-saida'), null, id + ': o clique seguinte fecha');
  }
  // ninguém abriu: o fim do comando não abre a caixa sozinho
  ctx.passo(P, { txt: 'Rodando no terminal', det: 'dir' }, 'fechado', 'Bash', 'dir fechado');
  ctx.toolEnd(P, 'fechado', 'saida', false);
  assert.equal(ctx.acharPasso(P, 'fechado').querySelector('.pa-saida'), null, 'o fim do comando não abre a caixa sozinho');
});

/* Leva 4, onda 1 (correção da revisão): arrastar para selecionar a saída e soltar na linha do passo, fora da .pa-saida, disparava o
   clique da linha e a caixa fechava com o texto selecionado. Agora o clique da linha é ignorado quando há texto selecionado (o vm não
   tem seleção: o getSelection é de mentira). Medida: caixa depois do clique que termina uma seleção (antes: fechava; depois: segue aberta). */
test('selecionar texto da saída e soltar na linha do passo não fecha a caixa (UI 4.1)', () => {
  const { ctx, P } = tela();
  // o passo de terminal ganha o ouvinte no passo(); o de edição ganha o dele no toolEnd()
  ctx.passo(P, { txt: 'Rodando no terminal', det: 'dir' }, 'term', 'Bash', 'dir term');
  ctx.toolEnd(P, 'term', 'saida term', false);
  ctx.passo(P, { txt: 'Mexendo no arquivo', det: 'a.js' }, 'edit', 'Edit', 'C:\\p\\a.js');
  ctx.toolEnd(P, 'edit', 'The file a.js has been updated', false);
  const selecionado = (texto) => { ctx.window.getSelection = () => ({ toString: () => texto }); };
  for (const id of ['term', 'edit']) {
    const d = ctx.acharPasso(P, id);
    selecionado('');
    d.disparar('click');
    assert.ok(d.querySelector('.pa-saida'), id + ': sem seleção, o clique abre');
    selecionado('saida');
    d.disparar('click');
    assert.ok(d.querySelector('.pa-saida'), id + ': o clique que terminou uma seleção fechou a caixa');
    assert.equal(d.getAttribute('aria-expanded'), 'true', id + ': segue aberta');
    d.disparar('keydown', { key: 'Enter' });
    assert.equal(d.querySelector('.pa-saida'), null, id + ': o teclado não depende da seleção, Enter fecha');
    d.disparar('click');
    assert.equal(d.querySelector('.pa-saida'), null, id + ': com texto selecionado o clique também não abre');
    selecionado('');
    d.disparar('click');
    assert.ok(d.querySelector('.pa-saida'), id + ': sem seleção, o clique volta a abrir');
  }
});

/* Leva 4, onda 3 (revisão da T3, que ficou da onda 1): o body tem user-select:none, então clicar na linha do passo NÃO limpa o texto que
   ficou selecionado na saída, e o clique da linha (que ignora clique com texto selecionado) ficava engolido até o usuário clicar em outro
   lugar. Agora o mousedown da linha, fora da .pa-saida, limpa a seleção. Medida: cliques para fechar a caixa depois de selecionar a
   saída (antes: 2, o 1o engolido; depois: 1). */
test('depois de selecionar a saída, o mousedown na linha limpa a seleção e o clique seguinte fecha a caixa (UI 4.1)', () => {
  const { ctx, P } = tela();
  // o passo de terminal ganha os ouvintes no passo(); o de edição ganha os dele no toolEnd()
  ctx.passo(P, { txt: 'Rodando no terminal', det: 'dir' }, 'term', 'Bash', 'dir term');
  ctx.toolEnd(P, 'term', 'saida term', false);
  ctx.passo(P, { txt: 'Mexendo no arquivo', det: 'a.js' }, 'edit', 'Edit', 'C:\\p\\a.js');
  ctx.toolEnd(P, 'edit', 'The file a.js has been updated', false);
  let texto = '';
  ctx.window.getSelection = () => ({ toString: () => texto, removeAllRanges: () => { texto = ''; } });
  for (const id of ['term', 'edit']) {
    const d = ctx.acharPasso(P, id);
    d.disparar('click');
    assert.ok(d.querySelector('.pa-saida'), id + ': abriu');
    texto = 'saida';                                              // arrastou na saída para selecionar
    d.disparar('click');
    assert.ok(d.querySelector('.pa-saida'), id + ': só o clique, com texto selecionado, é engolido (o body não deixa a seleção sair)');
    d.disparar('mousedown', { target: d.querySelector('.pa-saida') });
    assert.equal(texto, 'saida', id + ': mexer DENTRO da saída (selecionar outro trecho) não pode limpar a seleção');
    d.disparar('mousedown');                                      // o dedo desce na linha, fora da saída
    assert.equal(texto, '', id + ': o mousedown na linha limpou a seleção');
    d.disparar('click');
    assert.equal(d.querySelector('.pa-saida'), null, id + ': o clique depois do mousedown fecha a caixa');
    assert.equal(d.getAttribute('aria-expanded'), 'false');
  }
});

/* Leva 4, rodada final, item 4 (revisão final a7ed9b2c1aa8b7f86): o comando do passo de terminal não tinha teto (a saída já guarda 8000
   letras). Um script colado numa linha só (heredoc, base64) ia inteiro para a memória do painel e para a caixa. Medida: letras do comando
   guardado para um comando de 20 000 letras (antes 20 000; depois 8000). */
test('o comando guardado no passo de terminal tem teto de 8000 letras, igual à saída (item 4)', () => {
  const { ctx, P } = tela();
  const enorme = 'echo ' + 'x'.repeat(19995);
  ctx.passo(P, { txt: 'Rodando no terminal', det: 'echo' }, 'grande', 'Bash', enorme);
  const d = ctx.acharPasso(P, 'grande');
  assert.equal(d._comando.length, 8000);
  assert.equal(d._comando, enorme.slice(0, 8000), 'fica o começo, que é o que diz o que rodou');
  d.disparar('click');
  assert.equal(d.querySelector('.pa-saida').textContent.length, 8000, 'e a caixa mostra só isso');
  // a saída segue com o fim dela, no mesmo teto
  ctx.toolEnd(P, 'grande', 'a'.repeat(5000) + 'b'.repeat(5000), false);
  assert.equal(d._saida.length, 8000);
  assert.equal(d._saida.slice(-1), 'b');
  // comando curto: inteiro, sem mexer
  ctx.passo(P, { txt: 'Rodando no terminal', det: 'dir' }, 'curto', 'Bash', comando);
  assert.equal(ctx.acharPasso(P, 'curto')._comando, comando);
});
