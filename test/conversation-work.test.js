'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const work=require('../src/renderer/conversation-work.js');
const vm=require('node:vm');
const {lerFonte,pegarBloco}=require('../testes/raiz');
function rendererClock(){
  let now=0;const cfg={};const ctx=vm.createContext({window:{CockpitWork:work},cfg,performance:{now:()=>now},remotoDoPane:p=>p.remote||null,Map});
  const source=lerFonte('renderer','app.js');
  for(const name of ['chaveTempoTrabalho','guardarMedicaoTempo','restaurarTempoTrabalho','pintarTempoTrabalho','sincronizarTempoTrabalho','salvarTempoTrabalho'])vm.runInContext(pegarBloco(source,'function '+name+'('),ctx);
  return{ctx,cfg,advance:ms=>now+=ms};
}
test('tempo soma turnos observados e exclui o intervalo parado',()=>{
  const c=work.create();work.update(c,true,0);work.update(c,false,1200);work.update(c,false,120000);work.update(c,true,180000);work.update(c,false,181500);
  assert.deepEqual(work.snapshot(c),{ms:2700});
});
test('reabrir recupera somente a duração medida, nunca tempo offline',()=>{
  const c=work.create({ms:2500,at:100,running:true});work.update(c,false,600000);assert.equal(c.ms,2500);work.update(c,true,700000);work.update(c,false,701000);assert.equal(c.ms,3500);
});
test('contador ignora dado inválido e relógio que recua',()=>{
  const c=work.create({ms:Infinity});work.update(c,true,100);work.update(c,true,50);assert.equal(c.ms,0);assert.deepEqual(work.snapshot(work.create({ms:-2})),{ms:0});
});
test('permissão, pergunta bloqueante, plano, inicialização e ociosidade pausam',()=>{
  for(const extra of [{busy:false},{pedindoPerm:true},{filaPerm:[{}]},{filaPerg:[{}]},{perguntaAberta:{}},{planoPendente:{}},{ligando:true},{_religar:{}},{morto:true}])assert.equal(work.active({busy:true,...extra}),false,JSON.stringify(extra));
  assert.equal(work.active({busy:true,filaPerg:[{bloqueante:false}],perguntaAberta:{bloqueante:false}}),true);
});
test('robôs/agentes em paralelo contam tempo decorrido uma vez só',()=>{
  const p={busy:false,robos:new Map([['a',{}],['b',{}]])},c=work.create();work.update(c,work.active(p),0);work.update(c,work.active(p),5000);assert.equal(c.ms,5000);
  assert.equal(work.active({busy:false,agentesTrabalho:new Map([['a',{state:'running'}]])}),true);
  assert.equal(work.active({busy:false,agentesTrabalho:new Map([['a',{state:'idle'}]])}),false);
});
test('workflow respeita dono, motor, pai/thread e estado real, sem duplicar robô',()=>{
  const p={id:'p1',engine:'codex',robos:new Map([['a',{desc:'duplicado'}],['shell',{desc:'Comando ativo'}]])};
  const g=work.graph(p,[{id:'a',threadId:'ta',paneId:'p1',engine:'codex',task:'Pesquisa',state:'running'},{id:'b',parentId:'ta',paneId:'p1',engine:'codex',task:'Revisão',state:'completed'},{id:'x',paneId:'p2',engine:'codex'},{id:'y',paneId:'p1',engine:'claude'}]);
  assert.equal(g.length,3);assert.equal(g.find(x=>x.id==='b').parent,'a');assert.equal(g.find(x=>x.id==='b').state,'completed');assert.equal(g.filter(x=>x.title==='duplicado').length,0);
});
test('workflow mantém agentes com vínculo ausente ou cíclico sem criar setas falsas',()=>{
  const base={paneId:'p',engine:'claude'};
  const g=work.graph({id:'p',engine:'claude'},[{...base,id:'a',parentId:'b'},{...base,id:'b',parentId:'a'},{...base,id:'c',parentId:'ausente'}]);
  assert.equal(g.length,3);assert.equal(g.find(x=>x.id==='c').parent,null);assert.ok(g.find(x=>x.id==='a').parent===null||g.find(x=>x.id==='b').parent===null);
});
test('renderer: estado salvo não cresce enquanto app está fechado e ledger preserva histórico',()=>{
  const h=rendererClock(),p={engine:'claude',sessaoId:'sessao1',busy:true};h.ctx.restaurarTempoTrabalho(p);h.ctx.sincronizarTempoTrabalho(p);h.advance(4000);const saved=h.ctx.salvarTempoTrabalho(p);h.advance(800000);
  const reopened={engine:'claude',resumeId:'sessao1',busy:false};h.ctx.restaurarTempoTrabalho(reopened,saved);h.ctx.sincronizarTempoTrabalho(reopened);assert.equal(reopened._tempoTrabalho.ms,4000);
  reopened.resumeId='sessao2';h.ctx.sincronizarTempoTrabalho(reopened);assert.equal(reopened._tempoTrabalho.ms,0);reopened.resumeId='sessao1';h.ctx.sincronizarTempoTrabalho(reopened);assert.equal(reopened._tempoTrabalho.ms,4000);
});
test('renderer: ramo pendente não herda tempo do pai e mantém medida ao receber ID próprio',()=>{
  const h=rendererClock();const parent={engine:'claude',sessaoId:'pai'};h.ctx.restaurarTempoTrabalho(parent,{ms:50000});h.ctx.salvarTempoTrabalho(parent);
  const branch={engine:'claude',resumeId:'pai',forkPendente:true,busy:true};h.ctx.restaurarTempoTrabalho(branch,{ms:0});assert.equal(branch._tempoTrabalho.ms,0);h.ctx.sincronizarTempoTrabalho(branch);h.advance(2000);branch.sessaoId='filho';branch.resumeId=null;branch.forkPendente=false;h.ctx.sincronizarTempoTrabalho(branch);assert.equal(branch._tempoTrabalho.ms,2000);assert.equal(h.cfg.temposTrabalho[JSON.stringify(['claude:local','pai'])].ms,50000);
});
test('renderer: fechar painel em trabalho salva o último intervalo antes de removê-lo',async()=>{
  const h=rendererClock(),p={id:'fechando',engine:'codex',sessaoId:'sessao-fechando',busy:true,el:{remove(){},style:{}}};
  const other={id:'outro',el:{style:{}}};
  h.ctx.window.api={paneStop:async()=>true};
  Object.assign(h.ctx,{panes:new Map([[p.id,p],[other.id,other]]),acharPainel:()=>p,$:()=>null,
    clearInterval(){},clearTimeout(){},pararIrProFim(){},soltarNavArquivos(){},soltarPendente(){},matarTerminaisDoPainel(){},montarColunas(){},savePanes(){},sincronizarPendencias(){},quadro:null,focusPane:other});
  vm.runInContext(pegarBloco(lerFonte('renderer','app.js'),'async function closePane('),h.ctx);
  h.ctx.restaurarTempoTrabalho(p,{ms:5000});h.ctx.sincronizarTempoTrabalho(p);h.advance(1500);
  await h.ctx.closePane(p.id);
  assert.equal(h.ctx.panes.has(p.id),false);
  assert.equal(h.cfg.temposTrabalho?.[JSON.stringify(['codex:local','sessao-fechando'])]?.ms,6500);
});
