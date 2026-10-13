'use strict';
// Renderer real, transporte simulado. Nenhum SSH, arquivo pessoal ou motor.
const {app,BrowserWindow,session}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {verifyServer,ORIGIN}=require('./qa-environment.cjs');
const artifacts=path.resolve(__dirname,'../../artifacts');
fs.mkdirSync(artifacts,{recursive:true});
app.setPath('userData',path.join(artifacts,'markdown-viewer-qa-profile'));
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
const checks=[],errors=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const normalized=value=>String(value).replaceAll('\\','/');
const EXACT_REMOTE='/opt/equipe/trabalho/entregas/Motti/2026-09-29_revisao-cs/previa-acoes.txt';
let window,sequence=0;
const evaluate=code=>window.webContents.executeJavaScript(code);
async function until(expression,message){
  for(let n=0;n<80;n++){if(await evaluate(expression))return;await delay(50);}
  throw new Error(message||'Condição não apareceu: '+expression);
}
async function settle(){window.webContents.invalidate();await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await delay(350);}
async function capture(name){await settle();fs.writeFileSync(path.join(artifacts,name),(await window.webContents.capturePage()).toPNG());}
async function check(name,fn){
  try{await fn();checks.push({name,passed:true});}
  catch(error){checks.push({name,passed:false,error:error.message});errors.push(name+': '+error.message);}
  console.log(JSON.stringify(checks.at(-1)));
}
async function clickMessage(index,label,href){
  const key='qa-viewer-link-'+(++sequence),text='['+label+']('+href+')';
  await evaluate(`(()=>{const p=__qa.panel(__qa.panels[${index}]);textFinal(p,${JSON.stringify(key)},${JSON.stringify(text)},{});const a=[...p.chat.querySelectorAll('a')].findLast(a=>a.textContent===${JSON.stringify(label)});if(!a)throw new Error('Link de teste não renderizou');a.dataset.viewerQa=${JSON.stringify(key)};a.focus();a.click();})()`);
  return key;
}
async function viewerReady(text){
  await until(`(()=>{const v=document.querySelector('.p-visor:not(.hidden)');return !!v&&v.textContent.includes(${JSON.stringify(text)});})()`,'Arquivo não apareceu no visor: '+text);
  await settle();
}
const fileCalls=()=>evaluate('__qa.calls.filter(c=>c.method==="verArquivo")');
const engineCalls=()=>evaluate('__qa.calls.filter(c=>/^(paneStart|paneSend|paneStop|paneInterrupt|approve|perguntaResponder|termRun)$/.test(c.method)).length');
async function normalReads(){await evaluate('__qa.override("verArquivo",__viewerRead);true');}
async function close(){await evaluate('fecharVisor();true');await delay(180);}

app.whenReady().then(async()=>{
  const sourceIdentity=await verifyServer();
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{
    const allowed=details.url.startsWith(ORIGIN+'/')||details.url.startsWith('data:')||details.url==='about:blank';
    if(!allowed)errors.push('Pedido externo bloqueado: '+new URL(details.url).origin);
    callback({cancel:!allowed});
  });
  window=new BrowserWindow({width:1440,height:960,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('render-process-gone',(_event,details)=>errors.push('Renderer encerrou: '+details.reason));
  await window.loadURL(ORIGIN+'/?cenario=supervisao&visual=1&tema=claro');
  await until('!!window.__qa?.ready&&!!window.CockpitUI&&__qa.panels.length===3','Renderer não inicializou');
  await evaluate('document.fonts.ready');
  await evaluate(`(()=>{
    const local=__qa.panel(__qa.panels[0]),remote=__qa.panel(__qa.panels[1]);
    local.cwd='C:/QA/documentos';remote.cwd='/srv/projeto';remote.abaId='qa-servidor';
    window.__viewerXss=0;
    window.__viewerMarkdown='# Plano local\\n\\nTexto **em destaque** e _itálico_.\\n\\n- Primeiro item\\n- Segundo item\\n\\n| Área | Status |\\n| --- | --- |\\n| Testes | Pronto |\\n\\n[Link externo](https://example.invalid/arquivo?qa=1)\\n\\n## Seção final\\n\\nConteúdo local de teste.';
    window.__viewerFiles={
      'C:/QA/documentos/plano.md':{tipo:'texto',ext:'md',nome:'plano.md',dados:__viewerMarkdown},
      ${JSON.stringify(EXACT_REMOTE)}:{tipo:'texto',ext:'txt',nome:'previa-acoes.txt',dados:'CS da Motti — prévia fictícia do teste\\n19 clientes. Nenhum dado pessoal real.'},
      '/srv/projeto/docs/revisao.md':{tipo:'texto',ext:'md',nome:'revisao.md',dados:'# Revisão na VPS\\n\\n[Detalhe filho](sub/detalhe.md)\\n\\n[Seção interna](#fim)\\n\\n## Fim\\n\\nOrigem remota preservada.'},
      '/srv/projeto/docs/sub/detalhe.md':{tipo:'texto',ext:'md',nome:'detalhe.md',dados:'# Detalhe filho da VPS\\n\\n[Voltar à revisão](../revisao.md)\\n\\nConteúdo do mesmo servidor.'},
      'C:/QA/documentos/inseguro.md':{tipo:'texto',ext:'md',nome:'inseguro.md',dados:'# Documento sanitizado\\n\\n<script>window.__viewerXss=1</script>\\n<img src=x onerror="window.__viewerXss=2">\\n<iframe srcdoc="<script>parent.__viewerXss=3</script>"></iframe>\\n<a href="javascript:window.__viewerXss=4" onclick="window.__viewerXss=5">Não executar</a>\\n\\n[Link perigoso](javascript:alert(1))\\n\\n<a href="data:text/html,executar">Dados bloqueados</a>\\n<a href="C:/QA/documentos/plano.md">Prévia HTML local</a>'},
      'C:/QA/documentos/ausente.md':{erro:'Arquivo indisponível na simulação'}
    };
    window.__viewerRead=async(file,remote)=>{const f=__viewerFiles[String(file).replaceAll(String.fromCharCode(92),'/')];return f?{...f,path:file,bytes:1234}:{erro:'Fixture ausente: '+file};};
    __qa.override('verArquivo',__viewerRead);
  })()`);
  const callsBefore=await engineCalls();
  await check('Clique Markdown local abre prévia no visor amplo, sem shell externo',async()=>{
    const before=(await fileCalls()).length;
    const token=await clickMessage(0,'Abrir plano local','C:/QA/documentos/plano.md');
    await viewerReady('Plano local');
    const call=(await fileCalls()).at(-1);
    assert.equal((await fileCalls()).length,before+1);assert.equal(normalized(call.args[0]),'C:/QA/documentos/plano.md');assert.ok(call.args[1]==null);
    const dom=await evaluate(`(()=>{const v=document.querySelector('.p-visor:not(.hidden)'),r=v.querySelector('.visor-cx').getBoundingClientRect();return{body:v.parentElement===document.body,title:v.querySelector('.visor-markdown h1')?.textContent,bold:v.querySelector('.visor-markdown strong')?.textContent,items:v.querySelectorAll('.visor-markdown li').length,table:!!v.querySelector('.visor-markdown table'),origin:v.querySelector('.visor-origem')?.textContent,path:v.querySelector('.visor-caminho')?.textContent,width:r.width,vw:innerWidth};})()`);
    assert.equal(dom.body,true);assert.equal(dom.title,'Plano local');assert.equal(dom.bold,'em destaque');assert.equal(dom.items,2);assert.equal(dom.table,true);
    assert.match(dom.origin,/PC|computador/i);assert.ok(normalized(dom.path).includes('C:/QA/documentos/plano.md'));assert.ok(dom.width>dom.vw*.85);
    await capture('markdown-viewer-local.png');
    await evaluate(`window.__viewerFocusToken=${JSON.stringify(token)};true`);
  });
  await check('Abas Prévia/Código conservam fonte literal e Escape restaura foco sem parar painel',async()=>{
    await evaluate(`[...document.querySelectorAll('.p-visor:not(.hidden) .visor-modos button')].find(b=>(b.getAttribute('aria-label')||b.textContent.trim())==='Código').click();true`);
    assert.equal(await evaluate(`document.querySelector('.p-visor:not(.hidden) .visor-codigo pre').textContent===__viewerMarkdown`),true);
    assert.equal(await evaluate(`document.querySelector('.p-visor:not(.hidden) .visor-codigo').getClientRects().length>0`),true);
    await capture('markdown-viewer-codigo.png');
    await evaluate(`[...document.querySelectorAll('.p-visor:not(.hidden) .visor-modos button')].find(b=>(b.getAttribute('aria-label')||b.textContent.trim())==='Prévia').click();true`);
    assert.equal(await evaluate(`document.querySelector('.p-visor:not(.hidden) .visor-markdown').getClientRects().length>0`),true);
    await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));true`);await delay(180);
    assert.equal(await evaluate('document.querySelectorAll(".p-visor:not(.hidden)").length'),0);
    assert.equal(await evaluate('document.activeElement.dataset.viewerQa===__viewerFocusToken'),true);
    assert.equal(await engineCalls(),callsBefore);
  });
  await check('Link absoluto Linux do print é lido na VPS e não enviado ao shell do PC',async()=>{
    const linksBefore=await evaluate('__qa.calls.filter(c=>c.method==="abrirLink").length');
    await clickMessage(1,'Veja a prévia da nova notificação',EXACT_REMOTE);await viewerReady('19 clientes');
    const call=(await fileCalls()).at(-1);
    assert.equal(call.args[0],EXACT_REMOTE);assert.equal(call.args[1].host,'servidor.example.invalid');assert.equal(call.args[1].usuario,'demo');
    assert.equal(await evaluate('__qa.calls.filter(c=>c.method==="abrirLink").length'),linksBefore);
    assert.match(await evaluate('document.querySelector(".p-visor:not(.hidden) .visor-origem").textContent'),/servidor|VPS|demo@/i);
    assert.equal(await evaluate('document.querySelector(".p-visor:not(.hidden) .visor-abrir").getClientRects().length'),0);
    await capture('markdown-viewer-vps-txt.png');await close();
  });
  await check('Markdown relativo e link filho usam pasta do documento no mesmo servidor',async()=>{
    await clickMessage(1,'Revisão relativa','docs/revisao.md');await viewerReady('Revisão na VPS');
    assert.equal((await fileCalls()).at(-1).args[0],'/srv/projeto/docs/revisao.md');
    await evaluate(`[...document.querySelectorAll('.p-visor:not(.hidden) .visor-markdown a')].find(a=>a.textContent==='Detalhe filho').click();true`);await viewerReady('Detalhe filho da VPS');
    let call=(await fileCalls()).at(-1);assert.equal(call.args[0],'/srv/projeto/docs/sub/detalhe.md');assert.equal(call.args[1].host,'servidor.example.invalid');
    await evaluate(`[...document.querySelectorAll('.p-visor:not(.hidden) .visor-markdown a')].find(a=>a.textContent==='Voltar à revisão').click();true`);await viewerReady('Revisão na VPS');
    call=(await fileCalls()).at(-1);assert.equal(call.args[0],'/srv/projeto/docs/revisao.md');assert.equal(call.args[1].host,'servidor.example.invalid');
    const before=(await fileCalls()).length;
    await evaluate(`[...document.querySelectorAll('.p-visor:not(.hidden) .visor-markdown a')].find(a=>a.textContent==='Seção interna').click();true`);
    assert.equal((await fileCalls()).length,before);assert.equal(await evaluate('document.querySelectorAll(".p-visor:not(.hidden)").length'),1);
    await capture('markdown-viewer-vps-markdown.png');await close();
  });
  await check('Link para outro Markdown com seção abre o documento já na seção indicada',async()=>{
    await evaluate(`(()=>{
      __viewerFiles['C:/QA/documentos/indice.md']={tipo:'texto',ext:'md',nome:'indice.md',dados:'# Índice do plano\\n\\n[Ir aos testes](plano.md#testes)'};
      __viewerFiles['C:/QA/documentos/plano.md'].dados='# Plano local\\n\\n'+Array.from({length:30},(_,n)=>'Parágrafo anterior '+n+'. Conteúdo para tornar o salto observável.').join('\\n\\n')+'\\n\\n## Testes\\n\\nDestino da seção de outro documento.\\n\\n'+Array.from({length:30},(_,n)=>'Parágrafo posterior '+n+'. Espaço abaixo da seção.').join('\\n\\n');
    })()`);
    try{
      await clickMessage(0,'Índice com seção','C:/QA/documentos/indice.md');await viewerReady('Índice do plano');
      await evaluate(`[...document.querySelectorAll('.p-visor:not(.hidden) .visor-markdown a')].find(a=>a.textContent==='Ir aos testes').click();true`);
      await viewerReady('Destino da seção de outro documento');
      const call=(await fileCalls()).at(-1);assert.equal(normalized(call.args[0]),'C:/QA/documentos/plano.md');assert.ok(call.args[1]==null);
      const geometry=await evaluate(`(()=>{const v=document.querySelector('.p-visor:not(.hidden)'),body=v.querySelector('.visor-corpo'),section=v.querySelector('#testes'),r=section.getBoundingClientRect(),b=body.getBoundingClientRect();return{scroll:body.scrollTop,top:r.top,bottom:r.bottom,bodyTop:b.top,bodyBottom:b.bottom};})()`);
      assert.ok(geometry.scroll>600,JSON.stringify(geometry));
      assert.ok(geometry.top>=geometry.bodyTop-1&&geometry.bottom<=geometry.bodyBottom+1,JSON.stringify(geometry));
      await capture('markdown-viewer-anchor.png');
    }finally{
      await close();await evaluate(`__viewerFiles['C:/QA/documentos/plano.md'].dados=__viewerMarkdown;true`);
    }
  });
  await check('HTTP continua externo, e Markdown não executa HTML perigoso',async()=>{
    await clickMessage(0,'Documento com links','C:/QA/documentos/plano.md');await viewerReady('Plano local');
    await evaluate(`[...document.querySelectorAll('.p-visor:not(.hidden) .visor-markdown a')].find(a=>a.textContent==='Link externo').click();true`);
    const external=await evaluate('__qa.calls.filter(c=>c.method==="abrirLink").at(-1)');assert.equal(external.args[0],'https://example.invalid/arquivo?qa=1');await close();
    await clickMessage(0,'Documento inseguro','C:/QA/documentos/inseguro.md');await viewerReady('Documento sanitizado');
    const safe=await evaluate(`(()=>{const body=document.querySelector('.p-visor:not(.hidden) .visor-markdown');return{executed:__viewerXss,unsafe:body.querySelectorAll('script,iframe,object,embed,[onclick],[onerror],[srcdoc],a[href^="javascript:"],a[href^="data:"]').length};})()`);
    assert.equal(safe.executed,0);assert.equal(safe.unsafe,0);
    await evaluate(`[...document.querySelectorAll('.p-visor:not(.hidden) .visor-markdown a')].find(a=>a.textContent==='Prévia HTML local').click();true`);await viewerReady('Plano local');
    assert.equal(normalized((await fileCalls()).at(-1).args[0]),'C:/QA/documentos/plano.md');await close();
  });
  await check('Erro de leitura aparece e o visor continua fechável',async()=>{
    const token=await clickMessage(0,'Arquivo ausente','C:/QA/documentos/ausente.md');await viewerReady('Arquivo indisponível na simulação');
    await evaluate('document.querySelector(".p-visor:not(.hidden) .visor-x").click();true');await delay(100);
    assert.equal(await evaluate('document.querySelectorAll(".p-visor:not(.hidden)").length'),0);
    assert.equal(await evaluate('document.activeElement.dataset.viewerQa'),token,'X devolve foco ao link que abriu o arquivo');
  });
  await check('Fechar antes do SSH responder impede reabrir ou pintar resposta atrasada',async()=>{
    await evaluate('__qa.override("verArquivo",()=>new Promise(resolve=>{window.__viewerLate=resolve;}));true');
    await clickMessage(1,'Arquivo remoto lento','/srv/projeto/lento.md');
    await until('typeof window.__viewerLate==="function"','Pedido remoto não começou');
    await evaluate('document.querySelector(".p-visor:not(.hidden) .visor-x").click();__viewerLate({tipo:"texto",ext:"md",nome:"lento.md",dados:"# RESPOSTA_ATRASADA",bytes:30});true');await delay(180);
    assert.equal(await evaluate('document.querySelectorAll(".p-visor:not(.hidden)").length'),0);
    assert.equal(await evaluate('[...document.querySelectorAll(".visor-corpo")].some(n=>n.textContent.includes("RESPOSTA_ATRASADA"))'),false);
    await normalReads();
  });
  await check('Dois cliques com respostas invertidas conservam o último arquivo e sua origem',async()=>{
    await evaluate('window.__viewerPending={};__qa.override("verArquivo",(file)=>new Promise(resolve=>{__viewerPending[String(file).replaceAll(String.fromCharCode(92),"/")]=resolve;}));true');
    await clickMessage(1,'Primeiro remoto lento','/srv/projeto/primeiro.md');
    await clickMessage(0,'Segundo local rápido','C:/QA/documentos/segundo.md');
    await until('Object.keys(__viewerPending).length===2','Os dois pedidos não chegaram');
    await evaluate('__viewerPending["C:/QA/documentos/segundo.md"]({tipo:"texto",ext:"md",nome:"segundo.md",dados:"# ARQUIVO_CORRETO",bytes:30});true');await viewerReady('ARQUIVO_CORRETO');
    await evaluate('__viewerPending["/srv/projeto/primeiro.md"]({tipo:"texto",ext:"md",nome:"primeiro.md",dados:"# ARQUIVO_ANTIGO",bytes:30});true');await delay(180);
    assert.equal(await evaluate('document.querySelectorAll(".p-visor:not(.hidden)").length'),1);
    assert.equal(await evaluate('document.querySelector(".p-visor:not(.hidden)").textContent.includes("ARQUIVO_ANTIGO")'),false);
    assert.ok(normalized(await evaluate('document.querySelector(".p-visor:not(.hidden) .visor-caminho").textContent')).includes('C:/QA/documentos/segundo.md'));
    await close();await normalReads();
  });
  await check('Tela390 mantém documento, abas e Fechar dentro da janela',async()=>{
    window.setSize(390,844);await settle();
    await clickMessage(0,'Markdown no celular','C:/QA/documentos/plano.md');await viewerReady('Plano local');
    const geometry=await evaluate(`(()=>{const v=document.querySelector('.p-visor:not(.hidden)');const box=v.querySelector('.visor-cx').getBoundingClientRect();return{overflow:document.documentElement.scrollWidth>innerWidth+1,width:box.width,vw:innerWidth,vh:innerHeight,controls:[...v.querySelectorAll('.visor-x,.visor-modos button')].map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width};})};})()`);
    assert.equal(geometry.overflow,false);assert.ok(geometry.width>=geometry.vw*.85);
    for(const r of geometry.controls)assert.ok(r.width>0&&r.x>=0&&r.y>=0&&r.right<=geometry.vw+1&&r.bottom<=geometry.vh+1,JSON.stringify({geometry,control:r}));
    await capture('markdown-viewer-390.png');await close();window.setSize(1440,960);
  });
  await check('Trocar a pasta com visor aberto fecha o portal antes de guardar os painéis',async()=>{
    await clickMessage(0,'Documento antes da troca de pasta','C:/QA/documentos/plano.md');await viewerReady('Plano local');
    // Painéis simulados ocupados permanecem vivos ao sair da pasta. Isso
    // permite testar a guarda real sem misturar o teste com paneStop.
    await evaluate('for(const p of panes.values())p.busy=true;guardarPaineisDaAba().then(()=>{window.__viewerSaved=true;});true');
    await until('window.__viewerSaved===true','A guarda dos painéis não terminou');
    assert.equal(await evaluate('document.querySelectorAll(".p-visor:not(.hidden)").length'),0);
    assert.equal(await evaluate('panes.size'),0);assert.ok(await evaluate('panesFundo.size>=3'));
  });
  await check('Nenhum clique de documento inicia, interrompe ou envia mensagem a motor',async()=>assert.equal(await engineCalls(),callsBefore));
  const finalState=await evaluate('__qa.snapshot()');
  errors.push(...finalState.errors);
  if(finalState.missing.length)errors.push('APIs não simuladas: '+finalState.missing.join(', '));
  const latest=await verifyServer();
  if(sourceIdentity.sourceHash!==latest.sourceHash)errors.push('A fonte mudou durante o QA. Repetir após finalizar as edições.');
  const report={status:errors.length?'failed':'passed',createdAt:new Date().toISOString(),sourceIdentity,checks,errors,finalState,authenticatedEnginesStarted:false,remoteConnectionOpened:false,productionMainLoaded:false};
  fs.writeFileSync(path.join(artifacts,'markdown-viewer-qa.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));app.exit(errors.length?1:0);
}).catch(error=>{console.error(error.stack);fs.writeFileSync(path.join(artifacts,'markdown-viewer-qa.json'),JSON.stringify({status:'failed',checks,errors:[...errors,error.message]},null,2));app.exit(1);});
