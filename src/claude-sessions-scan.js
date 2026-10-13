'use strict';
// Esta função também roda na VPS. Devolve fichas pequenas, nunca o texto inteiro.
async function scan(options = {}) {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  const readline = require('node:readline');
  const root = options.root || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
  const files = [], rows = new Map();
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { if (e.code === 'ENOENT') return; throw e; }
    for (const e of entries) {
      if (e.isSymbolicLink() || ['subagents', 'workflows'].includes(e.name)) continue;
      const file = path.join(dir, e.name);
      if (e.isDirectory()) walk(file);
      else if (e.isFile() && e.name.endsWith('.jsonl')) files.push(file);
    }
  }
  walk(root);
  // O cursor é o último arquivo visitado. Páginas sem conversas visíveis
  // também avançam: o filtro de robôs nunca encerra a varredura antes da hora.
  const paginado = options.pageSize != null;
  const pageSize = paginado ? Number(options.pageSize) : files.length;
  if (paginado && (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500)) throw new Error('Tamanho de página inválido.');
  if (options.cursor != null && typeof options.cursor !== 'string') throw new Error('Cursor inválido.');
  const restantes = files.sort().filter(file => !options.cursor || file > options.cursor);
  const pagina = paginado ? restantes.slice(0, pageSize) : restantes;
  function value(raw, key) {
    const matches = [...raw.matchAll(new RegExp('"' + key + '"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")', 'g'))];
    try { return matches.length ? JSON.parse(matches.at(-1)[1]) : ''; } catch { return ''; }
  }
  function plain(text) {
    let s = String(text || '');
    if (/^\s*(?:<system-reminder>|<local-command|<command-name>|Base directory for this skill:|# AGENTS\.md instructions|<environment_context>)/i.test(s)) return '';
    const at = s.indexOf('Agora, o novo pedido:');
    if (at >= 0) s = s.slice(at + 21);
    return s.replace(/\s+/g, ' ').trim();
  }
  for (const file of pagina) {
    const stat = fs.statSync(file);
    if (!stat.size) continue;
    const fd = fs.openSync(file, 'r');
    let head, tail;
    try {
      const n = Math.min(stat.size, 128 * 1024), first = Buffer.alloc(n), last = Buffer.alloc(n);
      head = first.toString('utf8', 0, fs.readSync(fd, first, 0, n, 0));
      tail = last.toString('utf8', 0, fs.readSync(fd, last, 0, n, Math.max(0, stat.size - n)));
    } finally { fs.closeSync(fd); }
    const entrada = value(head, 'entrypoint');
    if (!options.incluirRobos && ((entrada && !['claude-vscode', 'cockpit', 'cli', 'claude-code'].includes(entrada)) || /"isSidechain"\s*:\s*true/.test(head))) continue;
    let cwd = value(head, 'cwd'), pedido = '';
    const stream = fs.createReadStream(file, { encoding: 'utf8' });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        let d; try { d = JSON.parse(line); } catch { continue; }
        if (!cwd && d.cwd) cwd = d.cwd;
        if (d.type !== 'user' || d.isMeta || d.isSidechain) continue;
        const c = d.message?.content;
        const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x?.text || '').join(' ') : '';
        const clean = plain(text);
        if (!clean || clean.startsWith('/') || /^(?:oi|olá|ok|sim|continue|continua|segue)[.!\s]*$/i.test(clean)) continue;
        pedido = clean.slice(0, 2000); break;
      }
    } finally { lines.close(); stream.destroy(); }
    const id = path.basename(file, '.jsonl');
    const manual = value(tail, 'customTitle');
    const title = manual || value(tail, 'aiTitle') || pedido.slice(0, 120) || 'Conversa guardada';
    const row = { engine: 'claude', id, title, pedido, cwd, when: stat.mtimeMs, file: '', entrada, remoto: true, ...(manual ? { nome: manual } : {}) };
    if (!rows.has(id) || rows.get(id).when < row.when) rows.set(id, row);
  }
  const itens = [...rows.values()].sort((a, b) => b.when - a.when);
  return paginado ? { itens, nextCursor: restantes.length > pagina.length ? pagina.at(-1) : null } : itens;
}
const script = options => 'node -e ' + require('./cockpit-remote-transport').q('(' + scan.toString() + ')(' + JSON.stringify(options || {}) + ').then(r=>process.stdout.write(JSON.stringify(r))).catch(e=>{process.stderr.write(e.message);process.exitCode=1})');
module.exports = { scan, script };
