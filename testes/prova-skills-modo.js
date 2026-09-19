/* Prova viva (FORA da bateria — usa a conta de verdade, gasta uso real da
   assinatura e demora por causa das 3 chamadas ao CLI). Nao entra no
   rodar-tudo.js: e' pra rodar na mao quando se quer reconferir o comportamento
   real do `claude` com os arquivos que claudeTravaDoModo gera.

   Confirma, subindo o CLI de verdade nos 3 modos que travam o defaultMode
   (manual, auto-edit, plan): o motor sobe no modo certo (permissionMode do
   'system init' bate com o esperado) E as skills pessoais de ~/.claude/skills
   voltam a aparecer (leva 40 tirava a fonte 'user' e elas soziam). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { pegarBloco, lerFonte } = require('./raiz');

const main = lerFonte('main.js');

// mesma extracao do teste unitario (test/modo-claude.test.js): o fonte de
// verdade, nao uma copia colada aqui
const RAIZ_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-modo-userData-'));
const ctx = { fs, path, app: { getPath: () => RAIZ_TMP }, JSON, String };
vm.createContext(ctx);
vm.runInContext(main.slice(main.indexOf('const MODO_NAS_SETTINGS'), main.indexOf(';', main.indexOf('const MODO_NAS_SETTINGS')) + 1).replace('const ', 'var '), ctx);
vm.runInContext(pegarBloco(main, 'function claudeTravaDoModo(', 'claudeTravaDoModo'), ctx);

// CLAUDE_MODE: o valor que claudeStart manda em --permission-mode pra cada modo do painel
const ctxCM = {};
vm.createContext(ctxCM);
vm.runInContext(main.slice(main.indexOf('const CLAUDE_MODE'), main.indexOf(';', main.indexOf('const CLAUDE_MODE')) + 1).replace('const ', 'var '), ctxCM);
const CLAUDE_MODE = ctxCM.CLAUDE_MODE;

const HOME = os.homedir();
const skillsPessoais = fs.readdirSync(path.join(HOME, '.claude', 'skills'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .slice(0, 3);

let erro = 0;
const checa = (nome, cond, det) => {
  if (cond) console.log('  ok   ' + nome);
  else { erro = 1; console.log('  FALHA ' + nome + (det ? ' -> ' + det : '')); }
};

const CASOS = [
  { modo: 'manual', permissionModeEsperado: 'default' },
  { modo: 'auto-edit', permissionModeEsperado: 'acceptEdits' },
  { modo: 'plan', permissionModeEsperado: 'plan' },
];

console.log('skills pessoais escolhidas pra conferir (de ' + path.join(HOME, '.claude', 'skills') + '):', skillsPessoais);

for (const caso of CASOS) {
  console.log('\n=== modo: ' + caso.modo + ' ===');
  const arqSettings = ctx.claudeTravaDoModo('prova-' + caso.modo, caso.modo);
  if (!arqSettings) { checa('claudeTravaDoModo gerou o arquivo', false); continue; }

  // so' AQUI: sem isto o hook SessionEnd de verdade do usuario grava nota no
  // Obsidian a cada rodada (a fonte 'user' volta a valer nestes modos)
  const settings = JSON.parse(fs.readFileSync(arqSettings, 'utf8'));
  settings.disableAllHooks = true;
  fs.writeFileSync(arqSettings, JSON.stringify(settings));
  console.log('  settings (' + arqSettings + '):', JSON.stringify(settings));

  const cwdVazio = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-cwd-'));
  const permissionModeFlag = CLAUDE_MODE[caso.modo];
  const args = [
    '-p', 'responda so: ok',
    '--output-format', 'stream-json', '--verbose',
    '--model', 'haiku', '--max-turns', '1',
    '--strict-mcp-config', '--no-session-persistence',
    '--permission-mode', permissionModeFlag,
    '--settings', arqSettings,
  ];
  console.log('  $ claude ' + args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' '));
  console.log('  cwd:', cwdVazio);

  let saida = '';
  try {
    saida = execFileSync('claude', args, { cwd: cwdVazio, encoding: 'utf8', timeout: 150000 });
  } catch (e) {
    /* visto na maquina: o modo plan as vezes sai com codigo != 0 DEPOIS de
       imprimir a linha "init" inteira e a resposta (bug do proprio CLI, fora
       do nosso controle). Em vez de descartar tudo, aproveita o stdout que
       ele conseguiu capturar antes de morrer -- e' o que sobra pra conferir. */
    checa('claude saiu com codigo 0', false, 'status=' + e.status + ' stderr=' + String(e.stderr || '').slice(0, 500));
    saida = String(e.stdout || '');
    if (!saida) continue;
  }

  const linhaInit = saida.split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .find((o) => o && o.type === 'system' && o.subtype === 'init');

  if (!linhaInit) { checa('achou a linha "subtype":"init"', false, saida.slice(0, 1000)); continue; }

  console.log('  init.permissionMode =', linhaInit.permissionMode, '| init.skills.length =', (linhaInit.skills || []).length);
  checa('permissionMode = ' + caso.permissionModeEsperado, linhaInit.permissionMode === caso.permissionModeEsperado, 'veio ' + linhaInit.permissionMode);
  const skills = linhaInit.skills || [];
  checa('skills.length >= 60', skills.length >= 60, 'veio ' + skills.length);
  const achou = skillsPessoais.filter((s) => skills.some((x) => String(x && (x.name || x.id || x)).includes(s)));
  checa('tem skill pessoal na lista (' + skillsPessoais.join(', ') + ')', achou.length > 0, 'nenhuma das 3 apareceu em ' + skills.length + ' skills');
}

console.log('');
process.exit(erro);
