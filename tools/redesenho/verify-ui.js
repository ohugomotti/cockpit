'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { connect, ARTIFACTS } = require('./cdp');
const { verifyServer } = require('./qa-environment.cjs');
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function main() {
  const client = await connect();
  const results = [];
  const check = async (name, run) => {
    try { await run(); results.push({ name, ok: true }); }
    catch (error) { results.push({ name, ok: false, error: error.message }); }
    console.log(JSON.stringify(results.at(-1)));
  };
  const evaluate = client.evaluate;
  async function key(key, code, modifiers = 0) {
    const vk = { Escape: 27, Tab: 9, F6: 117, Enter: 13, Home:36, End:35, ArrowUp:38, ArrowDown:40 }[key] || key.toUpperCase().charCodeAt(0);
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers, windowsVirtualKeyCode: vk });
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers, windowsVirtualKeyCode: vk });
    await delay(80);
  }
  async function click(selector) {
    const point = await evaluate(`(() => { const n=document.querySelector(${JSON.stringify(selector)}); if(!n)throw new Error('Elemento ausente');n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    await delay(100);
  }
  const engineCalls = () => evaluate(`__qa.calls.filter(c=>/^(paneStart|paneSend|paneStop|paneInterrupt|approve|perguntaResponder)$/.test(c.method)).length`);
  const closeLayers = async () => { for(let n=0;n<5 && await evaluate('!!document.querySelector(".ck-overlay")');n++)await key('Escape','Escape'); };
  try {
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await client.send('Page.reload', { ignoreCache: true });
    await delay(350); await client.ready();
    // Uma aba em segundo plano pode adiar requestAnimationFrame por até um segundo.
    const tower = () => evaluate('[...document.querySelectorAll(".ck-control-list .ck-session")].map(n=>({key:n.dataset.key,state:n.dataset.state}))');
    for(let attempt=0;attempt<40;attempt++) {
      if((await tower()).length>=2)break;
      await delay(100);
    }
    await check('Três sessões e estados preservados', async () => {
      const state = await evaluate('__qa.snapshot()');
      assert.equal(state.panels.length, 3); assert.equal(state.panels[0].permissions, 1); assert.equal(state.panels[1].busy, true);
      /* Concluída JÁ LIDA é histórico e fica fora da Torre (inControlTower no cockpit-ui.js;
         test/cockpit-control-tower.test.js: 'já lida é histórico, não Torre'). O terceiro painel
         só nasce lido se a janela do Chrome tiver foco no turn-end do fixture (app.js:
         uiUnread = ... || !document.hasFocus()). marcarConclusaoLida é o caminho do clique no
         painel e não faz nada quando ele já está lido: tira do check o foco da janela. */
      const third = await evaluate('__qa.panels[2]');
      await evaluate(`marcarConclusaoLida(__qa.panel(${JSON.stringify(third)}))`);
      assert.deepEqual(await evaluate(`(p=>({state:CockpitUI.stateOf(p),unread:!!p.uiUnread}))(__qa.panel(${JSON.stringify(third)}))`),{state:'done',unread:false});
      let rows = await tower();
      for(let attempt=0;attempt<40&&rows.some(row=>row.key===third);attempt++){await delay(100);rows=await tower();}
      assert.deepEqual(rows.map(row=>row.state), ['attention','working']);
      assert.ok(!rows.some(row=>row.key===third),'Concluída e lida fica fora da Torre');
    });
    await check('Barra inicia aberta com 224px', async () => assert.equal(await evaluate('document.querySelector(".ck-navigator").getBoundingClientRect().width'), 224));
    await check('Medidores de conta não sobrepõem números nem áreas de clique',async()=>{
      const boxes=await evaluate(`[...document.querySelectorAll('.ck-account-button:not([hidden]) button')].map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};})`);
      assert.equal(boxes.length,5);
      for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
        const a=boxes[i],b=boxes[j];
        assert.ok(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top,'Medidores se sobrepõem');
      }
    });
    await check('Arrastar lugar conserva o nó até soltar e mantém sessões',async()=>{
      await evaluate(`(() => {const head=document.querySelector('.ck-group-head');__qa.dragged=head;__qa.dragData=new DataTransfer();head.dispatchEvent(new DragEvent('dragstart',{dataTransfer:__qa.dragData}));__qa.dragMutations=0;__qa.dragObserver=new MutationObserver(records=>{__qa.dragMutations+=records.filter(r=>r.type==='childList').length;});__qa.dragObserver.observe(document.querySelector('.ck-place-trilha'),{childList:true});CockpitUI.refresh();})()`);
      await delay(350);
      assert.equal(await evaluate('__qa.dragMutations'),0);
      await evaluate(`__qa.dragObserver.disconnect();document.querySelectorAll('.ck-group-head')[1].dispatchEvent(new DragEvent('drop',{dataTransfer:__qa.dragData}));__qa.dragged.dispatchEvent(new DragEvent('dragend'))`);
      await delay(350);
      assert.equal(await evaluate('__qa.configuration.abas[1].id'),'qa-produto');
      assert.equal(await evaluate('__qa.snapshot().panels.length'),3);
      await evaluate(`moverAbaLocal('qa-produto',0)`);await delay(200);
    });
    await check('Recolher, espiar e sair sem deslocar a conversa', async () => {
      await click('.ck-toggle');
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 400 }); await delay(100);
      const before = await evaluate('({width:ckNavigator.getBoundingClientRect().width,x:document.querySelector(".pane").getBoundingClientRect().x})');
      assert.equal(before.width,56);
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 20, y: 250 });
      await delay(120); assert.equal(await evaluate('ckNavigator.classList.contains("ck-peek")'),false);
      await delay(300); assert.equal(await evaluate('ckNavigator.classList.contains("ck-peek")'),true);
      assert.equal(await evaluate('document.querySelector(".pane").getBoundingClientRect().x'),before.x);
      await client.screenshot('qa-sidebar-espiar.png');
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 400 }); await delay(250);
      assert.equal(await evaluate('ckNavigator.classList.contains("ck-peek")'),false);
      await client.screenshot('qa-sidebar-recolhida.png');
      await key('b','KeyB',2); assert.equal(await evaluate('ckNavigator.classList.contains("ck-collapsed")'),false);
    });
    await check('Busca preserva rascunho, seleção e não interrompe motores', async () => {
      const before = await engineCalls();
      await evaluate(`(() => { const p=__qa.panel(__qa.panels[0]);const n=p.el.querySelector('.p-input');n.value='Meu rascunho permanece aqui';n.focus();n.setSelectionRange(4,12);window.__qa.draftNode=n; })()`);
      await key('k','KeyK',2);
      assert.equal(await evaluate('!!document.querySelector(".ck-palette")'),true);
      assert.equal(await evaluate('document.activeElement.classList.contains("ck-search")'),true);
      await key('Escape','Escape');
      assert.deepEqual(await evaluate('({value:__qa.draftNode.value,selected:[__qa.draftNode.selectionStart,__qa.draftNode.selectionEnd],focused:document.activeElement===__qa.draftNode})'),{value:'Meu rascunho permanece aqui',selected:[4,12],focused:true});
      assert.equal(await engineCalls(),before);
    });
    await check('Tab fica contido na janela de busca', async () => {
      await key('k','KeyK',2);
      await evaluate(`(() => {const ns=[...document.querySelector('.ck-layer').querySelectorAll('button,input,textarea,select,[tabindex="0"]')].filter(n=>!n.disabled&&n.getClientRects().length);ns.at(-1).focus();})()`);
      await key('Tab','Tab');
      assert.equal(await evaluate('document.querySelector(".ck-layer").contains(document.activeElement)'),true);
      await key('Escape','Escape');
    });
    await check('Atalhos do menu nativo chegam à mesma navegação',async()=>{
      const before=await engineCalls();
      await evaluate(`__qa.emit('onMenu','buscarConversa')`);await delay(100);
      assert.equal(await evaluate('!!document.querySelector(".ck-palette")'),true);
      await evaluate(`__qa.emit('onMenu','novaConversa')`);
      assert.equal(await evaluate('__qa.snapshot().panels.length'),3);
      await key('Escape','Escape');
      await evaluate(`__qa.emit('onMenu','toggleSidebar')`);await delay(150);
      assert.equal(await evaluate('ckNavigator.classList.contains("ck-collapsed")'),true);
      await evaluate(`__qa.emit('onMenu','toggleSidebar')`);await delay(150);
      assert.equal(await evaluate('ckNavigator.classList.contains("ck-collapsed")'),false);
      assert.equal(await engineCalls(),before);
    });
    await check('Ctrl+Tab troca de pasta como o Alt+Tab',async()=>{
      /* O Ctrl entra como tecla propria (keyDown/keyUp): e' soltar o Ctrl que
         confirma a troca (soltarTrocaPasta, cockpit-ui.js). Modificadores do
         CDP: Ctrl=2, Shift=8. Trocar de pasta pode guardar e restaurar painel,
         mas nada pode ser ENVIADO a um motor (um \t no campo, uma aprovacao). */
      const envios=()=>evaluate(`__qa.calls.filter(c=>/^(paneSend|approve|perguntaResponder)$/.test(c.method)).length`);
      const before=await envios(),origem=await evaluate('cfg.abaAtiva');
      const ate=async expr=>{for(let n=0;n<60;n++){if(await evaluate(`(()=>{try{return !!(${expr});}catch{return false;}})()`))return;await delay(50);}throw new Error('Não chegou em: '+expr);};
      const tecla=(type,key,code,vk,modifiers)=>client.send('Input.dispatchKeyEvent',{type,key,code,modifiers,windowsVirtualKeyCode:vk});
      const ctrl=type=>tecla(type,'Control','ControlLeft',17,type==='keyDown'?2:0);
      const tab=async(modifiers=2)=>{await tecla('keyDown','Tab','Tab',9,modifiers);await tecla('keyUp','Tab','Tab',9,modifiers);};
      const lista=()=>evaluate(`[...document.querySelectorAll('.ck-troca-pasta [role=option]')].map(n=>n.getAttribute('aria-selected'))`);
      // segurando o Ctrl a lista aparece: a pasta atual primeiro, a seguinte ja' marcada
      await ctrl('keyDown');await tab();await delay(260);
      assert.deepEqual(await lista(),['false','true','false']);
      assert.equal(await evaluate(`document.querySelector('.ck-troca-pasta strong').textContent`),'Produto');
      await client.screenshot('qa-troca-pasta.png');
      // Shift+Tab volta na lista; Esc fecha sem trocar
      await tab(10);assert.deepEqual(await lista(),['true','false','false']);
      await tecla('keyDown','Escape','Escape',27,2);await tecla('keyUp','Escape','Escape',27,2);await ctrl('keyUp');await delay(120);
      assert.equal(await evaluate('!!document.querySelector(".ck-troca-pasta")'),false);
      assert.equal(await evaluate('cfg.abaAtiva'),origem);
      // toque rapido troca sem mostrar a lista; o segundo toque volta (ordem de uso)
      await ctrl('keyDown');await tab();await ctrl('keyUp');
      await ate(`cfg.abaAtiva==='qa-site' && !trocandoAba`);
      assert.equal(await evaluate('!!document.querySelector(".ck-troca-pasta")'),false);
      await ctrl('keyDown');await tab();await ctrl('keyUp');
      await ate(`cfg.abaAtiva===${JSON.stringify(origem)} && !trocandoAba`);
      // "Proxima pasta" do menu nativo passa pelo mesmo caminho
      await evaluate(`__qa.emit('onMenu','pastaProxima')`);await ate(`cfg.abaAtiva==='qa-site' && !trocandoAba`);
      await evaluate(`__qa.emit('onMenu','pastaProxima')`);await ate(`cfg.abaAtiva===${JSON.stringify(origem)} && !trocandoAba && panes.size===3`);
      assert.equal(await envios(),before);
    });
    await check('F6 abre pendência; Esc não nega nem aprova', async () => {
      const before=await engineCalls(); await key('F6','F6');
      assert.equal(await evaluate('!!document.querySelector(".ck-pending")'),true);
      await client.screenshot('qa-pendencia.png'); await key('Escape','Escape');
      assert.equal(await engineCalls(),before);
      assert.equal(await evaluate('__qa.panel(__qa.panels[0]).filaPerm.length'),1);
    });
    await check('Arquivos abre e devolve o mesmo nó e preserva a sessão', async () => {
      await evaluate(`window.__qa.originalView=document.querySelector('.side-view[data-view="explorer"]')`);
      await click('.ck-tools [aria-label="Arquivos"]');
      assert.equal(await evaluate('document.querySelector(".ck-layer").contains(__qa.originalView)'),true);
      await key('Escape','Escape');
      assert.equal(await evaluate(`document.querySelector('.side-view[data-view="explorer"]')===__qa.originalView`),true);
      assert.equal(await evaluate('__qa.panel(__qa.panels[0]).sessaoId'),'qa-session-0');
    });
    await check('Ajustes inclui atalhos e pode fechar sem alterar permissões', async () => {
      const before=await engineCalls(); await click('.ck-tools [aria-label="Ajustes"]');
      assert.match(await evaluate('document.querySelector(".ck-layer").textContent'),/Atalhos/);
      assert.equal(await evaluate('document.querySelectorAll(".ck-settings-tabs [role=tab]").length'),6);
      assert.equal(await evaluate('document.querySelectorAll(".ck-settings-sheet [role=tabpanel]:not([hidden])").length'),1);
      await client.screenshot('qa-ajustes.png');
      await click('.ck-settings-tabs [aria-label="Atalhos"]');
      assert.match(await evaluate('document.querySelector(".ck-settings-sheet [role=tabpanel]:not([hidden])").textContent'),/Ctrl K/);
      await key('Home','Home');
      assert.equal(await evaluate('document.activeElement.id'),'ck-settings-tab-0');
      await click('.ck-settings-sheet [data-tema="azul"]');
      assert.equal(await evaluate('__qa.configuration.tema'),'azul');
      await click('.ck-settings-sheet [data-tema="escuro"]');
      await key('Escape','Escape'); assert.equal(await engineCalls(),before);
    });
    await check('Editor SSH preserva a porta e recusa valores inválidos', async () => {
      await evaluate(`__qa.remoteEdit={id:'qa-port',nome:'Porta de teste',tipo:'ssh',host:'qa.invalid',usuario:'qa',porta:2222,chave:'C:/QA/id',caminhoRemoto:'~',paineis:[]};cfg.abas.push(__qa.remoteEdit);abrirModalAbaLocal(__qa.remoteEdit)`);
      assert.equal(await evaluate('document.querySelector("#abPorta").value'),'2222');
      await evaluate(`document.querySelector('#abPorta').value='65536';document.querySelector('#abOk').click()`);
      assert.equal(await evaluate('__qa.remoteEdit.porta'),2222);
      assert.equal(await evaluate('document.querySelector("#abPorta").validity.valid'),false);
      await evaluate(`document.querySelector('#abPorta').value='2200';document.querySelector('#abOk').click()`);
      assert.equal(await evaluate('__qa.remoteEdit.porta'),2200);
      assert.equal(await evaluate('remotoDoAba(__qa.remoteEdit).porta'),2200);
      await evaluate(`__qa.remoteEdit.paineis=[{id:'qa-saved',engine:'codex',sessaoId:'qa-remote-session'}];abrirModalAbaLocal(__qa.remoteEdit);document.querySelector('#abPorta').value='2222';document.querySelector('#abOk').click()`);
      assert.equal(await evaluate('__qa.remoteEdit.porta'),2200,'Painel salvo mantém seu destino');
      assert.match(await evaluate('document.querySelector("#abDestinoErro").textContent'),/Feche os painéis/);
      await evaluate(`document.querySelector('#abPorta').value='2200';document.querySelector('#abNome').value='Nome atualizado';document.querySelector('#abOk').click()`);
      assert.equal(await evaluate('__qa.remoteEdit.nome'),'Nome atualizado','Renomear continua permitido');
      await evaluate(`cfg.abas=cfg.abas.filter(a=>a.id!=='qa-port');pintarAbasLocal()`);
    });
    await check('Comparação mostra contas guardadas e cancela consulta ao fechar', async () => {
      await click('.ck-account-button button');
      assert.equal(await evaluate('document.querySelectorAll(".ck-account-card").length'),3);
      assert.match(await evaluate('document.querySelector(".ck-account").textContent'),/Projetos/);
      await client.screenshot('qa-comparacao-contas.png');
      await key('Escape','Escape');
      assert.ok(await evaluate('__qa.calls.some(c=>c.method==="contasCompararCancelar")'));
    });
    /* A busca tem debounce de 180 ms (palette no cockpit-ui.js): digitar as duas consultas de
       uma vez nem disparava a antiga. A corrida real: a antiga já está no ar quando a atual
       começa, a atual responde primeiro e a antiga chega depois. Quem descarta a antiga é o
       valid() (seq===searchSeq) dentro de search(). */
    await check('Busca descarta resposta antiga que chega depois da consulta atual', async () => {
      await evaluate(`__qa.searchPending={};__qa.override('buscarArquivos',options=>new Promise(resolve=>__qa.searchPending[options.termo]=resolve))`);
      await key('k','KeyK',2);
      const type = text => evaluate(`(() => {const n=document.querySelector('.ck-search');n.value=${JSON.stringify(text)};n.dispatchEvent(new Event('input'));})()`);
      const inFlight = async term => {
        const pending = `typeof __qa.searchPending[${JSON.stringify(term)}]==='function'`;
        await delay(300);
        for(let attempt=0;attempt<30&&!await evaluate(pending);attempt++)await delay(100);
        assert.equal(await evaluate(pending),true,`A busca por "${term}" não chegou a buscarArquivos`);
      };
      const shown = () => evaluate('document.querySelector(".ck-results").textContent');
      await type('/antigo'); await inFlight('antigo');
      await type('/atual'); await inFlight('atual');
      await evaluate(`__qa.searchPending.atual([{nome:'atual.js',path:'C:/QA/atual.js'}])`);
      for(let attempt=0;attempt<30&&!/atual\.js/.test(await shown());attempt++)await delay(100);
      await evaluate(`__qa.searchPending.antigo([{nome:'antigo.js',path:'C:/QA/antigo.js'}])`);
      await delay(300);
      assert.match(await shown(),/atual\.js/);
      assert.doesNotMatch(await shown(),/antigo\.js/);
      await key('Escape','Escape');
    });
    await check('Cancelar retomada não envia prompt quando vence o horário', async () => {
      const before=await engineCalls();
      await evaluate(`(() => {const p=__qa.panel(__qa.panels[2]);p.el.querySelector('.p-input').value='';CockpitUI.offerResume(p,{ms:Date.now()+1400});p.el.querySelector('.ck-resume button').click();})()`);
      await delay(150);
      assert.match(await evaluate('document.querySelector(".ck-resume").textContent'),/agendada/);
      await evaluate('CockpitUI.cancelResume(__qa.panel(__qa.panels[2]))');
      await delay(1500); assert.equal(await engineCalls(),before);
    });
    await check('Rascunho novo bloqueia retomada e permanece no campo', async () => {
      const before=await engineCalls();
      await evaluate(`(() => {const p=__qa.panel(__qa.panels[2]);CockpitUI.offerResume(p,{ms:Date.now()+1400});p.el.querySelector('.ck-resume button').click();})()`);
      await delay(150);
      await evaluate(`__qa.panel(__qa.panels[2]).el.querySelector('.p-input').value='Não enviar este rascunho'`);
      await delay(1500); assert.equal(await engineCalls(),before);
      assert.equal(await evaluate(`__qa.panel(__qa.panels[2]).el.querySelector('.p-input').value`),'Não enviar este rascunho');
      await evaluate(`CockpitUI.cancelResume(__qa.panel(__qa.panels[2]));__qa.panel(__qa.panels[2]).el.querySelector('.p-input').value=''`);
    });
    for(const theme of ['escuro','azul','claro','jornal']) await check('Tema '+theme+' em 1440px',async()=>{
      await closeLayers(); await evaluate(`__qa.setTheme(${JSON.stringify(theme)})`); await delay(200);
      assert.equal(await evaluate('document.documentElement.dataset.tema'),theme);
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
      await client.screenshot('qa-'+theme+'-1440.png');
    });
    for(const width of [1024,800,600]) await check('Janela desktop '+width+'px',async()=>{
      await client.send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});await delay(250);
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
      assert.equal(await evaluate('document.querySelector(".ck-navigator").getBoundingClientRect().bottom<=innerHeight'),true);
      const layout=await evaluate("(() => {\n const area=document.querySelector('#panes'),rects=[...document.querySelectorAll('.pane')].filter(n=>n.getClientRects().length).map(n=>{const r=n.getBoundingClientRect();const c=n.closest('.coluna').getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,insideColumn:r.left>=c.left-1&&r.right<=c.right+1};});\n const overlaps=rects.some((a,i)=>rects.slice(i+1).some(b=>a.right>b.left+1&&b.right>a.left+1&&a.bottom>b.top+1&&b.bottom>a.top+1));\n return{factor:devicePixelRatio,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,visiblePanes:rects.length,overlaps,contained:rects.every(r=>r.insideColumn),scrollable:area.scrollWidth>area.clientWidth,scrollWidth:area.scrollWidth,clientWidth:area.clientWidth,overflowX:getComputedStyle(area).overflowX};\n})()");
      assert.equal(layout.visiblePanes,3,'Todas as sessões devem permanecer disponíveis');
      assert.equal(layout.overlaps,false,'Painéis não podem se sobrepor');
      assert.equal(layout.contained,true,'Painel deve caber dentro da própria coluna');
      assert.equal(layout.scrollable,true,'Janela curta deve oferecer rolagem horizontal');
      assert.ok(['auto','scroll'].includes(layout.overflowX),'Rolagem horizontal não pode ficar bloqueada');
      for(const id of await evaluate('__qa.panels')) {
        await evaluate('irAoPainel(__qa.panel('+JSON.stringify(id)+'))');await delay(450);
        const accessible=await evaluate('(() => {const r=__qa.panel('+JSON.stringify(id)+').el.querySelector(".p-send").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})()');
        assert.equal(accessible,true,'Cada sessão deve ficar totalmente acessível ao selecioná-la');
      }
      await evaluate('irAoPainel(__qa.panel(__qa.panels[0]))');await delay(450);
      const send=await evaluate(`(() => {const n=__qa.panel(__qa.panels[0]).el.querySelector('.p-send');const r=n.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,visible:n.getClientRects().length>0};})()`);
      assert.ok(send.visible&&send.left>=0&&send.right<=width&&send.bottom<=800,'Enviar precisa estar inteiro na janela');
      await client.screenshot('qa-janela-'+width+'.png');
      await click('.ck-tools [aria-label="Ajustes"]');
      assert.equal(await evaluate('document.querySelector(".ck-settings-sheet").scrollWidth<=document.querySelector(".ck-settings-sheet").clientWidth'),true);
      await client.screenshot('qa-ajustes-'+width+'.png');await key('Escape','Escape');
    });
    await check('Sem erros de JavaScript ou API simulada ausente',async()=>{
      assert.deepEqual(await evaluate('__qa.errors'),[]);
      assert.deepEqual(await evaluate('[...__qa.missing]'),[]);
      const latest=await verifyServer();
      assert.equal(latest.sourceHash,client.sourceIdentity.sourceHash,'Fonte mudou durante a verificação');
      assert.equal(await evaluate('__qaIdentity.sourceHash'),client.sourceIdentity.sourceHash,'Página usa outra revisão');
    });
  } finally {
    await closeLayers().catch(()=>{});
    await client.send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false}).catch(()=>{});
    await evaluate(`__qa.setTheme('escuro')`).catch(()=>{});
    fs.writeFileSync(path.join(ARTIFACTS,'ui-verification.json'),JSON.stringify({createdAt:new Date().toISOString(),sourceIdentity:client.sourceIdentity,results},null,2)+'\n');
    client.close();
  }
  if(results.some(result=>!result.ok))process.exitCode=1;
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
