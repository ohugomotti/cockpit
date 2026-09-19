'use strict';
/* O leitor que o Codex usa no debate: le, lista e busca SO' dentro da pasta do
   painel. Tudo aqui roda numa pasta descartavel dentro de artifacts/. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { listar, ler, buscar, chamar, FERRAMENTAS } = require('../src/leitura-mcp');

const artifacts = path.resolve(__dirname, '..', 'artifacts');
function projeto(t) {
  fs.mkdirSync(artifacts, { recursive: true });
  const base = fs.mkdtempSync(path.join(artifacts, 'leitor-test-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 3 }));
  const raiz = path.join(base, 'projeto');
  fs.mkdirSync(path.join(raiz, 'src', 'regras'), { recursive: true });
  fs.mkdirSync(path.join(raiz, 'node_modules', 'lixo'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'src', 'regras', 'planos.js'), 'const planos = {\n  ouro: { parcelas: 17 },\n};\n');
  fs.writeFileSync(path.join(raiz, 'README.md'), '# Projeto\nNada aqui.\n');
  fs.writeFileSync(path.join(raiz, 'node_modules', 'lixo', 'x.js'), 'parcelas: 99');
  fs.writeFileSync(path.join(base, 'fora.txt'), 'SEGREDO_DE_FORA_7731');
  fs.writeFileSync(path.join(raiz, 'imagem.bin'), Buffer.from([1, 0, 2, 0]));
  return { base, raiz };
}

test('lê com número de linha, lista e busca dentro do projeto (pula node_modules)', t => {
  const { raiz } = projeto(t);
  const lido = ler(raiz, 'src/regras/planos.js');
  assert.match(lido, /^src\/regras\/planos\.js\n/);
  assert.match(lido, /\s2 {2}\s*ouro: \{ parcelas: 17 \},/);
  const lista = listar(raiz, '.');
  assert.match(lista, /src\/regras\/planos\.js/);
  assert.doesNotMatch(lista, /node_modules/);
  const achados = buscar(raiz, 'PARCELAS');
  assert.equal(achados, 'src/regras/planos.js:2: ouro: { parcelas: 17 },');
  assert.match(ler(raiz, 'src/regras/planos.js', 2, 1), /^src\/regras\/planos\.js\n\s+2 {2}/);
});

test('nada fora da pasta: ../, caminho absoluto e atalho (junction) são recusados', t => {
  const { base, raiz } = projeto(t);
  assert.throws(() => ler(raiz, '../fora.txt'), /Fora do projeto/);
  assert.throws(() => ler(raiz, path.join(base, 'fora.txt')), /Fora do projeto/);
  assert.throws(() => listar(raiz, '..'), /Fora do projeto/);
  assert.throws(() => buscar(raiz, 'x', '../'), /Fora do projeto/);
  let atalho = false;
  try { fs.symlinkSync(base, path.join(raiz, 'atalho'), 'junction'); atalho = true; } catch {}
  if (atalho) {
    assert.throws(() => ler(raiz, 'atalho/fora.txt'), /Fora do projeto/);
    assert.doesNotMatch(buscar(raiz, 'SEGREDO_DE_FORA'), /SEGREDO_DE_FORA_7731/);
  }
});

test('binário e pasta não são lidos como texto; ferramenta desconhecida recusa', t => {
  const { raiz } = projeto(t);
  assert.throws(() => ler(raiz, 'imagem.bin'), /binário/);
  assert.throws(() => ler(raiz, 'src'), /é uma pasta/);
  assert.throws(() => chamar(raiz, 'escrever', { caminho: 'x' }), /desconhecida/);
  assert.deepEqual(FERRAMENTAS.map(f => f.name), ['listar', 'ler', 'buscar']);
  assert.ok(FERRAMENTAS.every(f => f.annotations.readOnlyHint === true && f.annotations.destructiveHint === false));
});

test('servidor MCP de verdade (stdio): initialize, tools/list e tools/call', async t => {
  const { raiz } = projeto(t);
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'leitura-mcp.js')], { env: { ...process.env, COCKPIT_RAIZ: raiz }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { try { proc.kill(); } catch {} });
  const respostas = new Map(); let buf = '';
  proc.stdout.on('data', c => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); respostas.set(m.id, m); } });
  const pedir = (id, method, params) => { proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); };
  pedir(1, 'initialize', { protocolVersion: '2025-06-18' });
  pedir(2, 'tools/list', {});
  pedir(3, 'tools/call', { name: 'ler', arguments: { caminho: 'src/regras/planos.js' } });
  pedir(4, 'tools/call', { name: 'ler', arguments: { caminho: '../fora.txt' } });
  for (let i = 0; i < 100 && respostas.size < 4; i++) await new Promise(r => setTimeout(r, 30));
  assert.equal(respostas.get(1).result.serverInfo.name, 'cockpit-leitura');
  assert.equal(respostas.get(2).result.tools.length, 3);
  assert.match(respostas.get(3).result.content[0].text, /parcelas: 17/);
  assert.equal(respostas.get(4).result.isError, true);
  assert.doesNotMatch(JSON.stringify(respostas.get(4)), /SEGREDO_DE_FORA/);
});
