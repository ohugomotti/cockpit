'use strict';
// Apenas a prévia local autenticada por identidade do worktree, com dados fictícios.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { connect } = require('../redesenho/cdp');
const { verifyServer } = require('../redesenho/qa-environment.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const out = path.resolve(__dirname, '../../artifacts/auditoria');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const client = await connect(), checks = [];
  const evaluate = client.evaluate;
  const check = async (name, fn) => {
    try { await fn(); checks.push({ name, passed: true }); }
    catch (error) { checks.push({ name, passed: false, error: error.message }); }
  };
  const type = async text => { await evaluate(`(() => {const i=document.querySelector('.ck-search'); i.value=${JSON.stringify(text)};i.dispatchEvent(new Event('input',{bubbles:true}));})()`); await wait(300); };
  const close = () => evaluate('while(CockpitUI.layers.length)CockpitUI.closeLayer();');
  try {
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await client.send('Page.reload', { ignoreCache: true }); await wait(700); await client.ready();
    const beforeCalls = await evaluate('__qa.calls.filter(c=>/^(paneStart|paneSend|paneStop|approve)$/.test(c.method)).length');
    await check('Busca oferece cinco filtros e mantém opções fora da sequência Tab', async () => {
      await evaluate('CockpitUI.palette()');
      assert.deepEqual(await evaluate('[...document.querySelectorAll(".ck-search-filter")].map(n=>n.textContent)'), ['Tudo','Conversas','Pastas','Arquivos','Comandos']);
      assert.ok(await evaluate('[...document.querySelectorAll(".ck-result")].every(n=>n.tabIndex===-1)'));
      assert.ok(await evaluate('document.querySelector(".ck-search").getAttribute("aria-describedby")'));
    });
    await check('Filtro Pastas encontra Previdência sem acento e exclui os demais grupos', async () => {
      await evaluate('cfg.abas.find(a=>a.id==="qa-produto").nome="Previdência";document.querySelector("[data-scope=folders]").click()');
      await type('previdencia');
      assert.deepEqual(await evaluate('[...document.querySelectorAll(".ck-result strong")].map(n=>n.textContent)'), ['Previdência']);
      assert.deepEqual(await evaluate('[...document.querySelectorAll(".ck-result-group")].map(n=>n.textContent)'), ['Pastas']);
    });
    await check('Enter não executa a seleção antiga durante os 180 ms da busca', async () => {
      await evaluate(`(() => {const i=document.querySelector('.ck-search');i.value='sem-resultado';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
      assert.equal(await evaluate('!!document.querySelector(".ck-palette")'), true);
      assert.equal(await evaluate('document.querySelectorAll(".ck-result").length'), 0);
      await wait(300);
      assert.match(await evaluate('document.querySelector(".ck-search-status").textContent'), /Nenhum resultado/);
    });
    await check('Texto com marcação é tratado como busca, sem inserir HTML', async () => {
      await type('<img src=x onerror=alert(1)>');
      assert.equal(await evaluate('document.querySelectorAll(".ck-palette img").length'), 0);
      assert.equal(await evaluate('document.querySelectorAll(".ck-result").length'), 0);
    });
    await check('Paleta cabe em 390 px; filtros e campo permanecem acessíveis', async () => {
      await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      // Chromium reaplica meta viewport ao navegar após trocar modo desktop/mobile.
      await client.send('Page.reload', { ignoreCache: true }); await wait(700); await client.ready();
      await evaluate('CockpitUI.palette()');
      await type(''); await wait(200);
      const geometry = await evaluate(`(() => {const items=[...document.querySelectorAll('.ck-search,.ck-search-filter')];return {overflow:document.documentElement.scrollWidth>innerWidth+1,items:items.map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};})};})()`);
      assert.equal(geometry.overflow, false);
      assert.ok(geometry.items.every(r=>r.width>0&&r.left>=0&&r.right<=391), JSON.stringify(geometry));
      await client.screenshot('auditoria-busca-390.png');
    });
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    for (const theme of ['azul','escuro','claro','jornal']) await check('Busca no tema ' + theme + ' sem transbordamento', async () => {
      await evaluate(`aplicarTema(${JSON.stringify(theme)})`); await wait(150);
      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth+1'), false);
      await client.screenshot('auditoria-busca-' + theme + '.png');
    });
    await close();
    await check('Aviso de falha ao salvar é visível e repetição não duplica', async () => {
      await evaluate(`__qa.emit('onConfigSaveError',{});__qa.emit('onConfigSaveError',{});`); await wait(150);
      assert.equal(await evaluate('document.querySelectorAll("[data-notification-id=config-save-error],#avisos [data-aviso-id=config-save-error]").length'), 1);
    });
    await check('Nenhuma exceção de execução nem chamada de motor causada pela auditoria', async () => {
      assert.deepEqual(await evaluate('__qa.errors'), []);
      assert.equal(await evaluate('__qa.calls.filter(c=>/^(paneStart|paneSend|paneStop|approve)$/.test(c.method)).length'), beforeCalls);
    });
    const latest = await verifyServer();
    assert.equal(latest.sourceHash, client.sourceIdentity.sourceHash, 'Fonte mudou durante a auditoria');
    const report = { status: checks.every(c=>c.passed) ? 'passed' : 'failed', createdAt:new Date().toISOString(), sourceIdentity:latest, checks, simulated:true, enginesStarted:false };
    fs.writeFileSync(path.join(out,'interface.json'), JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
    if(report.status!=='passed')process.exitCode=1;
  } finally { client.close(); }
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
