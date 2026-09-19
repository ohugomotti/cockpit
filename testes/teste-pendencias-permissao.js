/* Task 3: desenharPermissao aceita um container alternativo (pra desenhar
   dentro do card da view Pendencias) sem mudar o comportamento padrao no
   painel. Mesmo estilo de teste do resto do repo: funcao extraida do fonte
   de verdade, rodada num vm com um DOM minimo escrito a mao (nao jsdom). */
const vm = require('vm');
const { lerFonte, pegarBloco, globaisFalsos } = require('./raiz');

const app = lerFonte('renderer', 'app.js');
let falhas = 0;
const checa = (nome, ok, det) => { console.log((ok ? '  ok   ' : '  FALHA') + ' ' + nome + (ok || !det ? '' : '  -> ' + det)); if (!ok) falhas++; };

class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.className = ''; this.style = {}; this.dataset = {};
    this.filhos = []; this.texto = ''; this._html = ''; this.eventos = {};
    this.classes = new Set(); this._achados = new Map(); this.pai = null;
    this.title = '';
  }
  get classList() {
    const eu = this;
    return {
      add: (...c) => c.forEach((x) => eu.classes.add(x)),
      remove: (...c) => c.forEach((x) => eu.classes.delete(x)),
      contains: (c) => eu.classes.has(c),
      toggle: (c, v) => { const liga = v === undefined ? !eu.classes.has(c) : !!v; if (liga) eu.classes.add(c); else eu.classes.delete(c); return liga; },
    };
  }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.filhos = []; }
  get textContent() { return this.texto || this.filhos.map((f) => f.textContent).join(''); }
  set textContent(v) { this.texto = String(v); }
  appendChild(c) { c.pai = this; this.filhos.push(c); return c; }
  after(c) { return c; }
  remove() { if (this.pai) this.pai.filhos = this.pai.filhos.filter((f) => f !== this); }
  set onclick(f) { this.eventos.click = f; }
  async clicar() { if (this.eventos.click) await this.eventos.click({ stopPropagation() {} }); }
  buscar(sel) { if (!this._achados.has(sel)) this._achados.set(sel, new El('span')); return this._achados.get(sel); }
}
const $ = (sel, raiz) => (raiz && raiz.buscar ? raiz.buscar(sel) : null);

function montarCtx() {
  const aprovacoes = [];
  const ctx = {
    ...globaisFalsos(), console,
    $, document: { createElement: (t) => new El(t) },
    piscar: () => {}, avisarNoQuadro: () => {}, quadro: null,
    // Task 5 fez proximaPermissao chamar sincronizarPendencias() no final; aqui a
    // funcao e' extraida isolada (sem o resto do app.js), entao precisa do mesmo
    // tipo de no-op que pintarAbasLocal ja recebe - efeito colateral fora do que
    // este teste verifica.
    elDiff: () => new El('div'), note: () => {}, pintarAbasLocal: () => {}, sincronizarPendencias: () => {},
    window: { api: { approve: async (arg) => { aprovacoes.push(arg); return true; }, autoLiberar: async () => {} } },
  };
  vm.createContext(ctx);
  for (const f of ['function desenharPermissao(', 'function proximaPermissao(', 'function esconderPermissao(']) {
    vm.runInContext(pegarBloco(app, f, f), ctx);
  }
  ctx._aprovacoes = aprovacoes;
  return ctx;
}

async function testaPadrao() {
  const ctx = montarCtx();
  const painelEl = new El('div');
  const P = { el: painelEl, filaPerm: [{ key: 'k1', title: 'Rodar comando', tool: 'Bash' }] };
  ctx.desenharPermissao(P);
  const bar = painelEl.buscar('.pane-perm');
  checa('sem 2o argumento, desenha em .pane-perm do painel', bar.buscar('.pp-txt').textContent.includes('Rodar comando'));
  await bar.buscar('.pp-yes').clicar();
  checa('clicar Permitir no painel chama approve com a key certa', JSON.stringify(ctx._aprovacoes[0]) === JSON.stringify({ key: 'k1', allow: true }));
}

async function testaContainerAlternativo() {
  const ctx = montarCtx();
  const painelEl = new El('div');
  const outro = new El('div');
  const P = { el: painelEl, filaPerm: [{ key: 'k2', title: 'Editar arquivo', tool: 'Edit' }, { key: 'k3', title: 'Rodar outro comando', tool: 'Bash' }] };
  ctx.desenharPermissao(P, outro);
  checa('com container alternativo, desenha LA e nao no painel', outro.buscar('.pp-txt').textContent.includes('Editar arquivo'));
  const barDoPainel = painelEl._achados.get('.pane-perm');
  checa('a barra do painel nao foi tocada', barDoPainel === undefined);
  await outro.buscar('.pp-yes').clicar();
  checa('apos responder o 1o da fila, o 2o continua aparecendo no MESMO container alternativo (nao pula pro painel)', outro.buscar('.pp-txt').textContent.includes('Rodar outro comando'));
  checa('so duas aprovacoes chamadas, nesta ordem', JSON.stringify(ctx._aprovacoes) === JSON.stringify([{ key: 'k2', allow: true }]));
}

(async () => {
  await testaPadrao();
  await testaContainerAlternativo();
  console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nteste-pendencias-permissao: tudo ok');
  process.exit(falhas ? 1 : 0);
})();
