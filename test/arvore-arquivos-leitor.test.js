'use strict';
/* UI 7.2-1 (leva 2, task 1): na árvore "Arquivos" o clique simples colava o caminho na caixa de escrever e o duplo
   clique (que antes dispara 2 cliques: caminho colado 2×) abria no programa do Windows, nunca no leitor (print q08).
   Agora o clique só MARCA a linha; duplo clique ou Enter na linha marcada abre no LEITOR (verArquivo); "Pôr o
   caminho na conversa" e "Abrir no programa do Windows" são ações explícitas do botão direito. Pasta continua
   abrindo e fechando no clique.

   O app.js não carrega em teste (precisa do Electron): roda o trecho REAL da árvore e o inserirNoInput, recortados do
   fonte, num vm com um DOM de mentira e uma ponte (window.api) que anota cada chamada. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');

const APP = lerFonte('renderer', 'app.js');
const CSS = lerFonte('renderer', 'style.css');
const iniArvore = APP.indexOf('/* ============ arvore de arquivos ============ */');
const fimArvore = APP.indexOf('/* ============ menus (');
assert.ok(iniArvore >= 0 && fimArvore > iniArvore, 'não achei o trecho da árvore de arquivos no app.js');
const TRECHO_ARVORE = APP.slice(iniArvore, fimArvore);
const INSERIR_NO_INPUT = pegarBloco(APP, 'function inserirNoInput(', 'inserirNoInput');

/* ---- DOM de mentira: só o que a árvore e o menu usam ---- */
class No {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.classes = new Set(); this.filhos = []; this.pai = null;
    this.attrs = {}; this.dataset = {}; this.style = {}; this.eventos = {};
    this.texto = ''; this.html = ''; this.value = ''; this.scrollHeight = 20; this.tabIndex = -1;
    this.rolouPara = 0;
  }
  get className() { return [...this.classes].join(' '); }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() {
    const no = this;
    return {
      add: (...c) => c.forEach((x) => no.classes.add(x)),
      remove: (...c) => c.forEach((x) => no.classes.delete(x)),
      contains: (c) => no.classes.has(c),
      toggle: (c, liga) => { const on = liga === undefined ? !no.classes.has(c) : !!liga; if (on) no.classes.add(c); else no.classes.delete(c); return on; },
    };
  }
  get innerHTML() { return this.html; }
  // lê <tag class="a b"> ... </tag> e cria os filhos (o texto solto não importa aqui)
  set innerHTML(v) {
    this.html = String(v); this.texto = ''; this.esvaziar();
    const pilha = [this];
    for (const m of this.html.matchAll(/<(\/)?([a-z0-9-]+)([^>]*?)(\/)?>/gi)) {
      if (m[1]) { if (pilha.length > 1) pilha.pop(); continue; }
      const f = new No(m[2]);
      const cls = /class="([^"]*)"/.exec(m[3]);
      if (cls) f.className = cls[1];
      pilha[pilha.length - 1].appendChild(f);
      if (!m[4] && !/^(br|img|input|hr|path|rect|circle)$/i.test(m[2])) pilha.push(f);
    }
  }
  get textContent() { return this.texto + this.filhos.map((f) => f.textContent).join(''); }
  set textContent(v) { this.texto = String(v); this.esvaziar(); }
  get isConnected() { return true; }
  get descendentes() { return this.filhos.flatMap((f) => [f, ...f.descendentes]); }
  esvaziar() { for (const f of this.filhos) f.pai = null; this.filhos = []; }
  tirar(f) { if (f.pai) f.pai.filhos = f.pai.filhos.filter((x) => x !== f); f.pai = null; }
  appendChild(f) { this.tirar(f); f.pai = this; this.filhos.push(f); return f; }
  remove() { this.tirar(this); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(nome, f) { (this.eventos[nome] = this.eventos[nome] || []).push(f); }
  focus() {}
  scrollIntoView() { this.rolouPara++; }
  contains(no) { for (let p = no; p; p = p.pai) if (p === this) return true; return false; }
  querySelectorAll(sel) {
    const casa = sel.startsWith('.') ? (n) => n.classes.has(sel.slice(1))
      : sel.startsWith('#') ? (n) => n.attrs.id === sel.slice(1)
        : (n) => n.tagName.toLowerCase() === sel;
    return this.descendentes.filter(casa);
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
const evento = (extra = {}) => ({
  prevented: false, parou: false,
  preventDefault() { this.prevented = true; }, stopPropagation() { this.parou = true; }, ...extra,
});
// roda TODOS os ouvintes do tipo, na ordem em que foram registrados (um navegador faria o mesmo). O navegador
// ignora o que o ouvinte devolve e o trabalho assíncrono (ler a pasta, o openPath) segue sozinho: aqui o
// setImmediate no fim deixa esse trabalho terminar antes de o teste olhar o resultado.
async function disparar(no, tipo, extra) {
  const ev = evento(extra);
  for (const fn of no.eventos[tipo] || []) await fn(ev);
  await new Promise((resolver) => setImmediate(resolver));
  return ev;
}
const simples = (v) => JSON.parse(JSON.stringify(v));

const RAIZ = 'C:/proj';
const ARQ = (nome) => RAIZ + '/' + nome;
const PASTAS = {
  [RAIZ]: { entries: [
    { name: 'src', path: ARQ('src'), dir: true },
    { name: 'README.md', path: ARQ('README.md'), dir: false },
    { name: 'notas.txt', path: ARQ('notas.txt'), dir: false },
  ] },
  [ARQ('src')]: { entries: [{ name: 'index.js', path: ARQ('src/index.js'), dir: false }] },
};

/* Monta a árvore de verdade (loadTree) com a ponte anotando tudo. `remotoDoPainel` é o que o painel em foco diz ser
   o servidor dele (null = painel local). */
async function montar({ remoto = null, remotoDoPainel = null, respostaOpenPath = { ok: true } } = {}) {
  const corpo = new No('body');
  const arvore = new No('div'); arvore.attrs.id = 'tree'; arvore.className = 'tree'; corpo.appendChild(arvore);
  const nomePasta = new No('span'); nomePasta.attrs.id = 'projName'; corpo.appendChild(nomePasta);
  const campo = new No('textarea'); campo.className = 'p-input';
  const el = new No('section'); el.appendChild(campo);
  const painel = { id: 'p1', el, abaId: 'a1' };
  // como no index.html: o menu mora no documento (#popGrupo) e nasce escondido
  const pop = new No('div'); pop.attrs.id = 'popGrupo'; pop.className = 'pop-global hidden'; corpo.appendChild(pop);
  const anotado = { ver: [], openPath: [], notas: [], listDir: [], popAbriu: [], popFechou: 0 };
  const api = {
    listDir: async (dir, rem) => { anotado.listDir.push([dir, rem]); return PASTAS[dir] || { entries: [] }; },
    openPath: async (p) => { anotado.openPath.push(p); return respostaOpenPath; },
  };
  const ctx = {
    console, document: { createElement: (t) => new No(t) },
    $: (sel, raiz) => (raiz || corpo).querySelector(sel),
    $$: (sel, raiz) => (raiz || corpo).querySelectorAll(sel),
    ico: (n) => '<i>' + n + '</i>',
    HOME: 'C:/home', ESTE_PC: 'PC', EH_WIN: true,
    baseNome: (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(p || ''),
    faltaConfigurarServidor: (r) => !!r && (!String(r.usuario || '').trim() || !String(r.host || '').trim()),
    AVISO_ABA_EM_BRANCO: 'aviso de aba em branco',
    window: { api },
    focusPane: painel,
    remotoDoPane: () => remotoDoPainel,
    verArquivo: (...a) => { anotado.ver.push(a); },
    note: (P, texto, erro) => { anotado.notas.push([P, texto, erro]); },
    abrirPopGlobal: (ancora) => { pop.innerHTML = ''; pop.classList.remove('hidden'); anotado.popAbriu.push(ancora); return pop; },
    fecharPopGlobal: () => { anotado.popFechou++; pop.innerHTML = ''; pop.classList.add('hidden'); },
  };
  vm.createContext(ctx);
  vm.runInContext(TRECHO_ARVORE + '\n' + INSERIR_NO_INPUT, ctx);
  await ctx.loadTree(RAIZ, remoto || undefined);
  const linha = (nome) => arvore.querySelectorAll('.node').find((n) => n.querySelector('.nm').textContent === nome);
  const menu = () => pop.filhos.map((f) => f.textContent);
  const marcadas = () => arvore.querySelectorAll('.node').filter((n) => n.classes.has('sel')).map((n) => n.querySelector('.nm').textContent);
  return { ctx, painel, campo, arvore, pop, anotado, linha, menu, marcadas };
}

test('clique num arquivo só MARCA a linha: não cola o caminho, não abre no leitor nem no Windows', async () => {
  const t = await montar();
  const readme = t.linha('README.md'), notas = t.linha('notas.txt');
  assert.ok(readme && notas, 'a árvore não pintou os arquivos');

  await disparar(readme, 'click');
  assert.deepEqual(t.marcadas(), ['README.md'], 'a linha clicada fica marcada (destaque)');
  assert.equal(t.campo.value, '', 'o clique não pode colar o caminho na caixa de escrever');
  assert.deepEqual(t.anotado.ver, [], 'o clique não abre o leitor');
  assert.deepEqual(t.anotado.openPath, [], 'o clique não abre no programa do Windows');

  // outra linha: a marca muda de lugar, nunca fica em duas
  await disparar(notas, 'click');
  assert.deepEqual(t.marcadas(), ['notas.txt']);
  assert.equal(t.campo.value, '');
});

test('duplo clique abre no LEITOR, uma vez, sem colar o caminho (os 2 cliques que vêm antes só marcam) e sem abrir no Windows', async () => {
  const t = await montar();
  const readme = t.linha('README.md');
  // a sequência real do navegador num duplo clique: click, click, dblclick
  await disparar(readme, 'click');
  await disparar(readme, 'click');
  await disparar(readme, 'dblclick');

  assert.equal(t.anotado.ver.length, 1, 'abre o leitor uma vez só');
  const [painel, caminho, remoto] = t.anotado.ver[0];
  assert.equal(painel, t.painel, 'no painel em foco');
  assert.equal(caminho, ARQ('README.md'));
  assert.equal(remoto, null, 'arquivo deste PC: sem servidor');
  assert.equal(t.campo.value, '', 'nenhum caminho colado (antes ficava colado 2×)');
  assert.deepEqual(t.anotado.openPath, [], 'o duplo clique não abre mais no programa do Windows');
  assert.deepEqual(t.marcadas(), ['README.md']);
});

test('Enter na linha marcada abre no leitor; sem linha marcada não faz nada; recarregar a árvore tira a marca', async () => {
  const t = await montar();
  assert.equal(t.arvore.tabIndex, 0, 'a árvore precisa de foco de teclado para o Enter chegar nela');

  const semMarca = await disparar(t.arvore, 'keydown', { key: 'Enter' });
  assert.deepEqual(t.anotado.ver, [], 'nada marcado, nada abre');
  assert.equal(semMarca.prevented, false);

  await disparar(t.linha('notas.txt'), 'click');
  const ev = await disparar(t.arvore, 'keydown', { key: 'Enter' });
  assert.equal(ev.prevented, true);
  assert.equal(t.anotado.ver.length, 1);
  assert.equal(t.anotado.ver[0][0], t.painel);
  assert.equal(t.anotado.ver[0][1], ARQ('notas.txt'));
  assert.equal(t.anotado.ver[0][2], null);
  assert.equal(t.campo.value, '', 'Enter também não cola o caminho');
  assert.deepEqual(t.anotado.openPath, []);

  // Ctrl+Enter e companhia são de outros atalhos: a árvore não pega
  await disparar(t.arvore, 'keydown', { key: 'Enter', ctrlKey: true });
  assert.equal(t.anotado.ver.length, 1);

  // árvore nova (outra pasta/painel): a marca velha não vale mais, e o teclado não é ligado duas vezes
  await t.ctx.loadTree(RAIZ);
  await disparar(t.arvore, 'keydown', { key: 'Enter' });
  assert.equal(t.anotado.ver.length, 1, 'a marca da árvore antiga sumiu');
  await disparar(t.linha('README.md'), 'click');
  await disparar(t.arvore, 'keydown', { key: 'Enter' });
  assert.equal(t.anotado.ver.length, 2, 'um Enter, uma abertura (o teclado não foi ligado em duplicidade)');
});

test('setas ↑/↓ movem a marca (sem passar do começo nem do fim) e Enter numa pasta abre/fecha a pasta', async () => {
  const t = await montar();
  const baixo = () => disparar(t.arvore, 'keydown', { key: 'ArrowDown' });
  const cima = () => disparar(t.arvore, 'keydown', { key: 'ArrowUp' });

  const primeira = await baixo();
  assert.equal(primeira.prevented, true, 'sem isso a seta rola a lista em vez de mover a marca');
  assert.deepEqual(t.marcadas(), ['src'], 'sem nada marcado, ↓ marca a primeira linha');
  await baixo();
  assert.deepEqual(t.marcadas(), ['README.md']);
  await baixo();
  assert.deepEqual(t.marcadas(), ['notas.txt']);
  await baixo();
  assert.deepEqual(t.marcadas(), ['notas.txt'], 'no fim fica no fim');
  await cima();
  assert.deepEqual(t.marcadas(), ['README.md']);
  await cima(); await cima();
  assert.deepEqual(t.marcadas(), ['src'], 'no começo fica no começo');
  assert.ok(t.linha('src').rolouPara > 0, 'a linha marcada precisa aparecer na lista');
  assert.deepEqual(t.anotado.ver, [], 'seta nunca abre nada');

  // Enter na pasta marcada = o mesmo que o clique nela: abre e mostra o que tem dentro
  await disparar(t.arvore, 'keydown', { key: 'Enter' });
  assert.ok(t.linha('index.js'), 'a pasta abriu');
  assert.deepEqual(t.anotado.ver, [], 'Enter numa pasta não abre o leitor');
  await disparar(t.arvore, 'keydown', { key: 'Enter' });
  assert.equal(t.linha('index.js'), undefined, 'o segundo Enter fecha a pasta');
});

test('pasta continua abrindo e fechando no clique, e agora fica marcada; o clique não cola o caminho', async () => {
  const t = await montar();
  const src = t.linha('src');
  await disparar(src, 'click');
  assert.ok(t.linha('index.js'), 'a pasta abriu no clique');
  assert.deepEqual(t.marcadas(), ['src']);
  assert.equal(t.campo.value, '');
  await disparar(src, 'click');
  assert.equal(t.linha('index.js'), undefined, 'o segundo clique fecha');
  assert.deepEqual(t.anotado.ver, []);
  assert.deepEqual(t.anotado.openPath, []);
});

test('botão direito num arquivo deste PC: menu com "Pôr o caminho na conversa" e "Abrir no programa do Windows"', async () => {
  const t = await montar();
  const readme = t.linha('README.md');
  const ev = await disparar(readme, 'contextmenu', { clientX: 10, clientY: 10 });
  assert.equal(ev.prevented, true, 'sem isso o menu do sistema (ou nenhum) vem junto');
  assert.deepEqual(t.marcadas(), ['README.md'], 'o botão direito também marca a linha: o menu é dela');
  assert.equal(t.anotado.popAbriu.at(-1), readme, 'o menu abre junto da linha');
  assert.deepEqual(t.menu(), ['Pôr o caminho na conversa', 'Abrir no programa do Windows']);
  assert.deepEqual(t.anotado.ver, [], 'abrir o menu não abre nada');
  assert.equal(t.campo.value, '');
});

test('menu: "Pôr o caminho na conversa" cola o caminho UMA vez (e só ele), no painel em foco, e fecha o menu', async () => {
  const t = await montar();
  t.campo.value = 'olha este arquivo';
  await disparar(t.linha('README.md'), 'contextmenu');
  const antes = t.anotado.popFechou;
  await disparar(t.pop.filhos[0], 'click');
  assert.equal(t.campo.value, 'olha este arquivo ' + ARQ('README.md'), 'o caminho entra uma vez, separado por espaço');
  assert.ok(t.anotado.popFechou > antes, 'o menu fecha ao escolher');
  assert.deepEqual(t.anotado.openPath, [], 'não abre no Windows');
  assert.deepEqual(t.anotado.ver, [], 'não abre o leitor');
});

test('menu: "Abrir no programa do Windows" chama o openPath seguro com o caminho; o erro do main aparece no painel', async () => {
  const t = await montar();
  await disparar(t.linha('README.md'), 'contextmenu');
  await disparar(t.pop.filhos[1], 'click');
  assert.deepEqual(t.anotado.openPath, [ARQ('README.md')]);
  assert.equal(t.campo.value, '', 'não cola caminho nenhum');
  assert.deepEqual(t.anotado.notas, [], 'abriu: nenhum aviso');

  // o main responde { error } (script/executável, caminho de rede...), texto cru (formato antigo) ou a promessa recusada
  for (const resposta of [{ error: 'Caminho de rede bloqueado por segurança.' }, 'Failed to open path']) {
    const u = await montar({ respostaOpenPath: resposta });
    await disparar(u.linha('notas.txt'), 'contextmenu');
    await disparar(u.pop.filhos[1], 'click');
    assert.deepEqual(simples(u.anotado.notas.map(([, texto, erro]) => [texto, erro])),
      [[typeof resposta === 'string' ? resposta : resposta.error, true]], 'o motivo aparece no painel como erro');
    assert.equal(u.anotado.notas[0][0], u.painel, 'no painel em foco');
  }
  const quebrou = await montar();
  quebrou.ctx.window.api.openPath = async () => { throw new Error('Esta janela não pode acessar este recurso do Cockpit.'); };
  await disparar(quebrou.linha('README.md'), 'contextmenu');
  await disparar(quebrou.pop.filhos[1], 'click');
  assert.match(quebrou.anotado.notas[0][1], /não pode acessar este recurso/);
});

test('painel em servidor (SSH): duplo clique lê no servidor, pelo painel; o menu só tem "Pôr o caminho" (não há o que abrir no Windows)', async () => {
  const servidor = { usuario: 'hugo', host: 'vps', chave: 'k', porta: 22 };
  const t = await montar({ remoto: servidor, remotoDoPainel: servidor });
  await disparar(t.linha('README.md'), 'click');
  await disparar(t.linha('README.md'), 'click');
  await disparar(t.linha('README.md'), 'dblclick');
  assert.equal(t.anotado.ver.length, 1);
  assert.equal(t.anotado.ver[0][0], t.painel);
  assert.equal(t.anotado.ver[0][1], ARQ('README.md'));
  assert.equal(t.anotado.ver[0][2], servidor, 'a rota é pelo PAINEL (o servidor dele), como já era');
  assert.equal(t.campo.value, '');
  assert.deepEqual(t.anotado.openPath, []);

  await disparar(t.linha('notas.txt'), 'contextmenu');
  assert.deepEqual(t.menu(), ['Pôr o caminho na conversa']);
  await disparar(t.pop.filhos[0], 'click');
  assert.equal(t.campo.value, ARQ('notas.txt'));
  assert.deepEqual(t.anotado.openPath, []);
});

test('sem painel em foco nada quebra: duplo clique e Enter não fazem nada, o menu "Pôr o caminho" também', async () => {
  const t = await montar();
  t.ctx.focusPane = null;
  await disparar(t.linha('README.md'), 'click');
  await disparar(t.linha('README.md'), 'dblclick');
  await disparar(t.arvore, 'keydown', { key: 'Enter' });
  await disparar(t.linha('README.md'), 'contextmenu');
  await disparar(t.pop.filhos[0], 'click');
  assert.deepEqual(t.anotado.ver, []);
  assert.equal(t.campo.value, '');
});

/* Fix C, item 4 (revisão da Task 1): com o menu do botão direito aberto (#popGrupo) o foco de teclado continua na
   árvore, e então Enter abria o leitor e as setas moviam a marca POR TRÁS do menu. Agora, com o menu aberto, o ouvinte
   da árvore não age. As teclas que nunca foram dela (Esc, Tab, ←/→, Alt+←) seguem passando, sem preventDefault. */
test('menu do botão direito aberto: Enter e as setas ↑/↓ não fazem nada na árvore; fechado o menu, voltam a valer', async () => {
  const t = await montar();
  await disparar(t.linha('README.md'), 'contextmenu');
  assert.equal(t.pop.classes.has('hidden'), false, 'o menu está aberto');
  assert.deepEqual(t.marcadas(), ['README.md']);
  for (const key of ['Enter', 'ArrowDown', 'ArrowUp']) {
    const ev = await disparar(t.arvore, 'keydown', { key });
    assert.equal(ev.prevented, false, key + ': com o menu aberto a tecla não é da árvore');
    assert.equal(ev.parou, false, key);
  }
  assert.deepEqual(t.anotado.ver, [], 'Enter com o menu aberto não abre o leitor');
  assert.deepEqual(t.marcadas(), ['README.md'], 'as setas não movem a marca por trás do menu');
  assert.equal(t.campo.value, '');
  assert.deepEqual(t.anotado.openPath, []);
  // o menu fecha (Esc, clique fora ou item escolhido): a árvore volta a responder
  t.ctx.fecharPopGlobal();
  const enter = await disparar(t.arvore, 'keydown', { key: 'Enter' });
  assert.equal(enter.prevented, true);
  assert.equal(t.anotado.ver.length, 1);
  assert.equal(t.anotado.ver[0][1], ARQ('README.md'));
  await disparar(t.arvore, 'keydown', { key: 'ArrowDown' });
  assert.deepEqual(t.marcadas(), ['notas.txt']);
});

test('Esc, Tab, Shift+Tab, ←, → e Alt+← passam pela árvore sem preventDefault e sem ação, com o menu fechado ou aberto', async () => {
  const t = await montar();
  await disparar(t.linha('README.md'), 'click');   // com linha marcada: mesmo assim essas teclas não são da árvore
  const teclas = [
    { key: 'Escape' }, { key: 'Tab' }, { key: 'Tab', shiftKey: true },
    { key: 'ArrowLeft' }, { key: 'ArrowRight' }, { key: 'ArrowLeft', altKey: true },
  ];
  for (const aberto of [false, true]) {
    if (aberto) await disparar(t.linha('README.md'), 'contextmenu');
    assert.equal(t.pop.classes.has('hidden'), !aberto);
    for (const tecla of teclas) {
      const ev = await disparar(t.arvore, 'keydown', tecla);
      const quem = JSON.stringify(tecla) + (aberto ? ' (menu aberto)' : ' (menu fechado)');
      assert.equal(ev.prevented, false, quem);
      assert.equal(ev.parou, false, quem + ': o Esc precisa chegar ao fechamento global do menu');
    }
    assert.deepEqual(t.marcadas(), ['README.md'], 'a marca não anda');
    assert.deepEqual(t.anotado.ver, []);
    assert.deepEqual(t.anotado.openPath, []);
    assert.equal(t.campo.value, '');
  }
});

test('CSS: a linha marcada da árvore tem destaque (.node.sel) que não some com o mouse em cima', () => {
  const regras = [...CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({ seletor: m[1].trim().replace(/\s+/g, ' '), corpo: m[2] }));
  const iSel = regras.findIndex((r) => r.seletor.split(',').some((s) => s.trim() === '.node.sel'));
  const iHover = regras.findIndex((r) => r.seletor.split(',').some((s) => s.trim() === '.node:hover'));
  assert.ok(iSel >= 0, 'falta a regra .node.sel no style.css');
  assert.match(regras[iSel].corpo, /background\s*:/, 'a marca precisa de fundo próprio');
  assert.match(regras[iSel].corpo, /var\(--/, 'cor do tema, não fixa');
  assert.ok(iSel > iHover, '.node.sel depois de .node:hover: mesmo peso, vale a última (marcada com o mouse em cima continua marcada)');

  // a árvore ganhou foco de teclado (tabindex): com linha marcada o anel do navegador em volta da lista inteira
  // some (a linha mostra o foco); sem linha marcada ele fica, para quem chegou pelo Tab saber onde está
  const anel = regras.find((r) => r.seletor.split(',').some((s) => /^\.tree:focus-visible:has\(\.node\.sel\)$/.test(s.trim())));
  assert.ok(anel, 'falta .tree:focus-visible:has(.node.sel) no style.css');
  assert.match(anel.corpo, /outline\s*:\s*none/);
});
