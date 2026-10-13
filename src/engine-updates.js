'use strict';

// Atualizações locais do Windows. Nenhuma chamada a modelos, contas ou VPS.
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const VERSION = /^\d+\.\d+\.\d+$/;
function versionOf(text) {
  return String(text || '').match(/\b(\d+\.\d+\.\d+)(?![\d.-])/)?.[1] || '';
}
function newer(a, b) {
  if (!VERSION.test(a || '') || !VERSION.test(b || '')) return false;
  const aa = a.split('.').map(Number), bb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (aa[i] !== bb[i]) return aa[i] > bb[i]; }
  return false;
}
function fault(code, message) { const error = new Error(message || code); error.code = code; return error; }
function cancelled(signal) { if (signal?.aborted) throw fault('cancelled'); }
async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
async function json(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.pending';
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
  await fs.rename(temporary, file);
}

function createRunner({ spawnBin, stopProcess, env }) {
  return (bin, args, { timeout = 15000, signal, cwd = os.homedir(), onSpawn } = {}) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(fault('cancelled'));
    let child, stdout = '', stderr = '', finished = false, reason = null, timer;
    const finish = error => {
      if (finished) return;
      finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve({ stdout, stderr });
    };
    const abort = () => { reason = fault(signal?.aborted ? 'cancelled' : 'timeout'); if (child) stopProcess(child); };
    try {
      child = spawnBin(bin, args, { cwd, env: env(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout?.on('data', chunk => { if (stdout.length < 128 * 1024) stdout += chunk.toString(); });
      child.stderr?.on('data', chunk => { if (stderr.length < 128 * 1024) stderr += chunk.toString(); });
      child.on('error', error => finish(reason || fault('command', error.message)));
      child.on('close', code => finish(reason || (code ? fault('command', 'O comando encerrou com código ' + code) : null)));
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(abort, timeout);
      try { onSpawn?.(child.pid); }
      catch { reason = fault('journal'); stopProcess(child); }
      if (signal?.aborted) abort();
    } catch (error) { finish(fault('command', error.message)); }
  });
}

function createWindowsBackend({ directory, findBin, run, activeCodex }) {
  const rootDir = () => path.resolve(directory());
  const journalFile = () => path.join(rootDir(), 'codex-recovery.json');
  const commands = ['--no-audit', '--no-fund', '--ignore-scripts', '--include=optional', '--fetch-retries=0', '--fetch-timeout=15000'];
  const view = async (spec, field, signal) => {
    const result = await run('npm', ['view', spec, field, '--json', '--fetch-retries=0', '--fetch-timeout=6000'], { signal, timeout: 10000 });
    return JSON.parse(result.stdout.trim());
  };
  const version = async (engine, signal) => {
    const result = await run(findBin(engine), ['--version'], { signal, timeout: 8000 });
    const value = versionOf(result.stdout + ' ' + result.stderr);
    if (!value) throw fault('invalid-version');
    return value;
  };
  const busy = activeCodex || (async signal => {
    const script = "$p = @(Get-Process -Name codex,codex-app-server,codex-code-mode-host -ErrorAction SilentlyContinue); Write-Output $p.Count; exit 0";
    const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { signal, timeout: 10000 });
    if (!/^\d+$/.test(result.stdout.trim())) throw fault('process-check');
    return Number(result.stdout.trim()) > 0;
  });
  async function context(signal, recovery = false) {
    const result = await run('npm', ['prefix', '-g'], { signal, timeout: 8000 });
    const prefix = result.stdout.trim();
    if (!path.isAbsolute(prefix)) throw fault('unsupported');
    const packageRoot = path.join(prefix, 'node_modules', '@openai', 'codex');
    if (recovery) return { prefix, packageRoot };
    const command = path.resolve(findBin('codex')).toLowerCase();
    if (command !== path.resolve(prefix, 'codex.cmd').toLowerCase()) throw fault('unsupported');
    const stat = await fs.lstat(packageRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw fault('unsupported');
    const info = await json(path.join(packageRoot, 'package.json'));
    if (info.name !== '@openai/codex') throw fault('unsupported');
    return { prefix, packageRoot };
  }
  async function verifyPackage(packageRoot, wanted, signal) {
    const info = await json(path.join(packageRoot, 'package.json'));
    if (info.name !== '@openai/codex' || info.version !== wanted) throw fault('verification');
    const entry = path.join(packageRoot, 'bin', 'codex.js');
    const result = await run('node', [entry, '--version'], { signal, timeout: 10000 });
    if (versionOf(result.stdout) !== wanted) throw fault('verification');
    await run('node', [entry, 'app-server', '--help'], { signal, timeout: 10000 });
  }
  async function verifyInstalled(ctx, wanted, signal) {
    await verifyPackage(ctx.packageRoot, wanted, signal);
    if (await version('codex', signal) !== wanted) throw fault('verification');
  }
  function pathsFor(id) {
    if (!/^[a-f0-9]{32}$/.test(id || '')) throw fault('recovery');
    return { stage: path.join(rootDir(), 'stage-' + id), backup: path.join(rootDir(), 'backup-' + id) };
  }
  async function cleanup(id) {
    const locations = pathsFor(id);
    for (const folder of Object.values(locations)) await fs.rm(folder, { recursive: true, force: true }).catch(() => {});
  }
  async function restore(record, ctx) {
    const { backup } = pathsFor(record.id);
    if (record.packageRoot !== ctx.packageRoot || !VERSION.test(record.before)) throw fault('recovery');
    if (!Array.isArray(record.launchers) || !record.launchers.includes('codex.cmd') ||
        record.launchers.some(name => !['codex', 'codex.cmd', 'codex.ps1'].includes(name))) throw fault('recovery');
    const backupPackage = path.join(backup, 'package');
    const backupInfo = await json(path.join(backupPackage, 'package.json'));
    if (backupInfo.name !== '@openai/codex' || backupInfo.version !== record.before) throw fault('recovery');
    const damaged = path.join(path.dirname(ctx.packageRoot), '.cockpit-codex-recovery-' + record.id + '-' + crypto.randomUUID());
    // Renomear na mesma pasta preserva a tentativa incompleta até o backup ser validado.
    if (await exists(ctx.packageRoot)) await fs.rename(ctx.packageRoot, damaged);
    try {
      await fs.cp(backupPackage, ctx.packageRoot, { recursive: true, errorOnExist: true, force: false });
      for (const name of record.launchers) await fs.copyFile(path.join(backup, 'launchers', name), path.join(ctx.prefix, name));
      await verifyInstalled(ctx, record.before);
    } catch (error) { throw fault('recovery', error.message); }
    await fs.rm(damaged, { recursive: true, force: true }).catch(() => {});
    await fs.unlink(journalFile());
    await cleanup(record.id);
  }
  async function recover(signal) {
    if (!await exists(journalFile())) return;
    const record = await json(journalFile());
    const ctx = await context(signal, true);
    pathsFor(record.id);
    if (record.packageRoot !== ctx.packageRoot || !VERSION.test(record.before) || !VERSION.test(record.target)) throw fault('recovery');
    if (Number.isSafeInteger(record.installerPid) && record.installerPid > 0) {
      // Após uma queda brusca, o npm pode ainda estar terminando fora do Electron.
      // Confirmar PID + comando evita confundir um PID reaproveitado pelo Windows.
      const script = '$p = Get-CimInstance Win32_Process -Filter "ProcessId = ' + record.installerPid + '"; ' +
        "if ($p -and $p.Name -ieq 'cmd.exe' -and $p.CommandLine.Contains('@openai/codex@" + record.target +
        "') -and $p.CommandLine.Contains('--global')) { '1' } else { '0' }";
      const running = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { signal, timeout: 10000 });
      if (running.stdout.trim() !== '0') throw fault('recovery-busy');
    }
    if (await busy(signal)) throw fault('recovery-busy');
    try {
      await verifyInstalled(ctx, record.target, signal);
      await fs.unlink(journalFile()); await cleanup(record.id);
    } catch { await restore(record, ctx); }
  }
  async function inspect(engine, signal) {
    const bin = findBin(engine);
    if (!path.isAbsolute(bin) || !await exists(bin)) return { state: 'missing' };
    const installed = await version(engine, signal);
    if (engine === 'claude') return { installed, native: true };
    let target;
    try { target = await view('@openai/codex@latest', 'version', signal); }
    catch (error) { if (signal?.aborted) throw error; return { installed, state: 'offline' }; }
    if (!VERSION.test(target || '')) return { installed, state: 'unsupported' };
    if (!newer(target, installed)) return { installed, target, state: 'current' };
    // O npm pode publicar o lançador antes do componente Windows (ocorreu na 0.159.1).
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const expected = 'npm:@openai/codex@' + target + '-win32-' + arch;
    try {
      const dependencies = await view('@openai/codex@' + target, 'optionalDependencies', signal);
      if (dependencies?.['@openai/codex-win32-' + arch] !== expected) return { installed, target, state: 'incomplete' };
      const integrity = await view('@openai/codex@' + target + '-win32-' + arch, 'dist.integrity', signal);
      if (typeof integrity !== 'string' || !/^sha(256|384|512)-[A-Za-z0-9+/=]+$/.test(integrity)) return { installed, target, state: 'incomplete' };
    } catch (error) { if (signal?.aborted) throw error; return { installed, target, state: 'incomplete' }; }
    const ctx = await context(signal);
    if (await busy(signal)) return { installed, target, state: 'busy' };
    return { installed, target, ctx };
  }
  async function install(engine, candidate, signal, progress) {
    if (engine === 'claude') {
      // O instalador nativo conserva o canal escolhido, versões em uso e logins.
      await run(findBin('claude'), ['update'], { signal, timeout: 120000 });
      const after = await version('claude', signal);
      if (newer(candidate.installed, after)) throw fault('verification');
      return after;
    }
    const { ctx, target } = candidate;
    const id = crypto.randomUUID().replaceAll('-', '');
    const { stage, backup } = pathsFor(id);
    let record = null;
    try {
      cancelled(signal);
      await fs.mkdir(stage, { recursive: true });
      await run('npm', ['install', '--prefix', stage, '@openai/codex@' + target, '--no-save', '--package-lock=false', ...commands], { signal, timeout: 180000 });
      await verifyPackage(path.join(stage, 'node_modules', '@openai', 'codex'), target, signal);
      cancelled(signal);
      if (await busy(signal)) throw fault('busy');
      // Se outro instalador atualizou enquanto baixávamos, não rebaixar nem sobrescrever.
      const current = await version('codex', signal);
      if (!newer(target, current)) return current;
      const beforeInfo = await json(path.join(ctx.packageRoot, 'package.json'));
      if (beforeInfo.version !== current) throw fault('verification');
      await fs.mkdir(path.join(backup, 'launchers'), { recursive: true });
      await fs.cp(ctx.packageRoot, path.join(backup, 'package'), { recursive: true, errorOnExist: true, force: false });
      const launchers = [];
      for (const name of ['codex', 'codex.cmd', 'codex.ps1']) {
        const launcher = path.join(ctx.prefix, name);
        if (await exists(launcher)) { await fs.copyFile(launcher, path.join(backup, 'launchers', name)); launchers.push(name); }
      }
      if (!launchers.includes('codex.cmd')) throw fault('verification');
      cancelled(signal);
      if (await busy(signal)) throw fault('busy');
      const planned = { id, packageRoot: ctx.packageRoot, before: current, target, launchers };
      await writeJson(journalFile(), planned);
      record = planned;
      progress('installing');
      await run('npm', ['install', '--global', '--prefix', ctx.prefix, '@openai/codex@' + target, ...commands], {
        signal, timeout: 180000,
        onSpawn: pid => {
          if (!Number.isSafeInteger(pid) || pid <= 0) throw fault('journal');
          record.installerPid = pid;
          const temporary = journalFile() + '.pending';
          fsSync.writeFileSync(temporary, JSON.stringify(record, null, 2));
          fsSync.renameSync(temporary, journalFile());
        },
      });
      await verifyInstalled(ctx, target, signal);
      const after = await version('codex', signal);
      if (after !== target) throw fault('verification');
      await fs.unlink(journalFile()); record = null;
      return after;
    } catch (error) {
      if (record) {
        // O cancelamento interrompe só o instalador. A restauração precisa terminar.
        try { await restore(record, ctx); record = null; }
        catch (restoreError) { throw fault('recovery', restoreError.message); }
      }
      throw error;
    } finally {
      if (!record) await cleanup(id);
    }
  }
  return { inspect, install, recover };
}

function createEngineUpdater(options) {
  const { directory, enabled, onUpdated = () => {}, platform = process.platform } = options;
  const run = options.run || createRunner(options);
  const backend = options.backend || createWindowsBackend({ ...options, run });
  const abort = new AbortController();
  const state = { enabled: false, running: false, engines: {} };
  let started = false, done = Promise.resolve(), gate = Promise.resolve(), gateDone = true, gateError = null;
  const snapshot = () => JSON.parse(JSON.stringify(state));
  const persist = () => writeJson(path.join(directory(), 'status.json'), snapshot()).catch(() => {});
  const set = (engine, entry) => { state.engines[engine] = { ...state.engines[engine], ...entry }; };
  async function perform(engine) {
    set(engine, { state: 'checking' });
    try {
      const candidate = await backend.inspect(engine, abort.signal);
      set(engine, { installed: candidate.installed, target: candidate.target });
      if (candidate.state) { set(engine, { state: candidate.state }); return; }
      cancelled(abort.signal);
      set(engine, { state: engine === 'codex' ? 'downloading' : 'checking' });
      const after = await backend.install(engine, candidate, abort.signal, phase => set(engine, { state: phase }));
      const updated = newer(after, candidate.installed);
      set(engine, { state: updated ? 'updated' : 'current', installed: after, before: candidate.installed });
      if (updated) { try { await onUpdated(engine); } catch {} }
    } catch (error) {
      if (engine === 'codex' && error.code === 'recovery') gateError = fault('recovery', 'A atualização do Codex precisa de recuperação. A instalação anterior foi preservada no backup.');
      set(engine, { state: ['cancelled', 'busy'].includes(error.code) ? error.code : 'failed', reason: error.code || 'command' });
    }
  }
  function start() {
    if (started) return done;
    started = true;
    state.enabled = platform === 'win32' && !!enabled();
    if (!state.enabled) return done;
    state.running = true; state.startedAt = Date.now(); gateDone = false;
    let releaseGate;
    gate = new Promise(resolve => { releaseGate = resolve; });
    done = (async () => {
      try {
        await backend.recover(abort.signal);
        await perform('codex');
      } catch (error) {
        if (!abort.signal.aborted) gateError = fault('recovery', 'Não foi possível concluir a recuperação do Codex. A cópia anterior foi preservada.');
        set('codex', { state: abort.signal.aborted ? 'cancelled' : 'failed', reason: error.code || 'recovery' });
      } finally { gateDone = true; releaseGate(); }
      if (!abort.signal.aborted) await perform('claude');
    })().finally(async () => { state.running = false; state.finishedAt = Date.now(); await persist(); });
    return done;
  }
  return {
    start, snapshot, get running() { return state.running; },
    get codexReady() { return gateDone; }, get codexError() { return gateError; },
    waitForCodex: () => gate.then(() => { if (gateError) throw gateError; }),
    stop: () => { abort.abort(); return done; },
  };
}

module.exports = { createEngineUpdater, createWindowsBackend, createRunner, versionOf, newer };
