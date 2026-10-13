'use strict';
// Janela oculta, sem motores, conta ou rede. Exercita o DOM real do componente.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { normalizeSchema } = require('../../src/cockpit-interactions');
for (const stream of [process.stdout, process.stderr]) stream.on('error', e => { if (e.code !== 'EPIPE') throw e; });
const run = path.resolve(__dirname, '../../artifacts/connector-prompts-qa-' + Date.now());
fs.mkdirSync(run, { recursive: true }); app.setPath('userData', path.join(run, 'profile'));
for (const flag of ['disable-background-networking', 'disable-component-update', 'mute-audio']) app.commandLine.appendSwitch(flag);
const checks = [], errors = [];
let win;
const ev = source => win.webContents.executeJavaScript(source);
const delay = ms => new Promise(r => setTimeout(r, ms));
async function check(name, fn) { try { await fn(); checks.push({ name, passed: true }); } catch (e) { checks.push({ name, passed: false, error: e.stack }); } }
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((r, cb) => cb({ cancel: !r.url.startsWith('data:') && r.url !== 'about:blank' }));
  win = new BrowserWindow({ width: 1000, height: 900, show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
  const css = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/connector-prompts.css'), 'utf8');
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta charset="utf-8"><style>body{font:14px system-ui;background:#f6f3eb;margin:20px}main{max-width:720px;margin:auto}textarea{max-width:100%}' + css + '</style><main><textarea id="chat" aria-label="Mensagem"></textarea><div id="cards"></div></main>'));
  await ev(fs.readFileSync(path.resolve(__dirname, '../../src/renderer/connector-prompts.js'), 'utf8') + ';void 0;');
  const schema = normalizeSchema({ type: 'object', properties: { email: { type: 'string', format: 'email', title: 'E-mail' }, senha: { type: 'string', title: 'Senha', default: 'NUNCA' } }, required: ['email'] });
  const prompt = { token: 'test-token', paneId: 'pane-a', threadId: 'child-7', serverName: '<img src=x onerror=alert(1)>', message: 'Confirme os dados', mode: 'openai/form', origin: { kind: 'remote', host: 'vps.test' }, schema, expiresAt: Date.now() + 60000 };
  await ev(`window.calls=[];window.links=[];document.getElementById('chat').focus();window.mount=CockpitConnectorPrompts.mount({container:document.getElementById('cards'),prompt:${JSON.stringify(prompt)},respond:async p=>{calls.push(p);return {ok:true}},openUrl:async p=>{links.push(p);return {ok:true}}});void 0;`);
  await check('Pedido não rouba foco, usa texto seguro e mantém origem/subagente', async () => {
    assert.equal(await ev('document.activeElement.id'), 'chat'); assert.equal(await ev('document.querySelectorAll("img").length'), 0);
    assert.equal(await ev('document.querySelector(".connector-origin").textContent'), 'VPS · vps.test · child-7');
  });
  await check('Segredo protegido, sem preencher default; botões ícones com nome acessível', async () => {
    assert.deepEqual(await ev('({type:document.querySelector("[name=senha]").type,value:document.querySelector("[name=senha]").value})'), { type: 'password', value: '' });
    assert.equal(await ev('[...document.querySelectorAll(".connector-icon")].every(b=>b.getAttribute("aria-label")&&b.title&&b.textContent.trim()==="")'), true);
  });
  await check('Formulário cabe em 390px sem rolagem horizontal', async () => {
    win.setSize(390, 900); await delay(100);
    assert.equal(await ev('document.documentElement.scrollWidth<=window.innerWidth'), true);
    fs.writeFileSync(path.join(run, 'mobile.png'), (await win.webContents.capturePage()).toPNG());
  });
  await check('Aceitar envia para painel certo e limpa valores sensíveis da tela', async () => {
    await ev(`document.querySelector('[name=email]').value='hugo@example.test';document.querySelector('[name=senha]').value='privado';document.querySelector('[aria-label="Enviar resposta ao conector"]').click()`); await delay(80);
    assert.equal(await ev('calls.length'), 1); assert.equal(await ev('calls[0].paneId'), 'pane-a'); assert.equal(await ev('calls[0].content.senha'), 'privado');
    assert.equal(await ev('document.querySelector("[name=senha]").value'), ''); assert.equal(await ev('document.querySelector(".connector-status").textContent'), 'Resposta enviada ao conector.');
  });
  await check('URL só abre no clique e não aceita automaticamente', async () => {
    await ev(`mount.dispose();window.mount=CockpitConnectorPrompts.mount({container:document.getElementById('cards'),prompt:${JSON.stringify({ ...prompt, mode: 'url', urlOrigin: 'https://login.example.test' })},respond:async p=>{calls.push(p);return {ok:true}},openUrl:async p=>{links.push(p);return {ok:true}}});void 0;`);
    assert.equal(await ev('links.length'), 0);
    await ev(`document.querySelector('[aria-label="Abrir site do conector"]').click()`); await delay(50);
    assert.equal(await ev('links.length'), 1); assert.equal(await ev('calls.length'), 1);
    await ev(`document.querySelector('[aria-label="Recusar pedido"]').click()`); await delay(50);
    assert.equal(await ev('calls[1].action'), 'decline');
  });
  await check('Rascunho espera clique e não chama envio; inserir uma vez', async () => {
    await ev('mount.dispose();window.drafts=0;CockpitConnectorPrompts.mountHostAction({container:document.getElementById("cards"),action:{text:"texto",origin:{kind:"local"}},type:"host-draft",onDraft:async()=>{drafts++;return{ok:true}}});void 0;');
    assert.equal(await ev('drafts'), 0);
    await ev(`document.querySelector('[aria-label="Inserir rascunho sem enviar"]').click()`); await delay(50);
    assert.equal(await ev('drafts'), 1); assert.equal(await ev(`document.querySelector('[aria-label="Inserir rascunho sem enviar"]').disabled`), true);
  });
  await check('Janela e console permanecem sem erro/visibilidade', async () => { assert.equal(win.isVisible(), false); assert.deepEqual(errors, []); });
  fs.writeFileSync(path.join(run, 'result.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ run, checks, errors }, null, 2)); app.exit(checks.every(c => c.passed) ? 0 : 1);
}).catch(e => { console.error(e); app.exit(1); });
