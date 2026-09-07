/* Motor ACP (src/acp.js): as traducoes puras, com o trafego REAL gravado na
   prova de viabilidade (acp-log-prova-20260906.jsonl) e com pedacos sinteticos
   dos tipos que o log curto nao tinha (tool_call, plan, permissao). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RAIZ } = require('./raiz');
const acp = require(path.join(RAIZ, 'src', 'acp.js'));

let falhas = 0;
const checa = (nome, ok, det) => { console.log((ok ? '  ok   ' : '  FALHA') + ' ' + nome + (ok || !det ? '' : '  -> ' + det)); if (!ok) falhas++; };

// --- comando -> partes ---
checa('comando simples', JSON.stringify(acp.comandoEmPartes('gemini --acp')) === '{"bin":"gemini","args":["--acp"]}');
checa('comando com aspas', JSON.stringify(acp.comandoEmPartes('npx -y "@zed-industries/claude-code-acp" --x'))
  === '{"bin":"npx","args":["-y","@zed-industries/claude-code-acp","--x"]}');
checa('comando vazio', acp.comandoEmPartes('   ').bin === '');

// --- modo do Cockpit -> modo do agente ---
const modosGemini = [{ id: 'default' }, { id: 'autoEdit' }, { id: 'yolo' }, { id: 'plan' }];
const modosClaude = [{ id: 'default' }, { id: 'acceptEdits' }, { id: 'plan' }, { id: 'bypassPermissions' }];
checa('bypass no Gemini vira yolo', acp.modoDoAgente('bypass', modosGemini) === 'yolo');
checa('bypass no adaptador do Claude vira bypassPermissions', acp.modoDoAgente('bypass', modosClaude) === 'bypassPermissions');
checa('auto-edit vira autoEdit / acceptEdits', acp.modoDoAgente('auto-edit', modosGemini) === 'autoEdit' && acp.modoDoAgente('auto-edit', modosClaude) === 'acceptEdits');
checa('plan vira plan; manual vira default', acp.modoDoAgente('plan', modosGemini) === 'plan' && acp.modoDoAgente('manual', modosClaude) === 'default');
checa('sem correspondencia nao inventa', acp.modoDoAgente('plan', [{ id: 'x' }]) === '');

// --- o trafego real da prova ---
const log = fs.readFileSync(path.join(__dirname, 'acp-log-prova-20260906.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));
const st = {};
const eventos = [];
for (const it of log) {
  const m = it.obj;
  if (it.dir !== '<-' || !m || m.method !== 'session/update') continue;
  eventos.push(...acp.traduzirUpdate(st, m.params.update));
}
const tipos = eventos.map((e) => e.kind);
checa('o log real rende fala, pensamento e comandos', tipos.includes('text-final') && tipos.includes('think-delta') && tipos.includes('acp-comandos'), tipos.join(','));
checa('a fala acumulada tem a palavra pedida', eventos.some((e) => e.kind === 'text-final' && /PONTE/.test(e.text)));
checa('comandos do agente viraram lista com nome', eventos.some((e) => e.kind === 'acp-comandos' && e.itens.length && e.itens[0].name));

// --- pedacos sinteticos: passos ---
const s2 = {};
const evs = [];
evs.push(...acp.traduzirUpdate(s2, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Vou rodar os testes.' } }));
evs.push(...acp.traduzirUpdate(s2, { sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Run: npm test', kind: 'execute', status: 'in_progress', rawInput: { command: 'npm test' } }));
evs.push(...acp.traduzirUpdate(s2, { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: '12 passed' } }] }));
evs.push(...acp.traduzirUpdate(s2, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Tudo verde.' } }));
const k = evs.map((e) => e.kind);
checa('a fala fecha ANTES do passo (ordem falou-fez-falou)', k.join(',') === 'text-final,text-final,tool-start,tool-end,text-final', k.join(','));
checa('a fala fechada e a nova tem ids diferentes', evs[1].fecha === true && evs[1].id !== evs[4].id);
checa('passo de terminal vira Bash com o comando', evs[2].name === 'Bash' && evs[2].arg === 'npm test');
checa('fim do passo traz a saida', evs[3].output === '12 passed' && evs[3].error === false);

// diff que chega no update de um passo desconhecido -> nasce o passo com a mudanca
const s3 = { ferramentas: new Map() };
const e3 = acp.traduzirUpdate(s3, { sessionUpdate: 'tool_call_update', toolCallId: 'e1', title: 'Edit app.js', kind: 'edit', status: 'in_progress',
  locations: [{ path: 'C:/x/app.js' }], content: [{ type: 'diff', path: 'C:/x/app.js', oldText: 'a', newText: 'b' }] });
checa('update sem tool_call anterior cria o passo com o diff', e3.length === 1 && e3[0].kind === 'tool-start' && e3[0].mudanca && e3[0].mudanca.antes === 'a' && e3[0].mudanca.depois === 'b' && e3[0].mudanca.tipo === 'edit', JSON.stringify(e3));
const e3b = acp.traduzirUpdate(s3, { sessionUpdate: 'tool_call_update', toolCallId: 'e1', status: 'completed' });
checa('e o fim do passo sai sem duplicar o inicio', e3b.length === 1 && e3b[0].kind === 'tool-end');
// diff que chega DEPOIS num passo que ja existia -> tool-mudanca
const s4 = { ferramentas: new Map() };
acp.traduzirUpdate(s4, { sessionUpdate: 'tool_call', toolCallId: 'w1', title: 'Write novo.txt', kind: 'edit', status: 'pending' });
const e4 = acp.traduzirUpdate(s4, { sessionUpdate: 'tool_call_update', toolCallId: 'w1', status: 'in_progress', content: [{ type: 'diff', path: 'C:/x/novo.txt', oldText: null, newText: 'oi' }] });
checa('diff tardio vira tool-mudanca (arquivo novo)', e4.length === 1 && e4[0].kind === 'tool-mudanca' && e4[0].mudanca.tipo === 'write-novo', JSON.stringify(e4));
// falha
const e5 = acp.traduzirUpdate(s4, { sessionUpdate: 'tool_call_update', toolCallId: 'w1', status: 'failed', rawOutput: { erro: 'EACCES' } });
checa('status failed vira erro com a saida crua', e5[0].kind === 'tool-end' && e5[0].error === true && /EACCES/.test(e5[0].output));

// plano
const e6 = acp.traduzirUpdate({}, { sessionUpdate: 'plan', entries: [{ content: 'ler', status: 'completed' }, { content: 'mexer', status: 'in_progress' }, { content: 'testar', status: 'pending' }] });
checa('plan vira plano com os tres estados', e6[0].kind === 'plano' && e6[0].itens.map((i) => i.estado).join(',') === 'feito,fazendo,pendente');

// replay do session/load nao vai pra tela
const s7 = { carregando: true };
const e7 = acp.traduzirUpdate(s7, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'antigo' } });
checa('durante o load a fala antiga e ignorada', e7.length === 0);

// --- permissao: qual opcao responder ---
const ops = [{ optionId: 'a1', kind: 'allow_once' }, { optionId: 'a2', kind: 'allow_always' }, { optionId: 'r1', kind: 'reject_once' }];
checa('permitir escolhe allow_once', acp.escolherOpcao(ops, true, false).optionId === 'a1');
checa('permitir "sempre" escolhe allow_always', acp.escolherOpcao(ops, true, true).optionId === 'a2');
checa('negar escolhe reject_once', acp.escolherOpcao(ops, false).optionId === 'r1');
checa('sem opcoes devolve null', acp.escolherOpcao([], true) === null);

// --- passo: nome e argumento ---
const p1 = acp.passoDaFerramenta({ title: 'Read file', kind: 'read', locations: [{ path: 'C:/x/a.js' }] });
checa('read com caminho vira Read + caminho', p1.name === 'Read' && p1.arg === 'C:/x/a.js');
const p2 = acp.passoDaFerramenta({ title: 'Buscar na web', kind: 'other' });
checa('kind desconhecido usa o titulo sem repetir no argumento', p2.name === 'Buscar na web' && p2.arg === '');

// --- transcricao propria ---
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-teste-'));
const pastaDados = () => tmp;
const arq = acp.arquivoDaSessao(pastaDados, 'abc-123');
acp.anotar(arq, { cabecalho: 1, id: 'abc-123', comando: 'gemini --acp', cwd: 'C:/proj', criado: 1, agente: 'Gemini CLI' });
acp.anotar(arq, { role: 'user', text: 'arruma o rodapé' });
acp.anotar(arq, { role: 'tool', name: 'Edit', arg: 'C:/proj/x.css' });
acp.anotar(arq, { role: 'bot', text: 'pronto' });
const lista = acp.listarSessoes(pastaDados);
checa('a sessao anotada aparece na lista com titulo, pasta e comando', lista.length === 1 && lista[0].title === 'arruma o rodapé' && lista[0].cwd === 'C:/proj' && lista[0].comando === 'gemini --acp', JSON.stringify(lista));
const hist = acp.historicoDaSessao(arq, 60);
checa('o historico volta na ordem user/tool/bot', hist.map((m) => m.role).join(',') === 'user,tool,bot');
// sessao sem fala sua nao vira conversa
const arq2 = acp.arquivoDaSessao(pastaDados, 'vazia');
acp.anotar(arq2, { cabecalho: 1, id: 'vazia' });
checa('sessao sem fala sua fica fora da lista', acp.listarSessoes(pastaDados).length === 1);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nteste-acp: tudo ok');
process.exit(falhas ? 1 : 0);
