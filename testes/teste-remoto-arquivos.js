/* Leva 37 / Fase A: arvore, "@" e visor lendo DENTRO de um servidor.

   As funcoes sao extraidas do main.js de verdade e rodadas com um execRemoto de
   mentira, que devolve o que o servidor devolveria. Assim o teste prova o que
   importa de verdade:
     1. o comando que sai daqui e' o comando certo (um so' por chamada);
     2. o que volta vira a lista/arquivo certo, com caminho POSIX;
     3. falha de rede vira ERRO com frase em portugues, nunca lista vazia;
     4. o cache separa servidores diferentes (dois '~' nao sao a mesma pasta);
     5. quem decide se e' remoto e' a tela, nunca o claudeRemoto (que some no stop). */
const vm = require('vm');
const path = require('path');
const { lerFonte, pegarBloco, globaisFalsos } = require('./raiz');

const main = lerFonte('main.js');
const NL = String.fromCharCode(10);
let falhas = 0;
const checa = (nome, ok, det) => {
  if (ok) console.log('  ok   ' + nome);
  else { falhas++; console.log('  FALHA ' + nome + (det ? ' -> ' + det : '')); }
};

/* ---- andaime: as pecas do main.js, sem electron no meio ---- */
let ultimoScript = '';
let respostaFalsa = { out: '' };
const ctx = {
  ...globaisFalsos(), console, path, Buffer,
  // o helper unico de exec remoto vira um gravador: guarda o script e devolve o combinado
  execRemoto: async (_remoto, script) => { ultimoScript = script; return respostaFalsa; },
};
vm.createContext(ctx);

/* "const X = ..." dentro do vm nao vira propriedade do contexto (variavel de
   bloco). Entao o valor e' avaliado e guardado na mao, na ordem em que um
   depende do outro. */
function constDe(nome) {
  const decl = 'const ' + nome + ' = ';
  const i = main.indexOf(decl);
  if (i < 0) throw new Error('nao achei ' + nome);
  const fim = main.indexOf(';', i + decl.length);
  ctx[nome] = vm.runInContext('(' + main.slice(i + decl.length, fim) + ')', ctx);
  return ctx[nome];
}
for (const n of ['IGNORE', 'PONTO_OK', 'escondido', 'ordemDaArvore', 'EXT_VIS_IMG',
  'EXT_VIS_TXT', 'TETO_VIS_IMG', 'TETO_VIS_TXT', 'mimeDaImagem', 'chaveDoCache']) constDe(n);
/* A sonda do find/base64 do GNU e' uma const de varias linhas E com ';' dentro
   do proprio texto do script -- o constDe corta no primeiro ';' e traria lixo.
   Entao o bloco inteiro entra de uma vez e se anuncia no contexto no fim. */
const blocoSonda = main.slice(main.indexOf('const SONDA_GNU'), main.indexOf('/* A mesma pasta, mas dentro do servidor'));
vm.runInContext(blocoSonda + '\nthis.SONDA_GNU = SONDA_GNU; this.AVISO_SEM_GNU = AVISO_SEM_GNU; this.erroDaSondaGnu = erroDaSondaGnu;', ctx);

// o ramo LOCAL entra junto: e' com ele que o remoto tem que empatar
ctx.fs = require('fs');
for (const f of ['function qLinux(', 'function cdRemoto(', 'function qRemoto(', 'function registrosNul(',
  'async function listDirRemoto(', 'async function varrerArquivosRemoto(', 'async function verArquivoRemoto(',
  'function verArquivoLocal(', 'function pontuarArquivos(']) vm.runInContext(pegarBloco(main, f, f), ctx);

// o que o servidor cospe: registros separados por NUL, em base64
const emPacote = (registros) => Buffer.from(registros.map((r) => r + '\0').join(''), 'utf8').toString('base64');

async function main2() {
  /* ---------- 1) arvore ---------- */
  console.log('1) arvore de arquivos dentro do servidor');
  respostaFalsa = { out: emPacote(['d\t.claude', 'd\tnode_modules', 'f\ta b.txt', 'd\tatalho', 'f\t.oculto', 'd\t.git', 'f\tzz.js']) };
  const arv = await ctx.listDirRemoto({ usuario: 'hugo', host: 'vps', chave: 'k', caminhoRemoto: '~' }, '~');

  checa('um comando so, e ele entra na pasta pedida', /^cd ~ 2>\/dev\/null \|\|/.test(ultimoScript));
  checa('so o primeiro nivel da pasta', /-mindepth 1 -maxdepth 1/.test(ultimoScript));
  checa('usa %Y (segue o atalho): link pra pasta aparece como pasta', /-printf '%Y/.test(ultimoScript));
  checa('volta em base64, com teto de tragada', /head -c \d+ \| base64 -w0/.test(ultimoScript));

  const nomes = (arv.entries || []).map((e) => e.name);
  checa('corta node_modules, .git e os ocultos, e mantem as 3 excecoes',
    nomes.join(',') === '.claude,atalho,a b.txt,zz.js', nomes.join(','));
  checa('pasta antes de arquivo (a mesma ordem do ramo local)',
    arv.entries[0].dir === true && arv.entries[1].dir === true && arv.entries[2].dir === false);
  checa('atalho pra pasta conta como pasta', arv.entries.find((e) => e.name === 'atalho').dir === true);
  checa('caminho e POSIX, nao do Windows',
    arv.entries.find((e) => e.name === 'a b.txt').path === '~/a b.txt',
    arv.entries.find((e) => e.name === 'a b.txt').path);

  console.log(NL + '2) falha e ERRO, nunca lista vazia');
  respostaFalsa = { error: 'O servidor (vps) recusou a chave. Confira o arquivo da chave e o usuário em Editar aba.' };
  const caiu = await ctx.listDirRemoto({ usuario: 'hugo', host: 'vps', chave: 'k' }, '~');
  checa('erro de ssh sobe como erro, e nao como pasta vazia', !!caiu.error && !caiu.entries, JSON.stringify(caiu));
  checa('e a frase esta em portugues', /chave|servidor/i.test(caiu.error));

  respostaFalsa = { out: 'COCKPIT_SEM_PASTA' };
  const semPasta = await ctx.listDirRemoto({ usuario: 'hugo', host: 'vps', chave: 'k' }, '~/nao-existe');
  checa('pasta que nao existe la vira frase clara, nao lista vazia',
    !!semPasta.error && /pasta/i.test(semPasta.error) && !semPasta.entries, JSON.stringify(semPasta));

  /* ---- achado 8: servidor sem o find/base64 do GNU ----
     "find -printf" e "base64 -w0" sao do GNU. Em BusyBox/Alpine/BSD o find
     falha, o 2>/dev/null engole o motivo e o codigo de saida do cano e' o do
     base64 (0, com entrada vazia) -- a resposta chegava vazia e a tela dizia
     "pasta vazia". Erro virando lista vazia e' exatamente o que o plano proibe. */
  checa('(8) o script leva a sonda do find -printf e do base64 -w0 ANTES do comando de verdade',
    /find \. -maxdepth 0 -printf '' >\/dev\/null 2>&1 \|\| \{ echo COCKPIT_FIND_SEM_PRINTF/.test(ultimoScript)
    && /printf '' \| base64 -w0 >\/dev\/null 2>&1 \|\| \{ echo COCKPIT_SEM_BASE64/.test(ultimoScript)
    && ultimoScript.indexOf('COCKPIT_FIND_SEM_PRINTF') < ultimoScript.indexOf('-mindepth 1 -maxdepth 1'),
    ultimoScript.slice(0, 260));

  respostaFalsa = { out: 'COCKPIT_FIND_SEM_PRINTF\n' };
  const semGnu = await ctx.listDirRemoto({ usuario: 'hugo', host: 'vps', chave: 'k' }, '~');
  checa('(8) arvore: find sem -printf vira FRASE, nao "pasta vazia"',
    !!semGnu.error && /GNU/.test(semGnu.error) && !semGnu.entries, JSON.stringify(semGnu));

  respostaFalsa = { out: 'COCKPIT_SEM_BASE64\n' };
  const semB64 = await ctx.listDirRemoto({ usuario: 'hugo', host: 'vps', chave: 'k' }, '~');
  checa('(8) arvore: base64 sem -w0 tambem vira frase', !!semB64.error && !semB64.entries, JSON.stringify(semB64));

  respostaFalsa = { out: 'COCKPIT_FIND_SEM_PRINTF\n' };
  const buscaSemGnu = await ctx.varrerArquivosRemoto({ usuario: 'hugo', host: 'vps', chave: 'k' }, '~', 200);
  checa('(8) o "@" cai na mesma armadilha e tambem foi tapado',
    !!buscaSemGnu.error && /GNU/.test(buscaSemGnu.error) && !buscaSemGnu.lista, JSON.stringify(buscaSemGnu));

  // e a pasta VAZIA de verdade continua vazia, sem virar erro
  respostaFalsa = { out: '' };
  const vaziaMesmo = await ctx.listDirRemoto({ usuario: 'hugo', host: 'vps', chave: 'k' }, '~/vazia');
  checa('(8) pasta vazia DE VERDADE continua sendo pasta vazia',
    !vaziaMesmo.error && Array.isArray(vaziaMesmo.entries) && vaziaMesmo.entries.length === 0, JSON.stringify(vaziaMesmo));

  /* ---------- 3) busca do "@" ---------- */
  console.log(NL + '3) a lista do "@" dentro do servidor');
  respostaFalsa = { out: emPacote(['./src/main.js', './a b.txt', './.claude/vai.md']) };
  const busca = await ctx.varrerArquivosRemoto({ usuario: 'hugo', host: 'vps', chave: 'k' }, '~/app', 20000);
  checa('poda as MESMAS pastas do IGNORE',
    [...ctx.IGNORE].filter((n) => !n.startsWith('.')).every((n) => ultimoScript.includes("-name '" + n + "'")));
  checa('poda tudo que comeca com ponto, menos as 3 excecoes',
    /-name '\.\*'/.test(ultimoScript) && ctx.PONTO_OK.every((n) => ultimoScript.includes("! -name '" + n + "'")));
  checa('tem teto de profundidade (nao varre o servidor inteiro)', /-maxdepth \d+/.test(ultimoScript));
  checa('so arquivo, nao pasta', /-type f -printf/.test(ultimoScript));
  checa('caminhos voltam POSIX e colados na raiz do painel',
    busca.lista.join('|') === '~/app/src/main.js|~/app/a b.txt|~/app/.claude/vai.md', String(busca.lista));

  respostaFalsa = { error: 'Não alcancei o servidor (vps). Ele está no ar e liberado para o seu IP?' };
  const buscaCaiu = await ctx.varrerArquivosRemoto({ usuario: 'hugo', host: 'vps', chave: 'k' }, '~', 20000);
  checa('rede fora vira erro (senao o "@" diria que a pasta nao tem nada)', !!buscaCaiu.error && !buscaCaiu.lista);

  checa('o "@" ordena por nome usando basename POSIX',
    ctx.pontuarArquivos(['~/app/src/main.js', '~/app/main.js'], 'main.js', { host: 'vps' })
      .every((x) => x.nome === 'main.js'));

  /* ---------- 4) visor ---------- */
  console.log(NL + '4) visor: mesmo teto do ramo local, e o erro aparece');
  const png = Buffer.from([137, 80, 78, 71]).toString('base64');
  respostaFalsa = { out: 'COCKPIT_TAM 4' + NL + png };
  const img = await ctx.verArquivoRemoto({ usuario: 'hugo', host: 'vps', chave: 'k' }, '~/prints/tela.png');
  checa('imagem volta pronta pra tag <img>', img.tipo === 'imagem' && img.dados === 'data:image/png;base64,' + png);
  checa('e leva nome e tamanho de verdade', img.nome === 'tela.png' && img.bytes === 4);
  checa('o teto de imagem e o mesmo do ramo local (25 MB)', ultimoScript.includes(String(ctx.TETO_VIS_IMG)));
  checa('nao chama o cat sem conferir: confere que e arquivo e que cabe',
    /\[ -f /.test(ultimoScript) && /-le \d+ \] && base64 -w0/.test(ultimoScript));
  checa('sai com codigo 0 mesmo quando nao cabe (senao viraria "caiu a conexao")', /exit 0$/.test(ultimoScript));

  respostaFalsa = { out: 'COCKPIT_TAM 12' + NL + Buffer.from('oi servidor', 'utf8').toString('base64') };
  const txt = await ctx.verArquivoRemoto({ usuario: 'hugo', host: 'vps', chave: 'k' }, '~/app/leia.md');
  checa('texto volta decodificado', txt.tipo === 'texto' && txt.dados === 'oi servidor');
  checa('o teto de texto tambem e o mesmo (600 KB)', ultimoScript.includes(String(ctx.TETO_VIS_TXT)));

  respostaFalsa = { out: 'COCKPIT_TAM 900000000' + NL };
  const gordo = await ctx.verArquivoRemoto({ usuario: 'hugo', host: 'vps', chave: 'k' }, '~/filme.mp4');
  checa('arquivo que nao abre aqui volta como "outro", sem baixar nada', gordo.tipo === 'outro' && gordo.bytes === 900000000);

  /* ---- ACHADO da leva 38: arquivo VAZIO no servidor ----
     "base64 -w0" de um arquivo de 0 byte nao imprime nada. O pacote vazio caia
     no mesmo balde do "nao cabe" e o visor dizia "Este tipo nao abre aqui
     dentro" para um .txt em branco -- enquanto o ramo LOCAL abre o mesmo
     arquivo como texto vazio, com um <pre> em branco. Agora os dois empatam.
     Quem separa "vazio" de "deu errado" e' o tamanho que o servidor mandou. */
  respostaFalsa = { out: 'COCKPIT_TAM 0' + NL };
  const vazio = await ctx.verArquivoRemoto({ usuario: 'hugo', host: 'vps', chave: 'k' }, '~/em-branco.txt');
  checa('(38) texto VAZIO no servidor abre como texto vazio, nao como "tipo nao suportado"',
    vazio.tipo === 'texto' && vazio.dados === '' && vazio.bytes === 0, JSON.stringify(vazio));

  // ...e o empate com o ramo local, provado no mesmo arquivo de verdade
  const os = require('os');
  const fsr = require('fs');
  const tmp = path.join(os.tmpdir(), 'cockpit-teste-vazio.txt');
  fsr.writeFileSync(tmp, '');
  const local = ctx.verArquivoLocal(tmp);
  try { fsr.unlinkSync(tmp); } catch {}
  checa('(38) e o ramo remoto empata com o LOCAL no mesmo arquivo de 0 byte',
    local.tipo === vazio.tipo && local.dados === vazio.dados && local.bytes === vazio.bytes,
    JSON.stringify({ local: local.tipo + '/' + JSON.stringify(local.dados), remoto: vazio.tipo + '/' + JSON.stringify(vazio.dados) }));

  respostaFalsa = { out: 'COCKPIT_TAM 0' + NL };
  const pngVazio = await ctx.verArquivoRemoto({ usuario: 'hugo', host: 'vps', chave: 'k' }, '~/prints/vazio.png');
  checa('(38) imagem de 0 byte tambem segue o ramo local (imagem sem carga), nao "outro"',
    pngVazio.tipo === 'imagem' && pngVazio.dados === 'data:image/png;base64,', JSON.stringify(pngVazio));

  // e o outro lado da moeda: pacote vazio com tamanho > 0 NAO e' arquivo vazio
  respostaFalsa = { out: 'COCKPIT_TAM 12' + NL };
  const mudo = await ctx.verArquivoRemoto({ usuario: 'hugo', host: 'vps', chave: 'k' }, '~/tem-coisa.txt');
  checa('(38) pacote vazio com tamanho > 0 continua "outro" (nao inventa arquivo vazio)',
    mudo.tipo === 'outro' && mudo.bytes === 12, JSON.stringify(mudo));

  respostaFalsa = { out: 'COCKPIT_TAM -1' + NL };
  const statFalhou = await ctx.verArquivoRemoto({ usuario: 'hugo', host: 'vps', chave: 'k' }, '~/proibido.txt');
  checa('(38) comando que falhou (stat -1) continua ERRO, e nao "arquivo vazio"',
    !!statFalhou.erro && !statFalhou.tipo, JSON.stringify(statFalhou));

  respostaFalsa = { out: '' };
  const nadaVeio = await ctx.verArquivoRemoto({ usuario: 'hugo', host: 'vps', chave: 'k' }, '~/x.txt');
  checa('(38) resposta que nem trouxe o tamanho tambem continua ERRO',
    !!nadaVeio.erro && !nadaVeio.tipo, JSON.stringify(nadaVeio));

  respostaFalsa = { out: 'COCKPIT_SEM_ARQUIVO' };
  const sumiu = await ctx.verArquivoRemoto({ usuario: 'hugo', host: 'vps', chave: 'k' }, '~/foi.txt');
  checa('arquivo que nao existe la diz isso (o visor mostra a frase)', !!sumiu.erro && /servidor/i.test(sumiu.erro));

  respostaFalsa = { error: 'O servidor (vps) não respondeu a tempo. Conexão lenta ou servidor ocupado.' };
  const visorCaiu = await ctx.verArquivoRemoto({ usuario: 'hugo', host: 'vps', chave: 'k' }, '~/x.txt');
  checa('e falha de conexao chega na tela com o motivo', !!visorCaiu.erro && /não respondeu a tempo/.test(visorCaiu.erro));

  checa('o til fica FORA das aspas (dentro delas o cd/cat procuraria uma pasta chamada "~")',
    ctx.qRemoto('~/a b.txt') === "~/'a b.txt'" && ctx.qRemoto('~') === '~' && ctx.qRemoto("/tmp/o'x") === "'/tmp/o'\\''x'");

  /* ---------- 5) cache ---------- */
  console.log(NL + '5) o cache do "@" separa os alvos');
  checa('dois servidores com "~" nao sao a mesma pasta',
    ctx.chaveDoCache({ usuario: 'hugo', host: 'vps1' }, '~') !== ctx.chaveDoCache({ usuario: 'hugo', host: 'vps2' }, '~'));
  checa('e nenhum deles e o "~" deste PC',
    ctx.chaveDoCache({ usuario: 'hugo', host: 'vps1' }, '~') !== ctx.chaveDoCache(null, '~')
    && ctx.chaveDoCache(null, '~').startsWith('local|'));

  /* ---------- 6) contratos que so o fonte mostra ---------- */
  console.log(NL + '6) contratos do fonte');
  const handler = (canal) => {
    const i = main.indexOf("ipcMain.handle('" + canal + "'");
    return i < 0 ? '' : main.slice(i, i + 700);
  };
  for (const canal of ['fs:list', 'fs:buscarArquivos', 'arquivo:ver']) {
    checa(canal + ': quem decide o remoto e a TELA, nao o claudeRemoto (que some no claudeStop)',
      handler(canal).includes('remotoDoPedido(') && !handler(canal).includes('claudeRemoto'));
  }
  checa('fs:list ainda aceita a forma antiga (string): o preload e superficie publica',
    /typeof d === 'object'\) \? d : \{ dir: d \}/.test(handler('fs:list')));
  checa('arquivo:ver ainda aceita a forma antiga (string)',
    /typeof f === 'object'\) \? f : \{ file: f \}/.test(handler('arquivo:ver')));
  checa('o ramo LOCAL do "@" continua devolvendo a lista crua, como sempre',
    /return rem \? \{ itens: achados \} : achados;/.test(main));

  const bloco = pegarBloco(main, 'function sshUmaVez(', 'sshUmaVez');
  checa('a conexao e reaproveitada (ControlMaster + ControlPath + ControlPersist)',
    /ControlMaster=auto/.test(bloco) && /ControlPath=/.test(bloco) && /ControlPersist=\d+/.test(bloco));
  // o socket de verdade: nome derivado do alvo, sem nada que o cmd.exe quebre
  const ctxS = { ...globaisFalsos(), path, crypto: require('crypto'), pastaSsh: () => '/tmp/ssh' };
  vm.createContext(ctxS);
  for (const f of ['function sockSeguro(', 'function caminhoDoSocket(']) vm.runInContext(pegarBloco(main, f, f), ctxS);
  const s1 = ctxS.caminhoDoSocket({ usuario: 'hugo', host: 'vps1' });
  const s2 = ctxS.caminhoDoSocket({ usuario: 'hugo', host: 'vps2' });
  checa('o nome do socket e um hash curto, so [a-z0-9_-]', /^cm-[a-f0-9]{16}$/.test(path.basename(s1)), path.basename(s1));
  checa('um socket por usuario@host (dois servidores nao dividem a conexao)', s1 !== s2);
  checa('e caminho curto, longe do teto de ~104 do socket', s1.length < 90, String(s1.length));
  ctxS.pastaSsh = () => 'C:\\Users\\a"b\\ssh';
  checa('caminho perigoso desliga o multiplexing em vez de arriscar a linha do cmd.exe',
    ctxS.caminhoDoSocket({ usuario: 'hugo', host: 'vps1' }) === ''
    && ctxS.sockSeguro('/tmp/ok/cm-1') === '/tmp/ok/cm-1' && ctxS.sockSeguro('/tmp/%VAR%/cm-1') === '');
  const exec = pegarBloco(main, 'async function execRemoto(', 'execRemoto');
  checa('se o multiplexing nao funcionar, cai no modo de hoje sem quebrar',
    /sshUmaVez\(alvo, script, timeout, false\)/.test(exec) && /desistirDoMux\(\)/.test(exec)
    && /muxEstado = false/.test(pegarBloco(main, 'function desistirDoMux(', 'desistirDoMux')));
  checa('e ao desistir volta pro ssh de sempre (o binario alternativo so vale se multiplexar)',
    /sshDeArquivo = 'ssh';/.test(pegarBloco(main, 'function desistirDoMux(', 'desistirDoMux'))
    && /const bin = sock \? sshDeArquivo : 'ssh';/.test(bloco));
  checa('a CONVERSA nunca troca de ssh: o claudeStart continua no spawnBin(\'ssh\')',
    pegarBloco(main, 'function claudeStart(', 'claudeStart').includes("spawnBin('ssh'")
    && !pegarBloco(main, 'function claudeStart(', 'claudeStart').includes('sshDeArquivo'));
  /* achado 2 da auditoria: "ssh -G" so' LE a configuracao -- nao testa
     multiplexing. O ssh do Windows respondia "controlmaster auto" e mesmo assim
     nao sabia multiplexar. A sonda agora NUNCA afirma que funciona: so' descarta
     quem comprovadamente nao sabe, e quem prova e' a primeira ida de verdade. */
  checa('a sonda roda UMA vez e nao usa mais o "-G" como prova',
    /muxProbe\b/.test(main) && !/'-G'/.test(main));
  checa('a sonda exercita o CLIENTE de multiplexing (ssh -O check), nao a configuracao',
    /'-O', 'check'/.test(pegarBloco(main, 'async function sabeMultiplexar(', 'sabeMultiplexar')));
  checa('quem AFIRMA que da certo e a conexao de verdade, no execRemoto',
    /muxEstado = true; muxProvado = true;/.test(exec)
    && !/muxEstado = true/.test(pegarBloco(main, 'function muxDaConta(', 'muxDaConta')));

  /* ---------- 7) ACHADO da leva 38: a degradacao do mux vale SEMPRE ----------
     O execRemoto so' tentava de novo sem multiplexing enquanto ele nao tinha
     sido "provado". Depois da primeira ida boa nao havia mais volta: mestre
     morto ou socket vencido no meio da sessao derrubava arvore, "@" e visor ate'
     reiniciar o app. Inerte nesta maquina (aqui nenhum ssh multiplexa), vivo no
     dia em que o Cockpit rodar em Mac/Linux -- entao o teste roda o execRemoto
     de verdade com um sshUmaVez de mentira, que devolve o combinado. */
  console.log(NL + '7) o multiplexing degrada sempre, nao so antes da primeira prova');
  const ctxMux = { ...globaisFalsos(), console, Buffer };
  vm.createContext(ctxMux);
  const valorMux = (nome) => {
    const decl = 'const ' + nome + ' = ';
    const i = main.indexOf(decl);
    if (i < 0) throw new Error('nao achei ' + nome);
    return vm.runInContext('(' + main.slice(i + decl.length, main.indexOf(';', i + decl.length)) + ')', ctxMux);
  };
  for (const n of ['SSH_MUX_TORTO', 'SSH_ERRO_FECHADO', 'sshDeuCerto']) ctxMux[n] = valorMux(n);
  for (const f of ['function motivoDoSsh(', 'function ssgValido(', 'function normalizarRemoto(',
    'function erroDoSsh(', 'function podeSerCulpaDoMux(', 'async function execRemoto(']) {
    vm.runInContext(pegarBloco(main, f, f), ctxMux);
  }
  let idas = [];
  let respostas = [];
  let desistiu = 0;
  ctxMux.sshUmaVez = (_alvo, script, _t, comMux) => {
    idas.push({ comMux: !!comMux, script });
    return Promise.resolve(respostas.shift() || { falhou: true, errout: 'o teste nao combinou resposta pra esta ida' });
  };
  ctxMux.muxDaConta = () => Promise.resolve(ctxMux.muxEstado !== false);
  ctxMux.desistirDoMux = () => { desistiu++; ctxMux.muxEstado = false; };
  const alvoMux = { usuario: 'hugo', host: 'vps', chave: 'k', caminhoRemoto: '~' };
  const cena = (estado, provado) => { ctxMux.muxEstado = estado; ctxMux.muxProvado = provado; ctxMux.muxSustos = 0; idas = []; desistiu = 0; };

  // 1) mux JA PROVADO e o mestre morre no meio da sessao
  cena(true, true);
  respostas = [{ code: 255, out: '', errout: 'mux_client_request_session: send fds failed' },
    { code: 0, out: 'a arvore do servidor', errout: '' }];
  const morreu = await ctxMux.execRemoto(alvoMux, 'ls', 1000);
  checa('(38) mestre morto DEPOIS de provado ainda cai no modo simples, e a chamada passa',
    morreu.out === 'a arvore do servidor' && !morreu.error && idas.length === 2
    && idas[0].comMux === true && idas[1].comMux === false, JSON.stringify({ morreu, idas }));
  checa('(38) e o mux sai de cena pelo resto da sessao (desistirDoMux)',
    desistiu === 1 && ctxMux.muxEstado === false, desistiu + '/' + ctxMux.muxEstado);

  // 2) e a chamada seguinte ja nasce sem mux, com uma ida so
  idas = [];
  respostas = [{ code: 0, out: 'de novo', errout: '' }];
  const depois = await ctxMux.execRemoto(alvoMux, 'ls', 1000);
  checa('(38) depois de desistir, a proxima chamada ja vai direto sem mux',
    depois.out === 'de novo' && idas.length === 1 && idas[0].comMux === false, JSON.stringify(idas));

  // 3) erro fechado nao merece segunda conexao: a resposta seria a mesma
  cena(true, false);
  respostas = [{ code: 255, out: '', errout: 'hugo@vps: Permission denied (publickey).' },
    { code: 0, out: 'ESTA IDA NAO DEVIA EXISTIR', errout: '' }];
  const recusou = await ctxMux.execRemoto(alvoMux, 'ls', 1000);
  checa('(38) chave recusada nao vira retentativa (nao e culpa do mux)',
    idas.length === 1 && !!recusou.error && /chave/i.test(recusou.error), JSON.stringify({ recusou, idas }));

  // 4) o comando RODOU la e voltou com codigo proprio: o tunel funcionou
  cena(true, false);
  respostas = [{ code: 1, out: '', errout: 'bash: line 1: cd: /naoexiste: No such file or directory' },
    { code: 0, out: 'ESTA IDA NAO DEVIA EXISTIR', errout: '' }];
  const semPastaLa = await ctxMux.execRemoto(alvoMux, 'cd /naoexiste', 1000);
  checa('(38) pasta inexistente (codigo do proprio comando) tambem nao repete',
    idas.length === 1 && !!semPastaLa.error, JSON.stringify({ semPastaLa, idas }));

  // 5) falha ambigua: UMA volta e para ai -- nada de laco
  cena(true, true);
  respostas = [{ code: 255, out: '', errout: '' }, { code: 255, out: '', errout: '' },
    { code: 0, out: 'ESTA IDA NAO DEVIA EXISTIR', errout: '' }];
  const ambigua = await ctxMux.execRemoto(alvoMux, 'ls', 1000);
  checa('(38) falha ambigua tenta UMA vez sem mux e para (sem laco)',
    idas.length === 2 && !!ambigua.error, JSON.stringify({ ambigua, idas }));
  checa('(38) e com o mux ja provado a falha ambigua nao aposenta o que ja funcionou',
    desistiu === 0 && ctxMux.muxEstado === true && ctxMux.muxSustos === 0,
    desistiu + '/' + ctxMux.muxEstado + '/' + ctxMux.muxSustos);

  // 6) nesta maquina o mux nunca liga: tem que continuar exatamente como antes
  cena(false, false);
  respostas = [{ code: 0, out: 'sem mux nenhum', errout: '' }];
  const simples = await ctxMux.execRemoto(alvoMux, 'ls', 1000);
  checa('(38) com o mux desligado (o caso desta maquina) nada mudou: uma ida so, sem mux',
    simples.out === 'sem mux nenhum' && idas.length === 1 && idas[0].comMux === false, JSON.stringify(idas));

  console.log(NL + (falhas ? falhas + ' FALHA(S)' : 'o backend remoto de arquivos esta de pe'));
  process.exit(falhas ? 1 : 0);
}

main2().catch((e) => { console.log('FALHA geral: ' + (e && e.stack || e)); process.exit(1); });
