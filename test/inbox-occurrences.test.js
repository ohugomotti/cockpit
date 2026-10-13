'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pegarBloco } = require('../testes/raiz');
const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');

function inbox() {
  const files = new Map(), sent = [];
  let now = 10000;
  const ctx = vm.createContext({
    Date: { now: () => now }, path, PASTA_INBOX: () => 'C:/QA/inbox',
    inboxVistos: new Set(), inboxRestaurados: new Map(), inboxAnunciados: new Map(), inboxOuvinte: true,
    fs: {
      readdirSync: () => [...files.keys()],
      statSync: file => { const value = files.get(path.basename(file)); if (!value) throw Error('Ausente'); return { mtimeMs:value.mtime, ctimeMs:value.ctime || 0, size:value.text.length, isFile:() => true }; },
      readFileSync: file => files.get(path.basename(file)).text,
    },
    win: { isDestroyed: () => false, webContents: { isLoading: () => false, send: (channel, value) => sent.push({ channel, ...value }) } },
  });
  for (const name of ['arquivosInbox', 'parInbox', 'ocorrenciaInbox', 'itemInbox', 'prepararReplayInbox', 'varrerInbox']) vm.runInContext(pegarBloco(main, 'function ' + name + '('), ctx);
  return { ctx, files, sent, put:(name,text='texto',mtime=now-1000) => files.set(name,{text,mtime}), advance:ms=>now+=ms };
}

test('Inbox existente no disco reaparece silenciosa; novos arquivos durante a carga continuam novos', () => {
  const t=inbox(); t.put('plano.md'); t.ctx.prepararReplayInbox(); t.put('chegou.txt'); t.ctx.varrerInbox();
  assert.equal(t.sent.find(n=>n.nome==='plano.md').replay,true);
  assert.equal(t.sent.find(n=>n.nome==='chegou.txt').replay,false);
  assert.notEqual(t.sent[0].occurrence,t.sent[1].occurrence);
  t.ctx.varrerInbox(); assert.equal(t.sent.length,2);
});

test('Recarregar conserva identidade do item; reescrever o mesmo arquivo cria nova ocorrência', () => {
  const t=inbox(); t.put('voz.txt','primeiro'); t.ctx.prepararReplayInbox(); t.ctx.varrerInbox();
  const id=t.sent[0].occurrence;
  t.ctx.prepararReplayInbox(); t.ctx.inboxVistos.clear(); t.ctx.varrerInbox();
  assert.equal(t.sent[1].occurrence,id); assert.equal(t.sent[1].replay,true);
  t.advance(2000); t.put('voz.txt','segundo'); t.ctx.varrerInbox();
  assert.notEqual(t.sent[2].occurrence,id); assert.equal(t.sent[2].replay,false);
});

test('Arquivo ainda sendo gravado é novo quando termina, não depende de atraso fixo do boot', () => {
  const t=inbox(); t.ctx.prepararReplayInbox(); t.put('nova.txt','nova',10000); t.ctx.varrerInbox();
  assert.equal(t.sent.length,0); t.advance(1000); t.ctx.varrerInbox();
  assert.equal(t.sent.length,1); assert.equal(t.sent[0].replay,false);
});

test('Expulsar vistos por volume não faz os mesmos anexos parecerem chegadas novas', () => {
  const t=inbox(); t.ctx.prepararReplayInbox(); t.put('novo.txt'); t.ctx.varrerInbox();
  for(let i=0;i<501;i++)t.ctx.inboxVistos.add('temporario-'+i);
  t.ctx.varrerInbox(); t.ctx.varrerInbox();
  assert.equal(t.sent.length,2); assert.equal(t.sent[0].replay,false); assert.equal(t.sent[1].replay,true);
  assert.equal(t.sent[0].occurrence,t.sent[1].occurrence);
});

test('Imagem com legenda conserva um único aviso e registros de arquivos removidos são liberados', () => {
  const t=inbox(); t.put('foto.png','imagem'); t.put('foto.txt','legenda'); t.ctx.prepararReplayInbox(); t.ctx.varrerInbox();
  assert.equal(t.sent.length,1); assert.equal(t.sent[0].legenda,'legenda'); assert.equal(t.sent[0].replay,true);
  t.files.clear(); t.ctx.varrerInbox();
  assert.equal(t.ctx.inboxRestaurados.size,0); assert.equal(t.ctx.inboxAnunciados.size,0);
});

test('reescrever apenas a legenda cria ocorrência nova e reler continua silencioso', () => {
  const t=inbox(); t.put('foto.png','imagem');t.put('foto.txt','legenda antiga');t.ctx.prepararReplayInbox();t.ctx.varrerInbox();
  const old=t.sent[0].occurrence;t.advance(2000);t.put('foto.txt','legenda nova');t.ctx.varrerInbox();
  assert.equal(t.sent.length,2);assert.equal(t.sent[1].nome,'foto.png');assert.equal(t.sent[1].legenda,'legenda nova');assert.equal(t.sent[1].replay,false);assert.notEqual(t.sent[1].occurrence,old);
  t.ctx.prepararReplayInbox();t.ctx.inboxVistos.clear();t.ctx.varrerInbox();assert.equal(t.sent[2].replay,true);assert.equal(t.sent[2].occurrence,t.sent[1].occurrence);
});

test('imagem aguarda legenda recém-escrita e acompanha legenda que chegou depois', () => {
  const t=inbox();t.put('foto.png','imagem');t.put('foto.txt','começando',10000);t.ctx.varrerInbox();assert.equal(t.sent.length,0);
  t.advance(1000);t.ctx.varrerInbox();assert.equal(t.sent.length,1);
  t.put('outra.png','imagem');t.ctx.varrerInbox();assert.equal(t.sent.length,2);
  t.advance(2000);t.put('outra.md','legenda que chegou depois');t.ctx.varrerInbox();assert.equal(t.sent.length,3);assert.equal(t.sent[2].nome,'outra.png');assert.equal(t.sent[2].legenda,'legenda que chegou depois');
});

test('txt e md independentes não se escondem; duas legendas ou imagens têm associação única', () => {
  const t=inbox();t.put('nota.txt','texto');t.put('nota.md','markdown');t.ctx.varrerInbox();assert.equal(t.sent.length,2);
  t.put('foto.png','img1');t.put('foto.jpg','img2');t.put('foto.txt','legenda');t.put('foto.md','plano separado');t.ctx.varrerInbox();
  const photos=t.sent.filter(x=>x.nome.startsWith('foto.'));
  assert.deepEqual(photos.map(x=>[x.nome,x.legenda]).sort(),[['foto.jpg',''],['foto.md',''],['foto.png','legenda']]);
});

test('versão não perde reescrita no mesmo milissegundo arredondado nem alteração só de ctime', () => {
  const t=inbox();t.put('voz.txt','primeira',9000.1);t.ctx.varrerInbox();t.put('voz.txt','segunda!',9000.2);t.ctx.varrerInbox();
  assert.equal(t.sent.length,2);assert.notEqual(t.sent[0].occurrence,t.sent[1].occurrence);
  t.files.get('voz.txt').ctime=9100;t.ctx.varrerInbox();assert.equal(t.sent.length,3);
});

function consuming(t, override={}) {
  const os=require('node:os'),crypto=require('node:crypto');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cockpit-inbox-safe-')),root=path.join(dir,'inbox');fs.mkdirSync(root);
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const io={...fs,...override},handlers=new Map();
  const ctx=vm.createContext({fs:io,path,crypto,Date,Map,Set,EH_WIN:process.platform==='win32',PASTA_INBOX:()=>root,app:{getPath:()=>dir},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)}});
  for(const name of ['arquivosInbox','parInbox','ocorrenciaInbox','itemInbox'])vm.runInContext(pegarBloco(main,'function '+name+'('),ctx);
  vm.runInContext(main.slice(main.indexOf("ipcMain.handle('inbox:consumir'"),main.indexOf("ipcMain.handle('inbox:pasta'")),ctx);
  return{dir,root,io,put:(name,value)=>{const file=path.join(root,name);fs.writeFileSync(file,value);return file;},version:name=>ctx.itemInbox(name,ctx.arquivosInbox()).occurrence,consume:o=>handlers.get('inbox:consumir')({},o)};
}

test('falha de mover imagem preserva imagem e legenda; erro não expõe caminho do sistema', t => {
  const h=consuming(t,{renameSync:()=>{throw Error('SECRET_PATH');}}),img=h.put('foto.png','imagem'),caption=h.put('foto.txt','legenda');
  const r=h.consume({arquivo:img,occurrence:h.version('foto.png')});assert.ok(r.error);assert.equal(r.ok,undefined);assert.ok(!r.error.includes('SECRET_PATH'));
  assert.equal(fs.readFileSync(img,'utf8'),'imagem');assert.equal(fs.readFileSync(caption,'utf8'),'legenda');
});

test('legenda alterada recusa consumo e descarte da ocorrência antiga sem apagar nenhum arquivo', t => {
  const h=consuming(t),img=h.put('foto.png','imagem'),caption=h.put('foto.txt','antes');const occurrence=h.version('foto.png');
  fs.writeFileSync(caption,'legenda nova');
  for(const apagar of [false,true]){const r=h.consume({arquivo:img,occurrence,apagar});assert.equal(r.code,'CONFLICT');assert.ok(fs.existsSync(img));assert.equal(fs.readFileSync(caption,'utf8'),'legenda nova');}
  assert.equal(h.consume({arquivo:img,occurrence:h.version('foto.png')}).ok,true);assert.equal(fs.existsSync(caption),false);
});

test('consumir texto preserva outro texto de mesmo basename e falha ao apagar imagem preserva legenda', t => {
  const h=consuming(t),txt=h.put('nota.txt','texto'),md=h.put('nota.md','plano');
  assert.equal(h.consume({arquivo:txt,occurrence:h.version('nota.txt')}).ok,true);assert.equal(fs.readFileSync(md,'utf8'),'plano');
  const img=h.put('foto.png','imagem'),caption=h.put('foto.txt','legenda');
  h.io.unlinkSync=file=>{if(file===img)throw Error('Travado');return fs.unlinkSync(file);};
  assert.ok(h.consume({arquivo:img,apagar:true,occurrence:h.version('foto.png')}).error);assert.ok(fs.existsSync(img));assert.ok(fs.existsSync(caption));
});

test('só a legenda apresentada sai com a imagem; imagem secundária e markdown continuam independentes', t => {
  const h=consuming(t),png=h.put('foto.png','png'),jpg=h.put('foto.jpg','jpg'),txt=h.put('foto.txt','legenda'),md=h.put('foto.md','plano');
  const second=h.consume({arquivo:jpg,occurrence:h.version('foto.jpg')});assert.equal(second.ok,true);assert.ok(fs.existsSync(txt));
  const first=h.consume({arquivo:png,occurrence:h.version('foto.png')});assert.equal(first.ok,true);assert.equal(fs.existsSync(txt),false);assert.equal(fs.readFileSync(md,'utf8'),'plano');
});

test('legenda alterada durante o rename é preservada para reaparecer como texto', t => {
  const h=consuming(t),img=h.put('foto.png','imagem'),caption=h.put('foto.txt','antes');
  h.io.renameSync=(from,to)=>{fs.renameSync(from,to);fs.writeFileSync(caption,'chegou depois da confirmação');};
  const r=h.consume({arquivo:img,occurrence:h.version('foto.png')});assert.equal(r.ok,true);assert.equal(fs.readFileSync(caption,'utf8'),'chegou depois da confirmação');assert.equal(fs.readFileSync(r.arquivo,'utf8'),'imagem');
});

test('texto que virou legenda não é apagado pelo aviso de texto antigo', t => {
  const h=consuming(t),txt=h.put('foto.txt','texto antigo');const occurrence=h.version('foto.txt');h.put('foto.png','imagem nova');
  assert.equal(h.consume({arquivo:txt,occurrence}).code,'CONFLICT');assert.ok(fs.existsSync(txt));
});

test('consumos próximos têm destinos diferentes e arquivo fora da inbox é recusado', t => {
  const h=consuming(t),a=h.put('a.png','A'),b=h.put('b.png','B');
  const one=h.consume({arquivo:a}),two=h.consume({arquivo:b});assert.equal(one.ok,true);assert.equal(two.ok,true);assert.notEqual(one.arquivo,two.arquivo);assert.equal(fs.readFileSync(one.arquivo,'utf8'),'A');assert.equal(fs.readFileSync(two.arquivo,'utf8'),'B');
  const outside=path.join(h.dir,'fora.txt');fs.writeFileSync(outside,'preservar');assert.ok(h.consume({arquivo:outside,apagar:true}).error);assert.equal(fs.readFileSync(outside,'utf8'),'preservar');
});
