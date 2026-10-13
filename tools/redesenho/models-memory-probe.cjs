'use strict';
// Leitura isolada de históricos locais, sem iniciar motores ou gravar o perfil instalado.
const fs=require('node:fs'),path=require('node:path');
module.exports=async(window,{js,wait,check,expect,app,ipcMain,root,run,work,installedConfigPath})=>{
  const intercept=(channel,handler)=>{ipcMain.removeHandler(channel);ipcMain.handle(channel,handler);};
  const catalog=[
    {id:'gpt-6.1-sol',nome:'GPT-6.1-Sol',efforts:['low','medium','high','xhigh','max'],modalitiesConfirmed:true,inputModalities:['text','image']},
    {id:'gpt-6-astra',nome:'GPT-6-Astra',efforts:['low','medium','high','xhigh','max']},
    {id:'gpt-6-sol',nome:'GPT-6-Sol',efforts:['low','medium','high','xhigh','max']},
    {id:'gpt-6-luna',nome:'GPT-6-Luna',efforts:['low','medium','high','xhigh','max']},
    {id:'gpt-5.6-sol',nome:'GPT-5.6-Sol',efforts:['high']},
    {id:'gpt-5.6-terra',nome:'GPT-5.6-Terra',efforts:['high']},
    {id:'gpt-5.6-luna',nome:'GPT-5.6-Luna',efforts:['high']},
  ];
  const claude=['claude-haiku-4-5-20251001','claude-sonnet-5-5','claude-opus-5-5','claude-fable-5-1'].map(id=>({id,efforts:['low','high','max']}));
  intercept('codex:models',()=>catalog); intercept('claude:models',()=>claude);
  intercept('motores:disponiveis',()=>Object.fromEntries(['claude','codex','gemini','grok','acp'].map(e=>[e,{disponivel:true}])));
  let stops=0; intercept('pane:stop',()=>{stops++;return true;});
  const links=[]; intercept('shell:link',(_e,url)=>{links.push(url);return true;});
  intercept('conta:ler',()=>({needsAuth:true,account:null}));
  // O IPC e a referência do pacote são reais; a rede está bloqueada no bootstrap.
  const catalogIds=()=>js("[...document.querySelectorAll('.ck-model-options [data-model]')].map(b=>b.dataset.model)");
  async function until(source){for(let i=0;i<120;i++){if(await js(source))return;await wait(50);}throw Error('Timeout: '+source);}
  async function capture(name){await js('document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).forEach(a=>{try{a.finish();}catch{}});document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');window.webContents.invalidate();await wait(250);fs.writeFileSync(path.join(root,'artifacts/'+name+'.png'),(await window.webContents.capturePage()).toPNG());}
  window.setBounds({width:1440,height:920});
  window.setTitle('Cockpit — teste isolado de modelos'); window.showInactive();
  await js(`cfg.tema='jornal';aplicarTema(cfg.tema);sairDaAbertura();window.qaModel=newPane({engine:'codex',cwd:${JSON.stringify(work)},abaId:cfg.abaAtiva,model:'gpt-6.1-sol',effort:'high'});window.qaAgent=CockpitUI.agentLayer(qaModel);void 0`);
  await until("!!document.querySelector('.ck-benchmark-source') && document.querySelector('.ck-model-options')?.textContent.includes('AA 53')");
  await check('Janela real ordena poder, preserva modelo/esforço e não desenha imagens nos nomes',async()=>{
    expect((await catalogIds())[0]==='gpt-6-astra','Mais recente continuou primeiro.');
    const state=await js("({model:qaModel.model,effort:qaModel.effort,images:document.querySelectorAll('.ck-model-capabilities,.ck-model-title img').length,icons:document.querySelectorAll('.ck-model-sort svg').length===3&&[...document.querySelectorAll('.ck-model-sort svg')].every(s=>s.childElementCount>0)})");
    expect(state.model==='gpt-6.1-sol'&&state.effort==='high'&&!state.images&&state.icons,'Escolha mudou ou ícones vazios.');return state;
  });
  await capture('modelos-poder-jornal');
  await check('Ordenar cota não troca o modelo nem fecha o cérebro',async()=>{
    await js("document.querySelector('[data-order=quota]').click();void 0");
    expect((await catalogIds())[0]==='gpt-6-luna','Cota menor não veio primeiro.');
    expect(await js("qaModel.model==='gpt-6.1-sol'&&!!document.querySelector('.ck-agent')"),'Janela fechou ou modelo mudou.');
  });
  await capture('modelos-cota-jornal');
  await check('Links abrem a fonte e a referência da cota pelo IPC correto',async()=>{
    await js("document.querySelector('.ck-model-order button:last-child').click();document.querySelector('.ck-quota-source').click();void 0");await wait(60);
    expect(links.includes('https://artificialanalysis.ai/leaderboards/models')&&links.includes('https://learn.chatgpt.com/docs/pricing'),'Link não passou pelo abridor real.');
  });
  await check('Cota do Claude e troca de motor mantêm a janela',async()=>{
    await js("document.querySelector('.ck-engine-option[data-motor=claude]').click();void 0");
    await until("document.querySelector('.ck-agent').dataset.engine==='claude'&&!!document.querySelector('[data-model=\"claude-haiku-4-5-20251001\"]')");
    expect((await catalogIds())[0]==='claude-haiku-4-5-20251001','Haiku não veio primeiro na cota.');
    await js("document.querySelector('[data-order=power]').click();void 0");
    expect((await catalogIds())[0]==='claude-opus-5-5','Opus não veio primeiro pelo ranking.');
    expect(await js("document.querySelector('[data-model=\"claude-fable-5-1\"]').textContent.includes('Cota sem comparação')"),'Cota do Fable foi inventada.');
  });
  await capture('modelos-claude-jornal');
  await check('390px: janela e conteúdo não transbordam',async()=>{
    window.setMinimumSize(320,300);
    window.setBounds({width:390,height:844});await wait(180);
    const state=await js("(()=>{const p=document.querySelector('.ck-agent'),r=p.getBoundingClientRect();return{x:r.x,right:r.right,width:innerWidth,overflow:p.scrollWidth>p.clientWidth+1}})()");
    expect(state.x>=0&&state.right<=state.width+1&&!state.overflow,'Janela transbordou.');return state;
  });
  await capture('modelos-mobile');
  window.hide();
  await js('while(CockpitUI.layers.length)CockpitUI.closeLayer();void 0');
  window.setBounds({width:1440,height:920});
  await js("qaModel.el.remove();panes.delete(qaModel.id);panesFundo.delete(qaModel.id);focusPane=null;window.qaModel=null;cfg.abas[0].paineis=[];void 0");
  const memory=[];
  async function sample(label){
    await wait(250);
    const processes=app.getAppMetrics().map(p=>({type:p.type,workingMB:Math.round(p.memory.workingSetSize/1024*10)/10,privateMB:Math.round(p.memory.privateBytes/1024*10)/10}));
    const renderer=processes.filter(p=>p.type==='Tab');
    const state=await js('({panels:panes.size+panesFundo.size,visible:panes.size,heapMB:performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):null,messages:[...panes.values(),...panesFundo.values()].reduce((n,p)=>n+(p.hist?.length||0),0)})');
    const result={label,...state,processes,workingMB:Math.round(processes.reduce((n,p)=>n+p.workingMB,0)*10)/10,rendererWorkingMB:Math.round(renderer.reduce((n,p)=>n+p.workingMB,0)*10)/10};
    memory.push(result);return result;
  }
  await sample('base-sem-conversas');
  const config=JSON.parse(fs.readFileSync(installedConfigPath,'utf8'));
  const local=config.abas.filter(a=>a.tipo!=='ssh').flatMap(a=>(a.paineis||[]).filter(p=>p.file&&fs.existsSync(p.file)).map(p=>({engine:p.engine,file:p.file,id:p.sessaoId})));
  let totalFileBytes=0, loaded=0, retained=0;
  const timing=[];
  for (const item of local) {
    totalFileBytes+=fs.statSync(item.file).size;
    // Caminhos explícitos são lidos pelo leitor real. codex.pronto=false: usa JSONL,
    // sem servidor, sem retomar a thread e sem consultar sessões da conta.
    const start=Date.now();
    const result=await js(`(async()=>{const msgs=await window.api.sessionHistory(${JSON.stringify({...item,inteiro:true})});const p=newPane({engine:${JSON.stringify(item.engine)},cwd:${JSON.stringify(work)},abaId:cfg.abaAtiva,titulo:'Histórico isolado'});desenharHistorico(p,msgs);p.sessaoId=null;p.started=false;const count=p.hist.length;p.el.remove();panes.delete(p.id);panesFundo.set(p.id,p);return {count,id:p.id};})()`);
    loaded++;retained+=result.count;timing.push({messages:result.count,loadMs:Date.now()-start});
    if(loaded===1||loaded%5===0)await sample(loaded+'-historicos-locais');
    if(memory.at(-1).rendererWorkingMB>900)break; // preservar folga do computador durante a medição
  }
  await sample('historicos-locais-carregados');
  await check('Voltar à aba reutiliza a mesma tela e não relê o histórico',async()=>{
    let reads=0;intercept('sessions:history',()=>{reads++;return [];});
    await js("window.qaBefore=[...panesFundo.values()].map(p=>({p,el:p.el,hist:p.hist}));trazerPaineisDoFundo(cfg.abaAtiva);void 0");
    const before=stops,start=Date.now();await js('guardarPaineisDaAba()');const storeMs=Date.now()-start;
    const restoreStart=Date.now();await js('trazerPaineisDoFundo(cfg.abaAtiva);void 0');const restoreMs=Date.now()-restoreStart;
    expect(await js('qaBefore.every(v=>v.p.el===v.el&&v.p.hist===v.hist&&panes.get(v.p.id)===v.p)'),'Tela ou histórico reconstruído.');
    expect(reads===0,'Histórico foi relido.');
    return {reads,storeMs,restoreMs,motorsStopped:stops-before};
  });
  return {memory,historyMeasurement:{savedPanels:config.abas.reduce((n,a)=>n+(a.paineis||[]).length,0),localFilesAvailable:local.length,loaded,
    retainedMessages:retained,sourceFileMB:Math.round(totalFileBytes/1048576*10)/10,timing,
    scope:'Históricos locais reais, motores desligados. Exclui arquivos da VPS e motores/MCPs. O JSONL inclui ferramentas e anexos, não apenas texto visível.'},links,run};
};
