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
/* Dialogo de lugar (Novo/Editar lugar): a consulta de motores roda num timer de
   800 ms. Fechar o dialogo nesse meio tempo (fecharModalGlobal esconde o modal e
   esvazia o .modal-cx) nao cancelava o timer, e o readRemote do app.js ia ler
   '#abHost' de um modal vazio -- TypeError no console. Se o mesmo .modal-cx ja'
   tinha virado outro dialogo, lia o formulario errado. O DOM daqui e' minimo mas
   e' arvore de verdade: append/before/prepend movem o no', e fechar/reabrir faz
   exatamente o que fecharModalGlobal/abrirModalGlobal fazem com o cx. */
function placeDialogHarness(existing) {
  const match=(n,sel)=>{
    const m=/^([a-z]+)?(?:#([\w-]+))?((?:\.[\w-]+)*)((?:\[[\w-]+="[^"]*"\])*)$/i.exec(sel);
    assert.ok(m,"seletor fora do DOM de teste: "+sel);
    return (!m[1]||n.tagName===m[1].toUpperCase())&&(!m[2]||n.id===m[2])&&
      m[3].split(".").filter(Boolean).every(c=>n.classes.has(c))&&
      [...m[4].matchAll(/\[([\w-]+)="([^"]*)"\]/g)].every(([,k,v])=>n.getAttribute(k)===v);
  };
  class El {
    constructor(tag,{cls="",text="",...props}={}){
      Object.assign(this,{tagName:tag.toUpperCase(),parentNode:null,children:[],classes:new Set(cls.split(" ").filter(Boolean)),
        dataset:{},attrs:{},listeners:{},id:"",value:"",textContent:text,customError:""},props);
    }
    get classList(){const c=this.classes;return{add:x=>c.add(x),remove:x=>c.delete(x),contains:x=>c.has(x)};}
    get isConnected(){let n=this;while(n.parentNode)n=n.parentNode;return n.isDocument===true;}
    get previousElementSibling(){const s=this.parentNode?.children;return s?.[s.indexOf(this)-1]||null;}
    get validity(){return{valid:!this.customError};}
    set innerHTML(html){for(const c of [...this.children])c.remove();}
    setCustomValidity(m){this.customError=m;}
    getAttribute(k){return k.startsWith("data-")?this.dataset[k.slice(5)]:this.attrs[k];}
    setAttribute(k,v){this.attrs[k]=String(v);}
    addEventListener(t,fn){(this.listeners[t]||=[]).push(fn);}
    remove(){const s=this.parentNode?.children;if(s)s.splice(s.indexOf(this),1);this.parentNode=null;}
    place(nodes,at){for(const n of nodes)n.remove();this.children.splice(at(),0,...nodes);for(const n of nodes)n.parentNode=this;}
    append(...n){this.place(n,()=>this.children.length);}
    prepend(...n){this.place(n,()=>0);}
    before(...n){const p=this.parentNode;p.place(n,()=>p.children.indexOf(this));}
    closest(sel){for(let n=this;n;n=n.parentNode)if(!n.isDocument&&match(n,sel))return n;return null;}
    contains(n){for(;n;n=n.parentNode)if(n===this)return true;return false;}
    querySelectorAll(sel){const all=n=>n.children.flatMap(c=>[c,...all(c)]);return all(this).filter(n=>match(n,sel));}
    querySelector(sel){return this.querySelectorAll(sel)[0]||null;}
  }
  const el=(tag,props,...kids)=>{const n=new El(tag,props);n.append(...kids);return n;};
  const doc=new El("html",{isDocument:true}),cx=el("div",{cls:"modal-cx"}),modal=el("div",{id:"modalGrupo",cls:"modal"},cx);
  doc.append(modal);
  // so' o que o placeDialog toca do formulario do abrirModalAbaLocal, com SSH ja' escolhido
  cx.append(el("div",{cls:"mo-top"},el("span",{cls:"mo-tit"})),el("input",{id:"abNome"}),
    el("div",{cls:"tipo-toggle"},el("button",{cls:"tipo-bt",dataset:{tipo:"local"}}),el("button",{cls:"tipo-bt on",dataset:{tipo:"ssh"}})),
    el("div",{id:"abCorpoSsh",cls:"mo-form"},el("input",{id:"abHost",value:existing?.host||""}),el("input",{id:"abUsuario",value:existing?.usuario||""}),
      el("label",{cls:"mo-dica",attrs:{for:"abPorta"}}),el("input",{id:"abPorta",value:"22"}),
      el("button",{id:"abEscolherChave",onclick:async()=>{}}),el("input",{id:"abCaminho",value:existing?.caminhoRemoto||""})),
    el("div",{id:"abCorpoConectores",cls:"mo-form"}),el("div",{cls:"mo-dica",text:"Cor"}),el("div",{cls:"cor-linha"}),
    el("div",{id:"abDestinoErro",cls:"mo-dica hidden"}),el("button",{id:"abOk"}));
  const timers=new Map(),probes=[];let timerId=0,reads=0;
  // mesmo formato do readRemote que o app.js passa: le' os campos direto do cx
  const readRemote=()=>{reads++;const f=s=>cx.querySelector(s).value.trim();
    return{host:f("#abHost"),usuario:f("#abUsuario"),porta:Number(f("#abPorta")),chave:"C:\\chaves\\id_ed25519",caminhoRemoto:f("#abCaminho")||"~"};};
  const ctx={q:(s,parent)=>parent.querySelector(s),node:(tag,cls,text)=>new El(tag,{cls:cls||"",text:text??""}),ico:()=>"",
    parseSshAddress:UI.parseSshAddress,formatSshAddress:UI.formatSshAddress,MOTORES:["claude","codex"],nomeDoMotor:e=>e,abasLocais:()=>[],
    setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),
    window:{api:{motoresDisponiveis:async r=>{probes.push(r);return{claude:{disponivel:true}};}}}};
  vm.runInNewContext(extractUi("placeDialog")+"\nthis.open=placeDialog;",ctx);
  ctx.open(cx,existing,readRemote);
  const compact=cx.querySelector("#abEndereco");
  return {probes,el,reads:()=>reads,status:()=>cx.querySelector(".ck-place-probe"),
    type(value){compact.value=value;for(const fn of compact.listeners.input)fn();},
    close(){modal.classList.add("hidden");cx.innerHTML="";},
    reopen(...kids){modal.classList.remove("hidden");cx.innerHTML="";cx.append(...kids);},
    fire(){const due=[...timers.values()];timers.clear();return Promise.all(due.map(fn=>fn()));}};
}
test("consulta de motores do lugar não lê o formulário depois que o modal fecha ou vira outro diálogo", async () => {
  const open=placeDialogHarness(null);
  open.type("qa@host-b:/srv/app");
  await open.fire();
  assert.deepEqual(open.probes.map(r=>[r.usuario,r.host,r.porta,r.caminhoRemoto]),[["qa","host-b",22,"/srv/app"]]);
  assert.match(open.status().textContent,/Motores encontrados: claude/);

  const closed=placeDialogHarness(null);
  closed.type("qa@host-b:/srv/app");
  closed.close();
  const readsBeforeClosedTimer=closed.reads();
  await assert.doesNotReject(closed.fire());
  assert.equal(closed.reads(),readsBeforeClosedTimer,"modal fechado: o formulário não existe mais");
  assert.equal(closed.probes.length,0);

  const reused=placeDialogHarness({tipo:"ssh",nome:"srv",usuario:"qa",host:"host-a",caminhoRemoto:"~"});
  reused.close();
  reused.reopen(reused.el("div",{cls:"mo-top"},reused.el("span",{cls:"mo-tit",text:"Outro diálogo"})));
  const readsBeforeReusedTimer=reused.reads();
  await assert.doesNotReject(reused.fire());
  assert.equal(reused.reads(),readsBeforeReusedTimer,"modal reaproveitado: não lê o formulário do outro diálogo");
  assert.equal(reused.probes.length,0);
});
