(function () {
  'use strict';
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const checked = r => { if (!r || r.error) throw Error(r?.error || 'A integração não respondeu.'); return r; };
  const button = (icon, title, fn) => { const b = el('button', 'exp-icon'); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.innerHTML = typeof ico === 'function' ? ico(icon) : icon; b.onclick = fn; return b; };
  function field(label, input) { const l = el('label', 'exp-field'); l.append(el('span', '', label), input); return l; }
  // Dialog próprio: permanece acima do painel modal e conserva a comparação.
  function preview(image, previous) {
    const d = el('dialog', 'exp-dialog exp-image-preview'), tools = el('header', 'exp-header'), area = el('div', 'exp-preview-area'), img = el('img');
    img.src = image; img.alt = 'Nova versão ampliada'; let scale = 1;
    const paint = () => { img.style.width = (scale * 100) + '%'; };
    const close = () => { d.close(); d.remove(); if (previous?.isConnected) previous.focus(); };
    tools.append(button('minus', 'Diminuir imagem', () => { scale = Math.max(.25, scale - .25); paint(); }), button('plus', 'Ampliar imagem', () => { scale = Math.min(4, scale + .25); paint(); }), button('rotate-cw', 'Ajustar imagem à tela', () => { scale = 1; paint(); }), button('x', 'Fechar imagem ampliada', close));
    area.append(img); d.append(tools, area); d.addEventListener('cancel', e => { e.preventDefault(); close(); }); d.addEventListener('keydown', e => e.stopPropagation()); document.body.append(d); d.showModal();
  }
  async function open(P, { image = '', tab = image ? 'images' : 'voice' } = {}) {
    if (!P || P.morto) return;
    const before = document.activeElement;
    const d = el('dialog', 'exp-dialog');
    const header = el('header', 'exp-header'); header.append(el('h2', '', 'Recursos opcionais'), button('x', 'Fechar recursos opcionais', () => d.close()));
    const origin = el('p', 'exp-origin', (P.titulo || 'Esta conversa') + ' · ' + nomeDoMotor(P.engine) + ' · ' + (remotoDoPane(P) ? 'VPS' : 'PC'));
    const nav = el('nav', 'exp-nav'); nav.setAttribute('aria-label', 'Recursos opcionais');
    const body = el('div', 'exp-body'); d.append(header, origin, nav, body);
    let dispose = () => {}, generation = 0, active = true;
    const accountGeneration = P.uiContaGeracao || 0;
    const originalEngine = P.engine, originalSession = P.sessaoId || P.resumeId, originalPlace = JSON.stringify(remotoDoPane(P));
    const valid = () => active && !P.morto && (P.uiContaGeracao || 0) === accountGeneration && P.engine === originalEngine && (P.sessaoId || P.resumeId) === originalSession && JSON.stringify(remotoDoPane(P)) === originalPlace;
    function notice(text) { const n = el('p', 'exp-notice', text); n.setAttribute('role', 'status'); body.append(n); return n; }
    const run = async (b, fn, message) => { if (b.disabled) return; b.disabled = true; try { await fn(); } catch (e) { message.textContent = e.message; } finally { if (b.isConnected) b.disabled = false; } };
    async function grant(feature, acceptance) {
      if (!valid()) throw Error('A conversa mudou. Reabra este painel na sessão correta.');
      if (!acceptance.checked) throw Error('Marque a confirmação da cobrança antes de iniciar.');
      return checked(await window.api.experimentsGrant({ feature, costAccepted: true })).grant;
    }
    function consent(text) { const input = el('input'); input.type = 'checkbox'; const label = field(text, input); label.classList.add('exp-consent'); body.append(label); return input; }
    async function paint(which) {
      dispose(); dispose = () => {}; body.replaceChildren(); const gen = ++generation;
      [...nav.children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === which)));
      if (which === 'config') {
        notice('API OpenAI com cobrança separada. A chave fica protegida neste computador e não altera as contas do Claude ou do Codex.');
        const input = el('input'); input.type = 'password'; input.autocomplete = 'off'; input.spellcheck = false; input.placeholder = 'sk-…';
        body.append(field('Chave do projeto OpenAI', input)); const msg = notice('');
        const save = button('save', 'Guardar chave com proteção do Windows', () => run(save, async () => { checked(await window.api.experimentsKey(input.value)); input.value = ''; msg.textContent = 'Chave guardada. Nenhum recurso foi iniciado.'; }, msg)); body.append(save);
        return;
      }
      let status; try { status = checked(await window.api.experimentsStatus()); } catch (e) { notice(e.message); return; }
      if (!active || gen !== generation) return;
      if (!status.configured) {
        notice('Desligado. Configure uma chave de API no ícone de ajustes para usar este piloto. Não usa a cota da assinatura.');
        body.append(button('settings', 'Configurar chave da API', () => paint('config'))); return;
      }
      if (which === 'images') {
        notice('Gerar ou editar cobra uso da API de imagem e do modelo que interpreta o pedido. O original é preservado.');
        const select = el('select'); for (const [v, t] of [['gpt-image-2.5-sunburst', 'Sunburst · edição e qualidade'], ['gpt-image-2.5-flare', 'Flare · rapidez']]) { const o = el('option', '', t); o.value = v; select.append(o); }
        body.append(field('Modelo de imagem', select));
        const prompt = el('textarea'); prompt.rows = 3; prompt.maxLength = 12000; prompt.placeholder = 'Descreva a imagem ou o ajuste que você quer'; body.append(field('Seu pedido', prompt));
        const compare = el('div', 'exp-images'); let result = '', rectangle = '', pointer;
        if (image) {
          const source = el('div', 'exp-image-source'); const img = el('img'); img.src = image; img.alt = 'Original · arraste para indicar uma região'; source.append(img); compare.append(source);
          const box = el('div', 'exp-image-region'); box.hidden = true; source.append(box);
          source.addEventListener('pointerdown', e => { const r = source.getBoundingClientRect(); pointer = { x: e.clientX - r.left, y: e.clientY - r.top }; source.setPointerCapture(e.pointerId); });
          source.addEventListener('pointerup', e => {
            if (!pointer) return; const r = source.getBoundingClientRect(), x = Math.max(0, Math.min(r.width, e.clientX - r.left)), y = Math.max(0, Math.min(r.height, e.clientY - r.top));
            const left = Math.min(pointer.x, x), top = Math.min(pointer.y, y), width = Math.abs(x - pointer.x), height = Math.abs(y - pointer.y); pointer = null;
            if (width < 6 || height < 6) { rectangle = ''; box.hidden = true; return; }
            Object.assign(box.style, { left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px' }); box.hidden = false;
            rectangle = 'Região indicada pelo usuário (percentual da imagem, origem no canto superior esquerdo): x=' + Math.round(left/r.width*100) + '%, y=' + Math.round(top/r.height*100) + '%, largura=' + Math.round(width/r.width*100) + '%, altura=' + Math.round(height/r.height*100) + '%. Preserve o restante quando possível.';
          });
        }
        const output = el('div', 'exp-image-output'); compare.append(output); body.append(compare);
        const acceptance = consent('Autorizo esta geração com cobrança separada da assinatura.');
        const msg = notice(''); const actions = el('div', 'exp-actions');
        const create = button('sparkles', 'Gerar nova versão', () => run(create, async () => {
          if (!prompt.value.trim()) throw Error('Descreva o que deseja primeiro.');
          const g = await grant('images', acceptance); acceptance.checked = false; msg.textContent = 'Criando a nova versão…';
          const response = checked(await window.api.experimentsImage({ grant: g, model: select.value, prompt: [prompt.value, rectangle].filter(Boolean).join('\n'), image }));
          if (!active || gen !== generation) return;
          result = response.image; const img = el('img'); img.src = result; img.alt = 'Nova versão'; img.tabIndex = 0; img.setAttribute('role','button'); img.onclick = () => preview(result, img); img.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); img.click(); } };
          output.replaceChildren(img); msg.textContent = 'Nova versão pronta. Compare com o original.'; save.disabled = attach.disabled = false;
        }, msg));
        const save = button('download', 'Salvar nova imagem', () => run(save, async () => { checked(await window.api.experimentsSaveImage({ image: result, cwd: P.cwd })); }, msg)); save.disabled = true;
        const attach = button('paperclip', 'Anexar nova imagem sem enviar', () => run(attach, async () => {
          if (!valid()) throw Error('A sessão mudou. Reabra o painel antes de anexar.');
          const r = checked(await window.api.imagemSalvar({ dados: result, prefixo: 'gerada' })); if (!valid()) throw Error('A sessão mudou; a imagem foi salva localmente.');
          await anexar(P, [r.arquivo]); msg.textContent = 'Imagem anexada. Nenhuma mensagem foi enviada.';
        }, msg)); attach.disabled = true;
        actions.append(create, save, attach); body.append(actions); return;
      }
      if (which === 'cloud') {
        notice('Nuvem OpenAI · tarefa independente do PC e da VPS. Cobra modelo, ferramentas e ambiente. Fechar o Cockpit não cancela a tarefa.');
        const prompt = el('textarea'); prompt.rows = 3; prompt.placeholder = 'Tarefa para o ambiente na nuvem'; body.append(field('Tarefa', prompt));
        const browser = consent('Usar navegador hospedado (mais custo; sites e login pedem sua autorização).');
        const acceptance = consent('Autorizo iniciar esta tarefa com cobrança da API e do ambiente.');
        const msg = notice(''); const list = el('div', 'exp-cloud-list'), detail = el('div', 'exp-cloud-detail');
        let inspection = 0;
        const loginCleanups = new Set();
        const clearLogins = () => { for (const clean of loginCleanups) clean(); loginCleanups.clear(); };
        dispose = () => { inspection++; clearLogins(); };
        function loginForm(card, sessionId, action) {
          const request = action.request, inputs = new Map(), form = el('form', 'exp-cloud-login');
          form.autocomplete = 'off';
          const destination = el('strong', 'exp-login-origin', request.credential_origin || 'Destino não informado');
          form.append(el('p', '', 'Confira o endereço antes de preencher. Os dados serão enviados pelo formulário de login e ficam fora da conversa.'), destination);
          let origin;
          try { origin = new URL(request.credential_origin); } catch {}
          const safe = origin?.protocol === 'https:' && origin.origin === request.credential_origin && !origin.username && !origin.password;
          if (!safe) { form.append(el('p', '', 'Destino de login inválido. Cancele este pedido.')); card.append(form); return; }
          const options = Array.isArray(request.options) ? request.options : [], definitions = Array.isArray(request.fields) ? request.fields : [];
          const method = el('select'), fieldsBox = el('div');
          if (options.length) {
            for (const option of options) { const o = el('option', '', option.label || option.id); o.value = option.id; method.append(o); }
            form.append(field('Método de login', method));
          }
          const clearInputs = () => { for (const input of inputs.values()) input.value = ''; inputs.clear(); };
          function paintFields() {
            clearInputs(); fieldsBox.replaceChildren();
            const ids = options.find(o => o.id === method.value)?.field_ids || [];
            for (const definition of definitions.filter(f => !options.length || ids.includes(f.id)).slice(0, 30)) {
              const input = el('input'); input.type = 'password'; input.autocomplete = 'off'; input.spellcheck = false;
              input.maxLength = 8192; input.required = definition.required === true;
              input.dataset.fieldId = definition.id; inputs.set(definition.id, input);
              fieldsBox.append(field((definition.label || definition.id) + (input.required ? ' · obrigatório' : ' · opcional'), input));
            }
          }
          method.onchange = paintFields; paintFields(); form.append(fieldsBox);
          const confirmed = el('input'); confirmed.type = 'checkbox'; confirmed.required = true;
          const confirmation = field('Conferi o endereço e autorizo enviar estes dados de login.', confirmed); confirmation.classList.add('exp-consent'); form.append(confirmation);
          const sendLogin = el('button', 'exp-login-submit', 'Enviar dados de login'); sendLogin.type = 'submit'; form.append(sendLogin);
          let expired = false, busy = false;
          const timer = setTimeout(() => { expired = true; clearInputs(); confirmed.checked = false; sendLogin.disabled = true; msg.textContent = 'O formulário expirou. Atualize a tarefa para conferir o pedido atual.'; }, 5 * 60 * 1000);
          const clean = () => { expired = true; clearTimeout(timer); clearInputs(); confirmed.checked = false; sendLogin.disabled = true; };
          loginCleanups.add(clean);
          form.onsubmit = async e => {
            e.preventDefault(); if (busy || expired) return;
            if (!valid() || gen !== generation) { clean(); msg.textContent = 'A conversa mudou. Reabra este painel.'; return; }
            if (!form.reportValidity()) return;
            busy = true; sendLogin.disabled = true; method.disabled = true;
            const payload = { sessionId, requestId: action.request_id, decision: 'submit', requestToken: action.cockpit_request_token, originConfirmed: confirmed.checked,
              fields: [...inputs].map(([field_id, input]) => ({ field_id, value: input.value })), ...(options.length ? { selectedOption: method.value } : {}) };
            clean();
            try {
              checked(await window.api.cloudApprove(payload));
              if (valid() && gen === generation) { await inspect(sessionId); msg.textContent = 'Dados enviados. Confira o estado da tarefa para saber se o login foi concluído.'; }
            } catch (error) {
              if (valid() && gen === generation) msg.textContent = error.message + ' Atualize a tarefa antes de tentar novamente.';
            } finally { for (const f of payload.fields) f.value = ''; }
          };
          card.append(form);
        }
        async function inspect(sessionId) {
          if (!valid()) throw Error('A conversa mudou. Reabra este painel.');
          const currentInspection = ++inspection; clearLogins();
          msg.textContent = 'Consultando a tarefa…'; const r = checked(await window.api.cloudRead(sessionId)); if (!valid() || gen !== generation || currentInspection !== inspection) return;
          detail.replaceChildren(el('h3', '', 'Tarefa em nuvem'), el('p', '', 'Estado: ' + ({ running: 'trabalhando', queued: 'na fila', idle: 'aguardando', completed: 'concluída', cancelled: 'cancelada', canceled: 'cancelada', failed: 'falhou', errored: 'falhou', interrupted: 'interrompida', timed_out: 'tempo esgotado', archived: 'arquivada' }[r.session.status] || 'aguardando atualização')));
          const cancel = button('square', 'Cancelar o trabalho na nuvem', () => run(cancel, async () => { checked(await window.api.cloudCancel(sessionId)); await inspect(sessionId); }, msg));
          detail.append(cancel, button('refresh-cw', 'Atualizar tarefa', () => inspect(sessionId).catch(e => { msg.textContent = e.message; })));
          for (const action of r.session.required_actions || []) {
            const card = el('section', 'exp-cloud-action'); card.append(el('p', '', action.request?.origin || action.request?.reason || 'A tarefa precisa de uma decisão.'));
            const auth = action.request?.type === 'browser_authentication';
            if (auth) loginForm(card, sessionId, action);
            for (const decision of auth ? ['cancel'] : ['approve', 'deny', 'cancel']) {
              const b = button(decision === 'approve' ? 'check' : 'x', ({ approve:'Autorizar acesso a este site', deny:'Negar acesso', cancel:'Cancelar pedido' })[decision], () => run(b, async () => { if (!valid() || gen !== generation) throw Error('A conversa mudou. Reabra este painel.'); clearLogins(); checked(await window.api.cloudApprove({ sessionId, requestId: action.request_id, decision, requestToken: action.cockpit_request_token })); await inspect(sessionId); }, msg)); card.append(b);
            }
            detail.append(card);
          }
          for (const item of (r.items || []).slice().reverse()) {
            const text = (item.content || item.item?.content || []).filter(c => typeof c.text === 'string').map(c => c.text).join('\n');
            if (text) { const p = el('div', 'md'); p.innerHTML = mdSeguro(text); detail.append(p); }
          }
          for (const artifact of r.artifacts || []) {
            const row = el('div', 'exp-artifact', artifact.path || artifact.id); const b = button('download', 'Baixar ' + ((artifact.path || '').split('/').pop() || 'arquivo'), () => run(b, async () => { checked(await window.api.cloudArtifact({ sessionId, artifactId: artifact.id, name: (artifact.path || '').split('/').pop(), cwd: P.cwd })); }, msg)); row.append(b); detail.append(row);
          }
          msg.textContent = r.hasMore ? 'Mostrando até 100 mensagens e 100 arquivos; há mais registros na API.' : 'Estado consultado. Atualizar não inicia outro turno.';
        }
        async function refresh() { const rows = checked(await window.api.cloudList()); if (!active || gen !== generation) return; list.replaceChildren(); for (const row of rows) { const card = el('div', 'exp-cloud-row'); card.append(el('span', '', row.title), button('book-open', 'Acompanhar ' + row.title, () => inspect(row.id).catch(e => { msg.textContent = e.message; }))); list.append(card); } }
        const start = button('play', 'Iniciar tarefa paga na nuvem', () => run(start, async () => { const g = await grant('cloud', acceptance); acceptance.checked = false; msg.textContent = 'Criando tarefa…'; const r = checked(await window.api.cloudStart({ grant: g, input: prompt.value, browser: browser.checked })); await refresh(); await inspect(r.id); }, msg));
        body.append(start, button('refresh-cw', 'Atualizar lista de tarefas', () => refresh().catch(e => { msg.textContent = e.message; })), list, detail); await refresh(); return;
      }
      if (which === 'voice') {
        notice('GPT-Live fala com você; o motor desta sessão continua sendo ' + nomeDoMotor(P.engine) + '. O ditado local continua disponível no microfone da barra.');
        if (!originalSession || !window.CockpitLiveVoice) { notice('Abra uma conversa existente para conectar a voz.'); return; }
        const target = el('div', 'exp-live'); body.append(target);
        const session = { paneId: P.id, threadId: originalSession, engine: P.engine };
        const live = window.CockpitLiveVoice.mount({ container: target, session,
          start: async o => { if (!valid()) throw Error('A sessão mudou.'); const g = checked(await window.api.experimentsGrant({ feature: 'voice', costAccepted: o.costAccepted === true })).grant; return checked(await window.api.liveOffer({ ...o, grant: g, session })); },
          isCurrent: valid,
          getContext: () => (P.busy ? 'A sessão está trabalhando. ' : 'A sessão está aguardando. ') + 'Título da sessão selecionada: ' + (P.titulo || 'Conversa'),
          sendToPane: async (_session, text) => {
            if (!valid()) return { ok: false, error: 'A sessão mudou.' };
            const input = P.el.querySelector('.p-input');
            if (input.value.trim() || P.anexos?.length || P.citacao || P.planoPendente || P.perguntaAberta || contaEmAlteracao(P) || P._worktreeBusy || P._trocando) return { ok: false, error: 'Conclua o rascunho, os anexos ou a alteração deste painel antes de enviar por voz.' };
            input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); await send(P);
            if (input.value.trim() === text.trim()) return { ok: false, error: 'O pedido ficou no campo da sessão. Confira antes de reenviar.' };
            return { ok: true, busy: P.busy };
          },
          interruptPane: () => window.api.paneInterrupt({ paneId: P.id, engine: P.engine }),
        });
        P.liveVoice = live;
        dispose = () => { live.dispose(); if (P.liveVoice === live) P.liveVoice = null; };
      }
    }
    for (const [name, icon, label] of [['voice','audio-lines','Voz ao vivo'],['images','image','Criar e editar imagens'],['cloud','cloud','Tarefas na nuvem'],['config','settings','Configurar API']]) {
      const b = button(icon, label, () => paint(name)); b.dataset.tab = name; nav.append(b);
    }
    d.addEventListener('keydown', e => e.stopPropagation());
    const cleanup = () => { if (!active) return; active = false; dispose(); d.remove(); if (before?.isConnected) before.focus(); };
    const nativeClose = d.close.bind(d);
    d.close = () => { nativeClose(); cleanup(); };
    d.addEventListener('cancel', e => { e.preventDefault(); d.close(); });
    d.addEventListener('close', cleanup);
    document.body.append(d); d.showModal(); await paint(tab);
  }
  window.CockpitExperiments = { open };
})();
