'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {Rpc}=require('../src/cockpit-remote-transport'),{createRemote}=require('../src/cockpit-remote');
function procFake(command='') {
 const p=new EventEmitter();p.stdout=new EventEmitter();p.stderr=new EventEmitter();p.stdin=new EventEmitter();p.sent=[];p.kill=()=>{};
 p.answer=(id,result)=>p.stdout.emit('data',Buffer.from(JSON.stringify({id,result})+'\n'));
 p.stdin.write=line=>{const m=JSON.parse(line);p.sent.push(m);queueMicrotask(()=>{
  if(m.method==='initialize')p.answer(m.id,{agentCapabilities:{}});
  else if(m.method==='thread/start')p.answer(m.id,{thread:{id:'t'}});
  else if(m.method==='session/new')p.answer(m.id,{sessionId:'s'});
  else if(m.id&&m.method)p.answer(m.id,{});
 });};return p;
}
test('RPC discards non-object JSON and still answers an interleaved request',async()=>{
 const p=procFake(),rpc=new Rpc(p);try{const result=rpc.request('read',{});result.catch(()=>{});p.stdout.emit('data',Buffer.from('null\n[]\n42\n"bad"\n'));assert.deepEqual(await result,{});}finally{rpc.close();}
});
for(const engine of ['codex','acp'])test('Remote '+engine+' closes only its destination pending approvals and questions',async()=>{
 const processes=[],events=[];
 const manager=createRemote({transport:{run:async()=>'/tmp\n',spawn:(remote,command)=>{const p=procFake(command);processes.push({remote,p});return p;},kill:p=>p.kill()},emit:(paneId,kind,data)=>events.push({paneId,kind,...data})});
 try{
  const a={usuario:'fake',host:'a.example',chave:'fixture'},b={...a,host:'b.example'};
  await manager.start('a',{engine,remoto:a,model:'gemini --acp'});await manager.start('b',{engine,remoto:b,model:'gemini --acp'});
  for(const {p}of processes){p.stdout.emit('data',Buffer.from(JSON.stringify({id:100,method:engine==='codex'?'item/commandExecution/requestApproval':'session/request_permission',params:{threadId:'t',toolCall:{toolCallId:'tool'},options:[]}})+'\n'));
   if(engine==='codex')p.stdout.emit('data',Buffer.from(JSON.stringify({id:101,method:'item/tool/requestUserInput',params:{threadId:'t',questions:[{id:'q',question:'Question',options:[]}]}})+'\n'));
  }
  const cardA=events.find(e=>e.kind==='approval'&&e.paneId==='a'),cardB=events.find(e=>e.kind==='approval'&&e.paneId==='b');
  processes[0].p.emit('close',1);
  assert.equal(manager.approvalOwns(cardA.key),false);assert.equal(manager.approvalOwns(cardB.key),true);
  assert.ok(events.some(e=>e.kind==='permissao-cancelada'&&e.key===cardA.key));
  if(engine==='codex'){const qa=events.find(e=>e.kind==='pergunta'&&e.paneId==='a'),qb=events.find(e=>e.kind==='pergunta'&&e.paneId==='b');assert.equal(manager.questionOwns(qa.id),false);assert.equal(manager.questionOwns(qb.id),true);}
 }finally{await manager.close();}
});
test('Remote CLI ignores non-object JSON before normal completion',async()=>{
 let p;const events=[];const manager=createRemote({transport:{run:async()=>'',upload:async()=>({paths:[],cleanup:async()=>{}}),spawn:()=>{p=procFake();p.stdin.end=()=>{};return p;},kill:p=>p.kill()},emit:(paneId,kind,data)=>events.push({paneId,kind,...data}),cliArgs:()=>[],cliEvent(){},cliFlush(){}});
 try{await manager.start('p',{engine:'grok',remoto:{usuario:'fake',host:'a.example',chave:'fixture'}});await manager.send('p','fixture');p.stdout.emit('data',Buffer.from('null\n[]\n42\n'));p.emit('close',0);assert.ok(events.some(e=>e.kind==='turn-end'&&e.status==='completed'));}finally{await manager.close();}
});


test('Codex SSH mantém pedido ativo nas retentativas e mostra erro terminal somente uma vez', async () => {
 let p; const events=[];
 const manager=createRemote({transport:{run:async()=>'/tmp\n',spawn:()=>{p=procFake();return p;},kill:p=>p.kill()},emit:(paneId,kind,data)=>events.push({paneId,kind,...data})});
 const notify=(method,params)=>p.stdout.emit('data',Buffer.from(JSON.stringify({method,params:{threadId:'t',...params}})+'\n'));
 try {
  await manager.start('p',{engine:'codex',remoto:{usuario:'fake',host:'a.example',chave:'fixture'}});
  notify('turn/started',{turn:{id:'r'}});
  p.stdout.emit('data',Buffer.from(JSON.stringify({id:99,method:'item/commandExecution/requestApproval',params:{threadId:'t',command:'pwd'}})+'\n'));
  const card=events.find(e=>e.kind==='approval'); const error={message:'Servidor fechou a conexão'};
  for(let i=0;i<3;i++) notify('error',{turnId:'r',willRetry:true,error});
  assert.equal(manager.approvalOwns(card.key),true);
  assert.equal(events.filter(e=>e.kind==='turn-end').length,0);
  const retry=events.filter(e=>e.kind==='note'&&e.retrying);
  assert.equal(retry.length,1);assert.equal(retry[0].error,false);assert.match(retry[0].text,/Servidor fechou/);
  notify('error',{turnId:'r',willRetry:false,error});
  notify('turn/completed',{turn:{id:'r',status:'failed',error}});
  assert.equal(manager.approvalOwns(card.key),false);
  assert.equal(events.filter(e=>e.kind==='note'&&e.error).length,1);
  assert.equal(events.filter(e=>e.kind==='turn-end').length,1);
  notify('turn/started',{turn:{id:'r2'}});
  notify('turn/completed',{turn:{id:'r2',status:'failed',error:{message:'Limite de contexto'}}});
  assert.ok(events.some(e=>e.kind==='note'&&e.text==='Limite de contexto'));
 } finally {await manager.close();}
});
