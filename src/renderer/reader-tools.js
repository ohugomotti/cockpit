/* Ferramentas locais do leitor. Não altera o arquivo e não chama motores. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CockpitReaderTools = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const sessions = new Map();
  const documentWrites = new Map();
  const BUTTON_ICONS = {
    'Voltar ao documento': 'arrow-left', Buscar: 'search', 'Sumário': 'clipboard-list',
    'Comentários': 'messages-square', Mais: 'ellipsis', 'Resultado anterior': 'arrow-up',
    'Próximo resultado': 'arrow-down', 'Fechar busca': 'x', 'Diminuir texto': 'zoom-out',
    'Restaurar tamanho do texto': 'rotate-cw', 'Aumentar texto': 'zoom-in', 'Quebrar linhas': 'wrap-text',
    'Copiar caminho': 'link', 'Reler arquivo': 'refresh-cw', 'Comentar trecho': 'message-plus',
    'Copiar trecho': 'copy', 'Preparar ajuste': 'square-pen', Abertos: 'circle', Resolvidos: 'circle-check',
    'Comentário geral': 'message-plus', 'Ver trecho': 'text-select', Editar: 'pencil', Reabrir: 'rotate-cw',
    Resolver: 'circle-check', 'Vincular à seleção': 'link', Excluir: 'trash', Cancelar: 'x',
    'Excluir comentário': 'trash', 'Salvar comentário': 'check', 'Descartar rascunho': 'x'
  };
  // Complementos da mesma família de traços dos ícones já usados pelo app.
  const EXTRA_ICONS = {
    'arrow-left': '<path d="m12 5-7 7 7 7M5 12h14"/>',
    'arrow-down': '<path d="m5 12 7 7 7-7M12 5v14"/>',
    ellipsis: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    'zoom-in': '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M7 10h6M10 7v6"/>',
    'zoom-out': '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M7 10h6"/>',
    'wrap-text': '<path d="M3 5h18M3 9h14a4 4 0 0 1 0 8h-5M3 13h5M3 17h4m8-3-3 3 3 3"/>',
    link: '<path d="m10 13 4-4M8 15l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 3 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    'message-plus': '<path d="M21 11v5a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h10M19 2v6M16 5h6"/>',
    'square-pen': '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M16 3l5 5M10 14l-1 4 4-1 9-9-4-4z"/>',
    'circle-check': '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    'text-select': '<path d="M7 3H3v4m14-4h4v4M3 17v4h4m14-4v4h-4M7 8h10M7 12h10M7 16h6"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>'
  };
  function renderIcon(name, fallback) {
    return EXTRA_ICONS[name] ? '<svg viewBox="0 0 24 24" class="ic" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + EXTRA_ICONS[name] + '</svg>' : fallback(name);
  }
  let serial = 0;
  function locateAnchor(text, anchor, version) {
    if (!anchor?.quote) return { status: 'general' };
    if (anchor.version === version && text.slice(anchor.start, anchor.end) === anchor.quote)
      return { status: 'found', start: anchor.start, end: anchor.end };
    const matches = [];
    for (let at = 0; at <= text.length;) {
      const found = text.indexOf(anchor.quote, at);
      if (found < 0) break;
      matches.push(found); at = found + Math.max(1, anchor.quote.length);
    }
    if (!matches.length) return { status: 'changed' };
    // Mesmo uma citação única pode ter sido removida e reaparecer em outro
    // parágrafo. Versão nova exige contexto compatível, não só o mesmo texto.
    let candidates = matches;
    if (anchor.prefix || anchor.suffix) candidates = matches.filter(start =>
      (!anchor.prefix || text.slice(Math.max(0, start - anchor.prefix.length), start) === anchor.prefix) &&
      (!anchor.suffix || text.slice(start + anchor.quote.length, start + anchor.quote.length + anchor.suffix.length) === anchor.suffix));
    else if (matches.length === 1 && text !== anchor.quote) return { status: 'changed' };
    if (!candidates.length) return { status: 'changed' };
    if (candidates.length !== 1) return { status: 'ambiguous' };
    return { status: 'found', start: candidates[0], end: candidates[0] + anchor.quote.length };
  }
  function makeAnchor(text, start, end, version, mode) {
    return { quote: text.slice(start, end), prefix: text.slice(Math.max(0, start - 64), start),
      suffix: text.slice(end, end + 64), start, end, version, mode };
  }
  function occurrences(text, query) {
    if (!query) return [];
    const result = [], pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
    for (const match of text.matchAll(pattern)) result.push({ start: match.index, end: match.index + match[0].length });
    return result;
  }
  /* Primeiro nó cujo fim passa de "pos" (inclusive = que chega em pos). Os nós vêm na ordem do texto e o fim só cresce:
     busca binária (R5-04). Antes eram dois .find na lista inteira para cada um dos até 1500 resultados. */
  function nodeAt(nodes, pos, inclusive) {
    let lo = 0, hi = nodes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (inclusive ? nodes[mid].end >= pos : nodes[mid].end > pos) hi = mid; else lo = mid + 1;
    }
    return nodes[lo];
  }
  function mount(options) {
    const { dialog, body, toolbar, document: descriptor, text, markdown, api, getMode, setMode, textForMode, reload, prepareDraft } = options;
    if (!dialog || !body) return null;
    const uid = ++serial, highlightNames = ['reader-find-' + uid, 'reader-current-' + uid, 'reader-comment-' + uid];
    const element = (tag, className, content) => { const el = document.createElement(tag); if (className) el.className = className; if (content != null) el.textContent = content; return el; };
    const button = (label, handler, className = '', iconName = BUTTON_ICONS[label]) => {
      const el = element('button', 'reader-button ' + className); el.type = 'button'; el.onclick = handler;
      el.title = label; el.setAttribute('aria-label', label);
      if (iconName) {
        el.classList.add('reader-icon-button');
        el.innerHTML = renderIcon(iconName, options.icon);
        el.querySelector('svg')?.setAttribute('aria-hidden', 'true');
      } else el.textContent = label; // Títulos do sumário são o conteúdo do documento.
      return el;
    };
    const key = descriptor?.id || JSON.stringify([options.path, options.remote || null]);
    let alive = true, ready = false, conflict = false, state = { revision: 0, comments: [], draft: null, view: {} };
    let selection = null, activePanel = '', filter = 'open', draft = null, draftTimer, selectedComment = null, savingDraft = false;
    let pending = Promise.resolve(), matches = [], currentMatch = -1, query = '', modeScroll = {}, view = { fontSize: 16, wrap: true };
    let searchTimer = 0, searchMap = null;   // R5-04: busca adiada e o mapa do documento que ela usou (solto ao fechar a busca e no redesenho)
    const layout = element('div', 'reader-layout'); body.before(layout); layout.appendChild(body);
    const aside = element('aside', 'reader-side'); aside.hidden = true; aside.setAttribute('aria-label', 'Ferramentas do documento'); layout.appendChild(aside);
    const sideTitle = element('strong', 'reader-side-title');
    const sideClose = button('Voltar ao documento', () => togglePanel(''));
    const sideHead = element('div', 'reader-side-head'); sideHead.append(sideTitle, sideClose); aside.append(sideHead);
    const sideContent = element('div', 'reader-side-content'); aside.append(sideContent);
    const status = element('div', 'reader-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); layout.after(status);
    function say(message, error = false) { if (!alive) return; status.textContent = message; status.classList.toggle('reader-error', error); }
    const tools = element('div', 'reader-main-tools'); toolbar.appendChild(tools);
    const searchButton = button('Buscar', () => openSearch()); searchButton.title = 'Buscar no documento (Ctrl+F)';
    const tocButton = button('Sumário', () => togglePanel(activePanel === 'toc' ? '' : 'toc')); tocButton.hidden = !markdown;
    const commentsButton = button('Comentários', () => togglePanel(activePanel === 'comments' ? '' : 'comments'));
    const moreButton = button('Mais', () => { more.hidden = !more.hidden; moreButton.setAttribute('aria-expanded', String(!more.hidden)); });
    tools.append(searchButton, tocButton, commentsButton, moreButton);
    const search = element('div', 'reader-search'); search.hidden = true; toolbar.after(search);
    const input = element('input'); input.type = 'search'; input.maxLength = 300; input.placeholder = 'Buscar neste documento'; input.setAttribute('aria-label', 'Buscar neste documento');
    const count = element('span', 'reader-search-count', '0 resultados'); count.setAttribute('aria-live', 'polite');
    const previous = button('Resultado anterior', () => moveMatch(-1)), next = button('Próximo resultado', () => moveMatch(1)), searchClose = button('Fechar busca', () => closeSearch());
    search.append(input, count, previous, next, searchClose);
    const more = element('div', 'reader-more'); more.hidden = true; search.after(more);
    const zoomDown = button('Diminuir texto', () => zoom(-1)), zoomReset = button('Restaurar tamanho do texto', () => zoom(0)), zoomUp = button('Aumentar texto', () => zoom(1));
    const zoomValue = element('output', 'reader-zoom-value', '100%'); zoomValue.setAttribute('aria-label', 'Tamanho atual do texto');
    const wrap = button('Quebrar linhas', () => { view.wrap = !view.wrap; applyView(); });
    const copyPath = button('Copiar caminho', async () => { try { await copy(options.path); say('Caminho copiado.'); } catch { say('Não consegui copiar o caminho.', true); } });
    const reread = button('Reler arquivo', () => { remember(); reload(); });
    more.append(zoomDown, zoomValue, zoomUp, zoomReset, wrap, copyPath, reread);
    const selectionBar = element('div', 'reader-selection'); selectionBar.hidden = true; selectionBar.setAttribute('role', 'toolbar'); selectionBar.setAttribute('aria-label', 'Trecho selecionado');
    const commentSelection = button('Comentar trecho', () => startDraft(selection));
    selectionBar.append(commentSelection, button('Copiar trecho', async () => { try { await copy(selection?.quote || ''); say('Trecho copiado.'); } catch { say('Não consegui copiar o trecho.', true); } }), button('Preparar ajuste', () => prepare(selection)));
    selectionBar.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); }); dialog.querySelector('.visor-cx').appendChild(selectionBar);
    function copy(value) { return api.copiarTexto ? api.copiarTexto(value) : navigator.clipboard.writeText(value); }
    function index() {
      const nodes = [], walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT); let node, value = '';
      while ((node = walker.nextNode())) { nodes.push({ node, start: value.length, end: value.length + node.length }); value += node.data; }
      return { nodes, text: value };
    }
    function rangeFor(start, end, map = index()) {
      const first = nodeAt(map.nodes, start, false), last = nodeAt(map.nodes, end, true);
      if (!first || !last || end <= start) return null;
      const range = document.createRange(); range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start); return range;
    }
    function setHighlight(name, ranges) { if (window.CSS?.highlights && window.Highlight) { const value = new Highlight(...ranges.filter(Boolean)); CSS.highlights.set(name, value); } }
    const highlightStyle = element('style'); highlightStyle.textContent = `::highlight(${highlightNames[0]}){background:#f2d78b;color:#26221b}::highlight(${highlightNames[1]}){background:#e9a83c;color:#20190d}::highlight(${highlightNames[2]}){background:#b8daca;color:#15392b}`; dialog.appendChild(highlightStyle);
    function scrollRange(range) {
      if (!range) return; const r = range.getBoundingClientRect(), b = body.getBoundingClientRect();
      if (r.top < b.top + 30 || r.bottom > b.bottom - 30) body.scrollTop += r.top - b.top - Math.max(32, b.height / 3);
    }
    function searchText(reset = true) {
      clearTimeout(searchTimer); searchTimer = 0;
      const map = searchMap = index(); query = input.value; matches = occurrences(map.text, query);
      if (reset) currentMatch = matches.length ? 0 : -1;
      else currentMatch = Math.min(Math.max(0, currentMatch), matches.length - 1);
      // Arquivos grandes continuam navegáveis; não criamos dezenas de milhares de ranges de uma vez.
      setHighlight(highlightNames[0], matches.slice(0, 1500).map(m => rangeFor(m.start, m.end, map)));
      showMatch();
    }
    function showMatch(scroll = true) {
      // "|| undefined": o valor padrão do rangeFor (index() novo) só vale para undefined; com searchMap null ele quebraria em null.nodes
      const selected = matches[currentMatch]; const range = selected && rangeFor(selected.start, selected.end, searchMap || undefined);
      // auditoria 2 (M-1): o texto mudou sem afterRender (as imagens do Markdown reescrevem o convite e a barra) e o mapa
      // aponta para um nó que saiu do documento; o Range nele não tem posição e o scrollRange subia o corpo. Refaz e mostra.
      // Com o corpo fora do documento nenhum mapa serve: refazer viraria um laço sem fim. Range recolhido = o nó mudou de lugar (leva 4).
      if (range && (range.collapsed || !range.startContainer.isConnected) && body.isConnected) { searchText(false); return; }
      setHighlight(highlightNames[1], range ? [range] : []);
      count.textContent = matches.length ? `${currentMatch + 1} de ${matches.length}` : '0 resultados'; previous.disabled = next.disabled = !matches.length;
      if (scroll) scrollRange(range);
    }
    function moveMatch(direction) {
      if (searchTimer) searchText();   // R5-04: seta ou Enter com busca pendente busca na hora (volta ao 1º resultado) e depois anda
      if (matches.length) { currentMatch = (currentMatch + direction + matches.length) % matches.length; showMatch(); }
    }
    function openSearch() { search.hidden = false; searchButton.setAttribute('aria-expanded', 'true'); input.focus(); input.select(); }
    function closeSearch() { clearTimeout(searchTimer); searchTimer = 0; searchMap = null; search.hidden = true; searchButton.setAttribute('aria-expanded', 'false'); highlightNames.slice(0, 2).forEach(n => CSS.highlights?.delete(n)); searchButton.focus(); }
    // R5-04: a busca espera 150 ms sem digitar; Enter ou seta com busca pendente (moveMatch) busca na hora e anda um resultado
    input.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { searchTimer = 0; if (alive) searchText(); }, 150); };
    input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); moveMatch(e.shiftKey ? -1 : 1); } };
    function applyView() {
      body.style.setProperty('--reader-font-size', view.fontSize + 'px'); body.classList.toggle('reader-wrap', !!view.wrap);
      zoomValue.textContent = Math.round(view.fontSize / 16 * 100) + '%'; wrap.setAttribute('aria-pressed', String(!!view.wrap));
    }
    function zoom(direction) { view.fontSize = direction ? Math.max(12, Math.min(24, view.fontSize + direction)) : 16; applyView(); }
    function snapshot() { return { ...view, mode: getMode(), scrollTop: Math.round(body.scrollTop), panel: activePanel, filter, search: search.hidden ? '' : input.value }; }
    function remember() { sessions.set(key, { view: alive ? snapshot() : (sessions.get(key)?.view || snapshot()), draft: draft && { ...draft } }); }
    function persist(patchOrFn) {
      pending = pending.then(async () => {
        if (!ready || conflict) return false;
        const patch = typeof patchOrFn === 'function' ? patchOrFn() : patchOrFn;
        try {
          const result = await api.readerCommentsSave({ document: descriptor, expectedRevision: state.revision, ...patch });
          if (!result?.ok) {
            if (result?.code === 'CONFLICT') conflict = true;
            say(conflict ? 'As anotações mudaram em outra janela. Seu texto foi mantido aqui; copie-o e releia o arquivo antes de continuar.' : 'Não consegui guardar. ' + (result?.error || '') + ' Seu texto continua aqui. Tente salvar novamente.', true);
            remember(); return false;
          }
          state = result.state; return true;
        } catch { say('Não consegui guardar. Seu texto continua aqui. Tente salvar novamente.', true); remember(); return false; }
      });
      documentWrites.set(key, pending);
      return pending;
    }
    function documentText(mode) { return mode === getMode() ? index().text : textForMode(mode); }
    function anchorStatus(comment, textos) {
      const mode = comment.mode || 'preview';
      if (!textos) return locateAnchor(documentText(mode), comment, descriptor?.version);
      // R5-06: o desenho da lista lê o texto de cada modo UMA vez (antes: o documento inteiro por comentário)
      if (!textos.has(mode)) textos.set(mode, documentText(mode));
      return locateAnchor(textos.get(mode), comment, descriptor?.version);
    }
    function showComment(comment) {
      const mode = comment.mode || 'preview'; if (mode !== getMode()) setMode(mode);
      const location = anchorStatus(comment);
      if (location.status !== 'found') { say(location.status === 'general' ? 'Comentário sobre o documento inteiro.' : 'Trecho mudou ou está repetido. A citação antiga foi preservada.', location.status !== 'general'); return; }
      selectedComment = comment.id; const range = rangeFor(location.start, location.end); setHighlight(highlightNames[2], [range]);
      if (window.innerWidth <= 680) togglePanel(''); scrollRange(range); body.focus();
    }
    function drawToc() {
      const headings = options.headings();
      if (!headings.length) sideContent.appendChild(element('p', 'reader-empty', 'Este documento não tem títulos.'));
      for (const heading of headings) {
        const b = button(heading.text, () => { if (getMode() !== 'preview') setMode('preview'); const target = [...body.querySelectorAll('[id]')].find(el => el.id === heading.id); if (window.innerWidth <= 680) togglePanel(''); target?.scrollIntoView({ block: 'start' }); body.focus(); }, '', null);
        b.classList.add('reader-toc-item'); b.style.setProperty('--reader-level', String(Math.min(4, heading.level - 1))); sideContent.appendChild(b);
      }
    }
    function togglePanel(nextPanel) {
      selectionBar.hidden = true;
      activePanel = nextPanel; aside.hidden = !nextPanel; layout.classList.toggle('reader-panel-open', !!nextPanel);
      commentsButton.setAttribute('aria-expanded', String(nextPanel === 'comments')); tocButton.setAttribute('aria-expanded', String(nextPanel === 'toc'));
      sideContent.replaceChildren(); sideTitle.textContent = nextPanel === 'toc' ? 'Sumário' : 'Comentários';
      if (nextPanel === 'toc') drawToc(); else if (nextPanel === 'comments') drawComments();
      if (!nextPanel) body.focus();
    }
    function startDraft(anchor = null, existing = null) {
      if (savingDraft) { say('Aguarde o comentário terminar de salvar.'); return; }
      if (!ready) { say('Aguarde as anotações carregarem.', true); return; }
      if (anchor?.quote?.length > 16000) { say('Selecione um trecho menor, com até 16 mil caracteres.', true); return; }
      if (draft?.text && !existing) { togglePanel('comments'); say('Termine ou descarte o comentário que está escrevendo antes de começar outro.'); return; }
      draft = existing ? { ...existing } : { text: '', quote: '', prefix: '', suffix: '', start: 0, end: 0, version: descriptor?.version, mode: getMode(), ...(anchor || {}) };
      selectionBar.hidden = true; togglePanel('comments'); sideContent.querySelector('textarea')?.focus(); remember(); persist({ draft });
    }
    function prepare(comment) {
      const quote = comment?.quote ? '\nTrecho:\n> ' + comment.quote.replace(/\n/g, '\n> ') : '';
      const note = comment?.text ? '\nComentário: ' + comment.text : '\nAjuste solicitado: ';
      const origin = dialog.querySelector('.visor-origem')?.textContent || 'Documento';
      const value = 'Revisar o arquivo ' + options.path + '\nOrigem: ' + origin + quote + note;
      const result = prepareDraft(value);
      say(result === false ? 'A conversa já foi fechada. Copie seu comentário para outra conversa.' : 'Rascunho acrescentado à conversa, sem enviar. O texto e os anexos anteriores foram mantidos.', result === false);
    }
    function drawComments() {
      if (!ready) { sideContent.appendChild(element('p', 'reader-empty', 'Carregando anotações…')); return; }
      const intro = element('p', 'reader-help', 'Anotações ficam neste Cockpit. O arquivo original permanece intacto.'); sideContent.appendChild(intro);
      const bar = element('div', 'reader-comment-filters');
      const opened = button('Abertos', () => { filter = 'open'; togglePanel('comments'); }), resolved = button('Resolvidos', () => { filter = 'resolved'; togglePanel('comments'); });
      opened.setAttribute('aria-pressed', String(filter === 'open')); resolved.setAttribute('aria-pressed', String(filter === 'resolved')); bar.append(opened, resolved); sideContent.appendChild(bar);
      const add = button('Comentário geral', () => startDraft()); add.disabled = conflict; sideContent.appendChild(add);
      if (draft) drawEditor();
      const comments = state.comments.filter(c => !!c.resolved === (filter === 'resolved'));
      const textos = new Map();
      if (!comments.length) sideContent.appendChild(element('p', 'reader-empty', filter === 'resolved' ? 'Nenhum comentário resolvido.' : 'Nenhum comentário aberto. Selecione um trecho ou faça um comentário geral.'));
      for (const comment of comments) {
        const card = element('section', 'reader-comment'); card.dataset.commentId = comment.id;
        if (comment.quote) { const q = element('blockquote', '', comment.quote); card.appendChild(q); }
        card.appendChild(element('p', 'reader-comment-text', comment.text));
        const location = anchorStatus(comment, textos);
        if (['changed', 'ambiguous'].includes(location.status)) card.appendChild(element('p', 'reader-anchor-warning', location.status === 'ambiguous' ? 'Trecho mudou · há mais de uma ocorrência possível.' : 'Trecho mudou · a citação antiga foi mantida.'));
        const actions = element('div', 'reader-comment-actions');
        if (comment.quote) actions.appendChild(button('Ver trecho', () => showComment(comment)));
        actions.append(button('Preparar ajuste', () => prepare(comment)), button('Editar', () => { if (draft?.text && draft.id !== comment.id) { say('Termine o comentário em edição primeiro.'); return; } startDraft(null, comment); }), button(comment.resolved ? 'Reabrir' : 'Resolver', async () => {
          const ok = await persist(() => ({ comments: state.comments.map(c => c.id === comment.id ? { ...c, resolved: !c.resolved, updatedAt: Date.now() } : c) }));
          if (ok && alive) { say(comment.resolved ? 'Comentário reaberto.' : 'Comentário resolvido.'); togglePanel('comments'); }
        }));
        if (['changed', 'ambiguous'].includes(location.status)) actions.appendChild(button('Vincular à seleção', async () => {
          if (!selection?.quote) { say('Selecione o novo trecho no documento e depois escolha Vincular à seleção.'); return; }
          const replacement = { ...selection }; const ok = await persist(() => ({ comments: state.comments.map(c => c.id === comment.id ? { ...c, ...replacement, updatedAt: Date.now() } : c) }));
          if (ok && alive) { togglePanel('comments'); say('Comentário vinculado ao trecho escolhido.'); }
        }));
        actions.appendChild(button('Excluir', () => {
          actions.replaceChildren(element('span', '', 'Excluir este comentário?'), button('Cancelar', () => togglePanel('comments')), button('Excluir comentário', async () => {
            const ok = await persist(() => ({ comments: state.comments.filter(c => c.id !== comment.id) }));
            if (ok && alive) { togglePanel('comments'); say('Comentário excluído.'); }
          }));
        })); card.appendChild(actions); sideContent.appendChild(card);
      }
    }
    function drawEditor() {
      const box = element('form', 'reader-comment-editor'); box.onsubmit = e => e.preventDefault();
      box.appendChild(element('strong', '', draft.id ? 'Editar comentário' : 'Novo comentário'));
      if (draft.quote) box.appendChild(element('blockquote', '', draft.quote));
      const textarea = element('textarea'); textarea.rows = 5; textarea.maxLength = 12000; textarea.value = draft.text || ''; textarea.disabled = savingDraft; textarea.placeholder = 'O que você quer registrar sobre este trecho?'; textarea.setAttribute('aria-label', 'Texto do comentário');
      textarea.oninput = () => { if (savingDraft || !draft) return; draft.text = textarea.value; remember(); clearTimeout(draftTimer); draftTimer = setTimeout(() => { if (draft) persist({ draft: { ...draft } }); }, 400); };
      const actions = element('div', 'reader-editor-actions');
      const save = button('Salvar comentário', async () => {
        if (savingDraft) return;
        if (!draft?.text.trim()) { say('Escreva o comentário antes de salvar.', true); textarea.focus(); return; }
        clearTimeout(draftTimer); savingDraft = true; save.disabled = textarea.disabled = discard.disabled = true; const edited = { ...draft }, now = Date.now();
        const original = state.comments.find(c => c.id === edited.id);
        const comment = { ...edited, id: edited.id || crypto.randomUUID(), createdAt: original?.createdAt || edited.createdAt || now, updatedAt: now, resolved: !!(original?.resolved ?? edited.resolved) };
        const ok = await persist(() => ({ comments: [...state.comments.filter(c => c.id !== comment.id), comment], draft: null }));
        savingDraft = false;
        if (ok) { draft = null; remember(); if (alive) { togglePanel('comments'); say('Comentário salvo.'); } } else save.disabled = false;
        if (!ok && alive) { textarea.disabled = discard.disabled = false; textarea.focus(); }
      });
      const discard = button('Descartar rascunho', async () => { if (savingDraft) return; clearTimeout(draftTimer); savingDraft = true; textarea.disabled = save.disabled = discard.disabled = true; const ok = await persist({ draft: null }); savingDraft = false; if (ok) { draft = null; remember(); if (alive) togglePanel('comments'); } else if (alive) { textarea.disabled = save.disabled = discard.disabled = false; } });
      save.disabled = discard.disabled = savingDraft;
      actions.append(save, discard); box.append(textarea, actions); sideContent.appendChild(box);
    }
    function captureSelection() {
      if (!alive) return;
      const selected = window.getSelection();
      if (!selected?.rangeCount || selected.isCollapsed) { selectionBar.hidden = true; return; }
      const range = selected.getRangeAt(0); if (!body.contains(range.startContainer) || !body.contains(range.endContainer)) return;
      const map = index(); const prefixRange = document.createRange(); prefixRange.selectNodeContents(body); prefixRange.setEnd(range.startContainer, range.startOffset);
      const start = prefixRange.toString().length, end = start + range.toString().length;
      if (!range.toString().trim()) { selectionBar.hidden = true; return; }
      selection = makeAnchor(map.text, start, end, descriptor?.version, getMode());
      const precedingHeading = [...body.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(h => h.contains(range.startContainer) || (h.compareDocumentPosition(range.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
      selection.section = (precedingHeading?.textContent || '').slice(0, 500);
      const r = range.getBoundingClientRect(), d = dialog.querySelector('.visor-cx').getBoundingClientRect();
      selectionBar.hidden = false; selectionBar.style.left = Math.max(8, Math.min(r.left - d.left, d.width - Math.min(340, d.width - 16) - 8)) + 'px';
      selectionBar.style.top = Math.max(8, Math.min(r.bottom - d.top + 6, d.height - 70)) + 'px';
    }
    function keyboard(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); event.stopImmediatePropagation(); openSearch(); return; }
      if (event.key !== 'Escape') return;
      if (!selectionBar.hidden) { selectionBar.hidden = true; window.getSelection()?.removeAllRanges(); }
      else if (!search.hidden) closeSearch();
      else if (!more.hidden) { more.hidden = true; moreButton.focus(); }
      else if (activePanel) togglePanel('');
      else return;
      event.preventDefault(); event.stopImmediatePropagation();
    }
    body.addEventListener('mouseup', captureSelection); body.addEventListener('keyup', captureSelection); dialog.addEventListener('keydown', keyboard, true);
    function afterRender() {
      applyView(); selection = null; selectionBar.hidden = true; highlightNames.forEach(n => window.CSS?.highlights?.delete(n));
      searchMap = null;   // o documento foi redesenhado: o mapa antigo não vale (R5-04)
      if (!search.hidden) searchText();
      if (activePanel === 'toc') { sideContent.replaceChildren(); drawToc(); }
      if (modeScroll[getMode()] != null) body.scrollTop = modeScroll[getMode()];
    }
    async function load() {
      try {
        await documentWrites.get(key);
        const cached = sessions.get(key);
        const result = descriptor && typeof api.readerCommentsGet === 'function' ? await api.readerCommentsGet(descriptor) : null;
        if (!alive) return;
        if (!result?.ok) { say('Anotações indisponíveis. ' + (result?.error || 'Busca e leitura continuam funcionando; releia o arquivo para tentar de novo.'), true); return; }
        state = result.state; ready = true; draft = cached ? cached.draft : state.draft;
        view = { ...view, ...state.view, ...(cached?.view || {}) };
        view.fontSize = Math.max(12, Math.min(24, Number(view.fontSize) || 16)); filter = view.filter || 'open';
        // Uma navegação explícita para seção ou linha tem prioridade sobre a posição guardada.
        if (!options.explicitLocation) {
          if (view.mode && view.mode !== getMode()) setMode(view.mode);
          if (view.search) { input.value = view.search; search.hidden = false; searchText(); }
          body.scrollTop = view.scrollTop || 0;
        }
        applyView(); if (view.panel || activePanel) togglePanel(activePanel || view.panel);
        if (draft?.text && !activePanel) say('Você tem um rascunho de comentário guardado em Comentários.');
      } catch { if (alive) say('Não consegui carregar as anotações. Releia o arquivo para tentar novamente.', true); }
    }
    load(); applyView();
    return {
      afterRender,
      beforeRender() { modeScroll[getMode()] = body.scrollTop; },
      dispose() {
        if (!alive) return; remember(); clearTimeout(draftTimer); clearTimeout(searchTimer);
        const closedView = snapshot();
        if (ready && !conflict) persist(() => ({ draft: draft ? { ...draft } : null, view: closedView }));
        alive = false; body.removeEventListener('mouseup', captureSelection); body.removeEventListener('keyup', captureSelection); dialog.removeEventListener('keydown', keyboard, true);
        highlightNames.forEach(n => window.CSS?.highlights?.delete(n));
        layout.before(body); layout.remove(); [tools, search, more, status, selectionBar, highlightStyle].forEach(el => el.remove());
        body.classList.remove('reader-wrap'); body.style.removeProperty('--reader-font-size');
      }
    };
  }
  return { mount, locateAnchor, makeAnchor, occurrences, renderIcon, nodeAt };
});
