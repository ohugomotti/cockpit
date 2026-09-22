const { webUtils, contextBridge, ipcRenderer } = require('electron');

/* Leva 41 (B2): TODA parada de proposito da tela passa pelo paneStop (trocar
   motor, modelo, modo, conta, pasta, fechar painel, guardar a aba...). A hora
   fica anotada aqui; antes de religar um motor que caiu, a tela confere -- se
   voce parou quase junto com a queda, nao religa. */
const paradas = new Map();

contextBridge.exposeInMainWorld('api', {
  // desde o Electron 32 o File nao tem ".path"; e' assim que se pega o caminho
  caminhoDoArquivo: (f) => { try { return webUtils.getPathForFile(f); } catch { return ''; } },
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (c) => ipcRenderer.invoke('config:set', c),
  home: () => ipcRenderer.invoke('sys:home'),
  versao: () => ipcRenderer.invoke('sys:versao'),
  /* o tema salvo, lido UMA vez aqui (antes do app.js): a tela ja' nasce nele,
     sem piscar escuro enquanto o boot le o config */
  temaInicial: (() => { try { return ipcRenderer.sendSync('config:tema') || ''; } catch { return ''; } })(),
  plataforma: process.platform,

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
  abrirLink: (u) => ipcRenderer.invoke('shell:link', u),
  openUrl: (u) => ipcRenderer.invoke('shell:openUrl', u),

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
  onDebateEvent: (cb) => { const handler = (_e, state) => cb(state); ipcRenderer.on('debate:event', handler); return () => ipcRenderer.removeListener('debate:event', handler); },
  approve: (o) => ipcRenderer.invoke('pane:approve', o),
  autoLiberar: (o) => ipcRenderer.invoke('pane:autoLiberar', o),
  liberacoes: (o) => ipcRenderer.invoke('pane:liberacoes', o),
  codexModels: (remoto) => ipcRenderer.invoke('codex:models', remoto),
  codexApps: (remoto) => ipcRenderer.invoke('codex:apps', remoto),
  sessionsClaude: (r) => ipcRenderer.invoke('sessions:claude', r),
  sessionsCodex: (r) => ipcRenderer.invoke('sessions:codex', r),
  sessionsCli: (e) => ipcRenderer.invoke('sessions:cli', e),
  sessionHistoryRemoto: (o) => ipcRenderer.invoke('sessions:historyRemoto', o),
  sessionHistory: (o) => ipcRenderer.invoke('sessions:history', o),
  sessionTitulo: (o) => ipcRenderer.invoke('sessions:titulo', o),
  skills: (e) => ipcRenderer.invoke('skills:list', e),
  pickFiles: (k) => ipcRenderer.invoke('dialog:pickFiles', k),
  pickPhoto: () => ipcRenderer.invoke('user:pickPhoto'),
  anexoLer: (f) => ipcRenderer.invoke('anexo:ler', f),
  colados: () => ipcRenderer.invoke('clipboard:anexos'),
  // terminal embutido: colar o codigo do login e copiar o que foi marcado
  textoCopiado: () => ipcRenderer.invoke('clipboard:texto'),
  copiarTexto: (t) => ipcRenderer.invoke('clipboard:copiar', t),
  // anexo colado mora SEMPRE aqui no PC: quem abre anexo nao passa 'remoto'
  verArquivo: (f, remoto) => ipcRenderer.invoke('arquivo:ver', remoto ? { file: f, remoto } : f),
  renomear: (o) => ipcRenderer.invoke('sessao:renomear', o),
  // leva 41 (B6): nome de 3 palavras da conversa nova ({ chave, texto } -> { titulo })
  tituloAuto: (o) => ipcRenderer.invoke('titulo:gerar', o),
  sessaoFork: (o) => ipcRenderer.invoke('sessao:fork', o),
  motoresVersoes: () => ipcRenderer.invoke('motores:versoes'),
  acpConfig: (o) => ipcRenderer.invoke('acp:config', o),
  agentesClaude: (o) => ipcRenderer.invoke('agentes:claude', o),
  // rotinas = tarefas agendadas do Windows (so' existem nesta plataforma)
  rotinasListar: (o) => ipcRenderer.invoke('rotinas:listar', o),   // { forcar: true } fura o cache de 15 s do main
  rotinasDisparar: (o) => ipcRenderer.invoke('rotinas:disparar', o),
  rotinasLigar: (o) => ipcRenderer.invoke('rotinas:ligar', o),   // { nome, caminho, ligar: true|false }
  imagemSalvar: (o) => ipcRenderer.invoke('imagem:salvar', o),
  textoSalvar: (o) => ipcRenderer.invoke('arquivo:salvarTexto', o),
  textoLer: (o) => ipcRenderer.invoke('arquivo:lerTexto', o),
  ocrLer: (o) => ipcRenderer.invoke('ocr:ler', o),
  promptsLer: () => ipcRenderer.invoke('prompts:ler'),
  promptsSalvar: (l) => ipcRenderer.invoke('prompts:salvar', l),
  recortarTela: (o) => ipcRenderer.invoke('tela:recortar', o),
  inboxConsumir: (o) => ipcRenderer.invoke('inbox:consumir', o),
  inboxPasta: () => ipcRenderer.invoke('inbox:pasta'),
  inboxOuvindo: () => ipcRenderer.invoke('inbox:ouvindo'),
  atalhosEstado: () => ipcRenderer.invoke('atalhos:estado'),
  atalhosLigar: (o) => ipcRenderer.invoke('atalhos:ligar', o),
  onVozMotorCaiu: (cb) => ipcRenderer.on('voz:motor-caiu', (_e, p) => cb(p)),
  onInbox: (cb) => ipcRenderer.on('inbox', (_e, p) => cb(p)),
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

  termRun: (o) => ipcRenderer.invoke('term:run', o),
  termInput: (o) => ipcRenderer.invoke('term:input', o),
  termKill: (o) => ipcRenderer.invoke('term:kill', o),
  termResize: (o) => ipcRenderer.invoke('term:resize', o),
  onTermEvent: (cb) => ipcRenderer.on('term:event', (_e, p) => cb(p)),

  onPaneEvent: (cb) => ipcRenderer.on('pane:event', (_e, p) => cb(p)),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action) => cb(action)),
});
