'use strict';
/* Leva 4, Tarefa 4 (UI 3.1 chip, UI 3.5 permissão no chip, R1-09). Medidas:
   - elementos criados por um nome de modelo com marcação (antes 1, o <b>; depois 0: entra escapado);
   - controles de permissão na barra (antes 1, o .p-modo; depois 0: a permissão mora no chip);
   - texto do chip do Opus 5.5 (antes "Opus 5.5" com o ícone do cérebro; depois "o5.5").
   Leva 5b (decisão do Hugo, 07/10: sempre símbolos): a permissão deixou de ser uma PALAVRA e virou o ÍCONE do próprio modo
   (o `ic` de MODOS, o mesmo do menu Permissões). Medida: o chip do Opus 5.5 sem pedir permissão (antes "o5.5 · Livre", 1 palavra;
   depois "o5.5 · " + o SVG do unlock, 0 palavras).
   Leva 5f (decisão do Hugo, 07/10, depois de ver a prévia): o chip deixa de escrever a sigla e passa a mostrar SÓ o ícone de traço da
   família + o anel de peso (+ o ícone da permissão). Medida: texto do chip do Opus 5.5 (antes "o5.5", 4 caracteres; depois 0 caracteres:
   o ícone "music" e o anel "peso-3"). A sigla fica em MAIÚSCULA (O5.5), igual ao CLAUDE.md, e vai no hover com o peso e a cota.
   Leva 5h (seções 1 e 4 da spec, decisão do Hugo em 08/10): o chip deixa de ser UM botão e vira um GRUPO de 3 botões, cada um com o seu menuzinho:
   [logo do motor] · [família + anel] · [permissão] ▾. O .p-model agora é o grupo (role="group"); os três botões moram no molde e NÃO são reescritos:
   o fillModels escreve só o do meio (.pm-modelo), o pintarModo só o da permissão (.pm-perm, com o .pm-modo dentro) e o pintarBotaoDeMotor o do
   motor (.pm-motor). Por que persistentes e não um innerHTML do grupo inteiro a cada fillModels: o foco, o ouvinte e o botão que abriu o menuzinho
   (para onde o Esc devolve o foco) continuam os mesmos depois de trocar de modelo; e cada pintor segue dono do seu pedaço.
   O que mudou NESTE arquivo, e por quê:
   - o chip() de mentira agora devolve o botão do meio (.pm-modelo): o texto dele é só a família e o anel (ou a sigla de quem não tem ícone);
     a permissão saiu daquele texto, porque agora é outro botão (os testes de permissão rodam o pintarModo de verdade);
   - o sufixo do hover do modelo passou de " — modelo, esforço, permissões e o envio" (o que o chip inteiro abria) para " — modelo e esforço";
     o nome acessível agora nasce pronto no fillModels ("Modelo: …"), e não mais no decoratePane;
   - o Grok ganhou o ícone do único modo dele (sliders-horizontal): com um botão para cada menuzinho, um botão VAZIO seria um alvo invisível,
     e é por ele que se chega ao Entra/Fila;
   - o CSS do chip mudou de dono: o ▾ é do botão da permissão, o espaço entre a família e o anel é do botão do meio, e o teto de largura saiu
     do grupo (quem encolhe, com elipse, é a sigla do botão do meio). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { lerFonte, pegarBloco, globaisFalsos } = require('../testes/raiz');
const Modelos = require('../src/renderer/model-presentation');

const APP = lerFonte('renderer', 'app.js');
const UI = lerFonte('renderer', 'cockpit-ui.js');
const HTML = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8').replace(/\r\n/g, '\n');   // leva 5h: LF, como o lerFonte (os recortes do molde contam linhas)
const CSS_UI = lerFonte('renderer', 'cockpit-ui.css');
const CSS_BASE = lerFonte('renderer', 'style.css');
const CSS_MAC = lerFonte('renderer', 'visual-mac.css');

/* corpo da regra de topo cujo seletor é exatamente "seletor" (o lerFonte já entrega o css com LF) */
function corpoDaRegra(css, seletor) {
  const esc = seletor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp('(?:^|\\n)' + esc + '\\s*\\{([^}]*)\\}').exec(css);
  assert.ok(m, 'não achei a regra ' + seletor);
  return m[1];
}

/* o ico() do app.js com o NOME do ícone à vista: o teste confere qual ícone entrou, sem depender do desenho */
const icoFalso = (n) => '<svg data-ic="' + n + '"></svg>';

/* janela: o `window` do contexto. Por padrão o CockpitModels de verdade; os testes de "sem o CockpitModels" passam outro.
   Devolve o botão do MEIO do chip (.pm-modelo): o que o fillModels escreve (innerHTML, title e o nome acessível, via ariaLabel). */
function chip(P, modelos, janela = { CockpitModels: Modelos }) {
  const botao = { innerHTML: '', title: '', ariaLabel: '' };
  const ctx = vm.createContext({ window: janela, ico: icoFalso, EF_DESC_PT: {},
    $: (sel) => (sel === '.pm-modelo' ? botao : null), modelosDe: () => modelos, modeloAtual: () => modelos[0], esforcosDe: () => [{ id: 'medium' }] });
  vm.runInContext(pegarBloco(APP, 'function fillModels(', 'fillModels'), ctx);
  ctx.fillModels(P);
  return botao;
}
/* O botão da permissão (.pm-perm) com o span .pm-modo dentro, como no molde: o pintarModo escreve nos dois. `perm` é o botão. */
function montarModo() {
  const permissao = { innerHTML: '', className: '', title: '' };
  const perm = { title: '', ariaLabel: '' };
  const ctx = vm.createContext({ ...globaisFalsos(), cfg: { defMode: 'manual' }, remotoDoPane: () => null, ico: icoFalso,
    $: (sel) => (sel === '.pm-modo' ? permissao : sel === '.pm-perm' ? perm : null) });
  const bloco = (ass, nome) => pegarBloco(APP, ass, nome).replace(/^const /, 'var ');
  vm.runInContext([bloco('const MODOS = {', 'MODOS') + ';', bloco('const modoDe = (P) => {', 'modoDe') + ';',
    ...['modoValido', 'ajeitarModoRemoto', 'pintarModo'].map((f) => pegarBloco(APP, 'function ' + f + '(', f))].join('\n'), ctx);
  return { ctx, permissao, perm };
}
function modo(P) {
  const { ctx, permissao } = montarModo();
  ctx.pintarModo(P);
  return permissao;
}

/* Leva 5f: a sigla do Claude passa a sair em MAIÚSCULA (H5, S5.5, O5.5, F5.1), igual ao rodapé "Use:" do CLAUDE.md. Antes o short()
   devolvia "h5", "s5.5", "o5.5", "f5.1". Os outros motores seguem com o nome curto, que nunca foi mexido. */
test('sigla do chip: a do rodapé "Use:" no Claude, em MAIÚSCULA como no CLAUDE.md; o nome curto nos outros (UI 3.1, leva 5f)', () => {
  assert.equal(typeof Modelos.short, 'function', 'falta CockpitModels.short');
  const s = (id, engine = 'claude', nome) => Modelos.short({ id, nome }, engine);
  assert.deepEqual(['claude-opus-5-5', 'claude-opus-5-5[1m]', 'claude-sonnet-5', 'claude-fable-5-1', 'claude-opus-5', 'claude-haiku-4-5-20251001',
    'claude-sonnet-5-5', 'claude-haiku-4-5', 'claude-sonnet-5-5[1m]', 'claude-fable-5'].map((id) => s(id)),
    ['O5.5', 'O5.5', 'S5', 'F5.1', 'O5', 'H5', 'S5.5', 'H5', 'S5.5', 'F5']);
  assert.equal(s('gpt-6-astra', 'codex', 'GPT-6-Astra'), 'GPT‑6 Astra');
  assert.equal(s('gemini-3.1-pro', 'gemini', 'Gemini 3.1 Pro'), 'Gemini 3.1 Pro');
  // id do Claude fora do padrão: o nome do catálogo, como sempre, sem virar maiúscula
  assert.equal(s('claude-instant-1', 'claude', 'Instant do catálogo'), 'Instant do catálogo');
});

/* Leva 5f: a tabela de identidade que o Hugo aprovou em 07/10 (spec 2026-10-07-icones-por-modelo-design.md, prévia B3). Cada linha:
   motor, id no catálogo, nome no catálogo, família, NOME do ícone em ICONES (app.js), peso 1 a 4, sigla (só o Claude tem) e o começo do hover
   (nome, sigla, "peso N de 4", cota). O peso vem da classe de cota do quota(): Haiku 1, Sonnet 2, Opus 3, Luna 1, Sol 2, Astra 3; Fable 4
   pela descrição do Cockpit e Terra 2 por estimativa. No Fable e no Terra o quota() não compara (label "Cota sem comparação"). */
const SUFIXO_DO_HOVER = ' — modelo e esforço';   // leva 5h: era " — modelo, esforço, permissões e o envio" (o que o chip inteiro abria); agora só o que o botão do meio abre
const SUFIXO_DA_PERMISSAO = ' — permissões e o envio';   // leva 5h: o que o botão da permissão abre (os modos e o Entra/Fila)
const TABELA = [
  ['claude', 'claude-haiku-4-5-20251001', 'Haiku 4.5', 'haiku', 'leaf', 1, 'H5', 'Haiku 4.5 (H5) · peso 1 de 4 · Cota menor'],
  ['claude', 'claude-sonnet-5-5', 'Sonnet 5.5', 'sonnet', 'feather', 2, 'S5.5', 'Sonnet 5.5 (S5.5) · peso 2 de 4 · Cota média'],
  ['claude', 'claude-opus-5-5', 'Opus 5.5', 'opus', 'music', 3, 'O5.5', 'Opus 5.5 (O5.5) · peso 3 de 4 · Cota maior'],
  ['claude', 'claude-fable-5-1', 'Fable 5.1', 'fable', 'fox', 4, 'F5.1', 'Fable 5.1 (F5.1) · peso 4 de 4 · Cota sem comparação'],
  ['codex', 'gpt-6-luna', 'GPT-6-Luna', 'luna', 'moon', 1, '', 'GPT-6-Luna · peso 1 de 4 · Cota menor'],
  ['codex', 'gpt-6.1-sol', 'GPT-6.1-Sol', 'sol', 'sun', 2, '', 'GPT-6.1-Sol · peso 2 de 4 · Cota média'],
  ['codex', 'gpt-5.6-terra', 'GPT-5.6-Terra', 'terra', 'globe', 2, '', 'GPT-5.6-Terra · peso 2 de 4 · Cota sem comparação'],
  ['codex', 'gpt-6-astra', 'GPT-6-Astra', 'astra', 'star', 3, '', 'GPT-6-Astra · peso 3 de 4 · Cota maior'],
];

const LINHAS = TABELA.map(([engine, id, nome, familia, icone, peso, sigla, hover]) => ({ engine, id, nome, familia, icone, peso, sigla, hover }));

test('familia(): os 8 modelos da tabela do Hugo dão família, ícone de traço, peso e sigla (leva 5f)', () => {
  assert.equal(typeof Modelos.familia, 'function', 'falta CockpitModels.familia');
  assert.equal(LINHAS.length, 8);
  for (const { engine, id, familia, icone, peso, sigla } of LINHAS) {
    assert.deepEqual(Modelos.familia({ id }, engine), { familia, icone, peso, sigla }, engine + '/' + id);
  }
});

test('familia(): a versão 1M, o Haiku com data no id e as outras versões da família caem na mesma família (leva 5f)', () => {
  const f = (id, engine = 'claude') => Modelos.familia({ id }, engine);
  assert.deepEqual(f('claude-opus-5-5[1m]'), f('claude-opus-5-5'));
  assert.deepEqual(f('claude-sonnet-5-5[1m]'), f('claude-sonnet-5-5'));
  assert.deepEqual(f('claude-fable-5-1[1m]'), f('claude-fable-5-1'));
  assert.deepEqual(f('claude-haiku-4-5'), f('claude-haiku-4-5-20251001'));
  assert.equal(f('claude-haiku-4-5').sigla, 'H5');
  // outras versões do catálogo: o mesmo ícone e o mesmo peso; só a sigla acompanha a versão
  assert.deepEqual(f('claude-sonnet-5'), { familia: 'sonnet', icone: 'feather', peso: 2, sigla: 'S5' });
  assert.deepEqual(f('claude-opus-5[1m]'), { familia: 'opus', icone: 'music', peso: 3, sigla: 'O5' });
  assert.deepEqual(f('claude-fable-5'), { familia: 'fable', icone: 'fox', peso: 4, sigla: 'F5' });
  for (const id of ['gpt-6-luna', 'gpt-5.6-luna']) assert.equal(f(id, 'codex').familia, 'luna', id);
  for (const id of ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-5.6-sol']) assert.equal(f(id, 'codex').familia, 'sol', id);
  // o id resolvido manda, como no quota() (o canonical() é o mesmo): "opus" que o Claude resolveu para o 5.5
  assert.deepEqual(Modelos.familia({ id: 'opus', resolvedModel: 'claude-opus-5-5' }, 'claude'), { familia: 'opus', icone: 'music', peso: 3, sigla: 'O5.5' });
});

test('familia(): id fora da tabela, outros motores e entradas vazias dão null, sem ícone inventado (leva 5f)', () => {
  const fora = [
    ['claude', 'claude-instant-1'], ['claude', 'claude-opus'], ['claude', ''],
    ['codex', 'gpt-5.5'], ['codex', 'gpt-6'], ['codex', ''], ['codex', 'padrão do Codex'],
    ['gemini', 'gemini-3.1-pro'], ['gemini', ''], ['grok', 'grok-4'], ['grok', ''],
    ['acp', 'gemini --acp'], ['acp', 'npx -y @zed-industries/claude-code-acp'], ['acp', 'npx -y @zed-industries/codex-acp'],
    // o id de um motor não vale em outro: o ícone segue o motor do painel, não o nome do id
    ['codex', 'claude-opus-5-5'], ['claude', 'gpt-6-astra'], ['gemini', 'claude-opus-5-5'], ['gemini', 'gpt-6-astra'], ['grok', 'gpt-6-sol'],
  ];
  for (const [engine, id] of fora) assert.equal(Modelos.familia({ id }, engine), null, engine + '/' + id);
  assert.equal(Modelos.familia(undefined, 'claude'), null);
  assert.equal(Modelos.familia(null, 'codex'), null);
  assert.equal(Modelos.familia({}, 'claude'), null);
  assert.equal(Modelos.familia({ id: 'claude-opus-5-5' }), null, 'sem o motor não adivinha');
  // cada chamada devolve um objeto novo: mexer no de um chip não estraga o dos outros
  const a = Modelos.familia({ id: 'claude-opus-5-5' }, 'claude');
  a.peso = 99; a.icone = 'x';
  assert.deepEqual(Modelos.familia({ id: 'claude-opus-5-5' }, 'claude'), { familia: 'opus', icone: 'music', peso: 3, sigla: 'O5.5' });
});

/* Leva 5f, auditoria rodada 2: o hover escrevia "peso leve/médio/alto/máximo", as MESMAS palavras do seletor de Esforço (Leve, Médio, Alto,
   Máximo): na mesma linha do hover, o peso fixo do modelo parecia o esforço de raciocínio da sessão. Agora o peso sai como "N de 4"
   ("peso 2 de 4"), sem palavra nenhuma que o seletor de Esforço também use. */
test('peso em texto: "1 de 4" a "4 de 4", nunca as palavras do seletor de Esforço (Leve, Médio, Alto, Máximo); fora disso, vazio (leva 5f)', () => {
  assert.equal(typeof Modelos.pesoPorExtenso, 'function', 'falta CockpitModels.pesoPorExtenso');
  assert.deepEqual([1, 2, 3, 4].map((n) => Modelos.pesoPorExtenso(n)), ['1 de 4', '2 de 4', '3 de 4', '4 de 4']);
  for (const n of [1, 2, 3, 4]) assert.doesNotMatch(Modelos.pesoPorExtenso(n), /leve|médio|alto|máximo/i, 'o peso não usa as palavras do esforço: ' + n);
  assert.deepEqual([0, 5, -1, 2.5, null, undefined, 'x', '2'].map((n) => Modelos.pesoPorExtenso(n)), ['', '', '', '', '', '', '', '']);
});

test('nome do modelo com marcação entra como texto no chip (R1-09)', () => {
  const nome = '<b onmouseover="x()">falso</b>';
  const b = chip({ engine: 'acp', model: 'acp-x', effort: 'medium', el: {} }, [{ id: 'acp-x', nome, efforts: [] }]);
  assert.doesNotMatch(b.innerHTML, /<b[\s>]/, 'virou elemento: ' + b.innerHTML);
  assert.match(b.innerHTML, /&#60;b onmouseover=&#34;x\(\)&#34;&#62;falso&#60;\/b&#62;/);
  assert.ok(b.title.startsWith(nome), 'o title (texto puro) leva o nome inteiro');
});

/* Leva 5f: antes este teste fixava '<span class="pm-sigla">o5.5</span>' (a sigla em minúscula escrita no chip). Agora o Opus 5.5 é um modelo da
   tabela: o chip leva o ícone da família (music) e o anel do peso 3, e a sigla só aparece no hover. */
test('o botão do meio mostra SÓ o ícone da família e o anel de peso; nome, sigla, peso e cota vão no hover e no nome acessível (UI 3.1 e leva 5f, 5h)', () => {
  const P = { engine: 'claude', model: 'claude-opus-5-5', effort: 'medium', el: {} };
  const b = chip(P, [{ id: 'claude-opus-5-5', nome: 'Opus 5.5', efforts: ['medium'] }]);
  assert.equal(b.innerHTML, '<span class="pm-familia"><svg data-ic="music"></svg></span><span class="pm-peso"><svg data-ic="peso-3"></svg></span>',
    'leva 5h: a permissão saiu daqui (é outro botão, ver o pintarModo)');
  assert.doesNotMatch(b.innerHTML, /pm-modo|Livre|Pergunta|Edita|Auto/, 'a permissão não mora no botão do modelo');
  assert.doesNotMatch(b.innerHTML, /pm-sigla|O5\.5|o5\.5|Opus/, 'nem a sigla nem o nome no chip');
  assert.equal(b.title, 'Opus 5.5 (O5.5) · peso 3 de 4 · Cota maior' + SUFIXO_DO_HOVER);
  assert.equal(b.ariaLabel, 'Modelo: Opus 5.5 (O5.5) · peso 3 de 4 · Cota maior', 'o nome acessível é o hover sem o sufixo do que o botão faz');
});

test('botão do meio dos 8 modelos da tabela: SÓ o ícone da família e o anel de peso; nenhum caractere de texto (leva 5f)', () => {
  for (const { engine, id, nome, icone, peso } of LINHAS) {
    const P = { engine, model: id, effort: 'medium', el: {} };
    const b = chip(P, [{ id, nome, efforts: ['medium'] }]);
    assert.equal(b.innerHTML, '<span class="pm-familia">' + icoFalso(icone) + '</span><span class="pm-peso">' + icoFalso('peso-' + peso) + '</span>', engine + '/' + id);
    // tirando as tags (os atributos vão junto), não sobra um caractere: o chip é só símbolo
    assert.equal(b.innerHTML.replace(/<[^>]*>/g, ''), '', 'o chip não escreve sigla nem nome: ' + id);
  }
});

test('hover do botão do meio: o nome inteiro, a sigla, o peso ("peso N de 4") e a cota; sem sigla (Codex), só o nome (leva 5f)', () => {
  for (const { engine, id, nome, hover } of LINHAS) {
    const b = chip({ engine, model: id, effort: 'medium', el: {} }, [{ id, nome, efforts: ['medium'] }]);
    assert.equal(b.title, hover + SUFIXO_DO_HOVER, engine + '/' + id);
    assert.equal(b.ariaLabel, 'Modelo: ' + hover, engine + '/' + id + ': o leitor de tela lê o mesmo, sem o sufixo');
  }
});

test('chip do 1M: a mesma família e o mesmo peso; o hover leva o nome com o (1M) (leva 5f)', () => {
  const b = chip({ engine: 'claude', model: 'claude-opus-5-5[1m]', effort: 'medium', el: {} }, [{ id: 'claude-opus-5-5[1m]', nome: 'Opus 5.5 (1M)', efforts: ['medium'] }]);
  assert.match(b.innerHTML, /^<span class="pm-familia"><svg data-ic="music"><\/svg><\/span><span class="pm-peso"><svg data-ic="peso-3"><\/svg><\/span>/);
  assert.equal(b.title, 'Opus 5.5 (1M) (O5.5) · peso 3 de 4 · Cota maior' + SUFIXO_DO_HOVER);
});

test('chip fora da tabela fica como era: o texto curto ou o nome, sem ícone de família nem anel inventados (leva 5f)', () => {
  const casos = [
    // motor, id, nome no catálogo, o texto que o chip escreve
    ['gemini', 'gemini-3.1-pro', 'Gemini 3.1 Pro', 'Gemini 3.1 Pro'],
    ['grok', '', 'padrão do Grok', 'padrão do Grok'],
    ['acp', 'gemini --acp', 'Gemini (ACP)', 'Gemini (ACP)'],
    ['codex', 'gpt-5.5', 'GPT-5.5', 'GPT‑5.5'],
    ['claude', 'claude-instant-1', 'Instant 1', 'Instant 1'],
  ];
  for (const [engine, id, nome, texto] of casos) {
    const b = chip({ engine, model: id, effort: 'medium', el: {} }, [{ id, nome, efforts: ['medium'] }]);
    assert.equal(b.innerHTML, '<span class="pm-sigla">' + texto + '</span>', engine + '/' + id);
    assert.equal(b.title, nome + SUFIXO_DO_HOVER, 'o hover não ganha peso nem cota de quem não tem peso: ' + id);
    assert.equal(b.ariaLabel, 'Modelo: ' + nome, id);
  }
});

test('modelo da família que sumiu do catálogo ("indisponível") fica no texto de sempre, sem ícone nem peso (leva 5f)', () => {
  const P = { engine: 'claude', model: 'claude-opus-4-8', effort: 'high', resumeId: 'S2', el: {} };
  const b = chip(P, [{ id: 'claude-sonnet-5-5', nome: 'Sonnet 5.5', efforts: ['medium'] }]);
  assert.equal(b.innerHTML, '<span class="pm-sigla">claude-opus-4-8 (indisponível)</span>');
  assert.equal(b.title, 'claude-opus-4-8 (indisponível)' + SUFIXO_DO_HOVER);
});

test('modelo preservado de conversa viva (em uso, mas fora do catálogo novo) mostra a identidade da família (leva 5f)', () => {
  // o withCurrent() devolve a entrada com preserved: true: o modelo ESTÁ na lista, então não é "indisponível"
  const P = { engine: 'claude', model: 'claude-opus-4-8', effort: 'high', resumeId: 'S2', el: {} };
  const b = chip(P, [{ id: 'claude-opus-4-8', nome: 'claude-opus-4-8', efforts: [], preserved: true }]);
  assert.match(b.innerHTML, /^<span class="pm-familia"><svg data-ic="music"><\/svg><\/span><span class="pm-peso"><svg data-ic="peso-3"><\/svg><\/span>/);
  assert.equal(b.title, 'claude-opus-4-8 (O4.8) · peso 3 de 4 · Cota maior' + SUFIXO_DO_HOVER);
});

test('nome ou id hostil de um modelo da tabela: o chip só tem os ícones fixos e o hover guarda o nome como texto puro (R1-09, leva 5f)', () => {
  const nome = '<img src=x onerror="x()">';
  const a = chip({ engine: 'claude', model: 'claude-opus-5-5', effort: 'medium', el: {} }, [{ id: 'claude-opus-5-5', nome, efforts: ['medium'] }]);
  assert.doesNotMatch(a.innerHTML, /<img|onerror/, a.innerHTML);
  assert.ok(a.title.startsWith(nome + ' (O5.5) · peso 3 de 4'), a.title);
  // o id também vem de fora: só a família e a sigla (dígitos) saem dele, e o desenho é sempre o da tabela
  const id = 'claude-opus-5-5"><img src=x onerror="x()">';
  const b = chip({ engine: 'claude', model: id, effort: 'medium', el: {} }, [{ id, nome: 'Opus', efforts: ['medium'] }]);
  assert.doesNotMatch(b.innerHTML, /<img|onerror/, b.innerHTML);
  assert.match(b.innerHTML, /^<span class="pm-familia"><svg data-ic="music"><\/svg><\/span><span class="pm-peso"><svg data-ic="peso-3">/);
});

test('sem o CockpitModels (ou sem o familia()), o chip mostra o texto de antes e o hover de antes (leva 5f)', () => {
  const ms = [{ id: 'claude-opus-5-5', nome: 'Opus 5.5', efforts: ['medium'] }];
  const painel = () => ({ engine: 'claude', model: 'claude-opus-5-5', effort: 'medium', el: {} });
  const sem = chip(painel(), ms, {});
  assert.match(sem.innerHTML, /^<span class="pm-sigla">Opus 5\.5<\/span>/);
  assert.equal(sem.title, 'Opus 5.5' + SUFIXO_DO_HOVER);
  const velho = chip(painel(), ms, { CockpitModels: { short: Modelos.short } });
  assert.match(velho.innerHTML, /^<span class="pm-sigla">O5\.5<\/span>/);
  assert.equal(velho.title, 'Opus 5.5' + SUFIXO_DO_HOVER);
});

/* Leva 5h: o Grok tinha o chip da permissão VAZIO (sem ícone, sem pontinho): não há o que escolher, é o que estiver no config dele. Com um botão
   para cada menuzinho, um botão vazio seria um alvo invisível de 28 px, e é pelo menuzinho da permissão que se chega ao Entra/Fila. Agora o Grok
   mostra o ícone do único modo dele (sliders-horizontal, o `ic` de MODOS.grok), como todo outro motor mostra o do modo atual. */
test('Grok: a permissão mostra o ícone do único modo dele (sliders-horizontal), sem a cor de "sem pedir permissão", e o botão tem nome (UI 3.5, leva 5h)', () => {
  const { ctx, permissao, perm } = montarModo();
  const P = { engine: 'grok', mode: 'bypass', el: {} };
  ctx.pintarModo(P);
  assert.equal(permissao.innerHTML, icoFalso('sliders-horizontal'));
  assert.equal(permissao.className, 'pm-modo', 'o id do modo do Grok é bypass, mas ele não é "livre": a configuração é a dele');
  assert.equal(perm.ariaLabel, 'Permissão: O que estiver no Grok');
  assert.equal(perm.title, 'O que estiver no Grok: vale a configuração do próprio Grok, no ~/.grok/config.toml' + SUFIXO_DA_PERMISSAO);
});

test('permissão em ícone: cada motor e modo mostra o ícone do próprio modo; livre e rebaixado mantidos; o Grok também tem o dele (UI 3.5, leva 5h)', () => {
  const casos = [
    ['claude', 'manual', 'hand', ''], ['claude', 'auto-edit', 'code-xml', ''], ['claude', 'plan', 'clipboard-list', ''],
    ['claude', 'auto', 'wand-sparkles', ''], ['claude', 'bypass', 'unlock', 'livre'],
    ['codex', 'manual', 'hand', ''], ['codex', 'auto', 'wand-sparkles', ''], ['codex', 'revisado', 'sparkles', ''], ['codex', 'bypass', 'unlock', 'livre'],
    ['gemini', 'plan', 'clipboard-list', ''], ['gemini', 'auto', 'code-xml', ''], ['gemini', 'bypass', 'unlock', 'livre'],
    ['acp', 'manual', 'hand', ''], ['acp', 'auto-edit', 'code-xml', ''], ['acp', 'plan', 'clipboard-list', ''], ['acp', 'bypass', 'unlock', 'livre'],
    ['grok', 'bypass', 'sliders-horizontal', ''],
  ];
  for (const [engine, mode, icone, classe] of casos) {
    const P = { engine, mode, el: {} };
    const el = modo(P);
    assert.equal(el.innerHTML, icoFalso(icone), engine + '/' + mode);
    assert.equal(el.className, 'pm-modo' + (classe ? ' ' + classe : ''), engine + '/' + mode);
    assert.equal(P.uiIconeModo, icone, 'guardado no painel: ' + engine + '/' + mode);
  }
  // rebaixado: o motor subiu em Manual quando você pediu Plano -> o ícone é o do modo REAL, o estilo é o do rebaixado
  const { ctx, permissao, perm } = montarModo();
  const P = { engine: 'claude', mode: 'plan', modoReal: 'manual', el: {} };
  ctx.pintarModo(P);
  assert.equal(permissao.innerHTML, icoFalso('hand'), 'o ícone do modo real (Manual), não o do pedido (Plano)');
  assert.equal(permissao.className, 'pm-modo rebaixado');
  assert.equal(perm.title, 'Você pediu Plano; o motor subiu em Manual.' + SUFIXO_DA_PERMISSAO, 'o hover do botão (a leva 5h tirou o title do span de dentro)');
  assert.equal(perm.ariaLabel, 'Permissão: Manual (você pediu Plano)');
  assert.equal(P.uiIconeModo, 'hand');
  assert.equal(P.uiNomeModo, 'Manual');
});

/* Leva 5h: o hover e o nome acessível da permissão moram no BOTÃO (.pm-perm), não mais no span do ícone: com o span também tendo title, o hover
   mudava conforme o ponto do botão em que o mouse parava (dentro do ícone, o texto sem o sufixo; na folga, o texto com ele). */
test('o ícone do chip é o `ic` do menu Permissões e o nome inteiro é o do modo; o hover do botão segue "nome: descrição" (UI 3.5, leva 5h)', () => {
  const { ctx, permissao, perm } = montarModo();
  let vistos = 0;
  for (const [engine, lista] of Object.entries(ctx.MODOS)) {
    for (const m of lista) {
      const P = { engine, mode: m.id, el: {} };
      ctx.pintarModo(P);
      assert.equal(permissao.innerHTML, icoFalso(m.ic), engine + '/' + m.id);
      assert.equal(P.uiIconeModo, m.ic, engine + '/' + m.id);
      assert.equal(P.uiNomeModo, m.nome, 'o nome inteiro, não a palavra curta: ' + engine + '/' + m.id);
      assert.equal(perm.title, m.nome + ': ' + m.desc + SUFIXO_DA_PERMISSAO, 'o hover continua com o nome inteiro e a descrição: ' + engine + '/' + m.id);
      assert.equal(perm.ariaLabel, 'Permissão: ' + m.nome, engine + '/' + m.id);
      assert.equal(permissao.title, '', 'o span do ícone não tem hover próprio: ' + engine + '/' + m.id);
      vistos++;
    }
  }
  assert.ok(vistos >= 15, 'percorreu todos os modos de todos os motores: ' + vistos);
});

test('painel sem o botão da permissão (molde antigo) não quebra o pintarModo (leva 5h)', () => {
  const { ctx } = montarModo();
  ctx.$ = (sel) => (sel === '.pm-modo' ? { innerHTML: '', className: '', title: '' } : null);   // o span existe, o botão não
  assert.doesNotThrow(() => ctx.pintarModo({ engine: 'claude', mode: 'manual', el: {} }));
  ctx.$ = () => null;   // nem um nem outro
  assert.doesNotThrow(() => ctx.pintarModo({ engine: 'claude', mode: 'manual', el: {} }));
});

test('não sobrou a palavra da permissão: nem P.uiPalavraModo nem o mapa PALAVRAS (UI 3.5)', () => {
  // exec + equal (e não doesNotMatch): se falhar, a mensagem não despeja o app.js inteiro
  for (const [arquivo, fonte] of [['app.js', APP], ['cockpit-ui.js', UI]]) {
    const resto = /uiPalavraModo|\bPALAVRAS\b/.exec(fonte);
    assert.equal(resto, null, arquivo + ' ainda tem ' + (resto && resto[0]));
  }
  const P = { engine: 'claude', mode: 'bypass', el: {} };
  modo(P);
  assert.equal(P.uiPalavraModo, undefined);
});

test('todo ícone de modo existe em ICONES e usa a cor do texto: o chip nunca fica com um <svg> vazio (UI 3.5)', () => {
  // o trecho real do app.js: as tabelas de ícones e o ico(); o resto da página não entra
  const ini = APP.indexOf('const ICONES = '), fim = APP.indexOf('\n', APP.indexOf('const ico = (n) =>'));
  assert.ok(ini > 0 && fim > ini, 'não achei ICONES / ico no app.js');
  const real = vm.createContext({});
  vm.runInContext(APP.slice(ini, fim).replace('const ICONES = ', 'var ICONES = ').replace('const ico = ', 'var ico = '), real);
  const { ctx } = montarModo();
  for (const [engine, lista] of Object.entries(ctx.MODOS)) {
    for (const m of lista) {
      assert.ok(real.ICONES[m.ic], 'falta o ícone "' + m.ic + '" em ICONES (' + engine + '/' + m.id + ')');
      const svg = real.ico(m.ic);
      assert.match(svg, /^<svg [^>]*class="ic"[^>]*stroke="currentColor"[^>]*><(path|rect|circle|line)/, svg.slice(0, 120));
    }
  }
});

test('a barra não tem mais o botão de permissão (UI 3.5)', () => {
  assert.doesNotMatch(HTML, /class="modo-btn p-modo"|modo-nome|modo-ic/, 'o .p-modo saiu do modelo do painel');
  // newPane(opts = {}): o pegarBloco pararia no "{}" do parâmetro; o corpo vai até a seção das colunas (como em test/ajustes.test.js:426)
  const newPane = APP.slice(APP.indexOf('function newPane('), APP.indexOf('/* ===================== COLUNAS'));
  assert.ok(newPane.length > 1000, 'não achei o corpo do newPane');
  assert.doesNotMatch(newPane, /\$\('\.p-modo', el\)/);
  assert.doesNotMatch(UI, /\[\s*"\.p-modo",\s*"mode"\s*\]/, 'o attach não procura o .p-modo');
});

/* Leva 5h: a camada grande "Agente" saiu de cena. O Entra/Fila continua morando junto das permissões, agora no menuzinho da permissão (o botão
   da direita do chip): os modos, um traço e o envio ↳ Entra / ≡ Fila. O comportamento (grava no painel e no padrão, repinta o botão de enviar)
   tem teste de verdade em test/chip-menuzinhos.test.js; aqui fica só onde ele mora. */
test('Entra/Fila mora no menuzinho da permissão, junto com os modos (UI 3.1, leva 5h)', () => {
  const camada = UI.slice(UI.indexOf('async function agentLayer('), UI.indexOf('  function plan('));
  assert.match(camada, /"Se ele estiver trabalhando"/);
  assert.match(camada, /\["entra", "corner-down-right", "Entra",/);
  assert.match(camada, /\["fila", "list-end", "Fila",/);
  assert.match(camada, /cfg\.envioPadrao = id/);
  assert.match(camada, /conteudo\.append\(modos, traco, envio\)/);
  assert.doesNotMatch(camada, /controls\.append|modeSection|sendSection/, 'sem as seções da camada grande');
});

/* Leva 4, onda 2, correção 1 (revisão ae08f472484ba810d). Antes: .pm-sigla{flex:none} impedia a sigla de encolher; com o nome
   de um motor longo (Gemini, "indisponível") ela tomava o chip todo e a permissão (min-width:0) encolhia até sumir.
   Depois: a sigla encolhe com elipse (a regra .p-model span) e a permissão (hoje o ícone) não encolhe.
   Leva 5h: quem encolhe agora é o BOTÃO DO MEIO (a sigla dentro dele); o do motor e o da permissão não encolhem, e o grupo não tem mais teto. */
test('chip estreito: a sigla encolhe com elipse dentro do botão do meio e os botões do motor e da permissão nunca somem (UI 3.1 e 3.5, leva 5h)', () => {
  const sigla = corpoDaRegra(CSS_UI, '.ck-app .p-model .pm-sigla');
  assert.match(sigla, /flex:\s*0 1 auto/, 'a sigla precisa poder encolher: ' + sigla.trim());
  assert.match(sigla, /min-width:\s*3ch/, 'e deixar ao menos 3 caracteres: ' + sigla.trim());
  const meio = corpoDaRegra(CSS_UI, '.ck-app .cmp-bar .pm-modelo');
  assert.match(meio, /flex:\s*0 1 auto/, 'o botão do meio encolhe (o .cmp-bar button põe flex-shrink: 0 em todos; esta regra é mais específica): ' + meio.trim());
  assert.match(meio, /min-width:\s*28px/, 'e nunca abaixo do alvo de 28 px');
  assert.match(meio, /overflow:\s*hidden/);
  for (const classe of ['pm-motor', 'pm-perm']) {
    assert.match(corpoDaRegra(CSS_UI, '.ck-app .cmp-bar .' + classe), /flex:\s*none/, classe + ' não pode encolher');
  }
  const permissao = corpoDaRegra(CSS_UI, '.ck-app .p-model .pm-modo');
  assert.match(permissao, /flex:\s*none/, 'a permissão não pode encolher: ' + permissao.trim());
  // a elipse vem da regra dos spans do chip; o nome inteiro já está no title
  const spans = corpoDaRegra(CSS_UI, '.ck-app .p-model span');
  assert.match(spans, /overflow:\s*hidden/);
  assert.match(spans, /text-overflow:\s*ellipsis/);
  // o grupo em si não tem teto: o que o prendia (150, 115, 110, 105 e 86 px) era a conta do chip de UM botão com a sigla dentro
  const grupo = corpoDaRegra(CSS_UI, '.ck-app .cmp-bar .p-model');
  assert.match(grupo, /max-width:\s*none/, grupo.trim());
});

/* Leva 5b. O ícone é um SVG (display:block pelo .ic do style.css) dentro do .pm-modo; o pontinho é o ::before do mesmo span. Sem o
   .pm-modo virar uma linha (flex), o "·" ficaria numa linha e o SVG embaixo dele. O tamanho segue os outros ícones pequenos do
   cockpit-ui.css (14 px, como .ck-sel-barra .ic e .dt-levar .ic); a cor vem do currentColor do ico(), então o livre e o rebaixado
   pintam o ícone sem regra extra. */
test('o ícone da permissão: 14 px, numa linha, alinhado no meio, na cor do modo (UI 3.5, leva 5h)', () => {
  const permissao = corpoDaRegra(CSS_UI, '.ck-app .p-model .pm-modo');
  assert.match(permissao, /display:\s*inline-flex/, 'o span é uma linha: o SVG não fica embaixo de nada: ' + permissao.trim());
  assert.match(permissao, /align-items:\s*center/, permissao.trim());
  const icone = corpoDaRegra(CSS_UI, '.ck-app .p-model .pm-modo .ic');
  assert.match(icone, /width:\s*14px/, icone.trim());
  assert.match(icone, /height:\s*14px/, icone.trim());
  assert.doesNotMatch(icone, /(?:^|[;\s])color:/, 'sem cor própria: o ícone herda a do modo (currentColor)');
  // "Sem pedir permissão" segue na cor de atenção; o rebaixado também, com a linha tracejada que o texto sublinhado tinha
  assert.match(corpoDaRegra(CSS_UI, '.ck-app .p-model .pm-modo.livre'), /color:\s*var\(--attention\)/);
  const rebaixado = corpoDaRegra(CSS_UI, '.ck-app .p-model .pm-modo.rebaixado');
  assert.match(rebaixado, /color:\s*var\(--attention\)/, rebaixado.trim());
  assert.match(rebaixado, /border-bottom:\s*1px dashed currentColor/, 'text-decoration não sublinha um SVG: a linha tracejada vira borda: ' + rebaixado.trim());
});

/* Leva 4, onda 2, correção 7 (opcional). Medida: o espaço de cada lado do "·" no chip. Antes: 9 px à esquerda (o gap de 5 px do .p-model
   mais a margem de 4 px do ::before) e 4 px à direita. Depois: 5 px e 4 px, quase iguais.
   Leva 5h: o "·" era o ::before do ícone da permissão; com três botões ele vira um separador de verdade (.pm-sep) ENTRE eles: 6 px de largura,
   igual dos dois lados, sem margem própria, e o clique atravessa (não é botão nem alvo). */
test('os "·" do chip são separadores entre os botões: 6 px de largura, iguais dos dois lados, sem clique e sem o ::before da permissão (UI 3.5, leva 5h)', () => {
  const sep = corpoDaRegra(CSS_UI, '.ck-app .p-model .pm-sep');
  assert.match(sep, /flex:\s*none/);
  assert.match(sep, /width:\s*6px/, 'a mesma folga dos dois lados do ponto: ' + sep.trim());
  assert.match(sep, /text-align:\s*center/);
  assert.match(sep, /pointer-events:\s*none/, 'o clique atravessa o ponto');
  assert.doesNotMatch(sep, /margin/, 'sem margem própria: ' + sep.trim());
  assert.doesNotMatch(CSS_UI, /\.pm-modo:not\(:empty\)::before/, 'o pontinho que era do ícone da permissão saiu');
});

/* Leva 5f. O botão do meio dos modelos conhecidos é [família][anel]: dois ícones de 14 px, cada um num span que vira uma linha (flex) e
   NÃO encolhe (a elipse é só da sigla do texto de quem não tem ícone).
   Leva 5h: a família e o anel formam um par DENTRO do botão do meio, que tem o gap próprio de 3 px (antes: o gap de 5 px do .p-model e uma margem
   de -2 px no anel, que só funcionavam porque os dois eram filhos do chip). Medida: o espaço entre a família e o anel segue 3 px. */
test('a família e o anel: 14 px, uma linha, sem encolher, 3 px entre os dois (o gap do botão do meio) (leva 5f, 5h)', () => {
  const par = corpoDaRegra(CSS_UI, '.ck-app .p-model .pm-familia,\n.ck-app .p-model .pm-peso');
  assert.match(par, /display:\s*inline-flex/, 'cada um é uma linha: o SVG não fica embaixo de nada: ' + par.trim());
  assert.match(par, /align-items:\s*center/, par.trim());
  assert.match(par, /flex:\s*none/, 'nenhum dos dois encolhe: é símbolo, não texto com elipse: ' + par.trim());
  const icones = corpoDaRegra(CSS_UI, '.ck-app .p-model .pm-familia .ic,\n.ck-app .p-model .pm-peso .ic');
  assert.match(icones, /width:\s*14px/, icones.trim());
  assert.match(icones, /height:\s*14px/, icones.trim());
  assert.doesNotMatch(icones, /(?:^|[;\s])color:/, 'sem cor própria: herdam a do chip (currentColor), nos 4 temas e no visual Mac');
  assert.match(corpoDaRegra(CSS_UI, '.ck-app .cmp-bar .pm-modelo'), /gap:\s*3px/, 'os 3 px entre a família e o anel são do botão do meio');
  assert.doesNotMatch(CSS_UI, /\.pm-familia \+ \.pm-peso/, 'a margem negativa de -2 px do anel saiu junto com o gap de 5 px do chip');
});

test('o chip nos dois visuais: cada botão tem a sua cor e o seu hover, o ▾ é do botão da permissão e o visual Mac não conhece os spans de dentro (leva 5h)', () => {
  // o ▾ era o ::after do chip inteiro; agora é do último botão (a permissão), e quem clica nele abre o menuzinho dela
  assert.match(corpoDaRegra(CSS_UI, '.ck-app .cmp-bar .pm-perm::after'), /content:\s*"▾"/);
  assert.doesNotMatch(CSS_UI, /\.cmp-bar \.p-model::after/, 'o ▾ do chip inteiro saiu');
  for (const seletor of ['html.visual-mac .ck-app .cmp-bar .pm-btn', 'html.visual-mac .ck-app .cmp-bar .pm-btn:hover', 'html.visual-mac .ck-app .cmp-bar .pm-perm::after']) {
    assert.ok(CSS_MAC.includes('\n' + seletor + ' {'), 'o visual Mac pinta ' + seletor);
  }
  assert.match(corpoDaRegra(CSS_MAC, 'html.visual-mac .ck-app .cmp-bar .pm-perm::after'), /-webkit-mask:/, 'o ▾ do Mac é o seletor de dois chevrons, em máscara');
  assert.doesNotMatch(CSS_MAC, /\.cmp-bar \.p-model::after/, 'e também saiu do Mac');
  // (exec + equal, e não doesNotMatch: se falhar, a mensagem não despeja o visual-mac.css inteiro)
  const resto = /pm-sigla|pm-familia|pm-peso|pm-sep/.exec(CSS_MAC);
  assert.equal(resto, null, 'o visual-mac.css não devia falar de ' + (resto && resto[0]) + ': os ícones de dentro herdam a cor do botão');
});

/* Leva 5h: o grupo tem o tamanho que os botões dão (28 + 6 + 45 + 6 + 40 = ~125 px com ícones; a sigla de um motor sem ícone encolhe com elipse) e
   a caixa .cmp-dir quebra por dentro se faltar lugar. O teto fica só no botão do meio, para a sigla de texto. */
test('coluna de até 290 px: o botão do meio ganha um teto menor, mas ainda cabe os dois ícones inteiros (leva 5h)', () => {
  const base = /\.ck-app \.cmp-bar \.pm-modelo \{[^}]*max-width:\s*(\d+)px/.exec(CSS_UI);
  assert.ok(base, 'não achei o teto do botão do meio');
  // o seletor da coluna estreita NÃO leva ".cmp-bar": test/caixa-duas-linhas.test.js proíbe regra de largura que mexa na barra. Ele ganha da regra
  // base (mesma especificidade, .ck-app .cmp-bar .pm-modelo contra .ck-app .p-model .pm-modelo) por vir depois no arquivo
  const m = /@container \(max-width: 290px\) \{\s*(?:\/\*[\s\S]*?\*\/\s*)?\.ck-app \.p-model \.pm-modelo \{\s*max-width:\s*(\d+)px/.exec(CSS_UI);
  assert.ok(m, 'não achei o teto do botão do meio na coluna de até 290 px');
  assert.ok(CSS_UI.indexOf(m[0]) > CSS_UI.indexOf('.ck-app .cmp-bar .pm-modelo {'), 'e vem depois da regra base, para ganhar dela');
  // 5 + 14 + 3 + 14 + 5 = 41 px os dois ícones com o respiro; abaixo disso o anel é cortado
  assert.ok(Number(m[1]) >= 44, 'o teto de ' + m[1] + ' px corta os ícones de 41 px');
  assert.ok(Number(m[1]) < Number(base[1]), 'e é menor que o teto de coluna larga (' + base[1] + ' px)');
  // as regras antigas que prendiam o chip de um botão só (e escondiam o ícone dele) saíram
  assert.doesNotMatch(CSS_UI, /\.ck-app \.p-model \{\s*max-width:/, 'o teto de largura do chip antigo saiu');
  assert.doesNotMatch(CSS_UI, /\.ck-app \.p-model > \.ic/, 'e o display: none do ícone filho direto também');
});

/* Leva 4, onda 2, correção 4. Medida: o nome acessível do chip. Antes: o do texto, "o5.5Livre" (duas spans coladas, sem espaço;
   o title só entra se não houver texto). Depois: o nome inteiro do modelo + a permissão.
   Leva 5b: o chip não escreve mais a palavra (é um ícone), então o leitor de tela recebe o NOME INTEIRO do modo, não a palavra curta. */
function elFalso(extra = {}) {
  const attrs = {};
  return { attrs, dataset: {}, classList: { add() {}, toggle() {}, contains: () => false }, setAttribute(k, v) { attrs[k] = v; }, ...extra };
}
/* Leva 5h: o decoratePane deixou de escrever o nome acessível do chip. O chip não é um botão: é um grupo de três, e cada um nasce com o nome e
   o hover e é atualizado por quem pinta o pedaço (fillModels, pintarModo, pintarBotaoDeMotor; testes acima e abaixo). O que o decoratePane fazia
   (juntar o title do botão único com a permissão: "Opus 5.5 · permissão: Sem pedir permissão") não tem mais sobre o que atuar. */
function decorar(p) {
  const chamados = [];
  const ctx = vm.createContext({ window: {}, attach() {}, stateOf: () => 'idle', STATES: { idle: { label: 'Parada' } },
    tituloNaTorre: () => 'Conversa', nomeDoMotor: () => 'Claude', abaPorId: () => null,
    q: (sel) => { chamados.push(sel); return sel === '.ck-header-robots' ? elFalso() : null; } });   // o decoratePane escreve no botão dos robôs sem checar
  vm.runInContext(pegarBloco(UI, 'function decoratePane(', 'decoratePane'), ctx);
  ctx.decoratePane({ el: elFalso(), engine: 'claude', ...p });
  return chamados;
}

test('o decoratePane não mexe mais no chip: nem o procura no DOM, nem escreve o aria-label dele (leva 5h)', () => {
  const chamados = decorar({ uiNomeModo: 'Sem pedir permissão' });
  assert.equal(chamados.includes('.p-model'), false, 'o chip é um grupo de três botões, cada um com o nome pronto');
  assert.doesNotMatch(pegarBloco(UI, 'function decoratePane(', 'decoratePane'), /p-model|pm-btn|uiNomeModo/);
  // painel sem nada disso no DOM continua não quebrando
  assert.doesNotThrow(() => decorar({}));
});

/* Leva 4, onda 2, correção 5. Medida: a parte da camada do agente que abre ao clicar na permissão do chip. Antes: "model" (a lista
   de modelos, longe das permissões, que o botão .p-modo abria). Depois: "mode" (a seção das permissões).
   Leva 5b: o que se clica agora é o ícone, um <svg> com <path>/<rect> dentro do .pm-modo: o alvo do clique é o SVG (ou um traço dele),
   nunca o span; o closest('.pm-modo') precisa subir de lá (Element.closest vale para SVGElement).
   Leva 5h: o chip são três botões (.pm-btn[data-peca]); o clique no grupo escolhe o menuzinho pelo botão de dentro (o closest('.pm-btn') sobe
   do SVG, do traço ou do span até ele): motor -> 'engine', modelo -> 'model', permissão -> 'mode'. O botão do motor do CABEÇALHO (.p-motor)
   continua abrindo o do motor. Clique no grupo fora de um botão (o ponto separador, a folga) não abre nada. */
function ligarChip() {
  const ouvintes = {}, abriu = [], parados = [];
  const ctx = vm.createContext({ q: (sel) => ({ after() {}, before() {}, setAttribute() {}, addEventListener(tipo, fn) { ouvintes[sel] = fn; } }),
    button: () => ({}), tituloNaTorre: () => 'Conversa', ligarArrastarPainel() {}, STATES: { idle: { label: 'Parada' } }, stateOf: () => 'idle',
    renomearAqui() {}, pendingLayer() {}, irAoPainel() {}, robotsLayer() {}, stopEvent: (e) => parados.push(e), refresh() {}, agentLayer: (p, parte) => abriu.push(parte) });
  vm.runInContext(pegarBloco(UI, 'function attach(', 'attach'), ctx);
  ctx.attach({ el: {} });
  return { ouvintes, abriu, parados };
}

/* a árvore do chip como o molde a escreve (leva 5h):
   <div.p-model><button.pm-btn.pm-motor><svg.logo-motor><path/></svg></button> <span.pm-sep/>
                <button.pm-btn.pm-modelo><span.pm-familia><svg.ic><path/></svg></span><span.pm-peso><svg.ic><path/></svg></span></button> <span.pm-sep/>
                <button.pm-btn.pm-perm><span.pm-modo><svg.ic><path/></svg></span></button></div>;
   quem não tem ícone (Gemini, Grok, ACP...) tem <span.pm-sigla/> no lugar dos dois primeiros. O closest sobe pelos pais como o do navegador. */
function arvoreDoChip() {
  const noh = (classe, pai, peca) => ({ classe, pai, dataset: peca ? { peca } : {}, closest(sel) { for (let x = this; x; x = x.pai) if (x.classe && sel === '.' + x.classe) return x; return null; } });
  const grupo = noh('p-model', null);
  const motor = noh('pm-btn', grupo, 'motor'), svgDoMotor = noh('logo-motor', motor), tracoDoMotor = noh('', svgDoMotor);
  const sep = noh('pm-sep', grupo);
  const meio = noh('pm-btn', grupo, 'modelo'), sigla = noh('pm-sigla', meio);
  const familia = noh('pm-familia', meio), svgDaFamilia = noh('ic', familia), peso = noh('pm-peso', meio), svgDoPeso = noh('ic', peso);
  const perm = noh('pm-btn', grupo, 'perm'), permissao = noh('pm-modo', perm), svg = noh('ic', permissao);
  return { grupo, motor, svgDoMotor, tracoDoMotor, sep, meio, sigla, familia, svgDaFamilia, tracoDaFamilia: noh('', svgDaFamilia), peso, svgDoPeso,
    tracoDoPeso: noh('', svgDoPeso), perm, permissao, svg, traco: noh('', svg) };
}

test('clicar no chip abre o menuzinho do botão clicado: motor, modelo (família, anel ou sigla) ou permissão (o botão, o ícone ou um traço dele) (UI 3.5, leva 5h)', () => {
  const { ouvintes, abriu, parados } = ligarChip();
  const a = arvoreDoChip();
  const clicar = (...alvos) => { for (const alvo of alvos) ouvintes['.p-model']({ target: alvo }); };
  clicar(a.motor, a.svgDoMotor, a.tracoDoMotor);
  assert.deepEqual(abriu, ['engine', 'engine', 'engine']);
  abriu.length = 0;
  clicar(a.meio, a.familia, a.svgDaFamilia, a.tracoDaFamilia, a.peso, a.svgDoPeso, a.tracoDoPeso, a.sigla);
  assert.deepEqual(abriu, Array(8).fill('model'), 'o botão do meio, a família, o anel (e traços deles) e a sigla de quem não tem ícone');
  abriu.length = 0;
  clicar(a.perm, a.permissao, a.svg, a.traco);
  assert.deepEqual(abriu, ['mode', 'mode', 'mode', 'mode'], 'o clique na folga do botão (fora do ícone) também vale: o botão inteiro é o alvo');
  assert.equal(parados.length, 15, 'cada clique em botão é consumido (stopEvent), para o ouvinte de reserva do app.js não abrir um segundo menu');
});

test('o botão do motor do cabeçalho segue abrindo o menuzinho do motor; clique no grupo fora de um botão não abre nada e não é consumido (leva 5h)', () => {
  const { ouvintes, abriu, parados } = ligarChip();
  ouvintes['.p-motor']({ target: { closest: () => null } });
  assert.deepEqual(abriu, ['engine']);
  abriu.length = 0; parados.length = 0;
  const a = arvoreDoChip();
  ouvintes['.p-model']({ target: a.sep });
  ouvintes['.p-model']({ target: a.grupo });
  assert.deepEqual(abriu, [], 'o ponto separador e a folga do grupo não são botões');
  assert.equal(parados.length, 0, 'e o clique segue para quem o quiser (o app.js ignora do mesmo jeito)');
  ouvintes['.p-model']({ target: {} });   // alvo sem closest (DOM de mentira): cai no modelo, sem quebrar
  assert.deepEqual(abriu, ['model']);
});

/* Leva 5f, auditoria rodada 2: o hover do chip terminava com " — modelo, esforço, permissões e o envio" (o que o botão faz). Na tela isso ajuda;
   no leitor de tela era ruído: o nome acessível lia a frase inteira a cada foco. Leva 5h: o hover de cada botão ainda diz o que ele abre, e o
   nome acessível (aria-label) nunca repete esse fim: o do modelo ("Modelo: …"), o da permissão ("Permissão: …") e o do motor ("Motor: …"). */
test('o nome acessível de cada botão do chip não repete o fim do hover (o que o botão abre) e começa pelo que ele é (leva 5h)', () => {
  const b = chip({ engine: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', el: {} }, [{ id: 'claude-sonnet-5-5', nome: 'Sonnet 5.5', efforts: ['medium'] }]);
  assert.ok(b.title.endsWith(SUFIXO_DO_HOVER), 'o hover da tela segue com o sufixo: ' + b.title);
  assert.equal(b.ariaLabel, 'Modelo: Sonnet 5.5 (S5.5) · peso 2 de 4 · Cota média');
  assert.doesNotMatch(b.ariaLabel, /modelo e esforço$/);
  const { ctx, perm } = montarModo();
  ctx.pintarModo({ engine: 'claude', mode: 'manual', el: {} });
  assert.ok(perm.title.endsWith(SUFIXO_DA_PERMISSAO), perm.title);
  assert.equal(perm.ariaLabel, 'Permissão: Manual');
  assert.doesNotMatch(perm.ariaLabel, /permissões e o envio$/);
});

/* O molde do painel (index.html): o chip é um grupo de 3 botões que NASCEM prontos e não são reescritos. Cada um tem o nome (aria-label) e o hover
   (title) já no molde, para o painel novo não ficar com um botão mudo até o primeiro pintor passar. A ordem do molde é a do Tab. */
test('o molde do chip: um grupo (role="group") com os 3 botões motor, modelo e permissão, e os pontos entre eles, na ordem do Tab (leva 5h)', () => {
  const i = HTML.indexOf('<div class="p-model"');
  assert.ok(i > 0, 'o .p-model é um div (o grupo), não mais um botão');
  const grupo = HTML.slice(i, HTML.indexOf('\n          <button class="p-stop', i));
  assert.match(grupo, /^<div class="p-model" role="group" aria-label="Motor, modelo e permissão">/);
  const itens = [...grupo.matchAll(/<(button|span)\b([^>]*)>/g)].map((m) => ({ tag: m[1], attrs: m[2] }));
  const botoes = itens.filter((x) => x.tag === 'button');
  assert.deepEqual(botoes.map((b) => /data-peca="(\w+)"/.exec(b.attrs)[1]), ['motor', 'modelo', 'perm']);
  assert.deepEqual(botoes.map((b) => /class="pm-btn (pm-\w+)"/.exec(b.attrs)[1]), ['pm-motor', 'pm-modelo', 'pm-perm']);
  for (const b of botoes) {
    assert.match(b.attrs, /type="button"/, 'botão que não envia formulário nenhum');
    assert.match(b.attrs, /aria-haspopup="menu"/, 'abre um menuzinho');
    assert.match(b.attrs, /title="[^"]+"/, 'o hover já no molde');
    assert.match(b.attrs, /aria-label="[^"]+"/, 'o nome acessível já no molde');
    assert.doesNotMatch(b.attrs, /tabindex/, 'o Tab chega em cada um pela ordem natural do molde');
  }
  // os pontos entre os botões: dois, escondidos do leitor de tela (são enfeite); a ordem é botão, ponto, botão, ponto, botão
  assert.deepEqual(itens.filter((x) => x.tag === 'button' || /pm-sep/.test(x.attrs)).map((x) => (x.tag === 'button' ? 'botao' : 'ponto')), ['botao', 'ponto', 'botao', 'ponto', 'botao']);
  assert.equal((grupo.match(/<span class="pm-sep" aria-hidden="true">·<\/span>/g) || []).length, 2);
  // a permissão leva o span .pm-modo dentro do botão: o pintarModo continua escrevendo nele
  assert.match(grupo, /<button type="button" class="pm-btn pm-perm"[^>]*><span class="pm-modo"><\/span><\/button>/);
  // o motor e o modelo nascem vazios: o logo vem do pintarBotaoDeMotor e o ícone/sigla do fillModels
  assert.match(grupo, /class="pm-btn pm-motor"[^>]*><\/button>/);
  assert.match(grupo, /class="pm-btn pm-modelo"[^>]*><\/button>/);
  // o ■ e o ↑ vêm logo depois do grupo, e o botão antigo do chip único não existe mais
  assert.doesNotMatch(HTML, /<button class="p-model"/);
});

/* O botão do motor do chip é pintado pelo mesmo lugar que pinta o do cabeçalho (pintarBotaoDeMotor), e só quando o motor muda: o paintEngine roda a
   cada resize da janela, e reescrever um SVG por painel a cada quadro do arrasto era o que a saída antecipada já evitava (comentário do app.js). */
function motorDoChip() {
  const dataset = {};
  const filho = () => ({ innerHTML: '', textContent: '' });
  const cab = { dataset, title: '', ...{ logo: filho(), nome: filho(), seta: filho() } };
  const motor = { innerHTML: '', title: '', ariaLabel: '', escritas: 0 };
  let html = '';
  Object.defineProperty(motor, 'innerHTML', { get: () => html, set: (v) => { html = v; motor.escritas++; } });
  const ctx = vm.createContext({ ico: icoFalso, svgMotor: (e) => '<svg data-motor="' + e + '"></svg>', nomeDoMotor: (e) => ({ claude: 'Claude', codex: 'Codex', gemini: 'Gemini', grok: 'Grok', acp: 'ACP' }[e]),
    atalhoDaMaquina: (s) => s,
    $: (sel, raiz) => (sel === '.p-motor' ? cab : sel === '.pm-motor' ? motor : sel === '.logo-lugar' ? cab.logo : sel === '.pm-nome' ? cab.nome : sel === '.pm-seta' ? cab.seta : null) });
  vm.runInContext(pegarBloco(APP, 'function pintarBotaoDeMotor(', 'pintarBotaoDeMotor'), ctx);
  return { ctx, cab, motor };
}

test('o botão do motor do chip leva o logo do motor (svgMotor), o hover "Motor: X — trocar de motor" e o nome acessível, e só é refeito quando o motor muda (leva 5h)', () => {
  const { ctx, cab, motor } = motorDoChip();
  const P = { el: {}, engine: 'claude' };
  ctx.pintarBotaoDeMotor(P);
  assert.equal(motor.innerHTML, '<svg data-motor="claude"></svg>', 'o logo vem do svgMotor(P.engine)');
  assert.equal(motor.title, 'Motor: Claude — trocar de motor');
  assert.equal(motor.ariaLabel, 'Motor: Claude');
  assert.equal(cab.dataset.motor, 'claude', 'o botão do cabeçalho segue pintado, na mesma passada');
  const escritas = motor.escritas;
  ctx.pintarBotaoDeMotor(P);
  assert.equal(motor.escritas, escritas, 'mesmo motor (o resize do arrasto): nada é reescrito');
  P.engine = 'gemini';
  ctx.pintarBotaoDeMotor(P);
  assert.equal(motor.innerHTML, '<svg data-motor="gemini"></svg>');
  assert.equal(motor.title, 'Motor: Gemini — trocar de motor');
  assert.equal(motor.ariaLabel, 'Motor: Gemini');
});

test('painel sem o botão do motor no chip (molde antigo) segue pintando o do cabeçalho, sem quebrar (leva 5h)', () => {
  const { ctx, cab } = motorDoChip();
  const chamados = [];
  const antigo = ctx.$;
  ctx.$ = (sel, raiz) => { chamados.push(sel); return sel === '.pm-motor' ? null : antigo(sel, raiz); };
  assert.doesNotThrow(() => ctx.pintarBotaoDeMotor({ el: {}, engine: 'codex' }));
  assert.equal(cab.dataset.motor, 'codex');
});

/* Os três pintores juntos, nos três botões do molde: cada um escreve SÓ no seu e nenhum recria os botões (a identidade deles é o que mantém o
   foco, o ouvinte e o botão para onde o Esc devolve o foco). Medida: botões do chip recriados por uma troca de modelo (antes 0, um botão só que
   era reescrito por dentro; depois 0, três botões que nunca são recriados). */
test('fillModels, pintarModo e pintarBotaoDeMotor: cada um escreve só no botão dele, e os botões são sempre os mesmos objetos (leva 5h)', () => {
  const botao = () => ({ innerHTML: '', title: '', ariaLabel: '', escritas: 0 });
  const motor = botao(), meio = botao(), perm = botao(), icone = { innerHTML: '', className: '', title: '', escritas: 0 };
  for (const b of [motor, meio, perm, icone]) { let html = ''; Object.defineProperty(b, 'innerHTML', { get: () => html, set: (v) => { html = v; b.escritas = (b.escritas || 0) + 1; } }); }
  const cab = { dataset: {}, title: '' }, filho = () => ({ innerHTML: '', textContent: '' });
  const logo = filho(), nomeCab = filho(), seta = filho();
  const ctx = vm.createContext({ ...globaisFalsos(), window: { CockpitModels: Modelos }, ico: icoFalso, EF_DESC_PT: {}, cfg: { defMode: 'manual' }, remotoDoPane: () => null,
    svgMotor: (e) => '<svg data-motor="' + e + '"></svg>', atalhoDaMaquina: (s) => s, nomeDoMotor: (e) => ({ claude: 'Claude', codex: 'Codex' }[e]),
    modelosDe: () => [{ id: 'claude-opus-5-5', nome: 'Opus 5.5', efforts: ['medium'] }], modeloAtual: () => ({ id: 'claude-opus-5-5', nome: 'Opus 5.5', efforts: ['medium'] }),
    esforcosDe: () => [{ id: 'medium' }],
    $: (sel) => ({ '.pm-motor': motor, '.pm-modelo': meio, '.pm-perm': perm, '.pm-modo': icone, '.p-motor': cab, '.logo-lugar': logo, '.pm-nome': nomeCab, '.pm-seta': seta }[sel] || null) });
  const bloco = (ass, nome) => pegarBloco(APP, ass, nome).replace(/^const /, 'var ');
  vm.runInContext([bloco('const MODOS = {', 'MODOS') + ';', bloco('const modoDe = (P) => {', 'modoDe') + ';',
    ...['modoValido', 'ajeitarModoRemoto', 'pintarModo', 'fillModels', 'pintarBotaoDeMotor'].map((f) => pegarBloco(APP, 'function ' + f + '(', f))].join('\n'), ctx);
  const P = { engine: 'claude', model: 'claude-opus-5-5', effort: 'medium', mode: 'bypass', el: {} };
  ctx.fillModels(P);
  assert.deepEqual([motor.escritas, meio.escritas, perm.escritas, icone.escritas], [0, 1, 0, 0], 'o fillModels só escreveu no botão do meio');
  ctx.pintarModo(P);
  assert.deepEqual([motor.escritas, meio.escritas, perm.escritas, icone.escritas], [0, 1, 0, 1], 'o pintarModo só no ícone da permissão (e no hover do botão dela)');
  ctx.pintarBotaoDeMotor(P);
  assert.deepEqual([motor.escritas, meio.escritas, perm.escritas, icone.escritas], [1, 1, 0, 1], 'o pintarBotaoDeMotor só no logo do motor');
  assert.equal(motor.title, 'Motor: Claude — trocar de motor');
  assert.equal(meio.ariaLabel, 'Modelo: Opus 5.5 (O5.5) · peso 3 de 4 · Cota maior');
  assert.equal(perm.ariaLabel, 'Permissão: Sem pedir permissão');
  assert.equal(icone.className, 'pm-modo livre');
  // trocar de modelo e de modo repinta o botão do meio e o ícone, de novo, sem tocar no motor
  P.model = 'claude-opus-5-5'; P.mode = 'manual';
  ctx.fillModels(P); ctx.pintarModo(P);
  ctx.pintarBotaoDeMotor(P);   // mesmo motor: a saída antecipada não reescreve o logo
  assert.deepEqual([motor.escritas, meio.escritas, perm.escritas, icone.escritas], [1, 2, 0, 2]);
  assert.equal(perm.ariaLabel, 'Permissão: Manual');
});

/* O ouvinte de reserva do app.js (o do CockpitUI.attach, na captura, vem antes e consome o clique; este só chega se ele ainda não se ligou).
   O comando que o liga é recortado do fonte, com as chaves casadas, como em test/pilula-contexto.test.js. */
test('o ouvinte de reserva do chip no newPane escolhe o menu pelo botão clicado e ignora o que não é botão (leva 5h)', () => {
  const NEWPANE = APP.slice(APP.indexOf('function newPane('), APP.indexOf('/* ===================== COLUNAS'));
  const i = NEWPANE.indexOf("$('.p-model', el).addEventListener('click'");
  assert.ok(i >= 0, 'não achei o ouvinte do chip no newPane');
  let nivel = 0, k = NEWPANE.indexOf('{', i);
  for (; k < NEWPANE.length; k++) { if (NEWPANE[k] === '{') nivel++; else if (NEWPANE[k] === '}' && --nivel === 0) break; }
  const comando = NEWPANE.slice(i, NEWPANE.indexOf(';', k) + 1);
  const abriu = [], ouvintes = [];
  const ctx = vm.createContext({ $: () => ({ addEventListener: (t, f) => ouvintes.push(f) }), el: {}, P: { id: 'p1' },
    menuMotores: () => abriu.push('motor'), menuModos: () => abriu.push('perm'), menuModelos: () => abriu.push('modelo') });
  vm.runInContext(comando, ctx);
  const a = arvoreDoChip();
  const clicar = (alvo) => { const e = { target: alvo, parou: false, stopPropagation() { this.parou = true; } }; ouvintes[0](e); return e; };
  assert.equal(clicar(a.svgDoMotor).parou, true);
  clicar(a.tracoDaFamilia); clicar(a.sigla); clicar(a.permissao); clicar(a.perm);
  assert.deepEqual(abriu, ['motor', 'modelo', 'modelo', 'perm', 'perm']);
  abriu.length = 0;
  assert.equal(clicar(a.sep).parou, false, 'o ponto separador: ignorado, e o clique segue (o fechamento global do documento o vê)');
  clicar(a.grupo);
  assert.deepEqual(abriu, []);
  clicar({});   // alvo sem closest (DOM de mentira): cai no modelo
  assert.deepEqual(abriu, ['modelo']);
});

/* Leva 5f: os desenhos da prévia que o Hugo aprovou (B3, 07/10), letra por letra: 24 px, traço, pontas redondas, currentColor (o ico()
   põe o traço; o anel e o miolo, que são cheios, pedem fill="currentColor" stroke="none" no próprio elemento). O "star" (Astra) já existia
   e não é fixado aqui: é o mesmo dos outros usos. */
const DESENHOS = {
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
  feather: '<path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z"/><path d="M16 8 2 22"/><path d="M17.5 15H9"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  fox: '<path d="M3 3l5.5 5h7L21 3v8.5L12 21l-9-9.5Z"/><path d="M9 12.5h.01"/><path d="M15 12.5h.01"/><path d="M11 17.2 12 18l1-.8"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  'peso-1': '<circle cx="12" cy="12" r="9"/><path d="M12 12V5.5A6.5 6.5 0 0 1 18.5 12Z" fill="currentColor" stroke="none"/>',
  'peso-2': '<circle cx="12" cy="12" r="9"/><path d="M12 12V5.5A6.5 6.5 0 0 1 12 18.5Z" fill="currentColor" stroke="none"/>',
  'peso-3': '<circle cx="12" cy="12" r="9"/><path d="M12 12V5.5A6.5 6.5 0 1 1 5.5 12Z" fill="currentColor" stroke="none"/>',
  'peso-4': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6.5" fill="currentColor" stroke="none"/>',
};

test('os ícones do chip existem em ICONES, iguais aos da prévia aprovada, e o ico() os desenha com a cor do texto (leva 5f)', () => {
  const ini = APP.indexOf('const ICONES = '), fim = APP.indexOf('\n', APP.indexOf('const ico = (n) =>'));
  assert.ok(ini > 0 && fim > ini, 'não achei ICONES / ico no app.js');
  const real = vm.createContext({});
  vm.runInContext(APP.slice(ini, fim).replace('const ICONES = ', 'var ICONES = ').replace('const ico = ', 'var ico = '), real);
  for (const [nome, desenho] of Object.entries(DESENHOS)) {
    assert.equal(real.ICONES[nome], desenho, 'o desenho de "' + nome + '" mudou');
    const svg = real.ico(nome);
    assert.match(svg, /^<svg viewBox="0 0 24 24" class="ic" fill="none" stroke="currentColor" stroke-width="1\.7" stroke-linecap="round" stroke-linejoin="round"><(path|circle)/, nome);
  }
  // a tabela inteira de ícones de família tem desenho (o star do Astra já existia)
  for (const { icone } of LINHAS) assert.ok(real.ICONES[icone], 'falta o ícone "' + icone + '" em ICONES');
  // o anel de peso é um círculo de traço + uma fatia cheia: 25, 50, 75 e 100 %; sem cor fixa, só currentColor
  for (const n of [1, 2, 3, 4]) {
    const anel = real.ICONES['peso-' + n];
    assert.match(anel, /^<circle cx="12" cy="12" r="9"\/>/, 'peso-' + n + ': começa pelo círculo de traço');
    assert.match(anel, /fill="currentColor" stroke="none"\/>$/, 'peso-' + n + ': a fatia é cheia, em currentColor');
    assert.doesNotMatch(anel, /#[0-9a-f]{3,6}|rgb|hsl/i, 'peso-' + n + ' tem cor fixa');
  }
});
