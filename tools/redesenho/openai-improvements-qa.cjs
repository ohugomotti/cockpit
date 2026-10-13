'use strict';
// Renderer real, somente respostas simuladas; bloqueia toda rede fora da prévia.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { verifyServer, ORIGIN } = require('./qa-environment.cjs');
for (const s of [process.stdout, process.stderr]) s.on('error', e => { if (e.code !== 'EPIPE') app.exit(1); });
const run = path.resolve(__dirname, '../../artifacts/openai-improvements-qa-' + Date.now());
fs.mkdirSync(run, { recursive:true }); app.setPath('userData', path.join(run,'profile'));
for (const flag of ['disable-background-networking','disable-component-update','mute-audio']) app.commandLine.appendSwitch(flag);
const checks = [], errors = [], delay = ms => new Promise(r => setTimeout(r, ms));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR4cAAAAASUVORK5CYII=';
let win;
const ev = code => win.webContents.executeJavaScript(code);
async function until(code) { for(let n=0;n<100;n++){if(await ev(code))return;await delay(60);}throw Error('Timeout: '+code); }
async function check(name,fn){try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.stack});}console.log(JSON.stringify(checks.at(-1)));}
async function click(label,scope='.exp-dialog'){await ev(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(scope)}+' button')].find(x=>x.getAttribute('aria-label')===${JSON.stringify(label)});if(!b)throw Error('Botão ausente: '+${JSON.stringify(label)});b.click()})()`);await delay(140);}
async function capture(name){win.webContents.invalidate();await ev('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');await delay(300);fs.writeFileSync(path.join(run,name+'.png'),(await win.webContents.capturePage()).toPNG());}
async function close(){await ev('document.querySelectorAll("dialog[open]").forEach(d=>d.close());void 0');await delay(100);}
app.whenReady().then(async()=>{
 const identity=await verifyServer();
 session.defaultSession.webRequest.onBeforeRequest((r,cb)=>{const ok=r.url.startsWith(ORIGIN+'/')||r.url.startsWith('data:')||r.url==='about:blank';if(!ok)errors.push('Rede externa bloqueada');cb({cancel:!ok});});
 win=new BrowserWindow({width:1440,height:980,show:false,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 await win.loadURL(ORIGIN+'/?cenario=supervisao&visual=1&tema=jornal');
 await until('!!window.__qa?.ready&&__qa.panels.length===3');
 await ev(`window.qaPanel=__qa.panel(__qa.panels[0]);window.pilotCalls=[];window.mockConfigured=false;window.cloudDone=false;window.cloudApproved=false;window.testImage=${JSON.stringify(PNG)};
 __qa.override('experimentsStatus',async()=>({configured:mockConfigured}));
 __qa.override('experimentsGrant',async x=>{pilotCalls.push(['grant',x]);return{grant:'mock-only'}});
 __qa.override('experimentsImage',async x=>{pilotCalls.push(['image',x]);return{image:testImage}});
 __qa.override('experimentsSaveImage',async x=>{pilotCalls.push(['save',x]);return{ok:true}});
 __qa.override('imagemSalvar',async x=>{pilotCalls.push(['store',x]);return{arquivo:'C:/QA/gerada.png'}});
 __qa.override('anexoLer',async file=>({path:file,nome:'gerada.png',ext:'png',bytes:68,mini:testImage}));
 __qa.override('cloudList',async()=>cloudDone?[{id:'session_cloud_qa',title:'Tarefa fictícia'}]:[]);
 __qa.override('cloudStart',async x=>{pilotCalls.push(['cloudStart',x]);cloudDone=true;return{id:'session_cloud_qa'}});
 __qa.override('cloudRead',async id=>({session:{id,status:'running',required_actions:cloudApproved?[]:[{type:'computer_use_approval_request',request_id:'approval_qa',request:{type:'browser_origin_access',origin:'https://example.test'}}]},items:[{content:[{type:'output_text',text:'Resultado **fictício**.'}]}],artifacts:[{id:'file_qa',path:'/mnt/data/plano.md'}],hasMore:false}));
 __qa.override('cloudApprove',async x=>{pilotCalls.push(['cloudApprove',x]);cloudApproved=true;return{ok:true}});
 __qa.override('cloudCancel',async x=>{pilotCalls.push(['cloudCancel',x]);return{ok:true}});
 __qa.override('cloudArtifact',async x=>{pilotCalls.push(['cloudArtifact',x]);return{ok:true}});
 void 0;`);
 await check('Pilotos desligados por padrão e ícones visíveis/acessíveis',async()=>{
  await ev('CockpitExperiments.open(qaPanel,{tab:"images"})');
  assert.match(await ev('document.querySelector(".exp-body").textContent'),/Desligado/);
  assert.equal(await ev('pilotCalls.length'),0);
  assert.equal(await ev('[...document.querySelectorAll(".exp-dialog button,.p-experiments")].every(b=>b.title&&b.getAttribute("aria-label")&&b.querySelector("svg>*"))'),true);
 });
 await check('Imagem só gera após consentimento; compara original e nova versão',async()=>{
  await close();await ev('mockConfigured=true;CockpitExperiments.open(qaPanel,{tab:"images",image:testImage})');
  await ev('document.querySelector(".exp-body textarea").value="Altere a cor do fundo"');
  await click('Gerar nova versão');assert.equal(await ev('pilotCalls.length'),0);
  await ev('document.querySelector(".exp-consent input").checked=true');await click('Gerar nova versão');
  assert.equal(await ev('pilotCalls.filter(x=>x[0]==="image").length'),1);
  assert.equal(await ev('document.querySelectorAll(".exp-images img").length'),2);
  assert.equal(await ev('document.querySelector(".exp-consent input").checked'),false);
  await capture('images-desktop');
  await ev('document.querySelector(".exp-image-output img").click()');
  assert.equal(await ev('document.querySelector(".exp-image-preview").getBoundingClientRect().width>innerWidth*.9'),true);
  await click('Ampliar imagem','.exp-image-preview');await click('Fechar imagem ampliada','.exp-image-preview');
  assert.equal(await ev('document.querySelectorAll(".exp-images img").length'),2);
 });
 await check('Salvar/anexar não envia mensagem; troca de conta invalida o painel',async()=>{
  const before=await ev('__qa.calls.filter(c=>["paneSend","paneStart"].includes(c.method)).length');
  await click('Salvar nova imagem');await click('Anexar nova imagem sem enviar');
  assert.equal(await ev('qaPanel.anexos.at(-1).path'),'C:/QA/gerada.png');
  assert.equal(await ev('__qa.calls.filter(c=>["paneSend","paneStart"].includes(c.method)).length'),before);
  await ev('qaPanel.uiContaGeracao=(qaPanel.uiContaGeracao||0)+1');await click('Anexar nova imagem sem enviar');
  assert.match(await ev('document.querySelector(".exp-body").textContent'),/sessão mudou/);
 });
 await check('Nuvem exige autorização, mantém sessão e pede liberação de cada site',async()=>{
  await close();await ev('CockpitExperiments.open(qaPanel,{tab:"cloud"})');
  await ev('document.querySelector(".exp-body textarea").value="Pesquise páginas públicas"');
  await click('Iniciar tarefa paga na nuvem');assert.equal(await ev('pilotCalls.filter(x=>x[0]==="cloudStart").length'),0);
  await ev('document.querySelectorAll(".exp-consent input")[1].checked=true');await click('Iniciar tarefa paga na nuvem');
  assert.equal(await ev('pilotCalls.filter(x=>x[0]==="cloudStart").length'),1,JSON.stringify(await ev('[...document.querySelectorAll(".exp-dialog")].map(d=>({open:d.open,text:d.textContent,inputs:[...d.querySelectorAll("input,textarea")].map(x=>({v:x.value,c:x.checked}))}))')));
  assert.equal(await ev('pilotCalls.filter(x=>x[0]==="cloudApprove").length'),0);
  await click('Autorizar acesso a este site');await click('Baixar plano.md');await click('Cancelar o trabalho na nuvem');
  assert.equal(await ev('pilotCalls.find(x=>x[0]==="cloudApprove")[1].sessionId'),'session_cloud_qa');
  assert.equal(await ev('pilotCalls.filter(x=>x[0]==="cloudStart").length'),1);
  await capture('cloud-desktop');
 });
 await check('Pilotos cabem em 390px, sem corte lateral ou foco perdido',async()=>{
  win.setSize(390,844);await delay(160);
  assert.equal(await ev('document.querySelector(".exp-dialog").getBoundingClientRect().right<=innerWidth'),true);
  assert.equal(await ev('document.querySelector(".exp-body").scrollWidth<=document.querySelector(".exp-body").clientWidth+1'),true);
  await capture('cloud-mobile');win.setSize(1440,980);await close();
 });
 await check('Histórico inteiro em memória, com montagem pequena e busca até o começo',async()=>{
  await ev('qaPanel.historyPager?.dispose();qaPanel.chat.replaceChildren();qaPanel.hist=[];qaPanel.blocks=new Map();window.historyFixture=Array.from({length:2000},(_,i)=>({role:i%2?"bot":"user",text:"Mensagem "+i+" "+(i===1234?"palavraunica":"conteúdo")}));desenharHistorico(qaPanel,historyFixture);void 0');
  assert.equal(await ev('qaPanel.hist.length'),2000);assert.equal(await ev('document.querySelectorAll(".history-pages-content > *").length'),60);
  await click('Ir à primeira mensagem','.history-pages-toolbar');assert.match(await ev('document.querySelector(".history-pages-content").textContent'),/Mensagem 0 /);
  await ev('document.querySelector(".history-pages-toolbar input").value="palavraunica"');await click('Buscar próximo trecho','.history-pages-toolbar');
  assert.match(await ev('document.querySelector(".history-match").textContent'),/Mensagem 1234 /);
  assert.equal(await ev('qaPanel.hist.length'),2000);await capture('history-desktop');
  await click('Ir à última mensagem','.history-pages-toolbar');assert.match(await ev('document.querySelector(".history-pages-content").textContent'),/Mensagem 1999 /);
 });
 await check('Pedido do conector no renderer não rouba foco e se resolve sem iniciar motor',async()=>{
  await ev('qaPanel.el.querySelector(".p-input").focus();__qa.emit("onPaneEvent",{paneId:qaPanel.id,kind:"connector-request",token:"connector_qa",mode:"url",serverName:"Teste",message:"Entre na conta",origin:{kind:"local"},urlOrigin:"https://example.test"});void 0');
  assert.equal(await ev('document.activeElement.matches(".p-input")'),true);
  assert.equal(await ev('qaPanel.connectorCards.size'),1);
  await ev('__qa.emit("onPaneEvent",{paneId:qaPanel.id,kind:"connector-resolved",token:"connector_qa",reason:"Concluído"});void 0');
  assert.equal(await ev('qaPanel.connectorCards.size'),0);
 });
 await check('Subagente abre leitura própria sem retomar nem enviar turno',async()=>{
  await ev('window.agentRead=0;__qa.override("agentesSessao",async()=>({itens:[{id:"child_qa",threadId:"thread_child_qa",paneId:qaPanel.id,engine:"codex",task:"Revisão na VPS",state:"completed",historySupported:true}]}));__qa.override("agentHistory",async()=>{agentRead++;return{messages:[{role:"user",text:"Pedido do agente"},{role:"bot",text:"Revisão concluída"}]}});window.agentBox=document.createElement("div");document.body.append(agentBox);CockpitCollaboration.paintAgents(agentBox);void 0');
  await until('!!document.querySelector(".co-agent-history-open")');
  const before=await ev('__qa.calls.filter(c=>["paneSend","paneStart"].includes(c.method)).length');
  await click('Ler a conversa deste agente','body');await until('agentRead===1');
  assert.match(await ev('document.querySelector(".co-agent-history").textContent'),/Revisão concluída/);
  assert.equal(await ev('__qa.calls.filter(c=>["paneSend","paneStart"].includes(c.method)).length'),before);
  await capture('subagent-desktop');await close();await ev('agentBox.remove()');
 });
 await check('Voz fica presa ao Claude selecionado e encerra ao fechar; rascunho não é atropelado',async()=>{
  await ev('window.originalVoice=CockpitLiveVoice;window.voiceDisposed=0;window.liveWiring=null;CockpitLiveVoice={mount:o=>{liveWiring=o;return{dispose(){voiceDisposed++},update(){}}}};CockpitExperiments.open(qaPanel,{tab:"voice"})');
  assert.equal(await ev('liveWiring.session.engine'),'claude');
  assert.equal(await ev('liveWiring.session.threadId'),'qa-session-0');
  assert.equal(await ev('liveWiring.getContext().includes("Mensagem 1999")'),false);
  await ev('qaPanel.el.querySelector(".p-input").value="Rascunho preservado"');
  assert.equal(await ev('liveWiring.sendToPane(liveWiring.session,"Outro pedido").then(x=>x.ok)'),false);
  assert.equal(await ev('qaPanel.el.querySelector(".p-input").value'),'Rascunho preservado');
  await ev('qaPanel.uiContaGeracao++');assert.equal(await ev('liveWiring.isCurrent()'),false);
  await close();assert.equal(await ev('voiceDisposed'),1);await ev('CockpitLiveVoice=originalVoice;void 0');
 });
 await check('Sem erro de console, sem requisição externa, nenhuma chamada de motor',async()=>{
  assert.deepEqual(await ev('__qa.errors'),[]);assert.deepEqual(errors,[]);
  assert.equal(await ev('__qa.calls.filter(c=>["paneSend","paneStart","liveOffer"].includes(c.method)).length'),0);
  assert.equal(win.isVisible(),false);
 });
 fs.writeFileSync(path.join(run,'result.json'),JSON.stringify({identity,checks,errors},null,2));console.log(JSON.stringify({run,passed:checks.filter(c=>c.passed).length,total:checks.length}));app.exit(checks.every(c=>c.passed)?0:1);
}).catch(e=>{console.error(e);app.exit(1);});
