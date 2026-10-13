'use strict';
// Somente renderer e contas simuladas. Nenhuma credencial real é lida ou trocada.
const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { verifyServer, ORIGIN } = require('./qa-environment.cjs');
const artifacts = path.resolve(__dirname, '../../artifacts');
const run = path.join(artifacts, 'contas-popup-qa-' + Date.now());
fs.mkdirSync(run, { recursive: true });
app.setPath('userData', path.join(run, 'profile'));
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
let win, identity, finished = false;
const checks = [], errors = [], blocked = [];
for (const stream of [process.stdout, process.stderr]) stream.on('error', error => { if (error.code !== 'EPIPE') { errors.push(error.message); finish(); } });
process.on('uncaughtException', error => { errors.push(error.stack); finish(); });
process.on('unhandledRejection', error => { errors.push(String(error?.stack || error)); finish(); });
const delay = ms => new Promise(r => setTimeout(r, ms));
const ev = code => win.webContents.executeJavaScript(code);
async function until(code) { for (let i=0;i<120;i++) { if(await ev(code))return; await delay(60); } throw Error('Timeout: '+code); }
async function check(name, fn) { fs.appendFileSync(path.join(run,'progress.log'),'START '+name+'\n'); try { await fn(); checks.push({name,passed:true}); } catch(error) { checks.push({name,passed:false,error:error.stack}); } fs.appendFileSync(path.join(run,'progress.log'),JSON.stringify(checks.at(-1))+'\n'); }
async function close() { await ev('while(CockpitUI.layers.length)CockpitUI.closeLayer();'); await delay(180); }
async function open(remote=false) {
  await close(); await ev(`void CockpitUI.accountLayer('codex',abasLocais().find(a=>a.id==='qa-${remote?'servidor':'produto'}'));`);
  await until("document.querySelector('.ck-account-use') && document.querySelector('.ck-account').getAttribute('aria-busy')==='false'");
}
async function capture(name) {
  await ev('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
  await ev("document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).forEach(a=>{try{a.finish();}catch{}})");
  await ev('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  win.webContents.invalidate(); await delay(320);
  fs.writeFileSync(path.join(run,name+'.png'),(await win.webContents.capturePage()).toPNG());
}
app.whenReady().then(async()=>{
  setTimeout(()=>{errors.push('Tempo de QA excedido');finish();},180000).unref();
  identity=await verifyServer();
  session.defaultSession.webRequest.onBeforeRequest((details, callback)=>{const ok=details.url.startsWith(ORIGIN+'/')||details.url.startsWith('data:')||details.url.startsWith('blob:'+ORIGIN)||details.url==='about:blank';if(!ok)blocked.push(details.url);callback({cancel:!ok});});
  win=new BrowserWindow({width:1440,height:900,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  await win.loadURL(ORIGIN+'/?cenario=supervisao&visual=1&tema=jornal'); await until('!!window.__qa?.ready');
  await ev(`
    window.accActive='Principal';window.accSwitches=[];window.accLogins=[];
    window.accConfirms=[];window.confirm=message=>{accConfirms.push(message);return true;};
    window.accCompare=async(engine,remote)=>({onde:remote?'Servidor simulado':'PC simulado',contas:[
      {apelido:'Principal',atual:accActive==='Principal',podeUsar:true,dados:__qa.account(engine,remote,52)},
      {apelido:'Projetos',atual:accActive==='Projetos',podeUsar:true,dados:__qa.account(engine,remote,19)},
      {apelido:'Antiga',atual:false,podeUsar:false,precisaLogin:true,erro:'Entre novamente para consultar.'}
    ]});
    __qa.override('contasComparar',accCompare);
    __qa.override('contasDisponivel',async()=>({gerenciado:true,login:true,trocar:true,salvar:true}));
    __qa.override('contasTrocar',async o=>{accSwitches.push(o);accActive=o.apelido;return {ok:true};});
    window.accOriginalLogin=entrarNaContaDoLugar;entrarNaContaDoLugar=(engine,lugar)=>{accLogins.push({engine,lugar});};
    void 0;
  `);
  await check('Conta atual, limites e ações aparecem sem o medidor ampliado antigo',async()=>{
    await open(); assert.equal(await ev("document.querySelector('.ck-account-current h3').textContent"),'Principal');
    assert.equal(await ev("document.querySelectorAll('.ck-account .ck-account-meter').length"),0);
    assert.equal(await ev("document.querySelectorAll('.ck-account .ck-usage-window').length"),4);
    assert.equal(await ev("document.querySelector('[data-account-action=login]').getAttribute('aria-label')"),'Entrar em outra conta');
    assert.equal(await ev("[...document.querySelectorAll('.ck-account button')].every(b=>!b.textContent.trim()&&b.querySelector('svg')&&b.title&&b.getAttribute('aria-label'))"),true);
  });
  await check('Troca confirmada mantém o mesmo popup e mostra a nova conta em uso',async()=>{
    await ev("window.accLayer=CockpitUI.layers.at(-1);document.querySelector('.ck-account-use').focus();document.querySelector('.ck-account-use').click();");
    await until("document.querySelector('.ck-account-current h3')?.textContent==='Projetos'");
    assert.equal(await ev('CockpitUI.layers.at(-1)===accLayer'),true);
    assert.equal(await ev('accSwitches.length'),1);
    assert.match(await ev("document.querySelector('.ck-account-status').textContent"),/Conta trocada/);
    assert.equal(await ev("document.querySelector('.ck-account').contains(document.activeElement)"),true,'Trocar a conta pelo teclado mantém foco no diálogo');
  });
  await check('Falha preserva popup, identidade anterior e permite tentar novamente',async()=>{
    await ev("__qa.override('contasTrocar',async()=>({error:'Não foi possível encerrar o motor antigo.'}));document.querySelector('.ck-account-use').click();");
    await until("document.querySelector('.ck-account-status').textContent.includes('motor antigo')");
    assert.equal(await ev("document.querySelector('.ck-account-current h3').textContent"),'Projetos');
    assert.equal(await ev("document.querySelector('.ck-account-use').disabled"),false);
  });
  await check('Clique duplo gera uma só troca e o fechamento não reabre ao concluir',async()=>{
    await ev("window.accPending=0;__qa.override('contasTrocar',()=>{accPending++;return new Promise(r=>window.accFinish=r);});document.querySelector('.ck-account-use').click();document.querySelector('.ck-account-use').click();");
    await until('!!window.accFinish'); assert.equal(await ev('accPending'),1);
    await close(); await ev("accFinish({ok:true});"); await delay(100);
    assert.equal(await ev('CockpitUI.layers.length'),0);
  });
  await check('Entrar em outra conta usa a autenticação do mesmo motor e destino',async()=>{
    await open(true); await ev("document.querySelector('[data-account-action=login]').click();");
    const call=await ev('accLogins.at(-1)'); assert.equal(call.engine,'codex'); assert.equal(call.lugar.remoto.host,'servidor.example.invalid');
    assert.equal(await ev('CockpitUI.layers.length'),0);
  });
  await check('Conta vencida só oferece novo login e nunca troca credencial inválida',async()=>{
    await open();assert.equal(await ev("document.querySelector('[data-account=Antiga] .ck-account-use')===null"),true);
    await ev("document.querySelector('[data-account=Antiga] button').click();");
    assert.equal(await ev('accLogins.length'),2);
  });
  await check('Consulta atrasada após Esc não reabre nem toma o foco',async()=>{
    await close(); await ev("__qa.override('contasComparar',()=>new Promise(r=>window.accLate=r));void CockpitUI.accountLayer('codex',abaAtual());");
    await until('!!window.accLate');
    await ev("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));");
    // Aguarda a devolução normal de foco da animação de fechamento. Só depois
    // chega a resposta atrasada que o cenário pretende isolar.
    await delay(300);await ev("window.accFocus=document.activeElement;accLate({contas:[]});");await delay(200);
    assert.equal(await ev('CockpitUI.layers.length'),0);assert.equal(await ev('document.activeElement===accFocus'),true);
    await ev("__qa.override('contasComparar',accCompare);");
  });
  await check('Erro na consulta aparece com botão de tentar novamente',async()=>{
    await close();await ev("__qa.override('contasComparar',async()=>{throw Error('Sem conexão simulada');});void CockpitUI.accountLayer('codex',abaAtual());");
    await until("document.querySelector('.ck-account-status')?.textContent.includes('Sem conexão')");
    assert.equal(await ev("document.querySelector('[data-account-action=refresh]').disabled"),false);
    await ev("__qa.override('contasComparar',accCompare);document.querySelector('[data-account-action=refresh]').click();");await until("!!document.querySelector('.ck-account-current')");
  });
  await check('Login real da interface reutiliza painel certo e cria vazio no PC sem iniciar modelo',async()=>{
    await close();await ev(`
      window.accRoutes=[];window.accDenied=[];window.accOldActive=cfg.abaAtiva;
      window.accSavedContaAcao=contaAcao;window.accSavedSemPainel=semPainelDaConta;
      contaAcao=(p,acao)=>{accRoutes.push({id:p.id,engine:p.engine,abaId:p.abaId,chave:lugarDaContaDoPainel(p).chave,acao,started:p.started});return true;};
      semPainelDaConta=(engine,lugar)=>{accDenied.push({engine,lugar});};
      cfg.abaAtiva='qa-produto';window.accExisting=[...panes.values()].find(p=>lugarDaContaDoPainel(p).chave==='pc');
      window.accCountBefore=panes.size;accOriginalLogin(accExisting.engine,{remoto:null,chave:'pc'});
    `);
    assert.equal(await ev('accRoutes.at(-1).id===accExisting.id && panes.size===accCountBefore'),true);
    await ev("window.accNewEngine=MOTORES.find(engine=>!painelParaConta(engine,'pc'));accOriginalLogin(accNewEngine,{remoto:null,chave:'pc'});");
    const result=await ev('({route:accRoutes.at(-1),count:panes.size,previous:accCountBefore,engine:accNewEngine})');
    assert.equal(result.count,result.previous+1);assert.equal(result.route.engine,result.engine);assert.equal(result.route.chave,'pc');assert.equal(result.route.abaId,'qa-produto');assert.equal(result.route.started,false);assert.equal(result.route.acao,'login');
  });
  await check('Login em VPS cria painel só no destino atual e recusa outro servidor',async()=>{
    await ev("cfg.abaAtiva='qa-servidor';window.accRemotePlace=lugarDaConta('codex',abaAtual());window.accRemoteEngine=MOTORES.find(engine=>!painelParaConta(engine,accRemotePlace.chave));window.accCountBefore=panes.size;accOriginalLogin(accRemoteEngine,accRemotePlace);");
    const result=await ev('({route:accRoutes.at(-1),count:panes.size,previous:accCountBefore,chave:accRemotePlace.chave,engine:accRemoteEngine})');
    assert.equal(result.count,result.previous+1);assert.equal(result.route.chave,result.chave);assert.equal(result.route.engine,result.engine);assert.equal(result.route.abaId,'qa-servidor');assert.equal(result.route.started,false);
    await ev("window.accCountBefore=panes.size;window.accRoutesBefore=accRoutes.length;accOriginalLogin('codex',{remoto:{host:'outro.example.invalid',usuario:'qa',porta:2222},chave:'qa@outro.example.invalid:2222',rotulo:'Outro servidor'});");
    assert.equal(await ev('panes.size===accCountBefore && accRoutes.length===accRoutesBefore && accDenied.length===1'),true);
    await ev('contaAcao=accSavedContaAcao;semPainelDaConta=accSavedSemPainel;cfg.abaAtiva=accOldActive;void 0;');
  });
  for(const [width,height] of [[1440,900],[390,844],[844,390]])await check('Layout '+width+'×'+height,async()=>{
    win.setContentSize(width,height);await open();await delay(70);
    const m=await ev("(()=>{const p=document.querySelector('.ck-account'),b=p.querySelector('.ck-layer-body'),r=p.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:b.scrollWidth>b.clientWidth};})()");
    assert.ok(m.left>=0&&m.right<=m.width+1&&m.top>=0&&m.bottom<=m.height+1,JSON.stringify(m));assert.equal(m.overflow,false);await capture('contas-'+width+'x'+height);
  });
  for(const theme of ['jornal','claro','escuro','azul'])await check('Tema '+theme,async()=>{
    win.setContentSize(1440,900);await open();await ev(`document.documentElement.setAttribute('data-tema','${theme}');`);await capture('contas-'+theme);
    assert.equal(await ev('document.documentElement.dataset.tema'),theme);
    const paint=await ev("(()=>{const p=document.querySelector('.ck-account');return{opacity:getComputedStyle(p).opacity,background:getComputedStyle(p).backgroundColor,canvas:getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim()}})()");
    assert.equal(Number(paint.opacity),1);fs.writeFileSync(path.join(run,'tema-'+theme+'.json'),JSON.stringify(paint));
  });
  const state=await ev('({errors:__qa.errors,missing:[...__qa.missing],engines:__qa.calls.filter(c=>/^(paneStart|paneSend|debateStart|termRun)$/.test(c.method))})');
  if(state.errors.length||state.missing.length||state.engines.length)errors.push(JSON.stringify(state));
  if(blocked.length)errors.push('Rede bloqueada: '+blocked.join(', '));
  const after=await verifyServer();if(after.sourceHash!==identity.sourceHash)errors.push('Fonte mudou durante QA');finish();
}).catch(error=>{errors.push(error.stack);finish();});
function finish(){if(finished)return;finished=true;const report={status:errors.length||checks.some(c=>!c.passed)?'failed':'passed',at:new Date().toISOString(),sourceIdentity:identity,checks,errors,blocked,run,productionMainLoaded:false,realAccountsChanged:false};fs.writeFileSync(path.join(run,'report.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(artifacts,'contas-popup-qa.json'),JSON.stringify(report,null,2));app.exit(report.status==='passed'?0:1);}
