'use strict';
/* src/renderer/log-tela.js: o script que a tela carrega ANTES de todos os outros.
   Aqui ele roda num vm com window, console e api.logTela falsos (o mesmo script
   que o Chromium roda, só que sem a tela). O que sai do logTela é o que o main
   recebe no canal 'tela:log'. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FONTE = fs.readFileSync(path.join(__dirname, '../src/renderer/log-tela.js'), 'utf8');

/* api: 'ok' (logTela grava em `enviados`), 'sem' (nenhum window.api, como na prévia de QA) ou um objeto */
function montar({ api = 'ok' } = {}) {
  const enviados = [];              // o que chegou no logTela, do jeito que chegou
  const ouvintes = {};              // nome do evento -> [{ fn, captura }]
  const originais = [];             // chamadas do console.error ORIGINAL (com o this de cada uma)
  const consoleFalso = { error: function (...a) { originais.push({ args: a, este: this }); } };
  const erroOriginal = consoleFalso.error;     // a função de antes de o script trocar o console.error
  const janela = { addEventListener: (nome, fn, captura) => { (ouvintes[nome] = ouvintes[nome] || []).push({ fn, captura }); } };
  if (api === 'ok') janela.api = { logTela: (e) => { enviados.push(e); } };
  else if (api && api !== 'sem') janela.api = api;
  const ctx = vm.createContext({ window: janela, console: consoleFalso });
  vm.runInContext(FONTE, ctx);
  const disparar = (nome, ev) => { for (const o of ouvintes[nome] || []) o.fn(ev); };
  return { enviados, ouvintes, originais, consoleFalso, erroOriginal, janela, ctx, disparar };
}
// o objeto nasceu dentro do vm (outro "mundo"): compara pelo conteúdo, como a ponte do Electron faz
const plano = (x) => JSON.parse(JSON.stringify(x));

/* ---------- eventos da janela ---------- */
test('evento error vira logTela com tipo erro, msg, fonte, linha e coluna', () => {
  const h = montar();
  h.disparar('error', { message: 'Uncaught TypeError: x is not a function', filename: 'file:///C:/app/app.js', lineno: 120, colno: 15 });
  assert.equal(h.enviados.length, 1);
  assert.deepEqual(plano(h.enviados[0]), { tipo: 'erro', msg: 'Uncaught TypeError: x is not a function', fonte: 'file:///C:/app/app.js', linha: 120, coluna: 15 });
  assert.deepEqual(Object.keys(h.enviados[0]), ['tipo', 'msg', 'fonte', 'linha', 'coluna'], 'sem chave "undefined" na ponte');
});

test('evento error com o objeto do erro leva também a stack', () => {
  const h = montar();
  const e = new Error('quebrou de verdade');
  h.disparar('error', { message: 'Uncaught Error: quebrou de verdade', filename: 'app.js', lineno: 1, colno: 2, error: e });
  assert.equal(h.enviados[0].stack, e.stack);
  assert.match(h.enviados[0].stack, /quebrou de verdade/);
});

test('evento error sem mensagem usa a do erro; sem nada, não quebra', () => {
  const h = montar();
  h.disparar('error', { error: new Error('só no objeto') });
  h.disparar('error', {});
  h.disparar('error', null);
  h.disparar('error', undefined);
  assert.equal(h.enviados.length, 2, 'null e undefined não mandam nada');
  assert.equal(h.enviados[0].msg, 'só no objeto');
  assert.equal(h.enviados[1].msg, 'undefined');
});

test('evento unhandledrejection com Error("x") vira tipo promessa, msg "x" e stack', () => {
  const h = montar();
  const e = new Error('x');
  h.disparar('unhandledrejection', { reason: e });
  assert.equal(h.enviados.length, 1);
  const [m] = h.enviados;
  assert.equal(m.tipo, 'promessa');
  assert.equal(m.msg, 'x');
  assert.equal(m.stack, e.stack);
  assert.deepEqual(Object.keys(m), ['tipo', 'msg', 'stack']);
});

test('promessa rejeitada com coisa que não é Error: texto, objeto, vazio', () => {
  const h = montar();
  h.disparar('unhandledrejection', { reason: 'falhou assim' });
  h.disparar('unhandledrejection', { reason: { code: 7, onde: 'ipc' } });
  h.disparar('unhandledrejection', { reason: undefined });
  h.disparar('unhandledrejection', { reason: null });
  h.disparar('unhandledrejection', {});
  const msgs = h.enviados.map((e) => e.msg);
  assert.deepEqual(msgs, ['falhou assim', '{"code":7,"onde":"ipc"}', 'undefined', 'null', 'undefined']);
  assert.ok(h.enviados.every((e) => e.tipo === 'promessa' && !('stack' in e)));
});

test('a janela é ouvida na captura (pega script/CSS que não carregou) e o script não esconde o erro do console', () => {
  const h = montar();
  assert.equal(h.ouvintes.error.length, 1);
  assert.equal(h.ouvintes.error[0].captura, true);
  assert.equal(h.ouvintes.unhandledrejection.length, 1);
  let impedidos = 0;
  const ev = { message: 'm', preventDefault() { impedidos++; } };
  h.disparar('error', ev);
  h.disparar('unhandledrejection', { reason: 'r', preventDefault() { impedidos++; } });
  assert.equal(impedidos, 0, 'o erro continua aparecendo no console como sempre');
});

test('script e CSS que não carregaram viram erro; imagem e outras coisas ficam de fora', () => {
  const h = montar();
  h.disparar('error', { target: { tagName: 'SCRIPT', src: 'file:///C:/app/vendor/xterm.js' } });
  h.disparar('error', { target: { tagName: 'LINK', rel: 'stylesheet', href: 'file:///C:/app/style.css' } });
  h.disparar('error', { target: { tagName: 'IMG', src: 'file:///C:/app/avatar.png' } });
  h.disparar('error', { target: { tagName: 'LINK', rel: 'icon', href: '../assets/icon.svg' } });
  assert.equal(h.enviados.length, 2);
  assert.deepEqual(plano(h.enviados[0]), { tipo: 'erro', msg: 'Falha ao carregar script file:///C:/app/vendor/xterm.js' });
  assert.deepEqual(plano(h.enviados[1]), { tipo: 'erro', msg: 'Falha ao carregar link file:///C:/app/style.css' });
});

/* ---------- console.error ---------- */
test('console.error("a", {b:1}) chama o console.error ORIGINAL e manda tipo console', () => {
  const h = montar();
  const objeto = { b: 1 };
  const volta = h.consoleFalso.error('a', objeto);
  assert.equal(volta, undefined);
  assert.equal(h.originais.length, 1, 'o original foi chamado uma vez');
  assert.deepEqual(h.originais[0].args, ['a', objeto]);
  assert.equal(h.originais[0].args[1], objeto, 'com os MESMOS argumentos, sem cópia');
  assert.equal(h.originais[0].este, h.consoleFalso, 'e com o this de console');
  assert.equal(h.enviados.length, 1);
  assert.deepEqual(plano(h.enviados[0]), { tipo: 'console', msg: 'a {"b":1}' });
  assert.notEqual(h.consoleFalso.error, h.erroOriginal, 'o console.error foi trocado por um que também registra');
});

test('console.error com Error leva a mensagem e a stack; vários argumentos viram uma frase só', () => {
  const h = montar();
  const e = new Error('boom');
  h.consoleFalso.error('evento', 'text-delta', e);
  h.consoleFalso.error(404, true, null, undefined, 10n);
  assert.equal(h.enviados[0].msg, 'evento text-delta boom');
  assert.equal(h.enviados[0].stack, e.stack);
  assert.equal(h.enviados[1].msg, '404 true null undefined 10');
  assert.equal('stack' in h.enviados[1], false);
  h.consoleFalso.error();
  assert.equal(h.enviados[2].msg, '');
  h.consoleFalso.error(new Error(''));
  assert.equal(h.enviados[3].msg, 'Error', 'erro sem mensagem usa o nome');
  assert.equal(h.originais.length, 4);
});

test('console.error chamado "solto" (const e = console.error; e(...)) ainda roda o original com o console como this', () => {
  const h = montar();
  const solto = h.consoleFalso.error;
  solto('sem o objeto na frente');
  assert.equal(h.originais.length, 1);
  assert.equal(h.originais[0].este, h.consoleFalso);
  assert.equal(h.enviados.length, 1);
});

test('console.error com objeto circular, getter que lança ou objeto gigante não quebra e ainda registra', () => {
  const h = montar();
  const circular = { nome: 'c' }; circular.eu = circular;
  const hostil = { get message() { throw new Error('getter'); } };
  const grande = {}; for (let i = 0; i < 5000; i++) grande['k' + i] = { v: i };
  assert.doesNotThrow(() => h.consoleFalso.error('c', circular));
  assert.doesNotThrow(() => h.consoleFalso.error('h', hostil));
  assert.doesNotThrow(() => h.consoleFalso.error('g', grande));
  assert.equal(h.originais.length, 3, 'o console.error original foi chamado nas três');
  assert.equal(h.enviados.length, 3);
  assert.equal(h.enviados[0].msg, 'c [object Object]');
  assert.ok(h.enviados.every((e) => e.msg.length <= 2000));
  assert.ok(h.enviados[2].msg.length < 600, 'objeto grande vira texto curto (até 500 letras)');
});

test('objeto vira JSON de no máximo 500 letras, no console.error e na promessa rejeitada', () => {
  const h = montar();
  h.consoleFalso.error('lista', { itens: 'y'.repeat(5000) });
  h.disparar('unhandledrejection', { reason: { detalhe: 'z'.repeat(5000) } });
  const [c, p] = h.enviados.map((e) => e.msg);
  assert.ok(c.startsWith('lista {"itens":"yyy'), c.slice(0, 30));
  assert.ok(c.length <= 'lista '.length + 500, 'console.error: ' + c.length);
  assert.ok(p.startsWith('{"detalhe":"zzz'), p.slice(0, 30));
  assert.ok(p.length <= 500, 'promessa: ' + p.length);
});

test('um console.error disparado de dentro do logTela não entra em laço', () => {
  const h = montar({ api: 'sem' });
  const chamadas = [];
  // (o "< 30" só impede que um laço de verdade trave o teste; com a trava, nunca chega perto)
  h.janela.api = { logTela: (e) => { chamadas.push(e); if (chamadas.length < 30) h.consoleFalso.error('ruído de dentro do logTela'); } };
  h.consoleFalso.error('de fora');
  assert.equal(chamadas.length, 1, 'só o de fora foi registrado');
  assert.equal(chamadas[0].msg, 'de fora');
  assert.equal(h.originais.length, 2, 'mas os dois chegaram no console de verdade');
  // e depois de um laço evitado, o próximo console.error volta a ser registrado
  h.consoleFalso.error('de novo, de fora');
  assert.equal(chamadas.length, 2);
});

test('o mesmo vale para um evento disparado de dentro do logTela', () => {
  const h = montar({ api: 'sem' });
  const chamadas = [];
  h.janela.api = { logTela: (e) => {
    chamadas.push(e);
    if (chamadas.length < 30) { h.disparar('error', { message: 'erro de dentro' }); h.disparar('unhandledrejection', { reason: 'de dentro' }); }
  } };
  h.disparar('error', { message: 'erro de fora' });
  assert.equal(chamadas.length, 1);
});

/* ---------- sem ponte, ponte ruim ---------- */
test('sem window.api (prévia de QA) nada quebra e o console.error original continua funcionando', () => {
  const h = montar({ api: 'sem' });
  assert.equal('api' in h.janela, false);
  assert.doesNotThrow(() => h.consoleFalso.error('sem ponte', { x: 1 }));
  assert.doesNotThrow(() => h.disparar('error', { message: 'm' }));
  assert.doesNotThrow(() => h.disparar('unhandledrejection', { reason: new Error('r') }));
  assert.equal(h.originais.length, 1);
  assert.deepEqual(h.originais[0].args, ['sem ponte', { x: 1 }]);
});

test('window.api sem logTela (ou com logTela que não é função) também não quebra', () => {
  for (const api of [{}, { logTela: 'x' }, { logTela: null }, null]) {
    const h = montar({ api });
    assert.doesNotThrow(() => h.consoleFalso.error('x'));
    assert.doesNotThrow(() => h.disparar('error', { message: 'm' }));
    assert.equal(h.originais.length, 1);
  }
});

test('window.api que aparece depois do script (a ponte é procurada a cada envio) passa a receber', () => {
  const h = montar({ api: 'sem' });
  h.consoleFalso.error('antes da ponte');
  const recebidos = [];
  h.janela.api = { logTela: (e) => recebidos.push(e) };
  h.consoleFalso.error('depois da ponte');
  assert.deepEqual(recebidos.map((e) => e.msg), ['depois da ponte']);
});

test('logTela que lança não derruba o console.error nem os eventos', () => {
  const h = montar({ api: { logTela() { throw new Error('ponte quebrada'); } } });
  assert.doesNotThrow(() => h.consoleFalso.error('x'));
  assert.doesNotThrow(() => h.disparar('error', { message: 'm' }));
  assert.doesNotThrow(() => h.disparar('unhandledrejection', { reason: 'r' }));
  assert.equal(h.originais.length, 1);
});

test('logTela que devolve promessa rejeitada não vira outro unhandledrejection', async () => {
  const visto = [];
  const aoVer = (m) => visto.push(m);
  process.on('unhandledRejection', aoVer);
  try {
    const h = montar({ api: { logTela: () => Promise.reject(new Error('a ponte recusou')) } });
    h.consoleFalso.error('x');
    h.disparar('error', { message: 'm' });
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(visto, []);
  } finally { process.removeListener('unhandledRejection', aoVer); }
});

test('console.error original que lança continua lançando, e mesmo assim fica registrado', () => {
  const gravados = [];
  const janela = { addEventListener() {}, api: { logTela: (e) => gravados.push(e) } };
  const ctx = vm.createContext({ window: janela, console: { error() { throw new Error('console quebrado'); } } });
  vm.runInContext(FONTE, ctx);
  assert.throws(() => ctx.console.error('x'), /console quebrado/);
  assert.equal(gravados.length, 1);
  assert.equal(gravados[0].msg, 'x');
});

/* ---------- limites ---------- */
test('msg e stack grandes saem cortados (2.000 e 4.000) para não entupir o canal', () => {
  const h = montar();
  const e = new Error('m'); e.stack = 's'.repeat(9000);
  h.consoleFalso.error('a'.repeat(5000), e);
  h.disparar('error', { message: 'b'.repeat(5000), filename: 'f'.repeat(2000), lineno: 1, colno: 1, error: e });
  h.disparar('unhandledrejection', { reason: e });
  for (const m of h.enviados) {
    assert.ok(m.msg.length <= 2000, 'msg ' + m.msg.length);
    if (m.stack) assert.ok(m.stack.length <= 4000, 'stack ' + m.stack.length);
    if (m.fonte) assert.ok(m.fonte.length <= 500);
  }
  assert.equal(h.enviados.length, 3);
});

/* ---------- instalação ---------- */
test('carregar o script duas vezes não registra tudo em dobro', () => {
  const h = montar();
  vm.runInContext(FONTE, h.ctx);
  assert.equal(h.ouvintes.error.length, 1);
  assert.equal(h.ouvintes.unhandledrejection.length, 1);
  h.consoleFalso.error('uma vez só');
  assert.equal(h.enviados.length, 1);
  assert.equal(h.originais.length, 1);
});

test('o script não vaza nada global além de uma marca na window', () => {
  const h = montar();
  assert.deepEqual(Object.keys(h.ctx).sort(), ['console', 'window']);
  assert.deepEqual(Object.keys(h.janela).filter((k) => !['addEventListener', 'api'].includes(k)), ['__cockpitLogTela']);
});

test('sem addEventListener (ambiente estranho) o script não lança', () => {
  const ctx = vm.createContext({ window: {}, console: { error() {} } });
  assert.doesNotThrow(() => vm.runInContext(FONTE, ctx));
  const ctx2 = vm.createContext({});
  assert.doesNotThrow(() => vm.runInContext(FONTE, ctx2));
});

test('em modo estrito e sem dependências: não usa require, module, process nem import', () => {
  assert.doesNotMatch(FONTE, /\brequire\s*\(|\bmodule\.exports\b|\bprocess\.|\bimport\s/);
  assert.match(FONTE, /^\s*\/\*[\s\S]*?\*\/\s*\(function \(\) \{\s*'use strict';/);
});
