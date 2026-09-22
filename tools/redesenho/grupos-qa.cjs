'use strict';
// Smoke no renderer real, somente API simulada e perfil isolado.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {verifyServer,ORIGIN}=require('./qa-environment.cjs');
const artifacts=path.resolve(__dirname,'../../artifacts');
const run=path.join(artifacts,'grupos-qa-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(run,{recursive:true});app.setPath('userData',path.join(run,'profile'));
app.commandLine.appendSwitch('disable-background-networking');app.commandLine.appendSwitch('disable-component-update');
const results=[],errors=[],blocked=[];let win,identity;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function bounded(p,label){let timer;try{return await Promise.race([p,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Timeout: '+label)),20000))]);}finally{clearTimeout(timer);}}
const ev=code=>bounded(win.webContents.executeJavaScript(code),'evaluate');
async function until(code){for(let i=0;i<120;i++){if(await ev(code))return;await delay(100);}throw Error('Timeout: '+code);}
async function click(selector){const box=await ev(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('Elemento ausente');const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height};})()`);assert.ok(box.width&&box.height,'Elemento visível');const point={x:Math.round(box.x),y:Math.round(box.y)};win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});await delay(100);}
async function capture(name){win.webContents.invalidate();await delay(150);fs.writeFileSync(path.join(run,name+'.png'),(await bounded(win.webContents.capturePage(),'capture')).toPNG());}
async function check(name,fn){try{await fn();results.push({name,passed:true});}catch(error){results.push({name,passed:false,error:error.stack});throw error;}}
app.whenReady().then(async()=>{
 identity=await verifyServer();
 session.defaultSession.webRequest.onBeforeRequest((r,cb)=>{const ok=r.url.startsWith(ORIGIN+'/')||r.url.startsWith('data:')||r.url.startsWith('blob:'+ORIGIN)||r.url==='about:blank';if(!ok)blocked.push(r.url);cb({cancel:!ok});});
 win=new BrowserWindow({width:1440,height:960,show:false,title:'Cockpit — QA de grupos recolhidos',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('render-process-gone',(_,d)=>errors.push('Renderer: '+d.reason));
 await bounded(win.loadURL(ORIGIN+'/?cenario=supervisao&gruposqa=1'),'load');win.webContents.setZoomFactor(1);
 await until('!!window.__qa?.ready && __qa.panels?.length===3 && document.querySelectorAll(".ck-nav-group").length===3');
 await check('Todos os grupos iniciam recolhidos e acessíveis',async()=>{
  const state=await ev(`[...document.querySelectorAll('.ck-nav-group')].map(g=>({title:g.querySelector('.ck-group-name').textContent,hidden:g.querySelector('.ck-group-body').hidden,expanded:g.querySelector('.ck-group-head').getAttribute('aria-expanded')}))`);
  assert.equal(state.length,3);assert.ok(state.every(g=>g.hidden&&g.expanded==='false'));results.initial=state;
  if(await ev('document.querySelector(".ck-navigator").classList.contains("ck-collapsed")'))await click('.ck-toggle');
  await capture('inicio-recolhido');
 });
 await check('Clique explícito abre e recolhe o grupo ativo',async()=>{
  await click('.ck-nav-group[data-current="true"] .ck-group-head');
  assert.equal(await ev('document.querySelector(".ck-nav-group[data-current=true] .ck-group-body").hidden'),false);
  assert.equal(await ev('document.querySelector(".ck-nav-group[data-current=true] .ck-group-head").getAttribute("aria-expanded")'),'true');
  await capture('grupo-aberto');await click('.ck-nav-group[data-current="true"] .ck-group-head');
  assert.equal(await ev('document.querySelector(".ck-nav-group[data-current=true] .ck-group-body").hidden'),true);
  assert.equal(await ev('document.querySelector(".ck-nav-group[data-current=true] .ck-group-head").getAttribute("aria-expanded")'),'false');
 });
 await check('Selecionar outro lugar abre seu grupo e preserva conversas e rascunhos',async()=>{
  await ev(`window.__groupsQaInitial=[...panes.values()].map((p,i)=>{p.el.querySelector('.p-input').value='RASCUNHO_GRUPO_'+i;return{id:p.id,engine:p.engine,session:p.sessaoId,draft:p.el.querySelector('.p-input').value};});void 0`);
  await click('.ck-nav-group:nth-child(2) .ck-group-head');await until('cfg.abaAtiva==="qa-site" && !trocandoAba && document.querySelector(".ck-nav-group[data-current=true] .ck-group-name")?.textContent==="Site institucional"');
  assert.equal(await ev('document.querySelector(".ck-nav-group[data-current=true] .ck-group-body").hidden'),false);
  assert.equal(await ev('document.querySelector(".ck-nav-group[data-current=true] .ck-group-name").textContent'),'Site institucional');
  await click('.ck-nav-group:nth-child(1) .ck-group-head');await until('cfg.abaAtiva==="qa-produto" && !trocandoAba && panes.size===3 && document.querySelector(".ck-nav-group[data-current=true] .ck-group-name")?.textContent==="Produto"');
  assert.equal(await ev('document.querySelector(".ck-nav-group[data-current=true] .ck-group-body").hidden'),false);
  const actual=await ev(`[...panes.values()].map(p=>({id:p.id,engine:p.engine,session:p.sessaoId,draft:p.el.querySelector('.p-input').value}))`);
  assert.deepEqual(actual,await ev('__groupsQaInitial'));assert.equal(await ev('cfg.abas.length'),3);
  await capture('retorno-preservado');
 });
 const state=await ev('({errors:__qa.errors,missing:[...__qa.missing],engineCalls:__qa.calls.filter(c=>/^(paneStart|paneSend|approve|perguntaResponder|termRun)$/.test(c.method))})');
 if(state.errors.length||state.missing.length||state.engineCalls.length)errors.push(JSON.stringify(state));
 const end=await verifyServer();if(end.sourceHash!==identity.sourceHash)errors.push('Renderer mudou durante teste');
 if(blocked.length)errors.push('Tentativas externas bloqueadas');
 finish(state);
}).catch(error=>{errors.push(error.stack);finish();});
function finish(state){const report={status:errors.length||results.some(x=>!x.passed)?'failed':'passed',at:new Date().toISOString(),sourceIdentity:identity,results,errors,blocked,state,productionMainLoaded:false,authenticatedEnginesStarted:false,run};fs.writeFileSync(path.join(run,'report.json'),JSON.stringify(report,null,2)+'\n');fs.writeFileSync(path.join(artifacts,'grupos-qa.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));app.exit(report.status==='passed'?0:1);}


