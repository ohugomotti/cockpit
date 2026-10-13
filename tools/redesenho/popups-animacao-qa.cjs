'use strict';
// Renderer real, ponte fictícia e perfil separado. Não abre motores nem o app instalado.
const {app,BrowserWindow,session}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {verifyServer,ORIGIN}=require('./qa-environment.cjs');
const artifacts=path.resolve(__dirname,'../../artifacts');
app.setPath('userData',path.join(artifacts,'popups-animacao-qa-profile'));
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
const checks=[],errors=[];
let win,sourceIdentity;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const evaluate=code=>win.webContents.executeJavaScript(code);
async function check(name,fn){try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.message});}console.log(JSON.stringify(checks.at(-1)));}
async function frames(){win.webContents.invalidate();await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');}
async function clear(){await evaluate(`fecharMaisDetalhes();for(const p of panes.values())fecharModal(p);fecharModalGlobal();while(document.querySelector('.ck-overlay:not(.ck-saindo)')){const x=document.querySelector('.ck-overlay:not(.ck-saindo) .ck-layer-close');if(!x)break;x.click();}`);await delay(250);}
const openDiff=`mostrarDiffGit(__qa.panel(__qa.panels[1]),'arquivo-qa.txt','@@ -1 +1 @@\\n-antigo\\n+novo');`;
function assertViewport(g){assert.ok(Math.abs(g.x)<1&&Math.abs(g.y)<1,'véu deslocado: '+JSON.stringify(g));assert.ok(Math.abs(g.width-g.vw)<1&&Math.abs(g.height-g.vh)<1,'véu não cobre toda a janela: '+JSON.stringify(g));}
app.whenReady().then(async()=>{
  sourceIdentity=await verifyServer();
  session.defaultSession.webRequest.onBeforeRequest((d,cb)=>{const ok=d.url.startsWith(ORIGIN+'/')||d.url.startsWith('data:')||d.url==='about:blank';if(!ok)errors.push('Rede externa bloqueada');cb({cancel:!ok});});
  win=new BrowserWindow({width:1320,height:900,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  win.webContents.on('render-process-gone',(_e,d)=>errors.push('Renderer: '+d.reason));
  await win.loadURL(ORIGIN+'/?cenario=supervisao&visual=1&tema=jornal');
  for(let i=0;i<100&&!await evaluate('!!window.__qa?.ready');i++)await delay(80);
  assert.ok(await evaluate('!!window.__qa?.ready'),'renderer não abriu');
  await evaluate('document.fonts.ready');
  for(const width of [1320,1024,390]){
    win.setSize(width,900);await frames();await delay(250);
    await check('Véu do painel cobre a janela inteira em '+width+'px, com três painéis',async()=>{
      await evaluate(openDiff);await delay(230);await frames();
      const g=await evaluate(`(()=>{const m=document.querySelectorAll('.pane')[1].querySelector('.p-modal');const r=m.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,vw:innerWidth,vh:innerHeight,panes:document.querySelectorAll('.pane').length};})()`);
      assert.equal(g.panes,3);assertViewport(g);await clear();
    });
  }
  win.setSize(1320,900);await frames();await delay(250);
  await check('Reabrir modal de painel durante a saída cancela a animação e mantém o novo conteúdo',async()=>{
    const state=await evaluate(`(()=>{const p=__qa.panel(__qa.panels[1]);${openDiff}fecharModal(p);mostrarDiffGit(p,'reaberto.txt','novo conteúdo');const m=p.el.querySelector('.p-modal');return{leaving:m.classList.contains('ck-saindo'),pointer:getComputedStyle(m).pointerEvents};})()`);
    assert.equal(state.leaving,false,'modal reaberto continua saindo');assert.equal(state.pointer,'auto');
    await delay(210);assert.equal(await evaluate(`!__qa.panel(__qa.panels[1]).el.querySelector('.p-modal').classList.contains('hidden')`),true);await clear();
  });
  await clear();
  await check('Modal global reabre dentro de 150ms sem desaparecer',async()=>{
    await evaluate(`abrirModalGlobal().innerHTML='<input id="qa-global-a">';fecharModalGlobal();abrirModalGlobal().innerHTML='<input id="qa-global-b">';`);
    await delay(220);assert.equal(await evaluate(`!!document.querySelector('#qa-global-b')&&!document.querySelector('#modalGrupo').classList.contains('hidden')`),true);await clear();
  });
  await check('Camada modal mantém Tab preso e Escape devolve foco ao campo anterior',async()=>{
    await evaluate(`window.qaFocus=__qa.panel(__qa.panels[0]).el.querySelector('.p-input');qaFocus.focus();window.qaLayer=CockpitUI.openLayer('QA de foco');qaLayer.body.innerHTML='<input id="qa-first"><button id="qa-last">Último</button>';document.querySelector('#qa-last').focus();true;`);
    await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));`);
    assert.equal(await evaluate(`qaLayer.panel.contains(document.activeElement)`),true);
    await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));`);
    assert.equal(await evaluate(`document.activeElement===qaFocus`),true);await delay(180);assert.equal(await evaluate(`qaLayer.overlay.isConnected`),false);
  });
  await check('Mais detalhes permanece ancorado ao painel depois da animação',async()=>{
    await evaluate(`abrirMaisDetalhes(__qa.panel(__qa.panels[1]),'Trecho fictício usado somente no mock');true;`);await delay(300);await frames();
    const g=await evaluate(`(()=>{const e=document.querySelector('.ck-detalhes'),r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,left:parseFloat(e.style.left),top:parseFloat(e.style.top),vw:innerWidth,vh:innerHeight,transform:getComputedStyle(e).transform};})()`);
    assert.ok(Math.abs(g.x-g.left)<1&&Math.abs(g.y-g.top)<1,'animação deslocou ancoragem: '+JSON.stringify(g));assert.ok(g.x>=0&&g.y>=0&&g.x+g.width<=g.vw+1&&g.y+g.height<=g.vh+1);
  });
  await check('Mais detalhes deixa de interceptar cliques assim que começa a fechar',async()=>{
    const g=await evaluate(`(()=>{const e=document.querySelector('.ck-detalhes'),r=e.getBoundingClientRect();fecharMaisDetalhes();const hit=document.elementFromPoint(r.x+r.width/2,r.y+40);return{blocked:!!hit?.closest('.ck-overlay.ck-saindo'),pointer:getComputedStyle(e).pointerEvents};})()`);
    assert.equal(g.blocked,false,'camada saindo ainda recebe cliques: '+JSON.stringify(g));await delay(180);
  });
  await clear();
  await check('Rodapé reúne Debater, workflow, contexto único e contador com descrição honesta',async()=>{
    const state=await evaluate(`(()=>{const p=__qa.panel(__qa.panels[1]);return{debate:!!p.el.querySelector('.cmp-bar .p-debate'),workflow:!!p.el.querySelector('.cmp-bar .p-workflow'),battery:!!p.el.querySelector('.p-tokens'),ring:!p.el.querySelector('.p-compactar').classList.contains('hidden'),title:p.el.querySelector('.p-tempo-total').title};})()`);
    assert.equal(state.debate,true);assert.equal(state.workflow,true);assert.equal(state.battery,false);assert.equal(state.ring,true);assert.match(state.title,/conversas antigas passam a contar/);
  });
  await check('Tempo real de painel pausa na permissão e retoma depois da resposta sem contar espera',async()=>{
    await evaluate(`window.qt=__qa.panel(__qa.panels[1]);qt.robos=new Map();qt.agentesTrabalho=new Map();qt.filaPerm=[];qt.filaPerg=[];qt.perguntaAberta=null;qt.busy=true;qt._tempoTrabalho=CockpitWork.create();sincronizarTempoTrabalho(qt);qt._tempoTrabalho.at=performance.now()-2500;showApproval(qt,{key:'qa-time-approval',title:'Teste de tempo',tool:'Read'});true;`);
    const paused=await evaluate(`({...qt._tempoTrabalho})`);assert.equal(paused.running,false);assert.ok(paused.ms>=2500&&paused.ms<2700);
    await delay(300);await evaluate('sincronizarTempoTrabalho(qt);');assert.equal(await evaluate('qt._tempoTrabalho.ms'),paused.ms);
    await evaluate(`qt.el.querySelector('.pp-yes').click();true;`);await delay(30);assert.equal(await evaluate('qt._tempoTrabalho.running'),true);
    await evaluate(`qt.busy=false;setDot(qt,'idle');`);
  });
  await check('Save/restore conserva tempo, troca de conversa zera e histórico recupera somente medida salva',async()=>{
    const result=await evaluate(`(()=>{qt._tempoTrabalho=CockpitWork.create({ms:4321});window.qtSaved=fichaDoPainel(qt);const restored=newPane(opcoesDoPainelSalvo(qtSaved,qt.abaId));const saved=restored._tempoTrabalho.ms;qt.resumeId=null;qt.resumeAnterior=null;qt.sessaoId='qa-different-time';sincronizarTempoTrabalho(qt);const fresh=qt._tempoTrabalho.ms;qt.sessaoId=qtSaved.sessaoId;sincronizarTempoTrabalho(qt);const back=qt._tempoTrabalho.ms;restored.morto=true;restored.el.remove();panes.delete(restored.id);savePanes();return{saved,fresh,back,stored:cfg.temposTrabalho[qt._tempoConversa.chave].ms};})()`);
    assert.equal(result.saved,4321);assert.equal(result.fresh,0);assert.equal(result.back,4321);assert.equal(result.stored,4321);
  });
  await check('Workflow exibe vínculos reais, trabalho paralelo e nenhuma chamada de execução',async()=>{
    await evaluate(`window.qaExecBefore=__qa.calls.filter(c=>/^(paneStart|paneSend|debateStart|debateContinue|termRun)$/.test(c.method)).length;window.qaAgents=[{id:'qa-parent',paneId:qt.id,engine:qt.engine,parentId:qt.sessaoId,task:'Pesquisa',state:'running'},{id:'qa-child',paneId:qt.id,engine:qt.engine,parentId:'qa-parent',task:'Revisão',state:'completed'},{id:'qa-outside',paneId:'outro-painel',engine:qt.engine,task:'Não mostrar',state:'running'}];__qa.override('agentesSessao',async()=>({itens:qaAgents}));qt.robos=new Map([['qa-shell',{desc:'Comando em segundo plano'}]]);qt.el.querySelector('.p-workflow').click();true;`);await delay(260);
    const data=await evaluate(`(()=>{const l=document.querySelector('.ck-workflow');return{nodes:l.querySelectorAll('.org-card').length,nested:!!l.querySelector('[data-agent-id="qa-parent"]').parentNode.querySelector(':scope > .org-pendurado [data-agent-id="qa-child"]'),extra:l.innerText.includes('Não mostrar'),completed:l.querySelector('[data-agent-id="qa-child"]').dataset.state,executed:__qa.calls.filter(c=>/^(paneStart|paneSend|debateStart|debateContinue|termRun)$/.test(c.method)).length-qaExecBefore};})()`);
    assert.equal(data.nodes,4);assert.equal(data.nested,true);assert.equal(data.extra,false);assert.equal(data.completed,'completed');assert.equal(data.executed,0);
    await evaluate(`qaAgents[0].state='completed';CockpitCollaboration.refreshWorkflow(qt);true;`);await delay(60);assert.equal(await evaluate(`document.querySelector('[data-agent-id="qa-parent"]').dataset.state`),'completed');
    win.setSize(390,900);await frames();await delay(200);const small=await evaluate(`(()=>{const l=document.querySelector('.ck-workflow');const r=l.getBoundingClientRect();return{inside:r.x>=0&&r.right<=innerWidth+1,overflow:l.scrollWidth>l.clientWidth};})()`);assert.equal(small.inside,true);assert.equal(small.overflow,false);
    await evaluate(`CockpitUI.closeLayer();qt.robos=new Map();true;`);await delay(180);win.setSize(1320,900);await frames();
  });
  await check('Fechar painel em trabalho preserva o tempo observado até o último instante',async()=>{
    const state=await evaluate(`(async()=>{const p=newPane({engine:'codex',resumeId:'qa-close-counter'});p.busy=true;p._tempoTrabalho=CockpitWork.create({ms:5000});sincronizarTempoTrabalho(p);p._tempoTrabalho.at=performance.now()-1500;const key=p._tempoConversa.chave;await closePane(p.id);return{removed:!panes.has(p.id),ms:cfg.temposTrabalho?.[key]?.ms};})()`);
    assert.equal(state.removed,true);assert.ok(state.ms>=6500&&state.ms<6800,'perdeu intervalo ao fechar: '+JSON.stringify(state));
  });
  await check('Renderer termina sem erros JavaScript',async()=>{const e=await evaluate('__qa.errors');assert.deepEqual(e,[]);assert.deepEqual(errors,[]);});
  const report={status:checks.every(c=>c.passed)&&!errors.length?'passed':'failed',createdAt:new Date().toISOString(),sourceIdentity,realRenderer:true,realMain:false,animationsEnabled:true,checks,errors};
  fs.writeFileSync(path.join(artifacts,'popups-animacao-qa.json'),JSON.stringify(report,null,2)+'\n');win.destroy();app.exit(report.status==='passed'?0:1);
}).catch(error=>{fs.writeFileSync(path.join(artifacts,'popups-animacao-qa.json'),JSON.stringify({status:'failed',error:error.stack,checks,errors},null,2));console.error(error);app.exit(1);});
