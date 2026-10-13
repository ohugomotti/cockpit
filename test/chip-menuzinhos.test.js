'use strict';
/* Leva 5h (seção 1 da spec, decisão do Hugo em 08/10): a camada grande "Agente" (modelo + esforço + permissões + envio + conta, no meio da tela)
   saiu de cena. O chip da caixa tem 3 botões e cada um abre o SEU menuzinho: uma janelinha pequena, colada no botão, aberta para cima, como a do +
   (leva 5d). Este arquivo prova o comportamento dos três com o DOM de mentira; o chip em si (os 3 botões, o hover, o nome acessível) é de
   test/chip-do-modelo.test.js.
   Quem abre cada um (agentLayer, que continua existindo com o mesmo nome e a mesma assinatura): 'engine' -> motor; 'mode' -> permissão;
   'model', 'effort' e sem parte -> modelo.
   O que é REAPROVEITADO da camada grande, sem duplicar: o change() com "Atualizando…" e a geração; trocarMotor, trocarModeloDoPainel, trocarEsforco,
   mudarModoDoPainel, alternarFallbackClaude; o catálogo (consulta, avisos, escopo); o remoto da VPS com os modos desligados; o bloqueio por plano
   ou pergunta pendente; o pintarMenuAcp; o accountLayer. A janelinha é a .modal-cx do próprio painel (novoMenu): só um menu aberto por vez, Esc
   fecha e devolve o foco, clique fora fecha, tudo da infraestrutura que o menu do + já usa.
   Medidas (conta, a confirmar na prévia):
   - cliques para trocar o esforço: antes 2 (chip, barrinha) com uma janela de ~560 px no meio da tela; depois 2, numa janelinha de ~250 px colada no chip;
   - texto fixo na janela do motor e da permissão: antes 5 títulos (Motor, Modelo, Esforço, Permissões, Se ele estiver trabalhando) e 9 descrições; depois 0. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');
const Modelos = require('../src/renderer/model-presentation');

const APP = lerFonte('renderer', 'app.js');
const UI = lerFonte('renderer', 'cockpit-ui.js');
const CSS_UI = lerFonte('renderer', 'cockpit-ui.css');
const CSS_MAC = lerFonte('renderer', 'visual-mac.css');

// elItem({ ic, … }, aoClicar): o corpo começa no "{" depois do ") {" (o pegarBloco pararia na desestruturação)
function corpo(nome) {
  const i = APP.indexOf('function ' + nome + '(');
  assert.ok(i >= 0, 'não achei ' + nome);
  let nivel = 0;
  for (let j = APP.indexOf(') {', i) + 2; j < APP.length; j++) { if (APP[j] === '{') nivel++; else if (APP[j] === '}' && --nivel === 0) return APP.slice(i, j + 1); }
  throw new Error('não fechei ' + nome);
}
const constDe = (assinatura, nome) => pegarBloco(APP, assinatura, nome).replace(/^const /, 'var ') + ';';

// o ICONES e o ico() de verdade (como em test/menu-mais-icones.test.js)
const MAPA = (() => {
  const ctx = vm.createContext({});
  const ini = APP.indexOf('const ICONES = '), fim = APP.indexOf('\n', APP.indexOf('const ico = (n) =>'));
  vm.runInContext(APP.slice(ini, fim).replace('const ICONES = ', 'var ICONES = ').replace('const ico = ', 'var ico = '), ctx);
  return ctx;
})();

/* O DOM de mentira. Entende ".classe", "[atributo]", "[atributo=\"v\"]", "[atributo^=\"v\"]", "tag" e listas com vírgula nos seletores; o evento
   sobe pelos pais (bolha) e para quando alguém chama stopPropagation; click() num botão desligado não faz nada, como no navegador. */
const casaUm = (e, sel) => {
  sel = sel.trim();
  let m;
  if ((m = /^\[([\w-]+)\^="([^"]*)"\]$/.exec(sel))) return String(e.getAttribute(m[1]) ?? '').startsWith(m[2]);
  if ((m = /^\[([\w-]+)="([^"]*)"\]$/.exec(sel))) return e.getAttribute(m[1]) === m[2];
  if ((m = /^\[data-([\w-]+)\]$/.exec(sel))) return e.dataset[m[1]] !== undefined;
  if ((m = /^\[([\w-]+)\]$/.exec(sel))) return e.getAttribute(m[1]) !== null;
  if (sel.startsWith('.')) return e._cls.has(sel.slice(1));
  return e.tagName === sel.toUpperCase();
};
const casa = (e, sel) => sel.split(',').some((s) => casaUm(e, s));
const ZERO = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };

function bancada({ engine = 'claude', modelo = 'claude-sonnet-5-5', esforco = 'medium', modo = 'manual', remoto = null, modelos, disponiveis, pintarAcp } = {}) {
  const eventos = [], tarefas = [];
  const doc = { activeElement: null, listeners: {} };
  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase(); this.filhos = []; this.pai = null; this._cls = new Set(); this.attrs = {}; this.ouvintes = {};
      this.dataset = {}; this.tabIndex = -1; this._html = ''; this._texto = ''; this.title = ''; this.type = ''; this.disabled = false; this.hidden = false;
      this.vars = {}; this.caixa = null; this.clientLeft = 0; this.onkeydown = null; this.onclick = null;
      const este = this;
      this.style = { setProperty(k, v) { este.vars[k] = String(v); }, getPropertyValue(k) { return este.vars[k] || ''; }, height: '' };
    }
    get className() { return [...this._cls].join(' '); }
    set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get classList() {
      const s = this._cls;
      return { add: (...c) => c.forEach((x) => s.add(x)), remove: (...c) => c.forEach((x) => s.delete(x)), contains: (c) => s.has(c),
        toggle: (c, on) => { const liga = on === undefined ? !s.has(c) : !!on; if (liga) s.add(c); else s.delete(c); return liga; } };
    }
    get innerHTML() { return this._html; }
    set innerHTML(h) { this._html = String(h); for (const f of this.filhos) f.pai = null; this.filhos = []; this._texto = ''; }
    get textContent() { return this._texto + this.filhos.map((f) => f.textContent).join(''); }
    set textContent(v) { for (const f of this.filhos) f.pai = null; this.filhos = []; this._html = ''; this._texto = String(v); }
    get parentNode() { return this.pai; }
    get isConnected() { let x = this; while (x.pai) x = x.pai; return x === doc.body; }
    append(...ns) { for (const n of ns) this.appendChild(typeof n === 'string' ? Object.assign(new El('#texto'), { _texto: n }) : n); }
    appendChild(c) { if (c.pai) c.pai.filhos = c.pai.filhos.filter((x) => x !== c); c.pai = this; this.filhos.push(c); return c; }
    replaceChildren(...ns) { for (const f of this.filhos) f.pai = null; this.filhos = []; this._html = ''; this._texto = ''; this.append(...ns); }
    remove() { if (this.pai) { this.pai.filhos = this.pai.filhos.filter((x) => x !== this); this.pai = null; } }
    contains(n) { for (let x = n; x; x = x.pai) if (x === this) return true; return false; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; }
    matches(s) { return casa(this, s); }
    querySelectorAll(sel) { const r = []; const andar = (x) => { for (const f of x.filhos) { if (casa(f, sel)) r.push(f); andar(f); } }; andar(this); return r; }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    addEventListener(t, f) { (this.ouvintes[t] = this.ouvintes[t] || []).push(f); }
    // o evento sobe pelos pais até o body; cada um roda os ouvintes do tipo e a propriedade on<tipo>
    disparar(t, extra) {
      const e = { type: t, target: this, defaultPrevented: false, parou: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.parou = true; },
        ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...(extra || {}) };
      for (let x = this; x && !e.parou; x = x.pai) {
        for (const f of x.ouvintes[t] || []) f(e);
        if (typeof x['on' + t] === 'function' && !e.parou) x['on' + t](e);
      }
      return e;
    }
    click() { if (this.disabled) return; this.disparar('click'); }
    focus() { if (this.disabled) return; doc.activeElement = this; }
    scrollIntoView() {}
    getBoundingClientRect() { return this.caixa ? this.caixa() : ZERO; }
  }
  doc.body = new El('body'); doc.createElement = (t) => new El(t);
  const pane = new El('section'), modal = new El('div'), cx = new El('div');
  const pm = (cls) => { const b = new El('button'); b.className = 'pm-btn ' + cls; return b; };
  const motorPeca = pm('pm-motor'), modeloPeca = pm('pm-modelo'), permPeca = pm('pm-perm');
  pane.className = 'pane'; modal.className = 'modal p-modal hidden'; cx.className = 'modal-cx';
  modal.appendChild(cx); pane.appendChild(modal);
  for (const b of [motorPeca, modeloPeca, permPeca]) pane.appendChild(b);
  const pop = new El('div'), global = new El('div');
  pop.className = 'hidden'; global.className = 'hidden';
  doc.body.appendChild(pane); doc.body.appendChild(pop); doc.body.appendChild(global);
  const P = { id: 'p1', el: pane, engine, model: modelo, effort: esforco, mode: modo, envio: 'fila', cwd: 'C:\\proj', abaId: 'aba1', uiContaGeracao: 0,
    pintarEnvio: () => eventos.push('pintarEnvio'), remotoFalso: remoto };
  const cfg = { fallbackClaude: false, envioPadrao: 'fila' };
  const lista = modelos || {
    claude: [
      { id: 'claude-opus-5-5', nome: 'Opus 5.5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], padraoEffort: 'medium' },
      { id: 'claude-sonnet-5-5', nome: 'Sonnet 5.5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], padraoEffort: 'medium', padrao: true },
      { id: 'claude-haiku-4-5-20251001', nome: 'Haiku 4.5', efforts: [] },
    ],
    codex: [{ id: 'gpt-6-astra', nome: 'GPT-6-Astra', efforts: ['low', 'medium', 'high', 'xhigh'] }, { id: 'gpt-6-luna', nome: 'GPT-6-Luna', efforts: ['low', 'medium'] }],
    gemini: [{ id: '', nome: 'padrão do Gemini', efforts: [], padrao: true }, { id: 'gemini-3.1-pro', nome: 'Gemini 3.1 Pro', efforts: [] }],
    grok: [{ id: '', nome: 'padrão do Grok', efforts: [], padrao: true }],
    acp: [{ id: 'gemini --acp', nome: 'Gemini (ACP)', efforts: [] }],
  };
  const api = {
    motoresDisponiveis: async (lugar) => { eventos.push('disponiveis:' + (lugar ? 'vps' : 'pc')); return disponiveis || { claude: { disponivel: true }, codex: { disponivel: true }, gemini: { disponivel: true }, grok: { disponivel: false, detalhe: 'sem login' }, acp: { disponivel: true } }; },
    claudeModels: async () => { eventos.push('consulta:claude'); return api.respostaClaude ? api.respostaClaude() : { models: lista.claude }; },
    codexModels: async () => { eventos.push('consulta:codex'); return { models: lista.codex }; },
    modelBenchmarks: async (refresh) => { eventos.push('benchmarks:' + !!refresh); return api.respostaBenchmarks || null; },
    abrirLink: (url) => eventos.push('link:' + url),
    setConfig: (c) => eventos.push('setConfig:' + c.envioPadrao),
  };
  // trocas de mentira: gravam o pedido e (a menos que o teste mande recusar) aplicam no painel, como as de verdade
  const sistema = { recusa: false, demora: null };
  const aplicar = async (nome, f) => { eventos.push(nome); if (sistema.demora) await sistema.demora; if (!sistema.recusa) f(); };
  const ctx = vm.createContext({
    document: doc, d: doc, panes: new Map([[P.id, P]]), focusPane: P, ICONES: MAPA.ICONES, ico: MAPA.ico, marcaDoMotor: () => '', cfg, Date, JSON, Promise, Number, String, Math, Array, Object, Set,
    MOTORES: ['claude', 'codex', 'gemini', 'grok', 'acp'], nomeDoMotor: (e) => ({ claude: 'Claude', codex: 'Codex', gemini: 'Gemini', grok: 'Grok', acp: 'ACP' }[e]),
    svgMotor: (e) => '<svg data-motor="' + e + '"></svg>', window: { api, CockpitModels: Modelos },
    $: (sel, raiz) => (sel === '#popGrupo' ? pop : sel === '#modalGrupo' ? global : raiz ? raiz.querySelector(sel) : null),
    q: (sel, raiz) => (raiz || doc.body).querySelector(sel),
    cancelarSaidaDoModal() {}, soltarNavArquivos() {}, pararBuscaEmVoo() {}, queueMicrotask: (f) => tarefas.push(f),
    fecharModalGlobal() {}, fecharVisor() {}, fecharTerminalDoPainel() {}, fecharModal() {}, interromperPainel: () => eventos.push('parou'),
    remotoDoPane: () => P.remotoFalso, abaPorId: (id) => ({ id }), refresh: () => eventos.push('refresh'),
    accountLayer: (eng) => eventos.push('conta:' + eng),
    // como o app.js: o catálogo consultado (P.uiClaudeModels / P.uiCodexModels) manda, e o de reserva vale enquanto não houver consulta
    modelosDe: (p) => (p.engine === 'claude' && p.uiClaudeModels?.length ? p.uiClaudeModels : p.engine === 'codex' && p.uiCodexModels?.length ? p.uiCodexModels : lista[p.engine]) || [],
    modeloAtual: (p) => (lista[p.engine] || []).find((m) => m.id === p.model) || (lista[p.engine] || [])[0],
    trocarMotor: (p, eng) => aplicar('trocarMotor:' + eng, () => { p.engine = eng; p.model = (lista[eng] && lista[eng][0] && lista[eng][0].id) || ''; }),
    trocarModeloDoPainel: (p, mo) => aplicar('trocarModelo:' + mo.id, () => { p.model = mo.id; }),
    trocarEsforco: (p, id) => aplicar('trocarEsforco:' + id, () => { p.effort = id; }),
    mudarModoDoPainel: (p, mo) => aplicar('mudarModo:' + mo.id, () => { p.mode = mo.id; }),
    alternarFallbackClaude: (p) => aplicar('fallback', () => { cfg.fallbackClaude = !cfg.fallbackClaude; }),
    pintarMenuAcp: pintarAcp || ((p, m) => { eventos.push('pintarMenuAcp'); const x = new El('div'); x.className = 'menu-acp-de-mentira'; m.appendChild(x); const it = new El('div'); it.setAttribute('role', 'menuitem'); it.tabIndex = 0; x.appendChild(it); }),
  });
  vm.runInContext([constDe('const MODOS = {', 'MODOS'), constDe('const EF_PT = {', 'EF_PT'), constDe('const EF_DESC_PT = {', 'EF_DESC_PT')].join('\n'), ctx);
  vm.runInContext(['fecharPopGlobal', 'fecharMenus', 'novoMenu', 'elItem', 'elLinha', 'tituloPopup', 'subPopup', 'tratarEsc'].map(corpo).join('\n'), ctx);
  vm.runInContext(['function node(', 'function chipAncorar(', 'function chipControle(', 'function chipTeclado(', 'function chipController(', 'async function chipPintarMotor(',
    'async function chipPintarModelo(', 'function chipPintarPerm(', 'async function chipMenu(', 'async function agentLayer(']
    .map((a) => pegarBloco(UI, a, a)).join('\n'), ctx);
  const rodar = () => { while (tarefas.length) tarefas.shift()(); };
  const tique = () => new Promise((ok) => setImmediate(ok));
  const sleep = async (n = 6) => { for (let i = 0; i < n; i++) { rodar(); await tique(); } };
  // origem (rodada 2, item 7): o botao que abriu a janelinha quando NAO e' o chip (o logo do motor do cabecalho do painel)
  const abrir = async (parte, foco, origem) => { if (foco) foco.focus(); const m = await ctx.agentLayer(P, parte, origem); rodar(); return m; };
  const todos = () => cx.querySelectorAll('[data-chave]');
  const por = (chave) => cx.querySelectorAll('[data-chave]').find((b) => b.dataset.chave === chave) || null;
  const esc = () => ctx.tratarEsc(P);
  return { ctx, doc, El, P, pane, modal, cx, motorPeca, modeloPeca, permPeca, eventos, api, cfg, lista, sistema, rodar, tique, sleep, abrir, todos, por, esc, pop };
}
const tecla = (alvo, key, extra) => alvo.disparar('keydown', { key, ...(extra || {}) });
const aberto = (t) => t.modal._cls.has('como-menu') && !t.modal._cls.has('hidden');
const rotulos = (t) => t.todos().map((b) => b.getAttribute('aria-label'));
// o texto que aparece na tela (o svg não tem texto): nada, nas janelinhas só de ícones
const visivel = (e) => (e._texto || '') + String(e._html).replace(/<[^>]*>/g, '') + e.filhos.map(visivel).join('');

/* ---------------------------------------------------------------------------------------------------------------------
   Quem chama o agentLayer abre o menuzinho certo
   --------------------------------------------------------------------------------------------------------------------- */
test('agentLayer: "engine" abre o menuzinho do motor, "mode" o da permissão, e "model", "effort" e sem parte o do modelo (leva 5h)', async () => {
  const casos = [['engine', 'mz-motor'], ['mode', 'mz-perm'], ['model', 'mz-modelo'], ['effort', 'mz-modelo'], [undefined, 'mz-modelo']];
  for (const [parte, classe] of casos) {
    const t = bancada();
    const m = await t.abrir(parte);
    await t.sleep();
    assert.ok(aberto(t), String(parte) + ': a janelinha abriu como menu');
    assert.ok(t.cx._cls.has('menu-chip') && t.cx._cls.has(classe), String(parte) + ': ' + [...t.cx._cls]);
    assert.equal(m.cx, t.cx, 'é a mesma .modal-cx do painel (a do menu do +)');
    assert.equal(t.cx.getAttribute('role'), 'menu', 'continua sendo o role="menu" do novoMenu');
    assert.equal(t.cx._cls.has('menu-icones'), false, 'não é a grade de 6 colunas do +: o CSS é outro');
  }
});

test('só um menuzinho aberto por vez: abrir outro fecha o anterior e o anterior para de repintar; o + e os demais menus também o fecham (leva 5h)', async () => {
  const t = bancada();
  const a = await t.abrir('model');
  await t.sleep();
  assert.equal(a.fechado, false);
  const b = await t.abrir('mode');
  await t.sleep();
  assert.equal(a.fechado, true, 'o do modelo foi substituído');
  assert.equal(b.fechado, false);
  assert.ok(t.cx._cls.has('mz-perm') && !t.cx._cls.has('mz-modelo'), 'a mesma caixa, agora com a classe da permissão: ' + [...t.cx._cls]);
  assert.equal(t.todos().filter((x) => x.dataset.chave.startsWith('modelo:')).length, 0, 'nada do modelo ficou na janelinha');
  t.ctx.novoMenu(t.P);   // outro menu qualquer (o +, os comandos…) toma a caixa
  assert.equal(b.fechado, true);
  // a pintura atrasada de um menu que já não é o da tela não escreve nada nem quebra
  await assert.doesNotReject(() => b.repintar());
  assert.equal(t.todos().length, 0);
});

/* ---------------------------------------------------------------------------------------------------------------------
   Posição: colada no botão do chip, abrindo para cima
   --------------------------------------------------------------------------------------------------------------------- */
test('a janelinha mede o botão clicado e grava onde ele está: --mi-dir (do lado direito do painel até o dele) e --mi-base (do pé do painel até o topo dele) (leva 5h)', async () => {
  const t = bancada();
  t.pane.clientLeft = 1;
  t.pane.caixa = () => ({ left: 200, top: 0, right: 700, bottom: 800, width: 500, height: 800 });
  t.modeloPeca.caixa = () => ({ left: 530, top: 757, right: 575, bottom: 785, width: 45, height: 28 });
  t.permPeca.caixa = () => ({ left: 586, top: 757, right: 626, bottom: 785, width: 40, height: 28 });
  await t.abrir('model');
  assert.equal(t.cx.style.getPropertyValue('--mi-dir'), '124px', '700 - 575 - 1: a janelinha alinha o canto direito dela com o do botão do meio');
  assert.equal(t.cx.style.getPropertyValue('--mi-base'), '43px', '800 - 757: sobe dali');
  await t.abrir('mode');
  assert.equal(t.cx.style.getPropertyValue('--mi-dir'), '73px', 'a permissão: 700 - 626 - 1');
});

test('sem medida (o botão ou o painel fora da tela) nada é gravado e nada quebra: o CSS tem os valores de reserva (leva 5h)', async () => {
  const t = bancada();
  await t.abrir('mode');
  assert.equal(t.cx.style.getPropertyValue('--mi-dir'), '');
  assert.equal(t.cx.style.getPropertyValue('--mi-base'), '');
  t.pane.filhos = t.pane.filhos.filter((f) => f !== t.permPeca);   // painel sem o botão
  await assert.doesNotReject(() => t.abrir('mode'));
});

/* Rodada 2 da leva 5h, item 7: o logo do motor no CABEÇALHO do painel (.p-motor, que continua na tela) abria o menuzinho do motor ancorado no chip
   da caixa, lá embaixo (a ~772 px do clique, na prévia). Agora a janelinha ancora em QUEM ABRIU: aberta do cabeçalho, cola no logo e DESCE (o
   espaço em cima do botão é menor que o de baixo), alinhada pela esquerda se o botão está na metade esquerda do painel. Aberta pelo chip, pelo
   ⌘⇧M ou pela paleta (sem origem), nada muda. Nenhum nó do DOM de mentira entra como actual/expected num assert (a mensagem de erro não pode
   expandir a árvore do DOM). */
function comCabecalho(t) {
  t.pane.clientLeft = 1;
  t.pane.caixa = () => ({ left: 200, top: 0, right: 700, bottom: 800, width: 500, height: 800 });
  t.modeloPeca.caixa = () => ({ left: 530, top: 757, right: 575, bottom: 785, width: 45, height: 28 });
  const logo = new t.El('button');
  logo.className = 'cb p-motor';
  logo.caixa = () => ({ left: 212, top: 8, right: 240, bottom: 36, width: 28, height: 28 });
  t.pane.appendChild(logo);
  return logo;
}

test('aberta pelo logo do motor do cabeçalho, a janelinha cola no logo e desce: --mi-topo e --mi-esq, classes mz-desce e mz-esq (rodada 2, item 7)', async () => {
  const t = bancada();
  const logo = comCabecalho(t);
  const m = await t.abrir('engine', logo, logo);
  await t.sleep();
  assert.ok(m.origem === logo, 'o controlador guarda quem abriu');
  assert.equal(t.cx.style.getPropertyValue('--mi-topo'), '36px', 'do topo do painel (0) até o pé do logo (36)');
  assert.equal(t.cx.style.getPropertyValue('--mi-esq'), '11px', '212 - 200 - 1 da borda: o canto esquerdo da janelinha no do logo');
  assert.ok(t.cx._cls.has('mz-desce'), 'desce a partir do logo');
  assert.ok(t.cx._cls.has('mz-esq'), 'alinhada pela esquerda: o logo está na metade esquerda do painel');
  assert.ok(t.cx._cls.has('menu-chip') && t.cx._cls.has('mz-motor'), 'segue sendo o menuzinho do motor');
  assert.equal(t.cx.style.getPropertyValue('--mi-base'), '', 'nada da ancoragem de baixo');
  assert.equal(t.cx.style.getPropertyValue('--mi-dir'), '', 'nem a da direita');
  assert.ok(aberto(t));
  assert.equal(t.todos().length, 5, 'os 5 logos do motor');
});

test('sem origem, ou com o próprio pedaço do chip como origem, nada muda: sobe, alinhada pela direita, sem as classes novas (rodada 2, item 7)', async () => {
  for (const origem of [undefined, 'pedaco']) {
    const t = bancada();
    comCabecalho(t);
    await t.abrir('model', null, origem === 'pedaco' ? t.modeloPeca : undefined);
    assert.equal(t.cx.style.getPropertyValue('--mi-dir'), '124px', 'o canto direito no do botão do meio');
    assert.equal(t.cx.style.getPropertyValue('--mi-base'), '43px');
    assert.equal(t.cx.style.getPropertyValue('--mi-topo'), '');
    assert.equal(t.cx.style.getPropertyValue('--mi-esq'), '');
    assert.ok(!t.cx._cls.has('mz-desce') && !t.cx._cls.has('mz-esq'), [...t.cx._cls].join(' '));
  }
});

test('a origem manda no lado e na direção: botão embaixo na metade esquerda sobe alinhado pela esquerda; botão no alto à direita desce alinhado pela direita (rodada 2, item 7)', async () => {
  const t = bancada();
  const logo = comCabecalho(t);
  logo.caixa = () => ({ left: 212, top: 740, right: 240, bottom: 768, width: 28, height: 28 });   // embaixo, à esquerda
  await t.abrir('engine', null, logo);
  assert.ok(!t.cx._cls.has('mz-desce'), 'embaixo: sobe');
  assert.ok(t.cx._cls.has('mz-esq'), 'à esquerda: alinhada pela esquerda');
  assert.equal(t.cx.style.getPropertyValue('--mi-base'), '60px', '800 - 740: sobe do topo do botão');
  assert.equal(t.cx.style.getPropertyValue('--mi-esq'), '11px');
  logo.caixa = () => ({ left: 640, top: 8, right: 668, bottom: 36, width: 28, height: 28 });   // no alto, à direita
  await t.abrir('engine', null, logo);
  assert.ok(t.cx._cls.has('mz-desce'), 'no alto: desce');
  assert.ok(!t.cx._cls.has('mz-esq'), 'à direita: alinhada pela direita');
  assert.equal(t.cx.style.getPropertyValue('--mi-topo'), '36px');
  assert.equal(t.cx.style.getPropertyValue('--mi-dir'), '31px', '700 - 668 - 1');
});

test('origem que saiu da tela (desconectada) ou sem medida: cai no pedaço do chip, como sempre; e reabrir pelo chip tira as classes da origem (rodada 2, item 7)', async () => {
  const t = bancada();
  const logo = comCabecalho(t);
  logo.remove();
  await t.abrir('model', null, logo);
  assert.equal(t.cx.style.getPropertyValue('--mi-dir'), '124px', 'desconectada: usa o botão do chip');
  assert.ok(!t.cx._cls.has('mz-desce') && !t.cx._cls.has('mz-esq'));
  const u = bancada();
  const logo2 = comCabecalho(u);
  logo2.caixa = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });   // sem medida
  await u.abrir('model', null, logo2);
  assert.equal(u.cx.style.getPropertyValue('--mi-dir'), '124px', 'sem medida da origem: usa o botão do chip');
  // aberta pelo logo e depois pelo chip, na mesma caixa: as classes da origem não ficam coladas
  const v = bancada();
  const logo3 = comCabecalho(v);
  await v.abrir('engine', null, logo3);
  assert.ok(v.cx._cls.has('mz-desce') && v.cx._cls.has('mz-esq'));
  await v.abrir('model');
  assert.ok(!v.cx._cls.has('mz-desce') && !v.cx._cls.has('mz-esq'), [...v.cx._cls].join(' '));
  assert.equal(v.cx.style.getPropertyValue('--mi-dir'), '124px');
});

test('o botão do motor do cabeçalho passa a si mesmo ao agentLayer; as outras entradas (chip, paleta, ⌘⇧M) seguem sem origem (rodada 2, item 7)', () => {
  assert.match(UI, /agentLayer\(p, "engine", logoDoMotor\)/, 'o clique no logo do cabeçalho manda a origem');
  assert.match(UI, /async function agentLayer\(p, section, origem\)/);
  assert.match(UI, /return chipMenu\(p, section === "mode" \? "perm" : section === "engine" \? "motor" : "modelo", origem\)/);
  assert.match(UI, /agentLayer\(p, qual === "perm" \? "mode" : qual === "motor" \? "engine" : "model"\)/, 'o clique no chip não leva origem: o pedaço dele já é o botão');
});

test('CSS: mz-desce desce a partir do pé do botão e mz-esq alinha pela esquerda, cada um com a sua reserva e o seu teto (rodada 2, item 7)', () => {
  const regra = (sel) => { const i = CSS_UI.indexOf(sel + ' {'); assert.ok(i >= 0, 'falta ' + sel); return CSS_UI.slice(i, CSS_UI.indexOf('}', i)); };
  const desce = regra('.ck-app .p-modal.como-menu > .modal-cx.menu-chip.mz-desce');
  assert.match(desce, /--mi-topo:\s*44px/, 'reserva');
  assert.match(desce, /top:\s*calc\(var\(--mi-topo\) \+ 4px\)/);
  assert.match(desce, /bottom:\s*auto/);
  assert.match(desce, /align-self:\s*start/, 'sem isso a grade do .modal empurra a caixa para baixo');
  assert.match(desce, /max-height:\s*calc\(100% - var\(--mi-topo\) - 16px\)/, 'não passa do pé do painel');
  const esq = regra('.ck-app .p-modal.como-menu > .modal-cx.menu-chip.mz-esq');
  assert.match(esq, /--mi-esq:\s*8px/);
  assert.match(esq, /left:\s*var\(--mi-esq\)/);
  assert.match(esq, /right:\s*auto/);
  assert.match(esq, /justify-self:\s*start/);
  assert.match(esq, /max-width:\s*calc\(100% - var\(--mi-esq\) - 8px\)/, 'não passa da borda direita do painel');
});

/* ---------------------------------------------------------------------------------------------------------------------
   Menuzinho do MOTOR: os 5 logos, só ícone
   --------------------------------------------------------------------------------------------------------------------- */
test('motor: 5 botões só com o logo (svgMotor), na ordem dos motores, sem texto na tela; o atual marcado; o nome no aria-label e no hover (leva 5h)', async () => {
  const t = bancada({ engine: 'codex', modelo: 'gpt-6-astra' });
  await t.abrir('engine');
  await t.sleep();
  const bs = t.todos();
  assert.equal(bs.length, 5);
  assert.deepEqual(bs.map((b) => b.dataset.motor), ['claude', 'codex', 'gemini', 'grok', 'acp']);
  assert.deepEqual(bs.map((b) => b._html), ['claude', 'codex', 'gemini', 'grok', 'acp'].map((e) => '<svg data-motor="' + e + '"></svg>'), 'o logo é o do svgMotor');
  assert.equal(visivel(t.cx).trim(), '', 'a janelinha não escreve nada: só logos');
  for (const b of bs) {
    assert.equal(b.tagName, 'BUTTON');
    assert.equal(b.type, 'button');
    assert.equal(b.getAttribute('role'), 'menuitemradio');
    assert.ok(b.title.startsWith(b.getAttribute('aria-label').replace(' · indisponível', '')), b.title);
  }
  assert.deepEqual(bs.map((b) => b.getAttribute('aria-checked')), ['false', 'true', 'false', 'false', 'false'], 'o Codex é o motor deste painel');
  assert.equal(bs[1]._cls.has('mz-sel'), true);
  assert.equal(t.doc.activeElement, bs[1], 'o foco abre no motor atual');
});

test('motor: o indisponível fica apagado (desligado), com o motivo no hover; o que o main não explica ganha o motivo de sempre (leva 5h)', async () => {
  const t = bancada({ disponiveis: { claude: { disponivel: true }, codex: { disponivel: true }, gemini: { disponivel: false, detalhe: 'sem login' }, grok: { disponivel: false }, acp: { disponivel: true } } });
  await t.abrir('engine');
  await t.sleep();
  const gemini = t.por('motor:gemini'), grok = t.por('motor:grok');
  assert.equal(gemini.disabled, true);
  assert.equal(gemini.getAttribute('aria-label'), 'Gemini · indisponível');
  assert.equal(gemini.title, 'Gemini · indisponível · sem login', 'o motivo que veio do main');
  assert.equal(grok.disabled, true);
  assert.equal(grok.title, 'Grok · indisponível · não instalado nesta máquina', 'sem motivo vindo do main: o de sempre');
  assert.equal(t.por('motor:claude').disabled, false);
  await t.abrir('engine');
  const r = bancada({ remoto: { host: 'h', usuario: 'u' }, disponiveis: { claude: { disponivel: true }, codex: { disponivel: false }, gemini: { disponivel: false }, grok: { disponivel: false }, acp: { disponivel: false } } });
  await r.abrir('engine');
  await r.sleep();
  assert.ok(r.eventos.includes('disponiveis:vps'), 'no servidor a consulta é do servidor (motoresDisponiveis(lugar))');
  assert.equal(r.por('motor:codex').title, 'Codex · indisponível · não roda neste servidor');
  assert.equal(r.por('motor:claude').disabled, false);
  // a consulta que falha deixa tudo desligado (como a camada grande) e não quebra
  const f = bancada();
  f.api.motoresDisponiveis = async () => { throw new Error('ipc caiu'); };
  await f.abrir('engine');
  await f.sleep();
  assert.equal(f.todos().length, 5);
  assert.ok(f.todos().every((b) => b.disabled), 'sem resposta, nenhum motor é oferecido');
});

test('motor: clicar num motor chama o trocarMotor de sempre, mostra "Atualizando…" enquanto troca, e repinta com o novo marcado e o foco nele (leva 5h)', async () => {
  const t = bancada();
  let solta; t.sistema.demora = new Promise((ok) => { solta = ok; });
  await t.abrir('engine');
  await t.sleep();
  t.por('motor:codex').click();
  await t.sleep();
  assert.deepEqual(t.eventos.filter((e) => e.startsWith('trocarMotor')), ['trocarMotor:codex']);
  const aviso = t.cx.querySelector('.mz-aviso');
  assert.equal(aviso.textContent, 'Atualizando…');
  assert.equal(aviso.hidden, false);
  assert.equal(t.cx.getAttribute('aria-busy'), 'true');
  assert.ok(t.todos().every((b) => b.disabled), 'tudo desligado enquanto troca: nenhum clique a mais');
  t.por('motor:gemini').click();   // clique a mais no meio da troca: ignorado
  solta(); t.sistema.demora = null;
  await t.sleep(10);
  assert.deepEqual(t.eventos.filter((e) => e.startsWith('trocarMotor')), ['trocarMotor:codex'], 'o segundo clique não trocou nada');
  assert.equal(t.cx.getAttribute('aria-busy'), null);
  assert.equal(t.cx.querySelector('.mz-aviso').hidden, true, 'o aviso some quando deu certo');
  assert.equal(t.por('motor:codex').getAttribute('aria-checked'), 'true');
  assert.equal(t.por('motor:claude').getAttribute('aria-checked'), 'false');
  assert.equal(t.doc.activeElement, t.por('motor:codex'), 'o foco volta para o botão que você usou');
  assert.ok(t.eventos.includes('refresh'), 'a Torre e a lateral são atualizadas (o refresh da camada grande)');
});

test('motor: se a troca não pegou, a janelinha diz que o motor anterior foi mantido e o escolhido anterior segue marcado (leva 5h)', async () => {
  const t = bancada();
  t.sistema.recusa = true;
  await t.abrir('engine');
  await t.sleep();
  t.por('motor:codex').click();
  await t.sleep(10);
  assert.equal(t.cx.querySelector('.mz-aviso').textContent, 'Este motor não pôde ser ativado neste destino. O motor anterior foi mantido.');
  assert.equal(t.por('motor:claude').getAttribute('aria-checked'), 'true');
  // erro lançado pela troca: a mensagem da camada grande
  const e = bancada();
  e.ctx.trocarMotor = async () => { throw new Error('o paneStop caiu'); };
  await e.abrir('engine');
  await e.sleep();
  e.por('motor:codex').click();
  await e.sleep(10);
  assert.equal(e.cx.querySelector('.mz-aviso').textContent, 'Não consegui concluir a mudança. o paneStop caiu');
});

/* ---------------------------------------------------------------------------------------------------------------------
   Menuzinho do MODELO: lista, esforço, rodapé de ícones
   --------------------------------------------------------------------------------------------------------------------- */
test('modelo: a lista tem o ícone da família, o nome e o anel de cada um; o atual destacado e marcado; descrição, nota AA e cota só no hover (leva 5h)', async () => {
  const t = bancada();
  t.api.respostaBenchmarks = { checkedAt: '2026-10-08T12:00:00Z', models: [{ id: 'claude-opus-5-5', engine: 'claude', score: 62, variant: 'high' }] };
  await t.abrir('model');
  await t.sleep();
  const linhas = t.todos().filter((b) => b.dataset.chave.startsWith('modelo:'));
  assert.deepEqual(linhas.map((b) => b.getAttribute('aria-label')), ['Opus 5.5', 'Sonnet 5.5', 'Haiku 4.5'], 'ordenada por poder (a nota AA); sem nota, a ordem do catálogo');
  const opus = t.por('modelo:claude-opus-5-5');
  assert.equal(opus.getAttribute('role'), 'menuitemradio');
  assert.deepEqual(opus.filhos.map((f) => f._cls.has('mz-fam') ? 'fam' : f._cls.has('mz-nome') ? 'nome' : f._cls.has('mz-anel') ? 'anel' : '?'), ['fam', 'nome', 'anel']);
  assert.equal(opus.filhos[0]._html, MAPA.ico('music'), 'o ícone de traço da família (a tabela da leva 5f)');
  assert.equal(opus.filhos[1].textContent, 'Opus 5.5');
  assert.equal(opus.filhos[2]._html, MAPA.ico('peso-3'), 'e o anel de peso');
  assert.match(opus.title, /^Opus 5\.5 · Para programação e trabalhos complexos\./, 'a descrição vai no hover');
  assert.match(opus.title, /AA 62/, 'a nota AA, também');
  assert.match(opus.title, /Cota maior/, 'e a cota');
  assert.equal(t.por('modelo:claude-sonnet-5-5').getAttribute('aria-checked'), 'true');
  assert.ok(t.por('modelo:claude-sonnet-5-5')._cls.has('mz-sel'), 'o atual fica destacado');
  assert.equal(t.por('modelo:claude-opus-5-5')._cls.has('mz-sel'), false);
  // o texto que aparece na tela é só o nome dos modelos: sem descrição, nota nem cota
  const naTela = linhas.map(visivel).join('|');
  assert.equal(naTela, 'Opus 5.5|Sonnet 5.5|Haiku 4.5');
  assert.equal(t.doc.activeElement, t.por('modelo:claude-sonnet-5-5'), 'o foco abre no modelo atual');
});

test('modelo: nome de modelo vindo de fora entra como texto, nunca como marcação (R1-09) (leva 5h)', async () => {
  const hostil = '<img src=x onerror="x()">';
  const t = bancada({ modelo: 'm-hostil', modelos: { claude: [{ id: 'm-hostil', nome: hostil, efforts: [] }] } });
  await t.abrir('model');
  await t.sleep();
  const linha = t.por('modelo:m-hostil');
  assert.equal(linha.filhos.find((f) => f._cls.has('mz-nome')).textContent, hostil, 'o nome vai por textContent');
  assert.doesNotMatch(linha._html, /<img|onerror/);
  assert.ok(linha.filhos.every((f) => !/<img/.test(f._html)));
});

test('modelo: clicar num modelo chama o trocarModeloDoPainel de sempre; o atual não faz nada; a lista se repinta com o novo marcado e o foco nele (leva 5h)', async () => {
  const t = bancada();
  await t.abrir('model');
  await t.sleep();
  t.por('modelo:claude-sonnet-5-5').click();
  await t.sleep();
  assert.deepEqual(t.eventos.filter((e) => e.startsWith('trocarModelo')), [], 'o modelo atual não reinicia nada');
  t.por('modelo:claude-opus-5-5').click();
  await t.sleep(10);
  assert.deepEqual(t.eventos.filter((e) => e.startsWith('trocarModelo')), ['trocarModelo:claude-opus-5-5']);
  assert.equal(t.por('modelo:claude-opus-5-5').getAttribute('aria-checked'), 'true');
  assert.equal(t.por('modelo:claude-sonnet-5-5').getAttribute('aria-checked'), 'false');
  assert.equal(t.doc.activeElement, t.por('modelo:claude-opus-5-5'));
});

test('modelo: o esforço são barrinhas (uma por nível) com o ícone brain na linha; o nível no hover; o escolhido marcado e as de baixo acesas (leva 5h)', async () => {
  const t = bancada({ esforco: 'high' });
  await t.abrir('model');
  await t.sleep();
  const linha = t.cx.querySelector('.mz-esforco');
  assert.ok(linha, 'a linha do esforço');
  assert.equal(linha.filhos[0]._html, MAPA.ico('brain'), 'o ícone da linha é o brain');
  const barras = t.todos().filter((b) => b.dataset.chave.startsWith('esforco:'));
  assert.deepEqual(barras.map((b) => b.dataset.chave), ['esforco:low', 'esforco:medium', 'esforco:high', 'esforco:xhigh', 'esforco:max'], '5 barrinhas, uma por nível');
  assert.deepEqual(barras.map((b) => b.getAttribute('aria-label')), ['Esforço: Leve', 'Esforço: Médio', 'Esforço: Alto', 'Esforço: Extra alto', 'Esforço: Máximo']);
  assert.match(barras[2].title, /^Alto — Pensa mais fundo em problemas difíceis/, 'o nível e o que ele faz, no hover');
  assert.deepEqual(barras.map((b) => b.getAttribute('aria-checked')), ['false', 'false', 'true', 'false', 'false']);
  assert.deepEqual(barras.map((b) => b._cls.has('mz-acesa')), [true, true, true, false, false], 'as barrinhas até o nível escolhido ficam acesas');
  assert.deepEqual(barras.map((b) => b.filhos[0].style.height), ['7px', '10px', '13px', '16px', '19px'], 'cada barrinha é mais alta que a anterior (7 + 3 por nível)');
  assert.equal(visivel(linha).trim(), '', 'nenhuma palavra na tela');
  barras[4].click();
  await t.sleep(10);
  assert.deepEqual(t.eventos.filter((e) => e.startsWith('trocarEsforco')), ['trocarEsforco:max']);
  assert.equal(t.por('esforco:max').getAttribute('aria-checked'), 'true');
  assert.equal(t.doc.activeElement, t.por('esforco:max'));
  barras[2].click();   // o nível que já era o do painel antes… agora o atual é o max: este troca
  t.por('esforco:max').click();   // o atual não faz nada
  await t.sleep(10);
  assert.equal(t.eventos.filter((e) => e.startsWith('trocarEsforco')).length, 2, 'clicar no nível atual não troca');
});

test('modelo sem níveis de esforço (Haiku, Gemini…) não desenha a linha do esforço (leva 5h)', async () => {
  const t = bancada({ modelo: 'claude-haiku-4-5-20251001' });
  await t.abrir('model');
  await t.sleep();
  assert.equal(t.cx.querySelector('.mz-esforco'), null);
  assert.equal(t.todos().filter((b) => b.dataset.chave.startsWith('esforco:')).length, 0);
});

test('modelo: o rodapé de ícones no Claude tem ordenar por poder e por cota, o Artificial Analysis, atualizar, o escudo do Sonnet e conta e consumo (leva 5h)', async () => {
  const t = bancada();
  await t.abrir('model');
  await t.sleep();
  const rodape = t.cx.querySelector('.mz-rodape');
  const bs = rodape.querySelectorAll('[data-chave]');
  assert.deepEqual(bs.map((b) => b.dataset.chave), ['ordem:power', 'ordem:quota', 'aa', 'atualizar', 'fallback', 'conta']);
  assert.deepEqual(bs.map((b) => b.getAttribute('aria-label')), ['Ordenar por poder', 'Ordenar pela cota', 'Ver benchmarks no Artificial Analysis',
    'Atualizar modelos disponíveis', 'Se o modelo cair, usar o Sonnet', 'Conta e consumo']);
  assert.deepEqual(bs.map((b) => b._html), ['chart-no-axes-column-increasing', 'battery', 'external-link', 'refresh-cw', 'shield-check', 'user'].map((n) => MAPA.ico(n)), 'só ícones');
  assert.equal(visivel(rodape).trim(), '');
  assert.match(bs[0].title, /maior nota medida/);
  assert.match(bs[1].title, /menor gasto primeiro/);
  assert.match(bs[3].title, /Catálogo do Claude · Este PC/, 'o escopo do catálogo vai no hover do atualizar (antes: uma linha de texto na janela)');
  assert.deepEqual(bs.map((b) => b.getAttribute('role')), ['menuitemradio', 'menuitemradio', 'menuitem', 'menuitem', 'menuitemcheckbox', 'menuitem']);
});

test('modelo: no Codex o rodapé não tem o escudo do Sonnet; no Gemini e no Grok só a conta; a lista de ordenar vem só com catálogo (leva 5h)', async () => {
  const codex = bancada({ engine: 'codex', modelo: 'gpt-6-astra' });
  await codex.abrir('model');
  await codex.sleep();
  assert.deepEqual(codex.cx.querySelector('.mz-rodape').querySelectorAll('[data-chave]').map((b) => b.dataset.chave), ['ordem:power', 'ordem:quota', 'aa', 'atualizar', 'conta']);
  assert.match(codex.por('atualizar').title, /Catálogo do Codex · Este PC/);
  for (const engine of ['gemini', 'grok']) {
    const t = bancada({ engine, modelo: '' });
    await t.abrir('model');
    await t.sleep();
    assert.deepEqual(t.cx.querySelector('.mz-rodape').querySelectorAll('[data-chave]').map((b) => b.dataset.chave), ['conta'], engine);
    assert.equal(t.eventos.some((e) => e.startsWith('consulta:')), false, engine + ': sem catálogo para consultar');
  }
});

test('modelo: ordenar por cota põe a cota menor primeiro; por poder volta; o botão marcado é o da ordem atual e nada mais se repinta (leva 5h)', async () => {
  const t = bancada();
  t.api.respostaBenchmarks = { checkedAt: '2026-10-08T12:00:00Z', models: [
    { id: 'claude-opus-5-5', engine: 'claude', score: 62, variant: 'high' }, { id: 'claude-sonnet-5-5', engine: 'claude', score: 55 }, { id: 'claude-haiku-4-5', engine: 'claude', score: 40 }] };
  await t.abrir('model');
  await t.sleep();
  const ordem = () => t.todos().filter((b) => b.dataset.chave.startsWith('modelo:')).map((b) => b.getAttribute('aria-label'));
  assert.deepEqual(ordem(), ['Opus 5.5', 'Sonnet 5.5', 'Haiku 4.5']);
  assert.equal(t.por('ordem:power').getAttribute('aria-checked'), 'true');
  t.por('ordem:quota').click();
  assert.deepEqual(ordem(), ['Haiku 4.5', 'Sonnet 5.5', 'Opus 5.5'], 'cota menor primeiro');
  assert.equal(t.por('ordem:quota').getAttribute('aria-checked'), 'true');
  assert.equal(t.por('ordem:power').getAttribute('aria-checked'), 'false');
  t.por('ordem:power').click();
  assert.deepEqual(ordem(), ['Opus 5.5', 'Sonnet 5.5', 'Haiku 4.5']);
  assert.deepEqual(t.eventos.filter((e) => e.startsWith('trocar')), [], 'ordenar não troca nada');
});

test('modelo: o Artificial Analysis abre o link; o atualizar zera a idade do catálogo, pede o benchmark de novo e consulta; o escudo liga e desliga o Sonnet reserva (leva 5h)', async () => {
  const t = bancada();
  await t.abrir('model');
  await t.sleep();
  assert.deepEqual(t.eventos.filter((e) => e.startsWith('consulta:')), ['consulta:claude'], 'catálogo velho (nunca consultado): consulta ao abrir');
  t.por('aa').click();
  assert.ok(t.eventos.includes('link:https://artificialanalysis.ai/leaderboards/models'));
  const antes = t.eventos.filter((e) => e.startsWith('consulta:')).length;
  t.por('atualizar').click();
  await t.sleep(10);
  assert.ok(t.eventos.includes('benchmarks:true'), 'pediu o benchmark de novo, com refresh');
  assert.equal(t.eventos.filter((e) => e.startsWith('consulta:')).length, antes + 1, 'e consultou o catálogo de novo');
  assert.equal(t.por('fallback').getAttribute('aria-checked'), 'false');
  t.por('fallback').click();
  await t.sleep(10);
  assert.deepEqual(t.eventos.filter((e) => e === 'fallback'), ['fallback']);
  assert.equal(t.por('fallback').getAttribute('aria-checked'), 'true', 'o escudo agora está ligado');
  assert.equal(t.por('fallback')._cls.has('mz-sel'), true);
  assert.match(t.por('fallback').title, /Sonnet assume o turno/);
  t.por('fallback').click();
  await t.sleep(10);
  assert.equal(t.por('fallback').getAttribute('aria-checked'), 'false', 'e desliga');
});

test('modelo: "Conta e consumo" fecha a janelinha e abre a conta do motor (leva 5h)', async () => {
  const t = bancada({ engine: 'codex', modelo: 'gpt-6-astra' });
  await t.abrir('model');
  await t.sleep();
  t.por('conta').click();
  assert.ok(t.eventos.includes('conta:codex'));
  assert.equal(aberto(t), false, 'a janelinha fechou antes de abrir a camada da conta');
});

/* o catálogo: consulta, avisos e escopo (o que a camada grande fazia antes de pintar a lista) */
test('catálogo: a lista aparece JÁ com o que se conhece e a consulta chega depois, com o aviso "Consultando modelos…"; chegou, a lista se refaz e o aviso some (leva 5h)', async () => {
  const t = bancada();
  let solta; const resposta = new Promise((ok) => { solta = ok; });
  t.api.respostaClaude = () => resposta;
  await t.abrir('model');
  await t.sleep(3);
  assert.equal(t.cx.querySelector('.mz-aviso').textContent, 'Consultando modelos…');
  assert.equal(t.cx.querySelector('.mz-aviso').hidden, false);
  assert.equal(t.todos().filter((b) => b.dataset.chave.startsWith('modelo:')).length, 3, 'a lista não esperou a consulta');
  solta({ models: [...t.lista.claude, { id: 'claude-fable-5-1', nome: 'Fable 5.1', efforts: ['low', 'medium'] }] });
  await t.sleep(10);
  assert.equal(t.cx.querySelector('.mz-aviso').hidden, true);
  assert.ok(t.por('modelo:claude-fable-5-1'), 'o modelo novo do catálogo consultado entrou na lista');
  assert.equal(t.P.uiClaudeModelsScope, 'pc', 'o escopo da consulta fica guardado (PC)');
  assert.equal(t.P.uiClaudeModels.length, 4);
  assert.ok(t.P.uiClaudeModelsAt > 0);
});

test('catálogo: consultado há menos de 1 minuto, no mesmo escopo, não consulta de novo; mudou o escopo (outra VPS) ou passou 1 minuto, consulta (leva 5h)', async () => {
  const t = bancada();
  t.P.uiClaudeModels = t.lista.claude; t.P.uiClaudeModelsScope = 'pc'; t.P.uiClaudeModelsAt = Date.now() - 5000;
  await t.abrir('model');
  await t.sleep();
  assert.equal(t.eventos.some((e) => e.startsWith('consulta:')), false, 'catálogo fresco: nenhuma consulta');
  assert.equal(t.cx.querySelector('.mz-aviso').hidden, true);
  const velho = bancada();
  velho.P.uiClaudeModels = velho.lista.claude; velho.P.uiClaudeModelsScope = 'pc'; velho.P.uiClaudeModelsAt = Date.now() - 61000;
  await velho.abrir('model');
  await velho.sleep();
  assert.ok(velho.eventos.includes('consulta:claude'), 'passou de 1 minuto');
  const vps = bancada({ remoto: { usuario: 'u', host: 'h', porta: 22, chave: 'k' } });
  vps.P.uiClaudeModels = vps.lista.claude; vps.P.uiClaudeModelsScope = 'pc'; vps.P.uiClaudeModelsAt = Date.now();
  await vps.abrir('model');
  await vps.sleep();
  assert.ok(vps.eventos.includes('consulta:claude'), 'o catálogo guardado era do PC; a aba é de servidor');
  assert.equal(vps.P.uiClaudeModelsScope, JSON.stringify(['u', 'h', 22, 'k']), 'o escopo da VPS: usuário, host, porta e chave');
  assert.match(vps.por('atualizar').title, /Catálogo do Claude · VPS/, 'e o hover diz de onde veio a lista');
});

test('catálogo: consulta que volta vazia ou falha deixa a escolha como está e avisa; o aviso não some no repaint de um clique (leva 5h)', async () => {
  const vazio = bancada();
  vazio.api.respostaClaude = async () => ({ models: [] });
  await vazio.abrir('model');
  await vazio.sleep(10);
  assert.equal(vazio.cx.querySelector('.mz-aviso').textContent, 'Não foi possível confirmar a lista agora. Sua escolha foi mantida.');
  assert.equal(vazio.P.model, 'claude-sonnet-5-5', 'a escolha do painel não mudou');
  assert.equal(vazio.todos().filter((b) => b.dataset.chave.startsWith('modelo:')).length, 3, 'a lista de antes segue na tela');
  const falha = bancada();
  falha.api.respostaClaude = async () => { throw new Error('rede'); };
  await falha.abrir('model');
  await falha.sleep(10);
  assert.equal(falha.cx.querySelector('.mz-aviso').textContent, 'Lista não confirmada. Tente atualizar novamente.');
  assert.equal(falha.P.uiClaudeModels, undefined, 'e nada foi guardado');
});

test('catálogo: se o painel mudou de lugar ou de motor durante a consulta, a resposta atrasada é descartada (a mesma geração) (leva 5h)', async () => {
  const t = bancada();
  let solta; const resposta = new Promise((ok) => { solta = ok; });
  t.api.respostaClaude = () => resposta;
  await t.abrir('model');
  await t.sleep(3);
  t.P.engine = 'codex';   // o painel trocou de motor por outro caminho
  solta({ models: [{ id: 'claude-x', nome: 'X', efforts: [] }] });
  await t.sleep(10);
  assert.equal(t.P.uiClaudeModels, undefined, 'a resposta de um painel que já não é Claude não é guardada');
  const fechou = bancada();
  let solta2; const resposta2 = new Promise((ok) => { solta2 = ok; });
  fechou.api.respostaClaude = () => resposta2;
  await fechou.abrir('model');
  await fechou.sleep(3);
  fechou.ctx.fecharMenus();   // clicou fora
  solta2({ models: fechou.lista.claude });
  await fechou.sleep(10);
  assert.equal(fechou.P.uiClaudeModels, undefined, 'janelinha fechada: a resposta atrasada não escreve nada');
  assert.equal(fechou.todos().length, 0);
});

/* Corrida: a consulta ao catálogo chega NO MEIO de uma troca de modelo. Se ela repintasse, a geração mudaria sob o m.change(), que então
   desistiria de repintar e deixaria a janelinha com o modelo de antes marcado. Medida: modelo marcado depois das duas coisas terminarem, nesta
   ordem de chegada (antes da correção: o de antes; depois: o escolhido). */
test('a consulta do catálogo que chega no meio de uma troca de modelo não repinta por cima dela: a troca repinta no fim, com o modelo novo marcado (leva 5h)', async () => {
  const t = bancada();
  let soltaConsulta; const consulta = new Promise((ok) => { soltaConsulta = ok; });
  let soltaTroca; t.sistema.demora = new Promise((ok) => { soltaTroca = ok; });
  t.api.respostaClaude = () => consulta;
  await t.abrir('model');
  await t.sleep(3);
  t.por('modelo:claude-opus-5-5').click();   // a troca começa e fica esperando
  await t.sleep(3);
  assert.equal(t.cx.getAttribute('aria-busy'), 'true');
  soltaConsulta({ models: t.lista.claude });   // a consulta termina com a troca ainda em andamento
  await t.sleep(5);
  assert.equal(t.cx.getAttribute('aria-busy'), 'true', 'a consulta não repintou nem derrubou o estado de "trocando"');
  assert.equal(t.cx.querySelector('.mz-aviso').textContent, 'Atualizando…');
  soltaTroca(); t.sistema.demora = null;
  await t.sleep(10);
  assert.equal(t.cx.getAttribute('aria-busy'), null);
  assert.equal(t.P.model, 'claude-opus-5-5');
  assert.equal(t.por('modelo:claude-opus-5-5').getAttribute('aria-checked'), 'true', 'o fim da troca repintou com o modelo novo');
  assert.equal(t.por('modelo:claude-sonnet-5-5').getAttribute('aria-checked'), 'false');
  assert.equal(t.cx.querySelector('.mz-aviso').hidden, true);
  assert.equal(t.P.uiClaudeModels.length, 3, 'e o catálogo consultado ficou guardado');
});

test('o benchmark que chega depois repinta só os rótulos da lista (a nota AA no hover), sem mexer no resto (leva 5h)', async () => {
  const t = bancada();
  let solta; const bench = new Promise((ok) => { solta = ok; });
  t.api.modelBenchmarks = async () => bench;
  await t.abrir('model');
  await t.sleep(3);
  assert.doesNotMatch(t.por('modelo:claude-opus-5-5').title, /AA 62/);
  assert.equal(t.por('aa').title, 'Ver benchmarks no Artificial Analysis', 'sem leitura ainda: só o nome');
  solta({ checkedAt: '2026-10-08T12:00:00Z', status: 'snapshot', models: [{ id: 'claude-opus-5-5', engine: 'claude', score: 62, variant: 'high' }] });
  await t.sleep(10);
  assert.match(t.por('modelo:claude-opus-5-5').title, /AA 62/);
  assert.match(t.por('aa').title, /^Ver benchmarks no Artificial Analysis · lido em \d{2}\/\d{2}.*· cópia de referência$/, 'e o hover do AA ganha a data da leitura quando ela chega');
  assert.equal(t.cx.querySelectorAll('.mz-rodape').length, 1, 'o rodapé não foi duplicado');
});

test('ACP: o pintarMenuAcp de sempre é pintado DENTRO do menuzinho do modelo, e o rodapé só tem a conta (leva 5h)', async () => {
  const chamadas = [];
  const t = bancada({ engine: 'acp', modelo: 'gemini --acp', pintarAcp: (p, m) => { chamadas.push([p.engine, m.tagName]); m.appendChild(Object.assign(new t.El('div'), { className: 'marca-acp' })); } });
  await t.abrir('model');
  await t.sleep();
  assert.deepEqual(chamadas, [['acp', 'DIV']], 'chamado uma vez, com o painel e uma caixa dentro da janelinha');
  assert.ok(t.cx.querySelector('.marca-acp'), 'o conteúdo do ACP está na janelinha');
  assert.ok(t.cx._cls.has('mz-acp'), 'a classe que alarga a janelinha para a configuração do ACP');
  assert.equal(t.todos().filter((b) => b.dataset.chave.startsWith('modelo:')).length, 0, 'sem a lista de modelos do Claude/Codex');
  assert.equal(t.cx.querySelector('.mz-esforco'), null);
  assert.deepEqual(t.cx.querySelector('.mz-rodape').querySelectorAll('[data-chave]').map((b) => b.dataset.chave), ['conta']);
});

/* ---------------------------------------------------------------------------------------------------------------------
   Menuzinho da PERMISSÃO: os modos só com ícone, um traço, o envio
   --------------------------------------------------------------------------------------------------------------------- */
test('permissão: os modos do motor só com ícone (o `ic` de MODOS), o nome e a descrição no hover; o unlock na cor de atenção; o atual marcado (leva 5h)', async () => {
  const t = bancada();
  await t.abrir('mode');
  const modos = t.todos().filter((b) => b.dataset.chave.startsWith('modo:'));
  const MODOS = [...t.ctx.MODOS.claude];   // do vm: sem o spread o deepEqual brigaria com o Array de outro "realm"
  assert.deepEqual(modos.map((b) => b.dataset.chave), MODOS.map((m) => 'modo:' + m.id));
  assert.deepEqual(modos.map((b) => b._html), MODOS.map((m) => MAPA.ico(m.ic)), 'o ícone de cada modo, o mesmo do chip');
  assert.deepEqual(modos.map((b) => b.getAttribute('aria-label')), MODOS.map((m) => m.nome));
  assert.deepEqual(modos.map((b) => b.title), MODOS.map((m) => m.nome + ' — ' + m.desc));
  assert.equal(visivel(t.cx).trim(), '', 'nenhuma palavra na tela');
  assert.deepEqual(modos.map((b) => b._cls.has('mz-perigo')), [false, false, false, false, true], 'só o "Sem pedir permissão" (unlock) na cor de atenção');
  assert.equal(modos[4]._html, MAPA.ico('unlock'));
  assert.deepEqual(modos.map((b) => b.getAttribute('aria-checked')), ['true', 'false', 'false', 'false', 'false'], 'o painel está em Manual');
  assert.equal(t.doc.activeElement, modos[0], 'o foco abre no modo atual');
  for (const b of modos) assert.equal(b.getAttribute('role'), 'menuitemradio');
});

test('permissão: um traço separa os modos do envio; o envio é ↳ Entra / ≡ Fila, só ícones, e o atual vem marcado (leva 5h)', async () => {
  const t = bancada();
  await t.abrir('mode');
  const filhos = t.cx.querySelector('.mz-conteudo').filhos.map((f) => (f._cls.has('mz-traco') ? 'traco' : f._cls.has('mz-modos') ? 'modos' : f._cls.has('mz-envio') ? 'envio' : '?'));
  assert.deepEqual(filhos, ['modos', 'traco', 'envio']);
  assert.equal(t.cx.querySelector('.mz-traco').getAttribute('role'), 'separator');
  const envio = t.todos().filter((b) => b.dataset.chave.startsWith('envio:'));
  assert.deepEqual(envio.map((b) => b.dataset.chave), ['envio:entra', 'envio:fila']);
  assert.deepEqual(envio.map((b) => b._html), [MAPA.ico('corner-down-right'), MAPA.ico('list-end')], '↳ Entra e ≡ Fila');
  assert.deepEqual(envio.map((b) => b.getAttribute('aria-label')), ['Se ele estiver trabalhando: Entra', 'Se ele estiver trabalhando: Fila']);
  assert.deepEqual(envio.map((b) => b.title), ['Entra — Sua mensagem entra no que está sendo feito agora', 'Fila — Sua mensagem espera terminar para começar']);
  assert.deepEqual(envio.map((b) => b.getAttribute('aria-checked')), ['false', 'true'], 'o painel está na Fila');
  assert.equal(visivel(t.cx).trim(), '');
});

test('permissão: escolher Entra ou Fila grava no painel e no padrão (cfg.envioPadrao), salva a config e repinta o botão de enviar; sem trocar de motor nem reiniciar (leva 5h)', async () => {
  const t = bancada();
  await t.abrir('mode');
  t.por('envio:entra').click();
  assert.equal(t.P.envio, 'entra');
  assert.equal(t.cfg.envioPadrao, 'entra');
  assert.deepEqual(t.eventos.filter((e) => e.startsWith('setConfig') || e === 'pintarEnvio'), ['setConfig:entra', 'pintarEnvio']);
  assert.equal(t.por('envio:entra').getAttribute('aria-checked'), 'true');
  assert.equal(t.por('envio:fila').getAttribute('aria-checked'), 'false');
  assert.equal(t.por('envio:entra')._cls.has('mz-sel'), true);
  assert.equal(t.eventos.some((e) => e.startsWith('trocar') || e.startsWith('mudar')), false, 'não reinicia o motor');
  t.por('envio:entra').click();   // o mesmo: nada a gravar
  assert.equal(t.eventos.filter((e) => e.startsWith('setConfig')).length, 1);
  assert.ok(aberto(t), 'a janelinha segue aberta depois de escolher o envio, como a camada grande');
});

test('permissão: clicar num modo chama o mudarModoDoPainel de sempre e repinta com o novo marcado; o atual não faz nada (leva 5h)', async () => {
  const t = bancada();
  await t.abrir('mode');
  t.por('modo:manual').click();
  await t.sleep();
  assert.deepEqual(t.eventos.filter((e) => e.startsWith('mudarModo')), []);
  t.por('modo:plan').click();
  await t.sleep(10);
  assert.deepEqual(t.eventos.filter((e) => e.startsWith('mudarModo')), ['mudarModo:plan']);
  assert.equal(t.por('modo:plan').getAttribute('aria-checked'), 'true');
  assert.equal(t.doc.activeElement, t.por('modo:plan'));
});

test('permissão: com plano ou pergunta pendente no Claude a troca não vale e a janelinha diz por quê; a confirmação é pelo modo do painel (leva 5h)', async () => {
  for (const pendencia of [{ planoPendente: { plano: 'x' } }, { perguntaAberta: { bloqueante: true } }]) {
    const t = bancada();
    Object.assign(t.P, pendencia);
    t.ctx.mudarModoDoPainel = async () => { t.eventos.push('mudarModo:recusado'); };   // o de verdade avisa e sai sem trocar
    await t.abrir('mode');
    t.por('modo:plan').click();
    await t.sleep(10);
    assert.equal(t.cx.querySelector('.mz-aviso').textContent, 'Responda o plano ou a pergunta antes de trocar as permissões.');
    assert.equal(t.por('modo:manual').getAttribute('aria-checked'), 'true', 'continua no modo de antes');
  }
  // sem pendência, mas a troca não pegou: a mensagem geral
  const t = bancada();
  t.sistema.recusa = true;
  await t.abrir('mode');
  t.por('modo:plan').click();
  await t.sleep(10);
  assert.equal(t.cx.querySelector('.mz-aviso').textContent, 'As permissões anteriores foram mantidas. Tente novamente.');
  // pergunta NÃO bloqueante não conta
  const n = bancada();
  n.P.perguntaAberta = { bloqueante: false };
  await n.abrir('mode');
  n.por('modo:plan').click();
  await n.sleep(10);
  assert.equal(n.P.mode, 'plan');
});

test('permissão: na aba de servidor o Claude só aceita "Sem pedir permissão": os outros modos ficam desligados, com o motivo no hover (leva 5h)', async () => {
  const t = bancada({ remoto: { host: 'h', usuario: 'u' } });
  await t.abrir('mode');
  const modos = t.todos().filter((b) => b.dataset.chave.startsWith('modo:'));
  assert.deepEqual(modos.map((b) => b.disabled), [true, true, true, true, false]);
  assert.equal(modos[0].title, 'O adaptador remoto deste motor não oferece este modo');
  assert.equal(modos[4].title, 'Sem pedir permissão — Faz tudo sem perguntar, inclusive o que é perigoso');
  // o Codex em servidor não tem essa trava (a trava é do transporte legado do Claude)
  const c = bancada({ engine: 'codex', modelo: 'gpt-6-astra', remoto: { host: 'h', usuario: 'u' } });
  await c.abrir('mode');
  assert.ok(c.todos().filter((b) => b.dataset.chave.startsWith('modo:')).every((b) => !b.disabled));
});

test('permissão: cada motor mostra os modos dele; o Grok, o único (sliders-horizontal, sem a cor de atenção) (leva 5h)', async () => {
  const esperado = { codex: 4, gemini: 3, acp: 4, grok: 1 };
  for (const [engine, n] of Object.entries(esperado)) {
    const t = bancada({ engine, modelo: '', modo: engine === 'grok' ? 'bypass' : undefined });
    await t.abrir('mode');
    const modos = t.todos().filter((b) => b.dataset.chave.startsWith('modo:'));
    assert.equal(modos.length, n, engine);
    assert.equal(t.todos().filter((b) => b.dataset.chave.startsWith('envio:')).length, 2, engine + ': o envio é de todo motor');
    if (engine === 'grok') {
      assert.equal(modos[0]._html, MAPA.ico('sliders-horizontal'));
      assert.equal(modos[0]._cls.has('mz-perigo'), false, 'a configuração do Grok não é "sem pedir permissão"');
    }
  }
});

/* ---------------------------------------------------------------------------------------------------------------------
   Teclado, Esc, clique fora
   --------------------------------------------------------------------------------------------------------------------- */
test('teclado: as setas andam pelos itens (direita e baixo para frente, esquerda e cima para trás), dão a volta nas pontas; Home e End vão às pontas (leva 5h)', async () => {
  const t = bancada();
  await t.abrir('mode');
  const itens = t.todos();
  assert.equal(t.doc.activeElement, itens[0]);
  const foco = () => itens.indexOf(t.doc.activeElement);
  const e = tecla(itens[0], 'ArrowRight');
  assert.equal(e.defaultPrevented, true);
  assert.equal(e.parou, true, 'a tecla tratada não vaza para o app');
  assert.equal(foco(), 1);
  tecla(t.doc.activeElement, 'ArrowDown');
  assert.equal(foco(), 2);
  tecla(t.doc.activeElement, 'ArrowLeft');
  assert.equal(foco(), 1);
  tecla(t.doc.activeElement, 'ArrowUp');
  tecla(t.doc.activeElement, 'ArrowUp');
  assert.equal(foco(), itens.length - 1, 'a seta para cima no primeiro dá a volta até o último');
  tecla(t.doc.activeElement, 'ArrowDown');
  assert.equal(foco(), 0, 'e a para baixo no último volta ao primeiro');
  tecla(t.doc.activeElement, 'End');
  assert.equal(foco(), itens.length - 1);
  tecla(t.doc.activeElement, 'Home');
  assert.equal(foco(), 0);
});

test('teclado: o Tab dá a volta dentro da janelinha (no último vai ao primeiro, Shift+Tab no primeiro vai ao último) e no meio segue o Tab normal (leva 5h)', async () => {
  const t = bancada();
  await t.abrir('mode');
  const itens = t.todos();
  const ultimo = itens[itens.length - 1];
  ultimo.focus();
  const a = tecla(ultimo, 'Tab');
  assert.equal(a.defaultPrevented, true);
  assert.equal(t.doc.activeElement, itens[0]);
  const b = tecla(itens[0], 'Tab', { shiftKey: true });
  assert.equal(b.defaultPrevented, true);
  assert.equal(t.doc.activeElement, ultimo);
  itens[1].focus();
  const c = tecla(itens[1], 'Tab');
  assert.equal(c.defaultPrevented, false, 'no meio, o Tab é o do navegador');
});

test('teclado: itens desligados são pulados; Ctrl, Alt e Cmd passam (são atalhos do app); a tecla num campo de texto (o ACP) é do campo (leva 5h)', async () => {
  // na VPS só o último modo do Claude está ligado (e o painel de verdade já está nele: o ajeitarModoRemoto força o bypass)
  const t = bancada({ remoto: { host: 'h', usuario: 'u' }, modo: 'bypass' });
  await t.abrir('mode');
  assert.equal(t.doc.activeElement, t.por('modo:bypass'), 'o foco abre no modo atual');
  tecla(t.doc.activeElement, 'ArrowLeft');
  assert.equal(t.doc.activeElement, t.por('envio:fila'), 'para trás, pula os 4 modos desligados e dá a volta até o último ligado');
  tecla(t.doc.activeElement, 'ArrowRight');
  assert.equal(t.doc.activeElement, t.por('modo:bypass'), 'e para frente volta ao único modo ligado');
  assert.ok(!t.doc.activeElement.disabled, 'o foco nunca para num desligado');
  const comCtrl = tecla(t.doc.activeElement, 'ArrowRight', { ctrlKey: true });
  assert.equal(comCtrl.defaultPrevented, false);
  const comAlt = tecla(t.doc.activeElement, 'ArrowRight', { altKey: true });
  assert.equal(comAlt.defaultPrevented, false);
  const campo = new t.El('input');
  t.cx.appendChild(campo);
  const noCampo = campo.disparar('keydown', { key: 'ArrowLeft' });
  assert.equal(noCampo.defaultPrevented, false, 'a seta no campo move o cursor, não o foco');
  assert.equal(noCampo.parou, false);
});

test('Esc fecha a janelinha e devolve o foco ao botão do chip que a abriu (leva 5h)', async () => {
  for (const [parte, peca] of [['engine', 'motorPeca'], ['model', 'modeloPeca'], ['mode', 'permPeca']]) {
    const t = bancada();
    await t.abrir(parte, t[peca]);   // o foco estava no botão do chip
    await t.sleep();
    assert.ok(aberto(t));
    assert.ok(t.cx.contains(t.doc.activeElement), 'o foco entrou na janelinha');
    t.esc();
    assert.equal(aberto(t), false, parte + ': Esc fechou');
    assert.equal(t.doc.activeElement, t[peca], parte + ': e o foco voltou ao botão ' + peca);
    assert.equal(t.cx.filhos.length, 0, 'e a caixa ficou vazia');
  }
});

test('Esc depois de trocar de modelo ainda devolve o foco ao botão do meio (que o fillModels não recria) (leva 5h)', async () => {
  const t = bancada();
  await t.abrir('model', t.modeloPeca);
  await t.sleep();
  t.por('modelo:claude-opus-5-5').click();
  await t.sleep(10);
  t.esc();
  assert.equal(t.doc.activeElement, t.modeloPeca);
});

test('clique fora fecha: no fundo transparente da .p-modal e no fechamento global do documento; clique DENTRO da janelinha não fecha (leva 5h)', async () => {
  const t = bancada();
  await t.abrir('mode');
  t.cx.onclick({ stopPropagation() {} });
  assert.equal(aberto(t), true, 'o clique dentro não fecha (o cx.onclick do novoMenu segura a bolha)');
  t.modal.onclick({ target: t.modal });
  assert.equal(aberto(t), false, 'o clique no fundo transparente que cobre o painel fecha');
  await t.abrir('model');
  await t.sleep();
  t.ctx.fecharMenus();   // o ouvinte de click do document (app.js) chama isto
  assert.equal(aberto(t), false);
});

test('clique no próprio botão do chip com a janelinha aberta fecha (cai no fundo transparente) e não reabre sozinho (leva 5h)', async () => {
  const t = bancada();
  await t.abrir('model', t.modeloPeca);
  t.modal.onclick({ target: t.modal });   // o fundo cobre o botão: o clique nele é um clique no fundo
  assert.equal(aberto(t), false);
});

/* ---------------------------------------------------------------------------------------------------------------------
   Nada da camada grande sobrou
   --------------------------------------------------------------------------------------------------------------------- */
test('a camada grande "Agente" saiu de cena: o agentLayer não abre mais camada nenhuma, só delega ao menuzinho (leva 5h)', () => {
  const corpoAgente = pegarBloco(UI, 'async function agentLayer(', 'agentLayer');
  assert.doesNotMatch(corpoAgente, /openLayer|ck-agent|paintAgent/, 'sem a camada');
  assert.match(corpoAgente, /chipMenu\(p, /);
  assert.equal(/openLayer\("Agente/.exec(UI), null, 'ninguém mais abre a camada "Agente · …"');
  assert.equal(/ck-agent-grid|ck-agent-engines|ck-agent-models|ck-agent-controls/.exec(UI), null, 'nem monta as seções dela');
  // o agentLayer segue exportado com o mesmo nome (app.js e a paleta chamam)
  assert.match(UI, /^\s+agentLayer,$/m);
});

test('o que as 3 telas faziam fica no código novo: o change() com "Atualizando…", a geração, o escopo do catálogo, o bloqueio por plano ou pergunta (leva 5h)', () => {
  const novo = ['function chipController(', 'async function chipPintarMotor(', 'async function chipPintarModelo(', 'function chipPintarPerm(']
    .map((a) => pegarBloco(UI, a, a)).join('\n');
  for (const trecho of ['Atualizando…', 'Não consegui concluir a mudança. ', 'A escolha não foi alterada. Tente novamente.',
    'Este motor não pôde ser ativado neste destino. O motor anterior foi mantido.', 'Consultando modelos…',
    'Não foi possível confirmar a lista agora. Sua escolha foi mantida.', 'Lista não confirmada. Tente atualizar novamente.',
    'Responda o plano ou a pergunta antes de trocar as permissões.', 'As permissões anteriores foram mantidas. Tente novamente.',
    'O adaptador remoto deste motor não oferece este modo', 'cfg.envioPadrao = id', 'p.pintarEnvio?.()', 'planoPendente', 'bloqueante !== false',
    'uiContaGeracao', 'pintarMenuAcp(p,', 'accountLayer(p.engine, abaPorId(p.abaId))', 'https://artificialanalysis.ai/leaderboards/models']) {
    assert.ok(novo.includes(trecho), 'falta no código novo: ' + trecho);
  }
});

/* ---------------------------------------------------------------------------------------------------------------------
   CSS
   --------------------------------------------------------------------------------------------------------------------- */
test('CSS das janelinhas: ancoradas pelo canto direito no botão, abrindo para cima, sem véu, dentro do painel, com teto de largura e altura (leva 5h)', () => {
  const bloco = (css, re, msg) => { const m = re.exec(css); assert.ok(m, msg); return m[1]; };
  const fundo = bloco(CSS_UI, /\.ck-app \.p-modal\.como-menu:has\(> \.modal-cx\.menu-chip\) \{([^}]*)\}/, 'o fundo transparente da .p-modal com a janelinha do chip');
  assert.match(fundo, /background:\s*transparent/);
  const cx = bloco(CSS_UI, /\.ck-app \.p-modal\.como-menu > \.modal-cx\.menu-chip \{([^}]*)\}/, 'a regra da janelinha');
  assert.match(cx, /--mi-dir:\s*8px/, 'reserva se não houver medida');
  assert.match(cx, /--mi-base:\s*43px/);
  assert.match(cx, /position:\s*absolute/);
  assert.match(cx, /right:\s*var\(--mi-dir\)/);
  assert.match(cx, /bottom:\s*calc\(var\(--mi-base\) \+ 4px\)/, 'abre para CIMA do botão');
  assert.match(cx, /place-self:\s*end end/, 'a .modal é uma grade com place-items: center; o alinhamento próprio é explícito');
  assert.match(cx, /max-width:\s*calc\(100% - var\(--mi-dir\) - 8px\)/, 'não passa da borda esquerda do painel');
  assert.match(cx, /max-height:\s*calc\(100% - var\(--mi-base\) - 16px\)/, 'nem do topo');
  assert.match(cx, /overflow:\s*auto/);
  assert.match(cx, /box-shadow:\s*var\(--shadow-float\)/);
  assert.match(cx, /border-radius:\s*12px/);
});

test('CSS dos itens: botões de 32 px só de ícone (motor e permissão), linhas de 30 px para os modelos, o escolhido com fundo, o desligado apagado, o perigo na cor de atenção (leva 5h)', () => {
  const regra = (sel) => { const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const m = new RegExp('(?:^|\\n)' + esc + '\\s*\\{([^}]*)\\}').exec(CSS_UI); assert.ok(m, 'falta ' + sel); return m[1]; };
  assert.match(regra('.ck-app .menu-chip .mz-icone'), /width:\s*32px[\s\S]*height:\s*32px/);
  assert.match(regra('.ck-app .menu-chip .mz-modelo-op'), /min-height:\s*30px/);
  assert.match(regra('.ck-app .menu-chip .mz-item.mz-sel'), /background:/);
  assert.match(regra('.ck-app .menu-chip .mz-item:disabled'), /opacity:\s*\.\d+/);
  assert.match(regra('.ck-app .menu-chip .mz-perigo'), /color:\s*var\(--attention\)/);
  assert.match(regra('.ck-app .menu-chip .mz-nome'), /text-overflow:\s*ellipsis/);
  assert.match(regra('.ck-app .menu-chip .mz-barra.mz-acesa > span'), /background:\s*var\(--focus\)/, 'barrinha acesa em --focus (8:1 nos 4 temas), não em --primary (3:1 no Azul)');
  assert.match(regra('.ck-app .menu-chip .mz-aviso[hidden]'), /display:\s*none/);
  assert.match(regra('.ck-app .menu-chip .mz-traco'), /height:\s*1px/);
  // o desenho do ícone herda a cor (currentColor) e tem o tamanho do menu do +
  assert.match(regra('.ck-app .menu-chip .mz-item .ic'), /width:\s*16px[\s\S]*height:\s*16px/);
});

test('visual Mac: os botões só de ícone das janelinhas do chip são redondos como os da barra e os modelos têm cantos de 10 px (leva 5h)', () => {
  assert.match(CSS_MAC, /html\.visual-mac \.ck-app \.p-modal\.como-menu > \.modal-cx\.menu-chip \.mz-icone \{[^}]*border-radius:\s*50%/);
  assert.match(CSS_MAC, /html\.visual-mac \.ck-app \.p-modal\.como-menu > \.modal-cx\.menu-chip \.mz-modelo-op \{[^}]*border-radius:\s*10px/);
});
