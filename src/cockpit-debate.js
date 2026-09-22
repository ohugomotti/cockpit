'use strict';
const fsReal = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { PASTAS_DE_MOTOR, SUBPASTAS_DE_MOTOR_LIVRES, PASTAS_SECRETAS_LISTA, PARES_SECRETOS } = require('./leitura-mcp');

/* resposta: 16 mil caracteres por fala (~2.500 palavras) -- sobra para uma
   fala com evidencia; o que passar e' cortado E marcado (na tela e no prompt).
   Prazo por fala: 10 min so' texto, 15 min lendo o projeto (ler arquivo leva
   tempo). Os dois numeros vao no estado (state.limites) e aparecem na tela. */
const LIMITS = Object.freeze({ topic: 8000, context: 24000, answer: 16000, messages: 50 });
const PRAZO_TEXTO_MS = 10 * 60 * 1000, PRAZO_LEITURA_MS = 15 * 60 * 1000;
const ESFORCOS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const MOTORES_DEBATE = ['codex', 'claude'];
const NOME = { codex: 'Codex', claude: 'Claude', user: 'Usuário' };
const outro = engine => MOTORES_DEBATE.find(e => e !== engine);
const idOK = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const copy = value => JSON.parse(JSON.stringify(value));
function clean(value, limit) { return String(value || '').slice(0, limit); }
function roundsOf(value) { const n = Number(value ?? 2); if (!Number.isInteger(n) || n < 1 || n > 3) throw new Error('Escolha de 1 a 3 rodadas.'); return n; }
/* o ~/.codex/AGENTS.md (e o CLAUDE.md) mandam fechar com "Use: <modelo>".
   No debate isso vira ruido que um passa pro outro: sai a linha final. So' o
   formato do rodape ("[h5]" ou nome de modelo): "Use: `npm test`" fica. A
   mesma regra abre a resposta com "Vou usar: …" (medido no debate vivo de
   14/09): a primeira linha sai tambem, se houver fala depois dela. */
function semRodape(text) {
  return String(text || '')
    .replace(/^\s*(?:Vou usar:[^\n]{0,240}|Sem ferramenta específica, fazendo direto\.?)[ \t]*\n+(?=\S)/i, '')
    .replace(/\n[ \t]*[*_>]*[ \t]*Use:[ \t]*(?:\[[a-z0-9]{1,6}\]|(?:GPT|Claude|Opus|Sonnet|Haiku|Fable|Codex|Gemini|Grok)[\w .()-]{0,30})[ \t]*[*_]*\s*$/i, '').trimEnd();
}
/* so' fala boa entra na conversa que vai pro prompt: interrompida, com erro ou
   vazia continua no historico (marcada), mas nao e' argumento pra ninguem */
const falaValida = m => m.status === 'completed' && String(m.text || '').trim();
function proximoAFalar(state) {
  const ultima = state.messages.findLast(m => MOTORES_DEBATE.includes(m.speaker) && falaValida(m));
  return ultima ? outro(ultima.speaker) : state.first;
}

function buildPrompt(state, engine, last) {
  const nome = NOME[engine], adversario = NOME[outro(engine)];
  const history = state.messages.filter(falaValida)
    .map(m => `### ${NOME[m.speaker] || m.speaker}\n${m.text}${m.truncated ? '\n[resposta cortada em 16.000 caracteres]' : ''}`).join('\n\n');
  const propoe = engine === state.first;
  const projeto = state.leitura
    ? `Projeto: ${path.basename(state.cwd)}\nPasta: ${state.cwd}\n`
      + 'Você pode LER os arquivos desta pasta (somente leitura) para embasar o que disser. Leia só o necessário. '
      + 'Traga evidência do código: cite o arquivo e a linha (ou o trecho) que você leu. Não invente arquivo nem linha; o que você não leu, marque como hipótese.\n'
    : (state.semLeitura === 'remoto'
      ? 'Este projeto está num servidor remoto e o debate roda neste computador: não há acesso aos arquivos. Discuta com base no problema e no contexto fornecido, e marque o que é hipótese.\n'
      : 'Não há acesso aos arquivos neste debate. Discuta com base no problema e no contexto fornecido, e marque o que é hipótese.\n');
  return `Você é ${nome}, num debate com ${adversario} que a pessoa usuária acionou manualmente no Cockpit. Responda em português do Brasil.\n`
    + projeto
    + (propoe
      ? `Seu papel: você PROPÕE. Traga uma proposta concreta para o problema e, nas falas seguintes, refine a proposta com as objeções de ${adversario} que fizerem sentido.\n`
      : `Seu papel: você CONTESTA. Procure falhas, riscos e o que falta na proposta de ${adversario}; diga o que manteria e proponha a alternativa concreta.\n`)
    + 'Avalie as razões do outro, concorde quando fizer sentido e aponte divergências concretas. Não invente a fala do outro. Não altere arquivos e não envie nada a terceiros.\n'
    + (last
      ? 'Esta é a última fala desta rodada. Feche com três seções: "## Consenso", "## Divergências" e "## Próximos passos" (uma proposta para a pessoa usuária decidir). Não declare consenso quando houver discordância.\n'
      : 'Seja objetivo e termine com o ponto que o outro precisa responder.\n')
    + (state.review ? 'Revisão de código: para cada problema encontrado, informe arquivo, linha quando identificável, gravidade, evidência e correção sugerida. Não invente números de linha. As alterações não serão aplicadas aqui.\n' : '')
    + `Você tem até ${Math.round(state.limites.falaMs / 60000)} min nesta fala.\n`
    + `\nPROBLEMA\n${state.topic}\n\nCONTEXTO FORNECIDO (conversa do painel)\n${state.context || '(nenhum contexto adicional)'}\n`
    + (state.review ? `\nMUDANÇAS SOB REVISÃO (${state.review.hash})\n${state.review.diff}\n${state.review.note || ''}\n` : '')
    + `\nCONVERSA DO DEBATE\n${history || '(você começa)'}\n\nSua vez, ${nome}.`;
}

/* o que vai pra tela: sem o diff da revisao (ate' 120 KB), que a tela nao usa
   e ia junto em cada pedaco de texto */
function paraTela(state) {
  const v = copy(state);
  if (v.review && typeof v.review.diff === 'string') { v.review.diffChars = v.review.diff.length; delete v.review.diff; }
  return v;
}

class DebateManager {
  constructor({ directory, runTurn, onUpdate = () => {}, timeoutMs = PRAZO_TEXTO_MS, timeoutLeituraMs = PRAZO_LEITURA_MS, fsImpl = fsReal, throttleMs = 150, home = os.homedir() }) {
    this.directory = directory; this.runTurn = runTurn; this.onUpdate = onUpdate; this.timeoutMs = timeoutMs; this.timeoutLeituraMs = timeoutLeituraMs;
    this.fs = fsImpl; this.throttleMs = throttleMs; this.home = home;
    this.states = new Map(); this.active = new Map(); this.retries = new Map(); this.lastEmit = new Map(); this.soon = new Map();
  }
  folder() { const p = typeof this.directory === 'function' ? this.directory() : this.directory; this.fs.mkdirSync(p, { recursive: true }); return p; }
  file(id) { if (!idOK(id)) throw new Error('Debate inválido.'); return path.join(this.folder(), id + '.json'); }
  write(state) { const file = this.file(state.id), temp = file + '.tmp'; this.fs.writeFileSync(temp, JSON.stringify(state, null, 2)); this.fs.renameSync(temp, file); }
  /* antivirus/indexador segurando o arquivo (EPERM no rename) nao pode derrubar
     o debate: o estado em memoria segue, tenta de novo em 200 ms e a tela avisa */
  persist(state) {
    state.updatedAt = new Date().toISOString();
    delete state.saveError;
    try { this.write(state); }
    catch (error) {
      state.saveError = 'Não consegui salvar o histórico deste debate (' + (error.code || 'erro de disco') + '). A conversa continua aqui na tela.';
      clearTimeout(this.retries.get(state.id));
      this.retries.set(state.id, setTimeout(() => {
        this.retries.delete(state.id);
        try { const aviso = state.saveError; delete state.saveError; this.write(state); if (aviso) this.onUpdate(paraTela(state)); } catch {}
      }, 200));
    }
  }
  publish(state, save = true) {
    clearTimeout(this.soon.get(state.id)); this.soon.delete(state.id);
    if (save) this.persist(state);
    this.lastEmit.set(state.id, Date.now()); this.onUpdate(paraTela(state));
  }
  /* pedaco de texto: junta e manda no maximo a cada 150 ms; o ultimo sempre sai */
  publishSoon(state, save) {
    if (save) this.persist(state);
    const wait = this.throttleMs - (Date.now() - (this.lastEmit.get(state.id) || 0));
    if (wait <= 0) { this.publish(state, false); return; }
    if (!this.soon.has(state.id)) this.soon.set(state.id, setTimeout(() => { this.soon.delete(state.id); this.publish(state, false); }, wait));
  }
  get(id) {
    if (this.states.has(id)) return paraTela(this.states.get(id));
    const raw = JSON.parse(this.fs.readFileSync(this.file(id), 'utf8'));
    if (raw.id !== id || !Array.isArray(raw.messages)) throw new Error('Histórico do debate inválido.');
    if (raw.status === 'running') {
      raw.status = 'interrupted'; raw.error = 'O aplicativo foi fechado durante a discussão. Continue somente quando desejar.';
      for (const m of raw.messages) if (m.status === 'running') { m.status = 'interrupted'; delete m.activity; }
      this.persist(raw);
    }
    if (!raw.limites) raw.limites = { falaMs: raw.leitura ? this.timeoutLeituraMs : this.timeoutMs, resposta: LIMITS.answer };
    this.states.set(id, raw); return paraTela(raw);
  }
  list() {
    return this.fs.readdirSync(this.folder()).filter(f => /^[a-f0-9-]{36}\.json$/.test(f)).map(f => {
      try { const s = this.get(f.slice(0, -5)); return { id: s.id, topic: s.topic.slice(0, 160), status: s.status, updatedAt: s.updatedAt, paneId: s.paneId }; } catch { return null; }
    }).filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 60);
  }
  /* le o projeto so' com pasta LOCAL que existe. Painel de servidor: o debate
     roda neste PC e nao alcanca os arquivos de la' -- vira so' texto. */
  leituraDe(input) {
    if (input.remoto) return { leitura: false, semLeitura: 'remoto' };
    const cwd = String(input.cwd || '');
    if (!cwd) return { leitura: false, semLeitura: 'pasta' };
    if (path.isAbsolute(cwd) && this.pastaAmpla(cwd)) return { leitura: false, semLeitura: 'ampla' };
    try { if (path.isAbsolute(cwd) && this.fs.statSync(cwd).isDirectory()) return { leitura: true, semLeitura: '' }; } catch {}
    return { leitura: false, semLeitura: 'pasta' };
  }
  /* auditoria 1: aba "PC inteiro" (pasta = pasta pessoal), uma pasta que CONTEM
     a pessoal, ou a raiz de um disco. Ali moram ~/.ssh, ~/.claude/.credentials.json,
     ~/.codex... e o que os dois leem vai pra OpenAI e pra Anthropic. Nesses
     lugares o debate roda SEM leitura. Atalho (junction) pra la' conta igual. */
  pastaAmpla(cwd) {
    const real = (p) => { try { return this.fs.realpathSync.native ? this.fs.realpathSync.native(p) : this.fs.realpathSync(p); } catch { return path.resolve(p); } };
    const alvo = real(cwd);
    if (path.parse(alvo).root === alvo || path.parse(path.resolve(cwd)).root === path.resolve(cwd)) return true;
    /* auditoria 2: agora o leitor olha o caminho RELATIVO a' pasta. Entao a
       RAIZ das contas dos motores (~/.claude, ~/.codex, ~/.gemini: credenciais,
       historico de conversa) nao pode ser "a pasta do projeto" -- e nenhuma
       pasta dentro de .ssh/.gnupg/.aws/.azure/.config/gcloud. Subpasta de
       .claude (skills, worktree) le normal. Mesma lista do leitor. */
    for (const p of [alvo, path.resolve(cwd)]) {
      const partes = p.split(/[\\/]+/).filter(Boolean).map((x) => x.toLowerCase());
      // raiz da conta do motor, ou subpasta dela que nao e' projeto (projects/ = todas as conversas)
      if (partes.some((x, i) => PASTAS_DE_MOTOR.includes(x) && !SUBPASTAS_DE_MOTOR_LIVRES.includes(partes[i + 1]))) return true;
      if (partes.some((x) => PASTAS_SECRETAS_LISTA.includes(x) && !PASTAS_DE_MOTOR.includes(x))) return true;
      if (PARES_SECRETOS.some(([a, b]) => partes.some((x, i) => x === a && partes[i + 1] === b))) return true;
    }
    if (!this.home) return false;
    const igual = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
    for (const casa of new Set([path.resolve(this.home), real(this.home)])) {
      const rel = path.relative(alvo, casa);
      if (rel === '' || igual(alvo, casa) || (!rel.startsWith('..') && !path.isAbsolute(rel))) return true;
    }
    return false;
  }
  start(input = {}) {
    const topic = String(input.topic || '').trim();
    if (!topic || topic.length > LIMITS.topic) throw new Error('Descreva o problema em até 8.000 caracteres.');
    if (this.active.size >= 3) throw new Error('Já há três debates em andamento. Encerre um antes de começar outro.');
    for (const state of this.states.values()) if (state.paneId === input.paneId && this.active.has(state.id)) throw new Error('Este painel já tem um debate em andamento.');
    const models = {};
    for (const engine of MOTORES_DEBATE) {
      const config = input.models?.[engine];
      if (!config || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,100}(?:\[1m\])?$/.test(config.model || '')) throw new Error('Escolha o modelo do ' + NOME[engine] + '.');
      if (/fable/i.test(config.model) && input.paidApproved !== true) throw new Error('Confirme na interface o uso de créditos do Fable antes de iniciar.');
      if (config.effort && !ESFORCOS.includes(config.effort)) throw new Error('Esforço inválido.');
      models[engine] = { model: config.model, effort: config.effort || '' };
    }
    const review = input.review || null;
    if (review && (!/^[a-f0-9]{64}$/.test(review.hash || '') || typeof review.diff !== 'string' || review.diff.length > 120000)) throw new Error('O conjunto de alterações para revisão é inválido ou grande demais.');
    const leitura = this.leituraDe(input);
    const state = { id: crypto.randomUUID(), paneId: clean(input.paneId, 120), topic, context: clean(input.context, LIMITS.context),
      contextTruncated: String(input.context || '').length > LIMITS.context, cwd: clean(input.cwd, 4000), ...leitura, models, rounds: roundsOf(input.rounds),
      first: MOTORES_DEBATE.includes(input.first) ? input.first : 'codex', status: 'ready', messages: [], review,
      limites: { falaMs: leitura.leitura ? this.timeoutLeituraMs : this.timeoutMs, resposta: LIMITS.answer }, createdAt: new Date().toISOString() };
    this.states.set(state.id, state); this.persist(state); this.launch(state); return paraTela(state);
  }
  continue(input = {}) {
    this.get(input.id); const state = this.states.get(input.id);
    if (this.active.has(state.id)) throw new Error('Pare ou aguarde a discussão antes de continuar.');
    for (const other of this.states.values()) if (other.id !== state.id && other.paneId === state.paneId && this.active.has(other.id)) throw new Error('Este painel já tem outro debate em andamento.');
    if (this.active.size >= 3) throw new Error('Já há três debates em andamento.');
    if (state.messages.length >= LIMITS.messages - 7) throw new Error('Este debate chegou ao limite. Comece outro usando a conclusão como contexto.');
    const message = String(input.message || '').trim();
    if (message.length > LIMITS.topic) throw new Error('Sua intervenção deve ter até 8.000 caracteres.');
    if (message) state.messages.push({ id: crypto.randomUUID(), speaker: 'user', text: message, status: 'completed', at: new Date().toISOString() });
    state.rounds = roundsOf(input.rounds ?? state.rounds); state.error = ''; this.launch(state); return paraTela(state);
  }
  stop(id) {
    this.get(id); const state = this.states.get(id), active = this.active.get(id);
    if (active) { active.controller.abort(); state.status = 'interrupted'; this.publish(state); }
    return paraTela(state);
  }
  stopAll() { for (const id of this.active.keys()) this.stop(id); }
  launch(state) {
    const controller = new AbortController(); const record = { controller };
    this.active.set(state.id, record); state.status = 'running'; this.publish(state);
    record.done = this.execute(state, controller.signal).finally(() => { if (this.active.get(state.id) === record) this.active.delete(state.id); });
  }
  async execute(state, signal) {
    const comeca = proximoAFalar(state);
    const order = [comeca, outro(comeca)];
    const prazo = state.limites.falaMs;
    let current;
    try {
      for (let i = 0; i < state.rounds * 2; i++) {
        if (signal.aborted) throw new Error('Discussão interrompida por você.');
        const engine = order[i % 2]; const config = state.models[engine];
        state.progress = { fala: i + 1, total: state.rounds * 2 };
        const prompt = buildPrompt(state, engine, i === state.rounds * 2 - 1);
        const inicio = Date.now();
        current = { id: crypto.randomUUID(), speaker: engine, model: config.model, effort: config.effort || '', text: '', status: 'running', at: new Date(inicio).toISOString() };
        state.messages.push(current); this.publish(state);
        const message = current;
        let timer; let cancel; let lastSave = 0;
        const salvarAgora = () => { const now = Date.now(); if (now - lastSave > 1000) { lastSave = now; return true; } return false; };
        try {
          const result = await Promise.race([
            this.runTurn({ engine, ...config, prompt, signal, cwd: state.cwd, leitura: state.leitura,
              onText: text => {
                if (signal.aborted || message.status !== 'running') return;
                message.text = clean(text, LIMITS.answer); this.publishSoon(state, salvarAgora());
              },
              onActivity: a => {
                if (signal.aborted || message.status !== 'running' || !a || typeof a !== 'object') return;
                if (a.aviso) message.aviso = clean(a.aviso, 300);
                if (a.kind) message.activity = { kind: clean(a.kind, 20), ferramenta: clean(a.ferramenta, 40), alvo: clean(a.alvo, 160) };
                if (a.leu) { message.reads = message.reads || []; const f = clean(a.leu, 300); if (!message.reads.includes(f) && message.reads.length < 40) message.reads.push(f); }
                this.publishSoon(state, false);
              } }),
            new Promise((_, reject) => { cancel = () => reject(new Error('Discussão interrompida por você.')); signal.addEventListener('abort', cancel, { once: true });
              timer = setTimeout(() => reject(new Error('O ' + NOME[engine] + ' passou do prazo de ' + Math.round(prazo / 60000) + ' min desta fala. O debate parou.')), prazo); }),
          ]);
          if (signal.aborted) throw new Error('Discussão interrompida por você.');
          if (!result || !String(result.text || '').trim()) throw new Error('O ' + NOME[engine] + ' terminou sem resposta. O debate parou.');
          const texto = semRodape(result.text);
          current.text = clean(texto, LIMITS.answer); current.truncated = texto.length > LIMITS.answer;
          current.sessionId = result.sessionId || ''; current.status = 'completed';
          if (result.usage && typeof result.usage === 'object') current.usage = result.usage;
          current.endedAt = new Date().toISOString(); current.durationMs = Date.now() - inicio; delete current.activity;
          this.publish(state);
        } finally { clearTimeout(timer); if (cancel) signal.removeEventListener('abort', cancel); }
      }
      state.status = 'completed';
    } catch (error) {
      state.status = signal.aborted ? 'interrupted' : 'failed'; state.error = clean(error.message, 1200);
      if (current?.status === 'running') {
        current.status = state.status; current.endedAt = new Date().toISOString();
        current.durationMs = Date.now() - Date.parse(current.at); delete current.activity;
      }
      // Inclui timeout: encerrar o participante ainda vivo antes de liberar outra rodada.
      this.active.get(state.id)?.controller.abort();
    }
    delete state.progress;
    this.publish(state);
  }
}
module.exports = { DebateManager, buildPrompt, LIMITS, semRodape, proximoAFalar };
