'use strict';
// Executa somente a prévia simulada. O main.js de produção nunca é carregado.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { verifyServer } = require('./qa-environment.cjs');
const artifacts = path.resolve(__dirname, '../../artifacts');
fs.mkdirSync(artifacts, { recursive: true });
app.setPath('userData', path.join(artifacts, 'electron-qa-profile'));
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
const errors = [];
app.whenReady().then(async () => {
  const sourceIdentity = await verifyServer();
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url.startsWith('http://127.0.0.1:4319/') || details.url.startsWith('data:') || details.url === 'about:blank';
    if (!allowed) errors.push('Pedido externo bloqueado: ' + new URL(details.url).origin);
    callback({ cancel: !allowed });
  });
  const window = new BrowserWindow({
    width: 1440, height: 960, show: false, title: 'Cockpit — prévia simulada',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('render-process-gone', (_event, details) => errors.push('Renderer encerrou: ' + details.reason));
  await window.loadURL('http://127.0.0.1:4319/?cenario=supervisao&electron=1');
  // O perfil de QA pode guardar o zoom da rodada anterior para esta origem.
  window.webContents.setZoomFactor(1);
  window.webContents.invalidate();
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    ready = await window.webContents.executeJavaScript('!!window.__qa?.ready && document.querySelectorAll(".ck-control-list .ck-session").length===3');
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('A prévia Electron não iniciou.');
  await window.webContents.executeJavaScript('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
  await new Promise(resolve => setTimeout(resolve, 250));
  const state = await window.webContents.executeJavaScript('window.__qa.snapshot()');
  errors.push(...state.errors);
  if (state.missing.length) errors.push('APIs não simuladas: ' + state.missing.join(', '));
  if (state.panels.length !== 3) errors.push('Esperados três painéis.');
  const normal = await window.webContents.executeJavaScript(`(() => {
 const area=document.querySelector('#panes'),rects=[...document.querySelectorAll('.pane')].filter(n=>n.getClientRects().length).map(n=>{const r=n.getBoundingClientRect();const c=n.closest('.coluna').getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,insideColumn:r.left>=c.left-1&&r.right<=c.right+1};});
 const overlaps=rects.some((a,i)=>rects.slice(i+1).some(b=>a.right>b.left+1&&b.right>a.left+1&&a.bottom>b.top+1&&b.bottom>a.top+1));
 return{factor:devicePixelRatio,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,visiblePanes:rects.length,overlaps,contained:rects.every(r=>r.insideColumn),scrollable:area.scrollWidth>area.clientWidth,scrollWidth:area.scrollWidth,clientWidth:area.clientWidth,overflowX:getComputedStyle(area).overflowX};
})()`);
  if (window.webContents.getZoomFactor() !== 1 || normal.width < 1200 || normal.overflow || normal.visiblePanes !== 3) errors.push('Visão normal deve exibir três painéis a 100% sem transbordar.');
  const screenshot = await window.webContents.capturePage();
  fs.writeFileSync(path.join(artifacts, 'electron-supervisao.png'), screenshot.toPNG());
  window.webContents.setZoomFactor(2);
  window.webContents.invalidate();
  await window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await new Promise(resolve => setTimeout(resolve, 300));
  const zoom = await window.webContents.executeJavaScript(`(() => {
 const area=document.querySelector('#panes'),rects=[...document.querySelectorAll('.pane')].filter(n=>n.getClientRects().length).map(n=>{const r=n.getBoundingClientRect();const c=n.closest('.coluna').getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,insideColumn:r.left>=c.left-1&&r.right<=c.right+1};});
 const overlaps=rects.some((a,i)=>rects.slice(i+1).some(b=>a.right>b.left+1&&b.right>a.left+1&&a.bottom>b.top+1&&b.bottom>a.top+1));
 return{factor:devicePixelRatio,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,visiblePanes:rects.length,overlaps,contained:rects.every(r=>r.insideColumn),scrollable:area.scrollWidth>area.clientWidth,scrollWidth:area.scrollWidth,clientWidth:area.clientWidth,overflowX:getComputedStyle(area).overflowX};
})()`);
  if (zoom.overflow) errors.push('Página transborda no zoom 200%.');
  if (zoom.visiblePanes !== 3 || zoom.overlaps || !zoom.contained || !zoom.scrollable || !['auto','scroll'].includes(zoom.overflowX)) errors.push('Zoom 200% precisa manter três painéis sem sobreposição e com rolagem lateral.');
  const reachable = [];
  for (const id of await window.webContents.executeJavaScript('__qa.panels')) {
    await window.webContents.executeJavaScript('irAoPainel(__qa.panel(' + JSON.stringify(id) + '))');
    await new Promise(resolve => setTimeout(resolve, 450));
    const visible = await window.webContents.executeJavaScript(`(() => {const p=__qa.panel(${JSON.stringify(id)}),r=p.el.querySelector('.p-send').getBoundingClientRect();return {id:p.id,left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,scroll:document.querySelector('#panes').scrollLeft,visible:r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight};})()`);
    reachable.push(visible);
  }
  if (reachable.some(p => !p.visible)) errors.push('Uma sessão não ficou acessível pela rolagem lateral no zoom 200%.');
  fs.writeFileSync(path.join(artifacts, 'electron-zoom-200.png'), (await window.webContents.capturePage()).toPNG());
  window.webContents.setZoomFactor(1);
  await new Promise(resolve => setTimeout(resolve, 250));
  const functional = await require('./functional-ui-checks.cjs')(window.webContents);
  for (const result of functional) if (!result.passed) errors.push(result.name + ': ' + result.error);
  const latestIdentity = await verifyServer();
  if (latestIdentity.sourceHash !== sourceIdentity.sourceHash || await window.webContents.executeJavaScript('__qaIdentity.sourceHash') !== sourceIdentity.sourceHash) errors.push('Fonte mudou durante a verificação Electron.');
  const report = { status:errors.length?'failed':'passed',createdAt:new Date().toISOString(),sourceIdentity, runtime: process.versions, state, normal, zoom, reachable, functional, errors, authenticatedEnginesStarted: false, productionMainLoaded: false };
  fs.writeFileSync(path.join(artifacts, 'electron-qa.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  app.exit(errors.length ? 1 : 0);
}).catch(error => { console.error(error.stack); app.exit(1); });
