'use strict';
// Interações reversíveis na instalação real; nenhum prompt, login ou ação de motor.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const status=JSON.parse(fs.readFileSync(path.join(root,'artifacts/aplicacao-status.json'),'utf8'));
 assert.equal(status.installedReplaced,true,'Pacote ainda não aplicado');
 const run=path.resolve(status.runDirectory);
 assert.equal(path.dirname(run),path.join(root,'artifacts'));
 const targets=await fetch('http://127.0.0.1:9337/json/list').then(r=>r.json());
 const target=targets.find(t=>t.type==='page'&&decodeURIComponent(t.url).toLowerCase()==='file:///c:/users/hugom/appdata/local/programs/cockpit/resources/app.asar/renderer/index.html');
 assert.ok(target,'Janela instalada ausente');
 const url=new URL(target.webSocketDebuggerUrl);
 assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&url.port==='9337');
 const ws=new WebSocket(url);const pending=new Map();let seq=0;const errors=[];const checks=[];
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CDP indisponível')),5000);ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('CDP falhou'));},{once:true});});
 ws.addEventListener('message',event=>{const d=JSON.parse(String(event.data));if(d.method==='Runtime.exceptionThrown')errors.push(d.params.exceptionDetails.text);const p=pending.get(d.id);if(p){pending.delete(d.id);clearTimeout(p.timer);d.error?p.reject(Error(d.error.message)):p.resolve(d.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Timeout: '+method));},10000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const d=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(d.exceptionDetails)throw Error(d.exceptionDetails.text);return d.result?.value;};
 const mouse=(x,y)=>send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
 const key=async(key,code,modifiers=0)=>{const vk=key==='Escape'?27:key.toUpperCase().charCodeAt(0);for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code,modifiers,windowsVirtualKeyCode:vk});await delay(120);};
 const click=async selector=>{const p=await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('Elemento ausente');const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);await mouse(p.x,p.y);for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await delay(150);};
 const capture=async name=>{const p=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(run,name),Buffer.from(p.data,'base64'));};
 const check=async(name,fn)=>{await fn();checks.push({name,passed:true});};
 let initialCollapsed, cleanupEnabled=false;
 try{
  await send('Runtime.enable');
  assert.equal(await evaluate('!!document.querySelector(".ck-overlay")'),false,'Há um diálogo aberto pelo usuário');
  initialCollapsed=await evaluate('!!cfg.uiCollapsed');cleanupEnabled=true;
  await evaluate(`window.__installedSmoke={drafts:[...panes.values()].map(p=>({id:p.id,engine:p.engine,session:p.sessaoId||p.resumeId||p.resumeAnterior||'',draft:p.el.querySelector('.p-input')?.value||''})),theme:cfg.tema,active:cfg.abaAtiva};`);
  await check('Busca abre com Ctrl+K e fecha com Esc',async()=>{await key('k','KeyK',2);assert.equal(await evaluate('!!document.querySelector(".ck-palette") && document.activeElement.classList.contains("ck-search")'),true);await key('Escape','Escape');assert.equal(await evaluate('!!document.querySelector(".ck-overlay")'),false);});
  await check('Ajustes e seção Atalhos respondem',async()=>{await click('.ck-tools [aria-label="Ajustes"]');assert.equal(await evaluate('document.querySelectorAll(".ck-settings-tabs [role=tab]").length'),6);await click('.ck-settings-tabs [aria-label="Atalhos"]');assert.equal(await evaluate('document.querySelector(".ck-settings-sheet [role=tabpanel]:not([hidden])").textContent.includes("Ctrl K")'),true);await capture('cockpit-instalado-atalhos.png');await key('Escape','Escape');});
  await check('Lateral recolhe e expande por hover sem mover conversa',async()=>{
   if(!await evaluate('!!cfg.uiCollapsed'))await click('.ck-toggle');
   const outside=await evaluate('({x:Math.min(innerWidth-30,700),y:Math.min(innerHeight-30,400)})');await mouse(outside.x,outside.y);await delay(350);
   const before=await evaluate('({width:document.querySelector(".ck-navigator").getBoundingClientRect().width,x:document.querySelector(".pane").getBoundingClientRect().x})');assert.equal(before.width,56);
   const point=await evaluate('(()=>{const r=document.querySelector(".ck-navigator").getBoundingClientRect();return{x:r.x+20,y:r.y+200};})()');await mouse(point.x,point.y);await delay(450);
   assert.equal(await evaluate('document.querySelector(".ck-navigator").classList.contains("ck-peek")'),true);assert.equal(await evaluate('document.querySelector(".pane").getBoundingClientRect().x'),before.x);await capture('cockpit-instalado-hover.png');
   await mouse(outside.x,outside.y);await delay(300);assert.equal(await evaluate('document.querySelector(".ck-navigator").classList.contains("ck-peek")'),false);
   if(!initialCollapsed)await key('b','KeyB',2);
  });
  await check('Sessões, rascunhos, tema e aba preservados após interações',async()=>{assert.equal(await evaluate(`(()=>{const s=window.__installedSmoke;return s.theme===cfg.tema&&s.active===cfg.abaAtiva&&JSON.stringify(s.drafts)===JSON.stringify([...panes.values()].map(p=>({id:p.id,engine:p.engine,session:p.sessaoId||p.resumeId||p.resumeAnterior||'',draft:p.el.querySelector('.p-input')?.value||''})));})()`),true);});
  await check('Nenhuma exceção na interface',async()=>assert.equal(errors.length,0));
  assert.equal(await evaluate('!!cfg.uiCollapsed'),initialCollapsed);await delay(400);
  const saved=JSON.parse(fs.readFileSync(path.join(process.env.APPDATA,'cockpit','config.json'),'utf8'));assert.equal(!!saved.uiCollapsed,initialCollapsed);
  await capture('cockpit-instalado-final.png');
  fs.writeFileSync(path.join(run,'interacoes.json'),JSON.stringify({status:'passed',checkedAt:new Date().toISOString(),checks,runtimeErrors:errors,promptsSent:0,preferencesRestored:true},null,2)+'\n');
  console.log(JSON.stringify({status:'passed',checks,promptsSent:0,preferencesRestored:true}));
 }catch(e){fs.writeFileSync(path.join(run,'interacoes.json'),JSON.stringify({status:'failed',checkedAt:new Date().toISOString(),checks,error:e.message,runtimeErrors:errors},null,2)+'\n');throw e;}
 finally{
  try{if(cleanupEnabled&&await evaluate('!!document.querySelector(".ck-overlay")'))await key('Escape','Escape');if(initialCollapsed!==undefined&&await evaluate('!!cfg.uiCollapsed')!==initialCollapsed)await key('b','KeyB',2);await evaluate('delete window.__installedSmoke');}catch{}
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Inspeção encerrada'));}ws.close();
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
