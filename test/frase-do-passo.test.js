'use strict';
/* Leva 1, Task 14 -- passos da conversa em portugues de gente (UI 4.1, parte).

   Dois defeitos na frase que a tela escreve pra cada passo (fraseDoPasso):
   1) "PowerShell" (a ferramenta de terminal do Claude no Windows) aparecia crua,
      enquanto Bash e Terminal viravam "Rodando no terminal".
   2) Ferramenta de MCP chega como "mcp__servidor__ferramenta" e aparecia com esse
      nome tecnico. Agora e' "Servidor: ferramenta" (sem o prefixo claude_ai_, com
      a primeira letra maiuscula e o _ trocado por espaco).

   A funcao de verdade sai do app.js e roda num vm, junto com as pecas que ela usa
   (baseNome, soNome, TOOL_PT e toolLabel), pra o que cai fora dos dois casos
   continuar passando pelo mesmo caminho de hoje. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { pegarBloco, lerFonte } = require('../testes/raiz');

const APP = lerFonte('renderer', 'app.js');

function carregar() {
  const linha = (nome) => {
    const l = APP.split('\n').find((x) => x.startsWith('const ' + nome + ' '));
    assert.ok(l, 'const nao encontrada no app.js: ' + nome);
    return l;
  };
  const ctx = vm.createContext({});
  vm.runInContext([
    linha('baseNome'), linha('soNome'),
    pegarBloco(APP, 'const TOOL_PT = {', 'TOOL_PT') + ';',
    pegarBloco(APP, 'function toolLabel(', 'toolLabel'),
    pegarBloco(APP, 'function fraseDoPasso(', 'fraseDoPasso'),
  ].join('\n'), ctx);
  return ctx.fraseDoPasso;
}
const fraseDoPasso = carregar();
// objeto do vm tem outro Object.prototype: copia os dois campos pra comparar com deepEqual
const frase = (nome, arg) => { const f = fraseDoPasso(nome, arg); return { txt: f.txt, det: f.det }; };

test('PowerShell vira "Rodando no terminal", igual a Bash e Terminal, com o comando embaixo', () => {
  const comando = 'Get-ChildItem C:\\Users\\hugom\\Projetos-Codex | Select-Object -First 5';
  for (const nome of ['PowerShell', 'Bash', 'Terminal']) {
    assert.deepEqual(frase(nome, comando), { txt: 'Rodando no terminal', det: comando }, nome);
  }
  // comando comprido e com quebra de linha: a mesma regra do Bash (um espaco so', 70 letras e reticencias)
  const longo = 'Write-Output "a"\n' + 'x'.repeat(100);
  assert.deepEqual(frase('PowerShell', longo), frase('Bash', longo));
  assert.equal(frase('PowerShell', longo).det.length, 71);
  assert.deepEqual(frase('PowerShell'), { txt: 'Rodando no terminal', det: '' }, 'sem comando: so a frase');
});

test('MCP: "mcp__servidor__ferramenta" vira "Servidor: ferramenta"', () => {
  assert.deepEqual(frase('mcp__cockpit__apresentar_artefato', 'pagina.html'),
    { txt: 'Cockpit: apresentar artefato', det: 'pagina.html' }, 'a linha de baixo (det) fica como hoje');
  assert.equal(frase('mcp__claude_ai_ClickUp__clickup_get_task', '{"task_id":"86abc"}').txt, 'ClickUp: clickup get task',
    'tira o claude_ai_ do servidor; a maiuscula que ja existe fica');
  assert.equal(frase('mcp__claude_ai_Google_Drive__search_files').txt, 'Google Drive: search files', 'o _ do nome do servidor tambem vira espaco');
  assert.equal(frase('mcp__chrome-logado__take_screenshot').txt, 'Chrome-logado: take screenshot');
  assert.equal(frase('mcp__windows-mcp__Click').txt, 'Windows-mcp: Click', 'so a primeira letra do servidor muda; a ferramenta fica como veio');
  assert.equal(frase('mcp__cockpit__apresentar_artefato', 'x'.repeat(100)).det.length, 71, 'a linha de baixo continua cortada em 70 letras');
});

test('o que nao e MCP segue o caminho de hoje (toolLabel), e as frases proprias do Cockpit mandam', () => {
  assert.deepEqual(frase('mcp__cockpit__plano'), { txt: 'Atualizando o plano', det: '' });
  assert.deepEqual(frase('mcp__cockpit__perguntar'), { txt: 'Perguntando pra você', det: '' });
  assert.deepEqual(frase('NotebookEdit', 'a.ipynb'), { txt: 'Editando notebook', det: 'a.ipynb' });
  assert.deepEqual(frase('ClickUp · get_task', '{}'), { txt: 'ClickUp · get_task', det: '{}' }, 'o nome do Codex ja chega legivel');
  assert.deepEqual(frase('foo__bar'), { txt: 'foo__bar', det: '' }, 'dois _ no meio nao fazem um MCP');
  assert.deepEqual(frase(undefined), { txt: 'Ferramenta', det: '' });
  assert.equal(frase('Task', 'x').txt, 'Chamando um agente');
  assert.equal(frase('Read', 'C:\\a\\b.txt').det, 'b.txt');
});

/* ---- Leva 1, "Pequenos" 14b: o filtro por tipo do cabecalho da caixa de passos ----
   A frase ja' saia certa (Task 14), mas o cabecalho agrupa pelo tipoDoPasso(nome-da-ferramenta)
   e ali "PowerShell" caia em "outro": o filtro "terminal" nao contava os passos dele. */
const tipoDoPasso = (() => {
  const ctx = vm.createContext({});
  vm.runInContext(pegarBloco(APP, 'function tipoDoPasso(', 'tipoDoPasso'), ctx);
  return ctx.tipoDoPasso;
})();

test('o filtro "terminal" conta PowerShell, igual a Bash e Terminal (pelo nome da ferramenta e pela frase da tela)', () => {
  for (const nome of ['PowerShell', 'Bash', 'Terminal']) {
    assert.equal(tipoDoPasso(nome), 'terminal', nome);
    // passo que chega sem o nome da ferramenta cai pela frase ("Rodando no terminal")
    assert.equal(tipoDoPasso(frase(nome, 'Get-Date').txt), 'terminal', 'frase de ' + nome);
  }
  assert.equal(tipoDoPasso('powershell'), 'terminal', 'a regra ignora maiuscula, como nas outras ferramentas');
});

test('os outros tipos do filtro seguem como antes (arquivo, busca, outro); o agente ganhou o seu (leva 5i)', () => {
  assert.deepEqual(['Read', 'Edit', 'Write'].map((n) => tipoDoPasso(n)), ['arquivo', 'arquivo', 'arquivo']);
  assert.deepEqual(['Grep', 'Glob', 'WebSearch'].map((n) => tipoDoPasso(n)), ['busca', 'busca', 'busca']);
  /* Leva 5i: o Task/Agent do Claude (e o spawnAgent do Codex) saiam em "outro" e sumiam entre os passos; agora o filtro "agentes" os junta.
     O plano do Cockpit e o passo sem nome continuam em "outro". Antes: ['outro', 'outro', 'outro'] para Task, plano e sem nome. */
  assert.deepEqual(['Task', 'Agent', 'Agente', 'spawnAgent'].map((n) => tipoDoPasso(n)), ['agente', 'agente', 'agente', 'agente']);
  assert.equal(tipoDoPasso(frase('Task', 'x').txt), 'agente', 'o passo que chega só com a frase "Chamando um agente" também');
  assert.deepEqual(['mcp__cockpit__plano', undefined].map((n) => tipoDoPasso(n)), ['outro', 'outro']);
});

/* ---- Leva 1, ajustes finais, item 6: nome de ferramenta de MCP com "__" duplo ----
   "mcp__cockpit__foo__bar" separa o servidor no 1o "__" e a ferramenta fica "foo__bar". O _ virava um espaco
   cada um, e a frase saia com DOIS espacos no meio ("Cockpit: foo  bar"). Agora uma sequencia de _ vira UM
   espaco, e espaco nas pontas sai (tanto no servidor quanto na ferramenta). */
test('MCP: "__" duplo no nome da ferramenta vira um espaco so (mcp__cockpit__foo__bar = "Cockpit: foo bar")', () => {
  assert.equal(frase('mcp__cockpit__foo__bar').txt, 'Cockpit: foo bar');
  assert.equal(frase('mcp__cockpit__foo___bar').txt, 'Cockpit: foo bar', 'tres _ seguidos tambem sao um espaco so');
  assert.equal(frase('mcp__cockpit__foo_bar__baz_qux').txt, 'Cockpit: foo bar baz qux', 'o _ simples e o duplo juntos, na mesma frase');
  assert.deepEqual(frase('mcp__cockpit__foo__bar', 'x'), { txt: 'Cockpit: foo bar', det: 'x' }, 'a linha de baixo (det) fica como hoje');
});

test('MCP: espaco nas pontas sai, no servidor e na ferramenta', () => {
  assert.equal(frase('mcp__cockpit___foo').txt, 'Cockpit: foo', 'um _ sobrando no comeco da ferramenta');
  assert.equal(frase('mcp__cockpit__foo_').txt, 'Cockpit: foo', 'um _ sobrando no fim da ferramenta');
  assert.equal(frase('mcp__cockpit__foo__').txt, 'Cockpit: foo', 'um __ sobrando no fim da ferramenta');
  assert.equal(frase('mcp___cockpit_x__tool').txt, 'Cockpit x: tool', 'um _ sobrando no comeco do servidor nao vira espaco na frente da frase');
});

test('MCP: o que ja saia certo continua igual (um _ so vira um espaco)', () => {
  assert.equal(frase('mcp__cockpit__apresentar_artefato').txt, 'Cockpit: apresentar artefato');
  assert.equal(frase('mcp__claude_ai_Google_Drive__search_files').txt, 'Google Drive: search files');
  assert.equal(frase('mcp__chrome-logado__take_screenshot').txt, 'Chrome-logado: take screenshot');
  assert.equal(frase('mcp__windows-mcp__Click').txt, 'Windows-mcp: Click');
});
