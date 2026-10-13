// Saneia a COPIA do perfil do Cockpit que a janela de teste da auditoria abre (rodada 2 da leva 5i).
//
// Por que existe: a janela de teste de uma auditoria abriu as conversas REAIS do Hugo (a copia do perfil trazia os paineis salvos), e ele digitou
// numa delas achando que era o Cockpit dele. A copia agora nasce SEM conversas: nenhum painel salvo, nenhuma sessao, nenhum prompt guardado, nenhum
// arquivo de pergunta, fila ou credencial. Ficam as abas, o tema e o visual (o que a rodada 1 confere), e tudo que e' so' preferencia.
//
// Duas camadas, de proposito:
//   1. o script que cria a copia (perfil-de-teste.ps1) so' copia o config.json e o .bak (lista do que PODE ir; o resto nunca sai do perfil real);
//   2. este saneador zera, no config da copia, o que aponta para conversa, e apaga da pasta qualquer coisa de conversa ou credencial que tenha
//      sobrado (uma copia feita de outro jeito, a mao, por um script antigo).
// Nunca toca o perfil real: so' abre uma pasta que tenha a marca ".copia-de-teste" (escrita por quem cria a copia) e recusa o %APPDATA%\Cockpit.
//
// Uso: node sanear-perfil.cjs <pasta da copia>      (escreve uma linha "SANEADO {json}" ou "ERRO ..." e sai com 0 ou 1)
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const MARCA = '.copia-de-teste';

// chaves do config.json que apontam para conversa ou sessao (nome da chave -> valor vazio do mesmo tipo)
const CHAVES_DE_CONVERSA = {
  panes: [],            // lista antiga de paineis (antes das abas)
  prompts: [],          // o que voce digitou (a seta para cima do campo traz de volta)
  temposTrabalho: {},   // tempo de trabalho por conversa (chave motor|sessao)
  artefatos: {},        // artefatos por conversa
  favoritos: [],        // conversas favoritas (chave motor|sessao)
  grupoSessao: {},      // em que grupo da lateral cada conversa esta
};
// pastas do perfil que guardam conversa, pergunta pendente, fila, credencial ou login de site
const PASTAS_FORA = ['acp', 'perguntas', 'mcp', 'remote-sessions', 'host-mailbox', 'inbox', 'debates', 'debate-workspace', 'quadros', 'colados',
  'reader-comments', 'audio', 'contas', 'ssh', 'Local Storage', 'Session Storage', 'IndexedDB', 'Partitions', 'Network', 'blob_storage'];
const ARQUIVOS_FORA = ['retomar.json', 'nomes.json', 'indice-conversas.json', 'Cookies', 'Cookies-journal', 'Login Data', 'Login Data-journal', 'Web Data'];
const PADROES_FORA = [/^claude-modo-.*\.json$/, /^config\.json\.corrompido-/, /^config\.json\.tmp/];

const copiaProfunda = (v) => JSON.parse(JSON.stringify(v));
const ehObjeto = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/* O config da copia sem conversa nenhuma. Puro: devolve { cfg, resumo } e nao muda o que recebeu.
   - cada aba fica (nome, tipo, pastas, tudo), so' sem os paineis (ab.paineis = []);
   - a aba ativa nunca e' de servidor (abrir a janela de teste nao pode conectar em servidor nenhum): se for, vai para a 1a aba local;
   - tema, visual, abas, grupos, pasta padrao e o resto das preferencias seguem como estao. */
function sanearConfig(entrada) {
  if (!ehObjeto(entrada)) throw new Error('O config.json nao e um objeto.');
  const cfg = copiaProfunda(entrada);
  const resumo = { abas: 0, paineisRemovidos: 0, paineisAntigosRemovidos: 0, chavesZeradas: [], abaAtiva: null, abaAtivaTrocada: false };
  const abas = Array.isArray(cfg.abas) ? cfg.abas : [];
  for (const aba of abas) {
    if (!ehObjeto(aba)) continue;
    resumo.abas++;
    if (Array.isArray(aba.paineis)) resumo.paineisRemovidos += aba.paineis.length;
    aba.paineis = [];
  }
  if (Array.isArray(cfg.panes)) resumo.paineisAntigosRemovidos = cfg.panes.length;
  for (const [chave, vazio] of Object.entries(CHAVES_DE_CONVERSA)) {
    if (Object.hasOwn(cfg, chave)) { cfg[chave] = copiaProfunda(vazio); resumo.chavesZeradas.push(chave); }
  }
  // conferencia da rodada 2 da leva 5i (achado A): na copia o nome automatico fica desligado (o app tambem barra, isto e' a segunda trava)
  cfg.tituloAuto = false;
  const locais = abas.filter((a) => ehObjeto(a) && a.tipo !== 'ssh' && a.id);
  const ativa = abas.find((a) => ehObjeto(a) && a.id === cfg.abaAtiva);
  if (locais.length && (!ativa || ativa.tipo === 'ssh')) {
    cfg.abaAtiva = locais[0].id;
    resumo.abaAtivaTrocada = true;
  }
  resumo.abaAtiva = cfg.abaAtiva === undefined ? null : cfg.abaAtiva;
  return { cfg, resumo };
}

// mesma pasta que a do perfil real? (case-insensitive, no Windows as duas grafias valem)
function ehOPerfilReal(pasta, ambiente = process.env) {
  const alvo = path.resolve(pasta).toLowerCase().replace(/[\\/]+$/, '');
  const reais = [ambiente.APPDATA && path.join(ambiente.APPDATA, 'Cockpit'), ambiente.LOCALAPPDATA && path.join(ambiente.LOCALAPPDATA, 'Cockpit')]
    .filter(Boolean).map((p) => path.resolve(p).toLowerCase());
  return reais.some((real) => alvo === real || alvo.startsWith(real + path.sep));
}

function gravarSeguro(arquivo, texto) {
  const tmp = arquivo + '.tmp-saneamento';
  fs.writeFileSync(tmp, texto, 'utf8');
  fs.renameSync(tmp, arquivo);
}

/* Sanea a pasta da copia: o config.json e o .bak sem conversa, e fora tudo que guarda conversa ou credencial. Devolve o relatorio. */
function sanearPerfil(pasta, { ambiente = process.env } = {}) {
  if (typeof pasta !== 'string' || !pasta.trim() || !path.isAbsolute(pasta)) throw new Error('Informe a pasta da copia do perfil (caminho completo).');
  if (ehOPerfilReal(pasta, ambiente)) throw new Error('Recusado: esta e a pasta do Cockpit de verdade (' + pasta + '). So sanear a COPIA.');
  if (!fs.existsSync(path.join(pasta, MARCA))) throw new Error('Recusado: a pasta nao tem a marca ' + MARCA + ' (so abro copias feitas por perfil-de-teste.ps1).');
  const arquivo = path.join(pasta, 'config.json');
  if (!fs.existsSync(arquivo)) throw new Error('A copia nao tem config.json.');
  const { cfg, resumo } = sanearConfig(JSON.parse(fs.readFileSync(arquivo, 'utf8')));
  const texto = JSON.stringify(cfg, null, 2);
  gravarSeguro(arquivo, texto);
  // o .bak entra no lugar do config quando ele corrompe: nao pode ressuscitar os paineis de verdade
  gravarSeguro(arquivo + '.bak', texto);
  const apagados = [];
  const apagar = (nome, recursivo) => {
    const alvo = path.join(pasta, nome);
    if (!fs.existsSync(alvo)) return;
    fs.rmSync(alvo, { recursive: recursivo, force: true });
    apagados.push(nome);
  };
  for (const d of PASTAS_FORA) apagar(d, true);
  for (const f of ARQUIVOS_FORA) apagar(f, false);
  for (const nome of fs.readdirSync(pasta)) if (PADROES_FORA.some((re) => re.test(nome))) apagar(nome, true);
  return { ...resumo, tema: cfg.tema ?? null, visualMac: !!cfg.visualMac, apagados };
}

module.exports = { MARCA, CHAVES_DE_CONVERSA, PASTAS_FORA, ARQUIVOS_FORA, PADROES_FORA, sanearConfig, sanearPerfil, ehOPerfilReal };

if (require.main === module) {
  try {
    const relatorio = sanearPerfil(process.argv[2]);
    console.log('SANEADO ' + JSON.stringify(relatorio));
  } catch (e) {
    console.log('ERRO ' + (e && e.message || e));
    process.exit(1);
  }
}
