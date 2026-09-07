/* A ponte ACP inteira (criarAcp) contra um AGENTE FALSO, sem processo de
   verdade: o "processo" e' um par de streams em memoria que responde como um
   agente ACP responderia. Cobre o que a auditoria 1A apontou:
     A1  dois starts no mesmo painel durante o handshake viram UM
     M2  cancelar responde 'cancelled' a permissao pendente NA HORA
     M3  agente que morre no handshake: o start lanca, sem 'engine-down'
     M4  request_permission so' com toolCallId herda titulo/diff do tool_call
     M5  chave do "sempre permitir": kind, ou other:<titulo>
     M6  fs/read_text_file: caminho relativo na pasta do painel, ENOENT = vazio
     M8  tool_call_update depois do fim nao renasce como passo
     B5  pedido de outra sessao e' recusado (-32602) */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough, Writable } = require('stream');
const { EventEmitter } = require('events');
const { RAIZ } = require('./raiz');
const acpMod = require(path.join(RAIZ, 'src', 'acp.js'));

let falhas = 0;
const checa = (nome, ok, det) => { console.log((ok ? '  ok   ' : '  FALHA') + ' ' + nome + (ok || !det ? '' : '  -> ' + det)); if (!ok) falhas++; };
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const ate = async (cond, ms) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > (ms || 3000)) return false; await dorme(10); } return true; };

/* ---- o agente falso ---- */
function agenteFalso(roteiro) {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.pid = 4242; proc.exitCode = null; proc.signalCode = null;
  proc.recebidas = [];
  proc.manda = (obj) => proc.stdout.write(JSON.stringify(obj) + '\n');
  proc.responde = (id, result) => proc.manda({ jsonrpc: '2.0', id, result });
  let resto = '';
  proc.stdin = new Writable({
    write(chunk, _enc, cb) {
      resto += chunk.toString('utf8');
      let i;
      while ((i = resto.indexOf('\n')) >= 0) {
        const l = resto.slice(0, i).trim(); resto = resto.slice(i + 1);
        if (!l) continue;
        let m; try { m = JSON.parse(l); } catch { continue; }
        proc.recebidas.push(m);
        try { roteiro(m, proc); } catch (e) { console.log('   (roteiro quebrou: ' + e.message + ')'); }
      }
      cb();
    },
  });
  proc.kill = () => { if (proc.exitCode !== null) return; proc.exitCode = 0; setImmediate(() => proc.emit('close', 0)); };
  return proc;
}
const roteiroPadrao = (m, proc) => {
  if (m.method === 'initialize') return proc.responde(m.id, { protocolVersion: 1, agentInfo: { name: 'falso', title: 'Agente Falso', version: '9' },
    agentCapabilities: { loadSession: true, promptCapabilities: { image: true } } });
  if (m.method === 'session/new') return proc.responde(m.id, { sessionId: 's1', modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }, { id: 'yolo', name: 'YOLO' }] } });
  if (m.method === 'session/set_mode') return proc.responde(m.id, {});
  if (m.method === 'session/prompt') { proc.promptId = m.id; proc.emit('prompt', m); return; }
  if (m.method === 'session/cancel') { proc.emit('cancel'); return; }
  if (m.id !== undefined && m.method === undefined) proc.emit('resposta', m);   // resposta a um pedido nosso
};

function montar(roteiro, opts) {
  const eventos = [];
  const pedidos = [];
  let procAtual = null;
  const feitos = [];
  const acp = acpMod.criarAcp({
    emit: (paneId, kind, data) => eventos.push({ paneId, kind, ...data }),
    spawnBin: (bin, args, o) => { procAtual = agenteFalso(roteiro || roteiroPadrao); procAtual.bin = bin; procAtual.args = args; procAtual.cwd = o.cwd; feitos.push(procAtual); return procAtual; },
    buildEnv: () => ({ PATH: '' }),
    matarProcesso: (p) => p.kill(),
    HOME: os.tmpdir(),
    pastaDados: () => (opts && opts.pastaDados) || path.join(os.tmpdir(), 'acp-ponte-' + process.pid),
    aoPedirPermissao: (paneId, rpcId, info) => pedidos.push({ paneId, rpcId, info }),
    aoCair: () => eventos.push({ kind: '__aoCair' }),
    aoFimDoTurno: () => eventos.push({ kind: '__aoFimDoTurno' }),
    autoLiberada: (opts && opts.autoLiberada) || (() => false),
  });
  return { acp, eventos, pedidos, proc: () => procAtual, feitos };
}

(async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-cwd-'));
  fs.writeFileSync(path.join(cwd, 'x.txt'), 'linha1\nlinha2\nlinha3', 'utf8');

  /* ---- A1: dois starts viram um ---- */
  {
    const t = montar();
    const p1 = t.acp.start('p1', { comando: 'falso --acp', cwd, approval: 'manual' });
    const p2 = t.acp.start('p1', { comando: 'falso --acp', cwd, approval: 'manual' });
    checa('A1 dois starts iguais em curso devolvem a MESMA promessa', p1 === p2);
    checa('A1 o start devolve true', (await p1) === true && (await p2) === true);
    checa('A1 subiu UM processo so', t.feitos.length === 1, String(t.feitos.length));
    checa('sessao e acp-info emitidos', t.eventos.some((e) => e.kind === 'sessao' && e.id === 's1') && t.eventos.some((e) => e.kind === 'acp-info' && e.agente === 'Agente Falso'));
    // depois de pronto, um novo start (ex: troca de agente) e' outro processo
    await t.acp.start('p1', { comando: 'falso --acp', cwd, approval: 'bypass' });
    checa('start depois de pronto sobe processo novo e mata o velho', t.feitos.length === 2 && t.feitos[0].exitCode !== null);
    const setMode = t.feitos[1].recebidas.find((m) => m.method === 'session/set_mode');
    checa('bypass pediu o modo yolo ao agente', !!setMode && setMode.params.modeId === 'yolo', JSON.stringify(setMode && setMode.params));
    t.acp.parar('p1');
  }

  /* ---- M3: morre no handshake ---- */
  {
    const t = montar((m, proc) => {
      if (m.method === 'initialize') { proc.stderr.write('Error: comando invalido --acp\n'); proc.exitCode = 1; setImmediate(() => proc.emit('close', 1)); }
    });
    let erro = null;
    try { await t.acp.start('p2', { comando: 'quebrado --acp', cwd }); } catch (e) { erro = e; }
    checa('M3 start lanca com o motivo do stderr', !!erro && /comando invalido/.test(erro.message), erro && erro.message);
    checa('M3 sem engine-down nem note (quem avisa e o start)', !t.eventos.some((e) => e.kind === 'engine-down' || e.kind === 'note' || e.kind === '__aoCair'), JSON.stringify(t.eventos));
  }

  /* ---- M4 + M5 + M8 + permissao respondida ---- */
  {
    const t = montar();
    await t.acp.start('p3', { comando: 'falso --acp', cwd, approval: 'manual' });
    const proc = t.proc();
    proc.on('prompt', () => {
      proc.manda({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's1', update: { sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Editar app.js', kind: 'edit', status: 'pending',
        locations: [{ path: path.join(cwd, 'app.js') }], content: [{ type: 'diff', path: path.join(cwd, 'app.js'), oldText: 'a', newText: 'b' }] } } });
      // pedido MINIMO, so' com o id (a spec permite)
      proc.manda({ jsonrpc: '2.0', id: 100, method: 'session/request_permission', params: { sessionId: 's1', toolCall: { toolCallId: 'c1' },
        options: [{ optionId: 'a1', name: 'Allow once', kind: 'allow_once' }, { optionId: 'a2', name: 'Always', kind: 'allow_always' }, { optionId: 'r1', name: 'Reject', kind: 'reject_once' }] } });
    });
    proc.on('resposta', (m) => {
      if (m.id !== 100) return;
      proc.permissao = m;
      // depois da permissao: fim do passo, update tardio duplicado, fala, fim do turno
      proc.manda({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's1', update: { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'gravado' } }] } } });
      proc.manda({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's1', update: { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed' } } });
      proc.manda({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Feito.' } } } });
      proc.responde(proc.promptId, { stopReason: 'end_turn' });
    });
    checa('enviar devolve true', t.acp.enviar('p3', 'mexe no app.js', []) === true);
    checa('o pedido de permissao chegou a tela', await ate(() => t.pedidos.length === 1));
    const ped = t.pedidos[0];
    checa('M4 cartao herda o titulo do tool_call', /Editar app\.js/.test(ped.info.title), ped.info.title);
    checa('M4 cartao herda o diff do tool_call', !!(ped.info.mudanca && ped.info.mudanca.antes === 'a' && ped.info.mudanca.depois === 'b'));
    checa('M5 chave do "sempre" e o kind; rotulo legivel em pt', ped.info.tool === 'edit' && ped.info.rotulo === 'Edit', JSON.stringify([ped.info.tool, ped.info.rotulo]));
    checa('responderPermissao(true) escolhe allow_once', t.acp.responderPermissao('p3', ped.rpcId, true) !== false && (await ate(() => !!proc.permissao)) && proc.permissao.result.outcome.optionId === 'a1', JSON.stringify(proc.permissao && proc.permissao.result));
    checa('turno terminou', await ate(() => t.eventos.some((e) => e.kind === 'turn-end')));
    const starts = t.eventos.filter((e) => e.kind === 'tool-start');
    const ends = t.eventos.filter((e) => e.kind === 'tool-end');
    checa('M8 update duplicado depois do fim NAO renasce o passo', starts.length === 1 && ends.length === 1, starts.length + '/' + ends.length);
    checa('a fala final chegou', t.eventos.some((e) => e.kind === 'text-final' && e.text === 'Feito.'));
    checa('aoFimDoTurno chamado no fim', t.eventos.some((e) => e.kind === '__aoFimDoTurno'));
    // transcricao propria
    const sess = t.acp.sessoes();
    checa('conversa listada com a pasta do painel', sess.length >= 1 && sess[0].cwd === cwd, JSON.stringify(sess[0]));
    t.acp.parar('p3');
  }

  /* ---- M5: other e' por titulo; "sempre permitir" responde allow_once e deixa rastro ---- */
  {
    const p = acpMod.passoDaFerramenta({ title: 'Buscar na web', kind: 'other' });
    checa('M5 chaveDePermissao de other leva o titulo', acpMod.chaveDePermissao(p) === 'other:Buscar na web');
    checa('M5 chaveDePermissao de execute e o kind', acpMod.chaveDePermissao(acpMod.passoDaFerramenta({ kind: 'execute', title: 'ls' })) === 'execute');
    const t = montar(undefined, { autoLiberada: (_p, chave) => chave === 'execute' });
    await t.acp.start('p4', { comando: 'falso --acp', cwd, approval: 'manual' });
    const proc = t.proc();
    proc.on('prompt', () => {
      proc.manda({ jsonrpc: '2.0', id: 200, method: 'session/request_permission', params: { sessionId: 's1', toolCall: { toolCallId: 'x1', title: 'Run: npm test', kind: 'execute', rawInput: { command: 'npm test' } },
        options: [{ optionId: 'a1', kind: 'allow_once' }, { optionId: 'a2', kind: 'allow_always' }] } });
    });
    proc.on('resposta', (m) => { if (m.id === 200) { proc.permissao = m; proc.responde(proc.promptId, { stopReason: 'end_turn' }); } });
    t.acp.enviar('p4', 'roda os testes', []);
    checa('liberado por "sempre": respondido sozinho', await ate(() => !!proc.permissao));
    checa('M5 com allow_once (cada chamada deixa rastro)', proc.permissao.result.outcome.optionId === 'a1', JSON.stringify(proc.permissao.result));
    checa('M5 rastro na auditoria com rotulo legivel', t.eventos.some((e) => e.kind === 'auto-liberado' && e.tool === 'Bash' && e.arg === 'npm test'), JSON.stringify(t.eventos.filter((e) => e.kind === 'auto-liberado')));
    checa('nada foi pra tela decidir', t.pedidos.length === 0);
    t.acp.parar('p4');
  }

  /* ---- M2: cancelar responde cancelled na hora ---- */
  {
    const t = montar();
    await t.acp.start('p5', { comando: 'falso --acp', cwd, approval: 'manual' });
    const proc = t.proc();
    const ordem = [];
    proc.on('prompt', () => {
      proc.manda({ jsonrpc: '2.0', id: 300, method: 'session/request_permission', params: { sessionId: 's1', toolCall: { toolCallId: 'd1', title: 'Apagar tudo', kind: 'delete' }, options: [{ optionId: 'a1', kind: 'allow_once' }, { optionId: 'r1', kind: 'reject_once' }] } });
    });
    proc.on('resposta', (m) => { if (m.id === 300) { ordem.push('permissao:' + m.result.outcome.outcome); } });
    // agente que so' devolve o prompt DEPOIS do cancel (como a spec descreve)
    proc.on('cancel', () => { ordem.push('cancel-recebido'); setTimeout(() => proc.responde(proc.promptId, { stopReason: 'cancelled' }), 30); });
    t.acp.enviar('p5', 'apaga', []);
    checa('pedido chegou a tela', await ate(() => t.pedidos.length === 1));
    t.acp.interromper('p5');
    checa('M2 cancelled respondido ANTES do prompt voltar', await ate(() => ordem.length >= 2) && ordem[0] === 'permissao:cancelled' && ordem[1] === 'cancel-recebido', ordem.join(' > '));
    checa('M2 aoFimDoTurno chamado no cancelamento (tira o cartao)', t.eventos.some((e) => e.kind === '__aoFimDoTurno'));
    checa('turno fechou com turn-end', await ate(() => t.eventos.some((e) => e.kind === 'turn-end')));
    t.acp.parar('p5');
  }

  /* ---- M6 + B5: fs pelo agente ---- */
  {
    const t = montar();
    await t.acp.start('p6', { comando: 'falso --acp', cwd, approval: 'manual' });
    const proc = t.proc();
    const respostas = new Map();
    proc.on('resposta', (m) => respostas.set(m.id, m));
    proc.manda({ jsonrpc: '2.0', id: 400, method: 'fs/read_text_file', params: { sessionId: 's1', path: 'x.txt', line: 2, limit: 1 } });
    proc.manda({ jsonrpc: '2.0', id: 401, method: 'fs/read_text_file', params: { sessionId: 's1', path: 'nao-existe.txt' } });
    proc.manda({ jsonrpc: '2.0', id: 402, method: 'fs/read_text_file', params: { sessionId: 'outra', path: 'x.txt' } });
    proc.manda({ jsonrpc: '2.0', id: 403, method: 'fs/write_text_file', params: { sessionId: 's1', path: 'novo/y.txt', content: 'oi' } });
    proc.manda({ jsonrpc: '2.0', id: 404, method: 'terminal/create', params: { sessionId: 's1', command: 'ls' } });
    checa('as 5 respostas chegaram', await ate(() => respostas.size === 5));
    checa('M6 caminho relativo resolve na pasta do painel (linha 2)', respostas.get(400).result && respostas.get(400).result.content === 'linha2', JSON.stringify(respostas.get(400)));
    checa('M6 arquivo inexistente devolve conteudo vazio', respostas.get(401).result && respostas.get(401).result.content === '');
    checa('B5 pedido de outra sessao e recusado', respostas.get(402).error && respostas.get(402).error.code === -32602);
    checa('M6 write cria a pasta e o arquivo na pasta do painel', respostas.get(403).result && fs.existsSync(path.join(cwd, 'novo', 'y.txt')) && fs.readFileSync(path.join(cwd, 'novo', 'y.txt'), 'utf8') === 'oi');
    checa('metodo nao anunciado volta -32601', respostas.get(404).error && respostas.get(404).error.code === -32601);
    t.acp.parar('p6');
  }

  /* ---- R1: enviar com o turno rodando NAO e' "morto": enfileira e sai depois ---- */
  {
    const t = montar();
    await t.acp.start('p7', { comando: 'falso --acp', cwd, approval: 'manual' });
    const proc = t.proc();
    let prompts = 0;
    proc.on('prompt', (m) => { prompts++; setTimeout(() => proc.responde(m.id, { stopReason: 'end_turn' }), 60); });
    const a = t.acp.enviar('p7', 'primeira', []);
    const b = t.acp.enviar('p7', 'segunda', []);
    checa('R1 segundo enviar com o turno rodando devolve true (fila), nao false', a === true && b === true);
    checa('R1 os dois turnos rodam, em ordem', await ate(() => prompts === 2, 3000) && proc.recebidas.filter((m) => m.method === 'session/prompt').map((m) => m.params.prompt[0].text).join('>') === 'primeira>segunda');
    checa('R1 dois turn-end', await ate(() => t.eventos.filter((e) => e.kind === 'turn-end').length === 2, 3000));
    t.acp.parar('p7');
  }

  /* ---- R2: agente que morre no session/load: o start falha NA HORA, com o motivo ---- */
  {
    const t = montar((m, proc) => {
      if (m.method === 'initialize') return proc.responde(m.id, { protocolVersion: 1, agentInfo: { name: 'falso' }, agentCapabilities: { loadSession: true } });
      if (m.method === 'session/load') { proc.stderr.write('panic: sessao corrompida\n'); proc.exitCode = 2; setImmediate(() => proc.emit('close', 2)); }
    });
    const t0 = Date.now();
    let erro = null;
    try { await t.acp.start('p8', { comando: 'falso --acp', cwd, approval: 'manual', resumeId: 'velha' }); } catch (e) { erro = e; }
    checa('R2 start falha rapido (sem esperar prazo) e com o stderr', !!erro && /corrompida/.test(erro.message) && (Date.now() - t0) < 2000, (erro && erro.message) + ' em ' + (Date.now() - t0) + 'ms');
  }

  /* ---- R3/R9: retomada que vira sessao nova: o contexto vai pro agente, nao pra transcricao ---- */
  {
    const pastaDados = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-dados-'));
    const velha = acpMod.arquivoDaSessao(() => pastaDados, 'velha');
    acpMod.anotar(velha, { cabecalho: 1, id: 'velha', comando: 'falso --acp', cwd, criado: 1 });
    acpMod.anotar(velha, { role: 'user', text: 'pergunta antiga' });
    acpMod.anotar(velha, { role: 'bot', text: 'resposta antiga' });
    const t = montar((m, proc) => {
      if (m.method === 'session/load') return proc.manda({ jsonrpc: '2.0', id: m.id, error: { code: -32602, message: 'sessao desconhecida' } });
      roteiroPadrao(m, proc);
    }, { pastaDados });
    await t.acp.start('p9', { comando: 'falso --acp', cwd, approval: 'manual', resumeId: 'velha' });
    checa('R9 avisou que comecou nova E que leva o resumo', t.eventos.some((e) => e.kind === 'note' && /Comecei uma conversa nova/.test(e.text) && /resumo/.test(e.text)));
    const proc = t.proc();
    proc.on('prompt', (m) => { proc.ultimoPrompt = m; setTimeout(() => proc.responde(m.id, { stopReason: 'end_turn' }), 30); });
    t.acp.enviar('p9', 'pergunta nova', []);
    checa('o turno rodou', await ate(() => !!proc.ultimoPrompt, 3000));
    const mandado = proc.ultimoPrompt.params.prompt[0].text;
    checa('R3 o agente recebeu o contexto antigo + a pergunta', /pergunta antiga/.test(mandado) && /resposta antiga/.test(mandado) && /pergunta nova$/.test(mandado));
    await ate(() => t.eventos.some((e) => e.kind === 'turn-end'), 3000);
    const nova = t.acp.sessoes().find((s) => s.id === 's1');
    checa('R3 a transcricao guarda so o que voce escreveu (titulo da lista)', !!nova && nova.title === 'pergunta nova', JSON.stringify(nova));
    const hist = t.acp.historico('s1', nova && nova.file);
    checa('R3 o historico nao tem o prefixo', hist.some((m) => m.role === 'user' && m.text === 'pergunta nova') && !hist.some((m) => /Estou continuando/.test(m.text || '')));
    t.acp.parar('p9');
    try { fs.rmSync(pastaDados, { recursive: true, force: true }); } catch {}
  }

  /* ---- R5/R6: start com pasta diferente e' outro start; o 3o igual reaproveita o 2o ---- */
  {
    const t = montar();
    const cwd2 = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-cwd2-'));
    const p1 = t.acp.start('p10', { comando: 'falso --acp', cwd, approval: 'manual' });
    const p2 = t.acp.start('p10', { comando: 'falso --acp', cwd: cwd2, approval: 'manual' });
    const p3 = t.acp.start('p10', { comando: 'falso --acp', cwd: cwd2, approval: 'manual' });
    checa('R5 pasta diferente = start diferente', p1 !== p2);
    checa('R6 o terceiro (igual ao segundo) reaproveita o segundo', p2 === p3);
    let e1 = null; try { await p1; } catch (e) { e1 = e; }
    // o motivo depende de ONDE o 1o estava quando foi derrubado (antes ou depois do initialize)
    checa('o primeiro foi derrubado pelo segundo', !!e1 && /parado|não está de pé/.test(e1.message), e1 && e1.message);
    checa('o segundo subiu na pasta nova', (await p2) === true && t.feitos.length === 2 && t.feitos[1].cwd === cwd2);
    t.acp.parar('p10');
    try { fs.rmSync(cwd2, { recursive: true, force: true }); } catch {}
  }

  try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(path.join(os.tmpdir(), 'acp-ponte-' + process.pid), { recursive: true, force: true }); } catch {}
  console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nteste-acp-ponte: tudo ok');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('ESTOUROU:', e && e.stack || e); process.exit(1); });
