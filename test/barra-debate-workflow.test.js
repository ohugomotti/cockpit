'use strict';
/* Leva 5i, item 4 da spec (prévia C, aprovada pelo Hugo em 09/10): o ⚖ Debater e o 👥 Workflow dos agentes ao lado do motor.
   O que mudou, e a medida de cada coisa (conta, a confirmar na prévia):
   - na linha de baixo da caixa, à direita, entram dois botões FIXOS antes do chip do modelo: ⚖ (.p-debate, ícone scale) e 👥 (.p-workflow, ícone users).
     Botões à vista antes do chip: antes 0 (o 👥 nascia escondido, o debate só existia no menu do +) e depois 2;
   - o número do 👥 conta só os agentes ATIVOS (rodando, aguardando, esperando você). Antes contava todos os que a conversa já chamou: com 3 agentes e 2 já
     concluídos o botão dizia 3 e agora diz 1; sem ativos, só o ícone;
   - o botão temporário do debate em andamento (leva 4) se fundiu com o ⚖: botões do debate na barra com o debate rodando, antes 1 (o temporário) e depois 1
     (o próprio ⚖, com o estado "rodando"); botões criados em tempo de execução, antes 1 e depois 0.
   Aqui ficam os testes DESTE item. Os testes do desenho antigo que mudaram junto são caixa-duas-linhas, caixa-uma-linha, menu-mais-icones, barra-encaixe e
   renderer-debate (cada um diz o que mudou). Os recortes do app.js rodam em vm; o DOM de mentira é o mínimo e NENHUM nó dele vai dentro de um assert (um
   assert que falha com um nó tenta mostrar o objeto inteiro: foi o que derrubou o PC em 08/10), só texto, número e booleano. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');

const APP = lerFonte('renderer', 'app.js');
const HTML = lerFonte('renderer', 'index.html');
const COLAB = lerFonte('renderer', 'collaboration.js');
const CSS_UI = lerFonte('renderer', 'cockpit-ui.css');
const CSS_MAC = lerFonte('renderer', 'visual-mac.css');
const CSS_COLAB = lerFonte('renderer', 'collaboration.css');
const UI_SRC = lerFonte('renderer', 'cockpit-ui.js');
const { searchText } = require('../src/renderer/cockpit-ui.js');   // o mesmo que a paleta Ctrl+K usa para casar o que se digita com o título do comando

/* ---------- o template ---------- */

/* Os botões da caixa .cmp-dir do index.html, na ordem do template. O chip (um div com 3 botões) conta como UM item (os 3 têm teste próprio). */
function direitaDoTemplate() {
  const i = HTML.indexOf('<div class="cmp-bar">');
  const bar = HTML.slice(i, HTML.indexOf('\n      </div>', i));
  const d = bar.indexOf('<div class="cmp-dir">');
  assert.ok(d > 0, 'falta a caixa da direita (.cmp-dir) no template');
  const direita = bar.slice(d).replace(/<div class="p-model"[\s\S]*?\n {10}<\/div>/, '<button class="p-model"></button>');
  return [...direita.matchAll(/<button\b([^>]*)>/g)].map((m) => ({ atributos: m[1], classes: /class="([^"]+)"/.exec(m[1])[1].split(/\s+/) }));
}
const nome = (b) => b.classes.find((c) => c.startsWith('p-'));
const atributo = (b, a) => (new RegExp('\\b' + a + '="([^"]*)"').exec(b.atributos) || [])[1];

/* ---------- o DOM de mentira ---------- */

class El {
  constructor(classes = '', tag = 'button') {
    this.tag = tag; this.className = classes; this.filhos = []; this.pai = null; this.title = ''; this.dataset = {}; this.attrs = {}; this.ouvintes = {};
    this.escritas = 0; this._html = '';
  }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = v; this.escritas++; }
  get classes() { return this.className.split(/\s+/).filter(Boolean); }
  get classList() {
    const este = this;
    return {
      contains: (c) => este.classes.includes(c),
      add: (...cs) => { este.className = [...new Set([...este.classes, ...cs])].join(' '); },
      remove: (...cs) => { este.className = este.classes.filter((c) => !cs.includes(c)).join(' '); },
      toggle: (c, on) => { const liga = on === undefined ? !este.classes.includes(c) : !!on; if (liga) este.classList.add(c); else este.classList.remove(c); return liga; },
    };
  }
  get parentNode() { return this.pai; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(t, f) { (this.ouvintes[t] ||= []).push(f); }
  remove() { if (this.pai) { this.pai.filhos = this.pai.filhos.filter((f) => f !== this); this.pai = null; } }
  appendChild(n) { n.remove(); n.pai = this; this.filhos.push(n); return n; }
  insertBefore(n, ref) {
    if (ref && ref.pai !== this) throw new Error('NotFoundError: a referência não é filha deste pai');
    n.remove(); n.pai = this;
    if (ref) this.filhos.splice(this.filhos.indexOf(ref), 0, n); else this.filhos.push(n);
    return n;
  }
  querySelector(sel) {
    const alvo = sel.slice(1);   // só ".classe": seletor composto não acha nada
    for (const f of this.filhos) { if (f.classes.includes(alvo)) return f; const d = f.querySelector(sel); if (d) return d; }
    return null;
  }
  clicar() { const e = { parou: false, stopPropagation() { this.parou = true; } }; for (const f of this.ouvintes.click || []) f(e); return e; }
}

/* A barra do template de verdade: a esquerda direto nela, a direita dentro da .cmp-dir (o chip como um item só). */
function barraDeMentira() {
  const raiz = new El('pane', 'section');
  const bar = raiz.appendChild(new El('cmp-bar', 'div'));
  const dir = bar.appendChild(new El('cmp-dir', 'div'));
  for (const b of direitaDoTemplate()) dir.appendChild(new El(b.classes.join(' ')));
  return { raiz, bar, dir, ordem: () => dir.filhos.map(nome) };
}

/* ---------- a ordem na direita ---------- */

test('a ordem na direita é ⚖, 👥, chip, ■, ↑; os dois botões nascem à vista e trazem o nome no hover e no leitor de tela (leva 5i)', () => {
  const direita = direitaDoTemplate();
  assert.deepEqual(direita.map(nome), ['p-debate', 'p-workflow', 'p-model', 'p-stop', 'p-send']);
  const [debate, workflow] = direita;
  for (const b of [debate, workflow]) {
    assert.ok(b.classes.includes('cb'), nome(b) + ': é um botão da barra (.cb), do mesmo tamanho dos vizinhos');
    assert.ok(!b.classes.includes('hidden'), nome(b) + ': nasce à vista, sempre');
  }
  assert.equal(atributo(debate, 'title'), 'Debater com Codex e Claude');
  assert.equal(atributo(debate, 'aria-label'), 'Debater com Codex e Claude');
  assert.equal(atributo(workflow, 'title'), 'Workflow dos agentes');
  assert.equal(atributo(workflow, 'aria-label'), 'Workflow dos agentes');
  assert.deepEqual(direita.filter((b) => b.classes.includes('hidden')).map(nome), ['p-stop'], 'só o ■ nasce escondido (depende do que está acontecendo)');
});

test('com a sugestão ✨ e o continuar › a ordem é ⚖, 👥, chip, ✨, ›, ■, ↑, venha qual vier primeiro (leva 5i)', () => {
  const ctx = vm.createContext({ $: (sel, no) => no.querySelector(sel), document: { createElement: (t) => new El('', t) }, ico: (n) => '<svg data-ic="' + n + '"></svg>', cfg: {},
    podeContinuar: () => true, fecharMenus: () => {} });
  vm.runInContext(['mostrarSugestoes', 'limparSugestoes', 'mostrarContinuar', 'limparContinuar'].map((f) => pegarBloco(APP, 'function ' + f + '(', f)).join('\n'), ctx);
  const FILA = ['p-debate', 'p-workflow', 'p-model', 'p-sugs', 'p-cont', 'p-stop', 'p-send'];
  const a = barraDeMentira();
  ctx.mostrarSugestoes({ el: a.raiz }, ['faça isso']);
  ctx.mostrarContinuar({ el: a.raiz });
  assert.deepEqual(a.ordem(), FILA, 'a sugestão chegou primeiro');
  const b = barraDeMentira();
  ctx.mostrarContinuar({ el: b.raiz });
  ctx.mostrarSugestoes({ el: b.raiz }, ['faça isso']);
  assert.deepEqual(b.ordem(), FILA, 'o continuar chegou primeiro');
  ctx.limparContinuar({ el: b.raiz });
  ctx.limparSugestoes({ el: b.raiz });
  assert.deepEqual(b.ordem(), ['p-debate', 'p-workflow', 'p-model', 'p-stop', 'p-send'], 'sem os chips, volta a caixa do template');
});

/* ---------- os cliques ---------- */

/* O ligarBotoesDaBarra de verdade (e o enviarArquivoDoPc, que ele usa), com o pintarAgentes de verdade, numa barra que só tem os dois botões da direita.
   O pintarBotao (collaboration.js) vem junto, para provar o clique do ⚖ no estado "rodando". */
function bancadaDosCliques({ colaboracao = true } = {}) {
  const eventos = [];
  const raiz = new El('pane', 'section');
  const debate = raiz.appendChild(new El('cb p-debate')), workflow = raiz.appendChild(new El('cb p-workflow'));
  const ctx = vm.createContext({
    $: (sel, no) => no.querySelector(sel), ico: (n) => '<svg data-ic="' + n + '"></svg>', fecharMenus: () => eventos.push('fechou'),
    window: colaboracao ? { CockpitCollaboration: { open: (P) => eventos.push('open:' + P.id), workflow: (P) => eventos.push('workflow:' + P.id) } } : {},
  });
  vm.runInContext([
    'async function enviarArquivoDoPc(', 'function ligarBotoesDaBarra(', 'function pintarAgentes(',
  ].map((a) => pegarBloco(APP, a, a)).join('\n') + '\n' + pegarBloco(COLAB, 'function pintarBotao(', 'pintarBotao'), ctx);
  const P = { id: 'p1', el: raiz, agentesTrabalho: new Map() };
  ctx.ligarBotoesDaBarra(P, raiz);
  return { ctx, P, raiz, debate, workflow, eventos };
}

test('o ⚖ abre o debate (CockpitCollaboration.open) e o 👥 abre o workflow (CockpitCollaboration.workflow); os dois fecham o menu aberto e o clique não sobe (leva 5i)', () => {
  const t = bancadaDosCliques();
  const d = t.debate.clicar();
  assert.deepEqual(t.eventos, ['fechou', 'open:p1'], 'o mesmo gesto do item do menu do +: fecha o que estiver aberto e abre o diálogo do debate');
  assert.equal(d.parou, true, 'o clique não vaza para o fechamento global do document');
  t.eventos.length = 0;
  const w = t.workflow.clicar();
  assert.deepEqual(t.eventos, ['fechou', 'workflow:p1'], 'o workflow dos agentes desta conversa');
  assert.equal(w.parou, true);
});

test('o ⚖ tem o ícone da balança e o 👥 nasce com o ícone dos agentes, já na criação do painel, sem esperar o relógio (leva 5i)', () => {
  const t = bancadaDosCliques();
  assert.equal(t.debate.innerHTML, '<svg data-ic="scale"></svg>');
  assert.equal(t.workflow.innerHTML, '<svg data-ic="users"></svg>', 'o botão não nasce vazio: o ligarBotoesDaBarra já chama o pintarAgentes');
  assert.equal(t.workflow.title, 'Workflow dos agentes');
  assert.match(pegarBloco(APP, 'function ligarBotoesDaBarra(', 'ligarBotoesDaBarra'), /if \(typeof pintarAgentes === 'function'\) pintarAgentes\(P\);/);
});

test('antes do collaboration.js carregar (sem window.CockpitCollaboration) o clique não quebra; painel sem os botões (molde antigo) também não (leva 5i)', () => {
  const sem = bancadaDosCliques({ colaboracao: false });
  assert.doesNotThrow(() => { sem.debate.clicar(); sem.workflow.clicar(); });
  assert.deepEqual(sem.eventos, ['fechou', 'fechou']);
  const ctx = bancadaDosCliques().ctx;
  const vazio = new El('pane', 'section');
  assert.doesNotThrow(() => ctx.ligarBotoesDaBarra({ id: 'p2', el: vazio, agentesTrabalho: new Map() }, vazio));
});

test('o clique do ⚖ é um só, com o debate rodando ou não: o que o botão temporário fazia (abrir o debate para acompanhar) agora é o próprio ⚖ (leva 5i)', () => {
  const t = bancadaDosCliques();
  t.ctx.pintarBotao(t.P, true);
  assert.ok(t.debate.classList.contains('rodando'));
  t.eventos.length = 0;
  t.debate.clicar();
  assert.deepEqual(t.eventos, ['fechou', 'open:p1'], 'rodando: abre o debate em andamento (o open devolve o foco ao diálogo aberto)');
  t.ctx.pintarBotao(t.P, false);
  t.eventos.length = 0;
  t.debate.clicar();
  assert.deepEqual(t.eventos, ['fechou', 'open:p1'], 'parado: o mesmo clique');
  assert.equal((t.debate.ouvintes.click || []).length, 1, 'um ouvinte só: não há um caminho para cada estado');
  assert.equal((t.workflow.ouvintes.click || []).length, 1);
});

test('o newPane já não liga o clique do 👥: quem liga o ⚖ e o 👥 é o ligarBotoesDaBarra, e o newPane chama esse (leva 5i)', () => {
  const NEWPANE = APP.slice(APP.indexOf('function newPane('), APP.indexOf('/* ===================== COLUNAS'));
  assert.doesNotMatch(NEWPANE, /\$\('\.p-workflow'/);
  assert.doesNotMatch(NEWPANE, /CockpitCollaboration\?\.(open|workflow)/);
  assert.match(NEWPANE, /ligarBotoesDaBarra\(P, el\);/);
});

/* ---------- o 👥: sempre à vista, número só dos ativos ---------- */

function bancadaDosAgentes() {
  const raiz = new El('pane', 'section');
  const bt = raiz.appendChild(new El('cb p-workflow'));
  const ctx = vm.createContext({ $: (sel, no) => no.querySelector(sel), ico: (n) => '<svg data-ic="' + n + '"></svg>' });
  vm.runInContext(pegarBloco(APP, 'function pintarAgentes(', 'pintarAgentes'), ctx);
  const P = { id: 'p1', el: raiz, agentesTrabalho: new Map() };
  const poe = (...estados) => { P.agentesTrabalho.clear(); estados.forEach((s, i) => P.agentesTrabalho.set('a' + i, { id: 'a' + i, state: s })); ctx.pintarAgentes(P); };
  return { ctx, P, bt, poe };
}

test('sem agentes o 👥 fica à vista, só com o ícone, sem número, no cinza dos vizinhos; hover e aria dizem "Workflow dos agentes" (leva 5i)', () => {
  const { ctx, P, bt } = bancadaDosAgentes();
  ctx.pintarAgentes(P);
  assert.equal(bt.innerHTML, '<svg data-ic="users"></svg>');
  assert.equal(bt.title, 'Workflow dos agentes');
  assert.equal(bt.attrs['aria-label'], 'Workflow dos agentes');
  assert.equal(bt.dataset.active, 'false', 'sem destaque');
  assert.ok(!bt.classList.contains('hidden'), 'à vista');
  assert.doesNotMatch(pegarBloco(APP, 'function pintarAgentes(', 'pintarAgentes'), /hidden/, 'o pintarAgentes não esconde mais o botão');
  // painel sem o mapa de agentes (conversa recém-aberta) e painel sem o botão (molde antigo)
  assert.doesNotThrow(() => ctx.pintarAgentes({ id: 'x', el: bt.pai, agentesTrabalho: undefined }));
  assert.doesNotThrow(() => ctx.pintarAgentes({ id: 'y', el: new El('pane', 'section') }));
  assert.doesNotThrow(() => ctx.pintarAgentes(null));
});

test('o número do 👥 conta só os ativos: rodando, aguardando e esperando você; quem já acabou ou parou não conta (leva 5i)', () => {
  const t = bancadaDosAgentes();
  for (const s of ['running', 'pending', 'waiting']) {
    t.poe(s);
    assert.equal(t.bt.innerHTML, '<svg data-ic="users"></svg><span>1</span>', s + ': ativo, conta');
    assert.equal(t.bt.dataset.active, 'true', s + ': ganha o destaque');
  }
  for (const s of ['completed', 'failed', 'interrupted', 'shutdown', 'notFound', 'idle', 'unknown', undefined]) {
    t.poe('running');   // volta a ter 1 ativo, para provar que o estado novo TIRA da conta
    t.poe(s);
    assert.equal(t.bt.innerHTML, '<svg data-ic="users"></svg>', String(s) + ': já acabou ou parou, não conta');
    assert.equal(t.bt.dataset.active, 'false', String(s) + ': sem destaque');
  }
});

test('três agentes, dois já concluídos: o 👥 diz 1 (antes dizia 3), e o hover e o aria dizem "· 1 trabalhando" (leva 5i)', () => {
  const t = bancadaDosAgentes();
  t.poe('completed', 'running', 'completed');
  assert.equal(t.bt.innerHTML, '<svg data-ic="users"></svg><span>1</span>');
  assert.equal(t.bt.title, 'Workflow dos agentes · 1 trabalhando');
  assert.equal(t.bt.attrs['aria-label'], 'Workflow dos agentes · 1 trabalhando');
  t.poe('running', 'pending', 'waiting', 'running', 'completed', 'failed', 'idle', 'interrupted');
  assert.equal(t.bt.innerHTML, '<svg data-ic="users"></svg><span>4</span>');
  assert.equal(t.bt.title, 'Workflow dos agentes · 4 trabalhando');
  assert.equal(t.bt.attrs['aria-label'], t.bt.title);
  // todos acabam: o número some, o botão fica e o destaque apaga
  t.poe('completed', 'completed', 'failed', 'running');
  assert.equal(t.bt.dataset.active, 'true');
  t.poe('completed', 'completed', 'failed', 'completed');
  assert.equal(t.bt.innerHTML, '<svg data-ic="users"></svg>');
  assert.equal(t.bt.title, 'Workflow dos agentes');
  assert.equal(t.bt.dataset.active, 'false');
});

test('o 👥 só se repinta quando o número de ativos muda (o relógio chama o pintarAgentes a cada segundo) (leva 5i)', () => {
  const t = bancadaDosAgentes();
  t.poe('running', 'completed');
  const escritas = t.bt.escritas;
  for (let i = 0; i < 5; i++) t.ctx.pintarAgentes(t.P);
  assert.equal(t.bt.escritas, escritas, 'mesmo número, nenhuma escrita');
  t.poe('running', 'completed', 'completed', 'completed');   // mais agentes, mas os mesmos ativos
  assert.equal(t.bt.escritas, escritas, 'o total mudou, o número de ativos não: nada a repintar');
  t.poe('running', 'running');
  assert.equal(t.bt.escritas, escritas + 1, 'mudou o número: uma escrita só');
});

test('o destaque do 👥 ativo é o CSS que já existia no visual-mac.css (data-active="true", cor de foco) e agora é ligado pelo pintarAgentes (leva 5i)', () => {
  assert.match(CSS_MAC, /\.ck-app \.cmp-bar \.p-workflow\[data-active="true"\] \{ color: var\(--focus\); \}/);
  assert.match(pegarBloco(APP, 'function pintarAgentes(', 'pintarAgentes'), /bt\.dataset\.active = n \? 'true' : 'false';/);
});

/* ---------- o ⚖ rodando e o botão temporário fora ---------- */

test('o debate rodando põe o estado "rodando" no próprio ⚖ (e no hover); acabando, o ⚖ volta ao normal; nenhum botão é criado (leva 5i)', () => {
  const t = bancadaDosCliques();
  let criados = 0;
  const original = t.raiz.appendChild.bind(t.raiz);
  t.raiz.appendChild = (n) => { criados++; return original(n); };
  const antes = t.raiz.filhos.length;
  assert.ok(!t.debate.classList.contains('rodando'));
  t.ctx.pintarBotao(t.P, true);
  assert.ok(t.debate.classList.contains('rodando'));
  assert.equal(t.debate.title, 'Debate em andamento — clique para acompanhar');
  assert.equal(t.debate.attrs['aria-label'], 'Debate em andamento — clique para acompanhar');
  t.ctx.pintarBotao(t.P, true);   // evento repetido: mesma coisa
  assert.ok(t.debate.classList.contains('rodando'));
  assert.equal(t.raiz.filhos.length, antes, 'nenhum botão temporário');
  assert.equal(criados, 0);
  t.ctx.pintarBotao(t.P, false);
  assert.ok(!t.debate.classList.contains('rodando'));
  assert.equal(t.debate.title, 'Debater com Codex e Claude');
  assert.equal(t.debate.attrs['aria-label'], 'Debater com Codex e Claude');
  assert.equal(t.raiz.filhos.length, antes, 'e o ⚖ continua lá, fixo');
  assert.equal(t.debate.innerHTML, '<svg data-ic="scale"></svg>', 'o desenho continua o do ligarBotoesDaBarra: o pintarBotao não escreve dentro dele');
  assert.doesNotThrow(() => t.ctx.pintarBotao({ id: 'sem-barra', el: new El('pane', 'section') }, true), 'painel sem o ⚖ (molde antigo): não quebra');
  assert.doesNotThrow(() => t.ctx.pintarBotao(null, true));
});

test('o botão temporário do debate saiu do collaboration.js e do CSS: nada de .pd-rot, .pd-ponto nem .ativo (leva 5i)', () => {
  assert.doesNotMatch(COLAB, /pd-rot|pd-ponto|button\('', 'p-debate'/);
  assert.doesNotMatch(CSS_COLAB, /pd-ponto|\.p-debate\.ativo/);
  assert.doesNotMatch(CSS_UI, /\.pd-rot/);
  assert.match(CSS_COLAB, /\.p-debate\.rodando/, 'o estado do fallback também é "rodando"');
  assert.match(CSS_COLAB, /@keyframes co-pulsa/, 'a pulsada continua no collaboration.css, para o anel do ⚖');
});

test('o estado "rodando" do ⚖ tem destaque (cor de foco) e um anel discreto que pulsa; quem pede menos movimento recebe o anel parado (leva 5i)', () => {
  const regra = (re) => { const m = re.exec(CSS_MAC); assert.ok(m, 'não achei ' + re); return m[1]; };
  assert.match(regra(/\n\.ck-app \.cmp-bar \.p-debate\.rodando \{([^}]*)\}/), /color:\s*var\(--focus\)/);
  const anel = regra(/\n\.ck-app \.cmp-bar \.p-debate\.rodando::after \{([^}]*)\}/);
  assert.match(anel, /animation:\s*co-pulsa 1\.6s/, 'o anel pulsa devagar');
  assert.match(anel, /pointer-events:\s*none/, 'e nunca rouba o clique do botão');
  assert.match(anel, /position:\s*absolute/);
  assert.match(anel, /inset:\s*2px/, 'o anel fica por dentro do botão (2 px de folga + 1,5 px de traço), sem bater no vizinho');
  assert.match(anel, /border-radius:\s*inherit/, 'e segue o raio do botão (8 px, ou 14 px no visual Mac)');
  assert.match(CSS_MAC, /@media \(prefers-reduced-motion: reduce\) \{\s*\.ck-app \.cmp-bar \.p-debate\.rodando::after \{ animation: none; opacity: \.55; \}/);
});

/* ---------- o menu do + e o nível 5 do encaixe ---------- */

const DEBATER = 'Debater com Codex e Claude', WORKFLOW = 'Workflow dos agentes';

/* O menuMais de verdade, com a barra de mentira no nível `aperto` (undefined = o painel não tem .cmp-bar). Cada ferramenta que o + oferece é um item com a
   ação dele; `acionar(nome)` clica nele, como o elItem faria. */
function menuMaisDe(aperto) {
  const itens = [], eventos = [];
  const ctx = vm.createContext({
    $: (sel) => (sel === '.cmp-bar' && aperto !== undefined ? { dataset: { aperto } } : null),
    shortPath: (p) => p, elLinha: () => ({ setAttribute() {} }), tituloPopup: () => ({}), subPopup: () => ({}),
    novoMenu: () => ({ appendChild: (x) => itens.push(x), classList: { add() {} }, style: { setProperty() {} } }),
    elItem: (o, f) => ({ nome: o.nome, ic: o.ic, soIcone: o.soIcone, f }),
    abrirQuadro() {}, menuSkills() {},
    window: { CockpitExperiments: { open() {} }, CockpitCollaboration: { open: (P) => eventos.push('open:' + P.id), workflow: (P) => eventos.push('workflow:' + P.id) } },
  });
  vm.runInContext(['menuAnexo', 'menuMais'].map((f) => pegarBloco(APP, 'function ' + f + '(', f)).join('\n'), ctx);
  ctx.menuMais({ id: 'p1', cwd: 'C:\\proj', el: {} });
  const nomes = itens.filter((x) => x && x.nome).map((x) => x.nome);
  return { itens, nomes, eventos, acionar: (nome) => itens.find((x) => x && x.nome === nome).f() };
}

test('o menu do + não tem mais o Debater nem o Workflow: depois dos anexos só Desenhar, Comandos e Voz/imagens/nuvem, em todo nível de 0 a 4 e sem barra (leva 5i)', () => {
  for (const aperto of [undefined, '', '0', '1', '2', '3', '4']) {
    const { nomes } = menuMaisDe(aperto);
    assert.deepEqual(nomes.slice(-3), ['Desenhar', 'Comandos', 'Voz, imagens e nuvem'], 'nível ' + JSON.stringify(aperto));
    assert.equal(nomes.length, 9, 'nível ' + JSON.stringify(aperto) + ': 6 anexos e 3 ferramentas (antes eram 11)');
    assert.ok(!nomes.includes(DEBATER) && !nomes.includes(WORKFLOW), 'nível ' + JSON.stringify(aperto) + ': os dois moram na barra');
  }
});

test('no nível 5 (o encaixe tirou o ⚖ e o 👥 da barra) o menu do + os mostra, no fim, e os dois itens fazem o mesmo que os botões da barra (leva 5i)', () => {
  const m = menuMaisDe('5');
  assert.deepEqual(m.nomes.slice(-5), ['Desenhar', 'Comandos', 'Voz, imagens e nuvem', DEBATER, WORKFLOW]);
  assert.equal(m.nomes.length, 11);
  assert.deepEqual([DEBATER, WORKFLOW].map((n) => m.itens.find((x) => x && x.nome === n).ic), ['scale', 'users'], 'os mesmos ícones dos botões');
  assert.ok(m.itens.filter((x) => x && x.nome).every((x) => x.soIcone === true), 'todos só de ícone, como o resto da janelinha');
  m.acionar(DEBATER);
  m.acionar(WORKFLOW);
  // os botões da barra, na bancada dos cliques: as mesmas chamadas, com o mesmo painel
  const barra = bancadaDosCliques();
  barra.debate.clicar();
  barra.workflow.clicar();
  assert.deepEqual(m.eventos, ['open:p1', 'workflow:p1']);
  assert.deepEqual(barra.eventos.filter((e) => /^(open|workflow):/.test(e)), m.eventos, 'o item do menu e o botão da barra chamam as mesmas funções');
});

test('o nível 5 é o mesmo para o CSS, o encaixe e o menu: o CSS esconde o ⚖ e o 👥 em data-aperto="5", o encaixarBarra tenta até o 5 e o menuMais lê o "5" (leva 5i)', () => {
  assert.match(CSS_UI, /\.ck-app \.cmp-bar\[data-aperto="5"\] \.p-debate,\s*\.ck-app \.cmp-bar\[data-aperto="5"\] \.p-workflow \{\s*display: none;/);
  assert.match(pegarBloco(APP, 'function encaixarBarra(', 'encaixarBarra'), /for \(let nivel = 0; nivel <= 5; nivel\+\+\)/);
  assert.match(pegarBloco(APP, 'function menuMais(', 'menuMais'), /barra\.dataset\.aperto === '5'/);
  // o nível 5 mantém o que o 4 faz: o teto do chip vale nos dois
  assert.match(CSS_UI, /\.ck-app \.cmp-bar:is\(\[data-aperto="4"\], \[data-aperto="5"\]\) \.pm-modelo \{\s*max-width: 72px;/);
  // (que nenhum nível de 1 a 4 esconde o ⚖ nem o 👥 é provado, regra por regra, em test/barra-encaixe.test.js)
});

/* ---------- os outros caminhos: o / e a paleta Ctrl+K ---------- */

/* O menu "/" DE VERDADE (menuSkills, com o acaoCasa e o motivoSemResumir que ele usa), num vm com o DOM de mentira: a mesma bancada de
   test/pilula-contexto.test.js, mais o window.CockpitCollaboration para clicar nos itens. `filtro` é o que se digita depois da barra. */
async function menuDaBarraDe(filtro) {
  const corpo = { itens: [], appendChild(x) { this.itens.push(x); return x; }, querySelector: () => null, querySelectorAll: () => [],
    get children() { return this.itens; }, set innerHTML(v) { this.itens.length = 0; } };
  const busca = { value: '', addEventListener() {}, focus() {}, setSelectionRange() {} };
  const campo = { value: '/' + filtro, style: {} };
  const eventos = [];
  const P = { id: 'p1', engine: 'claude', started: true, cwd: 'C:\\proj', effort: 'high', tokens: 100000, janela: 200000, el: { '.p-input': campo, '.p-compactar': { click() {}, disabled: false } } };
  const ctx = vm.createContext({
    $: (sel, raiz) => raiz[sel], novoMenu: () => ({ appendChild() {} }), tituloPopup: (t) => ({ titulo: t }),
    document: { createElement: (t) => (t === 'input' ? busca : corpo) },
    elSecao: (t) => ({ secao: t }), elItem: (o, f) => ({ ...o, f }), etiquetaSkill: () => '', inserirNoInput() {}, setTimeout() {},
    modeloAtual: () => ({ nome: 'modelo' }), EF_PT: {}, modoDe: () => ({ nome: 'modo' }), nomeDoMotor: (e) => e, atalhoDaMaquina: (s) => s,
    nomePasta: (p) => p, remotoDoPane: () => null, avisoEnvio() {},
    window: { api: { skills: async () => [], promptsLer: async () => [] }, CockpitCollaboration: { open: (Q) => eventos.push('open:' + Q.id), workflow: (Q) => eventos.push('workflow:' + Q.id) } },
  });
  vm.runInContext(['function acaoCasa(', 'function motivoSemResumir(', 'async function menuSkills('].map((a) => pegarBloco(APP, a, a)).join('\n'), ctx);
  await ctx.menuSkills(P, filtro, false);
  const nomes = corpo.itens.filter((x) => x.nome).map((x) => x.nome);
  return { itens: corpo.itens, nomes, eventos, campo, item: (n) => corpo.itens.find((x) => x.nome === n) };
}

test('o "/" lista o Workflow dos agentes junto do Debater, na seção Painel, com os mesmos ícones da barra (leva 5i)', async () => {
  const { nomes, item } = await menuDaBarraDe('');
  const i = nomes.indexOf(DEBATER);
  assert.ok(i >= 0, 'o Debater continua no /');
  assert.equal(nomes[i + 1], WORKFLOW, 'e o Workflow vem logo depois dele');
  assert.deepEqual([item(DEBATER), item(WORKFLOW)].map((x) => [x.sec, x.ic]), [['Painel', 'scale'], ['Painel', 'users']]);
  assert.equal(nomes.filter((n) => n === WORKFLOW).length, 1, 'uma vez só');
});

test('o "/" acha o Workflow por workflow, agentes, equipe, subagentes e organograma; "debat" continua achando só o Debater (leva 5i)', async () => {
  for (const q of ['workflow', 'Workflow', 'agentes', 'equipe', 'subagentes', 'organograma']) {
    const { nomes } = await menuDaBarraDe(q);
    assert.ok(nomes.includes(WORKFLOW), 'digitar "' + q + '" no / não achou o Workflow: ' + nomes.join(' | '));
  }
  assert.deepEqual((await menuDaBarraDe('workflow')).nomes, [WORKFLOW]);
  assert.deepEqual((await menuDaBarraDe('debat')).nomes, [DEBATER], 'o Workflow não aparece nas buscas do Debater');
});

test('o item do "/" abre o workflow da conversa (o mesmo gesto do botão 👥) e tira a barra digitada do campo, como os outros itens (leva 5i)', async () => {
  const w = await menuDaBarraDe('workflow');
  w.item(WORKFLOW).f();
  assert.deepEqual(w.eventos, ['workflow:p1']);
  assert.equal(w.campo.value, '', 'o "/workflow" digitado sai do campo');
  const d = await menuDaBarraDe('debat');
  d.item(DEBATER).f();
  assert.deepEqual(d.eventos, ['open:p1']);
  // o gesto é o do botão da barra
  const barra = bancadaDosCliques();
  barra.workflow.clicar();
  assert.deepEqual(barra.eventos.filter((e) => /^workflow:/.test(e)), w.eventos);
});

/* A paleta Ctrl+K: a lista de comandos (commands(), do cockpit-ui.js) roda num vm; `focusPane` é a conversa em foco. */
function comandosDaPaleta(focusPane) {
  const eventos = [];
  const ctx = vm.createContext({ focusPane, historyLayer() {}, window: { CockpitCollaboration: { open: (Q) => eventos.push('open:' + Q.id), workflow: (Q) => eventos.push('workflow:' + Q.id) } } });
  vm.runInContext(pegarBloco(UI_SRC, 'function commands(', 'commands'), ctx);
  const comandos = ctx.commands();
  return { comandos, eventos, achar: (titulo) => comandos.find((c) => c.title === titulo) };
}

test('a paleta Ctrl+K tem "Debater com Codex e Claude" e "Workflow dos agentes", com a balança e os agentes, e eles abrem o que o botão da barra abre, na conversa em foco (leva 5i)', () => {
  const t = comandosDaPaleta({ id: 'p1' });
  const titulos = t.comandos.map((c) => c.title);
  assert.ok(titulos.includes(DEBATER) && titulos.includes(WORKFLOW), titulos.join(' | '));
  assert.equal(titulos.filter((x) => x === DEBATER || x === WORKFLOW).length, 2, 'cada um uma vez só');
  assert.deepEqual([DEBATER, WORKFLOW].map((n) => [t.achar(n).icon, t.achar(n).detail]), [['scale', 'Comando'], ['users', 'Comando']]);
  t.achar(DEBATER).run();
  t.achar(WORKFLOW).run();
  assert.deepEqual(t.eventos, ['open:p1', 'workflow:p1']);
  const barra = bancadaDosCliques();
  barra.debate.clicar();
  barra.workflow.clicar();
  assert.deepEqual(barra.eventos.filter((e) => /^(open|workflow):/.test(e)), t.eventos, 'os mesmos dois gestos');
});

test('na paleta, sem conversa em foco os dois comandos não fazem nada nem quebram; o texto digitado os acha pelo título (leva 5i)', () => {
  const t = comandosDaPaleta(undefined);
  assert.doesNotThrow(() => { t.achar(DEBATER).run(); t.achar(WORKFLOW).run(); });
  assert.deepEqual(t.eventos, []);
  // o filtro da paleta é este: searchText(título).includes(searchText(o que se digita))
  const acha = (digitado) => t.comandos.filter((c) => searchText(c.title).includes(searchText(digitado))).map((c) => c.title);
  assert.ok(acha('debat').includes(DEBATER) && !acha('debat').includes(WORKFLOW));
  assert.ok(acha('workflow').includes(WORKFLOW) && !acha('workflow').includes(DEBATER));
  assert.ok(acha('AGENTES').includes(WORKFLOW), 'sem diferença de maiúscula');
  assert.ok(acha('codex').includes(DEBATER));
});
