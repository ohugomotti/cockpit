/* Levas 35 (Torre) e 36 (Entrada): as pecas puras, extraidas do fonte de
   verdade, e os contratos que nao dependem da tela (inbox em disco, nome do
   servidor MCP, comandos de voz normalizados, estado do painel na torre). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { lerFonte, pegarBloco, globaisFalsos } = require('./raiz');

const app = lerFonte('renderer', 'app.js');
const main = lerFonte('main.js');
let falhas = 0;
const checa = (nome, ok, det) => { console.log((ok ? '  ok   ' : '  FALHA') + ' ' + nome + (ok || !det ? '' : '  -> ' + det)); if (!ok) falhas++; };

/* ---- tela ---- */
const ctx = {
  ...globaisFalsos(), console,
  $: (sel, raiz) => (raiz && raiz.querySelector ? raiz.querySelector(sel) : null),
  duracaoCurta: (ms) => Math.round(ms / 1000) + 's',
  abaPorId: (id) => ({ pc: { id: 'pc', tipo: 'local', conectoresFora: ['claude.ai Make', ''] }, vazia: { id: 'vazia', tipo: 'local' } })[id],
  remotoDoPane: (P) => (P.abaId === 'ssh' ? { host: 'x' } : null),
};
vm.createContext(ctx);
for (const f of ['function normalizarFala(', 'function estadoDoPainel(', 'function conectoresForaDaAba(', 'function nomeDoModoAcp(']) vm.runInContext(pegarBloco(app, f, f), ctx);

checa('normalizarFala tira acento, pontuacao e caixa', ctx.normalizarFala(' Próximo painel! ') === 'proximo painel' && ctx.normalizarFala('Manda.') === 'manda' && ctx.normalizarFala('Apaga isso,') === 'apaga isso');
// os padroes dos comandos de voz (os mesmos regex do ligarDitado)
const cmd = (t) => {
  const s = ctx.normalizarFala(t);
  if (/^(manda|mandar|envia|enviar)( isso| agora| ai)?$/.test(s)) return 'manda';
  if (/^(cancela|cancelar)( isso| tudo| o ditado)?$/.test(s)) return 'cancela';
  if (/^(apaga|apagar|remove|remover) (isso|essa|essa frase|a ultima|a ultima frase|o ultimo)$/.test(s)) return 'apaga';
  if (/^proximo painel$/.test(s)) return 'proximo';
  return '';
};
checa('comandos de voz casam nas formas faladas', cmd('Manda!') === 'manda' && cmd('envia aí') === 'manda' && cmd('Cancela isso.') === 'cancela' && cmd('apaga a última frase') === 'apaga' && cmd('Próximo painel') === 'proximo');
checa('frase normal nao vira comando', cmd('manda o relatório pro grupo') === '' && cmd('cancela a reunião de amanhã') === '');

checa('estado: esperando autorizar vem antes de tudo', ctx.estadoDoPainel({ pedindoPerm: true, busy: true }).cls === 'espera');
checa('estado: trabalhando mostra ha quanto tempo', /trabalhando há \d+s/.test(ctx.estadoDoPainel({ busy: true, t0: Date.now() - 65000, trabEl: null }).txt));
checa('estado: parado com motor ligado / vazio', ctx.estadoDoPainel({ started: true }).txt === 'parado, motor ligado' && ctx.estadoDoPainel({}).cls === 'vazio');
checa('conectores fora: so no Claude local, sem vazios', JSON.stringify(ctx.conectoresForaDaAba({ engine: 'claude', abaId: 'pc' })) === '["claude.ai Make"]'
  && ctx.conectoresForaDaAba({ engine: 'codex', abaId: 'pc' }) === undefined && ctx.conectoresForaDaAba({ engine: 'claude', abaId: 'vazia' }) === undefined
  && ctx.conectoresForaDaAba({ engine: 'claude', abaId: 'ssh' }) === undefined);
checa('nome do modo do agente em portugues', ctx.nomeDoModoAcp('yolo') === 'sem pedir permissão' && ctx.nomeDoModoAcp('acceptEdits') === 'editar automaticamente' && ctx.nomeDoModoAcp('xpto') === 'xpto');

// o que a tela manda no start
checa('opcoesDeStart leva worktree e semConectores', /worktree: \(P\.engine === 'claude' && P\.worktree\) \|\| undefined,\s*semConectores: conectoresForaDaAba\(P\)/.test(app));
checa('Enter vazio exige o chip e recusa ditado mudo', /!text && !ditava && \$\('\.p-cont', P\.el\) && podeContinuar\(P\)/.test(app));
checa('menu + tem recorte e foto; ficha de imagem tem OCR', /nome: 'Recortar a tela'/.test(app) && /nome: 'Fotografar'/.test(app) && /className = 'anx-ocr'/.test(app));

/* ---- main ---- */
const ctxM = { ...globaisFalsos(), console };
vm.createContext(ctxM);
// nomeDeServidorMcp e' const arrow: recorta pela linha
const linhaNome = main.split('\n').find((l) => l.startsWith('const nomeDeServidorMcp ='));
vm.runInContext(linhaNome.replace(/^const /, 'var '), ctxM);
checa('nome do servidor MCP vira prefixo de ferramenta', ctxM.nomeDeServidorMcp('claude.ai Make') === 'claude_ai_Make' && ctxM.nomeDeServidorMcp('plugin:episodic-memory:episodic-memory') === 'plugin_episodic-memory_episodic-memory' && ctxM.nomeDeServidorMcp('') === '');
checa('start do Claude: -w so com nome limpo e --disallowedTools por servidor', /args\.push\('-w', nomeWt\)/.test(main) && /args\.push\('--disallowedTools', \.\.\.semConectores\.map\(\(n\) => 'mcp__' \+ n\)\)/.test(main));
checa('worktree e conectores nao vao pro remoto', /if \(!remoto && nomeWt && /.test(main) && /\(!remoto && Array\.isArray\(opts\.semConectores\)\)/.test(main));
// o regex do nome do worktree, igual ao do fonte: recusa "..", ".git", "-rf" e aceita nome normal
const reWt = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
checa('worktree: nome comeca com letra/numero (sem .., .git, -rf)', main.includes(String(reWt)) && reWt.test('wt-1') && reWt.test('feature.x') && !reWt.test('..') && !reWt.test('.git') && !reWt.test('-rf') && !reWt.test('a/b') && !reWt.test('x'.repeat(41)));
checa('conector cockpit nunca sai (main e editor)', /filter\(\(n\) => n && n !== 'cockpit'\)/.test(main) && /conectoresVistos\.filter\(\(n\) => n !== 'cockpit'\)/.test(app));
checa('worktree: caminho da sessao usa a pasta do worktree e o cwd do init', /claudeCwd\.set\(paneId, path\.join\(opts\.cwd \|\| HOME, '\.claude', 'worktrees', nomeWt\)\)/.test(main) && /encodeCwd\(m\.cwd \|\| claudeCwd\.get\(paneId\) \|\| HOME\)/.test(main));
checa('motor de voz: papel -> modelo', /const modeloDoPapel = \(rapido\) => \(motorVoz === 'parakeet' \? 'parakeet' : \(rapido \? 'base' : 'small'\)\)/.test(main) && /MODELOS_VOZ = \['base', 'small', 'parakeet'\]/.test(main));
checa('ouvinte que nao subiu explica o porque e volta pro whisper', /if \(o\.pronto === false\) \{\s*ou\.erroFatal = /.test(main) && /erro: ou\.erroFatal \|\| 'a transcrição parou'/.test(main) && /motorVoz = 'whisper';\s*if \(win && !win\.isDestroyed\(\)\) win\.webContents\.send\('voz:motor-caiu'/.test(main));
checa('ouvinte: fila por processo e close so zera o proprio', /const pedidos = new Map\(\);\s*ou\.pedidos = pedidos;/.test(main) && /if \(ou\.proc !== proc\) return;\s*ou\.proc = null;/.test(main) && !/ou\.proc\.kill\(\); \} catch \{\} ou\.proc = null/.test(main));
checa('atalhos globais: opt-in, combinacoes com Alt', /function ligarAtalhosGlobais\(ligado\)/.test(main) && /'Control\+Alt\+Space': 'ditar', 'Control\+Alt\+R': 'recortar'/.test(main) && /ligarAtalhosGlobais\(!!loadConfig\(\)\.atalhosGlobais\)/.test(main) && /id="chkAtalhosGlobais"/.test(lerFonte('renderer', 'index.html')));
checa('recorte: guarda contra 2 pedidos, so a tela do mouse, escala por eixo, sender conferido', /if \(recorte \|\| recortando\) return/.test(main) && !/\|\| fontes\[0\]/.test(main) && /kx = tam\.width \/ \(r\.boundsW/.test(main) && /const daJanelaDeRecorte = \(e\) =>/.test(main));
checa('OCR encolhe imagem grande e traduz o erro', /tam\.width > 2500 \|\| tam\.height > 2500/.test(main) && /imagem grande demais pro OCR do Windows/.test(main));
checa('recibo pedido ao Claude e ao Codex', (main.match(/## Recibo/g) || []).length >= 2);
/* ---- auditoria 1B: o que da pra conferir no fonte ---- */
checa('pedirTexto declarado uma vez so (a nova virou perguntarTexto)', (app.match(/^function pedirTexto\(/gm) || []).length === 1 && (app.match(/^function perguntarTexto\(/gm) || []).length === 1 && !/await pedirTexto\('/.test(app));
checa('modal global tem gancho de fechamento (camera desliga no veu/Esc)', /let aoFecharModalGlobal = null;/.test(app) && /aoFecharModalGlobal = \(\) => \{ fechado = true; parar\(\);/.test(app) && /aoFecharModalGlobal = \(\) => fim\(null\);/.test(app));
checa('quadro: foco dentro, Esc e aceleradores barrados, cena em arquivo', /focarQuadro\(\);/.test(app) && /if \(e\.key !== 'Escape' \|\| quadro\) return;/.test(app) && /if \(e\.key === 'Escape' && !quadro\)/.test(app) && /if \(quadro && a !== 'parar'\) return;\s*\n\s*if \(a === 'newPane'\)/.test(app) && /nome: 'quadro-' \+ P\.id/.test(app) && /quadro: P\.quadroArquivo \|\| \(\(P\.quadroCena/.test(app));
checa('recibo: so titulo "Recibo" e so como fecho da fala; painel restaurado tambem ganha o cartao', /cabs\.find\(\(h\) => \/\^.{0,12}recibo\(.{0,40}turno\)\?.{0,24}\$\/i\.test\(h\.textContent/.test(app) && /nivel\(h\) <= nivel\(cab\)/.test(app) && (app.match(/marcarRecibo\(b\.el\);/g) || []).length >= 3);
checa('torre: geracao contra repaint em voo e linha de fora sem pointer', /const gen = \+\+torreGen;/.test(app) && /if \(gen !== torreGen\) \{ if \(torreVisivel\(\)\) pintarTorre\(false\); return; \}/.test(app) && /else d\.classList\.add\('fora'\)/.test(app));
checa('voz: comando marcado, apaga tira a frase anterior, shift+clique para sem enviar', (app.match(/d\.comando = true;/g) || []).length === 4 && /if \(i > 0\) d\.frases\.splice\(i - 1, 1\);\s*\n/.test(app) && /pararDitado\(e\.shiftKey \? 'botao-editar' : 'botao'\)/.test(app) && /motivo !== 'botao-editar'/.test(app));
checa('rodada 2: -w so dentro de git, nome que o git aceita, inbox espera a tela ouvir, OCR com arquivo proprio, quadros orfaos limpos', /function dentroDeGit\(dir\)/.test(main) && /!dentroDeGit\(opts\.cwd \|\| HOME\)/.test(main) && /\.lock\$/.test(main) && /ipcMain\.handle\('inbox:ouvindo'/.test(main) && /if \(!inboxOuvinte \|\| !win/.test(main) && /'ocr-' \+ Date\.now\(\) \+ '-' \+ \(\+\+seqOcr\)/.test(main) && /function limparQuadrosOrfaos\(\)/.test(main) && /limparQuadrosOrfaos\(\);/.test(main) && /render-process-gone/.test(main));
checa('rodada 2B: cena lida sem teto, camera nao fica ligada, quadro cobre a tela pra permissao, conectores por uniao, voz sem comando fantasma', /ipcMain\.handle\('arquivo:lerTexto'/.test(main) && /window\.api\.textoLer\(\{ arquivo: P\.quadroArquivo \}\)/.test(app) && /let trilha = null, fechado = false;/.test(app) && /if \(fechado\) \{ try \{ nova\.getTracks/.test(app) && /function painelVisivel\(P\) \{\s*if \(quadro\) return false;/.test(app) && /cfg\.conectoresQuando = quando;/.test(app) && !/const completa = P && !conectoresForaDaAba/.test(app) && /d\.frases\.includes\(f\) && comandoDeVoz\(d, f\)/.test(app) && /if \(quadro && a !== 'parar'\) return;/.test(app));
checa('main: salvarTexto com nome fixo grava em quadros/', /const fixo = String\(nome \|\| ''\)\.replace/.test(main) && /fixo \? 'quadros' : 'colados'/.test(main));

/* ---- inbox em disco: o contrato do bot ---- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-teste-'));
const enviados = [];
const ctxI = {
  ...globaisFalsos(), console, fs, path, Date,
  PASTA_INBOX: () => tmp,
  inboxVistos: new Set(),
  inboxOuvinte: true,
  win: { isDestroyed: () => false, webContents: { isLoading: () => false, send: (canal, dados) => enviados.push({ canal, dados }) } },
};
vm.createContext(ctxI);
vm.runInContext(pegarBloco(main, 'function varrerInbox(', 'varrerInbox'), ctxI);
fs.writeFileSync(path.join(tmp, 'telegram-1.txt'), 'Cria a página de captura', 'utf8');
fs.writeFileSync(path.join(tmp, 'foto-1.jpg'), Buffer.from([1, 2, 3]));
fs.writeFileSync(path.join(tmp, 'lixo.exe'), 'x');
fs.writeFileSync(path.join(tmp, 'meio.txt.tmp'), 'ainda escrevendo');
// mtime recente demais e' ignorado (arquivo ainda sendo escrito): envelhece na mao
const velho = new Date(Date.now() - 5000);
for (const n of ['telegram-1.txt', 'foto-1.jpg', 'lixo.exe', 'meio.txt.tmp']) fs.utimesSync(path.join(tmp, n), velho, velho);
ctxI.varrerInbox();
const nomes = enviados.map((e) => e.dados.nome).sort();
checa('inbox: .txt vira texto e imagem vira imagem; .exe e .tmp ficam de fora', JSON.stringify(nomes) === '["foto-1.jpg","telegram-1.txt"]' && enviados.find((e) => e.dados.nome === 'telegram-1.txt').dados.texto === 'Cria a página de captura' && enviados.find((e) => e.dados.nome === 'foto-1.jpg').dados.tipo === 'imagem', JSON.stringify(nomes));
ctxI.varrerInbox();
checa('inbox: a segunda varredura nao repete', enviados.length === 2);
fs.writeFileSync(path.join(tmp, 'novo.txt'), 'x', 'utf8');   // recem-escrito: espera assentar
ctxI.varrerInbox();
checa('inbox: arquivo recem-escrito espera a proxima varredura', enviados.length === 2);
const futuroPerto = new Date(Date.now() + 300); fs.utimesSync(path.join(tmp, 'novo.txt'), futuroPerto, futuroPerto);
ctxI.varrerInbox();
checa('inbox: mtime uns ms no futuro (relogio do disco) ainda e recem-escrito', enviados.length === 2);
const futuroLonge = new Date(Date.now() + 60000); fs.utimesSync(path.join(tmp, 'novo.txt'), futuroLonge, futuroLonge);
ctxI.varrerInbox();
checa('inbox: mtime muito no futuro nao fica preso', enviados.length === 3);
// foto com legenda: a imagem e o .txt de mesmo nome viram UM aviso, com a legenda dentro
fs.writeFileSync(path.join(tmp, 'telegram-9-1.png'), Buffer.from([1, 2, 3]));
fs.writeFileSync(path.join(tmp, 'telegram-9-1.txt'), 'olha esse print', 'utf8');
for (const n of ['telegram-9-1.png', 'telegram-9-1.txt']) fs.utimesSync(path.join(tmp, n), velho, velho);
ctxI.varrerInbox();
const comLegenda = enviados.filter((e) => e.dados.nome.startsWith('telegram-9-1'));
checa('inbox: imagem + legenda de mesmo nome viram um aviso so', comLegenda.length === 1 && comLegenda[0].dados.tipo === 'imagem' && comLegenda[0].dados.legenda === 'olha esse print', JSON.stringify(comLegenda.map((e) => e.dados.nome)));
// tela ainda carregando: nao anuncia (senao o aviso se perde pra sempre)
ctxI.win.webContents.isLoading = () => true;
fs.writeFileSync(path.join(tmp, 'tarde.txt'), 'x', 'utf8'); fs.utimesSync(path.join(tmp, 'tarde.txt'), velho, velho);
ctxI.varrerInbox();
checa('inbox: com a tela carregando, espera', !enviados.find((e) => e.dados.nome === 'tarde.txt'));
ctxI.win.webContents.isLoading = () => false;
ctxI.varrerInbox();
checa('inbox: tela pronta, anuncia o que esperou', !!enviados.find((e) => e.dados.nome === 'tarde.txt'));
// o mesmo nome regravado depois (mtime novo) e' outra mensagem: nao pode ficar preso no "ja vi"
fs.writeFileSync(path.join(tmp, 'tarde.txt'), 'segunda', 'utf8');
const maisNovo = new Date(Date.now() - 2000); fs.utimesSync(path.join(tmp, 'tarde.txt'), maisNovo, maisNovo);
ctxI.varrerInbox();
checa('inbox: arquivo regravado com o mesmo nome e anunciado de novo', enviados.filter((e) => e.dados.nome === 'tarde.txt').length === 2 && enviados.filter((e) => e.dados.nome === 'tarde.txt').pop().dados.texto === 'segunda');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

/* ---- bot do Telegram: o gancho existe e escreve em dois tempos ---- */
try {
  const bot = fs.readFileSync('C:/Users/hugom/Projetos-claude/claude-telegram/bot.js', 'utf8');
  checa('bot: /cockpit, audio "cockpit, ..." e foto (ou imagem como arquivo) vao pra caixa; .txt em dois tempos; nome com sequencia', /case '\/cockpit':/.test(bot) && /ehTopicoCockpit\(msg\) \|\| mc/.test(bot) && /\(msg\.photo && msg\.photo\.length \|\| docImagem\) && \(ehTopicoCockpit/.test(bot) && /base \+ '\.txt\.tmp'/.test(bot) && /seqCockpit = \(seqCockpit \+ 1\)/.test(bot) && /base \+ ext \+ '\.tmp'/.test(bot) && bot.indexOf("base + ext + '.tmp'))") < bot.indexOf("fs.renameSync(path.join(dir, base + ext + '.tmp')"));
} catch { console.log('  (bot do Telegram nao esta nesta maquina: pulei)'); }

/* ---- handlers do main extraidos: inbox:consumir (pasta conferida de verdade) e prompts:salvar (normaliza) ---- */
function handlerDe(canal) {
  const ini = main.indexOf("ipcMain.handle('" + canal + "', ");
  if (ini < 0) throw new Error('sem handler ' + canal);
  const abre = main.indexOf('=> {', ini);
  let nivel = 0, fim = -1;
  for (let k = main.indexOf('{', abre); k < main.length; k++) {
    if (main[k] === '{') nivel++;
    else if (main[k] === '}') { nivel--; if (nivel === 0) { fim = k + 1; break; } }
  }
  return '(' + main.slice(ini + ("ipcMain.handle('" + canal + "', ").length, fim) + ')';
}
const caixa = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-consumir-'));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'userdata-'));
const gravados = {};
const ctxH = {
  ...globaisFalsos(), console, fs, path, Date,
  EH_WIN: process.platform === 'win32',
  PASTA_INBOX: () => caixa,
  PROMPTS_PATH: () => path.join(userData, 'prompts.json'),
  gravarSeguro: (arq, txt) => { gravados[arq] = txt; },
  app: { getPath: () => userData },
};
vm.createContext(ctxH);
const consumir = vm.runInContext(handlerDe('inbox:consumir'), ctxH);
fs.writeFileSync(path.join(caixa, 'foto.png'), Buffer.from([1]));
fs.writeFileSync(path.join(caixa, 'foto.txt'), 'legenda', 'utf8');
fs.mkdirSync(caixa + '2'); fs.writeFileSync(path.join(caixa + '2', 'x.txt'), 'x', 'utf8');
fs.writeFileSync(caixa + '-velha.txt', 'x', 'utf8');
checa('consumir: recusa pasta irma com o mesmo prefixo (inbox2, inbox-velha.txt)', !!consumir(null, { arquivo: path.join(caixa + '2', 'x.txt') }).error && !!consumir(null, { arquivo: caixa + '-velha.txt' }).error && fs.existsSync(path.join(caixa + '2', 'x.txt')));
checa('consumir: recusa caminho que sobe de dentro da caixa', !!consumir(null, { arquivo: path.join(caixa, '..', path.basename(caixa) + '-velha.txt') }).error);
const r1 = consumir(null, { arquivo: path.join(caixa, 'foto.png') });
checa('consumir: imagem vai pra colados/ e a legenda de mesmo nome some junto', !!r1.arquivo && fs.existsSync(r1.arquivo) && !fs.existsSync(path.join(caixa, 'foto.png')) && !fs.existsSync(path.join(caixa, 'foto.txt')), JSON.stringify(r1));
fs.writeFileSync(path.join(caixa, 'print.PNG'), Buffer.from([1]));
const r2 = consumir(null, { arquivo: path.join(caixa, 'print.PNG'), apagar: true });
checa('consumir: apagar=true descarta a imagem sem levar pra colados/', r2.ok && !fs.existsSync(path.join(caixa, 'print.PNG')) && !r2.arquivo);
if (process.platform === 'win32') {
  fs.writeFileSync(path.join(caixa, 'caixa.txt'), 'x', 'utf8');
  const r3 = consumir(null, { arquivo: path.join(caixa.toUpperCase(), 'caixa.txt') });
  checa('consumir: no Windows a pasta em caixa alta e a mesma pasta', r3.ok === true && !fs.existsSync(path.join(caixa, 'caixa.txt')), JSON.stringify(r3));
}
const salvar = vm.runInContext(handlerDe('prompts:salvar'), ctxH);
salvar(null, [{ nome: '  Relatório ', texto: 'x'.repeat(60000) }, { nome: '', texto: 'sem nome' }, { nome: 'vazio', texto: '   ' }, 'lixo', null, { nome: 'ok', texto: 'certo', quando: 5 }]);
const salvo = JSON.parse(Object.values(gravados)[0] || '[]');
checa('prompts:salvar normaliza (tira sem nome/sem texto, apara nome, corta texto em 50k)', salvo.length === 2 && salvo[0].nome === 'Relatório' && salvo[0].texto.length === 50000 && salvo[1].nome === 'ok' && salvo[1].quando === 5, JSON.stringify(salvo.map((p) => [p.nome, p.texto.length, p.quando])));
try { fs.rmSync(caixa, { recursive: true, force: true }); fs.rmSync(caixa + '2', { recursive: true, force: true }); fs.rmSync(caixa + '-velha.txt', { force: true }); fs.rmSync(userData, { recursive: true, force: true }); } catch {}

console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nteste-torre-entrada: tudo ok');
process.exit(falhas ? 1 : 0);
