'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {pathToFileURL}=require('node:url');
const {inventory}=require('./inventario.cjs');
const root=path.resolve(__dirname,'../..');
const fixture=path.join(root,'artifacts/unificacao/aplicacao-prova-fixture-'+Date.now());
const source=path.join(fixture,'source'),install=path.join(fixture,'install');
fs.mkdirSync(path.join(source,'renderer'),{recursive:true});fs.mkdirSync(path.join(install,'resources'),{recursive:true});
const config={abas:[{id:'fake-tab',nome:'Fictícia',tipo:'local',paineis:[{paneId:'p',engine:'codex',sessaoId:'fake-session',rascunho:'Rascunho fictício'}]}],abaAtiva:'fake-tab',tema:'jornal',defMode:'plan'};
fs.writeFileSync(path.join(fixture,'inventario-antes.json'),JSON.stringify(inventory(config)));
fs.writeFileSync(path.join(source,'renderer/index.html'),'<!doctype html><html><head><meta charset="utf-8"><title>Fixture isolada</title></head><body class="ck-app"><div class="ck-navigator" style="width:180px;height:240px">Fixture</div><div id="pane"><input class="p-input"></div><script src="fixture.js"></script></body></html>');
fs.writeFileSync(path.join(source,'renderer/fixture.js'),`var cfg=${JSON.stringify(config)};var trocandoAba=false;var montagemAdiada=0;window.CockpitUI={};document.querySelector('.p-input').value='Rascunho fictício';var panes=new Map([['p',{engine:'codex',sessaoId:'fake-session',el:document.getElementById('pane')}]])`);
fs.writeFileSync(path.join(fixture,'preload.cjs'),"require('electron').contextBridge.exposeInMainWorld('api',{versao:async()=> '1.1.1'});");
fs.writeFileSync(path.join(fixture,'main.cjs'),`const {app,BrowserWindow,session}=require('electron'),fs=require('node:fs'),path=require('node:path');app.setPath('userData',path.join(__dirname,'profile'));app.commandLine.appendSwitch('disable-background-networking');app.commandLine.appendSwitch('host-resolver-rules','MAP * ~NOTFOUND');app.whenReady().then(()=>{session.defaultSession.webRequest.onBeforeRequest((details,cb)=>cb({cancel:!details.url.startsWith('file:')}));const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,'preload.cjs')}});win.loadFile(path.join(__dirname,'install/resources/app.asar/renderer/index.html'));setInterval(()=>{if(fs.existsSync(path.join(__dirname,'finish')))app.exit(0)},100);setTimeout(()=>app.exit(2),25000)});`);
async function main(){
  const cache=path.join(process.env.LOCALAPPDATA,'npm-cache/_npx');
  const asarFile=fs.readdirSync(cache).map(name=>path.join(cache,name,'node_modules/@electron/asar/lib/asar.js')).find(file=>fs.existsSync(file));
  if(!asarFile)throw Error('ASAR local não disponível.');
  const asar=await import(pathToFileURL(asarFile).href);await asar.createPackage(source,path.join(install,'resources/app.asar'));
  const runtime=JSON.parse(fs.readFileSync(path.join(root,'artifacts/runtime-candidate.json'),'utf8').replace(/^\uFEFF/,''));
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
  const electron=cp.spawn(runtime.testExecutable,[path.join(fixture,'main.cjs'),'--remote-debugging-address=127.0.0.1','--remote-debugging-port=9358'],{cwd:fixture,env,windowsHide:true,stdio:'ignore'});
  try{
    const result=await new Promise((resolve,reject)=>{const verifier=cp.spawn(process.execPath,[path.join(__dirname,'validar-instalacao.cjs'),'--port=9358','--before='+path.join(fixture,'inventario-antes.json'),'--install='+install,'--expected-electron='+runtime.electron,'--out='+path.join(fixture,'validacao.json')],{windowsHide:true,stdio:'ignore'});verifier.on('error',reject);verifier.on('close',resolve);});
    const report=JSON.parse(fs.readFileSync(path.join(fixture,'validacao.json')));
    if(result!==0||report.status!=='passed')throw Error('Validador recusou fixture: '+JSON.stringify(report));
    fs.writeFileSync(path.join(root,'artifacts/unificacao/validador-fixture.json'),JSON.stringify({...report,fixture,realInstallationTouched:false},null,2));
    console.log(JSON.stringify({status:'passed',checks:Object.keys(report.checks).length,electron:report.electron,fixture,realInstallationTouched:false}));
  }finally{fs.writeFileSync(path.join(fixture,'finish'),'1');setTimeout(()=>electron.kill(),1500).unref();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
