/* Robo em segundo plano: o sinal de que tem trabalho rodando por tras
   depois que o turno acaba.

   A fonte e' o evento OFICIAL system/background_tasks_changed, que traz a
   LISTA INTEIRA a cada mudanca (e [] quando acabam). A tela espelha essa
   lista em vez de contar comeco e fim por conta - assim nao dessincroniza.

   Antes daqui houve um erro que vale lembrar: a primeira versao adivinhava
   pelo texto ("Async agent launched...") e fechava pela <task-notification>.
   O chip nunca fechava, porque essa notificacao NAO sai no stdout do claude -
   ela so' vai pro historico gravado (medido, nao suposto). */
const vm = require('vm');
const { lerFonte, pegarBloco, globaisFalsos } = require('./raiz');

const app = lerFonte('renderer', 'app.js');
const main = lerFonte('main.js');
let falhas = 0;
const checa = (nome, ok, det) => { console.log((ok ? '  ok   ' : '  FALHA') + ' ' + nome + (ok || !det ? '' : '  -> ' + det)); if (!ok) falhas++; };

/* ---------- telinha de mentira (o minimo que pintarRobos toca) ---------- */
class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.filhos = []; this.texto = ''; this.title = ''; this.classes = new Set(); this.pai = null;
  }
  get className() { return [...this.classes].join(' '); }
  set className(v) { this.classes = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  get classList() {
    const eu = this;
    return { add: (...c) => c.forEach((x) => eu.classes.add(x)), remove: (...c) => c.forEach((x) => eu.classes.delete(x)), contains: (c) => eu.classes.has(c) };
  }
  get textContent() { return this.texto || this.filhos.map((f) => f.textContent).join(' '); }
  set textContent(v) { this.texto = String(v); }
  append(...cs) { for (const c of cs) this.appendChild(c); }
  appendChild(c) { c.pai = this; this.filhos.push(c); return c; }
  insertBefore(c) { c.pai = this; this.filhos.push(c); return c; }
  remove() { if (this.pai) this.pai.filhos = this.pai.filhos.filter((f) => f !== this); }
}
function achar(no, classe) {
  for (const f of no.filhos) {
    if (f.classes && f.classes.has(classe)) return f;
    const dentro = achar(f, classe);
    if (dentro) return dentro;
  }
  return null;
}

function montarCtx() {
  const cmp = new El('div'); cmp.className = 'pane-cmp';
  const painel = new El('div'); painel.appendChild(cmp);
  const ctx = {
    ...globaisFalsos(), console,
    document: { createElement: (t) => new El(t) },
    $: (sel, raiz) => {
      const classe = String(sel).replace(/^\./, '');
      if (!raiz) return null;
      if (classe === 'pane-cmp') return cmp;
      if (classe === 'cmp-top') return null;   // insertBefore(x, null) = joga no fim, igual DOM real
      return achar(raiz, classe);
    },
    duracaoCurta: (ms) => Math.round(ms / 1000) + 's',
    panes: new Map(), panesFundo: new Map(), pintarAbasLocal: () => {},
    setInterval: () => 1, clearInterval: () => {},
  };
  vm.createContext(ctx);
  for (const f of ['function roboDoPainel(', 'function pintarRobos(']) vm.runInContext(pegarBloco(app, f, f), ctx);
  return { ctx, painel };
}

/* ---------- a tela espelhando a lista ---------- */
console.log('1) a tela espelha a lista que chega');
{
  const { ctx, painel } = montarCtx();
  const P = { id: 'p1', el: painel };
  ctx.panes.set('p1', P);

  ctx.roboDoPainel(P, { tarefas: [{ id: 'b1', tipo: 'agente', desc: 'Revisar a Task 5' }] });
  const chip = achar(painel, 'p-robos');
  checa('chip nasce com a primeira tarefa', !!chip);
  checa('no singular fala de UM robo', !!chip && chip.textContent.includes('um robô trabalhando'), chip && chip.textContent);
  checa('a dica mostra o que o robo foi fazer', !!chip && chip.title.includes('Revisar a Task 5'));

  ctx.roboDoPainel(P, { tarefas: [{ id: 'b1', tipo: 'agente', desc: 'Revisar a Task 5' }, { id: 'b2', tipo: 'comando', desc: 'npm test' }] });
  checa('duas tarefas: vira plural com o numero', achar(painel, 'p-robos').textContent.includes('2 robôs trabalhando'));

  ctx.roboDoPainel(P, { tarefas: [{ id: 'b2', tipo: 'comando', desc: 'npm test' }] });
  checa('quem saiu da lista sai da conta', achar(painel, 'p-robos').textContent.includes('um robô trabalhando'));

  ctx.roboDoPainel(P, { tarefas: [] });
  checa('lista vazia = chip some da tela', achar(painel, 'p-robos') === null);
}

console.log('2) o relogio do robo que continua NAO reinicia quando outro entra');
{
  const { ctx, painel } = montarCtx();
  const P = { id: 'p1', el: painel };
  ctx.roboDoPainel(P, { tarefas: [{ id: 'b1', tipo: 'agente', desc: 'o primeiro' }] });
  const t0Antes = P.robos.get('b1').t0;
  // um robo novo entra na lista: o antigo tem que manter o t0, senao o "ha X"
  // do que ja estava rodando volta pra zero a cada mudanca
  ctx.roboDoPainel(P, { tarefas: [{ id: 'b1', tipo: 'agente', desc: 'o primeiro' }, { id: 'b2', tipo: 'comando', desc: 'o segundo' }] });
  checa('o t0 do que ja estava rodando e preservado', P.robos.get('b1').t0 === t0Antes);
  checa('o que entrou agora ganha t0 proprio', !!P.robos.get('b2').t0);
}

console.log('3) lista fora de ordem ou repetida nao confunde a conta');
{
  const { ctx, painel } = montarCtx();
  const P = { id: 'p1', el: painel };
  ctx.roboDoPainel(P, { tarefas: [{ id: 'b1', desc: 'a' }, { id: 'b2', desc: 'b' }] });
  ctx.roboDoPainel(P, { tarefas: [{ id: 'b2', desc: 'b' }, { id: 'b1', desc: 'a' }] });
  checa('a mesma lista em outra ordem continua sendo 2', achar(painel, 'p-robos').textContent.includes('2 robôs trabalhando'));
  ctx.roboDoPainel(P, { tarefas: [] });
  checa('e some quando esvazia', achar(painel, 'p-robos') === null);
}

/* ---------- o lado do main ---------- */
console.log('4) o main le o evento oficial, nao adivinha por texto');
{
  checa('escuta background_tasks_changed', main.includes("m.subtype === 'background_tasks_changed'"));
  checa('manda a lista inteira pra tela', main.includes("emit(paneId, 'robos', { tarefas })"));
  checa('local_bash vira "comando", o resto vira "agente"', main.includes("=== 'local_bash' ? 'comando' : 'agente'"));
  checa('tarefa sem id e descartada', main.includes(".filter((x) => x.id)"));
  // o que NAO pode voltar: o palpite por texto que nunca fechava o chip
  checa('nao adivinha mais pelo texto do resultado', !main.includes('LANCOU_ROBO') && !main.includes('Async agent launched successfully'));
  checa('nao depende mais da <task-notification> (ela nao sai no stdout)', !main.includes("content.includes('<task-notification>')"));
}

console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nteste-robos: tudo ok');
process.exit(falhas ? 1 : 0);
