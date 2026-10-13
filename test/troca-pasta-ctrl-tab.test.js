'use strict';
// Pedido de 29/09: troca direta, na ordem da faixa, inclusive após arrastar.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const ui = fs.readFileSync(require('node:path').join(__dirname,'../src/renderer/cockpit-ui.js'),'utf8');
const extract = name => { const start=ui.indexOf('  function '+name+'('); return ui.slice(start,ui.indexOf('\n  }',start)+4); };
function setup() {
  const tabs = [{id:'pc'},{id:'vps'},{id:'cliente'},{id:'financeiro'}], calls = [];
  const c = {tabs, calls, active:'pc',trocandoAba:false,abaIndoPara:null,abaPendente:null,
    layers:[],quadro:null,modal:false,dialogoAberto:()=>c.modal,q:()=>null,
    abasLocais:()=>tabs,abaAtual:()=>tabs.find(t=>t.id===c.active),abaPorId:id=>tabs.find(t=>t.id===id),
    trocarAbaLocal:id=>{calls.push(id);if(c.trocandoAba)c.abaPendente=id;else c.active=id;},
    stopEvent:e=>{e.prevented=true;},};
  vm.runInNewContext(['pastaEfetiva','podeTrocarPasta','pularPasta','teclaTrocaPasta'].map(extract).join('\n'),c);
  const key = overrides => {const e={key:'Tab',shiftKey:true,ctrlKey:false,altKey:false,metaKey:false,...overrides};c.teclaTrocaPasta(e);return e;};
  return {c,key};
}
test('Shift+Tab percorre PC → VPS → cliente → financeiro → PC no keydown', () => {
  const {c,key}=setup(); for(let i=0;i<5;i++)assert.equal(key().prevented,true);
  assert.deepEqual(c.calls,['vps','cliente','financeiro','pc','vps']);
});
test('reordenar a faixa muda a ordem na próxima tecla, sem lista por uso recente', () => {
  const {c,key}=setup(); c.active='financeiro'; key(); assert.equal(c.active,'pc');
  c.tabs.splice(0,4,{id:'cliente'},{id:'pc'},{id:'financeiro'},{id:'vps'});
  key(); assert.equal(c.active,'financeiro'); key(); assert.equal(c.active,'vps');
});
test('Ctrl+Tab segue a mesma faixa e Ctrl+Shift+Tab volta com a volta nas pontas', () => {
  const {c,key}=setup(); key({ctrlKey:true,shiftKey:false}); assert.equal(c.active,'vps');
  key({ctrlKey:true}); assert.equal(c.active,'pc'); key({ctrlKey:true}); assert.equal(c.active,'financeiro');
});
test('teclas rápidas avançam do destino pendente da animação', () => {
  const {c,key}=setup(); c.trocandoAba=true; c.abaIndoPara='vps';
  key(); key(); key(); assert.deepEqual(c.calls,['cliente','financeiro','pc']);
});
test('popup mantém Shift+Tab para o foco; camada lateral não impede trocar pasta', () => {
  const {c,key}=setup(); c.layers=[{}]; assert.equal(key().prevented,undefined); assert.equal(c.calls.length,0);
  c.layers=[{naoModal:true}]; key(); assert.equal(c.active,'vps');
  c.modal=true; assert.equal(key().prevented,undefined); assert.equal(c.calls.length,1);
});
test('Tab normal, outras combinações e composição de texto não mudam pasta', () => {
  const {c,key}=setup(); for(const flags of [{shiftKey:false},{altKey:true},{metaKey:true},{isComposing:true},{key:'Enter'}])
    assert.equal(key(flags).prevented,undefined);
  assert.equal(c.calls.length,0); c.tabs.splice(1); key(); assert.equal(c.calls.length,0);
});
// Leva 4, onda 3 (revisao T8): o menu + ou / e' um .p-modal aberto; com o foco nos itens, Shift+Tab volta pelos itens
test('menu + ou / aberto (.p-modal sem .hidden) guarda Shift+Tab e Ctrl+Tab; fechado, volta a trocar de pasta', () => {
  const {c,key}=setup();
  const janelinha = {classList:{contains:()=>false}};   // o .p-modal do painel, aberto como menu (sem .hidden)
  c.q = s => (/\.p-modal/.test(s) ? janelinha : null);
  assert.equal(key().prevented,undefined); assert.equal(c.calls.length,0,'Shift+Tab no menu nao troca de pasta');
  assert.equal(key({ctrlKey:true,shiftKey:false}).prevented,undefined); assert.equal(c.calls.length,0);
  c.q = () => null;   // o menu fechou
  assert.equal(key().prevented,true); assert.deepEqual(c.calls,['vps']);
});
// Leva 5 (R4-04): com o foco dentro do visor de arquivo, Shift+Tab e Ctrl+Tab ficam com o visor (o laço de foco dele)
test('visor com o foco dentro guarda Shift+Tab e Ctrl+Tab; com o foco fora, volta a trocar de pasta (R4-04)', () => {
  const {c,key}=setup();
  const visor = {classList:{contains:()=>false}};
  c.q = s => (/\.p-visor:focus-within/.test(s) ? visor : null);
  assert.equal(key().prevented,undefined,'Shift+Tab no visor trocou de pasta'); assert.equal(key({ctrlKey:true,shiftKey:false}).prevented,undefined);
  assert.equal(c.calls.length,0,'trocas de pasta com o foco no visor: '+c.calls.length);
  c.q = () => null;   // o foco saiu do visor (ou ele fechou)
  assert.equal(key().prevented,true); assert.deepEqual(c.calls,['vps']);
});
