/* Componentes comuns; os protocolos e históricos nativos continuam separados. */
(() => {
  'use strict';
  let current = null, healthGeneration = 0, agentsGeneration = 0;
  const DEBATEDORES = ['codex', 'claude'];
  const outroDebatedor = engine => DEBATEDORES.find(e => e !== engine);
  function ensureAccountsAvailable() {
    const changing = DEBATEDORES.find(engine => window.CockpitUI?.accountChanging?.(engine, null));
    if (changing) throw new Error('Aguarde a troca de conta do ' + nome(changing) + ' neste computador antes de iniciar ou continuar o debate.');
  }
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
  function progressoDoDebate(state) {
    const falas = (state.messages || []).filter(m => DEBATEDORES.includes(m.speaker));
    const faltam = state.status === 'running' && state.progress
      ? Math.max(0, Number(state.progress.total || 0) - Number(state.progress.fala || 0)) : 0;
    return [...falas.map(m => ({ id: m.id, status: m.status })), ...Array.from({ length: Math.min(faltam, 6) }, () => ({ status: 'pending' }))];
  }
  function pintarProgresso(box, state) {
    const partes = progressoDoDebate(state);
    box.hidden = !partes.length;
    const prontas = partes.filter(p => p.status === 'completed').length;
    box.setAttribute('aria-label', prontas + ' de ' + partes.length + ' falas concluídas');
    box.replaceChildren(...partes.map((p, i) => {
      const segmento = el('span', 'co-progress-step ' + p.status);
      segmento.title = 'Fala ' + (i + 1) + ': ' + (p.status === 'pending' ? 'aguardando' : labels[p.status] || p.status);
      segmento.setAttribute('aria-hidden', 'true'); return segmento;
    }));
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
    d.classList.add('co-debate-dialog');
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
    leituraInfo.title = leituraInfo.textContent;
    leituraInfo.textContent = remoto ? 'Servidor: debate local, sem leitura dos arquivos remotos'
      : ampla ? 'Pasta sensível: leitura de arquivos desativada'
      : (pasta.split(/[\\/]/).filter(Boolean).pop() || 'Projeto') + ' · só leitura';
    leituraInfo.classList.add('co-reading-scope');
    d.querySelector('.co-dialog-head').append(leituraInfo);
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
    const progress = el('div', 'co-progress'); progress.hidden = true; progress.setAttribute('role', 'img'); body.append(progress);
    const transcript = el('div', 'co-transcript'); transcript.setAttribute('aria-label', 'Conversa entre Codex e Claude'); body.append(transcript);
    const vazio = el('p', 'co-vazio', 'Nada roda até você clicar em Iniciar debate.'); transcript.append(vazio);
    const intervention = el('textarea'); intervention.rows = 2; intervention.maxLength = 8000; intervention.placeholder = 'Acrescente uma orientação ou responda aos dois…';
    const interventionField = field('Sua intervenção', intervention); interventionField.hidden = true; body.append(interventionField);
    const footer = el('footer', 'co-actions'); d.append(footer);
    const history = select([['', 'Debates salvos…']], ''); history.className = 'co-salvos'; history.setAttribute('aria-label', 'Debates salvos');
    const start = button('Iniciar debate', 'co-primary'); const stop = button('Interromper', 'co-danger'); stop.hidden = true;
    const resume = button('Continuar discussão', 'co-primary'); resume.hidden = true;
    const use = button('Levar conclusão para o campo', 'co-primary'); use.hidden = true;
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
      status.hidden = false; status.textContent = statusDoDebate(state); status.title = leituraDoDebate(state);
      pintarProgresso(progress, state);
      leituraInfo.textContent = state.leitura ? (String(state.cwd || '').split(/[\\/]/).filter(Boolean).pop() || 'Projeto') + ' · só leitura' : state.semLeitura === 'remoto' ? 'Servidor: debate local, sem leitura dos arquivos remotos' : 'Leitura de arquivos desativada';
      leituraInfo.title = leituraDoDebate(state);
      vazio.remove(); d.classList.add('co-conversa');
      setup.hidden = true; start.hidden = true; stop.hidden = !running; resume.hidden = running; fresh.hidden = running; history.hidden = running;
      interventionField.hidden = running; verify.hidden = !state.review || running;
      resume.textContent = 'Continuar · ' + state.rounds + (state.rounds === 1 ? ' rodada' : ' rodadas');
      use.hidden = running || !state.messages.some(m => m.status === 'completed' && m.speaker !== 'user');
      if (state.error) errorIn(alert, state.error); else if (running) alert.hidden = true;
      if (state.saveError && !ui.avisouGravacao) { ui.avisouGravacao = true; info.textContent = state.saveError; info.hidden = false; }
      const nearBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 100;
      let numeroFala = 0;
      for (const message of state.messages) {
        if (DEBATEDORES.includes(message.speaker)) numeroFala++;
        let card = ui.cards.get(message.id);
        if (!card) {
          card = el('article', 'co-message ' + message.speaker); const header = el('header');
          header.append(logo(message.speaker), el('strong', '', nome(message.speaker)), el('span', 'co-message-model', message.model || ''));
          if (message.speaker !== 'user') header.append(el('span', 'co-message-round', 'Rodada ' + Math.ceil(numeroFala / 2)));
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
      if (ui.starting || ui.loadingHistory) return; ui.starting = true; start.disabled = true; alert.hidden = true;
      try {
        if (!topic.value.trim()) throw new Error('Descreva o problema para os dois discutirem.');
        ensureAccountsAvailable();
        if (ui.carregandoCodex) await ui.carregandoCodex;
        if (!d.open) return;
        const snapshot = review.checked && !remoto ? check(await window.api.debateReview({ cwd: cwdGitDoPainel(P) })) : null;
        if (!d.open) return;
        ensureAccountsAvailable();
        const state = check(await window.api.debateStart({ paneId: P.id, cwd: P.cwd, remoto, topic: topic.value.trim(), context: include.checked ? contexto : '',
          rounds: rodadas, first: ordem[0], paidApproved: paid.checked, review: snapshot,
          models: Object.fromEntries(Object.entries(models).map(([engine, c]) => [engine, { model: c.model.value, effort: c.effort.value }])) }));
        render(state); guardarNoSeletor(state);
        if (snapshot?.note) { info.textContent = snapshot.note; info.hidden = false; }   // arquivos novos: informacao, nao erro
      } catch (error) { errorIn(alert, error); } finally { ui.starting = false; start.disabled = false; }
    };
    stop.onclick = async () => { try { stop.disabled = true; render(check(await window.api.debateStop(ui.state.id))); } catch (error) { errorIn(alert, error); } finally { stop.disabled = false; } };
    resume.onclick = async () => { if (ui.loadingHistory) return; try { resume.disabled = true; alert.hidden = true; ensureAccountsAvailable(); const s = check(await window.api.debateContinue({ id: ui.state.id, message: intervention.value, rounds: ui.state.rounds })); intervention.value = ''; render(s); } catch (error) { errorIn(alert, error); } finally { resume.disabled = false; } };
    use.onclick = async () => {
      if (ui.loadingHistory || ui.state.status === 'running') return;
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
    let historyGeneration = 0;
    const initialDebateId = P.debateId;
    async function loadSaved(id) {
      const generation = ++historyGeneration;
      ui.loadingHistory = !!id;
      for (const action of [start, resume, use, verify, fresh]) action.disabled = !!id;
      if (!id) return;
      try {
        const response = await window.api.debateGet(id);
        if (!d.open || P.morto || generation !== historyGeneration || history.value !== id) return;
        const state = check(response);
        if (state.id !== id) throw new Error('A resposta não corresponde ao debate escolhido. Tente novamente.');
        transcript.replaceChildren(); ui.cards.clear(); render(state);
      } catch (error) {
        if (d.open && generation === historyGeneration) errorIn(alert, error);
      } finally {
        if (generation === historyGeneration) {
          ui.loadingHistory = false;
          for (const action of [start, resume, use, verify, fresh]) action.disabled = false;
        }
      }
    }
    history.onchange = () => loadSaved(history.value);
    try {
      const saved = check(await window.api.debateList());
      if (!d.open || P.morto) return;
      for (const item of saved) { const option = el('option', '', item.topic + ' · ' + (labels[item.status] || item.status)); option.value = item.id; history.append(option); }
      if (initialDebateId && !options.review && !historyGeneration && !ui.starting && !ui.state) {
        history.value = initialDebateId; await loadSaved(initialDebateId);
      }
    } catch (error) { if (d.open) errorIn(alert, error); }
    if (d.open) topic.focus();
  }
  /* Leva 5i (spec, secao 4): o ⚖ Debater virou botao FIXO da barra (index.html; o app.js liga o clique dele ao open(P) em ligarBotoesDaBarra). O botao
     temporario que nascia antes do ■ enquanto o debate rodava (UI 3.1) se fundiu com ele e saiu: aqui so' se marca o ESTADO. Rodando, o proprio ⚖ ganha
     .rodando (o anel que pulsa e' do CSS) e o hover e o aria-label dizem que ha' um debate em andamento; terminou, falhou ou foi interrompido, volta ao
     normal. O clique e' o mesmo nos dois estados: o open(P) devolve o foco ao dialogo aberto ou abre o debate desta conversa (P.debateId). */
  function pintarBotao(P, rodando) {
    const b = P?.el?.querySelector('.p-debate');
    if (!b) return;
    b.classList.toggle('rodando', !!rodando);
    b.title = rodando ? 'Debate em andamento — clique para acompanhar' : 'Debater com Codex e Claude';
    b.setAttribute('aria-label', b.title);
  }
  window.api.onDebateEvent?.(state => {
    if (current && !current.loadingHistory && (current.state?.id === state.id || (current.starting && state.paneId === current.P.id))) current.render(state);
    const P = acharPainel(state.paneId); if (P) { P.debateId = state.id; pintarBotao(P, state.status === 'running'); }
  });
  async function health(P) {
    if (!P || P.morto) return;
    const engine = P.engine;
    if (!['codex', 'claude'].includes(engine)) { note(P, 'O diagnóstico por sessão está disponível para Codex e Claude.'); return; }
    const d = dialog('Diagnóstico dos conectores', 'Configurado → carregado → última chamada observada. ' + nomeDoMotor(engine));
    d.className += ' co-health-dialog';
    const body = el('div', 'co-dialog-body co-health'); d.append(body);
    const actions = el('footer', 'co-actions'); d.append(actions);
    const refresh = button('Atualizar diagnóstico', 'co-primary', load);
    const reload = button('Recarregar conectores', 'co-secondary', async () => {
      const gen = ++healthGeneration; reload.disabled = true; refresh.disabled = true;
      try {
        const r = check(await window.api.mcpRecarregar({ engine, paneId: P.id, remoto: remotoDoPane(P) }));
        if (!d.isConnected || gen !== healthGeneration) return;
        if (r.diagnostico) render(check(r.diagnostico));
        body.prepend(el('p', 'co-hint', r.aviso || 'O Codex aceitou a recarga; o resultado de uma chamada ainda precisa ser observado.'));
      }
      catch (error) { if (d.isConnected) body.prepend(el('p', 'co-error', error.message)); }
      finally { reload.disabled = engine !== 'codex'; refresh.disabled = false; }
    });
    const manage = button('Gerenciar conectores', 'co-secondary', () => {
      if (typeof janelaConectores === 'function') { d.close(); janelaConectores(P); }
    });
    manage.disabled = typeof janelaConectores !== 'function';
    actions.append(manage);
    const headActions = el('div', 'co-health-actions'); headActions.append(refresh, reload);
    d.querySelector('.co-dialog-head').append(headActions);
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
      const legend = el('div', 'co-health-legend');
      legend.append(el('span', '', 'Conector'), el('span', '', 'Configurado · Carregado · Usado'), el('span', '', 'Última chamada'));
      if (r.itens?.length) body.append(legend);
      for (const m of r.itens || []) {
        const card = el('article', 'co-health-card');
        const name = el('div', 'co-health-name'); name.append(el('h3', '', m.nome));
        const estado = estados[m.estado] || 'Estado não confirmado';
        const detail = el('span', 'co-health-state', estado); name.append(detail);
        if (Number.isInteger(m.ferramentas)) name.title = m.ferramentas + ' ferramentas no inventário';
        const stages = el('div', 'co-health-stages');
        const call = m.ultimaChamada;
        const failed = ['failed', 'authenticationRequired', 'needs-auth'].includes(m.estado);
        const dados = [
          ['Configurado', m.configurado, false],
          ['Carregado na sessão', m.carregado, failed],
          ['Usado', call ? true : null, call?.estado === 'falhou'],
        ];
        for (const [label, value, fault] of dados) {
          const texto = label + ': ' + (value === true ? 'sim' : value === false ? 'não' : 'não confirmado');
          const station = el('span', 'co-health-station ' + (fault ? 'failed' : value === true ? 'yes' : 'unknown'));
          station.title = texto + (fault ? ' · ' + (label === 'Usado' ? 'A última chamada falhou' : estado) : '');
          station.setAttribute('aria-label', station.title);
          station.append(el('span', 'co-visually-hidden', texto)); stages.append(station);
        }
        const last = el('div', 'co-health-last');
        if (call) {
          const date = new Date(call.quando);
          last.append(el('span', '', chamadas[call.estado] || 'Sem estado confirmado'));
          const time = el('time', '', Number.isNaN(date.getTime()) ? 'Horário não informado' : date.toLocaleString('pt-BR'));
          if (!Number.isNaN(date.getTime())) time.setAttribute('datetime', date.toISOString());
          last.append(time); last.title = call.ferramenta || '';
        } else last.append(el('span', '', 'Nunca'), el('span', 'co-visually-hidden', 'Nenhuma chamada observada nesta sessão.'));
        card.append(name, stages, last);
        if (call?.erro) { const details = el('details', 'co-health-error'); details.append(el('summary', '', 'Ver erro da última chamada'), el('p', 'co-error', call.erro)); card.append(details); }
        body.append(card);
      }
    }
    async function load() {
      const gen = ++healthGeneration; refresh.disabled = true; reload.disabled = true;
      body.replaceChildren(el('p', 'co-hint', 'Consultando os conectores…'));
      try {
        const r = check(await window.api.mcpDiagnostico({ engine, paneId: P.id, remoto: remotoDoPane(P) })); if (!d.isConnected || gen !== healthGeneration) return;
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
  async function openAgentHistory(a) {
    const d = dialog(a.task || 'Conversa do subagente', 'Somente leitura · abrir não inicia trabalho');
    d.classList.add('co-agent-history');
    const close = d.querySelector('.co-close'); close.textContent = '×'; close.title = 'Fechar'; close.setAttribute('aria-label', 'Fechar');
    const body = el('div', 'co-dialog-body', 'Carregando…'); d.append(body);
    try {
      const r = check(await window.api.agentHistory({ paneId: a.paneId, threadId: a.threadId }));
      if (!d.isConnected) return;
      body.replaceChildren();
      for (const m of r.messages || []) if (m.role === 'user' || m.role === 'bot') {
        const row = el('article', 'co-history-message'); row.append(el('strong', '', m.role === 'user' ? 'Pedido' : 'Resposta'));
        const text = el('div', 'md'); text.innerHTML = mdSeguro(m.text || ''); row.append(text); body.append(row);
      }
      if (!body.children.length) body.textContent = 'Este agente ainda não tem mensagens gravadas.';
    } catch (e) { if (d.isConnected) errorIn(body, e); }
  }
  function agentHistoryButton(a) {
    const b = button('', 'co-agent-history-open', () => openAgentHistory(a));
    b.innerHTML = ico('book-open'); b.title = 'Ler a conversa deste agente'; b.setAttribute('aria-label', b.title); return b;
  }
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
        /* Tarefa 7: o nome em portugues de gente (app.js, nomeDoAgente), quando ja'
           chegou: titulo de 2 palavras e a linha logo abaixo; o nome tecnico do
           motor fica no passar do mouse. Sem ele (falhou, ainda nao chegou), o de hoje. */
        const bom = typeof nomeDoAgente === 'function' ? nomeDoAgente(a) : null;
        const titulo = el('strong', '', (typeof nomeDoMotor === 'function' ? nomeDoMotor(a.engine) : String(a.engine || '')) + ' → ' + (bom ? bom.titulo : (a.task || 'Tarefa sem descrição')));
        if (bom && a.task) titulo.title = a.task;
        if (typeof marcaDoMotor === 'function') { const logo = el('span', 'co-agent-logo'); logo.innerHTML = marcaDoMotor(a.engine); titulo.prepend(logo); }
        card.append(titulo);
        if (bom && bom.linha) card.append(el('span', 'co-hint', bom.linha));
        card.append(
          el('span', 'co-hint', (owner?.titulo || 'Conversa') + (a.parentId ? ' · tarefa vinculada a um agente' : '')),
          el('span', 'co-agent-state', ({ idle: 'Aguardando próximo turno', shutdown: 'Encerrado', notFound: 'Agente não encontrado' })[a.state]
            || agentLabels[a.state] || 'Sem estado confirmado'));
        if (a.model) card.append(el('span', 'co-hint', a.model));
        if (a.message || a.result) card.append(el('p', '', String(a.message || a.result).slice(0, 400)));
        if (a.historySupported && a.threadId && window.api.agentHistory) card.append(agentHistoryButton(a));
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
      // leva 5i: o link do passo abre no navegador interno do painel (abrirLinkDaTela, do app.js); Ctrl+clique e a preferencia mandam ao do Windows
      if (abrivel) row.append(button(name, 'co-resource-link', (e) => (typeof abrirLinkDaTela === 'function' ? abrirLinkDaTela(P, item.uri, e) : window.api.abrirLink(item.uri))));
      else row.append(el('span', '', name));
      if (item.texto) row.append(el('pre', '', item.texto)); box.append(row);
    }
    step.append(box);
  }
  /* ======================= Workflow dos agentes: o organograma (leva 5i) =======================
     A camada de sempre (.ck-workflow), com outro desenho: no topo o cartao da CONVERSA, que coordena a equipe; embaixo, um cartao por agente
     ligado ao pai por linhas de organograma. Os filhos da conversa ficam numa fileira (tronco do pai, barra e perninhas) e quebram em linhas
     quando nao cabem; os netos em diante PENDEM do pai (lista vertical com trilho), porque um cartao de 164 px nao cabe ao lado do outro
     dentro de um ramo. Os concluidos de um mesmo pai viram um cartao "N concluidos", que abre ao clique; o clique num agente abre o detalhe.
     A repintura e' INCREMENTAL: cada cartao e' guardado pelo id do agente (view.cards). A cada 1,5 s o que mudou troca so' o seu texto, o que
     entrou ganha um cartao novo, o que saiu e' removido e a ordem so' mexe nos nos que mudaram de lugar (antes a arvore era refeita inteira, e
     a rolagem voltava ao topo). O tempo (m:ss) anda a cada segundo: so' o texto, so' de quem trabalha e so' com a camada aberta.
     Estado = cor + simbolo do ico(); o NOME do estado so' vai no hover e no aria-label. */
  const ESTADOS_AG = {
    running:     { cls: 'rodando',   nome: 'Trabalhando',           icone: 'play',  vivo: true },
    pending:     { cls: 'rodando',   nome: 'Iniciando',             icone: 'play',  vivo: true },
    waiting:     { cls: 'precisa',   nome: 'Precisa de você',       icone: 'hand',  vivo: true },
    completed:   { cls: 'concluido', nome: 'Concluído',             icone: 'check', vivo: false },
    failed:      { cls: 'falhou',    nome: 'Falhou',                icone: 'x',     vivo: false },
    interrupted: { cls: 'parado',    nome: 'Interrompido',          icone: 'minus', vivo: false },
    shutdown:    { cls: 'parado',    nome: 'Encerrado',             icone: 'minus', vivo: false },
    notFound:    { cls: 'parado',    nome: 'Agente não encontrado', icone: 'minus', vivo: false },
    idle:        { cls: 'parado',    nome: 'Parado entre turnos',   icone: 'minus', vivo: false },
  };
  const SEM_ESTADO = { cls: 'parado', nome: 'Sem estado confirmado', icone: 'minus', vivo: false };
  const estadoDoAgente = (estado) => (Object.hasOwn(ESTADOS_AG, estado) ? ESTADOS_AG[estado] : SEM_ESTADO);
  // o texto numa linha so', no teto, com reticencias
  const cortar = (texto, max) => {
    const s = String(texto == null ? '' : texto).replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
  };
  // o tipo do agente quando o nome em portugues ainda nao chegou: "general-purpose" vira "General purpose"
  const humanizarTipo = (tipo) => { const s = String(tipo || '').replace(/[-_]+/g, ' ').trim(); return s ? s[0].toUpperCase() + s.slice(1) : ''; };
  /* O modelo, curto e legivel, como no chip: "Sonnet 5.5", "Haiku 4.5", "GPT-6 Astra". O agente do Claude manda o id inteiro ou so' o apelido
     (sonnet, opus, haiku); o do Codex, o id (gpt-6-astra). O que nao conheco sai como veio, cortado. */
  function modeloCurto(modelo) {
    const id = String(modelo || '').trim().replace(/\[1m\]$/i, '');
    if (!id || /^inherit$/i.test(id)) return '';
    const c = id.match(/^claude-(opus|sonnet|fable|haiku)-(\d+)(?:-(\d)(?=-|$))?/i);
    if (c) return c[1][0].toUpperCase() + c[1].slice(1).toLowerCase() + ' ' + c[2] + (c[3] ? '.' + c[3] : '');
    const g = id.match(/^gpt-(\d+(?:\.\d+)?)(?:-([a-z]+))?$/i);
    if (g) return 'GPT-' + g[1] + (g[2] ? ' ' + g[2][0].toUpperCase() + g[2].slice(1).toLowerCase() : '');
    if (/^[a-z]+$/i.test(id)) return id[0].toUpperCase() + id.slice(1).toLowerCase();
    return cortar(id, 18);
  }
  /* O estado da CONVERSA (o cartao do topo): precisa de voce (permissao, pergunta que bloqueia ou plano esperando), trabalhando ou parada.
     As mesmas condicoes que o CockpitWork.active usa para pausar o relogio da conversa. */
  function estadoDaConversa(P) {
    const espera = !!(P.pedindoPerm || P.filaPerm?.length || P.planoPendente
      || (P.filaPerg || []).some((q) => q.bloqueante !== false) || (P.perguntaAberta && P.perguntaAberta.bloqueante !== false));
    if (espera) return { cls: 'precisa', nome: 'Esperando você', icone: 'hand' };
    return P.busy ? { cls: 'rodando', nome: 'Trabalhando', icone: 'play' } : { cls: 'parado', nome: 'Parada', icone: 'minus' };
  }
  const NOME_DO_FUNDO = { comando: 'Comando', agente: 'Agente' };
  /* O que o cartao de um agente mostra, tudo texto simples (sem DOM): nome curto (o do Haiku; sem ele, o tipo do agente), funcao numa linha
     (a "linha" do Haiku; sem ela, a tarefa cortada em 60), o estado (cor, simbolo e o nome para o hover), o modelo e os dois horarios do tempo.
     n vem do CockpitWork.graph; raw e' o registro do main (so' ele sabe se a conversa do agente pode ser lida). */
  function modeloDoNo(n, raw) {
    const bom = raw && typeof nomeDoAgente === 'function' ? nomeDoAgente(raw) : null;
    const fundo = n.kind === 'background';
    const est = fundo ? ESTADOS_AG.running : estadoDoAgente(n.state);
    const tarefa = /^Subagente(?: Claude| Codex)?$/.test(n.title) ? '' : n.title;
    return {
      id: n.id, parentId: n.parentId, parent: n.parent, estado: n.state, cls: est.cls, estadoNome: est.nome, icone: est.icone, vivo: est.vivo,
      nome: cortar(bom?.titulo || (fundo ? NOME_DO_FUNDO[n.tipo] || 'Segundo plano' : humanizarTipo(n.tipo)) || 'Agente', 28),
      funcao: cortar(bom?.linha || tarefa, 60),
      modelo: modeloCurto(n.model),
      t0: n.startedAt || 0, t1: est.vivo ? 0 : (n.endedAt || n.updatedAt || 0),
      tarefa: cortar(tarefa, 300), detalhe: String(n.detail || '').slice(0, 600),
      historico: !!(raw && raw.historySupported && raw.threadId),
    };
  }
  /* A arvore do organograma, pura (sem DOM). itens: os modeloDoNo, um por agente; raiz: os ids que contam como a propria conversa (sessaoId e
     resumeId). Devolve { raiz, soltos }; cada posicao e' { item, filhos } ou, para o cartao dos concluidos, { grupo: true, chave, total, membros }.
     Ordem entre irmaos: quem precisa de voce, depois os que rodam, depois os outros (a do registro, dentro de cada grupo).
     Concluidos: so' o agente concluido com TODA a descendencia concluida pode ir para o cartao; com 2 ou mais irmaos assim, viram "N concluidos"
     (um so' fica como cartao comum: trocar um cartao por outro cartao nao poupa nada). Quem tem vinculo ausente ou cortado (ciclo) nao ganha pai
     inventado: vai para "soltos", como o CockpitWork.graph ja' prometia. */
  function montarArvore(itens, raiz) {
    const porId = new Map(itens.map((i) => [i.id, i]));
    const filhosDe = new Map(), daConversa = [], soltos = [];
    for (const i of itens) {
      if (i.parent && porId.has(i.parent)) { if (!filhosDe.has(i.parent)) filhosDe.set(i.parent, []); filhosDe.get(i.parent).push(i); }
      else if (!i.parentId || raiz.has(i.parentId)) daConversa.push(i);
      else soltos.push(i);
    }
    const prioridade = (i) => (i.cls === 'precisa' ? 0 : i.cls === 'rodando' ? 1 : 2);
    const ordenar = (lista) => lista.map((i, k) => [i, k]).sort((a, b) => prioridade(a[0]) - prioridade(b[0]) || a[1] - b[1]).map((p) => p[0]);
    const concluidoInteiro = (i) => i.cls === 'concluido' && (filhosDe.get(i.id) || []).every(concluidoInteiro);
    const contar = (i) => 1 + (filhosDe.get(i.id) || []).reduce((soma, f) => soma + contar(f), 0);
    const posicao = (i) => ({ item: i, filhos: irmaos(filhosDe.get(i.id) || [], i.id) });
    function irmaos(lista, dono) {
      const ordem = ordenar(lista), fechados = ordem.filter(concluidoInteiro);
      if (fechados.length < 2) return ordem.map(posicao);
      const dentro = new Set(fechados);
      return [...ordem.filter((i) => !dentro.has(i)).map(posicao),
        { grupo: true, chave: 'c:' + dono, total: fechados.reduce((soma, i) => soma + contar(i), 0), membros: fechados.map(posicao) }];
    }
    return { raiz: irmaos(daConversa, 'conversa'), soltos: ordenar(soltos).map(posicao) };
  }
  // o selo: o simbolo do ico() na cor do estado; o nome do estado so' no hover e no aria-label (nunca palavra solta)
  function pintarSelo(selo, icone, nomeDoEstado) {
    selo.innerHTML = typeof ico === 'function' ? ico(icone) : '';
    selo.title = nomeDoEstado; selo.setAttribute('aria-label', nomeDoEstado);
  }
  function novoCartao(view, item) {
    const no = el('div', 'org-no'); no.setAttribute('role', 'listitem');
    const cartao = el('button', 'org-card'); cartao.type = 'button'; cartao.dataset.agentId = item.id; cartao.setAttribute('aria-expanded', 'false');
    const topo = el('span', 'org-topo'), titulo = el('span', 'org-nome'), selo = el('span', 'org-selo'), funcao = el('span', 'org-funcao');
    const rodape = el('span', 'org-rodape'), tempo = el('span', 'org-tempo'), modelo = el('span', 'org-modelo');
    selo.setAttribute('role', 'img'); tempo.setAttribute('role', 'timer');
    topo.append(titulo, selo); rodape.append(tempo, modelo); cartao.append(topo, funcao, rodape); no.append(cartao);
    cartao.addEventListener('click', () => selecionar(view, item.id));
    return { id: item.id, no, cartao, titulo, selo, funcao, tempo, modelo, grupo: null, item, f: {}, t0: 0, t1: 0, vivo: false };
  }
  // o tempo do cartao: ao vivo (agora - inicio) enquanto trabalha; parado, o fim menos o inicio. So' mexe no texto quando ele muda.
  function escreverTempo(e, agora) {
    const texto = e.t0 ? minSeg(Math.max(0, (e.vivo ? agora : (e.t1 || e.t0)) - e.t0)) : '';
    if (e.f.tempo !== texto) { e.tempo.textContent = texto; e.f.tempo = texto; }
  }
  // troca so' o que mudou: nome, funcao, modelo, o selo (cor e simbolo) e o hover; o tempo vai pelo escreverTempo
  function atualizarCartao(e, item) {
    e.item = item;
    const f = e.f;
    if (f.nome !== item.nome) { e.titulo.textContent = item.nome; f.nome = item.nome; }
    if (f.funcao !== item.funcao) { e.funcao.textContent = item.funcao; f.funcao = item.funcao; }
    if (f.modelo !== item.modelo) { e.modelo.textContent = item.modelo; f.modelo = item.modelo; }
    const marca = item.estado + '|' + item.cls + '|' + item.icone + '|' + item.estadoNome;
    if (f.marca !== marca) {
      e.cartao.dataset.estado = item.cls; e.cartao.dataset.state = item.estado;   // estado = o visual (CSS); state = o do motor (como era antes)
      pintarSelo(e.selo, item.icone, item.estadoNome); f.marca = marca;
    }
    // o hover do cartao e' a tarefa como o motor a mandou (muitas vezes em ingles): o nome tecnico fica aqui, nao na tela
    const dica = item.tarefa && item.tarefa !== item.funcao ? item.tarefa : '';
    if (f.dica !== dica) { e.cartao.title = dica; f.dica = dica; }
    e.t0 = item.t0; e.t1 = item.t1; e.vivo = item.vivo;
    escreverTempo(e, Date.now());
  }
  function pintarAbertura(g, aberto) {
    if (g.f.aberto === aberto) return;
    g.f.aberto = aberto; g.lista.hidden = !aberto; g.cartao.setAttribute('aria-expanded', aberto ? 'true' : 'false');
  }
  function alternarGrupo(view, chave) {
    const g = view.grupos.get(chave);
    if (!g) return;
    if (view.abertos.has(chave)) view.abertos.delete(chave); else view.abertos.add(chave);
    pintarAbertura(g, view.abertos.has(chave));
    medirFilas(view);
  }
  // o cartao "N concluidos" (check + numero): abre a lista dos concluidos, pendurada embaixo dele
  function novoGrupo(view, chave) {
    const no = el('div', 'org-no org-no-grupo'); no.setAttribute('role', 'listitem');
    const cartao = el('button', 'org-card org-concluidos'); cartao.type = 'button'; cartao.dataset.estado = 'concluido'; cartao.dataset.grupo = chave;
    cartao.setAttribute('aria-expanded', 'false');
    const selo = el('span', 'org-selo'), total = el('span', 'org-total'), seta = el('span', 'org-seta');
    selo.setAttribute('role', 'img'); seta.innerHTML = typeof ico === 'function' ? ico('chevron-down') : '';
    cartao.append(selo, total, seta);
    const lista = el('div', 'org-grupo org-pendurado'); lista.setAttribute('role', 'list'); lista.hidden = true;
    no.append(cartao, lista);
    cartao.addEventListener('click', () => alternarGrupo(view, chave));
    return { chave, no, cartao, selo, total, lista, f: {} };
  }
  function atualizarGrupo(view, g, posicao) {
    if (g.f.total !== posicao.total) {
      const rotulo = posicao.total + (posicao.total === 1 ? ' concluído' : ' concluídos');
      g.total.textContent = String(posicao.total); g.f.total = posicao.total;
      pintarSelo(g.selo, 'check', rotulo); g.cartao.title = rotulo; g.cartao.setAttribute('aria-label', rotulo);
    }
    pintarAbertura(g, view.abertos.has(g.chave));
  }
  // poe os nos na ordem pedida mexendo so' no que esta fora do lugar (um no que ja' esta certo nao e' tocado)
  function acomodar(caixa, desejados) {
    desejados.forEach((no, i) => { const atual = caixa.children[i]; if (atual !== no) caixa.insertBefore(no, atual || null); });
  }
  function caixaDeFilhos(classe) { const c = el('div', classe); c.setAttribute('role', 'list'); return c; }
  function pintarArvore(view, arvore) {
    const vistos = new Set();
    const lugar = (caixa, posicoes) => {
      const desejados = [];
      for (const p of posicoes) {
        if (p.grupo) {
          let g = view.grupos.get(p.chave);
          if (!g) { g = novoGrupo(view, p.chave); view.grupos.set(p.chave, g); }
          atualizarGrupo(view, g, p);
          vistos.add('g:' + p.chave);
          lugar(g.lista, p.membros);
          desejados.push(g.no);
        } else {
          let e = view.cards.get(p.item.id);
          if (!e) { e = novoCartao(view, p.item); view.cards.set(p.item.id, e); }
          atualizarCartao(e, p.item);
          vistos.add(p.item.id);
          if (p.filhos.length) {
            if (!e.grupo) { e.grupo = caixaDeFilhos('org-grupo org-pendurado'); e.no.append(e.grupo); }
            lugar(e.grupo, p.filhos);
          } else if (e.grupo) { e.grupo.remove(); e.grupo = null; }
          desejados.push(e.no);
        }
      }
      acomodar(caixa, desejados);
    };
    lugar(view.linha, arvore.raiz);
    lugar(view.listaSoltos, arvore.soltos);
    for (const [id, e] of view.cards) if (!vistos.has(id)) { e.no.remove(); view.cards.delete(id); }
    for (const [chave, g] of view.grupos) if (!vistos.has('g:' + chave)) { g.no.remove(); view.grupos.delete(chave); view.abertos.delete(chave); }
  }
  // recomeca a arvore do zero (a saida de emergencia se o DOM recusar uma mudanca de lugar, o que so' acontece com um vinculo que se inverte)
  function reiniciarArvore(view) {
    view.cards.clear(); view.grupos.clear(); view.linha.replaceChildren(); view.listaSoltos.replaceChildren();
  }
  /* As fileiras da conversa: quando os filhos nao cabem numa linha eles quebram, e cada fileira precisa da sua barra. Aqui so' se LE onde cada
     um caiu (offsetTop) e se marca em quem e' o primeiro, o ultimo e o unico da fileira (data-fila); o desenho das linhas e' do CSS. Com mais de
     uma fileira o grupo ganha data-filas e a altura do trilho (--org-trilho), que liga as barras. Sem medida (sem layout), nao marca nada: o CSS
     cai no :first-child e :last-child, certo para uma fileira so'. So' escreve o que mudou. */
  function medirFilas(view) {
    const grupo = view.linha;
    if (!grupo) return;
    const nos = [...grupo.children];
    const topos = nos.map((n) => n.offsetTop);
    if (!nos.length || !topos.every(Number.isFinite)) return;
    const filas = [];
    topos.forEach((topo, i) => { const ultima = filas.at(-1); if (ultima && Math.abs(topos[ultima[0]] - topo) <= 2) ultima.push(i); else filas.push([i]); });
    const marcas = nos.map(() => 'meio');
    for (const fila of filas) {
      if (fila.length === 1) marcas[fila[0]] = 'so';
      else { marcas[fila[0]] = 'ini'; marcas[fila.at(-1)] = 'fim'; }
    }
    nos.forEach((n, i) => { if (n.dataset.fila !== marcas[i]) n.dataset.fila = marcas[i]; });
    if (filas.length > 1) {
      if (grupo.dataset.filas !== String(filas.length)) grupo.dataset.filas = String(filas.length);
      const trilho = topos[filas.at(-1)[0]] + 'px';
      if (grupo.style.getPropertyValue('--org-trilho') !== trilho) grupo.style.setProperty('--org-trilho', trilho);
    } else if (grupo.dataset.filas !== undefined) { delete grupo.dataset.filas; grupo.style.removeProperty('--org-trilho'); }
  }
  /* O detalhe: um painel unico embaixo da arvore (cartao estreito nao comporta o texto). Mostra o nome, o modelo, a tarefa como o motor a mandou,
     a mensagem ou o resultado do agente e o botao "ler a conversa". So' e' refeito quando o conteudo muda (o foco nao se perde a cada 1,5 s). */
  function selecionar(view, id) {
    view.selecionado = view.selecionado === id ? '' : id;
    pintarSelecao(view);
  }
  function pintarSelecao(view) {
    if (view.selecionado && !view.cards.has(view.selecionado)) view.selecionado = '';   // o agente saiu da lista
    for (const e of view.cards.values()) {
      const aberto = e.id === view.selecionado;
      if (e.f.aberto !== aberto) { e.cartao.setAttribute('aria-expanded', aberto ? 'true' : 'false'); e.f.aberto = aberto; }
    }
    pintarDetalhe(view);
  }
  function pintarDetalhe(view) {
    const e = view.selecionado ? view.cards.get(view.selecionado) : null;
    if (!e) { if (!view.detalhe.hidden) view.detalhe.hidden = true; view.detalheAssinatura = ''; return; }
    const item = e.item, assinatura = JSON.stringify([item.id, item.nome, item.funcao, item.modelo, item.cls, item.tarefa, item.detalhe, item.historico]);
    if (assinatura === view.detalheAssinatura && !view.detalhe.hidden) return;
    view.detalheAssinatura = assinatura; view.detalhe.hidden = false;
    const cabeca = el('div', 'org-d-cab');
    cabeca.append(el('strong', 'org-d-nome', item.nome));
    if (item.modelo) cabeca.append(el('span', 'org-d-modelo', item.modelo));
    const bruto = view.brutos.get(item.id);
    if (item.historico && bruto && window.api.agentHistory) cabeca.append(agentHistoryButton(bruto));
    const fechar = button('', 'org-d-fechar', () => selecionar(view, item.id));
    fechar.innerHTML = typeof ico === 'function' ? ico('x') : ''; fechar.title = 'Fechar o detalhe'; fechar.setAttribute('aria-label', fechar.title);
    cabeca.append(fechar);
    const partes = [cabeca];
    if (item.tarefa && item.tarefa !== item.funcao) partes.push(el('p', 'org-d-tarefa', item.tarefa));
    if (item.detalhe) partes.push(el('p', 'org-d-texto', item.detalhe));
    view.detalhe.replaceChildren(...partes);
  }
  // o esqueleto da camada, feito uma vez: o cartao da conversa, a fileira dos filhos, o aviso de lista vazia, os sem vinculo, o aviso de erro e o detalhe
  function montarEsqueleto(view) {
    if (view.org) return;
    const P = view.P, corpo = view.layer.body;
    const org = el('div', 'org'); org.setAttribute('role', 'group'); org.setAttribute('aria-label', 'Equipe desta conversa');
    const raizNo = el('div', 'org-no org-raiz');
    const cartao = el('div', 'org-card org-conversa');
    const topo = el('span', 'org-topo'), marca = el('span', 'org-logo'), modelo = el('span', 'org-modelo'), selo = el('span', 'org-selo'), titulo = el('span', 'org-nome');
    selo.setAttribute('role', 'img');
    // o logo e o nome dele sao escritos pelo pintarTopo (rodada 2 da leva 5i: no ACP com uma IA de preset o logo e' o da IA, e a troca de IA repinta)
    topo.append(marca, modelo, selo); cartao.append(topo, titulo);
    const linha = caixaDeFilhos('org-grupo org-linha'); linha.hidden = true;
    raizNo.append(cartao, linha); org.append(raizNo);
    const vazio = el('p', 'workflow-empty'); vazio.hidden = true;
    const soltos = el('div', 'org-soltos'); soltos.hidden = true;
    const listaSoltos = caixaDeFilhos('org-grupo org-solto');
    soltos.append(el('p', 'workflow-note', 'Agentes da conversa cujo vínculo anterior não foi informado:'), listaSoltos);
    const aviso = el('p', 'workflow-note'); aviso.setAttribute('role', 'status'); aviso.hidden = true;
    const detalhe = el('section', 'org-detalhe'); detalhe.hidden = true;
    corpo.append(org, vazio, soltos, aviso, detalhe);
    Object.assign(view, { org, linha, vazio, soltos, listaSoltos, aviso, detalhe, topo: { cartao, marca, modelo, selo, titulo }, topoF: {} });
    /* a largura da camada muda (janela redimensionada, rolagem que aparece): as fileiras podem quebrar de outro jeito. A medida fica para o
       proximo quadro: mexer no que o ResizeObserver olha, dentro dele, faz o navegador reclamar de "loop" de redimensionamento */
    if (typeof ResizeObserver === 'function') {
      const noProximoQuadro = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => fn();
      view.observador = new ResizeObserver(() => noProximoQuadro(() => { if (!view.layer.closed) medirFilas(view); }));
      view.observador.observe(org);
    }
  }
  function pintarTopo(view, topo) {
    const t = view.topo, f = view.topoF;
    // o logo e o nome dele (hover): o da IA do preset no ACP (OpenCode, Droid...), senao o do motor (rodada 2 da leva 5i). So' reescreve quando muda.
    const chaveDoLogo = topo.ia + '|' + view.P.engine;
    if (f.logo !== chaveDoLogo) {
      t.marca.innerHTML = topo.ia && typeof svgIa === 'function' ? svgIa(topo.ia) : (typeof svgMotor === 'function' ? svgMotor(view.P.engine) : '');
      t.marca.title = topo.iaNome || (typeof nomeDoMotor === 'function' ? nomeDoMotor(view.P.engine) : '');
      f.logo = chaveDoLogo;
    }
    if (f.titulo !== topo.titulo) { t.titulo.textContent = topo.titulo || 'Esta conversa'; f.titulo = topo.titulo; }
    if (f.modelo !== topo.modelo) { t.modelo.textContent = topo.modelo; t.modelo.hidden = !topo.modelo; f.modelo = topo.modelo; }
    if (f.cls !== topo.cls) { t.cartao.dataset.estado = topo.cls; pintarSelo(t.selo, topo.icone, topo.estadoNome); f.cls = topo.cls; }
  }
  function pintarRodape(view, total, soltos, aviso) {
    const f = view.rodapeF || (view.rodapeF = {});
    const vazio = total ? '' : (aviso ? 'A lista está temporariamente indisponível.' : 'Nenhum subagente ou trabalho em segundo plano observado nesta conversa.');
    if (f.vazio !== vazio) { view.vazio.textContent = vazio; view.vazio.hidden = !vazio; f.vazio = vazio; }
    if (view.soltos.hidden === !!soltos) view.soltos.hidden = !soltos;
    if (f.aviso !== aviso) { view.aviso.textContent = aviso; view.aviso.hidden = !aviso; f.aviso = aviso; }
  }
  // a tela inteira: dados do motor -> modelo de cada agente -> arvore -> DOM incremental. Sem mudanca nenhuma desde a ultima vez, nao faz nada.
  function pintarOrganograma(view, agents, aviso) {
    const P = view.P;
    const nodes = window.CockpitWork.graph(P, agents);
    const brutos = new Map(agents.map((a) => [String(a.id), a]));
    const itens = nodes.map((n) => modeloDoNo(n, brutos.get(n.id)));
    const conversa = estadoDaConversa(P);
    const idModelo = P.model || (typeof modeloAtual === 'function' ? (modeloAtual(P) || {}).id : '');
    /* Painel ACP numa IA de preset (OpenCode, Droid, Cursor...): o "modelo" do painel e' o COMANDO ("opencode acp"), que sairia cru no cartao, e o
       logo seria o plugue. Aqui vale o mesmo que o chip usa: o logo da IA (svgIa) e o nome dela (modeloAtual(P).nome). Comando digitado em "Outro
       comando…" (sem preset) segue como sempre. Rodada 2 da leva 5i. */
    const ia = typeof iaDoPainel === 'function' ? iaDoPainel(P) : null;
    const nomeDaIa = ia ? String((typeof modeloAtual === 'function' && (modeloAtual(P) || {}).nome) || ia.nome) : '';
    const topo = { titulo: String(P.titulo || ''), modelo: ia ? cortar(nomeDaIa, 18) : modeloCurto(idModelo), ia: ia ? String(ia.ia) : '', iaNome: nomeDaIa,
      cls: conversa.cls, icone: conversa.icone, estadoNome: conversa.nome };
    const raiz = new Set([P.sessaoId, P.resumeId].filter(Boolean).map(String));
    const assinatura = JSON.stringify([itens, aviso, topo, [...raiz]]);
    if (assinatura === view.signature) return;
    view.brutos = brutos;
    montarEsqueleto(view);
    pintarTopo(view, topo);
    const arvore = montarArvore(itens, raiz);
    try { pintarArvore(view, arvore); } catch { reiniciarArvore(view); pintarArvore(view, arvore); }
    view.linha.hidden = !arvore.raiz.length;
    pintarRodape(view, itens.length, arvore.soltos.length, aviso);
    medirFilas(view);
    pintarSelecao(view);
    view.signature = assinatura;   // so' depois de pintar: se a pintura quebrar, a proxima leitura tenta de novo
  }
  // 1x por segundo: so' o TEXTO do tempo de quem esta trabalhando (os parados ja' estao escritos)
  function tempoDoWorkflow(view) {
    if (workflowView !== view || view.layer.closed) return;
    const agora = Date.now();
    for (const e of view.cards.values()) if (e.vivo) escreverTempo(e, agora);
  }

  let workflowView = null;
  const chaveDoPainel = (P) => P.engine + ':' + (P.sessaoId || P.resumeId || '');
  function workflow(P) {
    if (!P?.el || !window.CockpitUI || !window.CockpitWork) return;
    if (workflowView) window.CockpitUI.closeLayer(workflowView.layer);
    const view = { P, key: chaveDoPainel(P), generation: 0, timer: null, relogio: null, observador: null, signature: '',
      cards: new Map(), grupos: new Map(), abertos: new Set(), brutos: new Map(), selecionado: '' };
    view.layer = window.CockpitUI.openLayer('Workflow dos agentes', {
      className: 'ck-workflow',
      // fechou: os dois relogios param (a leitura a cada 1,5 s e o tempo a cada 1 s) e a medida das fileiras sai de cena
      onClose: () => { clearInterval(view.timer); clearInterval(view.relogio); view.observador?.disconnect(); view.generation++; if (workflowView === view) workflowView = null; },
    });
    view.layer.body.classList.add('workflow-body');
    workflowView = view;
    refreshWorkflow(P);
    view.timer = setInterval(() => refreshWorkflow(P), 1500);
    view.relogio = setInterval(() => tempoDoWorkflow(view), 1000);
  }
  async function refreshWorkflow(P) {
    const view = workflowView;
    if (!view || view.P !== P || view.layer.closed) return;
    if (P.morto || view.key !== chaveDoPainel(P)) {
      window.CockpitUI.closeLayer(view.layer); return;
    }
    if (view.loading) return;
    view.loading = true;
    const generation = ++view.generation;
    let agents = [], aviso = '';
    try {
      if (!window.api.agentesSessao) throw new Error('Leitura de agentes indisponível.');
      const result = check(await window.api.agentesSessao({ paneId: P.id, engine: P.engine }));
      agents = Array.isArray(result.itens) ? result.itens : [];
    } catch (error) { aviso = 'Não consegui atualizar os agentes: ' + (error.message || error); }
    finally { view.loading = false; }
    if (workflowView !== view || generation !== view.generation || view.layer.closed) return;
    pintarOrganograma(view, agents, aviso);
  }
  /* UI 3.1: o Debater e o "Voz, imagens e nuvem" sairam da barra e foram para o menu "+" (app.js, menuMais). Leva 5i: o Debater voltou para a barra como
     botao fixo (⚖, que tambem mostra o debate rodando, pintarBotao) e so' reaparece no menu "+" no nivel 5 do encaixe; o frasco segue so' no menu. */
  function attach() {}
  window.CockpitCollaboration = { open, health, paintAgents, resources, attach, workflow, refreshWorkflow,
    _t: { esforcosDoModelo, esforcoEscolhido, contextOf, tamanhoTexto, estadoDaFala, statusDoDebate,
      // leva 5i: as partes puras do organograma (sem DOM), para os testes
      ESTADOS_AG, estadoDoAgente, estadoDaConversa, modeloCurto, modeloDoNo, montarArvore, cortar, humanizarTipo } };
  for (const P of panes.values()) attach(P);
})();
