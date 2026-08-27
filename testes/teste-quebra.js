/* A resposta parecia quebrada em varias: quatro "CLAUDE" seguidos e todas as
   ferramentas amontoadas depois do ultimo. Este teste roda a sequencia real de
   eventos (fala, ferramenta, fala, ferramenta, fala) e confere a ORDEM que
   sobra no chat. Roda sem Electron: monta um DOM de mentira e usa as funcoes
   de verdade, extraidas do app.js. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { RAIZ, versaoAnterior } = require('./raiz');
const NL = String.fromCharCode(10);

let falhas = 0;
const checa = (nome, cond, det) => {
  if (cond) console.log('  ok   ' + nome);
  else { falhas++; console.log('  FALHA ' + nome + (det ? ' -> ' + det : '')); }
};

// ---------- DOM minimo ----------
function novoEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [], parentNode: null, dataset: {}, style: { setProperty() {}, removeProperty() {} },
    _classes: new Set(), _html: '', textContent: '', title: '',
    get className() { return [...this._classes].join(' '); },
    set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
    classList: {
      add: (...c) => c.forEach(x => el._classes.add(x)),
      remove: (...c) => c.forEach(x => el._classes.delete(x)),
      contains: (c) => el._classes.has(c),
      toggle: (c) => (el._classes.has(c) ? (el._classes.delete(c), false) : (el._classes.add(c), true)),
    },
    get innerHTML() { return this._html; },
    /* parser bem simples: cria um filho por tag com class="", que e' o que as
       funcoes do app procuram depois com querySelector */
    set innerHTML(v) {
      this._html = String(v);
      this.children = [];
      if (!v) return;
      const re = /<([a-z]+)[^>]*class="([^"]+)"[^>]*>/gi;
      let m;
      while ((m = re.exec(String(v)))) {
        const f = novoEl(m[1]);
        f.className = m[2];
        f.parentNode = this;
        this.children.push(f);
      }
    },
    appendChild(c) {
      if (c.parentNode) c.parentNode.children = c.parentNode.children.filter(x => x !== c);
      c.parentNode = this; this.children.push(c); return c;
    },
    insertBefore(c, ref) {
      if (c.parentNode) c.parentNode.children = c.parentNode.children.filter(x => x !== c);
      c.parentNode = this;
      const i = this.children.indexOf(ref);
      if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
      return c;
    },
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(x => x !== this); this.parentNode = null; },
    addEventListener() {}, removeEventListener() {},
    querySelector(sel) { return buscar(this, sel)[0] || null; },
    querySelectorAll(sel) { return buscar(this, sel); },
    getBoundingClientRect: () => ({ width: 100, height: 20, top: 0, bottom: 20, left: 0, right: 100 }),
    scrollIntoView() {},
    get firstChild() { return this.children[0] || null; },
    get isConnected() { return true; },
  };
  return el;
}
function bate(el, sel) {
  if (sel.startsWith('.')) return el._classes.has(sel.slice(1));
  return el.tagName === sel.toUpperCase();
}
function buscar(raiz, sel) {
  const partes = String(sel).split(',').map(s => s.trim());
  const out = [];
  const anda = (n) => { for (const c of n.children) { if (partes.some(s => bate(c, s))) out.push(c); anda(c); } };
  anda(raiz);
  return out;
}

// ---------- carrega as funcoes de verdade do app.js ----------
const APP = path.join(RAIZ, 'src', 'renderer', 'app.js');
const fonte = fs.readFileSync(APP, 'utf8');

function extrair(nome) {
  const marca = 'function ' + nome + '(';
  const i = fonte.indexOf(marca);
  if (i < 0) throw new Error('nao achei a funcao ' + nome);
  let j = fonte.indexOf('{', i), n = 0;
  for (let k = j; k < fonte.length; k++) {
    if (fonte[k] === '{') n++;
    else if (fonte[k] === '}') { n--; if (!n) { j = k; break; } }
  }
  return fonte.slice(i, j + 1);
}

const ctx = {
  console,
  $: (sel, raiz) => (raiz || ctx.document).querySelector(sel),
  document: { createElement: novoEl, querySelector: () => null },
  mdSeguro: (s) => String(s),
  clearEmpty: () => {},
  scroll: () => {},
  svgMotor: () => '<svg/>',
  copiarTexto: () => {},
  toolLabel: (x) => x,
};
vm.createContext(ctx);
for (const f of ['botBlock', 'textDelta', 'selarPassos', 'recolherCaixa', 'limparPassos', 'passo']) {
  vm.runInContext(extrair(f), ctx);
}

// ---------- o cenario da tela do Hugo ----------
console.log('a resposta com ferramentas no meio mantem a ordem?');
const chat = novoEl('div');
const P = { chat, blocks: new Map(), busy: true, passosEl: null, passosSelados: null, engine: 'claude' };

ctx.textDelta(P, 'm1', 'Vou usar a skill security-review.');
ctx.passo(P, { txt: 'Procurando', det: 'npm audit' }, 't1');
ctx.passo(P, { txt: 'Lendo', det: 'package.json' }, 't2');
ctx.textDelta(P, 'm2', 'Nao achei as 9 vulnerabilidades no repo.');
ctx.passo(P, { txt: 'Rodando', det: 'npm audit --json' }, 't3');
ctx.textDelta(P, 'm3', 'npm audit da 13, nao 9.');
ctx.passo(P, { txt: 'Buscando', det: 'conversas anteriores' }, 't4');
ctx.textDelta(P, 'm4', 'Achei: vieram de uma sessao anterior.');

const ordem = chat.children.map(c => (c._classes.has('passos') ? 'PASSOS(' + c.children.length + ')'
  : (c._classes.has('bot') ? 'fala' : c.className)));
console.log('     ordem na tela: ' + ordem.join('  ->  '));

checa('a ordem alterna fala e ferramentas',
  ordem.join(',') === 'fala,PASSOS(2),fala,PASSOS(1),fala,PASSOS(1),fala',
  ordem.join(','));
checa('as ferramentas NAO ficaram todas no fim',
  !(ordem.slice(0, 4).join(',') === 'fala,fala,fala,fala'),
  ordem.join(','));

const falas = chat.children.filter(c => c._classes.has('bot'));
checa('sao 4 falas', falas.length === 4, String(falas.length));
checa('so a PRIMEIRA fala mostra o nome do motor',
  !falas[0]._classes.has('msg-seguida')
  && falas.slice(1).every(f => f._classes.has('msg-seguida')),
  falas.map(f => (f._classes.has('msg-seguida') ? 'escondido' : 'CLAUDE')).join(','));

console.log(NL + 'o fim do turno recolhe TODAS as caixas de passos');
ctx.limparPassos(P);
const caixas = chat.children.filter(c => c._classes.has('passos'));
checa('nenhuma caixa de passos sumiu', caixas.length === 3, String(caixas.length));
checa('todas recolhidas', caixas.every(c => c._classes.has('recolhido')),
  caixas.map(c => (c._classes.has('recolhido') ? 'ok' : 'ABERTA')).join(','));
checa('cada caixa ganhou seu botao de abrir',
  caixas.every(c => c.children.some(x => x._classes.has('passos-cab'))));
checa('nao sobrou caixa pendurada no painel', !P.passosEl && !P.passosSelados);

console.log(NL + 'o texto de cada fala foi preservado');
const textos = falas.map(f => {
  const corpo = f.querySelector('.msg-body');
  return corpo ? corpo._html : '';
});
checa('as 4 falas guardaram o texto certo',
  textos[0].includes('security-review') && textos[3].includes('sessao anterior'),
  JSON.stringify(textos.map(t => t.slice(0, 22))));

console.log(NL + (falhas ? falhas + ' FALHA(S)' : 'a resposta nao quebra mais'));
process.exit(falhas ? 1 : 0);
