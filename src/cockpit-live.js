'use strict';

// A chave é usada apenas pela função request do processo principal. O renderer
// recebe SDP e o ID opaco da sessão; nunca headers, chave ou token da conta.
const INSTRUCTIONS = 'Responda sempre em português do Brasil, em frases curtas. Você é a voz do Cockpit. '
  + 'Para consultar ou orientar o trabalho, delegue ao cliente. Os pedidos podem aguardar revisão do usuário. '
  + 'Não diga que enviou, executou, alterou ou concluiu algo sem o cliente confirmar. '
  + 'Transcrições podem conter erros: confirme detalhes ambíguos. Parar de falar não cancela o trabalho da sessão.';
function selectedSession(value) {
  if (!value || value.paneId == null || typeof value.threadId !== 'string' || !value.threadId || !['claude', 'codex', 'gemini', 'grok', 'acp'].includes(value.engine)) throw Error('Escolha uma sessão ativa para conversar por voz.');
  return { paneId: String(value.paneId), threadId: value.threadId.slice(0, 256), engine: value.engine };
}
function createLive({ request, authorize, resolveSession = value => value } = {}) {
  const pending = new Set();
  async function offer({ sdp, grant, session } = {}) {
    if (typeof request !== 'function' || typeof authorize !== 'function') throw Error('A voz da API não está configurada.');
    if (typeof sdp !== 'string' || sdp.length > 65536 || !/^v=0\r?\n/.test(sdp) || !/^m=audio /m.test(sdp) || /^m=video /m.test(sdp)) throw Error('Oferta de áudio inválida.');
    const target = selectedSession(await resolveSession(selectedSession(session)));
    if (target.paneId !== String(session.paneId) || target.threadId !== session.threadId || target.engine !== session.engine) throw Error('A sessão selecionada mudou. Selecione-a novamente.');
    if (pending.has(target.paneId)) throw Error('Uma conexão de voz já está sendo preparada para esta sessão.');
    pending.add(target.paneId);
    try {
      if (await authorize(grant, 'voice') === false) throw Error('Autorize a cobrança da voz antes de conectar.');
      const result = await request('/live/sessions', { method: 'POST', timeout: 30000, body: {
        session: { model: 'gpt-live-1', instructions: INSTRUCTIONS, delegation: { type: 'client' } },
        transport: { type: 'webrtc', sdp },
      } });
      if (typeof result?.session?.id !== 'string' || !result.session.id || result.session.id.length > 512
        || result.transport?.type !== 'webrtc' || typeof result.transport.sdp !== 'string'
        || result.transport.sdp.length > 65536 || !/^v=0\r?\n/.test(result.transport.sdp)) throw Error('A API não confirmou a conexão de voz. Confira o uso antes de tentar novamente.');
      return { session: { id: result.session.id, ...target }, transport: { type: 'webrtc', sdp: result.transport.sdp } };
    } finally { pending.delete(target.paneId); }
  }
  return { offer };
}
module.exports = { createLive, selectedSession, INSTRUCTIONS };
