/* Texto de apresentação; nunca escolhe ou substitui o modelo da conversa. */
(function (root) {
  'use strict';
  const descriptions = {
    'gpt-6.1-sol': 'Modelo atual para programação e trabalho diário.',
    'gpt-6-astra': 'Para problemas difíceis e trabalhos mais exigentes.',
    'gpt-6-sol': 'Geração anterior para programação e trabalho diário.',
    'gpt-6-luna': 'Rápido e econômico para tarefas simples.',
    'gpt-5.6-sol': 'Geração anterior para programação.',
    'gpt-5.6-terra': 'Geração anterior para tarefas bem definidas.',
    'gpt-5.6-luna': 'Geração anterior, rápida e econômica.',
    'gpt-5.5': 'Modelo anterior para programação.',
    'claude-opus-5-5': 'Para programação e trabalhos complexos.',
    'claude-fable-5-1': 'Para os trabalhos mais difíceis e demorados.',
    'claude-sonnet-5-5': 'Equilíbrio entre rapidez e capacidade.',
    'claude-haiku-5-5': 'Respostas rápidas para tarefas simples.',
    'claude-haiku-4-5-20251001': 'Geração anterior para respostas rápidas.',
    'claude-haiku-4-5': 'Geração anterior para respostas rápidas.',
    'claude-opus-5': 'Geração anterior para trabalhos complexos.',
    'claude-sonnet-5': 'Geração anterior para o trabalho diário.',
    'claude-fable-5': 'Geração anterior para trabalhos exigentes.',
  };
  function present(model, engine) {
    const id = String(model.id || ''), base = id.replace(/\[1m\]$/i, '');
    const claude = base.match(/^claude-(opus|sonnet|fable|haiku)-(\d+)(?:-(\d)(?=-|$))?/);
    let name = String(model.nome || id);
    if (engine === 'claude' && claude) {
      name = claude[1][0].toUpperCase() + claude[1].slice(1) + ' ' + claude[2] + (claude[3] ? '.' + claude[3] : '');
      if (/\[1m\]$/i.test(id)) name += ' (1M)';
    } else if (engine === 'codex') name = name.replace(/^GPT-/, 'GPT‑').replace(/-(Sol|Astra|Luna|Terra)$/i, ' $1');
    // Catálogos novos continuam utilizáveis sem despejar descrições em inglês.
    const description = descriptions[base] || (['codex','claude'].includes(engine)
      ? 'Modelo informado pelo ' + (engine === 'claude' ? 'Claude' : 'Codex') + ' deste destino.' : String(model.desc || ''));
    return { name, description };
  }
  function withCurrent(models, current, fallback) {
    const visible = models.filter(m => !m.hidden || m.id === current);
    if (!current || visible.some(m => m.id === current)) return visible;
    const old = (fallback || []).find(m => m.id === current);
    return [...visible, { ...old, id: current, nome: old?.nome || current,
      efforts: old?.efforts || [], preserved: true }];
  }
  const quotaSources = {
    codex: 'https://learn.chatgpt.com/docs/pricing',
    claude: 'https://support.claude.com/en/articles/14552983-models-usage-and-limits-in-claude-code',
  };
  function canonical(model) {
    return String(model.resolvedModel || model.id || '').toLowerCase().replace(/\[1m\]$/, '').replace(/-\d{8}$/, '');
  }
  function quota(model, engine) {
    const id = canonical(model);
    let rank = null;
    // Comparação relativa de cota incluída, conferida em 29/09/2026.
    // Preços de API e créditos avulsos não são convertidos em cota.
    if (engine === 'codex') rank = {'gpt-6-luna':1,'gpt-6.1-sol':2,'gpt-6-sol':2,'gpt-6-astra':3}[id] || null;
    if (engine === 'claude') {
      const family = id.match(/^claude-(haiku|sonnet|opus)-/);
      if (family) rank = {haiku:1,sonnet:2,opus:3}[family[1]];
    }
    return {rank, label:rank ? ['','Cota menor','Cota média','Cota maior'][rank] : 'Cota sem comparação',
      source:quotaSources[engine],
      detail:'Comparação relativa entre modelos deste motor. O gasto real depende do tamanho da conversa, da tarefa e do esforço. Não há um percentual fixo por mensagem.'};
  }
  function metrics(model, engine, comparison) {
    const benchmark = comparison?.models?.find(m => m.id === canonical(model) && m.engine === engine);
    const cost = quota(model,engine);
    const effort = benchmark?.variant?.replace('max','máx.').replace('xhigh','extra alto').replace('with fallback','com fallback').replace('Non-reasoning','sem raciocínio');
    const brief = benchmark?.variant?.replace('max','máx.').replace('xhigh','extra alto').replace('high','alto').replace('medium','médio').replace('low','leve').replace('with fallback','c/ fallback').replace('Non-reasoning','sem raciocínio');
    return {benchmark,quota:cost,
      label:(benchmark ? 'AA '+benchmark.score+(benchmark.preliminary?'*':'')+(brief?' ('+brief+')':'') : 'Sem nota AA')+' · '+cost.label,
      detail:(benchmark ? 'Maior nota medida no Artificial Analysis: '+benchmark.score+'. Configuração testada: '+(effort || 'padrão')+'. Isso não muda seu esforço selecionado. ' : 'Este modelo ainda não tem uma nota comparável nesta leitura. ')+cost.detail};
  }
  function ordered(models, engine, comparison, order='power') {
    return models.map((model,index) => ({model,index,...metrics(model,engine,comparison)})).sort((a,b) => {
      if (order === 'quota') {
        const gap=(a.quota.rank ?? Infinity)-(b.quota.rank ?? Infinity);
        if (gap && !Number.isNaN(gap)) return gap;
      }
      const gap=(b.benchmark?.score ?? -1)-(a.benchmark?.score ?? -1);
      return gap || a.index-b.index;
    }).map(row => row.model);
  }
  /* Leva 4 (UI 3.1): o texto do chip do modelo. No Claude, a sigla do rodape "Use:" (H5, S5, O5, O5.5, F5.1; a versao 1M
     tem a mesma sigla, o nome inteiro vai no hover); nos outros motores, o nome curto da apresentacao.
     Leva 5f: a sigla sai em MAIUSCULA, igual ao CLAUDE.md (antes: h5, s5, o5, o5.5, f5.1). siglaClaude() recebe o id ja sem o [1m]
     e devolve '' quando o id nao segue o padrao (o short() cai no nome, e o familia() fica sem sigla). */
  function siglaClaude(id) {
    if (/^claude-haiku-4-5(?:-|$)/.test(id)) return 'H5';
    const c = id.match(/^claude-(opus|sonnet|fable|haiku)-(\d+)(?:-(\d)(?=-|$))?/);
    return c ? (c[1][0] + c[2] + (c[3] ? '.' + c[3] : '')).toUpperCase() : '';
  }
  function short(model, engine) {
    if (engine === 'claude') {
      const sigla = siglaClaude(String(model?.id || '').replace(/\[1m\]$/i, ''));
      if (sigla) return sigla;
    }
    return present(model || {}, engine).name;
  }
  /* Leva 5f (decisao do Hugo, 07/10): a identidade do modelo no chip e' o icone de traco da familia + o anel de peso, sem sigla nem nome.
     O peso e' FIXO por familia (nao e' o esforco de raciocinio da sessao, que continua Leve a Maximo no menu): vem da classe de cota do
     quota() -- Haiku 1, Sonnet 2, Opus 3, Luna 1, Sol 2, Astra 3 --; Fable 4 pela descricao do Cockpit ("os trabalhos mais dificeis e
     demorados") e Terra 2 por estimativa. 'icone' e' o NOME do desenho em ICONES (app.js). */
  const identidades = {
    haiku: { icone: 'leaf', peso: 1 }, sonnet: { icone: 'feather', peso: 2 }, opus: { icone: 'music', peso: 3 }, fable: { icone: 'fox', peso: 4 },
    luna: { icone: 'moon', peso: 1 }, sol: { icone: 'sun', peso: 2 }, terra: { icone: 'globe', peso: 2 }, astra: { icone: 'star', peso: 3 },
  };
  /* { familia, icone, peso, sigla } ou null. Puro, sem DOM. A versao 1M, o Haiku com data no id e as outras versoes caem na mesma familia
     (o canonical() tira o [1m] e a data; vale o resolvedModel, como no quota()). No Claude a familia e' o claude-(opus|sonnet|fable|haiku)
     do id; no Codex, o sufixo -luna/-sol/-terra/-astra de um id gpt-. Fora da tabela (outro id, Gemini, Grok, ACP, sem o motor): null,
     e o chip fica com o texto de sempre, sem icone inventado. Quem nao tem sigla (todo o Codex) devolve '' nela: o hover so' leva o nome. */
  function familia(model, engine) {
    const id = canonical(model || {});
    const nome = engine === 'claude' ? (id.match(/^claude-(opus|sonnet|fable|haiku)-/) || [])[1]
      : engine === 'codex' ? (id.match(/^gpt-.*-(luna|sol|terra|astra)$/) || [])[1] : undefined;
    if (!nome) return null;
    return { familia: nome, icone: identidades[nome].icone, peso: identidades[nome].peso, sigla: engine === 'claude' ? siglaClaude(id) : '' };
  }
  /* O peso sai como "N de 4" (o hover do chip escreve "peso 2 de 4"), nunca como palavra: leve, medio, alto e maximo sao os nomes do seletor de
     Esforco, e na mesma linha do hover o peso fixo do modelo parecia o esforco de raciocinio da sessao (auditoria 2, leva 5f). Fora de 1 a 4: ''. */
  const ESCALA_DO_PESO = 4;
  function pesoPorExtenso(peso) { return Number.isInteger(peso) && peso >= 1 && peso <= ESCALA_DO_PESO ? peso + ' de ' + ESCALA_DO_PESO : ''; }
  const api = { present, withCurrent, metrics, ordered, quota, quotaSources, short, familia, pesoPorExtenso };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CockpitModels = api;
})(typeof window !== 'undefined' ? window : globalThis);
