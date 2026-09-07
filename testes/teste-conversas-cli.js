/* A lista de conversas do Gemini (e de qualquer motor por turno).

   O formato do arquivo NAO foi adivinhado: foi lido no codigo do proprio
   gemini-cli (chatRecordingService / loadConversationRecord). Como nesta
   maquina o Gemini nunca chegou a responder, nao ha conversa de verdade pra
   conferir - entao o teste monta um arquivo com as mesmas regras do CLI e
   cobra que o Cockpit leia igual:

     - linha com "id"        -> entra no mapa por id
     - "$set.messages"       -> LIMPA o mapa e repovoa
     - "$rewindTo"           -> apaga dali pra frente
     - <session_context>     -> nao e' fala de gente, nao vira titulo

   No fim ele ainda roda em cima da pasta ~/.gemini de verdade, so' pra provar
   que nao estoura com o que existe na maquina. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const { lerFonte, pegarBloco } = require('./raiz');

const NL = String.fromCharCode(10);
let falhas = 0;
function checa(nome, cond, det) {
  if (cond) console.log('  ok   ' + nome);
  else { falhas++; console.log('  FALHA ' + nome + (det ? ' -> ' + det : '')); }
}

/* ---- monta o contexto com as funcoes de verdade do main.js ---- */
const txt = lerFonte('main.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-cli-'));
const CASA = path.join(TMP, 'casa');
const RAIZ_GEMINI = path.join(CASA, '.gemini', 'tmp');
fs.mkdirSync(path.join(RAIZ_GEMINI, 'projeto-x', 'chats'), { recursive: true });
fs.mkdirSync(path.join(RAIZ_GEMINI, 'projeto-x', 'logs'), { recursive: true });

const ctx = {
  console, fs, path, Map, Set, JSON, Date, Math, Object, Array, String, Number, Boolean, RegExp, Error,
  HOME: CASA,
  headRead: (f, b) => {
    try {
      const fd = fs.openSync(f, 'r');
      const buf = Buffer.alloc(b);
      const n = fs.readSync(fd, buf, 0, b, 0);
      fs.closeSync(fd);
      return buf.slice(0, n).toString('utf8');
    } catch { return ''; }
  },
  CLIS: {
    gemini: { nome: 'Gemini', pastaSessoes: () => RAIZ_GEMINI, conversas: true },
    grok: { nome: 'Grok', pastaSessoes: () => path.join(CASA, '.grok', 'sessions'), conversas: false },
  },
  ipcMain: { handle() {} },
};
vm.createContext(ctx);
for (const a of ['function cliFalaDeGente(', 'function cliLerConversa(', 'function cliMapaProjetos(',
  'function cliSessions(', 'function cliHistory(', 'function comandosDoCli(', 'function descricaoDoToml(']) {
  vm.runInContext(pegarBloco(txt, a, a), ctx);
}
ctx.CLIS.gemini.comandos = true;
ctx.CLIS.grok.comandos = false;
for (const d of ['const cliTexto = ', 'const CLI_TETO_TITULO = ']) {
  const i = txt.indexOf(d);
  const fim = txt.indexOf(';', i);
  vm.runInContext('var ' + txt.slice(i + 'const '.length, fim + 1), ctx);
}

/* ---- o arquivo de conversa, nas regras do CLI ---- */
const CONTEXTO = { id: 'ctx1', timestamp: '2026-09-01T10:00:00.000Z', type: 'user', content: [{ text: '<session_context>' + NL + 'isto e o contexto que o CLI injeta' }] };
const linhas = [
  { sessionId: 'sess-1111', projectHash: 'hhh', startTime: '2026-09-01T10:00:00.000Z', lastUpdated: '2026-09-01T10:00:00.000Z', kind: 'main' },
  // primeira rodada: o processo grava o retrato inicial e depois acrescenta
  { $set: { messages: [CONTEXTO], lastUpdated: '2026-09-01T10:00:00.000Z' } },
  { id: 'u1', timestamp: '2026-09-01T10:00:10.000Z', type: 'user', content: [{ text: 'lista os arquivos da pasta' }] },
  { id: 'g1', timestamp: '2026-09-01T10:00:12.000Z', type: 'gemini', content: [{ text: 'Vou olhar.' }], toolCalls: [{ id: 't1', name: 'ReadFolder', args: { path: '.' }, result: 'ok' }] },
  { $set: { lastUpdated: '2026-09-01T10:00:12.000Z' } },
  // segunda rodada: processo NOVO, retrato do que ja existia + a fala nova
  { $set: { messages: [CONTEXTO, { id: 'u1', timestamp: '2026-09-01T10:00:10.000Z', type: 'user', content: [{ text: 'lista os arquivos da pasta' }] }, { id: 'g1', timestamp: '2026-09-01T10:00:12.000Z', type: 'gemini', content: [{ text: 'Vou olhar.' }], toolCalls: [{ id: 't1', name: 'ReadFolder', args: { path: '.' } }] }], lastUpdated: '2026-09-01T10:05:00.000Z' } },
  { id: 'u2', timestamp: '2026-09-01T10:05:01.000Z', type: 'user', content: [{ text: '/ajuda' }] },
  { id: 'u3', timestamp: '2026-09-01T10:05:30.000Z', type: 'user', content: [{ text: 'agora apaga tudo' }] },
  { id: 'g2', timestamp: '2026-09-01T10:05:31.000Z', type: 'gemini', content: [{ text: 'Melhor nao.' }] },
  // voltou atras: tudo de u3 pra frente sai
  { $rewindTo: 'u3' },
  { id: 'info1', timestamp: '2026-09-01T10:06:00.000Z', type: 'info', content: [{ text: 'aviso interno do CLI' }] },
  { id: 'g3', timestamp: '2026-09-01T10:06:10.000Z', type: 'gemini', content: [{ text: 'Terminei.' }] },
];
const ARQ = path.join(RAIZ_GEMINI, 'projeto-x', 'chats', 'session-2026-09-01T10-00-sess1111.jsonl');
fs.writeFileSync(ARQ, linhas.map((l) => JSON.stringify(l)).join(NL) + NL);

// o mesmo nome dentro de logs/: e o log do desenvolvedor, nao pode virar conversa
fs.writeFileSync(path.join(RAIZ_GEMINI, 'projeto-x', 'logs', 'session-2026-09-01T10-00-sess1111.jsonl'),
  JSON.stringify({ sessionId: 'sess-1111', projectHash: 'hhh' }) + NL);

// conversa que so' tem o contexto inicial: nao deve aparecer na lista
fs.writeFileSync(path.join(RAIZ_GEMINI, 'projeto-x', 'chats', 'session-2026-09-02T09-00-vazia.jsonl'),
  [{ sessionId: 'sess-2222', projectHash: 'hhh' }, { $set: { messages: [CONTEXTO] } }]
    .map((l) => JSON.stringify(l)).join(NL) + NL);

fs.writeFileSync(path.join(CASA, '.gemini', 'projects.json'),
  JSON.stringify({ projects: { 'c:\\trabalho\\projeto x': 'projeto-x' } }));

/* ---------------------------- o que se cobra ---------------------------- */

console.log(NL + 'A lista de conversas');
const lista = ctx.cliSessions('gemini');
{
  checa('so entra conversa com fala de gente', lista.length === 1, JSON.stringify(lista.map((s) => s.title)));
  const s = lista[0] || {};
  checa('o titulo e a primeira fala sua, nao o <session_context>',
    s.title === 'lista os arquivos da pasta', JSON.stringify(s.title));
  checa('o id vem do cabecalho do arquivo', s.id === 'sess-1111', JSON.stringify(s.id));
  checa('o motor vem marcado', s.engine === 'gemini', JSON.stringify(s.engine));
  checa('a pasta sai do projects.json, nao do apelido',
    String(s.cwd).toLowerCase() === 'c:\\trabalho\\projeto x', JSON.stringify(s.cwd));
  checa('a letra do disco volta maiuscula', String(s.cwd).startsWith('C:'), JSON.stringify(s.cwd));
  checa('o arquivo apontado e o de chats, nao o de logs',
    String(s.file).includes('chats'), JSON.stringify(s.file));
  checa('tem data pra ordenar a lista', typeof s.when === 'number' && s.when > 0, String(s.when));
}

console.log(NL + 'Motor sem formato confirmado');
{
  const r = ctx.cliSessions('grok');
  checa('Grok nao inventa lista', Array.isArray(r) && r.length === 0, JSON.stringify(r));
  checa('motor desconhecido nao estoura', ctx.cliSessions('zzz').length === 0);
}

console.log(NL + 'Reabrir a conversa');
const h = ctx.cliHistory(ARQ, 60);
{
  const papeis = h.map((m) => m.role).join(',');
  checa('o <session_context> nao volta pra tela',
    !h.some((m) => String(m.text || '').includes('<session_context>')), JSON.stringify(h[0]));
  checa('comando "/ajuda" nao volta como sua fala',
    !h.some((m) => m.role === 'user' && m.text === '/ajuda'), papeis);
  checa('a fala do modelo volta como bot',
    h.some((m) => m.role === 'bot' && m.text === 'Vou olhar.'), papeis);
  checa('a ferramenta volta com nome',
    h.some((m) => m.role === 'tool' && m.name === 'ReadFolder'), JSON.stringify(h.filter((m) => m.role === 'tool')));
  checa('a mensagem repetida no retrato NAO aparece duas vezes',
    h.filter((m) => m.role === 'user' && m.text === 'lista os arquivos da pasta').length === 1, papeis);
  checa('o que foi desfeito pelo $rewindTo nao volta',
    !h.some((m) => String(m.text || '').includes('agora apaga tudo')), papeis);
  checa('a resposta desfeita tambem some',
    !h.some((m) => m.text === 'Melhor nao.'), papeis);
  checa('o que veio depois do desfazer continua',
    h.some((m) => m.text === 'Terminei.'), papeis);
  checa('aviso interno do CLI (type info) nao vira bolha',
    !h.some((m) => String(m.text || '').includes('aviso interno')), papeis);
  checa('a ordem e a da conversa', papeis.startsWith('user,bot,tool'), papeis);
}

console.log(NL + 'O menu "/" de cada motor');
{
  const cmds = path.join(CASA, '.gemini', 'commands');
  fs.mkdirSync(path.join(cmds, 'git'), { recursive: true });
  fs.writeFileSync(path.join(cmds, 'revisar.toml'),
    'description = "olha o diff e aponta problema"' + NL + 'prompt = "revise isto"' + NL);
  fs.writeFileSync(path.join(cmds, 'git', 'commit.toml'),
    "description = 'escreve a mensagem do commit'" + NL + 'prompt = "faca o commit"' + NL);
  fs.writeFileSync(path.join(cmds, 'sem-descricao.toml'), 'prompt = "so isso"' + NL);
  fs.writeFileSync(path.join(cmds, 'leia-me.md'), 'isto nao e comando' + NL);

  const lista = ctx.comandosDoCli('gemini');
  const nomes = lista.map((c) => c.name);
  checa('acha os comandos do Gemini', nomes.includes('revisar'), JSON.stringify(nomes));
  checa('comando dentro de pasta vira "pasta:nome", como no proprio CLI',
    nomes.includes('git:commit'), JSON.stringify(nomes));
  checa('arquivo que nao e .toml fica de fora', !nomes.includes('leia-me'), JSON.stringify(nomes));
  checa('a descricao com aspas duplas e lida',
    (lista.find((c) => c.name === 'revisar') || {}).desc === 'olha o diff e aponta problema',
    JSON.stringify(lista.find((c) => c.name === 'revisar')));
  checa('a descricao com aspas simples tambem',
    (lista.find((c) => c.name === 'git:commit') || {}).desc === 'escreve a mensagem do commit',
    JSON.stringify(lista.find((c) => c.name === 'git:commit')));
  checa('comando sem descricao entra mesmo assim',
    nomes.includes('sem-descricao'), JSON.stringify(nomes));
  checa('o Grok NAO herda a lista do Codex',
    ctx.comandosDoCli('grok').length === 0, JSON.stringify(ctx.comandosDoCli('grok')));
}

console.log(NL + 'O erro do Gemini vira frase que diz o que fazer');
{
  /* o motivoDoCli tem uma regex com '\{' dentro - isso engana o contador de
     chaves do pegarBloco (armadilha ja conhecida). Corta por marco: a funcao
     seguinte no arquivo. */
  const iM = txt.indexOf('function motivoDoCli(');
  // logo depois dele vem o comentario que abre o bloco das conversas
  const fM = txt.indexOf('/* ---- lista de conversas dos motores por turno');
  if (iM < 0 || fM < 0 || fM < iM) throw new Error('nao achei os marcos do motivoDoCli');
  vm.runInContext(txt.slice(iM, fM), ctx);
  const cli = { nome: 'Gemini', bin: 'gemini' };
  const m = (t) => ctx.motivoDoCli(t, cli, 1);

  // mensagens REAIS colhidas rodando o CLI com a chave do Hugo (06/09/2026)
  const semGratis = 'Quota exceeded for metric: generatelanguage.googleapis.com/generate_content_free_tier_input_token_count, limit: 0, model: gemini-3.1-pro RESOURCE_EXHAUSTED';
  checa('"limit: 0" NAO vira "acabou a cota" (nunca teve cota)',
    /não entra na camada grátis/i.test(m(semGratis)), JSON.stringify(m(semGratis)));

  const aposentado = 'This model models/gemini-2.5-pro is no longer available to new users. Please update your code';
  checa('modelo aposentado manda trocar de modelo',
    /aposentou esse modelo/i.test(m(aposentado)), JSON.stringify(m(aposentado)));

  const cotaMesmo = 'RESOURCE_EXHAUSTED: quota exceeded, please retry in 24s';
  checa('cota esgotada de verdade continua dizendo "acabou a cota"',
    /Acabou a cota/i.test(m(cotaMesmo)), JSON.stringify(m(cotaMesmo)));
}

console.log(NL + 'Contra a maquina de verdade');
{
  const real = {
    gemini: { nome: 'Gemini', pastaSessoes: () => path.join(os.homedir(), '.gemini', 'tmp'), conversas: true },
    grok: { nome: 'Grok', pastaSessoes: () => path.join(os.homedir(), '.grok', 'sessions'), conversas: false },
  };
  const antes = ctx.CLIS;
  ctx.CLIS = real; ctx.HOME = os.homedir();
  let erro = '';
  let r = [];
  try { r = ctx.cliSessions('gemini'); } catch (e) { erro = e.message; }
  ctx.CLIS = antes; ctx.HOME = CASA;
  checa('ler a ~/.gemini desta maquina nao estoura', !erro, erro);
  checa('e devolve uma lista', Array.isArray(r), typeof r);
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}

console.log('');
if (falhas) { console.log(falhas + ' FALHA(S)'); process.exit(1); }
console.log('todas passaram');
