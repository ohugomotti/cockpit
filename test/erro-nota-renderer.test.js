'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {lerFonte,pegarBloco}=require('../testes/raiz');
test('nota visual nunca mostra object Object e usa texto seguro, sem HTML',()=>{
 const context={};vm.createContext(context);
 vm.runInContext(pegarBloco(lerFonte('renderer/app.js'),'function textoDaNota(','textoDaNota'),context);
 assert.equal(context.textoDaNota({message:'Falha de conexão'}),'Falha de conexão');
 assert.equal(context.textoDaNota({error:{message:'Conexão encerrada'}}),'Conexão encerrada');
 assert.equal(context.textoDaNota({unexpected:true}),'Não foi possível concluir a operação. Tente novamente.');
 assert.equal(context.textoDaNota('[object Object]'),'Não foi possível concluir a operação. Tente novamente.');
 assert.equal(context.textoDaNota('Texto legível'),'Texto legível');
});
