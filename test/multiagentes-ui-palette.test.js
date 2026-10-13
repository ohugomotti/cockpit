'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const UI = require('../src/renderer/cockpit-ui');
const HistoricoLista = require('../src/renderer/historico-lista');
const { lerFonte, pegarBloco } = require('../testes/raiz');
const progressive = pegarBloco(lerFonte('renderer', 'app.js'), 'function prepararRespostaHistorico(') + '\n' +
  pegarBloco(lerFonte('renderer', 'app.js'), 'async function listarSessoesComProgresso(');
const source = fs.readFileSync(path.join(__dirname, '../src/renderer/cockpit-ui.js'), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('  function palette() {');
const palette = source.slice(start, source.indexOf('\n  async function agentLayer', start));
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; }

function harness(options = {}) {
  const calls = [], nodes = [], timers = new Map();
  let timerId = 0, layerOptions;
  const node = (tag, cls = '', text = '') => {
    const n = {tag, className:cls, textContent:text, children:[], attrs:{}, dataset:{}, handlers:{}, value:'',
      setAttribute(k,v){this.attrs[k]=String(v);}, removeAttribute(k){delete this.attrs[k];},
      append(...children){this.children.push(...children);}, replaceChildren(...children){this.children=[...children];},
      addEventListener(type,fn){this.handlers[type]=fn;}, focus(){}, scrollIntoView(){},
    };
    nodes.push(n);return n;
  };
  const layer = {id:1, closed:false, body:node('div')};
  const button = (icon,title,action,cls) => {const n=node('button',cls,title);n.handlers.click=action;return n;};
  const folders = options.folders || [{id:'direito',nome:'Previdência',caminhos:['C:/Projetos/Previdência']}];
  const ctx = {
    node, button, labelled:(title,action,cls)=>button('',title,action,cls),
    q:(selector,parent)=>parent.children.find(n=>n.attrs['aria-selected']==='true'),
    openLayer:(title,opts)=>{layerOptions=opts;return layer;},
    closeLayer:()=>{layer.closed=true;layerOptions.onClose();},
    setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),queueMicrotask:fn=>fn(),
    searchSeq:0, listaProgressivaSeq:0, searchKind:UI.searchKind, searchText:UI.searchText, STATES:UI.STATES,
    liveRows:()=>options.live || [], abasLocais:()=>folders, abaAtual:()=>folders[0],
    commands:()=>options.commands || [{title:'Automações',detail:'Comando',run:()=>calls.push('automation')}],
    activate:r=>calls.push(r.title), trocarAbaLocal:id=>calls.push(id),
    detalheDaPasta:a=>a.caminhos?.[0] || '',iconeDaPasta:()=> 'folder',nomeDoMotor:e=>e,
    focusPane:options.noPane?null:{cwd:'C:/Projeto'},cfg:{abaAtiva:folders[0]?.id,defCwd:'C:/Projeto',tituloAuto:!!options.tituloAuto},HOME:'C:/QA',HistoricoLista,
    remotoDoPane:()=>null,remotoDoAba:()=>null,faltaConfigurarServidor:()=>false,
    MOTORES:['claude'],verArquivo:(p,file)=>calls.push(file),openSession:s=>calls.push(s.id),
    abrirModalAbaLocal:()=>calls.push('new-folder'),
    window:{api:{listDir:async()=>({entries:[]}),buscarArquivos:async()=>[],sessionsClaude:async()=>[],...options.api}},
  };
  vm.runInNewContext(progressive+'\n'+palette+'\nthis.open=palette;',ctx);ctx.open();
  const input=nodes.find(n=>n.className==='ck-search');
  const list=nodes.find(n=>n.className==='ck-results');
  const status=nodes.find(n=>n.className==='ck-search-status');
  return {calls,input,list,status,layer, nodes,
    resultNodes:()=>list.children.filter(n=>n.attrs.role==='option'),
    selected:()=>list.children.find(n=>n.attrs['aria-selected']==='true'),
    type(value){input.value=value;input.handlers.input();},
    key(key,extra={}){input.handlers.keydown({key,preventDefault(){},...extra});},
    filter(scope){nodes.find(n=>n.dataset.scope===scope).handlers.click();},
    close:ctx.closeLayer,
    async runTimers(){const due=[...timers.values()];timers.clear();await Promise.all(due.map(fn=>fn()));await settle();},
    startTimers(){const due=[...timers.values()];timers.clear();return Promise.all(due.map(fn=>fn()));},
  };
}

test('digitar invalida os resultados imediatamente: Enter não executa a busca anterior', async () => {
  const h=harness();
  assert.ok(h.resultNodes().length);
  h.type('>automacoes');h.key('Enter');
  assert.deepEqual(h.calls,[]);
  assert.equal(h.resultNodes().length,0);
  assert.equal(h.input.attrs['aria-activedescendant'],undefined);
  assert.equal(h.list.attrs['aria-busy'],'true');
  await h.runTimers();h.key('Enter');
  assert.deepEqual(h.calls,['automation']);
});

test('filtro Pastas busca nomes sem acentos e não consulta arquivos ou históricos', async () => {
  let requests=0;
  const h=harness({api:{listDir:async()=>{requests++;return [];},sessionsClaude:async()=>{requests++;return [];}}});
  h.filter('folders');h.type('previdencia');await h.runTimers();
  assert.deepEqual(h.resultNodes().map(n=>n.textContent),['Previdência']);
  assert.equal(requests,0);
  assert.equal(h.nodes.find(n=>n.dataset.scope==='folders').attrs['aria-pressed'],'true');
  h.key('Enter');assert.deepEqual(h.calls,['direito']);
});

test('filtro Conversas também mostra conversas guardadas com termo vazio e evita duplicar a viva', async () => {
  const h=harness({live:[{id:'viva',title:'Revisar integração',state:'working',engine:'claude',p:{sessaoId:'same'}}],
    api:{sessionsClaude:async()=>[{id:'same',title:'Revisar integração'},{id:'saved',title:'Planejar amanhã'}]}});
  h.filter('agents');await settle();
  assert.deepEqual(h.resultNodes().map(n=>n.textContent),['Revisar integração','Planejar amanhã']);
  assert.equal(h.list.attrs['aria-busy'],'false');
});

test('paleta unificada: encontra palavra do título original que saiu do nome curto e informa lista parcial', async () => {
  const h = harness({tituloAuto:true,api:{sessionsClaude:async()=>({
    itens:[{id:'saved',title:'Quero revisar histórico completo da previdência'}],aviso:'Página seguinte indisponível'
  })}});
  h.filter('agents');h.type('previdencia');await h.runTimers();
  assert.deepEqual(h.resultNodes().map(n=>n.textContent),['revisar histórico completo']);
  assert.match(h.status.textContent,/Página seguinte indisponível/);
  h.key('Enter');assert.deepEqual(h.calls,['saved']);
});

test('respostas assíncronas mantêm o resultado escolhido mesmo quando inserem grupos antes dele', async () => {
  const files=deferred(),history=deferred(),opened=[];
  const h=harness({folders:[{id:'teste',nome:'Teste pasta',caminhos:[]}],
    commands:[{title:'Teste comando',run:()=>opened.push('command')}],
    api:{listDir:()=>files.promise,sessionsClaude:()=>history.promise}});
  h.type('teste');const running=h.startTimers();
  h.key('ArrowDown');assert.equal(h.selected().textContent,'Teste comando');
  history.resolve([{id:'saved',title:'Teste conversa'}]);await settle();
  assert.equal(h.selected().textContent,'Teste comando');
  files.resolve({entries:[{name:'teste.md',path:'C:/Projeto/teste.md'}]});await running;
  assert.equal(h.selected().textContent,'Teste comando');
  h.key('Enter');assert.deepEqual(opened,['command']);
});

test('resposta antiga não reaparece depois de digitar outro termo', async () => {
  const pending=deferred();
  const h=harness({api:{sessionsClaude:()=>pending.promise}});
  h.type('antiga');const running=h.startTimers();h.type('nova');
  pending.resolve([{id:'old',title:'Antiga conversa'}]);await running;
  assert.equal(h.resultNodes().length,0);
  assert.equal(h.list.attrs['aria-busy'],'true');
  await h.runTimers();assert.equal(h.resultNodes().length,0);
  assert.match(h.status.textContent,/Nenhum resultado/);
});

test('combobox usa um único foco para resultados e descreve as teclas disponíveis', () => {
  const h=harness();
  assert.ok(h.resultNodes().every(n=>n.tabIndex===-1));
  assert.ok(h.resultNodes().some(n=>n.id===h.input.attrs['aria-activedescendant']));
  assert.equal(h.list.attrs['aria-label'],'Resultados da busca');
  assert.ok(h.nodes.some(n=>n.id===h.input.attrs['aria-describedby']&&n.textContent.includes('Enter')));
  assert.equal(h.status.attrs['aria-live'],'polite');
});

test('Enter usado para composição de texto não abre uma ação', () => {
  const h=harness();h.key('Enter',{isComposing:true});
  assert.deepEqual(h.calls,[]);assert.equal(h.layer.closed,false);
});

test('limite de resultados é informado e não troca a ação escolhida quando ela sai dos 80 visíveis', async () => {
  const history=deferred();let opened=false;
  const h=harness({commands:[{title:'Teste comando',run:()=>{opened=true;}}],folders:[],
    api:{sessionsClaude:()=>history.promise}});
  h.type('teste');const running=h.startTimers();
  assert.equal(h.selected().textContent,'Teste comando');
  history.resolve(Array.from({length:85},(_,i)=>({id:'h'+i,title:'Teste '+i})));
  await running;
  assert.equal(h.resultNodes().length,80);
  assert.match(h.status.textContent,/80 de 86 resultados/);
  assert.equal(h.selected(),undefined);
  assert.equal(h.input.attrs['aria-activedescendant'],undefined);
  h.key('Enter');assert.equal(opened,false);assert.deepEqual(h.calls,[]);
  h.key('ArrowDown');h.key('Enter');assert.deepEqual(h.calls,['h0']);
});

test('arquivo sem conversa aberta orienta como continuar', async () => {
  const h=harness({noPane:true});h.filter('files');await settle();
  assert.match(h.status.textContent,/Abra uma conversa/);
  assert.equal(h.list.attrs['aria-busy'],'false');
});

test('falha de histórico é anunciada sem esconder os resultados disponíveis', async () => {
  const h=harness({live:[{id:'one',title:'Conversa ativa',state:'working',engine:'claude'}],
    api:{sessionsClaude:async()=>{throw Error('Servidor indisponível');}}});
  h.filter('agents');await settle();
  assert.equal(h.resultNodes().length,1);
  assert.match(h.status.textContent,/1 resultados · Servidor indisponível/);
  assert.equal(h.list.attrs['aria-busy'],'false');
});

test('fechar a paleta cancela a busca ainda na espera', async () => {
  let requests=0;
  const h=harness({api:{sessionsClaude:async()=>{requests++;return [];}}});
  h.type('teste');h.close();await h.runTimers();assert.equal(requests,0);
});

test('paleta: lote aparece antes da conclusão e fechar cancela sem aceitar evento atrasado', async () => {
  const gate = deferred(), listeners = new Set(), cancelled = []; let request;
  const h = harness({api:{
    onSessionsProgress: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    sessionsScan: async value => { request = value; return gate.promise; },
    sessionsCancel: async id => { cancelled.push(id); return true; },
  }});
  h.filter('agents'); await settle();
  for (const fn of listeners) fn({requestId:request.requestId,engine:'claude',items:[{id:'primeira',title:'Ação previdenciária'}]});
  assert.equal(h.resultNodes().some(n=>n.textContent==='Ação previdenciária'),true);
  assert.match(h.status.textContent,/Carregando mais conversas/);
  h.close(); assert.deepEqual(cancelled,[request.requestId]); assert.equal(listeners.size,0);
  gate.resolve({items:[{id:'tardia',title:'Não aparecer'}]}); await settle();
  assert.equal(h.resultNodes().some(n=>n.textContent==='Não aparecer'),false);
});

test('paleta: digitar cancela varredura anterior e ignora progresso de outra geração', async () => {
  const gates=[], listeners=new Set(),requests=[],cancelled=[];
  const h=harness({api:{
    onSessionsProgress:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
    sessionsScan:value=>{requests.push(value);const gate=deferred();gates.push(gate);return gate.promise;},
    sessionsCancel:async id=>{cancelled.push(id);return true;},
  }});
  h.filter('agents');await settle();const old=requests[0];
  h.type('acao');assert.deepEqual(cancelled,[old.requestId]);const run=h.startTimers();await settle();const current=requests[1];
  for(const fn of listeners)fn({requestId:old.requestId,engine:'claude',items:[{id:'old',title:'Ação antiga'}]});
  assert.equal(h.resultNodes().length,0);
  for(const fn of listeners)fn({requestId:current.requestId,engine:'claude',items:[{id:'new',title:'Ação atual'}]});
  assert.equal(h.resultNodes()[0].textContent,'Ação atual');
  gates[0].resolve({cancelled:true});gates[1].resolve({items:[{id:'new',title:'Ação atual'}]});await run;await settle();
  h.key('Enter');assert.deepEqual(h.calls,['new']);
});

test('paleta: resultado final substitui parcial, avisa limite e abre a ficha atualizada', async () => {
  const gate=deferred(),listeners=new Set();let request;
  const h=harness({api:{onSessionsProgress:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},sessionsScan:value=>{request=value;return gate.promise;},sessionsCancel:async()=>true}});
  h.filter('agents');await settle();
  for(const fn of listeners)fn({requestId:request.requestId,engine:'claude',items:[{id:'antiga',title:'Sai no limite'},{id:'preservada',title:'Título provisório'}]});
  gate.resolve({truncated:true,items:[{id:'preservada',title:'Título definitivo'}]});await settle();
  assert.equal(h.resultNodes().length,1);assert.equal(h.resultNodes()[0].textContent,'Título definitivo');
  assert.match(h.status.textContent,/Histórico parcial/);
  h.key('ArrowDown');h.key('Enter');assert.deepEqual(h.calls,['preservada']);
});

test('Tab circula nos controles reais da camada e ignora opções com tabindex -1', () => {
  const keyStart=source.indexOf('  function keyLayer(e) {');
  const handler=source.slice(keyStart,source.indexOf('\n  function persist(',keyStart));
  for(const naoModal of [false,true]){
    const focused=[],first={tabIndex:0,getClientRects:()=>[1],focus:()=>focused.push('first')};
    const last={tabIndex:0,getClientRects:()=>[1],focus:()=>focused.push('last')};
    const option={tabIndex:-1,getClientRects:()=>[1],focus:()=>focused.push('option')};
    const ctx={layers:[{naoModal,panel:{contains:()=>true,querySelectorAll:()=>[first,last,option]}}],
      d:{activeElement:last,querySelector:()=>null},q:()=>({classList:{contains:()=>true}})};
    vm.runInNewContext(handler+'\nthis.key=keyLayer;',ctx);
    let prevented=false;
    ctx.key({key:'Tab',preventDefault:()=>{prevented=true;},stopImmediatePropagation(){}});
    assert.equal(prevented,true);assert.deepEqual(focused,['first']);
    ctx.d.activeElement=first;
    ctx.key({key:'Tab',shiftKey:true,preventDefault(){},stopImmediatePropagation(){}});
    assert.deepEqual(focused,['first','last']);
  }
});
