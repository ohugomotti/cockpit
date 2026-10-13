'use strict';
// Renderer real, APIs em memória e perfil isolado. Nunca inicia motores reais.
const { app, BrowserWindow, session } = require('electron');
// Um terminal encerrado não pode abrir uma caixa de erro no desktop do usuário.
// O relatório em disco continua sendo a fonte do resultado do teste.
for (const stream of [process.stdout, process.stderr]) stream.on('error', error => {
  if (error.code !== 'EPIPE') app.exit(1);
});
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { verifyServer, ORIGIN } = require('./qa-environment.cjs');
const artifacts = path.resolve(__dirname, '../../artifacts');
const run = path.join(artifacts, 'agente-popup-qa-' + new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(run, { recursive: true });
app.setPath('userData', path.join(run, 'profile'));
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
let win, identity;
const checks = [], errors = [], blocked = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const ev = code => win.webContents.executeJavaScript(code);
async function until(code) { for (let i = 0; i < 140; i++) { if (await ev(code)) return; await delay(70); } throw Error('Timeout: ' + code); }
async function check(name, fn) { try { await fn(); checks.push({ name, passed: true }); } catch (e) { checks.push({ name, passed: false, error: e.stack }); } console.log(JSON.stringify(checks.at(-1))); }
async function settleAnimation() { await ev("document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).forEach(a=>{try{a.finish();}catch{}})"); }
async function capture(name) { await settleAnimation(); win.webContents.invalidate(); await ev('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))'); await delay(180); fs.writeFileSync(path.join(run, name + '.png'), (await win.webContents.capturePage()).toPNG()); }
async function close() { await ev('while(CockpitUI.layers.length)CockpitUI.closeLayer();'); await delay(180); }
async function fresh(remote = false) {
  await close();
  await ev(`window.__agentCalls=0;__qa.override('paneStop',async()=>true);__qa.override('motoresDisponiveis',async()=>Object.fromEntries(MOTORES.map(e=>[e,{disponivel:true}])));__qa.override('codexModels',async()=>[{id:'modelo-qa-um',nome:'Modelo Codex Um',efforts:['low','high'],padraoEffort:'high',padrao:true},{id:'modelo-qa-dois',nome:'Modelo Codex Dois',efforts:['medium','max'],padraoEffort:'medium'}]);window.ap=newPane({engine:'claude',abaId:${remote ? "'qa-servidor'" : "'qa-produto'"},cwd:${remote ? "'/srv/projeto'" : "'C:/QA'"}});ap.busy=false;ap.started=false;ap.model=modelosDe(ap)[0].id;ap.mode=MODOS.claude[0].id;window.agentOpening=CockpitUI.agentLayer(ap);void 0`);
  await until("!!document.querySelector('.ck-agent .ck-mode-section')");
  await ev('window.agentPanel=document.querySelector(".ck-agent");window.agentLayerRef=CockpitUI.layers.at(-1);');
}
async function clickEngine(engine) { await ev(`document.querySelector('.ck-agent .ck-engine-option[data-motor="${engine}"]').click();void 0`); }
const samePanel = "document.querySelector('.ck-agent')===agentPanel && CockpitUI.layers.at(-1)===agentLayerRef && !agentLayerRef.closed";
app.whenReady().then(async () => {
  identity = await verifyServer();
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => { const allowed = details.url.startsWith(ORIGIN + '/') || details.url.startsWith('data:') || details.url.startsWith('blob:' + ORIGIN) || details.url === 'about:blank'; if (!allowed) blocked.push(details.url); callback({ cancel: !allowed }); });
  win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('render-process-gone', (_event, data) => errors.push('Renderer: ' + data.reason));
  await win.loadURL(ORIGIN + '/?cenario=supervisao&visual=1&tema=jornal');
  await until('!!window.__qa?.ready');

  await check('Claude → Codex → Claude conserva a mesma janela e atualiza todas as escolhas', async () => {
    await fresh(); await clickEngine('codex');
    await until("ap.engine==='codex' && !!document.querySelector('[data-model=\"modelo-qa-um\"]')");
    assert.equal(await ev(samePanel), true);
    assert.equal(await ev("document.querySelectorAll('.ck-fallback').length"), 0);
    assert.equal(await ev("document.querySelector('.ck-engine-option.ck-selected').dataset.motor"), 'codex');
    assert.deepEqual(await ev("[...document.querySelectorAll('.ck-mode-choice')].map(b=>b.dataset.mode)"), await ev("MODOS.codex.map(m=>m.id)"));
    assert.equal(await ev("document.activeElement.dataset.motor"), 'codex');
    await clickEngine('claude'); await until("ap.engine==='claude' && !!document.querySelector('.ck-fallback')");
    assert.equal(await ev(samePanel), true);
    assert.equal(await ev("document.querySelectorAll('[data-model=\"modelo-qa-um\"]').length"), 0);
    assert.equal(await ev("document.activeElement.dataset.motor"), 'claude');
  });
  await check('Modelo, esforço e permissões mudam sem fechar ou substituir a janela', async () => {
    await fresh(); await clickEngine('codex'); await until("!!document.querySelector('[data-model=\"modelo-qa-dois\"]')");
    await ev("document.querySelector('[data-model=\"modelo-qa-dois\"]').click();void 0");
    await until("document.querySelector('.ck-model-options .ck-selected')?.dataset.model==='modelo-qa-dois'");
    assert.equal(await ev(samePanel), true);
    assert.deepEqual(await ev("[...document.querySelectorAll('.ck-effort-level')].map(b=>b.dataset.effort)"), ['medium', 'max']);
    await ev("document.querySelector('[data-effort=max]').click();void 0");
    await until("document.querySelector('.ck-effort-level.ck-selected')?.dataset.effort==='max'");
    assert.equal(await ev(samePanel), true);
    await ev("window.wantedMode=[...document.querySelectorAll('.ck-mode-choice')].find(b=>!b.classList.contains('ck-selected')&&!b.disabled).dataset.mode;document.querySelector('[data-mode=\"'+wantedMode+'\"]').click();void 0");
    await until("document.querySelector('.ck-mode-choice.ck-selected')?.dataset.mode===wantedMode");
    assert.equal(await ev(samePanel), true);
    assert.equal(await ev('ap.mode===wantedMode'), true);
  });
  await check('Clique duplo durante troca inicia somente uma troca', async () => {
    await fresh();
    await ev("__qa.override('paneStop',()=>{__agentCalls++;return new Promise(r=>window.finishStop=r);});document.querySelector('.ck-agent .ck-engine-option[data-motor=codex]').click();document.querySelector('.ck-agent .ck-engine-option[data-motor=gemini]').click();void 0");
    await until('!!window.finishStop'); assert.equal(await ev('__agentCalls'), 1);
    assert.equal(await ev("document.querySelector('.ck-agent .ck-engine-option[data-motor=gemini]').disabled"), true);
    await ev('finishStop(true);void 0'); await until("ap.engine==='codex' && !!document.querySelector('[data-model=\"modelo-qa-um\"]')");
    assert.equal(await ev(samePanel), true);
  });
  await check('Esc durante catálogo atrasado fecha definitivamente e não rouba foco', async () => {
    await fresh();
    await ev("__qa.override('codexModels',()=>new Promise(r=>window.finishModels=r));delete ap.uiCodexModels;document.querySelector('.ck-agent .ck-engine-option[data-motor=codex]').click();void 0");
    await until('!!window.finishModels');
    await ev("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));window.focusAfterEscape=document.activeElement;finishModels([{id:'atrasado',nome:'Não reabrir',efforts:['high']}]);void 0");
    await delay(250);
    assert.equal(await ev('agentLayerRef.closed && !agentPanel.isConnected'), true);
    assert.equal(await ev('document.activeElement===focusAfterEscape'), true);
    assert.equal(await ev('CockpitUI.layers.length'), 0);
  });
  await check('Falha na troca deixa erro visível e libera nova tentativa', async () => {
    await fresh(); await ev("__qa.override('paneStop',async()=>{throw Error('Falha simulada de conexão');});void 0"); await clickEngine('codex');
    await until("document.querySelector('.ck-agent-feedback')?.textContent.includes('Falha simulada')");
    assert.equal(await ev(samePanel), true); assert.equal(await ev('ap.engine'), 'claude');
    assert.equal(await ev("document.querySelector('.ck-agent .ck-engine-option[data-motor=codex]').disabled"), false);
    await ev("__qa.override('paneStop',async()=>true);void 0"); await clickEngine('codex');
    await until("ap.engine==='codex' && !!document.querySelector('[data-model=\"modelo-qa-um\"]')");
    assert.equal(await ev(samePanel), true);
  });
  await check('Recusa de capacidade remota mantém o motor e a janela utilizável', async () => {
    await fresh(true);
    await ev("window.refuseOnce=true;__qa.override('motoresDisponiveis',async()=>{const refuse=refuseOnce;refuseOnce=false;return Object.fromEntries(MOTORES.map(e=>[e,{disponivel:!(refuse&&e==='codex')}]));});void 0");
    await clickEngine('codex');
    await until("document.querySelector('.ck-agent-feedback')?.textContent.includes('anterior foi mantido')");
    assert.equal(await ev('ap.engine'), 'claude'); assert.equal(await ev(samePanel), true);
    assert.equal(await ev("document.querySelector('.ck-agent .ck-engine-option[data-motor=codex]').disabled"), false);
    await clickEngine('codex'); await until("ap.engine==='codex' && !!document.querySelector('[data-model=\"modelo-qa-um\"]')");
    assert.equal(await ev(samePanel), true);
  });
  await check('Erro de catálogo não bloqueia escolha de outro motor', async () => {
    await fresh(); await ev("__qa.override('codexModels',async()=>{throw Error('Catálogo indisponível QA');});delete ap.uiCodexModels;void 0"); await clickEngine('codex');
    await until("document.querySelector('.ck-agent')?.textContent.includes('Lista não confirmada')");
    assert.equal(await ev(samePanel), true);
    await clickEngine('claude'); await until("ap.engine==='claude' && !!document.querySelector('.ck-fallback')");
    assert.equal(await ev(samePanel), true);
  });
  await check('Plano e pergunta bloqueantes explicam recusa de permissão dentro do popup', async () => {
    for (const pending of ['plano', 'pergunta']) {
      await fresh();
      await ev(`ap.mode=MODOS.claude[0].id;ap.planoPendente=${pending === 'plano' ? '{}' : 'null'};ap.perguntaAberta=${pending === 'pergunta' ? '{bloqueante:true}' : 'null'};window.oldMode=ap.mode;document.querySelector('.ck-agent .ck-mode-choice[data-mode="plan"]').click();void 0`);
      await until("document.querySelector('.ck-agent-feedback')?.textContent.includes('Responda o plano ou a pergunta')");
      assert.equal(await ev(samePanel), true); assert.equal(await ev('ap.mode===oldMode'), true);
      assert.equal(await ev("document.querySelector('.ck-mode-choice.ck-selected').dataset.mode===oldMode"), true);
      await ev('ap.planoPendente=null;ap.perguntaAberta=null;');
    }
  });
  await check('Em 390px, abrir permissões e trocar motor mantém foco visível no motor', async () => {
    win.setContentSize(390,844); await fresh(); await close();
    await ev("CockpitUI.agentLayer(ap,'mode');void 0"); await until("!!document.querySelector('.ck-agent .ck-mode-section')");
    await ev("window.agentPanel=document.querySelector('.ck-agent');window.agentLayerRef=CockpitUI.layers.at(-1);document.querySelector('.ck-agent .ck-layer-body').scrollTop=0;");
    await clickEngine('codex'); await until("!!document.querySelector('[data-model=\"modelo-qa-um\"]')"); await settleAnimation(); await delay(100);
    assert.equal(await ev(samePanel), true);
    assert.equal(await ev("(()=>{const a=document.activeElement,r=a.getBoundingClientRect(),b=document.querySelector('.ck-agent .ck-layer-body').getBoundingClientRect();return a.dataset.motor==='codex'&&r.top>=b.top&&r.bottom<=b.bottom;})()"), true);
    win.setContentSize(1440,900);
  });
  await check('Destino alterado durante consulta não pinta catálogo do destino antigo', async () => {
    await fresh(true); await ev("__qa.override('codexModels',()=>new Promise(r=>window.oldCatalog=r));delete ap.uiCodexModels;document.querySelector('.ck-agent .ck-engine-option[data-motor=codex]').click();void 0");
    await until('!!window.oldCatalog');
    await ev("ap.abaId='qa-produto';oldCatalog([{id:'conta-antiga',nome:'CATALOGO_ERRADO',efforts:['high']}]);void 0"); await delay(150);
    assert.doesNotMatch(await ev('agentPanel.textContent'), /CATALOGO_ERRADO/);
    assert.equal(await ev("ap.uiCodexModels?.some(m=>m.id==='conta-antiga')||false"), false);
  });
  await check('Catálogo do Claude inclui Sonnet 5.5 e Haiku não oferece esforço nem envia a opção', async () => {
    await fresh();
    assert.equal(await ev("!!document.querySelector('[data-model=\"claude-sonnet-5-5\"]')"),true);
    await ev("document.querySelector('[data-model=\"claude-haiku-4-5-20251001\"]').click();void 0");
    await until("document.querySelector('.ck-choice.ck-selected')?.dataset.model==='claude-haiku-4-5-20251001'");
    assert.equal(await ev("document.querySelectorAll('.ck-effort-level').length"),0);
    assert.equal(await ev('esforcoDe(ap)===undefined'),true);
    assert.equal(await ev(samePanel),true);
  });
  await check('Atualizar catálogo preserva modelo escolhido que deixou de aparecer', async () => {
    await fresh();
    await ev("window.beforeModel=ap.model;__qa.override('claudeModels',async()=>({models:[{id:'claude-opus-5-5',nome:'Opus',efforts:['medium']}]}));document.querySelector('.ck-model-refresh').click();void 0");
    await until("!!document.querySelector('.ck-model-preserved')");
    assert.equal(await ev('ap.model===beforeModel'),true);
    assert.equal(await ev("document.querySelector('.ck-choice.ck-selected').dataset.model===beforeModel"),true);
    await ev("__qa.override('claudeModels',async()=>({models:[{id:'claude-sonnet-5-5',nome:'Sonnet',efforts:['low','medium','high','xhigh','max'],padraoEffort:'medium'}]}));void 0");
  });
  await check('Codex tem texto em português, ícone de imagem e não imprime identificação técnica', async () => {
    await fresh();
    await ev("__qa.override('codexModels',async()=>[{id:'gpt-6.1-sol',nome:'GPT-6.1-Sol',desc:'Latest workhorse model for coding and everyday work.',modalitiesConfirmed:true,inputModalities:['text','image'],server:{userAgent:'cockpit/0.159.0 (Windows 10.0.26200; x86_64) unknown'},efforts:['low','medium','high','xhigh','max','ultra']}]);void 0");
    await clickEngine('codex'); await until("!!document.querySelector('[data-model=\"gpt-6.1-sol\"]')");
    const text=await ev("agentPanel.textContent");
    assert.match(text,/programação e trabalho diário/); assert.doesNotMatch(text,/workhorse|Windows 10|unknown|◉/);
    assert.equal(await ev("!!document.querySelector('[data-model=\"gpt-6.1-sol\"] .ck-model-capabilities svg')"),true);
    assert.equal(await ev("document.querySelector('.ck-agent-account').textContent.trim()"),'');
    await capture('modelos-codex-textos');
  });
  for (const [width, height] of [[1440,900],[760,900],[600,900],[390,844],[1440,420]]) {
    await check('Layout e rolagem em ' + width + '×' + height, async () => {
      win.setContentSize(width, height); await delay(100); await fresh();
      await ev("__qa.override('codexModels',async()=>Array.from({length:5},(_,i)=>({id:['gpt-6-astra','gpt-6-sol','gpt-6-luna','gpt-5.6-sol','gpt-5.6-terra'][i],nome:['GPT-6 Astra','GPT-6 Sol','GPT-6 Luna','GPT-5.6 Sol','GPT-5.6 Terra'][i],desc:'Modelo com descrição completa para conferir leitura, espaço e escolha.',contextWindow:1000000,efforts:['low','medium','high','xhigh','max','ultra'],padraoEffort:'high',padrao:i===0})));void 0");
      await clickEngine('codex'); await until("document.querySelectorAll('.ck-agent .ck-effort-level').length===6"); await settleAnimation();
      const measurements = await ev(`(()=>{const p=document.querySelector('.ck-agent'),b=p.querySelector('.ck-layer-body'),g=p.querySelector('.ck-agent-grid'),r=p.getBoundingClientRect();return{width:r.width,left:r.left,right:r.right,top:r.top,bottom:r.bottom,vw:innerWidth,vh:innerHeight,columns:getComputedStyle(g).gridTemplateColumns.split(' ').length,scroll:b.scrollHeight,body:b.clientHeight,overflow:p.scrollWidth>p.clientWidth||b.scrollWidth>b.clientWidth};})()`);
      assert.ok(measurements.left>=0 && measurements.right<=measurements.vw+1 && measurements.top>=0 && measurements.bottom<=measurements.vh+1, JSON.stringify(measurements));
      assert.equal(measurements.overflow, false, JSON.stringify(measurements));
      assert.equal(await ev("[...document.querySelectorAll('.ck-effort-level')].every(b=>b.scrollWidth<=b.clientWidth&&getComputedStyle(b).whiteSpace==='nowrap')"),true,'Nível de esforço cortado');
      assert.equal(measurements.columns, width<=680?1:2);
      if (width===1440) assert.ok(Math.abs(measurements.width-840)<2, JSON.stringify(measurements));
      if (height===420) { assert.ok(measurements.scroll>measurements.body); await ev("document.querySelector('.ck-agent .ck-layer-body').scrollTop=10000;"); }
      await capture('agente-'+width+'x'+height);
    });
  }
  for (const theme of ['claro','jornal','azul','escuro']) {
    await check('Tema ' + theme, async () => { win.setContentSize(1440,900); await fresh(); await ev(`document.documentElement.setAttribute('data-tema','${theme}');`); await capture('agente-'+theme); });
  }
  await check('Shift+Tab muda direto na ordem reordenada da faixa e conserva a animação', async () => {
    await close();
    await ev("window.oldTabOrder=cfg.abas.slice();cfg.abas=[abaPorId('qa-servidor'),abaPorId('qa-produto'),abaPorId('qa-site')];CockpitUI.refresh();trocarAbaLocal('qa-produto');void 0");
    await until("!trocandoAba&&cfg.abaAtiva==='qa-produto'");
    const key = async modifiers => { win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab',modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab',modifiers});await delay(100); };
    await key(['shift']); await until("!trocandoAba&&cfg.abaAtiva==='qa-site'");
    assert.equal(await ev("!!document.querySelector('.ck-troca-pasta')"),false);
    await key(['shift']); await until("!trocandoAba&&cfg.abaAtiva==='qa-servidor'");
    await key(['control','shift']); await until("!trocandoAba&&cfg.abaAtiva==='qa-site'");
    assert.equal(await ev("!!document.querySelector('.ck-troca-pasta')"),false);
    await ev("cfg.abas=oldTabOrder;CockpitUI.refresh();trocarAbaLocal('qa-produto');void 0");
    await until("!trocandoAba&&cfg.abaAtiva==='qa-produto'");
  });
  const state=await ev('({errors:__qa.errors,missing:[...__qa.missing],engineCalls:__qa.calls.filter(c=>/^(paneStart|paneSend|debateStart|termRun)$/.test(c.method))})');
  if(state.errors.length||state.missing.length||state.engineCalls.length)errors.push(JSON.stringify(state));
  if(blocked.length)errors.push('Rede externa bloqueada: '+blocked.join(', '));
  const after=await verifyServer();if(after.sourceHash!==identity.sourceHash)errors.push('Fonte mudou durante o QA');
  finish();
}).catch(e=>{errors.push(e.stack);finish();});
function finish(){const report={status:errors.length||checks.some(c=>!c.passed)?'failed':'passed',at:new Date().toISOString(),sourceIdentity:identity,checks,errors,blocked,run,authenticatedEnginesStarted:false,productionMainLoaded:false};fs.writeFileSync(path.join(run,'report.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(artifacts,'agente-popup-qa.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:checks.length,errors,run}));app.exit(report.status==='passed'?0:1);}
