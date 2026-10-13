(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CockpitConnectorPrompts = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  let sequence = 0;
  const ICONS = {
    check: '<path d="m5 12 4 4L19 6"/>', x: '<path d="m6 6 12 12M6 18 18 6"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/>',
    external: '<path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6"/>',
    draft: '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M16 3l5 5M10 14l-1 4 4-1 9-9-4-4z"/>',
  };
  function element(doc, tag, cls, value) {
    const el = doc.createElement(tag); if (cls) el.className = cls;
    if (value != null) el.textContent = value;
    return el;
  }
  function button(doc, title, icon, callback) {
    const b = element(doc, 'button', 'connector-icon'); b.type = 'button'; b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + ICONS[icon] + '</svg>';
    b.addEventListener('click', callback); return b;
  }
  function originLabel(origin) { return origin?.kind === 'remote' ? 'VPS · ' + String(origin.host || '') : 'Neste computador'; }
  function buildFields(doc, schema, parent, prefix) {
    const getters = [];
    for (const [name, s] of Object.entries(schema.properties || {})) {
      const required = (schema.required || []).includes(name);
      const id = prefix + '-' + (++sequence);
      const title = s.title || name;
      if (s.type === 'object') {
        const group = element(doc, 'fieldset', 'connector-group');
        group.append(element(doc, 'legend', '', title + (required ? ' *' : '')));
        if (s.description) group.append(element(doc, 'p', 'connector-hint', s.description));
        const get = buildFields(doc, s, group, id); parent.append(group);
        getters.push(out => { const v = get(); if (required || Object.keys(v).length) out[name] = v; });
        continue;
      }
      const wrap = element(doc, 'div', 'connector-field');
      const label = element(doc, 'label', '', title + (required ? ' *' : '')); label.htmlFor = id;
      wrap.append(label);
      let control, value;
      if (s.enum || s.type === 'boolean' || (s.type === 'array' && s.items?.enum)) {
        control = element(doc, 'select', 'connector-input');
        const multiselect = s.type === 'array';
        const options = multiselect ? s.items.enum : s.enum || [true, false];
        const labels = multiselect ? s.items.enumNames : s.enumNames;
        if (multiselect) { control.multiple = true; control.size = Math.min(5, options.length); }
        else { const empty = element(doc, 'option', '', 'Escolha'); empty.value = ''; control.append(empty); }
        options.forEach((v, i) => {
          const option = element(doc, 'option', '', labels?.[i] || (typeof v === 'boolean' ? (v ? 'Sim' : 'Não') : String(v)));
          option.value = String(i); control.append(option);
        });
        if (!s.secret && s.default != null && !multiselect) {
          const index = options.indexOf(s.default); if (index >= 0) control.value = String(index);
        }
        value = () => multiselect ? [...control.selectedOptions].map(o => options[Number(o.value)]) : control.value === '' ? undefined : options[Number(control.value)];
      } else if (s.type === 'array') {
        control = element(doc, 'textarea', 'connector-input'); control.rows = 3;
        control.maxLength = 20000; control.placeholder = 'Um item por linha';
        value = () => {
          const lines = control.value.split(/\r?\n/).filter(x => x.trim() !== '');
          return lines.map(x => s.items.type === 'number' || s.items.type === 'integer' ? Number(x) : s.items.type === 'boolean' ? /^(true|false)$/i.test(x.trim()) ? x.trim().toLowerCase() === 'true' : x : x);
        };
      } else {
        control = element(doc, 'input', 'connector-input');
        control.type = s.secret ? 'password' : ['number', 'integer'].includes(s.type) ? 'number' : s.format === 'email' ? 'email' : s.format === 'date' ? 'date' : 'text';
        if (['number', 'integer'].includes(s.type)) {
          control.step = s.type === 'integer' ? '1' : 'any';
          if (s.minimum != null) control.min = String(s.minimum);
          if (s.maximum != null) control.max = String(s.maximum);
        }
        if (s.type === 'string') { control.maxLength = s.maxLength ?? 20000; if (s.minLength != null) control.minLength = s.minLength; }
        if (!s.secret && s.default != null) control.value = String(s.default);
        value = () => control.value === '' ? undefined : ['number', 'integer'].includes(s.type) ? Number(control.value) : control.value;
      }
      control.id = id; control.required = required; control.name = name;
      control.autocomplete = s.secret ? 'new-password' : 'off'; control.spellcheck = !s.secret;
      control.setAttribute('data-secret', String(!!s.secret));
      wrap.append(control);
      if (s.description || s.secret) {
        const desc = element(doc, 'p', 'connector-hint', [s.description, s.secret ? 'Este valor não será salvo no histórico do Cockpit.' : ''].filter(Boolean).join(' '));
        desc.id = id + '-hint'; control.setAttribute('aria-describedby', desc.id); wrap.append(desc);
      }
      parent.append(wrap);
      getters.push(out => { const v = value(); if (v !== undefined && (!Array.isArray(v) || v.length || required)) out[name] = v; });
    }
    return () => { const out = Object.create(null); getters.forEach(get => get(out)); return out; };
  }
  function mount({ container, prompt, respond, openUrl, onClose = () => {} }) {
    if (!container || !prompt?.token || typeof respond !== 'function') throw Error('Pedido de conector incompleto.');
    const doc = container.ownerDocument;
    const card = element(doc, 'section', 'connector-prompt');
    card.setAttribute('aria-label', 'Pedido do conector ' + (prompt.serverName || ''));
    const header = element(doc, 'header', 'connector-heading');
    const title = element(doc, 'div'); title.append(element(doc, 'strong', '', prompt.serverName || 'Conector'));
    title.append(element(doc, 'span', 'connector-origin', originLabel(prompt.origin) + (prompt.threadId ? ' · ' + prompt.threadId : '')));
    header.append(title); card.append(header);
    card.append(element(doc, 'p', 'connector-message', prompt.message || 'O conector precisa de uma resposta para continuar.'));
    const form = element(doc, 'form', 'connector-form');
    let getContent = () => null;
    let closed = false, busy = false, timer;
    const status = element(doc, 'p', 'connector-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    if (prompt.mode === 'url') {
      form.append(element(doc, 'p', 'connector-destination', prompt.urlOrigin || 'Endereço do conector'));
      form.append(element(doc, 'p', 'connector-hint', 'Abra o site se quiser continuar. Depois de concluir por lá, confirme aqui. Abrir o site não aceita este pedido.'));
      form.append(button(doc, 'Abrir site do conector', 'external', async () => {
        if (closed || busy || typeof openUrl !== 'function') return;
        try { const r = await openUrl({ token: prompt.token, paneId: prompt.paneId }); if (r?.ok === false) status.textContent = r.error || 'Não foi possível abrir o site.'; }
        catch { status.textContent = 'Não foi possível abrir o site.'; }
      }));
    } else getContent = buildFields(doc, prompt.schema || {}, form, 'connector-' + (++sequence));
    const actions = element(doc, 'div', 'connector-actions');
    function disable(value) { form.querySelectorAll('input,select,textarea,button').forEach(el => { el.disabled = value; }); }
    function wipe() { form.querySelectorAll('input,textarea').forEach(el => { el.value = ''; }); form.querySelectorAll('select').forEach(el => { el.selectedIndex = -1; }); }
    async function answer(action) {
      if (closed || busy) return;
      if (action === 'accept' && !form.reportValidity()) return;
      busy = true; status.textContent = 'Enviando resposta…'; disable(true);
      try {
        const result = await respond({ token: prompt.token, paneId: prompt.paneId, action, content: action === 'accept' ? getContent() : null });
        if (closed) return;
        if (result?.ok === false) { status.textContent = result.error || 'Não foi possível responder.'; if (result.code === 'STALE') { wipe(); closed = true; clearTimeout(timer); } else disable(false); return; }
        closed = true; clearTimeout(timer); wipe(); status.textContent = action === 'accept' ? 'Resposta enviada ao conector.' : action === 'decline' ? 'Pedido recusado.' : 'Pedido cancelado.';
        onClose(action);
      } catch { if (!closed) { disable(false); status.textContent = 'Não foi possível responder. Tente novamente.'; } }
      finally { busy = false; }
    }
    actions.append(button(doc, 'Cancelar pedido', 'x', () => answer('cancel')),
      button(doc, 'Recusar pedido', 'ban', () => answer('decline')));
    const accept = button(doc, prompt.mode === 'url' ? 'Confirmar que concluí no site' : 'Enviar resposta ao conector', 'check', () => answer('accept'));
    accept.classList.add('connector-primary'); actions.append(accept);
    form.addEventListener('submit', event => { event.preventDefault(); answer('accept'); });
    form.append(status, actions); card.append(form); container.append(card);
    if (prompt.expiresAt) timer = setTimeout(() => { if (!closed) { closed = true; disable(true); wipe(); status.textContent = 'Este pedido expirou. O conector precisa fazer um novo pedido.'; onClose('expired'); } }, Math.max(0, prompt.expiresAt - Date.now()));
    // Receber um pedido NÃO move foco nem abre modal. O chamador escolhe onde
    // mostrar o cartão e pode anunciá-lo pela Ilha sem interromper a digitação.
    return { element: card, dispose(reason) { closed = true; clearTimeout(timer); wipe(); card.remove(); if (reason) onClose(reason); } };
  }
  function mountHostAction({ container, action, type, onOpen, onDraft }) {
    const doc = container.ownerDocument, card = element(doc, 'section', 'connector-host-action');
    const artifact = type === 'host-artifact';
    const words = element(doc, 'div');
    words.append(element(doc, 'strong', '', artifact ? action.title || 'Arquivo disponível' : 'Rascunho disponível'));
    words.append(element(doc, 'span', 'connector-origin', originLabel(action.origin)));
    if (action.file) words.append(element(doc, 'span', 'connector-path', action.file));
    card.append(words);
    const status = element(doc, 'span', 'connector-status'); status.setAttribute('role', 'status');
    const b = button(doc, artifact ? 'Abrir arquivo no leitor' : 'Inserir rascunho sem enviar', artifact ? 'file' : 'draft', async () => {
      b.disabled = true;
      try { const r = await (artifact ? onOpen?.(action) : onDraft?.(action)); if (r?.ok === false) throw Error(); if (!artifact) status.textContent = 'Rascunho inserido. Revise antes de enviar.'; }
      catch { status.textContent = artifact ? 'Não foi possível abrir o arquivo.' : 'Não foi possível inserir o rascunho.'; }
      finally { if (artifact || !status.textContent.startsWith('Rascunho inserido')) b.disabled = false; }
    });
    card.append(b, status); container.append(card);
    return { element: card, dispose() { card.remove(); } };
  }
  return { mount, mountHostAction, originLabel };
});
