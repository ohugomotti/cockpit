'use strict';

const CODEX_MODE = Object.freeze({
  manual: { policy: 'untrusted', sandbox: 'workspace-write' },
  'auto-edit': { policy: 'on-request', sandbox: 'workspace-write' },
  auto: { policy: 'on-request', sandbox: 'workspace-write' },
  revisado: { policy: 'on-request', sandbox: 'workspace-write', reviewer: 'auto_review' },
  bypass: { policy: 'never', sandbox: 'danger-full-access' },
});

function buildThreadOpenRequest({
  resumeId,
  cwd,
  model,
  approval,
  developerInstructions,
} = {}) {
  const mode = CODEX_MODE[approval] || CODEX_MODE.bypass;
  const params = {
    ...(resumeId ? { threadId: resumeId } : {}),
    ...(cwd ? { cwd } : {}),
    sandbox: mode.sandbox,
    approvalPolicy: mode.policy,
    ...(mode.reviewer ? { approvalsReviewer: mode.reviewer } : {}),
    ...(developerInstructions ? { developerInstructions } : {}),
    ...(model ? { model } : {}),
  };
  return { method: resumeId ? 'thread/resume' : 'thread/start', params };
}

function buildApprovalResponse(kind, allow, params = {}) {
  if (kind === 'perm') {
    return allow
      ? { permissions: params.permissions || {}, scope: 'session' }
      : { permissions: {}, scope: 'turn' };
  }
  /* Os metodos antigos (execCommandApproval, applyPatchApproval) continuam
     vivos no 0.147.0, mas falam OUTRO vocabulario: ReviewDecision, com
     approved/denied. Mandar "decline" pra eles e' uma resposta que o servidor
     nao consegue ler - e o turno fica pendurado esperando pra sempre. */
  if (kind === 'cmdLegado' || kind === 'fileLegado') {
    /* o "nao" do ReviewDecision NAO e' a palavra "denied": e' um objeto com o
       motivo dentro. Mandar a string trava o turno do mesmo jeito que o
       "reject" antigo travava. Conferido no ExecCommandApprovalResponse. */
    return allow
      ? { decision: 'approved_for_session' }
      : { decision: { denied: { rejection: 'Negado por você' } } };
  }
  return { decision: allow ? 'acceptForSession' : 'decline' };
}

function normalizeUserInputRequest(rpcId, params = {}) {
  const questions = Array.isArray(params.questions) ? params.questions : [];
  /* o id volta pela tela e passa por uma limpeza de caracteres antes de achar
     a pendencia: ja' sai limpo daqui, senao um rpcId em texto com ponto ou
     dois-pontos gera uma chave que ninguem mais encontra */
  const todas = questions.map((question) => ({
    id: String(question.id || ''),
    titulo: String(question.header || ''),
    pergunta: String(question.question || ''),
    segredo: !!question.isSecret,
    varias: false,
    opcoes: (Array.isArray(question.options) ? question.options : []).slice(0, 5).map((option) => ({
      rotulo: String(option.label || ''),
      detalhe: String(option.description || ''),
    })).filter((option) => option.rotulo),
  })).filter((question) => question.id && question.pergunta);
  return {
    id: 'codex_q_' + String(rpcId).replace(/[^a-zA-Z0-9_-]/g, ''),
    bloqueante: params.isBlocking !== false,
    // a tela desenha no maximo 4; 'todas' e' quem garante resposta pra TODAS
    perguntas: todas.slice(0, 4),
    todas,
  };
}

function normalizeAgentMessage(item = {}) {
  let text = typeof item.text === 'string' ? item.text : '';
  const questions = Array.isArray(item.questions) ? item.questions : [];
  // Texto remoto vai ao Markdown: neutraliza HTML e sintaxe nas perguntas.
  const escape = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_{}\[\]()#+.!|~-])/g, '\\$1');
  for (const question of questions) {
    if (!question || typeof question.title !== 'string') continue;
    const parts = [question.title, ...(Array.isArray(question.options) ? question.options.filter(o => typeof o === 'string') : [])];
    const missing = parts.filter(part => part && !text.includes(part) && !text.includes(escape(part)));
    if (missing.length) text += (text ? '\n\n' : '') + missing.map(escape).join('\n\n');
  }
  return { text, phase: item.phase || '', delivery: item.delivery ?? null, questions: item.questions ?? null, memoryCitation: item.memoryCitation ?? null };
}

// O app-server envia TurnError como objeto; nunca o converta com String().
// Leia apenas campos públicos conhecidos, sem despejar payloads de ferramentas.
function normalizeError(value, fallback = 'O Codex não conseguiu concluir a resposta.') {
  const seen = new Set();
  function read(item, depth = 0) {
    if (typeof item === 'string') return item.trim() === '[object Object]' ? '' : item.trim();
    if (!item || typeof item !== 'object' || depth > 5 || seen.has(item)) return '';
    seen.add(item);
    for (const key of ['message', 'error', 'cause', 'detail']) {
      const text = read(item[key], depth + 1);
      if (text) {
        const detail = typeof item.additionalDetails === 'string' ? item.additionalDetails.trim() : '';
        return detail && !text.includes(detail) ? text + '\n' + detail : text;
      }
    }
    return '';
  }
  return read(value) || fallback;
}

function normalizeErrorNotification(params = {}, state = {}) {
  const retrying = params.willRetry === true;
  const message = normalizeError(params);
  const duplicate = retrying ? !!state.retryShown : state.finalText === message;
  if (retrying) state.retryShown = true;
  else state.finalText = message;
  return { text: (retrying ? 'O Codex está tentando novamente. ' : '') + message,
    error: !retrying, retrying, duplicate };
}

function normalizeCommandOutput(method, params = {}) {
  if (method === 'command/exec/outputDelta') {
    return { id: params.processId, text: typeof params.deltaBase64 === 'string' ? Buffer.from(params.deltaBase64, 'base64').toString('utf8') : '' };
  }
  return { id: params.itemId ?? params.callId, text: typeof params.delta === 'string' ? params.delta : '' };
}

function buildUserInputResponse(questions, responses, canceled) {
  const answers = {};
  const values = Array.isArray(responses) ? responses : [];
  for (let i = 0; i < (questions || []).length; i++) {
    const id = String(questions[i] && questions[i].id || '');
    if (!id) continue;
    const raw = canceled ? [] : values[i];
    const list = Array.isArray(raw) ? raw : (raw == null ? [] : [raw]);
    answers[id] = { answers: list.map((value) => String(value)).filter(Boolean) };
  }
  return { answers };
}

function normalizeSkillsResponse(response, cwd) {
  const entries = response && Array.isArray(response.data) ? response.data : [];
  const wanted = String(cwd || '').toLowerCase();
  const entry = entries.find((item) => String(item && item.cwd || '').toLowerCase() === wanted) || entries[0];
  if (!entry || !Array.isArray(entry.skills)) return [];
  return entry.skills.filter((skill) => skill && skill.enabled !== false).map((skill) => ({
    name: String(skill.name || ''),
    desc: String(
      (skill.interface && skill.interface.shortDescription)
      || skill.shortDescription
      || skill.description
      || ''
    ).slice(0, 240),
    displayName: String((skill.interface && skill.interface.displayName) || skill.name || ''),
    path: String(skill.path || ''),
    scope: String(skill.scope || ''),
    source: 'native',
  })).filter((skill) => skill.name);
}

function appStatus(app, runtime) {
  if (!app.isAccessible) return 'Indisponível nesta conta';
  if (runtime && runtime.callable) return 'Pronto para usar';
  if ((runtime && !runtime.enabled) || app.isEnabled === false) return 'Desligado';
  if (runtime) return 'Ligado, mas sem ferramenta disponível';
  return 'Disponível para instalar';
}

function mergeApps(listResponse, installedResponse) {
  const listed = listResponse && Array.isArray(listResponse.data) ? listResponse.data : [];
  const installed = installedResponse && Array.isArray(installedResponse.apps) ? installedResponse.apps : [];
  const runtimeById = new Map(installed.map((app) => [String(app.id), app]));
  const seen = new Set();
  const result = listed.map((app) => {
    const id = String(app.id || '');
    const runtime = runtimeById.get(id);
    seen.add(id);
    return {
      id,
      nome: String(app.name || (runtime && runtime.runtimeName) || id),
      desc: String(app.description || ''),
      acessivel: !!app.isAccessible,
      habilitado: runtime ? !!runtime.enabled : app.isEnabled !== false,
      instalado: !!runtime,
      chamavel: !!(runtime && runtime.callable),
      status: appStatus(app, runtime),
      installUrl: String(app.installUrl || ''),
      logo: String(app.logoUrl || ''),
    };
  });
  for (const runtime of installed) {
    const id = String(runtime.id || '');
    if (!id || seen.has(id)) continue;
    result.push({
      id,
      nome: String(runtime.runtimeName || id),
      desc: '',
      acessivel: true,
      habilitado: !!runtime.enabled,
      instalado: true,
      chamavel: !!runtime.callable,
      status: runtime.callable ? 'Pronto para usar' : (runtime.enabled ? 'Ligado, mas sem ferramenta disponível' : 'Desligado'),
      installUrl: '',
      logo: '',
    });
  }
  return result;
}

module.exports = {
  CODEX_MODE,
  buildThreadOpenRequest,
  buildApprovalResponse,
  normalizeUserInputRequest,
  normalizeAgentMessage,
  normalizeCommandOutput,
  normalizeError,
  normalizeErrorNotification,
  buildUserInputResponse,
  normalizeSkillsResponse,
  mergeApps,
};
