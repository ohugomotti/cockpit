'use strict';
/* Reabrir traz a conversa inteira (Tarefa 5, 26/09/2026; porte do Cockpit do
   Homero, commits 22a9756, 89ede8d e fa161ce).

   Antes: o Claude lia so' os ultimos 6 MB do arquivo da conversa e todo motor
   devolvia so' os ultimos 60 itens -- e cada Edit, Bash ou Read conta como
   item. Numa conversa de trabalho as ferramentas comiam as 60 vagas, e o que
   sumia era justamente a CONVERSA (medido pelo Homero em 03/09: 10 falas dele
   + 59 respostas + 363 ferramentas voltavam como 4 falas e 11 respostas).

   Agora o arquivo e' lido INTEIRO, em blocos (varrerLinhas), e o corte e' por
   contagem de FALAS (cortarHistorico): as ultimas 600 voltam todas; das
   ferramentas, so' as mais antigas saem, ate' sobrarem 250. */
const fs = require('fs');

const respirar = () => new Promise((r) => setImmediate(r));

/* Le o arquivo em blocos (fs.readSync, 256 KB por vez) e entrega uma linha
   por chamada de aoLer, sem montar uma string do tamanho do arquivo.
   - Linha partida entre blocos: os pedacos ficam guardados e sao juntados UMA
     vez so', quando o fim dela chega. Emendar texto a cada bloco sai
     quadratico numa linha de base64 de varios MB.
   - A quebra e' procurada no BYTE (10): em UTF-8 ele nunca aparece dentro de
     uma letra de varios bytes, entao a letra cortada entre dois blocos volta
     inteira quando a linha e' decodificada.
   - A cada respiroMs de trabalho devolve o controle (setImmediate): enquanto
     uma conversa de 50 MB e' lida, o resto do app (outro IPC, a fila, os
     motores) continua andando.
   - Le ate' o tamanho que o arquivo tinha ao abrir: a conversa que esta
     sendo escrita agora nao vira leitura sem fim.
   Devolve false se nao conseguiu abrir ou ler (arquivo sumiu, sem permissao).
   Erro de quem le a linha (aoLer) nao e' engolido. */
async function varrerLinhas(arquivo, aoLer, { bloco = 256 * 1024, respiroMs = 8 } = {}) {
  let fd;
  try { fd = fs.openSync(arquivo, 'r'); } catch { return false; }
  try {
    let tamanho;
    try { tamanho = fs.fstatSync(fd).size; } catch { return false; }
    let pos = 0;
    let partes = [];   // pedacos da linha que ainda nao terminou
    let desde = Date.now();
    // a conta do tempo e' feita aqui mesmo: so' nasce promessa quando vai
    // respirar de verdade (uma por linha pesava e, no Node 24 desta maquina,
    // ajudava a disparar a queda nativa do CleanupQueue nos testes)
    while (pos < tamanho) {
      // bloco novo a cada leitura: os pedacos guardados em "partes" apontam
      // pra dentro do anterior e nao podem ser sobrescritos
      const buf = Buffer.allocUnsafe(Math.min(bloco, tamanho - pos));
      let n;
      try { n = fs.readSync(fd, buf, 0, buf.length, pos); } catch { return false; }
      if (!n) break;
      pos += n;
      let ini = 0, fim;
      while ((fim = buf.indexOf(10, ini)) >= 0 && fim < n) {
        const pedaco = buf.subarray(ini, fim);
        const linha = partes.length ? Buffer.concat([...partes, pedaco]).toString('utf8') : pedaco.toString('utf8');
        partes = [];
        ini = fim + 1;
        aoLer(linha);
        if (Date.now() - desde >= respiroMs) { await respirar(); desde = Date.now(); }
      }
      if (ini < n) partes.push(buf.subarray(ini, n));
      if (Date.now() - desde >= respiroMs) { await respirar(); desde = Date.now(); }
    }
    // a ultima linha pode nao ter a quebra no fim
    if (partes.length) aoLer(Buffer.concat(partes).toString('utf8'));
    return true;
  } finally { try { fs.closeSync(fd); } catch {} }
}

/* Quanto da conversa volta. Quem manda no corte e' a FALA (voce ou a IA): as
   ultimas maxFalas voltam todas, e das ferramentas so' as mais ANTIGAS saem,
   ate' sobrarem maxFerramentas. A ordem original nao muda.
   cortou = alguma FALA ficou de fora. Ferramenta podada nao conta: a tela nem
   desenha ferramenta de conversa reaberta, e a nota diria "ultimas 600 falas"
   numa conversa que voltou inteira. */
function cortarHistorico(msgs, maxFalas = 600, maxFerramentas = 250) {
  const lista = Array.isArray(msgs) ? msgs : [];
  const ehFerramenta = (m) => !!m && m.role === 'tool';
  // de tras pra frente: onde comeca o trecho com as ultimas maxFalas falas
  let falas = 0, ini = 0;
  for (let i = lista.length - 1; i >= 0; i--) {
    if (ehFerramenta(lista[i])) continue;
    if (++falas > maxFalas) { ini = i + 1; break; }
  }
  let falasOcultas = 0;
  for (let i = 0; i < ini; i++) if (!ehFerramenta(lista[i])) falasOcultas++;
  let trecho = lista.slice(ini);
  let sobra = trecho.filter(ehFerramenta).length - maxFerramentas;
  if (sobra > 0) trecho = trecho.filter((m) => !(ehFerramenta(m) && sobra-- > 0));
  return { msgs: trecho, cortou: falasOcultas > 0, falasOcultas };
}

/* O que volta pra tela ao reabrir: o corte acima e, se alguma fala ficou de
   fora, uma nota na FRENTE dizendo isso (nota, nao fala de ninguem). Erro
   ({ error }) passa direto: a tela mostra o motivo. */
function historicoParaTela(msgs, maxFalas = 600, maxFerramentas = 250) {
  if (!Array.isArray(msgs)) return msgs;
  const r = cortarHistorico(msgs, maxFalas, maxFerramentas);
  if (!r.cortou) return r.msgs;
  return [{ role: 'note', text: 'Mostrando as últimas ' + maxFalas + ' falas desta conversa.' }, ...r.msgs];
}

module.exports = { varrerLinhas, cortarHistorico, historicoParaTela };
