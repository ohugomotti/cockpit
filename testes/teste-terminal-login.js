/* Entrar na conta (Claude/Codex) e login de conector abrem a "telinha preta":
   janelaTerminal monta um xterm e manda o comando pro pty.

   O bug: janelaTerminal setava P._fecharTerm = fechar (o fechamento do terminal
   NOVO) e so' depois chamava fecharTerminalEmSilencio(P) pra tirar o antigo do
   caminho. Como _fecharTerm ja apontava pro novo, quem morria era o recem-criado:
   dispose no xterm, id fora de termsVivos e a classe cx-term perdida -- tudo
   ANTES do termRun. O comando ate rodava no pty, mas nenhum byte voltava pra
   tela: o usuario via a telinha preta vazia e nao conseguia entrar na conta.

   Aqui janelaTerminal roda de verdade, num DOM de mentira, nas duas versoes:
   a atual tem de sobreviver, a com o bug tem de morrer. */
const vm = require('vm');
const { lerFonte, pegarBloco, globaisFalsos } = require('./raiz');

const app = lerFonte('renderer', 'app.js');
let falhas = 0;
const checa = (nome, ok, det) => { console.log((ok ? '  ok   ' : '  FALHA') + ' ' + nome + (ok || !det ? '' : '  -> ' + det)); if (!ok) falhas++; };

/* ---- DOM de mentira: um elemento por seletor, o suficiente pra janelaTerminal ---- */
function montarPalco(fonteJanela) {
  const criados = new Map();
  const el = (sel) => {
    if (!criados.has(sel)) {
      const c = new Set();
      criados.set(sel, {
        _sel: sel, className: '', textContent: '', innerHTML: '', title: '',
        clientWidth: 700, clientHeight: 400, onclick: null, style: {},
        classList: { add: (x) => c.add(x), remove: (x) => c.delete(x), contains: (x) => c.has(x) },
        appendChild() {}, focus() {}, addEventListener() {},
      });
    }
    return criados.get(sel);
  };

  const feitos = [];          // todo xterm que nasceu nesta rodada
  function Terminal(o) { this.opts = o; this.escrito = ''; this.morto = false; feitos.push(this); }
  Terminal.prototype.open = function () {};
  Terminal.prototype.onData = function () {};
  Terminal.prototype.write = function (d) { this.escrito += d; };
  Terminal.prototype.dispose = function () { this.morto = true; };
  Terminal.prototype.resize = function () {};
  Terminal.prototype.focus = function () {};
  Terminal.prototype.attachCustomKeyEventHandler = function () {};   // colar/copiar (leva 41.1)
  Terminal.prototype.hasSelection = function () { return false; };

  const chamadas = [];
  const api = {
    termInput() {}, termResize() {}, openUrl() {},
    termKill(o) { chamadas.push('kill:' + o.id); return Promise.resolve({ ok: true }); },
    termRun(o) { chamadas.push('run:' + o.id); return Promise.resolve({ ok: true }); },
  };

  const ctx = {
    ...globaisFalsos(), console, Terminal,
    $: el, $$: () => [],
    window: { api },
    ico: () => '', fecharMenus: () => {}, mostrarAviso: () => {}, remotoDoPane: () => null,
    panes: new Map(), panesFundo: new Map(),
    bootId: 'b', termSeq: 0,
    termsVivos: new Map(),
    REG_LINK: /https?:\/\/[^\s"'<>)\]]+/g,
    fecharModal: (P) => { el('.p-modal').classList.add('hidden'); el('.modal-cx').innerHTML = ''; void P; },
  };
  vm.createContext(ctx);
  vm.runInContext(pegarBloco(app, 'function fecharTerminalEmSilencio('), ctx);
  vm.runInContext(pegarBloco(app, 'function ajustarTerminal('), ctx);
  vm.runInContext(pegarBloco(app, 'function textoVisivelDoTerminal('), ctx);
  vm.runInContext(fonteJanela, ctx);
  return { ctx, el, feitos, chamadas };
}

/* Abre a telinha e devolve o que importa: o xterm ainda vale? o id continua
   registrado? o comando chegou a rodar? */
function abrirTelinha(fonteJanela) {
  const palco = montarPalco(fonteJanela);
  const P = { id: 'p1', engine: 'claude', el: {}, morto: false };
  palco.ctx.P = P;
  palco.ctx.janelaTerminal(P, 'claude auth login', 'Entrar na conta do Claude');
  const [id] = [...palco.ctx.termsVivos.keys()];
  return {
    palco, P, id,
    registrado: palco.ctx.termsVivos.size === 1,
    vivo: palco.feitos.length === 1 && !palco.feitos[0].morto,
    rodou: palco.chamadas.some((c) => c.startsWith('run:')),
    ehTerm: palco.el('.modal-cx').className.includes('cx-term'),
    term: palco.feitos[0],
  };
}

const fonteAtual = pegarBloco(app, 'function janelaTerminal(');

/* ---- versao atual: a telinha tem de nascer viva ---- */
const bom = abrirTelinha(fonteAtual);
checa('o xterm sobrevive a abertura', bom.vivo);
checa('o id fica em termsVivos (senao os dados do pty se perdem)', bom.registrado);
checa('a caixa mantem a classe cx-term', bom.ehTerm);
checa('o comando foi mandado pro pty', bom.rodou);
checa('nao mata o pty recem-criado', !bom.palco.chamadas.includes('kill:' + bom.id));

/* o que o pty devolve tem de chegar na tela: e' o link do login */
if (bom.term) {
  const reg = bom.palco.ctx.termsVivos.get(bom.id);
  const saida = 'Opening browser to sign in…\r\nvisit: https://claude.com/cai/oauth/authorize?code=true&x=1\r\n';
  if (reg) { reg.term.write(saida); reg.viu(saida); }
  checa('o texto do login aparece na telinha', !!reg && bom.term.escrito.includes('Opening browser'));
  checa('o link do login vira botao "Abrir link"',
    bom.palco.el('.mono').textContent === 'https://claude.com/cai/oauth/authorize?code=true&x=1',
    bom.palco.el('.mono').textContent);
}

/* ---- a versao com o bug tem de falhar aqui, senao este teste nao prova nada ---- */
const fonteComBug = fonteAtual
  .replace(/ {2}fecharTerminalEmSilencio\(P\);\n\n {2}const modal =/, '  const modal =')
  .replace('  // o antigo ja saiu la em cima, antes deste nascer\n',
           '  fecharTerminalEmSilencio(P);\n  P._fecharTerm = fechar;\n');
checa('a versao com o bug foi montada de fato',
  !/fecharTerminalEmSilencio\(P\);\n\n {2}const modal =/.test(fonteComBug)
  && fonteComBug.includes('fecharTerminalEmSilencio(P);\n  P._fecharTerm = fechar;'));

const ruim = abrirTelinha(fonteComBug);
checa('com o bug, o xterm morria antes de rodar', !ruim.vivo);
checa('com o bug, o id sumia de termsVivos', !ruim.registrado);
checa('com o bug, a caixa perdia a classe cx-term', !ruim.ehTerm);

console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\ntudo certo');
process.exit(falhas ? 1 : 0);
