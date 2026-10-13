'use strict';
// Renderer real, imagens geradas em memória, janela offscreen e pontes simuladas.
const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { verifyServer, ORIGIN } = require('./qa-environment.cjs');
for (const stream of [process.stdout, process.stderr]) stream.on('error', error => { if (error.code !== 'EPIPE') app.exit(1); });
const artifacts = path.resolve(__dirname, '../../artifacts');
const run = path.join(artifacts, 'imagens-viewer-qa-' + new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(run, { recursive: true }); app.setPath('userData', path.join(run, 'profile'));
for (const flag of ['disable-background-networking', 'disable-component-update', 'mute-audio']) app.commandLine.appendSwitch(flag);
let win, identity; const checks = [], errors = [], blocked = [];
process.on('uncaughtException', error => { if (error.code === 'EPIPE') return; errors.push(String(error.stack || error)); finish(); });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms)), ev = code => win.webContents.executeJavaScript(code);
async function until(code) { for (let n = 0; n < 100; n++) { if (await ev(code)) return; await delay(50); } throw Error('Timeout: ' + code); }
const dimensions = { paisagem: [3200, 1100], vertical: [1000, 2800], pequena: [240, 160] };
const imageData = Object.fromEntries(Object.entries(dimensions).map(([name, [w, h]]) => [name, 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#dbeafe"/><rect x="8" y="8" width="${w - 16}" height="${h - 16}" fill="none" stroke="#b45309" stroke-width="16"/><path d="M0 0 ${w} ${h}M0 ${h} ${w} 0" stroke="#64748b" stroke-width="8"/><text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-size="${Math.min(w, h) / 16}" fill="#0f172a">${name} · ${w} × ${h}</text></svg>`).toString('base64')]));
async function reset() {
  await ev("if(!document.querySelector('#modalGrupo').classList.contains('hidden'))fecharModalGlobal();fecharVisor();while(CockpitUI.layers.length)CockpitUI.closeLayer();document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));ip.busy=false;rp.busy=false;window.imageRequests=[];window.originButton.focus();void 0;");
  await delay(180); win.setContentSize(1440, 900);
}
async function check(name, fn) {
  try {
    await reset(); await fn();
    const state = await ev("({errors:__qa.errors,missing:[...__qa.missing],executed:__qa.calls.filter(c=>/^(paneStart|paneSend|paneInterrupt|paneStop|termRun|debateStart)$/.test(c.method))})");
    assert.deepEqual(state, { errors: [], missing: [], executed: [] }); checks.push({ name, passed: true });
  } catch (error) { checks.push({ name, passed: false, error: error.stack }); }
  console.log(JSON.stringify(checks.at(-1)));
}
async function settle() { await ev('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))'); await ev("document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).forEach(a=>{try{a.finish();}catch{}})"); await delay(120); }
async function capture(name) { await settle(); win.webContents.invalidate(); fs.writeFileSync(path.join(run, name + '.png'), (await win.webContents.capturePage()).toPNG()); }
async function open(name = 'paisagem') { await ev(`verImagemGrande(imageData[${JSON.stringify(name)}]);void 0;`); await until("document.querySelector('#modalGrupo .img-grande')?.complete && document.querySelector('#modalGrupo .img-grande')?.naturalWidth>0"); await settle(); }
async function action(name) { await ev(`document.querySelector('#modalGrupo [data-image-action=${JSON.stringify(name)}]').click();void 0;`); await settle(); }
async function escape() { await ev("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));void 0;"); await delay(180); }
async function fit() {
  const geometry = await ev("(()=>{const img=document.querySelector('#modalGrupo .img-grande'),stage=document.querySelector('#modalGrupo .imagem-stage'),cx=document.querySelector('#modalGrupo .modal-img'),r=e=>{const a=e.getBoundingClientRect();return{x:a.x,y:a.y,right:a.right,bottom:a.bottom,width:a.width,height:a.height}};return{img:r(img),stage:r(stage),cx:r(cx),natural:[img.naturalWidth,img.naturalHeight],viewport:[innerWidth,innerHeight],fit:getComputedStyle(img).objectFit};})()");
  const { img, stage, cx, viewport } = geometry;
  assert.ok(img.width > 0 && img.height > 0, JSON.stringify(geometry));
  assert.ok(img.x >= stage.x - 1 && img.y >= stage.y - 1 && img.right <= stage.right + 1 && img.bottom <= stage.bottom + 1, JSON.stringify(geometry));
  assert.ok(cx.x >= 0 && cx.y >= 0 && cx.right <= viewport[0] + 1 && cx.bottom <= viewport[1] + 1, JSON.stringify(geometry));
  assert.ok(geometry.fit === 'contain' || Math.abs(img.width / img.height - geometry.natural[0] / geometry.natural[1]) < .02, JSON.stringify(geometry));
  return geometry;
}
app.whenReady().then(async () => {
  identity = await verifyServer();
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => { const allowed = details.url.startsWith(ORIGIN + '/') || details.url.startsWith('data:') || details.url.startsWith('blob:' + ORIGIN) || details.url === 'about:blank'; if (!allowed) blocked.push(details.url); callback({ cancel: !allowed }); });
  win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('render-process-gone', (_, data) => errors.push(data.reason));
  await win.loadURL(ORIGIN + '/?cenario=vazio&visual=1&tema=jornal'); await until('!!window.__qa?.ready');
  await ev(`window.imageData=${JSON.stringify(imageData)};window.ip=newPane({engine:'claude',abaId:'qa-produto',cwd:'C:/QA'});window.rp=newPane({engine:'codex',abaId:'qa-servidor',cwd:'/srv/projeto'});ip.started=false;rp.started=false;window.originButton=document.createElement('button');originButton.textContent='Origem QA';originButton.id='imagem-origem-qa';document.body.append(originButton);window.imageRequests=[];__qa.override('verArquivo',async(file,remote)=>{imageRequests.push({file,remote:remote||null});return{tipo:'imagem',nome:'captura.svg',dados:imageData.paisagem,bytes:1200};});cfg.notificationPeek=true;cfg.notificationSound=false;VisualMac.applyPreferences(cfg);void 0;`);
  await settle();
  for (const name of Object.keys(dimensions)) await check('Imagem ' + name + ' aparece inteira, proporcional e dentro da tela', async () => {
    await open(name); const geometry = await fit(); assert.deepEqual(geometry.natural, dimensions[name]);
    if (name === 'paisagem') assert.ok(geometry.cx.width > 900, JSON.stringify(geometry));
    if (name === 'pequena') assert.ok(geometry.img.width <= 240 && geometry.img.height <= 160, JSON.stringify(geometry));
    await capture('imagem-' + name);
  });
  await check('Expandir e recolher usam ícones acessíveis e mantêm a mesma imagem', async () => {
    await open(); const original = await ev("document.querySelector('#modalGrupo .img-grande').src");
    const buttons = await ev("[...document.querySelectorAll('#modalGrupo button')].map(b=>({action:b.dataset.imageAction,icon:!!b.querySelector('svg'),label:b.getAttribute('aria-label'),title:b.title,text:b.textContent.trim()}))");
    assert.equal(buttons.length, 3); assert.ok(buttons.every(b => b.icon && b.label && b.title && !b.text), JSON.stringify(buttons));
    await action('expand'); assert.equal(await ev("document.querySelector('.modal-img').classList.contains('imagem-expandida')"), true);
    const full = await fit(); assert.ok(full.cx.width >= full.viewport[0] - 32, JSON.stringify(full));
    assert.equal(await ev("document.querySelector('#modalGrupo .img-grande').src"), original); await capture('imagem-expandida');
    await action('expand'); assert.equal(await ev("document.querySelector('.modal-img').classList.contains('imagem-expandida')"), false); await fit();
  });
  await check('Tab fica nos controles da imagem e Escape devolve foco sem interromper sessão', async () => {
    await ev('ip.busy=true;originButton.focus();void 0;'); await open();
    assert.equal(await ev("!!document.activeElement.closest('#modalGrupo')"), true);
    await ev("window.imageButtons=[...document.querySelectorAll('#modalGrupo button')];imageButtons.at(-1).focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));void 0;");
    assert.equal(await ev('document.activeElement===imageButtons[0]'), true);
    await ev("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));void 0;");
    assert.equal(await ev('document.activeElement===imageButtons.at(-1)'), true);
    await escape(); assert.equal(await ev("document.querySelector('#modalGrupo').classList.contains('hidden')"), true); assert.equal(await ev('document.activeElement===originButton'), true);
  });
  await check('Ilha que abre durante a imagem não consome o Escape do visualizador', async () => {
    await open(); await ev("VisualMac.notify({id:'qa-imagem-aviso',occurrence:'unico',message:'Aviso de teste',attention:false});void 0;");
    await until("document.querySelector('.mac-ilha').dataset.presentation==='auto'"); await escape();
    assert.equal(await ev("document.querySelector('#modalGrupo').classList.contains('hidden')"), true); assert.equal(await ev("document.querySelector('.mac-ilha').classList.contains('aberta')"), true);
  });
  await check('Reabrir durante o fade não fecha a imagem nova nem restaura foco atrasado', async () => {
    await open(); await ev("fecharModalGlobal();verImagemGrande(imageData.vertical);void 0;"); await delay(240); await fit();
    assert.equal(await ev("document.querySelector('#modalGrupo').classList.contains('hidden')"), false); assert.equal(await ev("document.querySelector('#modalGrupo .img-grande').src===imageData.vertical"), true); assert.equal(await ev("!!document.activeElement.closest('#modalGrupo')"), true);
  });
  await check('Abrir formulário depois da imagem limpa estado, largura e teclado anteriores', async () => {
    await open(); await action('expand'); await ev("pedirTexto({titulo:'Nome de teste',valor:'Exemplo',aoConfirmar:()=>{}});void 0;"); await settle();
    assert.equal(await ev("!!document.querySelector('#modalGrupo .modal-img')"), false); assert.equal(await ev("!!document.querySelector('#pxCampo')"), true);
    assert.ok(await ev("document.querySelector('#modalGrupo .modal-cx').getBoundingClientRect().width<600"));
    assert.equal(await ev("document.activeElement===document.querySelector('#pxCampo')"), true); await escape();
  });
  await check('Clique no fundo fecha; clique nos controles não fecha por propagação', async () => {
    await open(); await action('expand'); assert.equal(await ev("document.querySelector('#modalGrupo').classList.contains('hidden')"), false);
    await ev("document.querySelector('#modalGrupo').click();void 0;"); await delay(180); assert.equal(await ev("document.querySelector('#modalGrupo').classList.contains('hidden')"), true);
  });
  await check('Miniaturas do histórico, do passo e da galeria continuam abrindo a imagem', async () => {
    await ev("window.testGallery=imagensDoHistorico(ip,[{mime:'image/svg+xml',dados:imageData.pequena.split(',')[1]}]);ip.chat.append(testGallery);testGallery.querySelector('img').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));void 0;"); await until("document.querySelector('#modalGrupo .img-grande')?.naturalWidth===240"); await escape();assert.equal(await ev("document.activeElement===testGallery.querySelector('img')"),true);
    await ev("window.testStep=document.createElement('div');ip.chat.append(testStep);mostrarPrintsDoPasso(ip,testStep,[{mime:'image/svg+xml',dados:imageData.vertical.split(',')[1]}]);testStep.querySelector('img').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}));void 0;"); await until("document.querySelector('#modalGrupo .img-grande')?.naturalHeight===2800"); await escape();assert.equal(await ev("document.activeElement===testStep.querySelector('img')"),true);
    await ev("mostrarPrintsDoTurno(ip,[imageData.paisagem]);ip.el.querySelector('.mo-print').click();void 0;"); await until("document.querySelector('#modalGrupo .img-grande')?.naturalWidth===3200"); await escape();
    assert.equal(await ev("ip.el.querySelector('.p-modal').classList.contains('hidden')"), false);assert.equal(await ev("document.activeElement===ip.el.querySelector('.mo-print')"),true); await ev('fecharModal(ip);testGallery.remove();testStep.remove();void 0;');
  });
  await check('Anexo no PC e na VPS usa arquivo local; documento remoto conserva origem e visor amplo', async () => {
    for (const panel of ['ip', 'rp']) {
      await ev(`${panel}.anexos=[{path:'C:/QA/anexo.svg',nome:'anexo.svg',ext:'svg',mini:imageData.pequena,bytes:1200}];pintarAnexos(${panel});${panel}.el.querySelector('.p-anexos .anx').click();void 0;`);
      await until("!!document.querySelector('.p-visor:not(.hidden) .visor-corpo img')"); assert.equal(await ev('imageRequests.at(-1).remote'), null); assert.equal(await ev('imageRequests.at(-1).file'), 'C:/QA/anexo.svg');
      assert.equal(await ev("document.querySelector('.p-visor:not(.hidden)').classList.contains('visor-amplo')"), true); await ev('fecharVisor();void 0;');
    }
    await ev("window.imageRemote=remotoDoPane(rp);verArquivo(rp,'/srv/projeto/captura.svg',imageRemote);void 0;"); await until("!!document.querySelector('.p-visor:not(.hidden) .visor-corpo img')");
    assert.equal(await ev('imageRequests.at(-1).remote.host===imageRemote.host'), true); assert.ok(await ev("document.querySelector('.p-visor:not(.hidden) .visor-origem').textContent.startsWith('VPS')"));
    await open('pequena'); await escape(); assert.equal(await ev("!!document.querySelector('.p-visor:not(.hidden)')"), true); await escape(); assert.equal(await ev("!!document.querySelector('.p-visor:not(.hidden)')"), false);
  });
  for (const [width, height] of [[390, 844], [900, 450]]) await check(`Imagem inteira e controles acessíveis em ${width}×${height}`, async () => {
    win.setContentSize(width, height); await open('vertical'); await fit(); await action('expand'); await fit();
    const controls = await ev("[...document.querySelectorAll('#modalGrupo button')].map(b=>{const r=b.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:innerWidth,h:innerHeight};})");
    assert.ok(controls.every(r=>r.left>=0&&r.top>=0&&r.right<=r.w&&r.bottom<=r.h),JSON.stringify(controls)); await capture(`imagem-${width}x${height}`); await action('expand'); await fit();
  });
  if (blocked.length) errors.push('Rede externa bloqueada: ' + blocked.join(', '));
  const after = await verifyServer(); if (after.sourceHash !== identity.sourceHash) errors.push('Fonte mudou durante o QA');
  finish();
}).catch(error => { errors.push(error.stack); finish(); });
function finish() {
  const report = { status: errors.length || checks.some(c => !c.passed) ? 'failed' : 'passed', at: new Date().toISOString(), sourceIdentity: identity, checks, errors, blocked, run, authenticatedEnginesStarted: false, productionMainLoaded: false, realAudioEnabled: false };
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2)); fs.writeFileSync(path.join(artifacts, 'imagens-viewer-qa.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ status: report.status, checks: checks.length, errors, run })); app.exit(report.status === 'passed' ? 0 : 1);
}
