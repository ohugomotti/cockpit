'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { RAIZ, lerFonte, pegarBloco, globaisFalsos } = require('../testes/raiz');
const links = require('../src/renderer/file-links');

/* UI 7.2-4 (leva 2, Task 4): imagem dentro de um .md aberto no leitor aparece (print q02).

   A CSP da tela só aceita img-src 'self' data:, e "./img.png" apontava para a pasta do APP, não do documento. A regra:
   - a tela resolve o src relativo a partir da PASTA DO DOCUMENTO (CockpitFileLinks.resolve) e pede ao main pelo IPC
     arquivo:imagemMd; o main lê (10 MB por imagem, só extensão de imagem) e devolve data:. A tela resolve DEPOIS da
     sanitização (o mdSeguro não foi tocado) e tira o src cru antes de o navegador buscá-lo;
   - imagem https: o main busca (net.request, 10 s, content-type image/*, teto de tamanho) e devolve data:. A CSP NÃO abre;
   - caminho de rede (\\servidor, //servidor, file://servidor) é recusado ANTES de qualquer fs.* (e do ssh), na tela e no main;
   - falha vira o aviso "imagem não carregou" e o documento segue.

   Fix B da leva 2 (revisão da Task 4 + auditoria 2):
   - SSRF: o net.request vai com redirect 'manual' e CADA salto (no máximo 5) passa pela mesma conferência do 1º endereço:
     só https, sem login, sem host privado (localhost, *.local, *.internal, sem ponto, 127/8, 10/8, 172.16/12, 192.168/16,
     169.254/16, 100.64/10, 0.0.0.0, ::1, fc00::/7, fe80::/10, ::ffff:);
   - imagem da web só com clique: a LOCAL continua automática; a https vira convite clicável + o botão "Carregar imagens da
     web (N)" no topo; a escolha vale só para o documento aberto;
   - a rolagem não pula quando as imagens chegam: cache por visor (src → { dados }) e a rolagem pedida devolvida de novo
     depois que as imagens têm tamanho, se o Hugo não mexeu;
   - um limite só, de 3 pedidos, para o módulo inteiro; desenho substituído não pede e o que chega é descartado;
   - o teto de 10 MB vai no pedido ao servidor.

   O main não carrega em teste (precisa do Electron): roda o código REAL dele, recortado do main.js, com o disco, a rede
   e o servidor vigiados (cada toque fica anotado). Nenhum teste faz requisição de verdade: o net.request é de mentira
   (netFalso, com o comportamento do Electron 44.5.1 lido do código dele). */

const MSG_REDE = 'Caminho de rede bloqueado por segurança.';
const TETO = 10 * 1024 * 1024;
const TETO_LEITOR = 25 * 1024 * 1024;   // o teto do leitor para imagem: o pedido de imagem do .md pede 10 MB ao servidor
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const PNG_URL = 'data:image/png;base64,' + PNG.toString('base64');
const REMOTO = { usuario: 'hugo', host: 'vps', chave: 'k' };
const simples = (v) => JSON.parse(JSON.stringify(v));   // o objeto nasce dentro do vm (outro Object.prototype)
const REDE = [
  '\\\\servidor\\pasta\\a.png', '//servidor/pasta/a.png', '/\\servidor/pasta/a.png', '\\/servidor/pasta/a.png',
  '  \\\\servidor\\pasta\\a.png', '\\\\?\\UNC\\servidor\\pasta\\a.png', '\\\\.\\pipe\\a.png',
];

/* =====================================================================
   O main: arquivo:imagemMd
   ===================================================================== */
const main = lerFonte('main.js');
function linhaConst(nome) {
  const ini = main.indexOf('const ' + nome + ' = ');
  assert.ok(ini >= 0, 'não achei: const ' + nome + ' = ... no main.js');
  return main.slice(ini, main.indexOf('\n', ini));
}
function trechoDoCanal(canal) {
  const ini = main.indexOf("ipcMain.handle('" + canal + "'");
  assert.ok(ini >= 0, "não achei ipcMain.handle('" + canal + "' no main.js");
  return main.slice(ini, main.indexOf('\n});', ini) + 4);
}

/* O net.request do Electron 44.5.1, como ele é de verdade (lido do código do próprio Electron):
   - com redirect: 'manual', cada redirecionamento sai pelo evento 'redirect' (statusCode, método, urlNova, cabeçalhos);
     o followRedirect() só vale SÍNCRONO, de dentro do evento; sem followRedirect nem abort() o pedido morre com
     "Redirect was cancelled" (evento 'error'). abort() para tudo e não emite 'error';
   - a resposta final chega no evento 'response' (statusCode e headers em minúsculo) e o corpo em 'data', fechando em 'end'.
   `rede(url, init)` diz o que cada endereço que FOI à rede devolve: uma Response (a resposta final) ou { redirecionar, status }.
   Nada vai à rede de verdade. */
const esperarUmaVez = () => new Promise((resolve) => setImmediate(resolve));
function netFalso(rede, toques) {
  const requisicoes = [];
  async function responder(req, resp) {
    const res = new EventEmitter();
    res.statusCode = resp.status; res.headers = {};
    for (const [k, v] of resp.headers) res.headers[k.toLowerCase()] = v;
    req.emit('response', res);
    const leitor = resp.body && resp.body.getReader ? resp.body.getReader() : null;
    try {
      while (leitor && !req.abortado) {
        const { done, value } = await leitor.read();
        if (done) break;
        res.emit('data', Buffer.from(value));
        await esperarUmaVez();
      }
    } catch (e) { if (!req.abortado) res.emit('error', e); return; }
    if (req.abortado) { if (leitor) Promise.resolve(leitor.cancel()).catch(() => {}); res.emit('close'); return; }
    res.emit('end'); res.emit('close');
  }
  async function percorrer(req, url) {
    for (;;) {
      if (req.abortado) return;
      toques.push(req.visitas.length ? 'salto ' + url : 'net.request ' + url);
      req.visitas.push(url);
      let r;
      try { r = await (rede || (() => { throw new Error('encostou em algo que o teste não combinou: rede'); }))(url, { signal: req.sinal, credentials: req.opcoes.credentials, headers: { ...req.cabecalhos } }); }
      catch (e) { if (!req.abortado) req.emit('error', e); return; }
      if (req.abortado) return;
      if (r && r.redirecionar !== undefined) {
        req.esperandoRedirect = true; req.seguiu = false;
        try { req.emit('redirect', r.status || 302, 'GET', r.redirecionar, {}); } finally { req.esperandoRedirect = false; }
        if (req.abortado) return;
        if (!req.seguiu) { req.emit('error', new Error('Redirect was cancelled')); return; }
        url = r.redirecionar;
        continue;
      }
      return responder(req, r);
    }
  }
  return {
    requisicoes,
    request(opcoes) {
      const controle = new AbortController();
      const req = Object.assign(new EventEmitter(), {
        opcoes, sinal: controle.signal, abortado: false, seguiu: false, esperandoRedirect: false, cabecalhos: {}, visitas: [],
        setHeader(k, v) { this.cabecalhos[String(k).toLowerCase()] = String(v); },
        abort() { this.abortado = true; controle.abort(); },
        followRedirect() { if (!this.esperandoRedirect) throw new Error('followRedirect() called, but was not waiting for a redirect'); this.seguiu = true; },
        end() { setImmediate(() => percorrer(this, this.opcoes.url)); },
      });
      requisicoes.push(req);
      return req;
    },
  };
}

/* Um "main.js em miniatura": só os pedaços da imagem do documento. Disco, rede e servidor de mentira: o que o código
   encostar fica em `toques`, e o que NÃO foi combinado explode. fs só tem o async (o main não trava com o Drive lento). */
function montarMain({ stat, lerArquivo, rede, remoto } = {}) {
  const toques = [], logs = [], temporizadores = new Set(), handlers = {}, tetosPedidos = [];
  const explode = (o) => () => { throw new Error('encostou em algo que o teste não combinou: ' + o); };
  const cobrar = (alvo, prefixo) => new Proxy(alvo, {
    get: (t, nome) => (nome in t ? t[nome] : () => { toques.push(prefixo + String(nome)); throw new Error('encostou: ' + prefixo + String(nome)); }),
  });
  const fsFalso = cobrar({
    promises: cobrar({
      stat: async (p) => { toques.push('fs.stat ' + p); return (stat || explode('stat'))(p); },
      readFile: async (p) => { toques.push('fs.readFile ' + p); return (lerArquivo || explode('readFile'))(p); },
    }, 'fs.promises.'),
  }, 'fs.');
  const net = netFalso(rede, toques);
  const ctx = {
    path, Buffer, URL, AbortController,
    // cada relógio fica anotado: um que sobra depois do pedido é um 10 s a mais segurando o app
    setTimeout: (fn, ms) => { const t = setTimeout(() => { temporizadores.delete(t); fn(); }, ms); temporizadores.add(t); return t; },
    clearTimeout: (t) => { temporizadores.delete(t); clearTimeout(t); },
    fs: fsFalso,
    require: (nome) => {
      if (nome !== 'electron') throw new Error('require inesperado: ' + nome);
      // net.fetch NÃO existe aqui: ele segue qualquer redirecionamento, e o pedido de imagem tem de conferir CADA salto
      return { net: { request: (opcoes) => net.request(opcoes), fetch: () => { toques.push('net.fetch'); throw new Error('encostou: net.fetch'); } } };
    },
    logMain: (contexto, erro) => logs.push([contexto, String((erro && erro.message) || erro)]),
    verArquivoRemoto: async (rem, arquivo, teto) => { toques.push('ssh ' + arquivo); tetosPedidos.push(teto); return (remoto || explode('verArquivoRemoto'))(rem, arquivo, teto); },
    ipcMain: { handle: (canal, fn) => { handlers[canal] = fn; } },
  };
  vm.createContext(ctx);
  for (const nome of ['MSG_CAMINHO_DE_REDE', 'ehCaminhoDeRede', 'EXT_VIS_IMG', 'mimeDaImagem', 'TETO_IMG_DOC', 'TEMPO_IMG_WEB', 'ERRO_IMG_GRANDE', 'MAX_SALTOS_IMG']) {
    vm.runInContext(linhaConst(nome), ctx);
  }
  vm.runInContext(pegarBloco(main, 'function remotoDoPedido(', 'remotoDoPedido'), ctx);
  vm.runInContext(pegarBloco(main, 'function hostPrivado(', 'hostPrivado'), ctx);
  vm.runInContext(pegarBloco(main, 'function recusaDoEnderecoDaWeb(', 'recusaDoEnderecoDaWeb'), ctx);
  vm.runInContext(pegarBloco(main, 'async function imagemDaWeb(', 'imagemDaWeb'), ctx);
  vm.runInContext(pegarBloco(main, 'async function imagemDoDocumento(', 'imagemDoDocumento'), ctx);
  vm.runInContext(trechoDoCanal('arquivo:imagemMd'), ctx);
  return { ctx, toques, logs, temporizadores, tetosPedidos, requisicoes: net.requisicoes, chamar: async (o) => simples(await handlers['arquivo:imagemMd']({}, o)) };
}
const arquivoFalso = (bytes, size = bytes.length) => ({
  stat: async () => ({ isFile: () => true, size }),
  lerArquivo: async () => bytes,
});

test('main.js: o canal arquivo:imagemMd existe, com o teto de 10 MB e o relógio de 10 s', () => {
  assert.match(linhaConst('TETO_IMG_DOC'), /10 \* 1024 \* 1024/);
  assert.match(linhaConst('TEMPO_IMG_WEB'), /10000/);
  assert.match(trechoDoCanal('arquivo:imagemMd'), /imagemDoDocumento\(/);
});

test('arquivo local: vira data: com o tipo certo pela extensão (png, jpg, svg...), lido de forma assíncrona', async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-imgmd-'));
  try {
    for (const [nome, mime] of [['grafico.png', 'image/png'], ['foto.jpg', 'image/jpeg'], ['FOTO.JPEG', 'image/jpeg'], ['logo.svg', 'image/svg+xml'], ['a.gif', 'image/gif'], ['b.webp', 'image/webp']]) {
      const alvo = path.join(pasta, nome);
      fs.writeFileSync(alvo, PNG);
      const m = montarMain({ stat: (p) => fs.promises.stat(p), lerArquivo: (p) => fs.promises.readFile(p) });
      const r = await m.chamar({ arquivo: alvo });
      assert.equal(r.dados, 'data:' + mime + ';base64,' + PNG.toString('base64'), nome);
      assert.equal(r.erro, undefined, nome);
      assert.deepEqual(m.toques, ['fs.stat ' + alvo, 'fs.readFile ' + alvo], nome);
    }
  } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
});

test('arquivo local: acima de 10 MB vira erro SEM ler o arquivo; exatamente 10 MB ainda carrega', async () => {
  const gordo = montarMain(arquivoFalso(Buffer.alloc(8), TETO + 1));
  const r = await gordo.chamar({ arquivo: 'C:\\docs\\gordo.png' });
  assert.equal(r.dados, undefined);
  assert.match(r.erro, /10 MB/);
  assert.deepEqual(gordo.toques, ['fs.stat C:\\docs\\gordo.png'], 'o tamanho vem do stat: não lê 10 MB à toa');

  const limite = montarMain(arquivoFalso(Buffer.alloc(8), TETO));
  assert.match((await limite.chamar({ arquivo: 'C:\\docs\\limite.png' })).dados, /^data:image\/png;base64,/);
});

test('arquivo local: o arquivo que cresceu entre o stat e a leitura também é recusado', async () => {
  const m = montarMain({ stat: async () => ({ isFile: () => true, size: 4 }), lerArquivo: async () => Buffer.alloc(TETO + 1) });
  const r = await m.chamar({ arquivo: 'C:\\docs\\cresceu.png' });
  assert.equal(r.dados, undefined);
  assert.match(r.erro, /10 MB/);
});

test('arquivo local: só extensão de imagem, e só caminho absoluto; o resto volta erro sem encostar no disco', async () => {
  for (const arquivo of [
    'C:\\docs\\nota.txt', 'C:\\docs\\README.md', 'C:\\docs\\a.exe', 'C:\\docs\\a.png.exe', 'C:\\docs\\a.html', 'C:\\docs\\semextensao', 'C:\\docs\\a.png.',
    'C:\\docs\\.png', 'C:\\docs\\a.heic', 'C:\\docs\\a.pdf',
    'a.png', './a.png', '../a.png', 'img\\a.png', '~/a.png',                  // não é absoluto: o main não adivinha a pasta
    'C:\\docs\\a\u0000.png', 'C:\\docs\\a\t.png', '/\t/servidor/a.png',      // controle no meio do caminho
  ]) {
    const m = montarMain();
    const r = await m.chamar({ arquivo });
    assert.equal(typeof r.erro, 'string', JSON.stringify(arquivo));
    assert.equal(r.dados, undefined, JSON.stringify(arquivo));
    assert.deepEqual(m.toques, [], 'encostou em algo: ' + JSON.stringify(arquivo));
  }
});

test('arquivo local: pasta, dispositivo e coisa que não é arquivo não são lidos', async () => {
  const m = montarMain({ stat: async () => ({ isFile: () => false, size: 0 }), lerArquivo: async () => PNG });
  const r = await m.chamar({ arquivo: 'C:\\docs\\pasta.png' });
  assert.equal(r.dados, undefined);
  assert.equal(typeof r.erro, 'string');
  assert.deepEqual(m.toques, ['fs.stat C:\\docs\\pasta.png']);
});

test('arquivo local: sumiu = aviso curto sem poluir o log; erro de verdade do disco vai para o log', async () => {
  const sumiu = montarMain({ stat: async () => { throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }); } });
  assert.match((await sumiu.chamar({ arquivo: 'C:\\docs\\sumiu.png' })).erro, /achei/);
  assert.deepEqual(sumiu.logs, [], 'imagem que não existe é comum num .md: não vai para o log');

  const negado = montarMain({ stat: async () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }); } });
  const r = await negado.chamar({ arquivo: 'C:\\docs\\negado.png' });
  assert.equal(typeof r.erro, 'string');
  assert.equal(negado.logs.length, 1, 'falha de verdade vai para o tela.log');
  assert.match(negado.logs[0][0], /imagem/i);
});

test('caminho de rede é recusado ANTES de qualquer fs.*, de rede e de ssh (local, servidor e url)', async () => {
  for (const arquivo of REDE) {
    for (const pedido of [{ arquivo }, { arquivo, remoto: REMOTO }]) {
      const m = montarMain();
      const r = await m.chamar(pedido);
      assert.equal(r.erro, MSG_REDE, JSON.stringify(pedido));
      assert.equal(r.dados, undefined, JSON.stringify(pedido));
      assert.deepEqual(m.toques, [], 'encostou em algo: ' + JSON.stringify(pedido));
    }
  }
  // file://host é rede, e nenhum file: vale como endereço de imagem: nada toca disco, servidor nem rede
  for (const pedido of [{ arquivo: 'file://servidor/pasta/a.png' }, { arquivo: 'file://servidor/pasta/a.png', remoto: REMOTO }]) {
    const m = montarMain();
    assert.equal((await m.chamar(pedido)).erro, MSG_REDE, JSON.stringify(pedido));
    assert.deepEqual(m.toques, [], JSON.stringify(pedido));
  }
  for (const pedido of [{ url: 'file://servidor/pasta/a.png' }, { url: 'file:///C:/a.png' }, { arquivo: 'file:///C:/a.png' }]) {
    const m = montarMain();
    const r = await m.chamar(pedido);
    assert.equal(typeof r.erro, 'string', JSON.stringify(pedido));
    assert.equal(r.dados, undefined, JSON.stringify(pedido));
    assert.deepEqual(m.toques, [], JSON.stringify(pedido));
  }
});

test('pedido torto não faz nada: sem url nem arquivo, os dois juntos, tipos errados', async () => {
  for (const pedido of [undefined, null, 42, 'C:\\a.png', {}, { url: 1 }, { arquivo: 2 }, { url: '', arquivo: '' }, { url: 'https://exemplo.com/a.png', arquivo: 'C:\\a.png' }]) {
    const m = montarMain();
    const r = await m.chamar(pedido);
    assert.equal(typeof r.erro, 'string', JSON.stringify(pedido));
    assert.deepEqual(m.toques, [], JSON.stringify(pedido));
  }
});

test('o canal nunca rejeita: uma falha inesperada vira { erro } e vai para o log', async () => {
  const m = montarMain({ stat: async () => { throw new TypeError('bug qualquer'); } });
  const r = await m.chamar({ arquivo: 'C:\\docs\\a.png' });
  assert.equal(typeof r.erro, 'string');
  assert.equal(m.logs.length, 1);
});

/* ---------- imagem da web (https) ---------- */
const resposta = (corpo, { status = 200, tipo = 'image/png', cabecalhos = {} } = {}) =>
  new Response(corpo, { status, headers: { ...(tipo ? { 'content-type': tipo } : {}), ...cabecalhos } });

test('https: o main busca com net.request (redirect manual, sem cookie, com relógio) e devolve data:', async () => {
  let pedido = null;
  const m = montarMain({ rede: (url, init) => { pedido = { url, init }; return resposta(PNG); } });
  const r = await m.chamar({ url: 'https://exemplo.com/img/a.png?v=2' });
  assert.equal(r.dados, PNG_URL);
  assert.deepEqual(m.toques, ['net.request https://exemplo.com/img/a.png?v=2']);
  assert.equal(pedido.init.credentials, 'omit', 'sem cookie do app');
  assert.equal(m.requisicoes[0].opcoes.redirect, 'manual', 'cada salto passa pela conferência: o Electron não segue sozinho');
  assert.equal(m.requisicoes[0].opcoes.method, 'GET');
  assert.equal(m.requisicoes[0].cabecalhos.accept, 'image/*');
  assert.equal(m.temporizadores.size, 0, 'o relógio de 10 s é desligado no fim');
});

test('https: content-type com parâmetro e svg valem; o que não é image/* é recusado', async () => {
  const ok = montarMain({ rede: () => resposta(PNG, { tipo: 'Image/PNG; charset=binary' }) });
  assert.match((await ok.chamar({ url: 'https://exemplo.com/a' })).dados, /^data:image\/png;base64,/);
  const svg = montarMain({ rede: () => resposta('<svg xmlns="http://www.w3.org/2000/svg"/>', { tipo: 'image/svg+xml' }) });
  assert.match((await svg.chamar({ url: 'https://exemplo.com/a.svg' })).dados, /^data:image\/svg\+xml;base64,/);
  for (const tipo of ['text/html', 'application/octet-stream', 'application/json', 'image/', 'imagem/png', 'image/png,<script>', 'image/p ng', null]) {
    const m = montarMain({ rede: () => resposta('<html>', { tipo }) });
    const r = await m.chamar({ url: 'https://exemplo.com/a.png' });
    assert.equal(r.dados, undefined, String(tipo));
    assert.equal(typeof r.erro, 'string', String(tipo));
  }
});

test('https: só https; http, file, data, ftp, login na url e endereço torto nem chegam na rede', async () => {
  for (const url of [
    'http://exemplo.com/a.png', 'file:///C:/a.png', 'file://servidor/a.png', 'data:image/png;base64,AAAA', 'ftp://exemplo.com/a.png', 'javascript:alert(1)',
    'https://usuario:senha@exemplo.com/a.png', 'https://usuario@exemplo.com/a.png', 'https://', '//exemplo.com/a.png', 'exemplo.com/a.png', 'https//exemplo.com',
  ]) {
    const m = montarMain({ rede: () => resposta(PNG) });
    const r = await m.chamar({ url });
    assert.equal(r.dados, undefined, url);
    assert.equal(typeof r.erro, 'string', url);
    assert.deepEqual(m.toques, [], 'foi para a rede: ' + url);
  }
});

test('https: status de erro e falha de rede viram { erro }; só a falha de verdade vai para o log', async () => {
  for (const status of [301, 403, 404, 500]) {
    let sinal;
    const m = montarMain({ rede: (_url, init) => { sinal = init.signal; return resposta('nao', { status }); } });
    const r = await m.chamar({ url: 'https://exemplo.com/a.png' });
    assert.equal(r.dados, undefined, String(status));
    assert.match(r.erro, new RegExp(String(status)));
    assert.deepEqual(m.logs, [], String(status));
    assert.equal(sinal.aborted, true, 'resposta recusada não segura a conexão: ' + status);
  }
  const fora = montarMain({ rede: async () => { throw new TypeError('fetch failed'); } });
  assert.equal(typeof (await fora.chamar({ url: 'https://exemplo.com/a.png' })).erro, 'string');
  assert.equal(fora.logs.length, 1);
  assert.equal(fora.temporizadores.size, 0);
});

test('https: acima do teto pelo content-length nem lê o corpo; sem content-length para de ler ao passar de 10 MB', async () => {
  let pulls = 0, sinal;
  const declarado = montarMain({ rede: (_url, init) => {
    sinal = init.signal;
    const corpo = new ReadableStream({ pull(c) { pulls++; c.enqueue(new Uint8Array(1024)); } });
    return resposta(corpo, { cabecalhos: { 'content-length': String(TETO + 1) } });
  } });
  const r1 = await declarado.chamar({ url: 'https://exemplo.com/gordo.png' });
  assert.match(r1.erro, /10 MB/);
  assert.ok(pulls <= 1, 'o content-length já diz que não cabe: nenhuma leitura (o stream puxa 1 pedaço sozinho ao nascer; puxou ' + pulls + ')');
  assert.equal(sinal.aborted, true, 'a requisição é abortada: a resposta que não foi lida não segura a conexão');

  let pedacos = 0;
  const mentiroso = montarMain({ rede: () => resposta(new ReadableStream({ pull(c) { pedacos++; c.enqueue(new Uint8Array(1024 * 1024)); if (pedacos >= 40) c.close(); } })) });
  const r2 = await mentiroso.chamar({ url: 'https://exemplo.com/infinito.png' });
  assert.equal(r2.dados, undefined);
  assert.match(r2.erro, /10 MB/);
  assert.ok(pedacos <= 13, 'parou de ler logo depois do teto (leu ' + pedacos + ' pedaços de 1 MB)');
  assert.equal(mentiroso.temporizadores.size, 0);
});

test('https: o servidor que não responde estoura o relógio, devolve { erro } e não deixa relógio sobrando', async () => {
  const m = montarMain({ rede: (_url, init) => new Promise((_, rejeita) => {
    init.signal.addEventListener('abort', () => rejeita(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })));
  }) });
  const t0 = Date.now();
  const r = simples(await m.ctx.imagemDaWeb('https://exemplo.com/lento.png', 30));   // o 2º parâmetro encurta o relógio só no teste
  assert.ok(Date.now() - t0 < 2000, 'não esperou os 10 s de verdade');
  assert.equal(r.dados, undefined);
  assert.match(r.erro, /demorou|10 s/);
  assert.deepEqual(m.logs, [], 'estouro de relógio é esperado: não vai para o log');
  assert.equal(m.temporizadores.size, 0);
});

test('https: o relógio também vale para o corpo (servidor que manda os cabeçalhos e trava)', async () => {
  const m = montarMain({ rede: (_url, init) => {
    const corpo = new ReadableStream({
      start(c) { init.signal.addEventListener('abort', () => c.error(Object.assign(new Error('aborted'), { name: 'AbortError' }))); },
      pull() { return new Promise(() => {}); },
    });
    return resposta(corpo);
  } });
  const r = simples(await m.ctx.imagemDaWeb('https://exemplo.com/trava.png', 30));
  assert.equal(r.dados, undefined);
  assert.match(r.erro, /demorou|10 s/);
  assert.equal(m.temporizadores.size, 0);
});

test('https: resposta sem corpo legível vira erro, não imagem vazia', async () => {
  const m = montarMain({ rede: () => resposta(null) });
  const r = await m.chamar({ url: 'https://exemplo.com/vazia.png' });
  assert.equal(r.dados, undefined);
  assert.equal(typeof r.erro, 'string');
});

test('o main busca a imagem pelo net.request do Electron (a rede do Chromium), nunca pelo net.fetch nem pelo fetch do Node', () => {
  // o ctx dos testes acima não tem "fetch" global e o net.fetch dele explode: se o código os chamasse, o teste de sucesso falharia
  const bloco = pegarBloco(main, 'async function imagemDaWeb(', 'imagemDaWeb');
  assert.match(bloco, /net\.request\(/, 'a busca é pelo net.request do Electron: só ele deixa conferir cada redirecionamento');
  assert.match(bloco, /redirect: 'manual'/);
  assert.match(bloco, /followRedirect\(\)/);
  assert.doesNotMatch(bloco, /\bfetch\(/, 'nenhum fetch (o net.fetch do Electron também segue redirecionamento sozinho)');
});

/* ---------- https: SSRF (host privado e redirecionamento) ---------- */
/* Quem escreve o .md escolhe o endereço da imagem. Sem estas travas, ele faria o PC buscar o roteador, um serviço local ou
   a nuvem de metadados (169.254.169.254): direto, ou por um host "público" que redireciona para dentro (https → http,
   público → 127.0.0.1/LAN). Cada salto passa pela MESMA conferência do 1º endereço: só https, sem login, sem host privado. */
const PRIVADOS = {
  'localhost': ['localhost', 'LOCALHOST', 'localhost.', 'api.localhost', 'a.b.localhost'],
  '*.local': ['impressora.local', 'nas.casa.local', 'impressora.local.'],
  '*.internal': ['metadata.google.internal', 'x.internal'],
  'host sem ponto': ['intranet', 'servidor', 'wpad'],
  '127/8': ['127.0.0.1', '127.255.255.254', '127.1', '2130706433', '0x7f.1', '0177.0.0.1', '0x7f000001'],
  '10/8': ['10.0.0.1', '10.255.255.255'],
  '172.16/12': ['172.16.0.1', '172.20.1.1', '172.31.255.255'],
  '192.168/16': ['192.168.0.1', '192.168.255.255'],
  '169.254/16': ['169.254.169.254', '169.254.0.1'],
  '100.64/10': ['100.64.0.1', '100.127.255.255'],
  '0.0.0.0': ['0.0.0.0', '0.1.2.3'],
  '::1': ['[::1]', '[0:0:0:0:0:0:0:1]', '[::]'],
  'fc00::/7': ['[fc00::1]', '[fd12:3456:789a::1]', '[fdff:ffff::1]'],
  'fe80::/10': ['[fe80::1]', '[fe80::1234:5678]', '[febf::1]'],
  '::ffff: (IPv4 mapeado)': ['[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '[::ffff:192.168.1.1]', '[::ffff:10.0.0.1]', '[::ffff:a9fe:a9fe]'],
};
const PUBLICOS = [
  'exemplo.com', 'img.shields.io', 'raw.githubusercontent.com', 'cdn.exemplo.com.br', 'imágenes.exemplo.com',
  'localhost.exemplo.com', 'local.exemplo.com', 'internal.exemplo.com', 'a.internal.exemplo.com',   // a palavra no meio não é o sufixo
  '8.8.8.8', '1.1.1.1', '9.255.255.255', '11.0.0.1', '126.255.255.255', '128.0.0.1',               // bordas de 10/8 e 127/8
  '172.15.255.255', '172.32.0.1', '192.167.255.255', '192.169.0.1',                                // bordas de 172.16/12 e 192.168/16
  '169.253.255.255', '169.255.0.1', '100.63.255.255', '100.128.0.1',                               // bordas de 169.254/16 e 100.64/10
  '[2001:4860:4860::8888]', '[2606:4700:4700::1111]', '[fbff::1]', '[fe7f::1]',                    // bordas de fc00::/7 e fe80::/10
];
const hostDe = (h) => new URL('https://' + h + '/').hostname;   // o mesmo caminho do main: new URL() normaliza 2130706433, 0x7f.1, IPv6

test('SSRF: hostPrivado recusa UMA faixa por vez (localhost, .local, .internal, sem ponto, IPv4, IPv6 e IPv4 mapeado)', () => {
  const m = montarMain();
  for (const [faixa, hosts] of Object.entries(PRIVADOS)) {
    for (const h of hosts) assert.equal(m.ctx.hostPrivado(hostDe(h)), true, faixa + ': ' + h);
  }
});

test('SSRF: host público passa, inclusive logo ao lado de cada faixa privada', () => {
  const m = montarMain();
  for (const h of PUBLICOS) assert.equal(m.ctx.hostPrivado(hostDe(h)), false, h);
});

test('SSRF: o 1º endereço em host privado nem sai pra rede', async () => {
  for (const [faixa, hosts] of Object.entries(PRIVADOS)) {
    for (const h of hosts) {
      const m = montarMain({ rede: () => resposta(PNG) });
      const r = await m.chamar({ url: 'https://' + h + '/a.png?x=1' });
      assert.equal(r.dados, undefined, faixa + ': ' + h);
      assert.equal(typeof r.erro, 'string', faixa + ': ' + h);
      assert.deepEqual(m.toques, [], 'foi pra rede: ' + h);
      assert.equal(m.temporizadores.size, 0, h);
    }
  }
  for (const h of PUBLICOS.slice(0, 4)) {
    const m = montarMain({ rede: () => resposta(PNG) });
    assert.equal((await m.chamar({ url: 'https://' + h + '/a.png' })).dados, PNG_URL, h);
  }
});

test('SSRF: redirecionamento para http, IP privado, localhost ou fora do https é recusado e o destino NUNCA é pedido', async () => {
  const destinos = [
    'http://127.0.0.1/', 'https://192.168.0.1/', 'https://localhost/a.png', 'http://exemplo.com/a.png', 'https://[::1]/a.png',
    'https://169.254.169.254/latest/meta-data/', 'https://10.0.0.5/a.png', 'https://impressora.local/a.png', 'https://[::ffff:127.0.0.1]/',
    'https://100.64.0.1/a.png', 'https://intranet/a.png', 'https://2130706433/a.png', 'ftp://exemplo.com/a.png', 'file:///C:/a.png',
    'data:image/png;base64,AAAA', 'https://usuario:senha@exemplo.com/a.png',
  ];
  for (const destino of destinos) {
    const m = montarMain({ rede: (url) => (url === 'https://exemplo.com/foto.png' ? { redirecionar: destino, status: 302 } : resposta(PNG)) });
    const r = await m.chamar({ url: 'https://exemplo.com/foto.png' });
    assert.equal(r.dados, undefined, destino);
    assert.match(r.erro, /https|rede interna/i, 'o motivo certo, não "falhou": ' + destino);
    assert.deepEqual(m.toques, ['net.request https://exemplo.com/foto.png'], 'o destino foi pedido: ' + destino);
    assert.equal(m.requisicoes[0].abortado, true, 'o pedido é cortado de propósito (não fica pendurado): ' + destino);
    assert.equal(m.temporizadores.size, 0, destino);
  }
});

test('SSRF: o mesmo vale no 2º, 3º... salto (público → público → privado)', async () => {
  const m = montarMain({ rede: (url) => (url.endsWith('/a') ? { redirecionar: 'https://cdn.exemplo.net/b' } : url.endsWith('/b') ? { redirecionar: 'https://192.168.0.1/c' } : resposta(PNG)) });
  const r = await m.chamar({ url: 'https://exemplo.com/a' });
  assert.equal(r.dados, undefined);
  assert.deepEqual(m.toques, ['net.request https://exemplo.com/a', 'salto https://cdn.exemplo.net/b'], 'o 192.168.0.1 nunca foi pedido');
  assert.equal(m.requisicoes[0].abortado, true);
});

test('SSRF: redirecionamento https → https público é seguido (301, 302, 303, 307, 308) e a imagem chega', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const m = montarMain({ rede: (url) => (url === 'https://exemplo.com/foto' ? { redirecionar: 'https://cdn.exemplo.net/img/foto.png', status } : resposta(PNG)) });
    const r = await m.chamar({ url: 'https://exemplo.com/foto' });
    assert.equal(r.dados, PNG_URL, String(status));
    assert.deepEqual(m.toques, ['net.request https://exemplo.com/foto', 'salto https://cdn.exemplo.net/img/foto.png'], String(status));
    assert.equal(m.logs.length, 0, 'seguir um redirecionamento bom não vai pro log');
  }
});

test('SSRF: até 5 saltos; o 6º é recusado, e um laço de redirecionamento não prende o app', async () => {
  const cadeia = (saltos) => (url) => { const n = Number(url.split('/s').pop()); return n < saltos ? { redirecionar: 'https://exemplo.com/s' + (n + 1) } : resposta(PNG); };
  const cinco = montarMain({ rede: cadeia(5) });
  assert.equal((await cinco.chamar({ url: 'https://exemplo.com/s0' })).dados, PNG_URL, '5 redirecionamentos ainda passam');
  assert.equal(cinco.toques.length, 6, 'o pedido de origem + 5 saltos');
  const seis = montarMain({ rede: cadeia(6) });
  const r = await seis.chamar({ url: 'https://exemplo.com/s0' });
  assert.equal(r.dados, undefined);
  assert.match(r.erro, /redirecionamentos/i);
  assert.equal(seis.toques.length, 6, 'o 6º salto não foi pedido: parou no teto de 5');
  assert.equal(seis.requisicoes[0].abortado, true);
  const laco = montarMain({ rede: () => ({ redirecionar: 'https://exemplo.com/a' }) });
  assert.match((await laco.chamar({ url: 'https://exemplo.com/a' })).erro, /redirecionamentos/i);
  assert.equal(laco.toques.length, 6);
  assert.equal(laco.temporizadores.size, 0);
});

test('SSRF: Location inválida ou vazia é recusada (sem seguir) e nenhum relógio sobra', async () => {
  for (const destino of ['', ':::', 'http://', 'https://']) {
    const m = montarMain({ rede: () => ({ redirecionar: destino }) });
    const r = await m.chamar({ url: 'https://exemplo.com/foto.png' });
    assert.equal(r.dados, undefined, JSON.stringify(destino));
    assert.equal(typeof r.erro, 'string', JSON.stringify(destino));
    assert.equal(m.toques.length, 1, JSON.stringify(destino));
    assert.equal(m.requisicoes[0].abortado, true, JSON.stringify(destino));
    assert.equal(m.temporizadores.size, 0, JSON.stringify(destino));
  }
});

test('SSRF: o redirecionamento recusado vai pro log só com o host (nunca o caminho nem a query, que podem ter segredo)', async () => {
  const m = montarMain({ rede: () => ({ redirecionar: 'https://192.168.0.1/admin/segredo.png?token=abc123' }) });
  await m.chamar({ url: 'https://exemplo.com/foto.png' });
  assert.equal(m.logs.length, 1);
  assert.equal(m.logs[0][0], 'arquivo:imagemMd');
  assert.match(m.logs[0][1], /192\.168\.0\.1/);
  assert.doesNotMatch(m.logs[0][1], /admin|segredo|token|abc123/);
});

test('SSRF: o relógio de 10 s vale para o caminho todo (um salto bom e depois um servidor mudo)', async () => {
  const m = montarMain({ rede: (url, init) => (url.endsWith('/a') ? { redirecionar: 'https://cdn.exemplo.net/b' }
    : new Promise((_, rejeita) => init.signal.addEventListener('abort', () => rejeita(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) });
  const t0 = Date.now();
  const r = simples(await m.ctx.imagemDaWeb('https://exemplo.com/a', 30));
  assert.ok(Date.now() - t0 < 2000);
  assert.match(r.erro, /demorou|10 s/);
  assert.equal(m.requisicoes[0].abortado, true);
  assert.equal(m.temporizadores.size, 0);
});

/* ---------- servidor (VPS) ---------- */
test('servidor: a imagem já resolvida vai pelo canal remoto que existe (verArquivoRemoto) e volta como data:', async () => {
  const chamadas = [];
  const m = montarMain({ remoto: async (rem, arquivo) => { chamadas.push([simples(rem), arquivo]); return { tipo: 'imagem', dados: 'data:image/png;base64,AAAA', bytes: 3, nome: 'a.png' }; } });
  const r = await m.chamar({ arquivo: '/home/hugo/app/img/a.png', remoto: REMOTO });
  assert.deepEqual(r, { dados: 'data:image/png;base64,AAAA', bytes: 3 });
  assert.deepEqual(chamadas, [[REMOTO, '/home/hugo/app/img/a.png']]);
  assert.deepEqual(m.toques, ['ssh /home/hugo/app/img/a.png'], 'nada do disco deste PC');
  const til = montarMain({ remoto: async () => ({ tipo: 'imagem', dados: 'data:image/png;base64,AAAA', bytes: 3 }) });
  assert.equal(typeof (await til.chamar({ arquivo: '~/app/a.png', remoto: REMOTO })).dados, 'string', '~/ também é caminho do servidor');
});

test('servidor: acima de 10 MB, tipo que não é imagem, erro do servidor e extensão fora da lista viram { erro }', async () => {
  const gordo = montarMain({ remoto: async () => ({ tipo: 'imagem', dados: 'data:image/png;base64,AAAA', bytes: TETO + 1 }) });
  assert.match((await gordo.chamar({ arquivo: '/srv/a.png', remoto: REMOTO })).erro, /10 MB/);
  const outro = montarMain({ remoto: async () => ({ tipo: 'outro', bytes: 30 * 1024 * 1024 }) });
  assert.equal(typeof (await outro.chamar({ arquivo: '/srv/a.png', remoto: REMOTO })).erro, 'string');
  const caiu = montarMain({ remoto: async () => ({ erro: 'Não achei este arquivo no servidor.' }) });
  assert.equal((await caiu.chamar({ arquivo: '/srv/a.png', remoto: REMOTO })).erro, 'Não achei este arquivo no servidor.');
  const txt = montarMain({ remoto: async () => ({ tipo: 'texto', dados: 'x' }) });
  const r = await txt.chamar({ arquivo: '/srv/a.txt', remoto: REMOTO });
  assert.equal(typeof r.erro, 'string');
  assert.deepEqual(txt.toques, [], 'extensão que não é de imagem nem chega no servidor');
  const relativo = montarMain();
  assert.equal(typeof (await relativo.chamar({ arquivo: 'a.png', remoto: REMOTO })).erro, 'string', 'o main não adivinha a pasta do servidor');
  assert.deepEqual(relativo.toques, []);
});

test('servidor: o teto de 10 MB vai no PEDIDO ao servidor, e imagem maior volta como erro sem baixar nada', async () => {
  const gorda = montarMain({ remoto: async () => ({ tipo: 'grande', bytes: 12 * 1024 * 1024, limite: TETO, nome: 'a.png' }) });
  assert.deepEqual(await gorda.chamar({ arquivo: '/srv/a.png', remoto: REMOTO }), { erro: 'Imagem maior que 10 MB.' });
  assert.deepEqual(gorda.tetosPedidos, [TETO], 'o handler passa o teto de 10 MB para o verArquivoRemoto');
  const boa = montarMain({ remoto: async () => ({ tipo: 'imagem', dados: 'data:image/png;base64,AAAA', bytes: 3 }) });
  assert.equal((await boa.chamar({ arquivo: '/srv/a.png', remoto: REMOTO })).dados, 'data:image/png;base64,AAAA');
  assert.deepEqual(boa.tetosPedidos, [TETO]);
});

/* o verArquivoRemoto de verdade (recortado do main.js), com o servidor de mentira: o que o ssh executaria fica em `scripts` */
function leitorRemoto() {
  const scripts = [];
  let respostaDoServidor = { out: '' };
  const ini = main.indexOf("const EXT_VIS_IMG = ['png'");
  const fim = main.indexOf('/* O mesmo arquivo, mas no servidor.');
  assert.ok(ini > 0 && fim > ini, 'não achei o trecho do leitor no main.js');
  const ctx = { fs: {}, path, Buffer, TextDecoder, execRemoto: async (_remoto, script) => { scripts.push(script); return respostaDoServidor; } };
  vm.createContext(ctx);
  vm.runInContext([main.slice(ini, fim), pegarBloco(main, 'function qLinux(', 'qLinux'), pegarBloco(main, 'function qRemoto(', 'qRemoto'),
    pegarBloco(main, 'async function verArquivoRemoto(', 'verArquivoRemoto'), 'this.verArquivoRemoto = verArquivoRemoto;'].join('\n'), ctx);
  return {
    scripts,
    ver: async (arquivo, r, ...extra) => { respostaDoServidor = r; scripts.length = 0; return simples(await ctx.verArquivoRemoto(REMOTO, arquivo, ...extra)); },
  };
}
const pacoteDoServidor = (bytes, buf) => ({ out: 'COCKPIT_TAM ' + bytes + '\n' + (buf ? buf.toString('base64') : '') });

test('verArquivoRemoto: aceita o teto da imagem — 10 MB no comando do servidor; sem ele, segue o teto de 25 MB do leitor', async () => {
  const { ver, scripts } = leitorRemoto();
  // com o teto de 10 MB: 12 MB volta "grande" com o limite pedido (o servidor nem manda o base64: o guarda do comando é -le 10 MB)
  const gorda = await ver('/srv/a.png', pacoteDoServidor(12 * 1024 * 1024), TETO);
  assert.match(scripts[0], new RegExp('-le ' + TETO + '\\b'), 'o teto do pedido está no comando que roda no servidor');
  assert.doesNotMatch(scripts[0], new RegExp('-le ' + TETO_LEITOR + '\\b'));
  assert.equal(gorda.tipo, 'grande');
  assert.equal(gorda.limite, TETO);
  assert.equal(gorda.dados, undefined);
  // uma imagem de 8 MB cabe nos dois
  const cabe = await ver('/srv/b.png', pacoteDoServidor(PNG.length, PNG), TETO);
  assert.equal(cabe.tipo, 'imagem');
  assert.equal(cabe.dados, PNG_URL);
  // sem o 3º parâmetro nada muda: é o teto do leitor (o arquivo:ver do visor)
  const padrao = await ver('/srv/a.png', pacoteDoServidor(12 * 1024 * 1024, PNG));
  assert.match(scripts[0], new RegExp('-le ' + TETO_LEITOR + '\\b'));
  assert.equal(padrao.tipo, 'imagem', '12 MB cabe no teto do leitor de 25 MB');
  // o teto da imagem não mexe no do texto
  const texto = await ver('/srv/leia.md', pacoteDoServidor(3, Buffer.from('oi\n')), TETO);
  assert.match(scripts[0], new RegExp('-le ' + 600 * 1024 + '\\b'));
  assert.equal(texto.tipo, 'texto');
});

test('servidor: remoto torto nunca vira leitura do disco DESTE PC; sem remoto lê aqui como sempre', async () => {
  for (const remoto of [{}, 'vps', 5, true, { host: '' }, []]) {
    const m = montarMain(arquivoFalso(PNG));
    const r = await m.chamar({ arquivo: 'C:\\docs\\a.png', remoto });
    assert.equal(typeof r.erro, 'string', JSON.stringify(remoto));
    assert.equal(r.dados, undefined, JSON.stringify(remoto));
    assert.deepEqual(m.toques, [], JSON.stringify(remoto));
  }
  for (const remoto of [undefined, null, false, 0, '']) {
    const m = montarMain(arquivoFalso(PNG));
    assert.equal((await m.chamar({ arquivo: 'C:\\docs\\a.png', remoto })).dados, PNG_URL, JSON.stringify(remoto));
  }
});

/* =====================================================================
   A CSP não abre
   ===================================================================== */
test('a CSP da tela continua img-src \'self\' data: (https não entra), e o main não mexe nos cabeçalhos', () => {
  const html = fs.readFileSync(path.join(RAIZ, 'src', 'renderer', 'index.html'), 'utf8');
  const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1];
  assert.ok(csp, 'não achei a CSP do index.html');
  assert.match(csp, /(?:^|;\s*)img-src 'self' data:(?:;|$)/);
  assert.doesNotMatch(csp, /https?:/, 'nenhuma fonte de rede na CSP');
  assert.doesNotMatch(main, /onHeadersReceived|Content-Security-Policy/i, 'o main não reescreve a CSP');
});

/* =====================================================================
   A tela: o trecho REAL do visor (app.js) rodando num vm, com um DOM de mentira
   ===================================================================== */
const app = lerFonte('renderer', 'app.js');
const trechoVisor = app.slice(
  app.indexOf('/* ============ visualizador de arquivo ============ */'),
  app.indexOf('/* ============ conversas recentes ============ */'));
assert.ok(trechoVisor.length > 200, 'não achei o trecho do visor no app.js');

class No {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.classes = new Set(); this.filhos = []; this.pai = null;
    this.attrs = {}; this.dataset = {}; this.style = {}; this.eventos = {};
    this.texto = ''; this.html = ''; this.scrollTop = 0; this.title = ''; this.focos = 0;
  }
  get className() { return [...this.classes].join(' '); }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() {
    const no = this;
    return {
      add: (...c) => c.forEach((x) => no.classes.add(x)),
      remove: (...c) => c.forEach((x) => no.classes.delete(x)),
      contains: (c) => no.classes.has(c),
      toggle: (c, liga) => { const on = liga === undefined ? !no.classes.has(c) : !!liga; if (on) no.classes.add(c); else no.classes.delete(c); return on; },
    };
  }
  get innerHTML() { return this.html; }
  /* sem parser de HTML de verdade: só as <img> do que o teste manda entram como filhos (com os atributos) */
  set innerHTML(v) {
    this.html = String(v); this.texto = ''; this.esvaziar();
    for (const m of this.html.matchAll(/<img\b([^>]*)>/gi)) {
      const img = new No('img');
      for (const a of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) img.setAttribute(a[1], a[2]);
      this.appendChild(img);
    }
  }
  get textContent() { return this.texto + this.filhos.map((f) => f.textContent).join(''); }
  set textContent(v) { this.texto = String(v); this.esvaziar(); }
  get src() { return this.getAttribute('src') ?? ''; }
  set src(v) { this.setAttribute('src', v); }
  get isConnected() { return true; }
  get descendentes() { return this.filhos.flatMap((f) => [f, ...f.descendentes]); }
  esvaziar() { for (const f of this.filhos) f.pai = null; this.filhos = []; }
  tirar(f) { if (f.pai) f.pai.filhos = f.pai.filhos.filter((x) => x !== f); f.pai = null; }
  appendChild(f) { this.tirar(f); f.pai = this; this.filhos.push(f); return f; }
  prepend(f) { this.tirar(f); f.pai = this; this.filhos.unshift(f); }
  after(f) { this.tirar(f); const i = this.pai.filhos.indexOf(this); f.pai = this.pai; this.pai.filhos.splice(i + 1, 0, f); }
  before(f) { this.tirar(f); const i = this.pai.filhos.indexOf(this); f.pai = this.pai; this.pai.filhos.splice(i, 0, f); }
  closest(tag) { for (let p = this; p; p = p.pai) if (p.tagName === String(tag).toUpperCase()) return p; return null; }
  replaceWith(no) { if (!this.pai) return; no.tirar(no); const i = this.pai.filhos.indexOf(this); no.pai = this.pai; this.pai.filhos.splice(i, 1, no); this.pai = null; }
  remove() { this.tirar(this); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(nome, f) { (this.eventos[nome] = this.eventos[nome] || []).push(f); }
  removeEventListener(nome, f) { this.eventos[nome] = (this.eventos[nome] || []).filter((x) => x !== f); }
  focus() { this.focos++; }
  // o navegador só dá o tamanho da imagem DEPOIS de carregada: o teste decide quando isso acontece (No.carregando = ainda não; dispara o load)
  get complete() { return !No.carregando; }
  scrollIntoView() {}
  contains(no) { for (let p = no; p; p = p.pai) if (p === this) return true; return false; }
  querySelectorAll(sel) {
    const casa = (n) => sel.split(',').map((s) => s.trim()).some((s) => (s.startsWith('.') ? n.classes.has(s.slice(1)) : n.tagName.toLowerCase() === s));
    return this.descendentes.filter(casa);
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
No.carregando = false;
function filho(pai, tag, classes = '') { const n = new No(tag); n.className = classes; pai.appendChild(n); return n; }

// o painel do index.html: o visor mora dentro do painel (template tplPane)
function painelComVisor() {
  const el = new No('section');
  const v = filho(el, 'div', 'modal p-visor hidden');
  const cx = filho(v, 'div', 'visor-cx');
  const top = filho(cx, 'div', 'visor-top');
  const ident = filho(top, 'div', 'visor-identidade'); filho(ident, 'span', 'visor-nome'); filho(ident, 'span', 'visor-origem');
  filho(top, 'button', 'visor-abrir'); filho(top, 'button', 'visor-x');
  filho(cx, 'div', 'visor-caminho');
  const barra = filho(cx, 'div', 'visor-toolbar hidden');
  const modos = filho(barra, 'div', 'visor-modos'); filho(modos, 'button', 'visor-previa'); filho(modos, 'button', 'visor-fonte');
  filho(barra, 'button', 'visor-copiar');
  filho(cx, 'div', 'visor-corpo');
  return { P: { id: 'p1', el }, v };
}

const dormir = () => new Promise((resolve) => setImmediate(resolve));
async function esvaziarFila() { for (let i = 0; i < 10; i++) await dormir(); }

/* O visor inteiro (verArquivo), com o markdown "renderizado" pelo mdSeguro de mentira: o texto do documento já é o HTML. */
function montarTela({ documento = '', imagemDoMd } = {}) {
  const { P, v } = painelComVisor();
  const corpoDoc = new No('body');
  const pedidos = [];
  const api = {
    verArquivo: async () => ({ tipo: 'texto', nome: 'relatório final.md', bytes: documento.length, dados: documento }),
    openPath: async () => ({ ok: true }),
    mostrarNaPasta: async () => ({ ok: true }),
    imagemDoMd: async (pedido) => { pedidos.push(simples(pedido)); return imagemDoMd ? imagemDoMd(pedido) : { dados: PNG_URL }; },
  };
  const ctx = {
    ...globaisFalsos(), console,
    document: { body: corpoDoc, activeElement: null, createElement: (t) => new No(t) },
    $: (sel, raiz) => (raiz || corpoDoc).querySelector(sel),
    $$: (sel) => (sel === '.p-visor' ? [v] : []),
    ico: (n) => '<i>' + n + '</i>',
    note() {}, abrirQuadro() {}, ESTE_PC: 'PC', savePanes() {},
    baseNome: (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(p || ''),
    tamanhoBonito: (b) => b + ' B',
    faltaConfigurarServidor: (r) => !!r && (!String(r.usuario || '').trim() || !String(r.host || '').trim()),
    AVISO_ABA_EM_BRANCO: 'aviso de aba em branco',
    mdSeguro: (t) => String(t), linkarArquivos() {}, marcarLinksWeb() {},
    window: { api, CockpitFileLinks: links },
  };
  vm.createContext(ctx);
  vm.runInContext(trechoVisor, ctx);
  return { ctx, P, v, api, pedidos, corpo: v.querySelector('.visor-corpo') };
}
const imgs = (raiz) => raiz.querySelectorAll('img');
const avisos = (raiz) => raiz.querySelectorAll('.visor-img-falhou');
const srcs = (raiz) => imgs(raiz).map((i) => i.getAttribute('src'));
const placeholders = (raiz) => raiz.querySelectorAll('.visor-img-web');   // o convite clicável que ocupa o lugar da imagem da web
const botaoDaWeb = (raiz) => raiz.querySelector('.visor-imgs-web-bt');   // "Carregar imagens da web (N)", no topo do documento
const clicar = (no) => { for (const f of no.eventos.click || []) f({ currentTarget: no, target: no }); if (typeof no.onclick === 'function') no.onclick({ currentTarget: no, target: no }); };
const PASTA_DOC = 'C:\\Users\\hugom\\Projetos-claude\\Relatórios do mês';
const DOC = PASTA_DOC + '\\relatório final.md';
const CARREGA = { pasta: PASTA_DOC, remoto: null, aindaVale: () => true };

// o <article> do markdown, já com as <img> que o mdSeguro deixou (cada uma com o alt "figura N")
function artigoComImagens(...origens) {
  const artigo = new No('article');
  artigo.innerHTML = origens.map((s, i) => '<img src="' + s + '" alt="figura ' + (i + 1) + '">').join('');
  return artigo;
}

/* ---------- resolver o src: a pasta do DOCUMENTO, nunca a do app ---------- */
test('pedidoDeImagem: o src relativo é resolvido a partir da PASTA DO DOCUMENTO (não da pasta do app)', () => {
  const { ctx } = montarTela();
  for (const [src, esperado] of [
    ['./grafico.png', PASTA_DOC + '\\grafico.png'],
    ['grafico.png', PASTA_DOC + '\\grafico.png'],
    ['img/a.png', PASTA_DOC + '\\img\\a.png'],
    ['../assets/a.png', 'C:\\Users\\hugom\\Projetos-claude\\assets\\a.png'],
    ['./img/foto%20de%20capa.png', PASTA_DOC + '\\img\\foto de capa.png'],        // o marked codifica o espaço
    ['./caf%C3%A9.png', PASTA_DOC + '\\café.png'],
    ['img\\a.png', PASTA_DOC + '\\img\\a.png'],
    ['./a.png?raw=true', PASTA_DOC + '\\a.png'], ['./a.png#centro', PASTA_DOC + '\\a.png'],
  ]) assert.deepEqual(simples(ctx.pedidoDeImagem(src, PASTA_DOC, null)), { arquivo: esperado }, src);
});

test('pedidoDeImagem: documento do servidor resolve em caminho POSIX e leva o remoto junto', () => {
  const { ctx } = montarTela();
  assert.deepEqual(simples(ctx.pedidoDeImagem('./img/a.png', '/home/hugo/app', REMOTO)), { arquivo: '/home/hugo/app/img/a.png', remoto: REMOTO });
  assert.deepEqual(simples(ctx.pedidoDeImagem('../a.png', '/home/hugo/app', REMOTO)), { arquivo: '/home/hugo/a.png', remoto: REMOTO });
  assert.deepEqual(simples(ctx.pedidoDeImagem('a.png', '~/app', REMOTO)), { arquivo: '~/app/a.png', remoto: REMOTO });
});

test('pedidoDeImagem: https vai como url (com a query intacta); o que não é arquivo nem https não vira pedido', () => {
  const { ctx } = montarTela();
  assert.deepEqual(simples(ctx.pedidoDeImagem('https://img.shields.io/badge/a-b-green?style=flat', PASTA_DOC, null)), { url: 'https://img.shields.io/badge/a-b-green?style=flat' });
  assert.deepEqual(simples(ctx.pedidoDeImagem('HTTPS://exemplo.com/a.png', PASTA_DOC, REMOTO)), { url: 'HTTPS://exemplo.com/a.png' }, 'a imagem da web não depende de onde está o documento');
  for (const src of ['', '   ', '#secao', 'mailto:a@b.com', 'javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<b>x</b>', 'C:img.png']) {
    const r = simples(ctx.pedidoDeImagem(src, PASTA_DOC, null));
    assert.equal(typeof r.erro, 'string', JSON.stringify(src));
    assert.equal(r.arquivo, undefined, JSON.stringify(src));
    assert.equal(r.url, undefined, JSON.stringify(src));
  }
  assert.equal(typeof simples(ctx.pedidoDeImagem('a.png', '', null)).erro, 'string', 'sem a pasta do documento não há como resolver');
});

test('pedidoDeImagem: caminho de rede é recusado na tela, antes de qualquer pedido ao main', () => {
  const { ctx } = montarTela();
  for (const src of [
    '\\\\servidor\\pasta\\a.png', '//servidor/pasta/a.png', '/\\servidor/pasta/a.png', '\\/servidor/pasta/a.png', '  //servidor/a.png',
    'file://servidor/pasta/a.png', 'file:////servidor/pasta/a.png', '/\t/servidor/a.png', '%5C%5Cservidor%5Cpasta%5Ca.png', '%2F%2Fservidor%2Fa.png',
  ]) {
    for (const [pasta, remoto] of [[PASTA_DOC, null], ['/home/hugo/app', REMOTO]]) {
      const r = simples(ctx.pedidoDeImagem(src, pasta, remoto));
      assert.equal(typeof r.erro, 'string', JSON.stringify(src));
      assert.equal(r.arquivo, undefined, JSON.stringify(src));
      assert.equal(r.url, undefined, JSON.stringify(src));
    }
  }
});

/* ---------- desenhar: do src cru ao data: ---------- */
test('carregarImagensDoMd: o src cru sai NA HORA (o navegador não busca na pasta do app) e a imagem entra como data:', async () => {
  const { ctx, pedidos, api } = montarTela();
  const artigo = artigoComImagens('./grafico.png', 'https://exemplo.com/b.png', '../outra/c.png');
  const durante = [];
  api.imagemDoMd = async (pedido) => { durante.push(srcs(artigo)); pedidos.push(simples(pedido)); return { dados: PNG_URL }; };
  const pronto = ctx.carregarImagensDoMd(artigo, CARREGA);
  assert.deepEqual(srcs(artigo), [null, null], 'síncrono: nada de src cru no DOM (a da web virou um convite, não é <img> até o clique)');
  await pronto;
  assert.deepEqual(pedidos, [{ arquivo: PASTA_DOC + '\\grafico.png' }, { arquivo: 'C:\\Users\\hugom\\Projetos-claude\\outra\\c.png' }],
    'a imagem LOCAL continua automática; a da web não foi buscada');
  assert.deepEqual(durante, [[null, null], [null, null]], 'nem durante os pedidos');
  assert.deepEqual(srcs(artigo), [PNG_URL, PNG_URL]);
  assert.equal(avisos(artigo).length, 0);
});

test('carregarImagensDoMd: data: que já veio no markdown fica como está, sem pedir nada ao main', async () => {
  const { ctx, pedidos } = montarTela();
  const artigo = artigoComImagens(PNG_URL);
  await ctx.carregarImagensDoMd(artigo, CARREGA);
  assert.deepEqual(pedidos, []);
  assert.deepEqual(srcs(artigo), [PNG_URL]);
});

test('carregarImagensDoMd: falha vira o aviso "imagem não carregou" no lugar da imagem, e o resto do documento segue', async () => {
  const { ctx, api } = montarTela();
  const artigo = artigoComImagens('./some.png', './boa.png', './explode.png', './lixo.png');
  api.imagemDoMd = async (pedido) => {
    if (/some/.test(pedido.arquivo)) return { erro: 'Não achei a imagem.' };
    if (/explode/.test(pedido.arquivo)) throw new Error('Error invoking remote method');
    if (/lixo/.test(pedido.arquivo)) return { dados: 'data:text/html;base64,PGI+eDwvYj4=' };
    return { dados: PNG_URL };
  };
  await ctx.carregarImagensDoMd(artigo, CARREGA);
  assert.deepEqual(srcs(artigo), [PNG_URL], 'só a boa continua imagem');
  assert.equal(avisos(artigo).length, 3);
  for (const aviso of avisos(artigo)) assert.equal(aviso.textContent, 'imagem não carregou');
  assert.match(avisos(artigo)[0].title, /figura 1/, 'o texto alternativo e o motivo ficam no title');
  assert.match(avisos(artigo)[0].title, /Não achei a imagem/);
  // a ordem do documento é mantida: aviso, imagem, aviso, aviso
  assert.deepEqual(artigo.filhos.map((f) => (f.tagName === 'IMG' ? 'img' : 'aviso')), ['aviso', 'img', 'aviso', 'aviso']);
});

test('carregarImagensDoMd: o motivo (que pode vir de fora) e o alt são texto, nunca marcação', async () => {
  const { ctx, api } = montarTela();
  const artigo = new No('article');
  artigo.innerHTML = '<img src="./a.png" alt="x">';
  api.imagemDoMd = async () => ({ erro: '<img src=x onerror=alert(1)>' });
  await ctx.carregarImagensDoMd(artigo, CARREGA);
  assert.equal(avisos(artigo)[0].html, '', 'foi por textContent/title, não por innerHTML');
  assert.equal(avisos(artigo)[0].textContent, 'imagem não carregou');
});

test('carregarImagensDoMd: imagem que a sanitização deixou sem src (C:\\..., \\\\servidor\\..., file:) vira o aviso, sem pedir nada ao main', async () => {
  const { ctx, pedidos } = montarTela();
  const artigo = new No('article');
  artigo.innerHTML = '<img alt="gráfico absoluto"><img alt="da rede"><img src="./boa.png" alt="boa">';
  await ctx.carregarImagensDoMd(artigo, CARREGA);
  assert.deepEqual(pedidos, [{ arquivo: PASTA_DOC + '\\boa.png' }], 'só a que tem src vai ao main');
  assert.equal(avisos(artigo).length, 2);
  assert.match(avisos(artigo)[0].title, /gráfico absoluto/);
  assert.equal(imgs(artigo).length, 1);
});

test('carregarImagensDoMd: o src que o navegador não consegue desenhar (evento error) também vira o aviso', async () => {
  const { ctx } = montarTela();
  const artigo = artigoComImagens('./quebrada.png');
  await ctx.carregarImagensDoMd(artigo, CARREGA);
  const img = imgs(artigo)[0];
  assert.ok(img.eventos.error && img.eventos.error.length, 'a imagem escuta o error');
  img.eventos.error[0]();
  assert.equal(imgs(artigo).length, 0);
  assert.equal(avisos(artigo).length, 1);
});

test('carregarImagensDoMd: no máximo 25 imagens por documento; a mesma imagem repetida conta uma vez só', async () => {
  const { ctx, pedidos } = montarTela();
  const origens = Array.from({ length: 30 }, (_, i) => './img' + i + '.png');
  const artigo = artigoComImagens(...origens, './img0.png', './img1.png', PNG_URL);
  await ctx.carregarImagensDoMd(artigo, CARREGA);
  assert.equal(pedidos.length, 25, 'só 25 pedidos ao main');
  assert.deepEqual(pedidos.map((p) => p.arquivo), origens.slice(0, 25).map((s) => PASTA_DOC + '\\' + s.slice(2)));
  assert.equal(avisos(artigo).length, 5, 'as 5 que passaram do limite viram aviso');
  assert.match(avisos(artigo)[0].title, /25/);
  assert.equal(imgs(artigo).length, 25 + 2 + 1, '25 + as 2 repetidas (mesmo resultado) + o data:');
  assert.ok(srcs(artigo).every((s) => s === PNG_URL));
});

test('carregarImagensDoMd: pede poucas por vez (3, deixando 1 das 4 threads de disco do app livre), não 25 imagens de 10 MB juntas', async () => {
  const { ctx, api } = montarTela();
  const artigo = artigoComImagens(...Array.from({ length: 12 }, (_, i) => './p' + i + '.png'));
  let juntas = 0, maximo = 0;
  api.imagemDoMd = async () => { juntas++; maximo = Math.max(maximo, juntas); await dormir(); juntas--; return { dados: PNG_URL }; };
  await ctx.carregarImagensDoMd(artigo, CARREGA);
  assert.equal(imgs(artigo).length, 12);
  assert.equal(maximo, 3, 'no máximo 3 ao mesmo tempo (foram ' + maximo + ')');
});

test('carregarImagensDoMd: uma exceção inesperada ao resolver um src vira o aviso dela e não derruba as outras imagens', async () => {
  const { ctx } = montarTela();
  ctx.window.CockpitFileLinks = { ...links, resolve: (v, o) => { if (/explode/.test(v)) throw new Error('bug na resolução'); return links.resolve(v, o); } };
  const artigo = artigoComImagens('./a.png', './explode.png', './b.png');
  await ctx.carregarImagensDoMd(artigo, CARREGA);
  assert.deepEqual(artigo.filhos.map((f) => (f.tagName === 'IMG' ? 'img' : 'aviso')), ['img', 'aviso', 'img']);
  assert.deepEqual(srcs(artigo), [PNG_URL, PNG_URL]);
});

test('carregarImagensDoMd: caminho de rede vira aviso na tela e NUNCA chega no main', async () => {
  const { ctx, pedidos } = montarTela();
  const artigo = artigoComImagens('\\\\servidor\\a.png', '//servidor/a.png', 'file://servidor/a.png', '%5C%5Cservidor%5Ca.png');
  await ctx.carregarImagensDoMd(artigo, CARREGA);
  assert.deepEqual(pedidos, []);
  assert.equal(avisos(artigo).length, 4);
  assert.equal(imgs(artigo).length, 0);
});

test('carregarImagensDoMd: se o documento mudou ou o visor fechou durante o pedido, não mexe mais na tela', async () => {
  const { ctx, api } = montarTela();
  const artigo = artigoComImagens('./a.png', './b.png');
  let vale = true;
  api.imagemDoMd = async () => { vale = false; return { dados: PNG_URL }; };
  await ctx.carregarImagensDoMd(artigo, { ...CARREGA, aindaVale: () => vale });
  assert.deepEqual(srcs(artigo), [null, null], 'nenhum data: entrou depois de fechar');
  assert.equal(avisos(artigo).length, 0);
});

test('carregarImagensDoMd: sem a ponte (api.imagemDoMd) o documento segue com os avisos, sem quebrar', async () => {
  const { ctx, api } = montarTela();
  const artigo = artigoComImagens('./a.png');
  delete api.imagemDoMd;
  await ctx.carregarImagensDoMd(artigo, CARREGA);
  assert.equal(avisos(artigo).length, 1);
});

/* ---------- um limite só, do módulo inteiro (fix B, item 4) ---------- */
test('carregarImagensDoMd: o limite de 3 pedidos vale para o MÓDULO inteiro: dois desenhos juntos pedem 3 por vez, não 6', async () => {
  const { ctx, api } = montarTela();
  const a = artigoComImagens(...Array.from({ length: 8 }, (_, i) => './a' + i + '.png'));
  const b = artigoComImagens(...Array.from({ length: 8 }, (_, i) => './b' + i + '.png'));
  let juntas = 0, maximo = 0;
  api.imagemDoMd = async () => { juntas++; maximo = Math.max(maximo, juntas); await dormir(); juntas--; return { dados: PNG_URL }; };
  await Promise.all([ctx.carregarImagensDoMd(a, CARREGA), ctx.carregarImagensDoMd(b, CARREGA)]);
  assert.equal(imgs(a).length, 8);
  assert.equal(imgs(b).length, 8);
  assert.equal(maximo, 3, 'no máximo 3 ao mesmo tempo no módulo todo (foram ' + maximo + ')');
});

test('carregarImagensDoMd: pedido de um desenho já substituído NÃO começa se ainda esperava na fila, e o que chega é descartado', async () => {
  const { ctx, api } = montarTela();
  const velho = artigoComImagens(...Array.from({ length: 10 }, (_, i) => './v' + i + '.png'));
  const novo = artigoComImagens('./n0.png', './n1.png');
  let valeVelho = true;
  const feitos = [], respostas = [];
  api.imagemDoMd = (pedido) => { feitos.push(pedido.arquivo); return new Promise((resolve) => respostas.push(() => resolve({ dados: PNG_URL }))); };
  const doVelho = ctx.carregarImagensDoMd(velho, { ...CARREGA, aindaVale: () => valeVelho });
  await esvaziarFila();
  assert.equal(feitos.length, 3, 'só 3 começaram; os outros 7 esperam vaga');
  valeVelho = false;                                      // o documento foi substituído
  const doNovo = ctx.carregarImagensDoMd(novo, CARREGA);
  await esvaziarFila();
  assert.equal(feitos.length, 3, 'o novo também espera: as 3 vagas ainda estão com o desenho antigo');
  respostas.splice(0).forEach((f) => f());                // chegam os 3 do desenho antigo
  await esvaziarFila();
  assert.deepEqual(feitos.slice(3), [PASTA_DOC + '\\n0.png', PASTA_DOC + '\\n1.png'], 'os 7 da fila velha foram descartados sem sair; só o desenho novo pediu');
  respostas.splice(0).forEach((f) => f());
  await Promise.all([doVelho, doNovo]);
  assert.deepEqual(srcs(velho), new Array(10).fill(null), 'o que chegou para o desenho substituído não entra na tela');
  assert.equal(avisos(velho).length, 0);
  assert.deepEqual(srcs(novo), [PNG_URL, PNG_URL]);
});

test('carregarImagensDoMd: a vaga volta para a fila mesmo quando o pedido falha ou o desenho já não vale (a fila nunca trava)', async () => {
  const { ctx, api } = montarTela();
  let chamadas = 0;
  api.imagemDoMd = async () => { chamadas++; throw new Error('Error invoking remote method'); };
  const ruim = artigoComImagens(...Array.from({ length: 7 }, (_, i) => './r' + i + '.png'));
  await ctx.carregarImagensDoMd(ruim, CARREGA);
  assert.equal(chamadas, 7);
  assert.equal(avisos(ruim).length, 7);
  api.imagemDoMd = async () => { chamadas++; return { dados: PNG_URL }; };
  const morto = artigoComImagens(...Array.from({ length: 6 }, (_, i) => './m' + i + '.png'));
  await ctx.carregarImagensDoMd(morto, { ...CARREGA, aindaVale: () => false });
  assert.equal(chamadas, 7, 'desenho que já não vale nem chega a pedir');
  const bom = artigoComImagens('./b0.png', './b1.png', './b2.png', './b3.png');
  await ctx.carregarImagensDoMd(bom, CARREGA);
  assert.equal(imgs(bom).length, 4, 'depois de tudo isso as 3 vagas continuam livres');
});

/* ---------- imagem da web só com clique (fix B, item 2) ---------- */
const WEB_A = 'https://exemplo.com/a.png', WEB_B = 'https://img.shields.io/b.svg';

test('imagem da web: abrir NÃO busca nada — vira convite clicável e, no topo, aparece "Carregar imagens da web (N)"', async () => {
  const { ctx, pedidos } = montarTela();
  const artigo = artigoComImagens('./local.png', WEB_A, WEB_B);
  await ctx.carregarImagensDoMd(artigo, CARREGA);
  assert.deepEqual(pedidos, [{ arquivo: PASTA_DOC + '\\local.png' }], 'só a local foi pedida; nenhum { url }');
  const convites = placeholders(artigo);
  assert.equal(convites.length, 2);
  for (const c of convites) {
    assert.equal(c.tagName, 'BUTTON', 'teclado e leitor de tela também alcançam');
    assert.equal(c.getAttribute('type'), 'button');
  }
  assert.match(convites[0].title, /figura 2/, 'o texto alternativo do autor');
  assert.match(convites[0].title, /exemplo\.com/, 'e o endereço, para decidir antes do clique');
  assert.equal(convites[0].getAttribute('aria-label'), 'Carregar imagem da web: figura 2', 'o leitor de tela diz de qual imagem se trata');
  assert.equal(imgs(artigo).length, 1, 'a única <img> que sobrou é a local');
  const topo = botaoDaWeb(artigo);
  assert.equal(topo.textContent, 'Carregar imagens da web (2)');
  assert.equal(artigo.filhos[0], topo.pai, 'a barra é a 1ª coisa do documento');
});

test('imagem da web: o botão do topo carrega TODAS as da web (a mesma repetida = um pedido) e some', async () => {
  const { ctx, pedidos } = montarTela();
  const artigo = artigoComImagens(WEB_A, './local.png', WEB_B, WEB_A);
  await ctx.carregarImagensDoMd(artigo, CARREGA);
  assert.equal(botaoDaWeb(artigo).textContent, 'Carregar imagens da web (3)', 'três imagens da web, duas delas iguais');
  pedidos.length = 0;
  clicar(botaoDaWeb(artigo));
  await esvaziarFila();
  assert.deepEqual(pedidos, [{ url: WEB_A }, { url: WEB_B }], 'um pedido por endereço');
  assert.deepEqual(artigo.filhos.map((f) => f.tagName), ['IMG', 'IMG', 'IMG', 'IMG'], 'sem convites e sem barra, na ordem do documento');
  assert.ok(srcs(artigo).every((s) => s === PNG_URL));
  assert.equal(botaoDaWeb(artigo), null, 'não sobrou nada para carregar');
});

test('imagem da web: clicar num convite carrega SÓ aquela imagem, e o botão do topo conta o que falta', async () => {
  const { ctx, pedidos } = montarTela();
  const artigo = artigoComImagens(WEB_A, WEB_B);
  await ctx.carregarImagensDoMd(artigo, CARREGA);
  clicar(placeholders(artigo)[1]);
  await esvaziarFila();
  assert.deepEqual(pedidos, [{ url: WEB_B }]);
  assert.deepEqual(srcs(artigo), [PNG_URL], 'só a B virou imagem');
  assert.equal(placeholders(artigo).length, 1);
  assert.equal(botaoDaWeb(artigo).textContent, 'Carregar imagens da web (1)');
  clicar(placeholders(artigo)[0]);
  await esvaziarFila();
  assert.equal(botaoDaWeb(artigo), null);
  assert.deepEqual(imgs(artigo).map((i) => i.getAttribute('alt')), ['figura 1', 'figura 2'], 'a ordem do documento é mantida');
});

test('imagem da web: clique repetido (no convite e no botão do topo) não repete o pedido', async () => {
  const { ctx, pedidos } = montarTela();
  const artigo = artigoComImagens(WEB_A);
  await ctx.carregarImagensDoMd(artigo, CARREGA);
  const convite = placeholders(artigo)[0], topo = botaoDaWeb(artigo);
  clicar(convite); clicar(convite); clicar(topo);
  await esvaziarFila();
  assert.deepEqual(pedidos, [{ url: WEB_A }]);
});

test('imagem da web: o main recusou (rede interna, redirecionamento, demora) → aviso com o motivo, e as outras seguem', async () => {
  const { ctx, api } = montarTela();
  const artigo = artigoComImagens(WEB_A, WEB_B);
  api.imagemDoMd = async (p) => (p.url === WEB_A ? { erro: 'Endereço de rede interna: a imagem não é buscada.' } : { dados: PNG_URL });
  await ctx.carregarImagensDoMd(artigo, CARREGA);
  clicar(botaoDaWeb(artigo));
  await esvaziarFila();
  assert.equal(avisos(artigo).length, 1);
  assert.equal(avisos(artigo)[0].textContent, 'imagem não carregou');
  assert.match(avisos(artigo)[0].title, /rede interna/);
  assert.deepEqual(srcs(artigo), [PNG_URL]);
  assert.equal(botaoDaWeb(artigo), null);
});

test('imagem da web: http:// (sem s) não vira convite — aviso direto, sem pedido e sem contar no botão', async () => {
  const { ctx, pedidos } = montarTela();
  const artigo = artigoComImagens('http://exemplo.com/a.png', WEB_A);
  await ctx.carregarImagensDoMd(artigo, CARREGA);
  assert.equal(avisos(artigo).length, 1);
  assert.match(avisos(artigo)[0].title, /https/);
  assert.equal(botaoDaWeb(artigo).textContent, 'Carregar imagens da web (1)');
  clicar(botaoDaWeb(artigo));
  await esvaziarFila();
  assert.deepEqual(pedidos, [{ url: WEB_A }]);
});

test('imagem da web: sem nenhuma imagem da web não aparece convite nem botão', async () => {
  const { ctx } = montarTela();
  const artigo = artigoComImagens('./a.png', PNG_URL);
  await ctx.carregarImagensDoMd(artigo, CARREGA);
  assert.equal(botaoDaWeb(artigo), null);
  assert.equal(placeholders(artigo).length, 0);
});

test('imagem da web: o convite é texto puro — o alt e o endereço do autor nunca viram marcação', async () => {
  const { ctx } = montarTela();
  const artigo = new No('article');
  artigo.innerHTML = '<img src="https://exemplo.com/a.png" alt="x">';
  artigo.filhos[0].setAttribute('alt', '<img src=x onerror=alert(1)>');
  await ctx.carregarImagensDoMd(artigo, CARREGA);
  const convite = placeholders(artigo)[0];
  assert.equal(convite.html, '', 'foi por textContent/title, não por innerHTML');
  assert.match(convite.title, /onerror/, 'o alt vai como texto, no title');
});

test('imagem da web dentro de um link (selo de README): o convite fica FORA do <a>, e a imagem volta para dentro dele', async () => {
  // o document intercepta (na captura) todo clique dentro de <a href> e abre o link no navegador: um convite dentro do
  // link nunca receberia o clique. Por isso ele vai logo ANTES do link e a imagem espera escondida onde estava.
  const { ctx, pedidos } = montarTela();
  const artigo = new No('article');
  const link = filho(artigo, 'a'); link.setAttribute('href', 'https://exemplo.com/projeto');
  const selo = filho(link, 'img'); selo.setAttribute('src', WEB_A); selo.setAttribute('alt', 'selo');
  const solta = filho(artigo, 'img'); solta.setAttribute('src', WEB_B); solta.setAttribute('alt', 'solta');
  await ctx.carregarImagensDoMd(artigo, CARREGA);
  const [doSelo, daSolta] = placeholders(artigo);
  assert.equal(doSelo.pai, artigo, 'fora do link');
  assert.equal(link.querySelector('.visor-img-web'), null, 'nenhum convite dentro do <a>');
  assert.equal(selo.pai, link, 'a imagem continua no link');
  assert.equal(selo.hidden, true, '...escondida');
  assert.deepEqual(artigo.filhos.map((f) => f.className || f.tagName), ['visor-imgs-web', 'visor-img-web', 'A', 'visor-img-web'], 'o convite vai logo antes do link');
  assert.equal(daSolta.pai, artigo);
  clicar(doSelo);
  await esvaziarFila();
  assert.deepEqual(pedidos, [{ url: WEB_A }]);
  assert.equal(selo.pai, link, 'a imagem carregada está dentro do link, como no documento');
  assert.equal(selo.hidden, false);
  assert.equal(selo.getAttribute('src'), PNG_URL);
  assert.equal(placeholders(artigo).length, 1, 'só o convite da outra sobrou');
  assert.equal(botaoDaWeb(artigo).textContent, 'Carregar imagens da web (1)');
});

test('imagem da web dentro de um link: duas imagens no mesmo link mantêm a ordem, e uma que falha vira o aviso fora do link', async () => {
  const { ctx, api } = montarTela();
  const artigo = new No('article');
  const link = filho(artigo, 'a'); link.setAttribute('href', 'https://exemplo.com/projeto');
  for (const [src, alt] of [[WEB_A, 'um'], [WEB_B, 'dois']]) { const i = filho(link, 'img'); i.setAttribute('src', src); i.setAttribute('alt', alt); }
  api.imagemDoMd = async (p) => (p.url === WEB_A ? { erro: 'O site respondeu 404.' } : { dados: PNG_URL });
  await ctx.carregarImagensDoMd(artigo, CARREGA);
  assert.deepEqual(placeholders(artigo).map((c) => c.getAttribute('aria-label')), ['Carregar imagem da web: um', 'Carregar imagem da web: dois'], 'a ordem do documento');
  clicar(botaoDaWeb(artigo));
  await esvaziarFila();
  assert.equal(avisos(artigo).length, 1);
  assert.equal(avisos(artigo)[0].pai, artigo, 'o aviso fica fora do link');
  assert.equal(link.filhos[1].hidden, false);
  assert.equal(link.filhos[1].getAttribute('src'), PNG_URL, 'a que carregou aparece dentro do link');
});

test('imagem da web: o clique tira o convite do foco — o foco volta ao leitor em vez de se perder', async () => {
  const { ctx, v, corpo } = montarTela();
  const artigo = artigoComImagens(WEB_A);
  await ctx.carregarImagensDoMd(artigo, { ...CARREGA, visor: v });
  const convite = placeholders(artigo)[0];
  ctx.document.activeElement = convite;
  clicar(convite);
  await esvaziarFila();
  assert.equal(corpo.focos, 1, 'o foco foi para o corpo do leitor');
  const sem = artigoComImagens(WEB_B);
  await ctx.carregarImagensDoMd(sem, { ...CARREGA, visor: v });
  ctx.document.activeElement = null;
  clicar(placeholders(sem)[0]);
  await esvaziarFila();
  assert.equal(corpo.focos, 1, 'quem não estava com o foco não rouba o foco');
});

/* ---------- cache por visor e rolagem estável (fix B, item 3) ---------- */
test('cacheDeImagensDoVisor: um cache por documento; outro documento começa vazio; os 3 últimos ficam (Voltar reaproveita)', () => {
  const { ctx } = montarTela();
  const v = new No('div');
  const a = ctx.cacheDeImagensDoVisor(v, 'A');
  assert.equal(ctx.cacheDeImagensDoVisor(v, 'A'), a, 'o mesmo documento: o mesmo cache (recarga, Prévia/Código)');
  const b = ctx.cacheDeImagensDoVisor(v, 'B');
  assert.notEqual(b, a, 'outro documento começa vazio');
  assert.equal(b.imagens.size, 0);
  assert.notEqual(ctx.cacheDeImagensDoVisor(new No('div'), 'A'), a, 'é um cache POR VISOR');
  ctx.cacheDeImagensDoVisor(v, 'C');                                  // [A, B, C]
  assert.equal(ctx.cacheDeImagensDoVisor(v, 'A'), a, 'Voltar ao anterior: reaproveita');   // [B, C, A]
  ctx.cacheDeImagensDoVisor(v, 'D');                                  // [C, A, D]: B, o mais antigo, saiu
  assert.equal(ctx.cacheDeImagensDoVisor(v, 'A'), a, 'A foi usado há pouco: ficou');
  assert.notEqual(ctx.cacheDeImagensDoVisor(v, 'B'), b, 'B saiu: volta vazio');
});

test('cache: o 2º desenho do MESMO documento usa o que já chegou — a imagem entra NA HORA e a da web liberada não é pedida de novo', async () => {
  const { ctx, pedidos } = montarTela();
  const cache = ctx.cacheDeImagensDoVisor(new No('div'), 'doc');
  const um = artigoComImagens('./a.png', WEB_A);
  await ctx.carregarImagensDoMd(um, { ...CARREGA, cache, geracao: 1 });
  clicar(botaoDaWeb(um));
  await esvaziarFila();
  assert.deepEqual(pedidos, [{ arquivo: PASTA_DOC + '\\a.png' }, { url: WEB_A }]);
  pedidos.length = 0;
  // Prévia → Código → Prévia: a mesma abertura (mesma geração) desenha de novo
  const dois = artigoComImagens('./a.png', WEB_A);
  const pronto = ctx.carregarImagensDoMd(dois, { ...CARREGA, cache, geracao: 1 });
  assert.deepEqual(srcs(dois), [PNG_URL, PNG_URL], 'síncrono: as duas já entram, sem esperar o main');
  assert.equal(botaoDaWeb(dois), null, 'a da web já foi liberada neste documento: sem convite');
  await pronto;
  assert.deepEqual(pedidos, [], 'nenhum pedido');
});

test('cache: só o que o Hugo já liberou volta sozinho — endereço novo da web (arquivo editado) é convite de novo', async () => {
  const { ctx, pedidos } = montarTela();
  const cache = ctx.cacheDeImagensDoVisor(new No('div'), 'doc');
  const um = artigoComImagens(WEB_A);
  await ctx.carregarImagensDoMd(um, { ...CARREGA, cache, geracao: 1 });
  clicar(botaoDaWeb(um));
  await esvaziarFila();
  pedidos.length = 0;
  const editado = artigoComImagens(WEB_A, 'https://vazamento.exemplo.net/pixel.png?dado=segredo');   // alguém acrescentou uma imagem ao .md
  await ctx.carregarImagensDoMd(editado, { ...CARREGA, cache, geracao: 2 });
  assert.deepEqual(pedidos, [], 'a recarga automática não busca endereço que o Hugo nunca liberou');
  assert.deepEqual(srcs(editado), [PNG_URL], 'a liberada volta do cache');
  assert.equal(placeholders(editado).length, 1);
  assert.equal(botaoDaWeb(editado).textContent, 'Carregar imagens da web (1)');
});

test('cache: recarga (nova abertura) mostra a imagem local do cache NA HORA e a confere de novo no disco — a que mudou é trocada, a que sumiu vira aviso', async () => {
  const { ctx, pedidos, api } = montarTela();
  const cache = ctx.cacheDeImagensDoVisor(new No('div'), 'doc');
  const NOVA = 'data:image/png;base64,AAAAAAAA';
  await ctx.carregarImagensDoMd(artigoComImagens('./muda.png', './igual.png', './some.png'), { ...CARREGA, cache, geracao: 1 });
  assert.equal(pedidos.length, 3);
  pedidos.length = 0;
  api.imagemDoMd = async (p) => { pedidos.push(simples(p)); return /muda/.test(p.arquivo) ? { dados: NOVA } : /some/.test(p.arquivo) ? { erro: 'Não achei a imagem.' } : { dados: PNG_URL }; };
  const segundo = artigoComImagens('./muda.png', './igual.png', './some.png');
  const pronto = ctx.carregarImagensDoMd(segundo, { ...CARREGA, cache, geracao: 2 });
  assert.deepEqual(srcs(segundo), [PNG_URL, PNG_URL, PNG_URL], 'na hora: o que tinha no cache (o arquivo pode ter mudado: o agente regenera o gráfico)');
  await pronto;
  assert.equal(pedidos.length, 3, 'as locais são conferidas de novo');
  assert.deepEqual(srcs(segundo), [NOVA, PNG_URL], 'a que mudou foi trocada; a igual ficou');
  assert.equal(avisos(segundo).length, 1, 'a que sumiu virou aviso');
  assert.equal(cache.imagens.has('./some.png'), false, 'e saiu do cache');
  // a mesma abertura (mesma geração): não confere de novo
  pedidos.length = 0;
  await ctx.carregarImagensDoMd(artigoComImagens('./muda.png', './igual.png'), { ...CARREGA, cache, geracao: 2 });
  assert.deepEqual(pedidos, []);
});

test('cache: o teto de bytes — a imagem que estoura o orçamento do cache aparece, mas não é guardada', async () => {
  const { ctx, api } = montarTela();
  const cache = ctx.cacheDeImagensDoVisor(new No('div'), 'doc');
  const grande = 'data:image/png;base64,' + 'A'.repeat(41 * 1024 * 1024);
  api.imagemDoMd = async (p) => (/grande/.test(p.arquivo) ? { dados: grande } : { dados: PNG_URL });
  const artigo = artigoComImagens('./grande.png', './pequena.png');
  await ctx.carregarImagensDoMd(artigo, { ...CARREGA, cache, geracao: 1 });
  assert.deepEqual(srcs(artigo), [grande, PNG_URL], 'as duas aparecem');
  assert.equal(cache.imagens.has('./grande.png'), false, 'a que estoura o teto não é guardada');
  assert.equal(cache.imagens.has('./pequena.png'), true);
});

/* A rolagem "pula" quando as imagens chegam (o texto sem imagem é mais curto, o navegador puxa a rolagem). Este
   contador imita isso: guarda cada ESCRITA do scrollTop, e `pular` mexe na posição sem ser escrita do código. */
function rolagemObservada(corpo, inicial = 0) {
  const escritas = [];
  let pos = inicial;
  Object.defineProperty(corpo, 'scrollTop', { configurable: true, get: () => pos, set: (x) => { pos = x; escritas.push(x); } });
  return { escritas, pular: (x) => { pos = x; }, ler: () => pos };
}
const DOC_COM_IMAGENS = '<p>texto</p><img src="./a.png" alt="a"><img src="./b.png" alt="b">';
const EVENTOS_DO_HUGO = ['wheel', 'touchstart', 'pointerdown', 'keydown'];

test('rolagem: o que o Voltar/recarga pediu é devolvido DE NOVO depois que as imagens chegam (antes elas não tinham tamanho)', async () => {
  const { ctx, P, corpo, api } = montarTela({ documento: DOC_COM_IMAGENS });
  const rol = rolagemObservada(corpo);
  api.imagemDoMd = async () => { rol.pular(120); return { dados: PNG_URL }; };   // a imagem chega e a rolagem sai do lugar
  await ctx.verArquivo(P, DOC, null, { rolagem: 500 });
  await esvaziarFila();
  assert.equal(rol.ler(), 500);
  assert.equal(rol.escritas.filter((x) => x === 500).length, 2, 'uma ao devolver (como antes) e outra quando as imagens chegaram');
  assert.equal(rol.escritas.at(-1), 500);
});

for (const evento of EVENTOS_DO_HUGO) {
  test('rolagem: se o Hugo mexeu (' + evento + ') enquanto as imagens chegavam, a rolagem dele NÃO é tomada de volta', async () => {
    const { ctx, P, v, corpo, api } = montarTela({ documento: DOC_COM_IMAGENS });
    const rol = rolagemObservada(corpo);
    api.imagemDoMd = async () => {
      for (const f of v.eventos[evento] || []) f({});   // o Hugo mexeu...
      rol.pular(300);                                    // ...e foi parar aqui
      return { dados: PNG_URL };
    };
    await ctx.verArquivo(P, DOC, null, { rolagem: 500 });
    await esvaziarFila();
    assert.equal(rol.ler(), 300, 'a posição dele ficou');
    assert.equal(rol.escritas.filter((x) => x === 500).length, 1, 'só a devolução de antes das imagens');
  });
}

test('rolagem: espera a imagem ter tamanho (load) antes de devolver, e a imagem quebrada (error) também solta a espera', async () => {
  No.carregando = true;
  try {
    const { ctx, P, corpo } = montarTela({ documento: '<img src="./a.png" alt="a">' });
    const rol = rolagemObservada(corpo);
    await ctx.verArquivo(P, DOC, null, { rolagem: 500 });
    await esvaziarFila();
    assert.equal(rol.escritas.filter((x) => x === 500).length, 1, 'a imagem ainda não tem tamanho: nada de reaplicar antes da hora');
    rol.pular(80);                                                           // ela carrega e o navegador puxa a rolagem
    for (const img of imgs(corpo)) for (const f of img.eventos.load || []) f();
    await esvaziarFila();
    assert.equal(rol.ler(), 500);
    assert.equal(rol.escritas.filter((x) => x === 500).length, 2);
    // imagem que não carrega (error): também não segura a rolagem para sempre
    const outra = montarTela({ documento: '<img src="./a.png" alt="a">' });
    const rol2 = rolagemObservada(outra.corpo);
    await outra.ctx.verArquivo(outra.P, DOC, null, { rolagem: 500 });
    await esvaziarFila();
    rol2.pular(80);
    for (const img of imgs(outra.corpo)) for (const f of img.eventos.error || []) f();
    await esvaziarFila();
    assert.equal(rol2.ler(), 500);
    assert.equal(avisos(outra.corpo).length, 1, 'e a imagem quebrada virou o aviso');
  } finally { No.carregando = false; }
});

test('rolagem: sem rolagem pedida (1ª abertura) nada é reaplicado, e nenhum ouvinte fica no visor', async () => {
  const { ctx, P, v, corpo } = montarTela({ documento: DOC_COM_IMAGENS });
  const rol = rolagemObservada(corpo);
  await ctx.verArquivo(P, DOC, null);
  await esvaziarFila();
  assert.deepEqual(rol.escritas, [0], 'só o "voltar ao topo" do desenho');
  assert.ok(Object.values(v.eventos).every((l) => l.length === 0), 'nenhum ouvinte');
});

test('rolagem: documento sem imagem para esperar (a maioria dos .md) não vigia nada e não mexe na rolagem de novo', async () => {
  const sem = montarTela({ documento: '<p>só texto</p>' });
  const rol = rolagemObservada(sem.corpo);
  await sem.ctx.verArquivo(sem.P, DOC, null, { rolagem: 500 });
  assert.ok(Object.values(sem.v.eventos).every((l) => l.length === 0), 'nenhum ouvinte, nem por um instante');
  await esvaziarFila();
  assert.equal(rol.escritas.filter((x) => x === 500).length, 1, 'a devolução de sempre, uma vez só');
  // só imagem da web (convite, ainda sem clique) também não tem nada a esperar
  const web = montarTela({ documento: '<img src="' + WEB_A + '" alt="a">' });
  const rol2 = rolagemObservada(web.corpo);
  await web.ctx.verArquivo(web.P, DOC, null, { rolagem: 500 });
  assert.ok(Object.values(web.v.eventos).every((l) => l.length === 0));
  await esvaziarFila();
  assert.equal(rol2.escritas.filter((x) => x === 500).length, 1);
});

test('rolagem: terminado o carregamento, os ouvintes saem do visor (nada vaza a cada recarga)', async () => {
  const { ctx, P, v } = montarTela({ documento: DOC_COM_IMAGENS });
  await ctx.verArquivo(P, DOC, null, { rolagem: 500 });
  assert.ok(EVENTOS_DO_HUGO.every((e) => (v.eventos[e] || []).length === 1), 'enquanto carrega, os 4 sinais do Hugo são vigiados');
  await esvaziarFila();
  assert.ok(Object.values(v.eventos).every((l) => l.length === 0), 'terminou: tudo solto');
});

test('rolagem: se outro documento abriu antes de as imagens chegarem, a rolagem do novo não é mexida', async () => {
  let soltar;
  const { ctx, P, v, corpo, api } = montarTela({ documento: '<img src="./a.png" alt="a">' });
  const rol = rolagemObservada(corpo);
  api.imagemDoMd = () => new Promise((resolve) => { soltar = resolve; });
  await ctx.verArquivo(P, DOC, null, { rolagem: 500 });
  await dormir();
  api.verArquivo = async () => ({ tipo: 'texto', nome: 'outro.md', bytes: 3, dados: '<p>outro</p>' });
  await ctx.verArquivo(P, PASTA_DOC + '\\outro.md', null);
  const antes = rol.escritas.length;
  soltar({ dados: PNG_URL });
  await esvaziarFila();
  assert.equal(rol.escritas.length, antes, 'nenhuma escrita depois que o desenho velho deixou de valer');
  assert.ok(Object.values(v.eventos).every((l) => l.length === 0), 'e os ouvintes dele saíram');
});

test('rolagem: alternar Prévia → Código → Prévia devolve a rolagem da Prévia quando as imagens (já no cache) tiverem tamanho', async () => {
  const { ctx, P, v, corpo } = montarTela({ documento: DOC_COM_IMAGENS });
  const rol = rolagemObservada(corpo);
  await ctx.verArquivo(P, DOC, null);
  await esvaziarFila();
  rol.pular(800);                                       // o Hugo rolou a Prévia
  clicar(v.querySelector('.visor-fonte'));              // Código (volta ao topo)
  assert.equal(rol.ler(), 0);
  No.carregando = true;
  try {
    clicar(v.querySelector('.visor-previa'));
    await esvaziarFila();
    rol.pular(100);                                                           // o tamanho aparece e a rolagem é puxada
    for (const img of imgs(corpo)) for (const f of img.eventos.load || []) f();
    await esvaziarFila();
    assert.equal(rol.ler(), 800);
  } finally { No.carregando = false; }
});

/* ---------- o visor de verdade ---------- */
test('visor: .md local com imagem relativa, https e quebrada: a local e a quebrada vão sozinhas, a da web só com clique, e o resto do texto aparece', async () => {
  const html = '<p>Relatório</p><img src="./grafico.png" alt="gráfico relativo"><img src="https://exemplo.com/web.png" alt="da web"><img src="./some.png" alt="some">';
  let abrir;
  const portao = new Promise((resolve) => { abrir = resolve; });
  const { ctx, P, corpo, pedidos } = montarTela({
    documento: html,
    imagemDoMd: async (pedido) => { await portao; return /some/.test(pedido.arquivo || '') ? { erro: 'Não achei a imagem.' } : { dados: PNG_URL }; },
  });
  await ctx.verArquivo(P, DOC, null);
  assert.equal(corpo.dataset.tipo, 'markdown');
  // os pedidos ainda estão em andamento: o src cru já saiu, nada fica apontando para a pasta do app
  assert.deepEqual(srcs(corpo), [null, null]);
  assert.equal(placeholders(corpo).length, 1, 'a da web é um convite clicável');
  abrir();
  await esvaziarFila();
  assert.deepEqual(pedidos, [{ arquivo: PASTA_DOC + '\\grafico.png' }, { arquivo: PASTA_DOC + '\\some.png' }], 'abrir o .md NÃO chama a busca https');
  assert.deepEqual(srcs(corpo), [PNG_URL]);
  assert.equal(avisos(corpo).length, 1);
  assert.match(corpo.textContent, /imagem não carregou/);
  // o clique chama
  clicar(placeholders(corpo)[0]);
  await esvaziarFila();
  assert.deepEqual(pedidos.at(-1), { url: 'https://exemplo.com/web.png' });
  assert.deepEqual(srcs(corpo), [PNG_URL, PNG_URL]);
  assert.equal(placeholders(corpo).length, 0);
  assert.equal(botaoDaWeb(corpo), null, 'não sobrou nada pra carregar: o botão do topo some');
});

test('visor: .md do servidor pede a imagem com o remoto e o caminho POSIX da pasta do documento', async () => {
  const { ctx, P, corpo, pedidos } = montarTela({ documento: '<img src="./prints/a.png" alt="a"><img src="../b.png" alt="b">' });
  await ctx.verArquivo(P, '/home/hugo/app/docs/leia.md', REMOTO);
  await esvaziarFila();
  assert.deepEqual(pedidos, [
    { arquivo: '/home/hugo/app/docs/prints/a.png', remoto: REMOTO },
    { arquivo: '/home/hugo/app/b.png', remoto: REMOTO },
  ]);
  assert.equal(imgs(corpo).length, 2);
});

test('visor: pedido de imagem que chega depois de abrir outro arquivo não pinta no documento novo', async () => {
  let soltar;
  const { ctx, P, corpo, api } = montarTela({ documento: '<img src="./a.png" alt="a">' });
  api.imagemDoMd = () => new Promise((resolve) => { soltar = resolve; });
  await ctx.verArquivo(P, DOC, null);
  await dormir();
  api.verArquivo = async () => ({ tipo: 'texto', nome: 'outro.md', bytes: 3, dados: '<p>outro</p>' });
  await ctx.verArquivo(P, PASTA_DOC + '\\outro.md', null);
  soltar({ dados: PNG_URL });
  await esvaziarFila();
  assert.equal(imgs(corpo).length, 0, 'a imagem do documento anterior não entra no novo');
  assert.equal(avisos(corpo).length, 0);
});

test('visor: a escolha de carregar a imagem da web vale para AQUELE documento — recarga e Voltar reaproveitam; outro documento, mesmo endereço, é convite de novo', async () => {
  const { ctx, P, corpo, pedidos } = montarTela({ documento: '<img src="' + WEB_A + '" alt="a"><img src="./l.png" alt="l">' });
  const daWeb = () => pedidos.filter((p) => p.url);
  await ctx.verArquivo(P, DOC, null);
  await esvaziarFila();
  assert.deepEqual(daWeb(), [], 'abrir não busca nada na web');
  clicar(placeholders(corpo)[0]);
  await esvaziarFila();
  assert.deepEqual(daWeb(), [{ url: WEB_A }]);
  assert.equal(imgs(corpo).length, 2);
  // recarga do mesmo documento (o arquivo mudou): as duas entram na hora; a da web nem é pedida, a local é conferida no disco
  pedidos.length = 0;
  await ctx.verArquivo(P, DOC, null);
  assert.deepEqual(srcs(corpo), [PNG_URL, PNG_URL], 'as duas entram na hora, do cache');
  await esvaziarFila();
  assert.deepEqual(daWeb(), [], 'a da web liberada não é pedida de novo');
  assert.deepEqual(pedidos.map((p) => p.arquivo), [PASTA_DOC + '\\l.png'], 'a local é conferida de novo (o arquivo pode ter mudado)');
  // outro documento: o mesmo endereço volta a ser convite
  await ctx.verArquivo(P, PASTA_DOC + '\\outro.md', null);
  await esvaziarFila();
  assert.equal(placeholders(corpo).length, 1);
  assert.deepEqual(daWeb(), []);
  // Voltar ao primeiro: o cache dele ainda está lá, e a da web aparece sem clique
  await ctx.voltarVisor(P);
  assert.deepEqual(srcs(corpo), [PNG_URL, PNG_URL]);
  assert.equal(placeholders(corpo).length, 0);
  await esvaziarFila();
  assert.deepEqual(daWeb(), [], 'nenhuma busca na web depois do clique');
});

test('visor: fechar o leitor e abrir o mesmo documento de novo NÃO lembra a escolha: a imagem da web volta a ser convite', async () => {
  const { ctx, P, v, corpo, pedidos } = montarTela({ documento: '<img src="' + WEB_A + '" alt="a">' });
  await ctx.verArquivo(P, DOC, null);
  clicar(placeholders(corpo)[0]);
  await esvaziarFila();
  assert.equal(imgs(corpo).length, 1);
  assert.ok(v._imagensMd, 'o visor guardou o documento enquanto esteve aberto');
  v.onkeydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });   // Esc fecha o leitor
  assert.equal(v.classList.contains('hidden'), true);
  pedidos.length = 0;
  await ctx.verArquivo(P, DOC, null);
  await esvaziarFila();
  assert.equal(placeholders(corpo).length, 1, 'a escolha valia só enquanto o documento esteve aberto');
  assert.deepEqual(pedidos, [], 'e nada foi buscado');
});

test('visor: alternar Prévia → Código → Prévia não pede imagem nenhuma de novo', async () => {
  const { ctx, P, v, corpo, pedidos } = montarTela({ documento: '<img src="./l.png" alt="l"><img src="' + WEB_A + '" alt="a">' });
  await ctx.verArquivo(P, DOC, null);
  await esvaziarFila();
  clicar(botaoDaWeb(corpo));
  await esvaziarFila();
  assert.equal(pedidos.length, 2);
  clicar(v.querySelector('.visor-fonte'));
  clicar(v.querySelector('.visor-previa'));
  assert.deepEqual(srcs(corpo), [PNG_URL, PNG_URL], 'de volta na Prévia as imagens já estão lá');
  await esvaziarFila();
  assert.equal(pedidos.length, 2, 'nenhum pedido novo');
});

test('ponta a ponta: o ./img do .md (pasta com acento e espaço, nome com %20) é achado na pasta do documento e volta como data:', async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-imgmd-'));
  try {
    const pasta = path.join(raiz, 'Relatórios do mês');
    fs.mkdirSync(path.join(pasta, 'img'), { recursive: true });
    fs.writeFileSync(path.join(pasta, 'img', 'gráfico 1.png'), PNG);
    const { ctx } = montarTela();
    const pedido = simples(ctx.pedidoDeImagem('./img/gr%C3%A1fico%201.png', pasta, null));
    assert.deepEqual(pedido, { arquivo: path.join(pasta, 'img', 'gráfico 1.png') });
    const m = montarMain({ stat: (p) => fs.promises.stat(p), lerArquivo: (p) => fs.promises.readFile(p) });
    assert.equal((await m.chamar(pedido)).dados, PNG_URL);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('o mdSeguro não foi tocado; a imagem é resolvida DEPOIS da sanitização (no verArquivo, não dentro do mdSeguro)', () => {
  const md = pegarBloco(app, 'function mdSeguro(', 'mdSeguro');
  assert.doesNotMatch(md, /imagemDoMd|pedidoDeImagem|carregarImagensDoMd/);
  assert.ok(md.includes(String.raw`ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|\.{1,2}[\\/][^:]*$|\/(?![\\/])[^:]*$|[^:\\/#.][^:]*$)/i`), 'a regra de URL é a mesma da leva 1');
  assert.match(md, /urlDeRedeNoAtributo\(data\.attrValue\)/);
  assert.match(md, /isNetworkPath\(data\.attrValue\)/);
  // o pegarBloco para no "= {}" do parâmetro padrão do verArquivo: aqui o corpo vai até a chave que fecha na coluna 0
  const ini = app.indexOf('async function verArquivo(');
  const visor = app.slice(ini, app.indexOf('\n}\n', ini));
  assert.ok(visor.length > 5000, 'recortei o verArquivo inteiro');
  const i = visor.indexOf('artigo.innerHTML = mdSeguro(texto)');
  assert.ok(i >= 0 && visor.indexOf('carregarImagensDoMd(artigo', i) > i, 'o carregamento vem depois do mdSeguro');
});

/* =====================================================================
   A ponte (preload), o simulador da prévia e o estilo do aviso
   ===================================================================== */
test('preload: imagemDoMd chama arquivo:imagemMd, logo ao lado do verArquivo', async () => {
  const bus = new EventEmitter(), chamadas = []; let api;
  bus.sendSync = () => ({}); bus.invoke = async (...args) => { chamadas.push(args); return { dados: PNG_URL }; };
  const fonte = lerFonte('preload.js');
  vm.runInNewContext(fonte, {
    process: { platform: 'win32' },
    require: () => ({ ipcRenderer: bus, webUtils: {}, contextBridge: { exposeInMainWorld: (_nome, valor) => { api = valor; } } }),
  });
  assert.equal(typeof api.imagemDoMd, 'function', 'falta api.imagemDoMd');
  await api.imagemDoMd({ arquivo: 'C:\\x\\a.png' });
  await api.imagemDoMd({ url: 'https://exemplo.com/a.png' });
  assert.deepEqual(chamadas, [['arquivo:imagemMd', { arquivo: 'C:\\x\\a.png' }], ['arquivo:imagemMd', { url: 'https://exemplo.com/a.png' }]]);
  const linhas = fonte.split('\n');
  const aoLado = linhas.findIndex((l) => /^\s*verArquivo:/.test(l));
  assert.ok(aoLado >= 0 && /imagemDoMd/.test(linhas.slice(aoLado + 1, aoLado + 9).join('\n')), 'ao lado do método parecido, não no fim do objeto');
});

test('mock-api.js: imagemDoMd está declarado e devolve data: (a prévia não registra método faltando)', async () => {
  const win = {};
  const ctx = vm.createContext({
    window: win, location: { search: '' }, URLSearchParams, JSON, Date, Math, Object, Array, String, Promise, Proxy, Set, Map,
    setTimeout, queueMicrotask, console, addEventListener() {},
  });
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'tools', 'redesenho', 'mock-api.js'), 'utf8'), ctx);
  assert.equal(typeof win.api.imagemDoMd, 'function');
  assert.match((await win.api.imagemDoMd({ arquivo: 'C:/QA/a.png' })).dados, /^data:image\//);
  assert.match((await win.api.imagemDoMd({ url: 'https://exemplo.com/a.png' })).dados, /^data:image\//);
  assert.ok(!win.__qa.missing.has('imagemDoMd'), 'imagemDoMd não está em __qa.missing');
});

test('o aviso "imagem não carregou", o convite da imagem da web e o botão do topo têm estilo discreto no style.css', () => {
  const css = fs.readFileSync(path.join(RAIZ, 'src', 'renderer', 'style.css'), 'utf8');
  assert.match(css, /\.visor-img-falhou\s*\{[^}]*\}/);
  assert.match(css, /\.visor-img-web\s*\{[^}]*\}/, 'o convite clicável no lugar da imagem da web');
  assert.match(css, /\.visor-imgs-web-bt\s*\{[^}]*\}/, 'o botão "Carregar imagens da web (N)"');
  assert.match(css, /\.visor-imgs-web\s*\{[^}]*\}/, 'a barra do topo');
});

/* Rodada final, item 2c (revisão final a7ed9b2c1aa8b7f86): o link cru que vira chip é da conversa (UI 4.4); o leitor de arquivos
   deixa a URL do documento inteira. Medida: opções que a Prévia passa ao marcarLinksWeb (antes nenhuma, e o link cru virava chip;
   depois { chip: false }). */
test('Prévia do Markdown: o leitor pede o marcarLinksWeb sem chip (a UI 4.4 é da conversa)', async () => {
  const { ctx, P } = montarTela({ documento: '<p>veja https://app.clickup.com/t/86abc123</p>' });
  const chamadas = [];
  ctx.marcarLinksWeb = (el, opcoes) => chamadas.push(opcoes === undefined ? 'sem opções' : simples(opcoes));
  await ctx.verArquivo(P, DOC, null);
  await esvaziarFila();
  assert.deepEqual(chamadas, [{ chip: false }]);
});
