'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),cp=require('node:child_process');
const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
const {pegarBloco}=require('../testes/raiz');
function handler(channel,extras){let callback;const start=source.indexOf("ipcMain.handle('"+channel+"'");const end=source.indexOf('\n});',start)+4;assert.ok(start>=0&&end>start);const ctx={ipcMain:{handle:(_,fn)=>callback=fn},...extras};vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);return{callback,ctx};}
function temp(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cockpit-handler-regression-'));return{dir,clean(){assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true})}};}
function git(args,cwd){return cp.execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true});}
test('git diff handler displays real staged-only changes and keeps unstaged precedence',async()=>{const h=temp();try{
 git(['init','-q'],h.dir);git(['config','core.autocrlf','false'],h.dir);const file=path.join(h.dir,'fixture.txt');fs.writeFileSync(file,'staged content\n');git(['add','fixture.txt'],h.dir);
 const calls=[];const {callback}=handler('git:diff',{rodar:async(bin,args)=>{calls.push(args);try{return{out:cp.execFileSync(bin,args,{encoding:'utf8',windowsHide:true}),err:null}}catch(err){return{out:'',err}}}});
 const staged=await callback({}, {cwd:h.dir,arquivo:'fixture.txt'});assert.match(staged,/\+staged content/);assert.ok(calls.some(args=>args.includes('--cached')));
 calls.length=0;fs.writeFileSync(file,'unstaged content\n');const unstaged=await callback({}, {cwd:h.dir,arquivo:'fixture.txt'});assert.match(unstaged,/\+unstaged content/);assert.equal(calls.length,1);
}finally{h.clean()}});
function exporter(h,engine,withPath=true){
 const file=path.join(h.dir,engine+'-session.jsonl'),out=path.join(h.dir,engine+'-export.md');
 fs.writeFileSync(file,[{sessionId:engine+'-id'},{id:'user',type:'user',content:'Pergunta com ação'},{id:'bot',type:engine,content:'Resposta '+engine},{id:'tool',type:engine,toolCalls:[{name:'Read',args:{path:'fixture.txt'}}]}].map(JSON.stringify).join('\n'));
 const extras={fs,path,CLAUDE_PROJ:path.join(h.dir,'claude'),CODEX_SESS:path.join(h.dir,'codex'),app:{getPath:()=>h.dir},win:null,dialog:{showSaveDialog:async()=>({filePath:out})},ehCli:e=>['gemini','grok'].includes(e),CLIS:{gemini:{nome:'Gemini'},grok:{nome:'Grok'}},acharArquivoSessao:(e,id)=>{assert.equal(e,engine);assert.equal(id,engine+'-id');return file},codexHistory:()=>{throw Error('wrong Codex reader')},claudeHistory:()=>{throw Error('wrong Claude reader')},varrerConversas:()=>{throw Error('wrong history root')},remoteEngines:{history:async()=>{throw Error('remote unavailable')}}};
 const loaded=handler('sessao:exportar',extras),ctx=loaded.ctx;
 for(const fn of ['function cliFalaDeGente(','function cliLerConversa(','function cliHistory('])vm.runInContext(pegarBloco(source,fn,fn),ctx);
 const a=source.indexOf('const cliTexto = '),b=source.indexOf(';',a)+1;vm.runInContext(source.slice(a,b),ctx);
 return{...loaded,file,out,request:{engine,id:engine+'-id',...(withPath?{file}:{})}};
}
for(const engine of ['gemini','grok'])for(const withPath of [true,false])test(engine+' exports actual CLI history '+(withPath?'by file':'by session id'),async()=>{const h=temp();try{
 const e=exporter(h,engine,withPath);const result=await e.callback({},e.request);assert.equal(result.ok,true,JSON.stringify(result));const md=fs.readFileSync(e.out,'utf8');assert.match(md,/Pergunta com ação/);assert.ok(md.includes('## '+(engine==='gemini'?'Gemini':'Grok')));assert.ok(md.includes('Resposta '+engine));assert.ok(md.includes('Read'));assert.ok(!md.includes('## Claude'));
}finally{h.clean()}});
test('remote export failure returns an actionable error without opening save dialog',async()=>{const h=temp();try{const e=exporter(h,'gemini');const result=await e.callback({}, {...e.request,remoto:{host:'fake'}});assert.match(result.error,/remote unavailable/);assert.ok(!fs.existsSync(e.out));}finally{h.clean()}});
