'use strict';
/* Leva 5, T3 (R3-04, R3-05): as listas antigas que o Ctrl+K abre ("Conversas guardadas", "Torre de controle") pelo teclado.
   A TORRE e o HISTÓRICO da lateral do .ck-app já eram botões (sessionRow). Medida: linhas que abrem com Enter (antes 0). */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');
const APP = lerFonte('renderer', 'app.js');

// elemento de mentira: classes, atributos e ouvintes; $(sel, el) devolve um filho de mentira por seletor
function falso(tag) {
  const cls = new Set(), attrs = {}, ouvintes = {}, subs = new Map();
  const el = {
    tagName: String(tag).toUpperCase(), tabIndex: -1, style: {}, dataset: {}, title: '', innerHTML: '', textContent: '',
    get className() { return [...cls].join(' '); },
    set className(v) { cls.clear(); for (const c of String(v).split(/\s+/)) if (c) cls.add(c); },
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c),
      toggle: (c, on) => { const ligar = on === undefined ? !cls.has(c) : !!on; if (ligar) cls.add(c); else cls.delete(c); return ligar; } },
    setAttribute: (k, v) => { attrs[k] = String(v); }, getAttribute: (k) => (k in attrs ? attrs[k] : null),
    addEventListener: (t, f) => { (ouvintes[t] = ouvintes[t] || []).push(f); },
    appendChild: (c) => c, closest: () => null,
    click() { for (const f of ouvintes.click || []) f({ target: el, stopPropagation() {}, preventDefault() {} }); },
    sub: (sel) => { if (!subs.has(sel)) subs.set(sel, falso('span')); return subs.get(sel); },
    // devolve quantas vezes a linha deu preventDefault; 'leitura.parou' conta os stopPropagation (a tecla não sobe)
    tecla(key, alvo, leitura) {
      let travou = 0;
      const e = { key, target: alvo || el, repeat: false, preventDefault() { travou++; }, stopPropagation() { if (leitura) leitura.parou++; } };
      for (const f of ouvintes.keydown || []) f(e);
      return travou;
    },
  };
  return el;
}
const DOM = () => ({ document: { createElement: falso }, $: (sel, raiz) => raiz.sub(sel) });

// linhaDaTorre({ titulo, … }): o pegarBloco pararia na "{" da desestruturação do parâmetro (SyntaxError); aqui o corpo
// começa na "{" depois do ")" da assinatura, como o funcao() do torre.test.js
function corpo(nome) {
  const i = APP.indexOf('function ' + nome + '(');
  assert.ok(i >= 0, 'não achei ' + nome);
  let nivel = 0, k = APP.indexOf('(', i);
  for (; k < APP.length; k++) { if (APP[k] === '(') nivel++; else if (APP[k] === ')' && --nivel === 0) break; }
  return APP.slice(i, k + 1) + pegarBloco(APP.slice(k + 1), '{', nome);
}

test('linha de "Conversas guardadas" abre com Enter e Espaço; o Enter num botão de dentro é do botão (R3-04)', () => {
  const abertas = [];
  const ctx = vm.createContext({ ...DOM(), marcarTermo: (el, t) => { el.textContent = t; }, quando: () => 'agora', ico: () => '',
    ehFavorita: () => false, grupoDaSessao: () => null, grupoPorId: () => null, remotoDoAba: () => null, abaAtual: () => null,
    openSession: (s) => abertas.push(s.id) });
  vm.runInContext(pegarBloco(APP, 'function linhaConversa(', 'linhaConversa'), ctx);
  const d = ctx.linhaConversa({ id: 's1', engine: 'claude', title: 'Conversa', when: 0, cwd: 'C:\\proj' }, '', '');
  assert.equal(d.tabIndex, 0, 'a linha entra no Tab');
  assert.equal(d.getAttribute('role'), 'button');
  assert.equal(d.tecla('Enter'), 1); assert.equal(d.tecla(' '), 1);
  assert.deepEqual(abertas, ['s1', 's1']);
  assert.equal(d.tecla('Enter', d.sub('.hi-fav')), 0, 'Enter na estrela');
  assert.deepEqual(abertas, ['s1', 's1'], 'o Enter na estrela não abre a conversa');
});

test('linha da "Torre de controle" vai ao painel pelo teclado; a de sessão de fora não entra no Tab (R3-05)', () => {
  const idas = [];
  const ctx = vm.createContext({ ...DOM(), ico: () => '', marcaDoMotor: () => '', nomeDoMotor: (m) => m });
  vm.runInContext(corpo('linhaDaTorre'), ctx);
  const d = ctx.linhaDaTorre({ titulo: 'Painel', motor: 'claude', estado: { cls: 'ok', txt: 'parado' }, aoClicar: () => idas.push(1) });
  assert.equal(d.tabIndex, 0); assert.equal(d.getAttribute('role'), 'button');
  d.tecla('Enter');
  assert.equal(idas.length, 1);
  const fora = ctx.linhaDaTorre({ titulo: 'Fora', motor: 'claude', estado: { cls: '', txt: 'fora do Cockpit' } });
  assert.equal(fora.tabIndex, -1, 'sem aoClicar não há para onde ir');
});

test('a repintura de 4 s da Torre espera o foco sair, como já esperava o mouse (R3-05)', () => {
  const i = APP.indexOf('if (document.hidden || !torreVisivel()) return;');
  const trecho = APP.slice(i, APP.indexOf('}, 4000);', i));
  assert.match(trecho, /b\.matches\(':hover'\) \|\| \(document\.activeElement && b\.contains\(document\.activeElement\)\)/);
});

test('cabeçalho de grupo abre e fecha pelo teclado e diz se está aberto (R3-04)', () => {
  const bloco = pegarBloco(APP, 'function linhaGrupo(', 'linhaGrupo');
  assert.match(bloco, /cab\.tabIndex = 0; cab\.setAttribute\('role', 'button'\);/);
  assert.match(bloco, /if \(\(e\.key === 'Enter' \|\| e\.key === ' '\) && e\.target === cab\)/);
  assert.match(bloco, /cab\.setAttribute\('aria-expanded', String\(!cab\.classList\.contains\('recolhido'\)\)\)/);
});

/* ---- Extras (além dos 4 testes do plano): o que o plano não mede ---- */
// as 3 linhas de verdade, num DOM de mentira; o cabeçalho do grupo é o 1º createElement da linhaGrupo
function tresLinhas() {
  const criados = [], alternados = [];
  const doc = { createElement: (t) => { const x = falso(t); criados.push(x); return x; }, createDocumentFragment: () => falso('frag') };
  const ctx = vm.createContext({ document: doc, $: (sel, raiz) => raiz.sub(sel), marcarTermo: (el, t) => { el.textContent = t; }, quando: () => 'agora',
    ico: () => '', marcaDoMotor: () => '', nomeDoMotor: (m) => m, ehFavorita: () => false, grupoDaSessao: () => null, grupoPorId: () => null,
    remotoDoAba: () => null, abaAtual: () => null, openSession() {}, grupoRecolhido: () => false, alternarGrupoRecolhido: (id) => alternados.push(id) });
  vm.runInContext(['linhaConversa', 'linhaGrupo', 'linhaDaTorre'].map(corpo).join('\n'), ctx);
  const conversa = ctx.linhaConversa({ id: 's1', engine: 'claude', title: 'Conversa', when: 0, cwd: 'C:\\proj' }, '', '');
  const antes = criados.length;
  ctx.linhaGrupo({ id: 'g1', nome: 'Clientes', cor: '#fff' }, []);
  const cab = criados[antes];
  const torre = ctx.linhaDaTorre({ titulo: 'Painel', motor: 'claude', estado: { cls: 'ok', txt: 'parado' }, aoClicar: () => {} });
  return { conversa, cab, torre, alternados };
}

test('cabeçalho de grupo de verdade: Enter e Espaço alternam, o aria-expanded acompanha e o Enter no lápis é do lápis (R3-04)', () => {
  const { cab, alternados } = tresLinhas();
  assert.equal(cab.tabIndex, 0);
  assert.equal(cab.getAttribute('aria-expanded'), 'true', 'aberto ao nascer');
  cab.tecla('Enter');
  assert.deepEqual(alternados, ['g1']);
  assert.equal(cab.getAttribute('aria-expanded'), 'false', 'fechou: o leitor de tela ouve "recolhido"');
  cab.tecla(' ');
  assert.equal(cab.getAttribute('aria-expanded'), 'true');
  cab.tecla('Enter', cab.sub('.grp-gear'));
  assert.deepEqual(alternados, ['g1', 'g1'], 'o Enter no lápis de dentro não alterna o grupo');
});

/* O ouvinte "abertura" (document) abre Claude e Codex em QUALQUER Enter enquanto a tela de boas-vindas existe; as Rotinas já
   seguram a tecla por isso. A linha que consumiu o Enter ou o Espaço não pode deixar a tecla subir: o Enter no cabeçalho do grupo
   (só alterna) abriria dois painéis de brinde. A tecla de um botão de dentro e o Tab seguem o caminho deles. */
test('a tecla que a linha consumiu não sobe ao document (a tela de boas-vindas abriria Claude e Codex); a de dentro e o Tab sobem (R3-04, R3-05)', () => {
  const { conversa, cab, torre } = tresLinhas();
  for (const [nome, linha] of [['conversa', conversa], ['grupo', cab], ['torre', torre]]) {
    for (const key of ['Enter', ' ']) {
      const lido = { parou: 0 };
      linha.tecla(key, undefined, lido);
      assert.equal(lido.parou, 1, nome + ': ' + JSON.stringify(key) + ' consumido não sobe');
    }
    const dentro = { parou: 0 }; linha.tecla('Enter', linha.sub('.botao-de-dentro'), dentro);
    assert.equal(dentro.parou, 0, nome + ': o Enter num botão de dentro segue com o botão');
    const tab = { parou: 0 }; linha.tecla('Tab', undefined, tab);
    assert.equal(tab.parou, 0, nome + ': o Tab passa');
  }
});
