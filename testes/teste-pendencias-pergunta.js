/* Task 4: desenharPergunta aceita um container alternativo. Cobre o caso que
   a implementacao incompleta da sessao anterior NAO cobria: 2 sub-perguntas
   ao mesmo tempo (o bug real era window.api.perguntaResponder({respostas:
   [resposta]}) com UMA resposta so, quebraria aqui). */
const vm = require('vm');
const { lerFonte, pegarBloco, globaisFalsos } = require('./raiz');

const app = lerFonte('renderer', 'app.js');
let falhas = 0;
const checa = (nome, ok, det) => { console.log((ok ? '  ok   ' : '  FALHA') + ' ' + nome + (ok || !det ? '' : '  -> ' + det)); if (!ok) falhas++; };

class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.style = {}; this.dataset = {};
    this.filhos = []; this.texto = ''; this._html = ''; this.eventos = {};
    this.classes = new Set(); this.pai = null; this.type = ''; this.placeholder = ''; this.value = '';
  }
  // no DOM real, className e classList sao duas vistas do mesmo conjunto de
  // tokens; o app.js cria os botoes com bt.className = 'perg-op' (nao
  // classList.add), entao sem isso coletarPorClasse nunca acharia nada
  get className() { return [...this.classes].join(' '); }
  set className(v) { this.classes = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
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
  addEventListener(n, f) { (this.eventos[n] = this.eventos[n] || []).push(f); }
  async disparar(n, ev) { for (const f of (this.eventos[n] || [])) await f(ev || { stopPropagation() {}, preventDefault() {}, key: '' }); }
  querySelectorAll(sel) {
    // usado so' por lista.querySelectorAll('.perg-op') pra tirar a marcacao anterior
    if (sel === '.perg-op') return coletarPorClasse(this, 'perg-op');
    return [];
  }
}
function coletarPorClasse(no, classe) {
  const achou = [];
  for (const f of no.filhos) { if (f.classes && f.classes.has(classe)) achou.push(f); achou.push(...coletarPorClasse(f, classe)); }
  return achou;
}
const $ = () => null;   // desenharPergunta so usa $ pra achar o cx PADRAO; nos testes sempre passamos cxExterna

function montarCtx() {
  const respostas = [];
  const ctx = {
    ...globaisFalsos(), console,
    $, document: { createElement: (t) => new El(t) },
    // Task 5 fez proximaPergunta chamar sincronizarPendencias() no final; aqui a
    // funcao e' extraida isolada (sem o resto do app.js), entao precisa do mesmo
    // tipo de no-op que pintarAbasLocal ja recebe - efeito colateral fora do que
    // este teste verifica.
    piscar: () => {}, avisarNoQuadro: () => {}, quadro: null, note: () => {}, pintarAbasLocal: () => {}, sincronizarPendencias: () => {}, scroll: () => {}, panes: new Map(),
    window: { api: { perguntaResponder: (arg) => { respostas.push(arg); } } },
  };
  vm.createContext(ctx);
  for (const f of ['function desenharPergunta(', 'function proximaPergunta(', 'function esconderPergunta(']) {
    vm.runInContext(pegarBloco(app, f, f), ctx);
  }
  ctx._respostas = respostas;
  return ctx;
}

async function testaDuasSubPerguntasNoContainerAlternativo() {
  const ctx = montarCtx();
  const painelEl = new El('div');
  const outro = new El('div');
  const P = {
    el: painelEl,
    filaPerg: [{
      id: 'q1', bloqueante: true,
      perguntas: [
        { pergunta: 'Qual pasta?', opcoes: [{ rotulo: 'src' }, { rotulo: 'dist' }] },
        { pergunta: 'Confirma?', opcoes: [{ rotulo: 'sim' }, { rotulo: 'não' }] },
      ],
    }],
  };
  ctx.desenharPergunta(P, outro);
  checa('as DUAS sub-perguntas aparecem no container alternativo', outro.textContent.includes('Qual pasta?') && outro.textContent.includes('Confirma?'));

  const opcoes = coletarPorClasse(outro, 'perg-op');
  const btSrc = opcoes.find((b) => b.textContent.includes('src'));
  const btSim = opcoes.find((b) => b.textContent.includes('sim'));
  await btSrc.disparar('click');
  await btSim.disparar('click');
  const btOk = coletarPorClasse(outro, 'perg-ok')[0];
  checa('botao Responder habilitado depois de marcar as 2', !btOk.disabled);
  await btOk.disparar('click');
  checa('perguntaResponder recebe as DUAS respostas, uma por sub-pergunta (nao so a ultima)', JSON.stringify(ctx._respostas) === JSON.stringify([{ id: 'q1', respostas: ['src', 'sim'] }]));
}

async function testaSemContainerUsaPainel() {
  const ctx = montarCtx();
  let pediuSeletorPadrao = false;
  ctx.$ = (sel, raiz) => { if (sel === '.pane-perg') pediuSeletorPadrao = true; return new El('div'); };
  const P = { el: new El('div'), filaPerg: [{ id: 'q2', bloqueante: true, perguntas: [{ pergunta: 'x', opcoes: [] }] }] };
  ctx.desenharPergunta(P);
  checa('sem 2o argumento, continua buscando .pane-perg do painel', pediuSeletorPadrao);
}

(async () => {
  await testaDuasSubPerguntasNoContainerAlternativo();
  await testaSemContainerUsaPainel();
  console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nteste-pendencias-pergunta: tudo ok');
  process.exit(falhas ? 1 : 0);
})();
