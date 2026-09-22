'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {pegarBloco}=require('../testes/raiz');
const src=fs.readFileSync(path.join(__dirname,'../src/renderer/app.js'),'utf8');
function extract(name){const start=src.indexOf('function '+name+'(');return(src.slice(start-6,start)==='async '?'async ':'')+pegarBloco(src,'function '+name+'(',name);}
function setup(options={}){
 const calls=[],notices=[],stops=[],panels=[];let terminal;
 const P=(id,remote=null,extra={})=>({id,engine:'codex',remote,started:true,busy:true,morto:false,sessaoId:'session-'+id,input:{value:'draft-'+id,style:{},scrollHeight:24},...extra});
 panels.push(P('local'),P('background'),P('remote',{host:'fixture.invalid',usuario:'qa'}));
 const ctx={console,Promise,Map,Set,ESTE_PC:'PC',MOTOR_DO_DEBATE:{claude:true,codex:true},
 window:{CockpitUI:{cancelResumesFor:(...args)=>calls.push(['cancelResumesFor',...args]),cancelResume:()=>{}},api:{
 contasDisponivel:async pedido=>{calls.push(['capabilities',pedido]);return options.caps || {gerenciado:true,salvar:true,trocar:true,login:true,logout:true};},
 contasTrocar:async pedido=>{calls.push(['switch',pedido]);return {ok:true};},
 auth:async pedido=>{calls.push(['auth',pedido]);return pedido.acao==='status'?(options.status||{verificado:true,entrou:true}):{terminal:'not executed',titulo:'Conta'};},
 paneStop:async pedido=>{calls.push(['stop',pedido]);stops.push(pedido.paneId);return true;},
 codexReiniciar:async()=>{calls.push(['restart']);return {ok:true};},
 debateList:async()=>options.debates||[],debateStop:async id=>{calls.push(['debateStop',id]);return{ok:true};}}},
 lugarDaContaDoPainel:p=>({remoto:p.remote,chave:p.remote?'qa@fixture.invalid':'pc'}),
 paineisDaConta:(engine,key)=>panels.filter(p=>p.engine===engine&&(p.remote?'qa@fixture.invalid':'pc')===key),
 nomeDoMotor:e=>e,faltaConfigurarServidor:()=>false,AVISO_ABA_EM_BRANCO:'blank',
 confirm:message=>{calls.push(['confirm',message]);return options.confirm!==false;},
 antesDaTroca:p=>({ocupado:p.busy,religando:false}),avisarTroca:()=>{},
 destravarPainel:p=>{p.busy=false;},setDot:()=>{},pintarFila:()=>{},$:(selector,el)=>el.input,
 savePanes:()=>calls.push(['save']),pintarCartaoConta:()=>{},carregarUsoSidebar:()=>{},
 mostrarAviso:x=>notices.push(x.texto),note:(p,text)=>notices.push(text),avisoTemp:(p,text)=>notices.push(text),
 janelaTerminal:(p,line,title,callback,opts)=>{calls.push(['terminal']);terminal={p,callback,...opts};},
 };
 for(const p of panels)p.el=p;
 vm.createContext(ctx);
 const declarations=['const operacoesDeConta = new Map();',src.split('\n').find(x=>x.startsWith('const chaveDaOperacaoDeConta = '))];
 const names=['pedidoDeConta','escopoDaConta','contaEmAlteracao','capacidadesDaConta','perfilDeContaUtilizavel','devolverFilaAoCampo','pararPaineisDaConta','prepararMudancaDaConta','trocarContaGuardada','contaAcao','send','enviarContinue'];
 vm.runInContext([...declarations,...names.map(extract),'this.opCount=()=>operacoesDeConta.size;'].join('\n'),ctx);
 return{ctx,calls,notices,stops,panels,get terminal(){return terminal;},place:{remoto:null,chave:'pc'}};
}
test('cancelar troca mantém processos, retomadas, sessões e rascunhos',async()=>{
 const h=setup({confirm:false}),before=JSON.stringify(h.panels.map(({el,...p})=>p));
 assert.equal(await h.ctx.trocarContaGuardada('codex',h.place,{apelido:'fixture',podeUsar:true}),false);
 assert.equal(JSON.stringify(h.panels.map(({el,...p})=>p)),before);assert.equal(h.ctx.opCount(),0);
 assert.equal(h.calls.some(c=>['cancelResumesFor','stop','restart','switch'].includes(c[0])),false);
});
test('troca guardada para todos os painéis do mesmo destino e preserva os da VPS',async()=>{
 const h=setup({debates:[{id:'debate',status:'running'}]});h.panels[0].queued='queued-text';
 assert.equal(await h.ctx.trocarContaGuardada('codex',h.place,{apelido:'fixture',podeUsar:true}),true);
 assert.deepEqual(h.stops,['local','background']);assert.equal(h.panels[2].busy,true);assert.equal(h.panels[2].sessaoId,'session-remote');
 for(const p of h.panels.slice(0,2)){assert.equal(p.busy,false);assert.equal(p.started,false);assert.equal(p.resumeId,'session-'+p.id);}
 assert.equal(h.panels[0].input.value,'queued-text\n\ndraft-local');assert.equal(h.ctx.opCount(),0);
 assert.equal(h.calls.filter(c=>c[0]==='confirm').length,1);assert.ok(h.calls.find(c=>c[0]==='debateStop'));
 assert.ok(h.calls.findIndex(c=>c[0]==='restart')<h.calls.findIndex(c=>c[0]==='switch'));
});
test('perfil conhecido inválido ou pedindo login não troca nem para painel',async()=>{
 for(const perfil of [{podeUsar:false},{precisaLogin:true},{estado:'login'}]){
  const h=setup();await assert.rejects(h.ctx.trocarContaGuardada('codex',h.place,{apelido:'fixture',...perfil}),/novo login/);
  assert.equal(h.stops.length,0);assert.equal(h.ctx.opCount(),0);
 }
});
test('login ocupado pede confirmação; recusar não cancela retomadas nem abre autenticação',async()=>{
 const h=setup({confirm:false});await h.ctx.contaAcao(h.panels[0],'login');
 assert.equal(h.calls.some(c=>['auth','stop','restart','cancelResumesFor','terminal'].includes(c[0])),false);assert.equal(h.ctx.opCount(),0);
});
test('login aceito protege envios até exit zero e status confirmado, preservando texto',async()=>{
 const h=setup();await h.ctx.contaAcao(h.panels[0],'login');
 assert.deepEqual(h.stops,['local','background']);assert.equal(h.ctx.opCount(),1);
 const before=h.panels[0].input.value;await h.ctx.send(h.panels[0]);h.ctx.enviarContinue(h.panels[0]);
 assert.equal(h.panels[0].input.value,before);assert.equal(h.ctx.contaEmAlteracao(h.panels[2]),false);
 await h.terminal.onExit({code:0,cancelled:false});
 assert.equal(h.ctx.opCount(),0);assert.ok(h.notices.some(n=>n.startsWith('Login confirmado')));
 await h.terminal.callback({code:0,cancelled:false});
 assert.equal(h.calls.filter(c=>c[0]==='auth'&&c[1].acao==='status').length,1);
});
test('cancelamento, erro ou fechamento sem exit não anuncia sucesso nem consulta status',async()=>{
 for(const end of [{cancelled:true,code:0},{cancelled:false,code:1},{cancelled:true,code:null},{error:'falha',code:null}]){
  const h=setup();await h.ctx.contaAcao(h.panels[0],'login');await h.terminal.callback(end);
  assert.equal(h.ctx.opCount(),0);assert.equal(h.calls.some(c=>c[0]==='auth'&&c[1].acao==='status'),false);
  assert.equal(h.notices.some(n=>n.startsWith('Login confirmado')),false);
 }
});
test('descarte silencioso do terminal libera alteração e uma segunda operação é recusada',async()=>{
 const h=setup();await h.ctx.contaAcao(h.panels[0],'login');await h.ctx.contaAcao(h.panels[1],'login');
 assert.equal(h.calls.filter(c=>c[0]==='terminal').length,1);assert.equal(h.ctx.opCount(),1);
 await h.terminal.onDiscard();assert.equal(h.ctx.opCount(),0);
});
test('logout exige confirmação e só confirma sucesso com status deslogado',async()=>{
 for(const [status,success] of [[{verificado:true,entrou:false},true],[{verificado:true,entrou:true},false],[{verificado:false,entrou:null},false]]){
  const h=setup({status});h.panels.forEach(p=>p.busy=false);await h.ctx.contaAcao(h.panels[0],'logout');
  assert.equal(h.calls.filter(c=>c[0]==='confirm').length,1);await h.terminal.onExit({code:0});
  assert.equal(h.notices.some(n=>n.startsWith('Saída da conta confirmada')),success);assert.equal(h.ctx.opCount(),0);
 }
});
test('motor ou destino sem gestão mostra orientação e não autentica nem interrompe',async()=>{
 const h=setup({caps:{gerenciado:false,login:false,logout:false,trocar:false,orientacao:'Use o terminal deste destino.'}});
 await h.ctx.contaAcao(h.panels[2],'login');assert.deepEqual(h.stops,[]);assert.equal(h.calls.some(c=>c[0]==='auth'),false);assert.ok(h.notices.includes('Use o terminal deste destino.'));
});


test('atalho e aviso de limite abrem a mesma conta do motor e destino do painel', async()=>{
 const calls=[],pane={engine:'codex',abaId:'vps'},aba={id:'vps',tipo:'ssh'};
 const ctx={window:{CockpitUI:{accountLayer:(engine,destino)=>calls.push([engine,destino])}},abaPorId:id=>{assert.equal(id,'vps');return aba;},fecharMenus:()=>{},fecharTerminalDoPainel:()=>{},note:()=>{}};
 vm.createContext(ctx);vm.runInContext(extract('janelaConta'),ctx);await ctx.janelaConta(pane);
 assert.equal(calls.length,1);assert.equal(calls[0][0],'codex');assert.equal(calls[0][1],aba);
});

test('endereços IPv6 e portas não misturam painéis nem a trava de troca de conta',()=>{
 const a={host:'2001:db8::1',usuario:'qa',porta:2222},b={host:'2001:db8::1:2222',usuario:'qa',porta:22};
 const pa={id:'a',abaId:'a',engine:'claude'},pb={id:'b',abaId:'b',engine:'claude'};
 const abas=new Map([['a',{remote:a}],['b',{remote:b}]]);
 const ctx={Map,panes:new Map([['a',pa]]),panesFundo:new Map([['b',pb]]),ESTE_PC:'PC',remotoDoAba:aba=>aba.remote,abaPorId:id=>abas.get(id)};
 vm.createContext(ctx);
 const declarations=['const CONTA_NO_SERVIDOR = ','const chaveDoLugar = ','const lugarDaContaDoPainel = ','const chaveDaOperacaoDeConta = '].map(prefix=>src.split('\n').find(line=>line.startsWith(prefix)));
 vm.runInContext([...declarations,'const operacoesDeConta = new Map();',...['servidorDaConta','lugarDaConta','paineisDaConta','contaEmAlteracao'].map(extract),
  'this.key=chaveDoLugar;this.lock=(engine,r)=>operacoesDeConta.set(chaveDaOperacaoDeConta(engine,{chave:chaveDoLugar(r)}),{});'].join('\n'),ctx);
 assert.notEqual(ctx.key(a),ctx.key(b));
 assert.equal(ctx.key(a),ctx.key({...a,host:'[2001:db8::1]'}));
 assert.equal(ctx.key({host:'fixture.invalid',usuario:'qa'}),'qa@fixture.invalid');
 assert.equal(ctx.key({host:'127.0.0.1',usuario:'qa',porta:2222}),'qa@127.0.0.1:2222');
 ctx.lock('claude',a);
 assert.equal(ctx.contaEmAlteracao(pa),true);assert.equal(ctx.contaEmAlteracao(pb),false);
 assert.deepEqual(Array.from(ctx.paineisDaConta('claude',ctx.key(a)),p=>p.id),['a']);
});

function sendFixture(){
 const calls=[],P={id:'fixture',abaId:'a',engine:'codex',anexos:[],input:{value:'prompt de prova',style:{}},blocks:new Map(),titulo:'Fixture',hist:[]};P.el=P;
 const ctx={console,Date,IMG_EXT:[],window:{api:{paneSend:async p=>{calls.push(['send',p]);return true;},paneStop:async p=>{calls.push(['stop',p]);return true;}}},
  $:(s,e)=>e.input,contaEmAlteracao:()=>false,remotoDoPane:()=>null,esforcoDe:()=>'',opcoesDeStart:p=>({paneId:p.id,engine:p.engine}),podeGerarTituloAuto:()=>false,userMsg:()=>({}),nomeDoMotor:e=>e};
 for(const n of ['pararBuscaDeArquivos','soltarNavArquivos','pintarAnexos','guardarPrompt','setDot','note','guardarEnderecoAteASessao','pararTrabalho','zerarTurno','limparPassos','trabalhando','subirNaLista'])ctx[n]=()=>{};
 vm.createContext(ctx);vm.runInContext(extract('desfazerEnvio')+'\n'+extract('send'),ctx);return{ctx,P,calls};
}

test('fechar painel enquanto liga impede envio e não ressuscita o painel',async()=>{
 const h=sendFixture();let release;h.ctx.window.api.paneStart=()=>new Promise(r=>release=r);
 const run=h.ctx.send(h.P);h.P.morto=true;h.P.started=false;h.P.busy=false;release(true);await run;
 assert.equal(h.calls.some(c=>c[0]==='send'),false);assert.equal(h.P.started,false);assert.equal(h.P.busy,false);
 assert.ok(h.calls.some(c=>c[0]==='stop'));
});

test('alteração de conta durante término do ditado preserva texto e anexos',async()=>{
 const h=sendFixture();h.P.started=true;h.P._ditado=true;h.P.anexos=[{path:'fixture.txt'}];
 let release,locked=false;h.P.pararDitado=()=>new Promise(r=>release=r);h.ctx.contaEmAlteracao=()=>locked;
 const run=h.ctx.send(h.P);locked=true;h.P.uiContaGeracao=1;release();await run;
 assert.equal(h.calls.some(c=>c[0]==='send'),false);assert.equal(h.P.input.value,'prompt de prova');assert.equal(h.P.anexos.length,1);
});

test('fechar ou trocar o motor durante tentativa de religar impede reenvio',async()=>{
 for(const mutate of [p=>{p.morto=true;p.busy=false;},p=>{p.engine='claude';p.busy=false;}]){
  const h=sendFixture();h.P.started=true;let release;
  h.ctx.window.api.paneSend=async p=>{h.calls.push(['send',p]);return false;};
  h.ctx.window.api.paneStart=()=>new Promise(r=>release=r);
  const run=h.ctx.send(h.P);await new Promise(r=>setImmediate(r));assert.ok(release);mutate(h.P);release(true);await run;
  assert.equal(h.calls.filter(c=>c[0]==='send').length,1);assert.equal(h.P.busy,false);
  assert.equal(h.calls.some(c=>c[0]==='stop'&&c[1].engine==='codex'),!!h.P.morto);
 }
});

test('fechar painel enquanto conta aguarda capacidade, parada ou comando libera operação sem terminal',async()=>{
 for(const step of ['capabilities','stop','auth']){
  const h=setup();let release;
  if(step==='capabilities')h.ctx.window.api.contasDisponivel=()=>new Promise(r=>release=()=>r({login:true}));
  if(step==='stop')h.ctx.window.api.paneStop=()=>new Promise(r=>release=()=>r(true));
  if(step==='auth')h.ctx.window.api.auth=()=>new Promise(r=>release=()=>r({terminal:'fixture',titulo:'Conta'}));
  const run=h.ctx.contaAcao(h.panels[0],'login');await new Promise(r=>setImmediate(r));assert.ok(release);
  h.panels[0].morto=true;
  // A parada alcança outros painéis; apenas a primeira espera simula o fechamento.
  if(step==='stop')h.ctx.window.api.paneStop=async()=>true;
  release();await run;
  assert.equal(h.terminal,undefined);assert.equal(h.ctx.opCount(),0);
 }
});

test('nova conversa não muda de destino enquanto verifica o servidor',async()=>{
 const calls=[],a={id:'a',remote:{host:'fixture-a'}},b={id:'b',remote:null};let current=a,release;
 const ctx={cfg:{abaAtiva:'a'},abaAtual:()=>current,remotoDoAba:a=>a.remote,capacidadeRemota:()=>new Promise(r=>release=r),motorDisponivel:{codex:true},
  cabeMaisPainel:()=>true,cwdPadraoDaAba:a=>'cwd-'+a.id,newPane:p=>{calls.push(p);return{id:'new',engine:p.engine,morto:true};},window:{api:{paneStop:async()=>true}}};
 vm.createContext(ctx);vm.runInContext(extract('novaConversa'),ctx);
 const run=ctx.novaConversa('codex');current=b;ctx.cfg.abaAtiva='b';release(true);await run;
 assert.equal(calls.length,0);
});

test('parar ou desligar o motor durante start invalida o envio pendente',async()=>{
 for(const action of ['interromperPainel','desligarMotor']){
  const h=sendFixture();let release;h.ctx.window.api.paneStart=()=>new Promise(r=>release=r);
  h.ctx.window.api.paneInterrupt=()=>true;h.ctx.clearInterval=()=>{};
  vm.runInContext(extract(action),h.ctx);
  const run=h.ctx.send(h.P);h.ctx[action](h.P);release(true);await run;
  assert.equal(h.calls.some(c=>c[0]==='send'),false);assert.equal(h.P.input.value,'prompt de prova');assert.equal(!!h.P.busy,false);assert.equal(h.P.ligando,false);assert.ok(h.calls.some(c=>c[0]==='stop'));
 }
});

test('troca de motor adquire trava antes de aguardar capacidade e recusa clique concorrente',async()=>{
 const calls=[],P={id:'fixture',abaId:'a',engine:'claude',remote:{host:'fixture-a'},hist:[],blocks:new Map()};let release;
 const ctx={window:{CockpitUI:{cancelResume:()=>{}},api:{paneStop:async p=>{calls.push(['stop',p]);return true;},setConfig:()=>{}}},cfg:{},
  remotoDoPane:p=>p.remote,capacidadeRemota:engine=>{calls.push(['capability',engine]);return new Promise(r=>release=r);},motorDisponivel:{},nomeDoMotor:e=>e,
  restaurarEstadoDoMotor:()=>false,modoValido:()=>'',note:()=>{}};
 for(const n of ['guardarEstadoDoMotor','destravarPainel','pintarTokens','esquecerPassos','limparPlano','limparAuditoria','zerarTurno','fillModels','paintEngine','mostrarPastaNoPainel','pintarModo','setDot','savePanes','marcaTroca'])ctx[n]=()=>{};
 vm.createContext(ctx);vm.runInContext(extract('trocarMotor'),ctx);
 const first=ctx.trocarMotor(P,'codex');const second=ctx.trocarMotor(P,'grok');
 assert.equal(calls.filter(c=>c[0]==='capability').length,1);release(true);await Promise.all([first,second]);
 assert.equal(P.engine,'codex');assert.equal(P._trocando,false);assert.equal(calls.filter(c=>c[0]==='stop').length,1);
 for(const mutate of [p=>{p.morto=true;},p=>{p.remote={host:'fixture-b'};}]){
  P.morto=false;P.engine='claude';P.remote={host:'fixture-a'};calls.length=0;
  const run=ctx.trocarMotor(P,'codex');mutate(P);release(true);await run;
  assert.equal(P.engine,'claude');assert.equal(P._trocando,false);assert.equal(calls.filter(c=>c[0]==='stop').length,0);
 }
});

test('resposta de start antigo não para nem repinta um novo dono do painel',async()=>{
 for(const outcome of ['resolve','reject'])for(const retry of [false,true])for(const newOwner of ['generation','token'])for(const [started,busy] of [[true,true],[true,false],[false,true]]){
  const h=sendFixture();h.P.started=retry;let release,fail;const dots=[];h.ctx.setDot=(p,state)=>dots.push(state);
  if(retry)h.ctx.window.api.paneSend=async p=>{h.calls.push(['send',p]);return false;};
  h.ctx.window.api.paneStart=()=>new Promise((r,j)=>{release=r;fail=j;});
  const run=h.ctx.send(h.P);await new Promise(r=>setImmediate(r));
  if(newOwner==='generation')h.P.uiEnvioGeracao=1;else h.P.uiInicioEnvio={};
  h.P.started=started;h.P.busy=busy;h.P.ligando=true;h.P.sessaoId='new-session';
  h.P.input.value='rascunho da nova sessão';dots.length=0;if(outcome==='resolve')release(true);else fail(new Error('fixture start failure'));await run;
  assert.equal(h.calls.filter(c=>c[0]==='stop').length,0);assert.equal(h.P.started,started);assert.equal(h.P.busy,busy);assert.equal(h.P.ligando,true);
  assert.equal(h.P.input.value,'rascunho da nova sessão');assert.deepEqual(dots,[]);
  assert.equal(h.calls.filter(c=>c[0]==='send').length,retry?1:0);
 }
});

test('start inicial e retry liberam Esc e troca de conta para um novo envio real',async()=>{
 for(const retry of [false,true])for(const action of ['escape','account'])for(const outcome of ['resolve','reject']){
  const h=sendFixture();h.P.started=retry;let release,fail,locked=false;
  h.ctx.contaEmAlteracao=()=>locked;h.ctx.window.api.paneInterrupt=()=>true;
  vm.runInContext(extract('interromperPainel'),h.ctx);
  if(retry)h.ctx.window.api.paneSend=async p=>{h.calls.push(['send',p]);return false;};
  h.ctx.window.api.paneStart=()=>new Promise((r,j)=>{release=r;fail=j;});
  const run=h.ctx.send(h.P);await new Promise(r=>setImmediate(r));assert.ok(release);
  if(action==='escape')h.ctx.interromperPainel(h.P);
  else{locked=true;h.P.uiContaGeracao=1;h.P.started=false;h.P.busy=false;h.P.ligando=false;}
  if(outcome==='resolve')release(true);else fail(new Error('fixture start failure'));
  await run;
  assert.equal(h.P.ligando,false);assert.equal(!!h.P.busy,false);assert.equal(h.P.started,false);assert.equal(h.P.input.value,'prompt de prova');
  assert.equal(h.calls.filter(c=>c[0]==='send').length,retry?1:0);
  if(outcome==='resolve')assert.ok(h.calls.some(c=>c[0]==='stop'));
  const sentBefore=h.calls.filter(c=>c[0]==='send').length;locked=false;
  h.ctx.window.api.paneStart=async()=>{h.calls.push(['next-start']);return true;};
  h.ctx.window.api.paneSend=async p=>{h.calls.push(['send',p]);return true;};
  await h.ctx.send(h.P);
  assert.equal(h.calls.filter(c=>c[0]==='next-start').length,1);assert.equal(h.calls.filter(c=>c[0]==='send').length,sentBefore+1);
  assert.equal(h.P.queued,undefined);assert.equal(h.P.ligando,false);assert.equal(h.P.busy,true);assert.equal(h.P.started,true);
 }
});
