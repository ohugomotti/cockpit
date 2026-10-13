'use strict';
/* Cascata mínima do <html>, só para os testes de tema (leva 5e, escuros e Automático). Lê as folhas do renderer na ordem em que o
   index.html as carrega e diz que valor cada propriedade do <html> tem num estado dado (tema, luz do tema, visual Mac ligado ou
   não): ganha a regra mais específica e, entre iguais, a que vem depois. É a conta que o navegador faz com os tokens, e por isso
   enxerga o que ler um bloco de CSS à mão não enxerga: quem ganha quando duas regras pintam o mesmo token.
   Entende só o que cabe no <html>: html, :root, .classe, [attr], [attr="v"], :not(), :is() e :where(). Um seletor de <html> que
   ela não entende estoura: melhor falhar do que medir errado. Só lê CSS (nada de navegador, nada de rede). */
const fs = require('node:fs');
const path = require('node:path');
const DIR = path.join(__dirname, '../src/renderer');
const lerFolha = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');

// as folhas, na ordem do index.html (as de vendor/ ficam de fora: são de terceiros e não mexem nos temas)
function folhas() {
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  return [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]).filter((h) => !h.startsWith('vendor/'));
}

// parte `texto` em `sep` só fora de (), [] e aspas
function dividir(texto, sep) {
  const partes = [];
  let fundo = 0, aspas = null, ini = 0;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) { if (c === '\\') i++; else if (c === aspas) aspas = null; continue; }
    if (c === '"' || c === "'") aspas = c;
    else if (c === '(' || c === '[') fundo++;
    else if (c === ')' || c === ']') fundo--;
    else if (c === sep && fundo === 0) { partes.push(texto.slice(ini, i)); ini = i + 1; }
  }
  partes.push(texto.slice(ini));
  return partes;
}

// as regras de primeiro nível: { seletores: [...], corpo }. At-rules (@media, @font-face, @keyframes) ficam de fora.
function regras(css) {
  const saida = [];
  let i = 0;
  while (i < css.length) {
    const abre = css.indexOf('{', i);
    if (abre < 0) break;
    const antes = dividir(css.slice(i, abre), ';');
    const prelude = antes[antes.length - 1].trim();
    let nivel = 1, j = abre + 1, aspas = null;
    for (; j < css.length && nivel > 0; j++) {
      const c = css[j];
      if (aspas) { if (c === '\\') j++; else if (c === aspas) aspas = null; continue; }
      if (c === '"' || c === "'") aspas = c;
      else if (c === '{') nivel++;
      else if (c === '}') nivel--;
    }
    if (!prelude.startsWith('@')) saida.push({ seletores: dividir(prelude, ',').map((s) => s.trim()).filter(Boolean), corpo: css.slice(abre + 1, j - 1) });
    i = j;
  }
  return saida;
}

function declaracoes(corpo) {
  const lista = [];
  for (const par of dividir(corpo, ';')) {
    const i = par.indexOf(':');
    const nome = i < 0 ? '' : par.slice(0, i).trim();
    if (!nome) continue;
    let valor = par.slice(i + 1).trim();
    const imp = /!important\s*$/i.test(valor);
    if (imp) valor = valor.replace(/\s*!important\s*$/i, '');
    lista.push({ nome: nome.startsWith('--') ? nome : nome.toLowerCase(), valor, imp });
  }
  return lista;
}

// o primeiro composto do seletor (até o primeiro espaço ou combinador fora de parênteses e colchetes) e o que vem depois dele
function composto(seletor) {
  let fundo = 0, aspas = null;
  for (let i = 0; i < seletor.length; i++) {
    const c = seletor[i];
    if (aspas) { if (c === '\\') i++; else if (c === aspas) aspas = null; continue; }
    if (c === '"' || c === "'") aspas = c;
    else if (c === '(' || c === '[') fundo++;
    else if (c === ')' || c === ']') fundo--;
    else if (fundo === 0 && /[\s>+~]/.test(c)) return [seletor.slice(0, i), seletor.slice(i).trim()];
  }
  return [seletor, ''];
}

function atomos(comp) {
  const lista = [];
  let i = 0;
  while (i < comp.length) {
    const resto = comp.slice(i);
    let m;
    if ((m = /^(html|\*)/.exec(resto))) lista.push({ t: m[1] });
    else if ((m = /^:root\b/.exec(resto))) lista.push({ t: 'root' });
    else if ((m = /^\.([\w-]+)/.exec(resto))) lista.push({ t: 'classe', n: m[1] });
    else if ((m = /^\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/.exec(resto))) lista.push({ t: 'attr', n: m[1], v: m[2] ?? m[3] ?? m[4] });
    else if ((m = /^:(not|is|where)\(/.exec(resto))) {
      let nivel = 1, j = i + m[0].length;
      for (; j < comp.length && nivel; j++) { if (comp[j] === '(') nivel++; else if (comp[j] === ')') nivel--; }
      lista.push({ t: m[1], itens: dividir(comp.slice(i + m[0].length, j - 1), ',').map((s) => s.trim()) });
      i = j;
      continue;
    } else throw new Error('seletor do <html> que a cascata não entende: ' + comp);
    i += m[0].length;
  }
  return lista;
}

// o <html> de um estado: { attrs: { 'data-tema': ..., 'data-mac-luz': ... }, classes: ['visual-mac'] }
function casa(comp, estado) {
  return atomos(comp).every((a) => {
    if (a.t === 'html' || a.t === 'root' || a.t === '*') return true;
    if (a.t === 'classe') return estado.classes.includes(a.n);
    if (a.t === 'attr') return a.v === undefined ? a.n in estado.attrs : estado.attrs[a.n] === a.v;
    if (a.t === 'not') return !a.itens.some((s) => casa(s, estado));
    return a.itens.some((s) => casa(s, estado));   // :is e :where
  });
}

// especificidade [ids, classes+atributos+pseudo-classes, tipos]; o :where() pesa zero e o :not()/:is() pesa o mais pesado de dentro
function peso(comp) {
  let b = 0, c = 0;
  for (const a of atomos(comp)) {
    if (a.t === 'html') c++;
    else if (a.t === 'root' || a.t === 'classe' || a.t === 'attr') b++;
    else if (a.t === 'not' || a.t === 'is') {
      const [, bb, cc] = a.itens.map(peso).sort((x, y) => (y[1] - x[1]) || (y[2] - x[2]))[0] || [0, 0, 0];
      b += bb; c += cc;
    }
  }
  return [0, b, c];
}
const ehHtml = (comp) => /^(html|:root)/.test(comp);
const maior = (x, y) => { for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

let cache = null;
function todas() {
  if (cache) return cache;
  cache = [];
  let ordem = 0;
  for (const f of folhas()) for (const r of regras(lerFolha(f))) cache.push({ f, ordem: ++ordem, seletores: r.seletores, decls: declaracoes(r.corpo) });
  return cache;
}

// o estado do <html> para um tema, a luz que o visual-mac.js põe nele e o visual Mac ligado ou não (a plataforma é a do Hugo)
const estado = (tema, luz, mac) => ({ attrs: { 'data-tema': tema, 'data-mac-luz': luz, 'data-platform': 'win32', 'data-mac-aneis': 'tema' }, classes: mac ? ['visual-mac'] : [] });

// o que o <html> vale naquele estado: Map nome -> { valor, de } (só as regras que pintam o próprio <html>, sem descendente)
function efetivo(est) {
  const vence = new Map();
  for (const r of todas()) for (const sel of r.seletores) {
    const [comp, resto] = composto(sel);
    if (resto || !ehHtml(comp) || !casa(comp, est)) continue;
    const chave = [...peso(comp), r.ordem];
    for (const d of r.decls) {
      const k = [d.imp ? 1 : 0, ...chave];
      const atual = vence.get(d.nome);
      if (!atual || maior(k, atual.k)) vence.set(d.nome, { valor: d.valor, k, de: r.f + ' · ' + sel });
    }
  }
  return vence;
}

// "var(--x)" e "var(--x, reserva)" resolvidos no mapa de um estado (para ler o --focus: var(--primary) como cor)
function resolver(valor, mapa, fundo = 0) {
  const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/.exec(String(valor).trim());
  if (!m || fundo > 8) return String(valor).trim();
  const alvo = mapa.get(m[1]);
  if (alvo) return resolver(alvo.valor, mapa, fundo + 1);
  return m[2] !== undefined ? resolver(m[2], mapa, fundo + 1) : String(valor).trim();
}

// as regras com descendente (html[...] .coisa) que valem para um estado e não para o outro: [] quando os dois pintam igual
function dessemelhantes(a, b) {
  const lista = [];
  for (const r of todas()) {
    let doA = false, doB = false, viu = false;
    for (const sel of r.seletores) {
      const [comp, resto] = composto(sel);
      if (!resto || !ehHtml(comp)) continue;
      viu = true; doA = doA || casa(comp, a); doB = doB || casa(comp, b);
    }
    if (viu && doA !== doB) lista.push(r.f + ' · ' + r.seletores.join(', ').slice(0, 140) + (doA ? ' [vale só no primeiro]' : ' [vale só no segundo]'));
  }
  return lista;
}

module.exports = { estado, efetivo, resolver, dessemelhantes, folhas };
