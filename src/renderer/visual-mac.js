(function (root) {
  'use strict';
  const CORES = ['escuro', 'azul', 'claro', 'jornal', 'automatico'];
  const ANEIS = ['tema', 'motor', 'watch'];
  function onAccent(color) {
    if (!/^#[\da-f]{6}$/i.test(color || '')) return '#ffffff';
    const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    const light = .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
    return (light + .05) / .05 > 1.05 / (light + .05) ? '#000000' : '#ffffff';
  }
  function lightFor(theme, dark) { return theme === 'automatico' ? (dark ? 'escuro' : 'claro') : ['claro', 'jornal'].includes(theme) ? 'claro' : 'escuro'; }
  function readUsage(text) {
    const number = re => { const m = re.exec(text || ''); return m ? Math.max(0, Math.min(100, Number(m[1].replace(',', '.')))) : null; };
    // Lê o hover novo ("janela de 5 h: 42 %", "semana: 18 %") e o antigo ("sessão 42%", "semana 18%").
    return { sessao: number(/(?:sessão|janela de [^:;·()]+):? (\d+(?:[.,]\d+)?) ?%/), semana: number(/semana:? (\d+(?:[.,]\d+)?) ?%/) };
  }
  const LEVELS = { info: 1, success: 2, warning: 3, error: 4 };
  function notificationActionIcon(label) {
    const text = String(label || '').toLowerCase();
    const path = /todos|lista/.test(text) ? '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>'
      : /conta|login|entrar/.test(text) ? '<circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>'
      : /usar|anex|import/.test(text) ? '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M8 15h8m-4-4 4 4-4 4"/>'
      : /tentar|repetir|reconect|atualiz/.test(text) ? '<path d="M20 7v5h-5M4 17v-5h5M6.1 6a8 8 0 0 1 13 3M4.9 15a8 8 0 0 0 13 3"/>'
      : /conversa|responder/.test(text) ? '<path d="M21 11a8 8 0 0 1-8 8H7l-5 3V11a9 9 0 0 1 19 0ZM7 10h9M7 14h6"/>'
      : '<path d="M7 17 17 7M7 7h10v10"/>';
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }
  /* A loja recebe eventos antes da montagem. Resolver não é descartar: só o
     X chama onDismiss (na caixa de entrada esse gesto apaga um arquivo). */
  function createNotificationStore(onChange = () => {}) {
    const entries = new Map(), dismissed = new Map(), seen = new Map();
    let sequence = 0, version = 0;
    const emit = event => onChange(event);
    const remember = (id, revision) => {
      dismissed.delete(id); dismissed.set(id, revision);
      while (dismissed.size > 300) dismissed.delete(dismissed.keys().next().value);
    };
    function notify(value) {
      if (!value || typeof value.message !== 'string' || !value.message.trim()) return false;
      const message = value.message.trim().slice(0, 6000), title = String(value.title || '').slice(0, 300);
      const level = Object.hasOwn(LEVELS, value.level) ? value.level : 'info';
      const id = value.id != null ? String(value.id) : 'message:' + level + ':' + title + ':' + message;
      const revision = value.revision == null ? '' : String(value.revision);
      const occurrence = value.occurrence == null ? 'revision:' + revision : String(value.occurrence);
      const stamp = JSON.stringify([revision, occurrence]), token = JSON.stringify([id, occurrence]);
      if (dismissed.has(id) && dismissed.get(id) === stamp) return true;
      dismissed.delete(id);
      const previous = entries.get(id), action = typeof value.action?.run === 'function' ? value.action : null;
      const newOccurrence = !seen.has(token);
      seen.delete(token); seen.set(token, true);
      while (seen.size > 1000) seen.delete(seen.keys().next().value);
      const next = { id, title, message, level, revision, occurrence, stamp,
        replay: value.replay === true, quiet: value.quiet === true, attention: value.attention === true,
        persistent: value.persistent === true,
        priority: Number.isFinite(value.priority) ? value.priority : 0,
        action, onDismiss: typeof value.onDismiss === 'function' ? value.onDismiss : null,
        dismissLabel: String(value.dismissLabel || 'Dispensar aviso'),
        sequence: previous?.sequence ?? ++sequence, version: previous?.version || 0,
        busy: previous?.busy || false, actionError: previous?.actionError || '' };
      const changed = !previous || ['title', 'message', 'level', 'revision', 'occurrence', 'replay', 'quiet', 'attention', 'persistent', 'priority', 'dismissLabel'].some(key => previous[key] !== next[key])
        || previous.action?.label !== action?.label || !!previous.action !== !!action;
      if (changed) { next.version = ++version; next.actionError = ''; }
      entries.set(id, next);
      const transient = [...entries.values()].filter(item => !item.persistent);
      while (transient.length > 30) entries.delete(transient.shift().id);
      if (changed) emit({ kind: 'notify', entry: next, fresh: newOccurrence, newOccurrence });
      return true;
    }
    function resolve(id) {
      id = String(id);
      dismissed.delete(id);
      if (entries.delete(id)) emit({ kind: 'resolve', id });
    }
    function resolvePrefix(prefix) {
      if (typeof prefix !== 'string' || !prefix) return;
      for (const id of [...dismissed.keys()]) if (id.startsWith(prefix)) dismissed.delete(id);
      let changed = false;
      for (const id of [...entries.keys()]) if (id.startsWith(prefix)) { entries.delete(id); changed = true; }
      if (changed) emit({ kind: 'resolve', prefix });
    }
    async function perform(id, dismiss) {
      const before = entries.get(id);
      if (!before || before.busy || (!dismiss && !before.action)) return false;
      const version = before.version;
      before.busy = true; before.actionError = ''; emit({ kind: 'busy', id });
      try {
        const result = await (dismiss ? before.onDismiss?.() : before.action.run());
        const current = entries.get(id);
        if (result !== false && current?.version === version) {
          entries.delete(id);
          // Executar uma ação não significa dispensar avisos futuros. Só o
          // X silencia a mesma revisão; uma nova falha de login deve voltar.
          if (dismiss) remember(id, before.stamp);
          else dismissed.delete(id);
          emit({ kind: 'resolve', id });
        }
        return result !== false;
      } catch (error) {
        const current = entries.get(id);
        if (current?.version === version) {
          current.actionError = 'Não foi possível concluir: ' + String(error?.message || error || 'tente novamente').slice(0, 250);
        }
        return false;
      } finally {
        const current = entries.get(id);
        if (current) { current.busy = false; emit({ kind: 'settled', id }); }
      }
    }
    return { notify, resolve, resolvePrefix, act: id => perform(id, false), dismiss: id => perform(id, true),
      list: () => [...entries.values()].sort((a, b) => b.priority - a.priority || Number(b.persistent) - Number(a.persistent)
        || LEVELS[b.level] - LEVELS[a.level] || b.sequence - a.sequence) };
  }
  /* Apresentação separada da loja: recolher nunca apaga cartões. Relógio e
     efeitos injetáveis deixam provar os três segundos sem áudio ou UI reais. */
  function createNotificationPresenter(options = {}) {
    const schedule = options.setTimeout || setTimeout, cancel = options.clearTimeout || clearTimeout;
    const now = options.now || Date.now, holds = new Set(), pending = new Map(), active = new Map();
    let mode = 'closed', batchTimer = null, closeTimer = null, deadline = 0, remaining = 3000;
    let primary = null, lastSound = -Infinity, sounded = false;
    const preferences = () => options.preferences?.() || {};
    const rank = (a, b) => b.priority - a.priority || LEVELS[b.level] - LEVELS[a.level] || b.sequence - a.sequence;
    const state = () => ({ mode, open: mode !== 'closed', primary: primary?.id || null, count: active.size, held: holds.size > 0 });
    const publish = () => options.onChange?.(state());
    function stopClose() { if (closeTimer !== null) cancel(closeTimer); closeTimer = null; }
    function arm(delay = remaining) {
      stopClose(); if (holds.size || !['auto', 'hover'].includes(mode)) return;
      deadline = now() + delay;
      closeTimer = schedule(() => { closeTimer = null; close(); }, delay);
    }
    function close() {
      stopClose(); if (batchTimer !== null) cancel(batchTimer); batchTimer = null;
      pending.clear(); active.clear(); primary = null; mode = 'closed'; sounded = false; remaining = 3000; publish();
    }
    function manual() { stopClose(); mode = 'manual'; publish(); }
    function hold(reason, enabled) {
      const wasHeld = holds.size > 0;
      if (enabled) holds.add(reason); else holds.delete(reason);
      if (!wasHeld && holds.size && closeTimer !== null) { remaining = Math.max(0, deadline - now()); stopClose(); }
      if (wasHeld && !holds.size) arm(mode === 'hover' ? 160 : Math.max(600, remaining));
      publish();
    }
    function pointer(inside) {
      hold('pointer', inside);
      if (inside && mode === 'closed') { mode = 'hover'; remaining = 160; publish(); }
    }
    function sound() {
      if (preferences().sound === false || sounded || now() - lastSound < 2500) return;
      lastSound = now(); if (mode === 'auto') sounded = true;
      try { Promise.resolve(options.onSound?.()).catch(() => {}); } catch {}
    }
    function flush() {
      batchTimer = null;
      const batch = [...pending.values()]; pending.clear(); if (!batch.length) return;
      for (const entry of batch) active.set(entry.id, entry);
      if (!holds.size || !primary) primary = [...active.values()].sort(rank)[0];
      const canPeek = preferences().peek !== false;
      if (mode === 'closed' && canPeek) { mode = 'auto'; sounded = false; }
      // Cada lote novo tem tempo inteiro de leitura, inclusive o que chegou
      // perto do fim da prévia anterior. Interação continua pausando o prazo.
      if (mode === 'auto') { remaining = 3000; arm(); }
      publish();
      options.onAnnounce?.(primary, Math.max(0, active.size - 1));
      if (batch.some(entry => entry.attention)) sound();
      if (mode === 'closed') { active.clear(); primary = null; }
    }
    function event(value) {
      if (value?.kind !== 'notify' || !value.newOccurrence || value.entry.replay || value.entry.quiet) return;
      pending.set(value.entry.id, value.entry);
      // Protege o lote que espera seus 120ms: o vencimento da prévia anterior
      // não pode chamar close() e apagar uma ocorrência ainda não apresentada.
      if (mode === 'auto') { remaining = 3000; arm(); }
      if (batchTimer === null) batchTimer = schedule(flush, 120);
    }
    function sync(rows) {
      hold('action', rows.some(row => row.busy));
      const ids = new Set(rows.map(row => row.id));
      for (const id of pending.keys()) if (!ids.has(id)) pending.delete(id);
      for (const id of active.keys()) if (!ids.has(id)) active.delete(id);
      if (primary && !ids.has(primary.id)) { primary = [...active.values()].sort(rank)[0] || null; publish(); }
      if (mode === 'auto' && !active.size) close();
    }
    function updatePreferences() { if (preferences().peek === false && mode === 'auto') close(); }
    return { event, close, manual, hold, pointer, sync, updatePreferences, state };
  }
  function limitNotifications(engine, account, place, action) {
    if (!account || account.erro || account.error) return null;
    const prefix = 'account-limit:' + engine + ':' + (place?.chave || 'local') + ':';
    if (account.entrou === false) return { prefix, items: [], keep: [] };
    if (account.entrou !== true) return null;
    const items = [], keep = [], name = String(engine || 'Motor').replace(/^./, letter => letter.toUpperCase());
    const location = place?.remoto ? (place.rotulo || place.chave || 'Servidor') : 'Este PC';
    for (const [key, title, min] of [['semana', 'Limite semanal', 70], ['sessao', 'Janela de 5h', 90]]) {
      const usage = account[key];
      if (typeof usage?.pct !== 'number' || !Number.isFinite(usage.pct)) { keep.push(prefix + key); continue; }
      if (usage.pct < min) continue;
      const pct = Math.max(0, Math.min(100, usage.pct));
      let message = `${pct}% usado`;
      const resetAt = typeof usage.reseta === 'number' ? usage.reseta : Date.parse(usage.reseta);
      if (usage.reseta && Number.isFinite(resetAt)) message += ' · zera ' + new Date(resetAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      items.push({ id: prefix + key, title: `${name} · ${location} · ${title}`, message,
        level: pct >= 95 ? 'error' : 'warning', persistent: true, action,
        reset: Number.isFinite(resetAt) ? String(resetAt) : '', threshold: pct >= 100 ? 100 : pct >= 90 ? 90 : 70 });
    }
    return { prefix, items, keep };
  }
  function createLimitPublisher(store, resolveLogin = id => store.resolve(id)) {
    const peaks = new Map();
    return function setLimit(engine, account, place, action) {
      const batch = limitNotifications(engine, account, place, action);
      if (!batch) return;
      if (account.entrou === true) resolveLogin(place?.remoto ? 'login-servidor-' + engine + '-' + place.chave : 'login-pc-' + engine);
      const ids = new Set([...batch.keep, ...batch.items.map(item => item.id)]);
      for (const key of ['semana', 'sessao']) {
        const id = batch.prefix + key;
        if (!ids.has(id)) { store.resolve(id); peaks.delete(id); }
      }
      for (const item of batch.items) {
        const previous = peaks.get(item.id);
        const reset = item.reset || previous?.reset || '';
        const peak = previous && previous.reset === reset ? Math.max(previous.threshold, item.threshold) : item.threshold;
        peaks.set(item.id, { reset, threshold: peak });
        const action = item.action && { ...item.action, run: async () => {
          await item.action.run();
          return false; // Ver a conta não resolve o limite que continua ativo.
        } };
        store.notify({ ...item, action, revision: reset + ':' + peak, quiet: true });
      }
    };
  }
  function ringSVG(usage, engine, logo) {
    const circle = (r, value, cls) => value === null ? '' : `<circle class="${cls}${value >= 80 ? ' quente' : ''}" cx="16" cy="16" r="${r}" pathLength="100" fill="none" stroke-width="3.6" stroke-linecap="round" stroke-dasharray="${value} 100" transform="rotate(-90 16 16)"/>`;
    const known = ['claude', 'codex', 'gemini', 'grok', 'acp'].includes(engine) ? engine : 'acp';
    // O logo do motor (o mesmo do mostrador original, .ck-logo) vai no furo do anel de dentro: sobram 7 de raio
    // (r 8,8 menos metade do traço 3,6) e o logo tem 10 de lado, centrado em 16,16. Só entra o `d` dos <path>,
    // com caracteres de desenho: nada do que veio de fora vira marcação.
    const paths = [...String(logo || '').matchAll(/<path\b[^>]*?\sd="([^"]*)"/g)].map(m => m[1]).filter(d => /^[\w\s.,+-]+$/.test(d));
    const mark = paths.length ? `<svg class="mac-logo" x="11" y="11" width="10" height="10" viewBox="0 0 24 24">${paths.map(d => `<path d="${d}"/>`).join('')}</svg>` : '';
    return `<svg class="mac-aneis${usage.sessao === null && usage.semana === null ? ' desligado' : ''}" data-motor="${known}" viewBox="0 0 32 32" aria-hidden="true"><circle class="trilho-5h" cx="16" cy="16" r="13.5" fill="none" stroke-width="3.6"/><circle class="trilho-semana" cx="16" cy="16" r="8.8" fill="none" stroke-width="3.6"/>${circle(13.5, usage.sessao, 'anel-5h')}${circle(8.8, usage.semana, 'anel-semana')}${mark}</svg>`;
  }
  const pure = { lightFor, readUsage, ringSVG, onAccent, createNotificationStore, createNotificationPresenter, limitNotifications, createLimitPublisher };
  if (typeof module === 'object' && module.exports) { module.exports = pure; return; }
  const d = document, html = d.documentElement, api = root.api || {};
  const media = root.matchMedia('(prefers-color-scheme: dark)');
  let config, system = api.systemAppearanceInicial || { dark: media.matches, platform: api.plataforma }, island, line, list, body, counter, announcer;
  let latestBadge = -1, pulseTimer, sizeFrame, meterObserver, audioContext, presenter;
  let presentation = { mode: 'closed', open: false, primary: null, count: 0 };
  const items = new Map(), beforeMount = [];
  const notifications = createNotificationStore(event => {
    renderIsland();
    if (!island) { if (event.kind === 'notify') beforeMount.push(event); return; }
    presenter.sync(notifications.list()); presenter.event(event);
  });
  function announce(entry, others) {
    if (!island || !entry) return;
      island.classList.remove('nova-notificacao');
      void island.offsetWidth;
      island.classList.add('nova-notificacao');
      clearTimeout(pulseTimer); pulseTimer = setTimeout(() => island.classList.remove('nova-notificacao'), 900);
      announcer.textContent = ((entry.title ? entry.title + ': ' : '') + entry.message).slice(0, 450) + (others ? ` E mais ${others} ${others === 1 ? 'aviso' : 'avisos'}.` : '');
  }
  function prepareAudio() {
    try {
      const Audio = root.AudioContext || root.webkitAudioContext;
      if (!Audio) return null;
      if (!audioContext || audioContext.state === 'closed') audioContext = new Audio();
      if (audioContext.state === 'suspended') Promise.resolve(audioContext.resume()).catch(() => {});
      return audioContext;
    } catch { return null; }
  }
  async function playNotificationSound() {
    const context = prepareAudio();
    if (!context) return false;
    // Não espera indefinidamente uma permissão de áudio do navegador.
    if (context.state === 'suspended') {
      let timer;
      try { await Promise.race([Promise.resolve(context.resume()), new Promise(resolve => { timer = setTimeout(resolve, 300); })]); }
      catch {} finally { clearTimeout(timer); }
    }
    if (context.state !== 'running') return false;
    try {
      const oscillator = context.createOscillator(), gain = context.createGain(), at = context.currentTime;
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(880, at);
      oscillator.frequency.exponentialRampToValueAtTime(1046.5, at + .12);
      gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(.07, at + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, at + .23);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(at); oscillator.stop(at + .25); return true;
    } catch { return false; }
  }
  presenter = createNotificationPresenter({
    preferences: () => ({ peek: config?.notificationPeek !== false, sound: config?.notificationSound !== false }),
    onSound: playNotificationSound, onAnnounce: announce,
    onChange: state => { presentation = state; if (island) { open(state.open); island.dataset.presentation = state.mode; renderIsland(); } },
  });
  for (const type of ['pointerdown', 'keydown']) d.addEventListener(type, e => { if (e.isTrusted && config?.notificationSound !== false) prepareAudio(); }, { capture: true, passive: true });
  const setLimit = createLimitPublisher(notifications, id => {
    if (typeof root.resolverAviso === 'function') root.resolverAviso(id);
    else notifications.resolve(id);
  });
  const node = (tag, cls, text) => { const n = d.createElement(tag); n.className = cls; if (text != null) n.textContent = text; return n; };
  const call = (name, ...args) => { try { return Promise.resolve(api[name]?.(...args)).catch(() => null); } catch { return Promise.resolve(null); } };
  html.dataset.platform = api.plataforma || system.platform || 'win32';
  html.classList.toggle('visual-mac', api.visualMacInicial === true);
  html.dataset.macAneis = 'tema';

  function themeChanged(theme) {
    const selected = theme === 'motti' ? 'azul' : CORES.includes(theme) ? theme : 'escuro';
    html.dataset.tema = selected;
    html.dataset.macLuz = lightFor(selected, system.dark);
    if (selected === 'automatico' && html.classList.contains('visual-mac') && /^#[\da-f]{6}$/i.test(system.accent || '')) {
      html.style.setProperty('--mac-system-accent', system.accent);
      html.style.setProperty('--mac-system-on-accent', onAccent(system.accent));
    } else {
      html.style.removeProperty('--mac-system-accent');
      html.style.removeProperty('--mac-system-on-accent');
    }
    const style = getComputedStyle(html);
    call('setWindowTheme', { color: style.getPropertyValue('--work').trim() || (html.dataset.macLuz === 'claro' ? '#f5f5f7' : '#1c1c1e'), symbolColor: html.dataset.macLuz === 'claro' ? '#202024' : '#f5f5f7' });
    root.dispatchEvent(new CustomEvent('cockpit-appearance-changed'));
    measure();
  }
  function applyPreferences(value) {
    config = value;
    html.classList.toggle('visual-mac', config.visualMac === true);
    html.dataset.macAneis = ANEIS.includes(config.macAneis) ? config.macAneis : 'tema';
    themeChanged(config.tema);
    for (const input of d.querySelectorAll('.mac-visual-mac input')) input.checked = config.visualMac === true;
    for (const button of d.querySelectorAll('[data-aneis]')) button.setAttribute('aria-checked', String(button.dataset.aneis === html.dataset.macAneis));
    presenter.updatePreferences();
  }
  async function setVisual(enabled) {
    if (!config) return;
    config.visualMac = !!enabled;
    applyPreferences(config);
    await call('setVisualMac', config.visualMac);
    await call('setConfig', config);
  }
  function addPreferences(settings) {
    const section = settings.querySelector('.ck-preferences');
    if (!section || section.querySelector('.mac-visual-mac')) return;
    const label = node('label', 'ck-preference mac-visual-mac');
    const copy = node('span', 'ck-preference-copy');
    copy.append(node('span', 'aj-nome', 'Visual Mac'), node('span', 'aj-desc', 'Vidro, cantos arredondados e bolhas em qualquer cor.'));
    const input = node('input', ''); input.type = 'checkbox'; input.setAttribute('role', 'switch'); input.setAttribute('aria-label', 'Visual Mac'); input.checked = config?.visualMac === true;
    input.addEventListener('change', () => setVisual(input.checked)); label.append(copy, input);
    const ringRow = node('div', 'ck-preference mac-cor-aneis'), ringCopy = node('span', 'ck-preference-copy'), choices = node('div', 'mac-seg');
    ringCopy.append(node('span', 'aj-nome', 'Cor dos anéis'), node('span', 'aj-desc', 'De fora: janela de 5h. De dentro: semana.'));
    choices.setAttribute('role', 'radiogroup'); choices.setAttribute('aria-label', 'Cor dos anéis');
    for (const [value, title] of [['tema', 'Tema'], ['motor', 'Motor'], ['watch', 'Watch']]) {
      const b = node('button', '', title); b.type = 'button'; b.dataset.aneis = value; b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(value === html.dataset.macAneis));
      b.addEventListener('click', () => { config.macAneis = value; applyPreferences(config); call('setConfig', config); }); choices.append(b);
    }
    choices.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); const buttons = [...choices.children], index = buttons.indexOf(d.activeElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (index + (e.key === 'ArrowRight' ? 1 : 2)) % 3;
      buttons[next].click(); buttons[next].focus();
    });
    ringRow.append(ringCopy, choices); section.prepend(label, ringRow);
  }
  function measure() {
    if (!island || sizeFrame) return;
    sizeFrame = requestAnimationFrame(() => {
      sizeFrame = 0;
      const available = Math.max(140, innerWidth - island.getBoundingClientRect().left - 16);
      island.style.setProperty('--mac-ilha-max', available + 'px');
      // A lista tem rolagem própria: a caixa acompanha a parte visível,
      // não a altura total dos avisos que ficaram abaixo da rolagem.
      island.style.setProperty('--mac-ilha-h', Math.min(innerHeight - 64, line.offsetHeight + list.offsetHeight + 2) + 'px');
    });
  }
  function open(value, restoreFocus = false) {
    if (!island) return;
    island.classList.toggle('aberta', value);
    line.setAttribute('aria-expanded', String(value));
    list.inert = !value; list.setAttribute('aria-hidden', String(!value));
    body.scrollTop = 0;
    if (!value && restoreFocus) line.focus({ preventScroll: true });
    measure();
  }
  function mount(bar, nav) {
    if (island) return bar.parentElement;
    const frame = node('div', 'mac-window-bar');
    bar.before(frame); frame.append(bar);
    // 28/09: a faixa rola sem barra de rolagem; a roda do mouse (vertical) anda de lado
    bar.addEventListener('wheel', e => {
      if (!html.classList.contains('visual-mac') || e.ctrlKey) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || bar.scrollWidth <= bar.clientWidth) return;
      bar.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
    island = node('div', 'mac-ilha'); body = node('div', 'mac-ilha-corpo');
    line = node('button', 'mac-ilha-linha'); line.type = 'button'; line.setAttribute('aria-expanded', 'false'); line.setAttribute('aria-controls', 'mac-ilha-lista');
    const bell = node('span', 'mac-ilha-sino'); bell.setAttribute('aria-hidden', 'true');
    bell.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>';
    counter = node('span', 'mac-ilha-contador', '0'); counter.setAttribute('aria-hidden', 'true'); line.append(bell, counter);
    announcer = node('span', 'mac-ilha-anuncio'); announcer.setAttribute('role', 'status'); announcer.setAttribute('aria-live', 'polite'); announcer.setAttribute('aria-atomic', 'true');
    list = node('div', 'mac-ilha-lista'); list.id = 'mac-ilha-lista'; list.inert = true; list.setAttribute('aria-hidden', 'true');
    list.setAttribute('aria-label', 'Notificações');
    body.append(line, list); island.append(body, announcer); frame.prepend(island);
    const menu = node('button', 'ck-button mac-window-menu', '⋯'); menu.type = 'button'; menu.title = 'Menu do Cockpit'; menu.setAttribute('aria-label', menu.title);
    menu.addEventListener('click', () => call('showWindowMenu', { x: Math.round(menu.getBoundingClientRect().left), y: Math.round(menu.getBoundingClientRect().bottom) })); frame.append(menu);
    line.addEventListener('click', () => presentation.mode === 'manual' ? presenter.close() : presenter.manual());
    line.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); presenter.manual(); list.scrollTop = 0; list.querySelector('button:not([hidden])')?.focus({ preventScroll: true }); } });
    island.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') presenter.pointer(true); });
    island.addEventListener('pointerleave', () => presenter.pointer(false));
    island.addEventListener('focusin', () => presenter.hold('focus', true));
    island.addEventListener('focusout', () => { setTimeout(() => presenter.hold('focus', island.contains(d.activeElement)), 0); });
    d.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !presentation.open) return;
      const inside = island.contains(d.activeElement);
      // Uma janela de documento ou pergunta conserva seu próprio Escape.
      if (!inside && d.querySelector('dialog[open],.ck-overlay:not(.ck-saindo),#modalGrupo:not(.hidden),.p-modal:not(.hidden),.p-visor:not(.hidden)')) return;
      e.preventDefault(); e.stopPropagation(); presenter.close(); if (inside) line.focus({ preventScroll: true });
    }, true);
    d.addEventListener('pointerdown', e => { if (!island.contains(e.target)) presenter.close(); }, true);
    root.addEventListener('blur', () => presenter.close());
    root.addEventListener('resize', measure);
    if (html.dataset.platform === 'darwin') { const traffic = node('div', 'mac-traffic-space'); traffic.setAttribute('aria-hidden', 'true'); nav.querySelector('.ck-nav-top')?.prepend(traffic); }
    renderIsland();
    for (const event of beforeMount.splice(0)) presenter.event(event);
    const accounts = nav.querySelector('.ck-accounts');
    if (accounts) observeMeters(accounts);
    return frame;
  }
  function updateTower(rows) {
    const attention = rows.filter(r => r.state === 'attention' && !r.automation).length;
    if (attention !== latestBadge) { latestBadge = attention; call('setAttentionBadge', attention); }
  }
  function renderIsland() {
    if (!island) return;
    const rows = notifications.list();
    counter.textContent = rows.length > 99 ? '99+' : String(rows.length);
    line.setAttribute('aria-label', rows.length ? `${rows.length} ${rows.length === 1 ? 'notificação' : 'notificações'}. Abrir central de avisos.` : 'Nenhuma notificação. Abrir central de avisos.');
    line.title = 'Notificações';
    island.dataset.count = String(rows.length);
    island.dataset.level = rows.reduce((level, row) => LEVELS[row.level] > LEVELS[level] ? row.level : level, 'info');
    const focused = island.contains(d.activeElement) ? d.activeElement : null;
    let heading = list.querySelector('.mac-ilha-cabecalho');
    if (!heading) { heading = node('div', 'mac-ilha-cabecalho', 'Notificações'); list.prepend(heading); }
    const preview = presentation.mode === 'auto';
    heading.textContent = preview ? 'Novo aviso' + (presentation.count > 1 ? ` · +${presentation.count - 1}` : '') : 'Notificações';
    const keys = new Set();
    for (const row of rows) {
      const key = row.id; keys.add(key);
      let item = items.get(key);
      if (!item) {
        item = node('article', 'mac-notificacao'); item.dataset.notificationId = key;
        const copy = node('div', 'mac-notificacao-copy');
        item._title = node('strong', 'mac-notificacao-titulo'); item._message = node('p', 'mac-notificacao-mensagem');
        item._error = node('p', 'mac-notificacao-erro'); item._error.setAttribute('role', 'status');
        copy.append(item._title, item._message, item._error);
        const actions = node('div', 'mac-notificacao-acoes');
        item._action = node('button', 'mac-notificacao-acao'); item._action.type = 'button';
        item._action.addEventListener('click', () => notifications.act(key));
        item._dismiss = node('button', 'mac-notificacao-fechar', '×'); item._dismiss.type = 'button';
        item._dismiss.addEventListener('click', () => notifications.dismiss(key));
        actions.append(item._action, item._dismiss); item.append(copy, actions); items.set(key, item);
      }
      item.dataset.level = row.level; item.dataset.persistent = String(row.persistent);
      item.dataset.previewHidden = String(preview && row.id !== presentation.primary);
      item.setAttribute('aria-busy', String(row.busy));
      item._title.textContent = row.title; item._title.hidden = !row.title;
      item._message.textContent = row.message;
      item._error.textContent = row.actionError; item._error.hidden = !row.actionError;
      const actionLabel = String(row.action?.label || 'Abrir');
      item._action.innerHTML = notificationActionIcon(actionLabel); item._action.title = actionLabel;
      item._action.setAttribute('aria-label', actionLabel); item._action.hidden = !row.action;
      // disabled retira o foco antes de uma promessa terminar. aria-disabled
      // o conserva; a loja recusa cliques repetidos enquanto busy=true.
      item._action.setAttribute('aria-disabled', String(row.busy));
      item._dismiss.setAttribute('aria-disabled', String(row.busy)); item._dismiss.title = row.dismissLabel; item._dismiss.setAttribute('aria-label', row.dismissLabel);
      const position = keys.size;
      if (list.children[position] !== item) list.insertBefore(item, list.children[position] || null);
    }
    for (const [key, item] of items) if (!keys.has(key)) { if (focused && item.contains(focused)) line.focus({ preventScroll: true }); item.remove(); items.delete(key); }
    // Uma mudança de prioridade pode mover um item. Conserva o foco no
    // mesmo controle quando ele continua na tela, sem puxá-lo de outro lugar.
    if (focused?.isConnected && focused.hidden) line.focus({ preventScroll: true });
    else if (focused?.isConnected && d.activeElement !== focused) focused.focus({ preventScroll: true });
    for (const old of list.querySelectorAll('.mac-ilha-vazia')) old.remove();
    let all = list.querySelector('.mac-ilha-ver-todos');
    if (!all) { all = node('button', 'mac-ilha-ver-todos'); all.type = 'button'; all.addEventListener('click', () => presenter.manual()); }
    const allLabel = `Ver todos os avisos (${rows.length})`;
    all.innerHTML = notificationActionIcon('todos'); all.title = allLabel; all.setAttribute('aria-label', allLabel);
    all.hidden = !preview || rows.length < 2; list.append(all);
    if (!rows.length) list.append(node('p', 'mac-ilha-vazia', 'Tudo em dia. Os novos avisos aparecem aqui.'));
    measure();
  }
  function refreshMeters(container) {
    for (const button of container.querySelectorAll('.ck-acct')) {
      const label = button.querySelector('.ck-dial')?.getAttribute('aria-label') || '';
      if (button.dataset.macUsage === label && button.querySelector('.mac-aneis')) continue;
      const usage = readUsage(label), engine = button.closest('[data-key]')?.dataset.key?.split(':').at(-1) || 'acp';
      button.dataset.macUsage = label; button.classList.add('mac-com-aneis');
      button.querySelector('.mac-aneis')?.remove(); button.insertAdjacentHTML('beforeend', ringSVG(usage, engine, button.querySelector('.ck-logo')?.innerHTML));
      button.title = label;
    }
  }
  function observeMeters(container) {
    meterObserver?.disconnect();
    refreshMeters(container);
    meterObserver = new MutationObserver(() => refreshMeters(container));
    meterObserver.observe(container, { subtree: true, childList: true });
  }
  const scrollTimers = new WeakMap();
  d.addEventListener('scroll', e => {
    const el = e.target;
    if (!(el instanceof Element)) return;
    el.classList.add('mac-rolando'); clearTimeout(scrollTimers.get(el));
    scrollTimers.set(el, setTimeout(() => el.classList.remove('mac-rolando'), 900));
  }, true);
  function updateSystem(next) { if (!next || typeof next.dark !== 'boolean') return; system = next; themeChanged(config?.tema || html.dataset.tema); }
  media.addEventListener('change', () => updateSystem({ ...system, dark: media.matches }));
  api.onSystemAppearance?.(updateSystem);
  call('getSystemAppearance').then(updateSystem);
  root.VisualMac = { ...pure, applyPreferences, addPreferences, setVisual, themeChanged, mount, updateTower, setLimit, refreshMeters, observeMeters,
    notify: notifications.notify, resolveNotification: notifications.resolve, resolveNotifications: notifications.resolvePrefix,
    playNotificationSound };
  themeChanged(api.temaInicial || 'escuro');
})(typeof window === 'object' ? window : globalThis);
