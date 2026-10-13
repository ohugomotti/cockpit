'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { lerFonte } = require('../testes/raiz');
const HistoricoLista = require('../src/renderer/historico-lista');
const NomeConversa = require('../src/renderer/nome-conversa');
const source = lerFonte('renderer','app.js');
const queueSource = source.slice(source.indexOf('const filaNomesDoHistorico ='),source.indexOf('function normalizarBuscaHistorico('));
const settle = async () => {for(let i=0;i<80;i++)await Promise.resolve();};

function harness(rows, save = async()=>true) {
  const requests = {history:[],title:[],save:[]}, changes=[];
  const context = {HistoricoLista,NomeConversa,cfg:{tituloAuto:true},histCache:{claude:rows},
    chaveDoLugar:r=>r ? r.usuario+'@'+r.host+':'+(r.porta||22):'local',
    paintHist:(_engine,list)=>changes.push(list.map(s=>s.title)),
    window:{CockpitUI:{refresh(){}},api:{
      sessionHistory:async request=>{requests.history.push(request);return [{role:'user',text:'Revisar painel de clientes'},{role:'bot',text:'Painel revisado'}];},
      tituloAuto:async request=>{requests.title.push(request);return {acao:'nome',titulo:request.conversa.remoto?'Revisão servidor remoto':'Revisão projeto local'};},
      renomear:async request=>{requests.save.push(request);return save(request);},
    }},
  };
  vm.runInNewContext(queueSource+'\nthis.queue=filaNomesDoHistorico;',context);
  return {context,requests,changes,queue:context.queue};
}

test('fila unificada: mesmo ID local/remoto tem revisão e salvamento separados, sem trocar cache de origem',async()=>{
  const remote={id:'same',engine:'claude',title:'Antes',revisarNome:true,remotoDestino:{host:'vps-a',usuario:'qa',porta:2222}};
  const local={id:'same',engine:'claude',title:'Antes',revisarNome:true};
  const h=harness([remote]);h.queue.adicionar([local,remote]);await settle();
  assert.equal(h.requests.title.length,2);
  assert.notEqual(h.requests.title[0].chave,h.requests.title[1].chave);
  assert.equal(h.requests.history[0].remoto,null);
  assert.equal(h.requests.history[1].remoto.host,'vps-a');
  assert.equal(h.requests.title[1].conversa.remoto.porta,2222);
  assert.equal(h.requests.save[1].remoto.host,'vps-a');
  assert.equal(h.requests.save[1].auto,true);
  assert.equal(h.context.histCache.claude[0].title,'Revisão servidor remoto');
  assert.equal(h.changes.length,1,'retorno local não altera a ficha remota');
  h.queue.adicionar([local,remote]);await settle();assert.equal(h.requests.title.length,2);
});

test('fila unificada: nome manual criado durante a revisão prevalece na tela e no backend',async()=>{
  const row={id:'manual',engine:'claude',title:'Antes',revisarNome:true};
  const h=harness([row],async()=>({manual:true,nome:'Nome escolhido pelo usuário'}));
  h.queue.adicionar([row]);await settle();
  assert.equal(row.title,'Nome escolhido pelo usuário');assert.equal(row.nome,row.title);
  assert.equal(row.tituloAuto,false);assert.equal(row.revisarNome,false);
});

test('fila unificada: falha ao salvar não muda título e permite nova tentativa',async()=>{
  let saved=false;
  const row={id:'retry',engine:'claude',title:'Antes',revisarNome:true};
  const h=harness([row],async()=>saved);
  h.queue.adicionar([row]);await settle();assert.equal(row.title,'Antes');assert.equal(h.changes.length,0);
  saved=true;h.queue.adicionar([row]);await settle();assert.equal(row.title,'Revisão projeto local');
  assert.equal(h.requests.save.length,2);
});

test('fila unificada: desativar nomes automáticos enquanto aguarda impede salvar e alterar a tela',async()=>{
  const row={id:'off',engine:'claude',title:'Antes',revisarNome:true};
  const h=harness([row]);let resolve;
  h.context.window.api.tituloAuto=()=>new Promise(done=>{resolve=done;});
  h.queue.adicionar([row]);await settle();h.context.cfg.tituloAuto=false;
  resolve({acao:'nome',titulo:'Título novo'});await settle();
  assert.equal(h.requests.save.length,0);assert.equal(row.title,'Antes');
});
