'use strict';
/* Leva 5h, a barra da caixa: o encaixe por prioridade da linha do menu.
   A regra do Hugo (leva 5c) é: a caixa tem 2 linhas, o texto em cima e o menu embaixo NUMA linha só. Medido na prévia (painel de 386 px) com os agentes
   (👥 3) e o › Continuar à vista: a linha do menu não cabia e o grupo da direita (.cmp-dir) caía para uma TERCEIRA linha. A conta: barra 366 px, respiro
   6 + 6, sobram 354 úteis; esquerda 5 × 28 + 4 × 2 = 148; vão 2; direita 32 + 115 + 28 + 28 + 3 × 2 = 209; total 359 > 354 (faltavam 5 px).
   O conserto, em ordem de prioridade, esconde só o necessário quando a linha quebraria: 1) desenhar, 2) enviar arquivo, 3) os pontinhos do chip (4: o teto
   do chip, rodada 2). Os dois botões seguem no menu do + ("Desenhar" e "Enviar do computador"). Se nem assim couber (coluna estreitíssima), fica o nível
   que deixa a barra mais baixa (sem diferença, tudo ao normal). Quem
   mede é o encaixarBarra (app.js); o CSS só esconde, pelo nível que ele marca em data-aperto no .cmp-bar.
   Conferido num navegador de verdade (página estática com o CSS do cockpit e o molde do painel; o Cockpit não foi aberto): numa coluna de 386 px a barra mede
   366 (354 úteis), a direita 209,03 e o .cmp-dir cai 32 px abaixo do + (3 linhas); com o encaixe fica no nível 1, em 2 linhas, com uma passada só. Varrendo a
   coluna de 600 a 284 px, e de volta: cabe inteiro com 359 px úteis ou mais, nível 1 de 329, nível 2 de 299, nível 3 de 287 e, abaixo disso, nível 0 em 3
   linhas (como antes); no máximo 2 passadas por mudança e nenhum erro de ResizeObserver. As contas da "página de mentira" abaixo são essas.
   Rodada 2 da leva 5h, item 4: com o chip de TEXTO (Gemini, Grok, ACP) num painel de ~340 px os botões ficavam em 2 ou 3 linhas: nem o nível 3 bastava,
   o encaixe voltava ao nível 0 e lá o grupo da direita quebrava por dentro. O nível 4 soma ao 3 o teto de 72 px (com reticências) no botão do meio do
   chip, a mesma regra do @container (max-width: 290px); e, se nem o 4 cabe numa linha, vale o nível que deixa a barra MAIS BAIXA (no empate, o menor).
   Leva 5i (item 4 da spec, prévia C): o ⚖ Debater e o 👥 Workflow ganharam botão FIXO na direita, antes do chip, e a barra aperta mais cedo (com a Sugestão,
   o Continuar e os agentes juntos). O nível 5 soma ao 4 o último recurso: esconde .p-debate e .p-workflow, e o menu do + passa a mostrá-los, só nesse nível.
   A conta da prévia não muda (o grupo da direita da prévia, ⚖ + 👥 3 + chip + ↑, mede os mesmos 209 px que 👥 + chip + › + ↑ mediam), mas onde antes nada cabia
   (de 287 px úteis para baixo, a barra caía em 3 linhas) agora o 5 cabe até 223 px úteis: libera 64 px a mais que o 3 (28 + 2 do ⚖ e 32 + 2 do 👥), 136 no total. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { RAIZ, lerFonte, pegarBloco, globaisFalsos } = require('../testes/raiz');

const APP = lerFonte('renderer', 'app.js');
// newPane(opts = {}): o pegarBloco pararia no "{}" do parâmetro; o corpo vai até a seção das colunas (como em test/ajustes.test.js:426)
const NEWPANE = APP.slice(APP.indexOf('function newPane('), APP.indexOf('/* ===================== COLUNAS'));
const CSS_UI = lerFonte('renderer', 'cockpit-ui.css');
const CSS_MAC = lerFonte('renderer', 'visual-mac.css');
const CSS_BASE = lerFonte('renderer', 'style.css');

/* ---------- leitura do CSS (a mesma ideia do test/caixa-duas-linhas.test.js) ---------- */

/* Todas as regras, sem os comentários; as de dentro de @media/@container/@supports vêm com o `contexto` da consulta (vazio = regra de topo). */
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

/* Parte o seletor na vírgula de topo: a de dentro de :is(a, b) ou de [attr] não conta. */
function seletores(prelude) {
  const saida = [];
  let fundo = 0, ini = 0;
  for (let i = 0; i < prelude.length; i++) {
    const c = prelude[i];
    if (c === '(' || c === '[') fundo++;
    else if (c === ')' || c === ']') fundo--;
    else if (c === ',' && !fundo) { saida.push(prelude.slice(ini, i).trim()); ini = i + 1; }
  }
  saida.push(prelude.slice(ini).trim());
  return saida;
}

/* Especificidade [a, b, c] de um seletor: #id → a; .classe, [atributo] e :pseudo-classe → b; tipo e ::pseudo-elemento → c. O :is(x, y) e o :not(x, y) valem
   o maior dos argumentos. Só o que o cockpit usa nas folhas; não é um motor de seletores. */
const compara = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
function especificidade(seletor) {
  const soma = [0, 0, 0];
  let resto = seletor;
  for (let i = resto.search(/:(?:is|not)\(/); i >= 0; i = resto.search(/:(?:is|not)\(/)) {
    const abre = resto.indexOf('(', i);
    let fundo = 0, fecha = abre;
    do { fundo += resto[fecha] === '(' ? 1 : resto[fecha] === ')' ? -1 : 0; fecha++; } while (fundo > 0);
    const maior = seletores(resto.slice(abre + 1, fecha - 1)).map(especificidade).sort(compara).pop();
    for (let n = 0; n < 3; n++) soma[n] += maior[n];
    resto = resto.slice(0, i) + ' ' + resto.slice(fecha);
  }
  soma[1] += (resto.match(/\[[^\]]*\]/g) || []).length;
  resto = resto.replace(/\[[^\]]*\]/g, ' ');
  soma[0] += (resto.match(/#[\w-]+/g) || []).length;
  soma[2] += (resto.match(/::[\w-]+/g) || []).length;
  resto = resto.replace(/::[\w-]+/g, ' ');
  soma[1] += (resto.match(/\.[\w-]+|:[\w-]+/g) || []).length;
  soma[2] += (resto.match(/(?:^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return soma;
}

/* O último pedaço do seletor (o que de fato recebe a regra): depois do último espaço ou combinador de fora dos parênteses. */
function ultimoPedaco(seletor) {
  let fundo = 0, corte = 0;
  for (let i = 0; i < seletor.length; i++) {
    const c = seletor[i];
    if (c === '(' || c === '[') fundo++;
    else if (c === ')' || c === ']') fundo--;
    else if (!fundo && /[\s>+~]/.test(c)) corte = i + 1;
  }
  return seletor.slice(corte);
}
const temClasse = (pedaco, classe) => new RegExp('\\.' + classe + '(?![\\w-])').test(pedaco);

/* Em que níveis de aperto o CSS esconde `classe`: as regras de topo com `display: none` cujo último pedaço é a classe, e os data-aperto="N" do seletor. */
function niveisQueEscondem(css, classe) {
  const niveis = new Set();
  for (const r of regras(css)) {
    if (r.contexto || !/(?:^|[;\s])display:\s*none\b/.test(r.corpo)) continue;
    for (const s of seletores(r.seletor)) {
      if (!temClasse(ultimoPedaco(s), classe)) continue;
      for (const m of s.matchAll(/\[data-aperto="(\d)"\]/g)) niveis.add(Number(m[1]));
    }
  }
  return niveis;
}
const regrasDeAperto = () => regras(CSS_UI).filter((r) => /data-aperto/.test(r.seletor));

/* ---------- o CSS dos cinco níveis ---------- */

// o teto de 72 px do chip vale nos níveis 4 e 5 (leva 5i: o 5 mantém tudo o que o 4 faz)
const SELETOR_DO_TETO = '.ck-app .cmp-bar:is([data-aperto="4"], [data-aperto="5"]) .pm-modelo';
const regraDoTeto = () => regrasDeAperto().find((r) => seletores(r.seletor).includes(SELETOR_DO_TETO));

test('o CSS esconde por nível: 1 = desenhar; 2 = também enviar arquivo; 3 = também os pontinhos do chip; 4 mantém tudo isso; 5 = também o ⚖ e o 👥 (leva 5h, item 4 da rodada 2; leva 5i)', () => {
  const por = (classe) => [...niveisQueEscondem(CSS_UI, classe)].sort();
  assert.deepEqual(por('p-desenhar'), [1, 2, 3, 4, 5], 'desenhar é o 1º a sair e fica fora até o fim');
  assert.deepEqual(por('p-envarq'), [2, 3, 4, 5], 'enviar arquivo sai no 2º');
  assert.deepEqual(por('pm-sep'), [3, 4, 5], 'os pontinhos do chip saem no 3º e o 4º e o 5º não os devolvem');
  assert.deepEqual(por('p-debate'), [5], 'o ⚖ Debater é o ÚLTIMO recurso: só sai no nível 5 (leva 5i)');
  assert.deepEqual(por('p-workflow'), [5], 'o 👥 Workflow também (leva 5i)');
  assert.deepEqual(por('pm-modelo'), [], 'o botão do meio do chip nunca é escondido: nos níveis 4 e 5 só ganha um teto de largura');
  // nenhum outro botão da barra sai por aperto: o +, o microfone, o contexto, o chip, o ✨, o › e o ■/↑ ficam sempre
  const foraDoPlano = regrasDeAperto().flatMap((r) => seletores(r.seletor)).filter((s) => !['p-desenhar', 'p-envarq', 'pm-sep', 'p-debate', 'p-workflow', 'pm-modelo'].some((c) => temClasse(ultimoPedaco(s), c)));
  assert.deepEqual(foraDoPlano, [], 'só os cinco são escondidos (e o do meio do chip ganha o teto dos níveis 4 e 5)');
  assert.equal(niveisQueEscondem(CSS_UI, 'p-plus').size + niveisQueEscondem(CSS_UI, 'p-mic').size + niveisQueEscondem(CSS_UI, 'p-compactar').size, 0);
});

test('as regras do aperto valem em toda largura, no escopo .ck-app .cmp-bar, e só escondem (display: none); a única exceção é o teto dos níveis 4 e 5 (leva 5h, 5i)', () => {
  const regrasDoAperto = regrasDeAperto();
  assert.ok(regrasDoAperto.length >= 1, 'achei as regras do aperto no cockpit-ui.css');
  for (const r of regrasDoAperto) {
    assert.equal(r.contexto, '', 'regra de topo: quem decide é o encaixarBarra, medindo; nenhuma consulta de largura: ' + r.seletor);
    if (seletores(r.seletor).includes(SELETOR_DO_TETO)) continue;   // o teto dos níveis 4 e 5 é provado no teste dele, logo abaixo
    assert.match(r.corpo.trim(), /^display:\s*none;?$/, 'a regra só esconde, sem mexer em tamanho, vão nem ordem: ' + r.corpo.trim());
    for (const s of seletores(r.seletor)) assert.ok(s.startsWith('.ck-app .cmp-bar'), 'o mesmo escopo das outras regras da barra: ' + s);
  }
  for (const s of seletores(regraDoTeto().seletor)) assert.ok(s.startsWith('.ck-app .cmp-bar'), 'o teto dos níveis 4 e 5 também mora no escopo da barra: ' + s);
});

/* O nível 4 soma ao 3 o teto do botão do meio do chip: 72 px, a mesma conta do @container (max-width: 290px), que já limitava a sigla de texto (Gemini,
   Grok, ACP) numa coluna estreita. O .pm-modelo tem max-width de 132 px por padrão (0,3,0) e 72 px no @container (0,3,0); a regra do teto (0,4,0) vence as duas
   sem depender da ordem no arquivo. Leva 5i: o nível 5 mantém o teto (soma ao 4), então a mesma regra vale nos dois: :is([data-aperto="4"], [data-aperto="5"])
   pesa o mesmo (0,4,0) que o [data-aperto="4"] de antes. */
test('os níveis 4 e 5 põem o teto de 72 px no botão do meio do chip (o mesmo do @container de 290 px) e vencem todo max-width que ele recebe (rodada 2, item 4; leva 5i)', () => {
  const r = regraDoTeto();
  assert.ok(r, 'a regra do teto existe');
  assert.equal(r.contexto, '');
  assert.match(r.corpo.trim(), /^max-width:\s*72px;?$/, 'só o teto, sem esconder nada: ' + r.corpo.trim());
  const doContainer = regras(CSS_UI).find((x) => /@container \(max-width: ?290px\)/.test(x.contexto) && /\.pm-modelo\b/.test(x.seletor));
  assert.ok(doContainer, 'a regra do @container de 290 px existe');
  assert.match(doContainer.corpo, /max-width:\s*72px/, 'é o mesmo teto que os níveis 4 e 5 usam');
  const forca = especificidade(SELETOR_DO_TETO);
  assert.deepEqual(forca, [0, 4, 0]);
  assert.deepEqual(especificidade('.ck-app .cmp-bar[data-aperto="4"] .pm-modelo'), forca, 'pesa o mesmo que o seletor de um nível só, de antes da leva 5i');
  assert.ok(SELETOR_DO_TETO.includes('[data-aperto="4"]') && SELETOR_DO_TETO.includes('[data-aperto="5"]'), 'vale nos DOIS níveis: o 5 mantém o teto do 4');
  const pasta = path.join(RAIZ, 'src', 'renderer');
  const concorrentes = [];
  for (const arquivo of fs.readdirSync(pasta).filter((f) => f.endsWith('.css'))) {
    for (const x of regras(lerFonte('renderer', arquivo))) {
      if (!/(?:^|[;\s])max-width:/.test(x.corpo) || x.seletor === SELETOR_DO_TETO) continue;
      for (const s of seletores(x.seletor)) if (temClasse(ultimoPedaco(s), 'pm-modelo')) concorrentes.push({ onde: arquivo + ': ' + (x.contexto ? x.contexto + ' ' : '') + s, forca: especificidade(s) });
    }
  }
  assert.ok(concorrentes.length >= 2, 'a base de 132 px e a do @container de 290 px: ' + concorrentes.map((c) => c.onde));
  for (const c of concorrentes) assert.ok(compara(c.forca, forca) < 0, c.onde + ' (' + c.forca + ') não pode empatar nem passar por cima do teto dos níveis 4 e 5 (' + forca + ')');
});

/* O nível 0 é a barra inteira ('' ou sem o atributo): nenhuma regra pode casar com data-aperto="" nem com a barra sem nível. */
test('o nível 0 não esconde nada: as regras só casam com os valores 1, 2, 3, 4 e 5 (leva 5h, 5i)', () => {
  for (const r of regrasDeAperto()) {
    const valores = [...r.seletor.matchAll(/\[data-aperto([^\]]*)\]/g)].map((m) => m[1]);
    assert.ok(valores.length > 0);
    for (const v of valores) assert.match(v, /^="[12345]"$/, 'só ="1" a ="5": ' + r.seletor);
  }
});

/* A especificidade: o .cb { display: grid } do style.css é o único display que esses botões recebem, e a regra do aperto (0,4,0) passa por cima. Se alguém
   puser um display mais forte nos botões da barra (no visual Mac, por exemplo), o botão escondido voltaria a aparecer: este teste acusa. */
test('a regra do aperto vence todo display que o desenhar, o enviar arquivo, os pontinhos, o ⚖ e o 👥 recebem (leva 5h, 5i)', () => {
  const pasta = path.join(RAIZ, 'src', 'renderer');
  const doAperto = regrasDeAperto().flatMap((r) => seletores(r.seletor)).map(especificidade).sort(compara);
  const maisFraca = doAperto[0];
  assert.deepEqual(maisFraca, [0, 4, 0], 'escopo .ck-app .cmp-bar (2 classes) + [data-aperto] + a classe do botão');
  const daBarra = (s) => ['cb', 'p-envarq', 'p-desenhar', 'pm-sep', 'p-debate', 'p-workflow'].some((c) => temClasse(ultimoPedaco(s), c))
    || (/(^|[\s>+~])(button|span)$|\*$/.test(ultimoPedaco(s)) && /cmp-bar|p-model/.test(s));
  const concorrentes = [];
  for (const arquivo of fs.readdirSync(pasta).filter((f) => f.endsWith('.css'))) {
    for (const r of regras(lerFonte('renderer', arquivo))) {
      if (!/(?:^|[;\s])display:/.test(r.corpo) || /data-aperto/.test(r.seletor)) continue;
      for (const s of seletores(r.seletor)) if (daBarra(s)) concorrentes.push({ onde: arquivo + ': ' + (r.contexto ? r.contexto + ' ' : '') + s, forca: especificidade(s) });
    }
  }
  assert.ok(concorrentes.some((c) => /^style\.css: \.cb$/.test(c.onde)), 'o .cb { display: grid } do style.css é um deles (senão o teste não está olhando o que devia): ' + concorrentes.map((c) => c.onde));
  // leva 5i: o display do ⚖ e do 👥 (visual-mac.css, 0,3,0) e o da base do ⚖ (collaboration.css, 0,1,0) são os que o nível 5 tem de vencer
  assert.ok(concorrentes.some((c) => /^visual-mac\.css: \.ck-app \.cmp-bar :is\(\.p-workflow, \.p-debate\)$/.test(c.onde)), 'o display do ⚖ e do 👥 no visual-mac.css também é um deles: ' + concorrentes.map((c) => c.onde));
  assert.ok(concorrentes.some((c) => /^collaboration\.css: \.p-debate$/.test(c.onde)), 'e o da base do ⚖ no collaboration.css: ' + concorrentes.map((c) => c.onde));
  for (const c of concorrentes) assert.ok(compara(c.forca, maisFraca) < 0, c.onde + ' (' + c.forca + ') não pode empatar nem passar por cima da regra do aperto (' + maisFraca + ')');
});

test('o visual Mac e o style.css não falam do aperto: a regra mora só no cockpit-ui.css, junto da barra (leva 5h)', () => {
  assert.doesNotMatch(CSS_MAC, /data-aperto/);
  assert.doesNotMatch(CSS_BASE, /data-aperto/);
  assert.ok(regrasDeAperto().length > 0, 'e no cockpit-ui.css ela existe');
});

/* Os dois botões escondidos são atalhos de itens do menu do +: o gesto não se perde, só ganha um clique. */
test('o que o aperto esconde continua no menu do +: "Enviar do computador" e "Desenhar" (leva 5h) e, só no nível 5, o ⚖ e o 👥 (leva 5i)', () => {
  assert.match(pegarBloco(APP, 'function menuAnexo(', 'menuAnexo'), /Enviar do computador/);
  const mais = pegarBloco(APP, 'function menuMais(', 'menuMais');
  assert.match(mais, /nome: 'Desenhar'/);
  assert.match(mais, /nome: 'Debater com Codex e Claude'/);
  assert.match(mais, /nome: 'Workflow dos agentes'/);
  assert.match(mais, /barra\.dataset\.aperto === '5'/, 'os dois só entram quando a barra está no nível 5 (o teste de comportamento está em test/barra-debate-workflow.test.js)');
});

/* ---------- o encaixarBarra, com a conta da quebra do flex ---------- */

/* Uma página de mentira com a conta que importa do flex-wrap da linha de baixo: o ORÇAMENTO de largura. Os 5 botões da esquerda têm 28 px, o grupo da
   direita (.cmp-dir) tem `dir` px, o vão entre os itens é de 2 px e a barra tem 6 + 6 de respiro. Cabe na linha se a soma do que está visível mais os vãos
   é, no máximo, a largura útil; senão o .cmp-dir cai e o topo dele desce 28 + 4 px (um botão e o vão entre as linhas). Quem está visível em cada nível
   vem do CSS DE VERDADE (o cockpit-ui.css, lido por niveisQueEscondem): o 1 esconde o desenhar, o 2 também o enviar arquivo, o 3 também os dois pontinhos
   (12 px do .cmp-dir), e (leva 5i) o 5 também o ⚖ e o 👥 (28 + 2 e 32 + 2 px do .cmp-dir). Os números são os da prévia: barra 366, direita 209 (⚖ 28 + 👥 com o
   número 32 + chip 115 + ↑ 28 + 3 vãos de 2), faltam 5 px.
   O dataset da barra anota cada escrita (escritas), para provar a ORDEM em que o encaixarBarra tenta os níveis. O campo de texto (estado.campo) só empurra a
   linha do menu para baixo; escondida zera largura e altura, como um painel fora da tela. */
const ESQUERDA = ['p-plus', 'p-envarq', 'p-desenhar', 'p-mic', 'p-compactar'];
const BOTAO = 28, VAO = 2, RESPIRO = 6, PONTINHOS = 12, QUEDA = BOTAO + 4;
const DEBATE = BOTAO, FLUXO = 32;   // leva 5i: o ⚖ e o 👥 (com o número "3" da prévia), os dois botões que o nível 5 tira do grupo da direita
const ESCONDE = Object.fromEntries(['p-envarq', 'p-desenhar', 'pm-sep', 'p-debate', 'p-workflow'].map((c) => [c, niveisQueEscondem(CSS_UI, c)]));
const escondidosNo = (nivel) => Object.keys(ESCONDE).filter((c) => ESCONDE[c].has(nivel)).sort();
const barraParaFaltar = (px) => 371 - px;   // com a direita em 209: 12 + 148 + 2 + 209 = 371 cabe justo; 366 falta 5
// rodada 2, item 4: o teto de largura do botão do meio do chip nos níveis 4 e 5 (o do CSS de verdade) e a largura de um chip de TEXTO (Gemini: "padrão do Gemini")
const TETO_DO_CHIP = Number(/max-width:\s*(\d+)px/.exec((regras(CSS_UI).find((r) => seletores(r.seletor).includes(SELETOR_DO_TETO)) || { corpo: '' }).corpo)?.[1]);
const CHIP_ICONES = 41, CHIP_TEXTO = 132;
// o grupo da direita com o chip de texto: troca os 41 px do chip de ícones pelos 132 do de texto (o teto da base); com ícones são os 209 de sempre
const DIR_COM_TEXTO = 209 - CHIP_ICONES + CHIP_TEXTO;

/* `chip`: a largura do botão do meio dentro do `dir` (41 de ícones, 132 de texto); nos níveis 4 e 5 ele não passa do teto. `queda(nivel)`: quantas linhas a mais a
   barra tem naquele nível quando o grupo da direita não cabe na linha do menu (1 = ele desce inteiro; 2 = desce e ainda quebra por dentro). */
function pagina({ barra = 366, dir = 209, topo = 40, chip = CHIP_ICONES, queda = () => 1 } = {}) {
  const estado = { barra, dir, chip, escondida: false, campo: BOTAO };
  const escritas = [];
  let aperto;
  const bar = { dataset: { get aperto() { return aperto; }, set aperto(v) { aperto = v; escritas.push(v); } } };
  const nivel = () => Number(aperto) || 0;   // '' e sem o atributo são o nível 0
  const visiveis = () => ESQUERDA.filter((c) => !(ESCONDE[c] && ESCONDE[c].has(nivel()))).length;
  const larguraDir = () => estado.dir - (ESCONDE['pm-sep'].has(nivel()) ? PONTINHOS : 0) - (nivel() >= 4 ? Math.max(0, estado.chip - TETO_DO_CHIP) : 0)
    - (ESCONDE['p-debate'].has(nivel()) ? DEBATE + VAO : 0) - (ESCONDE['p-workflow'].has(nivel()) ? FLUXO + VAO : 0);
  const cabe = () => visiveis() * BOTAO + (visiveis() - 1) * VAO + VAO + larguraDir() <= estado.barra - 2 * RESPIRO;
  const linha2 = () => topo + estado.campo + 4;   // abaixo do campo e do vão entre as linhas (4)
  const dado = (rect) => (estado.escondida ? { ...rect, width: 0, height: 0 } : rect);
  const mais = { getBoundingClientRect: () => dado({ top: linha2(), width: BOTAO, height: BOTAO }) };
  const dirEl = { getBoundingClientRect: () => dado({ top: linha2() + (cabe() ? 0 : QUEDA), width: larguraDir(), height: BOTAO }) };
  bar.getBoundingClientRect = () => dado({ top: topo, width: estado.barra, height: 2 * RESPIRO + estado.campo + 4 + BOTAO + (cabe() ? 0 : queda(nivel()) * QUEDA) });
  bar.querySelector = (sel) => ({ '.cmp-dir': dirEl, '.p-plus': mais })[sel] || null;
  const P = { el: { querySelector: (sel) => (sel === '.cmp-bar' ? bar : null) } };
  return { P, bar, estado, escritas, nivel, cabe, mais, dirEl, linha2 };
}

function contextoEncaixe() {
  const ctx = vm.createContext({ $: (sel, no) => no.querySelector(sel) });
  vm.runInContext(pegarBloco(APP, 'function encaixarBarra(', 'encaixarBarra'), ctx);
  return ctx;
}
/* a conta da prévia, para o teste não depender de a página de mentira estar certa: 148 + 2 + 209 = 359 > 354 (cai); sem o desenhar, 118 + 2 + 209 = 329 (cabe) */
test('a página de mentira reproduz a conta da prévia: 359 contra 354 no nível 0, 329 no nível 1 (leva 5h)', () => {
  const p = pagina();
  assert.equal(p.cabe(), false, 'no nível 0 a direita cai para a 3ª linha');
  assert.equal(p.dirEl.getBoundingClientRect().top - p.mais.getBoundingClientRect().top, QUEDA);
  p.bar.dataset.aperto = '1';
  assert.equal(p.cabe(), true, 'sem o desenhar cabe');
  assert.equal(p.dirEl.getBoundingClientRect().top - p.mais.getBoundingClientRect().top, 0, 'e fica na mesma linha do +');
  assert.equal(pagina({ barra: barraParaFaltar(0) }).cabe(), true, 'cabe justo (sobra 0)');
  assert.equal(pagina({ barra: barraParaFaltar(1) }).cabe(), false, 'falta 1 px e já cai');
});

test('cabe: a barra fica no nível 0 (data-aperto vazio) e nada é escondido (leva 5h)', () => {
  const ctx = contextoEncaixe();
  for (const barra of [barraParaFaltar(0), 400, 560]) {
    const p = pagina({ barra });
    ctx.encaixarBarra(p.P);
    assert.equal(p.bar.dataset.aperto, '', 'barra de ' + barra + ' px');
    assert.deepEqual(p.escritas, [''], 'só a marca do nível 0, sem tentar esconder nada');
    assert.deepEqual(escondidosNo(p.nivel()), []);
    ctx.encaixarBarra(p.P);
    assert.deepEqual(p.escritas, [''], 'de novo, com a barra no mesmo estado: nenhuma escrita (o navegador não recalcula o estilo à toa)');
  }
});

test('falta 5 px (a prévia, 366 px): nível 1, o desenhar some e o enviar arquivo fica (leva 5h)', () => {
  const p = pagina({ barra: 366 });
  contextoEncaixe().encaixarBarra(p.P);
  assert.equal(p.bar.dataset.aperto, '1');
  assert.deepEqual(escondidosNo(p.nivel()), ['p-desenhar'], 'o enviar arquivo e os pontinhos ficam');
  assert.deepEqual(p.escritas, ['', '1'], 'tentou o nível 0 e o 1, e parou no 1');
  assert.equal(p.cabe(), true, 'e o grupo da direita voltou para a linha do menu');
});

test('falta ~35 px: nível 2, o desenhar e o enviar arquivo somem e os pontinhos ficam (leva 5h)', () => {
  const p = pagina({ barra: barraParaFaltar(35) });
  contextoEncaixe().encaixarBarra(p.P);
  assert.equal(p.bar.dataset.aperto, '2');
  assert.deepEqual(escondidosNo(p.nivel()), ['p-desenhar', 'p-envarq']);
  assert.deepEqual(p.escritas, ['', '1', '2'], 'tentou 0, 1 e 2; o nível 3 não foi preciso');
  assert.equal(p.cabe(), true);
});

test('falta ~65 px: nível 3, somem também os pontinhos do chip (leva 5h)', () => {
  const p = pagina({ barra: barraParaFaltar(65) });
  contextoEncaixe().encaixarBarra(p.P);
  assert.equal(p.bar.dataset.aperto, '3');
  assert.deepEqual(escondidosNo(p.nivel()), ['p-desenhar', 'p-envarq', 'pm-sep']);
  assert.deepEqual(p.escritas, ['', '1', '2', '3']);
  assert.equal(p.cabe(), true);
});

/* Leva 5i: o nível 5 esconde também o ⚖ e o 👥 (64 px a mais que o 3: 28 + 2 e 32 + 2). Quem tem 100 px a menos que a barra inteira (271 de barra, 259 úteis contra
   as 287 do nível 3 e as 223 do 5) só cabe sem os cinco. */
test('falta ~100 px: nível 5, somem também o ⚖ e o 👥, e o menu do + passa a mostrá-los (leva 5i)', () => {
  const p = pagina({ barra: barraParaFaltar(100) });
  contextoEncaixe().encaixarBarra(p.P);
  assert.equal(p.bar.dataset.aperto, '5');
  assert.deepEqual(escondidosNo(p.nivel()), ['p-debate', 'p-desenhar', 'p-envarq', 'p-workflow', 'pm-sep'], 'o 5 mantém o que o 3 e o 4 escondem e tira o ⚖ e o 👥');
  assert.deepEqual(p.escritas, ['', '1', '2', '3', '4', '5'], 'tentou os cinco níveis, em ordem, e parou no que coube');
  assert.equal(p.cabe(), true);
});

test('não cabe nem com os cinco níveis (coluna estreitíssima, chip de ícones): volta ao nível 0 e o grupo da direita quebra de linha como antes (leva 5h, 5i)', () => {
  const ctx = contextoEncaixe();
  for (const barra of [barraParaFaltar(137), 200, 120]) {
    const p = pagina({ barra });
    ctx.encaixarBarra(p.P);
    assert.equal(p.bar.dataset.aperto, '', 'barra de ' + barra + ' px');
    assert.deepEqual(p.escritas, ['', '1', '2', '3', '4', '5', ''], 'tentou os cinco níveis, em ordem, e voltou ao 0: com a barra de mesma altura em todos, vale o menor nível');
    assert.deepEqual(escondidosNo(p.nivel()), [], 'a esquerda tem espaço de sobra: nada fica escondido à toa');
  }
});

/* Rodada 2 da leva 5h, item 4. O chip de TEXTO (Gemini, Grok, ACP) tem 132 px de botão do meio (o teto da base): o grupo da direita fica com 300 px em vez
   de 209. Num painel de ~340 px (a barra mede ~330) as contas são: nível 0 = 148 + 2 + 300 = 450; nível 3 = 88 + 2 + 288 = 378 (falta 60); nível 4 = o 3 com o
   chip em 72 px = 88 + 2 + 228 = 318 contra 318 úteis (cabe justo). Antes, o encaixe esgotava o 3 e voltava ao 0, com 2 ou 3 linhas de botões. */
test('chip de texto num painel de ~340 px: o nível 3 não basta e o 4, com o teto de 72 px no chip, cabe numa linha só (rodada 2, item 4)', () => {
  const ctx = contextoEncaixe();
  const p = pagina({ barra: 330, dir: DIR_COM_TEXTO, chip: CHIP_TEXTO });
  ctx.encaixarBarra(p.P);
  assert.equal(p.bar.dataset.aperto, '4');
  assert.deepEqual(p.escritas, ['', '1', '2', '3', '4'], 'tentou os quatro e parou no que coube');
  assert.deepEqual(escondidosNo(p.nivel()), ['p-desenhar', 'p-envarq', 'pm-sep'], 'o 4 mantém o que o 3 esconde');
  assert.equal(p.cabe(), true, 'o grupo da direita voltou para a linha do menu');
  assert.equal(p.bar.getBoundingClientRect().height, 2 * RESPIRO + BOTAO + 4 + BOTAO, 'a caixa tem as 2 linhas de sempre (o campo e o menu)');
  // sem o nível 4 (o código de antes), o mesmo painel ficaria sem caber: faltam 60 px no nível 3
  const sem4 = pagina({ barra: 330, dir: DIR_COM_TEXTO, chip: CHIP_TEXTO });
  sem4.bar.dataset.aperto = '3';
  assert.equal(sem4.cabe(), false, 'o nível 3 sozinho não cabe');
  assert.equal(TETO_DO_CHIP, 72);
});

test('chip de texto: a fronteira do nível 4 é o teto de 72 px; com 1 px a menos o 4 não cabe e o 5 (sem o ⚖ e o 👥) resolve, e abaixo dele nada cabe (rodada 2, item 4; leva 5i)', () => {
  const ctx = contextoEncaixe();
  const cabeJusto = pagina({ barra: 330, dir: DIR_COM_TEXTO, chip: CHIP_TEXTO });
  ctx.encaixarBarra(cabeJusto.P);
  assert.equal(cabeJusto.bar.dataset.aperto, '4', '330 px: 318 de conta + 12 de respiro, justo');
  const falta1 = pagina({ barra: 329, dir: DIR_COM_TEXTO, chip: CHIP_TEXTO });
  ctx.encaixarBarra(falta1.P);
  assert.equal(falta1.bar.dataset.aperto, '5', 'faltou 1 px: o 4 não cabe numa linha, o 5 (menos 64 px: o ⚖ e o 👥) cabe');
  assert.deepEqual(falta1.escritas, ['', '1', '2', '3', '4', '5'], 'tentou todos, em ordem, e parou no 5');
  assert.equal(falta1.cabe(), true);
  // a fronteira do 5 com o chip de texto: 88 + 2 + (300 - 12 - 64 - 60) = 254 de conta + 12 de respiro = 266
  const justo5 = pagina({ barra: 266, dir: DIR_COM_TEXTO, chip: CHIP_TEXTO });
  ctx.encaixarBarra(justo5.P);
  assert.equal(justo5.bar.dataset.aperto, '5', '266 px: cabe justo no 5');
  const nada = pagina({ barra: 265, dir: DIR_COM_TEXTO, chip: CHIP_TEXTO });
  ctx.encaixarBarra(nada.P);
  assert.equal(nada.cabe(), false, 'faltou 1 px: nenhum nível cabe numa linha');
  assert.deepEqual(nada.escritas, ['', '1', '2', '3', '4', '5', ''], 'tentou todos e, com a barra de mesma altura em todos, ficou no 0');
  // chip de ícones (41 px, abaixo do teto): o nível 4 não muda nada (vale o mesmo que o 3) e a conta é a de sempre; quem resolve é o 5
  const icones = pagina({ barra: barraParaFaltar(73) });
  ctx.encaixarBarra(icones.P);
  assert.equal(icones.bar.dataset.aperto, '5', '73 px a menos: o teto de 72 px não toca num chip de 41, então o 4 não ajuda e só o 5 cabe');
  assert.deepEqual(icones.escritas, ['', '1', '2', '3', '4', '5']);
});

/* "Mais baixa" é a altura da barra medida em cada nível: 1 linha a mais quando o grupo da direita desce inteiro, 2 quando desce e ainda quebra por dentro. */
test('nem o nível 5 cabe numa linha: vale o nível que deixa a barra MAIS BAIXA; no empate, o menor (rodada 2, item 4; leva 5i)', () => {
  const ctx = contextoEncaixe();
  const escolhe = (extras, opcoes = {}) => {
    const p = pagina({ barra: 150, queda: (n) => extras[n], ...opcoes });   // 150 px: nem o 5 cabe (223 + 12 de respiro = 235)
    ctx.encaixarBarra(p.P);
    return p;
  };
  // 0..2 quebram por dentro (2 linhas a mais) e 3, 4 e 5 só descem (1): o 3 é o menor dos mais baixos
  let p = escolhe([2, 2, 2, 1, 1, 1]);
  assert.equal(p.bar.dataset.aperto, '3', 'empate entre 3, 4 e 5: fica o 3, que mostra mais coisa (o chip inteiro e o ⚖ e o 👥)');
  assert.deepEqual(p.escritas, ['', '1', '2', '3', '4', '5', '3'], 'tentou os seis e voltou ao melhor');
  // só o 5 ajuda
  p = escolhe([2, 2, 2, 2, 2, 1]);
  assert.equal(p.bar.dataset.aperto, '5');
  assert.deepEqual(p.escritas, ['', '1', '2', '3', '4', '5'], 'o último tentado já era o melhor: nada a desfazer');
  // só o 4 ajuda (o 5 piora de novo): volta ao 4
  p = escolhe([2, 2, 2, 2, 1, 2]);
  assert.equal(p.bar.dataset.aperto, '4');
  assert.deepEqual(p.escritas, ['', '1', '2', '3', '4', '5', '4']);
  // o melhor é um nível do meio
  p = escolhe([3, 3, 2, 2, 2, 2]);
  assert.equal(p.bar.dataset.aperto, '2');
  assert.deepEqual(p.escritas, ['', '1', '2', '3', '4', '5', '2']);
  // o nível 0 já é o mais baixo: fica nele
  p = escolhe([1, 2, 2, 2, 2, 2]);
  assert.equal(p.bar.dataset.aperto, '');
  // todos iguais: o 0 (o que mostra mais)
  p = escolhe([2, 2, 2, 2, 2, 2]);
  assert.equal(p.bar.dataset.aperto, '');
  assert.deepEqual(p.escritas, ['', '1', '2', '3', '4', '5', '']);
  // escolhido o nível 3, o desenhar, o enviar arquivo e os pontinhos estão escondidos e o chip fica do tamanho dele; o ⚖ e o 👥 seguem à vista
  p = escolhe([2, 2, 2, 1, 1, 1]);
  assert.deepEqual(escondidosNo(p.nivel()), ['p-desenhar', 'p-envarq', 'pm-sep']);
});

test('meio pixel de diferença na altura da barra é arredondamento do navegador, não um nível melhor (rodada 2, item 4; leva 5i)', () => {
  const ctx = contextoEncaixe();
  const p = pagina({ barra: 150 });
  const alturas = { '': 200, '1': 199.8, '2': 199.6, '3': 199.9, '4': 200.2, '5': 200.1 };
  p.bar.getBoundingClientRect = () => ({ top: 40, width: 150, height: alturas[p.bar.dataset.aperto] });
  ctx.encaixarBarra(p.P);
  assert.equal(p.bar.dataset.aperto, '', 'todas dentro de meio pixel: empate, fica o 0');
  alturas['2'] = 168;   // 32 px a menos (uma linha de verdade)
  ctx.encaixarBarra(p.P);
  assert.equal(p.bar.dataset.aperto, '2');
});

/* As fronteiras: cada nível libera uma quantia. O 1 tira o desenhar (28 + 2 de vão = 30); o 2 tira o enviar arquivo (mais 30 = 60); o 3 tira os
   dois pontinhos (mais 12 = 72). O 4 não libera nada num chip de ícones (o teto de 72 px só toca a sigla de texto). Leva 5i: o 5 tira o ⚖ (28 + 2) e o 👥
   (32 + 2): mais 64 = 136. Faltando mais que 136, nenhum basta. */
test('as fronteiras: libera 30 px no nível 1, 60 no 2, 72 no 3 e 136 no 5 (leva 5h, 5i)', () => {
  const ctx = contextoEncaixe();
  const casos = [[-40, ''], [0, ''], [1, '1'], [5, '1'], [30, '1'], [31, '2'], [35, '2'], [60, '2'], [61, '3'], [65, '3'], [72, '3'], [73, '5'], [80, '5'], [100, '5'], [136, '5'], [137, ''], [200, '']];
  for (const [falta, esperado] of casos) {
    const p = pagina({ barra: barraParaFaltar(falta) });
    ctx.encaixarBarra(p.P);
    assert.equal(p.bar.dataset.aperto, esperado, 'faltando ' + falta + ' px');
  }
});

test('o encaixe não depende da altura do campo: o + e o grupo da direita descem juntos (leva 5h)', () => {
  const ctx = contextoEncaixe();
  for (const topo of [40, 100, 230]) {
    const p = pagina({ barra: barraParaFaltar(35), topo });
    ctx.encaixarBarra(p.P);
    assert.equal(p.bar.dataset.aperto, '2', 'campo com a linha 2 em ' + topo + ' px');
  }
});

test('o grupo da direita encolhe de novo (um botão sai dele) ou a coluna alarga: volta ao nível 0, o nível não gruda (leva 5h, 5i)', () => {
  const ctx = contextoEncaixe();
  const p = pagina({ barra: 366, dir: 209 });
  ctx.encaixarBarra(p.P);
  assert.equal(p.bar.dataset.aperto, '1');
  p.estado.dir = 209 - 32 - VAO;   // um botão de 32 px e o vão dele saíram do grupo (o Continuar, a Sugestão...)
  ctx.encaixarBarra(p.P);
  assert.equal(p.bar.dataset.aperto, '', 'sem ele cabe inteiro');
  assert.equal(p.cabe(), true);
  // outra volta: aperta de novo e a coluna alarga
  p.estado.dir = 209;
  ctx.encaixarBarra(p.P);
  assert.equal(p.bar.dataset.aperto, '1');
  p.estado.barra = 420;
  ctx.encaixarBarra(p.P);
  assert.equal(p.bar.dataset.aperto, '');
  // e um nível alto que sobrou de antes cai sozinho
  p.bar.dataset.aperto = '3';
  ctx.encaixarBarra(p.P);
  assert.equal(p.bar.dataset.aperto, '', 'recomeça do 0 a cada chamada');
});

test('barra sem largura (painel escondido, no fundo ou fora da tela): não faz nada e deixa para quando ela ganhar largura (leva 5h)', () => {
  const ctx = contextoEncaixe();
  const p = pagina({ barra: 366 });
  p.estado.escondida = true;
  ctx.encaixarBarra(p.P);
  assert.equal(p.bar.dataset.aperto, undefined, 'nem o atributo ela ganha');
  assert.deepEqual(p.escritas, []);
  // com o painel à vista a barra se encaixa; escondido de novo (e até estreito), o nível que já estava marcado fica como está
  p.estado.escondida = false;
  ctx.encaixarBarra(p.P);
  assert.equal(p.bar.dataset.aperto, '1');
  const antes = [...p.escritas];
  p.estado.escondida = true;
  p.estado.barra = 120;
  ctx.encaixarBarra(p.P);
  assert.equal(p.bar.dataset.aperto, '1');
  assert.deepEqual(p.escritas, antes, 'nada reescrito');
  // ao ganhar largura outra vez (agora estreita demais para qualquer nível), o encaixe acontece
  p.estado.escondida = false;
  ctx.encaixarBarra(p.P);
  assert.equal(p.bar.dataset.aperto, '');
});

/* A tolerância de ~4 px: o botão apertado (.cmp-bar button:active) encolhe um pouco e o navegador arredonda; só a queda de uma linha inteira (28 + 4) conta. */
test('o .cmp-dir só "caiu" se o topo dele passa mais de 4 px do topo do +: 3,5 px de folga é a mesma linha (leva 5h)', () => {
  const ctx = contextoEncaixe();
  const perto = pagina({ barra: 200 });
  perto.dirEl.getBoundingClientRect = () => ({ top: perto.linha2() + 3.5, width: 209, height: BOTAO });
  ctx.encaixarBarra(perto.P);
  assert.deepEqual(perto.escritas, [''], 'a mesma linha: nada é escondido');
  const longe = pagina({ barra: 200 });
  longe.dirEl.getBoundingClientRect = () => ({ top: longe.linha2() + 4.5, width: 209, height: BOTAO });
  ctx.encaixarBarra(longe.P);
  assert.deepEqual(longe.escritas, ['', '1', '2', '3', '4', '5', ''], '4,5 px já é outra linha: tenta os cinco níveis');
});

test('painel de molde antigo ou ainda sem a barra (sem .cmp-bar, .cmp-dir ou +) não quebra nem escreve nada (leva 5h)', () => {
  const ctx = contextoEncaixe();
  assert.doesNotThrow(() => { ctx.encaixarBarra(null); ctx.encaixarBarra({}); ctx.encaixarBarra({ el: { querySelector: () => null } }); });
  for (const faltando of ['.cmp-dir', '.p-plus']) {
    const p = pagina();
    const original = p.bar.querySelector;
    p.bar.querySelector = (sel) => (sel === faltando ? null : original(sel));
    assert.doesNotThrow(() => ctx.encaixarBarra(p.P), 'sem ' + faltando);
    assert.deepEqual(p.escritas, [], 'sem ' + faltando + ' não há o que medir');
  }
});

/* ---------- quem chama o encaixarBarra: os observadores, num navegador de mentira ---------- */

/* Um navegador de mentira com o que importa aqui da ordem de um quadro: 1) rodam os requestAnimationFrame que já estavam na fila; 2) o layout (as medidas
   são lidas na hora, da página de mentira); 3) cada ResizeObserver avisa UMA vez, dos alvos cujo tamanho mudou desde o último aviso (a especificação nasce com
   0 × 0 avisado: alvo sem tamanho não avisa). O que um callback agendar só roda no quadro seguinte, como no navegador de verdade. */
function navegador() {
  const observadores = [], fila = new Map();
  let seq = 0;
  class ROFalso {
    constructor(fn) { this.fn = fn; this.alvos = new Map(); this.desligado = false; observadores.push(this); }
    observe(alvo) { this.alvos.set(alvo, { w: 0, h: 0 }); }
    disconnect() { this.desligado = true; this.alvos.clear(); }
  }
  const quadro = () => {
    const rodar = [...fila.values()];
    fila.clear();
    for (const fn of rodar) fn(0);
    for (const o of observadores) {
      const mudou = [];
      for (const [alvo, avisado] of o.alvos) {
        const r = alvo.getBoundingClientRect();
        if (r.width !== avisado.w || r.height !== avisado.h) { o.alvos.set(alvo, { w: r.width, h: r.height }); mudou.push({ target: alvo }); }
      }
      if (mudou.length) o.fn(mudou, o);
    }
  };
  return {
    ROFalso, observadores, quadro,
    requestAnimationFrame: (fn) => { fila.set(++seq, fn); return seq; },
    cancelAnimationFrame: (id) => { fila.delete(id); },
    pendentes: () => fila.size,
    quadros: (n) => { for (let i = 0; i < n; i++) quadro(); },
  };
}

/* o ligarEncaixeDaBarra de verdade, com o encaixarBarra de verdade por baixo; `passadas` conta quantas vezes o encaixe rodou, sem mudar o que ele faz */
function contextoObservador(nav, extra = {}) {
  const ctx = vm.createContext({
    $: (sel, no) => no.querySelector(sel), ResizeObserver: nav.ROFalso,
    requestAnimationFrame: nav.requestAnimationFrame, cancelAnimationFrame: nav.cancelAnimationFrame, ...extra,
  });
  vm.runInContext(['function encaixarBarra(', 'function ligarEncaixeDaBarra('].map((a) => pegarBloco(APP, a, a)).join('\n'), ctx);
  const verdadeiro = ctx.encaixarBarra;
  ctx.passadas = 0;
  ctx.encaixarBarra = (P) => { ctx.passadas++; return verdadeiro(P); };
  return ctx;
}
function ligado(opcoes) {
  const nav = navegador(), p = pagina(opcoes), ctx = contextoObservador(nav);
  const desligar = ctx.ligarEncaixeDaBarra(p.P);
  return { nav, p, ctx, desligar };
}

test('liga UM observador, que vigia a barra e o grupo da direita (.cmp-dir) (leva 5h)', () => {
  const { nav, p } = ligado();
  assert.equal(nav.observadores.length, 1);
  assert.deepEqual([...nav.observadores[0].alvos.keys()], [p.bar, p.dirEl]);
});

test('a prévia (366 px, falta 5): o painel aparece, o encaixe roda UMA vez no quadro seguinte e fica no nível 1; nada mais é agendado (leva 5h)', () => {
  const { nav, p, ctx } = ligado({ barra: 366, dir: 209 });
  assert.equal(ctx.passadas, 0, 'ligar não mede: a barra ainda não tinha largura');
  nav.quadro();   // o painel ganha largura: o observador acorda
  assert.equal(ctx.passadas, 0, 'e só agenda: o ajuste roda FORA do observador (mexer no layout lá dentro deixa um resize sem entrega)');
  assert.equal(nav.pendentes(), 1);
  nav.quadro();   // o quadro seguinte roda o encaixe
  assert.equal(ctx.passadas, 1);
  assert.equal(p.bar.dataset.aperto, '1');
  assert.equal(nav.pendentes(), 0, 'a altura da barra mudou (3 linhas viraram 2), mas só a LARGURA acorda o encaixe');
  nav.quadros(50);
  assert.equal(ctx.passadas, 1, 'sem laço');
});

test('o nível 3 estreita o .cmp-dir (os pontinhos): o observador acorda UMA vez de volta, o encaixe chega ao mesmo nível e o ciclo para (leva 5h)', () => {
  const { nav, p, ctx } = ligado({ barra: barraParaFaltar(65) });
  nav.quadros(2);
  assert.equal(p.bar.dataset.aperto, '3');
  assert.equal(ctx.passadas, 1);
  assert.equal(nav.pendentes(), 1, 'o .cmp-dir encolheu 12 px: uma passada de conferência está agendada');
  nav.quadro();
  assert.equal(ctx.passadas, 2);
  assert.equal(p.bar.dataset.aperto, '3', 'recomeçou do 0 e chegou ao mesmo nível');
  assert.equal(nav.pendentes(), 0, 'o tamanho final é o último avisado: nada mais acorda');
  nav.quadros(50);
  assert.equal(ctx.passadas, 2, 'sem laço: duas passadas, para sempre');
  assert.equal(p.bar.dataset.aperto, '3');
});

test('nem com os cinco níveis cabe: o encaixe desfaz tudo, o tamanho volta ao do início e não há passada de conferência (leva 5h, 5i)', () => {
  const { nav, p, ctx } = ligado({ barra: barraParaFaltar(137) });
  nav.quadros(60);
  assert.equal(ctx.passadas, 1);
  assert.equal(p.bar.dataset.aperto, '');
  assert.deepEqual(p.escritas, ['', '1', '2', '3', '4', '5', '']);
});

test('o nível 5 estreita o .cmp-dir (o ⚖ e o 👥 saem): o observador acorda UMA vez de volta, o encaixe chega ao mesmo nível e o ciclo para (leva 5i)', () => {
  const { nav, p, ctx } = ligado({ barra: barraParaFaltar(100) });
  nav.quadros(2);
  assert.equal(p.bar.dataset.aperto, '5');
  assert.equal(ctx.passadas, 1);
  assert.equal(nav.pendentes(), 1, 'o .cmp-dir encolheu 64 px (o ⚖ e o 👥) mais os pontinhos: uma passada de conferência está agendada');
  nav.quadro();
  assert.equal(ctx.passadas, 2);
  assert.equal(p.bar.dataset.aperto, '5', 'recomeçou do 0 e chegou ao mesmo nível');
  assert.equal(nav.pendentes(), 0, 'o tamanho final é o último avisado: nada mais acorda');
  nav.quadros(50);
  assert.equal(ctx.passadas, 2, 'sem laço: duas passadas, para sempre');
  assert.equal(p.bar.dataset.aperto, '5');
});

test('chip de texto: o nível 4 estreita o chip, o observador acorda UMA vez de volta, o encaixe chega ao mesmo nível e o ciclo para (rodada 2, item 4)', () => {
  const { nav, p, ctx } = ligado({ barra: 330, dir: DIR_COM_TEXTO, chip: CHIP_TEXTO });
  nav.quadros(2);
  assert.equal(p.bar.dataset.aperto, '4');
  assert.equal(ctx.passadas, 1);
  assert.equal(nav.pendentes(), 1, 'o .cmp-dir encolheu (os pontinhos e o chip): uma passada de conferência está agendada');
  nav.quadro();
  assert.equal(ctx.passadas, 2);
  assert.equal(p.bar.dataset.aperto, '4', 'recomeçou do 0 e chegou ao mesmo nível');
  assert.equal(nav.pendentes(), 0);
  nav.quadros(50);
  assert.equal(ctx.passadas, 2, 'sem laço: duas passadas, para sempre');
});

test('uma rajada de avisos vira um quadro só e uma passada só (leva 5h)', () => {
  const { nav, p, ctx } = ligado({ barra: 366 });
  nav.quadros(3);   // estabiliza no nível 1
  const antes = ctx.passadas;
  const observador = nav.observadores[0];
  p.estado.barra = 380; observador.fn();
  p.estado.barra = 395; observador.fn();
  p.estado.dir = 255; observador.fn();
  p.estado.barra = 410; observador.fn();
  assert.equal(nav.pendentes(), 1, 'quatro avisos, um quadro agendado');
  nav.quadros(5);
  assert.equal(ctx.passadas - antes, 1, 'e uma passada, com o estado do fim da rajada');
  assert.equal(p.bar.dataset.aperto, '1', 'barra de 410 e direita de 255: 12 + 148 + 2 + 255 = 417 contra 410, faltam 7 e o desenhar sai');
});

test('só a largura acorda o encaixe: o campo crescendo uma linha (a altura da barra) não agenda nada (leva 5h)', () => {
  const { nav, p, ctx } = ligado({ barra: 366 });
  nav.quadros(3);
  const antes = ctx.passadas;
  p.estado.campo = BOTAO + 3 * 20;   // o texto passou de 1 para 4 linhas
  nav.quadro();
  assert.equal(nav.pendentes(), 0);
  p.estado.campo = BOTAO;
  nav.quadros(3);
  assert.equal(ctx.passadas, antes);
  assert.equal(p.bar.dataset.aperto, '1');
});

test('a coluna e o grupo da direita mudam (agentes ativos, sugestão e Continuar entram e saem): o nível sobe e desce sozinho (leva 5h, 5i)', () => {
  const { nav, p } = ligado({ barra: 420, dir: 205 });   // 205: ⚖ 28 + 👥 sem número 28 + chip 115 + ↑ 28 + 3 vãos de 2
  nav.quadros(3);
  assert.equal(p.bar.dataset.aperto, '', '12 + 148 + 2 + 205 = 367 contra 420: cabe de sobra');
  p.estado.dir = 209;   // o 👥 ganhou o número de agentes ativos (28 para 32 px)
  nav.quadros(4);
  assert.equal(p.bar.dataset.aperto, '', '371 contra 420: ainda cabe');
  p.estado.dir = 269;   // e entraram a sugestão e o Continuar (28 px e um vão cada um)
  nav.quadros(4);
  assert.equal(p.bar.dataset.aperto, '1', '431 contra 420: faltam 11 e o desenhar sai');
  p.estado.dir = 205;   // saiu tudo
  nav.quadros(4);
  assert.equal(p.bar.dataset.aperto, '', 'o nível desce sozinho e a barra volta inteira');
  p.estado.dir = 209; p.estado.barra = 300;   // e a coluna estreita
  nav.quadros(5);
  assert.equal(p.bar.dataset.aperto, '3', '300 px: 12 + 88 + 2 + 197 = 299 só cabe sem os dois botões e sem os pontinhos');
  nav.quadros(20);
  assert.equal(p.bar.dataset.aperto, '3');
  p.estado.barra = 260;   // e a coluna estreita mais ainda: 248 úteis, o 3 pede 287 e o 5 (sem o ⚖ e o 👥) pede 223
  nav.quadros(5);
  assert.equal(p.bar.dataset.aperto, '5', 'o ⚖ e o 👥 saem da barra (e o menu do + os mostra)');
  nav.quadros(20);
  assert.equal(p.bar.dataset.aperto, '5');
  p.estado.barra = 420;   // alarga de novo: tudo volta
  nav.quadros(5);
  assert.equal(p.bar.dataset.aperto, '', 'o ⚖ e o 👥 voltam à barra sozinhos');
});

test('painel escondido ou no fundo (sem largura): nada é agendado nem escrito; ao ganhar largura a barra se encaixa (leva 5h)', () => {
  const { nav, p, ctx } = ligado({ barra: 366 });
  p.estado.escondida = true;
  nav.quadros(10);
  assert.equal(ctx.passadas, 0);
  assert.deepEqual(p.escritas, []);
  p.estado.escondida = false;
  nav.quadros(3);
  assert.equal(p.bar.dataset.aperto, '1', 'ganhou largura: encaixou');
  p.estado.escondida = true;
  nav.quadros(5);
  assert.equal(p.bar.dataset.aperto, '1', 'escondido de novo: o nível fica como estava');
  p.estado.escondida = false;
  nav.quadros(5);
  assert.equal(p.bar.dataset.aperto, '1');
});

test('desligar: o observador sai, o quadro agendado é cancelado e nada mais roda (pode desligar duas vezes) (leva 5h)', () => {
  const { nav, p, ctx, desligar } = ligado({ barra: 366 });
  nav.quadro();   // o observador acordou e agendou
  assert.equal(nav.pendentes(), 1);
  desligar();
  assert.equal(nav.observadores[0].desligado, true);
  assert.equal(nav.pendentes(), 0, 'o quadro agendado foi cancelado');
  nav.quadros(5);
  assert.equal(ctx.passadas, 0);
  assert.equal(p.bar.dataset.aperto, undefined);
  assert.doesNotThrow(() => desligar());
});

test('sem ResizeObserver, sem barra ou sem o grupo da direita: não liga nada e devolve um desligar que não faz nada (leva 5h)', () => {
  const nav = navegador();
  const semRO = contextoObservador(nav, { ResizeObserver: undefined });
  assert.equal(typeof semRO.ligarEncaixeDaBarra(pagina().P), 'function');
  assert.doesNotThrow(() => semRO.ligarEncaixeDaBarra(pagina().P)());
  const ctx = contextoObservador(nav);
  for (const molde of [null, {}, { el: { querySelector: () => null } }]) {
    const desligar = ctx.ligarEncaixeDaBarra(molde);
    assert.equal(typeof desligar, 'function');
    assert.doesNotThrow(() => desligar());
  }
  const semDir = pagina();
  const original = semDir.bar.querySelector;
  semDir.bar.querySelector = (sel) => (sel === '.cmp-dir' ? null : original(sel));
  assert.doesNotThrow(() => ctx.ligarEncaixeDaBarra(semDir.P)());
  assert.equal(nav.observadores.length, 0, 'nenhum observador criado');
});

/* ---------- o newPane liga e desliga ---------- */

/* O encaixe e o desligar moram FORA das duas fatias do newPane que outros testes recortam e rodam sozinhas (titulo-auto: do grow ao timerRascunho;
   multiagentes-performance: do grow ao keydown): o que o newPane faz aqui é guardar o desligar no painel, e o _limparCampo (que o closePane e a exclusão de
   aba já chamam) usa com ?. para não depender de a ligação ter acontecido. */
test('o newPane liga o encaixe depois de pintar o chip e o anel e guarda o desligar no painel; as funções moram fora do newPane (leva 5h)', () => {
  assert.match(NEWPANE, /P\._desligarEncaixe = ligarEncaixeDaBarra\(P\);/);
  assert.ok(NEWPANE.indexOf('pintarAnel(P)') > 0 && NEWPANE.indexOf('pintarAnel(P)') < NEWPANE.indexOf('ligarEncaixeDaBarra(P)'), 'depois de o chip e o anel estarem pintados');
  assert.ok(NEWPANE.indexOf('fillModels(P)') < NEWPANE.indexOf('ligarEncaixeDaBarra(P)'));
  assert.doesNotMatch(NEWPANE, /function (encaixarBarra|ligarEncaixeDaBarra)\(/);
  assert.match(APP, /\nfunction encaixarBarra\(P\) \{/);
  assert.match(APP, /\nfunction ligarEncaixeDaBarra\(P\) \{/);
  // o andaime dos testes que rodam o newPane inteiro numa bancada (auditoria1) tem o encaixe de mentira
  assert.equal(typeof globaisFalsos().ligarEncaixeDaBarra(), 'function', 'o stub devolve o desligar, como o de verdade');
});

test('o _limparCampo do painel desliga o encaixe junto com o campo e esquece o desligar; chamado de novo, não quebra (leva 5h)', () => {
  const linha = /P\._limparCampo = (\(\) => \{[^\n]*\});/.exec(NEWPANE);
  assert.ok(linha, 'achei o _limparCampo no newPane');
  const eventos = [];
  const P = { _desligarEncaixe: () => eventos.push('encaixe') };
  const ctx = vm.createContext({ P, limparObservadorCampo: () => eventos.push('campo'), clearTimeout: () => eventos.push('timer'), timerRascunho: 7 });
  vm.runInContext('P._limparCampo = ' + linha[1] + ';', ctx);
  P._limparCampo();
  assert.deepEqual(eventos, ['campo', 'encaixe', 'timer']);
  assert.equal(P._desligarEncaixe, null);
  assert.doesNotThrow(() => P._limparCampo(), 'o painel fecha por mais de um caminho');
  assert.deepEqual(eventos, ['campo', 'encaixe', 'timer', 'campo', 'timer'], 'sem o desligar, só o resto');
  // painel sem encaixe nenhum (o campo foi ligado, o encaixe não): o ?. cobre
  const nu = {};
  const ctx2 = vm.createContext({ P: nu, limparObservadorCampo: () => {}, clearTimeout: () => {}, timerRascunho: 0 });
  vm.runInContext('P._limparCampo = ' + linha[1] + ';', ctx2);
  assert.doesNotThrow(() => nu._limparCampo());
});
