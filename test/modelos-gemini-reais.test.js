'use strict';
/* Todo id da lista de modelos tem que EXISTIR — 22/09/2026.

   O bug que este arquivo existe pra impedir: `gemini-3.8-flash` e
   `gemini-3.5-flash-lite` ficaram o dia inteiro na lista do Cockpit sem existir
   em lugar nenhum. Quem escolhesse "Gemini 3.8 Flash" no menu recebia, calado,
   o modelo padrao do CLI — a tela dizia uma coisa e o motor fazia outra.

   Como eles entraram: foram "conferidos rodando", `gemini -m <id> -p ...`, e
   responderam. So' que o CLI do Gemini (0.60.0) NAO valida o id: medido em
   22/09, ele aceita `gemini-99-flash` e `gemini-inventado-flash` do mesmo
   jeito e cai no padrao. Rodar o modelo prova que o CLI nao quebra; nao prova
   que o modelo existe.

   A fonte de verdade e' o proprio pacote do CLI, que carrega os ids que ele
   sabe resolver. E' isso que este teste le. Se o Gemini CLI nao estiver
   instalado, o teste passa avisando — ele nao pode falhar por falta de
   ambiente, so' por id inventado.

   O mesmo cuidado vale pro Claude, com uma diferenca importante: la' o CLI
   RECUSA id que nao existe ("There's an issue with the selected model"), entao
   rodar prova de verdade. O teste do Claude aqui e' de forma, nao de
   existencia: garante que ninguem escreva um id com sufixo de data solto nem
   esqueca o padraoEffort. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const APP = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');

function listaDe(nome) {
  const i = APP.indexOf('const ' + nome + ' = [');
  assert.ok(i >= 0, nome + ' nao existe mais em app.js');
  const bloco = APP.slice(i, APP.indexOf('\n];', i));
  return [...bloco.matchAll(/\{\s*id:\s*'([^']*)'[^}]*nome:\s*'([^']*)'[^}]*?\}/g)]
    .map((m) => ({ id: m[1], nome: m[2] }));
}

/* Onde o pacote do Gemini CLI mora. Sem ele instalado, devolve ''. */
function pastaDoGeminiCli() {
  /* no Windows o executavel e' npm.cmd; chamar 'npm' com shell:true dispara
     DEP0190 e ainda concatena argumento sem escapar. Tenta os dois nomes. */
  let raiz = '';
  for (const bin of (process.platform === 'win32' ? ['npm.cmd', 'npm'] : ['npm'])) {
    try { raiz = execFileSync(bin, ['root', '-g'], { encoding: 'utf8' }).trim(); break; } catch { /* tenta o proximo */ }
  }
  if (!raiz) return '';
  const p = path.join(raiz, '@google', 'gemini-cli');
  return fs.existsSync(p) ? p : '';
}

/* Junta o texto dos .js do pacote uma vez so' — sao varios megabytes. */
let textoDoCli = null;
function textoDoGeminiCli(pasta) {
  if (textoDoCli !== null) return textoDoCli;
  const partes = [];
  (function andar(dir, fundo) {
    if (fundo > 6) return;
    let itens = [];
    try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of itens) {
      const alvo = path.join(dir, e.name);
      if (e.isDirectory()) { andar(alvo, fundo + 1); continue; }
      if (!/\.(js|mjs|cjs|json)$/.test(e.name)) continue;
      try { partes.push(fs.readFileSync(alvo, 'utf8')); } catch { /* ilegivel: ignora */ }
    }
  })(pasta, 0);
  textoDoCli = partes.join('\n');
  return textoDoCli;
}

test('Gemini: todo id da lista existe no CLI instalado (id inventado cai no padrao calado)', () => {
  const lista = listaDe('MODELOS_GEMINI');
  const ids = lista.map((m) => m.id).filter(Boolean);
  assert.ok(ids.length >= 2, 'a lista do Gemini ficou vazia demais: ' + JSON.stringify(ids));

  const pasta = pastaDoGeminiCli();
  if (!pasta) {
    console.log('  (Gemini CLI nao instalado aqui — so' + "'" + ' a forma foi conferida)');
    for (const id of ids) assert.match(id, /^gemini-[0-9]/, 'id fora do formato: ' + id);
    return;
  }

  const texto = textoDoGeminiCli(pasta);
  const inventados = ids.filter((id) => !texto.includes(id));
  assert.deepEqual(inventados, [],
    'ids que o Gemini CLI nao conhece (o menu mentiria, entregando o padrao): ' + inventados.join(', '));
});

test('Gemini: o nome na tela corresponde ao id (senao o menu promete outro modelo)', () => {
  for (const m of listaDe('MODELOS_GEMINI')) {
    if (!m.id) continue;
    const versao = (m.id.match(/^gemini-([0-9.]+)/) || [])[1];
    assert.ok(versao, 'id sem versao: ' + m.id);
    assert.ok(m.nome.includes(versao),
      'o nome "' + m.nome + '" nao bate com o id "' + m.id + '"');
    const lite = m.id.includes('-lite');
    assert.equal(lite, /lite/i.test(m.nome),
      '"lite" no id e no nome tem que andar junto: ' + m.id + ' / ' + m.nome);
  }
});

test('Claude: o Opus 5.5 esta na lista, com o effort padrao dele (medium, nao high)', () => {
  const bloco = APP.slice(APP.indexOf('const MODELOS_CLAUDE = ['), APP.indexOf('\n];', APP.indexOf('const MODELOS_CLAUDE = [')));
  const ids = [...bloco.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(ids.includes('claude-opus-5-5'), 'o Opus 5.5 sumiu da lista');
  assert.ok(ids.includes('claude-opus-5-5[1m]'), 'faltou a versao 1M do Opus 5.5');

  /* o padrao do proprio modelo e' medium, um degrau abaixo do Opus 5: pedir
     high calado gastaria mais do que ele foi feito pra gastar */
  const linha = bloco.slice(bloco.indexOf("id: 'claude-opus-5-5'"));
  const effort = (linha.match(/padraoEffort:\s*'([a-z]+)'/) || [])[1];
  assert.equal(effort, 'medium', 'o Opus 5.5 tem que nascer em medium');
});

test('Claude: nome e id andam juntos — "(1M)" no nome exige o sufixo [1m] no id', () => {
  for (const m of listaDe('MODELOS_CLAUDE')) {
    const temNoNome = /\(1M\)/.test(m.nome);
    const temNoId = /\[1m\]$/.test(m.id);
    assert.equal(temNoNome, temNoId,
      'o rotulo "' + m.nome + '" nao corresponde ao id "' + m.id + '" ' +
      '(era esse o defeito do Fable 5.1: prometia 1M sem pedir 1M)');
  }
});
