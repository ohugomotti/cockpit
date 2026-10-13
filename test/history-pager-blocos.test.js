'use strict';
/* Leva 3, Tarefa 4 (R4-05): rolar uma conversa longa desenha só o bloco novo. Medidas: mensagens desenhadas para
   subir de 60 até o começo de 2000 (antes ~35,6 mil; depois 1940) e para descer um bloco depois de um salto
   (antes 120; depois 60). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const FONTE = fs.readFileSync(path.join(__dirname, '../src/renderer/history-pager.js'), 'utf8');

function pagina(total = 2000) {
  class El {
    constructor(tag) { this.tag = tag; this.children = []; this.parentNode = null; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.disabled = false; this.textContent = ''; }
    append(...ns) { for (const n of ns) { n.remove(); n.parentNode = this; this.children.push(n); } }
    prepend(...ns) { for (const n of ns) n.remove(); for (const n of ns) n.parentNode = this; this.children.unshift(...ns); }
    replaceChildren(...ns) { for (const c of this.children) c.parentNode = null; this.children = []; this.append(...ns); }
    remove() { const p = this.parentNode; if (p) { p.children.splice(p.children.indexOf(this), 1); this.parentNode = null; } }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    addEventListener(t, fn) { this.listeners[t] = fn; }
    removeEventListener(t) { delete this.listeners[t]; }
    querySelector() { return null; }
    scrollIntoView() {} focus() {} select() {}
    getBoundingClientRect() { return { top: 0, bottom: 0 }; }
    set innerHTML(_) {}
  }
  const container = new El('div');
  let conteudo = null, desenhadas = 0;
  container.clientHeight = 400; container.scrollTop = 0;
  // 20 px por mensagem na tela
  Object.defineProperty(container, 'scrollHeight', { get: () => (conteudo ? conteudo.children.length : 0) * 20 });
  const timers = [];
  const ctx = vm.createContext({
    document: { createElement: (t) => new El(t) },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {},
  });
  vm.runInContext(FONTE, ctx);
  const mensagens = Array.from({ length: total }, (_, i) => ({ role: i % 2 ? 'bot' : 'user', text: 'Mensagem ' + i }));
  const posicao = new Map(mensagens.map((m, i) => [m, i])), blocos = [];
  const pager = ctx.CockpitHistoryPager.mount({ container, messages: mensagens, identity: 'teste', valid: () => true,
    // como o desenho de verdade (app.js:10933): guarda o offset e numera a fala do usuário por ele
    draw: (fatia, alvo, offset) => {
      blocos.push({ offset, from: posicao.get(fatia[0]) });
      desenhadas += fatia.length;
      for (const [i, m] of fatia.entries()) {
        const el = new El('div'); el.textContent = m.text;
        if (m.role === 'user') el.dataset.historyIndex = String((offset || 0) + i);
        alvo.append(el);
      }
    } });
  const raiz = container.children[0];
  conteudo = raiz.children[1];
  const anteriores = raiz.children[0].children[1];   // primeira, anteriores, status, busca, buscar, última
  return {
    pager, container, desenhadas: () => desenhadas, zerar() { desenhadas = 0; }, anteriores, blocos,
    rolar(top) { container.scrollTop = top; container.listeners.scroll(); for (const fn of timers.splice(0)) fn(); },
    indices: () => conteudo.children.map((c) => Number(c.dataset.historyIndex)),
    altura: () => container.scrollHeight,
  };
}

test('subir até o começo desenha cada mensagem uma vez só (R4-05)', () => {
  const t = pagina(2000);
  assert.equal(t.desenhadas(), 60, 'a montagem desenha as últimas 60');
  t.zerar();
  // com teto: se o botão nunca desligar, o teste falha em vez de travar (2000 - 60 = 1940 mensagens, 33 blocos de 60)
  let voltas = 0;
  for (; voltas < 40 && !t.anteriores.disabled; voltas++) t.anteriores.onclick();
  assert.ok(t.anteriores.disabled, 'o botão desliga no começo da conversa (voltas: ' + voltas + ')');
  assert.ok(t.desenhadas() <= 1940, 'mensagens desenhadas para subir 1940: ' + t.desenhadas());
  assert.deepEqual(t.indices(), Array.from({ length: 2000 }, (_, i) => i), 'ordem e números certos');
  assert.deepEqual([...t.pager.range], [0, 2000]);
  for (const b of t.blocos) assert.equal(b.offset, b.from, 'offset do bloco que começa em ' + b.from);
});

test('subir mantém na tela o que estava na tela (R4-05)', () => {
  const t = pagina(2000);
  t.container.scrollTop = 30;
  t.anteriores.onclick();
  assert.equal(t.container.scrollTop, 30 + 60 * 20, 'a rolagem anda a altura do bloco novo');
});

test('descer depois de um salto desenha só o bloco seguinte (R4-05)', () => {
  const t = pagina(2000);
  t.pager.show(0);                       // "Ir à primeira mensagem": 0..60
  t.zerar();
  t.rolar(t.altura() - 400 - 50);        // perto do fim do que está na tela
  assert.equal(t.desenhadas(), 60, 'mensagens desenhadas ao descer um bloco: ' + t.desenhadas());
  assert.deepEqual(t.indices(), Array.from({ length: 120 }, (_, i) => i));
  for (const b of t.blocos) assert.equal(b.offset, b.from, 'offset do bloco que começa em ' + b.from);
});
