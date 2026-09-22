'use strict';
/* Sessao nova nasce na ponta esquerda — 22/09/2026, a pedido do Hugo.

   Antes o painel novo nascia em max(coluna)+1, na ponta DIREITA: com a esteira
   cheia ele abria fora da tela e so' aparecia depois do scrollIntoView. Agora
   ele nasce na coluna 0 e as sessoes que ja estavam andam uma casa pra direita.

   A troca tem um efeito colateral que este arquivo existe pra vigiar: quem cria
   painel EM LOTE (a restauracao ao abrir o app, e o "abrir dois motores de uma
   vez") nao pode deixar o empurrao embaralhar a disposicao. Duas garantias:

     1) a restauracao declara a coluna salva na propria chamada do newPane —
        nao adianta corrigir P.coluna DEPOIS, porque o empurrao ja aconteceu
        nos vizinhos e dois paineis terminavam na mesma coluna;
     2) o lote de motores cria de tras pra frente, senao a tela sai invertida.

   E a linha azul do foco, do mesmo pedido: ela circunda a sessao inteira como
   OUTLINE. Border nao serve — ocupa espaco (a sessao com rolagem desalinha) e
   desenha pra fora (briga com a coluna vizinha); foi por isso que a tentativa
   antiga foi removida. O teste fixa o outline com offset negativo. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..', 'src', 'renderer');
const leia = (nome) => fs.readFileSync(path.join(raiz, nome), 'utf8').replace(/\r\n/g, '\n');
const app = leia('app.js');
const cssUi = leia('cockpit-ui.css');
const cssAnim = leia('cockpit-anim.css');

/* ---------- 1) o painel novo nasce na esquerda ---------- */

test('painel novo: coluna 0, e as que ja estavam andam uma casa pra direita', () => {
  const trecho = app.slice(app.indexOf('function newPane('), app.indexOf('/* ===================== COLUNAS'));
  assert.ok(trecho.length > 100, 'nao achei o corpo do newPane');
  assert.doesNotMatch(
    trecho,
    /Math\.max\(\.\.\.\[\.\.\.panes\.values\(\)\]/,
    'ainda nasce em max+1, ou seja, na ponta direita',
  );
  assert.match(trecho, /P\.coluna = 0;/, 'o painel novo tem que assumir a coluna 0');
  assert.match(
    trecho,
    /for \(const q of panes\.values\(\)\) if \(q !== P\) q\.coluna = \(q\.coluna == null \? 0 : q\.coluna\) \+ 1;/,
    'faltou empurrar as sessoes que ja estavam',
  );
  // o empurrao NAO pode acontecer quando a coluna vem declarada
  assert.match(trecho, /if \(opts\.coluna != null\) \{\s*P\.coluna = opts\.coluna;/,
    'com coluna declarada, ninguem pode ser empurrado');
});

test('painel novo: a rolagem acompanha pelo comeco da esteira, nao pelo fim', () => {
  const trecho = app.slice(app.indexOf('function newPane('), app.indexOf('/* ===================== COLUNAS'));
  assert.match(trecho, /scrollIntoView\(\{ behavior: 'smooth', inline: 'start'/,
    "com a sessao nascendo na esquerda, inline:'end' rolava pro lado errado");
});

/* ---------- 2) lote nao pode embaralhar ---------- */

test('restauracao: a coluna salva vai na chamada do newPane, nao depois', () => {
  const fn = app.slice(app.indexOf('function opcoesDoPainelSalvo('), app.indexOf('async function restaurarPaineisMiolo'));
  assert.match(fn, /coluna: s\.coluna/, 'a ficha salva tem coluna e ela precisa ir junto');
  const restaura = app.slice(app.indexOf('async function restaurarPaineisMiolo'));
  assert.match(restaura.slice(0, 2500), /if \(salvas\.coluna == null\) salvas\.coluna = i;/,
    'ficha antiga sem coluna precisa cair no indice do lote');
});

test('abrir varios motores de uma vez: cria de tras pra frente', () => {
  assert.match(
    app,
    /for \(const m of \[\.\.\.quais\]\.reverse\(\)\) newPane\(/,
    'sem o reverse, os motores aparecem invertidos na tela',
  );
});

/* ---------- 3) a linha azul em volta da sessao ---------- */

test('foco: a sessao inteira ganha linha azul de 1px, como outline', () => {
  const regra = cssUi.slice(cssUi.indexOf('.ck-app .pane.focus,\n.ck-app .pane.focused'));
  const corpo = regra.slice(0, regra.indexOf('}') + 1);
  assert.match(corpo, /outline:\s*1px solid var\(--focus\)/, 'mesma espessura e cor da caixa de escrever');
  assert.match(corpo, /outline-offset:\s*-1px/, 'offset negativo: desenha por dentro, nao invade a coluna vizinha');
  assert.doesNotMatch(corpo, /border:/, 'border volta a ocupar espaco e desalinha a sessao com rolagem');
});

test('foco: a caixa de escrever continua com a linha dela', () => {
  assert.match(cssUi, /\.ck-app \.pane\.focus \.pane-cmp,[\s\S]{0,180}border-color: var\(--focus\)/,
    'a linha do campo nao pode ter sumido junto');
});

/* ---------- 4) a entrada da sessao nova ---------- */

test('entrada da sessao nova: fade, sem deslizar', () => {
  assert.match(app, /el\.classList\.add\('mv-nasce'\)/, 'falta marcar o painel novo');
  assert.match(app, /setTimeout\(\(\) => el\.classList\.remove\('mv-nasce'\), 420\)/, 'a classe precisa sair sozinha');
  const quadro = cssAnim.slice(cssAnim.indexOf('@keyframes mv-nasce'));
  const corpo = quadro.slice(0, quadro.indexOf('}\n') + 1);
  assert.match(corpo, /opacity/, 'o fade e o que faz a entrada');
  assert.doesNotMatch(corpo, /translate/, 'o guia de marca do Cockpit diz que nada entra deslizando');
});
