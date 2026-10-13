/* nome-conversa.js -- Tarefa 6 (27/09): o que conta como PEDIDO pro nome
   automatico da conversa. UM arquivo so', usado pelos dois lados: o main faz
   require (src/titulo-auto.js monta o pedido ao Haiku) e a tela carrega por
   <script> antes do app.js (window.NomeConversa: a revisao do fim do turno so'
   anda com pedido novo, e o envio so' pede nome no 1o pedido de verdade). Antes
   a tela tinha uma copia da regra; um conserto tinha de ser feito duas vezes.

   Funcoes PURAS, sem DOM e sem Node:
   - semColagem(t): so' a fala da pessoa, sem o que o app cola na mensagem;
   - ehPedidoNomeavel(t): saudacao, "continua", teste de conexao, confirmacao,
     "/comando" e mensagem de skill nao contam. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NomeConversa = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // o mesmo bloco do Responder (app.js, comCitacao/separarCitacao; main.js, semContexto)
  const CITACAO_ABRE = 'Sobre este trecho da sua resposta:';

  /* O que o app cola na mensagem antes de mandar fica gravado junto com a fala:
     o contexto da troca de motor ("Agora, o novo pedido:"), o trecho citado pelo
     Responder (e' da IA, nao pedido seu) e a lista de anexos. Mensagem que o CLI
     injeta como se fosse sua (conteudo de skill, lembrete do sistema) nao e'
     pedido nenhum. Sobra so' a fala da pessoa. */
  function semColagem(t) {
    let s = String(t == null ? '' : t).replace(/\r\n?/g, '\n');
    if (/^\s*(?:Base directory for this skill:|<system-reminder>|<local-command-caveat>|<command-name>|<local-command-stdout>)/i.test(s)) return '';
    const novo = s.indexOf('Agora, o novo pedido:');
    if (novo >= 0) s = s.slice(novo + 'Agora, o novo pedido:'.length);
    s = s.replace(/^\s+/, '');
    if (s.startsWith(CITACAO_ABRE + '\n')) {
      const resto = s.slice(CITACAO_ABRE.length + 1);
      const fim = resto.indexOf('\n\n');
      if (fim >= 0 && resto.slice(0, fim).split('\n').every((l) => l === '>' || l.startsWith('> '))) s = resto.slice(fim + 2);
    }
    const anexos = s.indexOf('Arquivos que anexei');
    if (anexos >= 0) s = s.slice(0, anexos);
    return s.trim();
  }

  /* Sem demanda nao ha' nome pra dar. A lista e' fechada e ancorada: uma
     saudacao seguida de pedido continua entrando ("oi, arruma o login"). Nao
     exige tamanho minimo nem verbo ("PDF", "INSS" sao pedidos). Nenhuma
     expressao da lista e' a juncao de duas outras dela ("pode seguir" ja' casa
     como "pode" + "seguir"): com duas leituras pra mesma frase, uma mensagem com
     a juncao repetida levava tempo exponencial pra ser recusada. */
  const SO_CONVERSA = /^(?:(?:oi|ola|bom dia|boa tarde|boa noite|ok|okay|sim|nao|certo|beleza|blz|obrigad[oa]|valeu|perfeito|pronto|show|top|legal|otimo|fechado|entendi|bora|vamos|continua|continue|continuar|segue|seguir|vai|prossiga|pode fazer|pode|faz isso|isso|isso mesmo|tudo bem|tudo certo|funcionando(?: ai)?|(?:voce )?(?:esta|ta) (?:ai|funcionando)|(?:so )?testando|teste|teste de conexao|e ai)(?:\s+|$))+$/;

  function ehPedidoNomeavel(texto) {
    const limpo = semColagem(texto);
    if (!limpo || limpo.startsWith('/')) return false;   // "/compact", "/model": comando, nao demanda
    const s = limpo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[!?.,;:…]+/g, ' ').replace(/\s+/g, ' ').trim();
    return !!s && !SO_CONVERSA.test(s);
  }

  return { CITACAO_ABRE, semColagem, ehPedidoNomeavel };
});
