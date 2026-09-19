'use strict';
/* Tela do debate (collaboration.js) rodando de verdade num DOM falso pequeno:
   eventos sobem de pai em pai ate' o document (e param no stopPropagation),
   <dialog> abre/fecha, <select> tem options/value como no navegador. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FONTE = fs.readFileSync(path.join(__dirname, '../src/renderer/collaboration.js'), 'utf8');
const tick = () => new Promise(r => setImmediate(r));

class Ev {
  constructor(type, init = {}) { this.type = type; this.bubbles = init.bubbles !== false; this.key = init.key; this.parado = false; this.defaultPrevented = false; }
  stopPropagation() { this.parado = true; }
  preventDefault() { this.defaultPrevented = true; }
}
class No {
  constructor(tag, doc) { this.tagName = String(tag).toUpperCase(); this.doc = doc; this.children = []; this.parentNode = null; this.ouvintes = {}; this.attrs = {}; this.classes = new Set(); this.dataset = {}; this.hidden = false; this._txt = ''; this.disabled = false; this.checked = false; this.scrollTop = 0; this.scrollHeight = 0; this.clientHeight = 0; }
  get className() { return [...this.classes].join(' '); }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() { const c = this.classes; return { add: (...n) => n.forEach(x => c.add(x)), remove: (...n) => n.forEach(x => c.delete(x)), contains: n => c.has(n), toggle: (n, f) => { const on = f === undefined ? !c.has(n) : !!f; on ? c.add(n) : c.delete(n); return on; } }; }
  get textContent() { return this._txt + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; this._txt = String(v); this._html = undefined; }
  get innerHTML() { return this._html ?? this._txt; }
  set innerHTML(v) { this.textContent = ''; this._html = String(v); this._txt = String(v).replace(/<[^>]*>/g, ''); }
  _solta(n) { if (n.parentNode) n.parentNode.children = n.parentNode.children.filter(c => c !== n); }
  append(...ns) { for (let n of ns) { if (typeof n === 'string') n = this.doc.createTextNode(n); this._solta(n); n.parentNode = this; this.children.push(n); } }
  prepend(...ns) { for (const n of ns.reverse()) { this._solta(n); n.parentNode = this; this.children.unshift(n); } }
  before(n) { const p = this.parentNode; if (!p) return; p._solta(n); n.parentNode = p; p.children.splice(p.children.indexOf(this), 0, n); }
  after(n) { const p = this.parentNode; if (!p) return; p._solta(n); n.parentNode = p; p.children.splice(p.children.indexOf(this) + 1, 0, n); }
  remove() { if (this.parentNode) this.parentNode._solta(this); this.parentNode = null; }
  replaceChildren(...ns) { this.textContent = ''; this.append(...ns); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === this.doc.root; }
  addEventListener(t, fn) { (this.ouvintes[t] ||= []).push(fn); }
  removeEventListener(t, fn) { this.ouvintes[t] = (this.ouvintes[t] || []).filter(f => f !== fn); }
  dispatchEvent(ev) {
    ev.target = this;
    for (let n = this; n; n = ev.bubbles ? n.parentNode : null) {
      for (const fn of n.ouvintes[ev.type] || []) fn.call(n, ev);
      if (n['on' + ev.type]) n['on' + ev.type](ev);
      if (ev.parado) break;
    }
    return !ev.defaultPrevented;
  }
  click() { if (!this.disabled) this.dispatchEvent(new Ev('click')); }
  focus() { this.doc.activeElement = this; }
  todos() { return this.children.flatMap(c => [c, ...c.todos()]); }
  _casa(sel) {
    const m = /^([a-z]*)((?:\.[\w-]+)*)(\[(\w+)\])?$/i.exec(sel.trim()); if (!m) return false;
    if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
    for (const c of (m[2] || '').split('.').filter(Boolean)) if (!this.classes.has(c)) return false;
    if (m[4] && !(m[4] === 'open' ? this.open : m[4] in this.attrs)) return false;
    return true;
  }
  querySelectorAll(sel) { return this.todos().filter(n => n._casa(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  // <select>/<option>
  get options() { return this.children.filter(c => c.tagName === 'OPTION'); }
  get value() { if (this.tagName === 'SELECT') { const o = this.options; return this._v !== undefined && o.some(x => x.value === this._v) ? this._v : (o[0] ? o[0].value : ''); } if (this.tagName === 'OPTION') return this._v ?? this.textContent; return this._v ?? ''; }
  set value(v) { this._v = String(v); }
  // <dialog>
  showModal() { this.open = true; }
  close() { if (!this.open) return; this.open = false; this.dispatchEvent(new Ev('close', { bubbles: false })); }
}
function criarDocumento() {
  const doc = { activeElement: null };
  doc.createElement = t => new No(t, doc);
  doc.createTextNode = t => { const n = new No('#text', doc); n._txt = String(t); return n; };
  doc.root = new No('html', doc); doc.body = new No('body', doc); doc.root.append(doc.body);
  doc.documentElement = doc.root;
  doc.addEventListener = (t, fn) => doc.root.addEventListener(t, fn);
  doc.querySelector = s => doc.root.querySelector(s);
  doc.querySelectorAll = s => doc.root.querySelectorAll(s);
  return doc;
}

const CODEX = [
  { id: 'gpt-6-astra', nome: 'GPT-6-Astra', efforts: [{ id: 'low', desc: 'rápido' }, { id: 'medium', desc: 'x' }, { id: 'high', desc: 'fundo' }, { id: 'ultra', desc: 'y' }], padraoEffort: 'medium', padrao: true },
  { id: 'gpt-5.6-luna', nome: 'GPT-5.6-Luna', efforts: [{ id: 'low', desc: 'rápido' }, { id: 'medium', desc: 'x' }], padraoEffort: 'medium' },
];
const CLAUDE = [
  { id: 'claude-opus-5[1m]', nome: 'Opus 5 (1M)', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], padraoEffort: 'high' },
  { id: 'claude-sonnet-5', nome: 'Sonnet 5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], padraoEffort: 'medium', padrao: true },
  { id: 'claude-haiku-4-5-20251001', nome: 'Haiku 4.5', efforts: ['low', 'medium', 'high'], padraoEffort: 'medium' },
];

function montar({ api = {}, remoto = null, codex = CODEX, painel = {} } = {}) {
  const document = criarDocumento();
  const chamadas = { start: [], review: [], models: 0 };
  let ouvinteDebate = null;
  const apiBase = {
    debateList: async () => [], debateGet: async () => ({ error: 'não achei' }),
    debateStart: async i => { chamadas.start.push(i); return { id: 'd1', paneId: i.paneId, status: 'running', rounds: i.rounds, topic: i.topic, leitura: !i.remoto, cwd: i.cwd, messages: [] }; },
    debateReview: async i => { chamadas.review.push(i); return { hash: 'h'.repeat(64), note: '' }; },
    debateStop: async () => ({}), debateContinue: async () => ({}),
    codexModels: async () => { chamadas.models++; return CODEX; },
    onDebateEvent: fn => { ouvinteDebate = fn; },
    ...api,
  };
  const P = { id: 'p1', engine: 'codex', cwd: 'C:\\Projetos\\prev-ia', abaId: 'a', hist: [{ quem: 'Você', texto: 'oi' }, { quem: 'Codex', texto: 'olá' }], el: new No('section', document), ...painel };
  const inp = new No('textarea', document); inp.className = 'p-input'; inp.value = '';
  const fechar = new No('button', document); fechar.className = 'p-close';
  P.el.append(inp, fechar); document.body.append(P.el);
  const panes = new Map([[P.id, P]]);
  const EF_PT = { minimal: 'Mínimo', low: 'Leve', medium: 'Médio', high: 'Alto', xhigh: 'Extra alto', max: 'Máximo', ultra: 'Ultra' };
  const ctx = { document, window: { api: apiBase }, panes, panesFundo: new Map(), MODELOS_CODEX: codex, MODELOS_CLAUDE: CLAUDE,
    catalogoClaude: () => CLAUDE, EF_PT, EF_DESC_PT: {}, remotoDoPane: () => remoto, cwdGitDoPainel: p => p.cwd,
    mdSeguro: t => String(t), savePanes: () => {}, acharPainel: id => panes.get(id), note: () => {},
    nomeDoMotor: e => ({ codex: 'Codex', claude: 'Claude' })[e] || 'Claude', marcaDoMotor: e => '<span class="marca-motor" data-motor="' + e + '"></span>',
    ico: n => '<svg class="ic" data-ic="' + n + '"></svg>', Event: Ev, setInterval: () => 0, clearInterval: () => {}, URL, Date, Math, JSON };
  vm.createContext(ctx);
  vm.runInContext(FONTE, ctx);
  return { ctx, P, document, chamadas, api: apiBase, evento: s => ouvinteDebate(s), CC: ctx.window.CockpitCollaboration };
}
const dialogo = h => h.document.querySelector('dialog[open]');
const botao = (h, texto) => dialogo(h).querySelectorAll('button').find(b => b.textContent.trim() === texto || b.textContent.includes(texto));
const selects = h => dialogo(h).querySelectorAll('select');

test('esforço do Codex vem da lista {id, desc}: rótulos em pt, nada desligado, padrão do debate Alto', async () => {
  const h = montar(); await h.CC.open(h.P);
  const [modeloCodex, esforcoCodex] = selects(h);
  assert.equal(modeloCodex.value, 'gpt-6-astra');
  assert.deepEqual(esforcoCodex.options.map(o => o.value), ['low', 'medium', 'high', 'ultra']);
  assert.deepEqual(esforcoCodex.options.map(o => o.textContent), ['Leve', 'Médio', 'Alto', 'Ultra']);
  assert.ok(esforcoCodex.options.every(o => !o.disabled));
  assert.equal(esforcoCodex.value, 'high');
  // modelo sem "high": cai no padrao dele
  modeloCodex.value = 'gpt-5.6-luna'; modeloCodex.dispatchEvent(new Ev('change'));
  assert.deepEqual(esforcoCodex.options.map(o => o.value), ['low', 'medium']);
  assert.equal(esforcoCodex.value, 'medium');
  const t = h.CC._t;
  assert.deepEqual(t.esforcosDoModelo({ efforts: [{ id: 'low', desc: '…' }, { id: 'high', desc: '…' }], padraoEffort: 'high' }), ['low', 'high']);
  assert.equal(t.esforcoEscolhido(['low', 'medium'], '', { padraoEffort: 'medium' }), 'medium');
});

test('lista do Codex ainda não chegou: pede ao abrir e mostra "carregando modelos…"', async () => {
  let libera; const h = montar({ codex: null, api: { codexModels: () => new Promise(r => { libera = r; }) } });
  await h.CC.open(h.P);
  const [modeloCodex] = selects(h);
  assert.equal(modeloCodex.options[0].textContent, 'carregando modelos…');
  assert.equal(modeloCodex.disabled, true);
  libera(CODEX); await tick(); await tick();
  assert.equal(modeloCodex.disabled, false);
  assert.equal(modeloCodex.value, 'gpt-6-astra');
  assert.equal(h.ctx.MODELOS_CODEX, CODEX);
});

test('tecla dentro do diálogo não chega ao document (Esc não para a IA de outro painel)', async () => {
  const h = montar(); await h.CC.open(h.P);
  const recebidas = []; h.document.addEventListener('keydown', e => recebidas.push(e.key));
  const campo = dialogo(h).querySelector('textarea');
  campo.dispatchEvent(new Ev('keydown', { key: 'Escape' }));
  campo.dispatchEvent(new Ev('keydown', { key: 'w' }));
  assert.deepEqual(recebidas, []);
  // fora do dialogo continua chegando
  h.P.el.dispatchEvent(new Ev('keydown', { key: 'Escape' }));
  assert.deepEqual(recebidas, ['Escape']);
});

test('cartões na ordem da fala com logo e selo; Inverter troca quem começa e vai no start', async () => {
  const h = montar(); await h.CC.open(h.P);
  const grade = dialogo(h).querySelector('.co-model-grid');
  const cartoes = () => grade.children.filter(c => c.classes.has('co-participant'));
  assert.deepEqual(cartoes().map(c => [...c.classes][1]), ['codex', 'claude']);
  assert.equal(cartoes()[0].querySelector('.co-selo').textContent, 'Começa');
  assert.equal(cartoes()[1].querySelector('.co-selo').textContent, 'Responde');
  assert.match(cartoes()[0].querySelector('.co-logo').innerHTML, /data-motor="codex"/);
  assert.equal(grade.children[1].classes.has('co-inverter'), true);        // o botao fica entre os dois
  botao(h, 'Inverter').click();
  assert.deepEqual(cartoes().map(c => [...c.classes][1]), ['claude', 'codex']);
  assert.equal(cartoes()[0].querySelector('.co-selo').textContent, 'Começa');
  dialogo(h).querySelector('textarea').value = 'Como melhorar o cadastro?';
  await botao(h, 'Iniciar debate').onclick();
  const pedido = JSON.parse(JSON.stringify(h.chamadas.start[0]));   // objeto de outro "realm" (vm)
  assert.equal(pedido.first, 'claude');
  assert.equal(pedido.rounds, 2);
  assert.equal(pedido.cwd, 'C:\\Projetos\\prev-ia');
  assert.equal(pedido.remoto, false);
  assert.deepEqual(pedido.models.codex, { model: 'gpt-6-astra', effort: 'high' });
  assert.deepEqual(pedido.models.claude, { model: 'claude-sonnet-5', effort: 'high' });
  // "Compartilhar texto" continua marcado (decisao do Hugo, 14/09) e "Você" vira "Usuário"
  assert.equal(pedido.context, '### Usuário\noi\n\n### Codex\nolá');
});

test('rodadas 1 · 2 · 3 lado a lado; o tamanho do contexto aparece ao lado da opção', async () => {
  const h = montar(); await h.CC.open(h.P);
  const r = dialogo(h).querySelector('.co-rodadas');
  assert.equal(r.getAttribute('role'), 'radiogroup');
  const bs = r.querySelectorAll('button');
  assert.deepEqual(bs.map(b => b.textContent), ['1', '2', '3']);
  assert.equal(bs[1].getAttribute('aria-checked'), 'true');
  bs[2].click(); assert.equal(bs[2].getAttribute('aria-checked'), 'true'); assert.equal(bs[1].getAttribute('aria-checked'), 'false');
  assert.match(dialogo(h).querySelector('.co-tam').textContent, /~\d+ caracteres/);
  assert.equal(h.CC._t.tamanhoTexto(0), 'a conversa ainda está vazia');
  assert.equal(h.CC._t.tamanhoTexto(12400), '~12 mil caracteres');
  dialogo(h).querySelector('textarea').value = 'x';
  await botao(h, 'Iniciar debate').onclick();
  assert.equal(h.chamadas.start[0].rounds, 3);
});

test('painel remoto: aviso claro, revisão de código desmarcada e escondida, start vai como remoto', async () => {
  const h = montar({ remoto: { host: 'vps' } }); await h.CC.open(h.P, { review: true });
  const d = dialogo(h);
  assert.match(d.querySelector('.co-aviso').textContent, /servidor \(VPS\).*não lê os arquivos/);
  const rev = d.querySelectorAll('input').find(i => i.parentNode.textContent.includes('Git'));
  assert.equal(rev.checked, false);
  assert.equal(rev.parentNode.hidden, true);
  assert.match(d.querySelector('.co-error').textContent, /só funciona em painel de pasta local/);
  await botao(h, 'Iniciar debate').onclick();
  assert.equal(h.chamadas.review.length, 0);
  assert.equal(h.chamadas.start[0].remoto, true);
});

test('rodando: status "Rodada 1 de 2 · Codex respondendo", só Interromper; conclusão só depois', async () => {
  const h = montar(); await h.CC.open(h.P);
  dialogo(h).querySelector('textarea').value = 'Tema';
  await botao(h, 'Iniciar debate').onclick();
  const base = { id: 'd1', paneId: 'p1', rounds: 2, topic: 'Tema', leitura: true, cwd: 'C:\\Projetos\\prev-ia' };
  h.evento({ ...base, status: 'running', progress: { fala: 1, total: 4 }, messages: [
    { id: 'm1', speaker: 'codex', model: 'gpt-6-astra', effort: 'high', status: 'running', at: new Date().toISOString(), text: '', activity: { kind: 'lendo', alvo: 'src/app.js' }, reads: ['src/app.js'] }] });
  const d = dialogo(h);
  assert.match(d.querySelector('.co-status').textContent, /^Rodada 1 de 2 · Codex respondendo · Os dois leem os arquivos de prev-ia/);
  assert.match(d.querySelector('.co-message-state').textContent, /^Codex lendo src\/app\.js · 0:0\d$/);
  assert.equal(d.querySelector('.co-leu').textContent, 'Leu: src/app.js');
  const visiveis = () => d.querySelector('.co-actions').querySelectorAll('button').filter(b => !b.hidden).map(b => b.textContent);
  assert.deepEqual(visiveis(), ['Interromper']);
  assert.equal(d.querySelector('.co-salvos').hidden, true);
  h.evento({ ...base, status: 'completed', messages: [
    { id: 'm1', speaker: 'codex', model: 'gpt-6-astra', effort: 'high', status: 'completed', at: new Date().toISOString(), text: 'Proposta', durationMs: 72000, usage: { total: 12300 } }] });
  assert.match(d.querySelector('.co-message-state').textContent, /levou 1:12 · 12,3 mil tokens/);
  assert.ok(visiveis().includes('Levar conclusão para o campo'));
  assert.ok(visiveis().includes('Novo debate'));
  assert.equal(visiveis().includes('Interromper'), false);
});

test('botão do painel: ícone + rótulo; rodando = classe ativo sem trocar o texto', async () => {
  const h = montar();
  const b = h.P.el.querySelector('.p-debate');
  assert.match(b.innerHTML, /data-ic="messages-square"/);
  assert.match(b.innerHTML, /<span class="pd-rot">Debater<\/span>/);
  const antes = b.innerHTML;
  h.evento({ id: 'd9', paneId: 'p1', status: 'running', messages: [] });
  assert.equal(b.classes.has('ativo'), true);
  assert.equal(b.innerHTML, antes);
  h.evento({ id: 'd9', paneId: 'p1', status: 'completed', messages: [] });
  assert.equal(b.classes.has('ativo'), false);
});

test('debate de OUTRO painel aberto pelo seletor não troca o debate deste painel', async () => {
  const outro = { id: 'x1', paneId: 'p2', status: 'completed', rounds: 1, topic: 'Outro', messages: [] };
  const h = montar({ api: { debateList: async () => [{ id: 'x1', topic: 'Outro', status: 'completed' }], debateGet: async () => outro } });
  h.P.debateId = 'meu'; await h.CC.open(h.P);
  const seletor = dialogo(h).querySelector('.co-salvos');
  seletor.value = 'x1'; await seletor.onchange();
  assert.equal(h.P.debateId, 'meu');
});

test('o debate recém-iniciado entra no seletor sem reabrir o diálogo', async () => {
  const h = montar(); await h.CC.open(h.P);
  dialogo(h).querySelector('textarea').value = 'Tema novo';
  await botao(h, 'Iniciar debate').onclick();
  const opcoes = dialogo(h).querySelector('.co-salvos').options.map(o => o.value);
  assert.deepEqual(opcoes, ['', 'd1']);
});

test('apagar uma aba para o debate de cada painel dela', async () => {
  const { pegarBloco } = require('../testes/raiz');
  const app = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
  const parados = [], parouPainel = [];
  const fundo = new Map([['p1', { id: 'p1', abaId: 'velha', debateId: 'deb-1', engine: 'codex' }], ['p2', { id: 'p2', abaId: 'outra', debateId: 'deb-2', engine: 'claude' }]]);
  const abas = [{ id: 'velha', nome: 'Velha' }, { id: 'outra', nome: 'Outra' }];
  const ctx = { cfg: { abaAtiva: 'outra', abas }, panesFundo: fundo, confirm: () => true, abasLocais: () => ctx.cfg.abas,
    trocarAbaLocal: async () => {}, matarTerminaisDoPainel: () => {}, pintarAbasLocal: () => {}, clearInterval: () => {},
    window: { api: { debateStop: async id => parados.push(id), paneStop: async p => parouPainel.push(p.paneId), setConfig: () => {} } } };
  vm.createContext(ctx);
  vm.runInContext(pegarBloco(app, 'async function apagarAbaLocal(', 'apagarAbaLocal'), ctx);
  await ctx.apagarAbaLocal(abas[0]);
  assert.deepEqual(parados, ['deb-1']);
  assert.deepEqual(parouPainel, ['p1']);
});

test('botão só com ícone em painel estreito (@container no fim do style.css, com .pane-hd)', () => {
  const css = fs.readFileSync(path.join(__dirname, '../src/renderer/style.css'), 'utf8');
  const colab = fs.readFileSync(path.join(__dirname, '../src/renderer/collaboration.css'), 'utf8');
  const i = css.lastIndexOf('@container (max-width: 420px)');
  assert.ok(i > 0 && i > css.lastIndexOf('@container (max-width: 340px)'), 'a regra do botao tem que ser a ultima @container');
  assert.match(css.slice(i), /\.pane-hd \.p-debate \.pd-rot\{display:none\}/);
  assert.doesNotMatch(colab, /@media[^{]*\{[^}]*\.p-debate\{/, 'botao do painel nao pode depender da largura da JANELA');
  // acao principal com cor neutra do tema, nao o azul do Codex
  assert.match(colab, /\.co-actions \.co-primary\{background:var\(--co-acao-fundo\)/);
  assert.doesNotMatch(colab, /\.co-primary\{background:var\(--accent\)/);
});

test('sem ternário de dois motores e sem a linha "Motti.IA · Cockpit" no topo', () => {
  assert.doesNotMatch(FONTE, /=== 'codex' \? 'Codex' : 'Claude'|=== 'claude' \? 'claude' : 'codex'/);
  assert.doesNotMatch(FONTE, /Motti\.IA · Cockpit/);
});
