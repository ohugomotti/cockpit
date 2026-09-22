"use strict";
// Interações do renderer real com API inteiramente simulada; nenhum comando sai do QA.
const assert = require("node:assert/strict");
module.exports = async function verifyFunctional(webContents) {
  const evaluate = source => webContents.executeJavaScript(source);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const results = [];
  const capture = async name => {
    webContents.invalidate();
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await delay(180);
    await require('node:fs/promises').writeFile(require('node:path').resolve(__dirname,'../../artifacts/',name),(await webContents.capturePage()).toPNG());
  };
  const check = async (name, action) => {
    try { await action(); results.push({name, passed:true}); }
    catch (error) { results.push({name, passed:false, error:error.message}); }
  };
  const settle = async source => {
    for(let n=0;n<100;n++) { if(await evaluate(source)) return; await delay(100); }
    throw Error("A interface não concluiu: "+source);
  };
  const close = async () => {await evaluate("while(CockpitUI.layers.length)CockpitUI.closeLayer();fecharVisor();fecharModalGlobal();fecharPopGlobal();");};
  await close();
  await check("Contas: dez combinações de motor e destino exibem somente ações suportadas", async () => {
    for(const engine of ['claude','codex','gemini','grok','acp'])for(const remote of [false,true]){
      await evaluate("CockpitUI.accountLayer("+JSON.stringify(engine)+",cfg.abas.find(a=>a.tipo==="+JSON.stringify(remote?'ssh':'local')+"))");
      await settle("!!document.querySelector('.ck-account') && !document.querySelector('.ck-account').textContent.includes('Consultando contas…')");
      const buttons=await evaluate("[...document.querySelectorAll('.ck-account button')].map(n=>n.textContent)");
      const managed=engine==='claude'||(engine==='codex'&&!remote);
      assert.equal(buttons.includes('Gerenciar contas'),managed,engine+' / '+remote);
      assert.equal(buttons.filter(n=>n==='Usar esta conta').length,managed?1:0);
      assert.equal(buttons.filter(n=>n==='Entrar novamente').length,managed?1:0);
      const text=await evaluate("document.querySelector('.ck-account').textContent");
      assert.ok(text.includes(remote?'Servidor · demo@servidor.example.invalid':'Neste PC'));
      await close();
    }
  });
  await check("Contas: clique Gerenciar abre o menu real e dispensa sem iniciar autenticação", async () => {
    const before=await evaluate("__qa.calls.filter(c=>['auth','contasTrocar','paneStop','codexReiniciar'].includes(c.method)).length");
    await evaluate("CockpitUI.accountLayer('codex',cfg.abas.find(a=>a.tipo==='local'))");
    await evaluate("[...document.querySelectorAll('.ck-account button')].find(n=>n.textContent==='Gerenciar contas').click();void 0");
    await settle("!document.querySelector('#popGrupo').classList.contains('hidden') && document.querySelector('#popGrupo').textContent.includes('Projetos')");
    assert.equal(await evaluate("document.querySelectorAll('.ck-account').length"),0);
    await close();
    assert.equal(await evaluate("__qa.calls.filter(c=>['auth','contasTrocar','paneStop','codexReiniciar'].includes(c.method)).length"),before);
  });
  await check("Automações recebe e mostra lista na camada", async () => {
    await evaluate("CockpitUI.toolLayer('automations');void 0");
    await settle("rotinasVisivel() && !!document.querySelector('#rotinas').textContent.trim() && !document.querySelector('#btnRotinasAtualizar').classList.contains('lendo')");
    assert.equal(await evaluate("document.querySelector('.ck-layer').contains(document.querySelector('#rotinas'))"),true);
    await close();
  });
  await check("Arquivos carrega árvore e exibe visor acima da conversa", async () => {
    await evaluate("CockpitUI.toolLayer('files');void 0");
    await settle("arvoreNaTela() && document.querySelector('#tree').textContent.includes('README.md')");
    await evaluate("verArquivo(focusPane,'C:/Projetos/Demonstracao/README.md',null)");
    assert.equal(await evaluate("CockpitUI.layers.length"),0);
    assert.equal(await evaluate("!!focusPane.el.querySelector('.p-visor:not(.hidden)')"),true);
    await close();
  });
  await check("Fallback Claude volta ao menu e preserva sessão ao alternar", async () => {
    await evaluate("irAoPainel(__qa.panel(__qa.panels[0]));CockpitUI.agentLayer(focusPane,'model')");
    await settle("!!document.querySelector('.ck-fallback')");
    const before=await evaluate("({fallback:!!cfg.fallbackClaude,session:focusPane.sessaoId||focusPane.resumeId})");
    await evaluate("document.querySelector('.ck-fallback').click()");
    await settle("!document.querySelector('.ck-fallback').disabled");
    assert.equal(await evaluate("!!cfg.fallbackClaude"),!before.fallback);
    assert.equal(await evaluate("focusPane.sessaoId||focusPane.resumeId"),before.session);
    await evaluate("document.querySelector('.ck-fallback').click()");
    await settle("!document.querySelector('.ck-fallback').disabled");
    assert.equal(await evaluate("!!cfg.fallbackClaude"),before.fallback);
    await close();
  });
  await check("Arrastar título empilha e separa de novo sem recriar sessões", async () => {
    const before=await evaluate("__qa.snapshot().panels.map(p=>p.id).sort()");
    await evaluate("(() => {const p=__qa.panel(__qa.panels[0]);__qa.dragData=new DataTransfer();p.el.querySelector('.ck-pane-title').dispatchEvent(new DragEvent('dragstart',{dataTransfer:__qa.dragData}));__qa.panel(__qa.panels[1]).el.closest('.coluna').dispatchEvent(new DragEvent('drop',{dataTransfer:__qa.dragData}));p.el.querySelector('.ck-pane-title').dispatchEvent(new DragEvent('dragend'));})()");
    assert.equal(await evaluate("__qa.panel(__qa.panels[0]).coluna===__qa.panel(__qa.panels[1]).coluna"),true);
    await evaluate("(() => {const p=__qa.panel(__qa.panels[0]);p.el.querySelector('.ck-pane-title').dispatchEvent(new DragEvent('dragstart',{dataTransfer:new DataTransfer()}));[...document.querySelectorAll('.faixa-nova')].at(-1).dispatchEvent(new DragEvent('drop',{dataTransfer:new DataTransfer()}));p.el.querySelector('.ck-pane-title').dispatchEvent(new DragEvent('dragend'));})()");
    assert.equal(await evaluate("__qa.panel(__qa.panels[0]).coluna!==__qa.panel(__qa.panels[1]).coluna"),true);
    assert.deepEqual(await evaluate("__qa.snapshot().panels.map(p=>p.id).sort()"),before);
    await close();
  });
  await check("Escape fora da tela preta fecha terminal e libera processo simulado", async () => {
    await evaluate("irAoPainel(__qa.panel(__qa.panels[2]));CockpitUI.toolLayer('terminal')");
    await settle("!!focusPane._fecharTerm");
    const before=await evaluate("__qa.calls.filter(c=>c.method==='termKill').length");
    await evaluate("focusPane.el.querySelector('#tmFecha').focus()");
    webContents.sendInputEvent({type:"keyDown",keyCode:"Escape"});
    webContents.sendInputEvent({type:"keyUp",keyCode:"Escape"});
    await settle("!focusPane._fecharTerm");
    assert.equal(await evaluate("__qa.calls.filter(c=>c.method==='termKill').length"),before+1);
    assert.equal(await evaluate("focusPane.el.querySelector('.p-modal').classList.contains('hidden')"),true);
    await close();
  });
  await check("Edição de lugar fica acessível por contexto do Navigator", async () => {
    await evaluate("document.querySelector('.ck-group-head').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))");
    await settle("!!document.querySelector('.ck-layer')");
    assert.match(await evaluate("document.querySelector('.ck-layer').textContent"),/Editar lugar/);
    await evaluate("[...document.querySelectorAll('.ck-layer-body button')].find(b=>b.textContent==='Editar lugar').click()");
    assert.equal(await evaluate("document.querySelector('#modalGrupo').classList.contains('hidden')"),false);
    assert.equal(await evaluate("!!document.querySelector('#abNome')"),true);
    await close();
  });
  await check("Novo lugar cria várias pastas a partir da busca sem duplicar recentes",async()=>{
    const before=await evaluate("cfg.abas.length");
    await evaluate("abrirModalAbaLocal(null,{caminho:'C:/QA/Primeira'})");
    assert.equal(await evaluate("cfg.abas.length"),before);
    assert.equal(await evaluate("document.querySelector('.ck-place-dialog').getBoundingClientRect().width"),460);
    assert.equal(await evaluate("document.querySelectorAll('.ck-place-dialog .tipo-bt').length"),2);
    assert.equal(await evaluate("document.querySelector('#abNome').value"),"Primeira");
    await evaluate("__qa.override('pickFolder',async()=> 'C:/QA/Segunda');document.querySelector('#abEscolherPasta').click()");
    await settle("document.querySelectorAll('#abPastasLista .pasta-linha').length===2");
    await capture("electron-new-place.png");
    await evaluate("document.querySelector('#abOk').click()");
    assert.equal(await evaluate("cfg.abas.length"),before+1);
    assert.deepEqual(await evaluate("cfg.abas.at(-1).caminhos"),["C:/QA/Primeira","C:/QA/Segunda"]);
    await close();
  });
  await check("Novo lugar SSH preserva porta, IPv6 e chave e valida erro sem alert",async()=>{
    const before=await evaluate("cfg.abas.length");
    await evaluate("abrirModalAbaLocal(null,{caminho:'/srv/projeto com espaços',remoto:{host:'2001:db8::1',usuario:'qa',porta:2200,chave:'C:/QA/id'}})");
    assert.equal(await evaluate("document.querySelector('#abEndereco').value"),"qa@[2001:db8::1]:/srv/projeto com espaços");
    assert.equal(await evaluate("document.querySelector('#abPorta').value"),"2200");
    await evaluate("document.querySelector('#abNome').value='SSH de QA';document.querySelector('#abPorta').value='65536';document.querySelector('#abOk').click()");
    assert.equal(await evaluate("cfg.abas.length"),before);
    assert.equal(await evaluate("document.querySelector('#abPorta').validity.valid"),false);
    await evaluate("document.querySelector('#abPorta').value='2200';document.querySelector('#abPorta').setCustomValidity('');document.querySelector('#abPorta').dispatchEvent(new Event('input',{bubbles:true}))");
    await settle("document.querySelector('.ck-place-probe').dataset.state==='available'");
    const probe=await evaluate("__qa.calls.filter(c=>c.method==='motoresDisponiveis').at(-1).args[0]");
    assert.equal(probe.porta,2200);assert.equal(probe.host,"2001:db8::1");assert.equal(probe.chave,"C:/QA/id");
    await capture("electron-new-place-ssh.png");
    await evaluate("document.querySelector('#abOk').click()");
    assert.equal(await evaluate("cfg.abas.length"),before+1);
    assert.equal(await evaluate("cfg.abas.at(-1).porta"),2200);
    await close();
  });
  await check("Automações agrupa estados reais, mantém fabricante recolhido e só executa após confirmar",async()=>{
    const before=await evaluate("__qa.calls.filter(c=>c.method==='rotinasDisparar').length");
    await evaluate("__qa.override('rotinasListar',async()=>({itens:[{nome:'QA falhou',estado:'pronta',falhou:true,resultado:1,ultima:new Date(Date.now()-3600000).toISOString(),dele:true},{nome:'QA em dia',estado:'pronta',falhou:false,resultado:0,ultima:new Date().toISOString(),dele:true},{nome:'QA desconhecida',estado:'pronta',falhou:false,resultado:123,ultima:new Date().toISOString(),dele:true},{nome:'QA desligada',estado:'desativada',falhou:true,resultado:1,dele:true},{nome:'QA fabricante',estado:'pronta',falhou:true,resultado:1,dele:false}]}));CockpitUI.toolLayer('automations');void 0");
    await settle("document.querySelector('.ck-auto-attention')?.dataset.attention==='1' && !!document.querySelector('.ck-run-automation')");
    assert.equal(await evaluate("document.querySelector('.ck-automations-sheet').getBoundingClientRect().width"),420);
    assert.match(await evaluate("document.querySelector('#rotinas').textContent"),/Parou/);
    assert.match(await evaluate("document.querySelector('#rotinas').textContent"),/Em dia/);
    assert.equal(await evaluate("document.querySelector('#rotinas').textContent.includes('QA fabricante')"),false);
    assert.equal(await evaluate("document.querySelectorAll('.ck-automation-session').length"),1);
    assert.equal(await evaluate("__qa.calls.filter(c=>c.method==='rotinasDisparar').length"),before);
    await capture("electron-automations.png");
    await evaluate("document.querySelector('.ck-run-automation').click()");
    await settle("!!document.querySelector('[data-conf=nao]')");
    assert.equal(await evaluate("__qa.calls.filter(c=>c.method==='rotinasDisparar').length"),before);
    await evaluate("document.querySelector('[data-conf=nao]').click()");
    await delay(100);
    assert.equal(await evaluate("__qa.calls.filter(c=>c.method==='rotinasDisparar').length"),before);
    await close();
    await evaluate("__qa.override('rotinasListar',async()=>({itens:[]}));pintarRotinas(true)");
    await delay(100);
  });
  await check("Terceira sessão guardada é a escolhida após restauração real dos painéis", async () => {
    await evaluate("cfg.abas.push({id:'qa-three-saved',nome:'Três guardadas',tipo:'local',caminhos:['C:/QA'],paineis:[0,1,2].map(i=>({paneId:'qa-old-'+i,engine:'codex',titulo:'Rascunho igual',cwd:'C:/QA',rascunho:'Rascunho '+i,uiEstado:'done'}))});CockpitUI.refresh()");
    // desde 21/09/2026 a chave da linha e' a CONVERSA (o paneId), nao mais
    // "saved:<pasta>:<painel>": ficha e painel restaurado tem que cair na mesma
    // linha, senao a Torre apaga e remonta a linha ao abrir a pasta
    await settle("!!document.querySelector('.ck-session[data-key=\"qa-old-2\"]')");
    await evaluate("(() => {const item=document.querySelector('.ck-session[data-key=\"qa-old-2\"]');const d=item.closest('details');if(d)d.open=true;item.click();})()");
    await settle("!trocandoAba && cfg.abaAtiva==='qa-three-saved' && focusPane.uiRestoredPaneId==='qa-old-2'");
    assert.equal(await evaluate("panes.size"),3);
    assert.equal(await evaluate("focusPane.el.querySelector('.p-input').value"),"Rascunho 2");
    assert.deepEqual(await evaluate("[...panes.values()].map(p=>p.uiRestoredPaneId).sort()"),["qa-old-0","qa-old-1","qa-old-2"]);
    await close();
  });
  await check("Sem exceções e sem métodos ausentes após interações funcionais",async()=>{
    assert.deepEqual(await evaluate("__qa.errors"),[]);
    assert.deepEqual(await evaluate("[...__qa.missing]"),[]);
  });
  return results;
};
