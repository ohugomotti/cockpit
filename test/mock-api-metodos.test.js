'use strict';
/* Métodos novos da leva 1: colarSalvarImagem, mostrarNaPasta e colados.
   O simulador (mock-api.js) deve declará-los para não registrar em __qa.missing. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { RAIZ } = require('../testes/raiz');

const MOCK = fs.readFileSync(path.join(RAIZ, 'tools', 'redesenho', 'mock-api.js'), 'utf8');

test('mock-api.js: colarSalvarImagem está declarado', () => {
  const win = {};
  const ctx = vm.createContext({
    window: win, location: { search: '' }, URLSearchParams, JSON, Date, Math, Object, Array, String, Promise, Proxy, Set, Map,
    setTimeout, queueMicrotask, console, addEventListener() {},
  });
  vm.runInContext(MOCK, ctx);
  assert.ok(typeof win.api.colarSalvarImagem === 'function', 'colarSalvarImagem é função');
  assert.ok(!win.__qa.missing.has('colarSalvarImagem'), 'colarSalvarImagem não está em __qa.missing');
});

test('mock-api.js: colarSalvarImagem retorna { arquivo: string }', async () => {
  const win = {};
  const ctx = vm.createContext({
    window: win, location: { search: '' }, URLSearchParams, JSON, Date, Math, Object, Array, String, Promise, Proxy, Set, Map,
    setTimeout, queueMicrotask, console, addEventListener() {},
  });
  vm.runInContext(MOCK, ctx);
  const buffer = new Uint8Array([137, 80, 78, 71]).buffer; // PNG magic
  const r = await win.api.colarSalvarImagem(buffer, 'image/png');
  assert.ok(r && typeof r === 'object', 'retorna um objeto');
  assert.ok(r.arquivo && typeof r.arquivo === 'string', 'tem propriedade .arquivo (string)');
});

test('mock-api.js: mostrarNaPasta está declarado', () => {
  const win = {};
  const ctx = vm.createContext({
    window: win, location: { search: '' }, URLSearchParams, JSON, Date, Math, Object, Array, String, Promise, Proxy, Set, Map,
    setTimeout, queueMicrotask, console, addEventListener() {},
  });
  vm.runInContext(MOCK, ctx);
  assert.ok(typeof win.api.mostrarNaPasta === 'function', 'mostrarNaPasta é função');
  assert.ok(!win.__qa.missing.has('mostrarNaPasta'), 'mostrarNaPasta não está em __qa.missing');
});

test('mock-api.js: mostrarNaPasta retorna { ok: true }', async () => {
  const win = {};
  const ctx = vm.createContext({
    window: win, location: { search: '' }, URLSearchParams, JSON, Date, Math, Object, Array, String, Promise, Proxy, Set, Map,
    setTimeout, queueMicrotask, console, addEventListener() {},
  });
  vm.runInContext(MOCK, ctx);
  const r = await win.api.mostrarNaPasta();
  assert.equal(r.ok, true, 'retorna { ok: true }');
});

test('mock-api.js: colados retorna { arquivos: [] }', async () => {
  const win = {};
  const ctx = vm.createContext({
    window: win, location: { search: '' }, URLSearchParams, JSON, Date, Math, Object, Array, String, Promise, Proxy, Set, Map,
    setTimeout, queueMicrotask, console, addEventListener() {},
  });
  vm.runInContext(MOCK, ctx);
  const r = await win.api.colados();
  assert.ok(r && typeof r === 'object', 'colados retorna um objeto');
  assert.ok(Array.isArray(r.arquivos), 'tem propriedade .arquivos (array)');
});

test('mock-api.js: __qa.missing vazio após chamar colarSalvarImagem, mostrarNaPasta e colados', async () => {
  const win = {};
  const ctx = vm.createContext({
    window: win, location: { search: '' }, URLSearchParams, JSON, Date, Math, Object, Array, String, Promise, Proxy, Set, Map,
    setTimeout, queueMicrotask, console, addEventListener() {},
  });
  vm.runInContext(MOCK, ctx);
  const buffer = new Uint8Array([137, 80, 78, 71]).buffer;
  await win.api.colarSalvarImagem(buffer, 'image/png');
  await win.api.mostrarNaPasta();
  await win.api.colados();
  assert.ok(!win.__qa.missing.has('colarSalvarImagem'), 'colarSalvarImagem não em missing');
  assert.ok(!win.__qa.missing.has('mostrarNaPasta'), 'mostrarNaPasta não em missing');
  assert.ok(!win.__qa.missing.has('colados'), 'colados não em missing');
});
