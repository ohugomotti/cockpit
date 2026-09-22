'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../..');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function connect(port,executable){
 let target;for(let i=0;i<40;i++){try{const tabs=await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(1000)}).then(r=>r.json());target=tabs.find(t=>t.type==='page'&&decodeURIComponent(t.url).replaceAll('\\','/').toLowerCase().endsWith('/resources/app.asar/renderer/index.html'));if(target)break;}catch{}await sleep(250);}
 assert.ok(target,'Renderer ausente');
 const expected='file:///'+path.dirname(executable).replaceAll('\\','/')+'/resources/app.asar/renderer/index.html';assert.equal(decodeURIComponent(target.url).toLowerCase(),expected.toLowerCase());
 const ws=new WebSocket(target.webSocketDebuggerUrl);let next=0;const pending=new Map(),errors=[];
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',e=>{const msg=JSON.parse(String(e.data));if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.exception?.description||msg.params.exceptionDetails.text);const p=pending.get(msg.id);if(p){clearTimeout(p.timer);pending.delete(msg.id);msg.error?p.reject(Error(msg.error.message)):p.resolve(msg.result);}});
 const rpc=(method,params={},timeout=15000)=>new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Tempo esgotado: '+method));},timeout);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await rpc('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;};
 const close=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Encerrado'));}ws.close();};
 await rpc('Runtime.enable');return{rpc,evaluate,close,errors};
}
async function main(){
 const m=read(path.join(root,'artifacts/windows-manifest.json')),run=read(path.join(m.run,'qa-clean-process.json'));
 const c=await connect(run.port,run.executable),report={status:'running',at:new Date().toISOString(),checks:[]};
 const check=async(name,fn)=>{const detail=await fn();report.checks.push({name,status:'passed',detail});console.log(JSON.stringify(report.checks.at(-1)));};
 try{
  for(let i=0;i<60;i++){if(await c.evaluate("typeof cfg==='object' && !!window.CockpitUI && !!document.querySelector('#primeirosPassos[open]')"))break;await sleep(250);}
  await check('Primeira abertura sem motores nem credenciais',async()=>{const r=await c.evaluate("(async()=>({version:await api.versao(),engines:await api.motoresDisponiveis(),guide:!!document.querySelector('#primeirosPassos[open]'),title:document.title,hasPersonalAvatar:!!cfg.foto}))()");assert.equal(r.version,m.version);assert.equal(r.title,'Cockpit');for(const id of ['claude','codex','gemini','grok'])assert.equal(r.engines[id],false,id);assert.equal(r.guide,true);assert.equal(r.hasPersonalAvatar,false);return r;});
  await check('Guia legível em janela de notebook',async()=>{await c.rpc('Emulation.setDeviceMetricsOverride',{width:1180,height:720,deviceScaleFactor:1,mobile:false});await sleep(350);const r=await c.evaluate("(()=>{const d=document.querySelector('#primeirosPassos'),b=d.getBoundingClientRect();return{width:b.width,height:b.height,viewport:[innerWidth,innerHeight],inside:b.left>=0&&b.top>=0&&b.right<=innerWidth&&b.bottom<=innerHeight,buttons:[...d.querySelectorAll('button')].map(b=>b.textContent),noHorizontalScroll:d.scrollWidth<=d.clientWidth,guideText:d.textContent.includes('própria conta')};})()");assert.ok(r.inside);assert.ok(r.noHorizontalScroll);assert.ok(r.guideText);assert.ok(r.buttons.some(b=>b.includes('Codex')));return r;});
  await check('Atualizar diagnóstico e fechar com Escape',async()=>{await c.evaluate("[...document.querySelectorAll('#primeirosPassos button')].find(b=>b.textContent==='Verificar novamente').click()");await sleep(500);await c.rpc('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await c.rpc('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});assert.equal(await c.evaluate("!!document.querySelector('#primeirosPassos')"),false);return{closed:true};});
  await check('Guia acessível nos Ajustes',async()=>{const r=await c.evaluate("(()=>{const b=document.querySelector('#btnPrimeirosPassosAjustes');b.click();return{button:!!b,opened:!!document.querySelector('#primeirosPassos[open]')};})()");assert.ok(r.button&&r.opened);await c.evaluate("document.querySelector('#primeirosPassos').close()");return r;});
  await check('Terminal nativo funciona sem Node global',async()=>{const id='qa-installer-native';await c.evaluate("window.__terminalQA=[];window.api.onTermEvent(e=>{if(e.id==='qa-installer-native')window.__terminalQA.push(e);});");const r=await c.evaluate("api.termRun({id:'qa-installer-native',linha:'cmd.exe /d /c echo COCKPIT_INSTALLER_OK',cols:80,rows:24})");assert.equal(r.ok,true);let ev=[];for(let i=0;i<40;i++){ev=await c.evaluate('__terminalQA');if(ev.some(e=>e.kind==='exit'))break;await sleep(200);}assert.ok(ev.some(e=>e.kind==='data'&&e.data.includes('COCKPIT_INSTALLER_OK')));assert.ok(ev.some(e=>e.kind==='exit'&&e.code===0));return{exitCode:0,realConPTY:true};});
  await check('Sem falhas JavaScript',async()=>{assert.deepEqual(c.errors,[]);return{exceptions:0};});
  await c.evaluate('abrirPrimeirosPassos()');
  try{const shot=await c.rpc('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},5000);fs.writeFileSync(path.join(run.run,'primeira-abertura.png'),Buffer.from(shot.data,'base64'));report.screenshot=path.join(run.run,'primeira-abertura.png');}catch(e){report.screenshotWarning=e.message;}
  report.status='passed';
 }catch(e){report.status='failed';report.error=e.stack;process.exitCode=1;}finally{c.close();fs.writeFileSync(path.join(run.run,'validation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
}
module.exports={connect,read,sleep};
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
