'use strict';
/* Leva 3, Tarefa 9 (pendência da leva 2): achar caminho no texto em tempo linear. Medidas:
   - linkarArquivos com 32 KB e 400 KB dos formatos que travavam o regex (antes: 32 KB entre 75 e 490 ms, 400 KB ~1 min;
     teto 30 ms e 50 ms), cada forma pelo melhor de 3;
   - uma linha de 144 KB com 16 mil caminhos (antes ~0,9-1,1 s; teto 400 ms), também pelo melhor de 3;
   - findPlainPaths + mergePaths dão o MESMO resultado do jeito antigo em 40 mil textos aleatórios, com caminhos de verdade
     entre as peças (com e sem espaço, de rede, com :linha e #L) e uma conferência de que o sorteio passa por tudo isso. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const links = require('../src/renderer/file-links');
const { lerFonte } = require('../testes/raiz');

const APP = lerFonte('renderer', 'app.js');
const inicio = APP.indexOf('function linkarArquivos(');
const TRECHO = APP.slice(inicio, APP.indexOf('\n}\n', inicio) + 2);
// o mesmo "re" que o linkarArquivos usa (test/quadro-fluxo.test.js lê do mesmo jeito)
const RE = vm.runInNewContext(TRECHO.split('\n').find((l) => /^\s*const re = \//.test(l)).replace(/^\s*const re = /, '').replace(/;\s*$/, ''));
const B = '\\';

/* DOM de mentira só com o que o linkarArquivos usa; fragmento e replaceWith sem splice por filho (o DOM de mentira
   não pode ser o gargalo de uma linha com 32 mil nós) */
class No {
  constructor(tipo, tag, texto = '') { this.nodeType = tipo; this.tagName = tag; this.texto = texto; this.filhos = []; this.pai = null; this.attrs = new Map(); this.dataset = {}; this.classes = new Set(); }
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
    if (n.nodeType === 11) { for (const f of n.filhos) { f.pai = this; this.filhos.push(f); } n.filhos = []; return n; }
    if (n.pai) n.pai.filhos.splice(n.pai.filhos.indexOf(n), 1);
    n.pai = this; this.filhos.push(n); return n;
  }
  replaceWith(n) {
    const pai = this.pai, i = pai.filhos.indexOf(this), novos = n.nodeType === 11 ? n.filhos : [n];
    if (n.nodeType === 11) n.filhos = [];
    pai.filhos = [...pai.filhos.slice(0, i), ...novos, ...pai.filhos.slice(i + 1)];
    for (const x of novos) x.pai = pai;
    this.pai = null;
  }
  descendentes() { return this.filhos.flatMap((f) => [f, ...f.descendentes()]); }
  querySelectorAll(sel) { const [, tag, attr] = sel.match(/^(\w+)(?:\[(\w+)\])?$/); return this.descendentes().filter((n) => n.nodeType === 1 && n.tagName === tag.toUpperCase() && (!attr || n.attrs.has(attr))); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { const tags = sel.split(',').map((s) => s.trim().toUpperCase()); for (let n = this; n && n.nodeType === 1; n = n.pai) if (tags.includes(n.tagName)) return n; return null; }
}
function palco() {
  const ctx = vm.createContext({
    console, window: { CockpitFileLinks: links },
    document: { createElement: (t) => new No(1, t.toUpperCase()), createTextNode: (s) => new No(3, '#text', s), createDocumentFragment: () => new No(11, '#document-fragment') },
    HOME: 'C:' + B + 'Users' + B + 'hugo', remotoDoPane: () => null, verArquivo() {},
  });
  vm.runInContext(TRECHO, ctx);
  return (txt) => {
    const raiz = new No(1, 'DIV'), p = new No(1, 'P');
    raiz.appendChild(p); p.appendChild(new No(3, '#text', txt));
    const t0 = performance.now();
    ctx.linkarArquivos({ id: 'p1', cwd: 'C:' + B + 'x' }, raiz);
    return { ms: performance.now() - t0, links: raiz.querySelectorAll('a').length };
  };
}
const FORMAS = {
  'barra-traço /-/-': (n) => '/-'.repeat(n / 2),
  'ponto-barra ./././': (n) => './'.repeat(n / 2),
  'traço-ponto-barra -./': (n) => '-./'.repeat(Math.floor(n / 3)),
  'til ~/~/': (n) => '~/'.repeat(n / 2),
  'traço-til -~/': (n) => '-~/'.repeat(Math.floor(n / 3)),
  'contrabarras -\\\\': (n) => ('-' + B + B).repeat(Math.floor(n / 3)),
  'file:/// repetido': (n) => '-file:///'.repeat(Math.floor(n / 9)),
  'unidade -C:\\': (n) => ('-C:' + B).repeat(Math.floor(n / 4)),
  'ponto sem extensão /a.-': (n) => '/a.-'.repeat(Math.floor(n / 4)),
  // as 9 formas acima não têm nenhum ponto seguido de letra, então o findPlainPaths pula o pedaço sem rodar o re; esta tem um no
  // começo, e só o CORTE depois dele (sem ele o re volta a varrer o lixo inteiro a cada "/") a mantém linear
  'ponto no começo e lixo depois x.a/-/-': (n) => 'x.a' + '/-'.repeat(Math.floor((n - 3) / 2)),
};
// o melhor de 3 (como o findSpacedPaths em file-links.test.js): um tropeço da máquina (coleta de lixo, outro programa) não
// reprova o teste, e o quadrático falha nas 3
const melhorDe3 = (linkar, txt) => {
  let melhor = null;
  for (let i = 0; i < 3; i++) { const r = linkar(txt); if (!melhor || r.ms < melhor.ms) melhor = r; }
  return melhor;
};

test('formatos que travavam o regex: 32 KB abaixo de 30 ms e 400 KB abaixo de 50 ms', () => {
  const linkar = palco();
  linkar('aquecer C:' + B + 'a.md /x/y.js');
  for (const [nome, forma] of Object.entries(FORMAS)) {
    const pequeno = melhorDe3(linkar, forma(32 * 1024));
    // quadrático já passa de 75 ms em 32 KB: falha aqui, sem tentar os 400 KB (~1 min)
    assert.ok(pequeno.ms < 30, nome + ' em 32 KB: ' + Math.round(pequeno.ms) + ' ms');
    const grande = melhorDe3(linkar, forma(400 * 1024));
    assert.ok(grande.ms < 50, nome + ' em 400 KB: ' + Math.round(grande.ms) + ' ms');
    assert.equal(grande.links, 0);
  }
});

test('linha com 16 mil caminhos (com e sem espaço) abaixo de 400 ms', () => {
  const linkar = palco();
  linkar('aquecer C:' + B + 'a.md');
  const r = melhorDe3(linkar, ('G:' + B + 'a b.md C:' + B + 'x.md ').repeat(8000));
  assert.equal(r.links, 16000);
  assert.ok(r.ms < 400, 'linkarArquivos de 144 KB com 16 mil caminhos: ' + Math.round(r.ms) + ' ms');
});

test('findPlainPaths + mergePaths dão o mesmo resultado do jeito antigo em 40 mil textos aleatórios', () => {
  // semente zerada aqui, no começo: o teste dá o mesmo resultado em toda máquina. Mulberry32, só com inteiros de 32 bits: o
  // "semente * 1103515245" que havia antes passava de 2^53, perdia os bits baixos e só sorteava posições pares (metade das
  // peças nunca saía, e nenhum texto tinha caminho com espaço)
  let semente = 42;
  const sorteio = (n) => {
    semente = (semente + 0x6d2b79f5) | 0;
    let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
  // o jeito antigo: o re no texto inteiro e um "some" na lista inteira para cada caminho
  const antigo = (txt) => {
    const achados = links.findSpacedPaths(txt).map(({ index, path }) => ({ index, path }));
    RE.lastIndex = 0;
    for (let m; (m = RE.exec(txt));) {
      const fim = m.index + m[1].length;
      if (!achados.some((x) => m.index < x.index + x.path.length && x.index < fim)) achados.push({ index: m.index, path: m[1] });
    }
    return achados.sort((x, y) => x.index - y.index);
  };
  const pecas = ['C:', B, '/', '.', 'md', 'js', 'a', 'b', ' ', '-', '~', ':', '12', '#L3', 'C4', '-L5', 'file:///', 'excalidraw', '.md',
    'G:' + B + 'Meu Drive' + B, 'x y.pdf', ',', ')', '"', "'", '<', '>', '|', '*', '?', '\n', 'Ç', '..', './', '../', B + B,
    'https://a.b/c.md', '%20', '_', '1', 'é', '\t',
    // caminhos completos (com e sem espaço, de rede, com :linha, #L e âncora), conectores e fins de frase: só com peças assim
    // os textos têm caminho de verdade, e então o corte do findPlainPaths, a cauda, o lookbehind e o mergePaths são exercitados
    'x.md:12', 'x.md#L3C4-L5', 'C:' + B + 'a.b' + B + 'Meu Drive' + B + 'x.md', 'G:' + B + 'Meu Drive' + B + 'a b.md', '/opt/x.js', '~/n.md',
    B + B + 'srv' + B + 'x.md', ' e ', './src/a.js:3:4', 'C:/Users/h/Meu Projeto/README.md', 'x.excalidraw.md', 'x.md#nome_x', 'x.',
    '//srv/x.md', 'file://srv/x.md', '. '];
  const usos = new Array(pecas.length).fill(0);
  const vistos = { comEspaco: 0, doisComEspaco: 0, comDescarte: 0, espacoEOutros: 0 };
  for (let k = 0; k < 40000; k++) {
    let txt = '';
    for (let i = 0, n = 1 + sorteio(14); i < n; i++) { const p = sorteio(pecas.length); usos[p]++; txt += pecas[p]; }
    const espaco = links.findSpacedPaths(txt), simples = links.findPlainPaths(txt, RE), junto = links.mergePaths(espaco, simples);
    assert.deepEqual(junto, antigo(txt), JSON.stringify(txt));
    if (espaco.length) vistos.comEspaco++;
    if (espaco.length > 1) vistos.doisComEspaco++;
    if (espaco.length + simples.length > junto.length) vistos.comDescarte++;   // a sobreposição descartou um achado sem espaço
    if (espaco.length && junto.length > espaco.length) vistos.espacoEOutros++;   // com espaço e sem espaço no mesmo texto, em ordem
  }
  // o sorteio tem de passar por tudo o que o teste diz conferir (medido: peça menos sorteada ~5000 vezes; 3950, 145, 1512 e 1424 textos)
  const raras = Math.min(...usos);
  assert.ok(raras > 1000, 'peça pouco sorteada: ' + JSON.stringify(pecas[usos.indexOf(raras)]) + ' saiu só ' + raras + ' vezes em 40 mil textos');
  assert.ok(vistos.comEspaco > 1000, 'poucos textos com caminho com espaço: ' + vistos.comEspaco);
  assert.ok(vistos.doisComEspaco > 50, 'poucos textos com 2 caminhos com espaço: ' + vistos.doisComEspaco);
  assert.ok(vistos.comDescarte > 400, 'poucos textos em que a sobreposição descartou um achado: ' + vistos.comDescarte);
  assert.ok(vistos.espacoEOutros > 400, 'poucos textos com caminho com espaço e sem espaço juntos: ' + vistos.espacoEOutros);
});
