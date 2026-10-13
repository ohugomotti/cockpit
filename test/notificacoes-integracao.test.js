'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
function section(start, end) {
  const at = source.indexOf(start);
  assert.notEqual(at, -1);
  const stop = source.indexOf(end, at);
  assert.ok(stop > at);
  return source.slice(at, stop);
}
function notices() {
  const sent = [];
  const context = vm.createContext({
    window: { VisualMac: { notify: value => { sent.push(value); return true; } } },
    quadro: null, nomeDoMotor: name => name,
    $() { throw new Error('Uma notificação centralizada não deve criar faixa no DOM.'); },
  });
  vm.runInContext(section('const avisosFechados = new Map();', '/* ---- ONDE mora a conta'), context);
  return { context, sent };
}
test('aviso global entra na Ilha sem criar faixa, conservando ação e erro', async () => {
  const { context, sent } = notices();
  let calls = 0;
  context.mostrarAviso({ id: 'conta', texto: '<script>texto literal</script>', tipo: 'erro', fixo: true,
    acao: 'Tentar', aoClicar: async () => { calls++; return false; } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].message, '<script>texto literal</script>');
  assert.equal(sent[0].level, 'error');
  assert.equal(sent[0].persistent, true);
  assert.equal(await sent[0].action.run(), false);
  assert.equal(calls, 1);
});
test('aviso dispensado só retorna quando piora ou vira a janela de uso', async () => {
  const { context, sent } = notices();
  const aviso = { id: 'limite', texto: 'Uso alto', tipo: 'alerta', nivel: 95, reseta: 1000 };
  context.mostrarAviso(aviso);
  await sent[0].onDismiss();
  context.mostrarAviso(aviso);
  context.mostrarAviso({ ...aviso, nivel: 90 });
  assert.equal(sent.length, 1);
  context.mostrarAviso({ ...aviso, nivel: 100 });
  assert.equal(sent.length, 2);
  await sent[1].onDismiss();
  context.mostrarAviso({ ...aviso, reseta: 2000 });
  assert.equal(sent.length, 3);
});
test('falha ao descartar inbox não silencia nem remove o aviso', async () => {
  const { context, sent } = notices();
  const aviso = { id: 'inbox', texto: 'Celular', rotuloFechar: 'Descartar arquivo',
    aoFechar: async () => ({ error: 'Arquivo em uso' }) };
  context.mostrarAviso(aviso);
  await assert.rejects(sent[0].onDismiss(), /Arquivo em uso/);
  context.mostrarAviso(aviso);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].dismissLabel, 'Descartar arquivo');
});
test('resolver condição limpa a dispensa para uma nova ocorrência', async () => {
  const { context, sent } = notices();
  const aviso = { id: 'login-pc-claude', texto: 'Entre novamente' };
  context.mostrarAviso(aviso);
  await sent[0].onDismiss();
  context.resolverAviso(aviso.id);
  context.mostrarAviso(aviso);
  assert.equal(sent.length, 2);
});
test('nova ocorrência do mesmo aviso dispensado volta sem depender do texto', async () => {
  const { context, sent } = notices();
  const aviso = { id: 'pergunta-igual', texto: 'Pode continuar?', occurrence: 'pergunta-1' };
  context.mostrarAviso(aviso); await sent[0].onDismiss(); context.mostrarAviso(aviso);
  assert.equal(sent.length, 1);
  context.mostrarAviso({ ...aviso, occurrence: 'pergunta-2' });
  assert.equal(sent.length, 2); assert.equal(sent[1].occurrence, 'pergunta-2');
});
test('produtor do painel separa perguntas iguais por identidade e silencia replay e notificação nativa', () => {
  const sent = [], native = [];
  const context = vm.createContext({ document: { hidden: true }, painelVisivel: () => false,
    nomeDoMotor: name => name, Notification: class { constructor(title, options) { native.push(options); } },
    window: { VisualMac: { notify: value => { sent.push(value); return true; } } } });
  vm.runInContext(section('function avisarPainel(', 'async function abrirPainelDoAviso('), context);
  const pane = { id: 'p1', engine: 'claude', titulo: 'Plano' };
  context.avisarPainel(pane, 'está perguntando', {kind:'pergunta',id:'q1'});
  context.avisarPainel(pane, 'está perguntando', {kind:'pergunta',id:'q2'});
  context.avisarPainel(pane, 'está perguntando', {kind:'pergunta',id:'q2',replay:true});
  assert.notEqual(sent[0].occurrence, sent[1].occurrence); assert.equal(sent[1].occurrence, sent[2].occurrence);
  assert.equal(sent[0].attention, true);assert.equal(sent[2].replay,true);
  assert.equal(native.length,2);assert.ok(native.every(options=>options.silent===true));
});
test('inbox conserva cartão por arquivo e encaminha replay/ocorrência sem remover e reinserir', () => {
  const sent=[];const context=vm.createContext({window:{VisualMac:{resolveNotifications:()=>{throw Error('não deve resolver replay');}}},
    document:{querySelectorAll:()=>[],querySelector:()=>null},CSS:{escape:text=>text},mostrarAviso:value=>sent.push(value)});
  vm.runInContext(section('function chegouNaInbox(', 'async function usarDaInbox('),context);
  const item={arquivo:'C:/inbox/voz.txt',nome:'voz.txt',tipo:'texto',texto:'Teste',occurrence:'voz:123:10',replay:true};
  context.chegouNaInbox(item);context.chegouNaInbox({...item,replay:false});context.chegouNaInbox({...item,occurrence:'voz:456:10',replay:false});
  assert.equal(new Set(sent.map(value=>value.id)).size,1);assert.equal(sent[0].replay,true);assert.equal(sent[1].replay,false);
  assert.equal(sent[0].occurrence,sent[1].occurrence);assert.notEqual(sent[1].occurrence,sent[2].occurrence);
});
function inbox(result, hasPane = true) {
  const actions = [], pane = { id: 'p1', anexos: [] };
  const context = vm.createContext({
    focusPane: hasPane ? pane : null, panes: new Map(),
    window: { api: { inboxConsumir: async () => { actions.push('consume'); return result; } } },
    mostrarAviso: value => actions.push(value.texto),
    inserirNoInput: (p, text) => actions.push(['input', p.id, text]),
    $: () => ({ focus() {} }), note: () => {}, anexar: async () => actions.push('attach'),
  });
  vm.runInContext(section('async function usarDaInbox(', '/* ===================== QUADRO BRANCO'), context);
  return { context, actions };
}
test('Usar da inbox sem painel não consome o arquivo nem descarta notificação', async () => {
  const f = inbox({ ok: true }, false);
  assert.equal(await f.context.usarDaInbox({ tipo: 'texto', texto: 'Olá' }), false);
  assert.equal(f.actions.includes('consume'), false);
});
test('Usar da inbox com erro mantém aviso e não insere texto duplicado', async () => {
  const f = inbox({ error: 'Indisponível' });
  assert.equal(await f.context.usarDaInbox({ tipo: 'texto', texto: 'Olá' }), false);
  assert.equal(f.actions.some(item => Array.isArray(item)), false);
});
test('Usar da inbox bem-sucedido só preenche campo, sem enviar ao motor', async () => {
  const f = inbox({ ok: true });
  assert.equal(await f.context.usarDaInbox({ tipo: 'texto', texto: 'Olá' }), true);
  assert.deepEqual(f.actions, ['consume', ['input', 'p1', 'Olá']]);
});
test('imagem que falhou ao anexar tenta de novo pelo arquivo já movido', async () => {
  const f = inbox({ ok: true, arquivo: 'colados/imagem.png' });
  const message = { tipo: 'imagem', arquivo: 'inbox/imagem.png' };
  assert.equal(await f.context.usarDaInbox(message), false);
  assert.equal(message.arquivoConsumido, 'colados/imagem.png');
  f.context.anexar = async (p, paths) => p.anexos.push({ path: paths[0] });
  assert.equal(await f.context.usarDaInbox(message), true);
  assert.equal(f.actions.filter(action => action === 'consume').length, 1);
});
