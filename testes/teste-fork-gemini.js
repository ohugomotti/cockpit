/* O ramo do Gemini e' uma COPIA do arquivo de conversa, com id novo e corte
   opcional na K-esima fala sua CONTANDO DO FIM. Este teste roda a funcao REAL
   (extraida do main.js) contra um arquivo de verdade em pasta temporaria e
   confere: o corte cai no lugar certo, o id troca so' onde e' id (texto de
   mensagem que contenha "sessionId" fica intacto) e o nome do arquivo novo
   carrega os 8 primeiros do id (e' por eles que acharArquivoSessao acha). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { RAIZ, pegarBloco, lerFonte } = require('./raiz');

let falhas = 0;
const checa = (nome, cond, det) => {
  if (cond) console.log('  ok   ' + nome);
  else { falhas++; console.log('  FALHA ' + nome + (det ? ' -> ' + det : '')); }
};

const main = lerFonte('main.js');

// pasta temporaria com um arquivo de conversa sintetico no formato do CLI
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-gemini-'));
const ID = 'aaaabbbb-cccc-dddd-eeee-ffff00001111';
const arq = path.join(tmp, 'session-2026-09-06-aaaabbbb.jsonl');
const L = [
  JSON.stringify({ sessionId: ID, projectHash: 'x' }),
  JSON.stringify({ $set: { sessionId: ID, messages: [
    { id: 'm1', type: 'user', content: 'primeira pergunta' },
    { id: 'm2', type: 'gemini', content: 'primeira resposta' },
  ] } }),
  JSON.stringify({ id: 'm3', type: 'user', content: 'segunda pergunta com "sessionId":"' + ID + '" colado no texto' }),
  JSON.stringify({ id: 'm4', type: 'gemini', content: 'segunda resposta' }),
  JSON.stringify({ id: 'm5', type: 'user', content: 'terceira pergunta' }),
  JSON.stringify({ id: 'm6', type: 'gemini', content: 'terceira resposta' }),
];
fs.writeFileSync(arq, L.join('\n') + '\n');

// contexto com as dependencias REAIS da funcao
const ctx = {
  fs, path, os,
  crypto: require('crypto'),
  acharArquivoSessao: (eng, id) => (id === ID ? arq : ''),
  console,
};
vm.createContext(ctx);
vm.runInContext(pegarBloco(main, 'function cliFalaDeGente(', 'cliFalaDeGente'), ctx);
/* cliTexto e' arrow SEM chaves: o contador de chaves do pegarBloco nao serve
   (armadilha ja conhecida do andaime). Recorte por ancora textual do fim. */
const iC = main.indexOf('const cliTexto =');
const fimC = main.indexOf("''));", iC);
if (iC < 0 || fimC < 0) { console.log('  FALHA nao achei cliTexto no fonte'); process.exit(1); }
vm.runInContext(main.slice(iC, fimC + "''));".length), ctx);
vm.runInContext(pegarBloco(main, 'function forkGemini(', 'forkGemini'), ctx);

console.log('1) fork da conversa INTEIRA');
const r1 = vm.runInContext('forkGemini("' + ID + '", null)', ctx);
checa('devolve id novo', r1 && r1.id && r1.id !== ID, JSON.stringify(r1));
const arq1 = path.join(tmp, 'session-2026-09-06-' + r1.id.slice(0, 8) + '.jsonl');
checa('o arquivo novo carrega os 8 primeiros do id', fs.existsSync(arq1));
const t1 = fs.readFileSync(arq1, 'utf8');
checa('o id novo assumiu no cabecalho', t1.includes('"sessionId":"' + r1.id + '"'));
checa('o id velho sumiu do cabecalho', !t1.split('\n')[0].includes(ID));
checa('a conversa inteira veio junto (terceira pergunta esta la)', t1.includes('terceira pergunta'));

console.log('\n2) corte na 2a fala do FIM (mantem ate a "segunda pergunta")');
const r2 = vm.runInContext('forkGemini("' + ID + '", 2)', ctx);
checa('devolve id novo', r2 && r2.id, JSON.stringify(r2));
const arq2 = path.join(tmp, 'session-2026-09-06-' + r2.id.slice(0, 8) + '.jsonl');
const t2 = fs.readFileSync(arq2, 'utf8');
checa('mantem a segunda pergunta', t2.includes('segunda pergunta'));
checa('NAO leva a segunda resposta (o corte e ATE a fala sua)', !t2.includes('segunda resposta'));
checa('NAO leva a terceira pergunta', !t2.includes('terceira pergunta'));
checa('as falas de dentro do $set contam na conta', t2.includes('primeira resposta'));

console.log('\n3) corte na 3a fala do FIM (so a primeira pergunta, que mora no $set)');
const r3 = vm.runInContext('forkGemini("' + ID + '", 3)', ctx);
const t3 = fs.readFileSync(path.join(tmp, 'session-2026-09-06-' + r3.id.slice(0, 8) + '.jsonl'), 'utf8');
checa('a linha do $set fica (a 1a pergunta mora nela)', t3.includes('primeira pergunta'));
checa('nada depois do $set', !t3.includes('segunda pergunta'));

console.log('\n4) fora do alcance e id errado falham com recado, nao com lixo');
const r4 = vm.runInContext('forkGemini("' + ID + '", 9)', ctx);
checa('corte alem do total vira erro claro', r4 && r4.error, JSON.stringify(r4));
const r5 = vm.runInContext('forkGemini("nao-existe", null)', ctx);
checa('conversa inexistente vira erro claro', r5 && r5.error);

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log('\n' + (falhas ? falhas + ' FALHA(S)' : 'fork do Gemini corta e batiza certo'));
process.exit(falhas ? 1 : 0);
