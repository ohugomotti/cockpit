/* Tempo observado e relações reais dos agentes. Sem relógio, rede ou DOM próprios. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CockpitWork=api;})(typeof window==='object'?window:globalThis,()=>{
  'use strict';
  const validMs=value=>Number.isFinite(value)&&value>=0?value:0;
  function create(saved){return{ms:validMs(saved?.ms),at:null,running:false};}
  function update(clock,running,now){
    if(clock.at!==null&&clock.running&&Number.isFinite(now))clock.ms+=Math.max(0,now-clock.at);
    clock.at=Number.isFinite(now)?now:null;clock.running=!!running;return clock.ms;
  }
  function snapshot(clock){return{ms:Math.round(validMs(clock?.ms))};}
  function active(p){
    if(!p||p.morto||p.ligando||p._religar)return false;
    const robots=p.robos?.size>0;
    const agents=p.agentesTrabalho&&[...p.agentesTrabalho.values()].some(a=>a.state==='running');
    const blocked=p.pedindoPerm||p.filaPerm?.length||p.planoPendente
      ||(p.filaPerg||[]).some(q=>q.bloqueante!==false)
      ||(p.perguntaAberta&&p.perguntaAberta.bloqueante!==false);
    return !!(robots||agents||(p.busy&&!blocked));
  }
  function graph(p,items){
    const nodes=[],aliases=new Map(),seen=new Set();
    for(const a of Array.isArray(items)?items:[]){
      if(String(a.paneId)!==String(p.id)||a.engine!==p.engine||!a.id||seen.has(String(a.id)))continue;
      // leva 5i: o organograma tambem usa o tipo do agente e os horarios (comeco, fim e ultima mudanca) que o registro guarda
      seen.add(String(a.id));const node={id:String(a.id),parentId:String(a.parentId||''),title:String(a.task||'Agente'),state:String(a.state||'unknown'),model:String(a.model||''),detail:String(a.message||a.result||''),kind:'agent',tipo:String(a.tipo||''),startedAt:validMs(a.startedAt),endedAt:validMs(a.endedAt),updatedAt:validMs(a.updatedAt)};
      nodes.push(node);aliases.set(node.id,node);if(a.threadId)aliases.set(String(a.threadId),node);
    }
    for(const [id,r] of p.robos||[]){
      if(aliases.has(String(id)))continue;
      nodes.push({id:'background:'+id,parentId:'',title:String(r.desc||r.tipo||'Trabalho em segundo plano'),state:'running',detail:'Trabalho em segundo plano observado pelo Cockpit',model:'',kind:'background',tipo:String(r.tipo||''),startedAt:validMs(r.t0),endedAt:0,updatedAt:0});
    }
    for(const n of nodes){const parent=aliases.get(n.parentId);n.parent=parent&&parent!==n?parent.id:null;}
    // Relações cíclicas ou pais ausentes nunca ocultam agentes nem inventam uma ligação.
    const byId=new Map(nodes.map(n=>[n.id,n]));
    for(const n of nodes){const visited=new Set([n.id]);let cur=n;while(cur.parent){if(visited.has(cur.parent)){n.parent=null;break;}visited.add(cur.parent);cur=byId.get(cur.parent);if(!cur)break;}}
    return nodes;
  }
  return{create,update,snapshot,active,graph};
});
