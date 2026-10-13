'use strict';
// Renderer real em Electron oculto, perfil/arquivos simulados. Sem motores e SSH.
const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
// Saída desconectada de um executor não deve abrir um diálogo nativo de erro.
for (const stream of [process.stdout, process.stderr]) stream.on('error', error => { if (error.code !== 'EPIPE') app.exit(1); });
process.on('uncaughtException', error => {
  if (error.code === 'EPIPE') return;
  try { fs.appendFileSync(path.resolve(__dirname, '../../artifacts/leitor-ferramentas-fatal.log'), String(error.stack || error) + '\n'); } catch {}
  app.exit(1);
});
const { verifyServer, ORIGIN } = require('./qa-environment.cjs');
const directory = path.resolve(__dirname, '../../artifacts/leitor-ferramentas-qa');
fs.mkdirSync(directory, { recursive: true });
app.setPath('userData', path.join(directory, 'profile'));
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
let win;
const checks = [], errors = [], delay = ms => new Promise(r => setTimeout(r, ms));
const ev = code => win.webContents.executeJavaScript(code);
async function until(code) { for (let n = 0; n < 100; n++) { if (await ev(code)) return; await delay(60); } throw Error('Timeout: ' + code); }
async function check(name, fn) { try { await fn(); checks.push({ name, passed: true }); } catch (e) { checks.push({ name, passed: false, error: e.stack }); } console.log(JSON.stringify(checks.at(-1))); }
async function click(label, selector = '.p-visor:not(.hidden)') { await ev(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)}+' button')].find(b=>(b.getAttribute('aria-label')||b.textContent.trim())===${JSON.stringify(label)}&&!b.hidden&&b.getClientRects().length);if(!b)throw Error('Botão ausente: '+${JSON.stringify(label)});b.click();})()`); await delay(90); }
async function open(remote = null, file = 'C:/QA/plano.md') { await ev(`verArquivo(__qa.panel(__qa.panels[0]),${JSON.stringify(file)},${JSON.stringify(remote)});void 0`); await until('!!document.querySelector(".p-visor:not(.hidden) .reader-main-tools")'); await until('window.__readerGetCount>0'); await delay(130); }
async function close() { await ev('fecharVisor();void 0'); await delay(170); }
async function typeComment(value) { await ev(`(()=>{const t=document.querySelector('.reader-comment-editor textarea');t.value=${JSON.stringify(value)};t.dispatchEvent(new Event('input',{bubbles:true}));})()`); }
async function selectText(quote) { await ev(`(()=>{const b=document.querySelector('.p-visor:not(.hidden) .visor-corpo'),w=document.createTreeWalker(b,NodeFilter.SHOW_TEXT),list=[];let n,t='';while(n=w.nextNode()){list.push({n,s:t.length,e:t.length+n.length});t+=n.data}const s=t.indexOf(${JSON.stringify(quote)}),e=s+${JSON.stringify(quote)}.length;if(s<0)throw Error('Trecho ausente');const f=list.find(x=>x.e>s),l=list.find(x=>x.e>=e&&x.s<e),r=document.createRange();r.setStart(f.n,s-f.s);r.setEnd(l.n,e-l.s);getSelection().removeAllRanges();getSelection().addRange(r);b.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));})()`); }
async function capture(name) { win.webContents.invalidate(); await ev('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))'); await delay(300); fs.writeFileSync(path.join(directory, name + '.png'), (await win.webContents.capturePage()).toPNG()); }
app.whenReady().then(async () => {
  const identity = await verifyServer();
  session.defaultSession.webRequest.onBeforeRequest((d, cb) => { const allowed = d.url.startsWith(ORIGIN + '/') || d.url.startsWith('data:') || d.url === 'about:blank'; if (!allowed) errors.push('Requisição externa bloqueada.'); cb({ cancel: !allowed }); });
  win = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await win.loadURL(ORIGIN + '/?cenario=supervisao&visual=1&tema=jornal');
  await until('!!window.__qa?.ready && !!window.CockpitUI && __qa.panels.length===3');
  await ev(`(()=>{
    window.__readerStore={};window.__readerGetCount=0;window.__readerFail=false;window.__readerCallsBefore=__qa.calls.length;
    window.__readerText='# Plano de revisão\\n\\nEste plano precisa de **atenção** necessária.\\n\\n## Entrega\\n\\nConferir a versão e o histórico.\\n\\n'+Array.from({length:35},(_,i)=>'Parágrafo '+i+' para leitura confortável.').join('\\n\\n')+'\\n\\n## Final\\n\\nÚltima etapa do plano.';
    window.__readerHash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
    __qa.override('verArquivo',async(file,remote)=>{const id=await __readerHash(JSON.stringify([file,remote||null]));window.__readerCurrentId=id;return{tipo:'texto',nome:'plano.md',dados:__readerText,bytes:__readerText.length,document:{id,path:file,origin:remote?{kind:'remote',host:remote.host,user:remote.usuario,port:remote.porta||22}:{kind:'local'},version:await __readerHash(__readerText)}}});
    __qa.override('readerCommentsGet',async doc=>{__readerGetCount++;return{ok:true,state:structuredClone(__readerStore[doc.id]||(__readerStore[doc.id]={revision:0,comments:[],draft:null,view:{fontSize:16,wrap:true,mode:'preview',scrollTop:0,panel:'',search:'',filter:'open'}}))}});
    __qa.override('readerCommentsSave',async data=>{if(__readerDeferred&&data.comments){window.__readerDeferred=false;await new Promise(r=>{window.__readerRelease=r})}const old=__readerStore[data.document.id];if(__readerFail||old.revision!==data.expectedRevision)return{ok:false,code:'CONFLICT',state:structuredClone(old)};const next={...old,...Object.fromEntries(['comments','draft','view'].filter(k=>k in data).map(k=>[k,data[k]])),revision:old.revision+1};__readerStore[data.document.id]=structuredClone(next);return{ok:true,state:structuredClone(next)}});
    window.__readerDeferred=false;
  })()`);
  await check('Ctrl+F busca apenas o documento, encontra texto que atravessa marcação e navega', async () => {
    await open(); await ev("document.querySelector('.p-visor:not(.hidden) .visor-corpo').dispatchEvent(new KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true,cancelable:true}))");
    assert.equal(await ev("document.activeElement.matches('.reader-search input')"), true);
    await ev("document.activeElement.value='atenção necessária';document.activeElement.dispatchEvent(new Event('input',{bubbles:true}))");
    await until("document.querySelector('.reader-search-count').textContent==='1 de 1'");   // a busca espera 150 ms sem digitar (leva 3, R5-04)
    await ev("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))");
    assert.equal(await ev("!!document.querySelector('.p-visor:not(.hidden)') && document.querySelector('.reader-search').hidden"), true);
  });
  await check('Sumário navega no documento e muda do código para a prévia', async () => {
    await click('Código'); await click('Sumário'); await click('Final', '.reader-side');
    assert.equal(await ev("document.querySelector('.p-visor:not(.hidden) .visor-corpo').dataset.tipo"), 'markdown');
    assert.ok(await ev("document.querySelector('.p-visor:not(.hidden) .visor-corpo').scrollTop > 500"));
    await click('Voltar ao documento');
  });
  await check('Selecionar, comentar e salvar conserva citação; HTML do comentário é texto seguro', async () => {
    await selectText('atenção necessária'); await click('Comentar trecho');
    await typeComment('Conferir antes. <img src=x onerror=alert(1)>'); await click('Salvar comentário');
    await until('Object.values(__readerStore)[0].comments.length===1');
    assert.equal(await ev("document.querySelector('.reader-comment blockquote').textContent"), 'atenção necessária');
    assert.equal(await ev("document.querySelectorAll('.reader-comment img').length"), 0);
    await capture('comentarios-desktop');
  });
  await check('Ações são ícones reais com nome acessível e dica; títulos do sumário conservam conteúdo', async () => {
    const audit = await ev("[...document.querySelectorAll('.p-visor:not(.hidden) button')].filter(b=>!b.classList.contains('reader-toc-item')).filter(b=>!b.querySelector('svg')||!(b.getAttribute('aria-label')||'').trim()||!b.title.trim()||b.textContent.trim()).map(b=>({label:b.getAttribute('aria-label'),text:b.textContent,title:b.title}))");
    assert.deepEqual(audit, []);
    await click('Sumário'); assert.equal(await ev("[...document.querySelectorAll('.reader-toc-item')].some(b=>b.textContent==='Entrega')"), true); await click('Comentários');
  });
  await check('Busca encontra trecho comentado; preparar ajuste só acrescenta rascunho e preserva anexos', async () => {
    await ev("window.__readerPane=__qa.panel(__qa.panels[0]);window.__readerInput=__readerPane.el.querySelector('.p-input');__readerInput.value='Meu rascunho anterior';window.__readerAttachments=JSON.stringify(__readerPane.anexos);window.__readerSendCount=__qa.calls.filter(c=>/^(paneSend|paneStart|paneStop)$/.test(c.method)).length;");
    await click('Preparar ajuste', '.reader-comment');
    assert.equal(await ev("__readerInput.value.startsWith('Meu rascunho anterior\\n\\nRevisar o arquivo')&&__readerInput.value.includes('atenção necessária')"), true);
    assert.equal(await ev('JSON.stringify(__readerPane.anexos)===__readerAttachments'), true);
    assert.equal(await ev('__qa.calls.filter(c=>/^(paneSend|paneStart|paneStop)$/.test(c.method)).length===__readerSendCount'), true);
    await click('Buscar'); await ev("document.querySelector('.reader-search-count').textContent='';document.querySelector('.reader-search input').value='atenção';document.querySelector('.reader-search input').dispatchEvent(new Event('input'))");   // zera o "1 de 1" que o check 1 deixou: o until só passa depois da pausa de 150 ms, com a busca rodada
    await until("document.querySelector('.reader-search-count').textContent==='1 de 1'"); await click('Fechar busca');
  });
  await check('Resolver, reabrir e editar preserva a observação', async () => {
    await click('Resolver', '.reader-comment'); await click('Resolvidos');
    assert.equal(await ev('document.querySelectorAll(".reader-comment").length'), 1);
    await click('Reabrir', '.reader-comment'); await click('Abertos'); await click('Editar', '.reader-comment');
    await typeComment('Comentário revisado'); await click('Salvar comentário');
    await until("document.querySelector('.reader-comment-text')?.textContent==='Comentário revisado'");
  });
  await check('Fechar e reabrir mantém comentário e rascunho pessoal sem alterar o Markdown', async () => {
    await click('Comentário geral'); await typeComment('Rascunho pessoal ainda não concluído');
    const original = await ev('__readerText'); await close(); await open();
    await until("document.querySelector('.reader-comment-editor textarea')?.value==='Rascunho pessoal ainda não concluído'");
    assert.equal(await ev('__readerText'), original);
    assert.equal(await ev("document.querySelector('.reader-comment-text').textContent"), 'Comentário revisado');
    await click('Descartar rascunho');
  });
  await check('Salvar lento bloqueia edição; fechar e reabrir não ressuscita rascunho já salvo', async () => {
    await click('Comentário geral'); await typeComment('Anotação assíncrona'); await ev('__readerDeferred=true'); await click('Salvar comentário');
    await until('typeof __readerRelease === "function"');
    assert.equal(await ev("document.querySelector('.reader-comment-editor textarea').disabled"), true);
    await close(); await open(); await ev('__readerRelease();void 0');
    await until("[...document.querySelectorAll('.reader-comment-text')].some(n=>n.textContent==='Anotação assíncrona')");
    assert.equal(await ev('document.querySelectorAll(".reader-comment-editor").length'), 0);
    assert.equal(await ev('__readerStore[__readerCurrentId].draft'), null);
  });
  await check('Arquivo alterado sinaliza trecho desaparecido; vincular de novo é explícito', async () => {
    await ev("__readerText=__readerText.replace('**atenção** necessária','nova revisão')");
    await click('Mais'); await click('Reler arquivo'); await delay(250);
    await until("!!document.querySelector('.reader-anchor-warning')");
    assert.match(await ev("document.querySelector('.reader-anchor-warning').textContent"), /Trecho mudou/);
    await selectText('nova revisão'); await click('Vincular à seleção', '.reader-comment');
    await until("document.querySelector('.reader-comment blockquote')?.textContent==='nova revisão'");
    assert.equal(await ev('document.querySelectorAll(".reader-anchor-warning").length'), 0);
    await ev('getSelection().removeAllRanges()');
  });
  await check('Código aceita comentário; zoom e quebra são guardados por documento', async () => {
    await click('Voltar ao documento'); await click('Código'); await selectText('## Entrega'); await click('Comentar trecho');
    await typeComment('Título na fonte'); await click('Salvar comentário'); await click('Mais'); await click('Aumentar texto'); await click('Quebrar linhas');
    await close(); await open(); await click('Mais');
    assert.equal(await ev("document.querySelector('.p-visor:not(.hidden) .visor-corpo').dataset.tipo"), 'texto');
    assert.equal(await ev("document.querySelector('.p-visor:not(.hidden) .visor-corpo').classList.contains('reader-wrap')"), false);
    assert.equal(await ev("document.querySelector('.p-visor:not(.hidden) .visor-corpo').style.getPropertyValue('--reader-font-size')"), '17px');
  });
  await check('Tela 390 usa um painel por vez; controles e foco permanecem no diálogo', async () => {
    win.setSize(390, 844); await delay(220); await click('Comentários'); await click('Comentários');
    if (!await ev("!document.querySelector('.reader-side').hidden")) await click('Comentários');
    assert.equal(await ev("getComputedStyle(document.querySelector('.p-visor:not(.hidden) .visor-corpo')).display"), 'none');
    const geometry = await ev("(()=>{const v=document.querySelector('.p-visor:not(.hidden)'),r=v.querySelector('.reader-side').getBoundingClientRect();return{left:r.left,right:r.right,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1}})()");
    assert.equal(geometry.overflow, false); assert.ok(geometry.left >= 0 && geometry.right <= geometry.width + 1);
    const controls = await ev("[...document.querySelectorAll('.p-visor:not(.hidden) .reader-main-tools button,.p-visor:not(.hidden) .visor-modos button')].map(b=>{const r=b.getBoundingClientRect();return{width:r.width,height:r.height,left:r.left,right:r.right}})");
    for(const control of controls)assert.ok(control.width>=32&&control.height>=32&&control.left>=0&&control.right<=390,JSON.stringify(control));
    await capture('comentarios-390'); await click('Voltar ao documento');
    assert.notEqual(await ev("getComputedStyle(document.querySelector('.p-visor:not(.hidden) .visor-corpo')).display"), 'none');
    win.setSize(1440, 960); await delay(120);
  });
  await check('Mesmo caminho no PC e em duas VPS mantém coleções separadas', async () => {
    await close(); const localId = await ev('__readerCurrentId');
    await open({ host: 'a.example.invalid', usuario: 'qa', porta: 22 }, '/srv/plano.md'); await click('Comentários');
    assert.equal(await ev('document.querySelectorAll(".reader-comment").length'), 0); const first = await ev('__readerCurrentId');
    await click('Comentário geral'); await typeComment('Servidor A'); await click('Salvar comentário'); await close();
    await open({ host: 'b.example.invalid', usuario: 'qa', porta: 22 }, '/srv/plano.md'); await click('Comentários');
    assert.equal(await ev('document.querySelectorAll(".reader-comment").length'), 0);
    assert.equal(await ev(`__readerCurrentId!==${JSON.stringify(first)}&&__readerCurrentId!==${JSON.stringify(localId)}`), true);
    await close(); await open({ host: 'a.example.invalid', usuario: 'qa', porta: 22 }, '/srv/plano.md');
    assert.equal(await ev("document.querySelector('.reader-comment-text').textContent"), 'Servidor A');
  });
  await check('Copiar caminho e conteúdo usa a origem atual; reler conserva a posição', async () => {
    await click('Voltar ao documento'); await click('Mais'); await click('Copiar caminho');
    assert.equal(await ev("__qa.calls.filter(c=>c.method==='copiarTexto').at(-1).args[0]"), '/srv/plano.md');
    await click('Copiar conteúdo'); assert.equal(await ev("__qa.calls.filter(c=>c.method==='copiarTexto').at(-1).args[0]===__readerText"), true);
    await ev("document.querySelector('.p-visor:not(.hidden) .visor-corpo').scrollTop=800");
    await click('Reler arquivo'); await delay(220);
    assert.ok(await ev("document.querySelector('.p-visor:not(.hidden) .visor-corpo').scrollTop>500"));
    await click('Comentários');
  });
  await check('Excluir exige clique explícito de confirmação e informa o resultado', async () => {
    await click('Excluir', '.reader-comment'); assert.equal(await ev('document.querySelectorAll(".reader-comment").length'), 1);
    await click('Cancelar', '.reader-comment'); assert.equal(await ev('document.querySelectorAll(".reader-comment").length'), 1);
    await click('Excluir', '.reader-comment'); await click('Excluir comentário');
    await until('document.querySelectorAll(".reader-comment").length===0');
    assert.match(await ev("document.querySelector('.reader-status').textContent"), /excluído/);
  });
  await check('Conflito não substitui comentário externo e mantém texto pessoal para recuperar', async () => {
    await click('Comentário geral'); await typeComment('Preservar este rascunho em conflito'); await ev('__readerFail=true');
    await click('Salvar comentário'); await until("document.querySelector('.reader-status').textContent.includes('outra janela')");
    assert.equal(await ev("document.querySelector('.reader-comment-editor textarea').value"), 'Preservar este rascunho em conflito');
    assert.equal(await ev('__readerStore[__readerCurrentId].comments.length'), 0);
    await ev('__readerFail=false'); await close();
  });
  const engineCalls = await ev('__qa.calls.slice(__readerCallsBefore).filter(c=>/^(paneSend|paneStart|paneStop|termRun|maisDetalhes)$/.test(c.method)).map(c=>c.method)');
  if (engineCalls.length) errors.push('Chamadas indevidas a motor: ' + engineCalls.join(','));
  const snapshot = await ev('__qa.snapshot()'); errors.push(...snapshot.errors);
  const report = { status: checks.every(c => c.passed) && !errors.length ? 'passed' : 'failed', sourceIdentity: identity, checks, errors, enginesStarted: false, sshOpened: false, productionMainLoaded: false, finalState: snapshot };
  fs.writeFileSync(path.resolve(directory, '../leitor-ferramentas-qa.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, passed: checks.filter(c => c.passed).length, total: checks.length, errors }));
  app.exit(report.status === 'passed' ? 0 : 1);
}).catch(e => { console.error(e.stack); app.exit(1); });
