'use strict';
/* Leva 4, Tarefa 5 (UI 3.3): o anel parcial azul parecia "carregando". Vira pílula com número, só a partir de 70 %.
   Medida: o que aparece a 50 / 78 / 92 % (antes: anel, anel, anel; depois: nada, "78 %", "92 % cheio").
   Leva 5h (seção 4 da spec, decisão do Hugo em 08/10): o contexto volta a ser um ANEL, agora de verdade: um círculo que enche conforme o uso,
   sempre à vista desde o começo da conversa (a pílula só aparecia a partir de 70 %). O que mudou nos testes daqui, e por quê:
   - "abaixo de 70 % a pílula some" virou "o anel nunca some": o Hugo quer ver o contexto desde a primeira mensagem, não só quando já
     está quase cheio; sem medida ainda, o anel fica vazio e o hover diz "Contexto ainda não medido";
   - o limiar vermelho passou de 90 para 92 % (âmbar de 70 a 91 %, vermelho de 92 % em diante), e o texto "78 %" / "92 % cheio" saiu da tela:
     o número e o "cheio" vão para o hover e para o nome acessível (a regra da casa: sempre símbolo, nome no hover);
   - o clique continua resumindo, com o estado .rodando de sempre, e o "Resumir a conversa" do "/" segue valendo (testes do fim do arquivo). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');

const APP = lerFonte('renderer', 'app.js');
const HTML = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8').replace(/\r\n/g, '\n');
const CSS = fs.readFileSync(path.join(__dirname, '../src/renderer/style.css'), 'utf8').replace(/\r\n/g, '\n');
const CSS_MAC = lerFonte('renderer', 'visual-mac.css');
// newPane(opts = {}): o pegarBloco pararia no "{}" do parâmetro; o corpo vai até a seção das colunas (como em test/ajustes.test.js:426)
const NEWPANE = APP.slice(APP.indexOf('function newPane('), APP.indexOf('/* ===================== COLUNAS'));

/* O botão de mentira guarda o que o pintarAnel faz com ele: as classes, o innerHTML (e quantas vezes foi reescrito), o title e o aria-label.
   Nasce SEM hidden, como o molde (leva 5h); se alguém voltar a esconder o anel, o teste de "sempre à vista" pega. */
function anel(tokens, janela, antes, doPainel) {
  const cls = new Set(['cb', 'p-compactar']), attrs = {};
  const bt = { innerHTML: '', escritas: 0, textContent: '', title: '', disabled: false, attrs, querySelector: () => null, setAttribute: (k, v) => { attrs[k] = v; },
    classList: { toggle: (c, on) => { if (on) cls.add(c); else cls.delete(c); }, add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) } };
  let html = '';
  Object.defineProperty(bt, 'innerHTML', { get: () => html, set: (v) => { html = v; bt.escritas++; } });
  const ctx = vm.createContext({ Math, String, $: (sel) => (sel === '.p-compactar' ? bt : null), nomeDoMotor: (e) => ({ claude: 'Claude', codex: 'Codex', gemini: 'Gemini', grok: 'Grok', acp: 'Agente ACP' }[e] || e) });
  // rodada 2 da leva 5h, item 8: o anel pergunta ao motivoSemResumir se a conversa pode ser resumida (so' Claude e Codex, com a sessao ligada)
  vm.runInContext(['function motivoSemResumir(', 'function pintarAnel('].map((a) => pegarBloco(APP, a, a)).join('\n'), ctx);
  // por padrao o painel e' um Claude ligado: onde da' para resumir tudo continua como era (e' o que os testes da leva 5h provam)
  const P = { el: {}, tokens, janela, engine: 'claude', started: true, ...(doPainel || {}) };
  if (antes) ctx.pintarAnel({ el: {}, engine: 'claude', started: true, ...antes });
  ctx.pintarAnel(P);
  return Object.assign(bt, {
    cls,
    repintar: (t, j) => { P.tokens = t; P.janela = j; ctx.pintarAnel(P); return bt; },
    // o painel mudou (ligou a sessao, caiu, trocou de motor): o setDot e o pintarTokens repintam o anel com o painel novo
    repintarPainel: (mudancas) => { Object.assign(P, mudancas); ctx.pintarAnel(P); return bt; },
    motivo: (p) => ctx.motivoSemResumir(p),
  });
}
const arco = (bt) => { const m = /class="ac-arco"[^>]*stroke-dasharray="([\d.]+) 100"/.exec(bt.innerHTML); return m ? Number(m[1]) : 0; };

test('o anel nunca some: a 0, 30, 69, 70, 100 % e sem medida nenhuma ele segue à vista (leva 5h)', () => {
  for (const [t, j] of [[0, 0], [60000, 200000], [138000, 200000], [140000, 200000], [200000, 200000]]) {
    const bt = anel(t, j);
    assert.equal(bt.classList.contains('hidden'), false, t + '/' + j + ': sem hidden');
    assert.match(bt.innerHTML, /^<svg [^>]*class="ic anel-ctx"/, t + '/' + j + ': é um SVG');
    assert.equal(bt.textContent, '', t + '/' + j + ': nenhum texto na tela, só o desenho');
  }
});

test('sem medida (nenhum número de contexto ainda) o anel fica VAZIO: só o trilho, e o hover diz "Contexto ainda não medido" (leva 5h)', () => {
  for (const [t, j] of [[0, 0], [undefined, undefined], [0, 200000], [50000, 0]]) {
    const bt = anel(t, j);
    assert.equal(arco(bt), 0, t + '/' + j + ': sem arco');
    assert.doesNotMatch(bt.innerHTML, /ac-arco/);
    assert.match(bt.innerHTML, /class="ac-trilho"/, 'o trilho vazio continua desenhado');
    assert.equal(bt.title, 'Contexto ainda não medido');
    assert.equal(bt.attrs['aria-label'], 'Contexto ainda não medido');
    assert.equal(bt.cls.has('meio') || bt.cls.has('cheio'), false, 'neutro');
  }
});

/* Os limiares de cor: neutro até 69 %, âmbar de 70 a 91 %, vermelho de 92 % em diante (antes: âmbar de 70 a 89 %, vermelho de 90 % em diante).
   Medida: faixa de cada cor, antes neutro (escondido) < 70, âmbar 70-89, vermelho >= 90; depois neutro < 70, âmbar 70-91, vermelho >= 92. */
test('a cor do anel: neutra até 69 %, âmbar de 70 a 91 %, vermelha de 92 % em diante; a conta é a do número arredondado (leva 5h)', () => {
  const cor = (p) => { const bt = anel(p * 2000, 200000); return bt.cls.has('cheio') ? 'vermelho' : bt.cls.has('meio') ? 'ambar' : 'neutro'; };
  assert.deepEqual([0, 1, 50, 69].map(cor), ['neutro', 'neutro', 'neutro', 'neutro']);
  assert.deepEqual([70, 71, 89, 90, 91].map(cor), ['ambar', 'ambar', 'ambar', 'ambar', 'ambar'], '90 e 91 % agora ainda são âmbar');
  assert.deepEqual([92, 93, 99, 100].map(cor), ['vermelho', 'vermelho', 'vermelho', 'vermelho']);
  // 91,6 % arredonda para 92 (o mesmo número que o hover escreve); 91,4 % para 91
  assert.equal(anel(183200, 200000).cls.has('cheio'), true, '91,6 % -> 92');
  assert.equal(anel(182800, 200000).cls.has('cheio'), false, '91,4 % -> 91');
  // passou de 100 %: o arco não passa do círculo
  assert.equal(arco(anel(260000, 200000)), 100);
  // voltar a baixar o uso (resumiu a conversa) volta a cor neutra: as classes não ficam coladas
  const bt = anel(190000, 200000).repintar(40000, 200000);
  assert.equal(bt.cls.has('cheio') || bt.cls.has('meio'), false);
});

test('o arco enche com o uso: stroke-dasharray = "<pct> 100" num círculo com pathLength 100, no traço do ícone (currentColor, 1,7) (leva 5h)', () => {
  for (const [t, esperado] of [[2000, 1], [100000, 50], [156000, 78], [184000, 92], [200000, 100]]) {
    const bt = anel(t, 200000);
    assert.equal(arco(bt), esperado, t + ' tokens');
    assert.match(bt.innerHTML, /<circle class="ac-arco" cx="12" cy="12" r="9" pathLength="100" stroke-dasharray="\d+ 100" transform="rotate\(-90 12 12\)"\/>/, 'o arco sai do alto (12 horas)');
  }
  const bt = anel(156000, 200000);
  assert.match(bt.innerHTML, /^<svg viewBox="0 0 24 24" class="ic anel-ctx" fill="none" stroke="currentColor" stroke-width="1\.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">/, 'o mesmo traço dos anéis de peso (ico())');
  assert.match(bt.innerHTML, /^<svg [^>]*><circle class="ac-trilho" cx="12" cy="12" r="9"\/><circle class="ac-arco"/, 'o trilho primeiro, o arco por cima');
  assert.doesNotMatch(bt.innerHTML, /#[0-9a-f]{3,6}|rgb|hsl/i, 'sem cor fixa: a cor vem do currentColor (tema e visual Mac)');
});

test('o número e o "cheio" moram no hover e no nome acessível, nunca na tela (leva 5h)', () => {
  const a = anel(156000, 200000);
  assert.equal(a.title, 'A conversa usou 78 % do espaço. Resumir libera espaço sem perder o fio.');
  assert.equal(a.attrs['aria-label'], a.title);
  assert.equal(a.cls.has('meio'), true);
  assert.equal(a.cls.has('cheio'), false);
  const b = anel(184000, 200000);
  assert.equal(b.cls.has('cheio'), true);
  assert.equal(b.cls.has('meio'), false);
  assert.equal(b.title, 'A conversa usou 92 % do espaço: cheio. Resumir libera espaço sem perder o fio.');
  assert.equal(b.attrs['aria-label'], b.title);
  const c = anel(100000, 200000);
  assert.equal(c.title, 'A conversa usou 50 % do espaço. Resumir libera espaço sem perder o fio.', 'abaixo de 70 % o hover também fala');
  for (const bt of [a, b, c]) assert.equal(bt.textContent, '');
});

/* Rodada 2 da leva 5h, item 8: o anel está sempre à vista (decisão do Hugo), mas no Gemini, no Grok, no ACP e num painel sem sessão o clique
   dava sempre "Não deu para resumir" (o pane:compactar do main só aceita Claude e Codex com a sessão ligada). Ali o anel só MOSTRA o uso:
   continua desenhado, sem ação de clique (disabled, cursor normal) e o hover diz só o uso, sem o convite a resumir. Onde dá, nada muda. */
const SEM_RESUMO = [['gemini', true], ['grok', true], ['acp', true], ['claude', false], ['codex', false]];

test('onde não dá para resumir (Gemini, Grok, ACP, painel sem sessão) o anel só mostra o uso: à vista, sem clique e sem convite a resumir no hover (rodada 2, item 8)', () => {
  for (const [engine, started] of SEM_RESUMO) {
    const nome = engine + (started ? '' : ' sem sessão');
    const bt = anel(156000, 200000, null, { engine, started });
    assert.equal(bt.disabled, true, nome + ': sem ação de clique');
    assert.equal(bt.cls.has('hidden'), false, nome + ': continua à vista');
    assert.match(bt.innerHTML, /^<svg [^>]*class="ic anel-ctx"/, nome + ': o anel segue desenhado');
    assert.equal(arco(bt), 78, nome + ': e o arco segue mostrando o uso');
    assert.equal(bt.title, 'A conversa usou 78 % do espaço.', nome);
    assert.equal(bt.attrs['aria-label'], bt.title, nome + ': o nome acessível é o mesmo');
    assert.doesNotMatch(bt.title, /Resumir/, nome);
    assert.equal(anel(184000, 200000, null, { engine, started }).title, 'A conversa usou 92 % do espaço: cheio.', nome + ': cheio');
    const vazio = anel(0, 0, null, { engine, started });
    assert.equal(vazio.title, 'Contexto ainda não medido', nome + ': sem medida o hover é o de sempre');
    assert.equal(vazio.disabled, true);
  }
});

test('onde dá para resumir (Claude e Codex com a sessão ligada) o anel segue como era: com clique e com o convite a resumir no hover (rodada 2, item 8)', () => {
  for (const engine of ['claude', 'codex']) {
    assert.equal(anel(156000, 200000, null, { engine, started: true }).disabled, false, engine);
    assert.equal(anel(156000, 200000, null, { engine, started: true }).title, 'A conversa usou 78 % do espaço. Resumir libera espaço sem perder o fio.', engine);
    assert.equal(anel(184000, 200000, null, { engine, started: true }).title, 'A conversa usou 92 % do espaço: cheio. Resumir libera espaço sem perder o fio.', engine);
    assert.equal(anel(0, 0, null, { engine, started: true }).disabled, false, engine + ': sem medida ainda dá para tentar resumir');
  }
});

test('o anel acompanha o painel: ligou a sessão, caiu ou trocou de motor, e o desenho não é refeito à toa (rodada 2, item 8)', () => {
  const bt = anel(100000, 200000, null, { engine: 'claude', started: false });
  assert.equal(bt.disabled, true, 'ainda sem sessão');
  const escritas = bt.escritas;
  bt.repintarPainel({ started: true });
  assert.equal(bt.disabled, false, 'a sessão ligou');
  assert.match(bt.title, /Resumir libera espaço/);
  bt.repintarPainel({ engine: 'gemini' });
  assert.equal(bt.disabled, true, 'trocou para um motor que não resume');
  assert.doesNotMatch(bt.title, /Resumir/);
  bt.repintarPainel({ engine: 'codex', started: false });
  assert.equal(bt.disabled, true, 'voltou para um motor que resume, mas sem sessão');
  bt.repintarPainel({ started: true });
  assert.equal(bt.disabled, false);
  assert.equal(bt.escritas, escritas, 'mesmo número: o SVG não foi recriado nenhuma vez');
});

test('motivoSemResumir: vazio quando dá; quando não dá, diz por quê (é o que o "/" mostra no lugar do clique) (rodada 2, item 8)', () => {
  const bt = anel(1, 2);
  assert.equal(bt.motivo({ engine: 'claude', started: true }), '');
  assert.equal(bt.motivo({ engine: 'codex', started: true }), '');
  for (const [engine, nome] of [['gemini', 'Gemini'], ['grok', 'Grok'], ['acp', 'Agente ACP']]) {
    const m = bt.motivo({ engine, started: true });
    assert.ok(m.includes('O ' + nome + ' não tem'), engine + ': ' + m);
    assert.match(m, /Comece uma conversa nova quando ela ficar longa\./);
  }
  assert.match(bt.motivo({ engine: 'claude', started: false }), /ainda não começou: mande uma mensagem antes de resumir/);
  // conferência da rodada 2: com conversa para retomar (motor desligado depois de uma troca ou ao reabrir), o motivo é o motor, não a conversa
  assert.match(bt.motivo({ engine: 'claude', started: false, sessaoId: 's1' }), /motor está desligado: mande a próxima mensagem e depois resuma/);
  assert.match(bt.motivo({ engine: 'codex', started: false, resumeId: 'r1' }), /motor está desligado/);
  assert.match(bt.motivo({ engine: 'codex', started: false }), /ainda não começou/);
});

test('o setDot repinta o anel (ligar, cair e trocar de motor passam por ele) e o ouvinte do clique continua o mesmo (rodada 2, item 8)', () => {
  assert.match(pegarBloco(APP, 'function setDot(', 'setDot'), /\bpintarAnel\(P\)/);
  assert.match(NEWPANE, /\$\('\.p-compactar', el\)\.addEventListener\('click'/, 'o clique que resume segue no newPane');
});

test('o estado .rodando (resumindo) sobrevive ao repaint e o desenho só é reescrito quando o número muda (leva 5h)', () => {
  const bt = anel(100000, 200000);
  bt.classList.add('rodando');
  const escritas = bt.escritas;
  bt.repintar(100000, 200000);
  assert.equal(bt.escritas, escritas, 'mesmo número: o SVG não é recriado a cada evento de tokens');
  assert.equal(bt.cls.has('rodando'), true, 'o repaint não mexe no .rodando (quem tira é o evento "compactou")');
  bt.repintar(110000, 200000);
  assert.equal(bt.escritas, escritas + 1, 'número novo: desenha de novo');
  assert.equal(arco(bt), 55);
});

test('o botão do contexto nasce à vista e vazio no molde (sem hidden, sem texto, sem SVG): o desenho vem do pintarAnel (leva 5h)', () => {
  const i = HTML.indexOf('<button class="cb p-compactar');
  assert.ok(i > 0, 'o botão do contexto tem a classe cb, como os outros da esquerda (ganha o formato redondo do visual Mac)');
  const botao = HTML.slice(i, HTML.indexOf('</button>', i) + 9);
  assert.doesNotMatch(botao, /\bhidden\b/, 'à vista desde o começo');
  assert.doesNotMatch(botao, /<svg|an-fio|cp-txt/, botao);
  assert.match(botao, /title="[^"]+"/);
  assert.match(botao, />\s*<\/button>$/, 'vazio: o desenho entra pelo pintarAnel');
  // o painel novo pinta o anel já na criação (senão ele ficaria um botão em branco até o primeiro evento de tokens)
  assert.match(NEWPANE, /pintarAnel\(P\)/, 'o newPane pinta o anel vazio');
});

/* O clique no anel: o ouvinte mora dentro do newPane (grande demais para rodar inteiro numa bancada), então o comando que o liga é recortado do
   fonte de verdade, com as chaves casadas, e roda num vm com o botão e o painel de mentira. Medida: o que o clique faz, igual ao da pílula
   (que ele substitui): resume pelo motor do painel e liga o .rodando; com o painel ocupado, só avisa. */
function ligarCliqueDoAnel({ resposta = { ok: true } } = {}) {
  const i = NEWPANE.indexOf("$('.p-compactar', el).addEventListener('click'");
  assert.ok(i >= 0, 'não achei o ouvinte do clique do anel no newPane');
  let nivel = 0, k = NEWPANE.indexOf('{', i);
  for (; k < NEWPANE.length; k++) { if (NEWPANE[k] === '{') nivel++; else if (NEWPANE[k] === '}' && --nivel === 0) break; }
  const comando = NEWPANE.slice(i, NEWPANE.indexOf(';', k) + 1);
  const cls = new Set(['cb', 'p-compactar']), ouvintes = {}, chamadas = [], avisos = [];
  const bt = { classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) }, addEventListener: (t, f) => { (ouvintes[t] ||= []).push(f); } };
  const P = { id: 'p1', engine: 'claude', busy: false };
  const ctx = vm.createContext({
    $: () => bt, el: {}, P, avisoEnvio: (_P, t) => avisos.push(t), setDot: (_P, estado) => chamadas.push('dot:' + estado),
    trabalhando: (_P, t) => chamadas.push('trabalhando:' + t), pararTrabalho: () => chamadas.push('parou-de-trabalhar'),
    window: { api: { paneCompactar: async (o) => { chamadas.push('compactar:' + o.paneId + ':' + o.engine); return resposta; } } },
  });
  vm.runInContext(comando, ctx);
  const clicar = async () => { const e = { parou: false, stopPropagation() { this.parou = true; } }; await ouvintes.click[0](e); return e; };
  return { P, cls, chamadas, avisos, clicar, ouvintes };
}

test('clicar no anel resume a conversa pelo motor do painel e liga o .rodando (que o evento "compactou" tira) (leva 5h)', async () => {
  const t = ligarCliqueDoAnel();
  const e = await t.clicar();
  assert.equal(e.parou, true, 'o clique não vaza para o fechamento global dos menus');
  assert.deepEqual(t.chamadas, ['dot:busy', 'trabalhando:resumindo a conversa', 'compactar:p1:claude']);
  assert.equal(t.P.busy, true, 'o painel fica ocupado enquanto resume');
  assert.equal(t.cls.has('rodando'), true, 'e o anel fica apagado e sem clique até o "compactou"');
  assert.deepEqual(t.avisos, []);
  // o fim do resumo: o app.js tira o .rodando no evento (a linha do case "compactou")
  assert.match(APP, /case 'compactou': \$\('\.p-compactar', P\.el\)\.classList\.remove\('rodando'\)/);
});

test('o anel com erro do motor (sem sessão, Gemini...) desfaz o .rodando e o ocupado e avisa o motivo; ocupado, só avisa (leva 5h)', async () => {
  const falha = ligarCliqueDoAnel({ resposta: { error: 'sessão fora do ar' } });
  await falha.clicar();
  assert.equal(falha.P.busy, false);
  assert.equal(falha.cls.has('rodando'), false, 'volta a aceitar clique');
  assert.deepEqual(falha.avisos, ['Não deu para resumir: sessão fora do ar']);
  assert.deepEqual(falha.chamadas, ['dot:busy', 'trabalhando:resumindo a conversa', 'compactar:p1:claude', 'dot:idle', 'parou-de-trabalhar']);
  const ocupado = ligarCliqueDoAnel();
  ocupado.P.busy = true;
  await ocupado.clicar();
  assert.deepEqual(ocupado.avisos, ['Espere ele terminar para resumir a conversa.']);
  assert.deepEqual(ocupado.chamadas, [], 'ocupado: não chama o motor');
  assert.equal(ocupado.cls.has('rodando'), false);
});

/* Leva 4, onda 2, correção 2 (revisão ae08f472484ba810d). Medida: contraste do texto da pílula âmbar sobre o fundo dela.
   Antes (color:var(--yellow) puro): 3,98:1 no tema claro e 4,28:1 no jornal, abaixo dos 4,5:1 do AA para texto pequeno.
   Depois (80 % âmbar + 20 % da tinta do tema): claro 5,36, jornal 5,36, azul 6,51, escuro 7,92 (conta do revisor). */
test('o âmbar da pílula escurece com a tinta do tema para passar no contraste AA (UI 3.3)', () => {
  const regra = /(?:^|\n)\.p-compactar\.meio\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(regra, 'não achei .p-compactar.meio no style.css');
  assert.match(regra[1], /(?:^|;)\s*color:\s*color-mix\(in srgb,\s*var\(--yellow\) 80%,\s*var\(--ink\)\)/, 'cor do texto: ' + regra[1]);
});

/* Leva 5h: o anel é traço (não texto), então vale o 3:1 do WCAG 1.4.11 para componente de interface, e a mesma mistura de 20 % da tinta do tema
   (5,4 a 7,9:1 nos 4 temas, medida acima) fica muito acima disso. A pílula (fundo de 14 % da cor, padding de 9 px, fonte de 10,5 px) saiu: o
   botão é redondo e transparente como os outros da esquerda, e só a COR do traço conta o estado. */
test('CSS do anel: botão redondo sem a pílula de texto, desenho de 16 px, trilho apagado, vermelho de 92 % e as mesmas cores no visual Mac (leva 5h)', () => {
  const corpo = (css, re, msg) => { const m = re.exec(css); assert.ok(m, msg); return m[1]; };
  const base = corpo(CSS, /(?:^|\n)\.p-compactar\s*\{([^}]*)\}/, 'não achei .p-compactar no style.css');
  assert.doesNotMatch(base, /padding:\s*0 9px|(?:^|[;\s])font:|font-variant-numeric|white-space/, 'a pílula de texto saiu: ' + base);
  assert.match(base, /border-radius:\s*50%/);
  assert.match(base, /flex:\s*none/, 'o anel não encolhe');
  assert.match(corpo(CSS, /(?:^|\n)\.p-compactar \.ic\s*\{([^}]*)\}/, 'falta o tamanho do desenho'), /width:16px;\s*height:16px/);
  assert.match(corpo(CSS, /(?:^|\n)\.p-compactar \.ac-trilho\s*\{([^}]*)\}/, 'falta o trilho apagado'), /opacity:\s*\.\d+/);
  assert.match(corpo(CSS, /(?:^|\n)\.p-compactar\.cheio\s*\{([^}]*)\}/, 'falta o vermelho'), /color:\s*var\(--red\)/);
  assert.doesNotMatch(corpo(CSS, /(?:^|\n)\.p-compactar\.cheio\s*\{([^}]*)\}/, '-'), /background/, 'sem o fundo de 14 %: é um traço');
  assert.match(corpo(CSS, /(?:^|\n)\.p-compactar\.rodando\s*\{([^}]*)\}/, 'falta o .rodando'), /opacity:\s*\.55[\s\S]*pointer-events:\s*none/);
  // o visual Mac pinta os .cb com uma regra mais forte (html.visual-mac .ck-app .cmp-bar .cb): as cores do estado precisam ser repetidas lá
  assert.match(corpo(CSS_MAC, /html\.visual-mac \.ck-app \.cmp-bar \.p-compactar\.meio\s*\{([^}]*)\}/, 'falta o âmbar no visual Mac'), /color:\s*color-mix\(in srgb,\s*var\(--yellow\) 80%,\s*var\(--ink\)\)/);
  assert.match(corpo(CSS_MAC, /html\.visual-mac \.ck-app \.cmp-bar \.p-compactar\.cheio\s*\{([^}]*)\}/, 'falta o vermelho no visual Mac'), /color:\s*var\(--red\)/);
});

test('CSS do anel que só mostra: cursor normal e sem fundo de hover, no style.css e no visual Mac, sem apagar o âmbar nem o vermelho (rodada 2, item 8)', () => {
  const corpo = (css, re, msg) => { const m = re.exec(css); assert.ok(m, msg); return m[1]; };
  assert.match(corpo(CSS, /(?:^|\n)\.p-compactar:disabled\s*\{([^}]*)\}/, 'falta o .p-compactar:disabled no style.css'), /cursor:\s*default/);
  assert.match(corpo(CSS, /(?:^|\n)\.p-compactar:disabled:hover\s*\{([^}]*)\}/, 'falta o hover sem fundo no style.css'), /background:\s*transparent/);
  // a cor do hover (a regra .cb:hover clareia o traço) só sai do neutro: o âmbar e o vermelho do estado continuam
  assert.match(corpo(CSS, /(?:^|\n)\.p-compactar:disabled:not\(\.meio\):not\(\.cheio\):hover\s*\{([^}]*)\}/, 'falta o traço neutro parado no hover'), /color:\s*var\(--fg-dim\)/);
  assert.match(corpo(CSS_MAC, /html\.visual-mac \.ck-app \.cmp-bar \.p-compactar:disabled:hover\s*\{([^}]*)\}/, 'falta o hover sem fundo no visual Mac'), /background:\s*transparent/);
  assert.match(corpo(CSS_MAC, /html\.visual-mac \.ck-app \.cmp-bar \.p-compactar:disabled:not\(\.meio\):not\(\.cheio\):hover\s*\{([^}]*)\}/, 'falta o traço neutro parado no visual Mac'), /color:\s*var\(--ink-muted\)/);
  // o estado de cor do anel que só mostra é o mesmo de antes (as regras .meio e .cheio não mudaram)
  assert.match(corpo(CSS, /(?:^|\n)\.p-compactar\.meio\s*\{([^}]*)\}/, '-'), /color-mix\(in srgb,\s*var\(--yellow\) 80%,\s*var\(--ink\)\)/);
  assert.match(corpo(CSS, /(?:^|\n)\.p-compactar\.cheio\s*\{([^}]*)\}/, '-'), /color:\s*var\(--red\)/);
});

/* Rodada final, item 3 (revisão final a7ed9b2c1aa8b7f86): a pílula só aparece a partir de 70 % e o clique nela era o único gatilho do
   resumo, então abaixo disso não havia caminho para resumir a conversa. O "/" ganhou "Resumir a conversa", que faz o mesmo clique
   (o botão escondido também responde ao click()). Medida: caminhos para resumir a conversa com o uso em 50 % (antes 0; depois 1, pelo "/").
   O menu "/" DE VERDADE (menuSkills) roda num vm, com o DOM e o resto de mentira. */
async function menuDoBarra(filtro, { engine = 'claude', desabilitado = false, started = true } = {}) {
  const corpo = { itens: [], appendChild(x) { this.itens.push(x); return x; }, querySelector: () => null, querySelectorAll: () => [],
    get children() { return this.itens; }, set innerHTML(v) { this.itens.length = 0; } };
  const busca = { value: '', addEventListener() {}, focus() {}, setSelectionRange() {} };
  const campo = { value: '/' + filtro, style: {} };
  const cliques = [], avisos = [];
  const botao = { click: () => cliques.push('compactar'), disabled: desabilitado };   // o .p-compactar (desabilitado onde nao da' para resumir)
  const P = { id: 'p1', engine, started, cwd: 'C:\\proj', effort: 'high', tokens: 100000, janela: 200000, el: { '.p-input': campo, '.p-compactar': botao } };
  const ctx = vm.createContext({
    $: (sel, raiz) => raiz[sel], novoMenu: () => ({ appendChild() {} }), tituloPopup: (t) => ({ titulo: t }),
    document: { createElement: (t) => (t === 'input' ? busca : corpo) },
    elSecao: (t) => ({ secao: t }), elItem: (o, f) => ({ ...o, f }), etiquetaSkill: () => '', inserirNoInput() {}, setTimeout() {},
    modeloAtual: () => ({ nome: 'modelo' }), EF_PT: {}, modoDe: () => ({ nome: 'modo' }), nomeDoMotor: (e) => ({ gemini: 'Gemini', grok: 'Grok', acp: 'Agente ACP' }[e] || e), atalhoDaMaquina: (s) => s,
    nomePasta: (p) => p, remotoDoPane: () => null, avisoEnvio: (_P, t) => { avisos.push(t); },
    window: { api: { skills: async () => [], promptsLer: async () => [] } },
  });
  vm.runInContext(['function acaoCasa(', 'function motivoSemResumir(', 'async function menuSkills('].map((a) => pegarBloco(APP, a, a)).join('\n'), ctx);
  await ctx.menuSkills(P, filtro, false);
  return { itens: corpo.itens, cliques, avisos, campo };
}

test('"/": "Resumir a conversa" acha por resumir, compactar, compact e contexto e dispara o mesmo clique do botão, mesmo escondido (UI 3.3)', async () => {
  for (const q of ['resumir', 'Resumir', 'compactar', 'compact', 'contexto']) {
    const { itens, cliques, campo } = await menuDoBarra(q);
    const item = itens.find((x) => x.nome === 'Resumir a conversa');
    assert.ok(item, 'digitar "' + q + '" no / não achou o item: ' + itens.map((x) => x.nome || x.secao).join(' | '));
    assert.deepEqual([item.sec, item.ic], ['Contexto', 'refresh-cw']);
    item.f();
    assert.deepEqual(cliques, ['compactar'], q + ': o item chama o clique do .p-compactar');
    assert.equal(campo.value, '', q + ': o "/" digitado sai do campo, como nos outros itens');
  }
  const { itens } = await menuDoBarra('zzz-nada');
  assert.equal(itens.some((x) => x.nome === 'Resumir a conversa'), false, 'não aparece fora do filtro');
});

test('"/": onde o anel só mostra (disabled), "Resumir a conversa" não clica no vazio: avisa por que não dá (rodada 2, item 8)', async () => {
  for (const [opcoes, esperado] of [
    [{ engine: 'gemini', desabilitado: true }, /O Gemini não tem "resumir" por aqui\. Comece uma conversa nova quando ela ficar longa\./],
    [{ engine: 'grok', desabilitado: true }, /O Grok não tem "resumir"/],
    [{ engine: 'acp', desabilitado: true }, /O Agente ACP não tem "resumir"/],
    [{ engine: 'claude', started: false, desabilitado: true }, /ainda não começou: mande uma mensagem antes de resumir/],
  ]) {
    const { itens, cliques, avisos } = await menuDoBarra('resumir', opcoes);
    const item = itens.find((x) => x.nome === 'Resumir a conversa');
    assert.ok(item, 'o item continua na lista (é o caminho do teclado)');
    item.f();
    assert.deepEqual(cliques, [], opcoes.engine + ': o botão desabilitado não é clicado');
    assert.equal(avisos.length, 1, opcoes.engine + ': um aviso, e não um silêncio');
    assert.match(avisos[0], esperado);
  }
  // onde dá, o mesmo item continua clicando no anel e sem aviso nenhum
  const bom = await menuDoBarra('resumir');
  bom.itens.find((x) => x.nome === 'Resumir a conversa').f();
  assert.deepEqual(bom.cliques, ['compactar']);
  assert.deepEqual(bom.avisos, []);
});

test('"/": o item mora na seção Contexto (uma só vez, sem partir a seção) e o ícone refresh-cw existe no ICONES (UI 3.3)', async () => {
  const { itens } = await menuDoBarra('');
  const iSecao = itens.findIndex((x) => x.secao === 'Contexto');
  const iItem = itens.findIndex((x) => x.nome === 'Resumir a conversa');
  const iProxima = itens.findIndex((x, i) => i > iSecao && x.secao);
  assert.equal(itens.filter((x) => x.secao === 'Contexto').length, 1, 'a seção Contexto aparece uma vez só');
  assert.ok(iSecao >= 0 && iItem > iSecao && iItem < iProxima, 'o item está entre o título da seção Contexto e o da próxima: ' + [iSecao, iItem, iProxima]);
  assert.match(APP, /^const ICONES = \{[^\n]*"refresh-cw":/m, 'ícone refresh-cw no mapa fechado ICONES');
});

/* Rodada final, item 6 (revisão final a7ed9b2c1aa8b7f86): na leva 4 o Debater passou a ser a balança (scale) no + e na barra, mas o "/" ficou com
   o messages-square de antes: o mesmo recurso com dois desenhos. Mesma bancada do menu "/" de verdade (acima).
   Medida: ícones diferentes para o Debater entre o +, a barra e o "/" (antes 2: scale e messages-square; depois 1: scale). */
test('"/": "Debater com Codex e Claude" leva a balança (scale), igual ao + e à barra; os outros itens do debate não mudam (UI 3.1)', async () => {
  const { itens } = await menuDoBarra('debat');
  assert.deepEqual(itens.filter((x) => x.nome).map((x) => [x.nome, x.ic]), [['Debater com Codex e Claude', 'scale']]);
  const { itens: revisar } = await menuDoBarra('revisar');
  assert.deepEqual(revisar.filter((x) => x.nome).map((x) => [x.nome, x.ic]), [['Revisar código com os dois', 'git-compare']]);
  // o ícone existe no mapa fechado: nome que não existe sai <svg> vazio
  assert.match(APP, /^\s*'scale':\s*'<path/m, 'ícone scale no ICONES');
});
