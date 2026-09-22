'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
const start = source.indexOf('const GUIA_MOTORES =');
const guide = source.slice(start, source.indexOf('const COMO_INSTALAR =', start));
function harness(availability = {claude:false,codex:false,gemini:false,grok:false}) {
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.events = {}; this.attrs = {}; this.textContent = ''; this.isConnected = false; }
    append(...items) { for (const item of items) { item.parent = this; item.connect(this.isConnected); this.children.push(item); } }
    prepend(item) { this.append(item); this.children.unshift(this.children.pop()); }
    connect(value) { this.isConnected = value; this.children.forEach(c => c.connect(value)); }
    setAttribute(k,v) { this.attrs[k] = v; }
    addEventListener(k,fn) { (this.events[k] ||= []).push(fn); }
    async fire(k,event={}) { for(const fn of this.events[k] || []) await fn(event); }
    querySelector(selector) { return all(this).find(e => selector === 'h3' ? e.tagName === 'h3' : e.tagName === 'button'); }
    focus() { document.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; this.fire('close'); }
    remove() { this.parent.children = this.parent.children.filter(e => e !== this); this.connect(false); }
  }
  const all = node => node.children.flatMap(c => [c,...all(c)]);
  const body = new Element('body'); body.isConnected = true;
  const group = new Element('section'); const heading = new Element('h3'); heading.textContent = 'Motores e contas'; group.append(heading);
  const welcome = new Element('div'); body.append(group,welcome);
  const document = { body,activeElement:null, createElement:t=>new Element(t), getElementById:id=>all(body).find(e=>e.id===id), querySelectorAll:s=>s === '.settings .aj-grupo' ? [group] : [], querySelector:s=>s === '#boasvindas .bv-cx' ? welcome : null };
  const calls = [];
  const ctx = {document,window:{api:{abrirLink:async url=>calls.push(url)}},verMotoresDisponiveis:async()=>availability};
  vm.runInNewContext(guide+'\nthis.openGuide=abrirPrimeirosPassos;this.prepare=prepararPrimeirosPassos;this.needed=precisaPrimeirosPassos',ctx);
  return {ctx,document,all:()=>all(body),calls,body,group,welcome,flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
test('primeiro uso só abre automaticamente sem configuração e com ausência confirmada de motores',()=>{
  const {ctx}=harness(); const no={claude:false,codex:false,gemini:false,grok:false};
  assert.equal(ctx.needed({},no),true);
  assert.equal(ctx.needed({abas:[{id:'pc'}]},no),false);
  assert.equal(ctx.needed({panes:[{engine:'codex'}]},no),false);
  assert.equal(ctx.needed({},null),false);
  for(const id of Object.keys(no)) assert.equal(ctx.needed({},{...no,[id]:true}),false,id);
});
test('guia é acessível na abertura e ajustes sem duplicar botões',()=>{
  const h=harness(); h.ctx.prepare(); h.ctx.prepare();
  assert.equal(h.all().filter(e=>e.id==='btnPrimeirosPassosAjustes').length,1);
  assert.equal(h.all().filter(e=>e.id==='btnPrimeirosPassosInicio').length,1);
  assert.equal(h.group.children[0].id,'btnPrimeirosPassosAjustes');
});
test('PC sem CLIs recebe orientação real e links oficiais, sem login ou instalação automática',async()=>{
  const h=harness();h.ctx.openGuide();await h.flush();
  assert.equal(h.document.getElementById('primeirosPassos').open,true);
  assert.equal(h.all().filter(e=>e.textContent==='Ainda não instalado neste computador.').length,3);
  assert.ok(h.all().some(e=>e.textContent.includes('sua própria conta')));
  assert.deepEqual(h.calls,[]);
  const links=h.all().filter(e=>e.tagName==='button'&&e.textContent.startsWith('Guia oficial'));
  assert.equal(links.length,4);
  for(const link of links)await link.fire('click');
  assert.equal(h.calls.length,4);
  assert.ok(h.calls.every(url=>/^https:\/\/(code\.claude\.com|developers\.openai\.com|geminicli\.com|git-scm\.com)\//.test(url)));
});
test('presença do executável não é mostrada como autenticação concluída',async()=>{
  const h=harness({claude:true,codex:true,gemini:true});h.ctx.openGuide();await h.flush();
  assert.equal(h.all().filter(e=>e.textContent==='Instalado neste computador. O login é conferido pelo próprio motor.').length,3);
});
test('falha de diagnóstico fica como desconhecido e permite nova tentativa',async()=>{
  const h=harness(null);h.ctx.openGuide();await h.flush();
  assert.equal(h.all().filter(e=>e.textContent==='Não consegui conferir a instalação.').length,3);
  assert.equal(h.all().find(e=>e.textContent==='Verificar novamente').disabled,false);
});
test('fechar durante diagnóstico não recria diálogo e restaura foco',async()=>{
  let finish;const h=harness();h.ctx.verMotoresDisponiveis=()=>new Promise(resolve=>finish=resolve);
  h.ctx.prepare();const origin=h.document.getElementById('btnPrimeirosPassosInicio');origin.focus();
  h.ctx.openGuide();h.ctx.openGuide();assert.equal(h.all().filter(e=>e.id==='primeirosPassos').length,1);
  h.document.getElementById('primeirosPassos').close(); finish({claude:true});await h.flush();
  assert.equal(h.document.getElementById('primeirosPassos'),undefined);
  assert.equal(h.document.activeElement,origin);
});

test('o tema salvo é aplicado antes do onboarding e dos ouvintes da interface',async()=>{
  const begin=source.indexOf('  cfg = await window.api.getConfig();');
  const end=source.indexOf('  cfg.defCwd =',begin);
  assert.ok(begin>=0 && end>begin);
  const events=[];
  const ctx={cfg:null,window:{api:{getConfig:async()=>({tema:'claro'})},dispatchEvent:e=>events.push(e.type)},
    CustomEvent:class{constructor(type){this.type=type;}},
    aplicarTema:theme=>events.push('tema:'+theme),prepararPrimeirosPassos:()=>events.push('onboarding')};
  await vm.runInNewContext('(async()=>{'+source.slice(begin,end)+'})()',ctx);
  assert.deepEqual(events,['tema:claro','onboarding','cockpit-config-ready']);
});
