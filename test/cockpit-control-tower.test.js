const test=require('node:test'),assert=require('node:assert/strict');
const {inControlTower,stateOf}=require('../src/renderer/cockpit-ui');
/* A Torre é a visão geral de TODAS as pastas: o que espera você, o que está
   rodando e o que está PRONTO PRA LER. Conversa concluída que ele já leu não
   entra — essa é histórico da pasta.

   Em 21/09/2026 isto chegou a ser alargado para "tudo que não é saved". Não
   sobreviveu à medição: ler zera `uiUnread` mas não `uiCompleted`, então nada
   saía mais da Torre — com o config real ela nascia com 18 linhas de conversas
   velhas já lidas, contra um teto visível de 15. Voltou a valer `uiUnread`.
   O que fazia a Torre mudar ao trocar de pasta era outra coisa (a chave, a
   ordem e a ficha sem estado) — ver test/torre-estavel-medidas.test.js. */
test('torre: atenção e atividade sempre aparecem; concluídas apenas enquanto não lidas',()=>{
 for(const state of ['attention','working'])assert.equal(inControlTower({state,p:{}}),true);
 assert.equal(inControlTower({state:'done',p:{uiUnread:true}}),true);
 assert.equal(inControlTower({state:'done',p:{uiUnread:false}}),false,'já lida é histórico, não Torre');
 assert.equal(inControlTower({state:'saved',p:{}}),false);
 assert.equal(inControlTower({state:'done',f:{uiUnread:true}}),true);
 assert.equal(inControlTower({state:'saved',f:{}}),false);
});
test('uma conclusão antiga não esconde uma nova permissão ou execução',()=>{
 const p={uiUnread:true,uiCompleted:true,busy:true};assert.equal(stateOf(p),'working');
 p.pedindoPerm=true;assert.equal(stateOf(p),'attention');
});
