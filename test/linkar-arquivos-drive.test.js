'use strict';
/* Leva 2, Task 2 (UI 7.2-2) -- caminho local na conversa vira link do leitor.

   Antes: o caminho entre crases e o caminho com espaco (todo G:\Meu Drive\... tem) ficavam como texto parado (print q10).
   Agora:
   - codigo inline cujo texto INTEIRO e' um arquivo X:\... (com espaco e tudo) vira link;
   - caminho com espaco fora de crase vira link so' quando e' inequivoco (letra de unidade + extensao conhecida);
   - NUNCA caminho de rede (\\servidor, //servidor, file://servidor);
   - bloco de codigo (```) nao vira link.

   O linkarArquivos de verdade sai do app.js e roda num vm, com o marked de verdade (o mesmo que desenha a resposta) e um DOM
   de mentira so' com o que ele usa: este projeto nao tem jsdom. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { RAIZ, lerFonte } = require('../testes/raiz');
const links = require('../src/renderer/file-links');

/* ---------- DOM de mentira: so' o que o linkarArquivos usa ---------- */
class No {
  constructor(tipo, tag, texto = '') {
    this.nodeType = tipo; this.tagName = tag; this.texto = texto;
    this.filhos = []; this.pai = null; this.attrs = new Map(); this.dataset = {}; this.classes = new Set();
  }
  get childNodes() { return this.filhos; }
  get textContent() { return this.nodeType === 3 ? this.texto : this.filhos.map((f) => f.textContent).join(''); }
  set textContent(v) { for (const f of this.filhos) f.pai = null; this.filhos = []; if (v !== '') this.appendChild(new No(3, '#text', String(v))); }
  get classList() { const c = this.classes; return { add: (x) => c.add(x), remove: (x) => c.delete(x), contains: (x) => c.has(x) }; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  removeAttribute(k) { this.attrs.delete(k); }
  set href(v) { this.setAttribute('href', v); }
  get href() { return this.getAttribute('href'); }
  appendChild(n) {
    if (n.nodeType === 11) { for (const f of [...n.filhos]) this.appendChild(f); return n; }
    if (n.pai) n.pai.filhos.splice(n.pai.filhos.indexOf(n), 1);
    n.pai = this; this.filhos.push(n); return n;
  }
  replaceWith(n) {
    const pai = this.pai;
    const novos = n.nodeType === 11 ? [...n.filhos] : [n];
    for (const x of novos) if (x.pai) x.pai.filhos.splice(x.pai.filhos.indexOf(x), 1);
    pai.filhos.splice(pai.filhos.indexOf(this), 1, ...novos);
    for (const x of novos) x.pai = pai;
    this.pai = null;
  }
  descendentes() { return this.filhos.flatMap((f) => [f, ...f.descendentes()]); }
  // so' "tag" e "tag[atributo]": e' tudo que o linkarArquivos pergunta
  querySelectorAll(sel) {
    const [, tag, attr] = sel.match(/^(\w+)(?:\[(\w+)\])?$/);
    return this.descendentes().filter((n) => n.nodeType === 1 && n.tagName === tag.toUpperCase() && (!attr || n.attrs.has(attr)));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  // lista de tags separadas por virgula ("pre, a"): o proprio no' ou um ancestral
  closest(sel) {
    const tags = sel.split(',').map((s) => s.trim().toUpperCase());
    for (let n = this; n && n.nodeType === 1; n = n.pai) if (tags.includes(n.tagName)) return n;
    return null;
  }
}
const texto = (s) => new No(3, '#text', s);
const el = (tag, ...filhos) => { const n = new No(1, tag.toUpperCase()); for (const f of filhos) n.appendChild(typeof f === 'string' ? texto(f) : f); return n; };

/* ---------- o marked de verdade, com as mesmas opcoes do app (app.js: marked.setOptions) ---------- */
const ctxMarked = { window: {}, self: {} };
ctxMarked.globalThis = ctxMarked;
vm.createContext(ctxMarked);
vm.runInContext(fs.readFileSync(path.join(RAIZ, 'src', 'renderer', 'vendor', 'marked.min.js'), 'utf8'), ctxMarked);
const marked = ctxMarked.marked || ctxMarked.window.marked || ctxMarked.self.marked;
marked.setOptions({ breaks: true, gfm: true });

const decodificar = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
// o HTML que o marked entrega (p, li, strong, code, pre, a, br) vira arvore do DOM de mentira
function htmlParaNos(html) {
  const raiz = new No(1, 'DIV');
  const pilha = [raiz];
  for (const pedaco of html.match(/<[^>]+>|[^<]+/g) || []) {
    const topo = pilha[pilha.length - 1];
    if (pedaco.startsWith('</')) { pilha.pop(); continue; }
    if (!pedaco.startsWith('<')) { topo.appendChild(texto(decodificar(pedaco))); continue; }
    const [, tag, atributos] = pedaco.match(/^<([a-z][a-z0-9]*)([^>]*?)\/?>$/i);
    const no = new No(1, tag.toUpperCase());
    for (const [, k, v] of atributos.matchAll(/([\w-]+)="([^"]*)"/g)) no.setAttribute(k, decodificar(v));
    topo.appendChild(no);
    if (!/^(?:br|hr|img)$/i.test(tag)) pilha.push(no);
  }
  return raiz;
}
const daResposta = (markdown) => htmlParaNos(marked.parse(markdown));

/* ---------- o linkarArquivos de verdade, recortado do app.js ---------- */
const APP = lerFonte('renderer', 'app.js');
const inicio = APP.indexOf('function linkarArquivos(');
assert.notEqual(inicio, -1, 'linkarArquivos existe no app.js');
// funcao de nivel de cima: fecha com "}" na coluna 0 (nao da' pra contar chaves, o "opcoes = {}" engana)
const TRECHO = APP.slice(inicio, APP.indexOf('\n}\n', inicio) + 2);

function palco({ remoto = null } = {}) {
  const abertos = [];
  const ctx = vm.createContext({
    console,
    window: { CockpitFileLinks: links },
    document: {
      createElement: (tag) => new No(1, tag.toUpperCase()),
      createTextNode: texto,
      createDocumentFragment: () => new No(11, '#document-fragment'),
    },
    HOME: 'C:\\Users\\hugo',
    remotoDoPane: () => remoto,
    verArquivo: (...args) => { abertos.push(args); },
  });
  vm.runInContext(TRECHO, ctx);
  const painel = { id: 'p1', cwd: 'C:\\Projetos\\cockpit' };
  return { abertos, painel, linkar: (no, opcoes) => ctx.linkarArquivos(painel, no, opcoes) };
}
// os links que viraram "arquivo", na ordem da tela
const anotados = (raiz) => raiz.querySelectorAll('a').filter((a) => a.classes.has('arquivo'))
  .map((a) => ({ caminho: a.dataset.filePath, texto: a.textContent, emCodigo: !!a.closest('code') }));
// linkar nunca muda o que a pessoa le: so' o que e' clicavel
function linkado(markdown, opcoes) {
  const p = palco(opcoes);
  const raiz = daResposta(markdown);
  const antes = raiz.textContent;
  p.linkar(raiz);
  assert.equal(raiz.textContent, antes, 'o texto visivel nao pode mudar');
  return { ...p, raiz };
}

/* =====================================================================
   o que o Hugo pediu: caminho entre crases e caminho com espaco viram link
   ===================================================================== */
test('codigo inline com X:\\ de ponta a ponta vira link do leitor, e o link fica DENTRO do codigo', () => {
  const { raiz } = linkado('Veja `G:\\Meu Drive\\04. PESSOAL\\nota.md` agora.');
  assert.deepEqual(anotados(raiz), [
    { caminho: 'G:\\Meu Drive\\04. PESSOAL\\nota.md', texto: 'G:\\Meu Drive\\04. PESSOAL\\nota.md', emCodigo: true },
  ]);
  const codigo = raiz.querySelector('code');
  assert.equal(codigo.filhos.length, 1, 'o <code> guarda so o link (o visual de codigo continua)');
  assert.equal(codigo.filhos[0].getAttribute('href'), '#');
});

test('caminho com espaco no texto corrido vira link ate a extensao (G:\\Meu Drive\\a b.pdf)', () => {
  const { raiz } = linkado('Abra G:\\Meu Drive\\a b.pdf agora e **G:\\Meu Drive\\04. PESSOAL\\relatorio.md** depois.');
  assert.deepEqual(anotados(raiz), [
    { caminho: 'G:\\Meu Drive\\a b.pdf', texto: 'G:\\Meu Drive\\a b.pdf', emCodigo: false },
    { caminho: 'G:\\Meu Drive\\04. PESSOAL\\relatorio.md', texto: 'G:\\Meu Drive\\04. PESSOAL\\relatorio.md', emCodigo: false },
  ]);
});

test('o link do caminho com espaco nao leva a pontuacao em volta, e dois caminhos no mesmo texto saem separados', () => {
  const { raiz } = linkado('Salvei em (G:\\Meu Drive\\a b.pdf), e tambem em G:\\Meu Drive\\c d.md.');
  assert.deepEqual(anotados(raiz).map((a) => a.caminho), ['G:\\Meu Drive\\a b.pdf', 'G:\\Meu Drive\\c d.md']);
});

test('print q10: solto com espaco, em codigo e sem espaco viram link; antes ficavam parados', () => {
  const { raiz } = linkado([
    'Relatório em `C:\\Users\\hugom\\Projetos-claude\\relatorio.md`.',
    '',
    '1. Solto: G:\\Meu Drive\\04. PESSOAL\\relatorio.md',
    '2. Em código: `G:\\Meu Drive\\04. PESSOAL\\relatorio.md`',
    '3. Solto sem espaço: C:\\Users\\hugom\\Projetos-claude\\relatorio.md',
  ].join('\n'));
  assert.deepEqual(anotados(raiz).map((a) => [a.caminho, a.emCodigo]), [
    ['C:\\Users\\hugom\\Projetos-claude\\relatorio.md', true],
    ['G:\\Meu Drive\\04. PESSOAL\\relatorio.md', false],
    ['G:\\Meu Drive\\04. PESSOAL\\relatorio.md', true],
    ['C:\\Users\\hugom\\Projetos-claude\\relatorio.md', false],
  ]);
});

/* =====================================================================
   o que NAO pode virar link
   ===================================================================== */
test('bloco de codigo (```) nao vira link, nem quando so tem o caminho', () => {
  const { raiz } = linkado([
    '```',
    'G:\\Meu Drive\\bloco.md',
    '```',
    '',
    '```bash',
    'cd G:\\Meu Drive\\pasta',
    'cat G:\\Meu Drive\\a b.md',
    '```',
  ].join('\n'));
  assert.deepEqual(anotados(raiz), []);
  for (const code of raiz.querySelectorAll('code')) assert.ok(code.filhos.every((f) => f.nodeType === 3), 'o conteudo do bloco continua texto puro');
});

const REDE = [
  '\\\\srv\\x.md', '\\\\srv\\Meu Drive\\a b.md', '//srv/x.md', '//srv/Meu Drive/a b.md', '/\\srv\\x.md', '\\/srv/x.md',
  'file://srv/x.md', 'file://srv/Meu Drive/a b.md', '\\\\?\\C:\\x.md', '\\\\.\\C:\\x.md', '\\\\srv\\G:\\Meu Drive\\a b.md',
];
test('caminho de rede entre crases nunca vira link (a trava do isNetworkPath vale aqui tambem)', () => {
  for (const rede of REDE) {
    const p = palco();
    const raiz = el('div', el('p', 'Rede: ', el('code', rede)));
    p.linkar(raiz);
    assert.deepEqual(anotados(raiz), [], rede);
    assert.equal(raiz.textContent, 'Rede: ' + rede, 'o texto fica como estava: ' + rede);
  }
  // e do jeito que o marked entrega a crase de verdade
  assert.deepEqual(anotados(linkado('Rede: `\\\\srv\\x.md`').raiz), []);
});

test('caminho de rede no texto corrido nunca vira link', () => {
  for (const rede of REDE) {
    const p = palco();
    const raiz = el('div', el('p', 'veja ' + rede + ' agora'));
    p.linkar(raiz);
    assert.deepEqual(anotados(raiz), [], rede);
    assert.equal(raiz.textContent, 'veja ' + rede + ' agora', 'o texto fica como estava: ' + rede);
  }
});

test('pasta e arquivo sem extensao conhecida entre crases ficam como codigo (o leitor nao abre pasta)', () => {
  const { raiz } = linkado([
    '`C:\\Users\\hugom`', '`C:\\Users\\hugom\\.claude`', '`G:\\Meu Drive\\Pasta Nova`', '`C:\\x\\Dockerfile`', '`C:\\x\\a.xyz`', '`C:\\`',
  ].join(' '));
  assert.deepEqual(anotados(raiz), []);
});

test('codigo com mais coisa do que o caminho (comando, dois caminhos, texto antes ou depois) fica como codigo', () => {
  const { raiz } = linkado([
    '`abrir G:\\Meu Drive\\a.md`', '`G:\\Meu Drive\\a.md --flag`', '`G:\\Meu Drive\\a.md e D:\\b.md`', '`cd G:\\Meu Drive`',
  ].join(' '));
  assert.deepEqual(anotados(raiz), []);
});

test('frase solta que so parece caminho (espaco logo depois da unidade, pasta sem extensao) nao vira link', () => {
  const { raiz } = linkado('Rode em C:\\ e abra o README.md depois. Pasta: G:\\Meu Drive\\Pasta Nova e fim.');
  assert.deepEqual(anotados(raiz), []);
});

test('codigo que ja esta dentro de um link nao ganha um segundo link', () => {
  const { raiz } = linkado('[`G:\\Meu Drive\\a.md`](https://exemplo.com/a)');
  assert.deepEqual(anotados(raiz), []);
  assert.ok(raiz.querySelector('code').filhos.every((f) => f.nodeType === 3));
});

/* =====================================================================
   o que ja funcionava continua igual
   ===================================================================== */
test('caminho sem espaco no texto, com linha, em POSIX e .excalidraw.md: o mesmo de antes', () => {
  const p = palco();
  const raiz = daResposta('Abra C:\\x\\app.js:12 e /opt/equipe/trabalho/a.md. Desenho: C:\\vault\\desenho.excalidraw.md ok.');
  p.linkar(raiz);
  assert.deepEqual(anotados(raiz).map((a) => a.caminho), ['C:\\x\\app.js', '/opt/equipe/trabalho/a.md', 'C:\\vault\\desenho.excalidraw.md']);
  assert.equal(raiz.querySelectorAll('a')[0].dataset.fileLine, '12', 'a linha do :12 continua indo no link');
});

test('link de markdown que ja era <a> continua virando link do leitor', () => {
  const { raiz } = linkado('[relatório](<G:\\Meu Drive\\04. PESSOAL\\relatorio.md>)');
  assert.deepEqual(anotados(raiz).map((a) => a.caminho), ['G:\\Meu Drive\\04. PESSOAL\\relatorio.md']);
});

test('linkar duas vezes a mesma resposta nao duplica nem refaz o link que ja existe', () => {
  const p = palco();
  const raiz = daResposta('Veja `G:\\Meu Drive\\a b.md` e G:\\Meu Drive\\c d.pdf.');
  p.linkar(raiz);
  const uma = anotados(raiz);
  const noDoCodigo = raiz.querySelector('code').filhos[0];
  p.linkar(raiz);
  assert.deepEqual(anotados(raiz), uma);
  assert.equal(uma.length, 2);
  assert.equal(raiz.querySelector('code').filhos.length, 1);
  assert.equal(raiz.querySelector('code').filhos[0], noDoCodigo, 'o link do codigo e o mesmo no, nao um novo');
  assert.equal(raiz.querySelectorAll('a').length, 2, 'nenhum link dentro de link');
});

test('espaco sobrando de um lado das crases nao atrapalha, e o texto continua como estava', () => {
  const { raiz } = linkado('Veja ` G:\\Meu Drive\\a b.md` agora.');
  assert.deepEqual(anotados(raiz).map((a) => a.caminho), ['G:\\Meu Drive\\a b.md']);
});

test('codigo que o parse recusa (controle escondido em %00) continua codigo, sem link vazio no lugar', () => {
  const { raiz } = linkado('Estranho: `C:\\x\\%00a.md` e `C:\\x\\a%0d%0ab.md`.');
  assert.deepEqual(anotados(raiz), []);
  assert.equal(raiz.querySelectorAll('a').length, 0);
  assert.ok(raiz.querySelectorAll('code').every((c) => c.filhos.length === 1 && c.filhos[0].nodeType === 3));
});

test('pasta com ponto (proj.v2) e espaco depois: o caminho sai inteiro, uma vez so', () => {
  const { raiz } = linkado('Abra C:\\proj.v2\\Meu Drive\\a.md agora.');
  assert.deepEqual(anotados(raiz).map((a) => a.caminho), ['C:\\proj.v2\\Meu Drive\\a.md']);
});

test('caminhos de tipos diferentes no mesmo texto saem na ordem em que aparecem', () => {
  const { raiz } = linkado('Abra C:\\x\\app.js e depois G:\\Meu Drive\\a b.pdf e /opt/equipe/a.md. Fim.');
  assert.deepEqual(anotados(raiz).map((a) => a.caminho), ['C:\\x\\app.js', 'G:\\Meu Drive\\a b.pdf', '/opt/equipe/a.md']);
});

/* =====================================================================
   o clique abre no leitor, com o caminho inteiro (espacos e tudo)
   ===================================================================== */
test('clicar no link do codigo e no do texto abre o caminho inteiro no leitor, sem seguir o href', () => {
  const { raiz, abertos, painel } = linkado('Veja `G:\\Meu Drive\\04. PESSOAL\\nota.md` e G:\\Meu Drive\\a b.pdf:7.');
  const [noCodigo, noTexto] = raiz.querySelectorAll('a');
  assert.ok(noCodigo && noTexto, 'os dois caminhos viraram link');
  const evento = { prevenido: false, parado: false, preventDefault() { this.prevenido = true; }, stopPropagation() { this.parado = true; } };
  noCodigo.onclick(evento);
  noTexto.onclick(evento);
  assert.equal(evento.prevenido && evento.parado, true, 'o clique nao navega a janela do app');
  assert.equal(abertos.length, 2);
  assert.equal(abertos[0][0], painel);
  assert.equal(abertos[0][1], 'G:\\Meu Drive\\04. PESSOAL\\nota.md');
  assert.equal(abertos[1][1], 'G:\\Meu Drive\\a b.pdf');
  assert.equal(abertos[1][3].line, 7, 'a linha do :7 vai junto');
});

test('painel remoto: o link do codigo leva o alvo do painel, como os outros links de arquivo', () => {
  const remoto = { usuario: 'hugo', host: 'vps1', chave: 'k' };
  const { raiz, abertos } = linkado('Veja `G:\\Meu Drive\\a.md`.', { remoto });
  const link = raiz.querySelector('a');
  assert.ok(link, 'o caminho entre crases virou link');
  link.onclick({ preventDefault() {}, stopPropagation() {} });
  assert.equal(abertos.length, 1);
  assert.equal(abertos[0][2], remoto);
});
