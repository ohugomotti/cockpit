"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const UI = require("../src/renderer/cockpit-ui");
const ui = fs.readFileSync(path.join(__dirname, "../src/renderer/cockpit-ui.js"), "utf8").replace(/\r\n/g, "\n");
const app = fs.readFileSync(path.join(__dirname, "../src/renderer/app.js"), "utf8").replace(/\r\n/g, "\n");
function piece(source, name, indent = "") {
  const start = source.search(new RegExp("(?:async )?function " + name + "\\("));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n" + indent + "}", start) + indent.length + 2);
}
function extractUi(name) { return piece(ui, name, "  "); }
function runApp(name, context) { vm.runInNewContext(piece(app, name) + "\nthis.fn=" + name, context); return context.fn; }

test("ficha guardada identifica rascunhos iguais e ramos sem trocar motor nem lugar", () => {
  const original = { id:"original-new",uiRestoredPaneId:"original",engine:"claude",abaId:"a",resumeId:"shared" };
  const branch = { id:"branch-new",uiRestoredPaneId:"branch",engine:"claude",abaId:"a",resumeId:"shared",forkPendente:true };
  const drafts = [0,1].map(i=>({id:"new-draft-"+i,uiRestoredPaneId:"draft-"+i,engine:"codex",abaId:"a",titulo:"Igual"}));
  const foreign = {...branch,id:"foreign",abaId:"b"};
  const candidates = [foreign,original,branch,...drafts];
  assert.equal(UI.paneFromSaved(candidates,{paneId:"branch",engine:"claude",sessaoId:"shared",fork:true},"a"),branch);
  assert.equal(UI.paneFromSaved(candidates,{paneId:"draft-1",engine:"codex"},"a"),drafts[1]);
  assert.equal(UI.paneFromSaved(candidates,{engine:"claude",sessaoId:"shared"},"a"),original);
  assert.equal(UI.paneFromSaved(candidates,{paneId:"branch",engine:"grok",sessaoId:"shared"},"a"),null);
  assert.equal(UI.paneFromSaved(candidates,{engine:"codex",sessaoId:"absent"},"a"),null);
});
test("clique na terceira guardada foca a terceira após restaurar com IDs novos", async () => {
  const saved=Array.from({length:3},(_,i)=>({paneId:"old-"+i,engine:"codex",titulo:"Rascunho igual"}));
  const restored=saved.map((s,i)=>({id:"new-"+i,uiRestoredPaneId:s.paneId,engine:s.engine,abaId:"a"}));
  let focused;
  const ctx={activationSeq:0,trocandoAba:false,cfg:{abaAtiva:"b"},panes:new Map(),
    paneFromSaved:UI.paneFromSaved,peek(){},refresh(){},irAoPainel:p=>{focused=p},setTimeout,
    trocarAbaLocal:async id=>{ctx.cfg.abaAtiva=id;ctx.panes=new Map(restored.map(p=>[p.id,p]));focused=restored[0];}
  };
  vm.runInNewContext(extractUi("activate")+"\nthis.activate=activate;",ctx);
  await ctx.activate({aba:{id:"a"},f:saved[2]});
  assert.equal(focused,restored[2]);
});
test("clique guardado aguarda a troca enfileirada e uma seleção nova cancela a anterior", async () => {
  const a={id:"new-a",uiRestoredPaneId:"old-a",engine:"claude",abaId:"a"};
  const b={id:"new-b",uiRestoredPaneId:"old-b",engine:"claude",abaId:"b"};
  const focused=[];
  const ctx={activationSeq:0,trocandoAba:true,cfg:{abaAtiva:"c"},panes:new Map(),paneFromSaved:UI.paneFromSaved,
    peek(){},refresh(){},irAoPainel:p=>focused.push(p.id),setTimeout, trocarAbaLocal:async()=>{}};
  vm.runInNewContext(extractUi("activate")+"\nthis.activate=activate;",ctx);
  const first=ctx.activate({aba:{id:"a"},f:{paneId:"old-a",engine:"claude"}});
  const second=ctx.activate({aba:{id:"b"},f:{paneId:"old-b",engine:"claude"}});
  ctx.cfg.abaAtiva="b";ctx.panes=new Map([[b.id,b],[a.id,a]]);ctx.trocandoAba=false;
  await Promise.all([first,second]);
  assert.deepEqual(focused,["new-b"]);
});
test("três views reconhecem camada visível mas não conteúdo oculto ou desconectado", () => {
  const state={connected:true,hidden:false,rect:true,layer:true,overlay:true,legacyHidden:true};
  const sidebar={contains:()=>!state.layer,classList:{contains:()=>state.legacyHidden}};
  const layer={closest:()=>state.overlay?{}:null};
  const view={get isConnected(){return state.connected},closest:s=>s===".hidden,[hidden]"?(state.hidden?{}:null):(state.layer?layer:null),getClientRects:()=>state.rect?[{}]:[]};
  const ctx={$:selector=>selector==="#sidebar"?sidebar:view};
  vm.runInNewContext(["viewLateralVisivel","arvoreNaTela","torreVisivel","rotinasVisivel"].map(n=>piece(app,n)).join("\n")+"\nthis.check=()=>[arvoreNaTela(),torreVisivel(),rotinasVisivel()]",ctx);
  assert.deepEqual(Array.from(ctx.check()),[true,true,true]);
  for(const [key,value] of [["hidden",true],["connected",false],["rect",false],["overlay",false]]) {
    const old=state[key];state[key]=value;assert.ok(ctx.check().every(v=>!v),key);state[key]=old;
  }
  state.layer=false;state.legacyHidden=false;assert.ok(ctx.check().every(Boolean));
  state.legacyHidden=true;assert.ok(ctx.check().every(v=>!v));
});
/* Eram sete acoes ate' 21/09/2026, quando o rodape encolheu para quatro botoes
   (Arquivos, Mudancas, Ferramentas, Ajustes) a pedido do Hugo. Este menu passou
   a guardar exatamente as tres que perderam botao proprio. As outras nao
   sumiram, mudaram de lugar: Quadro virou botao na barra de escrever (.p-fluxo),
   Novo lugar virou o "+" da faixa de pastas e Conversas guardadas deu lugar ao
   HISTORICO da lateral. O que este teste protege segue igual ao original: a
   camada fecha ANTES de a acao rodar (senao a acao abre sua propria camada e a
   antiga fica por cima). */
test("menu Ferramentas guarda as três que saíram do rodapé e fecha a camada antes de executá-las", () => {
  const actions=[],nodes=[];
  const layer={body:{append:n=>nodes.push(n)}};
  const ctx={openLayer:()=>layer,closeLayer:l=>actions.push("close"),toolLayer:k=>actions.push(k),
    abrirModalAbaLocal:()=>actions.push("place"),historyLayer:()=>actions.push("history"),
    node:(tag,cls,text)=>({text}),button:(icon,label,click)=>({label,click,append(){}})};
  vm.runInNewContext(extractUi("toolsMenu")+"\nthis.menu=toolsMenu;",ctx);
  ctx.menu();
  assert.deepEqual(nodes.map(n=>n.label),["Automações","Terminal","Conectores"]);
  for(const n of nodes)n.click();
  assert.deepEqual(actions,["close","automations","close","terminal","close","health"]);
});
test("lugar mantém edição, ordem e remoção usando ações existentes", () => {
  const calls=[],nodes=[],aba={id:"a",nome:"A"};
  const ctx={openLayer:()=>({body:{append:n=>nodes.push(n)}}),closeLayer:()=>calls.push("close"),
    abasLocais:()=>[aba,{id:"b"}],abrirModalAbaLocal:a=>calls.push(["edit",a.id]),
    moverAbaUmaCasa:(id,step)=>calls.push(["move",id,step]),apagarAbaLocal:a=>calls.push(["remove",a.id]),
    labelled:(label,click)=>({label,click})};
  vm.runInNewContext(extractUi("placeActions")+"\nthis.open=placeActions;",ctx);ctx.open(aba);
  assert.equal(nodes[1].disabled,true);assert.equal(nodes[2].disabled,false);
  nodes[0].click();nodes[2].click();nodes[3].click();
  assert.deepEqual(calls,["close",["edit","a"],"close",["move","a",1],"close",["remove","a"]]);
});
test("fallback Claude persiste opção e preserva conversa para próxima ligação", async () => {
  const calls=[],p={id:"p",engine:"claude",sessaoId:"same-session",started:true};
  const ctx={cfg:{fallbackClaude:false},window:{api:{setConfig:c=>calls.push(["config",c.fallbackClaude]),paneStop:async x=>calls.push(["stop",x.paneId,x.engine])}},
    antesDaTroca:()=>({}),avisarTroca:()=>{},guardarConversaPraVoltar:p=>{p.resumeId=p.sessaoId},
    destravarPainel:()=>{},setDot:()=>{},savePanes:()=>calls.push(["save"]),note:()=>{}};
  const toggle=runApp("alternarFallbackClaude",ctx);
  await toggle(p);assert.equal(ctx.cfg.fallbackClaude,true);assert.equal(p.resumeId,"same-session");assert.equal(p.started,false);
  await toggle(p);assert.equal(ctx.cfg.fallbackClaude,false);
  assert.deepEqual(calls.filter(x=>x[0]==="stop"),[["stop","p","claude"],["stop","p","claude"]]);
  const count=calls.length;await toggle({...p,engine:"codex"});assert.equal(calls.length,count);
});
test("alça do título novo transmite identidade de arrasto e remove estado ao terminar", () => {
  const handlers={},classes=new Set(),handle={dataset:{},setAttribute(){},addEventListener:(type,fn)=>{(handlers[type]||=[]).push(fn)}};
  const p={id:"drag-me",el:{classList:{add:c=>classes.add(c),remove:c=>classes.delete(c)}}};
  const ctx={arrastando:null,$:()=>handle,document:{querySelectorAll:()=>[]}};
  const bind=runApp("ligarArrastarPainel",ctx);bind(p,handle);bind(p,handle);
  assert.equal(handlers.dragstart.length,1);
  const data={};handlers.dragstart[0]({dataTransfer:{setData:(k,v)=>data[k]=v}});
  assert.equal(ctx.arrastando,p.id);assert.equal(data["text/plain"],p.id);assert.ok(classes.has("arrastando"));
  handlers.dragend[0]();assert.equal(ctx.arrastando,null);assert.equal(classes.size,0);
});
function sessionContext(panels, destination={host:"host-b",usuario:"qa",porta:2222}) {
  const calls=[],aba={id:"current",tipo:destination?"ssh":"local",remote:destination};
  const key=r=>r?[r.usuario,r.host,r.porta||22].join("@"):"pc";
  const ctx={calls,cfg:{abaAtiva:aba.id},window:{CockpitUI:{closeToolView:v=>calls.push(["close",v])}},
    abaAtual:()=>aba,remotoDoAba:a=>a.remote,remotoDoPane:p=>p.remote,chaveDoLugar:key,
    panes:new Map(panels.map(p=>[p.id,p])),panesFundo:new Map(),document:{querySelectorAll:()=>[]},
    mostrarAviso:x=>calls.push(["notice",x.texto]),capacidadeRemota:async()=>true,
    cabeMaisPainel:()=>true,newPane:()=>{throw Error("NEW_CORRECT_DESTINATION")},
    setFocus:p=>calls.push(["focus",p.id]),piscar(){},$:()=>({focus(){}})};
  vm.runInNewContext(piece(app,"painelDaConversa")+"\n"+piece(app,"openSession")+"\nthis.open=openSession;",ctx);
  return ctx;
}
test("abertura não captura sessão homônima de outro motor, servidor ou porta", async () => {
  const request={id:"shared",engine:"claude",remoto:true};
  for(const mismatch of [{engine:"codex"},{remote:{host:"host-a",usuario:"qa",porta:2222}},{remote:{host:"host-b",usuario:"qa",porta:22}}]) {
    const p={id:"wrong",engine:"claude",sessaoId:"shared",remote:{host:"host-b",usuario:"qa",porta:2222},...mismatch};
    const ctx=sessionContext([p]);
    await assert.rejects(ctx.open(request),/NEW_CORRECT_DESTINATION/);
    assert.ok(!ctx.calls.some(x=>x[0]==="focus"));
  }
  const correct={id:"right",engine:"claude",resumeId:"shared",remote:{host:"host-b",usuario:"qa",porta:2222}};
  const ctx=sessionContext([correct]);await ctx.open(request);
  assert.deepEqual(ctx.calls,[["close","hclaude"],["focus","right"]]);
});
test("histórico de destino antigo é recusado antes de criar ou focar sessão", async () => {
  const ctx=sessionContext([]);
  await ctx.open({id:"shared",engine:"claude",remoto:true,remotoDestino:{host:"host-a",usuario:"qa",porta:2222}});
  assert.equal(ctx.calls.at(-1)[0],"notice");
  assert.match(ctx.calls.at(-1)[1],/outro lugar/);
});
test("Escape do redesign fecha terminal em foco pelo handler que libera o PTY", () => {
  const events={},hidden={classList:{contains:()=>true}},modal={classList:{contains:()=>false}},visor=hidden;
  const p={id:"p",engine:"claude",busy:true,_fecharTerm:true,el:{querySelector:s=>s.includes(":not")?modal:s===".p-modal"?modal:visor}};
  let stopped=0,closed=0,interrupted=0;
  const ctx={cfg:{},panes:new Map([["p",p]]),panesFundo:new Map(),focusPane:p,quadro:null,
    document:{addEventListener:(kind,fn)=>events[kind]=fn,querySelector:()=>hidden},
    window:{addEventListener(){}},dialogoAberto:()=>false,
    $:(s,parent)=>parent?parent.querySelector(s):hidden,
    fecharMenus(){},fecharVisor(){},fecharPopGlobal(){},fecharModalGlobal(){},
    fecharTerminalDoPainel:q=>{stopped++;q._fecharTerm=null},fecharModal:()=>closed++,
    interromperPainel:()=>interrupted++};
  vm.runInNewContext(piece(app,"tratarEsc")+"\n"+ui,ctx);
  const e={key:"Escape",target:{closest:()=>null},preventDefault(){},stopImmediatePropagation(){}};
  events.keydown(e);
  assert.equal(stopped,1);assert.equal(closed,1);assert.equal(interrupted,0);
});

test("endereço compacto preserva IPv6, alias SSH e pasta com espaços sem interpretar porta", () => {
  assert.deepEqual(UI.parseSshAddress("qa@[2001:db8::1]:/srv/projeto com espaços"),{usuario:"qa",host:"2001:db8::1",caminhoRemoto:"/srv/projeto com espaços"});
  assert.deepEqual(UI.parseSshAddress("deploy@meu-alias"),{usuario:"deploy",host:"meu-alias",caminhoRemoto:"~"});
  assert.deepEqual(UI.parseSshAddress("qa@host:2222"),{usuario:"qa",host:"host",caminhoRemoto:"2222"});
  assert.equal(UI.formatSshAddress({usuario:"qa",host:"2001:db8::1",porta:2200,caminhoRemoto:"/srv/a b"}),"qa@[2001:db8::1]:/srv/a b");
  for(const value of ["","host","qa@","qa@::1","qa@host\nmalicioso"])assert.ok(UI.parseSshAddress(value).error,value);
});
test("resumo de automações inclui só falhas reais ligadas e sinaliza cache antigo", () => {
  const items=[{nome:"minha",falhou:true,estado:"pronta"},{nome:"executando",falhou:true,estado:"rodando"},{nome:"off",falhou:true,estado:"desativada"},{nome:"fabricante",falhou:true,estado:"pronta",dele:false},{nome:"ok",resultado:0}];
  const ctx={rotinasCache:{itens:items,erro:"",velha:false,lidoEm:1000},Date:{now:()=>200000}};
  vm.runInNewContext(app.match(/const emAlarme = [^\n]+/)[0]+"\n"+piece(app,"resumoDasRotinas")+"\n"+extractUi("automationSnapshot")+"\n"+extractUi("automationAttention")+"\nthis.list=automationAttention;this.snapshot=resumoDasRotinas;",ctx);
  assert.deepEqual(Array.from(ctx.list(),t=>t.nome),["minha"]);
  assert.equal(ctx.snapshot().velha,true);
  assert.notEqual(ctx.snapshot().itens,items,"consumidor não pode substituir o array do cache");
});
test("foco horizontal traz última sessão inteira e impede o campo de desfazer a rolagem", () => {
  let options;
  const area={scrollLeft:0,getBoundingClientRect:()=>({left:272,right:712})};
  const panel={el:{getBoundingClientRect:()=>({left:862,right:1142}),scrollIntoView(){}}};
  const ctx={$:(selector)=>selector==="#panes"?area:{focus:o=>options=o}};
  runApp("irAtePainel",ctx)(panel);
  assert.equal(area.scrollLeft,430);
  assert.equal(options.preventScroll,true);
});
