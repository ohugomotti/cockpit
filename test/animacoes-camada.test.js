'use strict';
/* Camada de movimento (cockpit-anim.css / .js) — 22/09/2026.

   A camada foi acrescentada pra dar UX ao plano vivo: o segmento em andamento
   respira, o que concluiu da um pop, o contador e o texto do passo avisam que
   mudaram. Ela e um arquivo a parte, carregado no fim do index.html, e some
   inteira se o <link> sair.

   Este arquivo cobra tres contratos. Os dois primeiros sao os mesmos do
   test/animacoes-estado.test.js, porque a regua vale pro app inteiro:

     1) todo quadro anima SO transform e opacity — nada que repinte;
     2) toda animacao infinita tem guarda de prefers-reduced-motion;

   e o terceiro e proprio desta camada, e o motivo dela existir:

     3) em seletor que JA e do app (.ck-plan*, .p-send, .pl-*), a camada so
        pode declarar movimento (animation/transition/transform). Se um dia
        alguem puser cor, tamanho, fonte ou espacamento aqui, o teste quebra —
        porque ai nao e mais "camada de movimento", e redesenho escondido.

   Mais dois contratos de desempenho, no JS:

     4) nada de MutationObserver: o plano e recriado a cada atualizacao, mas
        durante o streaming o DOM muda a cada quadro, e um observer no
        documento cobraria esse preco o turno inteiro. A camada envelopa
        CockpitUI.plan e compara o antes com o depois;
     5) o envelope nunca pode derrubar o render — o que ele faz depois de
        desenhar mora dentro de try/catch. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..', 'src', 'renderer');
const leia = (nome) => fs.readFileSync(path.join(raiz, nome), 'utf8').replace(/\r\n/g, '\n');
const cssBruto = leia('cockpit-anim.css');
const js = leia('cockpit-anim.js');
const html = leia('index.html');

/* ---------- o mesmo leitor de CSS dos testes vizinhos ---------- */
const css = cssBruto.replace(/\/\*[\s\S]*?\*\//g, ' ');
const limpo = (s) => s.replace(/\s+/g, ' ').trim();
function separarSeletores(cabeca) {
  const out = [];
  let nivel = 0, atual = '';
  for (const c of cabeca) {
    if (c === '(') nivel++;
    else if (c === ')') nivel--;
    if (c === ',' && nivel === 0) { out.push(atual); atual = ''; continue; }
    atual += c;
  }
  out.push(atual);
  return out.map(limpo).filter(Boolean);
}
function lerCss(fonte) {
  const regras = [], quadros = [];
  (function varrer(texto, dentroDe) {
    let i = 0, inicio = 0, nivel = 0, cabeca = '';
    while (i < texto.length) {
      const c = texto[i];
      if (c === '{') {
        if (nivel === 0) { cabeca = limpo(texto.slice(inicio, i)); inicio = i + 1; }
        nivel++;
      } else if (c === '}') {
        nivel--;
        if (nivel === 0) {
          const corpo = texto.slice(inicio, i);
          if (/^@keyframes/.test(cabeca)) quadros.push({ nome: cabeca.replace(/^@keyframes\s+/, ''), corpo });
          else if (/^@(media|supports|container)/.test(cabeca)) varrer(corpo, dentroDe.concat(cabeca));
          else for (const sel of separarSeletores(cabeca)) regras.push({ sel, corpo, dentroDe });
          inicio = i + 1;
        }
      }
      i++;
    }
  })(fonte, []);
  return { regras, quadros };
}
const { regras, quadros } = lerCss(css);
const animacaoDe = (regra) => {
  const m = regra.corpo.match(/(?:^|[;{\s])animation:\s*([^;]+)/);
  if (!m || /^none\b/.test(limpo(m[1]))) return null;
  return limpo(m[1]);
};
const emMovimentoReduzido = (r) => r.dentroDe.some((a) => /prefers-reduced-motion:\s*reduce/.test(a));
const animadas = regras.filter((r) => animacaoDe(r) && !emMovimentoReduzido(r));

/* ---------- 1) os quadros so mexem no compositor ---------- */

test('camada: todo @keyframes anima apenas transform e opacity', () => {
  assert.ok(quadros.length >= 8, 'a camada deveria ter os quadros do plano vivo');
  for (const k of quadros) {
    const props = [...new Set(Array.from(k.corpo.matchAll(/([a-z-]+)\s*:/g), (m) => m[1]))];
    for (const p of props)
      assert.ok(
        p === 'transform' || p === 'opacity',
        '@keyframes ' + k.nome + ' anima "' + p + '", que repinta; so transform e opacity',
      );
  }
});

/* ---------- 2) todo loop tem freio ---------- */

test('camada: toda animacao infinita aparece na guarda de movimento reduzido', () => {
  const guarda = new Set(
    regras.filter((r) => emMovimentoReduzido(r) && /animation:\s*none/.test(r.corpo)).map((r) => r.sel),
  );
  const infinitas = animadas.filter((r) => /\binfinite\b/.test(animacaoDe(r)));
  assert.ok(infinitas.length > 0, 'a respiracao do passo atual tem que estar aqui');
  for (const r of infinitas)
    assert.ok(guarda.has(r.sel), 'loop sem freio em reduce: ' + r.sel);
});

test('camada: as animacoes de uma vez so tambem param em movimento reduzido', () => {
  const guarda = new Set(
    regras.filter((r) => emMovimentoReduzido(r) && /animation:\s*none/.test(r.corpo)).map((r) => r.sel),
  );
  for (const r of animadas)
    assert.ok(guarda.has(r.sel), 'animacao fora da guarda de reduce: ' + r.sel);
});

/* ---------- 3) movimento sim, redesenho nao ---------- */

test('camada: em seletor do app, so pode declarar movimento', () => {
  /* .mv-* sao classes desta camada, que nao existem no Cockpit: nelas pode
     haver tamanho e cor, porque elas nascem aqui. O que nao pode e mexer na
     aparencia de quem ja estava na tela. */
  const daCamada = (sel) => /(^|[\s>+~])\.mv-[a-z-]+/.test(sel) && !/\.(ck-|pl-|p-send|pp-)/.test(sel);
  const permitidas = new Set(['animation', 'animation-delay', 'transition', 'transform', 'transform-origin']);
  for (const r of regras) {
    if (daCamada(r.sel)) continue;
    const props = [...new Set(Array.from(r.corpo.matchAll(/(?:^|[;{\s])([a-z-]+)\s*:/g), (m) => m[1]))];
    for (const p of props)
      assert.ok(
        permitidas.has(p),
        'a camada mexeria em "' + p + '" de "' + r.sel + '": isso e redesenho, nao movimento',
      );
  }
});

/* ---------- 4 e 5) o contrato de desempenho do JS ---------- */

test('camada: o JS envelopa CockpitUI.plan e nao observa o documento', () => {
  assert.doesNotMatch(js, /new MutationObserver/, 'observer no documento custa caro durante o streaming');
  assert.doesNotMatch(js, /requestAnimationFrame/, 'nao ha por que entrar no laco de quadro');
  assert.match(js, /CockpitUI\.plan\s*=\s*function/, 'falta o envelope de CockpitUI.plan');
  assert.match(js, /estado\.originais\.plan\.apply/, 'o envelope tem que chamar o render original');
});

test('camada: o que roda depois do render esta protegido por try/catch', () => {
  const envelope = js.slice(js.indexOf('function envelopar()'));
  const corpo = envelope.slice(0, envelope.indexOf('function desligar()'));
  const chamadas = corpo.match(/try\s*\{\s*aplicar(Plano|Legado)/g) || [];
  assert.equal(chamadas.length, 2, 'aplicarPlano e aplicarLegado precisam estar dentro de try');
});

test('camada: so anima o que mudou de estado, nunca a lista inteira', () => {
  /* o mapa de quem ja estava feito e o que separa "concluiu agora" de "ja
     estava concluido" — sem ele a barra piscaria inteira a cada passo */
  assert.match(js, /mapa:\s*l\.map\(eFeito\)/, 'falta o mapa de estado anterior');
  assert.match(js, /if \(depois\.mapa\[i\] && !eraFeito\)/, 'falta a comparacao antes/depois');
});

/* ---------- a ligacao no index.html ---------- */

test('camada: index.html carrega o CSS e carrega o JS depois do cockpit-ui.js', () => {
  assert.match(html, /<link rel="stylesheet" href="cockpit-anim\.css">/);
  const iUi = html.indexOf('<script src="cockpit-ui.js">');
  const iAnim = html.indexOf('<script src="cockpit-anim.js">');
  assert.ok(iUi !== -1 && iAnim !== -1, 'os dois scripts precisam estar no index');
  assert.ok(iAnim > iUi, 'o envelope so existe depois que o CockpitUI foi publicado');
});
