'use strict';
/* Leva 2, Task 3 (UI 7.2-3 e 7.2-5): o leitor abre mais tipos, separa TAMANHO de TIPO e acerta o acento.

   - HTML: desenhado num iframe sandbox SEM allow-scripts e sem allow-same-origin (srcdoc), com CSP própria na frente
     (default-src 'none': nada de rede); "Ver código" volta pro texto.
   - PDF: janela própria do main (sandbox, contextIsolation, sem preload, sem Node), carregando só o arquivo pedido;
     navegar e abrir janela nova ficam travados. Sem o visualizador: recado claro e "Abrir no programa".
   - .htm, .tsv, .ini, .cfg, .bat, .cmd, .env.example e arquivo sem extensão: texto, se o conteúdo for texto.
   - DOCX e XLSX: "Documento do Word: abra no programa", com o botão.
   - .md de 725 KB: "Grande demais para o leitor (725 KB; limite 600 KB)", não "tipo não abre" (print q04).
   - Acento: BOM UTF-8 sai, UTF-16 com BOM decodifica, UTF-8 estrito com reserva Windows-1252.

   Fixtures: as do evidencias/teste-leitor.cjs da auditoria de UI (01/10). O main não carrega em teste (precisa do
   Electron): o código REAL é recortado do main.js e roda num vm, com um Electron de mentira. Nenhuma janela abre. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { RAIZ, lerFonte, pegarBloco, globaisFalsos } = require('../testes/raiz');

const MAIN = lerFonte('main.js');
const APP = lerFonte('renderer', 'app.js');
const PRELOAD = lerFonte('preload.js');
const MSG_REDE = 'Caminho de rede bloqueado por segurança.';
const REDE = ['\\\\servidor\\pasta\\a.pdf', '//servidor/pasta/a.pdf', '/\\servidor/pasta/a.pdf', '  \\\\servidor\\a.pdf'];
const simples = (v) => JSON.parse(JSON.stringify(v));   // objeto nascido no vm (outro Object.prototype)

const temporarias = [];
test.after(() => { for (const d of temporarias) fs.rmSync(d, { recursive: true, force: true }); });
const D = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-leitor-'));
temporarias.push(D);
function arq(nome, conteudo, enc) {
  const p = path.join(D, nome);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, conteudo, enc);
  return p;
}
// fs de verdade, mas anotando quem leu conteúdo
function fsQueAnota() {
  const lidos = [];
  const anota = (nome) => (p, ...resto) => { lidos.push(nome + ' ' + path.basename(String(p))); return fs[nome](p, ...resto); };
  return { lidos, fs: { ...fs, readFileSync: anota('readFileSync'), openSync: anota('openSync') } };
}
// fs que não pode ser tocado: qualquer acesso fica anotado e falha
function fsProibido() {
  const toques = [];
  return { toques, fs: new Proxy({}, { get: (_, nome) => (...a) => { toques.push('fs.' + String(nome)); throw new Error('encostou no disco: fs.' + String(nome) + ' ' + a[0]); } }) };
}

/* ================================================================== */
/* main: o leitor local (verArquivoLocal)                              */
/* ================================================================== */
// de "const EXT_VIS_IMG" até o ramo do servidor: o mesmo recorte do evidencias/teste-leitor.cjs
function trechoDoLeitor() {
  const ini = MAIN.indexOf("const EXT_VIS_IMG = ['png'");
  const fim = MAIN.indexOf('/* O mesmo arquivo, mas no servidor.');
  assert.ok(ini > 0 && fim > ini, 'não achei o trecho do leitor no main.js');
  return MAIN.slice(ini, fim);
}
function leitor(extras = {}) {
  const ctx = { fs, path, Buffer, TextDecoder, ...extras };
  vm.createContext(ctx);
  vm.runInContext(trechoDoLeitor() + '\nthis.verArquivoLocal = verArquivoLocal; this.TETO_VIS_TXT = TETO_VIS_TXT; this.TETO_VIS_IMG = TETO_VIS_IMG;', ctx);
  return ctx;
}

test('acento: o BOM do UTF-8 sai e o 1º título do .md volta', () => {
  const { verArquivoLocal } = leitor();
  const r = verArquivoLocal(arq('com-bom.md', '\uFEFF# Título com BOM\n\ntexto\n'));
  assert.equal(r.tipo, 'texto');
  assert.equal(r.dados, '# Título com BOM\n\ntexto\n');
});

test('acento: UTF-16 com BOM (Out-File do PowerShell 5, "Unicode" do Bloco de Notas) decodifica, LE e BE', () => {
  const { verArquivoLocal } = leitor();
  const frase = 'Saída do PowerShell 5: ação\r\n';
  const le = verArquivoLocal(arq('powershell-utf16.txt', Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(frase, 'utf16le')])));
  assert.equal(le.tipo, 'texto');
  assert.equal(le.dados, frase);
  const be = verArquivoLocal(arq('utf16be.txt', Buffer.concat([Buffer.from([0xFE, 0xFF]), Buffer.from(frase, 'utf16le').swap16()])));
  assert.equal(be.tipo, 'texto');
  assert.equal(be.dados, frase);
});

test('acento: sem BOM é UTF-8 ESTRITO; o que não é UTF-8 válido cai no Windows-1252 (CSV do Excel)', () => {
  const { verArquivoLocal } = leitor();
  const csv = verArquivoLocal(arq('excel-latin1.csv', Buffer.from('Nome;Descrição;Preço\nJoão;Ação;10,50\n', 'latin1')));
  assert.equal(csv.tipo, 'texto');
  assert.equal(csv.dados, 'Nome;Descrição;Preço\nJoão;Ação;10,50\n', 'nada de "Descri��o"');
  // 0x80-0x9F do Windows-1252 (aspas curvas, euro, travessão) não viram caractere de controle do latin1
  const aspas = verArquivoLocal(arq('aspas-1252.txt', Buffer.from([0x93, 0x6F, 0x69, 0x94, 0x20, 0x80, 0x20, 0x96, 0x20, 0xE7])));
  assert.equal(aspas.dados, '\u201Coi\u201D \u20AC \u2013 \u00E7');
  // UTF-8 válido continua UTF-8 (não vira "aÃ§Ã£o")
  const utf8 = verArquivoLocal(arq('sub/relatório final.md', '# Relatório\n\nação “aspas” € — ok\n'));
  assert.equal(utf8.dados, '# Relatório\n\nação “aspas” € — ok\n');
});

test('tipos: .htm, .tsv, .ini, .cfg, .bat, .cmd, .env.example e arquivo sem extensão abrem como texto', () => {
  const { verArquivoLocal } = leitor();
  const casos = [
    ['pagina.htm', '<h1>htm</h1>'], ['pagina.html', '<!doctype html><h1>Relatório HTML</h1><p>gerado pelo agente</p>'],
    ['dados.tsv', 'a\tb\n1\t2\n'], ['config.ini', '[x]\ny=1\n'], ['app.cfg', 'porta=80\n'],
    ['rodar.bat', '@echo off\r\necho oi\r\n'], ['rodar.cmd', '@echo off\r\n'], ['.env.example', 'CHAVE=\n'],
    ['LEIAME', 'arquivo sem extensao'], ['Makefile', 'tudo:\n\techo oi\n'],
  ];
  for (const [nome, conteudo] of casos) {
    const r = verArquivoLocal(arq(nome, conteudo));
    assert.equal(r.tipo, 'texto', nome);
    assert.equal(r.dados, conteudo, nome);
  }
});

test('tipos: o conteúdo decide (byte nulo = binário); UTF-16 sem extensão continua texto pelo BOM; pasta não é texto', () => {
  const { verArquivoLocal } = leitor();
  const bin = verArquivoLocal(arq('binario', Buffer.from([0x7F, 0x45, 0x4C, 0x46, 0x02, 0x01, 0x00, 0x00])));
  assert.equal(bin.tipo, 'outro');
  assert.equal(bin.dados, undefined);
  const u16 = verArquivoLocal(arq('SAIDA', Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('saída', 'utf16le')])));
  assert.equal(u16.tipo, 'texto', 'UTF-16 tem byte nulo de propósito: o BOM vem antes do teste');
  assert.equal(u16.dados, 'saída');
  const dir = path.join(D, 'Uma pasta');
  fs.mkdirSync(dir, { recursive: true });
  const r = verArquivoLocal(dir);
  assert.equal(r.tipo, 'outro');
  assert.equal(r.erro, undefined, 'pasta sem extensão não é erro de leitura');
});

test('tamanho separado do tipo: o .md de 725 KB vira "grande" com o limite de 600 KB, sem ler o conteúdo', () => {
  const p = arq('grande.md', '# Grande\n\n' + 'linha de log com bastante texto pra encher o arquivo\n'.repeat(14000));
  const { lidos, fs: fsLido } = fsQueAnota();
  const { verArquivoLocal, TETO_VIS_TXT } = leitor({ fs: fsLido });
  const r = verArquivoLocal(p);
  assert.equal(r.tipo, 'grande');
  assert.equal(r.bytes, fs.statSync(p).size);
  assert.equal(Math.round(r.bytes / 1024), 725, 'o mesmo .md do print q04');
  assert.equal(r.limite, 600 * 1024);
  assert.equal(TETO_VIS_TXT, 600 * 1024);
  assert.equal(r.dados, undefined);
  assert.deepEqual(lidos, [], 'grande demais não é lido');
});

test('tamanho: imagem acima de 25 MB também é "grande" (limite 25 MB); tipo que o leitor não abre continua "outro", sem limite', () => {
  const { verArquivoLocal } = leitor();
  const img = arq('enorme.png', '');
  fs.truncateSync(img, 25 * 1024 * 1024 + 1);
  const r = verArquivoLocal(img);
  assert.equal(r.tipo, 'grande');
  assert.equal(r.limite, 25 * 1024 * 1024);
  const zip = arq('pacote.zip', '');
  fs.truncateSync(zip, 2 * 1024 * 1024);
  const z = verArquivoLocal(zip);
  assert.equal(z.tipo, 'outro');
  assert.equal(z.limite, undefined);
});

test('DOCX e XLSX viram "documento" e PDF vira "pdf", sem ler o arquivo (quem abre é o programa ou a janela do PDF)', () => {
  const { lidos, fs: fsLido } = fsQueAnota();
  const { verArquivoLocal } = leitor({ fs: fsLido });
  for (const [nome, tipo, ext] of [['proposta.docx', 'documento', 'docx'], ['planilha.xlsx', 'documento', 'xlsx'],
    ['documento.pdf', 'pdf', 'pdf'], ['Relatórios do mês/proposta.PDF', 'pdf', 'pdf']]) {
    const r = verArquivoLocal(arq(nome, 'PK\u0003\u0004 falso'));
    assert.equal(r.tipo, tipo, nome);
    assert.equal(r.ext, ext, nome);
    assert.equal(r.dados, undefined, nome);
  }
  assert.deepEqual(lidos, []);
});

test('caminho de rede: o leitor recusa antes de qualquer fs.*, inclusive para os tipos novos', () => {
  for (const p of REDE.concat(['\\\\srv\\LEIAME', '//srv/a.docx'])) {
    const { toques, fs: proibido } = fsProibido();
    const r = leitor({ fs: proibido }).verArquivoLocal(p);
    assert.equal(r.erro, MSG_REDE, p);
    assert.equal(r.tipo, undefined, p);
    assert.deepEqual(toques, [], p);
  }
});

/* ================================================================== */
/* main: o mesmo arquivo no servidor (verArquivoRemoto)                */
/* ================================================================== */
function leitorRemoto() {
  const pedidos = [];
  let resposta = { out: '' };
  const { fs: proibido } = fsProibido();
  const ctx = {
    fs: proibido, path, Buffer, TextDecoder,
    execRemoto: async (_remoto, script) => { pedidos.push(script); return resposta; },
  };
  vm.createContext(ctx);
  vm.runInContext([trechoDoLeitor(), pegarBloco(MAIN, 'function qLinux(', 'qLinux'), pegarBloco(MAIN, 'function qRemoto(', 'qRemoto'),
    pegarBloco(MAIN, 'async function verArquivoRemoto(', 'verArquivoRemoto'), 'this.verArquivoRemoto = verArquivoRemoto;'].join('\n'), ctx);
  return {
    pedidos,
    ver(arquivo, r) { resposta = r; pedidos.length = 0; return ctx.verArquivoRemoto({ usuario: 'hugo', host: 'vps', chave: 'k' }, arquivo); },
  };
}
const pacote = (bytes, buf) => ({ out: 'COCKPIT_TAM ' + bytes + '\n' + (buf ? buf.toString('base64') : '') });

test('servidor: o mesmo acento do ramo local (Windows-1252, UTF-16 e BOM) e sem extensão como texto', async () => {
  const { ver, pedidos } = leitorRemoto();
  const latin = Buffer.from('Descrição;Preço\n', 'latin1');
  let r = await ver('~/dados/excel.csv', pacote(latin.length, latin));
  assert.equal(r.tipo, 'texto');
  assert.equal(r.dados, 'Descrição;Preço\n');
  const u16 = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('ação', 'utf16le')]);
  r = await ver('~/saida.txt', pacote(u16.length, u16));
  assert.equal(r.dados, 'ação');
  const bom = Buffer.from('\uFEFF# Título\n');
  r = await ver('~/nota.md', pacote(bom.length, bom));
  assert.equal(r.dados, '# Título\n');
  const leiame = Buffer.from('arquivo sem extensao');
  r = await ver('/srv/app/LEIAME', pacote(leiame.length, leiame));
  assert.equal(r.tipo, 'texto');
  assert.equal(r.dados, 'arquivo sem extensao');
  assert.match(pedidos[0], /base64 -w0/, 'sem extensão também pede o conteúdo (até o teto de texto)');
  const bin = Buffer.from([1, 0, 2]);
  r = await ver('/srv/app/binario', pacote(bin.length, bin));
  assert.equal(r.tipo, 'outro');
  assert.equal(r.dados, undefined);
});

test('servidor: PDF, Word e Excel não baixam nada; grande demais diz o limite em vez de "outro"', async () => {
  const { ver, pedidos } = leitorRemoto();
  for (const [arquivo, tipo] of [['~/proposta.docx', 'documento'], ['~/planilha.xlsx', 'documento'], ['~/relatorio.pdf', 'pdf']]) {
    const r = await ver(arquivo, pacote(182272));
    assert.equal(r.tipo, tipo, arquivo);
    assert.doesNotMatch(pedidos[0], /base64/, arquivo + ': nada é baixado');
  }
  const r = await ver('~/grande.md', pacote(742010));
  assert.equal(r.tipo, 'grande');
  assert.equal(r.limite, 600 * 1024);
  assert.equal(r.bytes, 742010);
  assert.equal(r.dados, undefined);
});

/* ================================================================== */
/* main: a janela do PDF, com um Electron de mentira                   */
/* ================================================================== */
function trechoDoPdf() {
  const ini = MAIN.indexOf('/* PDF do leitor (UI 7.2-3)');
  const canal = MAIN.indexOf("ipcMain.handle('pdf:abrir'");
  assert.ok(ini > 0 && canal > ini, 'não achei a janela de PDF no main.js');
  return MAIN.slice(ini, MAIN.indexOf('\n', canal));
}
function eletronFalso() {
  const janelas = [];
  const sessao = new EventEmitter();
  class BrowserWindow extends EventEmitter {
    constructor(opcoes) {
      super();
      this.opcoes = opcoes; this.urls = []; this.mostrada = false; this.destruida = false; this.carga = null;
      const wc = new EventEmitter();
      wc.session = sessao;
      wc.setWindowOpenHandler = (f) => { wc.aoAbrirJanela = f; };
      this.webContents = wc;
      janelas.push(this);
    }
    loadURL(url) { this.urls.push(url); return new Promise((ok, falha) => { this.carga = { ok, falha }; }); }
    show() { this.mostrada = true; }
    close() { this.destroy(); }
    destroy() { if (this.destruida) return; this.destruida = true; this.emit('closed'); }
    isDestroyed() { return this.destruida; }
  }
  return { BrowserWindow, janelas, sessao };
}
function montarPdf(extras = {}) {
  const eletron = eletronFalso();
  const handlers = {}, registros = [], esperas = [];
  const ctx = {
    fs, path, Buffer, TextDecoder, require,
    BrowserWindow: eletron.BrowserWindow, win: null,
    logMain: (contexto, e) => { registros.push([contexto, e && e.message]); },
    setTimeout: (fn) => { esperas.push(fn); return 0; },
    ipcMain: { handle: (canal, fn) => { handlers[canal] = fn; } },
    ...extras,
  };
  vm.createContext(ctx);
  vm.runInContext(trechoDoLeitor() + '\n' + trechoDoPdf() + '\nthis.opcoesJanelaPdf = opcoesJanelaPdf;', ctx);
  assert.equal(typeof handlers['pdf:abrir'], 'function', 'falta o canal pdf:abrir');
  return { ctx, eletron, registros, esperas, chamar: (arquivo) => handlers['pdf:abrir']({}, arquivo) };
}
const umTique = () => new Promise((r) => setImmediate(r));

test('PDF: as opções da janela são de janela presa (sandbox, contextIsolation, sem preload, sem Node, sem webview)', () => {
  const { ctx } = montarPdf();
  const o = ctx.opcoesJanelaPdf('proposta.pdf');
  const wp = o.webPreferences;
  assert.equal(wp.sandbox, true);
  assert.equal(wp.contextIsolation, true);
  assert.equal(wp.nodeIntegration, false);
  assert.equal(wp.nodeIntegrationInSubFrames, false);
  assert.equal(wp.nodeIntegrationInWorker, false);
  assert.equal(wp.webviewTag, false);
  assert.equal(Object.prototype.hasOwnProperty.call(wp, 'preload'), false, 'sem preload: o PDF não alcança o window.api');
  assert.equal(o.show, false, 'só aparece depois de carregar');
  assert.equal(o.title, 'proposta.pdf');
});

test('PDF: caminho de rede é recusado antes de qualquer fs.* e de criar janela', async () => {
  for (const p of REDE) {
    const { toques, fs: proibido } = fsProibido();
    const { chamar, eletron } = montarPdf({ fs: proibido });
    assert.deepEqual(simples(await chamar(p)), { error: MSG_REDE }, p);
    assert.deepEqual(toques, [], p);
    assert.equal(eletron.janelas.length, 0, p);
  }
});

test('PDF: só PDF deste computador; HTML, caminho relativo, pasta e arquivo que não existe não criam janela', async () => {
  const html = arq('pagina-pdf.html', '<h1>x</h1>');
  const pastaPdf = path.join(D, 'pasta.pdf');
  fs.mkdirSync(pastaPdf, { recursive: true });
  for (const [pedido, motivo] of [[html, /Só abro PDF/], ['proposta.pdf', /Só abro PDF/], [pastaPdf, /Não achei este PDF/],
    [path.join(D, 'nao-existe.pdf'), /Não achei este PDF/], ['', /Só abro PDF/], [undefined, /Só abro PDF/]]) {
    const { chamar, eletron } = montarPdf();
    const r = simples(await chamar(pedido));
    assert.match(String(r.error), motivo, String(pedido));
    assert.equal(eletron.janelas.length, 0, String(pedido));
  }
});

test('PDF: abre numa janela presa, carrega SÓ o arquivo pedido e só aparece depois de carregar', async () => {
  const pdf = arq('Relatórios do mês/proposta 50% final.pdf', '%PDF-1.4\n%falso\n');
  const { chamar, eletron } = montarPdf();
  const pedido = chamar(pdf);
  const [j] = eletron.janelas;
  assert.ok(j, 'não criou a janela do PDF');
  assert.equal(eletron.janelas.length, 1);
  assert.deepEqual(j.urls, [pathToFileURL(pdf).href], 'carrega o arquivo pedido, e nada mais');
  assert.equal(j.mostrada, false);
  const wp = j.opcoes.webPreferences;
  assert.equal(wp.sandbox, true);
  assert.equal(wp.contextIsolation, true);
  assert.equal(wp.nodeIntegration, false);
  assert.equal('preload' in wp, false);
  j.carga.ok();
  assert.deepEqual(simples(await pedido), { ok: true });
  assert.equal(j.mostrada, true);
});

test('PDF: dentro da janela, janela nova, navegação e <webview> são recusados', async () => {
  const pdf = arq('travas.pdf', '%PDF-1.4\n');
  const { chamar, eletron } = montarPdf();
  const pedido = chamar(pdf);
  const [j] = eletron.janelas;
  const wc = j.webContents;
  for (const url of ['https://exemplo.com/', 'file:///C:/Windows/win.ini', 'about:blank']) {
    assert.deepEqual(simples(wc.aoAbrirJanela({ url })), { action: 'deny' }, url);
  }
  let barrados = 0;
  const evento = () => ({ preventDefault: () => { barrados++; } });
  wc.emit('will-navigate', evento(), 'https://exemplo.com/');
  wc.emit('will-navigate', evento(), 'file:///C:/outro.pdf');
  wc.emit('will-attach-webview', evento(), {}, {});
  assert.equal(barrados, 3);
  j.carga.ok();
  await pedido;
  // depois de aberto continua tudo travado
  wc.emit('will-navigate', evento(), 'https://exemplo.com/');
  assert.equal(barrados, 4);
});

test('PDF: subframe só navega pro próprio visualizador e pro PDF pedido; link pra fora, outro arquivo e servidor de rede não', async () => {
  const pdf = arq('subframe.pdf', '%PDF-1.4\n');
  const url = pathToFileURL(pdf).href;
  const { chamar, eletron } = montarPdf();
  const pedido = chamar(pdf);
  const wc = eletron.janelas[0].webContents;
  const barra = (destino, isMainFrame = false) => {
    let barrou = false;
    wc.emit('will-frame-navigate', { url: destino, isMainFrame, preventDefault: () => { barrou = true; } });
    return barrou;
  };
  // o visualizador do Chromium mora num subframe chrome-extension:// desde o Electron 41 (visto no 44.5.1): travado, o PDF não abre
  assert.equal(barra('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/a9475fe1-91cf-4fb3-a4b3-9d28'), false);
  assert.equal(barra('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html'), false);
  assert.equal(barra(url), false, 'o próprio PDF');
  assert.equal(barra(url + '#page=2'), false, 'o próprio PDF, em outra página');
  for (const fora of ['https://exemplo.com/', 'file://servidor/share/x.pdf', 'file:///C:/Windows/win.ini',
    'chrome-extension://outra-extensao/index.html', 'javascript:alert(1)', url.replace(/\.pdf$/, '.html')]) {
    assert.equal(barra(fora), true, fora);
  }
  eletron.janelas[0].carga.ok();
  await pedido;
});

test('PDF sem visualizador: o Chromium tentaria BAIXAR; o download é cortado (nada de "Salvar como") e a tela recebe o aviso', async () => {
  const pdf = arq('sem-visualizador.pdf', '%PDF-1.4\n');
  const { chamar, eletron, esperas, registros } = montarPdf();
  const pedido = chamar(pdf);
  const [j] = eletron.janelas;
  // o loadURL falha primeiro; o will-download chega logo depois (por isso o main espera um instante)
  j.carga.falha(Object.assign(new Error('ERR_FAILED (-2) loading'), { errno: -2 }));
  await umTique();
  let cortes = 0, outros = 0;
  eletron.sessao.emit('will-download', { preventDefault: () => { outros++; } }, { getURL: () => 'https://x/a.zip' }, { id: 'tela principal' });
  eletron.sessao.emit('will-download', { preventDefault: () => { cortes++; } }, { getURL: () => pathToFileURL(pdf).href }, j.webContents);
  assert.equal(cortes, 1, 'o download da janela do PDF é cortado');
  assert.equal(outros, 0, 'download de outra janela não é da conta dela');
  for (const f of esperas.splice(0)) f();
  const r = simples(await pedido);
  assert.equal(r.error, 'O visualizador de PDF não está disponível aqui.');
  assert.equal(j.destruida, true);
  assert.equal(j.mostrada, false);
  assert.equal(eletron.sessao.listenerCount('will-download'), 0, 'o ouvinte sai junto com a janela');
  assert.deepEqual(registros, [], 'sem visualizador não é erro do Cockpit');
});

test('PDF que falha ao carregar (sem download) vira recado e vai pro log; a janela some', async () => {
  const pdf = arq('falha.pdf', '%PDF-1.4\n');
  const { chamar, eletron, esperas, registros } = montarPdf();
  const pedido = chamar(pdf);
  const [j] = eletron.janelas;
  j.carga.falha(new Error('ERR_FILE_NOT_FOUND (-6) loading'));
  await umTique();
  for (const f of esperas.splice(0)) f();
  const r = simples(await pedido);
  assert.equal(r.error, 'Não consegui abrir este PDF aqui.');
  assert.equal(j.destruida, true);
  assert.deepEqual(registros, [['pdf:abrir', 'ERR_FILE_NOT_FOUND (-6) loading']]);
});

test('PDF aberto: o botão de baixar do próprio visualizador volta a valer', async () => {
  const pdf = arq('aberto.pdf', '%PDF-1.4\n');
  const { chamar, eletron } = montarPdf();
  const pedido = chamar(pdf);
  const [j] = eletron.janelas;
  j.carga.ok();
  await pedido;
  let cortes = 0;
  eletron.sessao.emit('will-download', { preventDefault: () => { cortes++; } }, { getURL: () => pathToFileURL(pdf).href }, j.webContents);
  assert.equal(cortes, 0);
});

test('PDF: fechar o Cockpit fecha a janela do PDF (aberta, ela seguraria o app vivo sem a janela principal)', async () => {
  const pdf = arq('junto.pdf', '%PDF-1.4\n');
  const principal = new EventEmitter();
  principal.isDestroyed = () => false;
  const a = montarPdf({ win: principal });
  const p1 = a.chamar(pdf);
  a.eletron.janelas[0].carga.ok();
  await p1;
  principal.emit('closed');
  assert.equal(a.eletron.janelas[0].destruida, true);
  assert.equal(a.eletron.sessao.listenerCount('will-download'), 0);
  // e fechar só o PDF solta o ouvinte da janela principal
  const outra = new EventEmitter();
  outra.isDestroyed = () => false;
  const b = montarPdf({ win: outra });
  const p2 = b.chamar(pdf);
  b.eletron.janelas[0].carga.ok();
  await p2;
  b.eletron.janelas[0].close();
  assert.equal(outra.listenerCount('closed'), 0);
});

test('PDF: o canal pdf:abrir passa pela fachada de segurança do IPC (ipcMain do main, não o do Electron)', () => {
  assert.ok(/^ipcMain\.handle\('pdf:abrir', /m.test(MAIN), "falta ipcMain.handle('pdf:abrir', ...) no main.js");
  assert.ok(!/electronIpcMain\.handle\('pdf:abrir'/.test(MAIN), 'o canal não pode pular a fachada de segurança');
});

/* ================================================================== */
/* a tela: o desenho do visor (verArquivo), com um DOM de mentira      */
/* ================================================================== */
const trechoVisor = APP.slice(
  APP.indexOf('/* ============ visualizador de arquivo ============ */'),
  APP.indexOf('/* ============ conversas recentes ============ */'));
assert.ok(trechoVisor.length > 200, 'não achei o trecho do visor no app.js');

class No {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.classes = new Set(); this.filhos = []; this.pai = null;
    this.attrs = {}; this.dataset = {}; this.style = {};
    this.texto = ''; this.html = ''; this.scrollTop = 0; this.title = '';
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
  set innerHTML(v) { this.html = String(v); this.texto = ''; this.esvaziar(); }
  get textContent() { return this.texto + this.filhos.map((f) => f.textContent).join(''); }
  set textContent(v) { this.texto = String(v); this.esvaziar(); }
  get isConnected() { return true; }
  get descendentes() { return this.filhos.flatMap((f) => [f, ...f.descendentes]); }
  esvaziar() { for (const f of this.filhos) f.pai = null; this.filhos = []; }
  tirar(f) { if (f.pai) f.pai.filhos = f.pai.filhos.filter((x) => x !== f); f.pai = null; }
  appendChild(f) { this.tirar(f); f.pai = this; this.filhos.push(f); return f; }
  prepend(f) { this.tirar(f); f.pai = this; this.filhos.unshift(f); }
  after(f) { this.tirar(f); const i = this.pai.filhos.indexOf(this); f.pai = this.pai; this.pai.filhos.splice(i + 1, 0, f); }
  remove() { this.tirar(this); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener() {}
  focus() {}
  scrollIntoView() {}
  contains(no) { for (let p = no; p; p = p.pai) if (p === this) return true; return false; }
  querySelectorAll(sel) {
    const casa = sel.startsWith('.') ? (n) => n.classes.has(sel.slice(1)) : (n) => n.tagName.toLowerCase() === sel;
    return this.descendentes.filter(casa);
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
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
function montarTela(resposta) {
  const { P, v } = painelComVisor();
  const corpoDoc = new No('body');
  const abertos = [], pdfs = [];
  const api = {
    verArquivo: async () => resposta,
    openPath: async (p) => { abertos.push(p); return { ok: true }; },
    mostrarNaPasta: async () => ({ ok: true }),
    abrirPdf: async (p) => { pdfs.push(p); return { ok: true }; },
  };
  const ctx = {
    ...globaisFalsos(), console,
    document: {
      body: corpoDoc, activeElement: null, createElement: (t) => new No(t),
      createTextNode: (t) => { const n = new No('#text'); n.texto = String(t); return n; },
    },
    $: (sel, raiz) => (raiz || corpoDoc).querySelector(sel),
    $$: (sel) => (sel === '.p-visor' ? [v] : []),
    ico: (n) => '<i>' + n + '</i>',
    note() {}, abrirQuadro() {}, ESTE_PC: 'PC',
    baseNome: (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(p || ''),
    faltaConfigurarServidor: (r) => !!r && (!String(r.usuario || '').trim() || !String(r.host || '').trim()),
    AVISO_ABA_EM_BRANCO: 'aviso de aba em branco',
    window: { api },
  };
  vm.createContext(ctx);
  // o tamanhoBonito de verdade: o recado de tamanho tem que dizer "725 KB" e "600 KB"
  vm.runInContext(pegarBloco(APP, 'const tamanhoBonito = (b) => {', 'tamanhoBonito'), ctx);
  vm.runInContext(trechoVisor, ctx);
  return { ctx, P, v, api, abertos, pdfs, corpo: v.querySelector('.visor-corpo') };
}
const botoes = (raiz) => raiz.querySelectorAll('button');
const botao = (raiz, texto) => botoes(raiz).find((b) => b.textContent === texto) || null;
const SERVIDOR = { usuario: 'hugo', host: 'vps', chave: 'k' };
const HTML = '<!doctype html><h1>Relatório HTML</h1><p>gerado pelo agente</p><script>document.body.style.background="red"</script>';
// a CSP PRÓPRIA da prévia (Leva 2, Fix A): a única outra barreira contra pedido de rede era a CSP herdada do pai
const CSP_PREVIA = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; font-src data:">';

test('tela: HTML aparece num iframe sandbox SEM allow-scripts e sem allow-same-origin, com o próprio HTML no srcdoc', async () => {
  for (const nome of ['pagina.html', 'PAGINA.HTM']) {
    const { ctx, P, corpo } = montarTela({ tipo: 'texto', nome, ext: 'html', bytes: HTML.length, dados: HTML });
    await ctx.verArquivo(P, 'C:\\x\\' + nome, null);
    const [quadro] = corpo.querySelectorAll('iframe');
    assert.ok(quadro, nome + ': o HTML não foi desenhado num iframe (print q05: código cru)');
    assert.equal(quadro.getAttribute('sandbox'), '', 'sandbox vazio: script, form, popup, topo e mesma origem travados');
    assert.equal(quadro.srcdoc, CSP_PREVIA + HTML, 'o conteúdo vai pelo srcdoc, depois da CSP própria');
    assert.equal(quadro.getAttribute('src'), null, 'nada de src apontando pro disco');
    assert.equal(corpo.dataset.tipo, 'html');
    assert.equal(corpo.querySelectorAll('pre').length, 0);
  }
});

test('tela: a prévia do HTML leva CSP própria ANTES do conteúdo (sem rede, sem depender da CSP do pai), com ou sem doctype e head', async () => {
  const paginas = [
    '<h1>só o corpo</h1>',
    HTML,
    '<!DOCTYPE html>\n<html lang="pt"><head><meta charset="utf-8"><title>Com head</title><link rel="stylesheet" href="https://exemplo.com/x.css"></head><body><img src="https://exemplo.com/pixel.png"></body></html>',
    '<HEAD><TITLE>caixa alta</TITLE></HEAD><BODY>x</BODY>',
    '\uFEFF  <!-- comentário --><!doctype html><p>espaço e comentário antes</p>',
  ];
  for (const pagina of paginas) {
    const { ctx, P, v, corpo } = montarTela({ tipo: 'texto', nome: 'p.html', ext: 'html', bytes: pagina.length, dados: pagina });
    await ctx.verArquivo(P, 'C:\\x\\p.html', null);
    const [quadro] = corpo.querySelectorAll('iframe');
    assert.ok(quadro, 'sem iframe: ' + pagina.slice(0, 30));
    assert.ok(quadro.srcdoc.startsWith(CSP_PREVIA), 'o srcdoc tem que COMEÇAR com a CSP (nada vem antes dela): ' + quadro.srcdoc.slice(0, 80));
    assert.equal(quadro.srcdoc.slice(CSP_PREVIA.length), pagina, 'o HTML vai inteiro, logo depois da CSP');
    assert.equal(quadro.getAttribute('sandbox'), '', 'o sandbox continua vazio');
    // Ver código -> Prévia desenha o iframe de novo: a CSP vem junto
    v.querySelector('.visor-fonte').onclick();
    v.querySelector('.visor-previa').onclick();
    assert.ok(corpo.querySelector('iframe').srcdoc.startsWith(CSP_PREVIA), 'a Prévia de volta perdeu a CSP');
  }
  // a política em si: nada de rede (default-src), imagem e fonte só embutidas, estilo só no próprio arquivo, sem script
  const politica = /content="([^"]*)"/.exec(CSP_PREVIA)[1];
  assert.equal(politica, "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:");
  assert.doesNotMatch(politica, /https?:|\*|script-src|connect-src|'self'/);
});

test('tela: "Ver código" alterna o HTML para o texto, e a Prévia volta pro iframe', async () => {
  const { ctx, P, v, corpo } = montarTela({ tipo: 'texto', nome: 'pagina.html', ext: 'html', bytes: HTML.length, dados: HTML });
  await ctx.verArquivo(P, 'C:\\x\\pagina.html', null);
  const modos = v.querySelector('.visor-modos');
  const previa = v.querySelector('.visor-previa'), codigo = v.querySelector('.visor-fonte');
  assert.equal(v.querySelector('.visor-toolbar').classes.has('hidden'), false);
  assert.equal(modos.classes.has('hidden'), false, 'HTML tem os dois modos, como o markdown');
  assert.equal(codigo.getAttribute('aria-label'), 'Ver código');
  codigo.onclick();
  assert.equal(corpo.querySelectorAll('iframe').length, 0);
  assert.equal(corpo.querySelector('pre').textContent, HTML);
  assert.equal(codigo.getAttribute('aria-selected'), 'true');
  previa.onclick();
  assert.equal(corpo.querySelectorAll('iframe').length, 1);
  assert.equal(previa.getAttribute('aria-selected'), 'true');
});

test('tela: texto comum continua em código, sem iframe e sem os modos', async () => {
  const { ctx, P, v, corpo } = montarTela({ tipo: 'texto', nome: 'dados.tsv', ext: 'tsv', bytes: 9, dados: 'a\tb\n1\t2\n' });
  await ctx.verArquivo(P, 'C:\\x\\dados.tsv', null);
  assert.equal(corpo.querySelectorAll('iframe').length, 0);
  assert.equal(corpo.querySelector('pre').textContent, 'a\tb\n1\t2\n');
  assert.equal(v.querySelector('.visor-modos').classes.has('hidden'), true);
});

test('tela: PDF deste PC pede a janela própria ao main e o visor sai quando ela abre', async () => {
  const { ctx, P, v, pdfs, abertos } = montarTela({ tipo: 'pdf', nome: 'proposta.pdf', ext: 'pdf', bytes: 182272 });
  await ctx.verArquivo(P, 'C:\\Users\\hugom\\Relatórios do mês\\proposta.pdf', null);
  assert.deepEqual(pdfs, ['C:\\Users\\hugom\\Relatórios do mês\\proposta.pdf']);
  assert.deepEqual(abertos, [], 'não manda pro programa quando a janela do PDF abriu');
  assert.equal(v.classes.has('hidden'), true, 'o PDF está na janela dele: o visor fecha');
});

test('tela: PDF sem visualizador diz o motivo e oferece "Abrir no programa" (openPath seguro)', async () => {
  const { ctx, P, v, api, corpo, abertos } = montarTela({ tipo: 'pdf', nome: 'proposta.pdf', ext: 'pdf', bytes: 182272 });
  api.abrirPdf = async () => ({ error: 'O visualizador de PDF não está disponível aqui.' });
  await ctx.verArquivo(P, 'C:\\x\\proposta.pdf', null);
  assert.equal(v.classes.has('hidden'), false);
  assert.match(corpo.textContent, /O visualizador de PDF não está disponível aqui\./);
  assert.doesNotMatch(corpo.textContent, /Este tipo não abre/);
  const bt = botao(corpo, 'Abrir no programa');
  assert.ok(bt, 'falta o botão "Abrir no programa"');
  await bt.onclick();
  assert.deepEqual(abertos, ['C:\\x\\proposta.pdf']);
  // promessa recusada (canal que não existe, janela sem acesso) também vira recado com o botão
  api.abrirPdf = async () => { throw new Error('Esta janela não pode acessar este recurso do Cockpit.'); };
  await ctx.verArquivo(P, 'C:\\x\\proposta.pdf', null);
  assert.match(corpo.textContent, /não pode acessar este recurso/);
  assert.ok(botao(corpo, 'Abrir no programa'));
});

test('tela: PDF do servidor não abre janela nem tem botão: só abre no programa (o daqui não alcança o servidor)', async () => {
  const { ctx, P, corpo, pdfs } = montarTela({ tipo: 'pdf', nome: 'relatorio.pdf', ext: 'pdf', bytes: 182272 });
  await ctx.verArquivo(P, '/home/hugo/relatorio.pdf', SERVIDOR);
  assert.deepEqual(pdfs, []);
  assert.match(corpo.textContent, /PDF no servidor: só abre no programa/);
  assert.equal(botoes(corpo).length, 0);
});

test('tela: DOCX diz "Documento do Word: abra no programa" e XLSX "Planilha do Excel: abra no programa", com o botão', async () => {
  for (const [nome, ext, frase] of [['proposta.docx', 'docx', 'Documento do Word: abra no programa'], ['planilha.xlsx', 'xlsx', 'Planilha do Excel: abra no programa']]) {
    const { ctx, P, corpo, abertos } = montarTela({ tipo: 'documento', nome, ext, bytes: 20480 });
    await ctx.verArquivo(P, 'C:\\x\\' + nome, null);
    assert.ok(corpo.textContent.includes(frase), nome + ': ' + corpo.textContent);
    assert.doesNotMatch(corpo.textContent, /Este tipo não abre/);
    const bt = botao(corpo, 'Abrir no programa');
    assert.ok(bt, nome + ': falta o botão');
    await bt.onclick();
    assert.deepEqual(abertos, ['C:\\x\\' + nome]);
  }
});

test('tela: 725 KB diz "Grande demais para o leitor (725 KB; limite 600 KB)" com "Abrir no programa", nunca "tipo não abre"', async () => {
  const { ctx, P, corpo, abertos } = montarTela({ tipo: 'grande', nome: 'grande.md', ext: 'md', bytes: 742010, limite: 600 * 1024 });
  await ctx.verArquivo(P, 'C:\\Users\\hugom\\scratch\\grande.md', null);
  assert.ok(corpo.textContent.includes('Grande demais para o leitor (725 KB; limite 600 KB)'), corpo.textContent);
  assert.doesNotMatch(corpo.textContent, /Este tipo não abre/);
  const bt = botao(corpo, 'Abrir no programa');
  assert.ok(bt);
  await bt.onclick();
  assert.deepEqual(abertos, ['C:\\Users\\hugom\\scratch\\grande.md']);
});

test('tela: no servidor, Word e "grande demais" explicam sem o botão', async () => {
  for (const resposta of [{ tipo: 'documento', nome: 'p.docx', ext: 'docx', bytes: 9 }, { tipo: 'grande', nome: 'g.md', ext: 'md', bytes: 742010, limite: 600 * 1024 }]) {
    const { ctx, P, corpo } = montarTela(resposta);
    await ctx.verArquivo(P, '/home/hugo/' + resposta.nome, SERVIDOR);
    assert.match(corpo.textContent, /Documento do Word: abra no programa|Grande demais para o leitor \(725 KB; limite 600 KB\)/);
    assert.match(corpo.textContent, /servidor/);
    assert.equal(botoes(corpo).length, 0, resposta.nome);
  }
});

test('tela: tipo que o leitor não conhece continua com o recado de sempre', async () => {
  const { ctx, P, corpo } = montarTela({ tipo: 'outro', nome: 'pacote.zip', ext: 'zip', bytes: 10 });
  await ctx.verArquivo(P, 'C:\\x\\pacote.zip', null);
  assert.match(corpo.textContent, /Este tipo não abre aqui dentro/);
});

/* ================================================================== */
/* a ponte (preload), o simulador da prévia e o CSS                    */
/* ================================================================== */
test('preload: abrirPdf fica AO LADO do verArquivo e chama o canal pdf:abrir com o caminho', async () => {
  const bus = new EventEmitter(), chamadas = [];
  let api;
  bus.sendSync = () => ({});
  bus.invoke = async (...args) => { chamadas.push(args); return { ok: true }; };
  vm.runInNewContext(PRELOAD, {
    process: { platform: 'win32' },
    require: () => ({ ipcRenderer: bus, webUtils: {}, contextBridge: { exposeInMainWorld: (_nome, valor) => { api = valor; } } }),
  });
  assert.equal(typeof api.abrirPdf, 'function', 'falta api.abrirPdf');
  await api.abrirPdf('C:\\x\\a.pdf');
  assert.deepEqual(chamadas, [['pdf:abrir', 'C:\\x\\a.pdf']]);
  const linhas = PRELOAD.split('\n');
  const i = linhas.findIndex((l) => /^\s*verArquivo:/.test(l));
  assert.ok(i > 0 && linhas.slice(i + 1, i + 4).some((l) => /^\s*abrirPdf:/.test(l)), 'abrirPdf logo depois do verArquivo');
});

test('simulador (mock-api.js): abrirPdf está declarado, ao lado do verArquivo, e responde { ok: true }', async () => {
  const MOCK = fs.readFileSync(path.join(RAIZ, 'tools', 'redesenho', 'mock-api.js'), 'utf8');
  const win = {};
  const ctx = vm.createContext({
    window: win, location: { search: '' }, URLSearchParams, JSON, Date, Math, Object, Array, String, Promise, Proxy, Set, Map,
    setTimeout, queueMicrotask, console, addEventListener() {},
  });
  vm.runInContext(MOCK, ctx);
  assert.equal(typeof win.api.abrirPdf, 'function');
  assert.equal(win.__qa.missing.has('abrirPdf'), false);
  assert.deepEqual(simples(await win.api.abrirPdf('C:/Projetos/Demonstracao/a.pdf')), { ok: true });
  const ver = MOCK.indexOf('verArquivo:async'), pdf = MOCK.indexOf('abrirPdf:async');
  assert.ok(ver > 0 && pdf > ver && pdf - ver < 1200, 'abrirPdf logo depois do verArquivo');
});

test('CSS: o HTML ocupa o corpo sem margem e a página sem fundo fica branca (texto preto some no tema escuro)', () => {
  const css = lerFonte('renderer', 'style.css');
  assert.ok(/\.visor-amplo \.visor-corpo\[data-tipo="html"\]\{padding:0\}/.test(css), 'falta o padding:0 do corpo com HTML');
  assert.ok(/\.visor-amplo \.visor-corpo\[data-tipo="html"\] iframe\{background:#fff\}/.test(css), 'falta o fundo branco do iframe');
  // o recado do PDF (que abre na janela dele) não perde a margem: o padding:0 é só do HTML
  assert.ok(!/\[data-tipo="pdf"\]/.test(css), 'o corpo do PDF não tem mais regra própria (o PDF abre na janela dele)');
});
