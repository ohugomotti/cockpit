'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { key } = require('./cockpit-remote-transport');
const hash = (x) => crypto.createHash('sha256').update(String(x)).digest('hex');
function createStore(folder) {
  const location = (remote, engine) => {
    if (!['claude', 'codex', 'gemini', 'grok', 'acp'].includes(engine)) throw new Error('Motor inválido.');
    return path.join(folder(), key(remote), engine);
  };
  function read(remote, engine, id) {
    try {
      return JSON.parse(fs.readFileSync(path.join(location(remote, engine), hash(id) + '.json'), 'utf8'));
    } catch {
      return null;
    }
  }
  function save(st) {
    if (!st.session) return;
    const dir = location(st.remoto, st.engine);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, hash(st.session) + '.json'),
      temp = file + '.' + crypto.randomUUID() + '.tmp';
    const previous = read(st.remoto, st.engine, st.session);
    /* Tarefa 6 (27/09): o nome tem dono. nomeCustomizado = o nome que VOCE deu
       (fica pra sempre); nomeAuto = o que o Cockpit deu (nome automatico, que
       acompanha o trabalho e nunca passa por cima do seu). O registro do fim
       de cada turno (save sem titulo) guarda os dois como estavam. */
    const nomeCustomizado = !!(st.nomeCustomizado || previous?.nomeCustomizado);
    const data = {
      nomeCustomizado,
      nomeAuto: !nomeCustomizado && !!(st.nomeAuto || previous?.nomeAuto),
      id: st.session,
      engine: st.engine,
      cwd: st.cwd,
      model: st.model,
      title:
        st.title ||
        (previous?.nomeCustomizado || previous?.nomeAuto ? previous.title : '') ||
        st.history?.find((m) => m.role === 'user')?.text?.slice(0, 120) ||
        'Conversa remota',
      when: Date.now(),
      remoto: true,
      origem: 'registro-cockpit-remoto',
      destino: key(st.remoto),
      msgs: (st.history || []).slice(-1000)
    };
    fs.writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(temp, file);
  }
  function list(engine, remote) {
    const dir = location(remote, engine);
    let files = [];
    try {
      files = fs.readdirSync(dir);
    } catch {}
    const rows = [];
    for (const file of files) {
      if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
      try {
        const { msgs, ...meta } = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        rows.push({ ...meta, file: '' });
      } catch {}
    }
    return rows.sort((a, b) => b.when - a.when);
  }
  /* opcoes.auto: o nome automatico do Cockpit. Grava a marca de automatico e
     NAO vira nome seu (antes todo rename virava nomeCustomizado: o automatico
     ficava parecendo nome dado a mao). Com nome seu ja' gravado, o automatico
     e' recusado (devolve false) e nada muda. */
  function rename(remote, engine, id, title, opcoes) {
    const auto = !!(opcoes && opcoes.auto);
    const row = read(remote, engine, id) || { engine, msgs: [] };
    if (auto && row.nomeCustomizado) return false;
    save({ ...row, remoto: remote, session: id, history: row.msgs, title, nomeCustomizado: !auto, nomeAuto: auto });
    return true;
  }
  function remove(remote, engine, id) {
    const file = path.join(location(remote, engine), hash(id) + '.json');
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  return { read, save, list, rename, remove };
}
module.exports = { createStore };
