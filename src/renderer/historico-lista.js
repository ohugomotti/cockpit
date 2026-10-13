(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HistoricoLista = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const PERIODOS = ['Hoje', 'Esta semana', 'Este mês', 'Anteriores'];
  function periodo(ms, agora = new Date()) {
    const data = Number(ms);
    if (!Number.isFinite(data) || data <= 0) return 'Anteriores';
    const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    const semana = new Date(hoje);
    semana.setDate(semana.getDate() - (semana.getDay() + 6) % 7);
    const mes = new Date(agora.getFullYear(), agora.getMonth(), 1);
    if (data >= hoje.getTime()) return 'Hoje';
    if (data >= semana.getTime()) return 'Esta semana';
    if (data >= mes.getTime()) return 'Este mês';
    return 'Anteriores';
  }
  function grupos(itens, agora = new Date()) {
    const mapa = new Map(PERIODOS.map(p => [p, []]));
    for (const item of [...itens].sort((a, b) => (Number(b.when) || 0) - (Number(a.when) || 0))) {
      mapa.get(periodo(item.when, agora)).push(item);
    }
    return [...mapa].filter(([, itens]) => itens.length).map(([nome, itens]) => ({ nome, itens }));
  }
  const VAZIAS = new Set('eu você voce quero queria preciso gostaria pode poderia alguns algumas um uma o a os as de do da dos das no na nos nas com para pra por em que e me fazer favor porfavor'.split(' '));
  function curto(texto) {
    const limpo = String(texto || '').replace(/\s+/g, ' ').trim();
    if (!limpo) return 'Conversa guardada';
    if (limpo.split(' ').length <= 3) return limpo;
    const palavras = limpo.replace(/^[#>*\s]+/, '').split(' ');
    const uteis = palavras.filter(p => !VAZIAS.has(p.toLocaleLowerCase('pt-BR').replace(/[.,:;!?]/g, '')));
    return (uteis.length ? uteis : palavras).slice(0, 3).join(' ').replace(/[,;:.!?\s]+$/, '').slice(0, 60).trim() || 'Conversa guardada';
  }
  function preparar(s, ligado = true) {
    if (!s || !ligado || s.nome || s.nomeCustomizado) return s;
    const original = s.tituloOriginal || s.title || 'Conversa guardada';
    // guardião do Codex (o main marca a ficha) não tem assunto: o Haiku só voltaria "sem-assunto", então nunca é revisado
    const precisa = !s.guardiao && (!s.tituloAuto || String(original).trim().split(/\s+/).length > 3);
    return { ...s, title: curto(original), tituloOriginal: original, revisarNome: precisa };
  }
  /* Decisão do Hugo (01/10): o Haiku só renomeia as 30 conversas mais recentes de cada pasta.
     Sem teto, abrir uma pasta com 481 conversas punha as 481 na fila, e cada uma lê a conversa
     inteira e chama o Haiku (R3-01). As antigas ficam para o mutirão (tools/nomes/mutirao.js). */
  const TETO_REVISAO_POR_PASTA = 30;
  function fila({ ligado, revisar, salvar, atualizar, identidade }) {
    const pendentes = new Map(), feitos = new Set(), ativos = new Set();
    let rodando = false;
    async function executar() {
      if (rodando) return;
      rodando = true;
      try {
        while (pendentes.size && ligado()) {
          const [chave, s] = pendentes.entries().next().value;
          pendentes.delete(chave);
          ativos.add(chave);
          const resultado = await revisar(s, chave).catch(() => null);
          ativos.delete(chave);
          if (!ligado()) break;
          if (!resultado || resultado.acao === 'erro' || resultado.acao === 'cancelado' || resultado.motivo === 'sem-claude' || resultado.motivo === 'sem-conta') break;
          feitos.add(chave);
          if (resultado?.acao === 'manual' && resultado.titulo) { atualizar(s, resultado.titulo, true); continue; }
          if (resultado?.acao !== 'nome' || !resultado.titulo) continue;
          const salvo = await salvar(s, resultado.titulo).catch(() => null);
          if (salvo === true || salvo?.ok === true) atualizar(s, resultado.titulo, false);
          else if (salvo?.manual && salvo.nome) atualizar(s, salvo.nome, true);
          else feitos.delete(chave);
        }
      } finally { rodando = false; }
    }
    return {
      adicionar(itens) {
        if (!ligado()) return;
        // cada chamada é uma pasta: só as mais recentes entram, estejam nomeadas ou não. Quem já entrou
        // (pendentes/ativos) ou já foi revisado (feitos) não volta, então a janela não anda a cada chamada.
        // O guardião do Codex sai ANTES do sort e do teto: dezenas dele numa pasta ocupavam as 30 vagas e as reais ficavam de fora.
        for (const s of [...itens].filter(item => !item.guardiao).sort((a, b) => (Number(b.when) || 0) - (Number(a.when) || 0)).slice(0, TETO_REVISAO_POR_PASTA)) {
          const chave = identidade(s);
          if (s.revisarNome && !s.nome && !feitos.has(chave) && !ativos.has(chave)) pendentes.set(chave, s);
        }
        void executar();
      },
      tamanho: () => pendentes.size,
    };
  }
  return { PERIODOS, TETO_REVISAO_POR_PASTA, periodo, grupos, curto, preparar, fila };
});
