'use strict';
/* Leva 4, Tarefa 8 (R2-04): itens dos menus (o + e o chip do git) pelo teclado. Medidas:
   - itens do menu alcançáveis pelo Tab (antes 0, tabIndex -1; depois todos);
   - onde fica o foco quando o menu fecha com o foco dentro (antes: num nó que saiu da tela; depois: no botão que abriu). */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');

const APP = lerFonte('renderer', 'app.js');
// elItem({ ic, … }, aoClicar): o corpo começa no "{" depois do ") {" (o pegarBloco pararia na desestruturação)
function corpo(nome) {
  const i = APP.indexOf('function ' + nome + '(');
  assert.ok(i >= 0, 'não achei ' + nome);
  let nivel = 0;
  for (let j = APP.indexOf(') {', i) + 2; j < APP.length; j++) { if (APP[j] === '{') nivel++; else if (APP[j] === '}' && --nivel === 0) return APP.slice(i, j + 1); }
  throw new Error('não fechei ' + nome);
}

function menu() {
  const doc = { activeElement: null };
  class El {
    constructor(tag) { this.tagName = String(tag).toUpperCase(); this.filhos = []; this.pai = null; this._cls = new Set(); this.attrs = {}; this.ouvintes = {}; this.tabIndex = -1; this._html = ''; }
    get className() { return [...this._cls].join(' '); }
    set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get classList() { const s = this._cls; return { add: (...c) => c.forEach((x) => s.add(x)), remove: (...c) => c.forEach((x) => s.delete(x)), contains: (c) => s.has(c) }; }
    get innerHTML() { return this._html; }
    set innerHTML(h) { this._html = h; for (const f of this.filhos) f.pai = null; this.filhos = []; for (const m of String(h).matchAll(/<div class="([^"]+)">/g)) { const e = new El('div'); e.className = m[1]; this.appendChild(e); } }
    set textContent(v) { this._texto = v; }
    get isConnected() { let x = this; while (x.pai) x = x.pai; return x === doc.body; }
    appendChild(c) { c.pai = this; this.filhos.push(c); return c; }
    contains(n) { for (let x = n; x; x = x.pai) if (x === this) return true; return false; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; }
    closest(sel) { const c = sel.replace(/^\./, ''); for (let x = this; x; x = x.pai) if (x._cls.has(c)) return x; return null; }
    querySelectorAll(sel) { const c = sel.replace(/^\./, ''), r = []; const andar = (x) => { for (const f of x.filhos) { if (f._cls.has(c)) r.push(f); andar(f); } }; andar(this); return r; }
    matches(s) { return s.split(',').some((t) => this.tagName === t.trim().toUpperCase()); }
    addEventListener(t, f) { (this.ouvintes[t] = this.ouvintes[t] || []).push(f); }
    disparar(t, extra) { const e = { target: this, preventDefault() {}, stopPropagation() {}, ...(extra || {}) }; for (const f of this.ouvintes[t] || []) f(e); return e; }
    click() { this.disparar('click'); }
    focus() { doc.activeElement = this; }
    querySelector(sel) { const papel = /\[role="([^"]+)"\]/.exec(sel); for (const f of this.filhos) { if (papel ? f.attrs.role === papel[1] : f._cls.has(sel.replace(/^\./, ''))) return f; const d = f.querySelector(sel); if (d) return d; } return null; }
  }
  doc.body = new El('body'); doc.createElement = (t) => new El(t);
  const pane = new El('section'), modal = new El('div'), cx = new El('div'), mais = new El('button'), pop = new El('div');
  modal.className = 'p-modal hidden'; cx.className = 'modal-cx'; pop.className = 'hidden';
  modal.appendChild(cx); pane.appendChild(modal); pane.appendChild(mais); doc.body.appendChild(pane); doc.body.appendChild(pop);
  const P = { id: 'p1', el: pane }, tarefas = [];
  const ctx = vm.createContext({ document: doc, panes: new Map([[P.id, P]]), ICONES: {}, ico: () => '', marcaDoMotor: () => '',
    $: (sel, raiz) => (sel === '#popGrupo' ? pop : sel === '.p-modal' ? modal : sel === '.modal-cx' ? cx : raiz ? raiz.querySelector(sel) : null),
    cancelarSaidaDoModal() {}, soltarNavArquivos() {}, pararBuscaEmVoo() {}, queueMicrotask: (f) => tarefas.push(f) });
  vm.runInContext(['fecharPopGlobal', 'fecharMenus', 'novoMenu', 'elItem'].map(corpo).join('\n'), ctx);
  return { ctx, doc, El, P, mais, rodar: () => { while (tarefas.length) tarefas.shift()(); } };
}

test('menu +: abre com o foco no 1º item; Tab alcança cada item; Enter clica e o foco volta ao + (R2-04)', () => {
  const t = menu();
  t.mais.focus();                                    // chegou no + pelo Tab e apertou Enter
  const cx = t.ctx.novoMenu(t.P);
  const feitos = [];
  for (const nome of ['Enviar do computador', 'Desenhar']) cx.appendChild(t.ctx.elItem({ ic: 'x', nome }, () => feitos.push(nome)));
  t.rodar();                                         // o microtask do novoMenu, depois dos itens
  const itens = cx.filhos;
  assert.equal(t.doc.activeElement, itens[0], 'o foco entra no 1º item');
  for (const i of itens) { assert.equal(i.tabIndex, 0); assert.equal(i.getAttribute('role'), 'menuitem'); }
  itens[1].focus();
  itens[1].disparar('keydown', { key: 'Enter' });
  assert.deepEqual(feitos, ['Desenhar']);
  assert.equal(t.doc.activeElement, t.mais, 'o item fechou o menu e o foco voltou ao +');
  const outro = t.ctx.novoMenu(t.P);
  outro.appendChild(t.ctx.elItem({ ic: 'x', nome: 'Desenhar' }, () => feitos.push('espaço')));
  t.rodar();
  t.doc.activeElement.disparar('keydown', { key: ' ' });
  assert.deepEqual(feitos, ['Desenhar', 'espaço'], 'Espaço também clica');
});

test('Esc (fecharMenus) com o foco dentro do menu devolve o foco a quem abriu (R2-04)', () => {
  const t = menu();
  t.mais.focus();
  const cx = t.ctx.novoMenu(t.P);
  cx.appendChild(t.ctx.elItem({ ic: 'x', nome: 'Desenhar' }, () => {}));
  t.rodar();
  cx.filhos[0].focus();
  t.ctx.fecharMenus();                               // é o que o Esc chama (tratarEsc)
  assert.equal(t.doc.activeElement, t.mais);
});

test('menu aberto pelo "@" do campo não rouba o foco do campo (R2-04)', () => {
  const t = menu();
  const campo = new t.El('textarea'); t.P.el.appendChild(campo); campo.focus();
  const cx = t.ctx.novoMenu(t.P);
  cx.appendChild(t.ctx.elItem({ ic: 'x', nome: 'arquivo.txt' }, () => {}));
  t.rodar();
  assert.equal(t.doc.activeElement, campo);
});

test('itens do chip do git e o pop global também andam pelo teclado (R2-04)', () => {
  const git = pegarBloco(APP, 'async function atualizarGit(', 'atualizarGit');
  assert.match(git, /d\.setAttribute\('role', 'menuitem'\); d\.tabIndex = 0;/);
  assert.match(git, /pop\.querySelector\('\.mi'\)\?\.focus\(\)/);
  assert.match(pegarBloco(APP, 'function abrirPopGlobal(', 'abrirPopGlobal'), /pop\._abriu = anchorEl;/);
  assert.match(pegarBloco(APP, 'function fecharPopGlobal(', 'fecharPopGlobal'), /volta\.focus\(\)/);
});

/* ---- Extras da implementação (além dos 4 testes do plano): o que o plano não mede ---- */
// abrirPopGlobal e atualizarGit de verdade, com o mínimo de mundo em volta; devolve o #popGrupo
function comPop(t) {
  t.ctx.window = { innerWidth: 1000, innerHeight: 800, api: {} };
  t.ctx.setTimeout = () => 0;
  vm.runInContext([corpo('abrirPopGlobal'), 'async ' + corpo('atualizarGit')].join('\n'), t.ctx);   // o corpo() começa em "function": o async volta na mão
  const popEl = t.ctx.$('#popGrupo');
  popEl.style = {};
  return popEl;
}

test('tecla segurada no item (e.repeat) não repete o clique, mas também não rola nem vaza a tecla (R2-04)', () => {
  // o Enter segurado no +: o 1º clique abre o menu e leva o foco ao 1º item; a repetição da tecla cairia nele e mandaria "Enviar do computador"
  const t = menu();
  t.mais.focus();
  const cx = t.ctx.novoMenu(t.P);
  const feitos = [];
  cx.appendChild(t.ctx.elItem({ ic: 'x', nome: 'Enviar do computador' }, () => feitos.push('enviar')));
  t.rodar();
  const item = t.doc.activeElement;
  let prev = 0, parou = 0;
  for (const key of ['Enter', ' ']) item.disparar('keydown', { key, repeat: true, preventDefault() { prev++; }, stopPropagation() { parou++; } });
  assert.deepEqual(feitos, [], 'a repetição da tecla segurada não clica');
  assert.deepEqual([prev, parou], [2, 2], 'mas a tecla segue consumida (o Espaço não rola o menu)');
  assert.equal(cx.filhos.length, 1, 'e o menu continua aberto');
  item.disparar('keydown', { key: 'Enter' });
  assert.deepEqual(feitos, ['enviar'], 'o primeiro toque, sem repeat, clica normalmente');
});

test('Tab, setas, letras e Esc passam pelo item sem ser engolidos (R2-04)', () => {
  const t = menu();
  t.mais.focus();
  const cx = t.ctx.novoMenu(t.P);
  const feitos = [];
  cx.appendChild(t.ctx.elItem({ ic: 'x', nome: 'Desenhar' }, () => feitos.push('x')));
  t.rodar();
  for (const key of ['Tab', 'ArrowDown', 'ArrowUp', 'a', 'Escape']) {
    let tocou = 0;
    t.doc.activeElement.disparar('keydown', { key, preventDefault() { tocou++; }, stopPropagation() { tocou++; } });
    assert.equal(tocou, 0, key + ' segue o caminho normal (o Esc chega ao escGlobal, o Tab anda pelo teclado)');
  }
  assert.deepEqual(feitos, []);
});

test('fechar o menu com o foco já fora dele não rouba o foco de quem o usuário foi usar (R2-04)', () => {
  const t = menu();
  t.mais.focus();
  const cx = t.ctx.novoMenu(t.P);
  cx.appendChild(t.ctx.elItem({ ic: 'x', nome: 'Desenhar' }, () => {}));
  t.rodar();
  assert.equal(t.doc.activeElement, cx.filhos[0]);
  const outro = new t.El('button'); t.P.el.appendChild(outro); outro.focus();   // o clique fora levou o foco a outro botão
  t.ctx.fecharMenus();
  assert.equal(t.doc.activeElement, outro);
  assert.equal(cx._abriu, null, 'e a lembrança de quem abriu foi solta');
});

test('de um menu pra outro (/ → Anexar arquivo…): o 2º menu devolve o foco ao mesmo botão do 1º (R2-04)', () => {
  const t = menu();
  t.mais.focus();
  const cx = t.ctx.novoMenu(t.P);
  cx.appendChild(t.ctx.elItem({ ic: 'x', nome: 'Anexar arquivo…' }, () => {
    const dois = t.ctx.novoMenu(t.P);                // o item fecha o 1º menu (o foco volta ao +) e o 2º abre a partir dali
    dois.appendChild(t.ctx.elItem({ ic: 'x', nome: 'Enviar do computador' }, () => {}));
  }));
  t.rodar();
  t.doc.activeElement.disparar('keydown', { key: 'Enter' });
  t.rodar();
  assert.equal(cx._abriu, t.mais, 'o 2º menu lembra o + e não o item do 1º');
  assert.equal(t.doc.activeElement.getAttribute('role'), 'menuitem', 'o foco entrou no 1º item do 2º menu');
  t.ctx.fecharMenus();
  assert.equal(t.doc.activeElement, t.mais);
});

test('menu aberto sem ninguém com o foco (corpo da página): nada é movido, nada é guardado (R2-04)', () => {
  const t = menu();
  t.doc.body.focus();
  const cx = t.ctx.novoMenu(t.P);
  cx.appendChild(t.ctx.elItem({ ic: 'x', nome: 'Desenhar' }, () => {}));
  t.rodar();
  assert.equal(cx._abriu, null);
  assert.equal(t.doc.activeElement, t.doc.body);
  t.ctx.fecharMenus();                               // sem quem abriu, não há pra onde devolver
  assert.equal(t.doc.activeElement, t.doc.body);
});

test('pop global: abrirPopGlobal guarda quem abriu; o foco só volta a ele se estava DENTRO do pop (R2-04)', () => {
  const t = menu();
  const popEl = comPop(t);
  const ancora = new t.El('button'); ancora.getBoundingClientRect = () => ({ left: 5, bottom: 20, top: 0 });
  t.P.el.appendChild(ancora);
  assert.equal(t.ctx.abrirPopGlobal(ancora), popEl);
  assert.equal(popEl._abriu, ancora);
  const item = new t.El('div'); popEl.appendChild(item); item.focus();
  t.ctx.fecharPopGlobal();
  assert.equal(t.doc.activeElement, ancora, 'com o foco dentro, volta pra quem abriu');
  assert.equal(popEl._abriu, null);
  // clicou fora: o foco já está noutro lugar e não é roubado
  t.ctx.abrirPopGlobal(ancora);
  const outro = new t.El('button'); t.P.el.appendChild(outro); outro.focus();
  t.ctx.fecharPopGlobal();
  assert.equal(t.doc.activeElement, outro);
  // quem abriu saiu da tela (lista redesenhada): não tenta focar o que não existe mais
  t.ctx.abrirPopGlobal(ancora);
  const dentro = new t.El('div'); popEl.appendChild(dentro); dentro.focus();
  ancora.pai.filhos = ancora.pai.filhos.filter((x) => x !== ancora); ancora.pai = null;
  t.ctx.fecharPopGlobal();
  assert.notEqual(t.doc.activeElement, ancora, 'quem abriu saiu da tela: o foco não vai pra um nó solto');
});

test('quem abriu o menu saiu da tela antes do fechamento (o chip de sugestão some no fim do turno): o foco não vai pra um nó solto (R2-04)', () => {
  const t = menu();
  t.mais.focus();
  const cx = t.ctx.novoMenu(t.P);
  cx.appendChild(t.ctx.elItem({ ic: 'x', nome: 'Desenhar' }, () => {}));
  t.rodar();
  t.P.el.filhos = t.P.el.filhos.filter((x) => x !== t.mais); t.mais.pai = null;   // o botão que abriu foi removido
  t.ctx.fecharMenus();
  assert.notEqual(t.doc.activeElement, t.mais);
});

test('chip do git: o foco entra no 1º arquivo, Espaço abre o diff e o foco volta ao chip (R2-04)', async () => {
  const t = menu();
  const popEl = comPop(t);
  const chip = new t.El('button'); chip.className = 'p-git'; chip.getBoundingClientRect = () => ({ left: 10, bottom: 30, top: 10 });
  t.P.el.appendChild(chip);
  const diffs = [];
  Object.assign(t.ctx, { remotoDoPane: () => null, cwdGitDoPainel: () => '/proj', baseNome: (p) => String(p).split('/').pop(),
    mostrarDiffGit: (P, nome, texto) => diffs.push([nome, texto]) });
  t.ctx.window.api = { gitStatus: async () => ({ branch: 'main', arquivos: [{ nome: 'src/a.js', estado: 'M' }, { nome: 'src/b.js', estado: 'A' }] }),
    gitDiff: async (p) => 'diff de ' + p.arquivo };
  await t.ctx.atualizarGit(t.P);
  chip.focus();
  chip.onclick({ stopPropagation() {} });            // o clique (ou o Enter) no chip
  assert.equal(popEl.filhos.length, 2);
  for (const i of popEl.filhos) { assert.equal(i.tabIndex, 0); assert.equal(i.getAttribute('role'), 'menuitem'); }
  assert.equal(t.doc.activeElement, popEl.filhos[0], 'o foco entra no 1º arquivo');
  popEl.filhos[1].focus();
  popEl.filhos[1].disparar('keydown', { key: ' ' });
  await new Promise((ok) => setImmediate(ok));
  assert.deepEqual(diffs, [['src/b.js', 'diff de src/b.js']], 'o Espaço abriu o diff do arquivo certo');
  assert.equal(t.doc.activeElement, chip, 'o pop fechou e o foco voltou ao chip');
  chip.onclick({ stopPropagation() {} });
  assert.equal(t.doc.activeElement, popEl.filhos[0]);
  t.ctx.fecharPopGlobal();                           // é o que o Esc chama (tratarEsc)
  assert.equal(t.doc.activeElement, chip, 'Esc também devolve o foco ao chip');
});

/* Leva 4, onda 3 (limpeza da revisão da T8): o outline do .mi:focus-visible (style.css) nunca valia: o .ck-app :focus-visible
   (cockpit-ui.css) tem a mesma especificidade e vem depois na cascata, então é ele que desenha o anel do item. O .mi só pinta o fundo. */
test('o anel de foco do item do menu vem do .ck-app :focus-visible; o .mi:focus-visible só pinta o fundo (R2-04)', () => {
  const css = lerFonte('renderer', 'style.css'), ui = lerFonte('renderer', 'cockpit-ui.css');
  assert.match(ui, /\.ck-app :focus-visible \{\s*outline: 2px solid var\(--focus\);/, 'o anel de foco de todo o app');
  const regra = /\.mi:focus-visible\s*\{([^}]*)\}/.exec(css);
  assert.ok(regra, 'o item focado continua com o fundo de hover');
  assert.match(regra[1], /background:\s*var\(--hover\)/);
  assert.doesNotMatch(regra[1], /outline/, 'outline sem efeito: perdia para o .ck-app :focus-visible');
});

/* Leva 5, T3 (R1-05, R3-04): os menus do #popGrupo que montam o próprio .mi (pastas da aba, "Mais ações", grupos, engrenagem,
   botão direito da árvore) andam pelo teclado por um ouvinte só, no abrirPopGlobal. Medida: itens alcançáveis pelo Tab na
   lista de pastas (antes 0; depois todos). */
test('pop global: item sem tecla própria entra no Tab, Enter e Espaço clicam, o foco entra no 1º (R1-05, R3-04)', () => {
  const t = menu();
  const popEl = comPop(t);
  const botao = new t.El('button'); botao.getBoundingClientRect = () => ({ left: 10, bottom: 30, top: 10 });
  t.P.el.appendChild(botao);
  botao.focus();
  const pop = t.ctx.abrirPopGlobal(botao);
  const cliques = [];
  for (const nome of ['backend', 'frontend']) { const d = new t.El('div'); d.className = 'mi'; d.addEventListener('click', () => cliques.push(nome)); pop.appendChild(d); }
  const desligado = new t.El('div'); desligado.className = 'mi mi-desligado'; pop.appendChild(desligado);
  t.rodar();
  for (const i of popEl.filhos.slice(0, 2)) { assert.equal(i.tabIndex, 0); assert.equal(i.getAttribute('role'), 'menuitem'); }
  assert.equal(desligado.tabIndex, -1, 'item desligado fica fora do Tab');
  assert.equal(t.doc.activeElement, popEl.filhos[0], 'o foco entra no 1º item');
  let travou = 0;
  const tecla = (key, alvo, extra) => pop.onkeydown({ key, target: alvo, repeat: false, defaultPrevented: false, preventDefault() { travou++; }, stopPropagation() {}, ...extra });
  tecla('Enter', popEl.filhos[1]);
  tecla(' ', popEl.filhos[0]);
  tecla('Enter', popEl.filhos[0], { repeat: true });
  tecla('Enter', popEl.filhos[0], { defaultPrevented: true });   // o item já tratou (menu da aba): não clica de novo
  assert.deepEqual(cliques, ['frontend', 'backend']);
  tecla('Tab', popEl.filhos[0]);
  assert.equal(travou, 3, 'Enter, Espaço e o Enter segurado são consumidos; o Tab passa');
});

test('o menu do painel é role="menu" enquanto está aberto (pendência da leva 4)', () => {
  const t = menu();
  t.mais.focus();
  const cx = t.ctx.novoMenu(t.P);
  assert.equal(cx.getAttribute('role'), 'menu');
  t.ctx.fecharMenus();
  assert.equal(cx.getAttribute('role'), null, 'a mesma caixa vira janela de terminal ou de contas: o papel sai ao fechar');
});

/* Leva 5, onda 1 (revisão da T3): o menu do botão direito da árvore, das pastas da aba, dos grupos e da engrenagem mora no #popGrupo;
   o abrirPopGlobal já marca os itens .mi como menuitem, e a caixa que os guarda diz que é um menu (como o .modal-cx do novoMenu).
   Escondido (.hidden, display:none) o papel não aparece para o leitor de tela. */
test('o #popGrupo, caixa do menu do botão direito e dos menus de pasta, grupo e conta, é role="menu" no index.html (revisão da T3)', () => {
  const tag = /<div\b[^>]*\bid="popGrupo"[^>]*>/.exec(lerFonte('renderer', 'index.html'));
  assert.ok(tag, 'falta o #popGrupo no index.html');
  assert.match(tag[0], /\brole="menu"/, 'o #popGrupo é role="menu": ' + tag[0]);
  assert.match(tag[0], /\bclass="[^"]*\bhidden\b[^"]*"/, 'e continua nascendo escondido');
});

/* Leva 5, onda 1 (revisão da T3): os itens do menu da aba (botão direito) e do menu de contas tratam a própria tecla
   (preventDefault + click) e o ouvinte do pop saía na hora por causa do defaultPrevented, sem segurar o evento: o Enter subia ao
   document, onde o ouvinte "abertura" abre Claude e Codex em qualquer Enter enquanto a tela de boas-vindas existe. Medida: Enter
   e Espaço de item que já tratou a tecla que sobem ao document (antes 2 de 2; depois 0). */
test('pop global: Enter e Espaço que o próprio item já tratou ficam no menu e não sobem ao "abertura" do document (revisão da T3)', () => {
  const t = menu();
  comPop(t);
  const botao = new t.El('button'); botao.getBoundingClientRect = () => ({ left: 10, bottom: 30, top: 10 });
  t.P.el.appendChild(botao);
  botao.focus();
  const pop = t.ctx.abrirPopGlobal(botao);
  const cliques = [];
  const item = new t.El('div'); item.className = 'mi'; item.addEventListener('click', () => cliques.push('item')); pop.appendChild(item);
  const desligado = new t.El('div'); desligado.className = 'mi mi-desligado'; desligado.addEventListener('click', () => cliques.push('desligado')); pop.appendChild(desligado);
  t.rodar();
  // devolve true quando a tecla NÃO chegaria ao document (o pop chamou stopPropagation)
  const tecla = (key, extra) => {
    let parou = false;
    pop.onkeydown({ key, target: item, repeat: false, defaultPrevented: false, preventDefault() {}, stopPropagation() { parou = true; }, ...extra });
    return parou;
  };
  for (const key of ['Enter', ' ']) {
    assert.equal(tecla(key, { defaultPrevented: true }), true, key + ' já tratado pelo item: não sobe ao document');
    assert.equal(tecla(key, { defaultPrevented: true, repeat: true }), true, key + ' segurado, já tratado pelo item: também não');
    assert.equal(tecla(key, { target: desligado }), true, key + ' num item desligado: fica no menu');
    assert.equal(tecla(key, { target: pop }), true, key + ' fora de qualquer item: fica no menu');
  }
  assert.deepEqual(cliques, [], 'o pop não clica de novo o item que já tratou a tecla, nem o desligado, nem o vazio');
  for (const key of ['Tab', 'Escape', 'ArrowDown', 'a']) assert.equal(tecla(key), false, key + ' segue o caminho normal (o Esc chega ao escGlobal, o Tab anda)');
  assert.equal(tecla('Enter'), true);
  assert.deepEqual(cliques, ['item'], 'sem regressão: o item sem tecla própria continua clicando uma vez');
});

/* Rodada final da leva 5 (item 5): no #popGrupo, Tab no último item saía do menu aberto e Shift+Tab no 1º ia ao Enviar. Agora o
   Tab dá a volta nas pontas, como o keyLayer na camada não modal; no meio o navegador anda sozinho, e Ctrl+Tab não é do menu. */
test('pop global: Tab no último item volta ao 1º, Shift+Tab no 1º vai ao último; no meio e com Ctrl o Tab passa (final)', () => {
  const t = menu();
  const popEl = comPop(t);
  const botao = new t.El('button'); botao.getBoundingClientRect = () => ({ left: 10, bottom: 30, top: 10 });
  t.P.el.appendChild(botao);
  botao.focus();
  const pop = t.ctx.abrirPopGlobal(botao);
  for (let i = 0; i < 3; i++) { const d = new t.El('div'); d.className = 'mi'; pop.appendChild(d); }
  const desligado = new t.El('div'); desligado.className = 'mi mi-desligado'; pop.appendChild(desligado);   // fora do Tab: o último é o 3º
  t.rodar();
  const [a, , c] = popEl.filhos;
  let segurou = 0;
  const tab = (shiftKey, extra) => pop.onkeydown({ key: 'Tab', shiftKey, target: t.doc.activeElement, repeat: false, defaultPrevented: false,
    preventDefault() { segurou++; }, stopPropagation() {}, ...extra });
  assert.equal(t.doc.activeElement, a, 'o foco entra no 1º item');
  tab(true);
  assert.equal(t.doc.activeElement, c, 'Shift+Tab no 1º vai ao último (antes ia ao Enviar)');
  tab(false);
  assert.equal(t.doc.activeElement, a, 'Tab no último volta ao 1º (antes saía do menu aberto)');
  assert.equal(segurou, 2, 'as duas pontas seguram o Tab do navegador');
  tab(false);
  assert.equal(segurou, 2, 'no meio o Tab não é segurado: o navegador anda sozinho');
  assert.equal(t.doc.activeElement, a, 'e o menu não mexe no foco');
  c.focus();
  tab(false, { ctrlKey: true });
  assert.equal(segurou, 2, 'Ctrl+Tab é atalho do app, não do menu');
  assert.equal(t.doc.activeElement, c);
});
