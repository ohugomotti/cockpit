'use strict';
// Somente fixtures em memória. Não importa Electron, não lê HOME e não inicia motores.
(() => {
  const qs = new URLSearchParams(location.search);
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const engines = ['claude','codex','gemini','grok','acp'];
  const calls = [], missing = new Set(), callbacks = new Map(), stopped = new Map();
  let configuration = {
    tema: ['escuro','azul','claro','jornal','motti'].includes(qs.get('tema')) ? qs.get('tema') : 'escuro',
    defCwd:'C:/Projetos/Demonstracao', tituloAuto:false, sugestoes:true, atalhosGlobais:false,
    motorVoz:'whisper', vozManda:false, verRobos:true, lastEngine:'claude',
    abaAtiva:'qa-produto', abas:[
      {id:'qa-produto',nome:'Produto',tipo:'local',caminhos:['C:/Projetos/Demonstracao'],paineis:[]},
      {id:'qa-site',nome:'Site institucional',tipo:'local',caminhos:['C:/Projetos/Site'],paineis:[]},
      {id:'qa-servidor',nome:'Servidor de teste',tipo:'ssh',host:'servidor.example.invalid',usuario:'demo',chave:'',caminhoRemoto:'/srv/projeto',paineis:[]}
    ]
  };
  function emit(channel, value) { for (const callback of callbacks.get(channel) || []) callback(clone(value)); }
  function account(engine = 'claude', remoto = null, pct) {
    const now = Date.now();
    return {entrou:true,email:`${engine}@exemplo.invalid`,plano:engine==='claude'?'Max':'Plus',via:'simulação',
      consultadoEm:now,onde:remoto?'Servidor de teste':'Este PC',
      ...(['claude','codex'].includes(engine) ? {
        sessao:{pct:pct == null ? engine==='claude'?34:52 : pct,reseta:new Date(now+3*3600000).toISOString(),mins:300},
        semana:{pct:pct == null ? engine==='claude'?72:43 : Math.max(0,pct-18),reseta:new Date(now+3*86400000).toISOString(),mins:10080}
      } : {})};
  }
  const histories = engines.reduce((result, engine) => {
    // title/when sao os nomes que o main.js devolve de verdade; titulo/mtime
    // ficaram so' por compatibilidade com scripts de QA antigos
    result[engine] = Array.from({length:4}, (_, i) => ({id:`qa-${engine}-${i}`,engine,
      title:['Ajustar navegação lateral','Revisar página inicial','Conferir integrações','Preparar nova versão'][i],
      titulo:['Ajustar navegação lateral','Revisar página inicial','Conferir integrações','Preparar nova versão'][i],
      cwd:'C:/Projetos/Demonstracao',when:Date.now()-i*3600000,mtime:Date.now()-i*3600000,data:Date.now()-i*3600000,resumeId:`qa-${engine}-${i}`}));
    return result;
  }, {});
  const models = [{id:'gpt-6-astra',nome:'GPT-6 Astra',name:'GPT-6 Astra',displayName:'GPT-6 Astra',padrao:true,contextWindow:1000000,supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'medium'},{reasoningEffort:'high'}],defaultReasoningEffort:'high'}];
  const implementation = {
    plataforma:'win32', temaInicial:configuration.tema,
    home:async ()=>'C:/QA', versao:async ()=>'Redesenho · prévia isolada',
    getConfig:async ()=>clone(configuration), setConfig:async data=>{configuration=clone(data);return true;},
    codexModels:async ()=>clone(models),
    motoresDisponiveis:async (...args)=>Object.fromEntries(engines.map(engine=>[engine,args.length?{disponivel:true,remoto:!!args[0],capacidades:{retomar:true}}:true])),
    motoresVersoes:async ()=>({}),
    contaLer:async value=>account(typeof value==='string'?value:value?.engine,value?.remoto),
    contasListar:async ()=>[{apelido:'Principal',atual:true,podeUsar:true},{apelido:'Projetos',atual:false,podeUsar:true}],
    contasDisponivel:async pedido=>{const engine=typeof pedido==='string'?pedido:pedido.engine,remoto=typeof pedido==='object'?pedido.remoto:null;const gerenciado=engine==='claude'||(engine==='codex'&&!remoto);return {ok:gerenciado,gerenciado,salvar:gerenciado,trocar:gerenciado,login:gerenciado,logout:gerenciado,consulta:['claude','codex'].includes(engine),orientacao:gerenciado?'':'A autenticação deste motor é administrada no terminal '+(remoto?'do servidor.':'do próprio agente.')};},
    contasComparar:async (engine,remoto)=>({onde:remoto?'Servidor de teste':'Este PC',contas:[
      {apelido:'Principal',atual:true,podeUsar:true,estado:'ok',dados:account(engine,remoto),consultadoEm:Date.now()},
      {apelido:'Projetos',atual:false,podeUsar:true,estado:'ok',dados:account(engine,remoto,19),consultadoEm:Date.now()},
      {apelido:'Conta antiga',atual:false,podeUsar:false,precisaLogin:true,estado:'login',dados:null,consultadoEm:Date.now(),erro:'Entre novamente para consultar.'}
    ]}),
    contasCompararCancelar:async ()=>true,
    contasSalvar:async ()=>({ok:true}), contasTrocar:async ()=>({ok:true}), contasEsquecer:async ()=>({ok:true}),
    sessionsClaude:async ()=>clone(histories.claude),sessionsCodex:async ()=>clone(histories.codex),
    sessionsCli:async engine=>clone(histories[engine]||[]),
    sessionHistory:async ()=>[],sessionHistoryRemoto:async ()=>[],sessionTitulo:async ()=>'',
    buscarConversas:async ()=>clone(Object.values(histories).flat()),
    listDir:async ()=>({entries:[{name:'src',path:'C:/Projetos/Demonstracao/src',dir:true},{name:'README.md',path:'C:/Projetos/Demonstracao/README.md',dir:false}]}),
    buscarArquivos:async ()=>[{nome:'app.js',name:'app.js',path:'C:/Projetos/Demonstracao/src/app.js',caminho:'C:/Projetos/Demonstracao/src/app.js'}],
    readFile:async ()=>({content:'# Arquivo de demonstração\nNenhum arquivo pessoal é lido.'}),
    verArquivo:async ()=>({tipo:'texto',dados:'# Prévia isolada',nome:'README.md',path:'C:/Projetos/Demonstracao/README.md',ext:'md',bytes:17}),
    gitStatus:async ()=>({branch:'redesenho',ramo:'redesenho',files:[],arquivos:[],changed:0}),
    gitDiff:async ()=>'diff --git a/app.js b/app.js\n+const pronto = true;',
    gitWorktreesList:async ()=>[],
    agentesClaude:async ()=>[],agentesSessao:async ()=>[],
    rotinasListar:async ()=>({ok:true,rotinas:[],tarefas:[],itens:[],suportado:true}),
    audioMotor:async ()=>({ok:true,motor:'whisper'}),audioMotorInfo:async ()=>({baixado:true}),audioDisponivel:async ()=>false,
    inboxPasta:async ()=>'C:/QA/inbox',inboxOuvindo:async ()=>true,
    atalhosEstado:async ()=>({falhos:[]}),atalhosLigar:async ()=>({falhos:[]}),
    promptsLer:async ()=>[],promptsSalvar:async ()=>true,
    skills:async ()=>[],codexApps:async ()=>[],mcpList:async ()=>[],mcpDiagnostico:async ()=>({itens:[],conectores:[]}),
    acpConfig:async ()=>({comando:'agente-acp',args:[]}),
    debateList:async ()=>[],debateGet:async ()=>null,debateLeitura:async ()=>({disponivel:true}),
    retomarPegar:async ()=>null,paradaEm:id=>stopped.get(String(id))||0,
    paneStart:async options=>{queueMicrotask(()=>emit('onPaneEvent',{paneId:options.paneId,kind:'sessao',id:`qa-session-${options.paneId}`}));return {ok:true};},
    paneSend:async options=>{emit('onPaneEvent',{paneId:options.paneId,kind:'busy'});return true;},
    paneSteer:async ()=>true,paneInterrupt:async ()=>true,paneStop:async options=>{stopped.set(String(options.paneId),Date.now());return true;},
    approve:async ()=>true,perguntaResponder:async ()=>true,
    tituloAuto:async ()=>({titulo:'Conversa de teste'}),
    termRun:async options=>{const id=options?.id||'qa-term';setTimeout(()=>emit('onTermEvent',{id,kind:'data',data:'Terminal simulado. Nenhum comando será executado.\r\n> '}),30);return {id};},
    termInput:async ()=>true,termResize:async ()=>true,termKill:async ()=>true,
    textoCopiado:async ()=>'texto de teste',copiarTexto:async ()=>true,colados:async ()=>[],
    pickFiles:async ()=>[],pickFolder:async ()=>null,pickPhoto:async ()=>null,
    anexoLer:async ()=>({error:'Nenhum arquivo real é lido na prévia.'}),
    openPath:async ()=>false,abrirLink:async ()=>false,openUrl:async ()=>false,
    auth:async ()=>({error:'Login real indisponível na prévia isolada.'})
  };
  window.api = new Proxy(implementation,{get(target,key){
    if (key in target) {const value=target[key];return typeof value==='function'?(...args)=>{calls.push({method:key,args:clone(args)});return value(...args);}:value;}
    if (typeof key==='string' && key.startsWith('on')) return callback=>{const listeners=callbacks.get(key)||new Set();listeners.add(callback);callbacks.set(key,listeners);return ()=>listeners.delete(callback);};
    return async (...args)=>{calls.push({method:key,args:clone(args)});missing.add(key);return null;};
  }});
  window.__qa = {calls,missing,emit,account,override:(key,handler)=>{implementation[key]=handler;},get configuration(){return clone(configuration);},fixture:qs.get('cenario')||'supervisao',ready:false,errors:[]};
  addEventListener('error',event=>window.__qa.errors.push(String(event.error?.stack||event.message)));
  addEventListener('unhandledrejection',event=>window.__qa.errors.push(String(event.reason?.stack||event.reason)));
  window.Notification = class {static permission='denied';static async requestPermission(){return 'denied';}close(){}};
})();
