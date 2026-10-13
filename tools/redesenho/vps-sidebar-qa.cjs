'use strict';
// Renderer real com transporte simulado: não abre SSH nem inicia motores reais.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {verifyServer,ORIGIN}=require('./qa-environment.cjs');
const out=path.resolve(__dirname,'../../artifacts');fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(out,'vps-sidebar-qa-profile'));
app.commandLine.appendSwitch('disable-background-networking');
let win;const checks=[],errors=[],states=[];const wait=ms=>new Promise(r=>setTimeout(r,ms));
const js=code=>win.webContents.executeJavaScript(code);
async function settle(ms=500){win.webContents.invalidate();await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await wait(ms);}
async function geometry(label){const state=await js(`(()=>{const box=s=>{const e=document.querySelector(s);return e?{rect:e.getBoundingClientRect().toJSON(),scroll:e.scrollLeft,width:e.scrollWidth,client:e.clientWidth,display:getComputedStyle(e).display,position:getComputedStyle(e).position,cls:e.className}:null;};return{tab:cfg.abaAtiva,focus:focusPane?.titulo,active:document.activeElement?.className,nav:box('.ck-navigator'),work:box('.ck-work'),panes:box('#panes'),first:box('#panes .coluna'),shell:box('#shell'),body:box('body'),html:box('html'),count:panes.size};})()`);states.push({label,...state});console.log(JSON.stringify({label,...state}));return state;}
async function capture(file){await settle();fs.writeFileSync(path.join(out,file),(await win.webContents.capturePage()).toPNG());}
async function check(name,fn){try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.message});errors.push(name+': '+e.message);}console.log(JSON.stringify(checks.at(-1)));}
function startsAtLeft(state){assert.ok(state.first.rect.left>=state.panes.rect.left-1,JSON.stringify({first:state.first.rect.left,panes:state.panes.rect.left}));assert.ok(state.panes.scroll<=1,'Rolagem indevida: '+state.panes.scroll);assert.equal(state.work.scroll,0);assert.equal(state.shell.scroll,0);if(!state.nav.cls.includes('ck-peek'))assert.ok(state.panes.rect.left>=state.nav.rect.right-1,'Painéis invadem lateral fixa');}
async function change(tab){await js('trocarAbaLocal('+JSON.stringify(tab)+')');await settle(800);}
app.whenReady().then(async()=>{
 const initial=await verifyServer();
 session.defaultSession.webRequest.onBeforeRequest((d,cb)=>cb({cancel:!d.url.startsWith(ORIGIN+'/')&&!d.url.startsWith('data:')&&d.url!=='about:blank'}));
 win=new BrowserWindow({width:1600,height:960,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 await win.loadURL(ORIGIN+'/?cenario=supervisao&visual=1&tema=jornal');
 for(let i=0;i<100&&!await js('!!window.__qa?.ready&&!!window.CockpitUI');i++)await wait(50);
 await js('__qa.override("sessionsRemoto",async()=>[]);true');
 await js(`(()=>{window.__localTab=cfg.abaAtiva;cfg.uiCollapsed=false;VisualMac.themeChanged(cfg.tema);sairDaAbertura();for(let i=0;i<3;i++){const p=newPane({engine:'codex',cwd:'C:/QA',abaId:cfg.abaAtiva,titulo:'Local extra '+i});p.started=true;p.sessaoId='local-extra-'+i;p.busy=true;}for(const p of panes.values())p.busy=true;savePanes();const remote=cfg.abas.find(a=>a.id==='qa-servidor');remote.paineis=Array.from({length:6},(_,i)=>({paneId:'qa-remote-'+i,sessaoId:'remote-session-'+i,engine:'codex',cwd:'/srv/projeto',titulo:'VPS sessão '+i,coluna:[4,3,2,1,1,0][i],rascunho:i===0?'Rascunho que precisa permanecer':''}));__qa.override('sessionHistory',async()=>{await new Promise(r=>setTimeout(r,40));return [];});return true;})()`);
 await settle(800);await geometry('local inicial');
 const local=await js('__localTab');
 await check('Restaurar VPS na ordem4,3,2,1,1,0 mostra a primeira coluna ao lado da lateral',async()=>{
   await change('qa-servidor');const state=await geometry('primeira restauração VPS');startsAtLeft(state);assert.equal(state.focus,'VPS sessão 5');
   assert.equal(await js('document.querySelectorAll("#panes .coluna").length'),5);assert.equal(state.count,6);
 });
 await js('for(const p of panes.values())p.busy=true;true');
 await check('Usuário ainda pode rolar horizontalmente sem deslocar a lateral',async()=>{
   await js('document.querySelector(".ck-toggle").focus({preventScroll:true});document.querySelector("#panes").scrollTo({left:300,behavior:"instant"});true');await settle();
   const state=await geometry('VPS rolada manualmente');assert.ok(state.panes.scroll>=250);assert.equal(state.nav.rect.left,8);assert.equal(state.work.scroll,0);
 });
 await check('Voltar entre PC e VPS já montada começa na esquerda e conserva rascunho/pilha',async()=>{
   for(let i=0;i<2;i++){await change(local);startsAtLeft(await geometry('volta local '+i));await change('qa-servidor');const state=await geometry('VPS já montada '+i);startsAtLeft(state);assert.equal(state.focus,'VPS sessão 5');}
   assert.equal(await js('[...panes.values()].find(p=>p.titulo==="VPS sessão 0").el.querySelector(".p-input").value'),'Rascunho que precisa permanecer');
   assert.equal(await js('document.querySelectorAll("#panes .coluna").length'),5);await capture('vps-sidebar-fixed.png');
 });
 await check('Lateral recolhida mantém faixa depois do rail nas trocas PC e VPS',async()=>{
   await js('document.querySelector(".ck-toggle").click();true');await settle();
   await change(local);startsAtLeft(await geometry('local rail'));await change('qa-servidor');const state=await geometry('VPS rail');startsAtLeft(state);assert.ok(state.nav.cls.includes('ck-collapsed'));assert.ok(!state.nav.cls.includes('ck-peek'));await capture('vps-sidebar-rail.png');
 });
 await check('Hover abre lateral sobre o rail e fixa sem deslocar a primeira coluna para trás',async()=>{
   const result=await require('./visual-mac-pointer-checks.cjs')(win);assert.equal(result.status,'passed',JSON.stringify(result.checks));
   states.push({label:'pointer checks',result});
   await js('if(cfg.uiCollapsed)document.querySelector(".ck-toggle").click();true');await settle();await change(local);await change('qa-servidor');startsAtLeft(await geometry('VPS após hover e fixar'));
 });
 await check('390px mantém a primeira coluna dentro da área útil após a troca',async()=>{
   win.setSize(390,844);await settle();await change(local);await change('qa-servidor');const state=await geometry('VPS mobile');startsAtLeft(state);assert.equal(state.html.width,state.html.client);await capture('vps-sidebar-390.png');
 });
 const final=await verifyServer();if(initial.sourceHash!==final.sourceHash)errors.push('A fonte mudou durante o QA.');
 const snapshot=await js('__qa.snapshot()');errors.push(...snapshot.errors);if(snapshot.missing.length)errors.push('API sem simulação: '+snapshot.missing.join(', '));
 const sends=await js('__qa.calls.filter(c=>["paneSend","paneStart","termRun","paneInterrupt"].includes(c.method)).length');if(sends)errors.push('Chamada inesperada a motor simulado: '+sends);
 fs.writeFileSync(path.join(out,'vps-sidebar-qa.json'),JSON.stringify({status:errors.length?'failed':'passed',initial,final,states,checks,errors,authenticatedEnginesStarted:false,remoteConnectionOpened:false},null,2));app.exit(errors.length?1:0);
}).catch(e=>{console.error(e.stack);app.exit(1);});
