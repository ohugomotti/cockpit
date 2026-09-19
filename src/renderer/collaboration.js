/* Componentes comuns; os protocolos e históricos nativos continuam separados. */
(() => {
  'use strict';
  let current = null, healthGeneration = 0, agentsGeneration = 0;
  const DEBATEDORES = ['codex', 'claude'];
  const outroDebatedor = engine => DEBATEDORES.find(e => e !== engine);
  const labels = { ready: 'Pronto para começar', running: 'Em discussão', completed: 'Rodadas concluídas', interrupted: 'Interrompido', failed: 'Parou com erro' };
  const agentLabels = { running: 'Trabalhando', pending: 'Aguardando', completed: 'Concluído', failed: 'Falhou', interrupted: 'Interrompido', unknown: 'Sem estado confirmado', waiting: 'Aguardando' };
  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; };
  function check(result) { if (!result || (result.error && !result.id)) throw new Error(result?.error || 'O Cockpit não respondeu.'); return result; }
  function button(text, cls, fn) { const b = el('button', cls, text); b.type = 'button'; if (fn) b.addEventListener('click', fn); return b; }
  function errorIn(box, error) { box.textContent = String(error.message || error); box.hidden = false; }
  const nome = engine => (engine === 'user' ? 'Você' : (typeof nomeDoMotor === 'function' ? nomeDoMotor(engine) : String(engine || '')));
  const logo = engine => { const s = el('span', 'co-logo'); if (typeof marcaDoMotor === 'function' && DEBATEDORES.includes(engine)) s.innerHTML = marcaDoMotor(engine); return s; };
  function dialog(title, subtitle) {
    const d = el('dialog', 'co-dialog'); const h = el('header', 'co-dialog-head');
    const titles = el('div'); titles.append(el('h2', '', title), el('p', '', subtitle));
    const x = button('Fechar', 'co-close', () => d.close()); h.append(titles, x); d.append(h);
    /* tecla digitada aqui dentro e' do dialogo. Sem isto ela subia ate' os
       ouvintes globais do app: o Esc parava a IA de OUTROS paineis e os atalhos
       agiam por baixo. O Esc nativo do <dialog> continua fechando so' ele. */
    d.addEventListener('keydown', e => e.stopPropagation());
    d.addEventListener('close', () => { if (current?.dialog === d) current = null; d.remove(); });
    document.body.append(d); d.showModal(); return d;
  }
  function field(label, control) { const box = el('label', 'co-field'); box.append(el('span', '', label), control); return box; }
  function select(options, value) { const s = el('select'); for (const [v, t] of options) { const o = el('option', '', t); o.value = v; s.append(o); } if (value != null) s.value = value; return s; }
  /* o que vai junto como contexto: as ultimas 30 falas do painel. "Você" vira
     "Usuário" -- o prompt diz "Você é Codex", e "### Você" confundia quem e' quem */
  function contextOf(P) {
    return (P.hist || []).slice(-30).map(h => `### ${h.quem === 'Você' ? 'Usuário' : h.quem}\n${h.texto || ''}`).join('\n\n').slice(-24000);
  }
  function tamanhoTexto(n) {
    if (!n) return 'a conversa ainda está vazia';
    return n < 1000 ? '~' + n + ' caracteres' : '~' + Math.round(n / 1000).toLocaleString('pt-BR') + ' mil caracteres';
  }
  /* catalogo de cada motor: Claude o do app (ja' com o padrao dos Ajustes);
     Codex a lista viva que o proprio Codex manda */
  const CATALOGO = {
    codex: () => (Array.isArray(MODELOS_CODEX) ? MODELOS_CODEX : []),
    claude: () => (typeof catalogoClaude === 'function' ? catalogoClaude() : MODELOS_CLAUDE),
  };
  /* o Codex manda cada esforco como {id, desc}; o Claude, como texto. Comparar
     o objeto com o texto deixava TODAS as opcoes desligadas e o select vazio. */
  function esforcosDoModelo(modelo) {
    const brutos = modelo && Array.isArray(modelo.efforts) && modelo.efforts.length ? modelo.efforts : ['low', 'medium', 'high'];
    return brutos.map(x => (typeof x === 'string' ? x : x && x.id)).filter(Boolean);
  }
  // padrao do debate: Alto (o uso real mostrou que "Máximo" passa minutos calado)
  function esforcoEscolhido(ids, pedido, modelo) {
    if (pedido && ids.includes(pedido)) return pedido;
    if (ids.includes('high')) return 'high';
    if (modelo && ids.includes(modelo.padraoEffort)) return modelo.padraoEffort;
    return ids[0] || '';
  }
  function preencherEsforco(sel, modelo, pedido) {
    const ids = esforcosDoModelo(modelo);
    sel.replaceChildren(...ids.map(id => { const o = el('option', '', (typeof EF_PT === 'object' && EF_PT[id]) || id); o.value = id; o.title = (typeof EF_DESC_PT === 'object' && EF_DESC_PT[id]) || ''; return o; }));
    sel.value = esforcoEscolhido(ids, pedido, modelo);
  }
  function modeloInicial(P, engine, lista) {
    const p = P.engine === engine ? P : (P.engineStates?.[engine] || [...panes.values()].find(x => x.engine === engine) || {});
    if (p.model) return p.model;
    return (lista.find(m => m.padrao) || lista[0] || {}).id || '';
  }
  function preencherModelos(sel, lista, valor) {
    const opcoes = lista.map(m => [m.id, m.nome || m.id]).filter(m => m[0]);
    if (valor && !opcoes.some(([id]) => id === valor)) opcoes.unshift([valor, valor]);
    sel.replaceChildren(...opcoes.map(([v, t]) => { const o = el('option', '', t); o.value = v; return o; }));
    if (valor) sel.value = valor;
  }
  const minSeg = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const ATIVIDADE = { pensando: () => 'pensando…', escrevendo: () => 'escrevendo…', lendo: a => 'lendo ' + (a.alvo || 'arquivo'),
    buscando: a => 'buscando "' + (a.alvo || '') + '"', listando: () => 'olhando os arquivos', rodando: () => 'rodando um comando de leitura' };
  function estadoDaFala(m) {
    if (m.status === 'running') {
      const a = m.activity; const f = a && ATIVIDADE[a.kind];
      return nome(m.speaker) + ' ' + (f ? f(a) : 'começando…') + ' · ' + minSeg(Date.now() - Date.parse(m.at));
    }
    if (m.status === 'completed') {
      const partes = [];
      if (m.durationMs) partes.push('levou ' + minSeg(m.durationMs));
      const u = m.usage || {}; const tokens = u.total || ((u.entrada || 0) + (u.saida || 0));
      if (tokens) partes.push((tokens >= 1000 ? (tokens / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : tokens) + ' tokens');
      if (m.truncated) partes.push('resposta cortada em 16 mil caracteres');
      return partes.join(' · ');
    }
    return (labels[m.status] || m.status) + (m.durationMs ? ' depois de ' + minSeg(m.durationMs) : '');
  }
  function statusDoDebate(state) {
    if (state.status !== 'running') return labels[state.status] || state.status;
    const falando = state.messages.findLast(m => m.status === 'running');
    const p = state.progress;
    const rodada = p ? 'Rodada ' + Math.ceil(p.fala / 2) + ' de ' + Math.ceil(p.total / 2) : 'Em discussão';
    return rodada + (falando ? ' · ' + nome(falando.speaker) + ' respondendo' : '');
  }
  function leituraDoDebate(state) {
    if (state.leitura) return 'Os dois leem os arquivos de ' + String(state.cwd || '').split(/[\\/]/).filter(Boolean).pop() + ' (só leitura).';
    if (state.semLeitura === 'ampla') return 'Sem leitura: a pasta do painel guarda chaves ou contas (pasta pessoal, raiz do disco, .claude, .codex). Escolha uma pasta de projeto pra eles lerem.';
    return state.semLeitura === 'remoto' ? 'Sem leitura do projeto: o painel é de um servidor, e o debate roda neste computador.'
      : 'Sem leitura do projeto: a pasta do painel não foi encontrada.';
  }
  /* auditoria 1: pasta pessoal, pasta que CONTEM a pessoal ou raiz do disco. La'
     moram chaves (.ssh), as contas dos motores (.claude, .codex) e o que mais
     houver -- e o que eles leem vai pra OpenAI e pra Anthropic. Quem decide e' o
     main (cockpit-debate.js leituraDe); aqui a tela so' avisa antes de iniciar. */
  /* auditoria 2: a mesma regra do main (e a lista do leitor-mcp): tambem a
     RAIZ de .claude/.codex/.gemini e qualquer pasta dentro de .ssh, .gnupg,
     .aws, .azure ou .config\gcloud. Quando o main responde (debateLeitura), vale
     a resposta dele; esta copia so' cobre a falta da ponte. */
  function pastaAmpla(p) {
    const bruto = String(p || '').trim();
    if (!bruto) return false;
    if (/^(?:[A-Za-z]:)?[\\/]*$/.test(bruto)) return true;   // "D:\", "D:", "/"
    const norm = x => String(x || '').replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase();
    const alvo = norm(bruto), casa = typeof HOME === 'string' ? norm(HOME) : '';
    const partes = alvo.split('\\').filter(Boolean);
    // raiz da conta do motor, ou subpasta dela que nao e' projeto (projects/ = todas as conversas)
    const livres = ['skills', 'agents', 'commands', 'worktrees', 'hooks', 'scripts', 'plans', 'output-styles', 'prompts'];
    if (partes.some((x, i) => ['.claude', '.codex', '.gemini'].includes(x) && !livres.includes(partes[i + 1]))) return true;
    if (partes.some((x, i) => ['.ssh', '.gnupg', '.aws', '.azure'].includes(x) || (x === '.config' && partes[i + 1] === 'gcloud'))) return true;
    return !!casa && (alvo === casa || casa.startsWith(alvo + '\\'));
  }
  async function open(P, options = {}) {
    if (!P || P.morto) return;
    const remoto = !!remotoDoPane(P);
    let ampla = !remoto && pastaAmpla(P.cwd);
    // quem decide se le e' o main (cockpit-debate.js leituraDe): a tela mostra o mesmo
    if (!remoto && window.api?.debateLeitura) {
      try { const r = await window.api.debateLeitura({ cwd: P.cwd }); if (r && typeof r.ampla === 'boolean') ampla = r.ampla; } catch {}
      if (!P || P.morto) return;
    }
    if (current?.dialog?.open) { if (current.P === P) { current.dialog.focus(); return; } current.dialog.close(); }
    const d = dialog('Debater com Codex e Claude', (remoto || ampla)
      ? 'Os dois discutem o problema e respondem um ao outro. Nada roda até você clicar em Iniciar.'
      : 'Os dois leem o projeto deste painel (só leitura), discutem e respondem um ao outro. Nada roda até você clicar em Iniciar.');
    const body = el('div', 'co-dialog-body'); d.append(body);
    const ui = { dialog: d, P, body, state: null, cards: new Map(), starting: false }; current = ui;
    const setup = el('section', 'co-setup'); body.append(setup);
    const topic = el('textarea'); topic.rows = 3; topic.maxLength = 8000; topic.placeholder = 'Ex.: qual é a melhor forma de organizar o atendimento dos leads?';
    topic.value = options.review ? 'Revisem as alterações de código. Discutam problemas concretos e proponham correções.' : (P.el.querySelector('.p-input')?.value || '');
    setup.append(field('Problema para discutir', topic));
    const pasta = String(P.cwd || '');
    const leituraInfo = el('p', (remoto || ampla) ? 'co-aviso' : 'co-info');
    leituraInfo.textContent = remoto
      ? 'Este painel é de um servidor (VPS). O debate roda neste computador e não lê os arquivos de lá: os dois discutem só com o texto que você mandar.'
      : ampla
        ? 'Esta pasta guarda chaves, senhas ou as contas dos motores (pasta pessoal, raiz do disco, .claude, .codex). Aqui os dois não leem arquivos. Escolha uma pasta de projeto pra eles lerem.'
        : 'Os dois podem ler os arquivos de ' + (pasta.split(/[\\/]/).filter(Boolean).pop() || 'esta pasta') + ' (só leitura, nada é alterado) · ' + pasta;
    setup.append(leituraInfo);
    // cartoes NA ORDEM DA FALA: a esquerda e' quem comeca
    const grid = el('div', 'co-model-grid'); setup.append(grid);
    const models = {}; const cards = {};
    for (const engine of DEBATEDORES) {
      const lista = CATALOGO[engine]();
      const box = el('div', 'co-participant ' + engine);
      const head = el('div', 'co-part-head'); const selo = el('span', 'co-selo');
      head.append(logo(engine), el('strong', '', nome(engine)), selo);
      const model = el('select'); model.setAttribute('aria-label', 'Modelo do ' + nome(engine));
      const effort = el('select'); effort.setAttribute('aria-label', 'Esforço do ' + nome(engine));
      const maxAviso = el('p', 'co-hint co-max', 'No máximo o motor pensa bastante antes de escrever: cada fala pode levar vários minutos.');
      // nasce escondido (auditoria 1): so' o syncEffort mostra, e com a lista do Codex falhando ele nem roda
      maxAviso.hidden = true;
      box.append(head, field('Modelo', model), field('Esforço', effort), maxAviso);
      models[engine] = { model, effort }; cards[engine] = { box, selo };
      const modeloAtual = () => CATALOGO[engine]().find(m => m.id === model.value);
      const syncEffort = () => { preencherEsforco(effort, modeloAtual(), effort.value || 'high'); maxAviso.hidden = !['max', 'ultra'].includes(effort.value); };
      effort.addEventListener('change', () => { maxAviso.hidden = !['max', 'ultra'].includes(effort.value); });
      model.addEventListener('change', syncEffort);
      const montar = () => { preencherModelos(model, CATALOGO[engine](), modeloInicial(P, engine, CATALOGO[engine]())); model.disabled = false; syncEffort(); };
      if (lista.length || engine !== 'codex') montar();
      else {
        // a lista do Codex chega no boot; se ainda nao chegou, pede agora
        model.replaceChildren(el('option', '', 'carregando modelos…')); model.disabled = true; effort.disabled = true;
        ui.carregandoCodex = (async () => {
          try { const ms = await window.api.codexModels(); if (Array.isArray(ms) && ms.length) MODELOS_CODEX = ms; } catch {}
          if (!d.isConnected) return;
          effort.disabled = false;
          if (CATALOGO.codex().length) montar();
          else { model.replaceChildren(el('option', '', 'não consegui ler os modelos do Codex')); errorIn(alert, 'Não consegui ler a lista de modelos do Codex. Confira se ele está instalado e com a conta conectada.'); }
        })();
      }
    }
    const ordem = [DEBATEDORES.includes(P.engine) ? P.engine : 'codex']; ordem.push(outroDebatedor(ordem[0]));
    const inverter = button('⇄ Inverter', 'co-inverter', () => { ordem.reverse(); pintarOrdem(); });
    inverter.title = 'Trocar quem começa'; inverter.setAttribute('aria-label', 'Inverter: trocar quem começa');
    function pintarOrdem() {
      grid.replaceChildren(cards[ordem[0]].box, inverter, cards[ordem[1]].box);
      cards[ordem[0]].selo.textContent = 'Começa'; cards[ordem[1]].selo.textContent = 'Responde';
    }
    pintarOrdem();
    // rodadas 1 · 2 · 3 lado a lado (uma rodada = uma fala de cada)
    let rodadas = 2;
    const grupo = el('div', 'co-rodadas'); grupo.setAttribute('role', 'radiogroup'); grupo.setAttribute('aria-label', 'Rodadas');
    const botoesRodada = [1, 2, 3].map(n => {
      const b = button(String(n), 'co-rodada', () => { rodadas = n; pintarRodadas(); }); b.setAttribute('role', 'radio'); b.dataset.n = String(n); return b;
    });
    const rodadaTexto = el('span', 'co-hint');
    function pintarRodadas() {
      for (const b of botoesRodada) { const on = Number(b.dataset.n) === rodadas; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); }
      rodadaTexto.textContent = rodadas + (rodadas === 1 ? ' rodada' : ' rodadas') + ' · ' + rodadas * 2 + ' falas (uma de cada, alternando)';
    }
    grupo.append(...botoesRodada, rodadaTexto); pintarRodadas();
    const rodadaCampo = el('div', 'co-field'); rodadaCampo.append(el('span', '', 'Rodadas'), grupo); setup.append(rodadaCampo);
    // opcoes
    const contexto = contextOf(P);
    const include = el('input'); include.type = 'checkbox'; include.checked = true;
    const includeLabel = el('label', 'co-check'); includeLabel.append(include, document.createTextNode('Compartilhar o texto recente desta conversa'), el('span', 'co-tam', '(' + tamanhoTexto(contexto.length) + ')')); setup.append(includeLabel);
    const review = el('input'); review.type = 'checkbox'; review.checked = !!options.review && !remoto;
    const reviewLabel = el('label', 'co-check'); reviewLabel.append(review, document.createTextNode('Incluir as alterações atuais do Git para revisão')); reviewLabel.hidden = remoto; setup.append(reviewLabel);
    const paid = el('input'); paid.type = 'checkbox';
    const paidLabel = el('label', 'co-check co-credit'); paidLabel.append(paid, document.createTextNode('Autorizo usar os créditos pagos que o Fable pode consumir.')); setup.append(paidLabel);
    const refreshPaid = () => { paidLabel.hidden = !Object.values(models).some(c => /fable/i.test(c.model.value)); };
    Object.values(models).forEach(c => c.model.addEventListener('change', refreshPaid)); refreshPaid();
    setup.append(el('p', 'co-hint', 'Cada fala tem até ' + ((remoto || ampla) ? '10' : '15') + ' min e até 16 mil caracteres (o que passar é cortado e marcado). Usa os limites das contas dos dois motores. Ninguém altera arquivos.'));
    const alert = el('p', 'co-error'); alert.setAttribute('role', 'alert'); alert.hidden = true; body.append(alert);
    const info = el('p', 'co-info co-nota'); info.hidden = true; body.append(info);
    if (remoto && options.review) errorIn(alert, 'A revisão de código só funciona em painel de pasta local.');
    const status = el('div', 'co-status', ''); status.setAttribute('aria-live', 'polite'); status.hidden = true; body.append(status);
    const transcript = el('div', 'co-transcript'); transcript.setAttribute('aria-label', 'Conversa entre Codex e Claude'); body.append(transcript);
    const vazio = el('p', 'co-vazio', 'Nada roda até você clicar em Iniciar debate.'); transcript.append(vazio);
    const intervention = el('textarea'); intervention.rows = 2; intervention.maxLength = 8000; intervention.placeholder = 'Acrescente uma orientação ou responda aos dois…';
    const interventionField = field('Sua intervenção', intervention); interventionField.hidden = true; body.append(interventionField);
    const footer = el('footer', 'co-actions'); d.append(footer);
    const history = select([['', 'Debates salvos…']], ''); history.className = 'co-salvos'; history.setAttribute('aria-label', 'Debates salvos');
    const start = button('Iniciar debate', 'co-primary'); const stop = button('Interromper', 'co-danger'); stop.hidden = true;
    const resume = button('Continuar discussão', 'co-primary'); resume.hidden = true;
    const use = button('Levar conclusão para o campo', 'co-secondary'); use.hidden = true;
    const fresh = button('Novo debate', 'co-secondary'); fresh.hidden = true;
    const verify = button('Conferir se o código mudou', 'co-secondary'); verify.hidden = true;
    footer.append(history, el('span', 'co-espaco'), stop, verify, fresh, use, resume, start);
    Object.assign(ui, { setup, topic, models, include, review, alert, info, status, transcript, start, stop, resume, use, fresh, verify, intervention, interventionField, history,
      inverter, ordem, rodadas: () => rodadas });
    // relogio da fala em andamento ("Claude pensando… 0:42"); para quando o dialogo fecha
    const relogio = setInterval(() => {
      if (!d.isConnected) { clearInterval(relogio); return; }
      for (const card of ui.cards.values()) if (card._msg?.status === 'running') card.querySelector('.co-message-state').textContent = estadoDaFala(card._msg);
    }, 1000);
    d.addEventListener('close', () => clearInterval(relogio));
    function render(state) {
      if (!d.isConnected) return; ui.state = state;
      if (state.paneId === P.id) P.debateId = state.id;   // debate de OUTRO painel aberto pelo seletor nao troca o deste
      const running = state.status === 'running';
      status.hidden = false; status.textContent = statusDoDebate(state) + ' · ' + leituraDoDebate(state);
      vazio.remove(); d.classList.add('co-conversa');
      setup.hidden = true; start.hidden = true; stop.hidden = !running; resume.hidden = running; fresh.hidden = running; history.hidden = running;
      interventionField.hidden = running; verify.hidden = !state.review || running;
      resume.textContent = 'Continuar · ' + state.rounds + (state.rounds === 1 ? ' rodada' : ' rodadas');
      use.hidden = running || !state.messages.some(m => m.status === 'completed' && m.speaker !== 'user');
      if (state.error) errorIn(alert, state.error); else if (running) alert.hidden = true;
      if (state.saveError && !ui.avisouGravacao) { ui.avisouGravacao = true; info.textContent = state.saveError; info.hidden = false; }
      const nearBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 100;
      for (const message of state.messages) {
        let card = ui.cards.get(message.id);
        if (!card) {
          card = el('article', 'co-message ' + message.speaker); const header = el('header');
          header.append(logo(message.speaker), el('strong', '', nome(message.speaker)), el('span', 'co-message-model', message.model || ''));
          if (message.speaker !== 'user') header.append(el('span', 'co-message-model', 'esforço ' + ((typeof EF_PT === 'object' && EF_PT[message.effort]) || message.effort || 'padrão do modelo').toLowerCase()));
          card.append(header, el('div', 'co-message-body'), el('p', 'co-leu'), el('p', 'co-hint co-message-aviso'), el('span', 'co-message-state')); ui.cards.set(message.id, card); transcript.append(card);
        }
        card._msg = message;
        const content = card.querySelector('.co-message-body');
        if (content._text !== message.text) { content._text = message.text; content.innerHTML = mdSeguro(message.text || '…'); }
        const leu = card.querySelector('.co-leu'); leu.hidden = !message.reads?.length;
        if (message.reads?.length) leu.textContent = 'Leu: ' + message.reads.join(', ');
        const aviso = card.querySelector('.co-message-aviso'); aviso.hidden = !message.aviso; aviso.textContent = message.aviso || '';
        card.querySelector('.co-message-state').textContent = estadoDaFala(message);
      }
      if (nearBottom) transcript.scrollTop = transcript.scrollHeight;
    }
    ui.render = render;
    function guardarNoSeletor(state) {
      if (!state?.id || [...history.options].some(o => o.value === state.id)) return;
      const o = el('option', '', String(state.topic || '').slice(0, 160) + ' · ' + (labels[state.status] || state.status)); o.value = state.id;
      history.options[0] ? history.options[0].after(o) : history.append(o);
    }
    start.onclick = async () => {
      if (ui.starting) return; ui.starting = true; start.disabled = true; alert.hidden = true;
      try {
        if (!topic.value.trim()) throw new Error('Descreva o problema para os dois discutirem.');
        if (ui.carregandoCodex) await ui.carregandoCodex;
        const snapshot = review.checked && !remoto ? check(await window.api.debateReview({ cwd: cwdGitDoPainel(P) })) : null;
        const state = check(await window.api.debateStart({ paneId: P.id, cwd: P.cwd, remoto, topic: topic.value.trim(), context: include.checked ? contexto : '',
          rounds: rodadas, first: ordem[0], paidApproved: paid.checked, review: snapshot,
          models: Object.fromEntries(Object.entries(models).map(([engine, c]) => [engine, { model: c.model.value, effort: c.effort.value }])) }));
        render(state); guardarNoSeletor(state);
        if (snapshot?.note) { info.textContent = snapshot.note; info.hidden = false; }   // arquivos novos: informacao, nao erro
      } catch (error) { errorIn(alert, error); } finally { ui.starting = false; start.disabled = false; }
    };
    stop.onclick = async () => { try { stop.disabled = true; render(check(await window.api.debateStop(ui.state.id))); } catch (error) { errorIn(alert, error); } finally { stop.disabled = false; } };
    resume.onclick = async () => { try { resume.disabled = true; alert.hidden = true; const s = check(await window.api.debateContinue({ id: ui.state.id, message: intervention.value, rounds: ui.state.rounds })); intervention.value = ''; render(s); } catch (error) { errorIn(alert, error); } finally { resume.disabled = false; } };
    use.onclick = async () => {
      if (ui.state.status === 'running') return;
      if (ui.state.review) {
        try {
          const snapshot = check(await window.api.debateReview({ cwd: ui.state.review.cwd }));
          if (snapshot.hash !== ui.state.review.hash) throw new Error('O código mudou. Inicie uma revisão nova antes de usar esta conclusão.');
        } catch (error) { errorIn(alert, error); return; }
      }
      const message = ui.state.messages.findLast(m => m.speaker !== 'user' && m.status === 'completed'); if (!message) return;
      const input = P.el.querySelector('.p-input'); if (!input) return;
      input.value = (input.value ? input.value + '\n\n' : '') + 'Conclusão do debate Codex ↔ Claude (para avaliar)' + (ui.state.review ? ' · revisão ' + ui.state.review.hash.slice(0, 12) : '') + ':\n' + message.text;
      input.dispatchEvent(new Event('input', { bubbles: true })); savePanes(); d.close(); input.focus();
    };
    fresh.onclick = () => { P.debateId = null; d.close(); open(P); };
    verify.onclick = async () => {
      try { const snapshot = await window.api.debateReview({ cwd: ui.state.review.cwd });
        if (snapshot.error) throw new Error('Não foi possível confirmar esta revisão: ' + snapshot.error);
        status.textContent = snapshot.hash === ui.state.review.hash ? 'O código continua igual ao que foi revisado.' : 'O código mudou. Esta revisão está desatualizada; inicie outra.';
      } catch (error) { errorIn(alert, error); }
    };
    history.onchange = async () => { if (!history.value) return; try { const s = check(await window.api.debateGet(history.value)); transcript.replaceChildren(); ui.cards.clear(); render(s); } catch (error) { errorIn(alert, error); } };
    try {
      const saved = check(await window.api.debateList());
      for (const item of saved) { const option = el('option', '', item.topic + ' · ' + (labels[item.status] || item.status)); option.value = item.id; history.append(option); }
      if (P.debateId && !options.review) render(check(await window.api.debateGet(P.debateId)));
    } catch (error) { errorIn(alert, error); }
    topic.focus();
  }
  const TITULO_DEBATER = 'Debater com Codex e Claude (os dois leem o projeto; só roda quando você iniciar)';
  function pintarBotao(P, rodando) {
    const b = P?.el?.querySelector('.p-debate'); if (!b) return;
    b.classList.toggle('ativo', !!rodando);
    b.title = rodando ? 'Debate em andamento — clique para acompanhar' : TITULO_DEBATER;
  }
  window.api.onDebateEvent?.(state => {
    if (current && (current.state?.id === state.id || (current.starting && state.paneId === current.P.id))) current.render(state);
    const P = acharPainel(state.paneId); if (P) { P.debateId = state.id; pintarBotao(P, state.status === 'running'); }
  });
  async function health(P) {
    const engine = P.engine;
    if (!['codex', 'claude'].includes(engine)) { note(P, 'O diagnóstico por sessão está disponível para Codex e Claude.'); return; }
    const d = dialog('Diagnóstico dos conectores', 'Configurado → carregado → última chamada observada. ' + nomeDoMotor(engine));
    const body = el('div', 'co-dialog-body co-health'); d.append(body);
    const actions = el('footer', 'co-actions'); d.append(actions);
    const refresh = button('Atualizar diagnóstico', 'co-primary', load);
    const reload = button('Recarregar conectores', 'co-secondary', async () => {
      const gen = ++healthGeneration; reload.disabled = true; refresh.disabled = true;
      try {
        const r = check(await window.api.mcpRecarregar({ engine, paneId: P.id }));
        if (!d.isConnected || gen !== healthGeneration) return;
        if (r.diagnostico) render(check(r.diagnostico));
        body.prepend(el('p', 'co-hint', r.aviso || 'O Codex aceitou a recarga; o resultado de uma chamada ainda precisa ser observado.'));
      }
      catch (error) { if (d.isConnected) body.prepend(el('p', 'co-error', error.message)); }
      finally { reload.disabled = engine !== 'codex'; refresh.disabled = false; }
    }); actions.append(refresh, reload);
    reload.disabled = engine !== 'codex';
    if (engine !== 'codex') reload.title = 'Claude aplica configurações na próxima abertura da sessão.';
    function render(r) {
      body.replaceChildren();
      for (const warning of r.avisos || []) body.append(el('p', 'co-hint', warning));
      if (!r.itens?.length) body.append(el('p', 'co-hint', 'Nenhum conector encontrado para este motor.'));
      const estados = { connected: 'Conectado', starting: 'Iniciando', notStarted: 'Ainda não iniciado', failed: 'Falhou',
        authenticationRequired: 'Precisa entrar na conta', cancelled: 'Cancelado', disabled: 'Desativado', pending: 'Aguardando',
        'needs-auth': 'Precisa entrar na conta', sessao_encerrada: 'Sessão encerrada', desconhecido: 'Estado não confirmado' };
      const chamadas = { em_andamento: 'Em andamento', sucesso: 'Concluída sem erro', falhou: 'Falhou', interrompida: 'Interrompida' };
      for (const m of r.itens || []) {
        const card = el('article', 'co-health-card'); card.append(el('h3', '', m.nome));
        const stages = el('div', 'co-health-stages');
        for (const [label, value] of [['Configurado', m.configurado], ['Carregado na sessão', m.carregado]])
          stages.append(el('span', value === true ? 'yes' : 'unknown', label + ': ' + (value === true ? 'sim' : value === false ? 'não' : 'não confirmado')));
        card.append(stages, el('p', 'co-hint', estados[m.estado] || 'Estado não confirmado'));
        if (Number.isInteger(m.ferramentas)) card.append(el('p', 'co-hint', 'Ferramentas no inventário: ' + m.ferramentas));
        const call = m.ultimaChamada;
        card.append(el('p', '', call ? 'Última chamada: ' + (chamadas[call.estado] || 'Sem estado confirmado') + ' · '
          + (call.ferramenta || '') + ' · ' + new Date(call.quando).toLocaleString('pt-BR') : 'Nenhuma chamada observada nesta sessão.'));
        if (call?.erro) card.append(el('p', 'co-error', call.erro)); body.append(card);
      }
    }
    async function load() {
      const gen = ++healthGeneration; refresh.disabled = true; reload.disabled = true;
      body.replaceChildren(el('p', 'co-hint', 'Consultando os conectores…'));
      try {
        const r = check(await window.api.mcpDiagnostico({ engine, paneId: P.id })); if (!d.isConnected || gen !== healthGeneration) return;
        render(r);
      } catch (error) { if (d.isConnected) body.replaceChildren(el('p', 'co-error', error.message)); }
      finally { refresh.disabled = false; reload.disabled = engine !== 'codex'; }
    }
    await load();
  }
  /* box: o conteiner FIXO no fim da Torre (.torre-agentes). Cabecalho na mesma
     lingua das outras secoes da Torre; sem agente, so' "nenhum" (a dica fixa
     ocupava espaco toda vez). Manda os paineis que ainda existem: agente
     encerrado de painel fechado nao volta mais. */
  async function paintAgents(box) {
    if (!window.api.agentesSessao || !box) return;
    const generation = ++agentsGeneration;
    try {
      const vivos = [...panes.keys(), ...(typeof panesFundo !== 'undefined' ? panesFundo.keys() : [])].map(String);
      const result = check(await window.api.agentesSessao({ paineisVivos: vivos })); if (generation !== agentsGeneration || !box.isConnected) return;
      const section = el('section', 'co-agents');
      const items = (result.itens || []).filter(a => !String(a.paneId).startsWith('debate-'));
      const head = el('div', 'torre-aba');
      head.append(el('span', 'torre-nome', 'Agentes nas conversas'), el('span', 'torre-conta', items.length ? String(items.length) : 'nenhum'));
      section.append(head);
      for (const a of items) {
        const owner = acharPainel(a.paneId); const card = el('article', 'co-agent');
        const titulo = el('strong', '', (typeof nomeDoMotor === 'function' ? nomeDoMotor(a.engine) : String(a.engine || '')) + ' → ' + (a.task || 'Tarefa sem descrição'));
        if (typeof marcaDoMotor === 'function') { const logo = el('span', 'co-agent-logo'); logo.innerHTML = marcaDoMotor(a.engine); titulo.prepend(logo); }
        card.append(titulo,
          el('span', 'co-hint', (owner?.titulo || 'Conversa') + (a.parentId ? ' · tarefa vinculada a um agente' : '')),
          el('span', 'co-agent-state', ({ idle: 'Aguardando próximo turno', shutdown: 'Encerrado', notFound: 'Agente não encontrado' })[a.state]
            || agentLabels[a.state] || 'Sem estado confirmado'));
        if (a.model) card.append(el('span', 'co-hint', a.model));
        if (a.message || a.result) card.append(el('p', '', String(a.message || a.result).slice(0, 400)));
        section.append(card);
      }
      box.replaceChildren(section);   // troca no lugar: a secao nao some nem pula entre uma pintura e outra
    } catch { /* A lista de painéis existente continua utilizável. */ }
  }
  function resources(P, id, items) {
    const step = acharPasso(P, id); if (!step || !items?.length) return;
    step.querySelector('.co-tool-resources')?.remove(); const box = el('div', 'co-tool-resources');
    for (const item of items.slice(0, 20)) {
      const row = el('div'); const name = item.nome || item.uri || 'Recurso';
      let abrivel = false;
      try { const u = new URL(item.uri); abrivel = item.abrivel === true && /^https?:$/.test(u.protocol) && !u.username && !u.password; } catch {}
      if (abrivel) row.append(button(name, 'co-resource-link', () => window.api.abrirLink(item.uri)));
      else row.append(el('span', '', name));
      if (item.texto) row.append(el('pre', '', item.texto)); box.append(row);
    }
    step.append(box);
  }
  function attach(P) {
    if (!P?.el || P.el.querySelector('.p-debate')) return;
    /* icone + rotulo; o rotulo some em painel estreito (@container no fim do
       style.css). Rodando: classe ativo com um ponto pulsando -- o texto nao
       muda ("Debatendo…" fazia a largura pular). */
    const b = button('', 'p-debate', () => open(P)); b.title = TITULO_DEBATER; b.setAttribute('aria-label', 'Debater com Codex e Claude');
    b.innerHTML = (typeof ico === 'function' ? ico('messages-square') : '') + '<span class="pd-rot">Debater</span><span class="pd-ponto" aria-hidden="true"></span>';
    P.el.querySelector('.p-close')?.before(b);
  }
  window.CockpitCollaboration = { open, health, paintAgents, resources, attach,
    _t: { esforcosDoModelo, esforcoEscolhido, contextOf, tamanhoTexto, estadoDaFala, statusDoDebate } };
  for (const P of panes.values()) attach(P);
})();
