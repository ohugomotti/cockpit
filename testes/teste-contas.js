/* Carrega o main.js DE VERDADE com um Electron falso e testa os handlers de
   conta: guardar, listar, trocar e esquecer - inclusive o token que ficava
   esquecido no disco depois da troca. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const { RAIZ: RAIZ_PROJ } = require('./raiz');   // a raiz do CODIGO (a outra e' a pasta temporaria do teste)
const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-teste-'));
const HOME_FALSA = path.join(RAIZ, 'home');
const USERDATA = path.join(RAIZ, 'userData');
fs.mkdirSync(path.join(HOME_FALSA, '.claude'), { recursive: true });
fs.mkdirSync(USERDATA, { recursive: true });

const handlers = new Map();
const eletronFalso = {
  app: {
    getPath: (q) => (q === 'userData' ? USERDATA : HOME_FALSA),
    whenReady: () => new Promise(() => {}),      // nunca resolve: nao abre janela
    on() {}, setName() {}, quit() {}, disableHardwareAcceleration() {},
    requestSingleInstanceLock: () => true, setAppUserModelId() {},
    commandLine: { appendSwitch() {} },
    isPackaged: false, getVersion: () => '1.0.0',
  },
  BrowserWindow: class { constructor() {} static getAllWindows() { return []; } on() {} loadFile() {} webContents = { on() {}, send() {}, session: { setPermissionRequestHandler() {}, webRequest: { onHeadersReceived() {} } } }; },
  ipcMain: { handle: (canal, fn) => handlers.set(canal, fn), on() {} },
  dialog: { showOpenDialog: async () => ({ canceled: true }) },
  shell: { openExternal() {}, openPath() {}, showItemInFolder() {} },
  Menu: { setApplicationMenu() {}, buildFromTemplate: () => ({}) },
  nativeTheme: { on() {} },
  clipboard: { readText: () => '', writeText() {} },
  globalShortcut: { register() {}, unregisterAll() {} },
  session: { defaultSession: { webRequest: { onHeadersReceived() {} }, setPermissionRequestHandler() {} } },
};

// intercepta o require de 'electron' e o os.homedir que o main usa pra achar a HOME
const requireOriginal = Module.prototype.require;
Module.prototype.require = function (nome) {
  if (nome === 'electron') return eletronFalso;
  if (nome === 'os') {
    const real = requireOriginal.call(this, 'os');
    // proxy: trocar so' o homedir sem copiar o resto (constants e' somente leitura)
    return new Proxy(real, { get: (alvo, k) => (k === 'homedir' ? () => HOME_FALSA : alvo[k]) });
  }
  return requireOriginal.apply(this, arguments);
};

let erro = 0;
const checa = (nome, cond, det) => {
  if (cond) console.log('  ok   ' + nome);
  else { erro = 1; console.log('  FALHA ' + nome + (det ? ' -> ' + det : '')); }
};

const pasta = process.argv[2] || 'src';
try {
  require(path.join(RAIZ_PROJ, pasta, 'main.js'));
} catch (e) {
  console.log('nao consegui carregar o main.js:', e.message);
  process.exit(1);
}
Module.prototype.require = requireOriginal;

const chamar = (canal, arg) => {
  const h = handlers.get(canal);
  if (!h) throw new Error('handler ausente: ' + canal);
  return h({}, arg);
};

const CRED = path.join(HOME_FALSA, '.claude', '.credentials.json');

(async () => {
  console.log('\npasta testada:', pasta);
  console.log('\n1) guardar a conta de agora');
  fs.writeFileSync(CRED, JSON.stringify({ token: 'AAA', conta: 'trabalho' }));
  checa('guardou', (await chamar('contas:salvar', { engine: 'claude', apelido: 'trabalho' })).ok === true);

  console.log('\n2) entrar em outra conta e guardar tambem');
  fs.writeFileSync(CRED, JSON.stringify({ token: 'BBB', conta: 'pessoal' }));
  checa('guardou a segunda', (await chamar('contas:salvar', { engine: 'claude', apelido: 'pessoal' })).ok === true);
  const lista = await chamar('contas:listar', 'claude');
  checa('as duas aparecem na lista', lista.length === 2, JSON.stringify(lista));
  checa('a atual esta marcada certo',
    lista.find(x => x.apelido === 'pessoal').atual === true && lista.find(x => x.apelido === 'trabalho').atual === false,
    JSON.stringify(lista));

  console.log('\n3) voltar para a primeira conta sem refazer login');
  const r = await chamar('contas:trocar', { engine: 'claude', apelido: 'trabalho' });
  checa('trocou sem erro', r.ok === true, JSON.stringify(r));
  checa('a credencial em uso e a da conta escolhida',
    JSON.parse(fs.readFileSync(CRED, 'utf8')).token === 'AAA',
    fs.readFileSync(CRED, 'utf8'));
  const lista2 = await chamar('contas:listar', 'claude');
  checa('a lista mostra a troca', lista2.find(x => x.apelido === 'trabalho').atual === true);

  console.log('\n4) o token da conta anterior nao pode ficar largado no disco');
  const sobrou = fs.existsSync(CRED + '.antes-da-troca');
  checa('nao sobrou copia com o token da outra conta', !sobrou,
    sobrou ? 'ainda existe ' + CRED + '.antes-da-troca' : '');

  console.log('\n5) arquivo temporario tambem nao pode sobrar');
  checa('sem .tmp largado', !fs.existsSync(CRED + '.tmp'));

  console.log('\n6) conta corrompida nao pode ser aplicada');
  const dirContas = path.join(USERDATA, 'contas');
  fs.writeFileSync(path.join(dirContas, 'claude__' + encodeURIComponent('quebrada') + '.json'), 'isto nao e json');
  const r6 = await chamar('contas:trocar', { engine: 'claude', apelido: 'quebrada' });
  checa('recusou a conta corrompida', !!r6.error, JSON.stringify(r6));
  checa('a credencial boa continuou no lugar', JSON.parse(fs.readFileSync(CRED, 'utf8')).token === 'AAA');

  console.log('\n7) esquecer uma conta guardada');
  checa('esqueceu', (await chamar('contas:esquecer', { engine: 'claude', apelido: 'pessoal' })).ok === true);
  const lista3 = await chamar('contas:listar', 'claude');
  checa('saiu da lista', !lista3.find(x => x.apelido === 'pessoal'), JSON.stringify(lista3));
  checa('a credencial em uso nao foi tocada', JSON.parse(fs.readFileSync(CRED, 'utf8')).token === 'AAA');

  console.log('\n8) trocar sem ter guardado nada devolve recado, nao explode');
  const r8 = await chamar('contas:trocar', { engine: 'claude', apelido: 'nao-existe' });
  checa('recado em vez de erro cru', !!r8.error, JSON.stringify(r8));

  try { fs.rmSync(RAIZ, { recursive: true, force: true }); } catch {}
  console.log('');
  process.exit(erro);
})().catch((e) => { console.log('ESTOUROU:', e.message); process.exit(1); });
