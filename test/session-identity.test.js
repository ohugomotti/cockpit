"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/renderer/app.js"), "utf8").replace(/\r\n/g, "\n");
function extract(name) {
  const start = source.search(new RegExp("(?:async )?function " + name + "\\("));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}
function setup() {
  const remote = {tipo:"ssh",host:"vps-a",usuario:"qa",porta:2222,chave:"key-a",caminhoRemoto:"/srv/a"};
  const cfg={abaAtiva:"local",abas:[
    {id:"local",tipo:"local"},{id:"local-2",tipo:"local"},
    {id:"remote",...remote},{id:"same",...remote,caminhoRemoto:"/srv/b"},
    {id:"host",...remote,host:"vps-b"},{id:"user",...remote,usuario:"outro"},
    {id:"port",...remote,porta:22},{id:"key",...remote,chave:"key-b"},
  ]};
  const calls=[];
  const ctx=vm.createContext({cfg,panes:new Map(),panesFundo:new Map(),fichasPendentes:new Map(),
    savePanes:()=>calls.push({save:true}),pintarNome:p=>calls.push({paint:p.id}),calls,
    listaOuErro:r=>({itens:Array.isArray(r)?r:r.itens||[]}),
    modeloDoHistorico:msgs=>msgs.find(m=>m.model)?.model||"",
    window:{api:{
      sessionHistory:async o=>{calls.push({local:o});return [{model:"local-history"}]},
      sessionHistoryRemoto:async o=>{calls.push({remote:o});return {itens:[{model:"remote-history"}]}},
    }},
  });
  vm.runInContext(["abasLocais","abaPorId","abaAtual","remotoDoAba","remotoDoPane","esquecerTituloAuto",
    "painelDaConversa","renomearPaineisDaConversa","modeloDaOrigem"].map(extract).join("\n"),ctx);
  return ctx;
}
function addPane(c,id,abaId,extra={}) {
  const p={id,abaId,engine:"claude",sessaoId:"shared",titulo:"Original",model:id+"-model",effort:"high",...extra};
  c.panes.set(id,p);return p;
}
test("identidade diferencia host, usuário, porta, chave e motor; porta SSH padrão é equivalente",()=>{
  const c=setup(), requested=c.remotoDoAba(c.abaPorId("remote"));
  for(const abaId of ["local","host","user","port","key"]) {
    const p=addPane(c,abaId,abaId);
    assert.equal(c.painelDaConversa([p],"shared",{engine:"claude",remoto:requested}),undefined,abaId);
  }
  const otherEngine=addPane(c,"engine","remote",{engine:"codex"});
  assert.equal(c.painelDaConversa([otherEngine],"shared",{engine:"claude",remoto:requested}),undefined);
  const same=addPane(c,"same","same");
  assert.equal(c.painelDaConversa([same],"shared",{engine:"claude",remoto:requested}),same);
  const standard=addPane(c,"standard","port");
  const expected={...c.remotoDoAba(c.abaPorId("port"))};delete expected.porta;
  assert.equal(c.painelDaConversa([standard],"shared",{engine:"claude",remoto:expected}),standard);
});
test("renomeação remota chega só aos painéis e fichas do destino capturado, inclusive pendentes",()=>{
  const c=setup(), remote=c.remotoDoAba(c.abaPorId("remote"));
  const matching=["remote","same"], changed=[];
  for(const ab of c.cfg.abas) {
    const p=addPane(c,"pane-"+ab.id,ab.id);
    const ficha={engine:"claude",sessaoId:"shared",titulo:"Original"};
    const pending={...ficha};
    ab.paineis=[ficha,{...ficha,engine:"codex"},{...ficha,fork:true}];
    c.fichasPendentes.set(ab.id,[pending,{...ficha,engine:"codex"},{...ficha,fork:true}]);
    if(matching.includes(ab.id))changed.push(p,ficha,pending);
  }
  const wrongEngine=addPane(c,"engine","remote",{engine:"codex"});
  const fork=addPane(c,"fork","remote",{sessaoId:null,resumeId:"shared",forkPendente:true});
  const dead=addPane(c,"dead","remote",{morto:true});
  const background=addPane(c,"background","same");
  c.panes.delete(background.id);c.panesFundo.set(background.id,background);changed.push(background);
  // A aba ativa já mudou para o PC enquanto o rename remoto aguardava a API.
  assert.equal(c.renomearPaineisDaConversa({engine:"claude",id:"shared",remoto:true,remotoDestino:remote},"Renomeada"),3);
  for(const ab of c.cfg.abas) {
    const expected=matching.includes(ab.id)?"Renomeada":"Original";
    assert.equal(c.panes.get("pane-"+ab.id).titulo,expected,ab.id);
    assert.equal(ab.paineis[0].titulo,expected,ab.id+" config");
    assert.equal(c.fichasPendentes.get(ab.id)[0].titulo,expected,ab.id+" pendente");
    for(const item of [ab.paineis[1],ab.paineis[2],...c.fichasPendentes.get(ab.id).slice(1)])
      assert.equal(item.titulo,"Original","outro motor ou ramo");
  }
  for(const item of changed) { assert.equal(item.titulo,"Renomeada");assert.equal(item.nomeManual,true);assert.equal(item.tituloAuto,false); }
  for(const item of [wrongEngine,fork,dead])assert.equal(item.titulo,"Original");
  assert.equal(c.calls.filter(x=>x.save).length,1);
});
test("renomeação local propaga entre pastas do PC e preserva servidor com mesmo ID",()=>{
  const c=setup();
  for(const ab of c.cfg.abas) {addPane(c,ab.id,ab.id);ab.paineis=[{engine:"claude",sessaoId:"shared",titulo:"Original"}];}
  assert.equal(c.renomearPaineisDaConversa({engine:"claude",id:"shared",remoto:false},"Local nova"),2);
  for(const ab of c.cfg.abas) {
    const expected=ab.tipo==="local"?"Local nova":"Original";
    assert.equal(c.panes.get(ab.id).titulo,expected);assert.equal(ab.paineis[0].titulo,expected);
  }
});
test("modelo de origem encontra a sessão certa depois de homônimas de outros destinos e motores",async()=>{
  const c=setup();
  for(const abaId of ["host","user","port","key","local"])addPane(c,abaId,abaId);
  addPane(c,"engine","remote",{engine:"codex"});
  const right=addPane(c,"right","same");
  c.panes.delete(right.id);c.panesFundo.set(right.id,right);
  const result=await c.modeloDaOrigem({engine:"claude",id:"shared",remoto:true,remotoDestino:c.remotoDoAba(c.abaPorId("remote"))});
  assert.equal(result.model,right.model);assert.equal(result.effort,"high");
  assert.equal(c.calls.length,0,"modelo aberto dispensa ler histórico");
});
test("modelo sem painel correspondente lê o destino capturado; local não herda de remoto nem outro motor",async()=>{
  const c=setup(), remote=c.remotoDoAba(c.abaPorId("remote"));
  addPane(c,"wrong-key","key");
  addPane(c,"other-engine","remote",{engine:"codex"});
  const result=await c.modeloDaOrigem({engine:"claude",id:"shared",remoto:true,remotoDestino:remote});
  assert.equal(result.model,"remote-history");
  assert.equal(c.calls[0].remote.remoto,remote);
  c.cfg.abaAtiva="remote";
  const local=await c.modeloDaOrigem({engine:"claude",id:"shared",remoto:false,file:"local.jsonl"});
  assert.equal(local.model,"local-history");assert.equal(c.calls[1].local.file,"local.jsonl");
  const unknown=await c.modeloDaOrigem({engine:"codex",id:"shared",remoto:false});
  assert.equal(unknown.model,"");assert.equal(c.calls.length,2,"Codex não consulta histórico Claude");
});
