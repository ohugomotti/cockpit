// Aperto de mao do ACP com cada IA instalada (leva 5i, item 9).
//
// Para cada preset INSTALADO, um por vez:
//   1. sobe o comando pelo MESMO ajudante do app (plataforma.spawnBin: resolve .cmd/.bat sem shell solto) e com o mesmo ambiente (buildEnv),
//      mais as variaveis que o registro manda para aquele comando (so' o Droid);
//   2. manda o initialize do ACP (JSON-RPC 2.0 por stdio): {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{}}};
//   3. espera a resposta ate 30 s;
//   4. anota o agentInfo e os authMethods (como o agente diz que se entra);
//   5. encerra o processo (a arvore inteira).
//
// O QUE ESTE SCRIPT NUNCA FAZ: session/new, authenticate, prompt, nem nada que peca login, abra navegador ou gaste credito. So' o initialize.
// Os adaptadores que sobem por npx (Claude Code e Codex pelo Zed) ficam de fora: rodar baixaria e executaria um pacote do npm. --com-npx liga.
//
// Uso (SEMPRE pelo teto de memoria, como todo node de prova deste repositorio):
//   pwsh -NoProfile -File testes\com-teto.ps1 -Pasta <worktree> -Exe node -Linha 'tools\acp\aperto-de-mao.mjs' -PorProcessoMB 1024 -TotalMB 2048 -TempoSeg 600
// Opcoes: --so=opencode,goose (so' estes ids)  --prazo=30000 (ms por IA)  --com-npx  --json (so' o JSON, sem a tabela)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const plataforma = require(path.join(raiz, 'src', 'plataforma.js'));
const { comandoEmPartes } = require(path.join(raiz, 'src', 'acp.js'));
const IAS = require(path.join(raiz, 'src', 'renderer', 'acp-presets.js'));

const opcoes = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([\w-]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const PRAZO_MS = Math.max(1000, Number(opcoes.prazo) || 30000);
const SO = typeof opcoes.so === 'string' ? new Set(opcoes.so.split(',').map((s) => s.trim()).filter(Boolean)) : null;
const COM_NPX = !!opcoes['com-npx'];
const SO_JSON = !!opcoes.json;

const PEDIDO = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } };
const cortar = (s, n) => { const t = String(s == null ? '' : s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

function resumoDosMetodos(lista) {
  return (Array.isArray(lista) ? lista : []).map((a) => ({
    id: String((a && a.id) || ''), nome: String((a && (a.name || a.title)) || ''), tipo: String((a && a.type) || ''),
  })).filter((a) => a.id || a.nome);
}

async function apertoDeMao(preset) {
  const { bin, args } = comandoEmPartes(preset.comando);
  const base = { ia: preset.ia, nome: preset.nome, comando: preset.comando };
  const t0 = Date.now();
  // pasta vazia e descartavel: nenhum agente enxerga o repositorio nem escreve nele
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'aperto-acp-'));
  let proc = null;
  const limpar = () => {
    if (proc) { try { plataforma.matarProcesso(proc); } catch { /* ja morreu */ } }
    try { fs.rmSync(pasta, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* o Windows solta a pasta depois */ }
  };
  try {
    const env = { ...plataforma.buildEnv(), ...(preset.env || {}) };
    try { proc = plataforma.spawnBin(bin, args, { cwd: pasta, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); }
    catch (e) { return { ...base, estado: 'falhou', ms: Date.now() - t0, erro: 'nao subiu: ' + cortar(e && e.message || e, 200) }; }

    return await new Promise((resolve) => {
      let buf = '', erro = '', acabou = false, timer = null;
      const fim = (resultado) => {
        if (acabou) return;
        acabou = true; clearTimeout(timer);
        resolve({ ...base, ms: Date.now() - t0, ...resultado });
      };
      const linha = (texto) => {
        let m; try { m = JSON.parse(texto); } catch { return; }   // banner ou aviso fora do protocolo
        if (!m || typeof m !== 'object' || m.id !== PEDIDO.id || m.method !== undefined) return;
        if (m.error) return fim({ estado: 'falhou', erro: 'o agente respondeu erro: ' + cortar((m.error.message || JSON.stringify(m.error)) + (m.error.code != null ? ' (' + m.error.code + ')' : ''), 240) });
        const r = m.result || {}, info = r.agentInfo || {}, caps = r.agentCapabilities || {};
        fim({
          estado: 'respondeu',
          agentInfo: { nome: info.name || '', titulo: info.title || '', versao: info.version || '' },
          authMethods: resumoDosMetodos(r.authMethods),
          protocolVersion: r.protocolVersion == null ? null : r.protocolVersion,
          retomaConversa: !!caps.loadSession, aceitaImagem: !!(caps.promptCapabilities && caps.promptCapabilities.image),
        });
      };
      proc.stdout.on('data', (d) => {
        buf += d.toString('utf8');
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) linha(l); }
      });
      proc.stderr.on('data', (d) => { erro = (erro + d.toString('utf8')).slice(-1500); });
      proc.on('error', (e) => fim({ estado: 'falhou', erro: 'erro do processo: ' + cortar(e && e.message || e, 200) }));
      proc.on('close', (codigo) => fim({ estado: 'falhou', erro: 'o processo saiu (codigo ' + codigo + ') sem responder' + (erro ? ': ' + cortar(erro, 240) : '') }));
      proc.stdin.on('error', () => { /* o close/erro acima explica */ });
      timer = setTimeout(() => fim({ estado: 'falhou', erro: 'sem resposta em ' + Math.round(PRAZO_MS / 1000) + ' s' + (erro ? ' · stderr: ' + cortar(erro, 240) : '') }), PRAZO_MS);
      try { proc.stdin.write(JSON.stringify(PEDIDO) + '\n'); } catch { /* idem */ }
    });
  } finally { limpar(); }
}

const alvos = [];
const fora = [];
for (const preset of IAS.PRESETS) {
  if (SO && !SO.has(preset.ia)) continue;
  if (!COM_NPX && /^(npx|npm|pnpm|yarn|bunx)$/.test(preset.bin)) { fora.push({ ia: preset.ia, nome: preset.nome, comando: preset.comando, estado: 'nao-testado', erro: 'sobe por npx: rodar baixaria um pacote do npm (use --com-npx)' }); continue; }
  if (!plataforma.temBin(preset.bin)) { fora.push({ ia: preset.ia, nome: preset.nome, comando: preset.comando, estado: 'nao-instalado', erro: '"' + preset.bin + '" nao esta no PATH' }); continue; }
  alvos.push(preset);
}

const resultados = [];
for (const preset of alvos) {   // um por vez
  if (!SO_JSON) console.log('… ' + preset.nome + ' (' + preset.comando + ')');
  resultados.push(await apertoDeMao(preset));
}
const todos = [...resultados, ...fora];

if (!SO_JSON) {
  const coluna = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log('\n' + coluna('IA', 20) + coluna('estado', 12) + coluna('ms', 7) + coluna('agente (versao)', 34) + 'como se entra (authMethods) / erro');
  for (const r of todos) {
    const agente = r.agentInfo ? (r.agentInfo.titulo || r.agentInfo.nome || '?') + (r.agentInfo.versao ? ' ' + r.agentInfo.versao : '') : '';
    const login = r.estado === 'respondeu'
      ? (r.authMethods.length ? r.authMethods.map((a) => a.id + (a.nome && a.nome !== a.id ? ' (' + a.nome + ')' : '')).join(' | ') : 'nao anuncia login')
      : r.erro;
    console.log(coluna(r.ia, 20) + coluna(r.estado, 12) + coluna(r.ms == null ? '' : r.ms, 7) + coluna(agente, 34) + cortar(login, 200));
  }
  console.log('\nJSON:');
}
console.log(JSON.stringify(todos, null, 1));
// sem handle pendurado o processo ja' sai sozinho; este relogio (que nao segura o processo) so' dispara se alguma IA deixou um cano aberto
process.exitCode = 0;
setTimeout(() => process.exit(0), 3000).unref();
