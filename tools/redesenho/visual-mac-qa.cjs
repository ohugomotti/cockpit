'use strict';
// Renderer real + mock local. Não carrega main.js nem usa motores autenticados.
const {app,BrowserWindow,session}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {verifyServer,ORIGIN}=require('./qa-environment.cjs');
const artifacts=path.resolve(__dirname,'../../artifacts');
fs.mkdirSync(artifacts,{recursive:true});
app.setPath('userData',path.join(artifacts,'visual-mac-qa-profile'));
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
const errors=[],checks=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let window;
const evaluate=code=>window.webContents.executeJavaScript(code);
const islandState=value=>evaluate(`(()=>{const b=document.querySelector('.mac-ilha-linha');if(b.getAttribute('aria-expanded')!==${JSON.stringify(String(value))})b.click();})()`);
async function settle(){window.webContents.invalidate();await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await delay(500);}
async function check(name,fn){try{await fn();checks.push({name,passed:true});}catch(error){checks.push({name,passed:false,error:error.message});errors.push(name+': '+error.message);}console.log(JSON.stringify(checks.at(-1)));}
async function ready(){
  for(let attempt=0;attempt<100;attempt++){
    if(await evaluate('!!window.__qa?.ready && !!window.CockpitUI && document.querySelectorAll(".pane").length===3')){
      await evaluate('document.fonts.ready');await delay(250);return;
    }
    await delay(100);
  }
  throw new Error('O renderer não terminou a inicialização.');
}
async function capture(name){await settle();fs.writeFileSync(path.join(artifacts,name),(await window.webContents.capturePage()).toPNG());}
async function geometry(){return evaluate(`(() => {
  const area=document.querySelector('#panes');
  const panes=[...document.querySelectorAll('.pane')].filter(n=>n.getClientRects().length).map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width};});
  return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1,panes,overlap:panes.some((a,i)=>panes.slice(i+1).some(b=>a.right>b.left+1&&b.right>a.left+1&&a.bottom>b.top+1&&b.bottom>a.top+1)),scrollWidth:area.scrollWidth,clientWidth:area.clientWidth};
})()`);}
app.whenReady().then(async()=>{
  const sourceIdentity=await verifyServer();
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{
    const allowed=details.url.startsWith(ORIGIN+'/')||details.url.startsWith('data:')||details.url==='about:blank';
    if(!allowed)errors.push('Pedido externo bloqueado: '+new URL(details.url).origin);
    callback({cancel:!allowed});
  });
  window=new BrowserWindow({width:1500,height:960,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('render-process-gone',(_event,details)=>errors.push('Renderer encerrou: '+details.reason));
  await window.loadURL(ORIGIN+'/?cenario=supervisao&visual=1&tema=automatico&sistema=escuro');
  await ready();
  await settle();
  const initial=await evaluate('__qa.snapshot()');
  const engineActions=()=>evaluate('__qa.calls.filter(c=>/^(paneStart|paneSend|paneSteer|paneStop|paneInterrupt|panePlano|approve|perguntaResponder|codexReiniciar)$/.test(c.method))');
  const engineCalls=async()=>(await engineActions()).length;
  const callsBefore=await engineCalls();
  const pointer=await require('./visual-mac-pointer-checks.cjs')(window);
  for(const result of pointer.checks){checks.push(result);if(!result.passed)errors.push(result.name+': '+result.error);console.log(JSON.stringify(result));}
  fs.writeFileSync(path.join(artifacts,'visual-mac-pointer-qa.json'),JSON.stringify(pointer,null,2)+'\n');
  await check('Ilha abre pelo teclado e Escape devolve o foco',async()=>{
    await islandState(false);
    await evaluate(`VisualMac.notify({id:'qa-keyboard',message:'Aviso para testar teclado',level:'warning',priority:100,action:{label:'Abrir',run:()=>false}});true`);
    await evaluate(`(()=>{const line=document.querySelector('.mac-ilha-linha');line.focus();line.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));})()`);
    assert.equal(await evaluate('document.querySelector(".mac-ilha-linha").getAttribute("aria-expanded")'),'true');
    assert.equal(await evaluate('document.activeElement.classList.contains("mac-notificacao-acao")'),true,'ArrowDown deve focar ação do primeiro aviso');
    await evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    assert.equal(await evaluate('document.querySelector(".mac-ilha-linha").getAttribute("aria-expanded")'),'false');
    assert.equal(await evaluate('document.activeElement.classList.contains("mac-ilha-linha")'),true,'Escape deve devolver foco ao sino');
    await evaluate(`VisualMac.notify({id:'qa-keyboard-dismiss',message:'Aviso sem ação',priority:200});document.querySelector('.mac-ilha-linha').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));true`);
    assert.equal(await evaluate('document.activeElement.classList.contains("mac-notificacao-fechar")'),true,'Aviso sem ação foca X, sem tentar focar botão oculto');
    await evaluate(`VisualMac.resolveNotification('qa-keyboard-dismiss');document.querySelector('.mac-ilha-linha').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true`);
    window.webContents.focus();
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});window.webContents.sendInputEvent({type:'char',keyCode:'\r'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});await delay(120);
    assert.equal(await evaluate('document.querySelector(".mac-ilha-linha").getAttribute("aria-expanded")'),'true','Enter abre o botão de verdade');
    await islandState(false);await evaluate('VisualMac.resolveNotification("qa-keyboard");true');
  });
  await check('Ilha só contém notificações e Torre continua exclusiva da lateral',async()=>{
    const count=await evaluate('document.querySelectorAll(".mac-notificacao").length');
    await evaluate(`VisualMac.updateTower([{key:'qa-torre',title:'CONVERSA_NAO_ENTRA_NA_ILHA',state:'attention'}]);true`);
    assert.equal(await evaluate('document.querySelectorAll(".mac-notificacao").length'),count);
    assert.equal(await evaluate('document.querySelector(".mac-ilha").textContent.includes("CONVERSA_NAO_ENTRA_NA_ILHA")'),false);
    assert.equal(await evaluate('document.querySelectorAll(".mac-ilha-item").length'),0);
    assert.ok(await evaluate('document.querySelectorAll(".ck-control-list .ck-session").length>0'));
    await evaluate('CockpitUI.refresh()');
  });
  await check('Faixa global vira um único card sem roubar foco ou abrir a Ilha',async()=>{
    await islandState(false);
    await evaluate(`(()=>{document.querySelector('.p-input').focus();for(let i=0;i<3;i++)mostrarAviso({id:'qa-faixa',texto:'Limite do Claude no PC',tipo:'alerta',fixo:true});})()`);
    assert.equal(await evaluate('document.querySelectorAll("[data-notification-id=qa-faixa]").length'),1);
    assert.equal(await evaluate('document.querySelectorAll("#avisos .aviso").length'),0);
    assert.equal(await evaluate('document.activeElement.classList.contains("p-input")'),true);
    assert.equal(await evaluate('document.querySelector(".mac-ilha").classList.contains("aberta")'),false);
    const rect=await evaluate('(()=>{const r=document.querySelector(".mac-ilha").getBoundingClientRect();return {w:r.width,h:r.height};})()');
    assert.ok(rect.w<=100&&rect.h<=30,'Pílula deve ocupar no máximo100×30: '+JSON.stringify(rect));
    await evaluate('VisualMac.resolveNotification("qa-faixa");true');
  });
  await check('Ação com falha fica disponível; sucesso e descarte removem sem executar outro callback',async()=>{
    await islandState(true);
    await evaluate(`window.qaIslandAction=0;window.qaIslandDismiss=0;VisualMac.notify({id:'qa-action',message:'<img src=x onerror=alert(1)>',action:{label:'Tentar',run:()=>{qaIslandAction++;throw new Error('Falha simulada');}},onDismiss:()=>{qaIslandDismiss++;}});document.querySelector('[data-notification-id="qa-action"] .mac-notificacao-acao').click();true`);
    await delay(60);
    assert.equal(await evaluate('!!document.querySelector("[data-notification-id=qa-action]")'),true);
    assert.equal(await evaluate('document.querySelectorAll("[data-notification-id=qa-action] img").length'),0);
    assert.ok(await evaluate('document.querySelector("[data-notification-id=qa-action] .mac-notificacao-erro").textContent.includes("Falha simulada")'));
    await evaluate(`VisualMac.notify({id:'qa-action',message:'Tente novamente',action:{label:'Tentar',run:()=>{qaIslandAction++;}},onDismiss:()=>{qaIslandDismiss++;}});document.querySelector('[data-notification-id="qa-action"] .mac-notificacao-acao').click();true`);await delay(60);
    assert.equal(await evaluate('!!document.querySelector("[data-notification-id=qa-action]")'),false);
    assert.equal(await evaluate('qaIslandAction'),2);assert.equal(await evaluate('qaIslandDismiss'),0);
    await evaluate(`VisualMac.notify({id:'qa-dismiss',message:'Descartar',onDismiss:()=>{qaIslandDismiss++;}});const dismiss=document.querySelector('[data-notification-id="qa-dismiss"] .mac-notificacao-fechar');dismiss.focus();dismiss.click();true`);await delay(60);
    assert.equal(await evaluate('qaIslandDismiss'),1);
    assert.equal(await evaluate('document.activeElement.classList.contains("mac-ilha-linha")'),true,'Foco volta ao sino ao remover o item focado');
    await islandState(false);
  });
  await check('Quota PC e VPS são separadas, sobrevivem falha e Ver conta mantém aviso ativo',async()=>{
    await islandState(true);
    await evaluate(`(()=>{window.qaAccountOpened='';const usage={entrou:true,semana:{pct:96,reseta:Date.parse('2026-10-01T22:00:00Z')}};for(const place of [{chave:'qa-pc'},{chave:'qa-vps',remoto:{host:'qa.invalid'},rotulo:'VPS de teste'}])VisualMac.setLimit('claude',usage,place,{label:'Ver conta',run:()=>{qaAccountOpened=place.chave;}});VisualMac.setLimit('claude',{error:'falha simulada'},{chave:'qa-vps',remoto:{}});document.querySelector('[data-notification-id="account-limit:claude:qa-vps:semana"] .mac-notificacao-acao').click();})()`);await delay(60);
    assert.equal(await evaluate('qaAccountOpened'),'qa-vps');
    assert.equal(await evaluate('document.querySelectorAll("[data-notification-id^=\\"account-limit:claude:qa-\\"]").length'),2);
    await islandState(true);await settle();
    const header=await evaluate(`(()=>{const b=document.querySelector('.mac-ilha-corpo'),l=document.querySelector('.mac-ilha-linha');return {scroll:b.scrollTop,body:b.getBoundingClientRect().top,line:l.getBoundingClientRect().top,expanded:l.getAttribute('aria-expanded')};})()`);
    assert.equal(header.scroll,0,JSON.stringify(header));assert.equal(header.expanded,'true');assert.ok(Math.abs(header.body-header.line)<=2,JSON.stringify(header));
    await capture('visual-mac-central-notificacoes.png');
    await evaluate(`VisualMac.setLimit('claude',{entrou:false},{chave:'qa-vps',remoto:{}});VisualMac.setLimit('claude',{entrou:false},{chave:'qa-pc'});true`);await islandState(false);
    assert.equal(await evaluate('document.querySelectorAll("[data-notification-id^=\\"account-limit:claude:qa-\\"]").length'),0);
  });
  await check('Lista longa rola dentro da Ilha sem uma caixa vazia abaixo',async()=>{
    await islandState(true);
    try {
      await evaluate(`for(let i=0;i<35;i++)VisualMac.notify({id:'qa-scroll-'+i,message:'Aviso de teste '+i});true`);
      let heights;
      for(let attempt=0;attempt<10;attempt++){
        await settle();
        heights=await evaluate(`(()=>{const body=document.querySelector('.mac-ilha-corpo'),list=document.querySelector('.mac-ilha-lista'),line=document.querySelector('.mac-ilha-linha');return {body:body.offsetHeight,list:list.offsetHeight,line:line.offsetHeight,scroll:list.scrollHeight,target:document.querySelector('.mac-ilha').style.getPropertyValue('--mac-ilha-h')};})()`);
        if(Math.abs(heights.body-heights.list-heights.line)<=4)break;
      }
      assert.ok(heights.scroll>heights.list);assert.ok(Math.abs(heights.body-heights.list-heights.line)<=4,JSON.stringify(heights));
    } finally { await evaluate(`VisualMac.resolveNotifications('qa-scroll-');true`);await islandState(false); }
  });
  await check('Anéis usam os limites reais da conta simulada',async()=>{
    const rings=await evaluate(`(()=>{const b=[...document.querySelectorAll('.ck-account-button')].find(n=>n.dataset.key?.endsWith(':claude'));return b?{outer:b.querySelector('.anel-5h')?.getAttribute('stroke-dasharray'),inner:b.querySelector('.anel-semana')?.getAttribute('stroke-dasharray')}:null;})()`);
    assert.ok(rings);assert.equal(rings.outer,'34 100');assert.equal(rings.inner,'72 100');
  });
  await check('Visual ligado desde a primeira tela e modo automático preservado',async()=>{
    assert.equal(await evaluate('document.documentElement.classList.contains("visual-mac") || document.body.classList.contains("visual-mac")'),true);
    assert.equal(await evaluate('document.documentElement.dataset.tema'),'automatico');
    assert.equal(await evaluate('document.documentElement.dataset.macLuz'),'escuro');
  });
  await check('Sistema claro/escuro atualiza sem recarregar a conversa',async()=>{
    await evaluate('__qa.setSystemAppearance({dark:false})');await delay(180);
    assert.equal(await evaluate('document.documentElement.dataset.macLuz'),'claro');
    await capture('visual-mac-automatico-claro.png');
    await evaluate('__qa.setSystemAppearance({dark:true})');await delay(180);
    assert.equal(await evaluate('document.documentElement.dataset.macLuz'),'escuro');
    assert.deepEqual((await evaluate('__qa.snapshot()')).panels,initial.panels);
  });
  const themeColors={};
  await evaluate('userMsg(__qa.panel(__qa.panels[0]),"Texto de teste para conferir a bolha da mensagem do usuário.")');
  for(const theme of ['automatico','escuro','claro','jornal','azul']){
    await check('Tema '+theme+' com três painéis e sem sobreposição',async()=>{
      await evaluate('__qa.setTheme('+JSON.stringify(theme)+')');await settle();
      const bounds=await geometry();
      assert.equal(bounds.panes.length,3);assert.equal(bounds.overflow,false);assert.equal(bounds.overlap,false);
      assert.equal(await evaluate('document.documentElement.dataset.tema'),theme);
      const bubble=await evaluate(`(()=>{const body=document.querySelector('.msg.user .msg-body');const style=getComputedStyle(body);return {background:style.backgroundColor,radius:parseFloat(style.borderTopLeftRadius),text:body.textContent};})()`);
      assert.ok(bubble.text.includes('Texto de teste'));assert.notEqual(bubble.background,'rgba(0, 0, 0, 0)');assert.ok(bubble.radius>=12);
      await capture('visual-mac-'+theme+'.png');
      themeColors[theme]=await evaluate('getComputedStyle(document.querySelector(".pane")).backgroundColor');
    });
  }
  await check('Claro e escuro apresentam superfícies diferentes',async()=>assert.notEqual(themeColors.claro,themeColors.escuro));
  await check('Spotlight dá foco à busca compacta e Escape fecha',async()=>{
    await evaluate('CockpitUI.palette();true');await settle();
    const field=await evaluate(`(()=>{const input=document.querySelector('.ck-palette input');return input?{focused:document.activeElement===input,height:input.getBoundingClientRect().height}:null;})()`);
    assert.ok(field);assert.equal(field.focused,true);assert.ok(field.height>=52&&field.height<=60,'Altura da busca: '+field.height);
    await capture('visual-mac-spotlight.png');
    await evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))');
    await delay(220); // a nova saída do popup termina antes de remover o nó
    assert.equal(await evaluate('!!document.querySelector(".ck-palette")'),false);
  });
  await check('O controle Visual de Mac preserva sessão e rascunho',async()=>{
    await evaluate(`(()=>{const p=__qa.panel(__qa.panels[0]);p.el.querySelector('.p-input').value='Rascunho preservado no teste visual';CockpitUI.toolLayer('settings');})()`);
    await delay(180);
    const toggle=await evaluate(`(()=>{const controls=[...document.querySelectorAll('input[type="checkbox"],button[role="switch"]')];const control=controls.find(n=>/visual.*mac/i.test([n.id,n.getAttribute('aria-label'),n.closest('label')?.textContent,n.closest('.aj-campo')?.textContent].join(' ')));if(!control)return null;control.dataset.qaVisualMac='1';return {tag:control.tagName};})()`);
    assert.ok(toggle,'Controle Visual de Mac não encontrado');
    for(const mode of ['motor','watch','tema']){
      await evaluate('document.querySelector("[data-aneis='+mode+']").click()');
      assert.equal(await evaluate('document.documentElement.dataset.macAneis'),mode);
      assert.equal(await evaluate('__qa.configuration.macAneis'),mode);
    }
    await evaluate('document.querySelector("[data-qa-visual-mac]").click()');await delay(200);
    assert.equal(await evaluate('document.documentElement.classList.contains("visual-mac") || document.body.classList.contains("visual-mac")'),false);
    await capture('visual-mac-desligado.png');
    await evaluate('document.querySelector("[data-qa-visual-mac]").click()');await delay(200);
    assert.equal(await evaluate('document.documentElement.classList.contains("visual-mac") || document.body.classList.contains("visual-mac")'),true);
    const after=await evaluate('__qa.snapshot()');
    assert.equal(after.panels[0].draft,'Rascunho preservado no teste visual');
    assert.deepEqual(after.panels.map(p=>p.session),initial.panels.map(p=>p.session));
    await evaluate('CockpitUI.closeToolView("settings")');
  });
  await check('Tela estreita mantém painéis acessíveis e página sem transbordar',async()=>{
    window.setSize(390,844);await settle();
    const bounds=await geometry();assert.equal(bounds.overflow,false,JSON.stringify(bounds));assert.equal(bounds.overlap,false,JSON.stringify(bounds));assert.equal(bounds.panes.length,3);
    await capture('visual-mac-390.png');
    for(const id of await evaluate('__qa.panels')){
      await evaluate('irAoPainel(__qa.panel('+JSON.stringify(id)+'))');await delay(350);
      const send=await evaluate(`(()=>{const p=__qa.panel(${JSON.stringify(id)});const r=p.el.querySelector('.p-send').getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight};})()`);
      assert.ok(send.left>=0&&send.right<=send.width+1&&send.bottom<=send.height+1,'Enviar não alcançável no painel '+id+': '+JSON.stringify(send));
    }
    await capture('visual-mac-390.png');
    window.setSize(1500,960);await delay(180);
  });
  await check('Nenhuma ação visual envia mensagens ou reinicia motores',async()=>assert.equal(await engineCalls(),callsBefore));
  // Desde 29/09, Ctrl+Tab troca imediatamente. Navegação é separada das ações
  // puramente visuais: guardar uma pasta para somente os seus motores ociosos.
  await check('Ctrl Tab avança, Ctrl Shift Tab volta e conserva sessões e rascunhos',async()=>{
    const state=()=>evaluate(`({tab:cfg.abaAtiva,tabs:abasLocais().map(a=>a.id),panels:[...panes.values()].map(p=>({id:p.id,engine:p.engine,session:p.sessaoId||p.resumeId||null,draft:p.el.querySelector('.p-input')?.value||'',busy:!!p.busy,started:!!p.started,hasTerminal:!!p.terms?.size,connected:p.el.isConnected}))})`);
    const waitForTab=async id=>{
      for(let attempt=0;attempt<100;attempt++){
        if(await evaluate('!trocandoAba && !abaPendente && cfg.abaAtiva==='+JSON.stringify(id)))return;
        await delay(50);
      }
      throw new Error('A troca não terminou na pasta '+id);
    };
    const press=shiftKey=>evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",ctrlKey:true,shiftKey:'+JSON.stringify(shiftKey)+',bubbles:true,cancelable:true}))');
    const before=await state(),previous=before.tab;
    assert.ok(before.tabs.length>=2,'A fixture precisa de duas pastas');
    const next=before.tabs[(before.tabs.indexOf(previous)+1)%before.tabs.length];
    const actionCount=(await engineActions()).length;
    const stopped=panels=>panels.filter(p=>!p.busy&&!p.hasTerminal).map(p=>({paneId:p.id,engine:p.engine}));
    const assertStops=async expected=>{
      const actions=(await engineActions()).slice(actionCount);
      assert.ok(actions.every(c=>c.method==='paneStop'),'Navegação iniciou, enviou, interrompeu ou aprovou trabalho: '+JSON.stringify(actions));
      assert.ok(actions.every(c=>c.args.length===1),'paneStop deve receber apenas o pedido esperado');
      assert.deepEqual(actions.map(c=>c.args[0]),expected,'Somente os motores ociosos das pastas de saída podem parar, uma vez cada');
    };
    try {
      await press(false);await waitForTab(next);
      assert.equal(await evaluate('!!document.querySelector(".ck-troca-lista")'),false,'Troca direta não abre o seletor antigo');
      await assertStops(stopped(before.panels));
      await capture('visual-mac-ctrl-tab.png');
      const away=await state();
      await press(true);await waitForTab(previous);
      const after=await state();
      assert.deepEqual(after.panels.map(({started,...p})=>p),before.panels.map(({started,...p})=>p),'Os mesmos painéis, sessões, rascunhos e estados devem voltar');
      for(const p of before.panels.filter(p=>p.busy||p.hasTerminal))assert.equal(after.panels.find(q=>q.id===p.id)?.started,p.started,'Motor ocupado deve continuar vivo');
      await assertStops([...stopped(before.panels),...stopped(away.panels)]);
    } finally {
      // Mesmo uma asserção falha não deixa as próximas verificações na pasta errada.
      await evaluate('trocarAbaLocal('+JSON.stringify(previous)+')');
      await waitForTab(previous);
    }
  });
  const finalState=await evaluate('__qa.snapshot()');
  errors.push(...finalState.errors);
  if(finalState.missing.length)errors.push('APIs não simuladas: '+finalState.missing.join(', '));
  const latestIdentity=await verifyServer();
  if(sourceIdentity.sourceHash!==latestIdentity.sourceHash)errors.push('A fonte mudou durante o QA. Rode novamente após finalizar as edições.');
  const report={status:errors.length?'failed':'passed',createdAt:new Date().toISOString(),runtime:process.versions,executable:process.execPath,sourceIdentity,checks,errors,themeColors,initial,finalState,authenticatedEnginesStarted:false,productionMainLoaded:false};
  fs.writeFileSync(path.join(artifacts,'visual-mac-qa.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  app.exit(errors.length?1:0);
}).catch(error=>{console.error(error.stack);fs.writeFileSync(path.join(artifacts,'visual-mac-qa.json'),JSON.stringify({status:'failed',createdAt:new Date().toISOString(),checks,errors:[...errors,error.message]},null,2));app.exit(1);});
