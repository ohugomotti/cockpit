'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ARTIFACTS = path.resolve(__dirname, '../../artifacts');
const { verifyServer } = require('./qa-environment.cjs');

async function connect() {
  const sourceIdentity = await verifyServer();
  const tabs = await fetch('http://127.0.0.1:9222/json/list').then(response => response.json());
  const target = tabs.find(tab => tab.type === 'page' && tab.url.startsWith('http://127.0.0.1:4319/'));
  if (!target) throw new Error('Abra somente a prévia QA em http://127.0.0.1:4319 antes de verificar.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map(); let sequence = 0;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Tempo esgotado conectando ao QA.')),10000);
    socket.addEventListener('open',()=>{clearTimeout(timeout);resolve();},{once:true});
    socket.addEventListener('error',event=>{clearTimeout(timeout);reject(event.error||new Error('CDP indisponível.'));},{once:true});
  });
  socket.addEventListener('message',event=>{
    const message=JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const request=pending.get(message.id);pending.delete(message.id);clearTimeout(request.timeout);
    if(message.error)request.reject(new Error(message.error.message));else request.resolve(message.result);
  });
  function send(method,params={}) {
    return new Promise((resolve,reject)=>{
      const id=++sequence;
      const timeout=setTimeout(()=>{pending.delete(id);reject(new Error(`Tempo esgotado: ${method}`));},25000);
      pending.set(id,{resolve,reject,timeout});socket.send(JSON.stringify({id,method,params}));
    });
  }
  async function evaluate(expression) {
    const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
    return result.result?.value;
  }
  async function ready() {
    for(let attempt=0;attempt<50;attempt++) {
      if(await evaluate('!!window.__qa?.ready'))return;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw new Error('O renderer QA não terminou a inicialização.');
  }
  async function screenshot(name) {
    if(!/^[a-z0-9_-]+\.png$/i.test(name))throw new Error('Nome inválido de captura QA.');
    const result=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    fs.mkdirSync(ARTIFACTS,{recursive:true});const destination=path.join(ARTIFACTS,name);
    fs.writeFileSync(destination,Buffer.from(result.data,'base64'));return destination;
  }
  function close(){for(const request of pending.values()){clearTimeout(request.timeout);request.reject(new Error('QA encerrado.'));}pending.clear();socket.close();}
  return {send,evaluate,ready,screenshot,close,sourceIdentity};
}

async function main() {
  const client=await connect();
  try {
    await client.ready();
    const action=process.argv[2]||'status';
    if(action==='capture')console.log(await client.screenshot(process.argv[3]||'qa-atual.png'));
    else if(action==='reload') {await client.send('Page.reload',{ignoreCache:true});await new Promise(resolve=>setTimeout(resolve,300));await client.ready();console.log(JSON.stringify(await client.evaluate('window.__qa.snapshot?.() || {ready:__qa.ready,errors:__qa.errors}')));}
    else console.log(JSON.stringify(await client.evaluate('window.__qa.snapshot?.() || {ready:__qa.ready,errors:__qa.errors}'),null,2));
  } finally {client.close();}
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={connect,ARTIFACTS};
