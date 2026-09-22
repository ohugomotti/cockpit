'use strict';
/* Redesenho da navegação (leva 1.2): as PASTAS saem da lateral e viram uma faixa
   horizontal acima dos painéis; no lugar delas a lateral passa a mostrar o
   HISTÓRICO da pasta ativa, com a mesma linha da Torre de controle.

   O que precisa continuar valendo:
   1) a faixa mora numa coluna própria (.ck-work) entre a lateral e os painéis,
      rola sozinha na horizontal e nunca faz a janela rolar;
   2) reordenar pasta por arraste continua sendo O MESMO mecanismo de antes
      (application/cockpit-place -> moverAbaLocal), não uma segunda cópia;
   3) a linha .ck-session é UMA função só, usada pela Torre e pelo histórico;
   4) o histórico lê o histCache que o loadHist já enche — nunca um segundo
      caminho de leitura de sessões;
   5) as duas listas têm rolagem própria, e o modo recolhido não quebra. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.join(__dirname, '..', 'src', 'renderer');
const ui = fs.readFileSync(path.join(raiz, 'cockpit-ui.js'), 'utf8').replace(/\r\n/g, '\n');
const css = fs.readFileSync(path.join(raiz, 'cockpit-ui.css'), 'utf8').replace(/\r\n/g, '\n');

/* mesmo recorte dos testes vizinhos: função de topo, fecha no primeiro "\n  }".
   Serve de guarda: se alguém aninhar errado, o teste quebra junto. */
function pedaco(nome) {
  const inicio = ui.search(new RegExp('(?:async )?function ' + nome + '\\('));
  assert.notEqual(inicio, -1, 'função não encontrada no cockpit-ui.js: ' + nome);
  return ui.slice(inicio, ui.indexOf('\n  }', inicio) + 4);
}

function regra(seletor) {
  const m = css.match(new RegExp(seletor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
  assert.ok(m, 'falta a regra ' + seletor);
  return m[1];
}

/* ---------- 1) a faixa de pastas ---------- */
test('a faixa de pastas nasce numa coluna própria, com o + no fim, e as pastas saem da lateral', () => {
  // a coluna .ck-work é o que põe a faixa ACIMA dos painéis e à DIREITA da
  // lateral; sem ela o flex do #shell jogaria a faixa ao lado dos painéis
  assert.match(ui, /placeBar = node\("div", "ck-place-bar"\)/);
  assert.match(ui, /work = node\("div", "ck-work"\)/);
  assert.match(ui, /panesBox\.before\(work\)/);
  assert.match(ui, /work\.append\(placeBar\)/);
  // pasta entra ANTES do botão de nova pasta: o + é sempre o último
  assert.match(ui, /placeBar\.insertBefore\(g\.el, newPlace\)/);
  assert.match(ui, /newPlace = button\("plus", "Nova pasta", \(\) => abrirModalAbaLocal\(\)/);
  // e nenhuma pasta vai mais para a lista da lateral
  assert.doesNotMatch(ui, /sessionList\.append\(g\.el\)/);
  assert.doesNotMatch(ui, /nav\.append\([^)]*places[,)]/);
});

test('a faixa rola na horizontal sem quebrar linha e sem empurrar a janela', () => {
  const faixa = regra('.ck-place-bar');
  assert.match(faixa, /flex-wrap:\s*nowrap/);
  assert.match(faixa, /overflow-x:\s*auto/);
  assert.match(faixa, /min-width:\s*0/, 'sem min-width:0 a faixa faz a janela rolar');
  assert.match(faixa, /min-height:\s*3[0-4]px/, 'a faixa é compacta: 30-34px');
  /* a barrinha somava 10px de altura e engordava a faixa só por haver muitas
     pastas; escondê-la exige a pista de que rola, como no #activitybar */
  assert.match(faixa, /scrollbar-width:\s*none/);
  assert.match(faixa, /background-attachment:\s*local,\s*scroll/);
  assert.match(faixa, /background-position:\s*right,\s*right/);
  assert.match(css, /\.ck-place-bar::-webkit-scrollbar\s*\{[^}]*height:\s*0/);
  // e a pasta que vira ativa se mostra sozinha quando a faixa está rolada
  assert.match(ui, /groups\.get\("place:" \+ place\?\.id\)\?\.el\.scrollIntoView/);
  const chip = regra('.ck-place-bar .ck-place-only');
  assert.match(chip, /flex:\s*0 0 auto/, 'pasta não encolhe: quem rola é a faixa');
  assert.match(chip, /max-width/);
  const trabalho = regra('.ck-app .ck-work');
  assert.match(trabalho, /flex-direction:\s*column/);
  assert.match(trabalho, /min-width:\s*0/);
});

/* A primeira versão escondia o ícone nas pastas locais, para deixar "só o nome".
   O Hugo pediu o ícone de pasta de volta em 21/09/2026: ele distingue pasta de
   servidor sem obrigar a ler o nome. O que continua valendo é o resto da regra
   de compactação — nada de contador, e nome longo com reticências. */
test('a pasta mostra o ícone e o nome, sem contador', () => {
  assert.match(regra('.ck-place-bar .ck-group-stats'), /display:\s*none/);
  const icone = regra('.ck-place-bar .ck-group-icon');
  assert.match(icone, /display:\s*flex/, 'o ícone de pasta tem que aparecer');
  assert.doesNotMatch(icone, /display:\s*none/);
  assert.match(regra('.ck-place-bar .ck-group-icon .ic'), /width:\s*13px/, 'ícone compacto');
  assert.match(ui, /placeIcon\.dataset\.place = aba\?\.tipo === "ssh" \? "ssh" : "local"/);
  // nome longo continua cortado com reticências, não estourando a faixa
  assert.match(regra('.ck-group-name'), /text-overflow:\s*ellipsis/);
  assert.match(regra('.ck-place-bar .ck-group-head'), /white-space:\s*nowrap/);
});

test('a pasta ativa se destaca com token que já existe, não com cor inventada', () => {
  const ativa = regra('.ck-place-bar .ck-place-only[data-current="true"] .ck-group-head');
  assert.match(ativa, /var\(--focus\)/);
  assert.match(ativa, /var\(--high\)/);
  assert.doesNotMatch(ativa, /#[0-9a-f]{3,8}\b/i, 'nada de cor crua fora dos tokens');
});

test('arraste, menu e duplo clique da pasta continuam sendo o mecanismo antigo', () => {
  // uma cópia a mais destes trechos significaria reimplementar o que já existe
  assert.equal((ui.match(/application\/cockpit-place/g) || []).length, 3);
  assert.equal((ui.match(/moverAbaLocal\(/g) || []).length, 1);
  assert.equal((ui.match(/placeActions\(aba\);/g) || []).length, 1, 'só um lugar abre o menu da pasta');
  // e tudo continua ligado no mesmo lugar de sempre: o groupFor
  const grupo = pedaco('groupFor');
  for (const trecho of ['dragstart', 'dragover', 'drop', 'dblclick', 'contextmenu',
    'application/cockpit-place', 'moverAbaLocal(', 'abrirModalAbaLocal(aba)', 'placeActions(aba)'])
    assert.ok(grupo.includes(trecho), 'saiu do groupFor: ' + trecho);
});

/* ---------- 2) a linha de sessão é uma só ---------- */
test('a Torre e o histórico pintam pela MESMA função de linha', () => {
  assert.match(ui, /function sessionRow\(store, row\)/);
  /* 21/09/2026: a Torre passou a montar a linha em DUAS etapas -- guarda o
     retorno da sessionRow, marca o teto de movimento (data-quieto, por estado)
     e SO' entao anexa. Era uma linha so' antes. O contrato deste teste nao
     mudou e e' outro: quem monta a linha das DUAS listas continua sendo a
     mesma sessionRow, e ninguem monta .ck-session por fora dela. */
  assert.match(ui, /const r = sessionRow\(rows, row\);/);
  assert.match(ui, /controlList\.append\(r\.el\);/);
  assert.match(ui, /sessionList\.append\(sessionRow\(histRows, row\)\.el\)/);
  // tres ocorrencias: a definicao e as duas listas. Uma quarta seria um
  // terceiro caminho de montagem, que e' o que este teste existe pra impedir.
  assert.equal((ui.match(/sessionRow\(/g) || []).length, 3);
  // o bloco inline antigo não pode ter ficado para trás dentro do renderNavigator
  const render = ui.slice(ui.indexOf('function renderNavigator('));
  const corpo = render.slice(0, render.indexOf('\n  }'));
  assert.doesNotMatch(corpo, /el\.className = "ck-session"/);
  assert.equal((ui.match(/el\.className = "ck-session"/g) || []).length, 1);
});

test('a linha montada é igual nas duas listas e cada lista tem a sua memória', () => {
  const feito = [];
  const criar = (tag, cls, text) => ({
    tag, className: cls || '', textContent: text == null ? '' : text, dataset: {}, title: '',
    innerHTML: '', children: [],
    append(...ns) { this.children.push(...ns); },
    classList: {
      set: new Set(),
      toggle(c, on) { on ? this.set.add(c) : this.set.delete(c); },
    },
    addEventListener(tipo, fn) { (this.on ||= {})[tipo] = fn; },
    setAttribute(k, v) { this[k] = v; },
  });
  const ctx = {
    STATES: { attention: { label: 'Sua vez' }, saved: { label: 'Guardado' } },
    focusPane: null,
    node: criar,
    button: (_i, _t, click) => Object.assign(criar('button'), { click }),
    ico: (nome) => '<ic:' + nome + '>',
    svgMotor: (m) => '<motor:' + m + '>',
    nomeDoMotor: (m) => m.toUpperCase(),
    activate: (row) => feito.push(['activate', row.key]),
    openSession: (s) => feito.push(['openSession', s.id]),
    sessionActions: () => {},
  };
  vm.runInNewContext(pedaco('sessionRow') + '\nthis.sessionRow=sessionRow;', ctx);

  const torre = new Map(), historico = new Map();
  const daTorre = { key: 'p1', p: { id: 'p1', cwd: 'C:/x' }, aba: { nome: 'Produto' }, state: 'attention', title: 'Viva', engine: 'claude' };
  const daPasta = { key: 'hist:claude:s1', s: { id: 's1', cwd: 'C:/x' }, aba: { nome: 'Produto' }, state: 'saved', title: 'Antiga', engine: 'claude' };
  const a = ctx.sessionRow(torre, daTorre), b = ctx.sessionRow(historico, daPasta);

  // mesmo desenho: mesma classe, mesmos cinco pedaços, mesma ordem.
  // só o selo de estado muda, porque o estado é que é diferente.
  const partes = (r) => Array.from(r.el.children, (n) => n.className.split(' ')[0]);
  assert.equal(a.el.className, 'ck-session');
  assert.equal(b.el.className, 'ck-session');
  assert.deepEqual(partes(a), partes(b));
  assert.deepEqual(partes(a),
    ['ck-state', 'ck-session-place', 'ck-engine', 'ck-session-title', 'ck-robots']);
  assert.equal(a.glyph.className, 'ck-state ck-g attention');
  assert.equal(b.glyph.className, 'ck-state ck-g stored');
  assert.equal(b.title.textContent, 'Antiga');
  assert.equal(b.el.dataset.state, 'saved');
  assert.ok(b.el.title.includes('Guardado') && b.el.title.includes('C:/x'));

  // cada lista guarda a sua linha: reusar a mesma memória faria uma apagar a outra
  assert.equal(torre.size, 1);
  assert.equal(historico.size, 1);
  assert.equal(ctx.sessionRow(torre, daTorre), a, 'a linha da torre é reaproveitada');

  // clique: a da torre passa pelo activate, a do histórico abre a sessão gravada
  a.el.click();
  b.el.click();
  assert.deepEqual(feito, [['activate', 'p1'], ['openSession', 's1']]);
});

/* ---------- 3) o histórico da pasta ---------- */
test('o histórico da lateral vem do histCache, ordenado do mais novo para o mais velho', () => {
  const ctx = {
    MOTORES: ['claude', 'codex'],
    abaAtual: () => ({ id: 'produto', nome: 'Produto' }),
    inControlTower: (r) => ['attention', 'working'].includes(r.state),
    liveRows: () => [
      { key: 'p1', p: { sessaoId: 'c2' }, state: 'working' },   // está na Torre
      { key: 'p2', p: { sessaoId: 'c3' }, state: 'saved' },     // aberta, mas parada
    ],
    histCache: {
      claude: [
        { id: 'c1', title: 'Velha', when: 1000, cwd: 'C:/x' },
        { id: 'c2', title: 'Aberta e trabalhando', when: 3000, cwd: 'C:/x' },
        { id: 'c3', title: 'Aberta e parada', when: 2500, cwd: 'C:/x' },
      ],
      codex: [{ id: 'x1', title: 'Do meio', when: 2000, cwd: 'C:/x' }],
      gemini: null,
    },
  };
  vm.runInNewContext(pedaco('historyRows') + '\nthis.linhas=historyRows();this.reuso=historyRows([]);', ctx);
  // a repintura passa o liveRows que já montou; sem argumento ele monta sozinho.
  // Com a lista vazia ninguém está na Torre, então as quatro descem pro histórico
  assert.deepEqual(Array.from(ctx.reuso, (r) => r.state), ['saved', 'saved', 'saved', 'saved']);
  // Array.from: o que volta da vm tem outro prototype e o deepEqual estrito reclama
  const campo = (k) => Array.from(ctx.linhas, (r) => r[k]);
  /* "Aberta e trabalhando" NÃO se repete aqui embaixo: ela já está na Torre.
     Eram duas linhas iguais, e clicar em cada uma fazia coisa diferente. */
  assert.deepEqual(campo('title'), ['Aberta e parada', 'Do meio', 'Velha']);
  assert.deepEqual(campo('key'),
    ['hist:claude:c3', 'hist:codex:x1', 'hist:claude:c1']);
  // painel aberto que NÃO está na Torre continua no histórico, com o estado real
  assert.deepEqual(campo('state'), ['saved', 'saved', 'saved']);
  assert.equal(ctx.linhas[0].aba.nome, 'Produto');
  assert.equal(ctx.linhas[1].engine, 'codex');
});

test('o histórico se recarrega sozinho quando o cache é zerado no fim do turno', () => {
  /* o bug: o app zera histCache[motor] no turn-end e a recarga estava atrás de
     "se a lista antiga estiver visível", que no tema ck-app nunca está */
  assert.match(ui, /function historicoFaltando\(\) \{/);
  assert.match(ui, /else if \(historicoFaltando\(\)\) loadPlaceHistory\(\);/);
  const guarda = pedaco('historicoFaltando');
  assert.match(guarda, /MOTORES\.some\(\(engine\) => histCache\[engine\] == null\)/);
  // sem trava vira laço: a repintura chamaria a recarga, que repinta, que chama…
  assert.match(guarda, /historyLoading \|\| Date\.now\(\) - historyTried < 2000/);
  // e o temporizador só é re-armado por quem ainda é dono da pasta atual
  assert.match(pedaco('loadPlaceHistory'),
    /if \(\(abaAtual\(\)\?\.id \|\| ""\) === place\) \{\s*\n\s*historyTimer = setTimeout/);
});

test('nada de segundo caminho de leitura: quem lê sessão continua sendo o loadHist', () => {
  assert.match(ui, /function loadPlaceHistory\(\)/);
  assert.match(ui, /MOTORES\.map\(\(engine\) =>\s*Promise\.resolve\(loadHist\(engine\)\)/);
  assert.match(ui, /if \(historyPlace !== \(place\?\.id \|\| ""\)\) \{/);
  assert.match(ui, /const saved = historyRows\(data\)/, 'a repintura reaproveita o liveRows que já montou');
  // a recarga só conhece o loadHist; ela não fala com a ponte de sessões, e é a
  // ÚNICA porta do navegador para o histórico (a busca global do palette é
  // outra coisa: ela varre todos os lugares, não a pasta ativa)
  const recarga = pedaco('loadPlaceHistory');
  assert.doesNotMatch(recarga, /window\.api|sessionsClaude|sessionsCodex|sessionsCli|sessionsRemoto/);
  const linhas = pedaco('historyRows');
  assert.doesNotMatch(linhas, /window\.api/);
  assert.match(linhas, /histCache\[engine\]/);
  // e a recarga periódica é desarmada ao fechar, como os outros temporizadores
  assert.match(ui, /clearTimeout\(historyTimer\)/);
});

test('o cabeçalho da lateral nomeia o histórico e guarda a pasta no title', () => {
  assert.match(ui, /node\("span", "ck-nav-label", "HISTÓRICO"\)/);
  assert.doesNotMatch(ui, /node\("span", "ck-nav-label", "PASTAS"\)/);
  assert.match(ui, /folderHeading\.title = "Conversas de " \+ \(place\?\.nome \|\| "esta pasta"\)/);
  assert.match(ui, /sessionList\.setAttribute\("aria-label", "Conversas desta pasta"\)/);
  // a linha divisória entre Torre e histórico é a mesma de antes
  assert.match(regra('.ck-folder-heading'), /border-top:\s*1px solid var\(--line\)/);
});

test('as duas listas têm altura limitada e rolagem própria, e o rail não quebra', () => {
  /* 21/09/2026: o padrão virou altura FIXA (o desenho do Hugo para Full HD) —
     a Torre não muda de tamanho e quem cresce em tela maior é o histórico. */
  const torre = regra('.ck-control-list');
  assert.match(torre, /max-height:\s*200px/, 'teto de 7 conversas');
  assert.match(torre, /height:\s*auto/, 'sem altura travada: com 2 conversas ela ocupa 2, não 7');
  assert.match(torre, /flex:\s*0 0 auto/, 'a Torre não estica nem é espremida');
  assert.match(regra('.ck-control-list'), /overflow-y:\s*auto/);
  // a lista do histórico tem MAIS de uma regra no arquivo; vale a última
  const listas = [...css.matchAll(/\.ck-session-list\s*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(listas.length, 'falta a regra .ck-session-list');
  const lista = listas.at(-1);
  assert.match(lista, /overflow-y:\s*auto/);
  assert.match(lista, /min-height:\s*60px/);
  // as duas listas compartilham a medida da linha: uma regra só, para as duas
  assert.ok(css.includes(':is(.ck-control-list, .ck-session-list) .ck-session {'));
  assert.ok(css.includes('.ck-collapsed:not(.ck-peek) :is(.ck-control-list, .ck-session-list) .ck-session {'),
    'no rail de 56px a linha do histórico também precisa virar ícone');
});

test('automação esperando resposta é assunto da Torre, não do histórico', () => {
  assert.match(ui, /controlList\.prepend\(automationSection\)/);
  assert.doesNotMatch(ui, /sessionList\.prepend\(automationSection\)/);
  // "Tudo em dia" só aparece quando não há sessão NEM automação pedindo atenção
  assert.match(ui, /const idle = !active\.length && !automations\.length/);
});

/* O bug que o print do Hugo mostrava em 21/09/2026 e que passou batido em três
   auditorias: os medidores de consumo apareciam CORTADOS AO MEIO na borda de
   baixo da lateral, e o "Conversas guardadas" espremido. Não era altura da
   Torre — era flex.

   A lateral é uma coluna flex e todo filho tem `flex-shrink: 1` por padrão.
   Com o histórico cheio, o navegador espremia TODOS os blocos que não se
   defendessem: medido, `.ck-accounts` renderizava 22px precisando de 42.
   Quem cede espaço numa coluna assim tem que ser UM só — a lista do histórico.
   É o mesmo defeito que já tinha mordido a lista do buscador (.ck-result). */
test('só o histórico cede espaço: nenhum outro bloco da lateral pode ser espremido', () => {
  for (const seletor of ['.ck-accounts', '.ck-tools', '.ck-history'])
    assert.match(regra(seletor), /flex:\s*none/, seletor + ' seria esmagado com a lista cheia');
  // e a lista do histórico é justamente a que estica e encolhe
  const listas = [...css.matchAll(/\.ck-session-list\s*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.match(listas.at(-1), /flex:\s*1/, 'o histórico é quem dá e toma o espaço');
});
