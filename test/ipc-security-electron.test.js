'use strict';

// Executar com COCKPIT_ELECTRON_EXE apontando ao runtime a validar.
// O processo filho usa apenas uma pasta temporária, mídia falsa e páginas de
// teste. Nunca carrega main.js nem o perfil/logins da instalação do Cockpit.
if (process.versions.electron && process.env.COCKPIT_IPC_INTEGRATION_CHILD === '1') {
  const { app, BrowserWindow, ipcMain, session } = require('electron');
  const fs = require('node:fs');
  const path = require('node:path');
  const assert = require('node:assert/strict');
  const { createIpcSecurity } = require('../src/cockpit-ipc-security');
  const root = process.env.COCKPIT_IPC_INTEGRATION_DIR;
  app.setPath('userData', path.join(root, 'profile'));
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  let main, capture;
  const mainFile = path.join(root, 'main.html'), captureFile = path.join(root, 'capture.html');
  const security = createIpcSecurity({ ipcMain, getMainWindow: () => main, getCaptureWindow: () => capture, mainFile, captureFile });
  const report = { electron: process.versions.electron, tests: [], permissions: [] };
  let privilegedCalls = 0;
  security.ipcMain.handle('audit:privileged', (_event, value) => { privilegedCalls++; return { value }; });
  security.ipcMain.on('audit:sync', event => { event.returnValue = 'trusted'; });
  for (const channel of ['recorte:dados', 'recorte:pronto', 'recorte:cancelar']) security.ipcMain.handle(channel, () => ({ ok: true }));
  const verify = (name, fn) => { fn(); report.tests.push(name); };
  const options = {
    show: false,
    webPreferences: { preload: path.join(root, 'preload.cjs'), contextIsolation: true, sandbox: true,
      nodeIntegration: false, nodeIntegrationInSubFrames: true, partition: 'ipc-security-audit' },
  };
  app.whenReady().then(async () => {
    const ses = session.fromPartition('ipc-security-audit');
    // Registrar o formato real dos callbacks sem guardar URL/pasta pessoal.
    for (const name of ['setPermissionCheckHandler', 'setPermissionRequestHandler']) {
      const original = ses[name].bind(ses);
      ses[name] = handler => original((...args) => {
        const details = args[3] || {};
        report.permissions.push({ kind: name, permission: args[1], hasContents: !!args[0],
          isMainFrame: details.isMainFrame, hasRequestingUrl: !!details.requestingUrl,
          mediaType: details.mediaType, mediaTypes: details.mediaTypes });
        return handler(...args);
      });
    }
    security.installSession(ses);
    main = new BrowserWindow(options);
    await main.loadFile(mainFile);
    verify('principal invoke', () => {});
    assert.deepEqual(await main.webContents.executeJavaScript("audit.invoke('audit:privileged', 'ok')"), { value: 'ok' });
    assert.equal(await main.webContents.executeJavaScript("audit.sync('audit:sync')"), 'trusted');
    report.tests.push('principal sendSync');
    const extra = new BrowserWindow(options);
    await extra.loadFile(mainFile);
    const denied = "audit.invoke('audit:privileged', 'bad').then(() => false, () => true)";
    assert.equal(await extra.webContents.executeJavaScript(denied), true);
    assert.equal(await extra.webContents.executeJavaScript("audit.sync('audit:sync')"), null);
    report.tests.push('outra janela e sendSync recusados');
    const frame = main.webContents.mainFrame.frames.find(f => f.url.endsWith('/frame.html'));
    assert.ok(frame, 'iframe de teste carregado');
    assert.equal(await frame.executeJavaScript(denied), true);
    report.tests.push('subframe recusado');
    capture = new BrowserWindow(options);
    security.protectCaptureWindow(capture);
    await capture.loadFile(captureFile);
    assert.deepEqual(await capture.webContents.executeJavaScript("audit.invoke('recorte:dados')"), { ok: true });
    assert.equal(await capture.webContents.executeJavaScript(denied), true);
    assert.equal(await main.webContents.executeJavaScript("audit.invoke('recorte:dados').then(() => false, () => true)"), true);
    report.tests.push('recorte limitado e principal sem foto');
    const audio = await main.webContents.executeJavaScript("navigator.mediaDevices.getUserMedia({audio:true}).then(s=>{s.getTracks().forEach(t=>t.stop());return true},e=>e.name)");
    assert.equal(audio, true, 'microfone simulado deve permanecer disponível');
    const video = await main.webContents.executeJavaScript("navigator.mediaDevices.getUserMedia({video:true}).then(s=>{s.getTracks().forEach(t=>t.stop());return true},e=>e.name)");
    assert.equal(video, true, 'câmera simulada deve permanecer disponível');
    report.tests.push('microfone e câmera simulados');
    const deniedMedia = await extra.webContents.executeJavaScript("navigator.mediaDevices.getUserMedia({audio:true}).then(s=>{s.getTracks().forEach(t=>t.stop());return false},()=>true)");
    assert.equal(deniedMedia, true);
    report.tests.push('mídia da janela estranha recusada');
    report.notification = await main.webContents.executeJavaScript("({permission:Notification.permission})");
    assert.equal(report.notification.permission, 'granted', 'notificações continuam permitidas para o app local');
    report.tests.push('notificações autorizadas sem mostrar alerta');
    await main.loadFile(captureFile);
    assert.equal(await main.webContents.executeJavaScript(denied), true);
    await main.loadFile(mainFile);
    assert.deepEqual(await main.webContents.executeJavaScript("audit.invoke('audit:privileged', 'reload')"), { value: 'reload' });
    report.tests.push('navegação revoga e reload legítimo restaura acesso');
    assert.equal(privilegedCalls, 2);
    report.tests.push('somente duas chamadas legítimas executaram o handler');
    report.ok = true;
    fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(report, null, 2));
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    app.quit();
  }).catch(error => {
    report.ok = false; report.error = String(error.stack || error);
    fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(report, null, 2));
    app.exit(1);
  });
} else {
  const test = require('node:test');
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawn } = require('node:child_process');
  const executable = process.env.COCKPIT_ELECTRON_EXE;
  test('Electron real: IPC, subframes, recorte e permissões com mídia simulada', { skip: !executable, timeout: 45000 }, async t => {
    assert.ok(fs.existsSync(executable), 'runtime informado existe');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-ipc-electron-'));
    t.after(() => {
      assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
      fs.rmSync(root, { recursive: true, force: true });
    });
    fs.mkdirSync(path.join(root, 'profile'));
    fs.writeFileSync(path.join(root, 'preload.cjs'), "const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('audit',{invoke:(...args)=>ipcRenderer.invoke(...args),sync:(...args)=>ipcRenderer.sendSync(...args)});");
    fs.writeFileSync(path.join(root, 'main.html'), '<!doctype html><title>Teste IPC</title><iframe src="frame.html"></iframe>');
    fs.writeFileSync(path.join(root, 'capture.html'), '<!doctype html><title>Teste recorte</title>');
    fs.writeFileSync(path.join(root, 'frame.html'), '<!doctype html><title>Subframe de teste</title>');
    const output = await new Promise((resolve, reject) => {
      const env = { ...process.env, COCKPIT_IPC_INTEGRATION_CHILD: '1', COCKPIT_IPC_INTEGRATION_DIR: root };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(executable, [__filename], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let text = '';
      child.stdout.on('data', data => { text += data; }); child.stderr.on('data', data => { text += data; });
      const timer = setTimeout(() => { child.kill(); reject(new Error('Teste Electron excedeu 35 segundos.')); }, 35000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); resolve({ code, text }); });
    });
    const file = path.join(root, 'result.json');
    const report = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { ok: false, error: output.text };
    if (process.env.COCKPIT_IPC_REPORT) fs.writeFileSync(process.env.COCKPIT_IPC_REPORT, JSON.stringify(report, null, 2));
    assert.equal(report.ok, true, report.error || output.text);
    assert.equal(output.code, 0, output.text);
    t.diagnostic(JSON.stringify(report));
  });
}
