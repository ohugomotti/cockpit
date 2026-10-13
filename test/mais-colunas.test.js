'use strict';
/* Leva 5, T8 (UI 6.3): a quinta coluna ficava cortada na borda sem sinal de que havia mais. Medida: sinal com coluna cortada
   à direita (antes nenhum; depois degradê + botão com o nome da próxima, que rola até ela). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ler, hex, contraste, temas } = require('../testes/contraste');
const ui = fs.readFileSync(path.join(__dirname, '../src/renderer/cockpit-ui.js'), 'utf8');
const extract = (name) => { const i = ui.indexOf('  function ' + name + '('); assert.ok(i >= 0, 'falta ' + name); return ui.slice(i, ui.indexOf('\n  }', i) + 4); };

// campo (opcional): o .p-input da coluna; ordem (opcional): onde rolar e focar anotam, para conferir quem vem primeiro
function coluna(nome, direita, campo, ordem) {
  return { classList: { contains: (c) => c === 'coluna' }, getBoundingClientRect: () => ({ right: direita }), rolagens: [],
    querySelector: (s) => (s === '.ck-pane-title' && nome ? { textContent: nome } : s === '.p-input' && campo ? campo : null),
    scrollIntoView(o) { this.rolagens.push(JSON.stringify(o)); if (ordem) ordem.push('rola'); } };
}
function cenario(filhos, borda) {
  const caixa = { children: filhos, offsetTop: 40, getBoundingClientRect: () => ({ right: borda }) };
  const work = { dataset: {}, style: { setProperty(k, v) { this[k] = v; } } };
  const botao = { hidden: true, textContent: '', title: '', onclick: null };
  const ctx = vm.createContext({});
  vm.runInContext(extract('sinalDeMaisColunas'), ctx);
  return { volta: ctx.sinalDeMaisColunas(caixa, work, botao), work, botao };
}

test('coluna cortada à direita: degradê ligado e botão com o nome da próxima, que rola até ela (UI 6.3)', () => {
  const cols = [coluna('Um', 400), coluna('Dois', 800), coluna('Três', 1200), coluna('Quatro', 1600)];
  const { work, botao, volta } = cenario(cols, 1400);
  assert.equal(volta, cols[3]);
  assert.equal(work.dataset.maisDireita, '1');
  assert.equal(work.style['--ck-mais-topo'], '40px');
  assert.equal(botao.hidden, false);
  assert.equal(botao.textContent, 'Quatro ›');
  assert.equal(botao.title, 'Ir para Quatro');
  // o button() grava aria-label="Ir para a próxima coluna" na criação: sem acompanhar o texto, o leitor de tela e o
  // comando de voz ("clicar Quatro") não acham o botão pelo nome que aparece (o repo mantém title e aria-label iguais)
  assert.equal(botao.ariaLabel, 'Ir para Quatro');
  botao.onclick();
  assert.deepEqual(cols[3].rolagens, [JSON.stringify({ behavior: 'smooth', block: 'nearest', inline: 'end' })]);
});

/* Onda 3, correção 1: ao chegar na última coluna o botão some (hidden) e o foco, que estava nele, caía no body: o teclado
   perdia o lugar. Medida: elemento focado depois do clique (antes o body; depois o campo da coluna de destino). */
test('o clique rola até a coluna e depois põe o foco no campo dela, sem rolar de novo (UI 6.3, revisão da onda 3)', () => {
  const ordem = [], focos = [];
  const campo = { focus: (o) => { focos.push(JSON.stringify(o)); ordem.push('foco'); } };
  const cols = [coluna('Um', 400), coluna('Dois', 1600, campo, ordem)];
  const { botao } = cenario(cols, 1400);
  botao.onclick();
  assert.deepEqual(ordem, ['rola', 'foco'], 'primeiro a rolagem, depois o foco');
  // preventScroll: a rolagem suave acabou de começar e um focus() comum a cancelaria
  assert.deepEqual(focos, [JSON.stringify({ preventScroll: true })]);
});

test('coluna sem campo (ainda sem painel montado): o clique só rola, sem erro (UI 6.3, revisão da onda 3)', () => {
  const cols = [coluna('Um', 400), coluna('Dois', 1600)];
  const { botao } = cenario(cols, 1400);
  assert.doesNotThrow(() => botao.onclick());
  assert.equal(cols[1].rolagens.length, 1);
});

test('tudo cabe, ou rolou até o fim: sem sinal (UI 6.3)', () => {
  const { work, botao, volta } = cenario([coluna('Um', 400), coluna('Dois', 800)], 1400);
  assert.equal(volta, null);
  assert.equal(work.dataset.maisDireita, undefined);
  assert.equal(botao.hidden, true);
});

test('coluna sem título vira "Mais colunas", e o divisor entre colunas não conta (UI 6.3)', () => {
  const divisor = { classList: { contains: () => false }, getBoundingClientRect: () => ({ right: 1500 }) };
  const { botao } = cenario([coluna('Um', 400), divisor, coluna('', 1700)], 1400);
  assert.equal(botao.textContent, 'Mais colunas ›');
});

/* Onda 3, item 7 (opcional): a medida roda a cada quadro do scroll e refazia o texto do botão (um nó de texto novo por quadro)
   mesmo sem o nome mudar. Medida: escritas no botão em 3 quadros seguidos (antes 9; depois 3, só na primeira vez). O clique,
   porém, é refeito sempre: a tela remonta as colunas (elementos novos, mesmo nome) e um clique velho rolaria a coluna morta. */
test('sem o nome mudar o botão não é reescrito a cada quadro, mas o clique sempre vai para a coluna de agora (UI 6.3, revisão da onda 3)', () => {
  const ctx = vm.createContext({});
  vm.runInContext(extract('sinalDeMaisColunas'), ctx);
  const escritas = [];
  const botao = { hidden: true, onclick: null };
  for (const k of ['textContent', 'title', 'ariaLabel']) {
    let v = '';
    Object.defineProperty(botao, k, { get: () => v, set: (x) => { v = x; escritas.push(k); } });
  }
  const work = { dataset: {}, style: { setProperty() {} } };
  const rodar = (filhos) => ctx.sinalDeMaisColunas({ children: filhos, offsetTop: 0, getBoundingClientRect: () => ({ right: 1400 }) }, work, botao);
  const antigas = [coluna('Um', 400), coluna('Dois', 1600)];
  rodar(antigas);
  assert.deepEqual(escritas, ['textContent', 'title', 'ariaLabel'], 'na primeira vez escreve o nome');
  rodar(antigas); rodar(antigas);
  assert.equal(escritas.length, 3, 'os quadros seguintes do scroll não refazem o botão');
  const novas = [coluna('Um', 400), coluna('Dois', 1600)];   // a tela remontou: elementos novos, mesmo nome
  rodar(novas);
  assert.equal(escritas.length, 3);
  botao.onclick();
  assert.deepEqual([antigas[1].rolagens.length, novas[1].rolagens.length], [0, 1], 'o clique rola a coluna de agora');
  rodar([coluna('Um', 400), coluna('Dois, com título novo', 1600)]);   // o nome mudou (ex.: título automático)
  assert.deepEqual(escritas.slice(3), ['textContent', 'title', 'ariaLabel']);
  assert.deepEqual([botao.textContent, botao.title, botao.ariaLabel], ['Dois, com título novo ›', 'Ir para Dois, com título novo', 'Ir para Dois, com título novo']);
});

test('a ligação mede no scroll, no tamanho e quando as colunas mudam, uma vez por quadro (UI 6.3)', () => {
  const i = ui.indexOf('work.append(panesBox);');
  const trecho = ui.slice(i, i + 1400);
  assert.match(trecho, /panesBox\.addEventListener\("scroll", medir, \{ passive: true \}\)/);
  assert.match(trecho, /new ResizeObserver\(medir\)\.observe\(panesBox\)/);
  assert.match(trecho, /new MutationObserver\(medir\)\.observe\(panesBox, \{ childList: true \}\)/);
  assert.match(trecho, /requestAnimationFrame/);
});

/* Onda 3, correção 2: no visual Mac o cartão da coluna é --raised e o #panes tem uma folga de 8 px embaixo (padding: 0 8px 8px 0),
   onde aparece o vidro da janela. O degradê do sinal acabava em --canvas e descia até o fim: uma faixa opaca tampava a folga.
   Medida (estrutural): onde o degradê termina e quanto ele desce (antes --canvas e 0 px de folga; depois --raised e 8 px). */
const CSS = ler('cockpit-ui.css'), MAC = ler('visual-mac.css');
const regra = (css, sel) => { const i = css.indexOf('\n' + sel + ' {'); assert.ok(i >= 0, 'falta a regra ' + sel); return css.slice(i, css.indexOf('}', i)); };

test('visual Mac: o degradê do sinal acaba na cor do cartão e para na folga de baixo do #panes (UI 6.3, revisão da onda 3)', () => {
  const base = '.ck-app .ck-work[data-mais-direita]::after';
  assert.ok(CSS.includes('\n' + base + ' {'), 'o seletor do sinal de base (cockpit-ui.css) mudou');
  // "html.visual-mac " na frente: pesa mais que a regra de base, que acaba ganhando em qualquer ordem de carga dos arquivos
  const sinal = regra(MAC, 'html.visual-mac ' + base);
  assert.match(sinal, /background: linear-gradient\(to right, transparent, var\(--raised\)\);/);
  // os 8 px são o padding de baixo do #panes (topo direita baixo esquerda), e a cor é a do cartão
  const folga = /padding: 0 (\d+)px (\d+)px 0;/.exec(regra(MAC, 'html.visual-mac .ck-app #panes'));
  assert.ok(folga, 'o padding do #panes mudou de forma');
  assert.match(sinal, new RegExp('bottom: ' + folga[2] + 'px;'), 'o degradê precisa parar na folga de baixo do #panes');
  assert.match(regra(MAC, 'html.visual-mac .ck-app .pane'), /background: var\(--raised\);/);
});

/* Onda 3, correção 3: a regra de base do botão (.ck-app .ck-mais-colunas, 2 classes) empatava com .ck-button:hover (1 classe +
   1 pseudo-classe) e vem depois: o fundo nunca mudava ao passar o mouse. Medida: fundo no hover (antes igual ao de repouso). */
test('o botão de mais colunas muda de fundo no hover, com regra mais pesada que a que o empatava, e o --high existe nos 6 jeitos de pintar (UI 6.3, revisão da onda 3)', () => {
  const hover = /\n(\.ck-app \.ck-mais-colunas:hover) \{ background: var\(--high\); \}/.exec(CSS);
  assert.ok(hover, 'falta o hover do botão');
  const pesoDe = (s) => (s.match(/[.:]/g) || []).length;   // classes + pseudo-classes (nenhum dos seletores tem id)
  for (const rival of ['.ck-button:hover', '.ck-app .ck-mais-colunas'])
    assert.ok(pesoDe(hover[1]) > pesoDe(rival), 'tem de pesar mais que ' + rival + ', senão o empate vai para quem vem depois');
  // var() sem valor invalida a propriedade: o --high precisa existir em todo tema, e o texto do botão (--ink) ler sobre ele
  for (const [tema, bloco] of Object.entries(temas())) {
    assert.ok(hex(bloco, '--high'), tema + ': falta --high');
    const r = contraste(hex(bloco, '--ink'), hex(bloco, '--high'));
    assert.ok(r >= 4.5, tema + ': texto sobre o fundo do hover = ' + r.toFixed(2) + ':1');
  }
});
