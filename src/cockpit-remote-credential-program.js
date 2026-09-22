'use strict';
const {inspectCredential,sameCredentialAccount,publicCredentialState}=require('./cockpit-credentials');
// Serialized into a one-shot Node program. Paths are arguments; credentials never enter commands.
function remoteProfilesMain(){
 const fs=require('fs'),path=require('path'),crypto=require('crypto');
 const [dir,cred,nome,acao]=process.argv.slice(1);
 const read=f=>{try{return fs.readFileSync(f,'utf8')}catch{return null}};
 const write=(f,t)=>{fs.mkdirSync(path.dirname(f),{recursive:true,mode:0o700});const tmp=f+'.cockpit-'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(tmp,t,{mode:0o600,flag:'wx'});fs.renameSync(tmp,f)}finally{try{fs.unlinkSync(tmp)}catch{}}};
 const text=read(cred),active=inspectCredential('claude',text);
 const profiles=()=>{
  let names=[];try{names=fs.readdirSync(dir)}catch{}
  return names.filter(f=>/^claude__[A-Za-z0-9%._~-]+\.json$/.test(f)).flatMap(f=>{
   let apelido;try{apelido=decodeURIComponent(f.slice(8,-5))}catch{return[]}
   const file=path.join(dir,f),raw=read(file);let info=inspectCredential('claude',raw),avisoSincronizacao;
   const atual=sameCredentialAccount(info,active);
   if(atual&&raw!==text&&active.podeUsar&&(!active.expiresAt||active.expiresAt>Date.now())&&read(cred)===text&&read(file)===raw){try{write(file,text);info=active}catch{avisoSincronizacao='Não foi possível atualizar a cópia guardada. A credencial ativa foi preservada.'}}
   return[{file,apelido,atual,info,avisoSincronizacao}];
  });
 };
 try{
  if(acao==='listar')for(const p of profiles())console.log('COCKPIT_PERFIL\t'+Buffer.from(JSON.stringify({apelido:p.apelido,atual:p.atual,...publicCredentialState(p.info),...(p.avisoSincronizacao?{avisoSincronizacao:p.avisoSincronizacao}:{})})).toString('base64'));
  else if(acao==='disponivel')console.log(active.valido&&active.podeUsar?'COCKPIT_SIM':'COCKPIT_NAO');
  else if(acao==='salvar'){
   if(!active.valido||!active.podeUsar)console.log('COCKPIT_SEM_CONTA');
   else{const file=path.join(dir,nome),old=read(file);
    if(old!=null&&!sameCredentialAccount(inspectCredential('claude',old),active))console.log('COCKPIT_APELIDO_USADO');
    else{fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.chmodSync(dir,0o700);write(file,text);console.log('COCKPIT_OK')}
   }
  } else if(acao==='trocar'){
   profiles();const saved=read(path.join(dir,nome)),info=inspectCredential('claude',saved);
   if(saved===null)console.log('COCKPIT_SEM_CONTA');
   else if(!info.valido)console.log('COCKPIT_CORROMPIDA');
   else if(!info.podeUsar)console.log('COCKPIT_EXPIRADA');
   else{write(cred,saved);console.log('COCKPIT_OK')}
  } else if(acao==='esquecer'){fs.rmSync(path.join(dir,nome),{force:true});console.log('COCKPIT_OK')}
 }catch{console.log('COCKPIT_ERRO_OPERACAO')}
}
function program(){return [inspectCredential.toString(),sameCredentialAccount.toString(),publicCredentialState.toString(),'('+remoteProfilesMain.toString()+')()'].join('\n');}
module.exports={program};
