'use strict';
/* "Salvar como" no Electron 43+ (Task 17 da leva 1; AUDITORIA-ELECTRON-44.md).

   O defeito possivel: a partir do Electron 43, um dialogo sem pasta no defaultPath abre em Downloads (e o Windows
   deixa de lembrar a ultima pasta). Os dois dialogos de salvar do main que passavam SO' o nome do arquivo
   (experiments:saveImage e experiments:cloudArtifact) agora montam as opcoes com opcoesSalvarComo(): o defaultPath
   sai ABSOLUTO, a pasta da conversa (se existir) ou Documentos, e o nome junto. A sonda nao prova isso porque abrir
   dialogo e' proibido; a conferencia ao vivo fica na lista "conferir depois de instalar".

   O main nao carrega em teste (precisa do Electron). Aqui roda o codigo REAL, recortado do main.js (a funcao e os
   dois handlers), com o dialog de mentira: nenhum dialogo abre e nada e' gravado fora da pasta temporaria. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { lerFonte, pegarBloco } = require('../testes/raiz');

const MAIN = lerFonte('main.js');
const TEM_FUNCAO = MAIN.includes('function opcoesSalvarComo(');

// pastas temporarias dos testes: saem todas no fim
const temporarias = [];
const pastaTemporaria = (prefixo) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefixo)); temporarias.push(d); return d; };
test.after(() => { for (const d of temporarias) fs.rmSync(d, { recursive: true, force: true }); });
const simples = (v) => JSON.parse(JSON.stringify(v));   // o objeto nasce dentro do vm (outro Object.prototype)

// "const nome = ...;" em uma linha so'
function linhaConst(nome) {
  const ini = MAIN.indexOf('const ' + nome + ' = ');
  assert.ok(ini >= 0, 'não achei const ' + nome + ' no main.js');
  const linha = MAIN.slice(ini, MAIN.indexOf('\n', ini));
  assert.ok(linha.endsWith(';'), 'const ' + nome + ' deixou de caber numa linha só: ' + linha);
  return linha;
}
function trechoDoCanal(canal) {
  const ini = MAIN.indexOf("ipcMain.handle('" + canal + "'");
  assert.ok(ini >= 0, 'não achei ipcMain.handle(' + canal + ')');
  return MAIN.slice(ini, MAIN.indexOf('\n}));', ini) + 4);
}

/* Um "main.js em miniatura": so' o que a funcao e os dois handlers tocam. Documentos, pasta pessoal, dialogo, nuvem e
   log sao de mentira. opcoes.documentos: pasta (padrao: uma temporaria) ou um Error (o getPath lanca);
   opcoes.resposta: o que o dialogo devolve (padrao: o usuario cancela); opcoes.fs: no lugar do fs real. */
function montar(opcoes = {}) {
  const documentos = 'documentos' in opcoes ? opcoes.documentos : pastaTemporaria('cockpit-documentos-');
  const home = pastaTemporaria('cockpit-home-');
  const registros = [], chamadasDoDialogo = [], baixados = [], handlers = {};
  const ctx = {
    path, Buffer, HOME: home, fs: opcoes.fs || fs,
    app: {
      getPath: (nome) => {
        if (nome !== 'documents') throw new Error('pediu a pasta errada: ' + nome);
        if (documentos instanceof Error) throw documentos;
        return documentos;
      },
    },
    logMain: (contexto, erro) => { registros.push({ contexto, mensagem: erro && erro.message }); },
    ipcMain: { handle: (canal, fn) => { handlers[canal] = fn; } },
    win: { janela: 'de mentira' },
    dialog: {
      showSaveDialog: async (_janela, opcoesDoDialogo) => {
        chamadasDoDialogo.push(opcoesDoDialogo);
        return opcoes.resposta ? opcoes.resposta() : { canceled: true };
      },
    },
    validateGeneratedImage: (imagem) => ({ buffer: Buffer.from('PNG:' + imagem) }),
    experiments: { cloudArtifact: async (sessao, artefato) => { baixados.push([sessao, artefato]); return Buffer.from('conteudo de ' + artefato); } },
  };
  vm.createContext(ctx);
  vm.runInContext(linhaConst('ehCaminhoDeRede'), ctx);
  vm.runInContext(linhaConst('experimentHandler'), ctx);
  // antes da correcao a funcao nao existe e os handlers antigos nao a usam: os testes dos handlers falham pelo defaultPath sem pasta
  if (TEM_FUNCAO) vm.runInContext(pegarBloco(MAIN, 'function opcoesSalvarComo(', 'opcoesSalvarComo'), ctx);
  for (const canal of ['experiments:saveImage', 'experiments:cloudArtifact']) vm.runInContext(trechoDoCanal(canal), ctx);
  return { ctx, documentos, home, registros, chamadasDoDialogo, baixados, handlers };
}
function funcaoDe(m) {
  assert.ok(TEM_FUNCAO, 'o src/main.js ainda não tem a função opcoesSalvarComo');
  return vm.runInContext('opcoesSalvarComo', m.ctx);
}
// chama o handler como o ipcMain chamaria; o experimentHandler transforma excecao em { error }, entao confere que nao veio erro
async function chamar(m, canal, pedido) {
  const r = await m.handlers[canal]({}, pedido);
  assert.equal(r && r.error, undefined, 'o handler devolveu erro: ' + (r && r.error));
  return r;
}

/* ================= a função que monta as opções ================= */

test('pasta da conversa que existe: o defaultPath é ABSOLUTO, dentro dela, com o nome junto', () => {
  const conversa = pastaTemporaria('cockpit-conversa-');
  const m = montar();
  const o = funcaoDe(m)('relatorio.csv', conversa);
  assert.ok(path.isAbsolute(o.defaultPath), 'defaultPath sem pasta: ' + o.defaultPath);
  assert.equal(o.defaultPath, path.join(conversa, 'relatorio.csv'));
});

test('sem pasta da conversa utilizável (ausente, relativa, inexistente ou um arquivo): cai em Documentos, sempre absoluto', () => {
  const m = montar();
  const arquivo = path.join(pastaTemporaria('cockpit-arquivo-'), 'nao-sou-pasta.txt');
  fs.writeFileSync(arquivo, 'x');
  const inexistente = path.join(m.home, 'nao-existe');
  for (const preferida of [undefined, null, '', 42, 'pasta/relativa', '.', inexistente, arquivo]) {
    const o = funcaoDe(m)('a.png', preferida);
    assert.ok(path.isAbsolute(o.defaultPath), 'defaultPath sem pasta com preferida=' + String(preferida) + ': ' + o.defaultPath);
    assert.equal(o.defaultPath, path.join(m.documentos, 'a.png'), 'preferida=' + String(preferida));
  }
});

test('caminho de rede como pasta da conversa: nem encosta no disco, vai para Documentos', () => {
  const toques = [];
  const fsVigiado = new Proxy(fs, {
    get: (alvo, nome) => (typeof alvo[nome] === 'function' ? (...a) => { toques.push(String(nome)); return alvo[nome](...a); } : alvo[nome]),
  });
  const m = montar({ fs: fsVigiado });
  for (const rede of ['\\\\servidor\\pasta', '//servidor/pasta', '/\\servidor/pasta', '\\/servidor/pasta']) {
    assert.equal(funcaoDe(m)('a.png', rede).defaultPath, path.join(m.documentos, 'a.png'), rede);
  }
  assert.deepEqual(toques, [], 'tocou no disco: ' + toques.join(', '));
});

test('o nome vira só nome de arquivo (sem pasta embutida) e nunca fica vazio', () => {
  const m = montar();
  const f = funcaoDe(m);
  assert.equal(f('../../fora.txt').defaultPath, path.join(m.documentos, 'fora.txt'));
  assert.equal(f('saida/dados/relatorio.csv').defaultPath, path.join(m.documentos, 'relatorio.csv'));
  for (const vazio of [undefined, null, '', '/']) assert.equal(f(vazio).defaultPath, path.join(m.documentos, 'arquivo'), 'nome=' + String(vazio));
});

test('as outras opções do diálogo (o filtro) seguem junto e o defaultPath calculado vence', () => {
  const m = montar();
  const filtros = [{ name: 'Imagem PNG', extensions: ['png'] }];
  const o = simples(funcaoDe(m)('a.png', undefined, { filters: filtros, defaultPath: 'sem-pasta.png' }));
  assert.deepEqual(o, { filters: filtros, defaultPath: path.join(m.documentos, 'a.png') });
});

test('Documentos indisponível: cai na pasta pessoal, registra o erro e o caminho continua absoluto', () => {
  const m = montar({ documentos: new Error("Failed to get 'documents' path") });
  const o = funcaoDe(m)('a.png');
  assert.equal(o.defaultPath, path.join(m.home, 'a.png'));
  assert.ok(path.isAbsolute(o.defaultPath));
  assert.deepEqual(m.registros.map((r) => r.contexto), ['salvar-como']);
});

/* ================= os dois diálogos de salvar do main ================= */

test('experiments:saveImage: o diálogo recebe defaultPath absoluto em Documentos, mantém o filtro PNG e grava onde o usuário escolheu', async () => {
  const destino = path.join(pastaTemporaria('cockpit-destino-'), 'escolhida.png');
  const m = montar({ resposta: () => ({ canceled: false, filePath: destino }) });
  const r = await chamar(m, 'experiments:saveImage', { image: 'AAA' });
  assert.equal(m.chamadasDoDialogo.length, 1);
  const o = m.chamadasDoDialogo[0];
  assert.ok(path.isAbsolute(o.defaultPath), 'defaultPath sem pasta: ' + o.defaultPath);
  assert.equal(path.dirname(o.defaultPath), m.documentos);
  assert.match(path.basename(o.defaultPath), /^imagem-\d+\.png$/);
  assert.deepEqual(simples(o.filters), [{ name: 'Imagem PNG', extensions: ['png'] }]);
  assert.deepEqual(simples(r), { file: destino });
  assert.equal(fs.readFileSync(destino, 'utf8'), 'PNG:AAA');
});

test('experiments:saveImage com a pasta da conversa no pedido: o diálogo abre nela; cancelar não grava nada', async () => {
  const conversa = pastaTemporaria('cockpit-conversa-');
  const m = montar();
  const r = await chamar(m, 'experiments:saveImage', { image: 'AAA', cwd: conversa });
  assert.equal(path.dirname(m.chamadasDoDialogo[0].defaultPath), conversa);
  assert.deepEqual(simples(r), { cancelled: true });
  assert.deepEqual(fs.readdirSync(conversa), []);
});

test('experiments:cloudArtifact: defaultPath absoluto só com o nome do artefato; cancelar não baixa nada', async () => {
  const m = montar();
  const r = await chamar(m, 'experiments:cloudArtifact', { sessionId: 's1', artifactId: 'a1', name: 'saida/dados/relatorio.csv' });
  assert.equal(m.chamadasDoDialogo.length, 1);
  assert.equal(m.chamadasDoDialogo[0].defaultPath, path.join(m.documentos, 'relatorio.csv'));
  assert.deepEqual(simples(r), { cancelled: true });
  assert.deepEqual(m.baixados, [], 'baixou o artefato antes de o usuário escolher onde salvar');
});

test('experiments:cloudArtifact: escolhido o destino, baixa e grava; com a pasta da conversa no pedido, abre nela', async () => {
  const conversa = pastaTemporaria('cockpit-conversa-');
  const destino = path.join(pastaTemporaria('cockpit-destino-'), 'relatorio.csv');
  const m = montar({ resposta: () => ({ canceled: false, filePath: destino }) });
  const r = await chamar(m, 'experiments:cloudArtifact', { sessionId: 's1', artifactId: 'a1', name: 'relatorio.csv', cwd: conversa });
  assert.equal(m.chamadasDoDialogo[0].defaultPath, path.join(conversa, 'relatorio.csv'));
  assert.deepEqual(simples(r), { file: destino });
  assert.deepEqual(m.baixados, [['s1', 'a1']]);
  assert.equal(fs.readFileSync(destino, 'utf8'), 'conteudo de a1');
});

/* ================= a tela manda a pasta da conversa (Leva 1, "Pequenos" 17b) =================

   Os handlers acima já leem o.cwd, mas o experiments.js (a tela) não mandava: o diálogo abria sempre em Documentos.
   Aqui roda o experiments.js DE VERDADE num DOM de mentira: o clique em "Salvar nova imagem" (aba Imagens) e em
   "Baixar <arquivo>" (aba Nuvem). O pedido de cada clique entra direto no handler REAL do main (o do vm acima), então o
   que se confere é a pasta onde o diálogo abriria: a do painel (P.cwd). */
const EXPERIMENTS = lerFonte('renderer', 'experiments.js');

// elemento de mentira: só o que o experiments.js toca (atributos, filhos, dataset e os métodos do <dialog>)
function noFalso(tag) {
  const attrs = {};
  const n = {
    tag, attrs, children: [], dataset: {}, style: {}, className: '', textContent: '', innerHTML: '', isConnected: true,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute: (k, v) => { attrs[k] = String(v); },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    append: (...filhos) => { n.children.push(...filhos); },
    replaceChildren: (...filhos) => { n.children = filhos; },
    addEventListener() {}, focus() {}, remove() { n.isConnected = false; }, showModal() {}, close() {},
  };
  return n;
}
function coletar(no, serve, saida = []) {
  if (serve(no)) saida.push(no);
  for (const filho of no.children) coletar(filho, serve, saida);
  return saida;
}
// o que a tela escreveu nos avisos (role=status): ajuda a entender por que um clique não fez o que devia
const avisosDa = (tela) => coletar(tela, (n) => n.getAttribute('role') === 'status').map((n) => n.textContent).filter(Boolean).join(' | ');
function botaoDe(tela, rotulo) {
  const b = coletar(tela, (n) => n.getAttribute('aria-label') === rotulo)[0];
  assert.ok(b, 'não achei o botão "' + rotulo + '" na tela do experiments.js. Avisos: ' + avisosDa(tela));
  return b;
}

// abre o painel de recursos opcionais do painel P na aba pedida e devolve a raiz do <dialog>
async function abrirRecursos(P, aba, api) {
  const dialogos = [];
  const janela = { api };
  const ctx = {
    window: janela, nomeDoMotor: () => 'Claude', remotoDoPane: () => null,
    document: { activeElement: null, createElement: (tag) => noFalso(tag), body: { append: (d) => { dialogos.push(d); } } },
  };
  vm.runInNewContext(EXPERIMENTS, ctx);
  await janela.CockpitExperiments.open(P, { tab: aba });
  assert.equal(dialogos.length, 1, 'o painel de recursos não abriu');
  return dialogos[0];
}
const painelDeTeste = (cwd) => ({ id: 'p1', engine: 'claude', titulo: 'Conversa de teste', sessaoId: 's-1', cwd });

test('experiments.js, aba Imagens: "Salvar nova imagem" manda a pasta do painel (P.cwd) e o diálogo abre nela', async () => {
  const conversa = pastaTemporaria('cockpit-conversa-');
  const m = montar();
  const pedidos = [];
  const api = {
    experimentsStatus: async () => ({ configured: true }),
    experimentsGrant: async () => ({ grant: 'g1' }),
    experimentsImage: async () => ({ image: 'AAA' }),
    experimentsSaveImage: async (pedido) => { pedidos.push(pedido); return m.handlers['experiments:saveImage']({}, pedido); },
  };
  const tela = await abrirRecursos(painelDeTeste(conversa), 'images', api);
  coletar(tela, (n) => n.tag === 'textarea')[0].value = 'desenhe um gato';
  coletar(tela, (n) => n.tag === 'input' && n.type === 'checkbox')[0].checked = true;   // a confirmação da cobrança
  await botaoDe(tela, 'Gerar nova versão').onclick();
  const salvar = botaoDe(tela, 'Salvar nova imagem');
  assert.equal(salvar.disabled, false, 'a nova versão não foi gerada. Avisos: ' + avisosDa(tela));
  await salvar.onclick();

  assert.equal(pedidos.length, 1, 'o clique em Salvar nova imagem não chegou ao main. Avisos: ' + avisosDa(tela));
  assert.equal(pedidos[0].image, 'AAA', 'o resto do pedido segue igual');
  assert.equal(pedidos[0].cwd, conversa, 'o pedido vai sem a pasta do painel');
  assert.equal(m.chamadasDoDialogo.length, 1);
  assert.equal(path.dirname(m.chamadasDoDialogo[0].defaultPath), conversa, 'o diálogo não abriu na pasta da conversa');
});

test('experiments.js, aba Nuvem: "Baixar <arquivo>" manda a pasta do painel (P.cwd) e o diálogo abre nela', async () => {
  const conversa = pastaTemporaria('cockpit-conversa-');
  const m = montar();
  const pedidos = [];
  const api = {
    experimentsStatus: async () => ({ configured: true }),
    cloudList: async () => [{ id: 's1', title: 'Relatório' }],
    cloudRead: async () => ({ session: { status: 'completed' }, items: [], artifacts: [{ id: 'a1', path: 'saida/dados/relatorio.csv' }] }),
    cloudArtifact: async (pedido) => { pedidos.push(pedido); return m.handlers['experiments:cloudArtifact']({}, pedido); },
  };
  const tela = await abrirRecursos(painelDeTeste(conversa), 'cloud', api);
  await botaoDe(tela, 'Acompanhar Relatório').onclick();
  await botaoDe(tela, 'Baixar relatorio.csv').onclick();

  assert.equal(pedidos.length, 1, 'o clique em Baixar não chegou ao main. Avisos: ' + avisosDa(tela));
  assert.deepEqual({ sessionId: pedidos[0].sessionId, artifactId: pedidos[0].artifactId, name: pedidos[0].name },
    { sessionId: 's1', artifactId: 'a1', name: 'relatorio.csv' }, 'o resto do pedido segue igual');
  assert.equal(pedidos[0].cwd, conversa, 'o pedido vai sem a pasta do painel');
  assert.equal(m.chamadasDoDialogo.length, 1);
  assert.equal(m.chamadasDoDialogo[0].defaultPath, path.join(conversa, 'relatorio.csv'), 'o diálogo não abriu na pasta da conversa');
});
