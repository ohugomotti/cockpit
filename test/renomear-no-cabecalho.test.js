'use strict';
/* Leva 5g (07/10/2026, print do Hugo): renomear a sessão pelo título.

   Antes, com o visual novo, o campo abria numa LINHA SEPARADA acima do cabeçalho do painel, com um pontinho roxo na frente, e o
   título velho continuava visível embaixo. O renomearAqui punha o <input> dentro da barra antiga (.pane-nome), que o visual novo
   esconde o tempo todo (cockpit-ui.css: .ck-app .pane-nome { display: none !important }) e só mostrava durante a edição
   (.ck-app .pane-nome:has(.pn-input)). O título que se vê é o botão .ck-pane-title, dentro do .pane-hd.

   Agora, com o .ck-pane-title no painel, o campo entra NO LUGAR dele: o título fica escondido e o <input> vem logo depois, na mesma
   linha do cabeçalho, com a mesma largura (flex: 1, min-width igual), a mesma fonte e o mesmo peso, com o visual Mac ligado ou
   desligado. Sem o .ck-pane-title (sem o visual novo) vale a barra de sempre. Nos dois caminhos: spellcheck = false (o corretor do
   Windows abria "Pedroso / Pedrosa" em cima do nome) e clicar ou selecionar dentro do campo não começa a arrastar o painel.

   O renomearAqui, o pintarNome, o tituloNaTorre e o ligarArrastarPainel rodam DE VERDADE (recortados do app.js) num DOM de
   mentira que repete o que o Chromium faz de relevante aqui: tirar da tela o campo que tem o foco dispara o blur dele, e o
   dragstart sobe pelos pais. O CSS é conferido pelas regras do cockpit-ui.css e do visual-mac.css. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');

const APP = lerFonte('renderer', 'app.js');
const UI_JS = lerFonte('renderer', 'cockpit-ui.js');
const CSS_UI = lerFonte('renderer', 'cockpit-ui.css');
const CSS_MAC = lerFonte('renderer', 'visual-mac.css');
const CSS_BASE = lerFonte('renderer', 'style.css');
const CSS_TOKENS = lerFonte('renderer', 'tokens.css');
const assentar = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

/* ---------- DOM de mentira ---------- */
const doc = { ativo: null };
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.filhos = []; this.pai = null; this.ouvintes = {}; this.style = { display: '' }; this.dataset = {};
    this._attrs = {}; this._cls = new Set(); this._txt = ''; this.title = ''; this.value = ''; this.selecionado = false;
  }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() {
    const s = this._cls;
    return { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c), toggle: (c, on) => { if (on === undefined ? !s.has(c) : on) s.add(c); else s.delete(c); } };
  }
  get textContent() { return this._txt; }
  set textContent(v) { this._txt = String(v); }
  get parentNode() { return this.pai; }
  get nextSibling() { if (!this.pai) return null; return this.pai.filhos[this.pai.filhos.indexOf(this) + 1] || null; }
  add(tag, cls) { const f = new El(tag); f.className = cls; this.appendChild(f); return f; }
  appendChild(f) { if (f.pai) f.remove(); f.pai = this; this.filhos.push(f); return f; }
  insertBefore(f, ref) { if (f.pai) f.remove(); f.pai = this; const i = this.filhos.indexOf(ref); this.filhos.splice(i < 0 ? this.filhos.length : i, 0, f); return f; }
  after(...nos) { if (!this.pai) return; const pai = this.pai; let ref = this.nextSibling; for (const n of nos) pai.insertBefore(n, ref); }
  // como no Chromium: tirar da tela o campo que tem o foco dispara o blur dele
  remove() { if (!this.pai) return; this.pai.filhos.splice(this.pai.filhos.indexOf(this), 1); this.pai = null; if (doc.ativo === this) { doc.ativo = null; this.disparar('blur'); } }
  querySelector(sel) {
    const m = /^\.([\w-]+)$/.exec(sel);
    if (!m) return null;
    const anda = (n) => { for (const f of n.filhos) { if (f._cls.has(m[1])) return f; const r = anda(f); if (r) return r; } return null; };
    return anda(this);
  }
  todos(cls, achados = []) { for (const f of this.filhos) { if (f._cls.has(cls)) achados.push(f); f.todos(cls, achados); } return achados; }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  addEventListener(t, fn) { (this.ouvintes[t] ||= []).push(fn); }
  // o dragstart e o keydown sobem pelos pais, como no navegador; o blur não
  disparar(tipo, ev = {}) {
    const e = { type: tipo, target: this, parou: false, cancelado: false, stopPropagation() { this.parou = true; }, preventDefault() { this.cancelado = true; }, ...ev };
    for (let n = this; n && !e.parou; n = tipo === 'blur' ? null : n.pai) for (const fn of n.ouvintes[tipo] || []) fn(e);
    return e;
  }
  focus() { doc.ativo = this; }
  select() { this.selecionado = true; }
}

const REMOTO = { host: 'servidor', usuario: 'hugo' };
/* Um painel como o do app: a barra antiga (.pane-nome: .pn-txt + .pn-edit) e o cabeçalho (.pane-hd: motor, [título do visual novo],
   pasta, fechar). O estado do histórico (aba aberta ou fechada), a resposta do main e o corretor são ajustáveis. */
function montar({ visualNovo = true, titulo = 'Campanha do Pedro', historicoAberto = false, respostaDoMain = { ok: true } } = {}) {
  doc.ativo = null;
  const el = new El('section');
  const barra = el.add('div', 'pane-nome');
  const txt = barra.add('span', 'pn-txt'); txt.textContent = titulo;
  const lapis = barra.add('button', 'pn-edit');
  const cab = el.add('header', 'pane-hd');
  cab.add('button', 'p-motor');
  const botaoTitulo = visualNovo ? cab.add('button', 'ck-pane-title') : null;
  if (botaoTitulo) botaoTitulo.textContent = titulo;
  cab.add('button', 'p-cwd');
  cab.add('button', 'p-close');
  const P = { id: 'p1', engine: 'claude', sessaoId: 'S1', titulo, nomeManual: false, tituloAuto: true, el };
  const registro = [], notas = [], renomeados = [];
  const aba = { classList: { contains: (c) => c === 'hidden' && !historicoAberto } };
  const ctx = vm.createContext({
    document: { createElement: (t) => new El(t), querySelectorAll: () => [] },
    $: (sel, raiz) => (raiz ? raiz.querySelector(sel) : (sel.startsWith('.side-view') ? aba : null)),
    // o refresh do cockpit-ui.js (decoratePane) repinta o botão do título com o tituloNaTorre: aqui na hora, no app no quadro seguinte
    window: {
      CockpitUI: { refresh() { registro.push('refresh'); const t = el.querySelector('.ck-pane-title'); if (t) t.textContent = ctx.tituloNaTorre(P); } },
      api: { renomear: async (r) => { registro.push('renomear'); renomeados.push(r); return respostaDoMain; } },
    },
    cancelarRevisaoDoNome: () => registro.push('cancelar'),
    savePanes: () => registro.push('savePanes'),
    note: (p, texto, erro) => notas.push({ texto, erro: !!erro }),
    remotoDoPane: () => REMOTO,
    histCache: { claude: [{ id: 'S1' }] },
    loadHist: (motor, forcar) => registro.push('loadHist:' + motor + ':' + forcar),
    arrastando: null,
  });
  vm.runInContext(['function tituloNaTorre(', 'function pintarNome(', 'function renomearAqui(', 'function ligarArrastarPainel('].map((a) => pegarBloco(APP, a)).join('\n'), ctx);
  if (botaoTitulo) ctx.ligarArrastarPainel(P, botaoTitulo);   // como o cockpit-ui.js faz no attach: o título é a alça
  ctx.ligarArrastarPainel(P);                                 // e a barra antiga, como o newPane
  return {
    ctx, P, el, barra, txt, lapis, cab, botaoTitulo, registro, notas, renomeados,
    campo: () => el.querySelector('.pn-input'),
    quantos: () => el.todos('pn-input').length,
    abrir: () => { ctx.renomearAqui(P); return el.querySelector('.pn-input'); },
    // visual novo: abre e já confere que o campo ficou no cabeçalho, no lugar do título, que saiu da frente
    abrirNoLugar: () => {
      ctx.renomearAqui(P);
      const campo = el.querySelector('.pn-input');
      assert.ok(campo, 'abriu o campo');
      assert.equal(campo.pai, cab, 'o campo está no cabeçalho');
      assert.equal(botaoTitulo.style.display, 'none', 'e o título saiu da frente');
      return campo;
    },
  };
}

/* ---------- o campo no lugar do título ---------- */
test('visual novo: o campo entra no .pane-hd, logo depois do .ck-pane-title escondido, e não dentro da .pane-nome', () => {
  const t = montar();
  const campo = t.abrir();
  assert.ok(campo, 'abriu o campo');
  assert.equal(campo.pai, t.cab, 'o campo é filho do cabeçalho');
  assert.equal(t.cab.filhos[t.cab.filhos.indexOf(t.botaoTitulo) + 1], campo, 'logo depois do título, na mesma linha, antes da pasta e do fechar');
  assert.equal(t.botaoTitulo.style.display, 'none', 'o título velho some enquanto o campo está aberto');
  assert.equal(t.barra.querySelector('.pn-input'), null, 'a barra antiga nunca recebe o campo no visual novo (ela fica escondida; o :has a mostraria)');
  assert.equal(t.quantos(), 1);
});

test('o foco vai para o campo com o texto selecionado, sem corretor ortográfico, e com nome para o leitor de tela', () => {
  const t = montar({ titulo: 'Pedro Pedroso' });
  const campo = t.abrirNoLugar();
  assert.equal(doc.ativo, campo, 'foco no campo');
  assert.equal(campo.selecionado, true, 'texto selecionado');
  assert.equal(campo.value, 'Pedro Pedroso', 'começa com o nome de agora');
  assert.equal(campo.spellcheck, false, 'o corretor do Windows não sugere "Pedroso / Pedrosa" em cima do nome');
  assert.ok(campo.getAttribute('aria-label'), 'o campo tem nome acessível: o título que ele substitui estava escondido');
});

test('Enter salva: o nome vira seu, a revisão automática cancela, grava no main, e o título volta com o nome novo', async () => {
  const t = montar();
  const campo = t.abrirNoLugar();
  campo.value = '  Campanha Nova  ';
  const e = campo.disparar('keydown', { key: 'Enter' });
  assert.equal(e.cancelado, true, 'Enter não vaza para o resto da tela');
  await assentar();
  assert.equal(t.P.titulo, 'Campanha Nova');
  assert.equal(t.P.nomeManual, true);
  assert.equal(t.P.tituloAuto, false);
  assert.deepEqual(t.registro, ['cancelar', 'refresh', 'savePanes', 'renomear'], 'a ordem de sempre');
  // o objeto nasce dentro do vm (outro Object.prototype): compara pelo conteúdo
  assert.deepEqual(JSON.parse(JSON.stringify(t.renomeados)), [{ engine: 'claude', id: 'S1', nome: 'Campanha Nova', remoto: REMOTO }]);
  assert.equal(t.ctx.histCache.claude, null, 'a lista do histórico é refeita');
  assert.equal(t.campo(), null, 'o campo saiu');
  assert.equal(t.botaoTitulo.style.display, '', 'o título voltou');
  assert.equal(t.botaoTitulo.textContent, 'Campanha Nova', 'com o nome novo');
  assert.equal(t.txt.textContent, 'Campanha Nova', 'a barra antiga também leva o nome novo (pintarNome)');
  assert.equal(t.registro.filter((x) => x === 'renomear').length, 1, 'o blur que o Chromium dispara ao tirar o campo não grava de novo');
});

test('com a aba do histórico aberta, salvar recarrega a lista; fechada, só zera o cache', async () => {
  const aberta = montar({ historicoAberto: true });
  aberta.abrirNoLugar().value = 'Outro';
  aberta.campo().disparar('keydown', { key: 'Enter' });
  await assentar();
  assert.ok(aberta.registro.includes('loadHist:claude:true'));
  const fechada = montar({ historicoAberto: false });
  fechada.abrirNoLugar().value = 'Outro';
  fechada.campo().disparar('keydown', { key: 'Enter' });
  await assentar();
  assert.ok(!fechada.registro.some((x) => x.startsWith('loadHist')));
});

test('o main recusar a gravação avisa no painel, e o nome fica no painel', async () => {
  const t = montar({ respostaDoMain: { ok: false, error: 'nomes.json ilegível' } });
  t.abrirNoLugar().value = 'Nome que o main recusou';
  t.campo().disparar('keydown', { key: 'Enter' });
  await assentar();
  assert.deepEqual(t.notas, [{ texto: 'nomes.json ilegível', erro: true }]);
  assert.equal(t.P.titulo, 'Nome que o main recusou');
});

test('Esc cancela: nada é salvo, o Esc não sobe para o resto da tela, e o título volta com o nome de antes', async () => {
  const t = montar();
  const campo = t.abrirNoLugar();
  campo.value = 'Digitei e desisti';
  const e = campo.disparar('keydown', { key: 'Escape' });
  assert.equal(e.parou, true, 'stopPropagation: o Esc não para o turno nem fecha camadas');
  await assentar();
  assert.equal(t.P.titulo, 'Campanha do Pedro');
  assert.equal(t.P.nomeManual, false);
  assert.deepEqual(t.registro, [], 'nada gravado, nada repintado');
  assert.equal(t.campo(), null);
  assert.equal(t.botaoTitulo.style.display, '');
  assert.equal(t.botaoTitulo.textContent, 'Campanha do Pedro');
});

test('sair do campo (blur) salva', async () => {
  const t = montar();
  const campo = t.abrirNoLugar();
  campo.value = 'Saí do campo';
  campo.disparar('blur');
  await assentar();
  assert.equal(t.P.titulo, 'Saí do campo');
  assert.deepEqual(t.renomeados.map((r) => r.nome), ['Saí do campo']);
  assert.equal(t.campo(), null);
  assert.equal(t.botaoTitulo.style.display, '');
});

test('nome igual ou vazio fecha o campo e o título volta, sem gravar nada', async () => {
  for (const digitado of ['Campanha do Pedro', '   ', '']) {
    const t = montar();
    const campo = t.abrirNoLugar();
    campo.value = digitado;
    campo.disparar('keydown', { key: 'Enter' });
    await assentar();
    assert.deepEqual(t.registro, [], 'digitado ' + JSON.stringify(digitado));
    assert.equal(t.P.titulo, 'Campanha do Pedro');
    assert.equal(t.campo(), null);
    assert.equal(t.botaoTitulo.style.display, '');
  }
});

test('dois cliques seguidos não abrem dois campos, e o campo aberto não perde o que foi digitado', () => {
  const t = montar();
  const primeiro = t.abrirNoLugar();
  primeiro.value = 'a meio caminho';
  const segundo = t.abrirNoLugar();
  assert.equal(segundo, primeiro, 'o segundo clique devolve o mesmo campo');
  assert.equal(t.quantos(), 1, 'um campo só');
  assert.equal(primeiro.value, 'a meio caminho');
  assert.equal(t.botaoTitulo.style.display, 'none');
});

test('terminada a edição, dá para renomear de novo', async () => {
  const t = montar();
  t.abrirNoLugar().disparar('keydown', { key: 'Escape' });
  await assentar();
  const outra = t.abrirNoLugar();
  assert.ok(outra, 'abriu de novo');
  assert.equal(outra.pai, t.cab);
  assert.equal(t.botaoTitulo.style.display, 'none');
  assert.equal(t.quantos(), 1);
});

/* ---------- sem o visual novo: o caminho antigo ---------- */
test('sem o .ck-pane-title, vale a barra de sempre: o campo vai antes do .pn-txt, que e o lápis somem, e tudo volta no fim', async () => {
  const t = montar({ visualNovo: false });
  const campo = t.abrir();
  assert.equal(campo.pai, t.barra, 'o campo é filho da barra');
  assert.equal(t.barra.filhos[t.barra.filhos.indexOf(campo) + 1], t.txt, 'antes do texto do nome');
  assert.equal(t.txt.style.display, 'none');
  assert.equal(t.lapis.style.display, 'none');
  assert.equal(t.barra.getAttribute('draggable'), 'false', 'enquanto edita, o mouse é do campo');
  assert.equal(t.cab.querySelector('.pn-input'), null, 'nada no cabeçalho');
  assert.equal(doc.ativo, campo);
  assert.equal(campo.selecionado, true);
  assert.equal(campo.spellcheck, false, 'também sem o corretor');
  assert.equal(t.quantos(), 1);
  t.abrir();
  assert.equal(t.quantos(), 1, 'dois cliques seguidos, um campo só');
  campo.value = 'Nome na barra';
  campo.disparar('keydown', { key: 'Enter' });
  await assentar();
  assert.equal(t.P.titulo, 'Nome na barra');
  assert.deepEqual(t.renomeados.map((r) => r.nome), ['Nome na barra']);
  assert.equal(t.campo(), null);
  assert.equal(t.txt.style.display, '');
  assert.equal(t.lapis.style.display, '');
  assert.equal(t.barra.getAttribute('draggable'), 'true', 'volta a poder arrastar');
  assert.equal(t.txt.textContent, 'Nome na barra');
});

test('sem o .ck-pane-title, Esc cancela e sair do campo salva, como sempre', async () => {
  const esc = montar({ visualNovo: false });
  const c1 = esc.abrir();
  c1.value = 'desisti';
  assert.equal(c1.disparar('keydown', { key: 'Escape' }).parou, true);
  await assentar();
  assert.deepEqual(esc.registro, []);
  assert.equal(esc.txt.style.display, '');
  const blur = montar({ visualNovo: false });
  const c2 = blur.abrir();
  c2.value = 'saí';
  c2.disparar('blur');
  await assentar();
  assert.equal(blur.P.titulo, 'saí');
});

/* ---------- arrastar o painel ---------- */
test('com o campo aberto, o título não é alça de arrastar; depois volta a ser', async () => {
  const t = montar();
  assert.equal(t.botaoTitulo.getAttribute('draggable'), 'true', 'antes: o título arrasta o painel');
  t.abrirNoLugar();
  assert.equal(t.botaoTitulo.getAttribute('draggable'), 'false', 'enquanto edita, o título escondido não é alça');
  t.campo().disparar('keydown', { key: 'Escape' });
  await assentar();
  assert.equal(t.botaoTitulo.getAttribute('draggable'), 'true', 'depois: volta a arrastar');
  const dados = {};
  t.botaoTitulo.disparar('dragstart', { dataTransfer: { setData: (k, v) => { dados[k] = v; } } });
  assert.equal(t.ctx.arrastando, 'p1', 'e o arrasto pelo título funciona');
  assert.equal(dados['text/plain'], 'p1');
});

test('clicar ou arrastar o texto selecionado dentro do campo não começa a arrastar o painel (visual novo e barra antiga)', () => {
  for (const visualNovo of [true, false]) {
    const t = montar({ visualNovo });
    const campo = t.abrir();
    const evento = campo.disparar('dragstart', { dataTransfer: { setData() { throw new Error('não podia gravar nada no arrasto'); } } });
    assert.equal(t.ctx.arrastando, null, (visualNovo ? 'visual novo' : 'barra antiga') + ': arrastando segue nulo');
    assert.equal(t.el.classList.contains('arrastando'), false, 'o painel não ganha a marca de arrasto');
    assert.equal(evento.cancelado, false);
    campo.disparar('mousedown');
    campo.disparar('pointerdown');
    assert.equal(t.ctx.arrastando, null);
  }
});

/* ---------- quem chama o renomearAqui segue igual ---------- */
test('os chamadores do renomearAqui não mudaram: clique no título, menu da Torre e do Histórico, lápis e duplo clique da barra', () => {
  assert.match(UI_JS, /button\(\s*"",\s*tituloNaTorre\(p\),\s*\(\) => renomearAqui\(p\),\s*"ck-pane-title",\s*\)/, 'clique no título');
  assert.match(UI_JS, /labelled\("Renomear", \(\) => \{\s*closeLayer\(l\);\s*renomearAqui\(row\.p\);\s*\}\)/, 'menu de ações da Torre e do Histórico');
  assert.match(APP, /\$\('\.pn-edit', el\)\.addEventListener\('click', \(\) => renomearAqui\(P\)\);/, 'lápis da barra');
  assert.match(APP, /\$\('\.pn-txt', el\)\.addEventListener\('dblclick', \(\) => renomearAqui\(P\)\);/, 'duplo clique na barra');
  // o que o titulo-auto.test.js cobra do texto da função segue valendo
  const fonte = pegarBloco(APP, 'function renomearAqui(');
  assert.match(fonte, /cancelarRevisaoDoNome\(P\)/);
  assert.match(fonte, /P\.nomeManual = true; P\.tituloAuto = false;/);
});

/* ---------- CSS ---------- */
/* Todas as regras do CSS, sem os comentários; as de dentro de @media/@container vêm com o `contexto` da consulta. */
function regras(css, contexto = '') {
  const sem = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const saida = [];
  let i = 0;
  while (i < sem.length) {
    const abre = sem.indexOf('{', i);
    if (abre < 0) break;
    let nivel = 1, k = abre + 1;
    while (k < sem.length && nivel) { nivel += sem[k] === '{' ? 1 : sem[k] === '}' ? -1 : 0; k++; }
    const prelude = sem.slice(i, abre).replace(/\s+/g, ' ').trim();
    const corpo = sem.slice(abre + 1, k - 1);
    if (/^@(container|media|supports|layer)\b/.test(prelude)) saida.push(...regras(corpo, contexto ? contexto + ' > ' + prelude : prelude));
    else if (!prelude.startsWith('@')) saida.push({ contexto, seletor: prelude, corpo });
    i = k;
  }
  return saida;
}
const lista = (r) => r.seletor.split(/\s*,\s*/);
/* a regra de topo cuja lista de seletores tem este (a regra pode dividir o corpo com outros seletores) */
const deTopo = (css, seletor) => regras(css).find((r) => !r.contexto && lista(r).includes(seletor));
const valor = (corpo, prop) => { const m = new RegExp('(?:^|[;\\s])' + prop + ':\\s*([^;]+);').exec(corpo); return m ? m[1].trim() : null; };
const px = (v) => { const m = /^(\d+(?:\.\d+)?)px$/.exec(v || ''); return m ? Number(m[1]) : NaN; };

const CAMPO = '.ck-app .pane-hd > .pn-input';

test('CSS: o campo ocupa o espaço do título (flex: 1, mesmo min-width), com o mesmo peso, a mesma cor e o mesmo tamanho de letra', () => {
  const campo = deTopo(CSS_UI, CAMPO);
  assert.ok(campo, 'falta a regra de topo de ' + CAMPO);
  const titulo = deTopo(CSS_UI, '.ck-pane-title');
  const botao = deTopo(CSS_UI, '.ck-button');
  assert.ok(titulo && botao);
  assert.equal(valor(campo.corpo, 'flex'), '1');
  assert.equal(valor(campo.corpo, 'flex'), valor(titulo.corpo, 'flex'), 'o mesmo flex do título');
  assert.equal(valor(campo.corpo, 'min-width'), valor(titulo.corpo, 'min-width'), 'o mesmo min-width do título');
  assert.equal(valor(campo.corpo, 'font-weight'), valor(titulo.corpo, 'font-weight'), 'o mesmo peso');
  assert.equal(valor(campo.corpo, 'color'), valor(titulo.corpo, 'color'), 'a mesma cor do texto');
  assert.equal(valor(campo.corpo, 'font-size'), valor(botao.corpo, 'font-size'), 'o tamanho da letra do .ck-button, de onde o título herda');
  assert.equal(valor(campo.corpo, 'font'), 'inherit', 'a família vem do cabeçalho, como no botão do título');
  assert.doesNotMatch(campo.corpo, /position:\s*(absolute|fixed)/, 'fica na linha, não por cima dela');
});

test('CSS: borda de foco var(--focus), raio pequeno, sem o anel de 2 px (o overflow do cabeçalho o cortaria) e fundo e cor do tema', () => {
  const campo = deTopo(CSS_UI, CAMPO);
  assert.ok(campo);
  assert.equal(valor(campo.corpo, 'border'), '1px solid var(--focus)');
  assert.equal(valor(campo.corpo, 'border-radius'), 'var(--radius-sm)');
  assert.equal(valor(campo.corpo, 'outline'), 'none');
  assert.equal(valor(campo.corpo, 'background'), 'var(--sunken)');
  assert.equal(valor(campo.corpo, 'color'), 'var(--ink)');
  // só tokens que existem
  for (const v of campo.corpo.matchAll(/var\(\s*(--[\w-]+)/g)) assert.match(CSS_TOKENS + CSS_BASE, new RegExp(v[1] + '\\s*:'), v[1] + ' existe');
});

test('CSS: a altura do campo cabe nos pixels úteis do cabeçalho (36 - 4 - 4 - 1 = 27), sem empurrar nada', () => {
  const campo = deTopo(CSS_UI, CAMPO);
  const cab = deTopo(CSS_UI, '.ck-app .pane-hd');
  assert.ok(campo && cab);
  const total = px(/--layout-pane-head:\s*(\d+px)/.exec(CSS_TOKENS)[1]);
  assert.equal(valor(cab.corpo, 'height'), 'var(--layout-pane-head)');
  const [vertical] = valor(cab.corpo, 'padding').split(/\s+/);
  const borda = px(/border-bottom:\s*(\d+px)/.exec(cab.corpo)[1]);
  const util = total - 2 * px(vertical) - borda;
  assert.equal(util, 27);
  const altura = px(valor(campo.corpo, 'height'));
  assert.ok(altura > 0 && altura <= util, 'altura ' + altura + ' > ' + util + ' úteis');
  assert.ok(!valor(campo.corpo, 'min-height') || px(valor(campo.corpo, 'min-height')) <= util);
  assert.equal(valor(campo.corpo, 'margin'), null, 'sem margem: nada sai do lugar');
  // o texto fica onde o do título ficava: 1 px de borda + o padding lateral = o padding de 6 px do .ck-button
  const lateral = px(valor(campo.corpo, 'padding').split(/\s+/)[1]);
  assert.equal(lateral + 1, px(valor(deTopo(CSS_UI, '.ck-button').corpo, 'padding')));
});

test('CSS: com o visual Mac ligado o campo usa a mesma fonte, tamanho e peso do título do Mac (a mesma regra)', () => {
  const regra = regras(CSS_MAC).find((r) => !r.contexto && /\.ck-pane-title/.test(r.seletor));
  assert.ok(regra, 'falta a regra do título no visual-mac.css');
  assert.match(regra.seletor, /^html\.visual-mac \.ck-app :is\(\.ck-pane-title, \.pane-hd > \.pn-input\)$/);
  assert.equal(valor(regra.corpo, 'font-family'), 'var(--font-display)');
  assert.equal(valor(regra.corpo, 'font-size'), '13px');
  assert.equal(valor(regra.corpo, 'font-weight'), '600');
  // o cabeçalho do Mac (44 px) é maior que o do tema normal: o campo de 26 px cabe com folga
  const cabMac = regras(CSS_MAC).find((r) => !r.contexto && r.seletor === 'html.visual-mac .ck-app .pane-hd');
  assert.ok(px(valor(cabMac.corpo, 'height')) >= px(valor(deTopo(CSS_UI, CAMPO).corpo, 'height')));
});

test('CSS: a barra antiga segue escondida no visual novo, e o :has dela só vale quando o campo está nela (sem o .ck-pane-title)', () => {
  const escondida = regras(CSS_UI).find((r) => !r.contexto && lista(r).includes('.ck-app .pane-nome'));
  assert.ok(escondida, 'a barra antiga continua na lista dos escondidos');
  assert.equal(valor(escondida.corpo, 'display'), 'none !important');
  const tem = deTopo(CSS_UI, '.ck-app .pane-nome:has(.pn-input)');
  assert.ok(tem, 'o caminho antigo (sem o .ck-pane-title) continua mostrando a barra durante a edição');
  assert.equal(valor(tem.corpo, 'display'), 'flex !important');
});

test('CSS: o .pn-input da lista do histórico (e o do estilo-base) não foi mexido: toda regra nova é do cabeçalho', () => {
  for (const [nome, css] of [['cockpit-ui.css', CSS_UI], ['visual-mac.css', CSS_MAC]]) {
    for (const r of regras(css)) {
      for (const s of lista(r).filter((x) => /\.pn-input/.test(x))) {
        assert.match(s, /\.pane-hd > \.pn-input|\.pane-nome:has\(\.pn-input\)/, nome + ': ' + s + ' fora do cabeçalho');
      }
    }
  }
  assert.ok(deTopo(CSS_BASE, '.pn-input'), 'o estilo-base do .pn-input (barra antiga e lista do histórico) continua');
});
