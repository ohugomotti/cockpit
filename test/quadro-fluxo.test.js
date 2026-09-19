'use strict';
/* Leva 41 (B5): quadro de fluxo.

   O desenho tem que virar algo que a IA ENTENDE: fluxoEmTexto(cena) transforma
   caixas, losangos e setas num passo a passo em markdown. As cenas aqui estao no
   formato que o Excalidraw 0.18 grava (texto dentro da caixa = elemento text com
   containerId; seta grudada = startBinding/endBinding; pontos relativos a x/y).

   Tambem: o bloco ```excalidraw de uma mensagem (validacao antes de desenhar) e
   a regex do linkarArquivos, que cortava ".excalidraw" em ".excali". */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { fluxoEmTexto, lerBlocoExcalidraw } = require('../src/renderer/quadro-fluxo.js');
const RAIZ = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(RAIZ, 'src', 'renderer', 'app.js'), 'utf8');

/* --- elementos no formato do Excalidraw --- */
function caixa(id, tipo, x, y, texto, w = 180, h = 80) {
  const els = [{ id, type: tipo, x, y, width: w, height: h, angle: 0, isDeleted: false,
    boundElements: texto ? [{ type: 'text', id: id + '-t' }] : [] }];
  if (texto) {
    els.push({ id: id + '-t', type: 'text', x: x + 10, y: y + h / 2 - 12, width: w - 20, height: 25,
      text: texto, originalText: texto, containerId: id, isDeleted: false });
  }
  return els;
}
/* seta de (x1,y1) ate (x2,y2); de/para = id grudado (ou null) */
function seta(id, [x1, y1], [x2, y2], de, para, rotulo) {
  const els = [{ id, type: 'arrow', x: x1, y: y1, width: Math.abs(x2 - x1), height: Math.abs(y2 - y1), angle: 0,
    isDeleted: false, points: [[0, 0], [x2 - x1, y2 - y1]],
    startBinding: de ? { elementId: de, focus: 0, gap: 4 } : null,
    endBinding: para ? { elementId: para, focus: 0, gap: 4 } : null,
    boundElements: rotulo ? [{ type: 'text', id: id + '-t' }] : null }];
  if (rotulo) els.push({ id: id + '-t', type: 'text', x: (x1 + x2) / 2, y: (y1 + y2) / 2, width: 40, height: 25,
    text: rotulo, originalText: rotulo, containerId: id, isDeleted: false });
  return els;
}
const texto = (id, x, y, t) => ({ id, type: 'text', x, y, width: 200, height: 25, text: t, originalText: t, containerId: null, isDeleted: false });
const cena = (...grupos) => JSON.stringify({ type: 'excalidraw', version: 2, source: 'cockpit', elements: grupos.flat(), appState: {}, files: {} });

test('fluxo linear: 3 caixas em coluna viram 1 → 2 → 3, a ultima e o fim', () => {
  const c = cena(
    caixa('a', 'rectangle', 100, 100, 'Receber pedido'),
    caixa('b', 'rectangle', 100, 260, 'Separar produto'),
    caixa('c', 'rectangle', 100, 420, 'Enviar'),
    seta('s1', [190, 184], [190, 256], 'a', 'b'),
    seta('s2', [190, 344], [190, 416], 'b', 'c'),
  );
  assert.equal(fluxoEmTexto(c), [
    'Fluxo desenhado no quadro:',
    '',
    '1. Receber pedido → 2. Separar produto',
    '2. Separar produto → 3. Enviar',
    '3. Enviar (fim)',
  ].join('\n'));
});

test('ordem vem das setas, nao da posicao: caixa de baixo que comeca o fluxo e o passo 1', () => {
  const c = cena(
    caixa('fim', 'rectangle', 100, 100, 'Publicar'),
    caixa('ini', 'rectangle', 100, 400, 'Escrever o post'),
    seta('s', [190, 396], [190, 184], 'ini', 'fim'),
  );
  assert.match(fluxoEmTexto(c), /1\. Escrever o post → 2\. Publicar\n2\. Publicar \(fim\)/);
});

test('decisao com 2 saidas: losango lista as saidas com o rotulo da seta (se sim / se nao), ramo por ramo', () => {
  const c = cena(
    caixa('a', 'rectangle', 200, 60, 'Receber pedido'),
    caixa('d', 'diamond', 200, 200, 'Tem estoque?', 180, 120),
    caixa('sep', 'rectangle', 40, 400, 'Separar produto'),
    caixa('av', 'rectangle', 380, 400, 'Avisar o cliente'),
    caixa('env', 'rectangle', 40, 560, 'Enviar'),
    seta('s1', [290, 144], [290, 196], 'a', 'd'),
    seta('s2', [240, 300], [130, 396], 'd', 'sep', 'sim'),
    seta('s3', [340, 300], [470, 396], 'd', 'av', 'não'),
    seta('s4', [130, 484], [130, 556], 'sep', 'env'),
  );
  assert.equal(fluxoEmTexto(c, { comImagem: true }), [
    'Fluxo desenhado no quadro (a imagem vai anexada):',
    '',
    '1. Receber pedido → 2. Tem estoque?',
    '2. Tem estoque? (decisão)',
    '   - (se sim) → 3. Separar produto',
    '   - (se não) → 5. Avisar o cliente',
    '3. Separar produto → 4. Enviar',
    '4. Enviar (fim)',
    '5. Avisar o cliente (fim)',
  ].join('\n'));
});

test('decisao: rotulo que ja e condicao nao ganha "se" de novo; saida sem rotulo e contada', () => {
  const c = cena(
    caixa('d', 'diamond', 200, 100, 'Pagou?', 160, 110),
    caixa('x', 'rectangle', 40, 320, 'Liberar acesso'),
    caixa('y', 'rectangle', 380, 320, 'Cobrar de novo'),
    seta('s1', [240, 200], [130, 316], 'd', 'x', 'senão'),
    seta('s2', [320, 200], [470, 316], 'd', 'y'),
  );
  const t = fluxoEmTexto(c);
  assert.match(t, /- \(senão\) → 2\. Liberar acesso/);
  assert.match(t, /- \(saída 2, sem rótulo\) → 3\. Cobrar de novo/);
});

test('seta comum com rotulo: → (rotulo) →', () => {
  const c = cena(
    caixa('a', 'rectangle', 100, 100, 'Gerar relatório'),
    caixa('b', 'rectangle', 100, 300, 'Cliente'),
    seta('s', [190, 184], [190, 296], 'a', 'b', 'manda por e-mail'),
  );
  assert.match(fluxoEmTexto(c), /1\. Gerar relatório → \(manda por e-mail\) → 2\. Cliente/);
});

test('merge: dois ramos que se juntam — o ponto de encontro vem depois dos dois e nao vira ciclo', () => {
  const c = cena(
    caixa('d', 'diamond', 200, 60, 'Tipo?', 160, 110),
    caixa('x', 'rectangle', 40, 260, 'Caminho A'),
    caixa('y', 'rectangle', 380, 260, 'Caminho B'),
    caixa('m', 'rectangle', 200, 440, 'Juntar'),
    seta('s1', [240, 160], [130, 256], 'd', 'x', 'a'),
    seta('s2', [320, 160], [470, 256], 'd', 'y', 'b'),
    seta('s3', [130, 344], [260, 436], 'x', 'm'),
    seta('s4', [470, 344], [340, 436], 'y', 'm'),
  );
  const t = fluxoEmTexto(c);
  assert.match(t, /2\. Caminho A → 4\. Juntar\n3\. Caminho B → 4\. Juntar\n4\. Juntar \(fim\)/);
  assert.doesNotMatch(t, /ciclo/);
});

test('ciclo: a seta que volta pra um passo anterior e marcada', () => {
  const c = cena(
    caixa('a', 'rectangle', 100, 100, 'Escrever código'),
    caixa('b', 'rectangle', 100, 260, 'Rodar os testes'),
    caixa('c', 'diamond', 100, 420, 'Passou?', 180, 120),
    caixa('d', 'rectangle', 100, 620, 'Commitar'),
    seta('s1', [190, 184], [190, 256], 'a', 'b'),
    seta('s2', [190, 344], [190, 416], 'b', 'c'),
    seta('s3', [190, 544], [190, 616], 'c', 'd', 'sim'),
    seta('s4', [100, 480], [100, 140], 'c', 'a', 'não'),
  );
  const t = fluxoEmTexto(c);
  assert.match(t, /^1\. Escrever código → 2\. Rodar os testes$/m);
  assert.match(t, /^3\. Passou\? \(decisão\)\n {3}- \(se não\) → 1\. Escrever código \(volta: ciclo\)\n {3}- \(se sim\) → 4\. Commitar$/m);
  assert.match(t, /^4\. Commitar \(fim\)$/m);
});

test('ciclo sem comeco (todo mundo recebe seta): comeca pela de cima e marca a volta', () => {
  const c = cena(
    caixa('x', 'ellipse', 100, 100, 'Ouvir'),
    caixa('y', 'ellipse', 100, 300, 'Responder'),
    seta('s1', [190, 184], [190, 296], 'x', 'y'),
    seta('s2', [60, 340], [60, 140], 'y', 'x'),
  );
  assert.equal(fluxoEmTexto(c).split('\n').slice(2).join('\n'), [
    '1. Ouvir → 2. Responder',
    '2. Responder → 1. Ouvir (volta: ciclo)',
  ].join('\n'));
});

test('seta solta: sem ligar nada, saindo de uma caixa pro vazio e chegando sem origem', () => {
  const c = cena(
    caixa('a', 'rectangle', 100, 100, 'Planejar'),
    caixa('b', 'rectangle', 100, 300, 'Fazer'),
    seta('liga', [190, 184], [190, 296], 'a', 'b'),
    seta('vazio', [280, 340], [520, 340], 'b', null, 'talvez'),
    seta('solta', [700, 700], [900, 700], null, null),
    seta('chega', [600, 140], [284, 140], null, 'a'),
  );
  const t = fluxoEmTexto(c);
  assert.match(t, /1\. Planejar → 2\. Fazer\n2\. Fazer \(fim\)/);
  assert.match(t, /Setas que não ligam duas caixas:\n- chega em 1\. Planejar sem sair de nenhuma caixa\n- sai de 2\. Fazer e não chega em nenhuma caixa \("talvez"\)\n- seta solta, sem ligar nada/);
});

test('seta que nao grudou mas foi solta perto da caixa conta como ligada', () => {
  const c = cena(
    caixa('a', 'rectangle', 100, 100, 'Pedir'),
    caixa('b', 'rectangle', 100, 300, 'Receber'),
    seta('s', [190, 195], [190, 290], null, null),   // 15 px abaixo de A, 10 px acima de B
  );
  assert.match(fluxoEmTexto(c), /1\. Pedir → 2\. Receber/);
  assert.doesNotMatch(fluxoEmTexto(c), /não ligam/);
});

test('caixa sem texto vira passo com nome explicito (e losango/elipse tambem)', () => {
  const c = cena(
    caixa('a', 'rectangle', 100, 100, 'Começo'),
    caixa('b', 'rectangle', 100, 260, ''),
    caixa('c', 'diamond', 100, 420, '', 160, 110),
    caixa('e', 'ellipse', 400, 420, ''),
    seta('s1', [190, 184], [190, 256], 'a', 'b'),
    seta('s2', [190, 344], [180, 416], 'b', 'c'),
  );
  const t = fluxoEmTexto(c);
  assert.match(t, /1\. Começo → 2\. \(caixa sem texto\)/);
  assert.match(t, /2\. \(caixa sem texto\) → 3\. \(losango sem texto\)/);
  assert.match(t, /3\. \(losango sem texto\) \(decisão\) \(fim\)/);
  assert.match(t, /4\. \(elipse sem texto\) \(sem setas\)/);
});

test('texto solto vira nota; texto dentro da seta nao vira nota; so texto = "Texto escrito no quadro"', () => {
  const c = cena(
    caixa('a', 'rectangle', 100, 100, 'Rodar'),
    caixa('b', 'rectangle', 100, 300, 'Conferir'),
    seta('s', [190, 184], [190, 296], 'a', 'b', 'depois'),
    texto('n2', 500, 400, 'não mexer no master'),
    texto('n1', 500, 90, 'prazo:\nsexta'),
  );
  const t = fluxoEmTexto(c);
  assert.match(t, /Notas soltas no quadro:\n- prazo: sexta\n- não mexer no master$/);
  assert.equal((t.match(/depois/g) || []).length, 1);
  assert.equal(fluxoEmTexto(cena(texto('t', 0, 0, 'só uma ideia'))), 'Fluxo desenhado no quadro:\n\nTexto escrito no quadro:\n- só uma ideia');
});

test('texto solto em que a seta grudou vira passo', () => {
  const c = cena(
    caixa('a', 'rectangle', 100, 100, 'Coletar'),
    texto('t', 100, 300, 'Banco de dados'),
    seta('s', [190, 184], [190, 296], 'a', 't'),
  );
  assert.match(fluxoEmTexto(c), /1\. Coletar → 2\. Banco de dados\n2\. Banco de dados \(fim\)/);
});

test('texto quebrado pelo Excalidraw usa o originalText; apagado e rabisco nao viram passo', () => {
  const els = caixa('a', 'rectangle', 100, 100, 'x');
  els[1].text = 'Mandar o\nrelatório'; els[1].originalText = 'Mandar o relatório';
  const c = cena(els, caixa('z', 'rectangle', 400, 100, 'Apagada').map((e) => ({ ...e, isDeleted: true })),
    { id: 'f', type: 'freedraw', x: 0, y: 0, width: 10, height: 10, points: [[0, 0], [5, 5]], isDeleted: false },
    { id: 'l', type: 'line', x: 0, y: 0, width: 10, height: 0, points: [[0, 0], [10, 0]], isDeleted: false });
  const t = fluxoEmTexto(c);
  assert.match(t, /1\. Mandar o relatório/);
  assert.doesNotMatch(t, /Apagada/);
  assert.match(t, /Também no desenho \(só na imagem\): 1 traço à mão, 1 linha\./);
});

test('esqueleto (formato que o agente escreve): label + start/end por id', () => {
  const esq = [
    { type: 'rectangle', id: 'a', x: 0, y: 0, width: 200, height: 80, label: { text: 'Ler o pedido' } },
    { type: 'diamond', id: 'd', x: 0, y: 160, width: 200, height: 120, label: { text: 'Urgente?' } },
    { type: 'rectangle', id: 'b', x: -150, y: 360, width: 200, height: 80, label: { text: 'Fazer já' } },
    { type: 'rectangle', id: 'c', x: 250, y: 360, width: 200, height: 80, label: { text: 'Agendar' } },
    { type: 'arrow', x: 100, y: 80, width: 0, height: 80, start: { id: 'a' }, end: { id: 'd' } },
    { type: 'arrow', x: 50, y: 280, width: 0, height: 80, start: { id: 'd' }, end: { id: 'b' }, label: { text: 'sim' } },
    { type: 'arrow', x: 150, y: 280, width: 0, height: 80, start: { id: 'd' }, end: { id: 'c' }, label: { text: 'não' } },
  ];
  assert.equal(fluxoEmTexto(esq).split('\n').slice(2).join('\n'), [
    '1. Ler o pedido → 2. Urgente?',
    '2. Urgente? (decisão)',
    '   - (se sim) → 3. Fazer já',
    '   - (se não) → 4. Agendar',
    '3. Fazer já (fim)',
    '4. Agendar (fim)',
  ].join('\n'));
  // nao mexe no que recebeu (quem chamou pode desenhar esses mesmos elementos depois)
  assert.equal(esq[4].id, undefined);
});

/* cena gravada pelo proprio app na vistoria b5: 3 caixas + losango pela API do
   Excalidraw e 1 seta desenhada com o MOUSE (de "Avisar o cliente" pra "Receber o pedido") */
const REAL = fs.readFileSync(path.join(__dirname, 'fixtures', 'quadro-fluxo-real.excalidraw'), 'utf8');
const TEXTO_REAL = [
  'Fluxo desenhado no quadro (a imagem vai anexada):',
  '',
  '1. Receber o pedido → 2. Tem estoque?',
  '2. Tem estoque? (decisão)',
  '   - (se sim) → 3. Separar e embalar',
  '   - (se não) → 4. Avisar o cliente',
  '3. Separar e embalar (fim)',
  '4. Avisar o cliente → 1. Receber o pedido (volta: ciclo)',
  '',
  'Notas soltas no quadro:',
  '- prazo: responder em 1 dia',
].join('\n');

test('cena real do quadro (gravada pelo app): decisao, rotulos, seta do mouse = ciclo, nota', () => {
  assert.equal(fluxoEmTexto(REAL, { comImagem: true }), TEXTO_REAL);
});

test('cena real sem nenhum startBinding/endBinding: a ligacao pela proximidade da o MESMO texto', () => {
  const c = JSON.parse(REAL);
  for (const e of c.elements) if (e.type === 'arrow') { e.startBinding = null; e.endBinding = null; }
  assert.equal(fluxoEmTexto(c, { comImagem: true }), TEXTO_REAL);
});

test('entrada ruim ou vazia devolve vazio, sem explodir', () => {
  assert.equal(fluxoEmTexto(''), '');
  assert.equal(fluxoEmTexto('{nao e json'), '');
  assert.equal(fluxoEmTexto({ elements: [] }), '');
  assert.equal(fluxoEmTexto([null, 3, 'x']), '');
  assert.equal(fluxoEmTexto(cena({ id: 'f', type: 'freedraw', x: 0, y: 0, points: [[0, 0]] })), '');
});

/* ---------------- bloco ```excalidraw ---------------- */
test('bloco excalidraw: esqueleto e cena completa passam; o texto volta limpo', () => {
  const esq = '[{"type":"rectangle","id":"a","x":0,"y":0,"width":200,"height":80,"label":{"text":"Oi"}},'
    + '{"type":"arrow","x":200,"y":40,"width":120,"height":0,"start":{"id":"a"},"endArrowhead":"arrow"}]';
  const r = lerBlocoExcalidraw('\n' + esq + '\n');
  assert.equal(r.ok, true);
  assert.equal(r.esqueleto, true);
  assert.equal(r.elementos.length, 2);
  assert.equal(r.texto, esq);
  const completa = lerBlocoExcalidraw(cena(caixa('a', 'rectangle', 0, 0, 'Oi')));
  assert.equal(completa.ok, true);
  assert.equal(completa.esqueleto, false);
});

test('bloco excalidraw invalido: explica o motivo (e a mensagem cai no codigo normal)', () => {
  const casos = [
    ['', /vazio/],
    ['{"elements": [', /JSON/],
    ['{"tipo": "outra coisa"}', /esperava/],
    ['[]', /nenhum elemento/],
    ['[1]', /não é um objeto/],
    ['[{"type":"star","x":0,"y":0}]', /desconhecido/],
    ['[{"type":"rectangle","x":"10","y":0}]', /x e y/],
    ['[{"type":"text","x":0,"y":0}]', /texto sem/],
    ['[{"type":"rectangle","x":0,"y":0,"label":"oi"}]', /label/],
    ['[{"type":"arrow","x":0,"y":0,"points":[[0,0],["a",1]]}]', /points/],
    ['[{"type":"arrow","x":0,"y":0,"start":{"id":"nao-existe"}}]', /não existe/],
    ['[{"type":"rectangle","x":0,"y":0,"isDeleted":true}]', /nenhum elemento/],
  ];
  for (const [txt, erro] of casos) {
    const r = lerBlocoExcalidraw(txt);
    assert.equal(r.ok, false, txt);
    assert.match(r.erro, erro, txt);
  }
  assert.equal(lerBlocoExcalidraw('[' + Array(2001).fill('{"type":"text","x":0,"y":0,"text":"a"}').join(',') + ']').ok, false);
});

test('o marked entrega ```excalidraw como code.language-excalidraw — e o app procura exatamente isso', () => {
  const ctx = { window: {}, self: {} };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'src', 'renderer', 'vendor', 'marked.min.js'), 'utf8'), ctx);
  const marked = ctx.marked || ctx.window.marked || ctx.self.marked;
  assert.ok(marked && marked.parse, 'marked carregou');
  const html = marked.parse('antes\n\n```excalidraw\n[{"type":"text","x":0,"y":0,"text":"<b>oi</b>"}]\n```\n');
  assert.match(html, /<pre><code class="language-excalidraw">/);
  assert.match(html, /&lt;b&gt;oi&lt;\/b&gt;/);   // o texto do modelo chega escapado, nunca como marcacao
  assert.ok(APP.includes('pre > code.language-excalidraw'), 'o app procura pre > code.language-excalidraw');
});

test('app: o desenho do bloco roda no texto final, no historico aberto pela lista e no restauro', () => {
  const chamadas = APP.match(/desenharBlocosExcalidraw\(P, b\.el\)/g) || [];
  assert.equal(chamadas.length, 3, 'textFinal + openSession + restaurarPaineis');
  assert.ok(APP.includes('QuadroFluxo.lerBlocoExcalidraw('), 'o bloco e conferido antes de desenhar');
  assert.ok(/function svgLimpo\([\s\S]{0,300}DOMPurify\.sanitize\(/.test(APP), 'svgLimpo passa pelo DOMPurify');
  assert.ok(/function desenharBlocosExcalidraw[\s\S]{0,3000}svgLimpo\(svg/.test(APP), 'o SVG do bloco passa pelo svgLimpo');
  const html = fs.readFileSync(path.join(RAIZ, 'src', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.indexOf('quadro-fluxo.js') > 0 && html.indexOf('quadro-fluxo.js') < html.indexOf('src="app.js"'), 'quadro-fluxo.js carrega antes do app.js');
  assert.match(html, /id="quadroPrompt"/);
  assert.match(html, /class="cb p-fluxo"/);
});

test('instrucao da casa: o exemplo de bloco excalidraw que o agente recebe e valido e vira fluxo', () => {
  const MAIN = fs.readFileSync(path.join(RAIZ, 'src', 'main.js'), 'utf8');
  const m = MAIN.match(/const EXEMPLO_EXCALIDRAW = ([\s\S]*?);\n/);
  assert.ok(m, 'EXEMPLO_EXCALIDRAW no main.js');
  const exemplo = vm.runInNewContext(m[1]);
  const r = lerBlocoExcalidraw(exemplo);
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.esqueleto, true);
  assert.match(fluxoEmTexto(exemplo), /1\. Ler o pedido → \(depois\) → 2\. Está claro\?\n2\. Está claro\? \(decisão\) \(fim\)/);
  assert.ok(/const INSTRUCOES_COCKPIT = \[[\s\S]*linguagem excalidraw[\s\S]*EXEMPLO_EXCALIDRAW,\s*\]\.join/.test(MAIN), 'a instrucao cita o bloco e leva o exemplo');
  assert.ok(EXEMPLO_SEM_METACARACTER_DO_CMD(exemplo));
});
// a instrucao vai na linha de comando: nada que o cmd.exe interprete se o claude for um .cmd
function EXEMPLO_SEM_METACARACTER_DO_CMD(s) { return !/[%^&|<>!]/.test(s); }

/* ---------------- linkarArquivos ---------------- */
function regexDoLinkar() {
  const i = APP.indexOf('function linkarArquivos(');
  assert.notEqual(i, -1);
  const linha = APP.slice(i).split('\n').find((l) => /^\s*const re = \//.test(l));
  const literal = linha.replace(/^\s*const re = /, '').replace(/;\s*$/, '');
  return vm.runInNewContext(literal);
}
// a regex nasceu em outro contexto do vm: copia pra uma lista daqui antes do deepEqual
const casar = (re, txt) => { re.lastIndex = 0; return [...(txt.match(re) || [])]; };

test('linkarArquivos: .excalidraw e .excalidraw.md saem inteiros (antes cortava em .excali)', () => {
  const re = regexDoLinkar();
  assert.deepEqual(casar(re, 'abra C:\\Users\\hugom\\fluxo.excalidraw pra ver'), ['C:\\Users\\hugom\\fluxo.excalidraw']);
  assert.deepEqual(casar(re, 'nota em C:\\vault\\desenho.excalidraw.md ok'), ['C:\\vault\\desenho.excalidraw.md']);
  assert.deepEqual(casar(re, 'no mac /Users/h/a.excalidraw e /home/h/b.excalidraw.md'), ['/Users/h/a.excalidraw', '/home/h/b.excalidraw.md']);
  // o que ja funcionava continua igual
  assert.deepEqual(casar(re, 'veja C:\\x\\app.js e C:\\x\\dados.json'), ['C:\\x\\app.js', 'C:\\x\\dados.json']);
  assert.deepEqual(casar(re, '/tmp/relatorio.xlsx,'), ['/tmp/relatorio.xlsx']);
});
