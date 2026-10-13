'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events');
const main=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
const handlerSource=main.slice(main.indexOf("ipcMain.handle('codex:reiniciar'"),main.indexOf("for (const [acao, method] of [['salvar'"));
test('troca recusa um Codex reaberto entre o IPC de parada e o de gravar credencial',()=>{
 const handlers={},writes=[],codex={proc:{}};
 const start=main.indexOf("for (const [acao, method] of [['salvar'");
 const source=main.slice(start,main.indexOf('/* ---------- conta e limite',start));
 vm.runInNewContext(source,{ipcMain:{handle:(name,fn)=>handlers[name]=fn},codex,remotoDaConta:()=>null,
  credentialStore:{change:(...args)=>{writes.push(args);return{ok:true};}}});
 const call=()=>handlers['contas:trocar'](null,{engine:'codex',apelido:'simulada'});
 assert.match(call().error,/voltou a abrir/);assert.equal(writes.length,0);
 codex.proc=null;assert.equal(call().ok,true);assert.equal(writes.length,1);
});
function setup(mode='close'){
 const p=new EventEmitter();p.stdout=new EventEmitter();p.stdout.on('data',()=>{});
 const codex={proc:p,ready:Promise.resolve(),pronto:true,paneToThread:new Map([['pane','thread']]),threadToPane:new Map([['thread','pane']]),paneTurn:new Map([['pane','turn']]),paneErrors:new Map(),paneMsgId:new Map([['pane','message']])};
 const timers=new Map(),stops=[];let nextTimer=0,handler,kills=0,replacement;
 const context={codex,Promise,observabilidade:{encerrarMotor(){}},vigiaTurno:{desligar:id=>stops.push(id)},
  setTimeout:fn=>{const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
  ipcMain:{handle:(name,fn)=>{assert.equal(name,'codex:reiniciar');handler=fn;}},
  matarProcesso:old=>{kills++;assert.equal(old,p);if(mode==='throw')throw Error('falha simulada');if(mode==='timeout')return;
   if(mode==='replacement'){replacement=new EventEmitter();codex.proc=replacement;codex.ready=Promise.resolve('novo');codex.paneToThread=new Map([['novo','nova-thread']]);}
   p.emit('close',0);
  }};
 vm.runInNewContext(handlerSource,context);
 return{codex,p,stops,timers,run:()=>handler(),expire:()=>[...timers.values()].forEach(fn=>fn()),get kills(){return kills;},get replacement(){return replacement;}};
}
test('timeout de parada não anuncia sucesso nem solta processo ainda vivo para trocar credencial',async()=>{
 const h=setup('timeout'),pending=h.run();h.expire();const result=await pending;
 assert.match(result.error,/não confirmou o encerramento/);assert.equal(result.ok,undefined);
 assert.equal(h.codex.proc,h.p);assert.equal(h.codex.paneToThread.get('pane'),'thread');assert.equal(h.codex.pronto,true);
 assert.equal(h.p.listenerCount('close'),0);assert.equal(h.p.stdout.listenerCount('data'),1);assert.equal(h.timers.size,0);
});
test('encerramento confirmado libera estado e limpa ouvintes sem timer residual',async()=>{
 const h=setup();assert.equal((await h.run()).ok,true);assert.equal(h.codex.proc,null);assert.equal(h.codex.ready,null);assert.equal(h.codex.pronto,false);
 assert.equal(h.codex.paneToThread.size,0);assert.equal(h.codex.threadToPane.size,0);assert.equal(h.p.stdout.listenerCount('data'),0);assert.equal(h.timers.size,0);assert.equal(h.kills,1);assert.deepEqual(h.stops,['pane']);
});
test('processo novo criado por consulta concorrente mantém mapas e obriga repetir troca',async()=>{
 const h=setup('replacement'),result=await h.run();assert.match(result.error,/reabriu o Codex/);assert.equal(h.codex.proc,h.replacement);
 assert.equal(h.codex.paneToThread.get('novo'),'nova-thread');assert.equal(h.codex.pronto,true);assert.ok(h.codex.ready);assert.equal(h.timers.size,0);
});
test('falha ao encerrar devolve erro sem esconder processo nem vazar listener',async()=>{
 const h=setup('throw'),result=await h.run();assert.match(result.error,/não confirmou/);assert.equal(h.codex.proc,h.p);assert.equal(h.timers.size,0);assert.equal(h.p.listenerCount('close'),0);
});
test('sem processo ativo limpa flags antigas sem tentar encerrar nada',async()=>{
 const h=setup();h.codex.proc=null;assert.equal((await h.run()).ok,true);assert.equal(h.codex.ready,null);assert.equal(h.codex.pronto,false);assert.equal(h.kills,0);
});
