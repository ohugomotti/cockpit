'use strict';
/* Leva 3, Tarefa 3 (R3-02 + R3-03): varredura do histórico e renomear na lista "Conversas do <motor>". Medidas:
   - fichas preparadas (HistoricoLista.preparar) numa varredura de 2000 em 8 lotes (antes ~11 mil; depois <= 4 mil);
   - linhas desenhadas durante a varredura com a lista FECHADA (antes ~9 mil; depois 0, só o desenho final);
   - pinturas de progresso com a lista ABERTA, 8 lotes em 640 ms (antes 8; depois 1 ou 2);
   - aberta ou fechada, cada lote atualiza o histCache e dispara um cockpit-history-progress (a lateral do cockpit-ui
     lê o cache e ouve o evento, filtrando por detail.abaId; o fim manda complete: true);
   - renomear: repintura ou carga no meio da edição não apaga o campo nem grava o nome pela metade;
   - renomear com sucesso: a repintura adiada durante a edição não se perde (o cache zerado pelo renomear não a descarta). */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const HistoricoLista = require('../src/renderer/historico-lista');
const { lerFonte, pegarBloco } = require('../testes/raiz');
const APP = lerFonte('renderer', 'app.js');
const assentar = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

/* ---------- varredura: loadHist/listarSessoesComProgresso/paintHist de verdade; a linha é só contada ---------- */
function varredura({ listaAberta = false } = {}) {
  let preparadas = 0, linhas = 0, agora = 1000000, pedido, fim;
  const ouvintes = new Set(), eventos = [];
  class Caixa { constructor() { this.filhos = []; } set innerHTML(_) { this.filhos = []; } appendChild(f) { this.filhos.push(f); return f; } replaceChildren(...f) { this.filhos = f; } insertAdjacentHTML() {} querySelector() { return null; } }
  const box = new Caixa();
  const vista = { classList: { contains: (c) => c === 'hidden' && !listaAberta } };
  const aba = { id: 'a', tipo: 'local', caminho: 'C:/A' };
  const ctx = vm.createContext({
    document: { createElement: () => ({}) },
    window: { api: {
      onSessionsProgress: (fn) => { ouvintes.add(fn); return () => ouvintes.delete(fn); },
      sessionsScan: (p) => { pedido = p; return new Promise((r) => { fim = r; }); },
      sessionsCancel: async () => true,
    }, dispatchEvent: (e) => { eventos.push(e); } },
    CustomEvent: class { constructor(tipo, o) { this.type = tipo; this.detail = o && o.detail; } },
    Date: { now: () => agora },
    histGen: { claude: 0 }, pintaGen: { claude: 0 }, histCache: { claude: null }, historicoCancelar: { claude: null },
    listaProgressivaSeq: 0, escondidasPorFiltro: { claude: 0 }, semPastaFiltrou: { claude: false }, verTodasAsConversas: { claude: false },
    buscaAtual: { claude: '' }, filtroGrupo: { claude: null }, cfg: { verRobos: false, tituloAuto: true },
    HistoricoLista: { ...HistoricoLista, preparar: (s, ligado) => { preparadas++; return HistoricoLista.preparar(s, ligado); } },
    filaNomesDoHistorico: { adicionar() {} }, chaveDoLugar: () => 'local', mostrarAviso() {},
    caixaDoMotor: () => box, $: (sel) => (sel === '.side-view[data-view="hclaude"]' ? vista : null),
    abaAtual: () => aba, abasLocais: () => [aba], pastasDaAba: (a) => [a.caminho], remotoDoAba: () => null,
    mesmaPasta: (a, b) => a === b, ehFavorita: () => false, listaGrupos: () => [], grupoDaSessao: () => null,
    grupoDoTempo: () => 'Hoje', linhaGrupo: () => ({}),
    linhaConversa: () => { linhas++; return {}; },
  });
  vm.runInContext(['function normalizarBuscaHistorico(', 'function prepararRespostaHistorico(', 'async function listarSessoesComProgresso(',
    'function filtrarHistoricoDaAba(', 'async function loadHist(', 'async function paintHist('].map((a) => pegarBloco(APP, a)).join('\n'), ctx);
  return {
    ctx, contagem: () => ({ preparadas, linhas }),
    // os cockpit-history-progress de cada lote, e os do fim da varredura (detail.complete)
    progresso: () => eventos.filter((e) => e.type === 'cockpit-history-progress' && !e.detail.complete),
    fimAvisado: () => eventos.filter((e) => e.type === 'cockpit-history-progress' && e.detail.complete),
    carregar: () => ctx.loadHist('claude'),
    // o main manda só os NOVOS de cada lote, ~80 ms depois do anterior
    lote(itens, ms = 80) { agora += ms; for (const fn of ouvintes) fn({ requestId: pedido.requestId, engine: 'claude', items: itens }); },
    terminar(itens) { fim(itens); },
  };
}
const conversa = (i) => ({ id: 'c' + i, title: 'Pedido número ' + i + ' sobre o painel de clientes', when: 5000 - i, cwd: 'C:/A' });
const todas = () => Array.from({ length: 2000 }, (_, i) => conversa(i));
/* a lateral do cockpit-ui lê o histCache e ouve cockpit-history-progress (filtra por detail.abaId): a cada lote, com a
   lista "Conversas do <motor>" aberta ou fechada, o cache cresce e sai UM evento */
function conferirLote(t, lote, total) {
  assert.equal(t.ctx.histCache.claude?.length, total, 'histCache depois do lote ' + lote);
  const eventos = t.progresso();
  assert.equal(eventos.length, lote, 'eventos cockpit-history-progress depois do lote ' + lote);
  assert.equal(eventos[lote - 1].detail.engine, 'claude', 'evento do lote ' + lote + ': motor');
  assert.equal(eventos[lote - 1].detail.abaId, 'a', 'evento do lote ' + lote + ': abaId');
}

test('varredura: cada conversa é preparada uma vez, não a cada lote (R3-02)', async () => {
  const t = varredura();
  const carga = t.carregar(); await assentar();
  const lista = todas();
  for (let k = 250; k <= 2000; k += 250) t.lote(lista.slice(k - 250, k));
  t.terminar(lista); await carga;
  const { preparadas } = t.contagem();
  assert.ok(preparadas <= 4000, 'fichas preparadas (2000 conversas, 8 lotes): ' + preparadas);
  assert.equal(t.ctx.histCache.claude.length, 2000);
  assert.equal(t.ctx.histCache.claude[0].id, 'c0', 'a mais nova primeiro');
});

test('varredura com a lista "Conversas do Claude" fechada: só o desenho final; o cache e o evento de cada lote seguem (R3-02)', async () => {
  const t = varredura({ listaAberta: false });
  const carga = t.carregar(); await assentar();
  const lista = todas();
  for (let k = 250, lote = 1; k <= 2000; k += 250, lote++) { t.lote(lista.slice(k - 250, k)); conferirLote(t, lote, k); }
  assert.equal(t.contagem().linhas, 0, 'linhas desenhadas durante a varredura com a lista fechada: ' + t.contagem().linhas);
  t.terminar(lista); await carga;
  assert.equal(t.contagem().linhas, 2000, 'o fim desenha a lista uma vez');
  assert.equal(t.fimAvisado().length, 1, 'o fim avisa uma vez, com complete: true');
  assert.equal(t.fimAvisado()[0].detail.abaId, 'a', 'o aviso do fim também leva o abaId');
});

test('varredura com a lista aberta: no máximo uma pintura de progresso a cada 500 ms (R3-02)', async () => {
  const t = varredura({ listaAberta: true });
  const carga = t.carregar(); await assentar();
  const lista = todas();
  let pinturas = 0;
  for (let k = 250, lote = 1; k <= 2000; k += 250, lote++) {
    const antes = t.contagem().linhas; t.lote(lista.slice(k - 250, k), 80); if (t.contagem().linhas > antes) pinturas++;
    conferirLote(t, lote, k);
  }
  assert.ok(pinturas >= 1 && pinturas <= 2, 'pinturas de progresso em 8 lotes (640 ms): ' + pinturas + ' (esperado 1 ou 2: aberta pinta, no máximo a cada 500 ms)');
  t.terminar(lista); await carga;
});

/* ---------- renomear: linhaConversa/paintHist/loadHist de verdade, num DOM de mentira que dispara blur ---------- */
function listaComRenomear() {
  const doc = { ativo: null };
  class El {
    constructor(tag) { this.tag = tag; this.filhos = []; this.pai = null; this.ouvintes = {}; this.style = {}; this.dataset = {}; this._cls = new Set(); this._txt = ''; this.title = ''; this.value = ''; }
    get className() { return [...this._cls].join(' '); }
    set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get classList() { const s = this._cls; return { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c), toggle: (c, on) => { if (on === undefined ? !s.has(c) : on) s.add(c); else s.delete(c); } }; }
    get textContent() { return this._txt + this.filhos.map((f) => f.textContent).join(''); }
    set textContent(v) { this._soltar(); this._txt = String(v); }
    // o HTML que a linha monta é plano (<span class="x"></span>…): um filho por tag com classe basta
    set innerHTML(html) { this._soltar(); this._txt = ''; for (const [, tag, cls] of String(html).matchAll(/<(\w+) class="([^"]+)"[^>]*>/g)) { const f = new El(tag); f.className = cls; this.appendChild(f); } }
    _soltar() { for (const f of this.filhos.splice(0)) { f.pai = null; f._desligar(); } }
    // como no Chromium: tirar da tela o campo focado dispara o blur dele
    _desligar() { if (doc.ativo === this) { doc.ativo = null; for (const fn of this.ouvintes.blur || []) fn({}); } for (const f of this.filhos) f._desligar(); }
    appendChild(f) { if (f.pai) f.remove(); f.pai = this; this.filhos.push(f); return f; }
    insertBefore(f, ref) { if (f.pai) f.remove(); f.pai = this; const i = this.filhos.indexOf(ref); this.filhos.splice(i < 0 ? this.filhos.length : i, 0, f); return f; }
    replaceChildren(...fs) { this._soltar(); for (const f of fs) this.appendChild(f); }
    remove() { if (!this.pai) return; this.pai.filhos.splice(this.pai.filhos.indexOf(this), 1); this.pai = null; this._desligar(); }
    insertAdjacentHTML() {}
    querySelector(sel) { const c = sel.replace(/^\./, ''); const anda = (n) => { for (const f of n.filhos) { if (f._cls.has(c)) return f; const r = anda(f); if (r) return r; } return null; }; return anda(this); }
    addEventListener(t, fn) { (this.ouvintes[t] ||= []).push(fn); }
    disparar(t, ev = {}) { for (const fn of this.ouvintes[t] || []) fn({ stopPropagation() {}, preventDefault() {}, target: { closest: () => null }, ...ev }); }
    focus() { doc.ativo = this; }
    setAttribute(k, v) { (this._attrs = this._attrs || {})[k] = String(v); }   // leva 5 (T3): a linha ganha role="button" e tabIndex
    select() {}
  }
  const box = new El('div');
  const renomeados = [];
  const s = { id: 's1', engine: 'claude', title: 'Nome antigo', cwd: 'C:/A', when: 1 };
  const aba = { id: 'a', tipo: 'local', caminho: 'C:/A' };
  const ctx = vm.createContext({
    document: { createElement: (t) => new El(t) },
    window: { api: { renomear: async (r) => { renomeados.push(r.nome); return { ok: true }; }, buscarConversas: async () => ({ achados: [] }), sessionsClaude: async () => [s] }, dispatchEvent() {} },
    CustomEvent: class { constructor(tipo, o) { this.type = tipo; this.detail = o && o.detail; } },
    $: (sel, raiz) => (raiz || box).querySelector(sel),
    histGen: { claude: 0 }, pintaGen: { claude: 0 }, histCache: { claude: [s] }, historicoCancelar: { claude: null }, listaProgressivaSeq: 0,
    buscaAtual: { claude: '' }, filtroGrupo: { claude: null }, escondidasPorFiltro: { claude: 0 }, semPastaFiltrou: { claude: false }, verTodasAsConversas: { claude: false },
    cfg: { verRobos: false, tituloAuto: false }, HistoricoLista, filaNomesDoHistorico: { adicionar() {} }, chaveDoLugar: () => 'local', mostrarAviso() {},
    caixaDoMotor: () => box, abaAtual: () => aba, abasLocais: () => [aba], pastasDaAba: (a) => [a.caminho], remotoDoAba: () => null, mesmaPasta: (a, b) => a === b,
    marcarTermo: (el, txt) => { el.textContent = txt; }, quando: () => 'agora', ico: () => '',
    ehFavorita: () => false, trocarFavorita() {}, grupoDaSessao: () => null, grupoPorId: () => null, abrirMenuGrupoDaSessao() {},
    listaGrupos: () => [], grupoDoTempo: () => 'Hoje', linhaGrupo: () => new El('div'),
    openSession() {}, renomearPaineisDaConversa() {}, abrirPopGlobal() {}, fecharPopGlobal() {}, ramificarDaLista() {},
  });
  vm.runInContext(['function normalizarBuscaHistorico(', 'function prepararRespostaHistorico(', 'async function listarSessoesComProgresso(',
    'function filtrarHistoricoDaAba(', 'async function loadHist(', 'function linhaConversa(', 'async function paintHist('].map((a) => pegarBloco(APP, a)).join('\n'), ctx);
  return { ctx, box, renomeados, abrirLapis: () => { box.querySelector('.hi-edit').disparar('click'); return box.querySelector('.pn-input'); } };
}

test('renomear: repintura no meio da edição não apaga o campo nem grava o nome pela metade (R3-03)', async () => {
  const t = listaComRenomear();
  await t.ctx.paintHist('claude', t.ctx.histCache.claude);
  const campo = t.abrirLapis();
  assert.ok(campo, 'o lápis abriu o campo');
  campo.value = 'Nome pela me';                                // ainda digitando
  await t.ctx.paintHist('claude', t.ctx.histCache.claude);     // a fila de nomes ou um lote chega agora
  await assentar();
  assert.equal(t.box.querySelector('.pn-input'), campo, 'o campo continua na tela');
  assert.deepEqual(t.renomeados, [], 'nada gravado pela metade: ' + JSON.stringify(t.renomeados));
  campo.value = 'Nome novo completo';
  campo.disparar('keydown', { key: 'Enter' });
  await assentar();
  assert.deepEqual(t.renomeados, ['Nome novo completo']);
});

test('renomear: a repintura adiada acontece quando a edição termina (R3-03)', async () => {
  const t = listaComRenomear();
  await t.ctx.paintHist('claude', t.ctx.histCache.claude);
  const linhaVelha = t.box.querySelector('.hist-item');
  const campo = t.abrirLapis();
  await t.ctx.paintHist('claude', t.ctx.histCache.claude);
  assert.equal(t.box.querySelector('.hist-item'), linhaVelha, 'adiada: a linha ainda é a mesma');
  campo.disparar('keydown', { key: 'Escape' });
  await assentar();
  const linhaNova = t.box.querySelector('.hist-item');
  assert.ok(linhaNova && linhaNova !== linhaVelha, 'repintou depois do Esc');
  assert.equal(t.box.querySelector('.pn-input'), null);
});

test('renomear: carga sem cache (fim de turno) e aviso de erro esperam a edição (R3-03)', async () => {
  const t = listaComRenomear();
  await t.ctx.paintHist('claude', t.ctx.histCache.claude);
  const campo = t.abrirLapis();
  t.ctx.histCache.claude = null;                                // o fim do turno zera o cache
  let responde; t.ctx.window.api.sessionsClaude = () => new Promise((r) => { responde = r; });
  const carga = t.ctx.loadHist('claude');
  assert.equal(t.box.querySelector('.pn-input'), campo, 'o esqueleto não apagou o campo');
  responde({ error: 'Disco ocupado' });
  await carga;
  assert.equal(t.box.querySelector('.pn-input'), campo, 'nem o aviso de erro');
  campo.disparar('keydown', { key: 'Escape' });
  await assentar();
  assert.match(t.box.textContent, /Não consegui ler: Disco ocupado/, 'o aviso aparece quando a edição termina');
});

/* ---------- renomear com sucesso (Enter): o renomear zera o histCache, mas a repintura adiada não pode se perder ---------- */
test('renomear: Enter com sucesso não deixa a busca pendurada quando a pintura foi adiada na edição (R3-03)', async () => {
  const t = listaComRenomear();
  t.ctx.histCache.claude.push({ id: 's2', engine: 'claude', title: 'Outra coisa', cwd: 'C:/A', when: 0 });   // sem o termo no nome: vai para a busca no conteúdo
  const buscas = [];
  t.ctx.window.api.buscarConversas = () => new Promise((r) => { buscas.push(r); });
  t.ctx.buscaAtual.claude = 'nome';
  const pintura = t.ctx.paintHist('claude', t.ctx.histCache.claude);
  assert.match(t.box.textContent, /procurando dentro das conversas/, 'a busca no conteúdo está no ar');
  const campo = t.abrirLapis();
  await t.ctx.paintHist('claude', t.ctx.histCache.claude);   // chega uma pintura no meio da edição: adiada, e a busca de cima fica velha
  buscas[0]({ achados: [] }); await pintura;
  assert.match(t.box.textContent, /procurando dentro das conversas/, 'a busca velha foi descartada e o aviso ficou');
  campo.value = 'Nome novo completo';
  campo.disparar('keydown', { key: 'Enter' });
  await assentar();
  assert.deepEqual(t.renomeados, ['Nome novo completo']);
  assert.equal(buscas.length, 2, 'a repintura adiada aconteceu: saiu outra busca no conteúdo');
  buscas[1]({ achados: [] }); await assentar();
  assert.doesNotMatch(t.box.textContent, /procurando dentro das conversas/, 'a busca nova terminou e tirou o aviso');
  assert.equal(t.box.querySelector('.hi-t').textContent, 'Nome novo completo', 'a linha mostra o nome novo');
});

test('renomear: Enter com sucesso repinta com a lista nova que chegou na edição, com o nome digitado (R3-03)', async () => {
  const t = listaComRenomear();
  await t.ctx.paintHist('claude', t.ctx.histCache.claude);
  const campo = t.abrirLapis();
  // uma varredura termina no meio da edição: o cache passa a ter fichas NOVAS (a conversa renomeada vem com o nome antigo,
  // porque a varredura começou antes do renomear) e mais uma conversa; a pintura é adiada
  t.ctx.histCache.claude = [{ id: 's1', engine: 'claude', title: 'Nome antigo', cwd: 'C:/A', when: 2 }, { id: 's2', engine: 'claude', title: 'Chegou na varredura', cwd: 'C:/A', when: 1 }];
  await t.ctx.paintHist('claude', t.ctx.histCache.claude);
  assert.doesNotMatch(t.box.textContent, /Chegou na varredura/, 'adiada: a conversa nova ainda não está na tela');
  campo.value = 'Nome novo completo';
  campo.disparar('keydown', { key: 'Enter' });
  await assentar();
  assert.deepEqual(t.renomeados, ['Nome novo completo']);
  assert.match(t.box.textContent, /Chegou na varredura/, 'a repintura adiada aconteceu: a conversa nova apareceu');
  assert.match(t.box.textContent, /Nome novo completo/, 'a linha renomeada mostra o nome digitado');
  assert.doesNotMatch(t.box.textContent, /Nome antigo/, 'e não o antigo, que vinha na lista nova');
  assert.equal(t.ctx.histCache.claude, null, 'o cache segue zerado: a próxima carga relê tudo');
});

test('renomear: o main recusar gravar avisa, não zera o cache e a repintura adiada usa o cache que ficou (R3-03)', async () => {
  const t = listaComRenomear();
  const avisos = []; t.ctx.mostrarAviso = (a) => avisos.push(a.texto);
  t.ctx.window.api.renomear = async () => ({ ok: false, error: 'nomes.json ilegível' });
  await t.ctx.paintHist('claude', t.ctx.histCache.claude);
  const linhaVelha = t.box.querySelector('.hist-item');
  const campo = t.abrirLapis();
  await t.ctx.paintHist('claude', t.ctx.histCache.claude);   // adiada
  const lista = t.ctx.histCache.claude;
  campo.value = 'Nome que o main recusa';
  campo.disparar('keydown', { key: 'Enter' });
  await assentar();
  assert.deepEqual(avisos, ['nomes.json ilegível']);
  assert.equal(t.ctx.histCache.claude, lista, 'nada mudou: o cache continua o mesmo');
  const linhaNova = t.box.querySelector('.hist-item');
  assert.ok(linhaNova && linhaNova !== linhaVelha, 'a repintura adiada aconteceu');
  assert.equal(t.box.querySelector('.hi-t').textContent, 'Nome antigo');
});
