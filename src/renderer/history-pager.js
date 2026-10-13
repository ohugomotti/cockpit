(function (root) {
  'use strict';
  function mount({ container, messages, draw, valid, identity, initialSize = 60 }) {
    const data = messages.filter(m => m && ['user', 'bot', 'note'].includes(m.role));
    const fragment = document.createElement('div'); fragment.className = 'history-pages';
    const toolbar = document.createElement('div'); toolbar.className = 'history-pages-toolbar';
    const content = document.createElement('div'); content.className = 'history-pages-content';
    const status = document.createElement('span'); status.setAttribute('role', 'status');
    const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Buscar na conversa inteira'; search.setAttribute('aria-label', search.placeholder);
    const key = 'cockpit.history.position.' + identity;
    let start = Math.max(0, data.length - initialSize), end = data.length, loading = false, disposed = false, timer;
    let saved;
    try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch {}
    if (saved?.index >= 0 && saved.index < data.length && !saved.atEnd) { start = Math.min(start, saved.index); end = Math.min(data.length, start + initialSize); }
    function button(icon, label, action) {
      const b = document.createElement('button'); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); b.innerHTML = typeof ico === 'function' ? ico(icon) : ''; b.onclick = action; return b;
    }
    const older = button('arrow-up', 'Carregar mensagens anteriores', () => extend());
    const first = button('arrow-up-to-line', 'Ir à primeira mensagem', () => show(0));
    const last = button('arrow-down-to-line', 'Ir à última mensagem', () => show(data.length - 1));
    // desenha só data[from..to) num contêiner solto e devolve os nós, cada um com o número da sua mensagem
    function block(from, to) {
      const holder = document.createElement('div');
      draw(data.slice(from, to), holder, from);
      const nodes = [...holder.children];
      nodes.forEach((el, n) => { if (!el.dataset.historyIndex) el.dataset.historyIndex = String(from + n); });
      return nodes;
    }
    function label() { status.textContent = (start + 1) + '–' + end + ' de ' + data.length; older.disabled = start === 0; }
    function paint(keep) {
      if (disposed || !valid()) return;
      const height = container.scrollHeight, top = container.scrollTop;
      content.replaceChildren(...block(start, end));
      label();
      if (keep) container.scrollTop = top + container.scrollHeight - height;
    }
    /* R4-05: subir desenha só o bloco novo e põe no começo, com a rolagem no lugar; descer (grow), só o bloco seguinte
       no fim. O paint() de antes apagava e redesenhava de start a end a cada 60: subir 2.000 mensagens desenhava ~35 mil.
       Redesenho inteiro só em show() e all(). */
    function extend() {
      if (loading || start === 0 || disposed || !valid()) return;
      loading = true;
      try {
        const height = container.scrollHeight, top = container.scrollTop, before = start;
        start = Math.max(0, start - initialSize);
        content.prepend(...block(start, before));
        label();
        container.scrollTop = top + container.scrollHeight - height;
      } finally { loading = false; }
    }
    function grow() {
      if (disposed || !valid() || end >= data.length) return;
      const top = container.scrollTop, before = end;
      end = Math.min(data.length, end + initialSize);
      content.append(...block(before, end));
      label();
      container.scrollTop = top;
    }
    function show(index) {
      start = Math.max(0, index - 10); end = Math.min(data.length, Math.max(index + initialSize, start + initialSize));
      paint(false); content.children[index - start]?.scrollIntoView({ block: 'start' });
    }
    let lastQuery = '', match = -1;
    function find() {
      const q = search.value.trim().toLocaleLowerCase(); if (!q) return;
      if (q !== lastQuery) match = -1;
      lastQuery = q;
      let next = data.findIndex((m, i) => i > match && String(m.text || '').toLocaleLowerCase().includes(q));
      if (next < 0) next = data.findIndex(m => String(m.text || '').toLocaleLowerCase().includes(q));
      if (next < 0) { status.textContent = 'Nenhum trecho encontrado'; return; }
      match = next; show(next);
      const el = content.children[next - start]; if (el) { el.classList.add('history-match'); el.tabIndex = -1; el.focus({ preventScroll: true }); }
    }
    search.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); find(); } });
    toolbar.append(first, older, status, search, button('search', 'Buscar próximo trecho', find), last);
    fragment.append(toolbar, content); container.append(fragment); paint(false);
    if (saved && !saved.atEnd) setTimeout(() => { if (valid()) content.querySelector('[data-history-index="' + saved.index + '"]')?.scrollIntoView({ block: 'start' }); }, 50);
    function onScroll() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!valid() || disposed) return;
        const top = container.getBoundingClientRect().top;
        const firstVisible = [...content.children].find(el => el.getBoundingClientRect().bottom >= top);
        try { localStorage.setItem(key, JSON.stringify({ index: Number(firstVisible?.dataset.historyIndex || start), atEnd: container.scrollHeight - container.scrollTop - container.clientHeight < 60 })); } catch {}
        if (container.scrollTop < 60) extend();
        // Depois de um salto para o começo, ir descendo também carrega o resto.
        if (end < data.length && container.scrollHeight - container.scrollTop - container.clientHeight < 100) grow();
      }, 120);
    }
    container.addEventListener('scroll', onScroll, { passive: true });
    return { dispose() { disposed = true; clearTimeout(timer); container.removeEventListener('scroll', onScroll); fragment.remove(); }, show, find,
      all() { start = 0; end = data.length; paint(false); }, focusSearch() { search.focus(); search.select(); },
      get complete() { return start === 0 && end === data.length; }, get range() { return [start, end]; } };
  }
  root.CockpitHistoryPager = { mount };
})(typeof window === 'object' ? window : globalThis);
