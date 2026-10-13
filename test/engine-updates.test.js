'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { createEngineUpdater, createWindowsBackend, createRunner, versionOf, newer } = require('../src/engine-updates');

const fail = code => Object.assign(new Error(code), { code });
async function fixture(t, options = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'cockpit-engine-update-'));
  t.after(() => fs.rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const prefix = path.join(base, 'npm'), data = path.join(base, 'data');
  const root = path.join(prefix, 'node_modules', '@openai', 'codex');
  const codex = path.join(prefix, 'codex.cmd'), claude = path.join(base, 'claude.exe');
  const calls = [];
  let claudeVersion = '2.1.284', busyCount = 0;
  async function packageAt(where, version) {
    await fs.mkdir(path.join(where, 'bin'), { recursive: true });
    await fs.writeFile(path.join(where, 'package.json'), JSON.stringify({ name: '@openai/codex', version }));
    await fs.writeFile(path.join(where, 'bin', 'codex.js'), 'executável simulado ' + version);
    await fs.writeFile(path.join(where, 'helper'), version);
  }
  async function readVersion(where) { return JSON.parse(await fs.readFile(path.join(where, 'package.json'))).version; }
  await packageAt(root, options.installed || '0.159.0');
  await fs.writeFile(codex, 'launcher anterior');
  await fs.writeFile(path.join(prefix, 'codex.ps1'), 'PowerShell anterior');
  await fs.writeFile(claude, 'Claude nativo simulado');
  const target = options.target || '0.159.1';
  const run = async (bin, args, settings = {}) => {
    calls.push({ bin, args: [...args], signal: !!settings.signal });
    if (settings.signal?.aborted) throw fail('cancelled');
    if (bin === 'npm' && args[0] === 'prefix') return { stdout: prefix, stderr: '' };
    if (bin === 'powershell.exe') return { stdout: options.installerStillRunning ? '1' : '0' };
    if (bin === 'npm' && args[0] === 'view') {
      if (options.offline) throw fail('timeout');
      const field = args[2];
      if (field === 'version') return { stdout: JSON.stringify(target) };
      if (field === 'optionalDependencies') return { stdout: JSON.stringify({
        ['@openai/codex-win32-' + (process.arch === 'arm64' ? 'arm64' : 'x64')]:
          'npm:@openai/codex@' + target + '-win32-' + (process.arch === 'arm64' ? 'arm64' : 'x64'),
      }) };
      if (options.incomplete) throw fail('command');
      return { stdout: JSON.stringify('sha512-YWJjZA==') };
    }
    if (bin === 'npm' && args[0] === 'install') {
      if (!args.includes('--global')) {
        const stage = args[args.indexOf('--prefix') + 1];
        await packageAt(path.join(stage, 'node_modules', '@openai', 'codex'), target);
        return { stdout: 'download completo' };
      }
      options.duringInstall?.();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(codex, { force: true });
      if (options.installFails || settings.signal?.aborted) throw fail(settings.signal?.aborted ? 'cancelled' : 'command');
      await packageAt(root, options.installedWrongVersion ? '0.158.0' : target);
      await fs.writeFile(codex, 'launcher novo');
      return { stdout: 'instalado' };
    }
    if (bin === codex) {
      await fs.access(codex);
      return { stdout: 'codex-cli ' + await readVersion(root) };
    }
    if (bin === claude) {
      if (args[0] === 'update') {
        if (options.claudeFails) throw fail('command');
        if (!options.claudeCurrent) claudeVersion = '2.1.285';
        return { stdout: 'Atualização nativa concluída' };
      }
      return { stdout: claudeVersion + ' (Claude Code)' };
    }
    if (bin === 'node') {
      const packageRoot = path.dirname(path.dirname(args[0]));
      const inStage = packageRoot !== root;
      if (inStage && options.stageFails) throw fail('command');
      if (!inStage && options.restoreFails && await readVersion(root) === '0.159.0') throw fail('command');
      await fs.access(path.join(packageRoot, 'helper'));
      return { stdout: args.includes('--version') ? 'codex-cli ' + await readVersion(packageRoot) : 'app-server --help' };
    }
    throw new Error('Comando inesperado: ' + bin + ' ' + args.join(' '));
  };
  const findBin = engine => engine === 'claude' ? claude : codex;
  const backend = createWindowsBackend({
    directory: () => data, findBin, run,
    activeCodex: async () => { busyCount++; return options.busy === true || (options.busyAt && busyCount >= options.busyAt); },
  });
  return { base, prefix, data, root, codex, claude, calls, run, findBin, backend, readVersion, packageAt };
}
const installs = f => f.calls.filter(c => c.bin === 'npm' && c.args[0] === 'install');
const globals = f => installs(f).filter(c => c.args.includes('--global'));

test('comparação recusa versões não estáveis e nunca rebaixa', () => {
  assert.equal(versionOf('codex-cli 0.159.1\n'), '0.159.1');
  assert.equal(versionOf('codex-cli 0.161.0-alpha.2'), '');
  assert.equal(newer('0.159.1', '0.159.0'), true);
  assert.equal(newer('0.159.1', '0.160.0'), false);
  assert.equal(newer('0.161.0-alpha.2', '0.159.1'), false);
});

for (const variant of [
  { name: 'versão atual', options: { target: '0.159.0' }, state: 'current' },
  { name: 'versão local mais nova', options: { installed: '0.160.0' }, state: 'current' },
  { name: 'sem internet', options: { offline: true }, state: 'offline' },
  { name: 'componente Windows ainda não publicado', options: { incomplete: true }, state: 'incomplete' },
  { name: 'publicação prévia', options: { target: '0.161.0-alpha.2' }, state: 'unsupported' },
  { name: 'versão com conteúdo de comando', options: { target: '0.159.1 & calc' }, state: 'unsupported' },
  { name: 'outro Codex em uso', options: { busy: true }, state: 'busy' },
]) test(variant.name + ' não chama instalador', async t => {
  const f = await fixture(t, variant.options);
  const result = await f.backend.inspect('codex');
  assert.equal(result.state, variant.state);
  assert.equal(installs(f).length, 0);
  assert.equal(await f.readVersion(f.root), variant.options.installed || '0.159.0');
});

test('testa uma cópia e instala exatamente a versão estável verificada', async t => {
  const f = await fixture(t);
  const candidate = await f.backend.inspect('codex');
  const phases = [];
  assert.equal(await f.backend.install('codex', candidate, undefined, p => phases.push(p)), '0.159.1');
  assert.deepEqual(phases, ['installing']);
  assert.equal(installs(f).length, 2);
  const globalIndex = f.calls.findIndex(c => c.args.includes('--global'));
  assert.ok(f.calls.slice(0, globalIndex).some(c => c.bin === 'node' && c.args.includes('app-server')));
  assert.ok(globals(f)[0].args.includes('@openai/codex@0.159.1'));
  assert.ok(globals(f)[0].args.includes('--ignore-scripts'));
  assert.equal(await f.readVersion(f.root), '0.159.1');
  assert.deepEqual(await fs.readdir(f.data), []);
});

test('cópia de teste defeituosa conserva instalação e lançadores', async t => {
  const f = await fixture(t, { stageFails: true });
  await assert.rejects(f.backend.install('codex', await f.backend.inspect('codex'), undefined, () => {}));
  assert.equal(globals(f).length, 0);
  assert.equal(await fs.readFile(f.codex, 'utf8'), 'launcher anterior');
  assert.equal(await f.readVersion(f.root), '0.159.0');
});

test('processo que começou durante o download adia sem trocar arquivos', async t => {
  const f = await fixture(t, { busyAt: 2 });
  await assert.rejects(f.backend.install('codex', await f.backend.inspect('codex'), undefined, () => {}), { code: 'busy' });
  assert.equal(globals(f).length, 0);
  assert.equal(await f.readVersion(f.root), '0.159.0');
});

for (const options of [{ installFails: true }, { installedWrongVersion: true }]) {
  test('falha parcial restaura pacote e comando do terminal: ' + JSON.stringify(options), async t => {
    const f = await fixture(t, options);
    await assert.rejects(f.backend.install('codex', await f.backend.inspect('codex'), undefined, () => {}));
    assert.equal(await f.readVersion(f.root), '0.159.0');
    assert.equal(await fs.readFile(f.codex, 'utf8'), 'launcher anterior');
    assert.equal(await fs.readFile(path.join(f.prefix, 'codex.ps1'), 'utf8'), 'PowerShell anterior');
    assert.deepEqual(await fs.readdir(f.data), []);
  });
}

test('fechar durante a instalação termina a restauração mesmo com sinal cancelado', async t => {
  const abort = new AbortController();
  const f = await fixture(t, { duringInstall: () => abort.abort() });
  await assert.rejects(f.backend.install('codex', await f.backend.inspect('codex'), abort.signal, () => {}), { code: 'cancelled' });
  assert.equal(await f.readVersion(f.root), '0.159.0');
  assert.equal(await fs.readFile(f.codex, 'utf8'), 'launcher anterior');
});

test('erro na restauração mantém diário e backup para recuperar depois', async t => {
  const f = await fixture(t, { installFails: true, restoreFails: true });
  await assert.rejects(f.backend.install('codex', await f.backend.inspect('codex'), undefined, () => {}), { code: 'recovery' });
  const record = JSON.parse(await fs.readFile(path.join(f.data, 'codex-recovery.json')));
  assert.equal(record.before, '0.159.0');
  await fs.access(path.join(f.data, 'backup-' + record.id, 'package', 'bin', 'codex.js'));
});

test('próxima abertura recupera queda que deixou pacote e lançador ausentes', async t => {
  const f = await fixture(t);
  const id = 'a'.repeat(32), backup = path.join(f.data, 'backup-' + id);
  await fs.mkdir(path.join(backup, 'launchers'), { recursive: true });
  await fs.cp(f.root, path.join(backup, 'package'), { recursive: true });
  await fs.copyFile(f.codex, path.join(backup, 'launchers', 'codex.cmd'));
  await fs.writeFile(path.join(f.data, 'codex-recovery.json'), JSON.stringify({
    id, packageRoot: f.root, before: '0.159.0', target: '0.159.1', launchers: ['codex.cmd'],
  }));
  await fs.rm(f.root, { recursive: true });
  await fs.rm(f.codex);
  await f.backend.recover();
  assert.equal(await f.readVersion(f.root), '0.159.0');
  assert.equal(await fs.readFile(f.codex, 'utf8'), 'launcher anterior');
});

test('diário com destino alheio nunca sobrescreve outra pasta', async t => {
  const f = await fixture(t);
  await fs.mkdir(f.data);
  await fs.writeFile(path.join(f.data, 'codex-recovery.json'), JSON.stringify({
    id: 'a'.repeat(32), packageRoot: f.base, before: '0.159.0', target: '0.159.1', launchers: ['codex.cmd'],
  }));
  await assert.rejects(f.backend.recover(), { code: 'recovery' });
  assert.equal(await f.readVersion(f.root), '0.159.0');
});

test('queda com instalador ainda ativo não inicia uma restauração concorrente', async t => {
  const f = await fixture(t, { installerStillRunning: true });
  await fs.mkdir(f.data);
  await fs.writeFile(path.join(f.data, 'codex-recovery.json'), JSON.stringify({
    id: 'b'.repeat(32), packageRoot: f.root, before: '0.159.0', target: '0.159.1', installerPid: 123,
    launchers: ['codex.cmd'],
  }));
  await assert.rejects(f.backend.recover(), { code: 'recovery-busy' });
  assert.equal(await f.readVersion(f.root), '0.159.0');
  assert.equal(globals(f).length, 0);
});

for (const choice of [{ enabled: false, platform: 'win32' }, { enabled: true, platform: 'darwin' }]) {
  test('desativado/prévia ou outra plataforma não executa nada: ' + JSON.stringify(choice), async t => {
    const f = await fixture(t);
    const updater = createEngineUpdater({ directory: () => f.data, enabled: () => choice.enabled, platform: choice.platform, backend: f.backend, run: f.run });
    await updater.start();
    assert.equal(updater.snapshot().enabled, false);
    assert.deepEqual(f.calls, []);
  });
}

test('início é único, o Codex espera sua atualização e o Claude usa seu instalador nativo', async t => {
  const f = await fixture(t);
  const changed = [];
  const updater = createEngineUpdater({ directory: () => f.data, enabled: () => true, platform: 'win32', backend: f.backend, run: f.run, onUpdated: engine => changed.push(engine) });
  const first = updater.start();
  assert.equal(updater.start(), first);
  assert.equal(updater.codexReady, false);
  await updater.waitForCodex();
  assert.equal(await f.readVersion(f.root), '0.159.1');
  await first;
  assert.deepEqual(changed, ['codex', 'claude']);
  assert.equal(updater.snapshot().engines.claude.installed, '2.1.285');
  assert.equal(updater.snapshot().running, false);
  assert.ok(f.calls.some(c => c.bin === f.claude && c.args[0] === 'update'));
  assert.equal(f.calls.filter(c => c.bin === 'npm' && c.args.some(a => a.includes('anthropic'))).length, 0);
});

test('falha recuperável não impede o uso do Codex anterior nem a atualização do Claude', async t => {
  const f = await fixture(t, { installFails: true });
  const updater = createEngineUpdater({ directory: () => f.data, enabled: () => true, platform: 'win32', backend: f.backend, run: f.run });
  await updater.start();
  await updater.waitForCodex();
  assert.equal(updater.snapshot().engines.codex.state, 'failed');
  assert.equal(updater.snapshot().engines.claude.state, 'updated');
  assert.equal(await f.readVersion(f.root), '0.159.0');
});

test('falha irrecuperável não inicia um Codex quebrado', async t => {
  const f = await fixture(t, { installFails: true, restoreFails: true });
  const updater = createEngineUpdater({ directory: () => f.data, enabled: () => true, platform: 'win32', backend: f.backend, run: f.run });
  await updater.start();
  await assert.rejects(updater.waitForCodex(), { code: 'recovery' });
  assert.equal(updater.codexError.code, 'recovery');
});

test('runner cancela somente seu filho, oculta janela e não executa shell livre', async () => {
  const signal = new AbortController();
  let child, spawnOptions, stopped = 0;
  const run = createRunner({
    env: () => ({ TEST: '1' }),
    spawnBin: (_bin, _args, options) => {
      spawnOptions = options;
      child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      return child;
    },
    stopProcess: p => { assert.equal(p, child); stopped++; queueMicrotask(() => child.emit('close', 1)); },
  });
  const result = run('npm', ['view', '@openai/codex', 'version'], { signal: signal.signal });
  signal.abort();
  await assert.rejects(result, { code: 'cancelled' });
  assert.equal(stopped, 1);
  assert.equal(spawnOptions.windowsHide, true);
  assert.equal(spawnOptions.shell, undefined);
});

for (const scenario of ['timeout', 'journal']) {
  test('runner espera o instalador encerrar antes de liberar a recuperação: ' + scenario, async () => {
    let child, closed = false, stopped = 0;
    const run = createRunner({
      env: () => ({}),
      spawnBin: () => {
        child = new EventEmitter(); child.pid = 123;
        child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
        return child;
      },
      stopProcess: process => {
        assert.equal(process, child); stopped++;
        setTimeout(() => { closed = true; child.emit('close', 1); }, 5);
      },
    });
    const options = scenario === 'timeout' ? { timeout: 10 } : { onSpawn: () => { throw Error('Disco sem espaço'); } };
    await assert.rejects(run('npm', ['install'], options), { code: scenario });
    assert.equal(closed, true);
    assert.equal(stopped, 1);
  });
}
