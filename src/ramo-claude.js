'use strict';
/* Leva 41 (B3): "voltar para cá" no Claude = ramo DE VERDADE, cortado.

   Antes, voltar para uma mensagem antiga no Claude colava um resumo de 14 mil
   caracteres num painel novo. Agora o arquivo da conversa (.jsonl do Claude
   Code) e' copiado cortado ANTES da mensagem escolhida, com um sessionId novo,
   e o painel novo sobe com --resume nele: o Claude lembra de tudo ate' ali, com
   as ferramentas e os resultados que ele viu, e nada do que veio depois.

   Formato medido nesta maquina (CLI 2.1.270, so' as chaves das linhas):
   - toda linha leva o sessionId; as da conversa levam uuid e parentUuid (o pai
     sempre vem antes no arquivo), e o CLI remonta a conversa andando de pai em
     pai a partir da folha;
   - linhas sem uuid (queue-operation, last-prompt, ai-title, mode, atis-latch)
     sao anotacoes -- a queue-operation carrega o TEXTO do envio, e a last-prompt
     aponta pra folha daquele momento;
   - anexos do envio (hook_success, hook_additional_context) entram na cadeia
     ANTES da fala; os do turno (total_tokens_reminder, prompt_snapshot) depois;
   - compactacao: a linha compact_boundary tem parentUuid null e o elo com o
     que veio antes em logicalParentUuid;
   - sub-agente mora em outro arquivo (<sessao>/subagents/agent-*.jsonl, tudo
     isSidechain) e nao entra aqui.
   O proprio --fork-session do CLI grava o ramo assim: SO' as linhas da cadeia
   ate' a folha, com os MESMOS uuids da origem e o sessionId trocado. O corte
   daqui faz igual, so' que com a folha antes da mensagem escolhida. */

const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/* O que a TELA mostra como fala sua, com as mesmas regras do mensagensDoJsonl
   do main (texto tecnico fora; o contexto colado pela troca de motor sai; so'
   imagem conta como fala sem texto). null = nao aparece como fala sua. */
function textoDaFala(d, ehTecnico, semContexto) {
  if (!d || d.type !== 'user' || !d.message || d.isSidechain) return null;
  const c = d.message.content;
  let t = typeof c === 'string' ? c
    : Array.isArray(c) ? c.filter((x) => x && x.type === 'text').map((x) => x.text).join('\n') : '';
  t = String(t || '').trim();
  if (t && !ehTecnico(t)) return semContexto(t) || t;
  const temImagem = Array.isArray(c) && c.some((x) => x && x.type === 'image' && x.source && x.source.type === 'base64' && x.source.data);
  return temImagem ? '' : null;
}

/* Corta a conversa antes da mensagem escolhida.
   A mensagem e' achada pelo TEXTO (alvo), contando quantas iguais vem depois
   dela na tela (repetidasDepois). Contar so' a posicao erraria: um "/compact"
   aparece na tela como fala sua e no arquivo e' texto tecnico -- a conta do fim
   escorregava um. Sem texto (mensagem so' de imagem), vale a posicao do fim.
   Texto que nao existe no arquivo vira erro: cortar no escuro e' pior do que o
   resumo colado, que a tela usa de reserva.
   Devolve { texto, linhas } | { vazio: true } (nao ha conversa antes) | { erro }. */
function cortarConversa(bruto, o) {
  const op = o || {};
  const idVelho = String(op.idVelho || '');
  const idNovo = String(op.idNovo || '');
  const ehTecnico = op.ehTecnico || (() => false);
  const semContexto = op.semContexto || ((t) => t);
  if (!idVelho || !idNovo) return { erro: 'conversa sem identificação' };

  const itens = [];
  for (const raw of String(bruto || '').split('\n')) {
    if (raw.charCodeAt(0) !== 123) continue;   // so' linha que comeca com chave
    let d; try { d = JSON.parse(raw); } catch { continue; }   // linha pela metade (arquivo sendo escrito)
    itens.push({ raw, d });
  }

  const falas = [];
  itens.forEach(({ d }, i) => {
    const t = textoDaFala(d, ehTecnico, semContexto);
    if (t !== null) falas.push({ i, t: norm(t) });
  });

  let alvoIdx = -1;
  const alvo = norm(op.alvo);
  if (alvo) {
    const iguais = falas.filter((f) => f.t === alvo);
    const k = Math.max(0, Number(op.repetidasDepois) || 0);
    if (iguais.length > k) alvoIdx = iguais[iguais.length - 1 - k].i;
    else return { erro: 'Não achei essa mensagem na conversa gravada.' };
  } else {
    const n = Number(op.doFim) || 0;
    if (n >= 1 && n <= falas.length) alvoIdx = falas[falas.length - n].i;
  }
  if (alvoIdx < 0) return { erro: 'Não achei esse ponto na conversa gravada.' };
  const escolhida = itens[alvoIdx].d;
  if (escolhida.isCompactSummary) return { erro: 'Esse ponto é o resumo automático da conversa; escolha uma mensagem sua.' };

  // so' o que vem ANTES da escolhida pode ficar
  const porUuid = new Map();
  for (let i = 0; i < alvoIdx; i++) {
    const d = itens[i].d;
    if (d && d.uuid && !d.isSidechain) porUuid.set(d.uuid, i);
  }
  const linha = (u) => itens[porUuid.get(u)].d;

  /* A folha e' o pai da escolhida, pulando os anexos: os de hook do envio
     cortado (o contexto que o hook colou pra ELA nao pode sobrar no ramo) e os
     de fim do turno anterior (lembrete de tokens, retrato do prompt), que o CLI
     regrava no proximo envio. Sobra a ultima coisa que o turno anterior disse. */
  let folha = escolhida.parentUuid || null;
  while (folha && porUuid.has(folha) && linha(folha).type === 'attachment') folha = linha(folha).parentUuid || null;
  if (!folha) return { vazio: true };
  if (!porUuid.has(folha)) return { erro: 'A conversa gravada está com um elo faltando nesse ponto.' };

  // a cadeia: de pai em pai ate' a raiz; na compactacao, pelo elo logico
  const cadeia = new Set();
  let u = folha;
  while (u && porUuid.has(u) && !cadeia.has(u)) {
    cadeia.add(u);
    const d = linha(u);
    u = d.parentUuid || d.logicalParentUuid || null;
  }

  /* troca SO' o campo sessionId desta sessao: dentro do texto de uma mensagem
     as aspas vem escapadas (\"), entao o marcador nunca casa la' */
  const marcaVelha = '"sessionId":"' + idVelho + '"';
  const marcaNova = '"sessionId":"' + idNovo + '"';
  const saida = [];
  for (let i = 0; i < alvoIdx; i++) {
    const { raw, d } = itens[i];
    if (!d.uuid || !cadeia.has(d.uuid) || porUuid.get(d.uuid) !== i) continue;
    let nova = raw.split(marcaVelha).join(marcaNova);
    // formato diferente do de sempre (espaco depois dos dois-pontos): regrava a linha
    if (d.sessionId !== idNovo && !nova.includes(marcaNova)) nova = JSON.stringify({ ...d, sessionId: idNovo });
    saida.push(nova);
  }
  if (!saida.length) return { vazio: true };
  return { texto: saida.join('\n') + '\n', linhas: saida.length };
}

module.exports = { cortarConversa, textoDaFala };
