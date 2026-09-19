'use strict';
/* Sessao Claude descartavel, com somente as duas pontes sob teste. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'artifacts', 'smoke-motores-claude.json');
const config = { mcpServers: {
  'chrome-logado': {
    command: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', 'C:\\Users\\hugom\\.claude\\chrome-logado\\chrome-mcp.ps1'],
  },
  'windows-mcp': {
    command: 'C:\\Users\\hugom\\Projetos-Codex\\cockpit-integracoes\\windows-mcp-0.8.5\\Scripts\\windows-mcp.exe',
    args: ['serve', '--transport', 'stdio', '--tools', 'App,Click,Move,Scroll,Shortcut,Snapshot,Screenshot,Type,Wait'],
    env: { ANONYMIZED_TELEMETRY: 'false', PYTHONUTF8: '1' },
  },
} };
const args = ['--print', '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
  '--strict-mcp-config', '--mcp-config', JSON.stringify(config), '--permission-mode', 'dontAsk',
  'Responda exatamente CLAUDE_SMOKE_OK sem usar ferramentas.'];
const proc = spawn('C:\\Users\\hugom\\.local\\bin\\claude.exe', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '', timedOut = false;
proc.stdout.on('data', c => { stdout += c.toString('utf8'); });
proc.stderr.on('data', c => { stderr += c.toString('utf8'); });
const timer = setTimeout(() => { timedOut = true; proc.kill(); }, 180000);
proc.on('close', code => {
  clearTimeout(timer);
  const messages = stdout.split(/\r?\n/).filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const init = messages.find(m => m.type === 'system' && m.subtype === 'init');
  const statuses = Array.isArray(init && init.mcp_servers) ? init.mcp_servers : [];
  const byName = Object.fromEntries(statuses.map(x => [x.name, x.status]));
  const resultText = messages.filter(m => m.type === 'result').map(m => m.result || '').join('');
  const artifact = {
    createdAt: new Date().toISOString(), claudeVersion: '2.1.263',
    isolated: { noSessionPersistence: true, strictMcpConfig: true },
    bridges: { 'chrome-logado': byName['chrome-logado'] || 'missing', 'windows-mcp': byName['windows-mcp'] || 'missing' },
    responseMarkerConfirmed: resultText.includes('CLAUDE_SMOKE_OK'), exitCode: code, timedOut,
    stderrSummary: stderr.trim().slice(0, 500),
  };
  artifact.passed = code === 0 && !timedOut && artifact.responseMarkerConfirmed
    && artifact.bridges['chrome-logado'] === 'connected' && artifact.bridges['windows-mcp'] === 'connected';
  fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(artifact, null, 2) + '\n');
  console.log(JSON.stringify(artifact, null, 2)); process.exitCode = artifact.passed ? 0 : 1;
});
