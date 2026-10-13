'use strict';
/* Conferencia da rodada 2 da leva 5i (achados A e C): a janela de teste nao chama o Haiku do nome automatico nem apaga conversa real,
   e a copia saneada do perfil sai com o nome automatico desligado. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { lerFonte } = require('../testes/raiz');
const { sanearConfig } = require('../tools/auditoria/sanear-perfil.cjs');

const MAIN = lerFonte('main.js');

test('achado A: o nome automatico e o nome dos agentes recebem o claudeRapido que recusa na janela de teste', () => {
  const trava = String.raw`claudeRapido: (typeof JANELA_DE_TESTE !== 'undefined' && JANELA_DE_TESTE) ? { ...claudeRapido, perguntar: async () => ({ ok: false, erro: 'janela-de-teste', motivo: 'janela-de-teste' }) } : claudeRapido,`;
  for (const quem of ['const revisorDeNomes = tituloAuto.registrar(ipcMain, {', 'const nomeadorDeAgentes = nomesAgentes.registrar(ipcMain, {']) {
    const i = MAIN.indexOf(quem);
    assert.ok(i > 0, quem);
    assert.equal(MAIN.slice(i + quem.length, i + quem.length + 400).trim().startsWith(trava), true, 'a trava e a 1a coisa da chamada: ' + quem);
  }
  assert.equal(/registrar\(ipcMain, \{\s*claudeRapido,/.test(MAIN), false, 'nenhum dos dois recebe mais o claudeRapido cru');
});

test('achado A, o comportamento: na janela de teste so o perguntar recusa (sem chamar o Haiku); cancelar e contaDeAssinatura seguem os de verdade', async () => {
  const i = MAIN.indexOf('const nomeadorDeAgentes = nomesAgentes.registrar(ipcMain, {');
  const linha = MAIN.slice(i).split('\n')[1].trim().replace(/^claudeRapido: /, '').replace(/,$/, '');
  const vm = require('node:vm');
  const chamadas = [];
  const real = { perguntar: async () => { chamadas.push('perguntar'); return { ok: true }; }, cancelar: () => chamadas.push('cancelar'), contaDeAssinatura: async () => 'conta' };
  const naJanela = vm.runInNewContext('(' + linha + ')', { JANELA_DE_TESTE: true, claudeRapido: real });
  const r = await naJanela.perguntar('oi');
  assert.equal(r.ok, false);
  assert.equal(r.erro, 'janela-de-teste');
  assert.deepEqual(chamadas, [], 'o Haiku nao foi chamado');
  naJanela.cancelar();
  assert.equal(await naJanela.contaDeAssinatura(), 'conta');
  assert.deepEqual(chamadas, ['cancelar']);
  const foraDela = vm.runInNewContext('(' + linha + ')', { JANELA_DE_TESTE: false, claudeRapido: real });
  assert.equal(foraDela === real, true, 'fora da janela de teste vai o objeto de verdade, intacto');
  const semConstante = vm.runInNewContext('(' + linha + ')', { claudeRapido: real });
  assert.equal(semConstante === real, true, 'num recorte sem a constante (os testes), tambem');
});

test('achado C: apagar conversa na janela de teste devolve o aviso antes de tocar no disco (local ou servidor)', () => {
  const ini = MAIN.indexOf("ipcMain.handle('sessao:apagar'");
  assert.ok(ini > 0);
  const corpo = MAIN.slice(ini, ini + 400);
  const trava = corpo.indexOf("if (typeof JANELA_DE_TESTE !== 'undefined' && JANELA_DE_TESTE) return { error: AVISO_JANELA_DE_TESTE };");
  assert.ok(trava > 0, 'a trava existe');
  assert.ok(trava < corpo.indexOf('if (remoto != null)'), 'e vem antes do caminho do servidor e do local');
});

test('a copia saneada do perfil sai com o nome automatico desligado (a segunda trava do achado A)', () => {
  // o sanearConfig trabalha numa copia e devolve { cfg, resumo }
  const { cfg } = sanearConfig({ tituloAuto: true, abas: [{ id: 'pc', nome: 'PC', tipo: 'local', paineis: [{ id: 'p1' }] }], abaAtiva: 'pc', prompts: ['oi'] });
  assert.equal(cfg.tituloAuto, false);
  const { cfg: semChave } = sanearConfig({ abas: [], abaAtiva: '' });
  assert.equal(semChave.tituloAuto, false, 'vale tambem quando o config nao tinha a chave');
});
