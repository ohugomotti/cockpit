'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {inspectCredential,sameCredentialAccount,publicCredentialState}=require('./cockpit-credentials');
function atomicWrite(file,text) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=file+'.cockpit-'+crypto.randomUUID()+'.tmp';
  try { fs.writeFileSync(temp,text,{mode:0o600,flag:'wx'});fs.renameSync(temp,file); }
  finally { try{fs.unlinkSync(temp);}catch{} }
}
function createCredentialStore({folder,activePath,now=Date.now,validate=(engine,text)=>inspectCredential(engine,text,now())}) {
  const supported=engine=>['claude','codex'].includes(engine);
  function read(file){try{return fs.readFileSync(file,'utf8');}catch{return null;}}
  function name(engine,nickname){
    if(!supported(engine))throw Error('Este motor não tem contas guardadas pelo Cockpit.');
    const n=String(nickname??'').trim();if(!n||n.length>40)throw Error('Dê um apelido de até 40 caracteres.');
    return path.join(folder(),engine+'__'+encodeURIComponent(n)+'.json');
  }
  function list(engine){
    if(!supported(engine))return[];
    const active=read(activePath(engine)),current=validate(engine,active);
    let files=[];try{files=fs.readdirSync(folder());}catch{return[];}
    return files.filter(f=>f.startsWith(engine+'__')&&f.endsWith('.json')).flatMap(f=>{
      let apelido;try{apelido=decodeURIComponent(f.slice(engine.length+2,-5));}catch{return[];}
      const file=path.join(folder(),f),text=read(file),info=validate(engine,text);
      const atual=sameCredentialAccount(info,current);
      // The active engine file is authoritative only for a proven matching identity.
      // Never replace a usable snapshot with an expired access token.
      let effective=info,avisoSincronizacao;
      if(atual&&active!==text&&current.valido&&current.podeUsar&&(!current.expiresAt||current.expiresAt>now())){
        if(read(activePath(engine))===active&&read(file)===text){try{atomicWrite(file,active);effective=current;}catch{avisoSincronizacao='Não foi possível atualizar a cópia guardada desta conta. A credencial ativa foi preservada.';}}
      }
      return[{apelido,atual,...publicCredentialState(effective),...(avisoSincronizacao?{avisoSincronizacao}:{})}];
    }).sort((a,b)=>a.apelido.localeCompare(b.apelido));
  }
  function save(engine,nickname){
    const file=name(engine,nickname),text=read(activePath(engine)),info=validate(engine,text);
    if(!info.valido||!info.podeUsar)return{error:info.motivo};
    const previous=read(file);
    if(previous!=null&&!sameCredentialAccount(validate(engine,previous),info))return{error:'Esse apelido já pertence a outra conta. Escolha outro apelido para preservar a cópia guardada.'};
    atomicWrite(file,text);return{ok:true};
  }
  function change(engine,nickname){
    const file=name(engine,nickname);if(!fs.existsSync(file))return{error:'Essa conta não está mais guardada.'};
    // Preserve any trustworthy refreshed snapshot of the account being left.
    list(engine);
    const text=read(file),info=validate(engine,text);
    if(!info.valido||!info.podeUsar)return{error:info.motivo};
    atomicWrite(activePath(engine),text);return{ok:true};
  }
  function forget(engine,nickname){fs.unlinkSync(name(engine,nickname));return{ok:true};}
  return{list,save,change,forget,readActive:engine=>supported(engine)?read(activePath(engine)):null};
}
module.exports={atomicWrite,createCredentialStore};
