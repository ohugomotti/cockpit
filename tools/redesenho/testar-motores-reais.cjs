'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const run=read(path.join(root,'artifacts/testes-reais-atual.json'));
if(path.dirname(run.run)!==path.join(root,'artifacts')||!run.authorized||run.port!==9441)throw Error('Perfil de teste inválido');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const tabs=await fetch('http://127.0.0.1:9441/json/list').then(r=>r.json());
 const target=tabs.find(t=>t.type==='page'&&decodeURIComponent(t.url).toLowerCase()==='file:///c:/users/hugom/appdata/local/programs/cockpit/resources/app.asar/renderer/index.html');if(!target)throw Error('Janela de testes ausente');
 const url=new URL(target.webSocketDebuggerUrl);if(!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='9441')throw Error('Destino fora do teste');
 const ws=new WebSocket(url);let sequence=0;const pending=new Map(),exceptions=[];
 await new Promise((resolve,reject)=>{let timer=setTimeout(()=>reject(Error('Conexão expirou')),5000);ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('CDP falhou'));},{once:true});});
 ws.addEventListener('message',ev=>{const d=JSON.parse(String(ev.data));if(d.method==='Runtime.exceptionThrown')exceptions.push((d.params.exceptionDetails.exception?.description||d.params.exceptionDetails.text).split('\n')[0]);const p=pending.get(d.id);if(p){clearTimeout(p.timer);pending.delete(d.id);d.error?p.reject(Error(d.error.message)):p.resolve(d.result);}});
 const rpc=(method,params={},timeoutMs=45000)=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Timeout '+method));},timeoutMs);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await rpc('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;};
 const scenario=process.argv[2]||'inspect';const oldFile=path.join(run.run,scenario+'-resultados.json');const results=fs.existsSync(oldFile)?read(oldFile).results:[];
 const output=path.join(run.run,scenario+'-resultados.json');
 const save=()=>{const latest=[...new Map(results.map(r=>[r.engine,r])).values()];fs.writeFileSync(output,JSON.stringify({status:latest.some(r=>r.status==='failed')?'failed':latest.some(r=>r.status==='running')?'running':'completed',updatedAt:new Date().toISOString(),latest,results,exceptions},null,2)+'\n');};
 try{
  await rpc('Runtime.enable');
  const config=await evaluate('window.api.getConfig()');if(config.testesReais!=='autorizados-20260920'||config.defCwd!==run.workspace)throw Error('Recusado: janela de trabalho real');
  if(scenario==='attachments'){await require('./anexos-reais.cjs')({evaluate,run});return;}
  if(scenario==='features'){await require('./funcionalidades-reais.cjs')({rpc,evaluate,run,read});return;}
  await evaluate(`if(!window.__realTests){window.__realTests={events:[],ids:[],errors:[]};window.api.onPaneEvent(e=>{if(__realTests.ids.includes(e.paneId))__realTests.events.push(e);});}`);
  let remote=null;
  if(scenario==='remote'){
   const actual=read(path.join(process.env.APPDATA,'cockpit/config.json'));const tab=actual.abas.find(a=>a.tipo==='ssh');if(!tab)throw Error('Nenhum destino SSH configurado');remote={host:tab.host,usuario:tab.usuario,chave:tab.chave,porta:tab.porta||22,caminhoRemoto:tab.caminhoRemoto||'~'};
   await evaluate(`(()=>{if(!cfg.abas.some(a=>a.id==='qa-real-remote'))cfg.abas.push({...${JSON.stringify(remote)},id:'qa-real-remote',nome:'Teste SSH real',tipo:'ssh',paineis:[]});})()`);
  }
  const available=await evaluate('window.api.motoresDisponiveis('+JSON.stringify(remote)+')');
  fs.writeFileSync(path.join(run.run,scenario+'-motores.json'),JSON.stringify(available,null,2)+'\n');
  console.log(JSON.stringify({stage:'availability',scenario,available}));
  if(scenario==='inspect'){console.log(JSON.stringify(await evaluate(`__realTests.ids.map(id=>{const p=acharPainel(id);return{id,engine:p?.engine,busy:!!p?.busy,completed:!!p?.uiCompleted,assistant:[...(p?.chat?.querySelectorAll('.msg.bot .msg-body')||[])].map(n=>n.textContent.slice(0,500))};})`)));return;}
  const engines=process.argv[3]?process.argv[3].split(','):scenario==='remote'?['claude','codex']:['claude','codex','gemini','grok','acp'];
  for(const engine of engines){
   if(!available[engine]?.disponivel||(engine==='acp'&&!available.gemini?.disponivel)){results.push({engine,scenario,status:'unavailable',reason:'Motor/preset não disponível no destino'});save();continue;}
   const model={claude:'claude-sonnet-5',codex:'gpt-6-astra',acp:'gemini --acp'}[engine]||'';
   const marker='COCKPIT_REAL_OK_'+scenario.toUpperCase()+'_'+engine.toUpperCase();
   const prompt='Teste técnico autorizado do Cockpit. Não use ferramentas, não leia arquivos, não pesquise e não execute ações. Responda apenas com este marcador exato: '+marker;
   const row={engine,scenario,model,status:'running',startedAt:new Date().toISOString(),prompt,turns:1};results.push(row);save();console.log(JSON.stringify({stage:'prompt-start',engine,scenario}));
   let id;
   try{
    id=await evaluate(`(()=>{const p=newPane({engine:${JSON.stringify(engine)},model:${JSON.stringify(model)},mode:${JSON.stringify(engine==='gemini'?'plan':engine==='grok'?'bypass':'manual')},effort:'low',cwd:${JSON.stringify(remote?(remote.caminhoRemoto==='~'?'/home/'+remote.usuario:remote.caminhoRemoto):run.workspace)},abaId:${JSON.stringify(remote?'qa-real-remote':'qa-real-local')},titulo:${JSON.stringify('Teste real '+scenario+' '+engine)}});__realTests.ids.push(p.id);p.el.querySelector('.p-input').value=${JSON.stringify(prompt)};void send(p).catch(e=>__realTests.errors.push({id:p.id,message:e.message}));return p.id;})()`);
    row.paneId=id;save();let snapshot;const deadline=Date.now()+180000;
    while(Date.now()<deadline){
     await delay(600);
     snapshot=await evaluate(`(()=>{const id=${JSON.stringify(id)},p=acharPainel(id),ev=__realTests.events.filter(e=>e.paneId===id);return{exists:!!p,busy:!!p?.busy,starting:!!p?.ligando,started:!!p?.started,session:p?.sessaoId||p?.resumeId||'',completed:!!p?.uiCompleted,terminalError:!!p?.uiTerminalError,states:ev.map(e=>e.kind),turnEnd:ev.some(e=>e.kind==='turn-end'),texts:(ev.some(e=>e.kind==='text-final')?ev.filter(e=>e.kind==='text-final'):ev.filter(e=>e.kind==='text-delta')).map(e=>e.text||''),notes:ev.filter(e=>e.kind==='note'&&e.error).map(e=>e.text),errors:__realTests.errors.filter(e=>e.id===id),rendered:[...(p?.chat?.querySelectorAll('.msg.bot .msg-body')||[])].some(n=>n.textContent.includes(${JSON.stringify(marker)})),pending:!!p?.perguntaAberta||!!p?.filaPerm?.length};})()`);
     row.busyObserved=row.busyObserved||snapshot.busy||snapshot.starting;
     if(snapshot.turnEnd||snapshot.errors.length||snapshot.notes.length||snapshot.pending||(!snapshot.started&&!snapshot.starting&&!snapshot.busy))break;
    }
    const exactResponse=snapshot.texts.join('').includes(marker);
    Object.assign(row,{status:snapshot.turnEnd&&exactResponse&&snapshot.rendered&&!snapshot.terminalError?'passed':'failed',response:snapshot.texts.join('').slice(0,1200),rendered:snapshot.rendered,turnEnd:snapshot.turnEnd,busyAfter:snapshot.busy,completed:snapshot.completed,session:snapshot.session,eventKinds:[...new Set(snapshot.states)],notes:snapshot.notes,errors:snapshot.errors,pending:snapshot.pending,finishedAt:new Date().toISOString()});
    try {const picture=await rpc('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},8000);fs.writeFileSync(path.join(run.run,scenario+'-'+engine+'.png'),Buffer.from(picture.data,'base64'));}catch(e){row.captureWarning=e.message;}
   }catch(e){row.status='failed';row.error=e.message;}
   finally{if(id)try{await evaluate(`window.api.paneStop({paneId:${JSON.stringify(id)},engine:${JSON.stringify(engine)}})`);}catch(e){row.stopError=e.message;}}
   if(row.status==='failed'&&/weekly limit|usage limit|rate.limit|quota|capacity/i.test([row.response,...(row.notes||[])].join(' ')))row.status='blocked-by-provider';
   save();console.log(JSON.stringify({stage:'prompt-end',...row}));
  }
 }finally{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Teste encerrado'));}ws.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
