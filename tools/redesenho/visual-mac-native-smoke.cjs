'use strict';
/* Main, preload e renderer REAIS do pacote. Só os efeitos externos dos
   motores ficam bloqueados: nenhuma sessão, conta ou configuração instalada
   entra neste teste. Rode com Electron 32.3.3, nunca com node.exe. */
const electron = require('electron');
const { app, BrowserWindow, Menu, nativeTheme, session } = electron;
const fs = require('node:fs');
const physicalFs = require('original-fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const Module = require('node:module');
const childProcess = require('node:child_process');
const realExecFileSync = childProcess.execFileSync.bind(childProcess);
const realExecFile = childProcess.execFile.bind(childProcess);
const root = path.resolve(__dirname, '../..');
const baseline = process.argv.includes('--baseline');
const reportName = baseline ? 'visual-mac-native-baseline' : 'visual-mac-native-smoke';
const argument = process.argv.find(value => value.startsWith('--manifest='));
const manifestPath = argument ? path.resolve(argument.slice(11)) : path.join(root, 'artifacts/visual-mac-package.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const hash = file => crypto.createHash('sha256').update(physicalFs.readFileSync(file)).digest('hex').toUpperCase();
if (manifest.status !== 'verified' || path.resolve(manifest.workspace) !== root || hash(manifest.package) !== manifest.packageHash) {
  throw Error('Manifesto ou pacote não pertence a esta compilação verificada.');
}
function verifySources() {
  if (!manifest.sourceHashes || !Object.keys(manifest.sourceHashes).length) throw Error('Manifesto sem hashes dos fontes.');
  for (const [relative, expected] of Object.entries(manifest.sourceHashes)) {
    const file = path.resolve(root, 'src', relative);
    if (!file.startsWith(path.join(root, 'src') + path.sep) || hash(file) !== expected) throw Error('Fonte mudou desde o pacote: ' + relative);
  }
}
if (!baseline) verifySources();
const installedAsar = path.join(process.env.LOCALAPPDATA, 'Programs/Cockpit/resources/app.asar');
const installedConfigPath = path.join(process.env.APPDATA, 'Cockpit/config.json');
const installedHash = hash(installedAsar);
if (installedHash !== manifest.baselineHash) throw Error('A instalação mudou desde a criação do pacote.');
const run = path.join(root, 'artifacts', 'native-smoke-' + Date.now());
const isolatedHome = path.join(run, 'home');
const data = path.join(run, 'dados');
const work = path.join(run, 'pasta-de-teste');
for (const dir of [run, isolatedHome, data, work, path.join(run, 'roaming'), path.join(run, 'local')]) fs.mkdirSync(dir, { recursive: true });
os.homedir = () => isolatedHome;
Object.assign(process.env, { USERPROFILE: isolatedHome, HOME: isolatedHome, APPDATA: path.join(run, 'roaming'),
  LOCALAPPDATA: path.join(run, 'local'), CODEX_HOME: path.join(isolatedHome, '.codex'), CLAUDE_CONFIG_DIR: path.join(isolatedHome, '.claude') });
app.setPath('home', isolatedHome);
app.setPath('userData', data);
app.commandLine.appendSwitch('user-data-dir', data);
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
process.chdir(work);
fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ visualMac: true, tema: 'automatico', tituloAuto: false,
  atalhosGlobais: false, sugestoes: false, defCwd: work, abaAtiva: 'native-smoke',
  abas: [{ id: 'native-smoke', nome: 'Teste nativo isolado', tipo: 'local', caminhos: [work], paineis: [] }] }));
const blocked = [], nativeCalls = [], checks = [], errors = [];
const systemDarkAtStart = nativeTheme.shouldUseDarkColors;
process.on('unhandledRejection', error => errors.push('Main: ' + (error?.message || String(error))));
setTimeout(() => { console.error('Smoke nativo excedeu seu tempo de teste.'); app.exit(1); }, process.argv.includes('--models-memory') ? 150000 : 55000).unref();
const block = name => (...args) => {
  blocked.push({ method: name, target: typeof args[0] === 'string' ? path.basename(args[0]).slice(0, 60) : '' });
  throw Error('Efeito externo bloqueado pelo smoke: ' + name);
};
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = block('child_process.' + name);
global.fetch = async () => { throw Error('Rede bloqueada pelo smoke.'); };
for (const protocol of ['http', 'https']) {
  const transport = require('node:' + protocol);
  transport.request = block(protocol + '.request'); transport.get = block(protocol + '.get');
}
const realLoad = Module._load;
const HiddenBrowserWindow = new Proxy(BrowserWindow, {
  construct(target, args) { return Reflect.construct(target, [{ ...args[0], show: false,
    webPreferences: { ...args[0].webPreferences, backgroundThrottling: false } }]); },
});
Module._load = function (name, parent, isMain) {
  if (name === 'electron') return { ...electron, BrowserWindow: HiddenBrowserWindow };
  if (name === '@lydell/node-pty' || name === 'node-pty') return { spawn: block('node-pty.spawn') };
  return realLoad.call(this, name, parent, isMain);
};
app.on('browser-window-created', (_event, window) => {
  for (const name of ['setBackgroundMaterial', 'setTitleBarOverlay', 'setOverlayIcon']) {
    const native = window[name].bind(window);
    window[name] = (...args) => { nativeCalls.push({ method: name, value: name === 'setOverlayIcon' ? !!args[0] : args[0] }); return native(...args); };
  }
  window.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
  window.webContents.on('render-process-gone', (_e, details) => errors.push('Renderer: ' + details.reason));
});
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !/^(file:|data:|devtools:|about:)/.test(details.url) }));
});
require(path.join(manifest.package, 'main.js'));

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function check(name, action) {
  try { const value = await action(); checks.push({ name, passed: true, value }); return value; }
  catch (error) { checks.push({ name, passed: false, error: error.message }); }
}
function expect(value, message) { if (!value) throw Error(message); }
function dwmMaterial(window) {
  const handle = window.getNativeWindowHandle();
  const numeric = handle.length >= 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
  const script = '$ErrorActionPreference="Stop"; $ProgressPreference="SilentlyContinue"\nAdd-Type -TypeDefinition @"\nusing System; using System.Runtime.InteropServices; public class SmokeDwm { [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size); }\n"@\n$value=0; $status=[SmokeDwm]::DwmGetWindowAttribute([IntPtr]' + numeric + ',38,[ref]$value,4); $dark=0; $darkStatus=[SmokeDwm]::DwmGetWindowAttribute([IntPtr]' + numeric + ',20,[ref]$dark,4); @{status=$status;material=$value;darkStatus=$darkStatus;immersiveDark=$dark}|ConvertTo-Json -Compress';
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  return JSON.parse(realExecFileSync(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 10000 }));
}

async function nativeHitTest(window, point) {
  const many = Array.isArray(point), points = many ? point : [point];
  if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw Error('Ponto nativo inválido.');
  const handle = window.getNativeWindowHandle();
  const numeric = handle.length >= 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
  const innerWidth = await window.webContents.executeJavaScript('innerWidth');
  // SendMessage precisa do event loop do Electron livre: execução assíncrona.
  const script = `$ErrorActionPreference="Stop"; $ProgressPreference="SilentlyContinue"
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class SmokeHit {
 [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; }
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref Point p);
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out Rect r);
 [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h,int m,IntPtr w,IntPtr l);
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[SmokeHit]::SetProcessDPIAware()|Out-Null
$h=[IntPtr]${numeric}; $r=New-Object SmokeHit+Rect; [SmokeHit]::GetClientRect($h,[ref]$r)|Out-Null
$scale=($r.Right-$r.Left)/${innerWidth}; $points='${JSON.stringify(points.map(p => ({ x: p.x, y: p.y })))}'|ConvertFrom-Json
$results=@(foreach($sample in $points){
 $p=New-Object SmokeHit+Point; $p.X=[int][Math]::Round($sample.x*$scale); $p.Y=[int][Math]::Round($sample.y*$scale)
 [SmokeHit]::ClientToScreen($h,[ref]$p)|Out-Null
 $packed=($p.Y -shl 16) -bor ($p.X -band 65535); $hit=[SmokeHit]::SendMessage($h,132,[IntPtr]::Zero,[IntPtr]$packed).ToInt32()
 @{hit=$hit;x=$sample.x;y=$sample.y;screenX=$p.X;screenY=$p.Y;scale=$scale}
})
ConvertTo-Json -InputObject $results -Compress`;
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  return new Promise((resolve, reject) => realExecFile(executable,
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 }, (error, stdout) => {
      if (error) return reject(error);
      try { const parsed = JSON.parse(stdout); resolve(many ? parsed : parsed[0]); } catch (e) { reject(e); }
    }));
}

app.whenReady().then(async () => {
  let window;
  for (let retry = 0; retry < 100; retry++) {
    window = BrowserWindow.getAllWindows()[0];
    if (window && !window.webContents.isLoading() && await window.webContents.executeJavaScript('!!window.VisualMac && !!document.querySelector(".mac-window-bar")').catch(() => false)) break;
    await wait(100);
  }
  if (!window) throw Error('Main não abriu janela.');
  const js = source => window.webContents.executeJavaScript(source);
  if (process.argv.includes('--models-memory')) {
    const result = await require('./models-memory-probe.cjs')(window, {js,wait,check,expect,app,ipcMain:electron.ipcMain,
      root,run,work,installedConfigPath});
    verifySources();
    const report={status:checks.every(c=>c.passed)?'passed':'failed',at:new Date().toISOString(),checks,errors,
      ...result,packageHash:hash(manifest.package),installedModified:hash(installedAsar)!==installedHash};
    if(report.installedModified)report.status='failed';
    fs.writeFileSync(path.join(root,'artifacts/models-memory-qa.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({status:report.status,checks:checks.map(c=>({name:c.name,passed:c.passed,error:c.error})),memory:report.memory,installedModified:report.installedModified}));
    app.exit(report.status==='passed'?0:1); return;
  }
  await check('Main/preload/renderer reais iniciam com perfil vazio', async () => {
    const state = await js('(async()=>({ api:!!window.api.setVisualMac, visual:document.documentElement.classList.contains("visual-mac"), platform:window.api.plataforma, bar:!!document.querySelector(".mac-window-bar"), home:await window.api.home() }))()');
    expect(state.api && state.visual && state.bar && state.home === isolatedHome, 'Interface ou perfil incorreto.');
    return state;
  });
  await check('Botões nativos e área de sobreposição ativos', async () => {
    const overlay = await js('({visible:navigator.windowControlsOverlay.visible,rect:navigator.windowControlsOverlay.getTitlebarAreaRect().toJSON()})');
    expect(overlay.visible && overlay.rect.height > 0, 'Overlay nativo não disponível.');
    expect(nativeCalls.some(c => c.method === 'setTitleBarOverlay'), 'Moldura nunca aplicada.');
    return overlay;
  });
  await check('Mica confirmado pelo DWM do Windows', async () => {
    const material = dwmMaterial(window);
    expect(material.status === 0 && material.material === 2, 'DWM não está usando Mica.');
    return material;
  });
  await check('Menu oculto permanece oculto após Alt; atalhos seguem registrados', async () => {
    expect(!window.isMenuBarVisible() && !window.isMenuBarAutoHide(), 'Faixa do menu visível ou acessível com Alt.');
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Alt' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Alt' }); await wait(120);
    expect(!window.isMenuBarVisible(), 'Alt trouxe a barra de menu de volta.');
    const actions = Menu.getApplicationMenu().items.flatMap(item => item.submenu?.items || []);
    expect(actions.some(item => item.accelerator === 'CmdOrCtrl+T') && actions.some(item => item.accelerator === 'CmdOrCtrl+B'), 'Atalhos do menu perdidos.');
    return { visible: window.isMenuBarVisible(), autoHide: window.isMenuBarAutoHide(), registered: actions.filter(item => item.accelerator).length };
  });
  await check('Chave desliga/liga material e persiste sem fechar', async () => {
    const disabled = await js('window.api.setVisualMac(false)');
    expect(disabled.ok && !JSON.parse(fs.readFileSync(path.join(data, 'config.json'))).visualMac, 'Desligar não persistiu.');
    const off = dwmMaterial(window); expect(off.status === 0 && off.material === 1, 'Mica não desligou.');
    const enabled = await js('window.api.setVisualMac(true)');
    expect(enabled.ok && JSON.parse(fs.readFileSync(path.join(data, 'config.json'))).visualMac, 'Ligar não persistiu.');
    return { disabled, enabled, off, on: dwmMaterial(window) };
  });
  await check('Automático recebe mudança real do nativeTheme e a moldura acompanha', async () => {
    nativeTheme.themeSource = 'light'; await wait(180);
    const light = await js('(async()=>({light:document.documentElement.dataset.macLuz,system:await window.api.getSystemAppearance()}))()');
    nativeTheme.themeSource = 'dark'; await wait(180);
    const dark = await js('(async()=>({light:document.documentElement.dataset.macLuz,system:await window.api.getSystemAppearance()}))()');
    expect(light.light === 'claro' && !light.system.dark && dark.light === 'escuro' && dark.system.dark, 'Aparência do sistema não chegou à tela.');
    nativeTheme.themeSource = 'system';
    return { light, dark };
  });
  await check('Claro e Jornal removem material escuro; Automático restaura SO real', async () => {
    window.setTitle('Cockpit — diagnóstico nativo isolado');
    window.setBounds({ x: 60, y: 60, width: 1500, height: 900 });
    window.showInactive();
    const themes = [];
    for (const theme of ['claro', 'jornal', 'automatico']) {
      await js(`(async()=>{cfg.tema=${JSON.stringify(theme)};aplicarTema(cfg.tema);await window.api.setConfig(cfg);})()`);
      await js('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
      window.webContents.invalidate();
      await wait(450);
      const state = { theme, source: nativeTheme.themeSource, dark: nativeTheme.shouldUseDarkColors,
        dwm: dwmMaterial(window), renderer: await js(`(()=>{const rootStyle=getComputedStyle(document.documentElement);return{theme:document.documentElement.dataset.tema,light:document.documentElement.dataset.macLuz,bg:getComputedStyle(document.querySelector('#shell')).backgroundColor,colorScheme:rootStyle.colorScheme,cards:[...document.querySelectorAll('.bv-bt')].map(el=>{const s=getComputedStyle(el);const r=el.getBoundingClientRect();return{background:s.backgroundColor,color:s.color,bg2:s.getPropertyValue('--bg2').trim(),raised:s.getPropertyValue('--raised').trim(),point:{x:Math.round(r.x+10),y:Math.round(r.y+20)}};})}})()`) };
      themes.push(state);
      window.webContents.invalidate();
      await wait(180);
      fs.writeFileSync(path.join(root, 'artifacts', `${reportName}-${theme}.png`), (await window.webContents.capturePage()).toPNG());
    }
    // Mantém evidência causal mesmo quando a versão anterior falhar.
    nativeCalls.push({ method: 'theme-cases', systemDarkAtStart, themes });
    for (const state of themes.slice(0, 2)) expect(state.source === 'light' && !state.dark && state.dwm.immersiveDark === 0,
      state.theme + ' continuou escuro: ' + JSON.stringify(state));
    expect(themes[2].source === 'system' && themes[2].dark === systemDarkAtStart, 'Automático não voltou ao sistema de verdade.');
    return { systemDarkAtStart, themes };
  });
  await check('IPC real recusa valores inválidos e selo acende/apaga', async () => {
    const responses = await js('(async()=>({invalid:await window.api.setAttentionBadge(-1),on:await window.api.setAttentionBadge(3),off:await window.api.setAttentionBadge(0),color:await window.api.setWindowTheme({color:"url(x)",symbolColor:"#ffffff"})}))()');
    expect(responses.invalid.error && responses.on.ok && responses.off.ok && responses.color.error, 'Validação ou selo incorreto.');
    expect(nativeCalls.some(c => c.method === 'setOverlayIcon' && c.value), 'Selo nativo não foi desenhado.');
    return responses;
  });
  await check('Botão ⋯ chega ao Menu.popup real', async () => {
    const menu = Menu.getApplicationMenu(); const popup = menu.popup.bind(menu); let opened = false;
    menu.popup = options => { opened = true; popup(options); setTimeout(() => menu.closePopup(window), 80); };
    await js('document.querySelector(".mac-window-menu").click()'); await wait(150);
    expect(opened, 'Botão não abriu menu nativo.');
    menu.popup = popup;
    return { opened };
  });
  // Janela exclusiva de QA visível sem roubar foco. O compositor do Windows
  // não atualiza regiões de mouse de modo confiável com a janela oculta.
  window.setTitle('Cockpit — diagnóstico nativo isolado');
  window.setBounds({ x: 60, y: 60, width: 1500, height: 900 });
  window.showInactive();
  await wait(180);
  await check('Cabeçalho livre arrasta; busca, expandir e pastas continuam clicáveis', async () => {
    const points = await js(`(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect();
      const center = selector => { const r = box(selector); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; };
      const top = box('.ck-nav-top'), bar = box('.ck-place-bar'), trilha = box('.ck-place-trilha');
      return [
        { label: 'Cabeçalho da lateral', expected: 2, x: Math.round(top.x + top.width / 2), y: Math.round(top.y + 2) },
        // leva 5h: as abas enchem a faixa, e o + fica no canto direito dela; o espaço livre que sobra é o vão entre a trilha e o +
        { label: 'Vão livre entre a trilha de pastas e o +', expected: 2, x: Math.round(trilha.right + 3), y: Math.round(bar.y + bar.height / 2) },
        { label: 'Busca', expected: 1, ...center('.ck-nav-search') },
        { label: 'Expandir/recolher', expected: 1, ...center('.ck-toggle') },
        { label: 'Pasta', expected: 1, ...center('.ck-place-bar .ck-group-head') },
        { label: 'Nova pasta', expected: 1, ...center('.ck-place-bar .ck-new-place') },
      ];
    })()`);
    const hits = await nativeHitTest(window, points);
    for (let i = 0; i < points.length; i++) expect(hits[i].hit === points[i].expected,
      points[i].label + ': região nativa ' + hits[i].hit + ', esperado ' + points[i].expected);
    return points.map((point, i) => ({ ...point, hit: hits[i].hit }));
  });
  await check('Cabeçalho continua arrastável com lateral recolhida e janela de 390px', async () => {
    const bounds = window.getBounds();
    const configured = await js('cfg.uiCollapsed');
    const cases = [];
    try {
      for (const width of [1500, 390]) {
        window.setBounds({ ...bounds, width });
        await js('if (!cfg.uiCollapsed) document.querySelector(".ck-toggle").click(); true');
        window.webContents.invalidate(); await wait(300);
        const points = await js(`(() => {
          const top = document.querySelector('.ck-nav-top').getBoundingClientRect();
          const button = document.querySelector('.ck-toggle').getBoundingClientRect();
          return [{x: Math.round(top.x + top.width / 2), y: Math.round(top.y + 3)},
            {x: Math.round(button.x + button.width / 2), y: Math.round(button.y + button.height / 2)}];
        })()`);
        const hits = await nativeHitTest(window, points);
        expect(hits[0].hit === 2 && hits[1].hit === 1, 'Regiões incorretas em ' + width + 'px: ' + JSON.stringify(hits));
        cases.push({ width, header: hits[0].hit, toggle: hits[1].hit });
      }
      return cases;
    } finally {
      window.setBounds(bounds);
      await js('if (!!cfg.uiCollapsed !== ' + JSON.stringify(!!configured) + ') document.querySelector(".ck-toggle").click(); true');
      await wait(200);
    }
  });
  let pointerDiagnosticStyle;
  await check('Região nativa do peek antes/depois de no-drag isolado', async () => {
    const previous = await js(`(()=>{const n=document.querySelector('.ck-navigator');const before=n.className;n.classList.add('ck-collapsed','ck-peek');return before;})()`);
    let inserted;
    try {
      window.webContents.invalidate(); await wait(250);
      const point = await js(`(()=>{const r=document.querySelector('.ck-navigator .ck-toggle').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
      const before = await nativeHitTest(window, point);
      inserted = await window.webContents.insertCSS('.ck-app #shell:has(.ck-peek) .mac-window-bar{-webkit-app-region:no-drag}');
      window.webContents.invalidate(); await wait(250);
      const after = await nativeHitTest(window, point);
      const evidence = { point, before, after, baseline };
      nativeCalls.push({ method: 'hit-test-diagnostic', ...evidence });
      expect(after.hit === 1, 'Mesmo no-drag não deixou o toggle cliente: ' + JSON.stringify(evidence));
      if (!baseline) expect(before.hit === 1, 'Pacote final ainda trata toggle como arrasto: ' + JSON.stringify(evidence));
      return evidence;
    } finally {
      if (inserted && baseline) pointerDiagnosticStyle = inserted;
      else if (inserted) await window.webContents.removeInsertedCSS(inserted);
      await js(`document.querySelector('.ck-navigator').className=${JSON.stringify(previous)}`);
    }
  });
  await check('Ponteiro real percorre rail/peek e botão não vira arrasto nativo', async () => {
    const result = await require('./visual-mac-pointer-checks.cjs')(window, {
      nativeHitTest: point => nativeHitTest(window, point),
      nativeHitTestPoints: points => nativeHitTest(window, points),
    });
    result.pointerWithInjectedFix = !!pointerDiagnosticStyle;
    fs.writeFileSync(path.join(root, 'artifacts', reportName + '-pointer.json'), JSON.stringify(result, null, 2));
    expect(result.status === 'passed', result.checks.filter(check => !check.passed).map(check => check.name + ': ' + check.error).join('\n'));
    return result;
  });
  if (pointerDiagnosticStyle) await window.webContents.removeInsertedCSS(pointerDiagnosticStyle);
  window.hide();
  await wait(200);
  fs.writeFileSync(path.join(root, 'artifacts', baseline ? 'visual-mac-native-baseline.png' : 'visual-mac-native-main.png'), (await window.webContents.capturePage()).toPNG());
  await check('Sem erro de console e sem pacote modificado', async () => {
    expect(errors.length === 0, errors.join('\n'));
    expect(hash(manifest.package) === manifest.packageHash, 'Pacote mudou durante teste.');
    if (!baseline) verifySources();
    expect(hash(installedAsar) === installedHash, 'Instalação mudou durante o teste.');
    return { consoleErrors: errors.length, packageHash: manifest.packageHash, sourceHashesVerified: baseline ? 0 : Object.keys(manifest.sourceHashes).length, installedHash };
  });
  const report = { status: checks.every(c => c.passed) ? 'passed' : 'failed', baseline, at: new Date().toISOString(),
    runtime: process.versions, package: manifest.package, packageHash: manifest.packageHash,
    productionMainLoaded: true, productionPreloadLoaded: true, authenticatedEnginesStarted: false,
    installedModified: false, isolatedHome, userData: data, checks, blocked, errors, nativeCalls };
  fs.writeFileSync(path.join(root, 'artifacts', reportName + '.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); app.exit(report.status === 'passed' ? 0 : 1);
}).catch(error => {
  const report = { status: 'failed', error: error.stack, checks, blocked, errors, installedModified: false };
  fs.writeFileSync(path.join(root, 'artifacts', reportName + '.json'), JSON.stringify(report, null, 2));
  console.error(error.stack); app.exit(1);
});
