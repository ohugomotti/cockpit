'use strict';
/* Leva 5, T2 (R6-02, R6-03 + R6-08, R6-04, R6-06 + R6-07): contraste com os tokens de cada tema (WCAG 2.x).
   Texto pede 4,5:1; borda de controle, 3:1. O "antes" de cada um está no comentário (medido no 6a269da). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ler, bloco, hex, contraste, temas } = require('../testes/contraste');
const STYLE = ler('style.css'), UI = ler('cockpit-ui.css');
const TEMAS = temas();
/* Leva 5e, 2a rodada (pedido do Hugo: "o automático tá diferente do escuro, deveria ser o mesmo"): o Automático não tem bloco de cores
   próprio, é apelido do Claro e do Escuro (o seletor dele divide a lista de seletores do tema fixo no tokens.css, no style.css e no
   visual-mac.css). Então TEMAS['automático claro'] é o bloco do Claro, e as peças que moram no style.css (--link, --cod, --puxador,
   --rot-falha...) o Automático claro lê do bloco do Claro de lá. As contas daqui seguem valendo para ele, agora por igualdade; a igualdade
   em si (todo o <html>, com e sem o visual Mac) é cobrada em contraste-painel-fundo.test.js. */
const CLARO_STYLE = bloco(STYLE, 'html[data-tema="claro"]{');
const tok = (tema, nome) => { const v = hex(TEMAS[tema], nome); assert.ok(v, tema + ': falta ' + nome + ' em hexadecimal'); return v; };
const FUNDOS = ['--canvas', '--surface', '--raised'];
function minimo(tema, cor, fundos, piso, rotulo) {
  for (const f of fundos) {
    const r = contraste(cor, tok(tema, f));
    assert.ok(r >= piso, tema + ': ' + rotulo + ' sobre ' + f + ' = ' + r.toFixed(2) + ':1 (mínimo ' + piso + ')');
  }
}
// --link: blocos de tema do style.css (o Azul e o Automático escuro herdam o :root; o Automático claro divide o bloco do Claro)
const RAIZ = bloco(STYLE, ':root{');
const LINK = { escuro: hex(RAIZ, '--link'), azul: hex(RAIZ, '--link'), claro: hex(CLARO_STYLE, '--link'),
  jornal: hex(bloco(STYLE, 'html[data-tema="jornal"]{'), '--link'), 'automático claro': hex(CLARO_STYLE, '--link'), 'automático escuro': hex(RAIZ, '--link') };

/* R6-04. Antes (#5aa8e8 fixo): 2,41:1 no Claro (--surface), 2,33:1 no Jornal, 2,29:1 no Automático claro (--canvas). */
test('link da resposta passa de 4,5:1 sobre os fundos da conversa em todo tema e é sublinhado (R6-04)', () => {
  for (const tema of Object.keys(TEMAS)) { assert.ok(LINK[tema], tema + ': falta --link'); minimo(tema, LINK[tema], FUNDOS, 4.5, 'link'); }
  const regra = /(?:^|\n)\.msg-body a\{([^}]*)\}/.exec(STYLE);
  assert.ok(regra, 'falta .msg-body a');
  assert.match(regra[1], /^color:var\(--link\);text-decoration:underline;/);
});

/* R6-02. Antes: #25283a sobre --canvas = 1,44:1 no Preto e 1,22:1 no Azul. */
test('cartão do conector com os tokens do tema: legível nos 6 jeitos de pintar e sem cor clara fixa (R6-02, R6-09)', () => {
  const css = ler('connector-prompts.css');
  for (const v of ['--bg-elevated', '--text', '--border', '--accent-soft']) assert.doesNotMatch(css, new RegExp('var\\(' + v + '[,)]'), v);
  for (const cru of ['#fbfaf7', '#25283a', '#ddd8cd', '#d8d3c8', '#eeece6', '#e6e7f3', '#5865d8']) assert.ok(!css.includes(cru), 'cor fixa ' + cru);
  assert.match(css, /\.connector-prompt,\.connector-host-action\{[^}]*background:var\(--raised\);color:var\(--ink\);border:1px solid var\(--line-strong\)/);
  for (const tema of Object.keys(TEMAS)) minimo(tema, tok(tema, '--ink'), ['--raised'], 4.5, 'texto do cartão');
  assert.match(css, /\.connector-message,\.connector-path\{user-select:text;cursor:text\}/, 'a mensagem do conector se copia');
});

/* R6-06 e R6-07. Antes: 30 usos de 6 variáveis que não existem (border com var() inválido vira none). */
const SEM_DONO = ['--border', '--text', '--text2', '--muted', '--bg-elevated', '--accent-soft'];
const COM_RESERVA = new Set(['--danger', '--mac-ilha-w', '--selection', '--warn', '--warning']);   // têm valor de reserva; ficam
test('nenhuma regra usa variável de cor que não existe (R6-06, R6-07)', () => {
  const dir = path.join(__dirname, '../src/renderer');
  const css = fs.readdirSync(dir).filter((f) => f.endsWith('.css')).map((f) => [f, ler(f)]);
  const js = fs.readdirSync(dir).filter((f) => /\.(js|html)$/.test(f)).map((f) => ler(f)).join('\n');
  const definidas = new Set();
  for (const [, t] of css) for (const m of t.matchAll(/(--[\w-]+)\s*:/g)) definidas.add(m[1]);
  for (const m of js.matchAll(/['"`](--[\w-]+)['"`]/g)) definidas.add(m[1]);
  for (const m of js.matchAll(/(--[\w-]+)\s*:/g)) definidas.add(m[1]);
  const faltam = [];
  for (const [f, t] of css) for (const m of t.matchAll(/var\(\s*(--[\w-]+)/g)) if (!definidas.has(m[1]) && !COM_RESERVA.has(m[1])) faltam.push(f + ': ' + m[1]);
  assert.deepEqual(faltam, []);
  for (const [f, t] of css) for (const v of SEM_DONO) assert.doesNotMatch(t, new RegExp('var\\(' + v + '[,)]'), f + ' ainda usa ' + v);
});

/* R6-06. Antes: #929399 (a reserva do --muted) sobre --sunken = 2,49:1 no Claro, 2,42:1 no Jornal, 2,53:1 no Automático claro.
   Leva 5e: a lateral deixou de ser o --sunken e é o --side (superfície própria, distinta do fundo); o --sunken segue na conta porque
   ainda é o fundo do código e das saídas de ferramenta. A lateral de vidro do visual Mac está em contraste-painel-fundo.test.js. */
test('título de período do histórico: --ink-muted em 11 px, 4,5:1 sobre a lateral em todo tema (R6-06)', () => {
  const regra = /\.ck-history-period \{([^}]*)\}/.exec(UI);
  assert.match(regra[1], /color: var\(--ink-muted\);/);
  assert.match(regra[1], /font-size: 11px;/);
  assert.match(UI, /\n\.ck-navigator \{[^}]*background: var\(--side\);/, 'a lateral é o --side');
  for (const tema of Object.keys(TEMAS)) minimo(tema, tok(tema, '--ink-muted'), ['--side', '--sunken'], 4.5, 'título de período');
});

/* R6-08. Antes (Automático claro): --control-border rgba(0,0,0,.16) = 1,45:1 sobre --canvas; --ink-faint #8a8a8e = 3,08:1;
   --attention #ff9500 = 2,20:1 sobre --raised; --done #28a745 = 3,13:1. Escuro: --control-border rgba(255,255,255,.2) = 1,89:1. */
test('Automático: borda de controle 3:1; texto fraco, atenção e concluído 4,5:1 (R6-08)', () => {
  for (const lado of ['automático claro', 'automático escuro']) minimo(lado, tok(lado, '--control-border'), FUNDOS, 3, '--control-border');
  for (const n of ['--ink-faint', '--attention', '--done']) minimo('automático claro', tok('automático claro', n), FUNDOS, 4.5, n);
  // o selo de pendências (.ck-attention-count) pinta o texto --on-attention sobre o fundo --attention: o #1a0e00 do tom antigo
  // (#ff9500, 8,63:1) cai para 3,59:1 no tom novo; o branco dá 5,28:1, como no Claro e no Jornal
  minimo('automático claro', tok('automático claro', '--on-attention'), ['--attention'], 4.5, '--on-attention (selo de pendências)');
});

/* R6-03. Antes: no Automático claro o --cod caía no #e6c07b do escuro (1,38:1 sobre o fundo do código) e o --rot-falha no #3a2222
   (1,15:1 com o texto); as regras "de tema claro" só olhavam a lista claro/jornal. */
test('Automático claro tem as cores das peças antigas, e as regras de tema claro seguem a luz, não a lista de temas (R6-03)', () => {
  // 2a rodada da leva 5e: ele tem essas peças por ser apelido do Claro. O seletor dele divide o bloco do Claro no style.css, com o
  // :where() que mantém o peso (0,1,1) do bloco do Claro (com o peso normal os nomes velhos de baixo ganhariam do tokens.css).
  assert.ok(STYLE.includes('html:where([data-mac-luz="claro"])[data-tema="automatico"],\nhtml[data-tema="claro"]{'), 'o Automático claro divide o bloco do Claro no style.css');
  assert.ok(STYLE.includes('html[data-tema="automatico"][data-mac-luz="claro"] .p-motor{'), 'o botão de motor do Claro vale para o Automático claro');
  for (const n of ['--cod', '--rot-falha', '--rot-falha-borda', '--puxador', '--link']) assert.ok(hex(CLARO_STYLE, n), 'falta ' + n);
  // o --hover2 do código inline sobre o painel (o --raised do Claro); era 5 % de preto sobre o --canvas #f2f2f7 do Automático antigo
  const fundoDoCodigo = sobre(camada(TEMAS['automático claro'], '--hover'), tok('automático claro', '--raised'));
  const cod = contraste(hex(CLARO_STYLE, '--cod'), fundoDoCodigo);
  assert.ok(cod >= 4.5, '--cod: ' + cod.toFixed(2));
  assert.ok(contraste(tok('automático claro', '--ink'), hex(CLARO_STYLE, '--rot-falha')) >= 4.5, 'texto na caixa de rotina quebrada');
  for (const sel of ['body', '.msg-body pre', '.msg-body code', '.act', '.ef-thumb', '.co-pt.off'])
    assert.ok(STYLE.includes('html[data-mac-luz="claro"] ' + sel + '{'), 'regra de tema claro pela luz: ' + sel);
  assert.match(STYLE, /html:not\(\[data-mac-luz="claro"\]\) \.fluxo-svg svg\{filter:invert/);
  assert.match(UI, /html\[data-mac-luz="claro"\] \.ck-brand \.ck-brand-light \{\s*display: block;/);
  assert.match(UI, /html\[data-mac-luz="claro"\] \.ck-brand \.ck-brand-dark \{\s*display: none;/);
});

/* Rodada final da leva 5 (item 4). O código inline (.msg-body code) é --cod sobre o --hover2 do .pane-chat: o --hover2 é o --hover
   (tokens.css) e o .pane-chat era --canvas, ou --raised no visual Mac. Antes (medido no Chrome headless com o CSS real, igual à conta
   daqui): Jornal #b58900 = 2,50:1 (2,79:1 no visual Mac) e Claro #a4552a = 4,38:1 (4,95:1).
   Leva 5e: o painel é o --raised nos dois estados (sem o visual Mac era o --canvas, a mesma cor do fundo: 1,00:1 do painel contra o
   fundo); então os dois estados medem sobre o --raised, e o teste confere a regra nova do .pane-chat em vez da velha. */
const TOKENS = ler('tokens.css'), MAC = ler('visual-mac.css');
function camada(b, nome) {
  const m = new RegExp('(?:^|[;{\\s])' + nome + ':\\s*([^;]+);').exec(b);
  assert.ok(m, 'falta ' + nome);
  const v = m[1].trim();
  let p = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(v);
  if (p) return [parseInt(p[1], 16), parseInt(p[2], 16), parseInt(p[3], 16), p[4] ? parseInt(p[4], 16) / 255 : 1];
  p = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(v);
  assert.ok(p, nome + ' num formato que a conta não lê: ' + v);
  return [+p[1], +p[2], +p[3], p[4] === undefined ? 1 : +p[4]];
}
const sobre = ([r, g, b, a], fundo) => '#' + [r, g, b].map((c, i) => Math.round(c * a + parseInt(fundo.slice(1 + 2 * i, 3 + 2 * i), 16) * (1 - a)).toString(16).padStart(2, '0')).join('');
const COD = { escuro: hex(RAIZ, '--cod'), azul: hex(RAIZ, '--cod'), claro: hex(CLARO_STYLE, '--cod'),
  jornal: hex(bloco(STYLE, 'html[data-tema="jornal"]{'), '--cod'), 'automático claro': hex(CLARO_STYLE, '--cod'), 'automático escuro': hex(RAIZ, '--cod') };
test('código inline (--cod) passa de 4,5:1 sobre o fundo real nos 6 jeitos de pintar, com e sem o visual Mac (final, item 4)', () => {
  // as regras que a conta segue: se uma mudar, o teste avisa em vez de medir sobre o fundo errado
  assert.match(STYLE, /\n\.msg-body code\{[^}]*background:var\(--hover2\);[^}]*color:var\(--cod\)\}/);
  assert.ok(TOKENS.includes('--hover2:var(--hover)'), 'o --hover2 é o --hover do tema');
  assert.match(UI, /\.ck-app \.pane-chat \{[^}]*background: var\(--raised\);/);
  assert.match(MAC, /html\.visual-mac \.ck-app \.pane-chat \{ background: var\(--raised\); \}/);
  for (const m of MAC.matchAll(/(?:^|\n)(html\.visual-mac[^\s{,]*) \{([^}]*)\}/g))
    for (const n of ['--raised', '--hover', '--cod']) assert.doesNotMatch(m[2], new RegExp('(?:^|[;{\\s])' + n + ':'), m[1] + ' muda ' + n + ': a conta precisa dele');
  for (const tema of Object.keys(TEMAS)) {
    assert.ok(COD[tema], tema + ': falta --cod');
    for (const [fundo, onde] of [['--raised', 'sem o visual Mac'], ['--raised', 'no visual Mac']]) {
      const r = contraste(COD[tema], sobre(camada(TEMAS[tema], '--hover'), tok(tema, fundo)));
      assert.ok(r >= 4.5, tema + ' ' + onde + ': --cod ' + COD[tema] + ' = ' + r.toFixed(2) + ':1 (mínimo 4,5)');
    }
  }
});

/* Decisão 11 (divisória -> --line). Onda 1, correção: as 3 divisórias do experiments.css (linha da nuvem, artefato e mensagem do
   histórico) usavam --border, que não existia (a linha não aparecia). A T2 as pôs em --control-border (3:1, borda de controle):
   a linha passou a aparecer mais forte do que as divisórias do resto do app. Divisória é --line, como o .exp-nav ao lado. */
test('divisórias da nuvem, dos artefatos e do histórico de agente usam --line, não a borda de controle (Decisão 11)', () => {
  const css = ler('experiments.css');
  const corpo = (seletor) => {
    const i = css.indexOf(seletor + ' {');
    assert.ok(i >= 0, 'falta a regra ' + seletor);
    return css.slice(i, css.indexOf('}', i));
  };
  for (const seletor of ['.exp-cloud-row,.exp-artifact', '.co-history-message']) {
    const regra = corpo(seletor);
    assert.match(regra, /border-bottom:1px solid var\(--line\);/, seletor + ': divisória em --line');
    assert.doesNotMatch(regra, /--control-border/, seletor + ': sem a borda de controle');
  }
  assert.match(corpo('.exp-nav'), /border-bottom:1px solid var\(--line\);/, 'a divisória do .exp-nav continua em --line');
});
