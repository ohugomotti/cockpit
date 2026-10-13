'use strict';
/* Tarefa 4: Trecho selecionado, "Perguntar no chat lateral".

   perguntarNoChatLateral(P, trecho) chama o mesmo ramificar/ramificarAte da
   Tarefa "Ramificar conversa" (Claude, Codex e Gemini com sessao de verdade,
   inclusive na VPS; Grok e ACP pelo resumo colado, montarContexto) e deixa a
   pergunta pronta na caixa do painel novo -- so' isso, nao manda nada. Se o
   ramo falhar, quem avisa (note, no painel de ORIGEM) e' o proprio
   ramificar/ramificarAte; nada mais muda.

   O harness `tela()' abaixo e' o mesmo modelo do test/ramificar.test.js: le as
   funcoes reais do app.js pelo texto (function NAME() {...}, aproveitando o
   hoisting) e roda dentro de um vm.Context com o resto do app (newPane, note,
   window.api...) mockado. Fica num arquivo a parte -- test/ramificar.test.js
   nao e' tocado -- mas repete a tecnica porque tela() nao e' exportado. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');

function funcao(nome) {
  const inicio = APP.indexOf('function ' + nome + '(');
  assert.notEqual(inicio, -1, 'funcao nao encontrada no app.js: ' + nome);
  const abre = APP.indexOf('{', inicio);
  let nivel = 0;
  for (let i = abre; i < APP.length; i++) {
    if (APP[i] === '{') nivel++;
    if (APP[i] === '}' && --nivel === 0) return APP.slice(APP.slice(inicio - 6, inicio) === 'async ' ? inicio - 6 : inicio, i + 1);
  }
  throw new Error('funcao incompleta: ' + nome);
}
// TRECHO_MAX e' um const simples (nao uma funcao com chaves): le do texto pra
// nao destoar do app.js se o teto de 1.500 letras mudar la'.
function constanteNumerica(nome) {
  const m = new RegExp('const ' + nome + '\\s*=\\s*(\\d+)\\s*;').exec(APP);
  assert.ok(m, 'constante nao encontrada no app.js: ' + nome);
  return Number(m[1]);
}
const TRECHO_MAX = constanteNumerica('TRECHO_MAX');

// o campo (.p-input) do painel novo: registra o que a acao faz nele, do jeito
// que o textarea de verdade reage (o app.js so' chama estes 4 metodos).
function campoFalso() {
  return {
    value: '', style: {}, focou: 0, eventos: [], selecao: null,
    dispatchEvent(e) { this.eventos.push(e && e.type); },
    focus() { this.focou++; },
    setSelectionRange(a, b) { this.selecao = [a, b]; },
  };
}

function tela(extras) {
  const criados = [], faixas = [], notas = [], forks = [], salvou = { n: 0 }, focos = [];
  const cfg = { abaAtiva: 'pc', abas: [
    { id: 'pc', tipo: 'local' },
    { id: 'vps', tipo: 'ssh', host: 'vps.test', usuario: 'qa', chave: 'chave-vps', caminhoRemoto: '~/projeto' },
  ], ...(extras?.cfg || {}) };
  const ctx = vm.createContext({
    Event,   // Web API que o vm nao da' de graca (fundamentais como String/Math vem sozinhos)
    criados, faixas, notas, forks, salvou, focos,
    newPane: (o) => {
      const P = { id: 'n' + criados.length, engine: o.engine, cwd: o.cwd, model: o.model || '', mode: o.mode, effort: o.effort,
        abaId: o.abaId || 'pc', titulo: o.titulo || '', resumeId: o.resumeId || null, sessaoId: null,
        hist: [], el: { campo: campoFalso() }, morto: false };
      criados.push(P); return P;
    },
    $: (sel, el) => (sel === '.p-input' && el ? el.campo : null),
    pintarNome() {}, savePanes: () => { salvou.n++; },
    setFocus: (P) => { focos.push(P && P.id); },
    faixaDeRamo: (novo, origem, doFim, soResumo, extra) => faixas.push({ novo: novo.id, origem: origem && origem.titulo, doFim, soResumo: !!soResumo, extra }),
    note: (P, t, erro) => notas.push({ P: P && P.id, t, erro: !!erro }),
    montarContexto: ({ hist }) => 'CONTEXTO:' + hist.map((h) => h.quem + '=' + h.texto).join('|'),
    nomeDoMotor: (e) => ({ claude: 'Claude', codex: 'Codex', gemini: 'Gemini', grok: 'Grok' })[e] || e,
    TRECHO_MAX,
    window: { api: {
      sessaoFork: async (o) => { forks.push(o); return (extras && extras.forkResp) ? extras.forkResp(o) : { id: 'fork-' + o.engine }; },
      motoresDisponiveis: async (remoto) => {
        if (extras?.mapaResp) return extras.mapaResp(remoto);
        return { claude: { disponivel: true, capacidades: { fork: true } }, codex: { disponivel: true, capacidades: { fork: true } } };
      },
    } },
    ...(extras || {}),
    cfg,
  });
  vm.runInContext(['tituloDeRamo', 'novoPainelRamo', 'forkClaude', 'abrirRamo', 'ramoPorContexto', 'ramificar', 'ramificarAte',
    'abasLocais', 'abaPorId', 'abaAtual', 'remotoDoAba', 'remotoDoPane', 'faltaConfigurarServidor', 'capacidadeRemota', 'avisoRamoNoServidor',
    'cortarDetalhe', 'perguntarNoChatLateral'].map(funcao).join('\n'), ctx);
  return ctx;
}

test('barra do trecho: a acao chat-lateral existe, com rotulo em portugues, chama perguntarNoChatLateral e usa um icone que existe em ICONES', () => {
  const bloco = APP.match(/\{\s*acao:\s*'chat-lateral'[\s\S]*?\}/);
  assert.ok(bloco, 'entrada chat-lateral em ACOES_DO_TRECHO');
  assert.match(bloco[0], /rotulo:\s*'Perguntar no chat lateral'/);
  assert.match(bloco[0], /rodar:\s*\(P, trecho\) => perguntarNoChatLateral\(P, trecho\)/);
  const icone = (bloco[0].match(/icone:\s*'([^']+)'/) || [])[1];
  assert.ok(icone, 'a acao declara um icone');
  assert.ok(APP.includes('"' + icone + '":'), 'o icone "' + icone + '" existe no mapa ICONES');
});

test('Claude local: ramo de verdade (fork no start); campo do painel novo comeca com o trecho, cursor no fim, foco no campo, nada enviado', async () => {
  const c = tela();
  const P = { id: 'p1', engine: 'claude', abaId: 'pc', cwd: 'C:\\proj', sessaoId: 'sessao-claude-1', titulo: 'Duvida',
    hist: [{ quem: 'Você', texto: 'oi' }, { quem: 'Claude', texto: 'explicação da resposta' }] };
  const novo = await c.perguntarNoChatLateral(P, 'Trecho selecionado da resposta');
  assert.equal(c.criados.length, 1, 'um painel novo so');
  assert.equal(novo, c.criados[0]);
  assert.equal(novo.engine, 'claude');
  assert.equal(novo.forkPendente, true, 'Claude: --fork-session roda no start');
  assert.equal(c.forks.length, 0, 'nao pediu corte nenhum ao main (ramo da conversa inteira)');
  const campo = novo.el.campo;
  assert.equal(campo.value, 'Sobre este trecho: "Trecho selecionado da resposta"\n\n');
  assert.ok(campo.value.startsWith('Sobre este trecho: "'), 'comeca com o cabecalho do trecho');
  assert.deepEqual(campo.eventos, ['input'], 'dispara o input que cresce o campo e guarda o rascunho');
  assert.equal(campo.focou, 1, 'foco no campo');
  assert.deepEqual(campo.selecao, [campo.value.length, campo.value.length], 'cursor no fim');
  assert.equal(novo.hist.length, 0, 'nada foi enviado: o ramo comeca sem historico');
  assert.ok(c.focos.includes(novo.id), 'o painel novo vira o focado do app');
  assert.equal(c.notas.length, 0, 'sem avisos: o ramo deu certo');
});

test('Codex local: ramo por thread/fork (sessao:fork); campo do painel novo comeca com o trecho e nada foi enviado', async () => {
  const c = tela();
  const P = { id: 'p1', engine: 'codex', abaId: 'pc', cwd: 'C:\\proj', sessaoId: 'thr-1', titulo: 'Tarefa', hist: [{ quem: 'Você', texto: 'a' }] };
  const novo = await c.perguntarNoChatLateral(P, 'outro trecho, do Codex');
  assert.equal(c.criados.length, 1);
  assert.deepEqual({ ...c.forks[0] }, { engine: 'codex', id: 'thr-1', doFim: null, remoto: null }, 'pediu o fork de verdade ao main (ramo da conversa inteira: doFim e remoto locais ficam null)');
  assert.equal(novo.resumeId, 'fork-codex');
  assert.ok(!novo.forkPendente, 'o fork ja aconteceu no motor; so retoma o id novo');
  const campo = novo.el.campo;
  assert.equal(campo.value, 'Sobre este trecho: "outro trecho, do Codex"\n\n');
  assert.equal(campo.focou, 1);
  assert.deepEqual(campo.selecao, [campo.value.length, campo.value.length]);
  assert.equal(novo.hist.length, 0);
  assert.equal(c.notas.length, 0);
});

test('Grok local: sem fork nativo, ramo por resumo (montarContexto); campo do painel novo comeca com o trecho e nada foi enviado', async () => {
  const c = tela();
  const P = { id: 'p1', engine: 'grok', abaId: 'pc', cwd: 'C:\\proj', titulo: 'Grok',
    hist: [{ quem: 'Você', texto: 'oi' }, { quem: 'Grok', texto: 'resposta' }] };
  const novo = await c.perguntarNoChatLateral(P, 'trecho escolhido na resposta do Grok');
  assert.equal(c.criados.length, 1);
  assert.equal(c.forks.length, 0, 'Grok nao ramifica de verdade: e so o resumo colado');
  assert.equal(novo.passarContexto, 'CONTEXTO:Você=oi|Grok=resposta');
  const campo = novo.el.campo;
  assert.equal(campo.value, 'Sobre este trecho: "trecho escolhido na resposta do Grok"\n\n');
  assert.equal(campo.focou, 1);
  assert.deepEqual(campo.selecao, [campo.value.length, campo.value.length]);
  assert.equal(novo.hist.length, 0);
  assert.equal(c.notas.length, 0);
});

test('painel na VPS (Claude remoto): passa pela checagem do servidor antes do fork; campo do painel novo comeca com o trecho e nada foi enviado', async () => {
  const c = tela({ cfg: { abaAtiva: 'vps' } });
  const P = { id: 'p1', engine: 'claude', abaId: 'vps', cwd: '~/projeto', sessaoId: 'sessao-vps', titulo: 'No servidor', hist: [] };
  const novo = await c.perguntarNoChatLateral(P, 'trecho de uma resposta na VPS');
  assert.equal(c.criados.length, 1);
  assert.equal(novo.abaId, 'vps');
  assert.equal(novo.forkPendente, true, 'ramo de verdade tambem na VPS: --fork-session no start');
  const campo = novo.el.campo;
  assert.equal(campo.value, 'Sobre este trecho: "trecho de uma resposta na VPS"\n\n');
  assert.equal(campo.focou, 1);
  assert.deepEqual(campo.selecao, [campo.value.length, campo.value.length]);
  assert.equal(novo.hist.length, 0);
  assert.equal(c.notas.length, 0);
});

test('ramo falhou (motor indisponivel no servidor): aviso so no painel de ORIGEM, nenhum painel nasce e nada mais muda', async () => {
  const c = tela({ cfg: { abaAtiva: 'vps' }, mapaResp: () => ({ claude: { disponivel: false } }) });
  const P = { id: 'p1', engine: 'claude', abaId: 'vps', cwd: '~/projeto', sessaoId: 'sessao-vps', titulo: 'No servidor', hist: [] };
  const r = await c.perguntarNoChatLateral(P, 'trecho que nao vai a lugar nenhum');
  assert.equal(r, null);
  assert.equal(c.criados.length, 0, 'nenhum painel novo nasceu');
  assert.equal(c.forks.length, 0);
  assert.equal(c.notas.length, 1, 'so um aviso');
  assert.equal(c.notas[0].P, 'p1', 'o aviso fica no painel de ORIGEM');
  assert.equal(c.notas[0].erro, true);
  assert.match(c.notas[0].t, /Claude/);
  assert.equal(c.focos.length, 0, 'nao mudou o foco: nada foi criado');
});

test('trecho maior que 1.500 letras entra cortado (mesmo teto do Responder), sem quebrar par de emoji', async () => {
  const c = tela();
  const P = { id: 'p1', engine: 'claude', abaId: 'pc', cwd: 'C:\\proj', sessaoId: 'sessao-x', hist: [] };
  const grande = 'x'.repeat(TRECHO_MAX + 200);
  const novo = await c.perguntarNoChatLateral(P, grande);
  const cortado = 'x'.repeat(TRECHO_MAX);
  assert.equal(novo.el.campo.value, 'Sobre este trecho: "' + cortado + '"\n\n');
});

test('trecho vazio (so espaco) nao ramifica: nenhum painel nasce, nenhum aviso', async () => {
  const c = tela();
  const P = { id: 'p1', engine: 'claude', abaId: 'pc', sessaoId: 's', hist: [] };
  const r = await c.perguntarNoChatLateral(P, '   ');
  assert.equal(r, null);
  assert.equal(c.criados.length, 0);
  assert.equal(c.notas.length, 0);
});

test('painel de origem ja fechado (morto) nao ramifica', async () => {
  const c = tela();
  const P = { id: 'p1', engine: 'claude', abaId: 'pc', sessaoId: 's', hist: [], morto: true };
  const r = await c.perguntarNoChatLateral(P, 'trecho qualquer');
  assert.equal(r, null);
  assert.equal(c.criados.length, 0);
  assert.equal(c.forks.length, 0);
});
