'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.listeners = {}; this.className = ''; this.isConnected = true; this._text = ''; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(' '); }
  append(...nodes) { this.children.push(...nodes); for (const n of nodes) n.parent = this; }
  prepend(...nodes) { this.children.unshift(...nodes); for (const n of nodes) n.parent = this; }
  replaceChildren(...nodes) { this._text = ''; this.children = []; this.append(...nodes); }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  setAttribute() {}
  showModal() { this.open = true; }
  close() { this.open = false; this.listeners.close?.(); }
  remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
  querySelector(selector) { return this.descendants().find(n => selector.startsWith('.') ? n.className.split(' ').includes(selector.slice(1)) : n.tagName === selector) || null; }
  descendants() { return this.children.flatMap(n => [n, ...n.descendants()]); }
}

function harness(api = {}) {
  const body = new Element('body'), step = new Element('section');
  const ctx = { URL, Map, Set, Date, panes: new Map(),
    window: { api }, document: { body, createElement: tag => new Element(tag) },
    acharPasso: () => step, acharPainel: () => ({ titulo: 'Projeto A' }), nomeDoMotor: engine => engine, note: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/collaboration.js'), 'utf8'), ctx);
  return { ...ctx.window.CockpitCollaboration, body, step };
}

test('recursos exigem abrivel confirmado e nunca fazem abertura automática', async () => {
  const abertos = [], h = harness({ abrirLink: u => abertos.push(u) });
  h.resources({}, 'passo', [
    { nome: 'Seguro', uri: 'https://example.com', abrivel: true, texto: '<script>texto simples</script>' },
    { nome: 'Sem prova', uri: 'https://example.com/2', abrivel: false },
    { nome: 'Credencial', uri: 'https://user:secret@example.com', abrivel: true },
    { nome: 'Script', uri: 'javascript:alert(1)', abrivel: true },
  ]);
  assert.equal(abertos.length, 0);
  const botoes = h.step.descendants().filter(n => n.tagName === 'button');
  assert.equal(botoes.length, 1);
  await botoes[0].listeners.click(); assert.deepEqual(abertos, ['https://example.com']);
  assert.equal(h.step.descendants().filter(n => n.tagName === 'script').length, 0);
});

test('Torre mostra message e estados do contrato sem controles inventados', async () => {
  const h = harness({ agentesSessao: async () => ({ itens: [
    { paneId: 0, engine: 'codex', task: 'Revisar arquivos', state: 'idle', message: 'Leitura concluída' },
    { paneId: 'debate-private', engine: 'claude', task: 'Oculto', state: 'running' },
  ] }) });
  const box = new Element('section'); await h.paintAgents(box);
  assert.match(box.textContent, /Aguardando próximo turno/); assert.match(box.textContent, /Leitura concluída/);
  assert.doesNotMatch(box.textContent, /Oculto/);
  assert.equal(box.descendants().filter(n => n.tagName === 'button').length, 0);
});

test('diagnóstico separa desconhecido de sucesso e usa snapshot devolvido no reload', async () => {
  let consultas = 0;
  const h = harness({
    mcpDiagnostico: async () => { consultas++; return { itens: [{ nome: 'Drive', configurado: true, carregado: null, estado: 'desconhecido' }], avisos: [] }; },
    mcpRecarregar: async () => ({ ok: true, aviso: 'Recarga confirmada; falta uma chamada.', diagnostico: {
      itens: [{ nome: 'Drive', configurado: true, carregado: true, estado: 'connected', ferramentas: 2, ultimaChamada: null }], avisos: [] } }),
  });
  await h.health({ engine: 'codex', id: 0 });
  assert.match(h.body.textContent, /Carregado na sessão: não confirmado/);
  const reload = h.body.descendants().find(n => n.tagName === 'button' && n.textContent === 'Recarregar conectores');
  await reload.listeners.click();
  assert.match(h.body.textContent, /Carregado na sessão: sim/);
  assert.match(h.body.textContent, /Nenhuma chamada observada/);
  assert.equal(consultas, 1);
});

test('Claude não oferece recarga que a ponte não suporta', async () => {
  const h = harness({ mcpDiagnostico: async () => ({ itens: [], avisos: ['Estado observado na abertura.'] }) });
  await h.health({ engine: 'claude', id: 0 });
  const reload = h.body.descendants().find(n => n.tagName === 'button' && n.textContent === 'Recarregar conectores');
  assert.equal(reload.disabled, true);
});
