'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/renderer/app.js'),'utf8');
const start=source.indexOf('async function trocarAbaLocal('),end=source.indexOf('/* A lateral segue a aba ativa:',start);
const functionSource=source.slice(start,end);
function harness({restored=false,columns=[4,3,2,1,1,0],remote=true}={}){
  const focus=[],scroll=[],inputs=[],order=[];
  const panels=columns.map((coluna,i)=>({id:'panel-'+i,coluna,el:{id:'element-'+i}}));
  const cfg={abaAtiva:'origem'},destination={id:'destino',tipo:remote?'ssh':'local',paineis:panels.map(p=>({paneId:p.id}))};
  const container={style:{},scrollTo:options=>scroll.push(options)};
  const ctx={cfg,panes:new Map(),trocandoAba:false,abaIndoPara:null,abaPendente:null,abaGen:0,MOTORES:[],histCache:{},verTodasAsConversas:{},
    window:{api:{setConfig(){}}},fecharMenus(){},savePanes(){},guardarPaineisDaAba:async()=>{},porMotor:()=>({}),
    lugarDaContaAtiva:()=>({chave:'pc'}),pintarAbasLocal(){},sincronizarPendencias(){},repintarContaSeMudouDeLugar(){},
    $:(selector,element)=>selector==='#panes'?container:{focus:options=>inputs.push({id:element.id,options})},$$:()=>[],loadHist(){},
    abaAtual:()=>destination,fichaVale:()=>true,
    trazerPaineisDoFundo:()=>{if(restored)return 0;for(const p of panels)ctx.panes.set(p.id,p);return panels.length;},
    restaurarPaineis:async()=>{for(const p of panels)ctx.panes.set(p.id,p);},newPane(){},
    reordenarPaineis:()=>order.push([...ctx.panes.keys()]),devolverOCursor(){},setFocus:p=>focus.push(p.id)};
  vm.runInNewContext(functionSource+'\nthis.change=trocarAbaLocal;',ctx);
  return {ctx,focus,scroll,inputs,order,panels};
}
for(const restored of [false,true])test(`VPS ${restored?'restaurada do histórico':'guardada em memória'} abre pela coluna esquerda, não pela primeira criada`,async()=>{
  const h=harness({restored});await h.ctx.change('destino');
  assert.deepEqual(h.focus,['panel-5']);
  assert.equal(h.inputs[0].options.preventScroll,true);
  assert.equal(h.scroll.at(-1).left,0);assert.equal(h.scroll.at(-1).behavior,'instant');
  assert.deepEqual([...h.ctx.panes.keys()],h.panels.map(p=>p.id),'não reordena sessões, apenas escolhe o foco visual');
});
test('Aba local usa a mesma regra e preserva a ordem dentro da primeira pilha',async()=>{
  const h=harness({columns:[2,0,0,1],remote:false});await h.ctx.change('destino');
  assert.deepEqual(h.focus,['panel-1']);assert.equal(h.scroll.length,1);
});
test('Pedido para a aba já ativa não muda foco nem rolagem escolhidos pelo usuário',async()=>{
  const h=harness();await h.ctx.change('origem');assert.equal(h.focus.length,0);assert.equal(h.scroll.length,0);
});
