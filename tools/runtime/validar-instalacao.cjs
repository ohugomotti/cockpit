'use strict';
// CDP exclusivamente local, somente leitura. Nenhum prompt ou preferência enviado.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { compare, canonical } = require('./inventario.cjs');
const options = Object.fromEntries(process.argv.slice(2).map(arg => { const i=arg.indexOf('='); return [arg.slice(2,i),arg.slice(i+1)]; }));
const root=path.resolve(__dirname,'../..'), out=path.resolve(options.out || ''), run=path.dirname(out), port=Number(options.port);
if (!run.startsWith(path.join(root,'artifacts','unificacao','aplicacao-')) || path.basename(out)!=='validacao.json' || !Number.isInteger(port) || port<1024 || port>65535 || path.dirname(path.resolve(options.before||''))!==run) throw Error('Parâmetros inválidos para validação.');
const expectedUrl=pathToFileURL(path.join(options.install,'resources','app.asar','renderer','index.html')).href.toLowerCase();
const before=JSON.parse(fs.readFileSync(options.before,'utf8').replace(/^\uFEFF/,''));
const deadline=Date.now()+100000;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket, errors=0, sequence=0;
const pending=new Map();
function command(method,params={}) { return new Promise((resolve,reject)=>{ const id=++sequence; const timer=setTimeout(()=>{pending.delete(id);reject(Error('A inspeção não respondeu: '+method));},8000); pending.set(id,{resolve,reject,timer}); socket.send(JSON.stringify({id,method,params})); }); }
async function evaluate(expression) { const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}); if(result.exceptionDetails)throw Error('A inspeção encontrou erro no renderer.'); return result.result?.value; }
async function main() {
  let target;
  while(Date.now()<deadline) {
    try { const list=await (await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(1500)})).json(); target=list.find(item=>item.type==='page' && item.url?.toLowerCase()===expectedUrl); if(target)break; } catch {}
    await delay(300);
  }
  if(!target)throw Error('Janela instalada não anunciou o renderer esperado.');
  const url=new URL(target.webSocketDebuggerUrl);
  if(url.hostname!=='127.0.0.1' || Number(url.port)!==port || !url.pathname.startsWith('/devtools/'))throw Error('CDP fora do endereço local autorizado.');
  socket=new WebSocket(url.href);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Conexão CDP não respondeu.')),5000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Falha CDP local.'));},{once:true});});
  socket.addEventListener('message',event=>{const data=JSON.parse(String(event.data));if(data.method==='Runtime.exceptionThrown')errors++;if(data.id&&pending.has(data.id)){const request=pending.get(data.id);pending.delete(data.id);clearTimeout(request.timer);data.error?request.reject(Error('Inspeção CDP recusada.')):request.resolve(data.result);}});
  await command('Runtime.enable');
  const expectedActive=before.tabs.find(tab=>tab.id===before.activeTab)?.panels || [];
  let stable=0;
  while(Date.now()<deadline && stable<2) {
    let ready=false;
    try { ready=await evaluate(`(()=>{try{return typeof cfg==='object' && Array.isArray(cfg.abas) && !trocandoAba && montagemAdiada===0 && panes.size===${expectedActive.length} && !!window.CockpitUI && !!document.querySelector('.ck-navigator') && typeof window.api?.versao==='function'}catch{return false}})()`); } catch {}
    if(errors)throw Error('Exceção não tratada durante a inicialização.');
    stable=ready?stable+1:0; await delay(700);
  }
  if(stable<2)throw Error('A interface não terminou de restaurar os painéis.');
  const current=await evaluate(`(async()=>{
    const canonical=${canonical.toString()};
    const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(canonical(value)))))].map(b=>b.toString(16).padStart(2,'0')).join('');
    const valid=p=>p&&(p.paneId||p.sessaoId||p.contexto||p.rascunho);
    const tabs=await Promise.all(cfg.abas.map(async tab=>({id:tab.id,panels:await Promise.all((tab.paineis||[]).filter(valid).map(async p=>({engine:p.engine||'',session:p.sessaoId||'',draft:await hash(p.rascunho||'')})))})));
    tabs.forEach(tab=>tab.panels.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));tabs.sort((a,b)=>String(a.id).localeCompare(String(b.id)));
    const preferenceHashes=Object.fromEntries(await Promise.all(Object.entries(cfg).filter(([key])=>!['abas','temposTrabalho','conectoresQuando','conectoresVistos'].includes(key)).map(async([key,value])=>[key,await hash(value)])));
    const tabPreferenceHashes=Object.fromEntries(await Promise.all(cfg.abas.map(async tab=>[tab.id,Object.fromEntries(await Promise.all(Object.entries(tab).filter(([key])=>key!=='paineis').map(async([key,value])=>[key,await hash(value)])))])));
    const live=await Promise.all([...panes.values()].map(async p=>({engine:p.engine||'',session:p.sessaoId||p.resumeId||p.resumeAnterior||'',draft:await hash(p.el.querySelector('.p-input')?.value||'')})));
    live.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const rect=document.querySelector('.ck-navigator').getBoundingClientRect();
    return{tabs,activeTab:cfg.abaAtiva,theme:cfg.tema||'escuro',preferenceHashes,tabPreferenceHashes,live,panels:panes.size,appVersion:await window.api.versao(),electron:navigator.userAgent.match(new RegExp('Electron/([0-9.]+)'))?.[1]||'',navigationVisible:rect.width>0&&rect.height>0,bodyReady:document.body.classList.contains('ck-app'),overflow:document.documentElement.scrollWidth>innerWidth};
  })()`);
  const checks={...compare(before,current),liveSessionsAndDraftsPreserved:JSON.stringify(current.live)===JSON.stringify(expectedActive),activePanelsRestored:current.panels===expectedActive.length,navigationLoaded:current.navigationVisible&&current.bodyReady,noHorizontalOverflow:!current.overflow,preloadAndIpc:typeof current.appVersion==='string'&&current.appVersion.length>0,electronVersion:current.electron===options['expected-electron'],noRuntimeExceptions:errors===0};
  const report={status:Object.values(checks).every(Boolean)?'passed':'failed',checkedAt:new Date().toISOString(),checks,electron:current.electron,appVersion:current.appVersion,tabs:current.tabs.length,savedPanels:before.savedPanels,activePanels:current.panels,rendererExceptions:errors,contentsIncluded:false,promptsSent:0,preferencesChangedByValidator:false};
  fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
  if(report.status!=='passed')process.exitCode=1;
}
main().catch(error=>{fs.writeFileSync(out,JSON.stringify({status:'failed',checkedAt:new Date().toISOString(),error:error.message,rendererExceptions:errors,promptsSent:0,contentsIncluded:false},null,2)+'\n');console.error(error.message);process.exitCode=1;}).finally(()=>{for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error('Inspeção encerrada.'));}pending.clear();socket?.close();});
