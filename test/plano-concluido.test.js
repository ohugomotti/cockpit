'use strict';
/* Leva 4, Tarefa 9 (UI 4.5): plano todo feito vira uma linha na conversa, "✓ 2 passos", em vez da faixa em cima do campo.
   Medida: faixas de plano concluído em cima do campo (antes 1; depois 0). */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');

const UI = lerFonte('renderer', 'cockpit-ui.js');
const APP = lerFonte('renderer', 'app.js');
function pedaco(nome) {
  const inicio = UI.search(new RegExp('(?:async )?function ' + nome + '\\('));
  assert.notEqual(inicio, -1, 'função não encontrada: ' + nome);
  return UI.slice(inicio, UI.indexOf('\n  }', inicio) + 4);
}
class El {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.filhos = []; this.pai = null; this.className = ''; this.textContent = ''; this.title = ''; this.attrs = {}; this.ouvintes = {}; }
  get parentNode() { return this.pai; }
  append(...cs) { for (const c of cs) this.appendChild(c); }
  appendChild(c) { if (c.pai) c.remove(); c.pai = this; this.filhos.push(c); return c; }
  insertBefore(c, ref) { if (c.pai) c.remove(); c.pai = this; const i = ref ? this.filhos.indexOf(ref) : -1; if (i < 0) this.filhos.push(c); else this.filhos.splice(i, 0, c); return c; }
  before(c) { this.pai.insertBefore(c, this); }
  remove() { if (this.pai) this.pai.filhos.splice(this.pai.filhos.indexOf(this), 1); this.pai = null; }
  replaceChildren(...cs) { for (const f of this.filhos) f.pai = null; this.filhos = []; this.append(...cs); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(t, f) { (this.ouvintes[t] = this.ouvintes[t] || []).push(f); }
  click() { for (const f of this.ouvintes.click || []) f({}); }
  querySelector(sel) { const c = sel.replace(/^\./, ''); for (const f of this.filhos) { if (f.className.split(' ').includes(c)) return f; const d = f.querySelector(sel); if (d) return d; } return null; }
}
function tela() {
  const camadas = [], pane = new El('section'), chat = new El('div'), cmp = new El('div');
  cmp.className = 'pane-cmp'; pane.append(chat, cmp);
  const node = (tag, cls, text) => { const n = new El(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const button = (icon, title, action, cls = '') => { const b = node('button', 'ck-button ' + cls); b.title = title; b.setAttribute('aria-label', title); if (action) b.addEventListener('click', action); return b; };
  const labelled = (text, action, cls = '') => { const b = button('', text, action, cls); b.textContent = text; return b; };
  const ctx = vm.createContext({ node, button, labelled, q: (sel, raiz) => raiz.querySelector(sel), $: (sel, raiz) => raiz.querySelector(sel), tituloNaTorre: () => 'Conversa',
    openLayer: (titulo) => { const l = { titulo, body: node('div') }; camadas.push(l); return l; } });
  vm.runInContext(pedaco('plan') + '\n' + pedaco('planLayer') + '\n' + pegarBloco(APP, 'function limparPlano(', 'limparPlano'), ctx);
  return { ctx, p: { el: pane, chat, plano: [] }, chat, pane, camadas };
}
const feito = (txt) => ({ txt, estado: 'feito' });
const linhasFeitas = (chat) => chat.filhos.filter((x) => x.className.split(' ').includes('ck-plan-feito'));

test('plano todo feito: sai a faixa e entra uma linha "✓ 2 passos" na conversa, uma vez só (UI 4.5)', () => {
  const { ctx, p, chat, pane, camadas } = tela();
  ctx.plan(p, [feito('Ler'), { txt: 'Escrever', estado: 'fazendo' }]);
  assert.ok(pane.querySelector('.ck-plan'), 'em andamento: a faixa fica');
  ctx.plan(p, [feito('Ler'), feito('Escrever')]);
  assert.equal(pane.querySelector('.ck-plan'), null, 'faixa de plano concluído em cima do campo');
  assert.equal(linhasFeitas(chat).length, 1);
  assert.equal(linhasFeitas(chat)[0].textContent, '✓ 2 passos');
  ctx.plan(p, [feito('Ler'), feito('Escrever')]);   // o agente reenvia o mesmo plano
  assert.equal(linhasFeitas(chat).length, 1, 'uma vez por plano');
  linhasFeitas(chat)[0].click();
  assert.equal(camadas.at(-1).body.filhos.length, 2, 'a linha abre a lista com os 2 passos');
});

test('a linha entra antes do "trabalhando…" (UI 4.5)', () => {
  const { ctx, p, chat } = tela();
  const trab = new El('div'); trab.className = 'trab'; chat.append(trab); p.trabEl = trab;
  ctx.plan(p, [feito('Único')]);
  assert.deepEqual(chat.filhos.map((x) => x.className.split(' ').pop()), ['ck-plan-feito', 'trab']);
  assert.equal(chat.filhos[0].textContent, '✓ 1 passo');
});

test('plano seguinte, mesmo com os mesmos passos, ganha a própria linha; a linha velha guarda a lista dela (UI 4.5)', () => {
  const { ctx, p, chat, camadas } = tela();
  ctx.plan(p, [feito('Ler'), feito('Escrever')]);
  ctx.plan(p, [{ txt: 'Revisar', estado: 'fazendo' }]);   // outro plano começa: a faixa volta e a chave zera
  ctx.plan(p, [feito('Ler'), feito('Escrever')]);
  assert.equal(linhasFeitas(chat).length, 2, 'um plano concluído novo não some por ter o texto de um antigo');
  ctx.plan(p, [{ txt: 'Revisar', estado: 'fazendo' }]);
  linhasFeitas(chat)[0].click();
  assert.deepEqual(camadas.at(-1).body.filhos.map((l) => l.filhos[1].textContent), ['Ler', 'Escrever'],
    'a linha abre a lista que ela contou, não o plano de agora');
});

/* Leva 4, onda 3 (revisão da T9): o limparPlano (conversa nova, troca de motor, retomar) zerava o plano mas não a chave do "plano
   concluído". A conversa nova que fechasse um plano com os mesmos passos da anterior ficava sem a linha "✓ N passos".
   Medida: linhas de plano concluído na conversa nova (antes 0; depois 1). */
test('zerar a conversa (limparPlano) esquece o plano concluído: o mesmo plano na conversa nova ganha a linha (UI 4.5)', () => {
  const { ctx, p, chat } = tela();
  ctx.plan(p, [feito('Ler'), feito('Escrever')]);
  assert.equal(linhasFeitas(chat).length, 1);
  ctx.limparPlano(p);                          // conversa nova: o chat é refeito do zero
  assert.equal(p.uiPlanoFeito, '', 'a chave do plano concluído zera junto com o plano');
  chat.replaceChildren();
  ctx.plan(p, [feito('Ler'), feito('Escrever')]);   // o agente monta o mesmo plano na conversa nova
  assert.equal(linhasFeitas(chat).length, 1, 'o plano igual ao da conversa anterior ficou sem a linha');
});

/* Leva 4, onda 3 (limpeza da revisão): duas linhas mortas das tarefas 9. (1) Com o plano todo feito a faixa nem nasce mais (vira a
   linha na conversa): sobra sempre um passo por fazer, então o "Plano concluído" de reserva do texto da faixa nunca aparece.
   (2) O tempo do passo foi para o title do próprio passo: a regra .mv-passo-tempo ficou sem elemento. */
test('limpeza: a faixa mostra o passo de agora sem texto de reserva, e a regra .mv-passo-tempo saiu (UI 4.5 e 3.4)', () => {
  assert.doesNotMatch(pedaco('plan'), /\|\| "Plano concluído"/, 'o texto de reserva da faixa nunca aparece');
  const { ctx, p, pane } = tela();
  ctx.plan(p, [feito('Ler'), { txt: 'Escrever', estado: 'fazendo' }, { txt: 'Revisar', estado: 'pendente' }]);
  assert.equal(pane.querySelector('.ck-plan-current').textContent, 'Escrever');
  ctx.plan(p, [feito('Ler'), feito('Escrever'), { txt: 'Revisar', estado: 'pendente' }]);
  assert.equal(pane.querySelector('.ck-plan-current').textContent, 'Revisar', 'sem passo em andamento, vale o primeiro por fazer');
  assert.doesNotMatch(lerFonte('renderer', 'cockpit-anim.css'), /mv-passo-tempo/);
  assert.doesNotMatch(lerFonte('renderer', 'cockpit-anim.js'), /mv-passo-tempo/);
});

test('plano em andamento: a faixa abre a lista de agora; sem conversa, o concluído só tira a faixa (UI 4.5)', () => {
  const { ctx, p, pane, camadas } = tela();
  ctx.plan(p, [feito('Ler'), { txt: 'Escrever', estado: 'fazendo' }, { txt: 'Revisar', estado: 'pendente' }]);
  pane.querySelector('.ck-plan').click();
  assert.equal(camadas.at(-1).body.filhos.length, 3, 'planLayer(p) sem lista usa o plano atual');
  delete p.chat;
  assert.doesNotThrow(() => ctx.plan(p, [feito('Ler'), feito('Escrever'), feito('Revisar')]));
  assert.equal(pane.querySelector('.ck-plan'), null);
});

/* UI 3.4: o tempo do passo é o title do próprio passo. Quando o passo é solto, o ATRIBUTO sai de vez: title="" sobrando
   calaria o tooltip do botão do plano ("Plano: 1 de 3 passos…") em cima do texto do passo. */
test('passo solto: o title do passo sai por inteiro, o tooltip do botão do plano volta (UI 3.4)', () => {
  const tem = (e, c) => e.className.split(/\s+/).includes(c);
  const descendentes = (e) => e.filhos.flatMap((f) => [f, ...descendentes(f)]);
  function busca(e, sel) {
    let atuais = [e];
    for (const c of sel.trim().split(/\s+/).map((s) => s.replace(/^\./, ''))) atuais = [...new Set(atuais.flatMap(descendentes))].filter((x) => tem(x, c));
    return atuais;
  }
  const el = (classe) => {
    const e = {
      className: classe, filhos: [], attrs: new Map(),
      get title() { return e.attrs.has('title') ? e.attrs.get('title') : ''; },   // como no DOM: sem o atributo, ''
      set title(v) { e.attrs.set('title', String(v)); },
      hasAttribute: (n) => e.attrs.has(n), removeAttribute: (n) => { e.attrs.delete(n); },
      append(...fs) { e.filhos.push(...fs); },
      querySelector: (sel) => busca(e, sel)[0] || null,
    };
    return e;
  };
  const relogios = [];
  const ctx = vm.createContext({
    CockpitUI: { plan(p, itens) {
      p.plano = itens;
      const bar = el('ck-plan'), linha = el('ck-plan-line');
      linha.append(el('ck-plan-current'), el('ck-plan-total')); bar.append(linha); p.el.filhos = [bar];
    } },
    Date: { now: () => 1000000 }, setTimeout: () => 0, clearTimeout() {},
    setInterval: (fn) => relogios.push(fn), clearInterval() {},
    document: { createElement: () => el('') },
  });
  vm.runInContext(lerFonte('renderer', 'cockpit-anim.js'), ctx);
  const p = { el: el('pane'), busy: true, morto: false, plano: [] };
  ctx.CockpitUI.plan(p, [{ txt: 'A', estado: 'fazendo' }]);
  const passo = p.el.querySelector('.ck-plan-current');
  assert.equal(passo.title, 'Neste passo há 0s');
  p.busy = false;
  relogios.forEach((fn) => fn());   // o relógio bate e o painel já não está ocupado
  assert.equal(passo.title, '');
  assert.equal(passo.hasAttribute('title'), false, 'title="" sobrando esconderia o tooltip do botão do plano');
});
