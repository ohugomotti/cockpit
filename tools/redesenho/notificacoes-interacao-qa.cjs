'use strict';
// Renderer real; rede externa, motores e áudio real bloqueados. Perfil descartável.
const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { verifyServer, ORIGIN } = require('./qa-environment.cjs');
for(const stream of [process.stdout,process.stderr])stream.on('error',e=>{if(e.code!=='EPIPE')throw e;});
const artifacts=path.resolve(__dirname,'../../artifacts'),run=path.join(artifacts,'notificacoes-interacao-qa-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(run,{recursive:true});app.setPath('userData',path.join(run,'profile'));
for(const flag of ['disable-background-networking','disable-component-update','mute-audio'])app.commandLine.appendSwitch(flag);
let win,identity;const checks=[],errors=[],blocked=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),ev=code=>win.webContents.executeJavaScript(code);
async function until(code){for(let i=0;i<100;i++){if(await ev(code))return;await delay(50);}throw Error('Timeout: '+code);}
const fakeAudio=`window.__tones=0;window.__audioFail=false;window.AudioContext=class{constructor(){this.state='running';this.currentTime=0;this.destination={};}resume(){this.state='running';return Promise.resolve();}createOscillator(){if(window.__audioFail)throw Error('Áudio indisponível QA');return{frequency:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){},start(){window.__tones++;},stop(){this.onended?.();}};}createGain(){return{gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}};`;
async function reset(){
  await win.loadURL(ORIGIN+'/?cenario=vazio&visual=1&tema=jornal');await until('!!window.__qa?.ready');
  await ev('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
  await ev(fakeAudio+';void 0;');
  await ev(`window.np=newPane({engine:'claude',abaId:'qa-produto',cwd:'C:/QA'});np.started=false;np.busy=false;window.nativeNotices=[];window.Notification=class{constructor(title,options){nativeNotices.push({title,options});}};cfg.notificationPeek=true;cfg.notificationSound=true;VisualMac.applyPreferences(cfg);window.savedFocus=np.el.querySelector('.p-input');savedFocus.focus();document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));window.__tones=0;`);
}
async function check(name,fn){try{await reset();await fn();const state=await ev('({errors:__qa.errors,missing:[...__qa.missing],executed:__qa.calls.filter(c=>/^(paneStart|paneSend|termRun|debateStart)$/.test(c.method))})');assert.deepEqual(state,{errors:[],missing:[],executed:[]});checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.stack});}console.log(JSON.stringify(checks.at(-1)));}
async function notify(extra={}){await ev(`VisualMac.notify(${JSON.stringify({id:'qa-aviso',message:'Preciso de uma escolha.',title:'Conversa de teste',level:'warning',occurrence:'primeira',attention:true,...extra})});`);}
async function opened(){await until("document.querySelector('.mac-ilha').dataset.presentation==='auto'");}
async function capture(name){win.webContents.invalidate();await ev('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');await ev("document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).forEach(a=>{try{a.finish();}catch{}})");await delay(180);fs.writeFileSync(path.join(run,name+'.png'),(await win.webContents.capturePage()).toPNG());}
app.whenReady().then(async()=>{
  console.log('QA pronto; verificando servidor');
  identity=await verifyServer();
  console.log('Servidor identificado; criando janela oculta');
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{const allowed=details.url.startsWith(ORIGIN+'/')||details.url.startsWith('data:')||details.url.startsWith('blob:'+ORIGIN)||details.url==='about:blank';if(!allowed)blocked.push(details.url);callback({cancel:!allowed});});
  win=new BrowserWindow({width:1440,height:900,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,offscreen:true}});
  console.log('Janela criada');
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('render-process-gone',(_,data)=>errors.push(data.reason));
  await check('Prévia abre três segundos sem foco ou janela à frente; cartão permanece',async()=>{
    await notify();await opened();assert.equal(await ev('document.activeElement===savedFocus'),true);assert.equal(win.isVisible(),false);assert.equal(await ev('__tones'),1);await capture('previa-novo-aviso');
    await delay(3200);assert.equal(await ev("document.querySelector('.mac-ilha').classList.contains('aberta')"),false);assert.equal(await ev("!!document.querySelector('[data-notification-id=qa-aviso]')"),true);
  });
  await check('Mouse segura a prévia e a saída retoma o recolhimento',async()=>{
    await notify();await opened();await ev("document.querySelector('.mac-ilha').dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}));");await delay(3300);assert.equal(await ev("document.querySelector('.mac-ilha').classList.contains('aberta')"),true);
    await ev("document.querySelector('.mac-ilha').dispatchEvent(new PointerEvent('pointerleave',{pointerType:'mouse'}));");await delay(3100);assert.equal(await ev("document.querySelector('.mac-ilha').classList.contains('aberta')"),false);
  });
  await check('Foco em botão e ação assíncrona seguram a prévia sem perder o controle',async()=>{
    await ev("VisualMac.notify({id:'qa-aviso',message:'Revisar documento',occurrence:'1',action:{label:'Abrir',run:()=>new Promise(resolve=>window.finishAction=resolve)}});");await opened();
    assert.equal(await ev("document.querySelector('[data-notification-id=qa-aviso] .mac-notificacao-acao').textContent.trim()"),'');assert.equal(await ev("document.querySelector('[data-notification-id=qa-aviso] .mac-notificacao-acao').getAttribute('aria-label')"),'Abrir');
    await ev("document.querySelector('[data-notification-id=qa-aviso] .mac-notificacao-acao').focus();document.activeElement.click();savedFocus.focus();");await delay(3300);
    assert.equal(await ev("document.querySelector('.mac-ilha').classList.contains('aberta')"),true);assert.equal(await ev("document.querySelector('[data-notification-id=qa-aviso]').getAttribute('aria-busy')"),'true');
    await ev('finishAction(false);');await delay(3100);assert.equal(await ev("document.querySelector('.mac-ilha').classList.contains('aberta')"),false);assert.equal(await ev("!!document.querySelector('[data-notification-id=qa-aviso]')"),true);
  });
  await check('Abertura manual permanece até fechar; Escape funciona sem roubar foco do chat',async()=>{
    await notify();await opened();await ev("document.querySelector('.mac-ilha-linha').click();");await delay(3300);assert.equal(await ev("document.querySelector('.mac-ilha').dataset.presentation"),'manual');
    await ev("savedFocus.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));");assert.equal(await ev("document.querySelector('.mac-ilha').classList.contains('aberta')"),false);assert.equal(await ev('document.activeElement===savedFocus'),true);
  });
  await check('Clique fora encerra e alteração do mesmo evento não reabre',async()=>{
    await notify();await opened();await ev("document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));");
    await notify({revision:'texto-atualizado',message:'Texto atualizado do mesmo evento.'});await delay(300);assert.equal(await ev("document.querySelector('.mac-ilha').classList.contains('aberta')"),false);assert.equal(await ev('__tones'),1);
  });
  await check('Ocorrência perto do vencimento ganha três segundos sem duplicar o toque',async()=>{
    await notify();await opened();await delay(2900);await notify({id:'segundo-aviso',occurrence:'segunda',message:'Chegou outro pedido.'});await delay(250);
    assert.equal(await ev("document.querySelector('.mac-ilha').dataset.presentation"),'auto');assert.equal(await ev('__tones'),1);await delay(2400);
    assert.equal(await ev("document.querySelector('.mac-ilha').classList.contains('aberta')"),true);await delay(600);assert.equal(await ev("document.querySelector('.mac-ilha').classList.contains('aberta')"),false);
  });
  await check('Perguntas iguais com IDs diferentes avisam de novo; nativas são silenciosas',async()=>{
    await ev("avisarPainel(np,'está perguntando',{kind:'pergunta',id:'q1'});");await opened();await delay(3200);
    await ev("avisarPainel(np,'está perguntando',{kind:'pergunta',id:'q2'});");await opened();assert.equal(await ev('__tones'),2);assert.equal(await ev('nativeNotices.every(n=>n.options.silent===true)'),true);
  });
  await check('Cota repetida e inbox restaurada não abrem nem tocam; regravação nova abre sem som',async()=>{
    await ev("VisualMac.setLimit('claude',{entrou:true,semana:{pct:100,reseta:123456789}},{chave:'qa-local'});VisualMac.setLimit('claude',{entrou:true,semana:{pct:100,reseta:123456789}},{chave:'qa-local'});window.inboxItem={arquivo:'C:/inbox/voz.txt',nome:'voz.txt',tipo:'texto',texto:'Nota restaurada',occurrence:'voz:10:100',replay:true};chegouNaInbox(inboxItem);chegouNaInbox(inboxItem);");
    await delay(300);assert.equal(await ev('__tones'),0);assert.equal(await ev("document.querySelector('.mac-ilha').classList.contains('aberta')"),false);
    assert.equal(await ev("document.querySelectorAll('[data-notification-id=\"inbox-C:/inbox/voz.txt\"]').length"),1);
    await ev("chegouNaInbox({...inboxItem,occurrence:'voz:11:100',replay:false,texto:'Nota nova'});");await opened();assert.equal(await ev('__tones'),0);
  });
  await check('Rajada exibe cartão prioritário, quantidade adicional e um só toque',async()=>{
    await ev("for(let i=0;i<6;i++)VisualMac.notify({id:'qa-'+i,occurrence:String(i),message:'Aviso '+i,attention:true,priority:i===4?100:0,level:'warning'});");await opened();
    assert.equal(await ev('__tones'),1);assert.equal(await ev("document.querySelector('.mac-ilha-cabecalho').textContent.includes('+5')"),true);
    assert.deepEqual(await ev("[...document.querySelectorAll('.mac-notificacao')].filter(n=>getComputedStyle(n).display!=='none').map(n=>n.dataset.notificationId)"),['qa-4']);
    assert.equal(await ev("document.querySelector('.mac-ilha-ver-todos').textContent.trim()"),'');assert.ok(await ev("document.querySelector('.mac-ilha-ver-todos').getAttribute('aria-label').includes('Ver todos')"));
    await ev("document.querySelector('.mac-ilha-ver-todos').click();");assert.equal(await ev("document.querySelector('.mac-ilha').dataset.presentation"),'manual');await capture('central-rajada');
  });
  await check('Preferências salvam, respeitam som/prévia independentes e oferecem exemplo',async()=>{
    await ev("CockpitUI.toolLayer('settings');void 0;");await until("!!document.querySelector('input[aria-label=\"Mostrar novos avisos por 3 segundos\"]')");assert.equal(await ev("document.querySelector('.ck-notification-sample').textContent.trim()"),'');assert.equal(await ev("document.querySelector('.ck-notification-sample').getAttribute('aria-label')"),'Ouvir exemplo');
    await ev("for(const label of ['Mostrar novos avisos por 3 segundos','Som para perguntas e erros']){const input=document.querySelector('input[aria-label=\"'+label+'\"]');input.click();}");await delay(250);
    assert.equal(await ev('__qa.configuration.notificationPeek'),false);assert.equal(await ev('__qa.configuration.notificationSound'),false);
    await ev("while(CockpitUI.layers.length)CockpitUI.closeLayer();VisualMac.applyPreferences(JSON.parse(JSON.stringify(__qa.configuration)));");await notify();await delay(300);
    assert.equal(await ev('__tones'),0);assert.equal(await ev("document.querySelector('.mac-ilha').classList.contains('aberta')"),false);
    await ev("CockpitUI.toolLayer('settings');document.querySelector('.ck-notification-sample').click();");await until("document.querySelector('.ck-notification-sample').parentElement.textContent.includes('reproduzido')");assert.equal(await ev('__tones'),1);await ev("document.querySelector('.ck-notification-sample').scrollIntoView({block:'center'});");await capture('preferencias');assert.ok(await ev("document.querySelector('.ck-notification-sample').parentElement.querySelector('[role=status]').getBoundingClientRect().width>180"));
  });
  await check('Falha no áudio conserva entrega visual e explica indisponibilidade no exemplo',async()=>{
    await ev('window.__audioFail=true;');await notify();await opened();assert.equal(await ev('__tones'),0);assert.equal(await ev("!!document.querySelector('[data-notification-id=qa-aviso]')"),true);
    await ev("document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));CockpitUI.toolLayer('settings');document.querySelector('.ck-notification-sample').click();");await until("document.querySelector('.ck-notification-sample').parentElement.textContent.includes('não está disponível')");
  });
  await check('Preferências e rota única de áudio também valem sem Visual Mac',async()=>{
    await ev('cfg.visualMac=false;VisualMac.applyPreferences(cfg);');await notify();await opened();assert.equal(await ev('__tones'),1);assert.equal(await ev("document.documentElement.classList.contains('visual-mac')"),false);
  });
  await check('Escape do leitor não é capturado pela Ilha aberta',async()=>{
    await notify();await opened();await ev("window.readerStub=document.createElement('div');readerStub.className='p-visor';document.body.append(readerStub);window.readerEscape=false;readerStub.addEventListener('keydown',e=>{if(e.key==='Escape')readerEscape=true;});readerStub.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));readerStub.remove();");assert.equal(await ev('readerEscape'),true);
  });
  for(const width of [1440,390])await check('Prévia compacta cabe na janela '+width+'px',async()=>{
    win.setContentSize(width,900);await notify({message:'Pergunta curta com uma ação para você escolher o próximo passo.'});await opened();await capture('previa-'+width);
    const bounds=await ev("(()=>{const r=document.querySelector('.mac-ilha-corpo').getBoundingClientRect();return{left:r.left,right:r.right,bottom:r.bottom,popupHeight:r.height,width:innerWidth,height:innerHeight};})()");assert.ok(bounds.popupHeight>70&&bounds.left>=0&&bounds.right<=bounds.width+1&&bounds.bottom<=bounds.height+1,JSON.stringify(bounds));win.setContentSize(1440,900);
  });
  if(blocked.length)errors.push('Rede externa bloqueada: '+blocked.join(', '));
  const after=await verifyServer();if(after.sourceHash!==identity.sourceHash)errors.push('Fonte mudou durante o QA');finish();
}).catch(error=>{errors.push(error.stack);finish();});
function finish(){const report={status:errors.length||checks.some(c=>!c.passed)?'failed':'passed',at:new Date().toISOString(),sourceIdentity:identity,checks,errors,blocked,run,authenticatedEnginesStarted:false,realAudioEnabled:false,productionMainLoaded:false};fs.writeFileSync(path.join(run,'report.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(artifacts,'notificacoes-interacao-qa.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:checks.length,errors,run}));app.exit(report.status==='passed'?0:1);}
