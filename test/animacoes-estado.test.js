'use strict';
/* Leva das tres animacoes (21/09/2026).

   A regua do guia de marca e' o filtro destes testes, nao um conselho:

     "Movimento so' para estado: o arco de 'trabalhando' gira e o halo de 'sua
      vez' respira. Hover muda fundo em 120 ms. Nada entra deslizando. Com
      prefers-reduced-motion, tudo para e as formas continuam dizendo o mesmo."

   Tres coisas sao testadas aqui, e as tres sao contrato de DESEMPENHO, nao de
   gosto: o app fica aberto o dia inteiro com 20+ linhas na lateral.

   1) so' os estados que estao ACONTECENDO animam ("sua vez" e "trabalhando");
      "terminou" e "guardada" ficam parados;
   2) nada anima propriedade que repinta -- so' transform e opacity;
   3) toda animacao infinita tem guarda de prefers-reduced-motion, e parada a
      forma continua dizendo a mesma coisa.

   OBS sobre o "arco que gira": o arco virou tres pontinhos, na mesma lingua do
   indicador que o chat ja' usa embaixo da resposta (.trab-pts, style.css:418).
   A frase do guia precisa trocar "arco" por "pontinhos"; o resto dela continua
   valendo inteiro e e' o que este arquivo cobra. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.join(__dirname, '..', 'src', 'renderer');
const leia = (nome) => fs.readFileSync(path.join(raiz, nome), 'utf8').replace(/\r\n/g, '\n');
const cssBruto = leia('cockpit-ui.css');
const ui = leia('cockpit-ui.js');
const app = leia('app.js');

/* mesmo recorte dos testes vizinhos: funcao de topo, fecha no primeiro "\n  }" */
function pedaco(fonte, nome, recuo) {
  const inicio = fonte.search(new RegExp('(?:async )?function ' + nome + '\\('));
  assert.notEqual(inicio, -1, 'funcao nao encontrada: ' + nome);
  return fonte.slice(inicio, fonte.indexOf('\n' + recuo + '}', inicio) + recuo.length + 2);
}

/* ---------- um leitor de CSS pequeno, so' o que estes testes precisam ----------
   Sem comentario no meio, senao uma chave dentro de comentario desalinha a
   contagem. E o @media entra recursivo: a regra de movimento reduzido mora
   dentro de um. */
const css = cssBruto.replace(/\/\*[\s\S]*?\*\//g, ' ');
const limpo = (s) => s.replace(/\s+/g, ' ').trim();
/* virgula de lista de seletores, nao a de dentro de :is()/:not() */
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
const quadro = (nome) => quadros.find((k) => k.nome === nome);
const propsDoQuadro = (nome) => {
  const k = quadro(nome);
  assert.ok(k, 'faltam os quadros de ' + nome);
  return [...new Set(Array.from(k.corpo.matchAll(/([a-z-]+)\s*:/g), (m) => m[1]))].sort();
};
/* uma regra "anima" quando declara a abreviacao animation com um nome de
   quadro -- animation: none e' justamente o contrario */
const animacaoDe = (regra) => {
  const m = regra.corpo.match(/(?:^|[;{\s])animation:\s*([^;]+)/);
  if (!m || /^none\b/.test(limpo(m[1]))) return null;
  return limpo(m[1]);
};
const animadas = regras.filter((r) => animacaoDe(r));
const dentroDeMovimentoReduzido = (r) => r.dentroDe.some((a) => /prefers-reduced-motion:\s*reduce/.test(a));

/* ---------- 1) o selo: so' o que esta' acontecendo se mexe ---------- */

test('selo de estado: "sua vez" respira e "trabalhando" pulsa; "terminou" e "guardada" ficam parados', () => {
  const halo = regras.find((r) => r.sel === '.ck-g.attention::after' && animacaoDe(r));
  assert.ok(halo, 'falta o halo de "sua vez"');
  assert.match(animacaoDe(halo), /^ck-halo 2\.25s ease-out infinite$/);
  // o halo e' uma COPIA do selo, nao uma sombra: por isso tem fundo proprio
  assert.match(halo.corpo, /background:\s*var\(--attention\)/);
  assert.match(halo.corpo, /opacity:\s*0\b/, 'parado, o halo tem que sumir e deixar so o selo');

  /* 21/09/2026: os tres pontinhos foram recusados pelo Hugo -- ele quer o
     circulo de carregar, o padrao que todo software usa, e tudo minimalista.
     O anel e' a BORDA do proprio selo, com dois lados coloridos, girando. */
  const anel = regras.find((r) => r.sel === '.ck-g.working' && animacaoDe(r));
  assert.ok(anel, 'falta o anel de "trabalhando"');
  assert.match(animacaoDe(anel), /^ck-anel 0\.75s linear infinite$/);
  assert.match(anel.corpo, /border:\s*1\.5px solid transparent/, 'o anel e a borda do selo');
  assert.match(anel.corpo, /border-top-color:\s*var\(--working\)/);
  assert.match(anel.corpo, /background:\s*transparent/, 'anel vazado, nao bolinha cheia');
  // e o keyframe gira e mais nada: uma propriedade so, compositor puro
  const giro = css.slice(css.indexOf('@keyframes ck-anel'));
  assert.match(giro.slice(0, giro.indexOf('}') + 1), /rotate\(360deg\)/);
  assert.doesNotMatch(css, /@keyframes ck-dots/, 'o keyframe dos pontos tinha que sair junto');

  // o que NAO pode se mexer
  for (const r of animadas)
    assert.ok(
      !/\.ck-g\.(done|stored)\b/.test(r.sel),
      '"' + r.sel + '" anima: terminou e guardada tem que ficar parados',
    );
});

test('o selo de "trabalhando" nao empurra a coluna do titulo: mesma medida dos outros', () => {
  const caixa = regras.find((r) => r.sel === '.ck-g.working' && /width/.test(r.corpo));
  assert.ok(caixa, 'falta a caixa do anel');
  /* 12px, o mesmo do selo cheio: trocar de estado nao pode deslizar o logo do
     motor nem o titulo. A versao dos pontinhos precisava de 16px e devolvia a
     diferenca com margem negativa; o anel ja nasce do tamanho certo. */
  assert.match(caixa.corpo, /width:\s*12px/);
  assert.match(caixa.corpo, /height:\s*12px/);
  assert.doesNotMatch(caixa.corpo, /margin-inline:\s*-/, 'nao precisa mais compensar largura');
});

test('os tres pontinhos nascem UMA vez com a linha e a repintura nao os apaga', () => {
  const linha = pedaco(ui, 'sessionRow', '  ');
  assert.match(linha, /glyph\.innerHTML = "<i><\/i><i><\/i><i><\/i>"/, 'os pontos nascem junto com a linha');
  assert.equal((ui.match(/<i><\/i><i><\/i><i><\/i>/g) || []).length, 1, 'um lugar so cria os pontos');
  // r.glyph.textContent = "" apagaria os tres <i> a cada repintura
  assert.doesNotMatch(ui, /glyph\.textContent = ""/);
  // e o selo continua sendo UM dos cinco pedacos da linha, igual nas duas listas
  assert.match(linha, /el\.append\(glyph, place, logo, title, robots\)/);
});

/* ---------- 2) nada que repinta ---------- */

test('nenhuma animacao nova repinta: os quadros so mexem em transform e opacity', () => {
  const proibidas = [
    'box-shadow', 'background-position', 'background', 'background-size',
    'width', 'height', 'filter', 'top', 'left', 'right', 'bottom',
    'margin', 'padding', 'inset', 'border-width', 'color',
  ];
  assert.ok(quadros.length >= 6, 'os seis quadros da leva tem que estar aqui');
  for (const k of quadros) {
    const props = propsDoQuadro(k.nome);
    for (const p of props)
      assert.ok(
        p === 'transform' || p === 'opacity',
        '@keyframes ' + k.nome + ' mexe em "' + p + '"; so transform e opacity sao de graca',
      );
    for (const p of proibidas)
      assert.doesNotMatch(k.corpo, new RegExp('(^|[;{\\s])' + p + '\\s*:'), k.nome + ' x ' + p);
  }
  // o halo antigo animava box-shadow, que repinta o selo a cada quadro: com a
  // Torre cheia era repintura em 20 lugares, 60 vezes por segundo
  assert.deepEqual(propsDoQuadro('ck-halo'), ['opacity', 'transform']);
  assert.doesNotMatch(css, /@keyframes[^{]*\{[^}]*box-shadow/);
  // e o brilho do esqueleto ANDA, nao muda de posicao de fundo
  assert.deepEqual(propsDoQuadro('ck-brilho'), ['transform']);
  assert.match(quadro('ck-brilho').corpo, /translateX\(100%\)/);
});

test('nenhuma transicao nova persegue propriedade cara', () => {
  for (const r of regras) {
    const m = r.corpo.match(/(?:^|[;{\s])transition:\s*([^;]+)/);
    if (!m) continue;
    assert.doesNotMatch(
      m[1],
      /box-shadow|background-position|\bwidth\b|\bheight\b|filter/,
      'transicao cara em "' + r.sel + '": ' + limpo(m[1]),
    );
  }
});

/* ---------- 3) movimento reduzido para tudo ---------- */

/* Este teste nasceu de um bug MEDIDO na previa: a guarda estava no meio do
   arquivo e o caret, declarado depois com o mesmo peso, ganhava no desempate
   por ordem e continuava piscando com movimento reduzido ligado. @media nao
   soma especificidade -- entao a guarda tem que ser a ULTIMA palavra. */
test('a guarda de movimento reduzido e a ultima palavra do arquivo', () => {
  const inicio = cssBruto.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.notEqual(inicio, -1, 'cade a guarda?');
  const depoisDaGuarda = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  const sobrando = [...depoisDaGuarda.matchAll(/(?:^|[;{\s])animation:\s*([^;}]+)/g)]
    .map((m) => limpo(m[1]))
    .filter((v) => !/^none\b/.test(v));
  assert.deepEqual(sobrando, [], 'regra que anima depois da guarda escapa dela');
});

test('toda animacao tem guarda de prefers-reduced-motion e a forma continua dizendo o mesmo', () => {
  const guarda = regras.filter((r) => dentroDeMovimentoReduzido(r) && /animation:\s*none/.test(r.corpo));
  assert.ok(guarda.length, 'faltou o bloco de movimento reduzido');
  const desligadas = new Set(guarda.map((r) => r.sel));
  for (const r of animadas) {
    if (dentroDeMovimentoReduzido(r)) continue;
    assert.ok(
      desligadas.has(r.sel),
      'animacao sem guarda de movimento reduzido: "' + r.sel + '"',
    );
  }
  // parada, cada forma ainda diz o estado sozinha:
  // "sua vez" segue cheio de ambar (o halo nasce invisivel e some de vez)
  assert.match(regras.find((r) => r.sel === '.ck-g.attention').corpo, /background:\s*var\(--attention\)/);
  // "trabalhando" segue tres pontinhos visiveis (nao nascem transparentes)
  assert.doesNotMatch(regras.find((r) => r.sel === '.ck-g.working').corpo, /box-shadow:/);
  // "terminou" segue com o visto, "guardada" segue so contorno
  assert.ok(regras.some((r) => r.sel === '.ck-g.done::after'));
  assert.match(regras.find((r) => r.sel === '.ck-g.stored').corpo, /border:/);
  // e o caret parado fica ACESO: apagado ele mentiria que o turno acabou
  assert.doesNotMatch(regras.find((r) => /ocupado/.test(r.sel) && animacaoDe(r)).corpo, /opacity:\s*0/);
  /* os tres pontinhos do chat (.trab-pts) falam a mesma lingua do selo de
     "trabalhando" e nasceram sem guarda nenhuma no style.css: parar um e
     deixar o outro pulando seria o pior dos dois mundos */
  assert.ok(desligadas.has('.ck-app .trab-pts i'), 'os pontinhos do chat tambem param');
});

test('as animacoes usam token, nunca cor crua', () => {
  const novas = ['.ck-g.attention::after', '.ck-g.working', '.ck-skeleton-row', '.ck-skeleton-row::after'];
  for (const sel of novas) {
    const r = regras.find((x) => x.sel === sel);
    assert.ok(r, 'falta a regra ' + sel);
    assert.doesNotMatch(r.corpo, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i, 'cor crua em ' + sel);
  }
  // o caret pega a cor do proprio texto: serve aos quatro temas sem token novo
  assert.match(regras.find((r) => /ocupado/.test(r.sel) && animacaoDe(r)).corpo, /background:\s*currentColor/);
});

/* ---------- teto de movimento: nao pode virar festa ---------- */

test('o teto de movimento conta POR ESTADO, e o rail recolhido nao anima nada', () => {
  const teto = regras.filter((r) => /\[data-quieto\]/.test(r.sel) && /animation:\s*none/.test(r.corpo));
  assert.equal(teto.length, 2, 'o teto vale para os dois estados que animam');
  assert.ok(teto.some((r) => /\.ck-g\.attention::after$/.test(r.sel)), 'o halo tem teto');
  assert.ok(teto.some((r) => /\.ck-g\.working$/.test(r.sel)), 'o anel tem teto');
  /* Contar por POSICAO na lista nao serve: a Torre ordena "sua vez" antes de
     "trabalhando" (ordemDaTorre), entao uma fila de pendencias no topo jogava
     todos os "trabalhando" pra fora do teto e os pontinhos nunca apareciam.
     Medido na previa com 26 linhas (9 "sua vez" / 9 "trabalhando"): com teto
     por posicao, ZERO pontinhos animavam. */
  assert.doesNotMatch(cssBruto, /nth-of-type\(n \+ 9\)/, 'teto por posicao volta a matar os pontinhos');
  const pintura = pedaco(ui, 'renderNavigator', '  ');
  assert.match(pintura, /quantosNoEstado\[row\.state\] = \(quantosNoEstado\[row\.state\] \|\| 0\) \+ 1/);
  assert.match(pintura, /toggleAttribute\("data-quieto", quantosNoEstado\[row\.state\] > 4\)/);

  // o rail tem selo de 8px: um anel de 1.5px ali vira mancha e o halo passa
  // por cima do logo. Ali a forma trabalha sozinha, parada e cheia.
  const railAnel = regras.find((r) => r.sel === '.ck-collapsed:not(.ck-peek) .ck-state.ck-g.working');
  assert.match(railAnel.corpo, /animation:\s*none/, 'o anel nao gira no rail');
  assert.match(railAnel.corpo, /border-color:\s*transparent/, 'sem anel: vira ponto cheio');
  const railHalo = regras.find((r) => r.sel === '.ck-collapsed:not(.ck-peek) .ck-state.ck-g.attention::after');
  assert.match(railHalo.corpo, /animation:\s*none/);
  // ...e o selo recolhido continua cheio, senao "trabalhando" sumiria do rail
  assert.match(
    regras.find((r) => r.sel === '.ck-collapsed:not(.ck-peek) .ck-state.ck-g.working').corpo,
    /background:\s*var\(--working\)/,
  );
  // o contador da Torre e as estatisticas do grupo usam o mesmo selo de 8px
  for (const sel of ['.ck-attention-count .ck-g.attention::after', '.ck-group-stats .ck-g.attention::after'])
    assert.match(regras.find((r) => r.sel === sel).corpo, /animation:\s*none/, sel);
});

/* ---------- esqueleto do historico ---------- */

test('o esqueleto reserva altura previsivel e o brilho anda por cima', () => {
  const caixa = regras.find((r) => r.sel === '.ck-skeleton');
  assert.ok(caixa, 'falta a caixa reservada');
  // 6 linhas de 32px + 5 vaos de 4px + 4px de respiro = 204px. O ganho e' este:
  // a lista para de pular quando os dados chegam.
  assert.match(caixa.corpo, /min-height:\s*204px/);
  assert.match(regras.find((r) => r.sel === '.ck-skeleton-row').corpo, /height:\s*32px/);

  const brilho = regras.find((r) => r.sel === '.ck-skeleton-row::after');
  assert.match(animacaoDe(brilho), /^ck-brilho 1\.15s linear infinite$/);
  assert.match(brilho.corpo, /transform:\s*translateX\(-100%\)/);
  assert.doesNotMatch(brilho.corpo, /background-position/);

  // na troca o esqueleto sai FLUTUANDO: em fluxo, esqueleto e linhas reais
  // ficariam empilhados por 180ms e a lista pularia -- o contrario do objetivo
  const saindo = regras.find((r) => r.sel === '.ck-skeleton[data-out]');
  assert.match(saindo.corpo, /position:\s*absolute/);
  assert.match(animacaoDe(saindo), /180ms/);
  assert.match(regras.find((r) => r.sel === '.ck-session-list').corpo, /position:\s*relative/);
  // crossfade curto: some e aparece no mesmo intervalo, sem deslizar
  const entrando = regras.find((r) => r.sel === '.ck-session-list[data-swap] > .ck-session');
  assert.match(animacaoDe(entrando), /^ck-entra 180ms ease-out$/);
  assert.deepEqual(propsDoQuadro('ck-entra'), ['opacity']);
  assert.deepEqual(propsDoQuadro('ck-sai'), ['opacity']);
});

test('o esqueleto se amarra ao historyLoading que ja existia, sem segundo controle', () => {
  const pintura = pedaco(ui, 'renderNavigator', '  ');
  assert.match(pintura, /const carregando = historyLoading && !saved\.length/);
  assert.match(pintura, /historySkeleton\(carregando\)/);
  // enquanto carrega quem ocupa o lugar e o esqueleto, nao o "Nenhuma conversa"
  assert.match(pintura, /!saved\.length && !carregando && !q\("\.ck-empty-nav", sessionList\)/);
  // nenhuma variavel nova de estado: quem liga e desliga continua sendo, e so,
  // o loadPlaceHistory -- fora dele so existe a declaracao
  const carga = pedaco(ui, 'loadPlaceHistory', '  ');
  assert.equal((carga.match(/historyLoading = (true|false)/g) || []).length, 2);
  assert.equal((ui.match(/historyLoading = (true|false)/g) || []).length, 3, 'declaracao + liga + desliga');
});

test('historySkeleton cria uma vez, reaproveita, e MORRE quando os dados chegam', async () => {
  const criar = (tag, cls) => ({
    tag, className: cls || '', dataset: {}, children: [], atributos: {},
    append(...ns) { this.children.push(...ns); },
    prepend(...ns) { this.children.unshift(...ns); },
    setAttribute(k, v) { this.atributos[k] = v; },
    remove() { const i = lista.children.indexOf(this); if (i >= 0) lista.children.splice(i, 1); },
  });
  const lista = criar('div', 'ck-session-list');
  const ctx = {
    node: criar, setTimeout, clearTimeout, sessionList: lista, skeletonTimer: 0,
    q: (sel, raiz) => raiz.children.find((c) => c.className === sel.slice(1)) || null,
  };
  vm.runInNewContext(pedaco(ui, 'historySkeleton', '  ') + '\nthis.historySkeleton=historySkeleton;', ctx);

  const primeiro = ctx.historySkeleton(true);
  assert.equal(lista.children.length, 1, 'um esqueleto');
  assert.equal(primeiro.children.length, 6, 'seis linhas fantasma');
  assert.equal(primeiro.atributos['aria-hidden'], 'true', 'o leitor de tela nao le caixa vazia');
  // repintura no meio do carregamento nao pode empilhar esqueleto
  assert.equal(ctx.historySkeleton(true), primeiro);
  assert.equal(lista.children.length, 1);

  // chegaram os dados: crossfade e morte
  ctx.historySkeleton(false);
  assert.equal(primeiro.dataset.out, '1');
  assert.equal(lista.dataset.swap, '1');
  assert.equal(lista.children.length, 1, 'ainda na tela durante os 180ms');
  await new Promise((r) => setTimeout(r, 260));
  assert.equal(lista.children.length, 0, 'o esqueleto tem que sair do DOM');
  assert.equal(lista.dataset.swap, undefined, 'e a marca de troca tambem sai');

  // sem esqueleto na tela, desligar nao faz nada
  assert.equal(ctx.historySkeleton(false), null);
});

/* ---------- caret do texto que esta chegando ---------- */

test('o caret pisca enquanto o turno nao acabou e se amarra ao .ocupado que ja existia', () => {
  const caret = regras.find((r) => animacaoDe(r) && /ck-caret/.test(animacaoDe(r)));
  assert.ok(caret, 'falta o caret');
  assert.match(animacaoDe(caret), /^ck-caret 1s step-end infinite$/);
  assert.match(caret.corpo, /width:\s*0\.5ch/);
  assert.deepEqual(propsDoQuadro('ck-caret'), ['opacity']);

  // a marca de "ainda esta vindo" e a que o app ja usava: .ocupado no painel
  assert.match(caret.sel, /\.pane\.ocupado\b/);
  // ...e ela vem do P.busy, pelo setDot: nao ha segundo caminho de estado
  assert.match(pedaco(app, 'setDot', ''), /classList\.toggle\('ocupado', state === 'busy'\)/);
  // o turn-end desliga: P.busy = false e setDot idle, entao o caret some
  const fim = app.slice(app.indexOf("case 'turn-end':"), app.indexOf("case 'engine-down':"));
  assert.match(fim, /P\.busy = false; setDot\(P, 'idle'\)/);

  // o caret mora na ULTIMA fala, que e onde as letras estao caindo
  assert.match(caret.sel, /\.msg\.bot:not\(:has\(~ \.msg\)\)/);
  assert.match(caret.sel, /\.msg-body > :last-child:not\(ul, ol\)::after/);
  // ...e lista e caso a parte: no <ul> o ::after cairia numa linha sozinha
  const emLista = regras.filter((r) => animacaoDe(r) && /ck-caret/.test(animacaoDe(r)))
    .find((r) => /:is\(ul, ol\):last-child li:last-child::after/.test(r.sel));
  assert.ok(emLista, 'falta o caret no ultimo item de lista');
});

test('nao ha efeito de digitacao: o texto ja chega em streaming de verdade', () => {
  // efeito de digitacao seria animar largura/quantidade de letras em degraus;
  // o unico step- da folha e o piscar do caret, que mexe so em opacity
  for (const k of quadros)
    assert.doesNotMatch(k.corpo, /steps\(/, '@keyframes ' + k.nome + ' parece efeito de digitacao');
  assert.equal((css.match(/step-end/g) || []).length, 1, 'so o caret pisca em degrau');
  // e quem desenha o texto continua sendo o textDelta, pedaco a pedaco
  assert.match(app, /function textDelta\(P, key, text\)/);
  assert.match(pedaco(app, 'textDelta', ''), /b\.raw \+= text/);
});
