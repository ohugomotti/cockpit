'use strict';
/* Duas coisas que o Hugo pediu em 21/09/2026.

   1) A TORRE NAO MUDA quando se troca de pasta. Ela e' a visao geral de tudo
      que esta' em andamento, esperando resposta ou pronto pra ler, em qualquer
      pasta. Antes mudava por tres motivos, todos medidos na previa:
        a) a ORDEM saia de allPanes(), que lista os paineis da pasta ABERTA
           primeiro e os de segundo plano depois -- as mesmas linhas, com os
           mesmos estados, trocavam de lugar dentro de cada estado;
        b) a CHAVE da linha era o objeto do momento; o painel restaurado nasce
           com id novo, entao a linha era destruida e remontada ao abrir a pasta;
        c) a FICHA nao guardava o estado real, so' uiUnread -- quem estava
           trabalhando numa pasta ainda nao aberta nesta sessao valia "guardada"
           e caia fora da Torre ate' voce abrir aquela pasta.

   2) As duas MEDIDAS da lateral viraram ajuste do dono: a altura da Torre
      (cfg.uiTorreAltura, em %) e a largura da barra (cfg.uiSidebarLargura, em
      px). Ausencia = comportamento de antes, que e' o que faz config velho
      abrir igual. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const UI = require('../src/renderer/cockpit-ui');

const raiz = path.join(__dirname, '..', 'src', 'renderer');
const ui = fs.readFileSync(path.join(raiz, 'cockpit-ui.js'), 'utf8').replace(/\r\n/g, '\n');
const app = fs.readFileSync(path.join(raiz, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const css = fs.readFileSync(path.join(raiz, 'cockpit-ui.css'), 'utf8').replace(/\r\n/g, '\n');

/* mesmo recorte dos testes vizinhos: funcao de topo, fecha no primeiro "\n  }" */
function pedaco(fonte, nome, recuo) {
  const inicio = fonte.search(new RegExp('(?:async )?function ' + nome + '\\('));
  assert.notEqual(inicio, -1, 'funcao nao encontrada: ' + nome);
  return fonte.slice(inicio, fonte.indexOf('\n' + recuo + '}', inicio) + recuo.length + 2);
}
const daUi = (nome) => pedaco(ui, nome, '  ');
const doApp = (nome) => pedaco(app, nome, '');

/* ---------- a Torre montada de verdade, com o codigo do arquivo ---------- */

/* Duas pastas com conversa em cada uma. O que muda entre "estar na pasta A" e
   "estar na pasta B" e' so' quem esta' em panes e quem esta' em panesFundo --
   e' exatamente o que guardarPaineisDaAba/trazerPaineisDoFundo fazem, sem
   ninguem morrer (painel guardado nao morre). */
function cenarioDeDuasPastas() {
  const abas = [
    { id: 'a', nome: 'Produto', paineis: [] },
    { id: 'b', nome: 'Site', paineis: [] },
  ];
  const paineis = [
    { id: 'p1', abaId: 'a', uiOrdem: 1, engine: 'claude', titulo: 'A1 sua vez', sessaoId: 's-a1', pedindoPerm: true },
    { id: 'p2', abaId: 'a', uiOrdem: 2, engine: 'codex', titulo: 'A2 trabalhando', sessaoId: 's-a2', busy: true },
    { id: 'p3', abaId: 'a', uiOrdem: 3, engine: 'gemini', titulo: 'A3 terminou', sessaoId: 's-a3', uiCompleted: true, uiUnread: true },
    { id: 'p4', abaId: 'b', uiOrdem: 4, engine: 'claude', titulo: 'B1 sua vez', sessaoId: 's-b1', pedindoPerm: true },
    { id: 'p5', abaId: 'b', uiOrdem: 5, engine: 'codex', titulo: 'B2 trabalhando', sessaoId: 's-b2', busy: true },
  ];
  for (const P of paineis)
    abaPorIdDe(abas, P.abaId).paineis.push({ paneId: P.id, sessaoId: P.sessaoId, engine: P.engine, titulo: P.titulo, uiUnread: !!P.uiUnread });
  return { abas, paineis };
}
const abaPorIdDe = (abas, id) => abas.find((a) => a.id === id);

/* roda o liveRows + a ordenacao da Torre exatamente como o renderNavigator faz */
function torreDaPasta(abas, paineis, abaAberta) {
  const ctx = {
    panes: new Map(paineis.filter((P) => P.abaId === abaAberta).map((P) => [P.id, P])),
    panesFundo: new Map(paineis.filter((P) => P.abaId !== abaAberta).map((P) => [P.id, P])),
    abasLocais: () => abas,
    abaPorId: (id) => abaPorIdDe(abas, id),
    stateOf: UI.stateOf,
    STATES: UI.STATES,
    inControlTower: UI.inControlTower,
    tituloNaTorre: (P) => P.titulo,
  };
  vm.runInNewContext(
    [daUi('allPanes'), daUi('liveRows'), daUi('lugarNaTorre'), daUi('ordemDaTorre')].join('\n') +
      `\nthis.torre = (() => {
         const ativas = liveRows().filter(inControlTower);
         for (const row of ativas) row.lugar = lugarNaTorre(row);
         return ativas.sort(ordemDaTorre).map((r) => r.key + '|' + r.state + '|' + r.title);
       })();`,
    ctx,
  );
  return Array.from(ctx.torre);   // sai do realm do vm: array de la nao e deepEqual ao daqui
}

test('a Torre e a MESMA lista em qualquer pasta: mesmas linhas, mesmos estados, mesma ordem', () => {
  const { abas, paineis } = cenarioDeDuasPastas();
  const naPastaA = torreDaPasta(abas, paineis, 'a');
  const naPastaB = torreDaPasta(abas, paineis, 'b');
  const voltandoParaA = torreDaPasta(abas, paineis, 'a');
  // as cinco conversas continuam listadas, nenhuma some por causa da pasta
  assert.equal(naPastaA.length, 5);
  /* e' aqui que o codigo antigo falhava: ele entregava
     [p1,p4,p2,p5,p3] na pasta A e [p4,p1,p5,p2,p3] na pasta B, porque a ordem
     vinha de quem estava na tela naquele instante */
  assert.deepEqual(naPastaB, naPastaA, 'a Torre nao pode depender da pasta aberta');
  assert.deepEqual(voltandoParaA, naPastaA, 'ida e volta tem que fechar igual');
  // e a ordem e' a que o dono ve: estado primeiro, pasta e posicao depois
  assert.deepEqual(naPastaA, [
    'p1|attention|A1 sua vez',
    'p4|attention|B1 sua vez',
    'p2|working|A2 trabalhando',
    'p5|working|B2 trabalhando',
    'p3|done|A3 terminou',
  ]);
});

test('trocar a ordem das PASTAS muda a Torre; trocar de pasta aberta nao', () => {
  const { abas, paineis } = cenarioDeDuasPastas();
  const antes = torreDaPasta(abas, paineis, 'a');
  abas.reverse();   // o dono arrastou a pasta B pra frente da A
  const depois = torreDaPasta(abas, paineis, 'a');
  assert.notDeepEqual(depois, antes, 'a faixa de pastas e a ordem que o dono escolheu');
  assert.deepEqual(depois.slice(0, 2), ['p4|attention|B1 sua vez', 'p1|attention|A1 sua vez']);
  assert.deepEqual(torreDaPasta(abas, paineis, 'b'), depois, 'e continua igual em qualquer pasta');
});

test('a linha guarda a chave quando a ficha vira painel: nao pisca nem pula de lugar', () => {
  const abas = [{ id: 'a', nome: 'Produto', paineis: [{ paneId: 'antigo-1', sessaoId: 's1', engine: 'claude', titulo: 'C1', uiEstado: 'done', uiUnread: true }] }];
  const soFicha = torreDaPasta(abas, [], 'a');
  assert.deepEqual(soFicha, ['antigo-1|done|C1']);
  /* a pasta abriu: o restaurarPaineis cria um painel com id NOVO e guarda o da
     ficha no uiRestoredPaneId, e o savePanes seguinte regrava a ficha com o id
     novo. A linha tem que continuar sendo a MESMA */
  const vivo = { id: 'novo-9', uiRestoredPaneId: 'antigo-1', abaId: 'a', uiOrdem: 9, engine: 'claude', titulo: 'C1', sessaoId: 's1', uiCompleted: true, uiUnread: true };
  abas[0].paineis[0].paneId = 'novo-9';
  assert.deepEqual(torreDaPasta(abas, [vivo], 'a'), ['antigo-1|done|C1']);
  // e a conversa aparece UMA vez, nunca duas (ficha + painel no mesmo lugar)
  assert.equal(torreDaPasta(abas, [vivo], 'a').length, 1);
});

test('ficha guarda o estado real, e ficha antiga (sem o campo) vale a regra de antes', () => {
  const abas = [{ id: 'a', nome: 'A', paineis: [
    { paneId: 'f1', sessaoId: 's1', engine: 'claude', titulo: 'Trabalhando', uiEstado: 'working' },
    { paneId: 'f2', sessaoId: 's2', engine: 'claude', titulo: 'Sua vez', uiEstado: 'attention' },
    { paneId: 'f3', sessaoId: 's3', engine: 'claude', titulo: 'Por ler', uiUnread: true },
    { paneId: 'f4', sessaoId: 's4', engine: 'claude', titulo: 'Guardada' },
    { paneId: 'f5', sessaoId: 's5', engine: 'claude', titulo: 'Campo estragado', uiEstado: 'seiLa' },
  ] }];
  assert.deepEqual(torreDaPasta(abas, [], 'a'), [
    'f2|attention|Sua vez',
    'f1|working|Trabalhando',
    'f3|done|Por ler',
  ]);
  // f4 (guardada) e f5 (estado que nao existe) ficam de fora, como antes
});

test('fichaDoPainel grava o estado da conversa, e so quando ha o que contar', () => {
  const ctx = {
    window: { CockpitUI: { stateOf: UI.stateOf } },
    $: () => ({ value: '' }),
    guardarEstadoDoMotor() {},
    remotoDoPane: () => false,
  };
  vm.runInNewContext(doApp('fichaDoPainel') + '\nthis.ficha = fichaDoPainel;', ctx);
  const base = { id: 'p1', engine: 'claude', el: {}, coluna: 0 };
  assert.equal(ctx.ficha({ ...base, busy: true }).uiEstado, 'working');
  assert.equal(ctx.ficha({ ...base, pedindoPerm: true }).uiEstado, 'attention');
  assert.equal(ctx.ficha({ ...base, uiCompleted: true }).uiEstado, 'done');
  // "guardada" nao vira campo: ficha sem novidade continua do tamanho de antes
  assert.equal(ctx.ficha({ ...base }).uiEstado, undefined);
  // e a ficha nao quebra fora do renderer, onde nao existe window
  const semJanela = { $: ctx.$, guardarEstadoDoMotor() {}, remotoDoPane: () => false };
  vm.runInNewContext(doApp('fichaDoPainel') + '\nthis.ficha = fichaDoPainel;', semJanela);
  assert.equal(semJanela.ficha({ ...base, busy: true }).uiEstado, undefined);
});

test('painel novo nasce com a ordem de nascimento, que e o desempate da Torre', () => {
  assert.match(app, /const id = 'p' \+ bootId \+ '_' \+ \(\+\+paneSeq\);/);
  assert.match(app, /uiOrdem: paneSeq,/);
});

/* ---------- as duas medidas da lateral ---------- */

function bancadaDaAlca() {
  const eventos = {};
  const alca = {
    atributos: {}, classes: new Set(),
    setAttribute(k, v) { this.atributos[k] = v; },
    getAttribute(k) { return this.atributos[k]; },
    addEventListener(tipo, fn) { eventos[tipo] = fn; },
    setPointerCapture() {},
    classList: { add: (c) => alca.classes.add(c), remove: (c) => alca.classes.delete(c) },
  };
  return { alca, eventos };
}

function medida(op) {
  const { alca, eventos } = bancadaDaAlca();
  const gravados = [];
  const ctx = {
    persist: () => gravados.push(1),
    stopEvent: () => {},
  };
  vm.runInNewContext(daUi('medidaArrastavel') + '\nthis.montar = medidaArrastavel;', ctx);
  const aplicar = ctx.montar(alca, op);
  return { alca, eventos, aplicar, gravados };
}

test('o divisor da Torre guarda a altura em cfg, respeita os limites e o duplo clique volta ao padrao', () => {
  const cfg = {};
  let alturaReal = 30;   // % que a Torre ocupa agora
  const b = medida({
    eixo: 'y', min: 15, max: 70, padrao: 44, passo: 3,
    gravado: () => cfg.uiTorreAltura ?? null,
    porPixel: () => 0.2,      // 5 px por ponto percentual
    atual: () => alturaReal,
    aplicar: (v) => { if (v == null) delete cfg.uiTorreAltura; else cfg.uiTorreAltura = v; },
  });
  // arrastar 50 px pra baixo = +10 pontos
  b.eventos.pointerdown({ button: 0, clientY: 100, pointerId: 1, preventDefault() {} });
  b.eventos.pointermove({ clientY: 150, pointerId: 1 });
  assert.equal(cfg.uiTorreAltura, 40);
  assert.equal(b.gravados.length, 0, 'no meio do arrasto nao grava a cada pixel');
  b.eventos.pointerup({ pointerId: 1 });
  assert.equal(b.gravados.length, 1, 'grava uma vez, ao soltar');
  assert.equal(b.alca.getAttribute('aria-valuenow'), '40');
  // limites: nao da' pra sumir com a Torre nem deixar ela comer a lista toda
  alturaReal = 40;
  b.aplicar(999);
  assert.equal(cfg.uiTorreAltura, 70);
  b.aplicar(-999);
  assert.equal(cfg.uiTorreAltura, 15);
  assert.deepEqual([b.alca.getAttribute('aria-valuemin'), b.alca.getAttribute('aria-valuemax')], ['15', '70']);
  // duplo clique APAGA do cfg: e' isso que devolve o comportamento de antes
  b.eventos.dblclick();
  assert.equal('uiTorreAltura' in cfg, false);
  assert.equal(b.alca.getAttribute('aria-valuenow'), '40', 'sem valor gravado, le a medida real');
});

test('a largura da lateral guarda em cfg, anda pelo teclado e volta com Home', () => {
  const cfg = {};
  let larguraReal = 224;
  const b = medida({
    eixo: 'x', min: 168, max: 420, padrao: 224, passo: 8,
    gravado: () => cfg.uiSidebarLargura ?? null,
    porPixel: () => 1,
    atual: () => (cfg.uiSidebarLargura ?? larguraReal),
    aplicar: (v) => { if (v == null) delete cfg.uiSidebarLargura; else cfg.uiSidebarLargura = v; },
  });
  b.eventos.pointerdown({ button: 0, clientX: 200, pointerId: 1, preventDefault() {} });
  b.eventos.pointermove({ clientX: 300, pointerId: 1 });
  b.eventos.pointerup({ pointerId: 1 });
  assert.equal(cfg.uiSidebarLargura, 324);
  // teclado: seta anda um passo, com Shift anda quatro
  b.eventos.keydown({ key: 'ArrowRight', preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(cfg.uiSidebarLargura, 332);
  b.eventos.keydown({ key: 'ArrowLeft', shiftKey: true, preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(cfg.uiSidebarLargura, 300);
  b.eventos.keydown({ key: 'ArrowUp', preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(cfg.uiSidebarLargura, 300, 'alca vertical so ouve esquerda e direita');
  b.eventos.keydown({ key: 'Home', preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal('uiSidebarLargura' in cfg, false);
  assert.equal(b.alca.getAttribute('aria-valuenow'), '224');
});

test('reabrir o app devolve as duas medidas, e ausencia devolve o padrao do CSS', () => {
  const estilo = new Map();
  const nav = {
    dataset: {}, classList: { toggle() {}, remove() {} },
    removeAttribute(k) { delete nav.dataset[k.replace('data-', '')]; },
    style: {
      setProperty: (k, v) => estilo.set(k, v),
      removeProperty: (k) => estilo.delete(k),
    },
  };
  const aplicadas = [];
  const ctx = {
    nav, d: { body: { classList: { toggle() {} } } }, q: () => null,
    cfg: { uiTorreAltura: 58, uiSidebarLargura: 352 },
    ajustarTorre: (v, guardar) => aplicadas.push(['torre', v, guardar]),
    ajustarLargura: (v, guardar) => aplicadas.push(['largura', v, guardar]),
  };
  vm.runInNewContext(daUi('applyPreferences') + '\nthis.aplicar = applyPreferences;', ctx);
  ctx.aplicar();
  assert.deepEqual(aplicadas, [['torre', 58, false], ['largura', 352, false]]);
  // guardar=false: reabrir o app nao pode contar como uma escolha nova do dono
  aplicadas.length = 0;
  ctx.cfg = {};
  ctx.aplicar();
  assert.deepEqual(aplicadas, [['torre', null, false], ['largura', null, false]]);
});

test('o CSS so muda de tamanho quando ha valor gravado; rail e peek ficam de fora', () => {
  // sem ajuste, a regra de sempre continua inteira
  const torre = css.match(/\n\.ck-control-list\s*\{([^}]*)\}/)[1];
  assert.match(torre, /max-height:\s*200px/, 'o padrao e o teto de 200px, com altura pelo conteudo');
  assert.match(css, /\.ck-navigator \{[^}]*--layout-sidebar:\s*224px/);
  // e o ajuste e' uma regra a parte, presa ao atributo que so' o arrasto liga
  const manual = css.match(/\.ck-navigator\[data-torre="manual"\] \.ck-control-list\s*\{([^}]*)\}/);
  assert.ok(manual, 'falta a regra da Torre ajustada na mao');
  // leva 5 (UI 5.6): o valor da alça virou o TETO; a altura é a do conteúdo (com 2 itens sobrava um buraco)
  assert.match(manual[1], /height:\s*auto;\s*max-height:\s*min\(var\(--ck-torre\),/, 'o min() continua segurando o rodape na tela');
  assert.match(manual[1], /flex:\s*0 0 auto/, 'a Torre ajustada nao estica');
  assert.match(css, /\.ck-navigator\[data-torre="manual"\]:has\(\.ck-torre-divisor\.ck-arrastando\) \.ck-control-list \{ height: min\(var\(--ck-torre\),/, 'arrastando, mostra o tamanho escolhido');
  // as alcas somem onde a largura nao e' escolha do dono
  assert.match(css, /\.ck-collapsed:not\(\.ck-peek\) :is\(\.ck-torre-divisor, \.ck-largura-alca\),\s*\n\.ck-peek \.ck-largura-alca \{ display: none; \}/);
  assert.match(css, /\.ck-largura-alca \{[^}]*cursor: col-resize/);
  assert.match(css, /\.ck-torre-divisor \{[^}]*cursor: row-resize/);
  // a alca da largura se pendura na borda da lateral: sem position relative ela
  // iria parar na janela inteira
  assert.match(css, /\.ck-navigator \{[^}]*position: relative/);
});

test('as alcas tem nome em portugues, sao focaveis e se anunciam como divisoria', () => {
  const nascimento = ui.slice(ui.indexOf('const divisorTorre = node('), ui.indexOf('nav.append(top, grouping'));
  for (const trecho of [
    'divisorTorre.tabIndex = 0', 'alcaLargura.tabIndex = 0',
    '"role", "separator"', '"aria-orientation", "horizontal"', '"aria-orientation", "vertical"',
    'Altura da Torre, em porcento da lateral', 'Largura da barra lateral, em pixels',
  ])
    assert.ok(nascimento.includes(trecho), 'faltou na alca: ' + trecho);
  // as duas entram na lateral na ordem certa: o divisor ENTRE as duas listas
  assert.match(ui, /nav\.append\(top, grouping, controlList, divisorTorre, folderHeading, sessionList, history, accountList, tools, alcaLargura\)/);
  // e e' uma funcao so' pros dois ajustes, nao duas copias do mesmo arrasto
  assert.equal((ui.match(/function medidaArrastavel\(/g) || []).length, 1);
  assert.equal((ui.match(/medidaArrastavel\(/g) || []).length, 3);
});

/* ---------- leva 5, onda 2 (revisao a7b73e53ce0f88fc7): o `atual` da Torre ----------
   Desde a T5 a Torre desenhada tem a altura do CONTEUDO, e o valor da alca e' so' o
   TETO. Se o `atual` medisse a Torre desenhada, com teto salvo de 58% e 2 conversas
   (62 px) as setas e o 1o movimento do arrasto partiriam de ~8% e cairiam no minimo
   (15%): mexer na alca REBAIXAVA o teto que o dono tinha escolhido.
   Roda o bloco `ajustarTorre = medidaArrastavel(divisorTorre, {...})` do initialize,
   com o codigo real, junto com o medidaArrastavel real. */
function torreDoInitialize({ cfg, alturaDoConteudo, alturaDaLateral }) {
  const ini = ui.indexOf('ajustarTorre = medidaArrastavel(divisorTorre, {');
  const fim = ui.indexOf('ajustarLargura = medidaArrastavel(', ini);
  assert.ok(ini > 0 && fim > ini, 'bloco do ajustarTorre nao encontrado no initialize');
  const { alca, eventos } = bancadaDaAlca();
  const nav = {
    clientHeight: alturaDaLateral, dataset: {},
    removeAttribute(k) { delete nav.dataset[k.replace('data-', '')]; },
    style: { setProperty() {}, removeProperty() {} },
  };
  let gravados = 0;
  const ctx = {
    cfg, nav, divisorTorre: alca,
    controlList: { getBoundingClientRect: () => ({ height: alturaDoConteudo }) },
    persist() { gravados++; }, stopEvent() {},
  };
  vm.runInNewContext(daUi('medidaArrastavel') + '\nvar ajustarTorre;\n' + ui.slice(ini, fim), ctx);
  return { alca, eventos, gravados: () => gravados };
}
const teclaDaAlca = (t, key, extra = {}) =>
  t.eventos.keydown({ key, preventDefault() {}, stopImmediatePropagation() {}, ...extra });

// lateral de 784 px, teto salvo em 58% (454,7 px), mas so' 2 conversas: a Torre desenhada tem 62 px (~7,9%)
const comTetoSalvoEPoucasConversas = () => {
  const cfg = { uiTorreAltura: 58 };
  return { cfg, t: torreDoInitialize({ cfg, alturaDoConteudo: 62, alturaDaLateral: 784 }) };
};

test('as setas da alca da Torre partem do TETO salvo, nao da altura desenhada', () => {
  const { cfg, t } = comTetoSalvoEPoucasConversas();
  teclaDaAlca(t, 'ArrowDown');
  assert.equal(cfg.uiTorreAltura, 61, 'seta pra baixo = teto + 1 passo (3), nao o minimo de 15%');
  teclaDaAlca(t, 'ArrowUp');
  teclaDaAlca(t, 'ArrowUp');
  assert.equal(cfg.uiTorreAltura, 55, 'duas setas pra cima = teto - 2 passos');
  teclaDaAlca(t, 'ArrowDown', { shiftKey: true });
  assert.equal(cfg.uiTorreAltura, 67, 'com Shift o passo vale 4x (12 pontos)');
});

/* Rodada final da leva 5 (item 2): o ARRASTO deixou de partir do teto salvo. Partindo dele, a classe do arrasto levava a Torre
   ao teto e a alca ficava ~415 px longe do ponteiro; agora ele parte da altura DESENHADA (onde o Hugo ve a alca), so' depois
   de 3 px. O que a onda 2 protegia continua valendo: o gesto sem movimento nao rebaixa o teto. As setas seguem no teto. */
test('o 1o movimento do arrasto da alca da Torre (menos de 3 px) nao rebaixa o teto salvo; depois, anda a partir da altura desenhada', () => {
  const { cfg, t } = comTetoSalvoEPoucasConversas();
  t.eventos.pointerdown({ button: 0, clientY: 300, pointerId: 1, preventDefault() {} });
  // o ponteiro ainda nao andou: o teto fica exatamente onde estava
  t.eventos.pointermove({ clientY: 300, pointerId: 1 });
  assert.equal(cfg.uiTorreAltura, 58, 'o 1o movimento nao pode rebaixar o teto para a altura do conteudo');
  t.eventos.pointermove({ clientY: 400, pointerId: 1 });   // 62 + 100 px = 162 px de 784 = ~20,7%
  assert.equal(cfg.uiTorreAltura, 21, 'o arrasto anda a partir da altura desenhada, nao do teto (58% + 100 px = 71%, preso nos 70%)');
  t.eventos.pointerup({ pointerId: 1 });
  assert.equal(t.alca.getAttribute('aria-valuenow'), '21');
});

test('sem teto salvo a alca da Torre parte da medida real, e o duplo clique volta a medir', () => {
  // 200 px numa lateral de 800 px = 25%: sem valor gravado esta' e' a unica medida que existe
  const cfg = {};
  const t = torreDoInitialize({ cfg, alturaDoConteudo: 200, alturaDaLateral: 800 });
  teclaDaAlca(t, 'ArrowDown');
  assert.equal(cfg.uiTorreAltura, 28, 'sem teto salvo a 1a seta parte dos 25% medidos');
  t.eventos.dblclick();
  assert.equal('uiTorreAltura' in cfg, false, 'duplo clique apaga o teto');
  assert.equal(t.alca.getAttribute('aria-valuenow'), '25', 'e a alca volta a mostrar a medida real');
});

/* ---------- rodada final da leva 5 (revisao final ac9040bba93ba3a12, item 2): apertar a alca nao salta ----------
   Com teto salvo maior que o conteudo (58% e 3 conversas = 92 px), o pointerdown ligava `.ck-arrastando` e a regra
   `:has(.ck-arrastando)` do CSS levava a Torre ao teto: a alca ficava ~415 px longe do ponteiro o arrasto todo e voltava
   ao soltar. Agora: arrasto a partir da altura DESENHADA, classe so' depois de 3 px e ja' com "desenhado + deslocamento". */
function vigiarClasse(t, cfg) {
  const ligou = [];
  const add = t.alca.classList.add;
  t.alca.classList.add = (c) => { ligou.push([c, cfg.uiTorreAltura]); add(c); };
  return ligou;
}

test('arrastar a alca da Torre parte da altura desenhada: 92 px + 10 px = (92+10)/lateral, nao o teto + 10 px, e a classe liga sem salto', () => {
  const cfg = { uiTorreAltura: 58 };
  const t = torreDoInitialize({ cfg, alturaDoConteudo: 92, alturaDaLateral: 600 });
  const ligou = vigiarClasse(t, cfg);
  t.eventos.pointerdown({ button: 0, clientY: 300, pointerId: 1, preventDefault() {} });
  assert.deepEqual(ligou, [], 'apertar nao liga a classe: com ela a Torre mostra o teto (o salto)');
  t.eventos.pointermove({ clientY: 302, pointerId: 1 });
  assert.equal(cfg.uiTorreAltura, 58, 'com menos de 3 px ainda e clique');
  assert.deepEqual(ligou, []);
  t.eventos.pointermove({ clientY: 310, pointerId: 1 });
  assert.equal(cfg.uiTorreAltura, 17, '(92 + 10) / 600 = 17%, nao 58% + 10 px (60%)');
  assert.deepEqual(ligou, [['ck-arrastando', 17]], 'a classe liga ja com o desenhado + deslocamento aplicado');
  t.eventos.pointermove({ clientY: 340, pointerId: 1 });
  assert.equal(cfg.uiTorreAltura, 22, '(92 + 40) / 600 = 22%');
  t.eventos.pointerup({ pointerId: 1 });
  assert.equal(t.alca.classes.has('ck-arrastando'), false, 'soltar desliga a classe');
  assert.equal(t.gravados(), 1, 'grava uma vez, ao soltar');
  assert.equal(t.alca.getAttribute('aria-valuenow'), '22');
});

test('Torre menor que o minimo da alca (92 px numa lateral de 884 px = 10%): o arrasto para no minimo de 15%, nunca no teto salvo', () => {
  const cfg = { uiTorreAltura: 58 };
  const t = torreDoInitialize({ cfg, alturaDoConteudo: 92, alturaDaLateral: 884 });
  t.eventos.pointerdown({ button: 0, clientY: 300, pointerId: 1, preventDefault() {} });
  t.eventos.pointermove({ clientY: 310, pointerId: 1 });
  assert.equal(cfg.uiTorreAltura, 15, '(92 + 10) / 884 = 11,5% fica no minimo (15%), e nao em 58% + 10 px (59%)');
  t.eventos.pointermove({ clientY: 350, pointerId: 1 });
  assert.equal(cfg.uiTorreAltura, 16, '(92 + 50) / 884 = 16%: passado o minimo, acompanha o ponteiro');
  t.eventos.pointerup({ pointerId: 1 });
});

test('clique na alca da Torre sem mover (menos de 3 px): o teto nao muda, nada e gravado e a classe nunca liga; setas e duplo clique seguem', () => {
  const cfg = { uiTorreAltura: 58 };
  const t = torreDoInitialize({ cfg, alturaDoConteudo: 92, alturaDaLateral: 600 });
  const ligou = vigiarClasse(t, cfg);
  t.eventos.pointerdown({ button: 0, clientY: 300, pointerId: 1, preventDefault() {} });
  t.eventos.pointerup({ pointerId: 1 });
  t.eventos.pointerdown({ button: 0, clientY: 300, pointerId: 1, preventDefault() {} });
  t.eventos.pointermove({ clientY: 302, pointerId: 1 });   // a mao treme 2 px
  t.eventos.pointercancel({ pointerId: 1 });
  assert.equal(cfg.uiTorreAltura, 58, 'o teto continua 58%');
  assert.deepEqual(ligou, [], 'a classe nunca ligou');
  assert.equal(t.gravados(), 0, 'nada mudou, nada a gravar');
  teclaDaAlca(t, 'ArrowDown');
  assert.equal(cfg.uiTorreAltura, 61, 'as setas continuam partindo do teto salvo (58% + 3)');
  t.eventos.dblclick();
  assert.equal('uiTorreAltura' in cfg, false, 'o duplo clique continua voltando ao padrao');
});

test('a alca da largura (sem limiar nem inicioArrasto) continua como antes: a classe liga ao apertar, 1 px ja anda e soltar grava', () => {
  const cfg = {};
  const b = medida({
    eixo: 'x', min: 168, max: 420, padrao: 224, passo: 8,
    gravado: () => cfg.uiSidebarLargura ?? null,
    porPixel: () => 1,
    atual: () => (cfg.uiSidebarLargura ?? 224),
    aplicar: (v) => { if (v == null) delete cfg.uiSidebarLargura; else cfg.uiSidebarLargura = v; },
  });
  b.eventos.pointerdown({ button: 0, clientX: 200, pointerId: 1, preventDefault() {} });
  assert.equal(b.alca.classes.has('ck-arrastando'), true, 'liga ao apertar, como sempre');
  b.eventos.pointermove({ clientX: 201, pointerId: 1 });
  assert.equal(cfg.uiSidebarLargura, 225, '1 px ja conta');
  b.eventos.pointerup({ pointerId: 1 });
  assert.equal(b.gravados.length, 1, 'soltar grava');
  assert.equal(b.alca.classes.has('ck-arrastando'), false);
});
