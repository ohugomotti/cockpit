'use strict';
/* Mutirao dos nomes: da' o nome automatico as conversas que ficaram sem ele.

   O Cockpit da' nome as conversas que passam por ele (src/renderer/app.js:
   no envio do 1o pedido e no fim dos turnos). Tudo que foi conversado antes de
   a leva 41 existir - ou fora do Cockpit, no `claude` e no `codex` do terminal
   - ficou sem nome. Este script e' o mutirao de tras pra frente: varre o
   disco, acha o que esta' sem nome e pede o mesmo nome que a tela pediria.

   NAO faz parte do app: nada aqui e' empacotado, nada aqui e' chamado pelo
   main.js. E' ferramenta de terminal, rodada na mao pelo dono.

   Por que ele NAO escreve um prompt proprio: o nome tem que sair igualzinho
   ao que a tela produz. Entao quem gera e' o gerador do app (src/titulo-auto.js,
   gerarTitulo -> montarPedido/interpretarSaida, o mesmo pedido e a mesma
   validacao da tela), pelo executor unico do claude -p rapido
   (src/claude-rapido.js: pedido pelo stdin, ambiente limpo, so' com a
   assinatura -- nunca API paga), que o dependencias() monta. Aqui so' mora a
   parte que a tela nao tem: achar o arquivo, ler o 1o pedido e gravar.

   Cuidados de proposito:
   - o Cockpit pode estar ABERTO lendo/gravando o nomes.json. Por isso o arquivo
     e' relido do disco a cada lote antes de gravar (o que ele escreveu no meio
     do caminho nao se perde) e a gravacao e' arquivo temporario + rename.
   - nome que VOCE deu mora na raiz do nomes.json e nunca e' tocado: este script
     so' escreve em "_auto", e ainda pula a conversa que ja tem nome seu.
   - 2 de cada vez e uma pausa entre os lotes: e' cota de verdade sendo gasta.
   - 5 erros seguidos e ele para sozinho, em vez de insistir contra rate limit.

   Uso:
     node tools/nomes/mutirao.js --simular        (nao chama modelo, nao grava)
     node tools/nomes/mutirao.js --dias 7 --limite 50
*/

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const T = require('../../src/titulo-auto');
const { criarClaudeRapido } = require('../../src/claude-rapido');
const plat = require('../../src/plataforma');

const DIAS_PADRAO = 7;
const JUNTOS = 2;              // no maximo 2 Haikus no ar (igual ao MAX_JUNTOS do app)
const PAUSA_MS = 1500;         // respiro entre lotes: a cota e' compartilhada com o Cockpit aberto
const ERROS_SEGUIDOS = 5;      // rate limit: para de bater na porta
const LIMITE_LINHAS = 20000;   // conversa gigante: se o 1o pedido humano nao apareceu ate' aqui, desiste
const PULAR_PASTA = new Set(['subagents', 'workflows']);   // igual ao main.js: agente interno nao e' conversa sua

/* ------------------------------------------------------------------ */
/* leitura dos arquivos                                                */
/* ------------------------------------------------------------------ */

/* Mesma lista FECHADA do main.js (const TECNICO), mais tres casos que so'
   aparecem no arquivo do Codex e que a tela nunca ve porque nao sao mensagem
   sua: o contexto que o app-server injeta, o cabecalho de arquivo colado e o
   sub-agente "guardian", que o proprio Codex sobe pra avaliar permissao e que
   nasce com originator "cockpit" (medido: 77 das 87 threads que o Cockpit abriu
   neste PC sao isso). Sem esse filtro o mutirao batizaria robo.
   O guardian e o cabecalho de arquivo mencionado NAO ficam copiados aqui: os
   padroes moram no titulo-auto.js (T.FALA_*), o mesmo que o main.js le (Task
   11b). O main.js so' pula o guardian; do arquivo mencionado ele tira so' o
   cabecalho, porque o pedido vem junto no mesmo turno. Aqui a fala inteira
   continua sendo pulada, como sempre foi. */
const TECNICO = /<recommended_plugins>|<environment_context>|<user_instructions>|<system-reminder>|<available_tools>|<plugins>|<workspace_roots>|<INSTRUCTIONS>|^Caveat:|^Responda (apenas|exatamente) COCKPIT_|^# AGENTS\.md instructions for|^<(task-notification|local-command-stdout|local-command-stderr|command-name|command-message|command-args|bash-input|bash-stdout|bash-stderr)>/i;
const ehTecnico = (t) => {
  if (!t) return true;
  const s = String(t).trim().slice(0, 400);
  return TECNICO.test(s) || T.FALA_SUBAGENTE_CODEX.test(s) || T.FALA_ARQUIVOS_CODEX.test(s);
};

/* Conversa que nao e' de gente: o proprio Cockpit conferindo se o app subiu
   ("Responda apenas COCKPIT_111_OK") e o `codex exec` das tarefas agendadas
   (radar diario). Sao dezenas por semana e nenhuma e' uma demanda sua - pagar
   Haiku pra batizar robo e' torrar cota a toa. O `--robos` inclui assim mesmo.
   Deny-list, nao allow-list, de proposito: o allow-list do main.js
   (ORIGENS_DE_GENTE) deixaria de fora o "Codex Desktop", que e' voce. */
const ROBO = /^(cockpit-smoke|cockpit-safe-smoke|codex[-_]exec|cockpit-robo)$/i;

/* igual ao semContexto do main.js: o que foi GRAVADO no arquivo leva o enfeite
   que o Cockpit montou (contexto da troca de motor, lista de anexos). A tela
   manda pro Haiku so' o que voce digitou - aqui a gente desfaz o enfeite pra
   pedir a mesma coisa. */
function semContexto(t) {
  if (!t) return t;
  const i = t.indexOf('Agora, o novo pedido:');
  if (i >= 0) return t.slice(i + 'Agora, o novo pedido:'.length).trim();
  const j = t.indexOf('Arquivos que anexei');
  if (j > 0) return t.slice(0, j).trim();
  return t;
}

/* Copia fiel da regra da tela (soComandoOuContinue em app.js). "/compact" e
   "continue" nao sao demanda: nao viram nome nem la' nem aqui.
   Ha um teste que compara as duas, pra elas nao se soltarem uma da outra. */
function soComandoOuContinue(texto) {
  const t = String(texto || '').trim();
  if (!t) return true;
  if (t.startsWith('/')) return true;
  return /^(continue|continua|continuar|prossiga|segue)[\s.!…]*$/i.test(t);
}

/* Claude: content e' string OU lista de blocos. So' o bloco 'text' e' fala sua -
   'tool_result' e 'image' entram na mesma lista e nao podem virar titulo. */
function textoClaude(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter((x) => x && x.type === 'text').map((x) => x.text || '').join(' ').trim();
}
/* Codex: content e' lista de { type: 'input_text' | 'text', text }. */
function textoCodex(content) {
  if (!Array.isArray(content)) return '';
  return content.map((x) => (x && typeof x.text === 'string' ? x.text : '')).join(' ').trim();
}

/* Os dois formatos NAO se parecem, entao cada motor tem seu leitor.

   Claude (.claude/projects/<pasta>/<uuid>.jsonl): uma linha por evento, a fala
   sua e' { type:'user', message:{ role:'user', content } }. isSidechain marca
   fala de sub-agente e isMeta marca o "Continue from where you left off." que o
   proprio CLI injeta - nenhum dos dois e' voce. O id da conversa vem no campo
   sessionId (e o nome do arquivo e' ele, serve de reserva).

   Codex (.codex/sessions/AAAA/MM/DD/rollout-<data>-<uuid>.jsonl): a 1a linha e'
   { type:'session_meta', payload:{ id, session_id, originator } } - conferido
   neste PC: esse id e' o MESMO do nome do arquivo e o MESMO da tabela `threads`
   do proprio Codex, entao serve de chave no nomes.json. A fala sua e'
   { type:'response_item', payload:{ type:'message', role:'user', content } },
   e as primeiras costumam ser contexto injetado (ver TECNICO). */
function criarLeitor(motor) {
  let id = '', prompt = '', origem = '', linhas = 0;
  const aceitar = (linha) => {
    if (++linhas > LIMITE_LINHAS) return true;      // desiste: resultado() devolve prompt vazio
    if (!linha || linha.charCodeAt(0) !== 123) return false;
    let d; try { d = JSON.parse(linha); } catch { return false; }
    if (motor === 'codex') {
      if (d.type === 'session_meta') {
        const p = d.payload || {};
        if (!id) id = String(p.id || p.session_id || '');
        origem = String(p.originator || p.source || '');
        return false;
      }
      const p = d.type === 'response_item' ? (d.payload || {}) : null;
      if (!p || p.type !== 'message' || p.role !== 'user') return false;
      const t = semContexto(textoCodex(p.content));
      if (t && !ehTecnico(t)) { prompt = t; return true; }
      return false;
    }
    if (!id && d.sessionId) id = String(d.sessionId);
    if (!origem && d.entrypoint) origem = String(d.entrypoint);
    if (d.type !== 'user' || d.isSidechain === true || d.isMeta === true) return false;
    const t = semContexto(textoClaude(d.message && d.message.content));
    if (t && !ehTecnico(t)) { prompt = t; return true; }
    return false;
  };
  return { aceitar, resultado: () => ({ id, prompt, origem }) };
}

/* Le linha a linha e PARA no 1o pedido humano. Conversa de 40 MB e' comum aqui;
   ler o arquivo inteiro na memoria pra pegar a 1a mensagem seria desperdicio. */
function lerConversa(arquivo, motor) {
  return new Promise((ok) => {
    const leitor = criarLeitor(motor);
    let fluxo;
    try { fluxo = fs.createReadStream(arquivo, { encoding: 'utf8' }); } catch { return ok(leitor.resultado()); }
    const rl = readline.createInterface({ input: fluxo, crlfDelay: Infinity });
    const fim = () => { try { rl.close(); } catch {} try { fluxo.destroy(); } catch {} ok(leitor.resultado()); };
    rl.on('line', (l) => { if (leitor.aceitar(l)) fim(); });
    rl.on('close', () => ok(leitor.resultado()));
    fluxo.on('error', () => ok(leitor.resultado()));
  });
}

/* varredura igual a do main.js (varrerConversas): pula pasta de agente interno,
   nao desce demais e ignora arquivo minusculo (conversa que nem comecou). */
function varrer(dir, achados, nivel, motor) {
  let itens = [];
  try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return achados; }
  for (const e of itens) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (PULAR_PASTA.has(e.name) || (nivel || 0) > 4) continue;
      varrer(p, achados, (nivel || 0) + 1, motor);
    } else if (e.name.endsWith('.jsonl')) {
      try {
        const st = fs.statSync(p);
        if (st.size > 300) achados.push({ arquivo: p, mtime: st.mtimeMs, motor, idArquivo: idDoNome(e.name, motor) });
      } catch {}
    }
  }
  return achados;
}

/* id de reserva, tirado do nome do arquivo: no Claude o arquivo E' o uuid; no
   Codex o nome e' "rollout-<data>-<uuid>". So' entra em cena se o miolo do
   arquivo nao trouxer o id. */
function idDoNome(nome, motor) {
  const base = nome.replace(/\.jsonl$/, '');
  if (motor === 'claude') return base;
  const m = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1] : base;
}

/* ------------------------------------------------------------------ */
/* nomes.json                                                          */
/* ------------------------------------------------------------------ */

function caminhoNomes(o) {
  if (o && o.nomes) return o.nomes;
  const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(base, 'cockpit', 'nomes.json');
}
/* Rodada 2 da leva 5: como o lerNomesSeguro do main.js. Sem arquivo = nenhum nome ainda ({}). Arquivo que existe mas nao abre
   como objeto (vazio, zeros ou pela metade de uma queda; preso; uma pasta no lugar) = null, e quem grava recusa: com o {} de
   antes o lote gravava so' os nomes novos e o gravarSeguro copiava o arquivo estragado por cima do .bak (os nomes seus sumiam). */
function lerNomes(arq) {
  let v;
  try { v = JSON.parse(fs.readFileSync(arq, 'utf8')); } catch (e) { return e && e.code === 'ENOENT' ? {} : null; }
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}
/* mesmo cuidado do gravarSeguro do main.js: escreve no .tmp, guarda um .bak e
   so' entao troca por rename. O Cockpit pode estar lendo o arquivo neste
   instante - rename e' atomico, leitura pega ou o velho inteiro ou o novo
   inteiro, nunca um arquivo pela metade. */
function gravarSeguro(destino, texto) {
  const tmp = destino + '.tmp';
  try {
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    // rodada 2 da leva 5: o arquivo que existe mas nao abre como objeto nao e' trocado nem vira .bak (a copia boa fica)
    const existe = fs.existsSync(destino);
    if (existe && !lerNomes(destino)) return false;
    fs.writeFileSync(tmp, texto);
    try { if (existe) fs.copyFileSync(destino, destino + '.bak'); } catch {}
    fs.renameSync(tmp, destino);
    return true;
  } catch { try { fs.unlinkSync(tmp); } catch {} return false; }
}

/* ------------------------------------------------------------------ */
/* escolha do que nomear                                               */
/* ------------------------------------------------------------------ */

/* Fica de fora: o que foi mexido ha' mais de N dias, o que ja tem nome (seu na
   raiz OU automatico em "_auto") e o que nao tem id. O resto vira candidato, do
   mais recente pro mais antigo - se o --limite cortar, corta o mais velho. */
function escolher(achados, nomes, agora, dias) {
  const corte = agora - dias * 24 * 60 * 60 * 1000;
  const fora = [];
  const dentro = [];
  for (const a of achados) {
    const id = a.id || a.idArquivo;
    if (a.mtime < corte) { fora.push({ ...a, porque: 'velha' }); continue; }
    if (!id) { fora.push({ ...a, porque: 'sem-id' }); continue; }
    const n = T.nomeDaConversa(nomes, id);
    if (n.nome) { fora.push({ ...a, id, porque: n.manual ? 'ja-tem-nome-seu' : 'ja-tem-nome-auto' }); continue; }
    dentro.push({ ...a, id });
  }
  dentro.sort((x, y) => y.mtime - x.mtime);
  return { dentro, fora };
}

/* ------------------------------------------------------------------ */
/* o gerador (o MESMO do app)                                          */
/* ------------------------------------------------------------------ */

/* Tarefa 6 (27/09): o executor unico do claude -p rapido, montado pro mutirao
   (e' outro processo, de terminal: a instancia do app mora no main.js). O
   mesmo claude que o app acha, o mesmo ambiente (que o executor limpa de API
   paga) e o settings dele na pasta do app (a do nomes.json, ou pastaSettings).
   So' roda com a conta de assinatura. */
function dependencias(pastaSettings) {
  const pasta = pastaSettings || path.dirname(caminhoNomes());
  return {
    claudeRapido: criarClaudeRapido({
      acharBin: (nome) => (plat.EH_WIN ? plat.acharBin(nome) : path.join(plat.HOME, '.local/bin', nome)),
      spawn: plat.spawnBin,
      buildEnv: plat.buildEnv,
      pastaDados: () => pasta,
    }),
  };
}

/* motivo que o gerador devolve quando a CULPA e' de fora (conta que nao e'
   assinatura ou deslogada, cota, rede, prazo, Claude que nao subiu).
   "resposta-torta", "sem-assunto", "sem-pedido" e "vazio" nao entram: o
   modelo respondeu (ou nem havia o que nomear), so' nao deu nome - isso e'
   pular, nao e' erro, e nao pode derrubar o mutirao. */
const ERROS_DE_FORA = ['motor', 'prazo', 'sem-claude', 'formato', 'erro', 'falhou', 'sem-login', 'conta-api', 'conta-desconhecida'];
const ehErro = (motivo) => ERROS_DE_FORA.includes(motivo) || /^codigo-/.test(String(motivo || ''));

/* ------------------------------------------------------------------ */
/* o mutirao                                                           */
/* ------------------------------------------------------------------ */

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const curto = (p) => String(p).split(/[\\/]/).slice(-2).join('/');

async function mutirao(o) {
  const op = o || {};
  const fala = op.fala || ((s) => process.stdout.write(s + '\n'));
  const agora = op.agora || Date.now();
  const dias = op.dias || DIAS_PADRAO;
  const arqNomes = caminhoNomes(op);
  const t0 = Date.now();

  const raizClaude = op.claude || path.join(os.homedir(), '.claude', 'projects');
  const raizCodex = op.codex || path.join(os.homedir(), '.codex', 'sessions');

  const achados = [];
  varrer(raizClaude, achados, 0, 'claude');
  varrer(raizCodex, achados, 0, 'codex');

  const nomes = lerNomes(arqNomes);
  if (!nomes) {   // rodada 2 da leva 5: existe mas nao abre; o Cockpit le a copia (.bak) e aqui nada e' gravado
    fala('O nomes.json existe mas nao abriu (vazio, pela metade ou preso): nada foi feito, para nao apagar os nomes que voce deu.');
    return { nomeadas: 0, puladas: 0, erros: 0, parou: true, pauta: [] };
  }
  let { dentro, fora } = escolher(achados, nomes, agora, dias);
  fala('Conversas no disco: ' + achados.length
    + ' | dos ultimos ' + dias + ' dias e sem nome: ' + dentro.length
    + ' | ja com nome: ' + fora.filter((f) => f.porque.startsWith('ja-tem')).length);
  if (op.limite) dentro = dentro.slice(0, op.limite);

  /* le o 1o pedido ANTES de chamar o modelo: assim o --simular mostra o que
     seria mandado, e o que nao tem pedido humano nem gasta vaga no lote */
  const pauta = [];
  let puladas = 0;
  for (const a of dentro) {
    const { id, prompt, origem } = await lerConversa(a.arquivo, a.motor);
    const chave = id || a.id;
    if (!chave) { puladas++; continue; }
    // o id de dentro do arquivo pode desmentir o do nome: revalida o "ja tem nome"
    if (T.nomeDaConversa(nomes, chave).nome) { puladas++; continue; }
    if (!op.robos && ROBO.test(origem || '')) { puladas++; continue; }
    // saudacao, teste de conexao e mensagem de skill tambem nao viram nome (a mesma regra da tela)
    if (!prompt || soComandoOuContinue(prompt) || !T.ehPedidoNomeavel(prompt)) { puladas++; continue; }
    pauta.push({ ...a, id: chave, prompt });
  }
  fala('Com 1o pedido de gente: ' + pauta.length + ' | puladas na leitura: ' + puladas);

  if (op.simular) {
    for (const p of pauta) {
      fala('  [' + p.motor + '] ' + curto(p.arquivo) + '\n      id ' + p.id
        + '\n      -> ' + JSON.stringify(p.prompt.replace(/\s+/g, ' ').slice(0, 96)));
    }
    fala('\nSIMULACAO: nenhum modelo foi chamado e o nomes.json nao foi tocado.');
    fala('Nomearia: ' + pauta.length + ' | pularia: ' + (puladas + (dentro.length - pauta.length - puladas))
      + ' | tempo: ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
    return { nomeadas: 0, puladas, simuladas: pauta.length, erros: 0, parou: false, pauta };
  }

  const dep = op.dep || dependencias(op.pastaSettings);
  const gerar = op.gerar || ((texto) => T.gerarTitulo(texto, dep));
  let nomeadas = 0, erros = 0, seguidos = 0, parou = false;

  for (let i = 0; i < pauta.length && !parou; i += JUNTOS) {
    const lote = pauta.slice(i, i + JUNTOS);
    const rs = await Promise.all(lote.map((p) => gerar(p.prompt).catch(() => ({ titulo: '', motivo: 'erro' }))));
    // relido do disco a cada lote: o Cockpit aberto pode ter gravado no meio
    const atuais = lerNomes(arqNomes);
    if (!atuais) {   // rodada 2 da leva 5: existe mas nao abre (preso, ou estragado no meio): para sem gravar, os nomes seus ficam
      parou = true;
      fala('\nParei: o nomes.json nao abriu neste lote (preso ou estragado). Nada deste lote foi gravado; rode de novo daqui a pouco.');
      break;
    }
    let mudou = false;
    for (let k = 0; k < lote.length; k++) {
      const p = lote[k], r = rs[k] || {};
      const pos = i + k + 1;
      if (r.titulo) {
        // ultima checagem: nome SEU que chegou enquanto isto rodava nao e' atropelado
        if (T.nomeDaConversa(atuais, p.id).manual) { puladas++; fala('[' + pos + '/' + pauta.length + '] pulada (ganhou nome seu agora): ' + curto(p.arquivo)); continue; }
        T.gravarNomeAuto(atuais, p.id, r.titulo);
        mudou = true; nomeadas++; seguidos = 0;
        fala('[' + pos + '/' + pauta.length + '] ' + p.motor + ' ' + curto(p.arquivo) + ' -> "' + r.titulo + '" (' + r.ms + 'ms)');
      } else if (ehErro(r.motivo)) {
        erros++; seguidos++;
        fala('[' + pos + '/' + pauta.length + '] ERRO (' + r.motivo + ') ' + curto(p.arquivo));
      } else {
        puladas++; seguidos = 0;
        fala('[' + pos + '/' + pauta.length + '] pulada (' + (r.motivo || 'sem titulo') + ') ' + curto(p.arquivo));
      }
    }
    if (mudou) {
      if (!gravarSeguro(arqNomes, JSON.stringify(atuais))) fala('  !! nao consegui gravar o nomes.json neste lote');
    }
    if (seguidos >= ERROS_SEGUIDOS) {
      parou = true;
      fala('\nParei sozinho: ' + seguidos + ' erros seguidos. Costuma ser cota/rate limit - tente mais tarde.');
      break;
    }
    if (i + JUNTOS < pauta.length) await espera(op.pausaMs != null ? op.pausaMs : PAUSA_MS);
  }

  const seg = ((Date.now() - t0) / 1000).toFixed(1);
  fala('\nNomeadas: ' + nomeadas + ' | puladas: ' + puladas + ' | erros: ' + erros + ' | tempo: ' + seg + 's');
  fala('Arquivo: ' + arqNomes);
  return { nomeadas, puladas, erros, parou, pauta };
}

/* ------------------------------------------------------------------ */

function lerArgumentos(argv) {
  const o = { simular: false };
  const lista = argv || [];
  for (let i = 0; i < lista.length; i++) {
    const a = lista[i];
    if (a === '--simular' || a === '--dry-run') o.simular = true;
    else if (a === '--dias') o.dias = Number(lista[++i]) || DIAS_PADRAO;
    else if (a === '--limite') o.limite = Number(lista[++i]) || 0;
    else if (a === '--nomes') o.nomes = lista[++i];
    else if (a === '--claude') o.claude = lista[++i];
    else if (a === '--codex') o.codex = lista[++i];
    else if (a === '--pausa') o.pausaMs = Number(lista[++i]) || 0;
    else if (a === '--robos') o.robos = true;
    else if (a === '--help' || a === '-h' || a === '--ajuda') o.ajuda = true;
  }
  return o;
}

/* --help so' mostra isto: antes, uma bandeira que ele nao conhecia caia no
   mutirao de verdade (chama o modelo e grava o nomes.json). */
const USO = [
  'Mutirao dos nomes: da o nome automatico as conversas do disco que ficaram sem nome.',
  'Uso:',
  '  node tools/nomes/mutirao.js --simular            (nao chama modelo, nao grava)',
  '  node tools/nomes/mutirao.js --dias 7 --limite 50',
  'Bandeiras: --simular, --dias N, --limite N, --nomes <nomes.json>, --claude <pasta>, --codex <pasta>, --pausa <ms>, --robos, --help',
].join('\n');

module.exports = {
  DIAS_PADRAO, JUNTOS, PAUSA_MS, ERROS_SEGUIDOS, USO,
  ROBO, ehTecnico, semContexto, soComandoOuContinue, textoClaude, textoCodex,
  criarLeitor, lerConversa, varrer, idDoNome,
  caminhoNomes, lerNomes, gravarSeguro, escolher, ehErro, dependencias,
  lerArgumentos, mutirao,
};

if (require.main === module) {
  const o = lerArgumentos(process.argv.slice(2));
  if (o.ajuda) process.stdout.write(USO + '\n');
  else {
    mutirao(o).then((r) => { process.exitCode = r.parou ? 1 : 0; })
      .catch((e) => { console.error('mutirao: ' + (e && e.message || e)); process.exitCode = 1; });
  }
}
