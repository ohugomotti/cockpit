'use strict';
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pegarBloco}=require('../../testes/raiz');
const root=path.resolve(__dirname,'../..');
const run=path.join(root,'artifacts/contas-popup-audit');
fs.mkdirSync(run,{recursive:true});app.setPath('userData',path.join(run,'profile'));
app.commandLine.appendSwitch('disable-background-networking');app.commandLine.appendSwitch('disable-component-update');
const source=fs.readFileSync(path.join(root,'src/renderer/app.js'),'utf8');
const ui=fs.readFileSync(path.join(root,'src/renderer/cockpit-ui.js'),'utf8');
const extract=(s,n,isAsync)=> (isAsync?'async ':'')+pegarBloco(s,'function '+n+'(',n);
const pieces=[['fecharMenus',false],['fecharPopGlobal',false],['abrirPopGlobal',false],['menuContas',true],['pedidoDeConta',false],['capacidadesDaConta',false],['escopoDaConta',false],['perfilDeContaUtilizavel',false]].map(([n,a])=>extract(source,n,a));
pieces.push(...[['node',false],['button',false],['labelled',false],['accountLayer',true]].map(([n,a])=>extract(ui,n,a)));
const setup=`const d=document,ICONES={},ESTE_PC='PC',panes=new Map(),accountList=document.getElementById('accounts');let layerSeq=0;const $=(s,n=document)=>n.querySelector(s),ico=()=>'',pararBuscaEmVoo=()=>{},remotoDoAba=()=>null,chaveDoLugar=()=> 'pc',nomeDoMotor=e=>e,faltaConfigurarServidor=()=>false,marcaDoMotor=()=>'',windowCalls=[];let capacidades={ok:true,gerenciado:true,salvar:true,trocar:true,login:true,logout:true,consulta:true};let profiles=[{apelido:'Atual QA',atual:true,dados:null},{apelido:'Inválida QA',atual:false,estado:'login',podeUsar:false,precisaLogin:true,erro:'Entre novamente',dados:null},{apelido:'Válida QA',atual:false,estado:'ok',podeUsar:true,dados:null}];window.api={contasComparar:async()=>({contas:profiles}),contaLer:async()=>null,contasListar:async()=>profiles,contasDisponivel:async()=>capacidades,contasCompararCancelar:()=>{}};const CockpitUsage={accountSummary:()=>({available:false,windows:[]}),renderAccountMeter:()=>''},svgMotor=()=>'',trocarContaGuardada=async(e,l,p)=>{windowCalls.push(['switch',p.apelido]);return false;},entrarNaContaDoLugar=()=>windowCalls.push(['login']);let layerTitle;function openLayer(title){layerTitle=title;const overlay=d.createElement('div'),body=d.createElement('section');overlay.className='audit-layer';overlay.append(body);d.body.append(overlay);return{overlay,body};} function closeLayer(l){l.closed=true;l.overlay.remove();}`;

app.whenReady().then(async()=>{let w;try{
 session.defaultSession.webRequest.onBeforeRequest((x,cb)=>cb({cancel:!x.url.startsWith('data:')&&x.url!=='about:blank'}));
 w=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
 w.webContents.on('console-message',(_,level,message)=>console.log('renderer:'+message));
 await w.loadURL('data:text/html,<html><style>.hidden{display:none}</style><body><div id="accounts">Conta</div><div id="popGrupo" class="hidden"></div></body></html>');
 await w.webContents.executeJavaScript(setup+'\n'+pieces.join('\n')+"\ndocument.addEventListener('click',fecharMenus);void 0;");
 const result=await w.webContents.executeJavaScript(`(async()=>{
  await accountLayer('codex',{nome:'Nome da pasta'});const title=layerTitle;
  const usable=[...d.querySelectorAll('.audit-layer button')].filter(n=>n.textContent==='Usar esta conta');
  const renew=[...d.querySelectorAll('.audit-layer button')].filter(n=>n.textContent==='Entrar novamente');
  usable[0].click();await new Promise(r=>setTimeout(r,10));
  const b=[...d.querySelectorAll('button')].find(n=>n.textContent==='Gerenciar contas');b.click();await new Promise(r=>setTimeout(r,40));
  const pop=$('#popGrupo');const click={hidden:pop.classList.contains('hidden'),entries:pop.children.length,text:pop.textContent};
  await menuContas('claude',accountList,null,{remoto:null,chave:'pc',rotulo:'PC'});
  const direct={hidden:pop.classList.contains('hidden'),entries:pop.children.length,text:pop.textContent};
  let resolveList;window.api.contasListar=()=>new Promise(r=>resolveList=r);
  const pending=menuContas('claude',accountList,null,{remoto:null,chave:'pc'});fecharPopGlobal();resolveList([]);await pending;
  const stale={hidden:pop.classList.contains('hidden'),entries:pop.children.length};
  capacidades={gerenciado:false,orientacao:'Use o terminal deste destino.'};await accountLayer('codex',null);
  const unsupported={buttons:[...d.querySelectorAll('.audit-layer button')].map(n=>n.textContent),text:d.querySelector('.audit-layer').textContent};
  return{title,usable:usable.length,renew:renew.length,calls:windowCalls,click,direct,stale,unsupported};
 })()`);
 assert.equal(result.click.hidden,false);assert.ok(result.click.entries>1);assert.equal(result.direct.hidden,false);
 assert.equal(result.title,'codex · Neste PC');assert.equal(result.usable,1);assert.equal(result.renew,1);
 assert.deepEqual(result.calls,[['switch','Válida QA']]);assert.equal(result.stale.hidden,true);assert.equal(result.stale.entries,0);
 assert.equal(result.unsupported.buttons.length,0);assert.match(result.unsupported.text,/Use o terminal/);
 const out={at:new Date().toISOString(),status:'passed',checks:5,isolation:'Electron oculto; funções atuais extraídas; API simulada; bloqueio de rede; nenhuma credencial real',...result};
 fs.writeFileSync(path.join(run,'report.json'),JSON.stringify(out,null,2));console.log(JSON.stringify(out));

 }catch(e){console.error(e.stack);process.exitCode=1;}finally{if(w&&!w.isDestroyed())w.destroy();app.exit(process.exitCode||0);}});
