'use strict';
// Usa somente a prévia identificada do worktree. Os lotes são fictícios.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { connect } = require('../redesenho/cdp');
const { verifyServer } = require('../redesenho/qa-environment.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const directory = path.resolve(__dirname, '../../artifacts/auditoria-fase2');
fs.mkdirSync(directory, { recursive: true });
const installMock = `(() => {
  window.qaScanJobs=new Map();window.qaScanCancelled=[];window.qaScanStarted=[];
  __qa.override('sessionsScan', request => new Promise(resolve => {
    qaScanStarted.push(request);qaScanJobs.set(request.requestId,{request,resolve});
  }));
  __qa.override('sessionsCancel', id => {
    qaScanCancelled.push(id);const job=qaScanJobs.get(id);
    if(job){job.resolve({requestId:id,cancelled:true});qaScanJobs.delete(id);}return true;
  });
  window.qaBatch=(id,items)=>__qa.emit('onSessionsProgress',{requestId:id,engine:'claude',items,scanned:items.length,complete:false});
  window.qaComplete=(id,items,truncated=false)=>{const job=qaScanJobs.get(id);job?.resolve({requestId:id,items,complete:true,truncated});qaScanJobs.delete(id);};
})()`;
(async () => {
  const client = await connect(), checks = [];
  const e = client.evaluate;
  const check = async (name, operation) => { try { await operation(); checks.push({ name, passed: true }); } catch (error) { checks.push({ name, passed: false, error: error.message }); } };
  try {
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await client.send('Page.reload', { ignoreCache: true }); await wait(500); await client.ready();
    assert.equal(await e('__qaIdentity.sourceHash'), client.sourceIdentity.sourceHash);
    const motorBefore = await e('__qa.calls.filter(c=>/^(paneStart|paneSend|paneStop|approve)$/.test(c.method)).length');
    await e(installMock);
    await check('Lateral mostra primeiro lote antes do término da consulta', async () => {
      await e(`window.qaHistPromise=loadHist('claude',true);window.qaFirst=qaScanStarted.at(-1).requestId;window.qaCwd=pastasDaAba(abaAtual())[0]||HOME;qaBatch(qaFirst,[{id:'qa-parcial',engine:'claude',title:'Ação progressiva de teste',cwd:qaCwd,when:123}]);`);
      await wait(100);
      assert.equal(await e('qaScanJobs.has(qaFirst)'), true);
      assert.equal(await e('histCache.claude.some(s=>s.id==="qa-parcial")'), true);
      assert.equal(await e('document.body.textContent.includes("Ação progressiva de teste")'), true);
    });
    await check('Nova carga cancela anterior e rejeita lote atrasado', async () => {
      await e(`window.qaNextPromise=loadHist('claude',true);window.qaNext=qaScanStarted.at(-1).requestId;qaBatch(qaFirst,[{id:'qa-obsoleto',engine:'claude',title:'Não pode aparecer',cwd:qaCwd,when:999}]);qaBatch(qaNext,[{id:'qa-atual',engine:'claude',title:'Consulta atual',cwd:qaCwd,when:456}]);`);
      assert.equal(await e('qaScanCancelled.includes(qaFirst)'), true, 'cancelamento da primeira consulta');
      assert.deepEqual(await e('histCache.claude.map(s=>s.id)'), ['qa-atual']);
      await e('qaComplete(qaNext,[{id:"qa-atual",engine:"claude",title:"Consulta atual",cwd:qaCwd,when:456}],true);qaNextPromise');
      await wait(100);
      assert.equal(await e('histCache.claude.truncated'), true, 'marca de limite no cache');
      assert.equal(await e('!!document.querySelector(".ck-history-limit")'), true, 'aviso de limite na lateral');
    });
    await check('Paleta busca sem acento e mostra lotes antes de concluir', async () => {
      await e(`CockpitUI.palette();document.querySelector('[data-scope=agents]').click();const input=document.querySelector('.ck-search');input.value='acao';input.dispatchEvent(new Event('input',{bubbles:true}));`);
      await wait(230);
      await e(`window.qaPalette=qaScanStarted.filter(r=>r.scope.startsWith('paleta-')&&r.engine==='claude').at(-1).requestId;qaBatch(qaPalette,[{id:'qa-paleta',engine:'claude',title:'Ação previdenciária fictícia',cwd:qaCwd,when:500}]);`);
      await wait(80);
      assert.equal(await e('[...document.querySelectorAll(".ck-result strong")].some(n=>n.textContent==="Ação previdenciária fictícia")'), true);
      assert.match(await e('document.querySelector(".ck-palette .ck-search-status").textContent'), /Carregando mais conversas/);
      assert.equal(await e('qaScanJobs.has(qaPalette)'), true);
      await client.screenshot('auditoria-historico-progressivo-desktop.png');
    });
    await check('Fechar paleta cancela a leitura e lote tardio não reabre camada', async () => {
      await e(`while(CockpitUI.layers.length)CockpitUI.closeLayer();qaBatch(qaPalette,[{id:'qa-tardio',title:'Evento tardio',engine:'claude',when:999}]);`);
      await wait(300);
      assert.equal(await e('qaScanCancelled.includes(qaPalette)'), true);
      assert.equal(await e('!!document.querySelector(".ck-palette")'), false);
      assert.equal(await e('document.body.textContent.includes("Evento tardio")'), false);
    });
    await check('Nenhuma exceção ou chamada de motor foi causada no desktop', async () => {
      assert.deepEqual(await e('__qa.errors'), []);
      assert.equal(await e('__qa.calls.filter(c=>/^(paneStart|paneSend|paneStop|approve)$/.test(c.method)).length'), motorBefore);
    });
    await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await client.send('Page.reload', { ignoreCache: true }); await wait(500); await client.ready();
    await e(installMock);
    await check('Progresso permanece legível e sem transbordamento em 390 px', async () => {
      await e(`CockpitUI.palette();document.querySelector('[data-scope=agents]').click();window.qaMobile=qaScanStarted.filter(r=>r.scope.startsWith('paleta-')&&r.engine==='claude').at(-1).requestId;qaBatch(qaMobile,[{id:'mobile',title:'Ação previdenciária fictícia',engine:'claude',when:123}]);`);
      await wait(100);
      assert.equal(await e('document.documentElement.scrollWidth>innerWidth+1'), false);
      assert.equal(await e('document.querySelector(".ck-palette .ck-search-status").getAttribute("role")'), 'status');
      await client.screenshot('auditoria-historico-progressivo-390.png');
      assert.deepEqual(await e('__qa.errors'), []);
    });
    await e('while(CockpitUI.layers.length)CockpitUI.closeLayer()');
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    const identity = await verifyServer();
    assert.equal(identity.sourceHash, client.sourceIdentity.sourceHash, 'Fonte mudou durante a auditoria');
    const report = { status: checks.every(item=>item.passed) ? 'passed' : 'failed', createdAt: new Date().toISOString(), sourceIdentity: identity, simulated: true, enginesStarted: false, checks };
    fs.writeFileSync(path.join(directory, 'historico-busca-browser.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report)); if (report.status !== 'passed') process.exitCode = 1;
  } finally { client.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
