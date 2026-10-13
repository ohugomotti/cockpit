'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createNotificationStore, createNotificationPresenter } = require('../src/renderer/visual-mac');
function harness(prefs = {}, sound) {
  let at = 0, next = 0, sounds = 0;
  const timers = new Map(), states = [], announcements = [];
  const presenter = createNotificationPresenter({ now: () => at,
    setTimeout: (fn, ms) => { timers.set(++next, { at: at + ms, fn }); return next; }, clearTimeout: id => timers.delete(id),
    preferences: () => prefs, onChange: state => states.push(state), onAnnounce: (entry, others) => announcements.push({ entry, others }),
    onSound: () => { sounds++; return sound?.(); } });
  const store = createNotificationStore(event => { presenter.sync(store.list()); presenter.event(event); });
  function tick(ms) { const end = at + ms; for (;;) { const first = [...timers].sort((a,b) => a[1].at-b[1].at)[0]; if (!first || first[1].at > end) break; at=first[1].at;timers.delete(first[0]);first[1].fn(); } at=end; }
  const notify = (extra = {}) => store.notify({ id: 'pergunta', occurrence: '1', message: 'Qual opção?', attention: true, level: 'warning', ...extra });
  return { presenter, store, prefs, tick, notify, states, announcements, sounds: () => sounds };
}
test('prévia agrupa por 120ms, abre três segundos e recolhe sem remover o cartão', () => {
  const h=harness();h.notify();h.tick(119);assert.equal(h.presenter.state().open,false);h.tick(1);
  assert.equal(h.presenter.state().mode,'auto');h.tick(2999);assert.equal(h.presenter.state().open,true);h.tick(1);
  assert.equal(h.presenter.state().open,false);assert.equal(h.store.list().length,1);assert.equal(h.sounds(),1);
});
test('mouse, foco e ação mantêm aberta além dos três segundos e retomam o prazo restante', () => {
  for(const reason of ['pointer','focus','action']){const h=harness();h.notify();h.tick(120);h.tick(500);h.presenter.hold(reason,true);h.tick(9000);assert.equal(h.presenter.state().open,true);h.presenter.hold(reason,false);h.tick(2499);assert.equal(h.presenter.state().open,true);h.tick(1);assert.equal(h.presenter.state().open,false);}
});
test('vários motivos de interação precisam terminar antes de recolher', () => {
  const h=harness();h.notify();h.tick(120);h.presenter.hold('pointer',true);h.presenter.hold('action',true);h.tick(5000);h.presenter.hold('pointer',false);h.tick(5000);assert.equal(h.presenter.state().open,true);h.presenter.hold('action',false);h.tick(3000);assert.equal(h.presenter.state().open,false);
});
test('abertura manual não expira, nem ao sair com mouse ou teclado', () => {
  const h=harness();h.presenter.manual();h.presenter.pointer(true);h.presenter.pointer(false);h.presenter.hold('focus',true);h.presenter.hold('focus',false);h.tick(30000);assert.equal(h.presenter.state().mode,'manual');h.presenter.close();assert.equal(h.presenter.state().open,false);
});
test('hover continua disponível, recolhendo só depois de o mouse sair', () => {
  const h=harness();h.presenter.pointer(true);h.tick(9000);assert.equal(h.presenter.state().mode,'hover');h.presenter.pointer(false);h.tick(159);assert.equal(h.presenter.state().open,true);h.tick(1);assert.equal(h.presenter.state().open,false);
});
test('Escape ou clique fora cancela prévia pendente e atualização não reabre o mesmo evento', () => {
  const h=harness();h.notify();h.presenter.close();h.tick(1000);assert.equal(h.presenter.state().open,false);
  h.notify({revision:'texto mudou',message:'Qual opção agora?'});h.tick(1000);assert.equal(h.presenter.state().open,false);assert.equal(h.sounds(),0);
  h.notify({occurrence:'2'});h.tick(120);assert.equal(h.presenter.state().open,true);assert.equal(h.sounds(),1);
});
test('duas perguntas iguais têm ocorrências distintas, mesmo com revisão idêntica', async () => {
  const h=harness();h.notify();h.tick(3120);await h.store.dismiss('pergunta');h.notify();h.tick(3000);assert.equal(h.store.list().length,0);
  h.notify({occurrence:'2'});h.tick(120);assert.equal(h.store.list().length,1);assert.equal(h.presenter.state().open,true);assert.equal(h.sounds(),2);
});
test('replay e polling são silenciosos, inclusive após resolver e reinserir o cartão', () => {
  const h=harness();h.notify({replay:true});h.tick(5000);assert.equal(h.sounds(),0);assert.equal(h.presenter.state().open,false);
  h.store.resolve('pergunta');h.notify({replay:false});h.tick(5000);assert.equal(h.sounds(),0);assert.equal(h.presenter.state().open,false);
  h.notify({occurrence:'2',quiet:true});h.tick(5000);assert.equal(h.sounds(),0);assert.equal(h.presenter.state().open,false);
});
test('rajada produz um toque e uma prévia, com prioridade e quantidade dos outros', () => {
  const h=harness();h.notify({id:'a',priority:0});h.notify({id:'b',priority:20,level:'error'});h.notify({id:'c',attention:false});h.tick(120);
  assert.equal(h.sounds(),1);assert.equal(h.presenter.state().primary,'b');assert.equal(h.presenter.state().count,3);assert.equal(h.announcements.length,1);assert.equal(h.announcements[0].others,2);
  h.tick(500);h.notify({id:'d'});h.tick(120);assert.equal(h.sounds(),1);h.tick(2999);assert.equal(h.presenter.state().open,true);h.tick(1);assert.equal(h.presenter.state().open,false);
});
test('lote no fim da prévia conserva três segundos e não perde evento pendente nos últimos 120ms', () => {
  for(const arrival of [2800,2990]){const h=harness();h.notify({id:'a'});h.tick(120);h.tick(arrival);h.notify({id:'b'});h.tick(120);assert.equal(h.presenter.state().open,true);assert.equal(h.presenter.state().count,2);assert.equal(h.announcements.length,2);assert.equal(h.sounds(),1);h.tick(2999);assert.equal(h.presenter.state().open,true);h.tick(1);assert.equal(h.presenter.state().open,false);}
});
test('replay, polling e cota não renovam prazo; lote novo sob foco mantém três segundos após soltar', () => {
  const h=harness();h.notify();h.tick(120);h.tick(2800);h.notify({revision:'atualizada'});h.notify({id:'replay',replay:true});h.notify({id:'quota',quiet:true});h.tick(200);assert.equal(h.presenter.state().open,false);
  h.notify({occurrence:'2'});h.tick(120);h.presenter.hold('focus',true);h.tick(2800);h.notify({id:'nova'});h.tick(120);h.tick(9000);assert.equal(h.presenter.state().open,true);h.presenter.hold('focus',false);h.tick(2999);assert.equal(h.presenter.state().open,true);h.tick(1);assert.equal(h.presenter.state().open,false);
});
test('a notificação que está sendo lida não troca de lugar quando chega outra prioritária', () => {
  const h=harness();h.notify({id:'a'});h.tick(120);h.presenter.hold('focus',true);h.notify({id:'b',priority:100});h.tick(120);assert.equal(h.presenter.state().primary,'a');assert.equal(h.presenter.state().count,2);
});
test('preferências independentes, restauradas em um controlador novo', () => {
  const saved=JSON.parse(JSON.stringify({peek:false,sound:false}));const h=harness(saved);h.notify();h.tick(5000);assert.equal(h.sounds(),0);assert.equal(h.presenter.state().open,false);assert.equal(h.store.list().length,1);
  saved.sound=true;h.notify({occurrence:'2'});h.tick(120);assert.equal(h.sounds(),1);assert.equal(h.presenter.state().open,false);
  saved.peek=true;saved.sound=false;h.notify({occurrence:'3'});h.tick(120);assert.equal(h.presenter.state().open,true);assert.equal(h.sounds(),1);
  saved.peek=false;h.presenter.updatePreferences();assert.equal(h.presenter.state().open,false);
});
test('erro ou rejeição do áudio nunca impede a prévia nem remove o aviso', async () => {
  for(const sound of [()=>{throw Error('áudio bloqueado');},()=>Promise.reject(Error('sem dispositivo'))]){const h=harness({},sound);h.notify();h.tick(120);await Promise.resolve();assert.equal(h.presenter.state().open,true);assert.equal(h.store.list().length,1);}
});
test('ação pendente segura prévia, e falha mantém cartão utilizável', async () => {
  const h=harness();let finish;h.notify({action:{label:'Responder',run:()=>new Promise(resolve=>{finish=resolve;})}});h.tick(120);const running=h.store.act('pergunta');h.tick(9000);assert.equal(h.presenter.state().open,true);finish(false);await running;assert.equal(h.store.list().length,1);assert.equal(h.store.list()[0].busy,false);h.tick(3000);assert.equal(h.presenter.state().open,false);
});
test('histórico limitado não deixa a prévia apontar para cartão expulso', () => {
  const h=harness();for(let i=0;i<50;i++)h.notify({id:'burst-'+i,priority:i===0?100:0});h.tick(120);assert.equal(h.store.list().length,30);assert.ok(h.store.list().some(row=>row.id===h.presenter.state().primary));assert.equal(h.presenter.state().count,30);
});
