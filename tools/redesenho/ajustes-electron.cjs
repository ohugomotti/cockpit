const {app,BrowserWindow,session,ipcMain}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const base=path.resolve(__dirname,'../..'),out=path.join(base,'artifacts/native-login.json');
const pty=require(path.join(process.env.LOCALAPPDATA,'Programs/Cockpit/resources/app.asar/node_modules/@lydell/node-pty'));
app.setPath('userData',path.join(base,'artifacts/native-login-profile'));
let win,terminal;const received=[];const wait=ms=>new Promise(r=>setTimeout(r,ms));
ipcMain.handle('qa:run',(_e,o)=>{
 terminal=pty.spawn('powershell.exe',['-NoLogo','-NoProfile','-Command',"$c=[Console]::ReadLine(); if ($c -eq 'CODIGO-QA#estado') { Write-Output 'CODIGO_RECEBIDO_OK' } else { Write-Output 'CODIGO_INCORRETO' }"],{name:'xterm-256color',cols:80,rows:24,cwd:base,env:process.env});
 terminal.onData(data=>{received.push(data);win.webContents.send('qa:event',{id:o.id,kind:'data',data})});terminal.onExit(e=>win.webContents.send('qa:event',{id:o.id,kind:'exit',code:e.exitCode}));return{ok:true};
});
ipcMain.handle('qa:input',(_e,o)=>{terminal.write(o.data);return{ok:true}});
ipcMain.handle('qa:kill',()=>{try{terminal.kill()}catch{}return{ok:true}});
app.whenReady().then(async()=>{try{
 session.defaultSession.webRequest.onBeforeRequest((d,cb)=>cb({cancel:!d.url.startsWith('http://127.0.0.1:4319/')&&!d.url.startsWith('data:')}));
 win=new BrowserWindow({show:false,width:1440,height:940,webPreferences:{preload:path.join(__dirname,'ajustes-preload.cjs'),contextIsolation:true,sandbox:true}});
 await win.loadURL('http://127.0.0.1:4319/?tema=motti');const ev=s=>win.webContents.executeJavaScript(s);
 for(let i=0;i<70&&!await ev('!!window.__qa?.ready');i++)await wait(100);
 await ev(`(()=>{window.api.termRun=terminalQA.run;window.api.termInput=terminalQA.input;window.api.termKill=terminalQA.kill;window.api.textoCopiado=async()=>({texto:' CODIGO-QA#estado\\n'});terminalQA.onEvent(e=>__qa.emit('onTermEvent',e));janelaTerminal([...panes.values()][0],'QA','Login — prova local',null,{login:true});})()`);
 await wait(1600);
 await ev(`document.querySelector('.term-colar').click()`);await wait(100);
 assert.equal(await ev(`document.querySelector('.term-code-input').value`),'CODIGO-QA#estado');
 await ev(`document.querySelector('.term-code-form').requestSubmit()`);
 for(let i=0;i<50&&!received.join('').includes('CODIGO_RECEBIDO_OK');i++)await wait(100);
 assert.ok(received.join('').includes('CODIGO_RECEBIDO_OK'),'PTY não recebeu o código');
 assert.equal(await ev(`document.querySelector('.term-code-input').value`),'');
 fs.writeFileSync(path.join(base,'artifacts/native-login.png'),(await win.webContents.capturePage()).toPNG());
 fs.writeFileSync(out,JSON.stringify({status:'passed',electron:process.versions.electron,pty:'Windows ConPTY',codeReceived:true,realOAuth:false,clipboard:'fixture; clipboard do usuário preservado'},null,2));
 app.exit(0);
}catch(e){fs.writeFileSync(out,JSON.stringify({status:'failed',error:e.stack}));try{terminal?.kill()}catch{}app.exit(1)}});
setTimeout(()=>{try{terminal?.kill()}catch{}app.exit(2)},20000);
