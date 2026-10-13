'use strict';
// Somente fixtures em memória. Não importa Electron, não lê HOME e não inicia motores.
(() => {
  const qs = new URLSearchParams(location.search);
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const engines = ['claude','codex','gemini','grok','acp'];
  const calls = [], missing = new Set(), callbacks = new Map(), stopped = new Map();
  const readerStates = new Map(), readerDocuments = new Set(), activeAccounts = new Map();
  const accountKey = (engine, remote) => JSON.stringify([engine, remote?.host || '', remote?.usuario || '', remote?.porta || 22]);
  const sha = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),v=>v.toString(16).padStart(2,'0')).join('');
  let systemAppearance = {dark:qs.get('sistema') !== 'claro',accent:'#007aff',platform:'win32'};
  let configuration = {
    tema: ['escuro','azul','claro','jornal','motti','automatico'].includes(qs.get('tema')) ? qs.get('tema') : 'escuro',
    visualMac:qs.get('visual') === '1',
    defCwd:'C:/Projetos/Demonstracao', tituloAuto:false, sugestoes:true, atalhosGlobais:false,
    motorVoz:'whisper', vozManda:false, verRobos:true, lastEngine:'claude',
    abaAtiva:'qa-produto', abas:[
      {id:'qa-produto',nome:'Produto',tipo:'local',caminhos:['C:/Projetos/Demonstracao'],paineis:[]},
      {id:'qa-site',nome:'Site institucional',tipo:'local',caminhos:['C:/Projetos/Site'],paineis:[]},
      {id:'qa-servidor',nome:'Servidor de teste',tipo:'ssh',host:'servidor.example.invalid',usuario:'demo',chave:'',caminhoRemoto:'/srv/projeto',paineis:[]}
    ]
  };
  function emit(channel, value) { for (const callback of callbacks.get(channel) || []) callback(clone(value)); }
  const scans = new Map();
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
    visualMacInicial:configuration.visualMac, systemAppearanceInicial:clone(systemAppearance),
    getSystemAppearance:async ()=>clone(systemAppearance),
    setVisualMac:async value=>{configuration.visualMac=!!value;return {ok:true,visualMac:!!value};},
    setWindowTheme:async ()=>({ok:true}), showWindowMenu:async ()=>({ok:true}),
    setAttentionBadge:async count=>({ok:true,count:Math.max(0,Math.trunc(Number(count)||0))}),
    home:async ()=>'C:/QA', versao:async ()=>'Redesenho · prévia isolada',
    getConfig:async ()=>clone(configuration), setConfig:async data=>{configuration=clone(data);return true;},
    codexModels:async ()=>clone(models),
    claudeModels:async ()=>({models:[
      {id:'claude-opus-5-5',nome:'Opus',efforts:['low','medium','high','xhigh','max'],padraoEffort:'medium',padrao:true,catalogConfirmed:true},
      {id:'claude-fable-5-1[1m]',nome:'Fable',efforts:['low','medium','high','xhigh','max'],padraoEffort:'high',catalogConfirmed:true},
      {id:'claude-sonnet-5-5',nome:'Sonnet',efforts:['low','medium','high','xhigh','max'],padraoEffort:'medium',catalogConfirmed:true},
      {id:'claude-haiku-4-5-20251001',nome:'Haiku',efforts:[],padraoEffort:'',catalogConfirmed:true}
    ]}),
    motoresDisponiveis:async (...args)=>Object.fromEntries(engines.map(engine=>[engine,args.length?{disponivel:true,remoto:!!args[0],capacidades:{retomar:true}}:true])),
    motoresVersoes:async ()=>({}),
    motoresAtualizacoes:async ()=>({enabled:false,running:false,engines:{}}),
    contaLer:async value=>account(typeof value==='string'?value:value?.engine,value?.remoto),
    contasListar:async ()=>[{apelido:'Principal',atual:true,podeUsar:true},{apelido:'Projetos',atual:false,podeUsar:true}],
    contasDisponivel:async pedido=>{const engine=typeof pedido==='string'?pedido:pedido.engine,remoto=typeof pedido==='object'?pedido.remoto:null;const gerenciado=engine==='claude'||(engine==='codex'&&!remoto);return {ok:gerenciado,gerenciado,salvar:gerenciado,trocar:gerenciado,login:gerenciado,logout:gerenciado,consulta:['claude','codex'].includes(engine),orientacao:gerenciado?'':'A autenticação deste motor é administrada no terminal '+(remoto?'do servidor.':'do próprio agente.')};},
    contasComparar:async (engine,remoto)=>({onde:remoto?'Servidor de teste':'Este PC',contas:[
      {apelido:'Principal',atual:(activeAccounts.get(accountKey(engine,remoto))||'Principal')==='Principal',podeUsar:true,estado:'ok',dados:account(engine,remoto),consultadoEm:Date.now()},
      {apelido:'Projetos',atual:activeAccounts.get(accountKey(engine,remoto))==='Projetos',podeUsar:true,estado:'ok',dados:account(engine,remoto,19),consultadoEm:Date.now()},
      {apelido:'Conta antiga',atual:false,podeUsar:false,precisaLogin:true,estado:'login',dados:null,consultadoEm:Date.now(),erro:'Entre novamente para consultar.'}
    ]}),
    contasCompararCancelar:async ()=>true,
    contasSalvar:async ()=>({ok:true}), contasTrocar:async o=>{activeAccounts.set(accountKey(o.engine,o.remoto),o.apelido);return {ok:true};}, contasEsquecer:async ()=>({ok:true}),
    codexReiniciar:async ()=>({ok:true}),
    sessionsClaude:async ()=>clone(histories.claude),sessionsCodex:async ()=>clone(histories.codex),
    sessionsScan:async request=>{
      const state={cancelled:false};scans.set(request.requestId,state);
      const items=clone(histories[request.engine]||[]);
      try {
        for(let i=0;i<items.length;i+=2){
          await new Promise(resolve=>setTimeout(resolve,35));
          if(state.cancelled)return{requestId:request.requestId,cancelled:true};
          emit('onSessionsProgress',{requestId:request.requestId,engine:request.engine,items:items.slice(i,i+2),scanned:Math.min(i+2,items.length),complete:false});
        }
        return{requestId:request.requestId,items,complete:true};
      }finally{scans.delete(request.requestId);}
    },
    sessionsCancel:async id=>{const state=scans.get(id);if(!state)return false;state.cancelled=true;return true;},
    sessionsCli:async engine=>clone(histories[engine]||[]),
    sessionHistory:async ()=>[],sessionHistoryRemoto:async ()=>[],sessionTitulo:async ()=>'',
    buscarConversas:async ()=>clone(Object.values(histories).flat()),
    listDir:async ()=>({entries:[{name:'src',path:'C:/Projetos/Demonstracao/src',dir:true},{name:'README.md',path:'C:/Projetos/Demonstracao/README.md',dir:false}]}),
    buscarArquivos:async ()=>[{nome:'app.js',name:'app.js',path:'C:/Projetos/Demonstracao/src/app.js',caminho:'C:/Projetos/Demonstracao/src/app.js'}],
    readFile:async ()=>({content:'# Arquivo de demonstração\nNenhum arquivo pessoal é lido.'}),
    verArquivo:async o=>{
      const file=typeof o==='string'?o:o?.file||o?.path||'C:/Projetos/Demonstracao/README.md',remote=o?.remoto;
      const dados='# Prévia isolada\n\n## O que muda\n\nBusque palavras, navegue pelo sumário ou selecione este trecho para comentar.\n\n## Próximos passos\n\nOs comentários ficam separados do arquivo original.\n';
      const origin=remote?{kind:'remote',host:remote.host,user:remote.usuario||'',port:Number(remote.porta)||22}:{kind:'local'};
      const document={id:await sha(JSON.stringify([origin,file])),path:file,origin,version:await sha(dados)};
      readerDocuments.add(document.id);
      return {tipo:'texto',dados,nome:file.split(/[\\/]/).pop(),path:file,ext:'md',bytes:new TextEncoder().encode(dados).length,document};
    },
    // PDF do leitor: na prévia nenhuma janela abre; o main de verdade responde { ok } ou { error }
    abrirPdf:async ()=>({ok:true}),
    // Imagem dentro do .md (Task 4): um retângulo SVG "imagem de teste", igual para arquivo e para https (nenhuma imagem real é lida nem buscada)
    imagemDoMd:async ()=>({dados:'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNjAiIGhlaWdodD0iOTAiPjxyZWN0IHdpZHRoPSIxNjAiIGhlaWdodD0iOTAiIGZpbGw9IiNjZmQ4ZGMiLz48dGV4dCB4PSI4MCIgeT0iNTAiIGZvbnQtc2l6ZT0iMTMiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiMzNzQ3NGYiPmltYWdlbSBkZSB0ZXN0ZTwvdGV4dD48L3N2Zz4='}),
    readerCommentsGet:async document=>readerDocuments.has(document.id)?{ok:true,state:clone(readerStates.get(document.id)||{revision:0,comments:[],draft:null,view:{}})}:{ok:false,error:'Documento não aberto.'},
    readerCommentsSave:async o=>{
      if(!readerDocuments.has(o.document.id))return {ok:false,error:'Documento não aberto.'};
      const state=readerStates.get(o.document.id)||{revision:0,comments:[],draft:null,view:{}};
      if(o.expectedRevision!==state.revision)return {ok:false,code:'CONFLICT',error:'Outra janela atualizou os comentários.',state:clone(state)};
      const next={...state,revision:state.revision+1};for(const key of ['comments','draft','view'])if(key in o)next[key]=clone(o[key]);
      readerStates.set(o.document.id,next);return {ok:true,state:clone(next)};
    },
    // Vigia do arquivo aberto (Task 5): nada e vigiado de verdade; o QA simula o aviso do main com __qa.emit('onArquivoMudou', { chave, arquivo, evento })
    vigiarArquivo:async ()=>({ok:true}),pararVigia:async ()=>({ok:true}),
    gitStatus:async ()=>({branch:'redesenho',ramo:'redesenho',files:[],arquivos:[],changed:0}),
    gitDiff:async ()=>'diff --git a/app.js b/app.js\n+const pronto = true;',
    gitWorktreesList:async ()=>[],
    agentesClaude:async ()=>[],agentesSessao:async ()=>[],
    // Leia a conversa do agente (Workflow dos agentes, leva 5i): duas falas de exemplo; nada e' lido de disco
    agentHistory:async()=>({messages:[{role:'user',text:'Revise o estilo da página de vendas e me diga o que mudar.'},{role:'bot',text:'Revisei: 3 ajustes de espaçamento e 1 de contraste no botão principal.'}]}),
    // Nome dos agentes (Tarefa 7): sem nome por padrao (fica o do motor); ?cenario=agentes troca por nomes fixos
    agentesNomes:async ()=>({}),
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
    // Plano pronto (Tarefa 8): o main aceita a resposta; sem "modo", a tela volta pro modo de antes do Plano
    panePlano:async ()=>({ok:true}),
    // Desfazer a edição (Tarefa 9): meio segundo de "Desfazendo…" e deu certo (nenhum arquivo é tocado)
    desfazerEdicao:()=>new Promise(resolve=>setTimeout(()=>resolve({ok:true}),500)),
    tituloAuto:async ()=>({titulo:'Conversa de teste'}),
    tituloCancelar:async ()=>({ok:true}),
    // Mais detalhes (Tarefa 3): meio segundo de "Pensando" e um markdown curto com um caminho de arquivo
    detalhePerguntar:()=>new Promise(resolve=>setTimeout(()=>resolve({ok:true,texto:'**Em resumo:** este trecho diz que a barra junta as conversas por pasta.\n\n- Cada pasta vira um grupo.\n- O código fica em C:/Projetos/Demonstracao/src/app.js.\n\nPergunte mais embaixo se quiser.'}),500)),
    detalheCancelar:async ()=>({ok:true}),
    termRun:async options=>{const id=options?.id||'qa-term';setTimeout(()=>emit('onTermEvent',{id,kind:'data',data:'Terminal simulado. Nenhum comando será executado.\r\n> '}),30);return {id};},
    termInput:async ()=>true,termResize:async ()=>true,termKill:async ()=>true,
    textoCopiado:async ()=>'texto de teste',copiarTexto:async ()=>true,
    colarSalvarImagem:async (arrayBuffer,mimeType)=>({arquivo:'C:\\QA\\colado-qa.png'}),
    quadroSalvar:async o=>({ok:true,arquivo:o?.arquivo||'C:\\QA\\desenho.excalidraw'}),
    quadroSalvarComo:async ()=>({ok:true,arquivo:'C:\\QA\\desenho-copia.excalidraw'}),
    mostrarNaPasta:async ()=>({ok:true}),
    colados:async ()=>({arquivos:[]}),
    pickFiles:async ()=>[],pickFolder:async ()=>null,pickPhoto:async ()=>null,
    anexoLer:async ()=>({error:'Nenhum arquivo real é lido na prévia.'}),
    openPath:async ()=>false,abrirLink:async ()=>false,openUrl:async ()=>false,
    // Navegador interno (leva 5i): a previa nao tem pagina nativa (e' um WebContentsView do main). Os comandos respondem { ok: true } e ficam em
    // __qa.calls como "navegador.abrir" etc.; o QA simula o que o main avisa por __qa.emit('navegadorEstado', {...}) e __qa.emit('navegadorDownload', {...}).
    navegador:Object.fromEntries([
      ...['abrir','posicionar','visivel','voltar','avancar','recarregar','parar','irPara','externo','fechar'].map(nome=>[nome,async (...args)=>{calls.push({method:'navegador.'+nome,args:clone(args)});return {ok:true};}]),
      ['onEstado',callback=>{const ouvintes=callbacks.get('navegadorEstado')||new Set();ouvintes.add(callback);callbacks.set('navegadorEstado',ouvintes);return ()=>ouvintes.delete(callback);}],
      ['onDownload',callback=>{const ouvintes=callbacks.get('navegadorDownload')||new Set();ouvintes.add(callback);callbacks.set('navegadorDownload',ouvintes);return ()=>ouvintes.delete(callback);}],
      // rodada 2 da leva 5i: a tecla que a pagina nativa nao guarda (Ctrl+W, Esc, Ctrl+L); o QA simula por __qa.emit('navegadorTecla', { paneId, tecla })
      ['onTecla',callback=>{const ouvintes=callbacks.get('navegadorTecla')||new Set();ouvintes.add(callback);callbacks.set('navegadorTecla',ouvintes);return ()=>ouvintes.delete(callback);}]
    ]),
    experimentsStatus:async ()=>({configured:false}),
    // Log de erros da tela: o log-tela.js chama isto a cada erro e console.error. Declarado de proposito: sem ele o Proxy
    // inventa o metodo e poe "logTela" em __qa.missing (os QAs exigem missing vazio). Nao grava nada; a chamada fica em __qa.calls.
    logTela:async ()=>{},
    connectorRespond:async ()=>({ok:true}),connectorOpenUrl:async ()=>({error:'Site externo desativado na prévia.'}),
    auth:async ()=>({error:'Login real indisponível na prévia isolada.'})
  };
  window.api = new Proxy(implementation,{get(target,key){
    if (key in target) {const value=target[key];return typeof value==='function'?(...args)=>{calls.push({method:key,args:clone(args)});return value(...args);}:value;}
    if (typeof key==='string' && key.startsWith('on')) return callback=>{const listeners=callbacks.get(key)||new Set();listeners.add(callback);callbacks.set(key,listeners);return ()=>listeners.delete(callback);};
    return async (...args)=>{calls.push({method:key,args:clone(args)});missing.add(key);return null;};
  }});
  window.__qa = {calls,missing,emit,account,override:(key,handler)=>{implementation[key]=handler;},get configuration(){return clone(configuration);},fixture:qs.get('cenario')||'supervisao',ready:false,errors:[]};
  window.__qa.setSystemAppearance = value=>{systemAppearance={...systemAppearance,...value};emit('onSystemAppearance',systemAppearance);return clone(systemAppearance);};
  addEventListener('error',event=>window.__qa.errors.push(String(event.error?.stack||event.message)));
  addEventListener('unhandledrejection',event=>window.__qa.errors.push(String(event.reason?.stack||event.reason)));
  window.Notification = class {static permission='denied';static async requestPermission(){return 'denied';}close(){}};
})();
