'use strict';
/* Rodada 2 da leva 5i, item 9 (incidente): as ferramentas de auditoria. A copia do perfil que a janela de teste abre nasce SEM conversas
   (tools/auditoria/sanear-perfil.cjs + perfil-de-teste.ps1), o candidato abre com a trava (abrir-candidato-teste.ps1) e a rodada 1 confere 0 paineis
   (conferir-rodada1.cjs + sonda-vital.cjs). Nada aqui abre o Electron nem o perfil real: o %APPDATA% e' falso (uma pasta temporaria). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FERRAMENTAS = path.join(__dirname, '..', 'tools', 'auditoria');
const { sanearConfig, sanearPerfil, ehOPerfilReal, MARCA, PASTAS_FORA, ARQUIVOS_FORA } = require(path.join(FERRAMENTAS, 'sanear-perfil.cjs'));
const { conferirRodada1, CODIGO_SEM_TRAVA } = require(path.join(FERRAMENTAS, 'conferir-rodada1.cjs'));
const lerFerramenta = (nome) => fs.readFileSync(path.join(FERRAMENTAS, nome), 'utf8').replace(/\r\n/g, '\n');
const copia = (v) => JSON.parse(JSON.stringify(v));
const criadas = [];   // as pastas temporarias saem no fim (nada fica no %TEMP%)
const temp = () => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-auditoria-teste-'))); criadas.push(d); return d; };
test.after(() => { for (const d of criadas) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* o antivirus pode segurar por um instante: fica no %TEMP% */ } } });

/* um config parecido com o do Hugo: 15 abas (uma de servidor, que e' a ativa), paineis com conversa de verdade e as chaves que apontam para sessao */
function configComConversas() {
  const abas = [];
  for (let i = 1; i <= 15; i++) {
    abas.push({ id: 'aba' + i, nome: 'Aba ' + i, tipo: i === 3 ? 'ssh' : 'local', caminhos: ['C:\\proj' + i], icone: 'folder',
      ...(i === 3 ? { host: 'servidor.exemplo', usuario: 'hugo', chave: 'C:\\Users\\hugom\\.ssh\\id', caminhoRemoto: '/srv' } : {}),
      paineis: i % 2 ? [{ paneId: 'p' + i, engine: 'claude', sessaoId: 'sessao-real-' + i, file: 'C:\\Users\\hugom\\.claude\\projects\\x\\s' + i + '.jsonl', rascunho: 'texto privado ' + i, titulo: 'Conversa ' + i }, { paneId: 'q' + i, engine: 'codex', sessaoId: 'thr-' + i }] : [] });
  }
  return {
    abas, abaAtiva: 'aba3', tema: 'jornal', visualMac: true, defCwd: 'C:\\Users\\hugom', lastEngine: 'claude', uiTorreAltura: 240, tituloAuto: true,
    grupos: [{ id: 'g1', nome: 'Clientes', cor: '#fff' }], gruposRecolhidos: ['g1'], linksAquiDentro: true,
    panes: [{ paneId: 'antigo', sessaoId: 'sessao-bem-antiga' }],
    prompts: ['a minha senha e 123', 'outro prompt real'],
    temposTrabalho: { 'claude|sessao-real-1': { ms: 5000 } }, artefatos: { 'claude|sessao-real-1': [{ nome: 'plano.md' }] },
    favoritos: ['claude|sessao-real-1'], grupoSessao: { 'claude|sessao-real-1': 'g1' },
  };
}
const contarPaineis = (cfg) => cfg.abas.reduce((n, a) => n + (a.paineis || []).length, 0) + (cfg.panes || []).length;

/* ============================ o saneador (o config) ============================ */
test('sanearConfig: nenhum painel, nenhuma sessao e nenhum prompt; ficam as 15 abas, o tema, o visual e o resto das preferencias', () => {
  const entrada = configComConversas();
  const original = copia(entrada);
  assert.ok(contarPaineis(entrada) > 0, 'o config de entrada tem conversa de verdade');
  const { cfg, resumo } = sanearConfig(entrada);
  assert.deepEqual(entrada, original, 'o que entrou nao foi mexido');
  assert.equal(contarPaineis(cfg), 0);
  assert.equal(cfg.abas.length, 15, 'as 15 abas ficam');
  assert.deepEqual(cfg.abas.map((a) => [a.id, a.nome, a.tipo, a.caminhos, a.icone]), original.abas.map((a) => [a.id, a.nome, a.tipo, a.caminhos, a.icone]), 'nome, tipo e pastas de cada aba');
  assert.deepEqual(cfg.abas[2], { ...original.abas[2], paineis: [] }, 'a aba de servidor segue como era (so sem painel)');
  assert.ok(cfg.abas.every((a) => Array.isArray(a.paineis) && a.paineis.length === 0));
  for (const chave of ['panes', 'prompts', 'favoritos']) assert.deepEqual(cfg[chave], [], chave);
  for (const chave of ['temposTrabalho', 'artefatos', 'grupoSessao']) assert.deepEqual(cfg[chave], {}, chave);
  // o que a rodada 1 confere e o resto das preferencias nao sao tocados; so' o nome automatico sai desligado (conferencia da rodada 2: sem Haiku na copia)
  for (const chave of ['tema', 'visualMac', 'defCwd', 'lastEngine', 'uiTorreAltura', 'grupos', 'gruposRecolhidos', 'linksAquiDentro']) assert.deepEqual(cfg[chave], original[chave], chave);
  assert.equal(cfg.tituloAuto, false, 'o nome automatico desligado na copia');
  assert.equal(JSON.stringify(cfg).includes('sessao-real'), false, 'nenhum id de sessao de verdade sobrou');
  assert.equal(JSON.stringify(cfg).includes('texto privado'), false, 'nem rascunho');
  assert.equal(JSON.stringify(cfg).includes('minha senha'), false, 'nem prompt');
  assert.equal(resumo.abas, 15);
  assert.equal(resumo.paineisRemovidos, 16, '8 abas com 2 paineis');
  assert.equal(resumo.paineisAntigosRemovidos, 1);
  assert.deepEqual(resumo.chavesZeradas.sort(), ['artefatos', 'favoritos', 'grupoSessao', 'panes', 'prompts', 'temposTrabalho']);
});

test('sanearConfig: a aba ativa nunca e de servidor (a janela de teste nao conecta em servidor nenhum); aba local ativa fica; config sem as chaves nao ganha chave nenhuma', () => {
  const comSsh = sanearConfig(configComConversas());
  assert.equal(comSsh.cfg.abaAtiva, 'aba1', 'a ativa era a de servidor: vai para a 1a local');
  assert.equal(comSsh.resumo.abaAtivaTrocada, true);
  const local = configComConversas(); local.abaAtiva = 'aba5';
  const r = sanearConfig(local);
  assert.equal(r.cfg.abaAtiva, 'aba5');
  assert.equal(r.resumo.abaAtivaTrocada, false);
  const sumida = configComConversas(); sumida.abaAtiva = 'nao-existe';
  assert.equal(sanearConfig(sumida).cfg.abaAtiva, 'aba1');
  const sobre = sanearConfig({ tema: 'escuro', abas: [{ id: 'a', tipo: 'local', paineis: [{ paneId: 'x' }] }], abaAtiva: 'a' });
  assert.deepEqual(sobre.cfg, { tema: 'escuro', abas: [{ id: 'a', tipo: 'local', paineis: [] }], abaAtiva: 'a', tituloAuto: false }, 'chave nova so a do nome automatico desligado (conferencia da rodada 2); o resto so zera o que existia');
  assert.deepEqual(sobre.resumo.chavesZeradas, []);
  // idempotente: sanear o que ja foi saneado nao muda nada
  assert.deepEqual(sanearConfig(comSsh.cfg).cfg, comSsh.cfg);
  // sem aba nenhuma (config primeiro-uso): nao inventa aba
  assert.deepEqual(sanearConfig({ tema: 'escuro' }).cfg, { tema: 'escuro', tituloAuto: false });
  for (const torto of [null, undefined, 'x', 42, [], [{ abas: [] }]]) assert.throws(() => sanearConfig(torto), /nao e um objeto/, JSON.stringify(torto));
});

/* ============================ o saneador (a pasta da copia) ============================ */
function copiaDeTeste({ comMarca = true, comConversas = true } = {}) {
  const pasta = path.join(temp(), 'copia');
  fs.mkdirSync(pasta);
  const texto = JSON.stringify(configComConversas(), null, 2);
  fs.writeFileSync(path.join(pasta, 'config.json'), texto);
  fs.writeFileSync(path.join(pasta, 'config.json.bak'), texto);
  if (comMarca) fs.writeFileSync(path.join(pasta, MARCA), 'copia de teste');
  if (comConversas) {
    for (const d of PASTAS_FORA) { fs.mkdirSync(path.join(pasta, d), { recursive: true }); fs.writeFileSync(path.join(pasta, d, 'conversa.txt'), 'conteudo de ' + d); }
    for (const f of ARQUIVOS_FORA) fs.writeFileSync(path.join(pasta, f), f.includes('nomes') ? '{"claude|s1":"Cliente X"}' : 'x');
    for (const f of ['claude-modo-p1.json', 'config.json.corrompido-20261001-101010', 'config.json.tmp-1']) fs.writeFileSync(path.join(pasta, f), '{"paineis":[{"sessaoId":"s"}]}');
  }
  // o que nao e de conversa fica
  fs.writeFileSync(path.join(pasta, 'versoes-motores.json'), '{}');
  fs.mkdirSync(path.join(pasta, 'logs')); fs.writeFileSync(path.join(pasta, 'logs', 'tela.log'), 'x');
  return pasta;
}
const AMBIENTE_FALSO = (base) => ({ APPDATA: path.join(base, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(base, 'AppData', 'Local') });

test('sanearPerfil: config.json E .bak sem conversa (o .bak entra no lugar do config quando ele corrompe), e fora tudo que guarda conversa, fila ou credencial', () => {
  const pasta = copiaDeTeste();
  const antes = fs.readdirSync(pasta);
  const r = sanearPerfil(pasta, { ambiente: AMBIENTE_FALSO(path.dirname(pasta)) });
  for (const arq of ['config.json', 'config.json.bak']) {
    const cfg = JSON.parse(fs.readFileSync(path.join(pasta, arq), 'utf8'));
    assert.equal(contarPaineis(cfg), 0, arq);
    assert.equal(cfg.abas.length, 15, arq);
    assert.equal(cfg.tema, 'jornal', arq);
    assert.equal(cfg.visualMac, true, arq);
    assert.equal(cfg.abaAtiva, 'aba1', arq);
    assert.equal(fs.readFileSync(path.join(pasta, arq), 'utf8').includes('sessao-real'), false, arq);
  }
  const depois = fs.readdirSync(pasta);
  for (const d of PASTAS_FORA) assert.equal(depois.includes(d), false, d + ' devia sair');
  for (const f of ARQUIVOS_FORA) assert.equal(depois.includes(f), false, f + ' devia sair');
  for (const f of ['claude-modo-p1.json', 'config.json.corrompido-20261001-101010', 'config.json.tmp-1']) assert.equal(depois.includes(f), false, f + ' devia sair');
  assert.deepEqual(depois.sort(), ['.copia-de-teste', 'config.json', 'config.json.bak', 'logs', 'versoes-motores.json'].sort(), 'so ficam os dois configs, a marca e o que nao e de conversa');
  assert.ok(antes.length > depois.length);
  assert.equal(r.abas, 15);
  assert.equal(r.tema, 'jornal');
  assert.equal(r.visualMac, true);
  assert.ok(r.apagados.includes('contas') && r.apagados.includes('inbox') && r.apagados.includes('retomar.json'), 'o relatorio diz o que apagou');
  // de novo: nada a apagar e o mesmo resultado
  const de2 = sanearPerfil(pasta, { ambiente: AMBIENTE_FALSO(path.dirname(pasta)) });
  assert.deepEqual(de2.apagados, []);
});

test('sanearPerfil recusa: pasta sem a marca, caminho relativo, o perfil real (e o que fica dentro dele) e copia sem config', () => {
  const base = temp();
  const ambiente = AMBIENTE_FALSO(base);
  const semMarca = copiaDeTeste({ comMarca: false, comConversas: false });
  assert.throws(() => sanearPerfil(semMarca, { ambiente: AMBIENTE_FALSO(path.dirname(semMarca)) }), /nao tem a marca/);
  assert.equal(contarPaineis(JSON.parse(fs.readFileSync(path.join(semMarca, 'config.json'), 'utf8'))) > 0, true, 'sem a marca nada foi tocado');
  for (const relativo of ['copia', '.\\copia', '', '   ', undefined, null, 42]) assert.throws(() => sanearPerfil(relativo), /Informe a pasta/, JSON.stringify(relativo));
  // o perfil real (do ambiente falso): mesmo com a marca dentro, recusa
  const real = path.join(ambiente.APPDATA, 'Cockpit');
  fs.mkdirSync(real, { recursive: true });
  fs.writeFileSync(path.join(real, 'config.json'), JSON.stringify(configComConversas()));
  fs.writeFileSync(path.join(real, MARCA), 'marca plantada');
  assert.throws(() => sanearPerfil(real, { ambiente }), /pasta do Cockpit de verdade/);
  assert.throws(() => sanearPerfil(real.toUpperCase(), { ambiente }), /pasta do Cockpit de verdade/, 'maiuscula/minuscula nao engana (Windows)');
  assert.throws(() => sanearPerfil(real + '\\', { ambiente }), /pasta do Cockpit de verdade/);
  fs.mkdirSync(path.join(real, 'filha'));
  fs.writeFileSync(path.join(real, 'filha', MARCA), 'x');
  assert.throws(() => sanearPerfil(path.join(real, 'filha'), { ambiente }), /pasta do Cockpit de verdade/, 'nem uma pasta dentro dele');
  assert.equal(contarPaineis(JSON.parse(fs.readFileSync(path.join(real, 'config.json'), 'utf8'))) > 0, true, 'o perfil real segue intacto');
  assert.equal(ehOPerfilReal(path.join(ambiente.APPDATA, 'CockpitOutro'), ambiente), false, 'pasta irma com nome parecido nao e o perfil real');
  assert.equal(ehOPerfilReal(path.join(ambiente.LOCALAPPDATA, 'Cockpit', 'x'), ambiente), true);
  // copia sem config.json
  const vazia = path.join(temp(), 'vazia'); fs.mkdirSync(vazia); fs.writeFileSync(path.join(vazia, MARCA), 'x');
  assert.throws(() => sanearPerfil(vazia, { ambiente: AMBIENTE_FALSO(path.dirname(vazia)) }), /nao tem config\.json/);
});

test('sanear-perfil.cjs pela linha de comando: "SANEADO {json}" e codigo 0; recusa com "ERRO ..." e codigo 1', () => {
  const pasta = copiaDeTeste();
  const script = path.join(FERRAMENTAS, 'sanear-perfil.cjs');
  const saida = execFileSync(process.execPath, [script, pasta], { encoding: 'utf8' });
  assert.match(saida, /^SANEADO \{/);
  const relatorio = JSON.parse(saida.slice('SANEADO '.length));
  assert.equal(relatorio.abas, 15);
  assert.equal(contarPaineis(JSON.parse(fs.readFileSync(path.join(pasta, 'config.json'), 'utf8'))), 0);
  const semMarca = copiaDeTeste({ comMarca: false, comConversas: false });
  let falhou = null;
  try { execFileSync(process.execPath, [script, semMarca], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { falhou = e; }
  assert.ok(falhou, 'devia sair com codigo diferente de 0');
  assert.equal(falhou.status, 1);
  assert.match(String(falhou.stdout), /^ERRO Recusado: a pasta nao tem a marca/);
});

/* ============================ a conferencia da rodada 1 ============================ */
const ESPERADO = { abas: 15, tema: 'jornal', visualMac: true, paineis: 0 };
const LIDO = () => ({
  tela: { abas: 15, abaAtiva: 'aba1', tema: 'jornal', visualMac: true, htmlMac: true, paineis: 0, aberturaVisivel: true, erroSalvar: false },
  trava: { api: true, titulo: 'TESTE — não use', faixa: true },
  gravou: { ok: true, r: true },
  disco: { config: { bytes: 10, abas: 15, tema: 'jornal' }, bak: { bytes: 10, abas: 15, tema: 'jornal' }, outros: [] },
  erros: [],
});

test('conferirRodada1: tela com 0 paineis (a copia nao tem conversa) e o ESPERADO: tudo bate e o veredito e ok', () => {
  const v = conferirRodada1(ESPERADO, LIDO());
  assert.deepEqual(copia(v), { ok: true, falhas: [], semTrava: false });
  // sem "paineis" no esperado, o padrao tambem e 0
  assert.equal(conferirRodada1({ abas: 15, tema: 'jornal', visualMac: true }, LIDO()).ok, true);
  assert.equal(CODIGO_SEM_TRAVA, 3);
});

test('conferirRodada1: painel na tela e alarme (seria conversa de verdade); trava ausente e falha grave; cada divergencia vira uma frase', () => {
  const comPainel = LIDO(); comPainel.tela.paineis = 2;
  const v = conferirRodada1(ESPERADO, comPainel);
  assert.equal(v.ok, false);
  assert.match(v.falhas[0], /paineis na tela: 2 \(esperado 0: a copia nao tem conversa nenhuma\)/);
  const semTrava = LIDO(); semTrava.trava = { api: false, titulo: 'Cockpit', faixa: false };
  const s = conferirRodada1(ESPERADO, semTrava);
  assert.equal(s.semTrava, true);
  assert.equal(s.ok, false);
  assert.match(s.falhas[0], /a trava da janela de teste nao esta ligada/);
  for (const [nome, alterar, esperadoNoTexto] of [
    ['abas', (l) => { l.tela.abas = 14; }, /abas na tela: 14 \(esperado 15\)/],
    ['tema', (l) => { l.tela.tema = 'escuro'; }, /tema na tela: escuro/],
    ['visual', (l) => { l.tela.htmlMac = false; }, /visual Mac na tela/],
    ['aviso de nao salvar', (l) => { l.tela.erroSalvar = true; }, /Reabra o Cockpit/],
    ['gravacao', (l) => { l.gravou = { ok: false, e: 'x' }; }, /o setConfig nao gravou/],
    ['config.json no disco', (l) => { l.disco.config = { erro: 'EPERM' }; }, /config\.json nao abre/],
    ['.bak no disco', (l) => { l.disco.bak.abas = 3; }, /config\.json\.bak no disco: 3 abas/],
    ['sobras', (l) => { l.disco.outros = ['config.json.corrompido-1']; }, /sobras ao lado do config\.json/],
    ['erros do console', (l) => { l.erros = ['EXC x']; }, /1 erro\(s\) no console/],
  ]) {
    const l = LIDO(); alterar(l);
    const r = conferirRodada1(ESPERADO, l);
    assert.equal(r.ok, false, nome);
    assert.ok(r.falhas.some((f) => esperadoNoTexto.test(f)), nome + ': ' + r.falhas.join(' | '));
    assert.equal(r.semTrava, false, nome);
  }
  assert.equal(conferirRodada1(ESPERADO, undefined).ok, false, 'sem nada lido: nao passa');
});

test('a sonda da rodada 1 aceita 0 paineis (a tela de abertura vale como "pronto"), le o esperado da copia e sai com 0, 4, 3 ou 2', () => {
  const sonda = lerFerramenta('sonda-vital.cjs');
  assert.match(sonda, /document\.querySelectorAll\('\.p-input'\)\.length > 0 \|\| !!document\.getElementById\('boasvindas'\)/, 'pronto: o campo de escrever OU a tela de abertura');
  assert.match(sonda, /function esperadoDoPerfil\(\)/);
  assert.match(sonda, /paineis: document\.querySelectorAll\('\.p-input'\)\.length/, 'o numero de paineis da tela segue impresso (agora vai a 0)');
  assert.match(sonda, /conferirRodada1\(esperado, \{ tela, trava, gravou: g, disco, erros \}\)/);
  assert.match(sonda, /process\.exit\(veredito\.semTrava \? CODIGO_SEM_TRAVA : veredito\.ok \? 0 : 4\)/);
  assert.match(sonda, /process\.exit\(2\)/);
  assert.match(sonda, /window\.api\.janelaDeTeste === true/, 'a sonda pergunta a flag que o preload entrega');
  assert.match(sonda, /document\.getElementById\('faixa-janela-teste'\)/);
});

/* ============================ os scripts do PowerShell ============================ */
test('abrir-candidato-teste.ps1: copia limpa, variavel de teste so no candidato, porta so em 127.0.0.1, foco devolvido, trava conferida e a PORTA na ultima linha', () => {
  const s = lerFerramenta('abrir-candidato-teste.ps1');
  assert.match(s, /\. \(Join-Path \$PSScriptRoot 'perfil-de-teste\.ps1'\)/);
  assert.match(s, /\$resumo = Copiar-PerfilDeTeste -Destino \$Perfil/, 'a copia limpa vem antes de abrir');
  assert.ok(s.indexOf('Copiar-PerfilDeTeste -Destino') < s.indexOf('Start-Process'), 'a copia nasce antes de o candidato abrir');
  assert.match(s, /\$env:COCKPIT_JANELA_TESTE = '1'/);
  assert.match(s, /finally \{ Remove-Item Env:COCKPIT_JANELA_TESTE/, 'a variavel nao fica no ambiente de quem chamou');
  assert.ok(s.indexOf("$env:COCKPIT_JANELA_TESTE = '1'") < s.indexOf('Start-Process'), 'e esta no ambiente quando o candidato nasce');
  assert.match(s, /--user-data-dir="' \+ \$Perfil \+ '"/, 'so com a copia');
  assert.match(s, /--remote-debugging-address=127\.0\.0\.1/);
  assert.match(s, /Devolver-Frente -Janela \$frente/);
  assert.match(s, /\*\\Programs\\Cockpit\\\*/, 'nunca o instalado');
  assert.match(s, /\$titulo -match '\^TESTE'/, 'a trava e conferida pelo titulo da pagina');
  assert.match(s, /SEM A TRAVA DE TESTE/);
  assert.match(s, /Remove-PerfilDeTeste -Pasta \$Perfil/, 'sem a trava: fecha e apaga a copia');
  assert.match(s, /-Encerrar/);
  const linhas = s.trimEnd().split('\n');
  assert.equal(linhas.at(-1), '"PORTA $Porta"', 'a porta e a ultima linha');
  assert.doesNotMatch(s, /robocopy/, 'nada de copiar o perfil inteiro');
  assert.doesNotMatch(s, /[^\x00-\x7F]/, 'so ASCII (o Windows PowerShell 5.1 le o arquivo sem BOM como ANSI)');
});

test('rodada1-vital.ps1 e perfil-de-teste.ps1: o mesmo perfil limpo, so o config sai do perfil real, e a copia e conferida de novo no disco', () => {
  const r1 = lerFerramenta('rodada1-vital.ps1');
  assert.match(r1, /\. \(Join-Path \$PSScriptRoot 'perfil-de-teste\.ps1'\)/);
  assert.match(r1, /Copiar-PerfilDeTeste -Destino \$perfil/);
  assert.match(r1, /\$env:COCKPIT_JANELA_TESTE = '1'/);
  assert.doesNotMatch(r1, /robocopy/, 'a copia do perfil INTEIRO era o que abriu as conversas reais');
  assert.match(r1, /if \(\$codigo -eq 3\)/, 'sem a trava, para');
  assert.match(r1, /paineis=\$paineis/, 'depois de fechar, o numero de paineis do disco tambem aparece (0)');
  assert.doesNotMatch(r1, /[^\x00-\x7F]/);
  const p = lerFerramenta('perfil-de-teste.ps1');
  assert.match(p, /foreach \(\$f in 'config\.json', 'config\.json\.bak'\)/, 'so os dois configs saem do perfil real');
  assert.match(p, /sanear-perfil\.cjs/);
  assert.match(p, /A copia ainda tem painel salvo/, 'confere de novo no disco');
  assert.match(p, /Remove-Item -LiteralPath \$Destino -Recurse -Force/, 'copia que nao ficou limpa nao fica no disco');
  assert.doesNotMatch(p, /[^\x00-\x7F]/);
});

function pwshOuNull() {
  try { return execFileSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8', timeout: 30000 }).trim() ? 'pwsh' : null; } catch { return null; }
}
test('Copiar-PerfilDeTeste de verdade (PowerShell, com um %APPDATA% falso): so o config sai, a copia fica sem conversa, e recusa destino cheio e perfil real', { skip: pwshOuNull() ? false : 'pwsh nao esta no PATH' }, () => {
  const base = temp();
  const appdata = path.join(base, 'AppData');
  const real = path.join(appdata, 'Cockpit');
  fs.mkdirSync(path.join(real, 'contas'), { recursive: true });
  fs.mkdirSync(path.join(real, 'inbox'));
  const texto = JSON.stringify(configComConversas(), null, 2);
  fs.writeFileSync(path.join(real, 'config.json'), texto);
  fs.writeFileSync(path.join(real, 'config.json.bak'), texto);
  fs.writeFileSync(path.join(real, 'contas', 'credencial.json'), 'segredo');
  fs.writeFileSync(path.join(real, 'inbox', 'msg.json'), '{"texto":"privado"}');
  fs.writeFileSync(path.join(real, 'nomes.json'), '{"claude|s1":"Cliente X"}');
  const destino = path.join(base, 'copia');
  const script = path.join(base, 'rodar.ps1');
  fs.writeFileSync(script, [
    "$ErrorActionPreference = 'Stop'",
    ". '" + path.join(FERRAMENTAS, 'perfil-de-teste.ps1').replace(/'/g, "''") + "'",
    "$r = Copiar-PerfilDeTeste -Destino '" + destino.replace(/'/g, "''") + "'",
    "'RESUMO ' + $r",
    "try { Copiar-PerfilDeTeste -Destino '" + destino.replace(/'/g, "''") + "' } catch { 'RECUSOU-CHEIO ' + $_.Exception.Message }",
    "try { Copiar-PerfilDeTeste -Destino '" + path.join(real, 'filha').replace(/'/g, "''") + "' } catch { 'RECUSOU-REAL ' + $_.Exception.Message }",
    "try { Remove-PerfilDeTeste -Pasta '" + real.replace(/'/g, "''") + "' } catch { 'RECUSOU-APAGAR-REAL ' + $_.Exception.Message }",
  ].join('\r\n'));
  const env = { ...process.env, APPDATA: appdata, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH };
  const saida = execFileSync('pwsh', ['-NoProfile', '-File', script], { env, encoding: 'utf8', timeout: 90000 });
  assert.match(saida, /^RESUMO \{/m);
  assert.match(saida, /^RECUSOU-CHEIO /m);
  assert.match(saida, /^RECUSOU-REAL A copia nao pode ficar no perfil real/m);
  assert.match(saida, /^RECUSOU-APAGAR-REAL Recusado: esta e a pasta do Cockpit de verdade/m);
  // a copia: SO' os dois configs e a marca; nada de conversa, fila, credencial ou nome de conversa
  assert.deepEqual(fs.readdirSync(destino).sort(), ['.copia-de-teste', 'config.json', 'config.json.bak']);
  for (const arq of ['config.json', 'config.json.bak']) {
    const cfg = JSON.parse(fs.readFileSync(path.join(destino, arq), 'utf8'));
    assert.equal(contarPaineis(cfg), 0, arq);
    assert.equal(cfg.abas.length, 15, arq);
    assert.equal(cfg.tema, 'jornal');
    assert.equal(cfg.abaAtiva, 'aba1');
    assert.equal(JSON.stringify(cfg).includes('sessao-real'), false);
  }
  // o perfil real nao foi tocado
  assert.equal(fs.readFileSync(path.join(real, 'config.json'), 'utf8'), texto);
  assert.equal(fs.existsSync(path.join(real, 'contas', 'credencial.json')), true);
  assert.equal(fs.existsSync(path.join(real, 'inbox', 'msg.json')), true);
});
