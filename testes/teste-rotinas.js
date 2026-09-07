/* Leva 37 / Fase C: a view lateral de ROTINAS -- as tarefas agendadas do
   Windows.

   A tela existe por causa do silencio: duas automacoes do Hugo estavam paradas
   ha semanas (RadarSkillsMCP em 0x800710E0, SkillReviewMensal em 0xC000013A) e
   nada na maquina avisava. O que este teste segura:

     a) o handler devolve ERRO em vez de lista vazia quando o PowerShell falha
        -- sem isso a falha viraria "nenhuma rotina" e envenenaria o cache;
     b) no erro, o cache bom de antes e' preservado e marcado como velho;
     c) os codigos do Agendador saem traduzidos, e o que nao esta na tabela sai
        como hexadecimal, sem inventar significado;
     d) "nunca rodou" e "rodando agora" NAO contam como falha (senao afogam as
        quebras de verdade no meio de dezenas de linhas vermelhas);
     e) rotinasGen: dois repaints em voo nao montam um por cima do outro;
     f) guarda de :hover no repaint periodico (senao o botao some no clique);
     g) "disparar agora" pergunta antes e tem trava de duplo clique;
     h) texto vindo do sistema entra por textContent, nunca por innerHTML;
     i) o disparo recusa nome com quebra de linha (injecao no PowerShell);
     j) fora do Windows sai erro claro, sem quebrar;
     k) os tres arquivos foram tocados (main + preload + tela) e a cor nova
        entrou nos TRES temas.

   As funcoes e os handlers sao recortados do fonte de verdade e rodados dentro
   de um vm, entao o que passa aqui e' o codigo que vai pro asar. */
const vm = require('vm');
const { lerFonte, globaisFalsos, pegarBloco } = require('./raiz');

const main = lerFonte('main.js');
const app = lerFonte('renderer', 'app.js');
const preload = lerFonte('preload.js');
const html = lerFonte('renderer', 'index.html');
const css = lerFonte('renderer', 'style.css');

let falhas = 0;
const checa = (nome, ok, det) => {
  if (ok) console.log('  ok   ' + nome);
  else { falhas++; console.log('  FALHA ' + nome + (det ? ' -> ' + det : '')); }
};

/* =====================================================================
   1) BACKEND: rotinas:listar e rotinas:disparar, do fonte de verdade
   ===================================================================== */

// o bloco inteiro (constantes + tabela de codigos + os dois handlers)
const iniM = main.indexOf('const ROTINAS_PS = [');
const fimM = main.indexOf("ipcMain.handle('pane:start'");
checa('main: o bloco das rotinas esta no fonte', iniM > 0 && fimM > iniM);
const blocoMain = main.slice(iniM, fimM);

let relogio = 1000000;              // Date.now() controlado, pra envelhecer o cache na mao
let respostaDoRodar = null;         // o que o "PowerShell" devolve nesta chamada
const chamadas = [];                // o que foi pedido ao rodar()
const handlers = {};

const ctxMain = {
  ...globaisFalsos(), console, Buffer, RegExp,
  EH_WIN: true,
  /* usuario e casa fixos: quem separa "rotina dele" de "rotina de fabricante" e'
     o par autor+programa, e o teste nao pode depender de quem esta' logado. */
  os: { userInfo: () => ({ username: 'hugom' }) },
  process: { env: { USERNAME: 'hugom' } },
  HOME: 'C:\\Users\\hugom',
  Date: { now: () => relogio },
  ipcMain: { handle: (canal, fn) => { handlers[canal] = fn; } },
  rodar: (bin, args, timeout) => { chamadas.push({ bin, args, timeout }); return Promise.resolve(respostaDoRodar); },
};
vm.createContext(ctxMain);
vm.runInContext(blocoMain, ctxMain);
checa('main: os dois canais foram registrados', typeof handlers['rotinas:listar'] === 'function' && typeof handlers['rotinas:disparar'] === 'function');

const listar = () => handlers['rotinas:listar'](null);
const disparar = (o) => handlers['rotinas:disparar'](null, o);

// uma saida de PowerShell igual a' da maquina de verdade (a mesma forma e os
// mesmos codigos que apareceram no Agendador do Hugo)
const SAIDA_BOA = JSON.stringify([
  { nome: 'BackupVPSHostinger', caminho: '\\', estado: 'Ready', ultima: '2026-09-07T10:00:01.0000000-03:00', resultado: 0, proxima: '2026-09-08T10:00:00.0000000-03:00' },
  { nome: 'RadarSkillsMCP', caminho: '\\', estado: 'Ready', ultima: '2026-08-25T08:56:36.0000000-03:00', resultado: 2147946720, proxima: '2026-09-15T09:30:00.0000000-03:00' },
  { nome: 'SkillReviewMensal', caminho: '\\', estado: 'Ready', ultima: '2026-09-01T09:55:27.0000000-03:00', resultado: 3221225786, proxima: '2026-10-01T09:30:00.0000000-03:00' },
  { nome: 'UserModeWorker', caminho: '\\Samsung\\SamsungUpdate\\', estado: 'Running', ultima: '2026-09-07T12:46:14.0000000-03:00', resultado: 267009, proxima: '' },
  { nome: 'SoftLandingCreativeManagementTask', caminho: '\\SoftLanding\\', estado: 'Disabled', ultima: '', resultado: 267011, proxima: '2026-09-08T11:11:39.0000000-03:00' },
  { nome: 'OneDrive Per-Machine Standalone Update Task', caminho: '\\', estado: 'Ready', ultima: '2026-09-06T21:19:17.0000000-03:00', resultado: 2147806724, proxima: '' },
]);

(async () => {
  /* ---- a lista boa, normalizada campo a campo ---- */
  respostaDoRodar = { err: null, out: SAIDA_BOA, errout: '' };
  const r1 = await listar();
  const porNome = {};
  for (const t of (r1.itens || [])) porNome[t.nome] = t;
  checa('listar: devolve as rotinas normalizadas', (r1.itens || []).length === 6 && !r1.error, JSON.stringify(r1).slice(0, 200));
  checa('listar: usa o PowerShell por -EncodedCommand (base64 de UTF-16)',
    chamadas.length === 1 && chamadas[0].bin === 'powershell.exe' && chamadas[0].args.includes('-EncodedCommand') && chamadas[0].args.includes('-NoProfile'));
  const script = Buffer.from(String(chamadas[0].args[chamadas[0].args.indexOf('-EncodedCommand') + 1]), 'base64').toString('utf16le');
  checa('listar: o script filtra as tarefas do proprio Windows',
    /Get-ScheduledTask/.test(script) && /Get-ScheduledTaskInfo/.test(script)
    && script.indexOf("-like '" + String.fromCharCode(92) + "Microsoft" + String.fromCharCode(92) + "*'") > 0
    && script.indexOf("-like '" + String.fromCharCode(92) + "Windows" + String.fromCharCode(92) + "*'") > 0, script.slice(0, 400));

  /* ---- (c) e (d): a traducao dos codigos ---- */
  checa('codigo 0 = deu certo, e nao e falha', porNome.BackupVPSHostinger.motivo === 'deu certo' && porNome.BackupVPSHostinger.falhou === false);
  checa('0x800710E0 vira "o agendador recusou a execução" e E falha',
    porNome.RadarSkillsMCP.motivo === 'o agendador recusou a execução' && porNome.RadarSkillsMCP.falhou === true, porNome.RadarSkillsMCP.motivo);
  checa('0xC000013A vira "o processo foi interrompido" e E falha',
    porNome.SkillReviewMensal.motivo === 'o processo foi interrompido' && porNome.SkillReviewMensal.falhou === true, porNome.SkillReviewMensal.motivo);
  checa('0x41301 = "está rodando agora" e NAO e falha', porNome.UserModeWorker.motivo === 'está rodando agora' && porNome.UserModeWorker.falhou === false);
  checa('0x41303 = "nunca rodou" e NAO e falha', porNome.SoftLandingCreativeManagementTask.motivo === 'nunca rodou' && porNome.SoftLandingCreativeManagementTask.falhou === false);
  checa('codigo desconhecido sai em hexadecimal, sem inventar significado',
    porNome['OneDrive Per-Machine Standalone Update Task'].motivo === 'código 0x8004EE04' && porNome['OneDrive Per-Machine Standalone Update Task'].falhou === true,
    porNome['OneDrive Per-Machine Standalone Update Task'].motivo);
  checa('estado do Windows vira palavra em portugues',
    porNome.BackupVPSHostinger.estado === 'pronta' && porNome.UserModeWorker.estado === 'rodando' && porNome.SoftLandingCreativeManagementTask.estado === 'desativada');
  checa('nada de objeto cru: so os campos previstos, com o tipo forcado',
    JSON.stringify(Object.keys(porNome.RadarSkillsMCP).sort()) === '["caminho","dele","estado","falhou","motivo","nome","proxima","resultado","ultima"]'
    && typeof porNome.RadarSkillsMCP.nome === 'string' && typeof porNome.RadarSkillsMCP.resultado === 'number' && typeof porNome.RadarSkillsMCP.falhou === 'boolean',
    JSON.stringify(Object.keys(porNome.RadarSkillsMCP)));

  /* resultado ausente nao pode virar 0 ("deu certo"): Number(null) e Number('')
     dao zero, e o app estaria afirmando algo que nao sabe */
  relogio += 60000;
  respostaDoRodar = { err: null, errout: '', out: JSON.stringify([
    { nome: 'SemInfo', caminho: '\\', estado: 'Ready', ultima: '', resultado: null, proxima: '' },
    { nome: 'InfoVazia', caminho: '\\', estado: 'Ready', ultima: '', resultado: '', proxima: '' },
    { nome: 'InfoLixo', caminho: '\\', estado: 'Ready', ultima: '', resultado: 'abc', proxima: '' },
    { nome: '', caminho: '\\', estado: 'Ready', ultima: '', resultado: 0, proxima: '' },
  ]) };
  const rSem = await listar();
  checa('resultado ausente/invalido vira desconhecido, nunca "deu certo"',
    (rSem.itens || []).length === 3 && rSem.itens.every((t) => t.resultado === null && t.motivo === '' && t.falhou === false),
    JSON.stringify(rSem.itens));
  checa('rotina sem nome nao entra na lista', !(rSem.itens || []).some((t) => !t.nome));

  /* ---- ACHADO 6 e 7 da auditoria, no backend ----
     6: rotina RODANDO agora nao pode sair como falha -- o resultado guardado e'
        o da execucao anterior (RtkAudUService64_BG, Running, 0x40010004).
     7: separar as automacoes DELE das do sistema. A pasta nao separa nada
        (OneDrive, Realtek e Zoom moram na raiz igual as dele); quem separa e' o
        par autor + programa. Os dados abaixo sao os do Agendador desta maquina,
        copiados campo a campo. */
  relogio += 60000;
  respostaDoRodar = { err: null, errout: '', out: JSON.stringify([
    { nome: 'BackupVPSHostinger', caminho: '\\', estado: 'Ready', ultima: '2026-09-07T10:00:01-03:00', resultado: 0, proxima: '', autor: '', programa: 'wscript.exe' },
    { nome: 'RadarSkillsMCP', caminho: '\\', estado: 'Ready', ultima: '2026-08-25T08:56:36-03:00', resultado: 2147946720, proxima: '', autor: 'HUGOMOTTI\\hugom', programa: 'wscript.exe' },
    { nome: 'SkillReviewMensal', caminho: '\\', estado: 'Ready', ultima: '2026-09-01T09:55:27-03:00', resultado: 3221225786, proxima: '', autor: '', programa: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' },
    { nome: 'OneDrive Per-Machine Standalone Update Task', caminho: '\\', estado: 'Ready', ultima: '2026-09-06T21:19:17-03:00', resultado: 2147806724, proxima: '', autor: 'Microsoft Corporation', programa: 'C:\\Program Files\\Microsoft OneDrive\\OneDriveStandaloneUpdater.exe' },
    { nome: 'RtkAudUService64_BG', caminho: '\\', estado: 'Running', ultima: '2026-09-07T13:00:00-03:00', resultado: 1073807364, proxima: '', autor: 'Realtek', programa: '""C:\\WINDOWS\\System32\\DriverStore\\FileRepository\\realtek.inf\\RtkAudUService64.exe""' },
    { nome: 'RunPlatformExperienceHelper_Daily', caminho: '\\GoogleUserPEH\\', estado: 'Ready', ultima: '', resultado: 0, proxima: '', autor: 'HUGOMOTTI\\hugom', programa: '"C:\\Program Files\\Google\\Chrome\\Application\\PlatformExperienceHelper\\platform_experience_helper.exe"' },
  ]) };
  const rDono = await listar();
  const pn = {};
  for (const t of (rDono.itens || [])) pn[t.nome] = t;
  checa('(7) automacao dele com autor vazio e interpretador de script conta como DELE',
    pn.BackupVPSHostinger.dele === true && pn.SkillReviewMensal.dele === true);
  checa('(7) automacao dele com o proprio usuario como autor tambem',
    pn.RadarSkillsMCP.dele === true);
  checa('(7) tarefa de fabricante NAO e dele, mesmo morando na raiz igual as dele',
    pn['OneDrive Per-Machine Standalone Update Task'].dele === false && pn.RtkAudUService64_BG.dele === false);
  checa('(7) tarefa com o usuario como autor mas .exe de Program Files (Chrome) tambem nao',
    pn.RunPlatformExperienceHelper_Daily.dele === false);
  checa('(6) rotina RODANDO agora nao sai marcada como falha',
    pn.RtkAudUService64_BG.estado === 'rodando' && pn.RtkAudUService64_BG.falhou === false,
    JSON.stringify(pn.RtkAudUService64_BG));
  checa('(6) e a que falhou parada continua marcada',
    pn.RadarSkillsMCP.falhou === true && pn.SkillReviewMensal.falhou === true);
  const dele = (rDono.itens || []).filter((t) => t.dele && t.falhou).map((t) => t.nome).sort();
  checa('(7) so as DUAS falhas dele ficam pro bloco vermelho (as outras 2 sao ruido do sistema)',
    dele.join(',') === 'RadarSkillsMCP,SkillReviewMensal', dele.join(','));
  // devolve o cache ao estado bom, que os testes de falha logo abaixo conferem
  relogio += 60000;
  respostaDoRodar = { err: null, out: SAIDA_BOA, errout: '' };
  await listar();

  /* ---- cache curto: nao chama o PowerShell de novo em 15 s ---- */
  const antes = chamadas.length;
  await listar();
  checa('listar: cache de 15 s poupa o PowerShell', chamadas.length === antes);

  /* ---- (a) e (b): o PowerShell falha ---- */
  relogio += 60000;                                     // envelhece o cache
  respostaDoRodar = { err: new Error('saiu com código 1'), out: '', errout: 'nao rolou' };
  const r2 = await listar();
  checa('(a) PowerShell falhando devolve ERRO, nao lista vazia calada', !!r2.error, JSON.stringify(r2).slice(0, 200));
  checa('(a) o erro traz o motivo do PowerShell, nao so "saiu com codigo 1"', /nao rolou/.test(String(r2.error || '')), String(r2.error));
  checa('(b) o cache bom de antes e preservado e marcado como velho',
    (r2.itens || []).length === 6 && r2.velho === true, JSON.stringify({ n: (r2.itens || []).length, velho: r2.velho }));

  // e o cache nao pode ter sido envenenado pela falha: a proxima leitura boa volta inteira
  relogio += 60000;
  respostaDoRodar = { err: null, out: SAIDA_BOA, errout: '' };
  const r3 = await listar();
  checa('a falha nao envenenou o cache', (r3.itens || []).length === 6 && !r3.error);

  // saida com sujeira antes do JSON (o PowerShell as vezes fala demais)
  relogio += 60000;
  respostaDoRodar = { err: new Error('codigo 1'), out: '[]', errout: '' };
  const r4 = await listar();
  checa('erro COM saida valida nao vira excecao: [] legitimo passa', !r4.error && (r4.itens || []).length === 0, JSON.stringify(r4));

  /* ---- disparar ---- */
  respostaDoRodar = { err: null, out: 'ok\r\n', errout: '' };
  const d1 = await disparar({ nome: 'RadarSkillsMCP', caminho: '\\' });
  checa('disparar: Start-ScheduledTask com nome e caminho', d1.ok === true, JSON.stringify(d1));
  const scriptD = Buffer.from(String(chamadas[chamadas.length - 1].args[chamadas[chamadas.length - 1].args.indexOf('-EncodedCommand') + 1]), 'base64').toString('utf16le');
  checa('disparar: o nome vai como texto literal do PowerShell', /Start-ScheduledTask -TaskName 'RadarSkillsMCP' -TaskPath '/.test(scriptD), scriptD.slice(0, 300));

  // (i) injecao: nome com quebra de linha nao chega no PowerShell
  const nChamadas = chamadas.length;
  const dInj = await disparar({ nome: 'X' + String.fromCharCode(10) + "Remove-Item C:'", caminho: '\\' });
  checa('(i) disparar recusa nome com quebra de linha, sem rodar nada', !!dInj.error && chamadas.length === nChamadas, JSON.stringify(dInj));
  const dVazio = await disparar({});
  checa('disparar sem nome recusa', !!dVazio.error);

  // nome com espaco e acento PASSA (metade das tarefas da maquina tem)
  respostaDoRodar = { err: null, out: 'ok', errout: '' };
  const dEsp = await disparar({ nome: "OneDrive Reporting Task d'Ana", caminho: '\\' });
  checa('disparar aceita espaco e apostrofo (aspa dobrada, como manda o PowerShell)', dEsp.ok === true, JSON.stringify(dEsp));
  const scriptE = Buffer.from(String(chamadas[chamadas.length - 1].args[chamadas[chamadas.length - 1].args.indexOf('-EncodedCommand') + 1]), 'base64').toString('utf16le');
  checa('disparar: a aspa simples do nome vai dobrada', /-TaskName 'OneDrive Reporting Task d''Ana'/.test(scriptE), scriptE.slice(0, 300));

  // o erro do PowerShell volta pelo stdout, em texto, e vira frase em pt-BR
  respostaDoRodar = { err: null, out: 'erro: Acesso negado.\r\n', errout: '' };
  const dNeg = await disparar({ nome: 'X', caminho: '\\' });
  checa('disparar: erro do Windows sai em portugues', /negou acesso/.test(String(dNeg.error || '')), JSON.stringify(dNeg));
  respostaDoRodar = { err: null, out: 'erro: O sistema não pode encontrar o arquivo especificado.', errout: '' };
  const dSem = await disparar({ nome: 'X', caminho: '\\' });
  checa('disparar: "não pode encontrar" vira "o Windows não achou essa rotina"', /não achou essa rotina/.test(String(dSem.error || '')), JSON.stringify(dSem));
  /* CLIXML no stderr foi o que apareceu na maquina de verdade antes da correcao:
     uma sopa de XML ia direto pra faixa de avisos no lugar do motivo. */
  const clixml = '#< CLIXML\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><S S="Error">Start-ScheduledTask : Acesso negado._x000D__x000A_</S></Objs>';
  respostaDoRodar = { err: new Error('codigo 1'), out: '', errout: clixml };
  const dXml = await disparar({ nome: 'X', caminho: '\\' });
  checa('disparar: CLIXML do stderr nao vaza pra tela', /negou acesso/.test(String(dXml.error || '')) && !/CLIXML|<Objs/.test(String(dXml.error || '')), JSON.stringify(dXml));
  respostaDoRodar = { err: new Error('codigo 1'), out: '', errout: '' };
  const dMudo = await disparar({ nome: 'X', caminho: '\\' });
  checa('disparar: agendador mudo vira frase, nao string vazia', /não respondeu|não confirmou/.test(String(dMudo.error || '')), JSON.stringify(dMudo));

  /* ---- (j) fora do Windows ---- */
  const ctxMac = { ...globaisFalsos(), console, Buffer, RegExp, EH_WIN: false, Date: { now: () => 1 },
    os: { userInfo: () => ({ username: 'hugo' }) }, process: { env: {} }, HOME: '/home/hugo',
    ipcMain: { handle: (c, f) => { hMac[c] = f; } }, rodar: () => { throw new Error('nao podia ter chamado'); } };
  const hMac = {};
  vm.createContext(ctxMac);
  vm.runInContext(blocoMain, ctxMac);
  const mac1 = await hMac['rotinas:listar'](null);
  const mac2 = await hMac['rotinas:disparar'](null, { nome: 'X' });
  checa('(j) fora do Windows: erro claro e lista vazia, sem quebrar',
    /só existem no Windows/.test(String(mac1.error || '')) && Array.isArray(mac1.itens) && /só existem no Windows/.test(String(mac2.error || '')),
    JSON.stringify([mac1, mac2]));

  /* =====================================================================
     2) TELA: linhaDaRotina, dispararRotina e pintarRotinas
     ===================================================================== */
  class El {
    constructor(tag) {
      this.tagName = String(tag || 'div').toUpperCase();
      this.className = ''; this.style = {}; this.dataset = {}; this.title = '';
      this.filhos = []; this.texto = ''; this._html = ''; this.eventos = {};
      this.classes = new Set(); this._achados = new Map(); this.disabled = false; this.pai = null;
    }
    get classList() {
      const eu = this;
      return {
        add: (...c) => c.forEach((x) => eu.classes.add(x)),
        remove: (...c) => c.forEach((x) => eu.classes.delete(x)),
        contains: (c) => eu.classes.has(c) || String(eu.className).split(/\s+/).includes(c),
      };
    }
    get innerHTML() { return this._html; }
    set innerHTML(v) { this._html = String(v); this.filhos = []; }
    get textContent() { return this.texto; }
    set textContent(v) { this.texto = String(v); }
    appendChild(c) { c.pai = this; this.filhos.push(c); return c; }
    remove() { if (this.pai) this.pai.filhos = this.pai.filhos.filter((f) => f !== this); this.pai = null; }
    addEventListener(n, f) { (this.eventos[n] = this.eventos[n] || []).push(f); }
    async disparar(n, ev) { for (const f of (this.eventos[n] || [])) await f(ev || { stopPropagation: () => {} }); }
    matches() { return false; }        // nunca esta sob o mouse nos testes
    buscar(sel) {
      if (!this._achados.has(sel)) this._achados.set(sel, new El('span'));
      return this._achados.get(sel);
    }
  }
  const caixaRot = new El('div');
  const viewRot = new El('div');
  const sidebar = new El('div');
  const porSeletor = { '#rotinas': caixaRot, '.side-view[data-view="rotinas"]': viewRot, '#sidebar': sidebar };

  let perguntou = 0, respostaDoConfirm = true;
  const avisos = [];
  const disparosPedidos = [];
  let respostaListar = { itens: [] };
  let respostaDisparar = { ok: true };
  let seguraODisparo = null;           // promessa que o teste solta na mao

  const ctxApp = {
    ...globaisFalsos(), console,
    document: { createElement: (t) => new El(t) },
    $: (sel, raiz) => (raiz && raiz.buscar ? raiz.buscar(sel) : (porSeletor[sel] || null)),
    ico: (n) => '<svg data-ico="' + n + '"></svg>',   // a seta do grupo recolhivel
    confirm: (txt) => { perguntou++; avisos.push({ confirm: txt }); return respostaDoConfirm; },
    mostrarAviso: (o) => avisos.push(o),
    window: {
      api: {
        rotinasListar: () => Promise.resolve(respostaListar),
        rotinasDisparar: (o) => { disparosPedidos.push(o); return seguraODisparo || Promise.resolve(respostaDisparar); },
      },
    },
  };
  vm.createContext(ctxApp);
  const iniA = app.indexOf('let rotinasCache = ');
  const fimA = app.indexOf('/* ===================== ENTRADA SEM DIGITAR', iniA);
  checa('tela: o bloco das rotinas esta no app.js', iniA > 0 && fimA > iniA);
  vm.runInContext(app.slice(iniA, fimA), ctxApp);

  /* ---- (h) texto do sistema por textContent ---- */
  const veneno = '<img src=x onerror="alert(1)"> & "aspas"';
  const linha = ctxApp.linhaDaRotina({ nome: veneno, caminho: '\\', estado: 'pronta', ultima: '', proxima: '', resultado: 0, motivo: 'deu certo', falhou: false });
  checa('(h) o nome vindo do Windows entra por textContent',
    linha.buscar('.ri-tit').textContent === veneno && linha.innerHTML.indexOf('<img') < 0, JSON.stringify(linha.innerHTML).slice(0, 160));
  checa('(h) o innerHTML da linha e so o esqueleto fixo, sem concatenar dado',
    /d\.innerHTML = '<span class="ri-pt"><\/span><span class="ri-txt"><span class="ri-tit"><\/span><span class="ri-est"><\/span><span class="ri-quando"><\/span><\/span>';/.test(app));

  /* ---- estado -> classe (reusando os modificadores da torre) ---- */
  const base = { caminho: '\\', ultima: '2026-09-01T09:55:27-03:00', proxima: '', resultado: 0, motivo: 'deu certo', falhou: false };
  const cls = (t) => String(ctxApp.linhaDaRotina({ nome: 'x', ...base, ...t }).className);
  checa('falha usa .espera (o vermelho da torre)', cls({ estado: 'pronta', falhou: true, motivo: 'o processo foi interrompido' }).includes('espera'));
  checa('rodando usa .ocupado, desativada usa .fora, o resto .parado',
    cls({ estado: 'rodando' }).includes('ocupado') && cls({ estado: 'desativada' }).includes('fora') && cls({ estado: 'pronta' }).includes('parado'));
  const linhaFalha = ctxApp.linhaDaRotina({ nome: 'RadarSkillsMCP', ...base, estado: 'pronta', falhou: true, motivo: 'o agendador recusou a execução' });
  checa('a linha quebrada mostra o motivo traduzido, nao o codigo cru',
    /^falhou em .*: o agendador recusou a execução$/.test(linhaFalha.buscar('.ri-est').textContent), linhaFalha.buscar('.ri-est').textContent);

  /* ---- ACHADO 6 da auditoria: quem esta RODANDO nao pode aparecer quebrado ----
     Ao vivo nesta maquina: "RtkAudUService64_BG || falhou em hoje 13:00: codigo
     0x40010004", com a tarefa em Running. O 'falhou' e' o resultado da execucao
     ANTERIOR; o estado fala de agora, e agora ganha. */
  const rodandoEFalhou = { nome: 'RtkAudUService64_BG', ...base, estado: 'rodando', falhou: true, resultado: 1073807364, motivo: 'código 0x40010004' };
  checa('(6) rotina RODANDO nao usa a classe de falha, mesmo com resultado ruim guardado',
    cls(rodandoEFalhou).includes('ocupado') && !cls(rodandoEFalhou).includes('espera'), cls(rodandoEFalhou));
  const lRodando = ctxApp.linhaDaRotina(rodandoEFalhou);
  checa('(6) e o texto diz que esta rodando agora, nao que falhou',
    /^rodando agora/.test(lRodando.buscar('.ri-est').textContent)
    && !/falhou/.test(lRodando.buscar('.ri-est').textContent), lRodando.buscar('.ri-est').textContent);
  checa('(6) a rotina parada que falhou de verdade continua vermelha',
    cls({ estado: 'pronta', falhou: true }).includes('espera'));

  /* ---- (g) confirmacao antes de disparar ---- */
  respostaDoConfirm = false;
  const bt = linhaFalha.filhos.find((f) => f.className === 'ri-acao');
  checa('a linha tem o botao "disparar"', !!bt && bt.textContent === 'disparar');
  await bt.disparar('click');
  checa('(g) sem confirmar, nada e disparado', perguntou === 1 && disparosPedidos.length === 0);

  /* ---- (g) trava de duplo clique ---- */
  respostaDoConfirm = true;
  let soltar;
  seguraODisparo = new Promise((res) => { soltar = res; });
  const emVoo = ctxApp.dispararRotina({ nome: 'RadarSkillsMCP', caminho: '\\' }, new El('button'));
  const segundo = ctxApp.dispararRotina({ nome: 'RadarSkillsMCP', caminho: '\\' }, new El('button'));
  await segundo;
  checa('(g) duplo clique na mesma rotina dispara UMA vez so', disparosPedidos.length === 1, JSON.stringify(disparosPedidos));
  soltar({ ok: true });
  await emVoo;
  seguraODisparo = null;
  checa('depois que o agendador responde, a rotina destrava',
    avisos.some((a) => a && a.tipo === 'info' && /foi disparada agora/.test(String(a.texto || ''))), JSON.stringify(avisos.slice(-2)));
  // e um repaint no meio do disparo nao devolve o botao habilitado
  const emVoo2 = (() => { seguraODisparo = new Promise((res) => { soltar = res; }); return ctxApp.dispararRotina({ nome: 'X', caminho: '\\' }, new El('button')); })();
  const durante = ctxApp.linhaDaRotina({ nome: 'X', ...base, estado: 'pronta' }).filhos.find((f) => f.className === 'ri-acao');
  checa('(g) repaint durante o disparo mantem o botao travado', durante.disabled === true && durante.textContent === 'disparando…');
  soltar({ ok: true }); await emVoo2; seguraODisparo = null;

  // erro do agendador vira aviso vermelho
  respostaDisparar = { error: 'o Windows negou acesso' };
  await ctxApp.dispararRotina({ nome: 'Y', caminho: '\\' }, new El('button'));
  checa('disparo que falha vira aviso de erro na faixa do topo',
    avisos.some((a) => a && a.tipo === 'erro' && /negou acesso/.test(String(a.texto || ''))));
  respostaDisparar = { ok: true };

  /* dispararRotina termina com um pintarRotinas(true) solto (nao esperado, como
     o resto do app faz). Antes de medir a pintura, deixa esses repaints em voo
     assentarem -- senao e' o teste que se atropela, nao o codigo. */
  const assentar = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
  await assentar();

  /* ---- pintura: a falha vem PRIMEIRO, numa caixa propria ---- */
  respostaListar = {
    itens: [
      { nome: 'BackupVPSHostinger', caminho: '\\', estado: 'pronta', ultima: '2026-09-07T10:00:01-03:00', proxima: '2026-09-08T10:00:00-03:00', resultado: 0, motivo: 'deu certo', falhou: false },
      { nome: 'SkillReviewMensal', caminho: '\\', estado: 'pronta', ultima: '2026-09-01T09:55:27-03:00', proxima: '', resultado: 3221225786, motivo: 'o processo foi interrompido', falhou: true },
      { nome: 'ClaudeCodeSetupDiario', caminho: '\\', estado: 'pronta', ultima: '2026-09-06T18:00:01-03:00', proxima: '2026-09-07T18:00:00-03:00', resultado: 0, motivo: 'deu certo', falhou: false },
      { nome: 'RadarSkillsMCP', caminho: '\\', estado: 'pronta', ultima: '2026-08-25T08:56:36-03:00', proxima: '', resultado: 2147946720, motivo: 'o agendador recusou a execução', falhou: true },
    ],
  };
  await ctxApp.pintarRotinas(true);
  const primeiro = caixaRot.filhos[0];
  const caixaFalha = caixaRot.filhos[1];
  checa('o resumo abre a tela e conta as falhas',
    /2 suas falharam na última vez/.test(primeiro.textContent) && primeiro.className.includes('tem-falha'), primeiro.textContent);
  checa('a caixa vermelha vem antes de tudo, com as 2 quebradas dentro',
    caixaFalha && caixaFalha.className === 'rot-caixa' && caixaFalha.filhos.length === 3
    && caixaFalha.filhos.slice(1).map((f) => f.buscar('.ri-tit').textContent).join(',') === 'RadarSkillsMCP,SkillReviewMensal',
    caixaFalha && caixaFalha.filhos.slice(1).map((f) => f.buscar('.ri-tit').textContent).join(','));
  checa('as que estao em dia vem depois, fora da caixa vermelha',
    caixaRot.filhos.slice(2).filter((f) => f.className && f.className.startsWith('rot-item')).length === 2);

  // lista velha (o main devolveu cache) e' dita na cara
  respostaListar = { itens: respostaListar.itens, velho: true, error: 'saiu com código 1' };
  await ctxApp.pintarRotinas(true);
  checa('lista antiga avisa que nao conseguiu atualizar', /lista antiga/.test(caixaRot.filhos[0].textContent), caixaRot.filhos[0].textContent);

  // nenhuma falha: sem caixa vermelha
  respostaListar = { itens: [{ nome: 'A', caminho: '\\', estado: 'pronta', ultima: '', proxima: '', resultado: 0, motivo: 'deu certo', falhou: false }] };
  await ctxApp.pintarRotinas(true);
  checa('sem falha, a tela diz que todas rodaram sem erro e nao monta caixa vermelha',
    /todas rodaram sem erro/.test(caixaRot.filhos[0].textContent) && !caixaRot.filhos.some((f) => f.className === 'rot-caixa'));

  /* ---- ACHADO 7 na tela: o bloco vermelho vinha com 50% de ruido ----
     "35 rotinas · 4 falharam": duas dele (RadarSkillsMCP, SkillReviewMensal) e
     duas do sistema (OneDrive 0x8004EE04, Realtek 0x40010004). A tela existe pra
     ele ver as DELE. Agora as de fabricante vao pra um grupo proprio, recolhido
     -- presentes e contadas, fora do destaque. */
  const fichaDeRotina = (nome, dele, falhou) => ({
    nome, caminho: '\\', estado: 'pronta', ultima: '2026-09-01T09:00:00-03:00', proxima: '',
    resultado: falhou ? 3221225786 : 0, motivo: falhou ? 'o processo foi interrompido' : 'deu certo', falhou, dele,
  });
  respostaListar = { itens: [
    fichaDeRotina('RadarSkillsMCP', true, true), fichaDeRotina('SkillReviewMensal', true, true),
    fichaDeRotina('BackupVPSHostinger', true, false), fichaDeRotina('MeetAtas', true, false),
    fichaDeRotina('OneDrive Per-Machine Standalone Update Task', false, true),
    fichaDeRotina('RtkAudUService64_BG', false, true), fichaDeRotina('ZoomUpdateTaskUser', false, false),
  ] };
  await ctxApp.pintarRotinas(true);
  const cxV = caixaRot.filhos.find((f) => f.className === 'rot-caixa');
  const nomesDaCaixa = cxV ? cxV.filhos.filter((f) => String(f.className).startsWith('rot-item')).map((f) => f.buscar('.ri-tit').textContent) : [];
  checa('(7) o bloco vermelho fica SO com as falhas dele',
    nomesDaCaixa.join(',') === 'RadarSkillsMCP,SkillReviewMensal', nomesDaCaixa.join(','));
  checa('(7) o resumo conta as dele em destaque e as do sistema a parte',
    /7 rotinas · 2 suas falharam na última vez · 2 do sistema também/.test(caixaRot.filhos[0].textContent),
    caixaRot.filhos[0].textContent);
  const cabecalhos = caixaRot.filhos.filter((f) => String(f.className).startsWith('rot-grupo')).map((f) => f.buscar('.rot-nome').textContent);
  checa('(7) as do sistema ganham grupo proprio, com nome que diz o que sao',
    cabecalhos.includes('Do sistema e de programas'), cabecalhos.join(' | '));
  const cabSis = caixaRot.filhos.find((f) => String(f.className).startsWith('rot-grupo') && f.buscar('.rot-nome').textContent === 'Do sistema e de programas');
  checa('(7) o grupo do sistema nasce RECOLHIDO (nenhuma linha delas na tela)',
    !caixaRot.filhos.some((f) => String(f.className).startsWith('rot-item') && /OneDrive|Rtk|Zoom/.test(f.buscar('.ri-tit').textContent))
    && caixaRot.filhos.filter((f) => String(f.className).startsWith('rot-item')).length === 2);
  checa('(7) mas ele diz quantas sao e quantas falharam (nada some calado)',
    /3 rotinas · 2 com falha/.test(cabSis.buscar('.rot-conta').textContent), cabSis.buscar('.rot-conta').textContent);
  await cabSis.disparar('click');
  checa('(7) e um clique abre a lista das outras',
    caixaRot.filhos.some((f) => String(f.className).startsWith('rot-item') && f.buscar('.ri-tit').textContent === 'RtkAudUService64_BG'));
  const cabDepois = caixaRot.filhos.find((f) => String(f.className).startsWith('rot-grupo') && f.buscar('.rot-nome').textContent === 'Do sistema e de programas');
  await cabDepois.disparar('click');   // e outro fecha de novo, deixando a tela como estava
  checa('(7) e outro clique fecha',
    !caixaRot.filhos.some((f) => String(f.className).startsWith('rot-item') && f.buscar('.ri-tit').textContent === 'RtkAudUService64_BG'));
  // lista guardada por uma versao antiga nao tem o campo: na duvida, e' DELE
  respostaListar = { itens: [{ nome: 'SemCampoDele', caminho: '\\', estado: 'pronta', ultima: '', proxima: '', resultado: 3221225786, motivo: 'o processo foi interrompido', falhou: true }] };
  await ctxApp.pintarRotinas(true);
  checa('(7) rotina sem o campo "dele" (cache antigo) conta como dele, nunca some',
    !!caixaRot.filhos.find((f) => f.className === 'rot-caixa'), caixaRot.filhos.map((f) => f.className).join(','));

  /* ---- (e) rotinasGen: repaint em voo nao monta por cima ---- */
  checa('(e) rotinasGen existe e e conferido depois do await',
    /const gen = \+\+rotinasGen;/.test(app) && /if \(gen !== rotinasGen\) return;/.test(app));
  /* ACHADO 3: o perdedor da corrida repintava DENTRO do proprio return, e todo
     repaint tomava geracao nova -- isso derrubava o vencedor que ainda estava em
     voo. Agora a geracao e' so' de quem vai BUSCAR, e o perdedor sai calado. */
  checa('(3) so quem vai buscar toma geracao (o ++rotinasGen mora dentro do if da busca)',
    app.indexOf('if (forcar || Date.now() - rotinasCache.quando > 20000) {') < app.indexOf('const gen = ++rotinasGen;')
    && app.indexOf('const gen = ++rotinasGen;') < app.indexOf('chegou = await window.api.rotinasListar()')
    && !/if \(gen !== rotinasGen\) \{ if \(rotinasVisivel\(\)\) pintarRotinas\(false\); return; \}/.test(app));
  let soltarLista;
  respostaListar = { itens: [] };
  const listaLenta = new Promise((res) => { soltarLista = res; });
  ctxApp.window.api.rotinasListar = () => listaLenta;
  const pinturaVelha = ctxApp.pintarRotinas(true);
  ctxApp.window.api.rotinasListar = () => Promise.resolve({
    itens: [{ nome: 'NOVA', caminho: '\\', estado: 'pronta', ultima: '', proxima: '', resultado: 0, motivo: 'deu certo', falhou: false }],
  });
  await ctxApp.pintarRotinas(true);          // a nova chega primeiro e pinta
  soltarLista({ itens: [{ nome: 'VELHA', caminho: '\\', estado: 'pronta', ultima: '', proxima: '', resultado: 0, motivo: 'deu certo', falhou: false }] });
  await pinturaVelha;                        // a velha chega depois: nao pode sobrescrever
  const nomes = caixaRot.filhos.filter((f) => f.className && f.className.startsWith('rot-item')).map((f) => f.buscar('.ri-tit').textContent);
  checa('(e) a resposta atrasada nao pinta por cima da mais nova', nomes.join(',') === 'NOVA', nomes.join(','));

  /* ---- (3) o perdedor da corrida nao pode derrubar o vencedor ----
     Ao vivo: a resposta MAIS NOVA era descartada. O perdedor chamava
     pintarRotinas(false) no proprio return, isso incrementava o rotinasGen e
     invalidava a chamada boa ainda em voo -- ela voltava, via gen !== rotinasGen
     e ia pro lixo (nem pintava, NEM gravava no cache). Como o rotinasCache.quando
     ja' tinha sido atualizado, a tela ficava 20 s dizendo "Nenhuma rotina
     agendada nesta maquina" numa maquina com 19 rotinas. */
  const zerarCache = () => vm.runInContext('rotinasCache.itens = []; rotinasCache.erro = ""; rotinasCache.velha = false; rotinasCache.quando = 0;', ctxApp);
  const rot = (nome) => ({ nome, caminho: '\\', estado: 'pronta', ultima: '', proxima: '', resultado: 0, motivo: 'deu certo', falhou: false });
  zerarCache();
  let soltarPerdedor, soltarVencedor;
  ctxApp.window.api.rotinasListar = () => new Promise((r) => { soltarPerdedor = r; });
  const perdedor = ctxApp.pintarRotinas(true);
  ctxApp.window.api.rotinasListar = () => new Promise((r) => { soltarVencedor = r; });
  const vencedor = ctxApp.pintarRotinas(true);      // esta e' a mais nova: e' ela que manda
  soltarPerdedor({ itens: [rot('VELHA')] });        // mas o perdedor volta PRIMEIRO
  await perdedor;
  soltarVencedor({ itens: [rot('NOVA'), rot('NOVA2')] });
  await vencedor;
  const nomes3 = caixaRot.filhos.filter((f) => f.className && f.className.startsWith('rot-item')).map((f) => f.buscar('.ri-tit').textContent);
  checa('(3) a resposta mais NOVA pinta, mesmo tendo chegado depois do perdedor',
    nomes3.join(',') === 'NOVA,NOVA2', nomes3.join(','));
  checa('(3) e a tela nao diz "Nenhuma rotina agendada" com rotina na maquina',
    !/Nenhuma rotina agendada/.test(caixaRot.filhos[0].textContent), caixaRot.filhos[0].textContent);
  checa('(3) o cache tambem ficou com a lista nova (senao os 20 s seguintes mentem)',
    vm.runInContext('rotinasCache.itens.map((t) => t.nome).join(",")', ctxApp) === 'NOVA,NOVA2',
    vm.runInContext('rotinasCache.itens.map((t) => t.nome).join(",")', ctxApp));

  /* ---- (6) a view nao pode abrir EM BRANCO: o PowerShell leva 2,9-3,9 s ----
     A arvore ja' resolveu isso com o .tree-carregando ("o 'lendo...' e' o que
     separa 'lento' de 'quebrado'"); a Rotinas tinha ficado de fora. */
  zerarCache();
  let soltarLenta;
  ctxApp.window.api.rotinasListar = () => new Promise((r) => { soltarLenta = r; });
  const pLenta = ctxApp.pintarRotinas(true);
  checa('(6) enquanto o Agendador nao responde, a view diz que esta lendo',
    caixaRot.filhos.some((f) => f.className === 'rot-carregando' && /Lendo as rotinas/.test(f.textContent)),
    caixaRot.filhos.map((f) => f.className).join(','));
  soltarLenta({ itens: [rot('A')] });
  await pLenta;
  checa('(6) e o "lendo" sai quando a lista chega',
    !caixaRot.filhos.some((f) => f.className === 'rot-carregando')
    && caixaRot.filhos.some((f) => String(f.className).startsWith('rot-item')));
  let soltarLenta2;
  ctxApp.window.api.rotinasListar = () => new Promise((r) => { soltarLenta2 = r; });
  const pLenta2 = ctxApp.pintarRotinas(true);
  checa('(6) mas por cima de uma lista pronta ele nao pisca (nada de apagar o que ja da pra ler)',
    !caixaRot.filhos.some((f) => f.className === 'rot-carregando')
    && caixaRot.filhos.some((f) => String(f.className).startsWith('rot-item')));
  soltarLenta2({ itens: [rot('A')] });
  await pLenta2;
  checa('(6) o .rot-carregando existe na folha de estilo', /\.rot-carregando\{/.test(css));

  /* =====================================================================
     ACHADO 7: o banner de disparo EMPILHAVA em vez de atualizar.
     O mostrarAviso montava '[data-aviso="' + id + '"]' sem CSS.escape -- os
     outros dois call sites ja' escapavam. O id da rotina e' caminho + nome
     ('rotina-\BackupVPSHostinger') e, dentro de uma string de seletor CSS, o
     '\B' vira 'B': o seletor nao casava com nada e disparar 3x deixava 3
     tarjas na tela. Aqui o mostrarAviso DE VERDADE roda com um seletor que
     desescapa como o CSS desescapa.
     ===================================================================== */
  console.log('');
  const caixaAvisos = new El('div');
  const semEscape = (x) => String(x).replace(/\\(.)/g, '$1');   // e' o que o CSS faz com o '\B'
  const ctxAvi = {
    ...globaisFalsos(), console,
    // a tarja nao pode sumir sozinha no meio do teste (o globaisFalsos roda o timer na hora)
    setTimeout: () => 0, clearTimeout: () => {},
    document: { createElement: (t) => new El(t) },
    ico: () => '',
    CSS: { escape: (x) => String(x).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c) },
    $: (sel, raiz) => {
      if (sel === '#avisos') return caixaAvisos;
      const mm = /^\[data-aviso="(.*)"\]$/.exec(sel);
      if (mm) return (raiz || caixaAvisos).filhos.find((f) => f.dataset.aviso === semEscape(mm[1])) || null;
      return raiz && raiz.buscar ? raiz.buscar(sel) : new El('div');
    },
  };
  vm.createContext(ctxAvi);
  vm.runInContext(app.slice(app.indexOf('const avisosFechados = new Map();'), app.indexOf('/* avisa quando o limite de uso esta perto do fim')), ctxAvi);
  const idRotina = 'rotina-' + '\\' + 'BackupVPSHostinger';   // 'rotina-' + caminho + nome
  for (let i = 0; i < 3; i++) ctxAvi.mostrarAviso({ id: idRotina, tipo: 'info', texto: '"BackupVPSHostinger" foi disparada agora. (' + i + ')' });
  checa('(7) disparar 3x deixa UMA tarja, nao tres empilhadas',
    caixaAvisos.filhos.length === 1, caixaAvisos.filhos.length + ' tarjas');
  checa('(7) e a tarja que ficou traz o texto da ULTIMA vez',
    caixaAvisos.filhos.length === 1 && /\(2\)$/.test(caixaAvisos.filhos[0].buscar('.avi-txt').textContent),
    caixaAvisos.filhos.length ? caixaAvisos.filhos[0].buscar('.avi-txt').textContent : '(sem tarja)');
  checa('(7) o id da tarja e mesmo caminho + nome (e dai que vem a barra invertida)',
    vm.runInContext("chaveDaRotina({ caminho: '\\\\', nome: 'BackupVPSHostinger' })", ctxApp) === '\\BackupVPSHostinger'
    && /id: 'rotina-' \+ chave,/.test(app));
  checa('(7) e o mostrarAviso escapa o id no seletor, como os outros dois call sites',
    /\$\('\[data-aviso="' \+ CSS\.escape\(id\) \+ '"\]', caixa\)/.test(app));

  /* =====================================================================
     3) Contratos de fonte: hover, temas, os tres arquivos, activitybar
     ===================================================================== */
  checa('(f) o repaint periodico so pinta se o mouse NAO estiver em cima',
    /setInterval\(\(\) => \{ const b = \$\('#rotinas'\); if \(rotinasVisivel\(\) && !\(b && b\.matches\(':hover'\)\)\) pintarRotinas\(false\); \}/.test(app));
  checa('(g) a confirmacao esta no fonte, antes de qualquer disparo',
    /if \(!confirm\('Rodar "' \+ t\.nome \+ '" agora\?/.test(app) && app.indexOf("if (!confirm('Rodar") < app.indexOf('rotinasDisparando.add(chave)'));
  checa('(g) a trava de duplo clique e a primeira coisa do disparo',
    /if \(rotinasDisparando\.has\(chave\)\) return;/.test(app) && /rotinasDisparando\.delete\(chave\);/.test(app));

  checa('(k) o canal existe nos TRES arquivos (main, preload, tela)',
    /ipcMain\.handle\('rotinas:listar'/.test(main) && /ipcMain\.handle\('rotinas:disparar'/.test(main)
    && /rotinasListar: \(\) => ipcRenderer\.invoke\('rotinas:listar'\)/.test(preload) && /rotinasDisparar: \(o\) => ipcRenderer\.invoke\('rotinas:disparar', o\)/.test(preload)
    && /window\.api\.rotinasListar\(\)/.test(app) && /window\.api\.rotinasDisparar\(/.test(app));
  checa('(k) o botao e o painel da view existem no HTML',
    /<button class="act" data-view="rotinas"/.test(html) && /<div class="side-view hidden" data-view="rotinas">/.test(html)
    && /<div class="rot" id="rotinas"><\/div>/.test(html) && /id="btnRotinasAtualizar"/.test(html));
  checa('(k) o roteador de views carrega a lista ao abrir', /if \(v === 'rotinas'\) pintarRotinas\(true\);/.test(app));

  /* A cor nova precisa existir nos TRES blocos de tema. Esquecer um so' deixa a
     caixa vermelha invisivel (fundo indefinido) naquele tema. */
  const temas = { escuro: ':root{', claro: 'html[data-tema="claro"]{', jornal: 'html[data-tema="jornal"]{' };
  const semCor = Object.keys(temas).filter((t) => {
    let bloco = ''; try { bloco = pegarBloco(css, temas[t], t); } catch { return true; }
    return !/--rot-falha:/.test(bloco) || !/--rot-falha-borda:/.test(bloco);
  });
  checa('(k) --rot-falha esta nos tres temas (escuro, claro, jornal)', semCor.length === 0, 'faltou em: ' + semCor.join(', '));
  checa('(k) as classes .rot-* existem no css', /\.rot\{/.test(css) && /\.rot-item\.espera \.ri-pt\{/.test(css) && /\.rot-caixa\{/.test(css));

  // nono botao: a barra precisa rolar em vez de espremer os icones
  const nBotoes = (html.match(/<button class="act[^"]*" data-view=/g) || []).length;
  checa('activitybar: com 9 botoes a barra rola e os botoes nao encolhem',
    nBotoes >= 9 && /#activitybar\{[^}]*overflow-y:auto/.test(css) && /\.act\{[^}]*flex:none/.test(css), 'botoes=' + nBotoes);
  /* ACHADO 9: a 380px de altura o ultimo botao (Ajustes) fica 21px abaixo da
     dobra, e o scrollbar-width:none esconde qualquer indicio. A pista e' a
     sombra na borda de baixo, no truque classico das duas camadas: a sombra
     e' 'scroll' (presa na borda) e a tampa da cor da barra e' 'local' (anda com
     o conteudo), entao a sombra some sozinha ao chegar no fim -- e nem aparece
     quando nao ha' o que rolar. */
  const barra = (css.match(/#activitybar\{[^}]*\}/) || [''])[0];
  checa('(9) a barra tem pista visual de que rola (sombra que some no fim)',
    /background-attachment:local,scroll/.test(barra)
    && /background-image:linear-gradient\(var\(--act\),var\(--act\)\),linear-gradient\(to top,rgba\(0,0,0,/.test(barra)
    && /background-position:bottom,bottom/.test(barra), barra.slice(0, 400));
  checa('(9) e a cor da tampa e a mesma da barra nos TRES temas (o --act ja existe nos tres)',
    (css.match(/--act:/g) || []).length >= 3 && /background-color:var\(--act\)/.test(barra));

  /* =====================================================================
     4) A MAQUINA DE VERDADE: roda o PowerShell mesmo
     ===================================================================== */
  if (process.platform !== 'win32') {
    console.log('  (nao e Windows: pulei a leitura do Agendador de verdade)');
  } else {
    const cp = require('child_process');
    const hReal = {};
    const ctxReal = {
      ...globaisFalsos(), console, Buffer, RegExp,
      EH_WIN: true, Date,
      // aqui e' a maquina de verdade: usuario e casa reais, sem faz de conta
      os: require('os'), process, HOME: require('os').homedir(),
      ipcMain: { handle: (c, f) => { hReal[c] = f; } },
      // mesmo contrato do rodar() do main: nunca rejeita, devolve {err,out,errout}
      rodar: (bin, args) => {
        const r = cp.spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
        return Promise.resolve({ err: r.status === 0 ? null : new Error('saiu com código ' + r.status), out: r.stdout || '', errout: r.stderr || '' });
      },
    };
    vm.createContext(ctxReal);
    vm.runInContext(blocoMain, ctxReal);
    const real = await hReal['rotinas:listar'](null);
    const itens = real.itens || [];
    checa('MAQUINA: o Agendador respondeu com rotinas de verdade', itens.length > 0 && !real.error, JSON.stringify(real).slice(0, 200));
    checa('MAQUINA: nenhuma tarefa do proprio Windows entrou na lista',
      !itens.some((t) => /^\\(Microsoft|Windows)\\/.test(t.caminho)), JSON.stringify(itens.filter((t) => /^\\(Microsoft|Windows)\\/.test(t.caminho)).map((t) => t.caminho)));
    checa('MAQUINA: todo item veio normalizado (tipos certos, motivo so quando ha resultado)',
      itens.every((t) => typeof t.nome === 'string' && t.nome && typeof t.estado === 'string' && typeof t.falhou === 'boolean'
        && typeof t.motivo === 'string' && (t.resultado === null ? t.motivo === '' : !!t.motivo)));
    checa('MAQUINA: nenhuma rotina "nunca rodou" ou "rodando agora" foi marcada como falha',
      !itens.some((t) => t.falhou && (t.resultado === 0x41301 || t.resultado === 0x41303)));
    checa('MAQUINA (6): nenhuma rotina em execucao aparece como quebrada',
      !itens.some((t) => t.falhou && t.estado === 'rodando'),
      itens.filter((t) => t.falhou && t.estado === 'rodando').map((t) => t.nome).join(','));
    /* achado 7: o bloco vermelho tem que ser DELE. Nomes de fabricante que
       moram na raiz "\" e por isso passavam pelo filtro de pasta. */
    const ruido = itens.filter((t) => t.dele && /^(OneDrive|RtkAud|ZoomUpdate|SensorMon|BulletUserMode|UserModeWorker|TimeSyncInit|SoftLanding|RunPlatformExperience)/i.test(t.nome));
    checa('MAQUINA (7): tarefa de fabricante nao entra como "sua"', ruido.length === 0, ruido.map((t) => t.nome).join(','));
    const suas = itens.filter((t) => t.dele);
    checa('MAQUINA (7): as automacoes dele foram reconhecidas',
      suas.length > 0 && suas.some((t) => /Backup|Radar|Gestor|Cerebro|Claude/i.test(t.nome)), suas.length + ' suas');
    const quebradas = itens.filter((t) => t.falhou);
    console.log('       > ' + itens.length + ' rotinas nesta maquina: ' + suas.length + ' dele e '
      + (itens.length - suas.length) + ' do sistema; ' + quebradas.length + ' com falha:');
    for (const t of quebradas) console.log('         - ' + (t.dele ? 'DELE   ' : 'sistema') + ' ' + t.nome + ': ' + t.motivo + ' (última em ' + (t.ultima || '?') + ')');
  }

  console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nteste-rotinas: tudo ok');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA inesperada: ' + (e && e.stack || e)); process.exit(1); });
