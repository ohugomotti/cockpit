/* ===================== LEITOR DO PROJETO (debate) =====================
   Servidor MCP SO' DE LEITURA que o Cockpit da' ao Codex no debate.

   Por que existe: no debate os dois motores LEEM o projeto do painel (decisao
   do Hugo, 14/09/2026). O Claude tem Read/Grep/Glob proprios. O Codex le pelo
   terminal -- e no Windows, com o sandbox "so' leitura" e o sandbox do Windows
   nao configurado, o Codex bloqueia TODO processo ("CreateProcess ... blocked by
   policy", medido em 14/09): ele nao consegue nem um `type arquivo`. Ligar o
   terminal sem sandbox de verdade deixaria ele escrever. Entao ele ganha estas
   tres ferramentas, que por construcao so' leem, e so' dentro da pasta do painel.

   Env que o Cockpit passa:
     COCKPIT_RAIZ   a pasta do painel (nada fora dela e' lido) */

'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const PULAR = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next', '.cache']);
const LIMITES = Object.freeze({ lista: 400, linhas: 2000, bytesLer: 200 * 1024, achados: 120, arquivosBusca: 6000, bytesBusca: 1024 * 1024 });

/* Segredo NUNCA e' lido, listado nem buscado (auditoria 1): o que o debate le
   vai pra OpenAI e pra Anthropic, e numa aba "PC inteiro" a pasta do painel e'
   a pessoal -- com ~/.ssh, ~/.claude/.credentials.json, ~/.codex... ao alcance.
   Vale pra qualquer pedaco do caminho, e pro caminho pedido E pro real (um
   atalho de nome inocente pra dentro de .ssh tambem e' barrado). */
/* auditoria 2: UMA lista so'. O leitor do Codex (aqui), o deny do Claude no
   debate (cockpit-debate-adapters.js, GLOBS_SEGREDO) e a pasta que o debate
   nao le (cockpit-debate.js pastaAmpla, PASTAS_DE_MOTOR) saem destas tres
   constantes -- antes o Claude so' negava id_rsa e o leitor negava as quatro. */
const PASTAS_SECRETAS_LISTA = ['.ssh', '.gnupg', '.aws', '.azure', '.claude', '.codex', '.gemini'];
const PARES_SECRETOS = [['.config', 'gcloud']];
const ARQUIVOS_SECRETOS = ['.env*', '*.pem', '*.key', 'id_rsa*', 'id_dsa*', 'id_ecdsa*', 'id_ed25519*', '.credentials*', '.git-credentials', '.npmrc', '.netrc'];
/* as contas dos motores: a RAIZ delas (~/.claude, ~/.codex, ~/.gemini) nao e'
   projeto -- o debate ali roda sem leitura. Uma subpasta (skills, worktree) le. */
const PASTAS_DE_MOTOR = ['.claude', '.codex', '.gemini'];
/* dentro dessas, so' estas subpastas contam como projeto. O resto (projects,
   sessions, history, logs, tmp...) guarda TODAS as conversas do Hugo: debate
   aberto ali mandaria o historico inteiro pra OpenAI e pra Anthropic. */
const SUBPASTAS_DE_MOTOR_LIVRES = ['skills', 'agents', 'commands', 'worktrees', 'hooks', 'scripts', 'plans', 'output-styles', 'prompts'];
const PASTAS_SECRETAS = new Set(PASTAS_SECRETAS_LISTA);
const globParaRe = (g) => g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
const ARQ_SECRETO = new RegExp('^(?:' + ARQUIVOS_SECRETOS.map(globParaRe).join('|') + ')$', 'i');
// no formato gitignore do Claude (as duas estrelas com barra = em qualquer nivel, relativo a' pasta)
const GLOBS_SEGREDO = Object.freeze([
  ...PASTAS_SECRETAS_LISTA.map((p) => '**/' + p + '/**'),
  ...PARES_SECRETOS.map((par) => '**/' + par.join('/') + '/**'),
  ...ARQUIVOS_SECRETOS.map((a) => '**/' + a),
]);
/* o caminho RELATIVO a' pasta do projeto (auditoria 2): olhar o absoluto cegava
   o debate numa pasta de projeto dentro de .claude (as skills do Hugo) ou num
   worktree em repo\.claude\worktrees\x -- e a tela dizia "Os dois leem". */
function sensivel(caminho) {
  const partes = String(caminho || '').split(/[\\/]+/).filter((p) => p && p !== '.');
  for (let i = 0; i < partes.length; i++) {
    const p = partes[i].toLowerCase();
    if (PASTAS_SECRETAS.has(p) || ARQ_SECRETO.test(partes[i])) return true;
    if (p === '.config' && String(partes[i + 1] || '').toLowerCase() === 'gcloud') return true;
  }
  return false;
}
const recusaSegredo = (rel) => new Error('Arquivo protegido (chaves, senhas ou contas): o debate não lê "' + rel + '".');

/* resolve dentro da raiz ou recusa. realpath nas duas pontas: um atalho
   (symlink/junction) dentro do projeto nao pode abrir a porta pra fora dele */
/* .native (auditoria 2): no Windows ele devolve o nome LONGO. O realpath do JS
   deixa o nome curto 8.3 como veio -- "ENV~1" e "CREDEN~1.JSO" passavam pelo
   bloqueio e abriam o .env e o .credentials.json. */
const realNativo = (p) => (fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p));
function dentro(raiz, rel) {
  const base = realNativo(raiz);
  const alvo = path.resolve(base, String(rel == null || rel === '' ? '.' : rel));
  if (sensivel(path.relative(base, alvo))) throw recusaSegredo(rel);
  let real;
  try { real = realNativo(alvo); } catch { throw new Error('Não achei "' + rel + '" dentro do projeto.'); }
  const r = path.relative(base, real);
  if (r.startsWith('..') || path.isAbsolute(r)) throw new Error('Fora do projeto: só leio dentro de ' + base);
  if (sensivel(r)) throw recusaSegredo(rel);
  return { base, real, rel: r.split(path.sep).join('/') || '.' };
}

function listar(raiz, pasta = '.', padrao = '') {
  const { base, real } = dentro(raiz, pasta);
  if (!fs.statSync(real).isDirectory()) throw new Error('"' + pasta + '" não é uma pasta.');
  const filtro = String(padrao || '').toLowerCase();
  const saida = []; let cortou = false;
  const fila = [real];
  while (fila.length && !cortou) {
    const atual = fila.shift();
    let itens; try { itens = fs.readdirSync(atual, { withFileTypes: true }); } catch { continue; }
    itens.sort((a, b) => a.name.localeCompare(b.name));
    for (const it of itens) {
      // atalho (symlink/junction) nao entra na varredura: pode apontar pra fora.
      // Segredo nem aparece na lista (auditoria 1)
      if (PULAR.has(it.name) || it.isSymbolicLink()) continue;
      const cheio = path.join(atual, it.name);
      const rel = path.relative(base, cheio).split(path.sep).join('/');
      if (sensivel(rel)) continue;   // o caminho todo: ".config/gcloud" so' e' segredo junto
      if (it.isDirectory()) { fila.push(cheio); if (!filtro) saida.push(rel + '/'); }
      else if (!filtro || rel.toLowerCase().includes(filtro)) saida.push(rel);
      if (saida.length >= LIMITES.lista) { cortou = true; break; }
    }
  }
  return saida.join('\n') + (cortou ? '\n… (lista cortada em ' + LIMITES.lista + ' itens; filtre com "padrao")' : '') || '(pasta vazia)';
}

function ler(raiz, caminho, linhaInicial = 1, linhas = LIMITES.linhas) {
  const { real, rel } = dentro(raiz, caminho);
  const st = fs.statSync(real);
  if (st.isDirectory()) throw new Error('"' + caminho + '" é uma pasta: use listar.');
  const buf = Buffer.alloc(Math.min(st.size, LIMITES.bytesLer));
  const fd = fs.openSync(real, 'r'); try { fs.readSync(fd, buf, 0, buf.length, 0); } finally { fs.closeSync(fd); }
  if (buf.includes(0)) throw new Error('"' + rel + '" parece binário; não leio.');
  const todas = buf.toString('utf8').split(/\r?\n/);
  const ini = Math.max(1, Math.floor(Number(linhaInicial) || 1));
  const qtd = Math.min(LIMITES.linhas, Math.max(1, Math.floor(Number(linhas) || LIMITES.linhas)));
  const trecho = todas.slice(ini - 1, ini - 1 + qtd).map((l, i) => String(ini + i).padStart(5) + '  ' + l);
  const aviso = st.size > LIMITES.bytesLer ? '\n… (arquivo tem ' + st.size + ' bytes; li só os primeiros ' + LIMITES.bytesLer + ')' : '';
  return rel + '\n' + trecho.join('\n') + aviso;
}

function buscar(raiz, texto, pasta = '.') {
  const agulha = String(texto || '').toLowerCase();
  if (!agulha) throw new Error('Diga o texto a buscar.');
  const { base, real } = dentro(raiz, pasta);
  const achados = []; let vistos = 0; const fila = [real];
  while (fila.length && achados.length < LIMITES.achados && vistos < LIMITES.arquivosBusca) {
    const atual = fila.shift();
    let st; try { st = fs.lstatSync(atual); } catch { continue; }
    if (st.isSymbolicLink()) continue;   // atalho pode apontar pra fora do projeto
    if (sensivel(path.relative(base, atual))) continue;   // segredo nao entra na busca (auditoria 1); relativo a' pasta (auditoria 2)
    if (st.isDirectory()) {
      let itens; try { itens = fs.readdirSync(atual); } catch { continue; }
      for (const n of itens.sort()) if (!PULAR.has(n) && !sensivel(n)) fila.push(path.join(atual, n));
      continue;
    }
    vistos++;
    if (st.size > LIMITES.bytesBusca) continue;
    let buf; try { buf = fs.readFileSync(atual); } catch { continue; }
    if (buf.includes(0)) continue;
    const rel = path.relative(base, atual).split(path.sep).join('/');
    const ls = buf.toString('utf8').split(/\r?\n/);
    for (let i = 0; i < ls.length && achados.length < LIMITES.achados; i++) {
      if (ls[i].toLowerCase().includes(agulha)) achados.push(rel + ':' + (i + 1) + ': ' + ls[i].trim().slice(0, 240));
    }
  }
  if (!achados.length) return 'Nada encontrado para "' + texto + '".';
  return achados.join('\n') + (achados.length >= LIMITES.achados ? '\n… (parei em ' + LIMITES.achados + ' achados)' : '');
}

const SO_LEITURA = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const FERRAMENTAS = [
  { name: 'listar', description: 'Lista arquivos e pastas do projeto (só leitura). "pasta" relativa à raiz do projeto; "padrao" filtra pelo nome.', annotations: SO_LEITURA,
    inputSchema: { type: 'object', properties: { pasta: { type: 'string' }, padrao: { type: 'string' } } } },
  { name: 'ler', description: 'Lê um arquivo de texto do projeto (só leitura), com número de linha. "caminho" relativo à raiz do projeto.', annotations: SO_LEITURA,
    inputSchema: { type: 'object', properties: { caminho: { type: 'string' }, linha_inicial: { type: 'integer' }, linhas: { type: 'integer' } }, required: ['caminho'] } },
  { name: 'buscar', description: 'Procura um texto (sem diferenciar maiúsculas) nos arquivos do projeto e devolve arquivo:linha: trecho (só leitura).', annotations: SO_LEITURA,
    inputSchema: { type: 'object', properties: { texto: { type: 'string' }, pasta: { type: 'string' } }, required: ['texto'] } },
];

function chamar(raiz, nome, a = {}) {
  if (nome === 'listar') return listar(raiz, a.pasta, a.padrao);
  if (nome === 'ler') return ler(raiz, a.caminho, a.linha_inicial, a.linhas);
  if (nome === 'buscar') return buscar(raiz, a.texto, a.pasta);
  throw new Error('ferramenta desconhecida: ' + nome);
}

module.exports = { listar, ler, buscar, chamar, sensivel, FERRAMENTAS, LIMITES, GLOBS_SEGREDO, PASTAS_DE_MOTOR, SUBPASTAS_DE_MOTOR_LIVRES, PASTAS_SECRETAS_LISTA, PARES_SECRETOS };

if (require.main === module) {
  const RAIZ = process.env.COCKPIT_RAIZ || '';
  const escrever = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (linha) => {
    let m; try { m = JSON.parse(linha); } catch { return; }
    if (m.method === 'initialize') {
      return escrever({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: (m.params && m.params.protocolVersion) || '2025-06-18',
        capabilities: { tools: {} }, serverInfo: { name: 'cockpit-leitura', version: '1.0.0' } } });
    }
    if (typeof m.method === 'string' && m.method.startsWith('notifications/')) return;
    if (m.method === 'tools/list') return escrever({ jsonrpc: '2.0', id: m.id, result: { tools: FERRAMENTAS } });
    if (m.method === 'tools/call') {
      try {
        if (!RAIZ) throw new Error('O Cockpit não disse qual é a pasta do projeto.');
        const texto = chamar(RAIZ, m.params && m.params.name, (m.params && m.params.arguments) || {});
        return escrever({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: texto }] } });
      } catch (e) {
        return escrever({ jsonrpc: '2.0', id: m.id, result: { isError: true, content: [{ type: 'text', text: String(e.message || e) }] } });
      }
    }
    if (m.id !== undefined) escrever({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'método não suportado: ' + m.method } });
  });
  process.on('disconnect', () => process.exit(0));
  rl.on('close', () => process.exit(0));
}
