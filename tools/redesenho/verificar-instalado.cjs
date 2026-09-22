'use strict';
// Inspeção passiva da partida aprovada. Não envia prompts ou altera preferências.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const index = arg.indexOf('=');
  return [arg.slice(2, index), arg.slice(index + 1)];
}));
const root = path.resolve(__dirname, '../..');
const output = path.resolve(options.out || '');
const configuration = path.resolve(options.config || '');
const port = Number(options.port);
const runRoot = path.dirname(output);
const safeRun = runRoot.startsWith(path.join(root, 'artifacts', 'aplicacao-'));
if (!safeRun || path.basename(output) !== 'validacao.json' || !configuration.startsWith(runRoot + path.sep)
  || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Parâmetros de inspeção inválidos.');
const deadline = Date.now() + 120000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = value => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const valid = p => p && (p.paneId || p.sessaoId || p.contexto || p.rascunho);
const inventory = config => (config.abas || []).map(tab => ({
  id: tab.id,
  panels: (tab.paineis || []).filter(valid).map(p => ({
    engine: p.engine, session: p.sessaoId || '', draft: sha(p.rascunho || ''),
  })).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),
})).sort((a,b)=>String(a.id).localeCompare(String(b.id)));

async function connect(target) {
  const url = new URL(target.webSocketDebuggerUrl);
  if (!['127.0.0.1','localhost'].includes(url.hostname) || Number(url.port) !== port) throw new Error('Depuração fora do endereço local aprovado.');
  const ws = new WebSocket(url.href);
  const pending = new Map(); let sequence = 0;
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Tempo esgotado no WebSocket.')),5000);
    ws.addEventListener('open',()=>{clearTimeout(timeout);resolve();},{once:true});
    ws.addEventListener('error',()=>{clearTimeout(timeout);reject(new Error('Falha no WebSocket local.'));},{once:true});
  });
  const runtimeErrors = [];
  ws.addEventListener('message', event=>{
    const data=JSON.parse(String(event.data));
    if(data.method==='Runtime.exceptionThrown'){const e=data.params.exceptionDetails;runtimeErrors.push({message:(e.exception?.description||e.text||'Exceção na interface').split('\n')[0].slice(0,350),frames:(e.stackTrace?.callFrames||[]).slice(0,4).map(f=>({function:f.functionName,file:f.url.split('/').pop(),line:f.lineNumber+1}))});}
    if(!data.id || !pending.has(data.id))return;
    const request=pending.get(data.id);pending.delete(data.id);clearTimeout(request.timer);
    if(data.error)request.reject(new Error(data.error.message));else request.resolve(data.result);
  });
  function send(method,params={}) {
    return new Promise((resolve,reject)=>{
      const id=++sequence;
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Tempo esgotado: '+method));},10000);
      pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
    });
  }
  async function evaluate(expression) {
    const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails)throw new Error(result.exceptionDetails.text || 'Falha na inspeção da interface');
    return result.result?.value;
  }
  return {send,evaluate,runtimeErrors,close(){for(const q of pending.values()){clearTimeout(q.timer);q.reject(new Error('Inspeção encerrada.'));}pending.clear();ws.close();}};
}

async function main() {
  const before=JSON.parse(fs.readFileSync(configuration,'utf8').replace(/^\uFEFF/,''));
  const expectedInventory=inventory(before);
  const expectedActiveCount=(before.abas.find(tab=>tab.id===before.abaAtiva)?.paineis || []).filter(valid).length;
  let target;
  while(Date.now()<deadline) {
    try {
      const response=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(2000)});
      const targets=await response.json();
      target=targets.find(t=>t.type==='page' && decodeURIComponent(t.url).replace(/\\/g,'/').toLowerCase()
        === 'file:///c:/users/hugom/appdata/local/programs/cockpit/resources/app.asar/renderer/index.html');
      if(target)break;
    }catch{}
    await delay(500);
  }
  if(!target)throw new Error('A janela instalada não anunciou a interface esperada.');
  const client=await connect(target);
  try {
    let runtimeEnabled=false;
    while(Date.now()<deadline&&!runtimeEnabled){try{await client.send('Runtime.enable');runtimeEnabled=true;}catch(error){if(!/^Tempo esgotado: /.test(error.message))throw error;await delay(500);}}
    if(!runtimeEnabled)throw new Error('A depuração do renderer não respondeu durante a inicialização.');
    let ready=false, stableReadings=0;
    while(Date.now()<deadline) {
      try { ready=await client.evaluate(`(() => {try{return typeof cfg==='object' && cfg.abas?.length>0 && cfg.abaAtiva===${JSON.stringify(before.abaAtiva)} && !trocandoAba && montagemAdiada===0 && panes.size===${expectedActiveCount} && !!window.CockpitUI && !!document.querySelector('.ck-navigator') && typeof window.api?.versao==='function';}catch{return false;}})()`); }
      catch(error){if(!/^Tempo esgotado: Runtime.evaluate$/.test(error.message))throw error;ready=false;}
      if(client.runtimeErrors.length)throw new Error('Exceção real durante inicialização: '+JSON.stringify(client.runtimeErrors));
      stableReadings=ready ? stableReadings+1 : 0;
      if(stableReadings>=2)break;
      await delay(1000);
    }
    if(!ready || stableReadings<2)throw new Error('A interface redesenhada não terminou a restauração.');
    await client.evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
    await delay(1500);
    // Só os dados necessários são retornados; textos de conversa e credenciais ficam fora do relatório.
    const current=await client.evaluate(`(async()=>{
      if(!crypto?.subtle)throw new Error('Hash da inspeção indisponível neste contexto');
      const sha=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(value||''))))].map(b=>b.toString(16).padStart(2,'0')).join('');
      const tabs=await Promise.all(cfg.abas.map(async tab=>({id:tab.id,panels:await Promise.all((tab.paineis||[]).filter(p=>p&&(p.paneId||p.sessaoId||p.contexto||p.rascunho)).map(async p=>({engine:p.engine,session:p.sessaoId||'',draft:await sha(p.rascunho||'')})))})));
      tabs.forEach(t=>t.panels.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));tabs.sort((a,b)=>String(a.id).localeCompare(String(b.id)));
      const nav=document.querySelector('.ck-navigator'),rect=nav.getBoundingClientRect();
      const active=cfg.abas.find(a=>a.id===cfg.abaAtiva);
      const live=await Promise.all([...panes.values()].map(async p=>({engine:p.engine,session:p.sessaoId||p.resumeId||p.resumeAnterior||'',draft:await sha(p.el.querySelector('.p-input')?.value||'')})));
      live.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
      return {inventory:tabs,live,activeTab:cfg.abaAtiva,theme:document.documentElement.dataset.tema,expectedActivePanels:(active?.paineis||[]).filter(p=>p&&(p.paneId||p.sessaoId||p.contexto||p.rascunho)).length,panels:panes.size,navigationWidth:rect.width,navigationVisible:rect.width>0&&rect.height>0,sessionRows:document.querySelectorAll('.ck-session').length,overflow:document.documentElement.scrollWidth>innerWidth,bodyReady:document.body.classList.contains('ck-app'),version:await window.api.versao()};
    })()`);
    const checks={
      inventoryPreserved:JSON.stringify(current.inventory)===JSON.stringify(expectedInventory),
      activeTabPreserved:current.activeTab===before.abaAtiva,
      activePanelsRestored:current.panels===current.expectedActivePanels,
      liveSessionsAndDraftsPreserved:JSON.stringify(current.live)===JSON.stringify(expectedInventory.find(tab=>tab.id===before.abaAtiva)?.panels || []),
      navigationLoaded:current.navigationVisible && current.bodyReady,
      noHorizontalOverflow:!current.overflow,
      preloadAndIpc:typeof current.version==='string' && current.version.length>0,
      themePreserved:current.theme===(before.tema==='motti'?'azul':before.tema || 'escuro'),
      noRuntimeExceptions:client.runtimeErrors.length===0,
    };
    const screenshot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    const screenshotFile=path.join(runRoot,'cockpit-instalado.png');fs.writeFileSync(screenshotFile,Buffer.from(screenshot.data,'base64'));
    const report={status:Object.values(checks).every(Boolean)?'passed':'failed',checkedAt:new Date().toISOString(),checks,version:current.version,tabs:current.inventory.length,savedPanels:current.inventory.reduce((n,t)=>n+t.panels.length,0),activePanels:current.panels,navigationWidth:current.navigationWidth,theme:current.theme,runtimeErrors:client.runtimeErrors,screenshot:screenshotFile,promptsSent:0,preferencesChanged:false};
    fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
    if(report.status!=='passed')process.exitCode=1;
  } finally {client.close();}
}
main().catch(error=>{
  const report={status:'inconclusive',checkedAt:new Date().toISOString(),error:error.message,promptsSent:0,preferencesChanged:false};
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.error(error.message);process.exitCode=2;
});
