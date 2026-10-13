'use strict';
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
for (const stream of [process.stdout, process.stderr]) stream.on('error', e => { if (e.code !== 'EPIPE') throw e; });
const run = path.resolve(__dirname, '../../artifacts/live-voice-qa-' + Date.now());
fs.mkdirSync(run, { recursive: true }); app.setPath('userData', path.join(run, 'profile'));
for (const flag of ['disable-background-networking', 'disable-component-update', 'mute-audio']) app.commandLine.appendSwitch(flag);
const checks = [], errors = []; let win;
const ev = source => win.webContents.executeJavaScript(source), delay = ms => new Promise(r => setTimeout(r, ms));
async function check(name, fn) { try { await fn(); checks.push({ name, passed: true }); } catch (e) { checks.push({ name, passed: false, error: e.stack }); } }
const fixture = `
window.started=0;window.sent=0;window.stopped=0;window.interrupted=0;
class QAEvents {constructor(){this.listeners={};this.readyState='open';this.sent=[]}addEventListener(n,f){(this.listeners[n]||=[]).push(f)}removeEventListener(){}send(v){this.sent.push(JSON.parse(v))}close(){this.readyState='closed';(this.listeners.close||[]).forEach(f=>f())}}
class QAPeer extends QAEvents {constructor(){super();this.iceGatheringState='complete'}addTrack(){}createDataChannel(){return this.channel=new QAEvents()}async createOffer(){return{type:'offer',sdp:'v=0\\r\\nm=audio 9 UDP/TLS/RTP/SAVPF 111\\r\\n'}}async setLocalDescription(v){this.localDescription=v}async setRemoteDescription(v){this.remoteDescription=v}}
window.voice=CockpitLiveVoice.mount({container:document.getElementById('cards'),session:{paneId:'p1',threadId:'thread-claude-1',engine:'claude'},P:{nome:'Revisão financeira'},
start:async a=>{if(!a.costAccepted)throw Error('sem custo');started++;return{session:{id:'live-id',...a.session},transport:{type:'webrtc',sdp:a.sdp}}},sendToPane:async(s,t)=>{sent++;window.sentText=t;return{ok:true}},interruptPane:async()=>{interrupted++;return{ok:true}},
Peer:QAPeer,mediaDevices:{getUserMedia:async()=>{const track={enabled:true,stop(){stopped++}};return{getTracks:()=>[track],getAudioTracks:()=>[track]}}},makeAudio:()=>({play:async()=>{},pause(){},srcObject:null}),makeStream:x=>x});void 0;`;
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((r, cb) => cb({ cancel: !r.url.startsWith('data:') && r.url !== 'about:blank' }));
  win = new BrowserWindow({ width: 1000, height: 900, show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
  const css = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/connector-prompts.css'), 'utf8');
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta charset="utf-8"><style>body{font:14px system-ui;background:#f6f3eb;color:#25283a;margin:20px}main{max-width:720px;margin:auto}' + css + '</style><main><textarea id="chat" aria-label="Mensagem"></textarea><div id="cards"></div></main>'));
  await ev(fs.readFileSync(path.resolve(__dirname, '../../src/renderer/live-voice.js'), 'utf8') + ';void 0;');
  await ev("document.getElementById('chat').focus();"); await ev(fixture);
  await check('Abrir painel não pede microfone, paga ou tira foco; custo e sessão visíveis', async () => {
    assert.equal(await ev('started'), 0); assert.equal(await ev('document.activeElement.id'), 'chat');
    assert.ok(await ev('voice.element.textContent.includes("US$ 0,05/min")&&voice.element.textContent.includes("15 segundos")&&voice.element.textContent.includes("thread-claude-1")'));
    assert.equal(await ev('[...voice.element.querySelectorAll("button")].every(b=>b.title&&b.getAttribute("aria-label")&&b.textContent.trim()==="")'), true);
  });
  await check('Conexão exige autorização de custo deliberada', async () => {
    await ev(`document.querySelector('[aria-label="Conectar voz"]').click()`); await delay(30); assert.equal(await ev('started'), 0);
    await ev(`voice.element.querySelector('input[type=checkbox]').click();document.querySelector('[aria-label="Conectar voz"]').click()`); await delay(50);
    assert.equal(await ev('started'), 1); await ev(`voice.controller.handleEvent({type:'session.started'});`);
    assert.equal(await ev('voice.element.dataset.microphone'), 'on');
  });
  await check('Transcrição chega, pode ser corrigida e só envia ao clicar', async () => {
    await ev(`voice.controller.handleEvent({type:'session.input_transcript.delta',delta:'Revise o plano',start_ms:0,end_ms:500});voice.controller.handleEvent({type:'session.delegation.created',offset_ms:501,delegation:{id:'d1',target:'client'}});`);
    assert.equal(await ev('sent'), 0); assert.equal(await ev(`document.querySelector('[aria-label="Revisar pedido de voz antes de enviar"]').value`), 'Revise o plano');
    await ev(`document.querySelector('[aria-label="Revisar pedido de voz antes de enviar"]').value='Revise somente os títulos.';document.querySelector('[aria-label="Enviar transcrição revisada para esta sessão"]').click()`); await delay(40);
    assert.equal(await ev('sentText'), 'Revise somente os títulos.'); assert.equal(await ev('sent'), 1);
  });
  await check('Voz/microfone e trabalho têm controles independentes', async () => {
    await ev(`document.querySelector('[aria-label="Silenciar voz sem parar trabalho"]').click()`); assert.equal(await ev('interrupted'), 0); assert.equal(await ev('voice.element.dataset.microphone'), 'on');
    await ev(`document.querySelector('[aria-label="Pausar microfone"]').click()`); assert.equal(await ev('voice.element.dataset.microphone'), 'off'); assert.equal(await ev('voice.controller.getState().active'), true);
    await ev(`document.querySelector('[aria-label="Interromper o trabalho da sessão"]').click()`); await delay(20); assert.equal(await ev('interrupted'), 1);
  });
  await check('Painel cabe em 390px, com nomes acessíveis e sessão identificada', async () => {
    win.setSize(390, 900); await delay(60); assert.equal(await ev('document.documentElement.scrollWidth<=innerWidth'), true);
    fs.writeFileSync(path.join(run, 'mobile.png'), (await win.webContents.capturePage()).toPNG());
  });
  await check('Remover popup encerra captura sem interromper o trabalho', async () => {
    await ev('voice.element.remove()'); await delay(40); assert.equal(await ev('stopped'), 1); assert.equal(await ev('voice.controller.getState().active'), false); assert.equal(await ev('interrupted'), 1);
  });
  await check('Janela nunca aparece, rede bloqueada e console limpo', async () => { assert.equal(win.isVisible(), false); assert.deepEqual(errors, []); });
  fs.writeFileSync(path.join(run, 'result.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ run, checks, errors }, null, 2)); app.exit(checks.every(c => c.passed) ? 0 : 1);
}).catch(e => { console.error(e); app.exit(1); });
