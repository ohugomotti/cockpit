'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {lerFonte,pegarBloco}=require('../testes/raiz');const source=lerFonte('main.js');
function fake(){const p=new EventEmitter();p.stdout=new PassThrough();p.stderr=new PassThrough();p.stdin=new PassThrough();p.kill=()=>{};return p;}
function fragment(stream,text){for(const b of Buffer.from(text))stream.write(Buffer.from([b]));}
function harness(name,extra={}){const p=fake();const c={console,Promise,Map,Set,Buffer,Array,Error,setTimeout,clearTimeout,HOME:'C:/QA',buildEnv:()=>({}),spawnBin:()=>p,...extra};vm.createContext(c);vm.runInContext(pegarBloco(source,'function '+name+'(',name),c);return{p,c};}
for(const invalid of [false,true])test('Codex stdout '+(invalid?'ignores JSON non-objects':'preserves fragmented UTF-8'),async()=>{
 const seen=[];const {p,c}=harness('codexStart',{codex:{ready:null},codexIncoming:m=>{assert.ok(m&&typeof m==='object'&&!Array.isArray(m));seen.push(m);},codexReq:async()=>({}),codexNote:()=>{}});await c.codexStart();
 if(invalid)p.stdout.write('null\n[]\n42\n"text"\n');fragment(p.stdout,JSON.stringify({method:'text',params:{text:'Ação 🙂'}})+'\n');assert.equal(seen.length,1);assert.equal(seen[0].params.text,'Ação 🙂');
});
for(const invalid of [false,true])test('CLI stdout '+(invalid?'ignores JSON non-objects':'preserves fragmented UTF-8'),()=>{
 const seen=[],st={engine:'gemini',primeira:true,sessao:'fake',cwd:'C:/QA'};const {p,c}=harness('cliEnviar',{cliPanes:new Map([['p',st]]),CLIS:{gemini:{bin:'fake',args:()=>[]}},emit:()=>{},cliEvento:(_id,_st,m)=>{assert.ok(m&&typeof m==='object'&&!Array.isArray(m));seen.push(m);}});c.cliEnviar('p','test');
 if(invalid)p.stdout.write('null\n[]\n42\n"text"\n');fragment(p.stdout,JSON.stringify({type:'text',text:'Ação 🙂'})+'\n');assert.equal(seen.length,1);assert.equal(seen[0].text,'Ação 🙂');
});
for(const invalid of [false,true])test('Audio stdout '+(invalid?'ignores JSON non-objects':'preserves fragmented UTF-8'),()=>{
 const ou={modelo:'small',proc:null};const {p,c}=harness('ligarOuvinte',{pegarOuvinte:()=>ou,temTranscricao:()=>true,PY_TRANSCRICAO:'fake',OUVINTE:()=>'',EH_WIN:false});c.ligarOuvinte('small');let response;ou.pedidos.set('req',r=>response=r);
 if(invalid)p.stdout.write('null\n[]\n42\n"text"\n');fragment(p.stdout,JSON.stringify({id:'req',texto:'Ação 🙂'})+'\n');assert.equal(response.texto,'Ação 🙂');
});
test('Command stdout and stderr preserve UTF-8 across pipe chunks',async()=>{
 const {p,c}=harness('rodar');const pending=c.rodar('fake',[],1000);fragment(p.stdout,'Ação 🙂');fragment(p.stderr,'Atenção 🙂');p.emit('close',0);const r=await pending;assert.equal(r.out,'Ação 🙂');assert.equal(r.errout,'Atenção 🙂');assert.equal(r.err,null);
});
