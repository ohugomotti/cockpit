'use strict';
// Renderer real com ponte simulada; nenhum instalador ou motor é executado.
const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { verifyServer, ORIGIN } = require('./qa-environment.cjs');
const directory = path.resolve(__dirname, '../../artifacts/engine-updates-qa');
fs.mkdirSync(directory, { recursive: true });
app.setPath('userData', path.join(directory, 'perfil'));
for (const flag of ['disable-background-networking', 'disable-component-update', 'force-prefers-reduced-motion']) app.commandLine.appendSwitch(flag);
let window, identity;
const checks = [], errors = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = code => window.webContents.executeJavaScript(code);
async function check(name, action) { await action(); checks.push({ name, passed: true }); }
async function settle() { await evaluate('document.fonts.ready'); await wait(300); }
async function capture(name) { fs.writeFileSync(path.join(directory, name + '.png'), (await window.webContents.capturePage()).toPNG()); }
async function finish(error) {
  if (error) errors.push(error.stack || String(error));
  const status = errors.length ? 'failed' : 'passed';
  fs.writeFileSync(path.join(directory, 'resultado.json'), JSON.stringify({ status, identity, checks, errors, enginesStarted: false }, null, 2));
  console.log(JSON.stringify({ status, checks: checks.length, errors, directory }));
  app.exit(errors.length ? 1 : 0);
}
setTimeout(() => finish(Error('QA excedeu 45 segundos.')), 45000).unref();
app.whenReady().then(async () => {
  identity = await verifyServer();
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url.startsWith(ORIGIN + '/') || /^(data:|about:)/.test(details.url);
    if (!allowed) errors.push('Rede externa bloqueada: ' + new URL(details.url).origin);
    callback({ cancel: !allowed });
  });
  window = new BrowserWindow({ width: 1440, height: 1000, useContentSize: true, show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('render-process-gone', (_event, detail) => errors.push(detail.reason));
  await window.loadURL(ORIGIN + '/?cenario=vazio&visual=1&tema=jornal');
  for (let i = 0; i < 100 && !await evaluate('!!window.__qa?.ready'); i++) await wait(100);
  assert.equal(await evaluate('!!window.__qa?.ready'), true);
  await evaluate(`document.querySelector('button[aria-label="Ajustes"]').click();
    [...document.querySelectorAll('[role="tab"]')].find(e => e.innerText === 'Motores e contas').click();`);
  await settle();
  await check('Ligado por padrão em Motores e contas', async () => {
    const info = await evaluate(`(() => { const input = document.querySelector('input[aria-label="Atualizar Claude e Codex ao abrir"]');
      return { checked: input.checked, visible: input.getBoundingClientRect().height > 0, title: input.closest('[role="tabpanel"]').querySelector('h3').textContent }; })()`);
    assert.deepEqual(info, { checked: true, visible: true, title: 'Motores e contas' });
  });
  await check('Desativar e reativar persiste a preferência', async () => {
    for (const desired of [false, true]) {
      await evaluate(`document.querySelector('input[aria-label="Atualizar Claude e Codex ao abrir"]').click()`);
      await wait(250);
      assert.equal(await evaluate('__qa.configuration.autoUpdateEngines'), desired);
    }
  });
  for (const width of [1440, 390]) {
    window.setContentSize(width, 900); await settle();
    await evaluate(`document.querySelector('input[aria-label="Atualizar Claude e Codex ao abrir"]').closest('label').scrollIntoView({ block: 'nearest' })`);
    await settle();
    await check('Controle cabe na janela de ' + width + ' pixels', async () => {
      const fit = await evaluate(`(() => { const input = document.querySelector('input[aria-label="Atualizar Claude e Codex ao abrir"]');
        const row = input.closest('label'), rect = row.getBoundingClientRect();
        let fits = rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && row.scrollWidth <= row.clientWidth + 1;
        for (let parent = row.parentElement; parent; parent = parent.parentElement) {
          if (getComputedStyle(parent).overflowY !== 'visible') { const clip = parent.getBoundingClientRect(); fits = fits && rect.top >= clip.top - 1 && rect.bottom <= clip.bottom + 1; }
        }
        return { width: innerWidth, fits }; })()`);
      assert.equal(fit.width, width); assert.equal(fit.fits, true);
    });
    await capture('ajustes-' + width);
  }
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
  window.setContentSize(1440, 900); await settle();
  await check('Atualização gera um aviso silencioso e sem duplicatas', async () => {
    await evaluate(`__qa.override('motoresAtualizacoes', async () => ({ enabled: true, running: false,
      engines: { codex: { state: 'updated', before: '0.159.0', installed: '0.159.1' } } }));
      acompanharAtualizacoesMotores();`);
    await wait(100);
    await evaluate('acompanharAtualizacoesMotores()'); await wait(100);
    assert.equal(await evaluate(`document.querySelectorAll('[data-notification-id="auto-update-codex"]').length`), 1);
    assert.match(await evaluate(`document.querySelector('[data-notification-id="auto-update-codex"]').innerText`), /0\.159\.0 → 0\.159\.1/);
    if (!await evaluate(`document.querySelector('.mac-ilha').classList.contains('aberta')`)) await evaluate(`document.querySelector('.mac-ilha-linha').click()`);
    await capture('notificacao');
  });
  await check('Versão atual resolve o aviso e não pede atualização manual', async () => {
    await evaluate(`__qa.override('motoresAtualizacoes', async () => ({ enabled: true, running: false, engines: { codex: { state: 'current', installed: '0.159.1' } } }));
      __qa.override('motoresVersoes', async () => ({ codex: { instalada: '0.159.0', ultima: '0.159.1' } }));
      acompanharAtualizacoesMotores(); checarVersoesDosMotores();`);
    await wait(150);
    assert.equal(await evaluate(`document.querySelectorAll('[data-notification-id="auto-update-codex"]').length`), 0);
    assert.equal(await evaluate(`document.querySelector('.mac-ilha').innerText.includes('atualize no terminal')`), false);
  });
  await check('Sem erros, API ausente ou envio para motores', async () => {
    assert.deepEqual(await evaluate('__qa.errors'), []);
    assert.deepEqual(await evaluate('[...__qa.missing]'), []);
    assert.deepEqual(await evaluate(`__qa.calls.filter(c => /^(claude|codex|cli)(Enviar|Send)|sshExec/.test(c.method)).map(c => c.method)`), []);
  });
  await finish();
}).catch(finish);
