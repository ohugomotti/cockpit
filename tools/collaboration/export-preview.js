'use strict';
// Prévia estática: lê o renderer isolado. Nunca inicia modelos ou debates.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { connect } = require('./cdp');
const root = path.resolve(__dirname, '../..');
const renderer = path.join(root, 'src/renderer');
const artifacts = path.join(root, 'artifacts');
const port = 9348;

async function exportPreview() {
  const c = await connect();
  try {
    await c.evaluate('(async()=>{await window.CockpitCollaboration.open([...panes.values()][0]);await document.fonts.ready;return true})()');
    const snapshot = await c.evaluate(`(() => {
      const clone = document.documentElement.cloneNode(true);
      const originals = [...document.documentElement.querySelectorAll('*')];
      const copies = [...clone.querySelectorAll('*')];
      originals.forEach((source, i) => {
        const target = copies[i];
        if (!target) return;
        if (source instanceof HTMLInputElement) { target.setAttribute('value', source.value); target.toggleAttribute('checked', source.checked); }
        if (source instanceof HTMLTextAreaElement) target.textContent = source.value;
        if (source instanceof HTMLOptionElement) target.toggleAttribute('selected', source.selected);
        if (source.scrollTop || source.scrollLeft) { target.dataset.previewScrollTop = source.scrollTop; target.dataset.previewScrollLeft = source.scrollLeft; }
        if (source instanceof HTMLDialogElement && source.open) { target.removeAttribute('open'); target.dataset.previewModal = 'true'; }
      });
      clone.querySelectorAll('script,base,meta[http-equiv="Content-Security-Policy"]').forEach(node => node.remove());
      clone.querySelectorAll('dialog:not([data-preview-modal])').forEach(node => node.remove());
      for (const node of clone.querySelectorAll('*')) for (const attr of [...node.attributes]) {
        if (/^on/i.test(attr.name) || ((attr.name === 'href' || attr.name === 'src') && /^javascript:/i.test(attr.value))) node.removeAttribute(attr.name);
      }
      for (const node of clone.querySelectorAll('[src],link[href]')) {
        const attr = node.hasAttribute('src') ? 'src' : 'href'; const value = node.getAttribute(attr);
        if (!value || /^(data:|https?:|#)/i.test(value)) continue;
        let local = value.replace(/^.*\\/renderer\\//, '');
        node.setAttribute(attr, 'http://127.0.0.1:${port}/' + local.replace(/^\\.\\//, ''));
      }
      const head = clone.querySelector('head');
      const viewport = clone.querySelector('meta[name="viewport"]');
      if (!viewport) { const v = document.createElement('meta'); v.name = 'viewport'; v.content = 'width=device-width, initial-scale=1'; head.append(v); }
      clone.querySelector('title').textContent = 'Prévia estática · Debate real · Motti.IA Cockpit';
      const script = document.createElement('script'); script.src = '/preview-init.js'; script.defer = true; head.append(script);
      const style = document.createElement('style'); style.textContent = '.preview-notice{position:fixed;right:8px;bottom:3px;z-index:2147483647;font:10px var(--mono,monospace);padding:1px 5px;color:#eef1f6;background:#07182f;border-radius:3px;pointer-events:none}'; head.append(style);
      const notice = document.createElement('span'); notice.className = 'preview-notice'; notice.textContent = 'Prévia estática da interface real';
      (clone.querySelector('dialog[data-preview-modal]') || clone.querySelector('body')).append(notice);
      return { html: '<!doctype html>\\n' + clone.outerHTML, metadata: { capturedAt: new Date().toISOString(), source: 'renderer isolado CDP9336', theme: document.documentElement.dataset.tema, status: document.querySelector('dialog[open] .co-status')?.textContent, messages: document.querySelectorAll('dialog[open] .co-message').length, paneCount: panes.size, sourceViewport: { width: innerWidth, height: innerHeight } } };
    })()`);
    fs.mkdirSync(artifacts, { recursive: true });
    fs.writeFileSync(path.join(artifacts, 'preview-debate-real.html'), snapshot.html);
    fs.writeFileSync(path.join(artifacts, 'preview-debate-real.json'), JSON.stringify(snapshot.metadata, null, 2));
    console.log(JSON.stringify(snapshot.metadata));
  } finally { c.close(); }
}
function serve() {
  const init = `document.addEventListener('DOMContentLoaded',async()=>{for(const d of document.querySelectorAll('dialog[data-preview-modal]'))d.showModal();await document.fonts.ready;for(const n of document.querySelectorAll('[data-preview-scroll-top]')){n.scrollTop=Number(n.dataset.previewScrollTop);n.scrollLeft=Number(n.dataset.previewScrollLeft)}document.documentElement.dataset.previewReady='true'});`;
  const mime = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2' };
  http.createServer((req,res)=>{
    const pathname = decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
    res.setHeader('Cache-Control','no-store');
    if(pathname==='/preview-init.js'){res.setHeader('Content-Type',mime['.js']);res.end(init);return;}
    const file = pathname==='/' || pathname==='/preview-debate-real.html' ? path.join(artifacts,'preview-debate-real.html') : path.resolve(renderer,'.'+pathname);
    if(file!==path.join(artifacts,'preview-debate-real.html') && !file.startsWith(renderer+path.sep)){res.writeHead(403);res.end();return;}
    fs.readFile(file,(error,data)=>{if(error){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',mime[path.extname(file)] || 'application/octet-stream');res.end(data);});
  }).listen(port,'127.0.0.1',()=>console.log('Prévia estática: http://127.0.0.1:'+port+'/preview-debate-real.html'));
}
async function captureChromePreview(debugPort = 9222) {
  const targets = await (await fetch('http://127.0.0.1:'+debugPort+'/json/list')).json();
  const target = targets.find(t => t.type === 'page' && t.url === 'http://127.0.0.1:'+port+'/preview-debate-real.html');
  if (!target) throw new Error('A aba exata da prévia não está aberta.');
  const ws = new WebSocket(target.webSocketDebuggerUrl); let seq = 0; const pending = new Map();
  ws.addEventListener('message', event => { const data = JSON.parse(event.data); const p = pending.get(data.id); if (p) { pending.delete(data.id); clearTimeout(p.timer); data.error ? p.reject(new Error(JSON.stringify(data.error))) : p.resolve(data.result); } });
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  function call(method,params={}) { return new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Prazo de 20s: '+method));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));}); }
  try {
    let ready = false;
    for(let i=0;i<20;i++){
      try { const check = await call('Runtime.evaluate',{expression:'document.readyState === "complete" && document.documentElement.dataset.previewReady === "true"',returnByValue:true});if(check.result?.value){ready=true;break;} } catch(error){ if(!/context was destroyed/.test(error.message))throw error; }
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    if(!ready)throw new Error('O DOM estático não terminou de carregar.');
    for (const [name,width,height,mobile] of [['desktop',1440,960,false],['mobile',390,844,true]]) {
      await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
      await call('Runtime.evaluate',{expression:'document.fonts.ready.then(()=>true)',awaitPromise:true,returnByValue:true});
      // O enquadramento da prévia começa na primeira fala; não altera o runtime.
      await call('Runtime.evaluate',{expression:'document.querySelector("dialog:modal .co-transcript").scrollTop=0',returnByValue:true});
      // A superfície de captura precisa redesenhar após mudar a largura em segundo plano.
      await call('Runtime.evaluate',{expression:'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))',awaitPromise:true,returnByValue:true});
      await new Promise(resolve=>setTimeout(resolve,300));
      const shot=await call('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false,optimizeForSpeed:true});
      const file=path.join(artifacts,'preview-debate-'+name+'.png');fs.writeFileSync(file,Buffer.from(shot.data,'base64'));console.log(file);
      const metrics = await call('Runtime.evaluate',{expression:`(()=>{const d=document.querySelector('dialog:modal');const p=d.querySelector('.co-primary:not([hidden])');const r=d.getBoundingClientRect();const primary=p&&getComputedStyle(p);return {preview:true,source:'DOM real exportado do runtime isolado',renderedIn:'Chrome ${debugPort===9350?'headless isolado':'logado, aba de prévia'}',viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,dialog:{width:r.width,height:r.height,scrollWidth:d.scrollWidth,clientWidth:d.clientWidth},messageCount:d.querySelectorAll('.co-message').length,fonts:[...document.fonts].map(f=>({family:f.family,status:f.status})),primary:primary?{foreground:primary.color,background:primary.backgroundColor}:null,overflow:[...d.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().width>0&&e.scrollWidth>e.clientWidth+2).map(e=>({tag:e.tagName,className:e.className,width:e.clientWidth,scroll:e.scrollWidth}))}})()`,returnByValue:true});
      fs.writeFileSync(path.join(artifacts,'preview-debate-'+name+'.json'),JSON.stringify(metrics.result.value,null,2));
    }
  } finally { if(debugPort===9350) await call('Browser.close').catch(()=>{}); ws.close();for(const p of pending.values())clearTimeout(p.timer); }
}
async function captureHeadlessPreview() {
  const { spawn } = require('node:child_process');
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const args = ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=9350','--user-data-dir='+path.join(artifacts,'preview-chrome-cdp'),'http://127.0.0.1:'+port+'/preview-debate-real.html'];
  const child=spawn(chrome,args,{windowsHide:true,stdio:'ignore'});
  try {
    let connected = false;
    for(let i=0;i<30;i++){try{await fetch('http://127.0.0.1:9350/json/version');connected=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,200));}}
    if(!connected)throw new Error('Chrome isolado não respondeu em 6s.');
    await captureChromePreview(9350);
  } finally { child.kill(); }
}
const action = process.argv.includes('--capture-headless') ? captureHeadlessPreview() : process.argv.includes('--capture-chrome') ? captureChromePreview() : exportPreview().then(()=>{if(process.argv.includes('--serve'))serve();});
action.catch(error=>{console.error(error);process.exitCode=1;});
