const { webUtils, contextBridge, ipcRenderer } = require('electron');

/* Leva 41 (B2): TODA parada de proposito da tela passa pelo paneStop (trocar
   motor, modelo, modo, conta, pasta, fechar painel, guardar a aba...). A hora
   fica anotada aqui; antes de religar um motor que caiu, a tela confere -- se
   voce parou quase junto com a queda, nao religa. */
const paradas = new Map();

/* O preload não enxerga o logMain do main: o erro vai para o tela.log pelo mesmo canal 'tela:log' do logTela (mais
   abaixo). O canal só leva tipo, msg e stack, então o contexto vai no começo da msg: "[contexto] mensagem".
   Se nem esse canal funcionar não há onde registrar: o erro vai para o console da tela e quem chamou segue com o
   mesmo valor de volta de sempre (nunca lança). */
function registrarNoLog(contexto, erro) {
  try {
    ipcRenderer.send('tela:log', {
      tipo: 'erro', msg: '[' + contexto + '] ' + String((erro && erro.message) || erro),
      stack: erro && typeof erro.stack === 'string' ? erro.stack : undefined,
    });
  } catch (falha) {
    if (typeof console !== 'undefined') console.error('[preload] não consegui registrar "' + contexto + '":', falha);
  }
}

const visualMacInitial = (() => {
  try { return ipcRenderer.sendSync('visual-mac:initial') || {}; } catch (e) { registrarNoLog('visual-mac-inicial', e); return {}; }
})();

// Só dados cruzam a ponte; quem monta um painel pode remover seu ouvinte
// ao desmontar. Retornar ipcRenderer.on(...) expunha o emissor e não limpava.
function ouvir(canal, cb) {
  if (typeof cb !== 'function') return () => {};
  const handler = (_event, payload) => cb(payload);
  ipcRenderer.on(canal, handler);
  return () => ipcRenderer.removeListener(canal, handler);
}

contextBridge.exposeInMainWorld('api', {
  // desde o Electron 32 o File nao tem ".path"; e' assim que se pega o caminho
  caminhoDoArquivo: (f) => { try { return webUtils.getPathForFile(f); } catch (e) { registrarNoLog('caminho-do-arquivo', e); return ''; } },
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (c) => ipcRenderer.invoke('config:set', c),
  onConfigSaveError: (cb) => ouvir('config:save-error', cb),
  home: () => ipcRenderer.invoke('sys:home'),
  versao: () => ipcRenderer.invoke('sys:versao'),
  /* log de erros da tela (userData/logs/tela.log): manda e esquece, sem esperar
     resposta. Quem usa e' o renderer/log-tela.js, o primeiro script da tela; o
     main so' aceita este canal da janela principal e corta e mascara o que chega. */
  logTela: (entrada) => { try { ipcRenderer.send('tela:log', entrada); } catch {} },
  /* o tema salvo, lido UMA vez aqui (antes do app.js): a tela ja' nasce nele,
     sem piscar escuro enquanto o boot le o config */
  temaInicial: (() => { try { return ipcRenderer.sendSync('config:tema') || ''; } catch (e) { registrarNoLog('tema-inicial', e); return ''; } })(),
  plataforma: process.platform,
  /* janela de teste (rodada 2 da leva 5i): o main poe --cockpit-janela-teste nos argumentos da tela quando o app abre com COCKPIT_JANELA_TESTE=1
     (additionalArguments). A tela poe a faixa vermelha e barra o envio. So' o booleano cruza a ponte; sem a flag (o normal): false. */
  janelaDeTeste: !!(process.argv && process.argv.includes('--cockpit-janela-teste')),
  visualMacInicial: visualMacInitial.visualMac === true,
  systemAppearanceInicial: visualMacInitial.appearance || null,
  getSystemAppearance: () => ipcRenderer.invoke('visual-mac:appearance'),
  onSystemAppearance: (cb) => ouvir('visual-mac:appearance', cb),
  setVisualMac: (enabled) => ipcRenderer.invoke('visual-mac:set', enabled),
  setWindowTheme: (colors) => ipcRenderer.invoke('visual-mac:window-theme', colors),
  showWindowMenu: (point) => ipcRenderer.invoke('visual-mac:menu', point),
  setAttentionBadge: (count) => ipcRenderer.invoke('visual-mac:attention', count),

  pickFolder: (start) => ipcRenderer.invoke('dialog:pickFolder', start),
  /* Arvore, "@" e visor tambem sabem ler dentro de um servidor. O 'remoto'
     ({host, usuario, chave, caminhoRemoto}) vem do PAINEL, e sem ele tudo
     segue lendo o disco deste PC exatamente como antes. */
  listDir: (d, remoto) => ipcRenderer.invoke('fs:list', remoto ? { dir: d, remoto } : d),
  buscarArquivos: (o) => ipcRenderer.invoke('fs:buscarArquivos', o),   // { cwd, termo, remoto? }
  gitStatus: (o) => ipcRenderer.invoke('git:status', o),
  gitDiff: (o) => ipcRenderer.invoke('git:diff', o),
  gitWorktreesList: (o) => ipcRenderer.invoke('git:worktrees:list', o),
  gitWorktreesCreate: (o) => ipcRenderer.invoke('git:worktrees:create', o),
  gitWorktreesOpen: (o) => ipcRenderer.invoke('git:worktrees:open', o),
  apagarSessao: (o) => ipcRenderer.invoke('sessao:apagar', o),
  exportarSessao: (o) => ipcRenderer.invoke('sessao:exportar', o),
  readFile: (f) => ipcRenderer.invoke('fs:read', f),
  openPath: (p) => ipcRenderer.invoke('shell:open', p),
  mostrarNaPasta: (p) => ipcRenderer.invoke('shell:mostrarNaPasta', p),
  abrirLink: (u) => ipcRenderer.invoke('shell:link', u),
  openUrl: (u) => ipcRenderer.invoke('shell:openUrl', u),
  /* Navegador interno (leva 5i): a pagina e' um WebContentsView do main, nao DOM. A tela manda os comandos e o retangulo do corpo do
     visor (px da tela; o main converte para o zoom da janela) e ouve o estado. Tudo vai por { paneId, ... }; so' dados cruzam a ponte.
     abrir(paneId, url, rect?) -> { ok } | { ok: false, erro }; posicionar(paneId, { x, y, width, height }); visivel(paneId, true|false);
     o estado { paneId, url, titulo, podeVoltar, podeAvancar, carregando } e o download { paneId, nome, caminho } chegam por onEstado e onDownload.
     Rodada 2 da leva 5i: onTecla recebe { paneId, tecla } quando o foco esta' na PAGINA e a tecla e' da tela ('fechar': Ctrl+W ou Esc; 'endereco': Ctrl+L). */
  navegador: {
    abrir: (paneId, url, rect) => ipcRenderer.invoke('navegador:abrir', { paneId, url, rect }),
    posicionar: (paneId, rect) => ipcRenderer.invoke('navegador:posicionar', { paneId, rect }),
    visivel: (paneId, visivel) => ipcRenderer.invoke('navegador:visivel', { paneId, visivel }),
    voltar: (paneId) => ipcRenderer.invoke('navegador:voltar', { paneId }),
    avancar: (paneId) => ipcRenderer.invoke('navegador:avancar', { paneId }),
    recarregar: (paneId, semCache) => ipcRenderer.invoke('navegador:recarregar', { paneId, semCache }),
    parar: (paneId) => ipcRenderer.invoke('navegador:parar', { paneId }),
    irPara: (paneId, url) => ipcRenderer.invoke('navegador:irPara', { paneId, url }),
    externo: (paneId) => ipcRenderer.invoke('navegador:externo', { paneId }),
    fechar: (paneId) => ipcRenderer.invoke('navegador:fechar', { paneId }),
    onEstado: (cb) => ouvir('navegador:estado', cb),
    onDownload: (cb) => ouvir('navegador:download', cb),
    onTecla: (cb) => ouvir('navegador:tecla', cb),
  },

  paneStart: (o) => ipcRenderer.invoke('pane:start', o),
  paneSend: (o) => ipcRenderer.invoke('pane:send', o),
  paneInterrupt: (o) => ipcRenderer.invoke('pane:interrupt', o),
  paneSteer: (o) => ipcRenderer.invoke('pane:steer', o),
  paneCompactar: (o) => ipcRenderer.invoke('pane:compactar', o),
  paneStop: (o) => { if (o && o.paneId != null) paradas.set(String(o.paneId), Date.now()); return ipcRenderer.invoke('pane:stop', o); },
  paradaEm: (paneId) => paradas.get(String(paneId)) || 0,
  // conversa que estava em turno quando o app fechou/recarregou (entregue uma vez so')
  retomarPegar: (o) => ipcRenderer.invoke('retomar:pegar', o),
  debateStart: (o) => ipcRenderer.invoke('debate:start', o),
  debateGet: (id) => ipcRenderer.invoke('debate:get', id),
  debateList: () => ipcRenderer.invoke('debate:list'),
  debateLeitura: (o) => ipcRenderer.invoke('debate:leitura', o),
  debateContinue: (o) => ipcRenderer.invoke('debate:continue', o),
  debateStop: (id) => ipcRenderer.invoke('debate:stop', id),
  debateReview: (o) => ipcRenderer.invoke('debate:review', o),
  onDebateEvent: (cb) => ouvir('debate:event', cb),
  approve: (o) => ipcRenderer.invoke('pane:approve', o),
  // Tarefa 8: resposta do cartao "Plano pronto" do Claude ({ paneId, chave, aprovar, texto } -> { ok, modo } | { error, encerrado })
  panePlano: (o) => ipcRenderer.invoke('pane:plano', o),
  autoLiberar: (o) => ipcRenderer.invoke('pane:autoLiberar', o),
  liberacoes: (o) => ipcRenderer.invoke('pane:liberacoes', o),
  codexModels: (remoto) => ipcRenderer.invoke('codex:models', remoto),
  claudeModels: (remoto) => ipcRenderer.invoke('claude:models', remoto),
  modelBenchmarks: (refresh=false) => ipcRenderer.invoke('models:comparison', {refresh:refresh === true}),
  agentHistory: (o) => ipcRenderer.invoke('agents:history', o),
  connectorRespond: (o) => ipcRenderer.invoke('connector:respond', o),
  connectorList: (paneId) => ipcRenderer.invoke('connector:list', paneId),
  connectorOpenUrl: (o) => ipcRenderer.invoke('connector:openUrl', o),
  experimentsStatus: () => ipcRenderer.invoke('experiments:status'),
  experimentsKey: key => ipcRenderer.invoke('experiments:key', key),
  experimentsGrant: o => ipcRenderer.invoke('experiments:grant', o),
  experimentsImage: o => ipcRenderer.invoke('experiments:image', o),
  experimentsSaveImage: o => ipcRenderer.invoke('experiments:saveImage', o),
  liveOffer: o => ipcRenderer.invoke('experiments:liveOffer', o),
  cloudStart: o => ipcRenderer.invoke('experiments:cloudStart', o),
  cloudList: () => ipcRenderer.invoke('experiments:cloudList'),
  cloudRead: id => ipcRenderer.invoke('experiments:cloudRead', id),
  cloudCancel: id => ipcRenderer.invoke('experiments:cloudCancel', id),
  cloudApprove: o => ipcRenderer.invoke('experiments:cloudApprove', o),
  cloudArtifact: o => ipcRenderer.invoke('experiments:cloudArtifact', o),
  codexApps: (remoto) => ipcRenderer.invoke('codex:apps', remoto),
  sessionsClaude: (r) => ipcRenderer.invoke('sessions:claude', r),
  sessionsScan: (o) => ipcRenderer.invoke('sessions:scan', o),
  sessionsCancel: (id) => ipcRenderer.invoke('sessions:scan-cancel', id),
  onSessionsProgress: (cb) => ouvir('sessions:progress', cb),
  sessionsCodex: (r) => ipcRenderer.invoke('sessions:codex', r),
  sessionsCli: (e) => ipcRenderer.invoke('sessions:cli', e),
  sessionHistoryRemoto: (o) => ipcRenderer.invoke('sessions:historyRemoto', o),
  sessionHistory: (o) => ipcRenderer.invoke('sessions:history', { ...o, inteiro: true }),
  sessionTitulo: (o) => ipcRenderer.invoke('sessions:titulo', o),
  skills: (e) => ipcRenderer.invoke('skills:list', e),
  pickFiles: (k) => ipcRenderer.invoke('dialog:pickFiles', k),
  pickPhoto: () => ipcRenderer.invoke('user:pickPhoto'),
  anexoLer: (f) => ipcRenderer.invoke('anexo:ler', f),
  colados: () => ipcRenderer.invoke('clipboard:anexos'),
  colarSalvarImagem: (bytes, tipo) => ipcRenderer.invoke('colar:salvar-imagem', bytes, tipo),   // bytes do File colado (ArrayBuffer) -> { arquivo } | { error }
  // terminal embutido: colar o codigo do login e copiar o que foi marcado
  textoCopiado: () => ipcRenderer.invoke('clipboard:texto'),
  copiarTexto: (t) => ipcRenderer.invoke('clipboard:copiar', t),
  // anexo colado mora SEMPRE aqui no PC: quem abre anexo nao passa 'remoto'
  verArquivo: (f, remoto) => ipcRenderer.invoke('arquivo:ver', remoto ? { file: f, remoto } : f),
  // PDF do leitor: abre numa janela propria do main (sandbox, sem preload, sem Node) -> { ok } | { error }
  abrirPdf: (f) => ipcRenderer.invoke('pdf:abrir', f),
  // imagem dentro do .md aberto no leitor: { arquivo, remoto? } (ja' resolvido pela pasta do documento) ou { url } https -> { dados: data: } | { erro }
  imagemDoMd: (o) => ipcRenderer.invoke('arquivo:imagemMd', o),
  readerCommentsGet: (document) => ipcRenderer.invoke('reader-comments:get', document),
  readerCommentsSave: (input) => ipcRenderer.invoke('reader-comments:save', input),
  // Leva 2 (Task 5): o leitor aberto vigia o arquivo LOCAL (nunca de rede) e recarrega quando ele muda.
  // vigiarArquivo({ chave, arquivo }) -> { ok } | { ok: false, motivo }; pararVigia(chave) -> { ok }; o aviso: { chave, arquivo, evento: 'mudou' | 'apagado' }
  vigiarArquivo: (o) => ipcRenderer.invoke('arquivo:vigiar', o),
  pararVigia: (chave) => ipcRenderer.invoke('arquivo:vigiar-parar', chave),
  onArquivoMudou: (cb) => ouvir('arquivo:mudou', cb),
  // Tarefa 9: desfazer a edicao da IA de um passo. Vai SO' { paneId, id }: o antes/depois quem sabe e' o main
  desfazerEdicao: (o) => ipcRenderer.invoke('arquivo:desfazer', { paneId: o && o.paneId, id: o && o.id }),
  renomear: (o) => ipcRenderer.invoke('sessao:renomear', o),
  // leva 41 (B6) + Tarefa 6: o nome automatico da conversa, no envio do 1o pedido e no fim do turno
  // ({ chave, revisao, pedidos, total, primeiraResposta, ultimaResposta, tituloAtual, pasta, conversa } -> { acao, titulo, motivo })
  tituloAuto: (o) => ipcRenderer.invoke('titulo:revisar', o),
  // o nome dado a mao cancela a revisao em andamento ({ chave })
  tituloCancelar: (o) => ipcRenderer.invoke('titulo:cancelar', o),
  // Tarefa 3 (26/09): Mais detalhes de um trecho ({ requestId, paneId, trecho, resposta, historico, conversa, pergunta })
  detalhePerguntar: (o) => ipcRenderer.invoke('detalhe:perguntar', o),
  detalheCancelar: (o) => ipcRenderer.invoke('detalhe:cancelar', o),
  sessaoFork: (o) => ipcRenderer.invoke('sessao:fork', o),
  motoresVersoes: () => ipcRenderer.invoke('motores:versoes'),
  motoresAtualizacoes: () => ipcRenderer.invoke('motores:atualizacoes'),
  acpConfig: (o) => ipcRenderer.invoke('acp:config', o),
  agentesClaude: (o) => ipcRenderer.invoke('agentes:claude', o),
  // rotinas = tarefas agendadas do Windows (so' existem nesta plataforma)
  rotinasListar: (o) => ipcRenderer.invoke('rotinas:listar', o),   // { forcar: true } fura o cache de 15 s do main
  rotinasDisparar: (o) => ipcRenderer.invoke('rotinas:disparar', o),
  rotinasLigar: (o) => ipcRenderer.invoke('rotinas:ligar', o),   // { nome, caminho, ligar: true|false }
  imagemSalvar: (o) => ipcRenderer.invoke('imagem:salvar', o),
  textoSalvar: (o) => ipcRenderer.invoke('arquivo:salvarTexto', o),
  textoLer: (o) => ipcRenderer.invoke('arquivo:lerTexto', o),
  // Quadro aberto de um .excalidraw do disco (Task 7 da leva 2): vai SO' { arquivo, texto }; quem pergunta e escolhe onde grava e' o main
  quadroSalvar: (o) => ipcRenderer.invoke('quadro:salvar', { arquivo: o && o.arquivo, texto: o && o.texto }),
  quadroSalvarComo: (o) => ipcRenderer.invoke('quadro:salvarComo', { arquivo: o && o.arquivo, texto: o && o.texto }),
  ocrLer: (o) => ipcRenderer.invoke('ocr:ler', o),
  promptsLer: () => ipcRenderer.invoke('prompts:ler'),
  promptsSalvar: (l) => ipcRenderer.invoke('prompts:salvar', l),
  recortarTela: (o) => ipcRenderer.invoke('tela:recortar', o),
  inboxConsumir: (o) => ipcRenderer.invoke('inbox:consumir', o),
  inboxPasta: () => ipcRenderer.invoke('inbox:pasta'),
  inboxOuvindo: () => ipcRenderer.invoke('inbox:ouvindo'),
  atalhosEstado: () => ipcRenderer.invoke('atalhos:estado'),
  atalhosLigar: (o) => ipcRenderer.invoke('atalhos:ligar', o),
  onVozMotorCaiu: (cb) => ouvir('voz:motor-caiu', cb),
  onInbox: (cb) => ouvir('inbox', cb),
  audioMotor: (o) => ipcRenderer.invoke('audio:motor', o),
  audioMotorInfo: () => ipcRenderer.invoke('audio:motorInfo'),
  buscarConversas: (o) => ipcRenderer.invoke('sessions:buscar', o),
  auth: (o) => ipcRenderer.invoke('auth:acao', o),
  contaLer: (e) => ipcRenderer.invoke('conta:ler', e),
  audioDisponivel: () => ipcRenderer.invoke('audio:disponivel'),
  audioAquecer: () => ipcRenderer.invoke('audio:aquecer'),
  audioDitado: (o) => ipcRenderer.invoke('audio:ditado', o),
  audioDitadoFinal: (o) => ipcRenderer.invoke('audio:ditado-final', o),
  audioDitadoCancelar: (o) => ipcRenderer.invoke('audio:ditado-cancelar', o),
  perguntaResponder: (o) => ipcRenderer.invoke('pergunta:responder', o),
  contasListar: (e) => ipcRenderer.invoke('contas:listar', e),
  contasDisponivel: (e) => ipcRenderer.invoke('contas:disponivel', e),
  codexReiniciar: () => ipcRenderer.invoke('codex:reiniciar'),
  motoresDisponiveis: (...args) => ipcRenderer.invoke('motores:disponiveis', args.length ? { remoto: args[0], detalhado: true } : undefined),
  contasComparar: (engine, remoto, options = {}) => ipcRenderer.invoke('contas:comparar', { ...options, engine, remoto }),
  contasCompararCancelar: (id) => ipcRenderer.invoke('contas:compararCancelar', id),
  sessionsRemoto: (o) => ipcRenderer.invoke('sessions:remoto', o),
  contasSalvar: (o) => ipcRenderer.invoke('contas:salvar', o),
  contasTrocar: (o) => ipcRenderer.invoke('contas:trocar', o),
  contasEsquecer: (o) => ipcRenderer.invoke('contas:esquecer', o),
  mcpList: (e) => ipcRenderer.invoke('mcp:list', e),
  mcpAcao: (o) => ipcRenderer.invoke('mcp:acao', o),
  mcpDiagnostico: (o) => ipcRenderer.invoke('mcp:diagnostico', o),
  mcpRecarregar: (o) => ipcRenderer.invoke('mcp:recarregar', o),
  agentesSessao: (o) => ipcRenderer.invoke('agentes:sessao', o),
  // Tarefa 7: nome dos agentes em portugues de gente ([{ chave, tipo, pedido, descricao }] -> { [chave]: { titulo, linha } })
  agentesNomes: (lista) => ipcRenderer.invoke('agentes:nomes', lista),

  termRun: (o) => ipcRenderer.invoke('term:run', o),
  termInput: (o) => ipcRenderer.invoke('term:input', o),
  termKill: (o) => ipcRenderer.invoke('term:kill', o),
  termResize: (o) => ipcRenderer.invoke('term:resize', o),
  onTermEvent: (cb) => ouvir('term:event', cb),

  onPaneEvent: (cb) => ouvir('pane:event', cb),
  onMenu: (cb) => ouvir('menu', cb),
});
