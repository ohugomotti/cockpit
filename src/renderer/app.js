/* ============ estado global ============ */
let cfg = {}, HOME = '';
let paneSeq = 0, focusPane = null;
// muda a cada abertura/recarga da tela: sem isso o 'p1' novo colidia com o
// 'p1' que o processo principal ainda tinha mapeado da sessao anterior
const bootId = Math.random().toString(36).slice(2, 7);
const panes = new Map();     // id -> objeto do painel

/* ============ abas locais (PC / VPS / outras pastas e servidores) ============
   Cada aba e' um "lugar" onde o Cockpit trabalha - uma pasta do PC ou um
   servidor remoto por SSH. Trocar de aba troca os paineis inteiros, igual
   trocar de aba no navegador: os desta aba somem (mas ficam guardados) e
   entram os da aba nova. */
function abasLocaisPadrao() {
  return [
    { id: 'pc', nome: 'PC inteiro', tipo: 'local', caminho: null, cor: '#6ea8fe', paineis: [] },
    // servidor em branco de proposito: endereco e chave sao SEUS, nao ficam no
    // codigo. Duplo clique na aba pra preencher host, usuario e caminho da chave.
    { id: 'vps', nome: 'VPS', tipo: 'ssh', host: '', usuario: '',
      chave: '', caminhoRemoto: '~', cor: '#5aa469', paineis: [] },
  ];
}
function abasLocais() { return Array.isArray(cfg.abas) ? cfg.abas : []; }
function abaPorId(id) { return abasLocais().find(a => a.id === id); }
function abaAtual() { return abaPorId(cfg.abaAtiva) || abasLocais()[0]; }
function remotoDoAba(aba) {
  if (!aba || aba.tipo !== 'ssh') return null;
  return { host: aba.host, usuario: aba.usuario, chave: aba.chave, caminhoRemoto: aba.caminhoRemoto || '~' };
}
function remotoDoPane(P) { return remotoDoAba(abaPorId(P.abaId)); }
/* pastas de uma aba local: aceita a lista nova (caminhos) e o campo antigo
   (caminho), pra nao quebrar aba criada antes desta versao */
function pastasDaAba(aba) {
  if (!aba || aba.tipo === 'ssh') return [];
  const lista = Array.isArray(aba.caminhos) ? aba.caminhos.slice() : [];
  if (!lista.length && aba.caminho) lista.push(aba.caminho);
  return lista.filter(Boolean);
}
function cwdPadraoDaAba(aba) {
  if (!aba) return cfg.defCwd || HOME;
  if (aba.tipo === 'ssh') return aba.caminhoRemoto || '~';
  return pastasDaAba(aba)[0] || cfg.defCwd || HOME;
}
function nomeCurtoDaAba(aba) {
  if (aba.tipo === 'ssh') return (aba.usuario || '') + '@' + (aba.host || '?');
  const ps = pastasDaAba(aba);
  if (!ps.length) return 'PC inteiro';
  return ps.length === 1 ? baseNome(ps[0]) : (baseNome(ps[0]) + ' +' + (ps.length - 1));
}

const $ = (s, r = document) => r.querySelector(s);
/* logos oficiais (simple-icons) */
const LOGO = {
  claude: 'M4.7144 15.9555l4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
  codex: 'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z',
};
const ICONES = {"hand": "<path d=\"M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2\" /> <path d=\"M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2\" /> <path d=\"M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8\" /> <path d=\"M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15\" />", "code-xml": "<path d=\"m18 16 4-4-4-4\" /> <path d=\"m6 8-4 4 4 4\" /> <path d=\"m14.5 4-5 16\" />", "clipboard-list": "<rect width=\"8\" height=\"4\" x=\"8\" y=\"2\" rx=\"1\" ry=\"1\" /> <path d=\"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2\" /> <path d=\"M12 11h4\" /> <path d=\"M12 16h4\" /> <path d=\"M8 11h.01\" /> <path d=\"M8 16h.01\" />", "zap": "<path d=\"M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z\" />", "unlock": "<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\" /> <path d=\"M7 11V7a5 5 0 0 1 9.9-1\" />", "upload": "<path d=\"M12 3v12\" /> <path d=\"m17 8-5-5-5 5\" /> <path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\" />", "image": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" ry=\"2\" /> <circle cx=\"9\" cy=\"9\" r=\"2\" /> <path d=\"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21\" />", "folder": "<path d=\"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z\" />", "map-pin": "<path d=\"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0\" /> <circle cx=\"12\" cy=\"10\" r=\"3\" />", "eraser": "<path d=\"M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21\" /> <path d=\"m5.082 11.09 8.828 8.828\" />", "sparkles": "<path d=\"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z\" /> <path d=\"M20 2v4\" /> <path d=\"M22 4h-4\" /> <circle cx=\"4\" cy=\"20\" r=\"2\" />", "brain": "<path d=\"M12 18V5\" /> <path d=\"M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4\" /> <path d=\"M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5\" /> <path d=\"M17.997 5.125a4 4 0 0 1 2.526 5.77\" /> <path d=\"M18 18a4 4 0 0 0 2-7.464\" /> <path d=\"M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517\" /> <path d=\"M6 18a4 4 0 0 1-2-7.464\" /> <path d=\"M6.003 5.125a4 4 0 0 0-2.526 5.77\" />", "sliders-horizontal": "<path d=\"M10 5H3\" /> <path d=\"M12 19H3\" /> <path d=\"M14 3v4\" /> <path d=\"M16 17v4\" /> <path d=\"M21 12h-9\" /> <path d=\"M21 19h-5\" /> <path d=\"M21 5h-7\" /> <path d=\"M8 10v4\" /> <path d=\"M8 12H3\" />", "lock": "<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\" /> <path d=\"M7 11V7a5 5 0 0 1 10 0v4\" />", "arrow-left-right": "<path d=\"M8 3 4 7l4 4\" /> <path d=\"M4 7h16\" /> <path d=\"m16 21 4-4-4-4\" /> <path d=\"M20 17H4\" />", "folder-open": "<path d=\"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2\" />", "plus": "<path d=\"M5 12h14\" /> <path d=\"M12 5v14\" />", "plug": "<path d=\"M12 22v-5\" /> <path d=\"M15 8V2\" /> <path d=\"M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z\" /> <path d=\"M9 8V2\" />", "key-round": "<path d=\"M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z\" /> <circle cx=\"16.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\" />", "log-out": "<path d=\"m16 17 5-5-5-5\" /> <path d=\"M21 12H9\" /> <path d=\"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4\" />", "user": "<path d=\"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2\" /> <circle cx=\"12\" cy=\"7\" r=\"4\" />", "file-code": "<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\" /> <path d=\"M14 2v5a1 1 0 0 0 1 1h5\" /> <path d=\"M10 12.5 8 15l2 2.5\" /> <path d=\"m14 12.5 2 2.5-2 2.5\" />", "file-text": "<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\" /> <path d=\"M14 2v5a1 1 0 0 0 1 1h5\" /> <path d=\"M10 9H8\" /> <path d=\"M16 13H8\" /> <path d=\"M16 17H8\" />", "braces": "<path d=\"M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1\" /> <path d=\"M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1\" />", "terminal": "<path d=\"M12 19h8\" /> <path d=\"m4 17 6-6-6-6\" />", "file": "<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\" /> <path d=\"M14 2v5a1 1 0 0 0 1 1h5\" />", "refresh-cw": "<path d=\"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8\" /> <path d=\"M21 3v5h-5\" /> <path d=\"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16\" /> <path d=\"M8 16H3v5\" />", "circle-help": "<circle cx=\"12\" cy=\"12\" r=\"10\" /> <path d=\"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3\" /> <path d=\"M12 17h.01\" />", "x": "<path d=\"M18 6 6 18\" /> <path d=\"m6 6 12 12\" />", "check": "<path d=\"M20 6 9 17l-5-5\" />", "panel-left": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" /> <path d=\"M9 3v18\" />", "chevron-right": "<path d=\"m9 18 6-6-6-6\" />", "chevron-down": "<path d=\"m6 9 6 6 6-6\" />", "arrow-up": "<path d=\"m5 12 7-7 7 7\" /> <path d=\"M12 19V5\" />", "square": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" />", "rotate-cw": "<path d=\"M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8\" /> <path d=\"M21 3v5h-5\" />", "circle": "<circle cx=\"12\" cy=\"12\" r=\"10\" />", "minus": "<path d=\"M5 12h14\" />", "pencil": "<path d=\"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z\" /> <path d=\"m15 5 4 4\" />", "search": "<path d=\"m21 21-4.34-4.34\" /> <circle cx=\"11\" cy=\"11\" r=\"8\" />", "star": "<path d=\"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z\" />", "mic": "<path d=\"M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z\" /> <path d=\"M19 10v2a7 7 0 0 1-14 0v-2\" /> <line x1=\"12\" x2=\"12\" y1=\"19\" y2=\"22\" />", "server": "<rect width=\"20\" height=\"8\" x=\"2\" y=\"2\" rx=\"2\" ry=\"2\" /> <rect width=\"20\" height=\"8\" x=\"2\" y=\"14\" rx=\"2\" ry=\"2\" /> <line x1=\"6\" x2=\"6.01\" y1=\"6\" y2=\"6\" /> <line x1=\"6\" x2=\"6.01\" y1=\"18\" y2=\"18\" />"};
const ico = (n) => '<svg viewBox="0 0 24 24" class="ic" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + (ICONES[n] || '') + '</svg>';
const svgMotor = (eng) => '<svg viewBox="0 0 24 24" class="logo-motor"><path d="' + LOGO[eng === 'codex' ? 'codex' : 'claude'] + '"/></svg>';
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
/* este computador: o app nasceu so para Mac, entao tudo que fala de caminho
   ou do proprio sistema passa por aqui em vez de assumir "/" e "Mac". */
const EH_WIN = (window.api && window.api.plataforma)
  ? window.api.plataforma === 'win32' : /Windows/i.test(navigator.userAgent);
const ESTE_PC = EH_WIN ? 'PC' : 'Mac';
const baseNome = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(p || '');
marked.setOptions({ breaks: true, gfm: true });
/* markdown vem do modelo e de arquivos de conversa - nao e' fonte confiavel.
   A CSP ja bloqueia script, mas HTML+CSS cru ainda permitiria desenhar um
   botao falso por cima da barra de aprovacao. */
function mdSeguro(txt) {
  const bruto = marked.parse(String(txt == null ? '' : txt));
  try {
    return DOMPurify.sanitize(bruto, {
      // permite tambem link relativo e ancora (./src/x.js, #secao) - o que
      // nao pode e' javascript:, file: e afins
      ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|[.\/#][^:]*$)/i,
      FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed', 'base', 'meta', 'link'],
      FORBID_ATTR: ['style', 'srcset', 'formaction', 'action', 'target', 'ping'],
    });
  } catch {
    // cair pra HTML cru era o contrario do proposito desta funcao: sem o
    // DOMPurify, texto puro. Nunca marcacao vinda do modelo.
    const d = document.createElement('div');
    d.textContent = String(txt == null ? '' : txt);
    return d.innerHTML;
  }
}

const EF_PT = { minimal: 'Mínimo', low: 'Leve', medium: 'Médio', high: 'Alto',
  xhigh: 'Extra alto', max: 'Máximo', ultra: 'Ultra' };
const EF_DESC_PT = {
  minimal: 'O mais rápido, pensa quase nada',
  low: 'Resposta rápida, raciocínio leve',
  medium: 'Equilibra velocidade e profundidade',
  high: 'Pensa mais fundo em problemas difíceis',
  xhigh: 'Raciocínio bem mais profundo',
  max: 'Profundidade máxima para o mais difícil',
  ultra: 'Consome a cota de uso mais rápido',
};

const MODELOS_CLAUDE = [
  { id: 'claude-opus-5[1m]', nome: 'Opus 5 (1M)', desc: 'O mais forte, com memória gigante',
    efforts: ['low','medium','high','xhigh','max'], padraoEffort: 'high', padrao: true },
  { id: 'claude-opus-5', nome: 'Opus 5', desc: 'O mais forte',
    efforts: ['low','medium','high','xhigh','max'], padraoEffort: 'high' },
  { id: 'claude-fable-5', nome: 'Fable 5', desc: 'Da família Claude 5',
    efforts: ['low','medium','high','xhigh','max'], padraoEffort: 'medium' },
  { id: 'claude-sonnet-5', nome: 'Sonnet 5', desc: 'Rápido e bom para o dia a dia',
    efforts: ['low','medium','high','xhigh','max'], padraoEffort: 'medium' },
  { id: 'claude-haiku-4-5-20251001', nome: 'Haiku 4.5', desc: 'O mais barato e veloz',
    efforts: ['low','medium','high'], padraoEffort: 'medium' },
];
let MODELOS_CODEX = null;   // vem do proprio Codex

function modelosDe(P) {
  if (P.engine === 'claude') return MODELOS_CLAUDE;
  return MODELOS_CODEX || [{ id: '', nome: 'padrão do Codex', desc: 'o que está no seu config', efforts: ['low','medium','high','xhigh'], padraoEffort: 'medium' }];
}
function modeloAtual(P) {
  const ms = modelosDe(P);
  return ms.find(m => m.id === P.model) || ms.find(m => m.padrao) || ms[0];
}
function esforcosDe(P) {
  const m = modeloAtual(P);
  const e = (m.efforts || []).map(x => (typeof x === 'string' ? { id: x, desc: EF_DESC_PT[x] || '' } : { id: x.id, desc: EF_DESC_PT[x.id] || x.desc || '' }));
  return e.length ? e : [{ id: 'medium', desc: '' }];
}

const TOOL_PT = {
  Read: 'Lendo arquivo', Write: 'Criando arquivo', Edit: 'Editando arquivo', Bash: 'Terminal',
  Glob: 'Procurando arquivos', Grep: 'Buscando no código', WebSearch: 'Pesquisando na web',
  WebFetch: 'Abrindo link', Task: 'Agente', TodoWrite: 'Lista de tarefas', Skill: 'Skill',
  NotebookEdit: 'Editando notebook', BashOutput: 'Saída do terminal',
};
function toolLabel(n) {
  if (TOOL_PT[n]) return TOOL_PT[n];
  if (n && n.startsWith('mcp__')) { const p = n.split('__'); return p[1] + (p[2] ? ' · ' + p[2] : ''); }
  return n || 'Ferramenta';
}
const shortPath = (p) => !p ? '' : (p === HOME ? ESTE_PC + ' inteiro' : (EH_WIN ? String(p) : String(p).replace(HOME, '~')));
const nomePasta = (p) => {
  if (!p) return 'Pasta';
  if (p === HOME) return 'Pasta: ' + ESTE_PC + ' inteiro';
  return 'Pasta: ' + baseNome(p);
};

/* ============ painel ============ */
function piscar(P) {
  P.el.classList.remove('piscando');
  void P.el.offsetWidth;              // reinicia a animacao se clicar de novo
  P.el.classList.add('piscando');
  setTimeout(() => P.el.classList.remove('piscando'), 900);
}

function sairDaAbertura() {
  const bv = $('#boasvindas');
  if (bv) { bv.remove(); $('#panes').style.display = ''; }
}

function newPane(opts = {}) {
  sairDaAbertura();
  const id = 'p' + bootId + '_' + (++paneSeq);
  const el = $('#tplPane').content.firstElementChild.cloneNode(true);
  el.dataset.id = id;

  const abaId = opts.abaId || cfg.abaAtiva;
  const aba = abaPorId(abaId);
  const P = {
    id, el, abaId,
    engine: opts.engine || cfg.lastEngine || 'codex',
    cwd: opts.cwd || cwdPadraoDaAba(aba),
    model: opts.model || '',
    started: false, busy: false, queued: null, hist: [], passarContexto: null,
    titulo: opts.titulo || '', sessaoId: null, sessaoFile: '', anexos: [],
    envio: cfg.envioPadrao || 'fila',
    mode: opts.mode || cfg.defMode || 'bypass', effort: opts.effort || cfg.defEffort || 'high',
    blocks: new Map(), tools: new Map(),
    chat: $('.pane-chat', el),
  };
  panes.set(id, P);

  // interruptor Claude / Codex
  $$('.ch-lado', el).forEach(bt => {
    $('span', bt).innerHTML = svgMotor(bt.dataset.motor);
    bt.addEventListener('click', () => trocarMotor(P, bt.dataset.motor));
  });
  try { P.ro = new ResizeObserver(() => posicionarChave(P)); P.ro.observe($('.p-chave', el)); } catch {}

  // modelo
  $('.p-model', el).addEventListener('click', (e) => { e.stopPropagation(); menuModelos(P); });

  // pasta (so' faz sentido numa aba local; numa aba remota a pasta e' a da aba)
  const btnCwd = $('.p-cwd', el);
  const trocarCwdDoPainel = async (p) => {
    if (!p) return;
    P.cwd = p; btnCwd.textContent = nomePasta(p);
    await window.api.paneStop({ paneId: id, engine: P.engine });
    destravarPainel(P);
    // pasta nova = conversa nova: com o resumeId antigo o Claude procurava a
    // sessao na pasta errada, nao achava, e o painel caia em looping
    P.resumeId = null; P.sessaoId = null; P.sessaoFile = '';
    P.started = false; setDot(P, 'off');
    if (focusPane === P) { loadTree(P.cwd); $('#tbTitle').textContent = shortPath(P.cwd) + '  ·  ' + (P.engine === 'codex' ? 'Codex' : 'Claude'); }
    note(P, 'Pasta: ' + shortPath(p)); savePanes(); atualizarGit(P);
  };
  btnCwd.addEventListener('click', async (ev) => {
    const abaAgora = abaPorId(P.abaId);
    if (abaAgora && abaAgora.tipo === 'ssh') { note(P, 'Pasta fixa desta aba remota. Pra mudar, edite a aba "' + abaAgora.nome + '".'); return; }
    const pastas = pastasDaAba(abaAgora);
    if (pastas.length > 1) {
      // aba com mais de uma pasta: escolhe entre elas, sem abrir o Explorer
      ev.stopPropagation();
      const pop = abrirPopGlobal(btnCwd);
      const item = (texto, sub, on, aoClicar) => {
        const d = document.createElement('div');
        d.className = 'mi' + (on ? ' on' : '');
        d.innerHTML = '<div class="mi-ic"></div><div class="mi-txt"><div class="mi-n"></div></div>' + (on ? '<div class="mi-ck">' + ico('check') + '</div>' : '');
        $('.mi-ic', d).innerHTML = ico('folder');
        $('.mi-n', d).textContent = texto;
        if (sub) { const e2 = document.createElement('div'); e2.className = 'mi-d'; e2.textContent = sub; $('.mi-txt', d).appendChild(e2); }
        d.addEventListener('click', () => { fecharPopGlobal(); aoClicar(); });
        return d;
      };
      for (const p of pastas) pop.appendChild(item(baseNome(p), shortPath(p), mesmaPasta(P.cwd, p), () => trocarCwdDoPainel(p)));
      pop.appendChild(Object.assign(document.createElement('div'), { className: 'menu-linha' }));
      pop.appendChild(item('Escolher outra pasta…', '', false, async () => trocarCwdDoPainel(await window.api.pickFolder(P.cwd))));
      return;
    }
    trocarCwdDoPainel(await window.api.pickFolder(P.cwd));
  });

  $('.p-close', el).addEventListener('click', () => closePane(id));

  $('.pn-edit', el).innerHTML = ico('pencil');
  $('.pn-edit', el).addEventListener('click', () => renomearAqui(P));
  $('.pn-txt', el).addEventListener('dblclick', () => renomearAqui(P));

  // input
  const inp = $('.p-input', el);
  const grow = () => { inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 190) + 'px'; };
  inp.addEventListener('input', grow);
  let timerRascunho = 0;
  inp.addEventListener('input', () => {
    clearTimeout(timerRascunho);
    timerRascunho = setTimeout(savePanes, 900);   // guarda o rascunho, sem gravar a cada tecla
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(P); }
    if (e.key === 'Escape') { fecharMenus(); fecharTerminalDoPainel(P); fecharModal(P); if (P.busy) window.api.paneInterrupt({ paneId: id, engine: P.engine }); }
    // seta pra cima com o campo vazio (ou navegando) traz o que voce ja mandou
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const lista = historicoPrompts();
      if (!lista.length) return;
      const naPrimeiraLinha = inp.selectionStart === 0 && inp.selectionEnd === 0;
      const vazio = !inp.value.trim();
      // depois de trazer um prompt o cursor vai pro FIM, entao 'naPrimeiraLinha'
      // virava false e o proximo Up era barrado: dava pra ver so' o ultimo prompt
      if (e.key === 'ArrowUp' && !(vazio || naPrimeiraLinha || P.navHist !== undefined)) return;
      if (e.key === 'ArrowDown' && P.navHist === undefined) return;
      e.preventDefault();
      if (P.navHist === undefined) { P.rascunhoAntes = inp.value; P.navHist = lista.length; }
      P.navHist += (e.key === 'ArrowUp' ? -1 : 1);
      if (P.navHist < 0) P.navHist = 0;
      if (P.navHist >= lista.length) { P.navHist = undefined; inp.value = P.rascunhoAntes || ''; }
      else inp.value = lista[P.navHist];
      grow();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Dead' || e.key === 'Process'
               || (e.key.length === 1 && !e.ctrlKey && !e.metaKey)) {
      // so' sai do modo historico ao MEXER no texto: antes Home/End/setas
      // laterais ja descartavam o rascunho guardado
      P.navHist = undefined;
    }
  });
  // "@" em qualquer lugar da linha: completa caminho de arquivo da pasta do painel
  inp.addEventListener('input', () => {
    const v = inp.value;
    const cursor = inp.selectionStart || v.length;
    const antes = v.slice(0, cursor);
    const mm = /@([^\s@]*)$/.exec(antes);
    if (mm) menuArquivos(P, mm[1], mm.index);
    else if ($('.p-modal .menu-arquivos', el)) fecharMenus();
  });
  // barra no comeco da linha abre o menu de acoes, e vai filtrando conforme digita
  inp.addEventListener('input', () => {
    const v = inp.value;
    if (v.startsWith('/') && !v.includes(' ')) {
      const busca = $('.p-modal .menu-search', el);
      if (busca) { busca.value = v.slice(1); busca.dispatchEvent(new Event('input')); }
      else { const t = v.slice(1); inp.value = ''; inp.style.height = 'auto'; menuSkills(P, t, true); }
    }
  });
  inp.addEventListener('focus', () => setFocus(P));
  el.addEventListener('mousedown', () => setFocus(P));
  // colar: imagem da area de transferencia ou arquivo copiado no Finder/Explorer
  const colar = async (e) => {
    const dt = e.clipboardData;
    const temTexto = dt && [...(dt.items || [])].some(i => i.kind === 'string' && i.type === 'text/plain');
    const temArquivoNoEvento = dt && [...(dt.files || [])].length > 0;
    if (temArquivoNoEvento) {
      const fs2 = [...dt.files].map(f => f.path).filter(Boolean);
      if (fs2.length) { e.preventDefault(); setFocus(P); await anexar(P, fs2); return; }
    }
    const r = await window.api.colados();
    if (r && r.arquivos && r.arquivos.length) {
      e.preventDefault(); setFocus(P); await anexar(P, r.arquivos); return;
    }
    if (!temTexto) e.preventDefault();
  };
  el.addEventListener('paste', colar);   // um so: o evento do campo sobe ate aqui

  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('soltando'); });
  el.addEventListener('dragleave', () => el.classList.remove('soltando'));
  el.addEventListener('drop', async (e) => {
    e.preventDefault(); el.classList.remove('soltando');
    const fs = [...(e.dataTransfer.files || [])].map(f => f.path).filter(Boolean);
    if (fs.length) { setFocus(P); await anexar(P, fs); }
  });

  $('.p-send', el).addEventListener('click', () => send(P));
  $('.p-stop', el).addEventListener('click', () => window.api.paneInterrupt({ paneId: id, engine: P.engine }));

  // botao do modo (abre o menu de Modos)
  $('.p-modo', el).addEventListener('click', (e) => { e.stopPropagation(); menuModos(P); });

  $('.p-compactar', el).addEventListener('click', async (e) => {
    e.stopPropagation();
    if (P.busy) { avisoEnvio(P, 'Espere ele terminar para resumir a conversa.'); return; }
    const bt = $('.p-compactar', el);
    bt.classList.add('rodando');
    P.busy = true; setDot(P, 'busy'); trabalhando(P, 'resumindo a conversa');
    const r = await window.api.paneCompactar({ paneId: P.id, engine: P.engine });
    if (r && r.error) {
      P.busy = false; setDot(P, 'idle'); pararTrabalho(P);
      bt.classList.remove('rodando');
      avisoEnvio(P, 'Não deu para resumir: ' + r.error);
    }
  });

  const btEnvio = $('.p-modoenvio', el);
  const pintarEnvio = () => {
    const entra = P.envio === 'entra';
    btEnvio.innerHTML = ico(entra ? 'zap' : 'clipboard-list') + '<span>' + (entra ? 'Entra' : 'Fila') + '</span>';
    btEnvio.title = entra
      ? 'Se ele estiver trabalhando, sua mensagem entra no que está sendo feito agora'
      : 'Se ele estiver trabalhando, sua mensagem espera terminar para começar';
  };
  P.pintarEnvio = pintarEnvio;
  pintarEnvio();
  btEnvio.addEventListener('click', (e) => {
    e.stopPropagation();
    P.envio = P.envio === 'entra' ? 'fila' : 'entra';
    cfg.envioPadrao = P.envio; window.api.setConfig(cfg);
    pintarEnvio();
  });

  // microfone: grava, transcreve aqui no PC e joga o texto no campo
  const btMic = $('.p-mic', el);
  btMic.innerHTML = ico('mic');
  let gravador = null, pedacos = [], trilha = null;
  const pararGravacao = () => {
    clearTimeout(P._micLimite);
    try { gravador && gravador.state !== 'inactive' && gravador.stop(); } catch {}
    try { trilha && trilha.getTracks().forEach((t) => t.stop()); } catch {}   // desliga o microfone de verdade
    trilha = null;
    btMic.classList.remove('gravando');
  };
  // só depois de existir: fechar o painel precisa desligar o microfone
  P.pararGravacao = pararGravacao;
  btMic.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (gravador && gravador.state === 'recording') { pararGravacao(); return; }
    const disp = await window.api.audioDisponivel();
    if (!disp || !disp.ok) {
      mostrarAviso({ texto: 'A transcrição de áudio ainda não está instalada nesta máquina.', tipo: 'alerta' });
      return;
    }
    try { trilha = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { mostrarAviso({ texto: 'Não consegui usar o microfone. Verifique a permissão do Windows.', tipo: 'erro' }); return; }
    pedacos = [];
    window.api.audioAquecer();   // ja vai carregando o modelo enquanto voce fala
    gravador = new MediaRecorder(trilha);
    gravador.ondataavailable = (ev) => { if (ev.data && ev.data.size) pedacos.push(ev.data); };
    gravador.onstop = async () => {
      btMic.classList.remove('gravando');
      if (P.morto) return;   // painel fechou: nao gasta CPU transcrevendo pro vazio
      btMic.classList.add('pensando');
      try {
        const blob = new Blob(pedacos, { type: gravador.mimeType || 'audio/webm' });
        if (blob.size < 1200) { mostrarAviso({ texto: 'Gravação muito curta.', tipo: 'alerta' }); return; }
        // Uint8Array atravessa o IPC direto; Array.from inflava cada byte num
        // numero e travava o app em gravacao longa
        const buf = new Uint8Array(await blob.arrayBuffer());
        const r = await window.api.audioTranscrever({ bytes: buf, mime: blob.type });
        if (r && r.error) { mostrarAviso({ texto: r.error, tipo: 'erro' }); return; }
        if (P.morto) return;   // fechou enquanto transcrevia
      const inp2 = $('.p-input', el);
      if (!inp2) return;
        const texto = (r && r.texto) || '';
        inp2.value = inp2.value ? (inp2.value.replace(/\s*$/, '') + ' ' + texto) : texto;
        inp2.focus();
        inp2.style.height = 'auto'; inp2.style.height = Math.min(inp2.scrollHeight, 190) + 'px';
      } finally {
        btMic.classList.remove('pensando');
      }
    };
    gravador.start();
    btMic.classList.add('gravando');
    btMic.title = 'Gravando… clique para parar e transcrever';
    // corta sozinho em 5 min: gravacao esquecida viraria um arquivo enorme
    clearTimeout(P._micLimite);
    P._micLimite = setTimeout(() => {
      if (gravador && gravador.state === 'recording') {
        pararGravacao();
        mostrarAviso({ texto: 'Gravação encerrada em 5 minutos (limite).', tipo: 'alerta' });
      }
    }, 5 * 60 * 1000);
  });

  // botao +  (anexar)
  $('.p-plus', el).addEventListener('click', (e) => { e.stopPropagation(); menuAnexo(P); });
  // botao /  (comandos)
  $('.p-slash', el).addEventListener('click', (e) => { e.stopPropagation(); menuSkills(P); });

  btnCwd.textContent = (aba && aba.tipo === 'ssh') ? ('🖧 ' + aba.nome) : nomePasta(P.cwd);
  fillModels(P); paintEngine(P); pintarModo(P);

  if (panes.size > 1) $('#panes').appendChild(makeSplitter());
  $('#panes').appendChild(el);
  setFocus(P);
  inp.focus();
  setTimeout(() => el.scrollIntoView({ behavior: 'smooth', inline: 'end', block: 'nearest' }), 60);
  setTimeout(savePanes, 30);
  return P;
}

function makeSplitter() {
  const s = document.createElement('div');
  s.className = 'pane-split';
  s.title = 'Arraste para ajustar · clique duas vezes para deixar todos do mesmo tamanho';
  s.addEventListener('dblclick', (e) => {
    e.preventDefault(); e.stopPropagation();
    for (const q of panes.values()) q.el.style.flex = '';
    savePanes();
  });
  s.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const prev = s.previousElementSibling, next = s.nextElementSibling;
    if (!prev || !next) return;
    const startX = e.clientX, w1 = prev.getBoundingClientRect().width, w2 = next.getBoundingClientRect().width;
    const move = (ev) => {
      const d = ev.clientX - startX;
      const a = Math.max(280, w1 + d), b = Math.max(280, w2 - d);
      prev.style.flex = '0 0 ' + a + 'px'; next.style.flex = '0 0 ' + b + 'px';
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.style.cursor = ''; savePanes(); };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  });
  return s;
}

/* o que voce ja mandou, pra trazer de volta com a seta pra cima */
function historicoPrompts() { return Array.isArray(cfg.prompts) ? cfg.prompts : []; }
function guardarPrompt(txt) {
  const t = String(txt || '').trim();
  if (!t) return;
  if (!Array.isArray(cfg.prompts)) cfg.prompts = [];
  const i = cfg.prompts.indexOf(t);
  if (i >= 0) cfg.prompts.splice(i, 1);   // repetido sobe pro fim em vez de duplicar
  cfg.prompts.push(t);
  while (cfg.prompts.length > 50) cfg.prompts.shift();
  window.api.setConfig(cfg);
}

/* Um painel rodando em segundo plano tambem chama savePanes (quando a sessao
   dele nasce, por exemplo). Sem separar por aba, ele gravava o painel de outra
   aba dentro da aba ATUAL - e as duas abas ficavam erradas. */
function fichaDoPainel(P) {
  // paneId: sem um id estavel na ficha nao da' pra saber QUAL painel da lista
  // salva corresponde a este - e a mesclagem virava sobrescrita
  return ({ paneId: P.id, engine: P.engine, cwd: P.cwd, model: P.model, mode: P.mode, effort: P.effort, titulo: P.titulo,
    sessaoId: P.sessaoId || P.resumeId || null, file: P.sessaoFile || '', remoto: !!(P.sessaoRemota || remotoDoPane(P)),
    rascunho: (($('.p-input', P.el) || {}).value || '').slice(0, 4000),
    // conversa que trocou de motor e ainda nao mandou a 1a mensagem: sem guardar
    // isto, trocar de aba no meio jogava fora tudo que ja tinha sido dito
    contexto: (P.passarContexto || '').slice(0, 20000) });
}

function savePanes() {
  const ab = abaAtual();
  const daAba = [...panes.values()].map(fichaDoPainel);
  if (ab) ab.paineis = daAba; else cfg.panes = daAba;   // sem aba (versao antiga) ainda funciona
  // os que continuam rodando fora da tela ATUALIZAM a ficha deles na aba de
  // origem. MESCLAR, nunca substituir: trocando a lista inteira, os painéis
  // parados daquela aba (que nao estao no segundo plano) sumiam do config.
  const porAba = {};
  for (const P of panesFundo.values()) (porAba[P.abaId] = porAba[P.abaId] || []).push(fichaDoPainel(P));
  for (const id of Object.keys(porAba)) {
    const outra = abaPorId(id);
    if (!outra || (ab && outra.id === ab.id)) continue;
    // chave com reserva: config gravado por versao antiga nao tem paneId, e sem
    // isso a ficha nova entrava como uma SEGUNDA linha da mesma conversa
    const chave = (f) => (f && (f.paneId || (f.sessaoId && 's:' + f.sessaoId))) || null;
    const antigas = Array.isArray(outra.paineis) ? outra.paineis : [];
    const novas = new Map(porAba[id].map(f => [chave(f), f]));
    const juntas = antigas.map(f => novas.get(chave(f)) || f);
    for (const [k, f] of novas) if (k && !antigas.some(a => chave(a) === k)) juntas.push(f);
    outra.paineis = juntas;
  }
  window.api.setConfig(cfg);
  pintarAbasLocal();
}

/* pedido de permissao de um motor que ja parou: o cartao continuava na tela e
   clicar "Permitir" respondia pra um processo que nao existe mais */
function esconderPermissao(P) {
  if (!P || !P.el) return;
  if (P.filaPerm) P.filaPerm.length = 0;   // os pedidos morreram junto com o motor
  P.pedindoPerm = false;
  const bar = $('.pane-perm', P.el);
  if (!bar) return;
  const d = $('.diff', bar); if (d) d.remove();
  bar.classList.add('hidden');
}
/* Painéis de OUTRAS abas que continuam rodando. Trocar de aba matava o
   processo do Claude no meio do trabalho - o turno era abortado de verdade,
   não era só a animação sumindo. Quem está trabalhando agora fica aqui, com o
   elemento fora da tela mas com o processo vivo e os eventos chegando. */
const panesFundo = new Map();
const acharPainel = (id) => panes.get(id) || panesFundo.get(id);
/* o teto de 12 e' de MOTORES vivos, nao de caixas na tela: sem contar os de
   segundo plano dava pra passar do limite sem perceber */
const totalDePaineis = () => panes.size + panesFundo.size;
/* quantos painéis estão trabalhando em cada aba (pra bolinha na barra de abas) */
function trabalhandoPorAba() {
  const conta = {};
  for (const P of [...panes.values(), ...panesFundo.values()]) {
    if (P.busy) conta[P.abaId] = (conta[P.abaId] || 0) + 1;
  }
  return conta;
}
/* aba com painel PARADO esperando voce autorizar - e' outra coisa de
   "trabalhando", e precisa chamar mais atencao, nao menos */
function esperandoPorAba() {
  const conta = {};
  for (const P of panesFundo.values()) if (P.pedindoPerm) conta[P.abaId] = (conta[P.abaId] || 0) + 1;
  return conta;
}

/* qualquer troca que reinicia o motor precisa destravar o painel: antes,
   trocar de modelo no meio de uma resposta deixava "trabalhando…" eterno e
   toda mensagem nova ficava presa na fila */
function destravarPainel(P) {
  esconderPermissao(P);
  if (!P.busy && !P.queued) return;
  const presa = P.queued;
  P.busy = false; P.queued = null; pintarFila(P);
  setDot(P, 'off'); pararTrabalho(P); limparPassos(P);
  // devolve a mensagem que estava na fila em vez de engolir ela
  if (presa) {
    const inp = $('.p-input', P.el);
    if (inp && !inp.value.trim()) {
      inp.value = presa;
      inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 190) + 'px';
      note(P, 'Sua mensagem voltou pro campo de escrever: o painel reiniciou antes de enviar.');
    }
  }
}

async function trocarMotor(P, novo) {
  if (novo === P.engine) return;
  // clicar duas vezes rapido fazia duas trocas se atropelarem no meio
  if (P._trocando) return;
  // o Codex so' roda local: numa aba de servidor ele executaria no PC do Hugo
  // enquanto a tela diz que esta no servidor
  if (novo === 'codex' && remotoDoPane(P)) {
    note(P, 'O Codex ainda não roda em servidor remoto. Nesta aba, use o Claude.', true);
    return;
  }
  P._trocando = true;
  try {
    const antigo = P.engine === 'codex' ? 'Codex' : 'Claude';
    // monta o contexto ANTES de mexer no estado do painel
    const contexto = P.hist.length ? montarContexto(P) : null;
    await window.api.paneStop({ paneId: P.id, engine: P.engine });
    if (P.morto) return;
    // o motor morre de proposito, entao 'engine-down' NAO chega pra destravar:
    // sem isto, trocar de motor no meio de uma resposta deixava "trabalhando…"
    // pra sempre e toda mensagem nova caia na fila em vez de ser enviada
    destravarPainel(P);
    P.engine = novo; P.started = false; P.model = ''; P.resumeId = null;
    // a sessao pertence ao motor antigo: guardar o id fazia o motor novo tentar
    // retomar uma conversa que nao existe pra ele (--resume com id do outro)
    P.sessaoId = null; P.sessaoFile = ''; P.sessaoRemota = false;
    // contador de contexto e' do outro motor: continuar mostrando mente
    P.tokens = 0; P.janela = 0; pintarTokens(P);
    P.blocks.clear();
    cfg.lastEngine = novo; window.api.setConfig(cfg);
    fillModels(P); paintEngine(P); pintarModo(P); setDot(P, 'off');
    // a conversa continua: o motor novo recebe o que já foi dito
    P.passarContexto = contexto;
    savePanes();   // depois de definir o contexto, senao ele nao era guardado
    marcaTroca(P, antigo, novo === 'codex' ? 'Codex' : 'Claude');
  } finally { P._trocando = false; }
}

function montarContexto(P) {
  const LIM = 14000;
  const linhas = [];
  for (let i = P.hist.length - 1; i >= 0; i--) {
    const h = P.hist[i];
    const t = '### ' + h.quem + ':\n' + (h.texto || '').trim();
    if (linhas.join('\n\n').length + t.length > LIM) break;
    linhas.unshift(t);
  }
  return 'Estou continuando uma conversa que vinha sendo tocada por outro assistente, no mesmo computador '
    + 'e na mesma pasta. Abaixo está o que já foi conversado. Assuma o trabalho daqui em diante, '
    + 'sem recomeçar do zero e sem repetir o que já foi feito.\n\n'
    + '--- conversa até aqui ---\n' + linhas.join('\n\n') + '\n--- fim da conversa anterior ---\n\n'
    + 'Agora, o novo pedido:\n';
}

function marcaTroca(P, de, para) {
  clearEmpty(P);
  const d = document.createElement('div');
  d.className = 'troca';
  d.innerHTML = '<span></span>';
  $('span', d).textContent = 'daqui em diante quem responde é o ' + para + ' (antes era o ' + de + ')';
  P.chat.appendChild(d); scroll(P, true);
}

function fillModels(P) {
  const ms = modelosDe(P);
  if (!ms.find(m => m.id === P.model)) P.model = (ms.find(m => m.padrao) || ms[0]).id;
  const ef = esforcosDe(P);
  if (!ef.find(e => e.id === P.effort)) P.effort = modeloAtual(P).padraoEffort || ef[Math.min(2, ef.length - 1)].id;
  $('.p-model', P.el).innerHTML = ico('brain') + '<span>' + modeloAtual(P).nome + '</span>';
}
function posicionarChave() {}   // o destaque do lado ativo é só CSS

function paintEngine(P) {
  const vazio = $('.pe-logo', P.el);
  if (vazio) vazio.innerHTML = svgMotor(P.engine);
  posicionarChave(P);
  P.el.classList.toggle('eng-codex', P.engine === 'codex');
  P.el.classList.toggle('eng-claude', P.engine === 'claude');
}
function setFocus(P) {
  if (focusPane === P) return;
  focusPane = P;
  for (const q of panes.values()) q.el.classList.toggle('focus', q === P);
  P.el.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  const remoto = remotoDoPane(P);
  if (remoto) {
    treeGen++;   // cancela qualquer carregamento local em andamento
    $('#tree').innerHTML = '<div class="hint" style="padding:10px 14px">Árvore de arquivos ainda não funciona em servidor remoto — use o terminal (menu /) pra navegar.</div>';
    $('#projName').textContent = '🖧 ' + remoto.usuario + '@' + remoto.host;
    $('#tbTitle').textContent = remoto.usuario + '@' + remoto.host + ':' + (P.cwd || remoto.caminhoRemoto) + '  ·  ' + (P.engine === 'codex' ? 'Codex' : 'Claude');
    return;
  }
  loadTree(P.cwd);
  atualizarGit(P);
  $('#tbTitle').textContent = shortPath(P.cwd) + '  ·  ' + (P.engine === 'codex' ? 'Codex' : 'Claude');
  $('#projName').textContent = P.cwd === HOME ? 'Pasta: ' + ESTE_PC + ' inteiro' : ('Pasta: ' + baseNome(P.cwd));
}
function matarTerminaisDoPainel(P) {
  if (!P || !P.terms) return;
  for (const tid of [...P.terms]) {
    try { window.api.termKill({ id: tid }); } catch {}
    const t = termsVivos.get(tid);
    if (t) { try { t.term.dispose(); } catch {} termsVivos.delete(tid); }
  }
  P.terms.clear();
}

async function closePane(id) {
  const P = panes.get(id); if (!P) return;
  if (panes.size === 1) { note(P, 'Este é o último painel.'); return; }
  if (P.ro) { try { P.ro.disconnect(); } catch {} }
  clearInterval(P.relogio); P.relogio = 0;
  soltarNavArquivos(P);
  P.morto = true;
  if (P.pararGravacao) { try { P.pararGravacao(); } catch {} }
  const tj = $('#avisoPaineis');
  if (tj && tj._itens) { tj._itens.delete(id); }
  matarTerminaisDoPainel(P);
  await window.api.paneStop({ paneId: id, engine: P.engine });
  const sp = P.el.previousElementSibling || P.el.nextElementSibling;
  if (sp && sp.classList.contains('pane-split')) sp.remove();
  P.el.remove(); panes.delete(id);
  for (const q of panes.values()) q.el.style.flex = '';
  if (focusPane === P) setFocus([...panes.values()][0]);
  savePanes();
}
/* Sair da aba. Quem está TRABALHANDO (ou com terminal aberto) continua vivo em
   segundo plano; quem está parado é desligado como antes — nesse caso não custa
   nada, porque a conversa volta sozinha com --resume na próxima mensagem. */
async function guardarPaineisDaAba() {
  for (const P of panes.values()) {
    const segueVivo = !!(P.busy || (P.terms && P.terms.size));
    if (P.ro) { try { P.ro.disconnect(); } catch {} P.ro = null; }
    soltarNavArquivos(P);

    if (segueVivo) {
      // tira da tela SEM matar nada: o processo continua, o terminal continua e
      // os eventos continuam chegando (o onPaneEvent acha pelo panesFundo).
      // O innerHTML='' la embaixo limpa os divisores que sobrarem.
      P.el.remove();
      panesFundo.set(P.id, P);
      continue;
    }
    fecharTerminalDoPainel(P);

    clearInterval(P.relogio); P.relogio = 0;
    P.morto = true;
    if (P.pararGravacao) { try { P.pararGravacao(); } catch {} }
    matarTerminaisDoPainel(P);
    await window.api.paneStop({ paneId: P.id, engine: P.engine });
  }
  $('#panes').innerHTML = '';
  panes.clear();
  focusPane = null;
}

/* A tela tem que respeitar a ordem salva da aba. Quem voltou vivo era sempre
   colocado ANTES dos recriados, e o savePanes seguinte gravava essa ordem
   trocada - o embaralhamento virava permanente. */
function reordenarPaineis(fichasSalvas) {
  const caixa = $('#panes');
  const fichas = Array.isArray(fichasSalvas) ? fichasSalvas : [];
  const sobrando = new Map([...panes.values()].map(P => [P.id, P]));
  const ordem = [];
  for (const f of fichas) {
    if (!f) continue;
    let P = f.paneId ? sobrando.get(f.paneId) : null;
    if (!P && f.sessaoId) P = [...sobrando.values()].find(q => (q.sessaoId || q.resumeId) === f.sessaoId);
    if (P) { ordem.push(P); sobrando.delete(P.id); }
  }
  for (const P of sobrando.values()) ordem.push(P);   // sem ficha: vai pro fim
  if (ordem.length < 2) return;
  for (const sp of [...caixa.querySelectorAll('.pane-split')]) sp.remove();
  ordem.forEach((P, i) => { if (i) caixa.appendChild(makeSplitter()); caixa.appendChild(P.el); });
  // o MAPA tambem: o savePanes grava na ordem de insercao, nao na ordem da tela.
  // Sem isto a ordem certa da tela era desfeita na proxima gravacao.
  panes.clear();
  for (const P of ordem) panes.set(P.id, P);
}

/* Voltar pra aba: quem ficou rodando volta pra tela do jeito que estava. */
function trazerPaineisDoFundo(abaId) {
  const caixa = $('#panes');
  let quantos = 0;
  for (const P of [...panesFundo.values()]) {
    if (P.abaId !== abaId) continue;
    panesFundo.delete(P.id);
    panes.set(P.id, P);
    if (panes.size > 1) caixa.appendChild(makeSplitter());
    caixa.appendChild(P.el);
    try { P.ro = new ResizeObserver(() => posicionarChave(P)); P.ro.observe($('.p-chave', P.el)); } catch {}
    // fora da tela o scroll nao anda: sem isto voce voltava no COMECO da conversa
    scroll(P, true);
    if (P.busy) trabalhando(P);   // recria o bloco e religa o relogio do turno
    quantos++;
  }
  return quantos;
}

/* ---- desenha as abas no topo (tipo aba de navegador) ---- */
function pintarAbasLocal() {
  const box = $('#abasLocal');
  if (!box) return;
  try { pintarAbasLocalMiolo(box); }
  catch (e) {
    // se der erro, mostra na propria barra em vez de sumir em silencio
    box.innerHTML = '<span style="color:var(--red);font-size:11px;padding:0 8px">Erro nas abas: ' + (e && e.message || e) + '</span>';
  }
}
function pintarAbasLocalMiolo(box) {
  box.innerHTML = '';
  const lista = abasLocais();
  const podeApagar = lista.length > 1;
  for (const ab of lista) {
    const bt = document.createElement('button');
    bt.className = 'aba-local' + (ab.id === cfg.abaAtiva ? ' on' : '');
    bt.innerHTML = '<span class="al-topo"><span class="al-cor"></span><span class="al-n"></span></span><span class="al-s"></span>'
      + (podeApagar ? '<button class="al-x">' + ico('x') + '</button>' : '');
    const corAba = ab.cor || (ab.tipo === 'ssh' ? '#5aa469' : '#6ea8fe');
    $('.al-cor', bt).style.background = corAba;
    if (ab.id === cfg.abaAtiva) bt.style.borderColor = corAba;
    $('.al-n', bt).textContent = ab.nome;
    const n = (ab.paineis && ab.paineis.length) || 0;
    $('.al-s', bt).textContent = (ab.tipo === 'ssh' ? '🖧 ' : '') + n + (n === 1 ? ' chat' : ' chats');
    // bolinha pulsando: tem painel trabalhando NESTA aba, mesmo voce estando em outra
    const ocupados = trabalhandoPorAba()[ab.id] || 0;
    const esperando = esperandoPorAba()[ab.id] || 0;
    // o ponto existe SEMPRE (invisivel quando nao ha nada): sem isso a aba
    // mudava de largura ao comecar/terminar e empurrava as vizinhas de lugar
    const pt = document.createElement('span');
    pt.className = 'al-trab' + (esperando ? ' esperando' : (ocupados ? '' : ' vazio'));
    pt.title = esperando ? 'um painel aqui está esperando você autorizar'
      : ocupados === 1 ? 'um painel está trabalhando aqui'
      : ocupados ? ocupados + ' painéis estão trabalhando aqui' : '';
    $('.al-topo', bt).appendChild(pt);
    const ondeAba = ab.tipo === 'ssh' ? (ab.usuario + '@' + ab.host + (ab.caminhoRemoto ? ':' + ab.caminhoRemoto : ''))
      : (pastasDaAba(ab).map(shortPath).join('\n') || 'PC inteiro');
    bt.title = ondeAba + '\n\n(duplo clique para editar esta aba)';
    bt.addEventListener('click', (e) => { if (!e.target.closest('.al-x')) trocarAbaLocal(ab.id); });
    bt.addEventListener('dblclick', (e) => { if (!e.target.closest('.al-x')) abrirModalAbaLocal(ab); });
    if (podeApagar) $('.al-x', bt).addEventListener('click', (e) => { e.stopPropagation(); apagarAbaLocal(ab); });
    box.appendChild(bt);
  }
  const add = document.createElement('button');
  add.className = 'aba-local aba-local-add';
  add.innerHTML = ico('plus');
  add.title = 'Nova aba (pasta ou servidor remoto)';
  add.addEventListener('click', () => abrirModalAbaLocal(null));
  box.appendChild(add);
}

/* ---- troca de aba: guarda os paineis da aba que sai, mostra os da aba que entra ---- */
let trocandoAba = false;
let abaGen = 0;
let abaPendente = null;
let abaIndoPara = null;   // destino da troca em curso (cfg.abaAtiva so' muda depois do await)
async function trocarAbaLocal(novoId) {
  // 'cfg.abaAtiva' so' muda depois do await la embaixo: durante uma troca em
  // curso, comparar com ele fazia o clique de volta (A->B->A) ser jogado fora
  if (novoId === (trocandoAba ? abaIndoPara : cfg.abaAtiva)) return;
  // sem esta trava, clicar em duas abas durante o carregamento gravava a lista
  // pela metade e jogava painel de uma aba dentro da outra.
  // O clique nao e' jogado fora: fica guardado pra acontecer no fim.
  if (trocandoAba) { abaPendente = novoId; return; }
  trocandoAba = true; abaIndoPara = novoId;
  const gen = ++abaGen;
  try {
  savePanes();
  await guardarPaineisDaAba();
  cfg.abaAtiva = novoId;
  window.api.setConfig(cfg);
  pintarAbasLocal();
  $('#panes').style.display = '';
  histCache.claude = null; histCache.codex = null;
  const abaLateralAberta = $$('.side-view').find(v => !v.classList.contains('hidden'));
  if (abaLateralAberta && abaLateralAberta.dataset.view === 'hclaude') loadHist('claude', true);
  if (abaLateralAberta && abaLateralAberta.dataset.view === 'hcodex') loadHist('codex', true);
  // quem ficou trabalhando nesta aba volta INTEIRO: nao recarrega, nao reinicia
  const voltaram = trazerPaineisDoFundo(novoId);
  const ab = abaAtual();
  const salvos = (ab && Array.isArray(ab.paineis)) ? ab.paineis.filter(p => p && (p.sessaoId || p.contexto || p.rascunho)) : [];
  // painel que voltou vivo nao pode ser recriado do config em cima dele mesmo.
  // Casar pelo ID DO PAINEL, nao pelo da sessao: quem acabou de mandar a
  // primeira mensagem ainda nao tem sessaoId e virava um clone a cada volta.
  const vivos = new Set([...panes.values()].map(P => P.id));
  const sessoesVivas = new Set([...panes.values()].map(P => P.sessaoId || P.resumeId).filter(Boolean));
  const faltando = salvos.filter(s => !(s.paneId && vivos.has(s.paneId))
                                   && !(s.sessaoId && sessoesVivas.has(s.sessaoId)));
  if (faltando.length) await restaurarPaineis(faltando, novoId, gen);
  else if (!voltaram && gen === abaGen) newPane({ abaId: novoId });
  // 'salvos' e' a ordem de antes da troca; abaAtual().paineis ja foi regravado
  // pelo savePanes() do restaurarPaineis, na ordem errada do DOM
  if (gen === abaGen) { reordenarPaineis(salvos); savePanes(); }
  if (voltaram && gen === abaGen) {
    const primeiro = [...panes.values()][0];
    if (primeiro) { setFocus(primeiro); const c = $('.p-input', primeiro.el); if (c) c.focus(); }
    savePanes();   // sem restaurarPaineis no caminho, ninguem gravava
  }
  } finally {
    trocandoAba = false; abaIndoPara = null;
    const proxima = abaPendente; abaPendente = null;
    if (proxima && proxima !== cfg.abaAtiva) trocarAbaLocal(proxima);
  }
}

async function apagarAbaLocal(ab) {
  if (abasLocais().length <= 1) return;
  if (!confirm('Apagar a aba "' + ab.nome + '"? Os painéis salvos nela se perdem (as conversas em si continuam existindo, só saem da lista).')) return;
  const eraAtiva = ab.id === cfg.abaAtiva;
  if (eraAtiva) {
    // sai da aba ANTES de apagar. Apagando primeiro, cfg.abaAtiva apontava pra
    // uma aba que nao existe mais, abaAtual() caia na primeira da lista e o
    // savePanes() de dentro de trocarAbaLocal gravava os paineis desta aba
    // POR CIMA dos paineis da vizinha - perda de verdade, sem volta.
    const destino = abasLocais().find(a => a.id !== ab.id);
    if (!destino) return;
    ab.paineis = [];              // ela vai embora: nao leva painel pra lugar nenhum
    await trocarAbaLocal(destino.id);
  }
  // painel dessa aba que tinha ficado rodando em segundo plano morre com ela
  for (const P of [...panesFundo.values()]) {
    if (P.abaId !== ab.id) continue;
    panesFundo.delete(P.id);
    clearInterval(P.relogio); P.relogio = 0;
    P.morto = true;
    matarTerminaisDoPainel(P);
    try { await window.api.paneStop({ paneId: P.id, engine: P.engine }); } catch {}
  }
  cfg.abas = abasLocais().filter(a => a.id !== ab.id);
  window.api.setConfig(cfg);
  pintarAbasLocal();
}

/* ---- criar/editar aba: nome + tipo (pasta local ou servidor remoto) ---- */
function abrirModalAbaLocal(existente) {
  const cx = abrirModalGlobal();
  const editando = !!existente;
  cx.innerHTML = '<div class="mo-top"><span class="mo-tit">' + (editando ? 'Editar aba' : 'Nova aba') + '</span>'
    + '<button class="mo-x">' + ico('x') + '</button></div>'
    + '<div class="mo-sub">Uma aba é um lugar onde o Cockpit trabalha: uma pasta do seu PC, ou um servidor remoto por SSH.</div>'
    + '<div class="mo-form"><input id="abNome" placeholder="Nome da aba, ex: Projeto X" maxlength="40"></div>'
    + '<div class="tipo-toggle">'
    +   '<button class="tipo-bt" data-tipo="local">Pasta local</button>'
    +   '<button class="tipo-bt" data-tipo="ssh">Servidor remoto (SSH)</button>'
    + '</div>'
    + '<div class="mo-form" id="abCorpoLocal">'
    +   '<div class="mo-dica">Pastas desta aba (pode ser mais de uma, ex: backend + frontend)</div>'
    +   '<div id="abPastasLista"></div>'
    +   '<button class="mo-btn" id="abEscolherPasta">+ Adicionar pasta</button>'
    + '</div>'
    + '<div class="mo-form hidden" id="abCorpoSsh">'
    +   '<input id="abHost" placeholder="Endereço, ex: 203.0.113.10 ou meu-servidor.com">'
    +   '<input id="abUsuario" placeholder="Usuário, ex: hugo">'
    +   '<div class="mo-dica">Chave privada (arquivo SSH)</div>'
    +   '<div class="path-box" id="abChaveMostra">—</div>'
    +   '<button class="mo-btn" id="abEscolherChave">Escolher arquivo</button>'
    +   '<input id="abCaminho" placeholder="Pasta no servidor (opcional), ex: ~/projeto">'
    + '</div>'
    + '<div class="mo-dica" style="margin-top:10px">Cor</div>'
    + '<div class="cor-linha">' + GRUPO_CORES.map(c => '<button class="cor-sw" data-cor="' + c + '" style="background:' + c + '"></button>').join('') + '</div>'
    + '<div class="mo-rodape"><button class="mo-btn destaque" id="abOk">' + (editando ? 'Salvar' : 'Criar aba') + '</button>'
    + '<button class="mo-btn" id="abCancela">Cancelar</button></div>';
  $('.mo-x', cx).onclick = fecharModalGlobal;
  $('#abCancela', cx).onclick = fecharModalGlobal;

  let tipo = (existente && existente.tipo) || 'local';
  let pastasEscolhidas = (existente && existente.tipo === 'local') ? pastasDaAba(existente) : [];
  let chaveEscolhida = (existente && existente.chave) || '';
  let corEscolhida = (existente && existente.cor) || GRUPO_CORES[Math.floor(Math.random() * GRUPO_CORES.length)];

  const pintaTipo = () => {
    $$('.tipo-bt', cx).forEach(b => b.classList.toggle('on', b.dataset.tipo === tipo));
    $('#abCorpoLocal', cx).classList.toggle('hidden', tipo !== 'local');
    $('#abCorpoSsh', cx).classList.toggle('hidden', tipo !== 'ssh');
  };
  $$('.tipo-bt', cx).forEach(b => b.addEventListener('click', () => { tipo = b.dataset.tipo; pintaTipo(); }));
  pintaTipo();

  const pintarPastas = () => {
    const box = $('#abPastasLista', cx);
    box.innerHTML = '';
    if (!pastasEscolhidas.length) {
      box.innerHTML = '<div class="path-box">— nenhuma pasta: a aba mostra o computador inteiro</div>';
      return;
    }
    pastasEscolhidas.forEach((p, i) => {
      const linha = document.createElement('div');
      linha.className = 'pasta-linha';
      linha.innerHTML = '<span class="path-box"></span><button class="pasta-x">' + ico('x') + '</button>';
      $('.path-box', linha).textContent = shortPath(p);
      $('.pasta-x', linha).onclick = () => { pastasEscolhidas.splice(i, 1); pintarPastas(); };
      box.appendChild(linha);
    });
  };
  pintarPastas();
  $('#abEscolherPasta', cx).onclick = async () => {
    const p = await window.api.pickFolder(pastasEscolhidas[0] || HOME);
    if (p && !pastasEscolhidas.some(x => mesmaPasta(x, p))) { pastasEscolhidas.push(p); pintarPastas(); }
  };
  $('#abChaveMostra', cx).textContent = chaveEscolhida ? baseNome(chaveEscolhida) : '—';
  $('#abEscolherChave', cx).onclick = async () => {
    const fs = await window.api.pickFiles('file');
    if (fs && fs[0]) { chaveEscolhida = fs[0]; $('#abChaveMostra', cx).textContent = baseNome(fs[0]); }
  };
  const pintaCorAba = () => $$('.cor-sw', cx).forEach(b => {
    const on = b.dataset.cor === corEscolhida;
    b.classList.toggle('on', on);
    b.innerHTML = on ? ico('check') : '';
  });
  $$('.cor-sw', cx).forEach(b => b.addEventListener('click', () => { corEscolhida = b.dataset.cor; pintaCorAba(); }));
  pintaCorAba();

  $('#abNome', cx).value = existente ? existente.nome : '';
  if (existente && existente.tipo === 'ssh') {
    $('#abHost', cx).value = existente.host || '';
    $('#abUsuario', cx).value = existente.usuario || '';
    $('#abCaminho', cx).value = existente.caminhoRemoto || '';
  }
  setTimeout(() => $('#abNome', cx).focus(), 30);

  $('#abOk', cx).onclick = () => {
    const nome = $('#abNome', cx).value.trim();
    if (!nome) { $('#abNome', cx).focus(); return; }
    let dado;
    if (tipo === 'ssh') {
      const host = $('#abHost', cx).value.trim(), usuario = $('#abUsuario', cx).value.trim();
      if (!host || !usuario || !chaveEscolhida) { alert('Preciso do endereço, do usuário e da chave.'); return; }
      dado = { nome, tipo: 'ssh', host, usuario, chave: chaveEscolhida, caminhoRemoto: $('#abCaminho', cx).value.trim() || '~', cor: corEscolhida };
    } else {
      dado = { nome, tipo: 'local', caminhos: pastasEscolhidas.slice(), caminho: null, cor: corEscolhida };
    }
    if (editando) { Object.assign(existente, dado); }
    else {
      if (!Array.isArray(cfg.abas)) cfg.abas = [];
      cfg.abas.push(Object.assign({ id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), paineis: [] }, dado));
    }
    window.api.setConfig(cfg);
    fecharModalGlobal();
    pintarAbasLocal();
    histCache.claude = null; histCache.codex = null;
    const abaLateralAberta = $$('.side-view').find(v => !v.classList.contains('hidden'));
    if (abaLateralAberta && abaLateralAberta.dataset.view === 'hclaude') loadHist('claude', true);
    if (abaLateralAberta && abaLateralAberta.dataset.view === 'hcodex') loadHist('codex', true);
  };
}

function pintarTokens(P) {
  pintarAnel(P);
  const el = $('.p-tokens', P.el);
  if (!P.tokens) { el.innerHTML = ''; return; }
  const usado = (P.tokens / 1000).toFixed(1) + 'k';
  if (P.janela) {
    const pct = Math.min(100, Math.round((P.tokens / P.janela) * 100));
    el.innerHTML = '<b></b><span class="tok-bar"><span class="tok-fill"></span></span>';
    $('b', el).textContent = usado + ' / ' + Math.round(P.janela / 1000) + 'k';
    $('.tok-fill', el).style.width = pct + '%';
    el.title = 'A conversa já ocupa ' + usado + ' das ' + Math.round(P.janela / 1000)
      + 'k palavras-token que cabem neste modelo (' + pct + '%). Quando enche, a conversa é resumida.';
  } else {
    el.innerHTML = '<b></b>';
    $('b', el).textContent = usado;
    el.title = 'Tamanho da conversa até agora.';
  }
}

function pintarAnel(P) {
  const bt = $('.p-compactar', P.el);
  if (!bt) return;
  const pct = (P.tokens && P.janela) ? Math.min(100, Math.round((P.tokens / P.janela) * 100)) : 0;
  // só aparece quando já vale a pena pensar nisso
  bt.classList.toggle('hidden', pct < 20);
  bt.classList.toggle('meio', pct >= 70 && pct < 90);
  bt.classList.toggle('cheio', pct >= 90);
  const volta = 2 * Math.PI * 15;
  $('.an-fio', bt).style.strokeDashoffset = String(volta - (volta * pct) / 100);

  bt.title = 'A conversa já ocupa ' + pct + '% do que cabe neste modelo.\n'
    + 'Clique para resumir e liberar espaço sem perder o fio.';
}

function setDot(P, state) {
  P.el.classList.toggle('ocupado', state === 'busy');
  $('.p-dot', P.el).className = 'p-dot dot ' + state;
  $('.p-stop', P.el).classList.toggle('hidden', state !== 'busy');
  $('.p-send', P.el).disabled = false;   // dá para enviar durante o trabalho: vai pela fila ou entra nele
}

/* ============ desenho das mensagens ============ */
function clearEmpty(P) { const e = $('.pane-empty', P.el); if (e) e.remove(); }

const soNome = (c) => baseNome(c);
function fraseDoPasso(nome, arg) {
  const a = String(arg || '').replace(/\s+/g, ' ').trim();
  const curto = a.length > 70 ? a.slice(0, 70) + '…' : a;
  switch (nome) {
    case 'Terminal': case 'Bash': return { txt: 'Rodando no terminal', det: curto };
    case 'Read': return { txt: 'Lendo', det: soNome(a) };
    case 'Write': return { txt: 'Criando o arquivo', det: soNome(a) };
    case 'Edit': case 'Editando arquivo': return { txt: 'Mexendo no arquivo', det: soNome(a) };
    case 'Grep': case 'Buscando no código': return { txt: 'Procurando no código', det: curto };
    case 'Glob': case 'Procurando arquivos': return { txt: 'Procurando arquivos', det: curto };
    case 'WebSearch': case 'Pesquisando na web': return { txt: 'Pesquisando na web', det: curto };
    case 'WebFetch': case 'Abrindo link': return { txt: 'Abrindo uma página', det: curto };
    case 'Task': case 'Agente': return { txt: 'Chamando um agente', det: curto };
    case 'TodoWrite': case 'Lista de tarefas': return { txt: 'Organizando as tarefas', det: '' };
    case 'Skill': return { txt: 'Usando a skill', det: curto };
    default: return { txt: toolLabel(nome), det: curto };
  }
}

function passo(P, frase, id) {
  if (!P.busy) return;
  clearEmpty(P);
  let box = P.passosEl;
  if (!box || box.parentNode !== P.chat) {
    box = document.createElement('div');
    box.className = 'passos';
    P.chat.appendChild(box);
    P.passosEl = box;
  }
  const d = document.createElement('div');
  d.className = 'passo';
  d.innerHTML = '<span class="pa-pt"></span><span class="pa-t"></span><span class="pa-d"></span>';
  $('.pa-t', d).textContent = frase.txt;
  $('.pa-d', d).textContent = frase.det || '';
  if (id) d.dataset.id = id;
  box.appendChild(d);
  while (box.children.length > 8) box.firstChild.remove();
  P.chat.appendChild(box);
  if (P.trabEl) P.chat.appendChild(P.trabEl);
  scroll(P);
}

function passoPronto(P, id, erro) {
  const box = P.passosEl;
  if (!box) return;
  const d = [...box.children].reverse().find(x => x.dataset.id === id);
  if (d) d.classList.add(erro ? 'erro' : 'ok');
}

/* no fim do turno os passos viravam pó. Agora encolhem num resumo clicavel,
   pra dar pra conferir depois o que ele mexeu. */
function limparPassos(P) {
  const box = P.passosEl;
  P.passosEl = null;
  if (!box || box.parentNode !== P.chat) { if (box) box.remove(); return; }
  const n = box.children.length;
  if (!n) { box.remove(); return; }
  if (box.classList.contains('recolhido')) return;
  box.classList.add('recolhido');
  const cab = document.createElement('button');
  cab.className = 'passos-cab';
  cab.textContent = n === 1 ? '1 passo' : n + ' passos';
  cab.title = 'Ver o que ele fez neste turno';
  cab.addEventListener('click', () => {
    box.classList.toggle('aberto');
    cab.textContent = box.classList.contains('aberto')
      ? 'esconder passos' : (n === 1 ? '1 passo' : n + ' passos');
  });
  box.insertBefore(cab, box.firstChild);
}

function trabalhando(P, oque) {
  if (!P.busy) return;              // terminou? entao nao mostra nada
  clearEmpty(P);
  let t = P.trabEl;
  // parentNode, nao isConnected: o painel de outra aba tem o chat fora do
  // documento, e a checagem antiga criava um bloco novo a CADA chamada
  if (!t || t.parentNode !== P.chat) {
    t = document.createElement('div');
    t.className = 'trab';
    t.innerHTML = '<span class="trab-pts"><i></i><i></i><i></i></span><span class="trab-txt">trabalhando…</span>'
      + '<span class="trab-rel"></span><span class="trab-esc">Esc para parar</span>';
    P.chat.appendChild(t);
    P.trabEl = t;
    // relogio correndo: da' pra ver se ele esta pensando ou travou
    if (!P.t0) P.t0 = Date.now();
    clearInterval(P.relogio);
    P.relogio = setInterval(() => {
      // para quando o painel morre ou o bloco sai do chat. Painel que continua
      // rodando em outra aba NAO para: o relogio dele tem que seguir contando
      if (P.morto || !P.trabEl || P.trabEl.parentNode !== P.chat) { clearInterval(P.relogio); P.relogio = 0; return; }
      const el = $('.trab-rel', P.trabEl);
      if (!el) { clearInterval(P.relogio); P.relogio = 0; return; }
      el.textContent = duracaoCurta(Date.now() - P.t0);
    }, 1000);
  }
  $('.trab-txt', t).textContent = oque ? 'trabalhando… ' + oque : 'trabalhando…';
  P.chat.appendChild(t);            // mantem sempre no fim
  scroll(P);
}
function pararTrabalho(P) {
  clearInterval(P.relogio); P.relogio = 0;
  if (P.trabEl) { P.trabEl.remove(); P.trabEl = null; }
}
function duracaoCurta(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  return m + 'm' + String(s % 60).padStart(2, '0') + 's';
}
/* linha discreta no fim do turno: quanto levou e quanto ocupou */
function marcarFimDoTurno(P) {
  if (!P.t0) return;
  const levou = Date.now() - P.t0;
  P.t0 = 0;
  if (levou < 3000) return;   // resposta curta nao precisa de carimbo
  const d = document.createElement('div');
  d.className = 'turno-fim';
  const tok = P.tokens ? ' · ' + (P.tokens / 1000).toFixed(1) + 'k de contexto' : '';
  d.textContent = 'levou ' + duracaoCurta(levou) + tok;
  P.chat.appendChild(d); scroll(P);
}
function atBottom(P) { return P.chat.scrollHeight - P.chat.scrollTop - P.chat.clientHeight < 100; }
function scroll(P, force) { if (force || atBottom(P)) P.chat.scrollTop = P.chat.scrollHeight; }

/* devolve o balao e a entrada do historico: quem chamou precisa poder desfazer
   EXATAMENTE o que desenhou, e nao "o ultimo que estiver na tela" - com dois
   envios ao mesmo tempo, o ultimo pode ser de outra mensagem */
function userMsg(P, text, anexos) {
  clearEmpty(P);
  const d = document.createElement('div');
  d.className = 'msg user';
  d.innerHTML = '<div class="msg-role"><span class="av"></span>Você</div>'
    + '<div class="msg-anx hidden"></div><div class="msg-body"></div>';
  pintarAvatar($('.av', d));
  if (anexos && anexos.length) {
    const cx = $('.msg-anx', d);
    cx.classList.remove('hidden');
    for (const a of anexos) cx.appendChild(fichaAnexo(a, false, null, P));
  }
  $('.msg-body', d).textContent = text;
  P.chat.appendChild(d); scroll(P, true);
  const entrada = { quem: 'Você', texto: text };
  P.hist.push(entrada);
  return { balao: d, entrada };
}
function pintarAvatar(el) {
  if (cfg.foto) el.innerHTML = '<img src="' + cfg.foto + '" alt="">';
  else el.innerHTML = ico('user');
}
function repintarAvatares() { $$('.msg.user .av').forEach(pintarAvatar); $('#fotoPrev') && pintarAvatar($('#fotoPrev')); }

function copiarTexto(txt, botao, rotuloOk) {
  try {
    navigator.clipboard.writeText(String(txt || ''));
    if (botao) {
      const antes = botao.textContent;
      botao.textContent = rotuloOk || 'copiado';
      botao.classList.add('copiou');
      setTimeout(() => { botao.textContent = antes; botao.classList.remove('copiou'); }, 1400);
    }
  } catch {}
}

/* botao de copiar em cada bloco de codigo da resposta */
function botoesDeCodigo(el) {
  for (const pre of el.querySelectorAll('pre')) {
    if (pre.querySelector('.cod-copiar')) continue;
    pre.classList.add('com-copiar');
    const bt = document.createElement('button');
    bt.className = 'cod-copiar';
    bt.textContent = 'copiar';
    bt.addEventListener('click', (e) => { e.stopPropagation(); copiarTexto(pre.innerText, bt); });
    pre.appendChild(bt);
  }
}

function botBlock(P, key) {
  clearEmpty(P);
  const d = document.createElement('div');
  d.className = 'msg bot';
  d.innerHTML = '<div class="msg-role"><span class="av">' + svgMotor(P.engine) + '</span>'
    + (P.engine === 'codex' ? 'Codex' : 'Claude') + '</div>'
    + '<button class="msg-copiar" title="Copiar esta resposta">copiar</button>'
    + '<div class="msg-body"></div>';
  P.chat.appendChild(d);
  const b = { el: $('.msg-body', d), raw: '' };
  $('.msg-copiar', d).addEventListener('click', (e) => { e.stopPropagation(); copiarTexto(b.raw, $('.msg-copiar', d)); });
  P.blocks.set(key, b); scroll(P);
  return b;
}
function thinkBlock(P) {
  clearEmpty(P);
  const d = document.createElement('div');
  d.className = 'think'; d.innerHTML = '<div class="think-in"></div>';
  P.chat.appendChild(d);
  const b = { el: $('.think-in', d), raw: '' };
  P.blocks.set('__think', b); scroll(P);
  return b;
}
function textDelta(P, key, text) {
  // um bloco POR FALA (pela chave), nao um "bloco corrente": dois sub-agentes
  // falando junto se intercalam, e o corrente unico repetia a fala a cada troca
  let b = P.blocks.get('b:' + key);
  if (!b) {
    b = botBlock(P, 'b:' + key);
    P.blocks.set('resp', b); P.blocks.set('respKey', key);
  }
  b.raw += text; b.el.innerHTML = mdSeguro(b.raw);
  if (P.passosEl) P.chat.insertBefore(P.passosEl, b.el.parentElement);
  if (P.trabEl) P.chat.appendChild(P.trabEl);
  scroll(P);
}
let ultimoPensar = 0;
function thinkDelta(P, text) {
  trabalhando(P, 'pensando');
  const agora = Date.now();
  if (agora - ultimoPensar > 8000) { ultimoPensar = agora; passo(P, { txt: 'Pensando no problema', det: '' }); }
}
function marcarLinksWeb(el) {
  for (const a of el.querySelectorAll('a[href^="http"]')) {
    a.classList.add('link-web');
    a.title = 'abre no seu navegador';
  }
}

function linkarArquivos(P, el) {
  // Mac: /Users/... | Windows: C:\... e caminho de rede
  const re = /((?:[A-Za-z]:[\\/]|\\\\)[^\s"'<>)|*?]+\.[A-Za-z0-9]{1,6}|\/(?:Users|tmp|private|Volumes|home)\/[^\s"'<>)]+\.[A-Za-z0-9]{1,6})/g;
  const andar = (no) => {
    for (const filho of [...no.childNodes]) {
      if (filho.nodeType === 3) {
        const txt = filho.textContent;
        if (!re.test(txt)) { re.lastIndex = 0; continue; }
        re.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let ult = 0, m;
        while ((m = re.exec(txt))) {
          if (m.index > ult) frag.appendChild(document.createTextNode(txt.slice(ult, m.index)));
          const caminho = m[1];                       // guarda o valor: o m muda no proximo laço
          const a = document.createElement('a');
          a.className = 'arquivo'; a.textContent = caminho; a.href = '#';
          a.title = 'abre aqui dentro';
          a.onclick = (e) => { e.preventDefault(); e.stopPropagation(); verArquivo(P, caminho); };
          frag.appendChild(a);
          ult = m.index + caminho.length;
        }
        if (ult < txt.length) frag.appendChild(document.createTextNode(txt.slice(ult)));
        filho.replaceWith(frag);
      } else if (filho.nodeType === 1 && !['A', 'PRE', 'CODE'].includes(filho.tagName)) andar(filho);
    }
  };
  andar(el);
}

/* o texto que ja esta na tela e' o comeco desta mesma fala? Entao e' a MESMA
   mensagem chegando na versao final, nao uma fala nova. */
function mesmaFala(naTela, final) {
  const x = String(naTela || '').trim(), y = String(final || '').trim();
  if (!x || !y) return false;
  // piso de tamanho vale pros DOIS casos: "Pronto." e "Feito." se repetem, e
  // duas falas curtas iguais nao podem virar uma so'
  if (x.length < 20) return false;
  if (x === y) return true;
  // prefixo INTEIRO, nao os primeiros 200: duas falas longas que comecassem com
  // o mesmo paragrafo eram tratadas como a mesma, e a primeira sumia da tela
  return y.startsWith(x);
}
function textFinal(P, key, text) {
  if (!text || !text.trim()) return;
  let b = P.blocks.get('b:' + key);
  let fundiu = false;
  if (!b) {
    // rede de seguranca contra RESPOSTA EM DOBRO: se o id mudou entre o texto
    // que chegou letra a letra e a versao final, o que esta na tela e' esta
    // MESMA fala - continua no mesmo bloco em vez de repetir tudo embaixo.
    const corrente = P.blocks.get('resp');
    if (corrente && mesmaFala(corrente.raw, text)) { b = corrente; fundiu = true; }
    else b = botBlock(P, 'b:' + key);
    P.blocks.set('b:' + key, b);
    P.blocks.set('resp', b); P.blocks.set('respKey', key);
  }
  b.raw = text; b.el.innerHTML = mdSeguro(text);
  linkarArquivos(P, b.el); marcarLinksWeb(b.el); botoesDeCodigo(b.el);
  if (P.trabEl) P.chat.appendChild(P.trabEl);
  scroll(P);
  const quem = P.engine === 'codex' ? 'Codex' : 'Claude';
  const ult = P.hist[P.hist.length - 1];
  // mesma chave = continuacao do mesmo bloco; chave nova = fala nova.
  // 'fundiu' so' e' true quando a bolha na tela tambem era a mesma fala: sem
  // essa amarra, duas falas que comecassem igual viravam UMA no historico
  if (ult && ult.quem === quem && (ult.chave === key || (fundiu && mesmaFala(ult.texto, text)))) { ult.texto = text; ult.chave = key; }
  else P.hist.push({ quem, texto: text, chave: key });
}
function toolStart(P, id, name, arg, mudanca) {
  passo(P, fraseDoPasso(name, arg), id);
  if (!mudanca) return;
  const d = acharPasso(P, id);
  if (!d || $('.pa-diff', d)) return;
  const bt = document.createElement('button');
  bt.className = 'pa-diff';
  // so' conta as linhas agora; o desenho do diff so' e' montado se voce abrir
  const resumo = resumoDaMudanca(mudanca);
  bt.textContent = 'ver mudança' + (resumo ? ' ' + resumo : '');
  bt.title = mudanca.path || 'ver o que muda no arquivo';
  let bloco = null;
  bt.addEventListener('click', (e) => {
    e.stopPropagation();
    const aberto = $('.diff', d);
    if (aberto) { aberto.remove(); bt.textContent = 'ver mudança' + (resumo ? ' ' + resumo : ''); return; }
    if (!bloco) bloco = elDiff(mudanca);
    d.appendChild(bloco);
    bt.textContent = 'esconder';
    scroll(P);
  });
  d.appendChild(bt);
}

/* a saida do comando fica guardada no proprio passo: clicar abre.
   Antes era descartada - erro de build aparecia so' como bolinha vermelha. */
/* compara duas versoes de um texto linha a linha e devolve o que saiu e o
   que entrou. Algoritmo classico de maior subsequencia comum - suficiente pro
   tamanho de edicao que aparece aqui. */
function linhasDoDiff(antes, depois) {
  // texto vazio = nenhuma linha (e nao uma linha em branco), senao um arquivo
  // novo aparecia com uma linha "removida" fantasma
  const emLinhas = (s) => { const t = String(s == null ? '' : s); return t === '' ? [] : t.split('\n'); };
  const A = emLinhas(antes);
  const B = emLinhas(depois);
  const TETO = 400;   // arquivo enorme: mostra resumo em vez de travar a tela
  if (A.length > TETO || B.length > TETO) {
    return [{ t: 'info', txt: A.length + ' linhas → ' + B.length + ' linhas (grande demais para mostrar linha a linha)' }];
  }
  const n = A.length, mm = B.length;
  const tab = Array.from({ length: n + 1 }, () => new Uint32Array(mm + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = mm - 1; j >= 0; j--) {
      tab[i][j] = A[i] === B[j] ? tab[i + 1][j + 1] + 1 : Math.max(tab[i + 1][j], tab[i][j + 1]);
    }
  }
  const saida = [];
  let i = 0, j = 0;
  while (i < n && j < mm) {
    if (A[i] === B[j]) { saida.push({ t: 'igual', txt: A[i] }); i++; j++; }
    else if (tab[i + 1][j] >= tab[i][j + 1]) { saida.push({ t: 'menos', txt: A[i] }); i++; }
    else { saida.push({ t: 'mais', txt: B[j] }); j++; }
  }
  while (i < n) { saida.push({ t: 'menos', txt: A[i] }); i++; }
  while (j < mm) { saida.push({ t: 'mais', txt: B[j] }); j++; }
  return saida;
}

/* guarda o calculo do diff pra nao refazer: o resumo (+N −M) e o desenho
   usavam o mesmo trabalho pesado e faziam duas vezes */
const cacheDiff = new WeakMap();
function partesDoDiff(mudanca) {
  if (cacheDiff.has(mudanca)) return cacheDiff.get(mudanca);
  const partes = mudanca.tipo === 'multi' ? (mudanca.partes || []) : [{ antes: mudanca.antes, depois: mudanca.depois }];
  const calc = partes.map((p) => linhasDoDiff(p.antes, p.depois));
  cacheDiff.set(mudanca, calc);
  return calc;
}

/* so' a conta de linhas (+N −M), sem montar nada na tela */
function resumoDaMudanca(mudanca) {
  if (!mudanca) return '';
  if (mudanca.tipo === 'write-grande') return 'arquivo grande';
  let mais = 0, menos = 0;
  for (const linhas of partesDoDiff(mudanca)) {
    for (const l of linhas) {
      if (l.t === 'mais') mais++;
      else if (l.t === 'menos') menos++;
    }
  }
  return (mais ? '+' + mais : '') + (mais && menos ? ' ' : '') + (menos ? '−' + menos : '');
}

/* monta o bloco visual do diff, escondendo trecho longo sem alteracao */
function elDiff(mudanca) {
  const cx = document.createElement('div');
  cx.className = 'diff';
  if (!mudanca) return cx;
  if (mudanca.tipo === 'write-grande') {
    const d = document.createElement('div');
    d.className = 'df-info';
    d.textContent = 'Vai sobrescrever um arquivo de ' + Math.round((mudanca.bytes || 0) / 1024) + ' KB (grande demais para comparar aqui).';
    cx.appendChild(d);
    return cx;
  }
  if (mudanca.tipo === 'write') {
    const d = document.createElement('div');
    d.className = 'df-info';
    d.textContent = 'Este arquivo já existe — o conteúdo abaixo substitui o atual por inteiro.';
    cx.appendChild(d);
  }
  if (mudanca.tipo === 'write-incerto') {
    const d = document.createElement('div');
    d.className = 'df-info';
    d.textContent = 'Não dá para conferir o conteúdo atual daqui (arquivo no servidor ou na rede). Se o arquivo já existir, isto substitui tudo.';
    cx.appendChild(d);
  }
  let mais = 0, menos = 0;
  for (const linhas of partesDoDiff(mudanca)) {
    // corta sequencia longa de linha igual: so' 2 de contexto de cada lado
    const marcados = linhas.map((l, idx) => {
      if (l.t !== 'igual') return true;
      for (let k = Math.max(0, idx - 2); k <= Math.min(linhas.length - 1, idx + 2); k++) {
        if (linhas[k].t !== 'igual') return true;
      }
      return false;
    });
    let pulou = 0;
    linhas.forEach((l, idx) => {
      if (l.t === 'mais') mais++;
      if (l.t === 'menos') menos++;
      if (!marcados[idx]) { pulou++; return; }
      if (pulou) {
        const g = document.createElement('div');
        g.className = 'df-pulo'; g.textContent = '⋯ ' + pulou + ' linha' + (pulou > 1 ? 's' : '') + ' sem mudança';
        cx.appendChild(g); pulou = 0;
      }
      const d = document.createElement('div');
      d.className = 'df-l df-' + l.t;
      d.textContent = (l.t === 'mais' ? '+ ' : l.t === 'menos' ? '- ' : l.t === 'info' ? '' : '  ') + l.txt;
      cx.appendChild(d);
    });
    if (pulou) {
      const g = document.createElement('div');
      g.className = 'df-pulo'; g.textContent = '⋯ ' + pulou + ' linha' + (pulou > 1 ? 's' : '') + ' sem mudança';
      cx.appendChild(g);
    }
  }
  cx.dataset.resumo = (mais ? '+' + mais : '') + (mais && menos ? ' ' : '') + (menos ? '−' + menos : '');
  return cx;
}

function acharPasso(P, id) {
  const box = P.passosEl;
  if (!box || !id) return null;
  return [...box.children].reverse().find(x => x.dataset.id === id) || null;
}
function toolOutput(P, id, text) {
  const d = acharPasso(P, id);
  if (!d || !text) return;
  d._saida = ((d._saida || '') + text).slice(-20000);
}
function toolEnd(P, id, output, isErr) {
  const d = acharPasso(P, id);
  passoPronto(P, id, isErr);
  if (!d) return;
  const txt = String(output || d._saida || '').trim();
  if (!txt) return;
  d._saida = txt.slice(-20000);
  d.classList.add('tem-saida');
  if (!$('.pa-abrir', d)) {
    const bt = document.createElement('button');
    bt.className = 'pa-abrir';
    bt.textContent = isErr ? 'ver erro' : 'ver saída';
    bt.title = 'Mostrar o que o comando respondeu';
    bt.addEventListener('click', (e) => {
      e.stopPropagation();
      let cx = $('.pa-saida', d);
      if (cx) { cx.remove(); bt.textContent = isErr ? 'ver erro' : 'ver saída'; return; }
      cx = document.createElement('pre');
      cx.className = 'pa-saida';
      cx.textContent = d._saida || '(sem saída)';
      d.appendChild(cx);
      bt.textContent = 'esconder';
      scroll(P);
    });
    d.appendChild(bt);
  }
}

function note(P, text, isErr) {
  clearEmpty(P);
  const d = document.createElement('div');
  d.className = 'note' + (isErr ? ' err' : '');
  d.textContent = text;
  P.chat.appendChild(d);
  if (isErr) {
    // erro fica na tela, mas nao pra sempre: numa sessao com varias quedas o DOM nao pode crescer sem fim
    const erros = [...P.chat.querySelectorAll('.note.err')];
    while (erros.length > 6) erros.shift().remove();
  }
  if (P.passosEl) P.chat.appendChild(P.passosEl);
  if (P.trabEl) P.chat.appendChild(P.trabEl);
  scroll(P, true);
  if (!isErr) setTimeout(() => d.remove(), 10000);   // aviso normal some sozinho
}

/* nao deu pra enviar: desfaz o balao que ja tinha sido desenhado, senao a
   mensagem fica na tela E no campo, e reenviar deixava tudo em dobro */
function desfazerEnvio(P, escrito, text, anexos) {
  // por IDENTIDADE, nao por posicao: durante o "await paneStart" (que no Codex
  // leva segundos) um segundo Enter ja pode ter desenhado o balao dele
  if (escrito && escrito.balao) { try { escrito.balao.remove(); } catch {} }
  if (escrito && escrito.entrada) {
    const i = P.hist.indexOf(escrito.entrada);
    if (i >= 0) P.hist.splice(i, 1);
  }
  if (anexos && anexos.length) { P.anexos = anexos.slice(); pintarAnexos(P); }
  const campo = $('.p-input', P.el);
  if (campo && !campo.value.trim()) {
    campo.value = text; campo.style.height = 'auto';
    campo.style.height = Math.min(campo.scrollHeight, 190) + 'px';
  }
}

/* duas mensagens na fila: a segunda apagava a primeira em silencio, mesmo com
   as duas ja desenhadas na conversa */
function juntarNaFila(P, texto) {
  return P.queued ? (P.queued + '\n\n' + texto) : texto;
}

/* ============ envio ============ */
async function send(P) {
  const inp = $('.p-input', P.el);
  const text = inp.value.trim();
  if (!text) return;

  if (P.busy) {
    const anx = P.anexos.slice(); P.anexos = []; pintarAnexos(P);
    inp.value = ''; inp.style.height = 'auto';
    userMsg(P, text, anx);
    let envio = text;
    if (anx.length) envio += '\n\nArquivos que anexei (abra cada um antes de responder):\n' + anx.map(a => '- ' + a.path).join('\n');
    if (P.envio === 'entra') {
      const nota = avisoEnvio(P, 'Mandando para dentro do trabalho…');
      let r = null;
      try { r = await window.api.paneSteer({ paneId: P.id, engine: P.engine, text: envio }); } catch { r = null; }
      if (nota) nota.textContent = r && r.ok
        ? 'Entrou no trabalho que ele já está fazendo.'
        : 'Não deu para entrar agora, então ficou na fila.';
      if (!(r && r.ok)) { P.queued = juntarNaFila(P, envio); pintarFila(P); }
    } else {
      const tinha = !!P.queued;
      P.queued = juntarNaFila(P, envio); pintarFila(P);
      avisoEnvio(P, tinha ? 'Somei à mensagem que já estava na fila.' : 'Na fila. Começa assim que ele terminar.');
    }
    return;
  }
  const anexos = P.anexos.slice();
  P.anexos = []; pintarAnexos(P);
  inp.value = ''; inp.style.height = 'auto';
  guardarPrompt(text);            // pra trazer de volta com a seta pra cima
  P.navHist = undefined;
  P.t0 = Date.now();              // comeca o relogio do turno
  const escrito = userMsg(P, text, anexos);
  if (!P.titulo) { P.titulo = text.replace(/\s+/g, ' ').slice(0, 70); pintarNome(P); }

  if (!P.started) {
    setDot(P, 'busy');
    note(P, P.engine === 'codex' ? 'Ligando o Codex…' : 'Ligando o Claude…');
    try {
      // o main devolve false quando nao consegue ligar (SSH invalido, binario
      // sumido): sem olhar o retorno, o painel dizia "trabalhando" pra sempre
      const ligou = await window.api.paneStart({ paneId: P.id, engine: P.engine, cwd: P.cwd, model: P.model || undefined, approval: P.mode, effort: esforcoDe(P), resumeId: P.resumeId || undefined, remoto: remotoDoPane(P) || undefined });
      if (ligou === false) throw new Error('o motor não subiu');
      P.started = true; P.resumeId = null;
    } catch (e) {
      setDot(P, 'off'); pararTrabalho(P);
      desfazerEnvio(P, escrito, text, anexos);
      note(P, 'Não consegui ligar: ' + (e && e.message || e), true);
      return;
    }
  }
  P.busy = true; setDot(P, 'busy'); P.blocks.clear(); pararTrabalho(P); limparPassos(P); trabalhando(P);
  subirNaLista(P);
  let envio = text;
  // no Claude a imagem viaja dentro da mensagem; no Codex continua indo o caminho
  const ehClaude = P.engine === 'claude';
  const listar = ehClaude ? anexos.filter(x => !IMG_EXT.includes(String(x.ext || '').toLowerCase())) : anexos;
  if (listar.length) {
    envio += '\n\nArquivos que anexei (abra cada um antes de responder):\n'
      + listar.map(x => '- ' + x.path).join('\n');
    // painel remoto: o caminho do PC nao existe la dentro
    if (remotoDoPane(P)) note(P, 'Atenção: este painel roda no servidor, e o caminho do arquivo é do seu PC — ele não vai conseguir abrir.', true);
  }
  const contextoUsado = P.passarContexto;
  if (P.passarContexto) { envio = P.passarContexto + envio; P.passarContexto = null; }
  try {
    const foi = await window.api.paneSend({ paneId: P.id, engine: P.engine, text: envio,
      // so' imagem: o resto ja foi listado no texto acima, mandar de novo duplicava
      anexos: ehClaude ? anexos.filter(x => IMG_EXT.includes(String(x.ext || '').toLowerCase())).map(x => x.path) : undefined,
      effort: P.engine === 'codex' ? esforcoDe(P) : undefined });
    if (foi === false) throw new Error('o motor não está ligado');
  }
  catch (e) {
    P.busy = false; setDot(P, 'idle'); pararTrabalho(P); limparPassos(P);
    // nao perde o que ja tinha sido dito na troca de motor
    if (contextoUsado) P.passarContexto = contextoUsado;
    desfazerEnvio(P, escrito, text, anexos);
    note(P, 'Falhou: ' + (e && e.message || e), true);
  }
}

/* ============ eventos vindos do motor ============ */
window.api.onPaneEvent((ev) => {
  // acharPainel, nao panes.get: o painel pode estar rodando em outra aba
  const P = acharPainel(ev.paneId); if (!P) return;
  const noFundo = !panes.has(ev.paneId);
  switch (ev.kind) {
    case 'busy': P.busy = true; setDot(P, 'busy'); trabalhando(P); if (noFundo) pintarAbasLocal(); break;
    case 'sessao': P.sessaoId = ev.id; P.sessaoFile = ev.file || ''; P.sessaoRemota = !!ev.remoto; savePanes(); break;   // sessaoRemota entra no savePanes abaixo
    case 'text-delta': textDelta(P, ev.id, ev.text); break;
    case 'think-delta': thinkDelta(P, ev.text); break;
    case 'text-final': textFinal(P, ev.id, ev.text); break;
    case 'tool-start': toolStart(P, ev.id, ev.name, ev.arg, ev.mudanca); break;
    case 'tool-output': toolOutput(P, ev.id, ev.text); break;
    case 'tool-end': toolEnd(P, ev.id, ev.output, ev.error); break;
    case 'compactou': $('.p-compactar', P.el).classList.remove('rodando'); avisoEnvio(P, 'Conversa resumida. O que importa foi mantido.'); break;
    case 'tokens':
      if (ev.janela) P.janela = ev.janela;
      P.tokens = ev.total || 0;
      pintarTokens(P);
      break;
    case 'janela': P.janela = ev.total; pintarTokens(P); break;
    case 'note': note(P, ev.text, ev.error); break;
    case 'permissao-cancelada': esconderPermissao(P); if (noFundo) pintarAbasLocal(); break;
    case 'turn-end':
      // quem tira o cartao de permissao e' o 'permissao-cancelada' vindo do
      // motor, que ANTES responde o pedido - esconder aqui deixava o Codex
      // esperando uma resposta pra sempre
      P.busy = false; setDot(P, 'idle'); P.blocks.clear(); pararTrabalho(P); limparPassos(P);
      marcarFimDoTurno(P);
      avisarPainel(P, 'terminou');
      atualizarGit(P);
      // acabou o motivo de segurar o motor fora da tela: desliga e devolve pro
      // config. A conversa volta sozinha com --resume quando voce abrir a aba.
      if (noFundo && !P.queued && !(P.filaPerm && P.filaPerm.length) && !(P.terms && P.terms.size)) {
        clearInterval(P.relogio); P.relogio = 0;
        savePanes();                 // ANTES do delete: fora do mapa a ficha dele nao e' atualizada
        panesFundo.delete(P.id);
        P.desligadoNoFundo = true;   // desligado, mas nao "fechado": o aviso ainda vale
        window.api.paneStop({ paneId: P.id, engine: P.engine });
      }
      if (noFundo) pintarAbasLocal();   // a aba para de pulsar quando termina
      $('.p-compactar', P.el).classList.remove('rodando');
      setTimeout(() => { if (!P.busy) { pararTrabalho(P); limparPassos(P); } }, 400);
      histCache[P.engine] = null;
      setTimeout(() => buscarNome(P), 1200);
      if (!$('.side-view[data-view="h' + P.engine + '"]').classList.contains('hidden')) loadHist(P.engine, true);
      if (P.queued) { const q = P.queued; P.queued = null; pintarFila(P);
        setTimeout(async () => {
          // painel FECHADO nao envia mais nada. Mas painel que so' mudou de aba
          // continua vivo e a mensagem da fila tem que ir - antes ela sumia calada
          if (P.morto || !acharPainel(P.id)) return;
          P.busy = true; setDot(P, 'busy');
          try {
            const ok = await window.api.paneSend({ paneId: P.id, engine: P.engine, text: q, effort: P.engine === 'codex' ? esforcoDe(P) : undefined });
            if (ok === false) throw new Error('o motor não está mais ligado');
          } catch (e) {
            // antes isso sumia calado e o painel ficava travado em "trabalhando"
            P.busy = false; setDot(P, 'idle'); pararTrabalho(P); limparPassos(P);
            note(P, 'Não consegui enviar a mensagem da fila (' + (e && e.message || e) + '). Ela está aqui embaixo, é só mandar de novo:', true);
            const inp = $('.p-input', P.el);
            if (inp && !inp.value.trim()) { inp.value = q; inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 190) + 'px'; }
          }
        }, 150); }
      break;
    case 'engine-down': {
      P.started = false; P.busy = false; setDot(P, 'off'); pararTrabalho(P); limparPassos(P);
      esconderPermissao(P);
      if (noFundo) pintarAbasLocal();   // senao a aba seguia pulsando um trabalho ja morto
      const perdeu = !!P.queued; P.queued = null; pintarFila(P);
      note(P, perdeu ? 'A conexão caiu e a mensagem que estava na fila não foi enviada. Escreva de novo.'
                     : 'A conexão caiu. A próxima mensagem religa.', true);
      break;
    }
    case 'approval': showApproval(P, ev); avisarPainel(P, 'está pedindo permissão'); break;
    case 'auto-liberado':
      note(P, 'liberado automaticamente: ' + ev.tool + (ev.arg ? ' · ' + String(ev.arg).slice(0, 60) : ''));
      break;
  }
});

/* a barra de permissao e' UMA por painel, mas o modelo pede varias ferramentas
   na mesma volta. O segundo pedido sobrescrevia o botao do primeiro, que nunca
   era respondido - e o motor ficava esperando pra sempre, painel travado em
   "trabalhando...". Agora os pedidos entram numa fila e aparecem um a um. */
function showApproval(P, ev) {
  // pedido chegou numa aba que nao esta na tela: sem avisar, o motor esperava
  // pra sempre e a unica pista era a bolinha, que diz "trabalhando", nao "travado"
  // so' no PRIMEIRO pedido: o Codex pede permissao varias vezes seguidas, e
  // uma notificacao por pedido viraria uma pilha de avisos iguais
  if (!panes.has(P.id) && panesFundo.has(P.id) && !P.pedindoPerm) {
    P.pedindoPerm = true;
    pintarAbasLocal();
    try {
      new Notification('Cockpit — precisa da sua permissão', {
        body: (P.titulo || 'Um painel') + ' está esperando você autorizar, na aba ' + nomeCurtoDaAba(abaPorId(P.abaId)),
      });
    } catch {}
  }
  if (!P.filaPerm) P.filaPerm = [];
  P.filaPerm.push(ev);
  if (P.filaPerm.length === 1) desenharPermissao(P);
  else note(P, 'Mais um pedido de permissão na fila (' + (P.filaPerm.length - 1) + ' esperando).');
}

function proximaPermissao(P) {
  if (P.filaPerm && P.filaPerm.length) P.filaPerm.shift();
  if (P.filaPerm && P.filaPerm.length) desenharPermissao(P);
  else { P.pedindoPerm = false; esconderPermissao(P); pintarAbasLocal(); }
}

function desenharPermissao(P) {
  const ev = P.filaPerm[0];
  const bar = $('.pane-perm', P.el);
  const txt = $('.pp-txt', bar);
  txt.textContent = ev.title + '\n' + (ev.detail || '') + (ev.reason ? '\n' + ev.reason : '');
  // mostra o que vai mudar no arquivo ANTES de voce decidir
  const antigo = $('.diff', bar); if (antigo) antigo.remove();
  if (ev.mudanca) {
    const bloco = elDiff(ev.mudanca);
    bloco.classList.add('na-perm');
    txt.after(bloco);
  }
  const btSempre = $('.pp-sempre', bar);
  if (btSempre) {
    btSempre.classList.toggle('hidden', !ev.tool);
    btSempre.textContent = ev.tool ? 'Sempre permitir ' + ev.tool : 'Sempre permitir';
    btSempre.title = ev.tool ? 'Não perguntar mais por ' + ev.tool + ' neste painel (vale até fechar o painel)' : '';
  }
  bar.classList.remove('hidden');
  piscar(P);   // painel fora de vista: chama atencao
  const done = (allow) => {
    const d = $('.diff', bar); if (d) d.remove();
    window.api.approve({ key: ev.key, allow });
    proximaPermissao(P);   // mostra o proximo pedido em vez de sumir com ele
  };
  $('.pp-yes', bar).onclick = () => done(true);
  $('.pp-no', bar).onclick = () => done(false);
  if (btSempre) btSempre.onclick = async () => {
    if (ev.tool) await window.api.autoLiberar({ paneId: P.id, tool: ev.tool });
    note(P, 'Não vou mais perguntar por ' + ev.tool + ' neste painel.');
    done(true);
  };
}

/* ============ arvore de arquivos ============ */
const expanded = new Set();
let treeGen = 0;
async function loadTree(dir) {
  const gen = ++treeGen;                    // cancela um carregamento anterior ainda em andamento
  $('#projName').textContent = dir === HOME ? 'Pasta: ' + ESTE_PC + ' inteiro' : ('Pasta: ' + baseNome(dir));
  const box = $('#tree'); box.innerHTML = '';
  await level(dir, box, 0, gen);
}
async function level(dir, container, depth, gen) {
  if (gen !== undefined && gen !== treeGen) return;
  const r = await window.api.listDir(dir);
  if (gen !== undefined && gen !== treeGen) return;
  if (r.error) { container.innerHTML = '<div class="hint" style="padding:6px 14px">' + r.error + '</div>'; return; }
  for (const e of r.entries) {
    const n = document.createElement('div');
    n.className = 'node ' + (e.dir ? 'd' : 'f');
    n.style.paddingLeft = (8 + depth * 12) + 'px';
    const open = expanded.has(e.path);
    n.innerHTML = '<span class="chev">' + (e.dir ? (open ? ico('chevron-down') : ico('chevron-right')) : '') + '</span>'
      + '<span class="ico">' + (e.dir ? ico('folder') : icon(e.name)) + '</span><span class="nm"></span>';
    $('.nm', n).textContent = e.name;
    container.appendChild(n);
    if (e.dir) {
      const kids = document.createElement('div'); container.appendChild(kids);
      if (open) await level(e.path, kids, depth + 1, gen);
      n.addEventListener('click', async () => {
        if (expanded.has(e.path)) { expanded.delete(e.path); kids.innerHTML = ''; $('.chev', n).innerHTML = ico('chevron-right'); }
        else { expanded.add(e.path); $('.chev', n).innerHTML = ico('chevron-down'); await level(e.path, kids, depth + 1); }
      });
    } else {
      n.addEventListener('click', () => {
        if (!focusPane) return;
        const inp = $('.p-input', focusPane.el);
        inp.value = (inp.value ? inp.value + ' ' : '') + e.path;
        inp.focus();
      });
      n.addEventListener('dblclick', async () => {
        const r = await window.api.openPath(e.path);
        // sem isso, arquivo recusado por seguranca nao abria e nao explicava nada
        if (r && r.error && focusPane) note(focusPane, r.error, true);
      });
    }
  }
}
function icon(name) {
  const x = name.split('.').pop().toLowerCase();
  if (['js','mjs','ts','tsx','jsx','py','html','css'].includes(x)) return ico('file-code');
  if (['json','yml','yaml','toml'].includes(x)) return ico('braces');
  if (['md','txt'].includes(x)) return ico('file-text');
  if (['png','jpg','jpeg','gif','svg','webp'].includes(x)) return ico('image');
  if (['sh','zsh','bash'].includes(x)) return ico('terminal');
  return ico('file');
}

/* ============ menus (mesma cara do VSCode, em português) ============ */
const MODOS = {
  claude: [
    { id: 'manual',    ic: 'hand', nome: 'Manual',                 desc: 'Pergunta antes de cada ação' },
    { id: 'auto-edit', ic: 'code-xml', nome: 'Editar automaticamente', desc: 'Mexe nos arquivos sozinho e pergunta o resto' },
    { id: 'plan',      ic: 'clipboard-list', nome: 'Plano',                  desc: 'Só estuda e mostra o plano, não altera nada' },
    { id: 'auto',      ic: 'zap', nome: 'Auto',                   desc: 'Segue sozinho no que é seguro e para no que é arriscado' },
    { id: 'bypass',    ic: 'unlock', nome: 'Sem pedir permissão',    desc: 'Faz tudo sem perguntar, inclusive o que é perigoso' },
  ],
  codex: [
    { id: 'manual',    ic: 'hand', nome: 'Manual',                 desc: 'Pergunta antes de cada ação' },
    { id: 'auto',      ic: 'zap', nome: 'Auto',                   desc: 'Segue sozinho no que é seguro e para no que é arriscado' },
    { id: 'bypass',    ic: 'unlock', nome: 'Sem pedir permissão',    desc: 'Faz tudo sem perguntar, inclusive o que é perigoso' },
  ],
};
const esforcoDe = (P) => P.effort;
const modoDe = (P) => (MODOS[P.engine].find(m => m.id === P.mode) || MODOS[P.engine][MODOS[P.engine].length - 1]);

/* ---- barra de esforço: trilho contínuo, arrasta com ímã e volta no encaixe ---- */
const clamp01 = (v, a, b) => Math.min(b, Math.max(a, v));
const suave = (a, b, v) => { const x = clamp01((v - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
const entre = (a, b, t) => a + (b - a) * t;

function barraEsforco(P) {
  const lista = esforcosDe(P);
  const ULT = lista.length - 1;

  const box = document.createElement('div');
  box.className = 'ef-blk';
  box.innerHTML =
    '<div class="ef-top">' +
      '<div class="ef-tit">Esforço <span class="ef-stage">' +
        '<span class="ef-out"></span><span class="ef-cur"></span></span></div>' +
      '<div class="ef-helpwrap"><button class="ef-help" type="button" aria-label="o que é isso">' +
        ico('circle-help') + '</button>' +
        '<div class="ef-tip">Quanto mais alto, mais tempo ele pensa antes de responder. O último nível gasta a sua cota bem mais rápido.</div>' +
      '</div>' +
    '</div>' +
    '<div class="ef-axis"><span>mais rápido</span><span>mais esperto</span></div>' +
    '<div class="ef-shell">' +
      '<div class="ef-track"><div class="ef-fill"></div><canvas class="ef-px"></canvas>' +
      '<div class="ef-ticks">' + lista.map(() => '<span class="ef-tick"></span>').join('') + '</div></div>' +
      '<div class="ef-thumb" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="' + ULT + '"></div>' +
    '</div>';

  const shell = $('.ef-shell', box), thumb = $('.ef-thumb', box);
  const cur = $('.ef-cur', box), out = $('.ef-out', box);
  const track = $('.ef-track', box), cv = $('.ef-px', box);

  let valor = Math.max(0, lista.findIndex(e => e.id === P.effort));
  let ix = Math.round(valor);
  let arrastando = false, amostras = [], frameMola = 0, framePx = 0, revelar = 0, ultraDesde = 0;

  const nome = (i) => EF_PT[lista[i].id] || lista[i].id;

  function trocaRotulo(novoTxt, pFrente) {
    const antes = cur.textContent;
    if (!antes) { cur.textContent = novoTxt; return; }
    out.textContent = antes; cur.textContent = novoTxt;
    cur.style.setProperty('--sobe', pFrente ? '3px' : '-3px');
    out.style.setProperty('--sai', pFrente ? '-3px' : '3px');
    cur.classList.add('preparando'); out.classList.remove('saindo');
    void cur.getBoundingClientRect();
    requestAnimationFrame(() => { cur.classList.remove('preparando'); out.classList.add('saindo'); });
    setTimeout(() => { out.textContent = ''; out.classList.remove('saindo'); }, 210);
  }

  function pintar(v) {
    valor = clamp01(v, 0, ULT);
    box.style.setProperty('--ef-prog', String(ULT ? valor / ULT : 0));
    const novoIx = Math.round(valor);
    if (novoIx !== ix) { const frente = novoIx > ix; ix = novoIx; trocaRotulo(nome(ix), frente); }
    else if (!cur.textContent) cur.textContent = nome(ix);
    box.classList.toggle('ultra', ix === ULT);
    thumb.title = nome(ix) + (lista[ix].desc ? ' — ' + lista[ix].desc : '');
    thumb.setAttribute('aria-valuenow', String(ix));
    thumb.setAttribute('aria-valuetext', nome(ix));
  }

  // ímã: perto de um encaixe, puxa para ele
  function ima(v) {
    const perto = Math.round(v), d = v - perto, dist = Math.abs(d);
    if (dist < 0.001 || dist > 0.5) return v;
    const t = 1 - dist / 0.5;
    return v - d * (0.68 + 0.42 * t) * t * t;
  }

  function encaixar() {
    const alvo = Math.round(valor);
    if (Math.abs(alvo - valor) < 0.001) { aplicar(alvo); return; }
    let vel = 0;
    if (amostras.length >= 2) {
      const a = amostras[0], b = amostras[amostras.length - 1];
      vel = clamp01((b.v - a.v) / Math.max((b.t - a.t) / 1000, 0.016), -8, 8);
    }
    cancelAnimationFrame(frameMola);
    let pos = valor, tAnt = performance.now();
    const passo = (t) => {
      const dt = Math.min((t - tAnt) / 1000, 0.032); tAnt = t;
      vel += (-920 * (pos - alvo) - 40 * vel) * dt;
      pos = clamp01(pos + vel * dt, 0, ULT);
      pintar(pos);
      if (Math.abs(pos - alvo) < 0.001 && Math.abs(vel) < 0.01) { frameMola = 0; aplicar(alvo); return; }
      frameMola = requestAnimationFrame(passo);
    };
    frameMola = requestAnimationFrame(passo);
  }

  async function aplicar(i) { pintar(i); await trocarEsforco(P, lista[i].id); }

  const valorDoX = (clientX) => {
    const r = shell.getBoundingClientRect();
    const larg = 22;                                   // largura do puxador
    const util = Math.max(1, r.width - larg);
    return clamp01(((clientX - r.left - larg / 2) / util) * ULT, 0, ULT);
  };
  const comecar = (e) => {
    e.preventDefault(); e.stopPropagation();
    cancelAnimationFrame(frameMola);
    arrastando = true; box.classList.add('pegando');
    amostras = [{ t: performance.now(), v: valor }];
    pintar(ima(valorDoX(e.clientX)));
    const mover = (ev) => {
      const v = ima(valorDoX(ev.clientX));
      const agora = performance.now();
      amostras.push({ t: agora, v });
      amostras = amostras.filter(a => agora - a.t < 90).slice(-5);
      pintar(v);
    };
    const soltar = () => {
      window.removeEventListener('mousemove', mover);
      window.removeEventListener('mouseup', soltar);
      arrastando = false; box.classList.remove('pegando');
      encaixar();
    };
    window.addEventListener('mousemove', mover);
    window.addEventListener('mouseup', soltar);
  };
  shell.addEventListener('mousedown', comecar);
  thumb.addEventListener('keydown', (e) => {
    const alvos = { ArrowLeft: ix - 1, ArrowDown: ix - 1, ArrowRight: ix + 1, ArrowUp: ix + 1, Home: 0, End: ULT };
    if (!(e.key in alvos)) return;
    e.preventDefault(); aplicar(clamp01(alvos[e.key], 0, ULT));
  });
  box.addEventListener('mousedown', e => e.stopPropagation());
  $('.ef-help', box).addEventListener('click', (e) => { e.stopPropagation(); $('.ef-helpwrap', box).classList.toggle('aberto'); });

  /* ---- campo de pixels do último nível, na cor do painel ---- */
  let accent = [110, 168, 254];
  function lerAccent() {
    const c = getComputedStyle(P.el).getPropertyValue('--accent').trim();
    const m = c.match(/#([0-9a-f]{6})/i);
    if (m) accent = [parseInt(m[1].slice(0,2),16), parseInt(m[1].slice(2,4),16), parseInt(m[1].slice(4,6),16)];
  }
  function limparPixels() {
    const ctx = cv.getContext('2d'); if (ctx) ctx.clearRect(0, 0, cv.width, cv.height);
  }
  function medirCanvas() {
    const r = track.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
    return true;
  }
  function desenhar(t) {
    const ctx = cv.getContext('2d'); if (!ctx || !cv.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const L = cv.width / dpr, A = cv.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, L, A);
    const nivel = ULT ? valor / ULT : 0;          // 0 = apagado, 1 = no talo
    if (nivel <= 0.001) return;
    const forcaNivel = Math.pow(nivel, 0.85);
    const frente = 1 - revelar;
    const cel = L < 240 ? 4 : 5, vao = 1;
    const cols = Math.ceil(L / cel), lins = Math.ceil(A / cel);
    const passado = Math.max(0, t - ultraDesde);
    const fluxoBruto = passado / 4000;
    const fluxo = Math.floor(fluxoBruto) + suave(0, 1, fluxoBruto - Math.floor(fluxoBruto));
    const frio = [58, 58, 62];
    const quente = [Math.min(255, accent[0] + 60), Math.min(255, accent[1] + 60), Math.min(255, accent[2] + 60)];

    ctx.save(); ctx.beginPath(); ctx.roundRect(0, 0, L, A, 8); ctx.clip();
    for (let li = 0; li < lins; li++) {
      for (let co = 0; co < cols; co++) {
        const x = co * cel, y = li * cel;
        const nx = (x + cel / 2) / L;
        // acende so ate onde o puxador chegou, com a beirada suave
        const ateAqui = 1 - suave(nivel - 0.07, nivel + 0.03, nx);
        if (ateAqui <= 0.002) continue;
        const alfa = suave(frente - 0.1, frente + 0.07, nx) * ateAqui;
        if (alfa <= 0.002) continue;
        const quanto = suave(0.1, 0.9, nx / Math.max(nivel, 0.15));
        const forca = suave(0.04, 0.4, nx / Math.max(nivel, 0.15)) * forcaNivel;
        const h1 = Math.abs(Math.sin(co * 12.9898 + li * 78.233) * 43758.5453) % 1;
        const h2 = Math.abs(Math.sin(co * 7.13 + li * 19.41) * 19341.731) % 1;
        const h3 = Math.abs(Math.sin(co * 31.17 + li * 11.93) * 28437.123) % 1;
        const periodo = 500 + h2 * 1500;
        const tl = passado + h3 * periodo;
        const ciclo = Math.floor(tl / periodo), prog = (tl % periodo) / periodo;
        const hc = Math.abs(Math.sin(co * 17.17 + li * 41.73 + ciclo * 13.11) * 24634.6345) % 1;
        const hl = Math.abs(Math.sin(co * 5.37 + li * 29.11 + ciclo * 7.43) * 17391.443) % 1;
        const centro = 0.2 + hc * 0.55, larg = 0.09 + hl * 0.08;
        const d = (prog - centro) / larg;
        const pulso = Math.exp(-d * d * 1.45) * (hc > 0.12 ? 1 : 0.26);
        const fase = (nx + fluxo + li * 0.06 + h1 * 0.02) * Math.PI * 2;
        const onda = Math.pow(0.5 + 0.5 * Math.cos(fase), 5);
        const brilho = Math.max(pulso * (0.48 + onda * 0.58), onda * (0.38 + h1 * 0.28));
        const base = [entre(frio[0], accent[0], quanto), entre(frio[1], accent[1], quanto), entre(frio[2], accent[2], quanto)];
        const mistura = clamp01(brilho * (0.5 + hc * 0.35), 0, 1);
        ctx.globalAlpha = alfa * forca * clamp01(0.62 + brilho * 0.3, 0, 1);
        ctx.fillStyle = 'rgb(' + Math.round(entre(base[0], quente[0], mistura)) + ' '
          + Math.round(entre(base[1], quente[1], mistura)) + ' '
          + Math.round(entre(base[2], quente[2], mistura)) + ')';
        ctx.fillRect(x + vao / 2, y + vao / 2, cel - vao, cel - vao);
      }
    }
    ctx.restore(); ctx.globalAlpha = 1;
  }
  let ultimoQuadro = 0;
  function loopPixels() {
    if (framePx) return;
    // caixa ja removida (menu fechado): medirCanvas volta false pra sempre e o
    // retry se reagendava de 60 em 60ms ate o app fechar
    if (!box.isConnected) { framePx = 0; return; }
    lerAccent();
    if (!medirCanvas()) { setTimeout(loopPixels, 60); return; }
    const passo = (t) => {
      if (!box.isConnected) { framePx = 0; return; }
      if (t - ultimoQuadro >= 33) {
        ultimoQuadro = t;
        revelar = suave(0, 1, (t - ultraDesde) / 900);
        desenhar(t);
      }
      framePx = requestAnimationFrame(passo);
    };
    framePx = requestAnimationFrame(passo);
  }

  pintar(valor);
  cur.textContent = nome(ix);
  ultraDesde = performance.now();
  setTimeout(loopPixels, 30);
  return box;
}

async function trocarEsforco(P, id) {
  P.effort = id; cfg.defEffort = id; window.api.setConfig(cfg);
  if (P.engine === 'claude' && P.started) {
    await window.api.paneStop({ paneId: P.id, engine: P.engine });
    P.resumeId = P.sessaoId || P.resumeId;   // religa na MESMA conversa
    destravarPainel(P);
    P.started = false; setDot(P, 'off');
  }
  savePanes();
}

function avisoEnvio(P, txt) {
  clearEmpty(P);
  const d = document.createElement('div');
  d.className = 'envio-nota';
  d.textContent = txt;
  P.chat.appendChild(d);
  if (P.passosEl) P.chat.appendChild(P.passosEl);
  if (P.trabEl) P.chat.appendChild(P.trabEl);
  scroll(P, true);
  setTimeout(() => d.remove(), 9000);
  return d;
}

function subirNaLista(P) {
  const id = P.sessaoId || P.resumeId;
  const lista = histCache[P.engine];
  if (!id || !lista) return;
  const i = lista.findIndex(s => s.id === id);
  if (i < 0) return;
  lista[i].when = Date.now();
  lista.unshift(lista.splice(i, 1)[0]);
  const aba = $('.side-view[data-view="h' + P.engine + '"]');
  if (aba && !aba.classList.contains('hidden')) paintHist(P.engine, lista);
}

function pintarNome(P) {
  const barra = $('.pane-nome', P.el);
  const t = (P.titulo || '').trim();
  barra.classList.toggle('vazio', !t);
  $('.pn-txt', barra).textContent = t;
  barra.title = t;
}

function renomearAqui(P) {
  const barra = $('.pane-nome', P.el);
  if ($('.pn-input', barra)) return;
  const txt = $('.pn-txt', barra), lapis = $('.pn-edit', barra);
  const inp = document.createElement('input');
  inp.className = 'pn-input';
  inp.value = P.titulo || '';
  txt.style.display = 'none'; lapis.style.display = 'none';
  barra.insertBefore(inp, txt);
  inp.focus(); inp.select();
  let pronto = false;
  const fim = async (salvar) => {
    if (pronto) return; pronto = true;
    const novo = inp.value.trim();
    inp.remove(); txt.style.display = ''; lapis.style.display = '';
    if (salvar && novo && novo !== P.titulo) {
      P.titulo = novo; P.nomeManual = true; pintarNome(P); savePanes();
      const id = P.sessaoId || P.resumeId;
      if (id) { await window.api.renomear({ engine: P.engine, id, nome: novo });
        histCache[P.engine] = null;
        const aba = $('.side-view[data-view="h' + P.engine + '"]');
        if (aba && !aba.classList.contains('hidden')) loadHist(P.engine, true); }
    }
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); fim(true); }
    if (e.key === 'Escape') { e.stopPropagation(); fim(false); }
  });
  inp.addEventListener('blur', () => fim(true));
}

async function buscarNome(P) {
  if (P.engine !== 'claude' || !P.sessaoId || P.nomeManual) return;
  const t = await window.api.sessionTitulo({ engine: 'claude', file: P.sessaoFile, id: P.sessaoId });
  if (t && t !== P.titulo) { P.titulo = t; pintarNome(P); savePanes(); }
}

function pintarModo(P) {
  const m = modoDe(P);
  P.mode = m.id;
  $('.modo-ic', P.el).innerHTML = ico(m.ic);
  $('.modo-nome', P.el).textContent = m.nome;
}

function fecharMenus() {
  for (const P of panes.values()) {
    const m = $('.p-modal', P.el);
    if (m && m.classList.contains('como-menu')) { m.classList.add('hidden'); m.classList.remove('como-menu'); $('.modal-cx', m).innerHTML = ''; }
    soltarNavArquivos(P);
  }
  fecharPopGlobal();
}
document.addEventListener('click', fecharMenus);

// link de site sempre abre no navegador do sistema, nunca dentro do app
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a) return;
  const href = a.getAttribute('href') || '';
  if (a.classList.contains('arquivo')) return;
  // ancora (#secao): nao deixa navegar de verdade. A pagina do app nao tem
  // secoes pra pular, e a navegacao dispararia o desligamento dos motores.
  if (href.startsWith('#')) { e.preventDefault(); return; }
  e.preventDefault(); e.stopPropagation();
  if (/^https?:\/\//i.test(href)) window.api.abrirLink(href);
  else if (href.startsWith('file://')) window.api.abrirLink(decodeURIComponent(href.replace('file://', '')));
  else if (href.startsWith('/')) window.api.abrirLink(href);
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // dentro do terminal embutido, Esc é do terminal, não fecha a janelinha
  const dentroTerm = document.activeElement && document.activeElement.closest && document.activeElement.closest('.term-wrap');
  if (dentroTerm) return;
  if (!$('#popGrupo').classList.contains('hidden')) { fecharPopGlobal(); return; }
  if (!$('#modalGrupo').classList.contains('hidden')) { fecharModalGlobal(); return; }
  const visorAberto = [...panes.values()].some(P => !$('.p-visor', P.el).classList.contains('hidden'));
  if (visorAberto) { fecharVisor(); return; }
  const popupAberto = [...panes.values()].some(P => !$('.p-modal', P.el).classList.contains('hidden'));
  if (popupAberto) {
    fecharMenus();
    // o terminal so' morre no painel em que voce esta: Esc no painel B nao pode
    // derrubar o login que esta rodando no painel A. E o painel A tambem nao
    // pode ter a janelinha ESCONDIDA com o processo vivo por tras dela.
    if (focusPane) fecharTerminalDoPainel(focusPane);
    for (const P of panes.values()) if (!P._fecharTerm) fecharModal(P);
    return;
  }
  // sem popup: para o que a IA estiver fazendo
  const alvo = (focusPane && focusPane.busy) ? [focusPane] : [...panes.values()].filter(P => P.busy);
  for (const P of alvo) window.api.paneInterrupt({ paneId: P.id, engine: P.engine });
});

function novoMenu(P) {
  fecharMenus();
  const modal = $('.p-modal', P.el);
  modal.classList.remove('hidden');
  modal.classList.add('como-menu');
  modal.onclick = (e) => { if (e.target === modal) fecharMenus(); };
  const cx = $('.modal-cx', modal);
  cx.className = 'modal-cx';
  cx.innerHTML = '';
  cx.onclick = (e) => e.stopPropagation();
  return cx;
}
function elItem({ ic, nome, desc, tag, on }, aoClicar) {
  const d = document.createElement('div');
  d.className = 'mi' + (on ? ' on' : '');
  d.innerHTML = '<div class="mi-ic"></div><div class="mi-txt"><div class="mi-n"></div></div>'
    + (on ? '<div class="mi-ck">' + ico('check') + '</div>' : (tag ? '<div class="mi-tag"></div>' : ''));
  $('.mi-ic', d).innerHTML = ic ? (ICONES[ic] ? ico(ic) : '<span class="ic-txt">' + ic + '</span>') : '';
  $('.mi-n', d).textContent = nome;
  if (desc) { const e = document.createElement('div'); e.className = 'mi-d'; e.textContent = desc; $('.mi-txt', d).appendChild(e); }
  if (tag && !on) $('.mi-tag', d).textContent = tag;
  d.addEventListener('click', () => { fecharMenus(); aoClicar && aoClicar(); });
  return d;
}
function subPopup(txt) {
  const d = document.createElement('div');
  d.className = 'mo-sub';
  d.textContent = txt;
  return d;
}
function tituloPopup(txt, dica) {
  const d = document.createElement('div');
  d.className = 'mo-top';
  d.innerHTML = '<span class="mo-tit"></span><button class="mo-x">' + ico('x') + '</button>';
  $('.mo-tit', d).textContent = txt;
  $('.mo-x', d).onclick = () => fecharMenus();
  if (dica) { const e = document.createElement('div'); e.className = 'mo-sub'; e.textContent = dica; d.dataset.temSub = '1'; }
  return d;
}
function elSecao(txt) { const d = document.createElement('div'); d.className = 'menu-secao'; d.textContent = txt; return d; }
function elLinha() { const d = document.createElement('div'); d.className = 'menu-linha'; return d; }

/* ---- menu de Modos + barrinha de esforço ---- */
function menuModos(P) {
  const m = novoMenu(P);
  m.appendChild(tituloPopup('Modos'));
  m.appendChild(subPopup('O que ele pode fazer sem te perguntar.'));

  for (const mo of MODOS[P.engine]) {
    m.appendChild(elItem({ ic: mo.ic, nome: mo.nome, desc: mo.desc, on: mo.id === P.mode }, async () => {
      P.mode = mo.id; cfg.defMode = mo.id; window.api.setConfig(cfg); pintarModo(P);
      await window.api.paneStop({ paneId: P.id, engine: P.engine });
      // so o Claude reaplica o modo ao retomar; no Codex a politica antiga ficaria valendo
      if (P.engine === 'claude') P.resumeId = P.sessaoId || P.resumeId;
      destravarPainel(P);
      P.started = false; setDot(P, 'off');
      note(P, 'Modo: ' + mo.nome + ' — ' + mo.desc.toLowerCase() + '.');
      savePanes();
    }));
  }
  m.appendChild(elLinha());

  m.appendChild(barraEsforco(P));
}

/* ---- menu de modelos (no cabeçalho) ---- */
async function menuModelos(P) {
  const m = novoMenu(P);
  const pintar = () => {
    m.innerHTML = '';
    m.appendChild(tituloPopup('Modelo'));
    m.appendChild(subPopup('Qual cérebro este painel vai usar, e quanto ele deve pensar.'));
    for (const mo of modelosDe(P)) {
      m.appendChild(elItem({ nome: mo.nome, desc: mo.desc, on: mo.id === P.model }, async () => {
        P.model = mo.id;
        const ef = esforcosDe(P);
        if (!ef.find(e => e.id === P.effort)) P.effort = mo.padraoEffort || ef[0].id;
        fillModels(P);
        await window.api.paneStop({ paneId: P.id, engine: P.engine });
        if (P.engine === 'claude') P.resumeId = P.sessaoId || P.resumeId;
        destravarPainel(P);
        P.started = false; setDot(P, 'off'); savePanes();
      }));
    }
    m.appendChild(elLinha());
    m.appendChild(barraEsforco(P));
  };
  pintar();
  if (P.engine === 'codex' && !MODELOS_CODEX) {
    MODELOS_CODEX = (await window.api.codexModels()) || null;
    if (MODELOS_CODEX && MODELOS_CODEX.length) { fillModels(P); pintar(); }
  }
}

/* ---- menu do + ---- */
function menuAnexo(P) {
  const m = novoMenu(P);
  m.appendChild(tituloPopup('Anexar'));
  m.appendChild(subPopup('Manda o caminho do arquivo junto com a sua mensagem.'));
  const itens = [
    { ic: 'upload', nome: 'Enviar do computador', desc: 'escolher arquivos', act: 'file' },
    { ic: 'image', nome: 'Enviar imagem', desc: 'png, jpg, webp', act: 'image' },
    { ic: 'folder', nome: 'Adicionar pasta', desc: 'manda o caminho da pasta', act: 'folder' },
    { ic: 'map-pin', nome: 'Pasta deste painel', desc: shortPath(P.cwd), act: 'cwd' },
  ];
  for (const i of itens) m.appendChild(elItem(i, async () => {
    if (i.act === 'cwd') return inserirNoInput(P, P.cwd);
    const files = await window.api.pickFiles(i.act);
    if (files && files.length) {
      if (i.act === 'folder') inserirNoInput(P, files.join(' '));
      else await anexar(P, files);
    }
  }));
}

/* ---- menu do / (ações, modelo e comandos) ---- */
async function menuSkills(P, filtroInicial, focar) {
  const m = novoMenu(P);
  m.appendChild(tituloPopup('Ações e comandos'));
  const busca = document.createElement('input');
  busca.className = 'menu-search';
  busca.placeholder = 'Filtrar ações…';
  m.appendChild(busca);
  const corpo = document.createElement('div');
  m.appendChild(corpo);

  const acoes = [
    { sec: 'Contexto', ic: 'upload', nome: 'Anexar arquivo…', act: () => menuAnexo(P) },
    { sec: 'Contexto', ic: 'folder', nome: 'Mencionar a pasta deste painel', act: () => inserirNoInput(P, P.cwd) },
    { sec: 'Contexto', ic: 'eraser', nome: 'Limpar a tela', desc: 'a conversa continua', act: () => { P.chat.innerHTML = ''; P.blocks.clear(); P.tools.clear(); } },
    { sec: 'Contexto', ic: 'sparkles', nome: 'Começar conversa nova', act: () => novaConversa(P.engine) },
    { sec: 'Modelo', ic: 'brain', nome: 'Trocar modelo…', tag: modeloAtual(P).nome, act: () => menuModelos(P) },
    { sec: 'Modelo', ic: 'sliders-horizontal', nome: 'Esforço', tag: EF_PT[P.effort] || P.effort, act: () => menuModelos(P) },
    { sec: 'Modelo', ic: 'lock', nome: 'Modos de permissão', tag: modoDe(P).nome, act: () => menuModos(P) },
    { sec: 'Modelo', ic: 'unlock', nome: 'Limpar liberações automáticas', desc: 'volta a perguntar sobre as ferramentas que você liberou neste painel', act: async () => {
      await window.api.liberacoes({ paneId: P.id, limpar: true });
      note(P, 'Pronto: volto a perguntar antes de usar qualquer ferramenta.');
    } },
    { sec: 'Modelo', ic: 'arrow-left-right', nome: 'Trocar de motor', tag: P.engine === 'codex' ? 'Codex' : 'Claude', desc: 'continua a mesma conversa com o outro', act: () => trocarMotor(P, P.engine === 'codex' ? 'claude' : 'codex') },
    { sec: 'Painel', ic: 'folder-open', nome: 'Trocar a pasta deste painel', tag: nomePasta(P.cwd), act: () => $('.p-cwd', P.el).click() },
    { sec: 'Painel', ic: 'plus', nome: 'Abrir outro painel ao lado', act: () => { if (totalDePaineis() < 12) newPane({ engine: P.engine, cwd: P.cwd }); } },
    { sec: 'Painel', ic: 'arrow-left-right', nome: 'Continuar em outro painel', desc: 'leva o assunto pra um painel novo, sem mexer neste', act: () => ramificar(P) },
    { sec: 'Conectores', ic: 'plug', nome: 'conectores', desc: 'ver, reconectar ou adicionar um conector', act: () => janelaConectores(P) },
    { sec: 'Painel', ic: 'terminal', nome: 'terminal', desc: 'rodar comandos aqui dentro, sem abrir o Terminal do sistema', act: () => janelaTerminal(P, linhaShell(P.cwd, remotoDoPane(P)), 'Terminal — ' + (remotoDoPane(P) ? nomeCurtoDaAba(abaPorId(P.abaId)) : nomePasta(P.cwd))) },
    { sec: 'Conta', ic: 'arrow-left-right', nome: 'Trocar de conta', desc: 'alternar entre as contas já guardadas, sem sair desta conversa', act: () => menuContas(P.engine, ancoraDoPainel(P), null) },
    { sec: 'Conta', ic: 'key-round', nome: 'login', desc: 'entrar com outra conta ' + (P.engine === 'codex' ? 'do Codex' : 'do Claude'), act: () => contaAcao(P, 'login') },
    { sec: 'Conta', ic: 'log-out', nome: 'logout', desc: 'sair da conta atual', act: () => contaAcao(P, 'logout') },
    { sec: 'Conta', ic: 'user', nome: 'conta', desc: 'quem está entrado e quanto do limite já foi', act: () => janelaConta(P) },
  ];

  let skills = [];
  const pintar = (f) => {
    corpo.innerHTML = '';
    const q = (f || '').toLowerCase().replace(/^\//, '');
    let secAtual = '';
    for (const a of acoes) {
      if (q && !a.nome.toLowerCase().includes(q)) continue;
      if (a.sec !== secAtual) { secAtual = a.sec; corpo.appendChild(elSecao(a.sec)); }
      corpo.appendChild(elItem(a, () => {
        const inp = $('.p-input', P.el);
        if (inp.value.startsWith('/') && !inp.value.includes(' ')) { inp.value = ''; inp.style.height = 'auto'; }
        a.act();
      }));
    }
    // quem bate no nome vem antes de quem so bate na descricao
    const porNome = skills.filter(sk => q && sk.name.toLowerCase().includes(q));
    const porDesc = q ? skills.filter(sk => !sk.name.toLowerCase().includes(q) && (sk.desc || '').toLowerCase().includes(q)) : skills;
    const vis = (q ? [...porNome, ...porDesc] : skills).slice(0, 150);
    if (vis.length) {
      corpo.appendChild(elSecao('Comandos e skills' + (skills.length ? ' (' + skills.length + ')' : '')));
      for (const sk of vis) corpo.appendChild(elItem({ ic: '/', nome: sk.name, desc: sk.desc }, () => {
        const inp = $('.p-input', P.el);
        if (inp.value.startsWith('/') && !inp.value.includes(' ')) inp.value = '';
        inserirNoInput(P, '/' + sk.name);
      }));
    } else if (!corpo.children.length) {
      corpo.innerHTML = '<div class="menu-empty">Nada encontrado.</div>';
    }
  };
  busca.value = filtroInicial || '';
  pintar(busca.value);
  busca.addEventListener('input', () => pintar(busca.value));
  // setas + Enter: antes so' dava pra escolher com o mouse
  busca.addEventListener('keydown', (ev) => {
    const itens = [...corpo.querySelectorAll('.mi')];
    if (!itens.length) return;
    let i = itens.findIndex(x => x.classList.contains('sel'));
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      i = ev.key === 'ArrowDown' ? (i + 1) % itens.length : (i <= 0 ? itens.length - 1 : i - 1);
      itens.forEach(x => x.classList.remove('sel'));
      itens[i].classList.add('sel');
      itens[i].scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      (itens[i >= 0 ? i : 0]).click();
    }
  });
  if (filtroInicial === undefined || focar) setTimeout(() => { busca.focus(); busca.setSelectionRange(busca.value.length, busca.value.length); }, 30);
  skills = (await window.api.skills(P.engine)) || [];
  pintar(busca.value);
}

/* ---- faixa de avisos no topo da janela (estilo VS Code) ----
   Aviso importante nao pode ficar so' dentro de um painel: some no meio da
   conversa e voce nunca ve. */
/* guarda COMO voce dispensou: { nivel, reseta }.
   - nivel: se o aperto piorar, volta a avisar.
   - reseta: quando a semana (ou a sessao) vira, a dispensa antiga morre junto.
     Sem isso, dispensar em 100% calava o aviso na semana seguinte inteira. */
const avisosFechados = new Map();
function mostrarAviso({ id, texto, tipo, acao, aoClicar, fixo, nivel, reseta }) {
  const caixa = $('#avisos');
  if (!caixa) return;
  // dispensado antes: fica calado ate' a situacao piorar ou a janela virar
  if (id && avisosFechados.has(id)) {
    const antes = avisosFechados.get(id) || {};
    const virou = reseta && antes.reseta && reseta !== antes.reseta;
    const piorou = typeof nivel === 'number' && typeof antes.nivel === 'number' && nivel > antes.nivel;
    if (!virou && !piorou) return;
    avisosFechados.delete(id);
  }
  // ja esta na tela: atualiza o texto em vez de empilhar outra tarja
  const existente = id && $('[data-aviso="' + id + '"]', caixa);
  if (existente) {
    const t = $('.avi-txt', existente);
    if (t) t.textContent = texto;
    existente.className = 'aviso aviso-' + (tipo || 'info');
    if (typeof nivel === 'number') existente.dataset.nivel = String(nivel);
    if (reseta) existente.dataset.reseta = String(reseta);
    const ic = $('.av-ic', existente);
    if (ic) ic.innerHTML = ico(tipo === 'alerta' ? 'circle-help' : tipo === 'erro' ? 'x' : 'circle');
    // se agora tem acao e antes nao tinha, o botao precisa aparecer
    if (acao && !$('.avi-acao', existente)) {
      const bt = document.createElement('button');
      bt.className = 'avi-acao';
      bt.textContent = acao;
      bt.onclick = () => { try { aoClicar && aoClicar(); } catch {} existente.remove(); };
      existente.insertBefore(bt, $('.avi-x', existente));
    }
    return;
  }
  const d = document.createElement('div');
  d.className = 'aviso aviso-' + (tipo || 'info');
  if (id) d.dataset.aviso = id;
  d.innerHTML = '<span class="av-ic"></span><span class="avi-txt"></span>'
    + (acao ? '<button class="avi-acao"></button>' : '')
    + '<button class="avi-x"></button>';
  $('.av-ic', d).innerHTML = ico(tipo === 'alerta' ? 'circle-help' : tipo === 'erro' ? 'x' : 'circle');
  $('.avi-txt', d).textContent = texto;
  if (acao) {
    $('.avi-acao', d).textContent = acao;
    $('.avi-acao', d).onclick = () => { try { aoClicar && aoClicar(); } catch {} d.remove(); };
  }
  $('.avi-x', d).innerHTML = ico('x');
  if (typeof nivel === 'number') d.dataset.nivel = String(nivel);
  if (reseta) d.dataset.reseta = String(reseta);
  // le do elemento, nao da chamada que criou: a tarja se atualiza sozinha e o
  // X tem que gravar o que esta' na tela AGORA
  const comoEsta = () => ({
    nivel: d.dataset.nivel !== undefined ? Number(d.dataset.nivel) : 0,
    reseta: d.dataset.reseta !== undefined ? Number(d.dataset.reseta) : 0,
  });
  $('.avi-x', d).onclick = () => { if (id) avisosFechados.set(id, comoEsta()); d.remove(); };
  caixa.appendChild(d);
  // some sozinho, mas NAO cala pra sempre: se o limite subir, avisa de novo
  if (!fixo) setTimeout(() => { if (id) avisosFechados.set(id, comoEsta()); d.remove(); }, 20000);
}

/* avisa quando o limite de uso esta perto do fim - o dado ja existia, so'
   nao chegava ate voce a nao ser que abrisse a lista de conversas */
function checarLimite(engine, c) {
  if (!c || !c.entrou) return;
  const nome = engine === 'codex' ? 'Codex' : 'Claude';
  const sem = c.semana && c.semana.pct;
  const ses = c.sessao && c.sessao.pct;
  if (sem >= 80) {
    mostrarAviso({
      id: 'limite-semana-' + engine, nivel: sem, reseta: c.semana.reseta,
      tipo: sem >= 95 ? 'erro' : 'alerta', fixo: true,
      texto: 'Você já usou ' + sem + '% do limite semanal do ' + nome
        + (c.semana.reseta ? ' · zera ' + quandoFuturo(c.semana.reseta) : ''),
      acao: 'ver conta',
      aoClicar: () => { if (focusPane) janelaConta(focusPane); },
    });
  }
  if (ses >= 90) {
    mostrarAviso({
      id: 'limite-sessao-' + engine, nivel: ses, reseta: c.sessao.reseta,
      tipo: 'alerta',
      texto: 'Sessão do ' + nome + ' em ' + ses + '%' + (c.sessao.reseta ? ' · zera ' + quandoFuturo(c.sessao.reseta) : ''),
    });
  }
}

/* ---- cartao da conta, no topo da lista de conversas ---- */
async function pintarCartaoConta(engine) {
  const alvo = $(engine === 'claude' ? '#contaClaude' : '#contaCodex');
  if (!alvo) return;
  // ler a conta demora (o do Claude tem prazo de 25s): se outra pintura comecar
  // no meio, esta aqui desiste em vez de empilhar botao repetido
  const geracao = (alvo._geracao = (alvo._geracao || 0) + 1);
  let c = null;
  try { c = await window.api.contaLer(engine); } catch {}
  if (geracao !== alvo._geracao) return;
  if (!c || !c.entrou) {
    alvo.innerHTML = '<button class="ct-entrar">Entrar no ' + (engine === 'codex' ? 'Codex' : 'Claude') + '</button>';
    $('.ct-entrar', alvo).onclick = () => { if (focusPane) contaAcao(focusPane, 'login'); };
    // tem conta guardada? entao da' pra voltar pra ela sem refazer login
    try {
      const gs = await window.api.contasListar(engine) || [];
      if (geracao !== alvo._geracao) return;
      if (gs.length) {
        const b = document.createElement('button');
        b.className = 'ct-guardadas';
        b.textContent = gs.length === 1 ? 'Usar a conta guardada' : 'Usar uma conta guardada';
        b.onclick = (e) => { e.stopPropagation(); menuContas(engine, b, null); };
        alvo.appendChild(b);
      }
    } catch {}
    return;
  }
  checarLimite(engine, c);
  const email = c.email || c.nome || '—';
  const inicial = (email.trim()[0] || '?').toUpperCase();
  alvo.innerHTML = '<button class="ct-bt">'
    + '<span class="ct-ini"></span>'
    + '<span class="ct-info"><span class="ct-email"></span><span class="ct-plano"></span></span>'
    + '<span class="ct-seta"></span></button>';
  $('.ct-ini', alvo).textContent = inicial;
  $('.ct-ini', alvo).style.background = engine === 'codex' ? 'var(--codex)' : 'var(--claude)';
  $('.ct-email', alvo).textContent = email;
  $('.ct-plano', alvo).textContent = [c.plano, c.via].filter(Boolean).join(' · ') || 'conectado';
  $('.ct-seta', alvo).innerHTML = ico('chevron-down');
  $('.ct-bt', alvo).title = email;
  $('.ct-bt', alvo).onclick = (e) => { e.stopPropagation(); menuContas(engine, $('.ct-bt', alvo), c); };
}

/* o popup precisa se pendurar em algo que NAO some quando o menu fecha */
function ancoraDoPainel(P) {
  return (P && P.el && ($('.p-model', P.el) || $('.p-head', P.el))) || (P && P.el) || document.body;
}

async function menuContas(engine, ancora, c) {
  const pop = abrirPopGlobal(ancora);
  const nomeEngine = engine === 'codex' ? 'Codex' : 'Claude';
  const item = (texto, sub, icone, aoClicar, marcado) => {
    const d = document.createElement('div');
    d.className = 'mi' + (marcado ? ' on' : '');
    d.innerHTML = '<div class="mi-ic"></div><div class="mi-txt"><div class="mi-n"></div></div>'
      + (marcado ? '<div class="mi-ck">' + ico('check') + '</div>' : '');
    $('.mi-ic', d).innerHTML = ico(icone);
    $('.mi-n', d).textContent = texto;
    if (sub) { const s = document.createElement('div'); s.className = 'mi-d'; s.textContent = sub; $('.mi-txt', d).appendChild(s); }
    d.addEventListener('click', () => { fecharPopGlobal(); aoClicar(); });
    return d;
  };

  let guardadas = [], podeGuardar = true;
  // aberto pelo painel: a conta ainda nao foi lida. Busca por fora pra sugerir o
  // apelido quando ele clicar em "Guardar", sem segurar o menu fechado ate la
  if (!c) { window.api.contaLer(engine).then((x) => { if (x && x.entrou) c = x; }).catch(() => {}); }
  // listar sempre: se a credencial sumiu (logout/expirou), e' exatamente quando
  // voce precisa ver as contas guardadas pra voltar pra uma
  try { guardadas = await window.api.contasListar(engine) || []; } catch {}
  try { const d = await window.api.contasDisponivel(engine); podeGuardar = !!(d && d.ok); } catch {}

  const cab = document.createElement('div');
  cab.className = 'menu-secao';
  cab.textContent = 'Conta do ' + nomeEngine;
  pop.appendChild(cab);

  if (guardadas.length) {
    for (const g of guardadas) {
      pop.appendChild(item(g.apelido, g.atual ? 'em uso agora' : 'trocar para esta', 'user', async () => {
        if (g.atual) return;
        // PRIMEIRO parar os motores: um Claude vivo renova o token e reescreve o
        // arquivo de credencial - trocar com ele rodando podia ser desfeito calado
        let religados = 0;
        // tambem os de segundo plano: um Claude vivo em OUTRA aba renova o
        // token e reescreve a credencial por cima da conta recem-trocada
        for (const Q of [...panes.values(), ...panesFundo.values()]) {
          if (Q.engine !== engine) continue;
          try { await window.api.paneStop({ paneId: Q.id, engine: Q.engine }); } catch {}
          if (Q.morto) continue;
          destravarPainel(Q);
          // religa na MESMA conversa: a sessao e' arquivo local, nao pertence a conta
          Q.resumeId = Q.sessaoId || Q.resumeId; Q.sessaoId = null;
          if (Q.started || Q.resumeId) religados++;   // painel que nunca rodou nao "religa"
          Q.started = false; setDot(Q, 'off');
        }
        // o Codex compartilha UM processo entre os paineis: parar painel nao
        // basta, tem que derrubar o motor pra ele reler a credencial
        if (engine === 'codex') { try { await window.api.codexReiniciar(); } catch {} }
        savePanes();
        const r = await window.api.contasTrocar({ engine, apelido: g.apelido });
        if (r && r.error) {
          // os paineis ja foram desligados aqui em cima: nao deixa ele achar
          // que nao aconteceu nada
          mostrarAviso({
            texto: r.error + (religados ? ' — a conta NÃO mudou; os painéis religam na conta de antes na próxima mensagem.' : ''),
            tipo: 'erro',
          });
          return;
        }
        await pintarCartaoConta(engine);
        carregarUsoSidebar(engine);
        mostrarAviso({
          texto: 'Conta do ' + nomeEngine + ' trocada para "' + g.apelido + '"'
            + (religados ? ' · ' + religados + ' painel(is) vão religar na conta nova na próxima mensagem' : ''),
          tipo: 'info',
        });
      }, g.atual));
    }
    pop.appendChild(Object.assign(document.createElement('div'), { className: 'menu-linha' }));
  }

  if (!podeGuardar) {
    const aviso = document.createElement('div');
    aviso.className = 'mi'; aviso.style.opacity = '.75';
    aviso.innerHTML = '<div class="mi-ic"></div><div class="mi-txt"><div class="mi-n"></div></div>';
    $('.mi-ic', aviso).innerHTML = ico('lock');
    $('.mi-n', aviso).textContent = 'Não dá para guardar a conta atual aqui';
    pop.appendChild(aviso);
  } else pop.appendChild(item('Guardar a conta de agora…', c && c.email ? c.email : '', 'plus', () => {
    // prompt() nao existe no Electron: usa o modal proprio do app
    pedirTexto({
      titulo: 'Guardar esta conta',
      dica: 'Dê um apelido para reconhecer depois. A conta fica guardada neste computador.',
      valor: (c && c.email || '').split('@')[0] || '',
      exemplo: 'ex: pessoal, trabalho',
      aoConfirmar: async (apelido) => {
        const r = await window.api.contasSalvar({ engine, apelido });
        if (r && r.error) mostrarAviso({ texto: r.error, tipo: 'erro' });
        else mostrarAviso({ texto: 'Conta guardada como "' + apelido + '". Agora dá pra alternar por aqui.', tipo: 'info' });
      },
    });
  }));
  pop.appendChild(item('Entrar com outra conta', 'abre o login do ' + nomeEngine, 'key-round', () => {
    if (focusPane) contaAcao(focusPane, 'login');
  }));
  pop.appendChild(item('Ver limite de uso', '', 'sliders-horizontal', () => { if (focusPane) janelaConta(focusPane); }));
  if (guardadas.length) {
    pop.appendChild(Object.assign(document.createElement('div'), { className: 'menu-linha' }));
    pop.appendChild(item('Esquecer uma conta guardada…', '', 'x', () => {
      // lista com botao de remover, em vez de pedir pra digitar o apelido
      const cx = abrirModalGlobal();
      cx.innerHTML = '<div class="mo-top"><span class="mo-tit">Contas guardadas</span>'
        + '<button class="mo-x">' + ico('x') + '</button></div>'
        + '<div class="mo-sub">Esquecer só apaga a cópia guardada aqui — não desconecta a conta.</div>'
        + '<div class="mo-lista" id="lstContas"></div>'
        + '<div class="mo-rodape"><button class="mo-btn" id="ctFechar">Fechar</button></div>';
      $('.mo-x', cx).onclick = fecharModalGlobal;
      $('#ctFechar', cx).onclick = fecharModalGlobal;
      const lista = $('#lstContas', cx);
      const pintar = (itens) => {
        lista.innerHTML = '';
        if (!itens.length) { lista.innerHTML = '<div class="mo-carregando">Nenhuma conta guardada.</div>'; return; }
        for (const g of itens) {
          const linha = document.createElement('div');
          linha.className = 'co';
          linha.innerHTML = '<span class="co-pt ' + (g.atual ? 'ok' : 'off') + '"></span>'
            + '<span class="co-txt"><span class="co-n"></span><span class="co-s"></span></span>'
            + '<button class="co-bt">Esquecer</button>';
          $('.co-n', linha).textContent = g.apelido;
          $('.co-s', linha).textContent = g.atual ? 'em uso agora' : 'guardada';
          $('.co-bt', linha).onclick = async () => {
            const r = await window.api.contasEsquecer({ engine, apelido: g.apelido });
            if (r && r.error) { mostrarAviso({ texto: r.error, tipo: 'erro' }); return; }
            pintar((await window.api.contasListar(engine)) || []);
          };
          lista.appendChild(linha);
        }
      };
      pintar(guardadas);
    }));
  }
}

/* ---- completar caminho de arquivo com "@" ---- */
let buscaArqTimer = 0;
/* solta o atalho de setas do menu de arquivos. Se ficar preso, ele engole o
   Enter do campo e a mensagem nunca e' enviada. */
function soltarNavArquivos(P) {
  if (P && P._navArq && P._navArqInp) {
    try { P._navArqInp.removeEventListener('keydown', P._navArq, true); } catch {}
  }
  if (P) { P._navArq = null; P._navArqInp = null; }
}
async function menuArquivos(P, termo, posArroba) {
  const remoto = remotoDoPane(P);
  if (remoto) return;   // painel remoto: a busca teria que ir por SSH, fica pra depois
  clearTimeout(buscaArqTimer);
  buscaArqTimer = setTimeout(async () => {
    let itens = [];
    try { itens = await window.api.buscarArquivos({ cwd: P.cwd, termo }) || []; } catch {}
    if (!itens.length) { if ($('.menu-arquivos', P.el)) fecharMenus(); return; }
    const m = novoMenu(P);
    m.classList.add('menu-arquivos');
    m.appendChild(tituloPopup('Arquivos'));
    m.appendChild(subPopup('Escolha para colar o caminho na mensagem.'));
    const corpo = document.createElement('div');
    m.appendChild(corpo);
    let sel = 0;
    const pintar = () => {
      corpo.innerHTML = '';
      itens.slice(0, 40).forEach((x, i) => {
        const d = elItem({ ic: 'file', nome: x.nome, desc: shortPath(x.path) }, () => {
          soltarNavArquivos(P);   // escolheu no mouse: solta o atalho tambem
          const inp = $('.p-input', P.el);
          const v = inp.value;
          const cursor = inp.selectionStart || v.length;
          // troca o "@trecho" pelo caminho escolhido
          const antes = v.slice(0, cursor).replace(/@([^\s@]*)$/, '');
          inp.value = antes + x.path + ' ' + v.slice(cursor);
          inp.focus();
          inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 190) + 'px';
          const fim = (antes + x.path + ' ').length;
          inp.setSelectionRange(fim, fim);
        });
        if (i === sel) d.classList.add('sel');
        corpo.appendChild(d);
      });
    };
    pintar();
    // setas funcionam sem tirar o foco do campo de escrever
    const inp = $('.p-input', P.el);
    soltarNavArquivos(P);          // nunca deixa dois presos ao mesmo tempo
    const nav = (ev) => {
      // menu ja saiu da tela (escolheu no mouse, fechou por fora): se solta
      if (!corpo.isConnected) { soltarNavArquivos(P); return; }
      const vis = [...corpo.querySelectorAll('.mi')];
      if (!vis.length) return;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault(); ev.stopPropagation();
        sel = ev.key === 'ArrowDown' ? (sel + 1) % vis.length : (sel <= 0 ? vis.length - 1 : sel - 1);
        pintar(); corpo.children[sel] && corpo.children[sel].scrollIntoView({ block: 'nearest' });
      } else if (ev.key === 'Enter' && corpo.children[sel]) {
        ev.preventDefault(); ev.stopPropagation();
        corpo.children[sel].click();
        soltarNavArquivos(P);
      } else if (ev.key === 'Escape') {
        fecharMenus(); soltarNavArquivos(P);
      }
    };
    P._navArq = nav; P._navArqInp = inp;
    inp.addEventListener('keydown', nav, true);
  }, 140);
}

/* ---- buscar dentro da conversa aberta (Ctrl+F) ---- */
function buscarNoPainel(P) {
  if (!P) return;
  let barra = $('.p-busca', P.el);
  if (barra) { $('input', barra).focus(); $('input', barra).select(); return; }
  barra = document.createElement('div');
  barra.className = 'p-busca';
  barra.innerHTML = '<input placeholder="Buscar nesta conversa…"><span class="pb-conta"></span>'
    + '<button class="pb-bt" data-ir="-1">↑</button><button class="pb-bt" data-ir="1">↓</button>'
    + '<button class="pb-x"></button>';
  $('.pb-x', barra).innerHTML = ico('x');
  P.el.insertBefore(barra, P.chat);
  const campo = $('input', barra);
  let achados = [], atual = -1;

  const limpar = () => {
    for (const marca of [...P.chat.querySelectorAll('.busca-hit')]) {
      const pai = marca.parentNode;
      pai.replaceChild(document.createTextNode(marca.textContent), marca);
      pai.normalize();
    }
    achados = []; atual = -1;
  };
  const procurar = () => {
    limpar();
    const termo = campo.value.trim().toLowerCase();
    if (!termo) { $('.pb-conta', barra).textContent = ''; return; }
    // marca sobre nos de TEXTO, pra nao estragar o HTML ja renderizado
    const andar = (no) => {
      for (const filho of [...no.childNodes]) {
        if (filho.nodeType === 3) {
          const txt = filho.textContent;
          const baixo = txt.toLowerCase();
          if (baixo.indexOf(termo) < 0) continue;
          // marca TODAS as vezes que aparece, nao so' a primeira
          const frag = document.createDocumentFragment();
          let de = 0, i;
          while ((i = baixo.indexOf(termo, de)) >= 0) {
            if (i > de) frag.appendChild(document.createTextNode(txt.slice(de, i)));
            const marca = document.createElement('mark');
            marca.className = 'busca-hit';
            marca.textContent = txt.slice(i, i + termo.length);
            frag.appendChild(marca);
            achados.push(marca);
            de = i + termo.length;
          }
          if (de < txt.length) frag.appendChild(document.createTextNode(txt.slice(de)));
          filho.replaceWith(frag);
        } else if (filho.nodeType === 1 && !['SCRIPT', 'STYLE', 'MARK', 'INPUT', 'TEXTAREA'].includes(filho.tagName)) {
          andar(filho);
        }
      }
    };
    andar(P.chat);
    $('.pb-conta', barra).textContent = achados.length ? '1/' + achados.length : 'nada';
    if (achados.length) { atual = 0; focar(); }
  };
  const focar = () => {
    achados.forEach((x, i) => x.classList.toggle('atual', i === atual));
    if (achados[atual]) {
      achados[atual].scrollIntoView({ block: 'center', behavior: 'smooth' });
      $('.pb-conta', barra).textContent = (atual + 1) + '/' + achados.length;
    }
  };
  const ir = (passo) => {
    if (!achados.length) return;
    atual = (atual + passo + achados.length) % achados.length;
    focar();
  };
  let t = 0;
  campo.addEventListener('input', () => { clearTimeout(t); t = setTimeout(procurar, 200); });
  campo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); ir(e.shiftKey ? -1 : 1); }
    // sem o stopPropagation o Esc subia pro document e mandava PARAR o modelo:
    // fechar a busca no meio de uma resposta longa matava a resposta
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(); }
  });
  $$('.pb-bt', barra).forEach((b) => b.addEventListener('click', () => ir(Number(b.dataset.ir))));
  const fechar = () => { limpar(); barra.remove(); $('.p-input', P.el).focus(); };
  $('.pb-x', barra).addEventListener('click', fechar);
  campo.focus();
}

/* ---- avisa quando um painel fora de vista termina ou pede permissao ---- */
/* traz o painel pra vista mesmo quando ele ja e' o painel com foco
   (setFocus sai cedo nesse caso e nao rola a tela) */
function irAtePainel(P) {
  try { P.el.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' }); } catch {}
  const inp = $('.p-input', P.el);
  if (inp) inp.focus();
}

function painelVisivel(P) {
  try {
    const r = P.el.getBoundingClientRect();
    const caixa = $('#panes').getBoundingClientRect();
    return r.right > caixa.left + 40 && r.left < caixa.right - 40;
  } catch { return true; }
}
function tarjaAviso() {
  let t = $('#avisoPaineis');
  if (!t) {
    t = document.createElement('div');
    t.id = 'avisoPaineis';
    document.body.appendChild(t);
  }
  if (!t._itens) t._itens = new Map();
  return t;
}

/* desenhar e decidir-se-avisa sao coisas separadas: juntar as duas fazia o
   botao "ir" sair sem redesenhar e travar nos painteis seguintes */
function pintarTarjaAviso() {
  const tarja = tarjaAviso();
  // painel fechado no meio do caminho nao conta mais
  // painel fechado no meio do caminho nao conta - mas o que esta rodando em
  // outra aba CONTA, e era justamente ele que o aviso precisava mostrar
  // so' o painel FECHADO sai do aviso. O que rodou em outra aba - inclusive o
  // que ja se desligou sozinho ao terminar - continua valendo, e e' justamente
  // esse que o aviso existe pra mostrar
  for (const [id, it] of [...tarja._itens]) if (!it || !it.P || it.P.morto) tarja._itens.delete(id);
  const lista = [...tarja._itens.values()];
  if (!lista.length) { tarja.classList.remove('ver'); tarja.innerHTML = ''; return; }
  const primeiro = lista[0];
  tarja.innerHTML = '<span class="av-txt"></span><button class="av-ir">ir</button><button class="av-x"></button>';
  $('.av-txt', tarja).textContent = lista.length === 1
    ? ((primeiro.P.titulo ? '“' + primeiro.P.titulo.slice(0, 40) + '”: ' : '') + primeiro.texto)
    : lista.length + ' painéis pedindo atenção';
  $('.av-x', tarja).innerHTML = ico('x');
  tarja.classList.add('ver');
  $('.av-ir', tarja).onclick = () => {
    const alvo = [...tarja._itens.values()][0];
    if (alvo) {
      tarja._itens.delete(alvo.P.id);
      if (panes.has(alvo.P.id)) { setFocus(alvo.P); irAtePainel(alvo.P); piscar(alvo.P); }
      // terminou numa aba que nao esta na tela: leva voce ate la. Decide pela
      // ABA, nao pelo mapa - o painel pode ja ter se desligado ao terminar
      else if (alvo.P.abaId && alvo.P.abaId !== cfg.abaAtiva) {
        trocarAbaLocal(alvo.P.abaId).then(() => {
          const Q = panes.get(alvo.P.id)
            || [...panes.values()].find(q => q.sessaoId && q.sessaoId === (alvo.P.sessaoId || alvo.P.resumeId));
          if (Q) { setFocus(Q); irAtePainel(Q); piscar(Q); }
        });
      }
    }
    pintarTarjaAviso();   // redesenha SEMPRE, sem passar pela regra de "esta visivel?"
  };
  $('.av-x', tarja).onclick = () => { tarja._itens.clear(); pintarTarjaAviso(); };
  clearTimeout(tarja._t);
  tarja._t = setTimeout(() => { tarja._itens.clear(); pintarTarjaAviso(); }, 15000);
}

function avisarPainel(P, texto) {
  if (!P) return;
  // "fora de vista" e' tanto painel rolado pra fora quanto janela em segundo plano
  const foraDeVista = document.hidden || !painelVisivel(P);
  if (!foraDeVista) return;
  tarjaAviso()._itens.set(P.id, { P, texto });
  pintarTarjaAviso();
  if (document.hidden) {
    try { new Notification('Cockpit', { body: (P.titulo || 'Painel') + ': ' + texto, silent: true }); } catch {}
  }
}

/* ---- chip do git no cabecalho do painel ---- */
async function atualizarGit(P) {
  const chip = $('.p-git', P.el);
  if (!chip) return;
  if (remotoDoPane(P)) { chip.classList.add('hidden'); return; }
  let g = null;
  try { g = await window.api.gitStatus({ cwd: P.cwd }); } catch {}
  if (!g || !g.branch) { chip.classList.add('hidden'); return; }
  chip.classList.remove('hidden');
  const n = (g.arquivos || []).length;
  chip.textContent = g.branch + (n ? '  ±' + n : '');
  chip.title = n ? n + ' arquivo(s) alterado(s) — clique para ver' : 'Nada alterado nesta pasta';
  chip.onclick = (e) => {
    e.stopPropagation();
    if (!n) return;
    const pop = abrirPopGlobal(chip);
    for (const arq of g.arquivos.slice(0, 40)) {
      const d = document.createElement('div');
      d.className = 'mi';
      d.innerHTML = '<div class="mi-ic"></div><div class="mi-txt"><div class="mi-n"></div><div class="mi-d"></div></div>';
      $('.mi-ic', d).textContent = arq.estado || '?';
      $('.mi-n', d).textContent = baseNome(arq.nome);
      $('.mi-d', d).textContent = arq.nome;
      d.addEventListener('click', async () => {
        fecharPopGlobal();
        let texto = '';
        try { texto = await window.api.gitDiff({ cwd: P.cwd, arquivo: arq.nome }); } catch {}
        mostrarDiffGit(P, arq.nome, texto);
      });
      pop.appendChild(d);
    }
  };
}
function mostrarDiffGit(P, nome, texto) {
  const modal = $('.p-modal', P.el), cx = $('.modal-cx', modal);
  modal.classList.remove('hidden');
  modal.onclick = (e) => { if (e.target === modal) fecharModal(P); };
  cx.onclick = (e) => e.stopPropagation();
  cx.innerHTML = '<div class="mo-top"><span class="mo-tit"></span><button class="mo-x">' + ico('x') + '</button></div>'
    + '<div class="diff diff-git"></div>';
  $('.mo-tit', cx).textContent = nome;
  $('.mo-x', cx).onclick = () => fecharModal(P);
  const box = $('.diff', cx);
  if (!texto) { box.innerHTML = '<div class="df-info">Sem alterações para mostrar.</div>'; return; }
  for (const linha of texto.split('\n').slice(0, 4000)) {
    const d = document.createElement('div');
    const t = linha.startsWith('+') && !linha.startsWith('+++') ? 'mais'
      : linha.startsWith('-') && !linha.startsWith('---') ? 'menos'
      : linha.startsWith('@@') ? 'pulo' : 'igual';
    d.className = t === 'pulo' ? 'df-pulo' : 'df-l df-' + t;
    d.textContent = linha;
    box.appendChild(d);
  }
}

/* ---- janelinha de conectores, no meio da conversa ---- */
const nomeLimpo = (n) => String(n || '').replace(/^claude\.ai\s+/i, '').replace(/^mcp[-_ ]/i, '').trim();

/* a caixa do painel e' UMA so': abrir outra janela por cima do terminal
   deixava o pty rodando sem tela e o "depois de fechar" nunca acontecia */
function fecharTerminalDoPainel(P) {
  if (P && P._fecharTerm) { const f = P._fecharTerm; P._fecharTerm = null; f(); }
}
function fecharModal(P) {
  // matar o terminal e' decisao de quem fecha, nao efeito colateral de esconder
  // a caixa: o Esc global fecha a caixa de TODOS os paineis de uma vez
  const m = $('.p-modal', P.el);
  m.classList.add('hidden'); $('.modal-cx', m).innerHTML = '';
}

async function janelaConectores(P) {
  fecharMenus();
  fecharTerminalDoPainel(P);
  const modal = $('.p-modal', P.el);
  const cx = $('.modal-cx', modal);
  modal.classList.remove('hidden');
  modal.onclick = (e) => { if (e.target === modal) fecharModal(P); };
  cx.onclick = (e) => e.stopPropagation();

  const motor = P.engine === 'codex' ? 'Codex' : 'Claude';
  const cabeca = () =>
    '<div class="mo-top"><span class="mo-tit">Conectores</span><button class="mo-x">' + ico('x') + '</button></div>'
    + '<div class="mo-sub">Serviços ligados ao ' + motor + ' neste ' + ESTE_PC + '.</div>';

  cx.innerHTML = cabeca() + '<div class="mo-carregando">Verificando conectores…</div>';
  $('.mo-x', cx).onclick = () => fecharModal(P);

  const lista = await window.api.mcpList(P.engine);
  if (!modal || modal.classList.contains('hidden')) return;

  if (lista && lista.error) {
    cx.innerHTML = cabeca() + '<div class="mo-erro">' + lista.error + '</div>';
    $('.mo-x', cx).onclick = () => fecharModal(P);
    return;
  }

  const pintar = (arr) => {
    const linhas = arr.map((c, i) => {
      const classe = c.precisaEntrar ? 'falta' : (c.ligado ? 'ok' : 'off');
      return '<div class="co" data-i="' + i + '">'
        + '<span class="co-pt ' + classe + '"></span>'
        + '<span class="co-txt"><span class="co-n"></span><span class="co-s"></span></span>'
        + '<button class="co-bt ' + (c.precisaEntrar ? 'destaque' : 'some') + '" data-ac="login">'
        + (c.precisaEntrar ? 'Entrar' : 'Reconectar') + '</button>'
        + '<button class="co-bt some" data-ac="remove">Tirar</button>'
        + '</div>';
    }).join('');
    cx.innerHTML = cabeca()
      + '<div class="mo-lista">' + (linhas || '<div class="mo-carregando">Nenhum conector ainda.</div>') + '</div>'
      + '<div class="mo-rodape"><button class="mo-btn destaque" id="btAdd">Adicionar conector</button>'
      + '<button class="mo-btn" id="btRe">Atualizar</button></div>';
    $('.mo-x', cx).onclick = () => fecharModal(P);
    $$('.co', cx).forEach((el) => {
      const c = arr[Number(el.dataset.i)];
      $('.co-n', el).textContent = nomeLimpo(c.nome);
      $('.co-s', el).textContent = c.precisaEntrar ? 'precisa entrar' : c.status;
      el.title = c.nome + (c.alvo ? '\n' + c.alvo : '');
      $$('.co-bt', el).forEach(bt => bt.onclick = async () => {
        const ac = bt.dataset.ac;
        if (ac === 'remove' && !confirm('Tirar o conector "' + c.nome + '" do ' + motor + '?')) return;
        bt.textContent = '…';
        const r = await window.api.mcpAcao({ engine: P.engine, acao: ac, nome: c.nome });
        if (r && r.error) { bt.textContent = 'erro'; alert(r.error); return; }
        if (r && r.terminal) janelaTerminal(P, r.terminal, r.titulo || nomeLimpo(c.nome), () => janelaConectores(P));
        else janelaConectores(P);
      });
    });
    $('#btRe', cx).onclick = () => janelaConectores(P);
    $('#btAdd', cx).onclick = () => formConector(P);
  };
  pintar(lista || []);
}

function formConector(P) {
  const cx = $('.p-modal .modal-cx', P.el);
  const motor = P.engine === 'codex' ? 'Codex' : 'Claude';
  cx.innerHTML =
    '<div class="mo-top"><span class="mo-tit">Adicionar conector</span><button class="mo-x">' + ico('x') + '</button></div>'
    + '<div class="mo-sub">Cole o endereço que o serviço te deu. Se for um programa que roda aqui no ' + ESTE_PC + ', use o campo de baixo.</div>'
    + '<div class="mo-form">'
    + '<input id="cnNome" placeholder="Nome curto, ex: notion">'
    + '<input id="cnUrl" placeholder="Endereço, ex: https://mcp.notion.com/mcp">'
    + '<div class="mo-dica">ou, se for um programa local:</div>'
    + '<input id="cnCmd" placeholder="Comando, ex: npx -y @alguem/mcp-server">'
    + '</div>'
    + '<div class="mo-erro" id="cnErro" style="display:none"></div>'
    + '<div class="mo-rodape"><button class="mo-btn destaque" id="cnOk">Adicionar no ' + motor + '</button>'
    + '<button class="mo-btn" id="cnVolta">Voltar</button></div>';
  $('.mo-x', cx).onclick = () => fecharModal(P);
  $('#cnVolta', cx).onclick = () => janelaConectores(P);
  setTimeout(() => $('#cnNome', cx).focus(), 40);
  $('#cnOk', cx).onclick = async () => {
    const nome = $('#cnNome', cx).value.trim();
    const url = $('#cnUrl', cx).value.trim();
    const comando = $('#cnCmd', cx).value.trim();
    const erro = $('#cnErro', cx);
    if (!nome || (!url && !comando)) { erro.style.display = 'block'; erro.textContent = 'Preciso do nome e do endereço (ou do comando).'; return; }
    $('#cnOk', cx).textContent = 'adicionando…';
    const r = await window.api.mcpAcao({ engine: P.engine, acao: 'add', nome, url, comando });
    if (r && r.error) { erro.style.display = 'block'; erro.textContent = r.error; $('#cnOk', cx).textContent = 'Tentar de novo'; return; }
    fecharModal(P);
    avisoTemp(P, 'Conector "' + nome + '" adicionado. Vale na próxima conversa deste painel.');
    await window.api.paneStop({ paneId: P.id, engine: P.engine });
    if (P.morto) return;
    if (P.engine === 'claude') P.resumeId = P.sessaoId || P.resumeId;
    destravarPainel(P);   // era o unico paneStop do renderer que faltava
    P.started = false; setDot(P, 'off');
  };
}

/* Linha que abre um shell interativo na pasta do painel.
   No Mac o pty roda via /bin/sh, entao vale o shell do usuario (zsh).
   No Windows o pty roda via cmd.exe: pedimos o PowerShell 7 e caimos
   no PowerShell classico se ele nao existir. */
function linhaShell(cwd, remoto) {
  if (remoto) {
    // o til so' expande FORA das aspas: com aspas o cd falha calado e o terminal
    // abre na home em vez da pasta configurada (testado na VPS)
    const p = String(remoto.caminhoRemoto || '~').trim() || '~';
    const escapa = (s) => s.replace(/'/g, "'\\''");
    const cd = p === '~' ? 'cd ~'
      : p.startsWith('~/') ? "cd ~/'" + escapa(p.slice(2)) + "'"
      : "cd '" + escapa(p) + "'";
    const alvo = remoto.usuario + '@' + remoto.host;
    return 'ssh -t -i "' + remoto.chave + '" -o StrictHostKeyChecking=accept-new ' + alvo + ' "' + cd + ' || exit 1; exec \$SHELL -l"';
  }
  const ehWin = (window.api && window.api.plataforma)
    ? window.api.plataforma === 'win32'
    : /Windows/i.test(navigator.userAgent);
  if (ehWin) {
    const p = String(cwd || '').replace(/"/g, '');
    return 'cd /d "' + p + '" && (where pwsh >nul 2>nul && pwsh -NoLogo || powershell -NoLogo)';
  }
  return 'cd ' + JSON.stringify(cwd) + ' 2>/dev/null; exec ${SHELL:-/bin/zsh} -l';
}

/* ---- terminal embutido: roda o comando aqui dentro, sem abrir o Terminal do sistema ---- */
let termSeq = 0;
const termsVivos = new Map();
const REG_LINK = /https?:\/\/[^\s"'<>)\]]+/g;

window.api.onTermEvent(({ id, kind, data, code }) => {
  const t = termsVivos.get(id);
  if (!t) return;
  if (kind === 'data') { t.term.write(data); t.viu(data); }
  if (kind === 'exit') {
    t.vivo = false;
    t.term.write('\r\n\x1b[90m— terminou' + (code ? ' (código ' + code + ')' : ', tudo certo') + ' —\x1b[0m\r\n');
  }
});

function janelaTerminal(P, linha, titulo, aoFechar) {
  fecharMenus();
  const modal = $('.p-modal', P.el), cx = $('.modal-cx', modal);
  modal.classList.remove('hidden');
  cx.className = 'modal-cx cx-term';
  cx.onclick = (e) => e.stopPropagation();

  const id = 't' + bootId + '_' + (++termSeq);
  if (!P.terms) P.terms = new Set();
  P.terms.add(id);
  cx.innerHTML =
    '<div class="mo-top"><span class="mo-tit"></span><button class="mo-x">' + ico('x') + '</button></div>'
    + '<div class="mo-sub">Rodando aqui dentro do Cockpit. Se pedir para escolher ou colar algo, clique na tela preta e digite.</div>'
    + '<div class="term-wrap"><div class="term-tela"></div></div>'
    + '<div class="term-link"><span class="mono"></span><button>Abrir link</button></div>'
    + '<div class="mo-rodape"><button class="mo-btn" id="tmCancela">Cancelar</button>'
    + '<button class="mo-btn destaque" id="tmFecha">Fechar</button></div>';
  $('.mo-tit', cx).textContent = titulo || 'Terminal';

  const term = new Terminal({
    cols: 92, rows: 22, fontSize: 12, lineHeight: 1.25, cursorBlink: true, scrollback: 4000,
    fontFamily: '"Cascadia Mono", Consolas, ui-monospace, SFMono-Regular, Menlo, monospace',
    theme: { background: '#141416', foreground: '#dcdcdc', cursor: '#d8bd8a', selectionBackground: '#ffffff30' },
  });
  term.open($('.term-tela', cx));
  term.onData((d) => window.api.termInput({ id, data: d }));

  const elLink = $('.term-link', cx), txtLink = $('.mono', elLink);
  const reg = {
    term, buf: '', vivo: true,
    viu(d) {
      this.buf = (this.buf + d).slice(-8000);
      const achou = this.buf.match(REG_LINK);
      if (!achou) return;
      const u = achou[achou.length - 1].replace(/[.,;]+$/, '');
      if (txtLink.textContent === u) return;
      txtLink.textContent = u; elLink.classList.add('ver');
    },
  };
  termsVivos.set(id, reg);
  $('button', elLink).onclick = () => window.api.openUrl(txtLink.textContent);

  const fechar = () => {
    P._fecharTerm = null;
    window.api.termKill({ id });
    try { term.dispose(); } catch {}
    termsVivos.delete(id);
    if (P.terms) P.terms.delete(id);
    cx.className = 'modal-cx';
    fecharModal(P);
    aoFechar && aoFechar();
  };
  // Esc chama fecharModal direto: sem isto o login rodava, o pty ficava vivo e o
  // painel NUNCA religava na conta nova (quem faz isso e' o aoFechar)
  P._fecharTerm = fechar;
  modal.onclick = (e) => { if (e.target === modal) fechar(); };
  $('.mo-x', cx).onclick = fechar;
  $('#tmFecha', cx).onclick = fechar;
  $('#tmCancela', cx).onclick = () => { window.api.termInput({ id, data: '\x03' }); term.focus(); };

  window.api.termRun({ id, linha, cols: 92, rows: 22 }).then((r) => {
    if (r && r.error) term.write('\r\n\x1b[31m[não consegui rodar: ' + r.error + ']\x1b[0m\r\n');
  });
  setTimeout(() => term.focus(), 60);
}

function barraUso(titulo, j) {
  if (!j) return '';
  const pct = Math.min(100, Math.max(0, j.pct || 0));
  const cor = pct >= 90 ? 'perto' : pct >= 70 ? 'meio' : '';
  return '<div class="us">'
    + '<div class="us-top"><span>' + titulo + '</span><b>' + pct + '%</b></div>'
    + '<div class="us-bar"><span class="us-fill ' + cor + '" style="width:' + pct + '%"></span></div>'
    + '<div class="us-pe">' + (j.reseta ? 'zera ' + quandoFuturo(j.reseta) : 'sem prazo informado') + '</div>'
    + '</div>';
}
async function carregarUsoSidebar(engine) {
  const alvo = $(engine === 'claude' ? '#usoClaude' : '#usoCodex');
  if (!alvo) return;
  try {
    const c = await window.api.contaLer(engine);
    if (!c || !c.entrou) { alvo.innerHTML = ''; return; }
    checarLimite(engine, c);   // avisa na faixa do topo quando esta perto do fim
    // sessao/semana vazias podem ser um erro passageiro (ex: a propria API de uso
    // deu limite) - nesse caso mantem o que ja estava na tela, nao apaga
    if (!c.sessao && !c.semana) return;
    alvo.innerHTML = barraUso('Sessão', c.sessao) + barraUso('Semana', c.semana);
  } catch { /* e' so um indicador; se falhar, mantem o que ja estava na tela */ }
}

async function janelaConta(P) {
  fecharMenus();
  fecharTerminalDoPainel(P);
  const modal = $('.p-modal', P.el), cx = $('.modal-cx', modal);
  modal.classList.remove('hidden');
  modal.onclick = (e) => { if (e.target === modal) fecharModal(P); };
  cx.onclick = (e) => e.stopPropagation();
  const motor = P.engine === 'codex' ? 'Codex' : 'Claude';
  const topo = '<div class="mo-top"><span class="mo-tit">Conta do ' + motor + '</span>'
    + '<button class="mo-x">' + ico('x') + '</button></div>';
  cx.innerHTML = topo + '<div class="mo-carregando">Vendo a conta e o quanto já foi usado…</div>';
  $('.mo-x', cx).onclick = () => fecharModal(P);

  let c = null;
  try { c = await window.api.contaLer(P.engine); }
  catch (e) {
    cx.innerHTML = topo + '<div class="mo-sub">Não consegui falar com o ' + motor + ': ' + (e && e.message || e) + '</div>';
    $('.mo-x', cx).onclick = () => fecharModal(P);
    return;
  }
  if (modal.classList.contains('hidden')) return;
  if (!c || !c.entrou) {
    cx.innerHTML = topo + '<div class="mo-sub">Você não está entrado no ' + motor + ' neste ' + ESTE_PC + '.</div>'
      + '<div class="mo-rodape"><button class="mo-btn destaque" id="ctEntrar">Entrar</button></div>';
    $('.mo-x', cx).onclick = () => fecharModal(P);
    $('#ctEntrar', cx).onclick = () => { fecharModal(P); contaAcao(P, 'login'); };
    return;
  }

  const extra = c.extra && c.extra.teto
    ? '<div class="us-extra">' + (c.extra.ligado
        ? 'Crédito extra ligado: ' + c.extra.usado + ' de ' + c.extra.teto + ' ' + c.extra.moeda
        : 'Crédito extra desligado') + '</div>'
    : '';

  cx.innerHTML = topo
    + '<div class="ct-cab"><div class="ct-av"></div><div class="ct-txt">'
    + '<div class="ct-n"></div><div class="ct-e"></div></div>'
    + (c.plano ? '<span class="ct-plano"></span>' : '') + '</div>'
    + '<div class="mo-sub" style="margin-top:12px">Limite de uso</div>'
    + (c.sessao ? barraUso('Sessão de agora', c.sessao)
       : '<div class="us"><div class="us-top"><span>Sessão de agora</span><b>—</b></div>'
         + '<div class="us-pe">sem uso registrado na janela curta agora</div></div>')
    + barraUso('Semana', c.semana)
    + (!c.sessao && !c.semana ? '<div class="mo-sub">Não consegui ler o limite agora.</div>' : '')
    + extra
    + '<div class="mo-rodape"><button class="mo-btn" id="ctTrocar">Trocar de conta</button>'
    + '<button class="mo-btn" id="ctSair">Sair</button></div>';

  $('.mo-x', cx).onclick = () => fecharModal(P);
  $('.ct-av', cx).innerHTML = svgMotor(P.engine);
  $('.ct-n', cx).textContent = c.nome || c.email;
  $('.ct-e', cx).textContent = c.email + (c.via ? '  ·  ' + c.via : '');
  if (c.plano) $('.ct-plano', cx).textContent = c.plano;
  $('#ctTrocar', cx).onclick = () => {
    // o botao dizia "Trocar de conta" e abria o login do zero. Agora ele
    // mostra de verdade as contas guardadas pra alternar em um clique.
    const ancora = ancoraDoPainel(P);
    fecharModal(P);
    menuContas(P.engine, ancora, c);
  };
  $('#ctSair', cx).onclick = () => { fecharModal(P); contaAcao(P, 'logout'); };
}

function quandoFuturo(ms) {
  const d = ms - Date.now();
  if (d <= 0) return 'já zerou';
  const min = Math.round(d / 60000);
  if (min < 60) return 'em ' + min + ' min';
  const h = Math.round(min / 60);
  if (h < 24) return 'em ' + h + 'h';
  const dias = Math.round(h / 24);
  return 'em ' + dias + (dias === 1 ? ' dia' : ' dias');
}

async function contaAcao(P, acao) {
  const r = await window.api.auth({ engine: P.engine, acao });
  if (!r) return;
  if (r.error) return note(P, 'Não consegui: ' + r.error, true);
  if (acao === 'status') { avisoTemp(P, (r.texto || 'sem resposta').split('\n').slice(0, 4).join(' · ')); return; }
  if (r.terminal) {
    janelaTerminal(P, r.terminal, r.titulo || 'Conta', async () => {
      avisoTemp(P, 'Pronto. Mande uma mensagem para o painel começar de novo com a conta certa.');
      await window.api.paneStop({ paneId: P.id, engine: P.engine });
      if (P.morto) return;
      if (P.engine === 'claude') P.resumeId = P.sessaoId || P.resumeId;
      // o motor parou de proposito: 'engine-down' nao vem, entao um painel que
      // estava trabalhando ficaria travado em "trabalhando…" pra sempre
      destravarPainel(P);
      P.started = false; setDot(P, 'off');
      // o Codex mantem UM processo pra todos os paineis, com a credencial ja
      // lida na memoria: sem derrubar, ele continuaria na conta anterior
      if (P.engine === 'codex') { try { await window.api.codexReiniciar(); } catch {} }
      savePanes();
      // a lateral mostrava o email e o limite da conta velha ate a proxima troca de aba
      pintarCartaoConta(P.engine);
      carregarUsoSidebar(P.engine);
    });
  }
}

function avisoTemp(P, texto) {
  clearEmpty(P);
  const d = document.createElement('div');
  d.className = 'note'; d.textContent = texto;
  P.chat.appendChild(d); scroll(P, true);
  setTimeout(() => d.remove(), 12000);
}

const IMG_EXT = ['png','jpg','jpeg','gif','webp','bmp','heic','svg'];
const TIPO_ICO = (ext) => {
  if (IMG_EXT.includes(ext)) return 'image';
  if (['pdf','doc','docx','txt','md','rtf','pages'].includes(ext)) return 'file-text';
  if (['mp3','wav','m4a','ogg','aac','flac'].includes(ext)) return 'file';
  if (['mp4','mov','avi','mkv','webm'].includes(ext)) return 'file';
  if (['js','ts','py','html','css','json','sh','yml','yaml'].includes(ext)) return 'file-code';
  return 'file';
};
const tamanhoBonito = (b) => {
  if (!b) return '';
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return Math.round(b / 1024) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
};

async function anexar(P, caminhos) {
  for (const c of caminhos) {
    if (P.anexos.some(a => a.path === c)) continue;
    const a = await window.api.anexoLer(c);
    if (a) P.anexos.push(a);
    else note(P, 'Não consegui anexar ' + baseNome(c) + ' (arquivo grande demais, sem permissão, ou o caminho não existe).', true);
  }
  pintarAnexos(P);
}

function fichaAnexo(a, comX, aoTirar, P) {
  const d = document.createElement('div');
  d.className = 'anx' + (P ? ' clicavel' : '');
  if (P) d.onclick = (e) => { if (!e.target.closest('.anx-x')) verArquivo(P, a.path); };
  d.title = a.path;
  d.innerHTML = '<div class="anx-mini"></div><div class="anx-txt">'
    + '<span class="anx-n"></span><span class="anx-s"></span></div>'
    + (comX ? '<button class="anx-x">' + ico('x') + '</button>' : '');
  const mini = $('.anx-mini', d);
  if (a.mini) { const img = document.createElement('img'); img.src = a.mini; mini.appendChild(img); }
  else mini.innerHTML = ico(TIPO_ICO(a.ext || ''));
  $('.anx-n', d).textContent = a.nome;
  $('.anx-s', d).textContent = [(a.ext || '').toUpperCase(), tamanhoBonito(a.bytes)].filter(Boolean).join(' · ');
  if (comX) $('.anx-x', d).onclick = () => aoTirar(a);
  return d;
}

/* a mensagem em fila virava um aviso que sumia em 12s; agora fica na tela */
function pintarFila(P) {
  const barra = $('.p-fila', P.el);
  if (!barra) return;
  barra.classList.toggle('hidden', !P.queued);
  if (!P.queued) { barra.innerHTML = ''; return; }
  barra.innerHTML = '<span class="fl-ic"></span><span class="fl-txt"></span><button class="fl-x" title="Tirar da fila"></button>';
  $('.fl-ic', barra).innerHTML = ico('clipboard-list');
  $('.fl-txt', barra).textContent = P.queued.replace(/\s+/g, ' ').slice(0, 120);
  barra.title = P.queued;
  $('.fl-x', barra).innerHTML = ico('x');
  $('.fl-x', barra).onclick = () => {
    const txt = P.queued; P.queued = null; pintarFila(P);
    const inp = $('.p-input', P.el);
    if (inp && !inp.value.trim()) { inp.value = txt; inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 190) + 'px'; inp.focus(); }
  };
}

function pintarAnexos(P) {
  const barra = $('.p-anexos', P.el);
  barra.innerHTML = '';
  barra.classList.toggle('hidden', !P.anexos.length);
  for (const a of P.anexos) {
    barra.appendChild(fichaAnexo(a, true, (x) => {
      P.anexos = P.anexos.filter(y => y.path !== x.path);
      pintarAnexos(P);
    }));
  }
}

function inserirNoInput(P, txt) {
  const inp = $('.p-input', P.el);
  const sep = inp.value && !inp.value.endsWith(' ') ? ' ' : '';
  inp.value += sep + txt;
  inp.focus();
  inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 190) + 'px';
}

/* ============ visualizador de arquivo ============ */
function fecharVisor() { $$('.p-visor').forEach(v => { v.classList.add('hidden'); $('.visor-corpo', v).innerHTML = ''; }); }

async function verArquivo(P, caminho) {
  const v = $('.p-visor', P.el);
  const corpo = $('.visor-corpo', v);
  v.classList.remove('hidden');
  v.onclick = (e) => { if (e.target === v) fecharVisor(); };
  $('.visor-nome', v).textContent = baseNome(caminho);
  $('.visor-x', v).innerHTML = ico('x');
  $('.visor-x', v).onclick = fecharVisor;
  $('.visor-abrir', v).innerHTML = ico('upload');
  $('.visor-abrir', v).title = 'Abrir no ' + ESTE_PC;
  $('.visor-abrir', v).onclick = async () => {
    const r = await window.api.openPath(caminho);
    if (r && r.error) { const c = $('.visor-corpo', v); if (c) c.insertAdjacentHTML('afterbegin', '<div class="visor-vazio"></div>'); const av = $('.visor-vazio', c); if (av) av.textContent = r.error; }
  };
  corpo.innerHTML = '<div class="visor-vazio">abrindo…</div>';

  const a = await window.api.verArquivo(caminho);
  if (!a || a.erro) { corpo.innerHTML = '<div class="visor-vazio">Não consegui abrir.<br>' + ((a && a.erro) || '') + '</div>'; return; }
  $('.visor-nome', v).textContent = a.nome + '  ·  ' + tamanhoBonito(a.bytes);
  if (a.tipo === 'imagem') { corpo.innerHTML = ''; const i = document.createElement('img'); i.src = a.dados; corpo.appendChild(i); }
  else if (a.tipo === 'texto') { corpo.innerHTML = '<pre></pre>'; $('pre', corpo).textContent = a.dados; }
  else corpo.innerHTML = '<div class="visor-vazio">Este tipo não abre aqui dentro.<br>Use o botão do canto para abrir no ' + ESTE_PC + '.</div>';
}

/* ============ conversas recentes ============ */
const histCache = { claude: null, codex: null };

function grupoDoTempo(ms) {
  if (!ms) return 'Sem data';
  const agora = new Date();
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
  const d = ms;
  if (d >= hoje) return 'Hoje';
  if (d >= hoje - 86400000) return 'Ontem';
  if (d >= hoje - 7 * 86400000) return 'Últimos 7 dias';
  if (d >= hoje - 30 * 86400000) return 'Últimos 30 dias';
  const dt = new Date(d);
  const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  return meses[dt.getMonth()] + (dt.getFullYear() !== agora.getFullYear() ? ' de ' + dt.getFullYear() : '');
}

function quando(ms) {
  if (!ms) return '';
  const d = Math.max(0, Date.now() - ms);
  const min = Math.round(d / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return min + ' min';
  const h = Math.round(min / 60);
  if (h < 24) return h + 'h';
  const dias = Math.round(h / 24);
  return dias + (dias === 1 ? ' dia' : ' dias');
}

function mesmaPasta(cwdSessao, cwdAba) {
  if (!cwdSessao || !cwdAba) return false;
  // normaliza barra invertida e barra normal: o mesmo caminho aparece dos dois
  // jeitos dependendo de quem gravou a sessao
  const norm = (s) => String(s).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return norm(cwdSessao) === norm(cwdAba);
}

const histGen = { claude: 0, codex: 0 };
const pintaGen = { claude: 0, codex: 0 };
const escondidasPorFiltro = { claude: 0, codex: 0 };
async function loadHist(engine, force) {
  const meuGen = ++histGen[engine];
  const box = $(engine === 'claude' ? '#histClaude' : '#histCodex');
  if (histCache[engine]) paintHist(engine, histCache[engine]);   // mostra o que ja tem
  else box.innerHTML = '<div class="hist-load">Carregando…</div>';

  const aba = abaAtual();
  let r;
  if (aba && aba.tipo === 'ssh') {
    // as conversas de uma aba remota ficam gravadas dentro do servidor, nao aqui
    escondidasPorFiltro[engine] = 0;   // aba remota nao filtra por pasta local
    if (engine === 'codex') { r = []; }
    else {
      box.innerHTML = '<div class="hist-load">Buscando no servidor…</div>';
      r = await window.api.sessionsClaudeRemoto({ remoto: remotoDoAba(aba) });
    }
  } else {
    r = engine === 'claude' ? await window.api.sessionsClaude(!!cfg.verRobos) : await window.api.sessionsCodex(!!cfg.verRobos);
    const pastas = pastasDaAba(aba);
    if (pastas.length && Array.isArray(r)) {
      const todas = r.length;
      r = r.filter(s => pastas.some(p => mesmaPasta(s.cwd, p)));
      escondidasPorFiltro[engine] = todas - r.length;   // pra avisar na tela
    } else escondidasPorFiltro[engine] = 0;
  }
  // chegou tarde: o usuario ja trocou de aba ou pediu outra lista
  if (meuGen !== histGen[engine]) return;
  if (r && r.error) { box.innerHTML = '<div class="hist-load">Não consegui ler: ' + r.error + '</div>'; return; }
  histCache[engine] = r || [];
  paintHist(engine, histCache[engine]);
}

const buscaAtual = { claude: '', codex: '' };

const chaveFav = (s) => s.engine + ':' + s.id;
const ehFavorita = (s) => Array.isArray(cfg.favoritos) && cfg.favoritos.includes(chaveFav(s));
function trocarFavorita(s) {
  if (!Array.isArray(cfg.favoritos)) cfg.favoritos = [];
  const k = chaveFav(s);
  const i = cfg.favoritos.indexOf(k);
  if (i >= 0) cfg.favoritos.splice(i, 1); else cfg.favoritos.unshift(k);
  window.api.setConfig(cfg);
}

/* ============ grupos de conversa, compartilhados entre Claude e Codex ============ */
const GRUPO_CORES = ['#6ea8fe','#d97757','#5aa469','#d7ba7d','#e05252','#b083f0','#f0839f','#4fd1c5'];
const filtroGrupo = { claude: null, codex: null };   // aba ativa em cada lista; nao e' salvo, reseta a cada abertura

function pintarAbasGrupo(engine) {
  const box = $(engine === 'claude' ? '#abasClaude' : '#abasCodex');
  if (!box) return;
  const ativo = filtroGrupo[engine];
  box.innerHTML = '';
  const bTodos = document.createElement('button');
  bTodos.className = 'aba-grupo' + (!ativo ? ' on' : '');
  bTodos.textContent = 'Todos';
  bTodos.addEventListener('click', () => {
    filtroGrupo[engine] = null; pintarAbasGrupo(engine);
    histCache[engine] && paintHist(engine, histCache[engine]);
  });
  box.appendChild(bTodos);
  for (const g of listaGrupos()) {
    const bt = document.createElement('button');
    bt.className = 'aba-grupo' + (ativo === g.id ? ' on' : '');
    bt.title = g.nome;
    bt.innerHTML = '<span class="aba-cor" style="background:' + g.cor + '"></span><span class="aba-txt"></span>';
    $('.aba-txt', bt).textContent = g.nome;
    bt.addEventListener('click', () => {
      filtroGrupo[engine] = g.id; pintarAbasGrupo(engine);
      histCache[engine] && paintHist(engine, histCache[engine]);
    });
    box.appendChild(bt);
  }
  const bAdd = document.createElement('button');
  bAdd.className = 'aba-grupo aba-add';
  bAdd.innerHTML = ico('plus');
  bAdd.title = 'Novo grupo';
  bAdd.addEventListener('click', () => abrirModalGrupo(null));
  box.appendChild(bAdd);
}

function listaGrupos() { return Array.isArray(cfg.grupos) ? cfg.grupos : []; }
function grupoPorId(id) { return listaGrupos().find(g => g.id === id); }
function grupoDaSessao(s) { return cfg.grupoSessao && cfg.grupoSessao[chaveFav(s)]; }
function moverParaGrupo(s, grupoId) {
  if (!cfg.grupoSessao) cfg.grupoSessao = {};
  if (grupoId) cfg.grupoSessao[chaveFav(s)] = grupoId; else delete cfg.grupoSessao[chaveFav(s)];
  window.api.setConfig(cfg);
  histCache[s.engine] && paintHist(s.engine, histCache[s.engine]);
}
function grupoRecolhido(id) { return Array.isArray(cfg.gruposRecolhidos) && cfg.gruposRecolhidos.includes(id); }
function alternarGrupoRecolhido(id) {
  if (!Array.isArray(cfg.gruposRecolhidos)) cfg.gruposRecolhidos = [];
  const i = cfg.gruposRecolhidos.indexOf(id);
  if (i >= 0) cfg.gruposRecolhidos.splice(i, 1); else cfg.gruposRecolhidos.push(id);
  window.api.setConfig(cfg);
}

/* modal central, fora de qualquer painel (a lista de conversas nao pertence a nenhum) */
function abrirModalGlobal() {
  const modal = $('#modalGrupo'), cx = $('.modal-cx', modal);
  modal.classList.remove('hidden');
  modal.onclick = (e) => { if (e.target === modal) fecharModalGlobal(); };
  cx.onclick = (e) => e.stopPropagation();
  cx.innerHTML = '';
  return cx;
}
function fecharModalGlobal() {
  const modal = $('#modalGrupo');
  modal.classList.add('hidden'); $('.modal-cx', modal).innerHTML = '';
}

/* popup pequeno ancorado perto do botao que abriu, tipo menu de selecao */
function fecharPopGlobal() { $('#popGrupo').classList.add('hidden'); $('#popGrupo').innerHTML = ''; }
function abrirPopGlobal(anchorEl) {
  fecharMenus(); fecharPopGlobal();
  const pop = $('#popGrupo');
  pop.innerHTML = ''; pop.onclick = (e) => e.stopPropagation();
  pop.classList.remove('hidden');
  const r = anchorEl.getBoundingClientRect();
  const largura = 220;
  pop.style.left = Math.min(window.innerWidth - largura - 10, Math.max(10, r.left)) + 'px';
  pop.style.top = Math.min(window.innerHeight - 60, r.bottom + 6) + 'px';
  setTimeout(() => {
    const alt = pop.getBoundingClientRect().height;
    if (r.bottom + 6 + alt > window.innerHeight - 10) pop.style.top = Math.max(10, r.top - alt - 6) + 'px';
  }, 0);
  return pop;
}

/* caixinha pra digitar um texto: o Electron nao tem prompt(), e sem isto
   qualquer "digite um nome" simplesmente nao funcionava */
function pedirTexto({ titulo, dica, valor, exemplo, aoConfirmar }) {
  const cx = abrirModalGlobal();
  cx.innerHTML = '<div class="mo-top"><span class="mo-tit"></span><button class="mo-x">' + ico('x') + '</button></div>'
    + (dica ? '<div class="mo-sub"></div>' : '')
    + '<div class="mo-form"><input id="pxCampo" maxlength="60"></div>'
    + '<div class="mo-rodape"><button class="mo-btn destaque" id="pxOk">Salvar</button>'
    + '<button class="mo-btn" id="pxCancela">Cancelar</button></div>';
  $('.mo-tit', cx).textContent = titulo || '';
  if (dica) $('.mo-sub', cx).textContent = dica;
  const campo = $('#pxCampo', cx);
  campo.placeholder = exemplo || '';
  campo.value = valor || '';
  $('.mo-x', cx).onclick = fecharModalGlobal;
  $('#pxCancela', cx).onclick = fecharModalGlobal;
  const confirmar = () => {
    const v = campo.value.trim();
    if (!v) { campo.focus(); return; }
    fecharModalGlobal();
    try { aoConfirmar(v); } catch {}
  };
  $('#pxOk', cx).onclick = confirmar;
  campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmar(); } });
  setTimeout(() => { campo.focus(); campo.select(); }, 30);
}

/* criar/renomear grupo: nome + cor - a firula pedida, em vez de um prompt() cru */
function abrirModalGrupo(existente) {
  const cx = abrirModalGlobal();
  const editando = !!existente;
  cx.innerHTML = '<div class="mo-top"><span class="mo-tit">' + (editando ? 'Renomear grupo' : 'Novo grupo') + '</span>'
    + '<button class="mo-x">' + ico('x') + '</button></div>'
    + '<div class="mo-sub">Vale pro Claude e pro Codex juntos — o mesmo grupo pode ter conversa dos dois.</div>'
    + '<div class="mo-form"><input id="pnNome" placeholder="Nome do grupo, ex: Pedro" maxlength="40"></div>'
    + '<div class="mo-dica" style="margin-top:10px">Cor</div>'
    + '<div class="cor-linha">' + GRUPO_CORES.map(c => '<button class="cor-sw" data-cor="' + c + '" style="background:' + c + '"></button>').join('') + '</div>'
    + '<div class="mo-rodape"><button class="mo-btn destaque" id="pnOk">' + (editando ? 'Salvar' : 'Criar grupo') + '</button>'
    + '<button class="mo-btn" id="pnCancela">Cancelar</button></div>';
  $('.mo-x', cx).onclick = fecharModalGlobal;
  $('#pnCancela', cx).onclick = fecharModalGlobal;
  let corEscolhida = (existente && existente.cor) || GRUPO_CORES[Math.floor(Math.random() * GRUPO_CORES.length)];
  const pintaCor = () => $$('.cor-sw', cx).forEach(b => {
    const on = b.dataset.cor === corEscolhida;
    b.classList.toggle('on', on);
    b.innerHTML = on ? ico('check') : '';
  });
  $$('.cor-sw', cx).forEach(b => b.addEventListener('click', () => { corEscolhida = b.dataset.cor; pintaCor(); }));
  pintaCor();
  const inp = $('#pnNome', cx);
  inp.value = existente ? existente.nome : '';
  setTimeout(() => inp.focus(), 30);
  const salvar = () => {
    const nome = inp.value.trim();
    if (!nome) { inp.focus(); return; }
    if (!Array.isArray(cfg.grupos)) cfg.grupos = [];
    if (editando) { existente.nome = nome; existente.cor = corEscolhida; }
    else cfg.grupos.push({ id: 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), nome, cor: corEscolhida });
    window.api.setConfig(cfg);
    fecharModalGlobal();
    pintarAbasGrupo('claude'); pintarAbasGrupo('codex');
    histCache.claude && paintHist('claude', histCache.claude);
    histCache.codex && paintHist('codex', histCache.codex);
  };
  $('#pnOk', cx).onclick = salvar;
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') salvar(); });
}

function apagarGrupo(g) {
  if (!confirm('Apagar o grupo "' + g.nome + '"? As conversas continuam, só saem do grupo.')) return;
  cfg.grupos = listaGrupos().filter(x => x.id !== g.id);
  if (cfg.grupoSessao) for (const k of Object.keys(cfg.grupoSessao)) if (cfg.grupoSessao[k] === g.id) delete cfg.grupoSessao[k];
  if (filtroGrupo.claude === g.id) filtroGrupo.claude = null;
  if (filtroGrupo.codex === g.id) filtroGrupo.codex = null;
  window.api.setConfig(cfg);
  fecharPopGlobal();
  pintarAbasGrupo('claude'); pintarAbasGrupo('codex');
  histCache.claude && paintHist('claude', histCache.claude);
  histCache.codex && paintHist('codex', histCache.codex);
}

/* popup: mover uma sessao pra um grupo (o "botao ou botao direito com selecao" pedido) */
function abrirMenuGrupoDaSessao(anchorEl, s) {
  const pop = abrirPopGlobal(anchorEl);
  const atual = grupoDaSessao(s);
  const linha = (texto, ic, on, cor, aoClicar) => {
    const d = document.createElement('div');
    d.className = 'mi' + (on ? ' on' : '');
    d.innerHTML = '<div class="mi-ic"></div><div class="mi-txt"><div class="mi-n"></div></div>' + (on ? '<div class="mi-ck">' + ico('check') + '</div>' : '');
    if (cor) $('.mi-ic', d).innerHTML = '<span class="pop-cor" style="background:' + cor + '"></span>';
    else if (ic) $('.mi-ic', d).innerHTML = ico(ic);
    $('.mi-n', d).textContent = texto;
    d.addEventListener('click', () => { fecharPopGlobal(); aoClicar(); });
    return d;
  };
  pop.appendChild(linha('Sem grupo', 'x', !atual, null, () => moverParaGrupo(s, null)));
  const grupos = listaGrupos();
  if (grupos.length) {
    pop.appendChild(Object.assign(document.createElement('div'), { className: 'menu-linha' }));
    for (const g of grupos) pop.appendChild(linha(g.nome, null, atual === g.id, g.cor, () => moverParaGrupo(s, g.id)));
  }
  pop.appendChild(Object.assign(document.createElement('div'), { className: 'menu-linha' }));
  pop.appendChild(linha('Novo grupo…', 'plus', false, null, () => abrirModalGrupo(null)));
}

/* cabecalho de um grupo na lista lateral, com as conversas dentro */
function linhaGrupo(g, sessoes) {
  const cab = document.createElement('div');
  cab.className = 'grp-cab' + (grupoRecolhido(g.id) ? ' recolhido' : '');
  cab.innerHTML = '<span class="chev">' + ico('chevron-down') + '</span>'
    + '<span class="grp-cor" style="background:' + g.cor + '"></span>'
    + '<span class="grp-nome"></span><span class="grp-conta"></span>'
    + '<button class="grp-gear">' + ico('pencil') + '</button>';
  $('.grp-nome', cab).textContent = g.nome;
  $('.grp-conta', cab).textContent = String(sessoes.length);
  const corpo = document.createElement('div');
  corpo.className = 'grp-corpo';
  corpo.classList.toggle('hidden', grupoRecolhido(g.id));
  for (const s of sessoes) corpo.appendChild(linhaConversa(s, ''));
  cab.addEventListener('click', (e) => {
    if (e.target.closest('.grp-gear')) return;
    alternarGrupoRecolhido(g.id);
    cab.classList.toggle('recolhido');
    corpo.classList.toggle('hidden');
  });
  $('.grp-gear', cab).addEventListener('click', (e) => {
    e.stopPropagation();
    const pop = abrirPopGlobal(e.currentTarget);
    const mi = (texto, ic, aoClicar) => {
      const d = document.createElement('div'); d.className = 'mi';
      d.innerHTML = '<div class="mi-ic"></div><div class="mi-txt"><div class="mi-n"></div></div>';
      $('.mi-ic', d).innerHTML = ico(ic); $('.mi-n', d).textContent = texto;
      d.addEventListener('click', aoClicar);
      return d;
    };
    pop.appendChild(mi('Renomear / trocar cor', 'pencil', () => { fecharPopGlobal(); abrirModalGrupo(g); }));
    pop.appendChild(mi('Apagar grupo', 'x', () => apagarGrupo(g)));
  });
  const bloco = document.createDocumentFragment();
  bloco.appendChild(cab); bloco.appendChild(corpo);
  return bloco;
}

function marcarTermo(el, texto, termo) {
  el.textContent = '';
  const i = termo ? texto.toLowerCase().indexOf(termo) : -1;
  if (i < 0) { el.textContent = texto; return; }
  el.appendChild(document.createTextNode(texto.slice(0, i)));
  const m = document.createElement('span'); m.className = 'hi-marca';
  m.textContent = texto.slice(i, i + termo.length);
  el.appendChild(m);
  el.appendChild(document.createTextNode(texto.slice(i + termo.length)));
}

function linhaConversa(s, termo, trecho) {
  const d = document.createElement('div');
  d.className = 'hist-item' + (trecho ? ' com-trecho' : '');
  d.innerHTML = '<span class="hi-w"></span><span class="hi-t"></span>'
    + (trecho ? '<span class="hi-trecho"></span>' : '')
    + '<button class="hi-fav" title="Deixar no topo"></button>'
    + '<button class="hi-grupo" title="Mover pra grupo"></button>'
    + '<button class="hi-edit" title="Renomear"></button>'
    + '<button class="hi-mais" title="Mais ações"></button>';
  marcarTermo($('.hi-t', d), s.title, trecho ? '' : termo);
  $('.hi-w', d).textContent = quando(s.when);
  if (trecho) marcarTermo($('.hi-trecho', d), trecho, termo);
  $('.hi-edit', d).innerHTML = ico('pencil');
  const bm = $('.hi-mais', d);
  bm.innerHTML = ico('sliders-horizontal');
  bm.addEventListener('click', (e) => {
    e.stopPropagation();
    const pop = abrirPopGlobal(bm);
    const mi = (texto, icone, aoClicar, perigo) => {
      const x = document.createElement('div');
      x.className = 'mi' + (perigo ? ' mi-perigo' : '');
      x.innerHTML = '<div class="mi-ic"></div><div class="mi-txt"><div class="mi-n"></div></div>';
      $('.mi-ic', x).innerHTML = ico(icone);
      $('.mi-n', x).textContent = texto;
      x.addEventListener('click', () => { fecharPopGlobal(); aoClicar(); });
      return x;
    };
    if (s.remoto) {
      const aviso = document.createElement('div');
      aviso.className = 'mi'; aviso.style.opacity = '.7';
      aviso.innerHTML = '<div class="mi-ic"></div><div class="mi-txt"><div class="mi-n"></div></div>';
      $('.mi-ic', aviso).innerHTML = ico('server');
      $('.mi-n', aviso).textContent = 'Conversa do servidor: exportar e apagar só pelo servidor';
      pop.appendChild(aviso);
      return;
    }
    pop.appendChild(mi('Exportar como .md', 'upload', async () => {
      const r = await window.api.exportarSessao({ engine: s.engine, id: s.id, file: s.file, titulo: s.title });
      if (r && r.error) alert('Não consegui exportar: ' + r.error);
      else if (r && r.ok && focusPane) note(focusPane, 'Conversa salva em ' + r.caminho);
    }));
    pop.appendChild(Object.assign(document.createElement('div'), { className: 'menu-linha' }));
    pop.appendChild(mi('Apagar conversa', 'x', async () => {
      if (!confirm('Mandar "' + s.title + '" para a Lixeira?\n\nDá para restaurar de lá se mudar de ideia.')) return;
      const r = await window.api.apagarSessao({ id: s.id, file: s.file });
      if (r && r.error) { alert('Não consegui apagar: ' + r.error); return; }
      d.remove();
      // painel aberto que usava esta conversa: para o motor de verdade
      for (const Q of [...panes.values(), ...panesFundo.values()]) {
        if (Q.sessaoId === s.id || Q.resumeId === s.id) {
          try { await window.api.paneStop({ paneId: Q.id, engine: Q.engine }); } catch {}
          destravarPainel(Q);
          Q.sessaoId = null; Q.resumeId = null; Q.sessaoFile = ''; Q.started = false;
          setDot(Q, 'off');
          note(Q, 'Esta conversa foi apagada. A próxima mensagem começa uma nova.', true);
        }
      }
      // painel salvo em OUTRA aba local: so' existe no config, o laco acima nao alcanca
      for (const ab of abasLocais()) {
        if (!Array.isArray(ab.paineis)) continue;
        for (const pp of ab.paineis) {
          if (pp && pp.sessaoId === s.id) { pp.sessaoId = null; pp.file = ''; }
        }
      }
      savePanes();
      if (Array.isArray(histCache[s.engine])) histCache[s.engine] = histCache[s.engine].filter((x) => x.id !== s.id);
      if (Array.isArray(cfg.favoritos)) cfg.favoritos = cfg.favoritos.filter((k) => k !== chaveFav(s));
      if (cfg.grupoSessao) delete cfg.grupoSessao[chaveFav(s)];
      window.api.setConfig(cfg);
    }, true));
  });
  const favorita = ehFavorita(s);
  const bf = $('.hi-fav', d);
  bf.innerHTML = ico('star');
  bf.classList.toggle('on', favorita);
  bf.title = favorita ? 'Tirar do topo' : 'Deixar no topo';
  d.classList.toggle('favorita', favorita);
  bf.addEventListener('click', async (e) => {
    e.stopPropagation();
    trocarFavorita(s);
    histCache[s.engine] && paintHist(s.engine, histCache[s.engine]);
  });
  const gAtual = grupoDaSessao(s);
  const bg = $('.hi-grupo', d);
  bg.innerHTML = ico('folder');
  bg.classList.toggle('on', !!gAtual);
  if (gAtual) { const gg = grupoPorId(gAtual); if (gg) bg.style.color = gg.cor; }
  bg.title = gAtual ? 'Mover pra outro grupo' : 'Mover pra grupo';
  bg.addEventListener('click', (e) => { e.stopPropagation(); abrirMenuGrupoDaSessao(bg, s); });
  d.title = s.title + '\n' + s.cwd;
  d.addEventListener('click', (e) => { if (!e.target.closest('.hi-edit')) openSession(s, d); });
  $('.hi-edit', d).addEventListener('click', (e) => {
    e.stopPropagation();
    if ($('.pn-input', d)) return;
    const alvo = $('.hi-t', d), lapis = $('.hi-edit', d);
    const inp = document.createElement('input');
    inp.className = 'pn-input';
    inp.value = s.title;
    alvo.style.display = 'none'; lapis.style.display = 'none';
    d.insertBefore(inp, alvo);
    inp.focus(); inp.select();
    let pronto = false;
    const fim = async (salvar) => {
      if (pronto) return; pronto = true;
      const novo = inp.value.trim();
      inp.remove(); alvo.style.display = ''; lapis.style.display = '';
      if (!salvar || !novo || novo === s.title) return;
      await window.api.renomear({ engine: s.engine, id: s.id, nome: novo });
      s.title = novo;
      alvo.textContent = novo;
      d.title = novo + '\n' + s.cwd;
      histCache[s.engine] = null;
      for (const P of [...panes.values(), ...panesFundo.values()]) {
        if (P.resumeId !== s.id && P.sessaoId !== s.id) continue;
        P.titulo = novo; P.nomeManual = true;
        if (panes.has(P.id)) pintarNome(P);   // o de fundo nao tem nome na tela pra pintar
      }
    };
    inp.onclick = (ev) => ev.stopPropagation();
    inp.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); fim(true); }
      if (ev.key === 'Escape') fim(false);
    });
    inp.addEventListener('blur', () => fim(true));
  });
  return d;
}

async function paintHist(engine, list) {
  // a busca dentro das conversas demora segundos. Sem esta marca, o resultado
  // de uma busca ja cancelada chegava depois e apagava a lista que estava na tela
  const meuGen = ++pintaGen[engine];
  const box = $(engine === 'claude' ? '#histClaude' : '#histCodex');
  const termo = (buscaAtual[engine] || '').toLowerCase().trim();
  box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<div class="hist-load">Nenhuma conversa ainda.</div>'; return; }

  if (!termo) {
    // avisa que a aba esta filtrando, em vez de simplesmente esconder
    const nEsc = escondidasPorFiltro[engine] || 0;
    if (nEsc > 0) {
      const av = document.createElement('button');
      av.className = 'hist-filtro-aviso';
      av.textContent = '+' + nEsc + (nEsc === 1 ? ' conversa de outra pasta' : ' conversas de outras pastas');
      av.title = 'Esta aba mostra só as conversas das pastas dela. Clique para ver todas.';
      av.addEventListener('click', () => {
        const pc = abasLocais().find(x => x.tipo === 'local' && !pastasDaAba(x).length);
        if (pc) trocarAbaLocal(pc.id);
      });
      box.appendChild(av);
    }
    const alvo = filtroGrupo[engine];
    if (alvo) {
      const g = grupoPorId(alvo);
      const doGrupo = list.filter(s => grupoDaSessao(s) === alvo);
      if (!doGrupo.length) box.innerHTML = '<div class="hist-load">Nada em "' + (g ? g.nome : '') + '" ainda.</div>';
      else for (const s of doGrupo) box.appendChild(linhaConversa(s, ''));
      return;
    }
    const favs = list.filter(ehFavorita);
    if (favs.length) {
      box.appendChild(Object.assign(document.createElement('div'), { className: 'hist-cab', textContent: 'Favoritas' }));
      for (const s of favs) box.appendChild(linhaConversa(s, ''));
    }
    let restantes = list.filter(s => !ehFavorita(s));

    // grupos aparecem sempre, mesmo vazios (igual ao VS Code)
    for (const g of listaGrupos()) {
      const doGrupo = restantes.filter(s => grupoDaSessao(s) === g.id);
      restantes = restantes.filter(s => grupoDaSessao(s) !== g.id);
      box.appendChild(linhaGrupo(g, doGrupo));
    }

    let grupoAtual = '';
    for (const s of restantes) {
      const g = grupoDoTempo(s.when);
      if (g !== grupoAtual) {
        grupoAtual = g;
        box.appendChild(Object.assign(document.createElement('div'), { className: 'hist-cab', textContent: g }));
      }
      box.appendChild(linhaConversa(s, ''));
    }
    return;
  }

  const porNome = list.filter(s => s.title.toLowerCase().includes(termo));
  const resto = list.filter(s => !porNome.includes(s));
  if (porNome.length) {
    box.appendChild(Object.assign(document.createElement('div'), { className: 'hist-cab', textContent: 'no nome' }));
    for (const s of porNome) box.appendChild(linhaConversa(s, termo));
  }
  const aviso = document.createElement('div');
  aviso.className = 'hist-load';
  aviso.textContent = 'procurando dentro das conversas…';
  box.appendChild(aviso);

  const resp = await window.api.buscarConversas({ engine, termo, itens: resto.map(s => ({ id: s.id, file: s.file })) });
  // outra pintura ja aconteceu enquanto isto rodava: nao mexe mais na lista
  if (meuGen !== pintaGen[engine]) return;
  aviso.remove();
  const achados = (resp && resp.achados) || [];
  const avisoTrunc = '<div class="hist-load">Algumas conversas são grandes demais e foram buscadas só na parte mais recente.</div>';
  if (!achados.length) {
    if (!porNome.length) box.innerHTML = '<div class="hist-load">Nada com “' + termo + '”.</div>' + (resp && resp.truncado ? avisoTrunc : '');
    return;
  }
  box.appendChild(Object.assign(document.createElement('div'), { className: 'hist-cab', textContent: 'dentro da conversa' }));
  if (resp && resp.truncado) box.insertAdjacentHTML('beforeend', avisoTrunc);
  for (const a of achados) {
    const s = resto.find(x => x.id === a.id);
    if (s) box.appendChild(linhaConversa(s, termo, a.trecho));
  }
}

async function openSession(s, el) {
  // ja esta aberta em algum painel? so pisca e leva voce ate ela
  // tambem os que estao rodando em OUTRA aba: abrir de novo criaria um segundo
  // motor na MESMA conversa (dois 'claude --resume' no mesmo arquivo; no Codex,
  // o roteamento por thread era sequestrado e o painel antigo travava)
  const noFundo = [...panesFundo.values()].find(q => q.resumeId === s.id || q.sessaoId === s.id);
  if (noFundo) {
    document.querySelectorAll('.hist-item').forEach(x => x.classList.remove('on'));
    if (el) el.classList.add('on');
    const destino = noFundo.abaId;
    await trocarAbaLocal(destino);
    // com outra troca em curso, a nossa fica na fila e acontece depois: nao da'
    // pra focar agora. Tenta de novo no proximo quadro em vez de nao fazer nada.
    const focar = () => {
      const Q = panes.get(noFundo.id);
      if (Q) { setFocus(Q); piscar(Q); const c = $('.p-input', Q.el); if (c) c.focus(); return true; }
      return false;
    };
    if (!focar()) setTimeout(focar, 400);
    return;
  }
  const aberta = [...panes.values()].find(q => q.resumeId === s.id || q.sessaoId === s.id);
  if (aberta) {
    document.querySelectorAll('.hist-item').forEach(x => x.classList.remove('on'));
    if (el) el.classList.add('on');
    setFocus(aberta);
    piscar(aberta);
    $('.p-input', aberta.el).focus();
    return;
  }
  // cada conversa da lista abre no seu proprio painel, sem atropelar o que ja esta rolando
  let P = null;
  if (totalDePaineis() < 12) P = newPane({ engine: s.engine, cwd: s.cwd, titulo: s.title });
  else {
    P = [...panes.values()].find(q => !q.busy && !q.hist.length) || [...panes.values()].find(q => !q.busy);
    if (!P) { const q = focusPane; if (q) avisoTemp(q, 'Todos os painéis estão ocupados. Feche um para abrir esta conversa.'); return; }
  }
  sairDaAbertura();
  document.querySelectorAll('.hist-item').forEach(x => x.classList.remove('on'));
  if (el) el.classList.add('on');

  await window.api.paneStop({ paneId: P.id, engine: P.engine });
  if (P.morto) return;
  destravarPainel(P);
  P.engine = s.engine; P.cwd = s.cwd; P.resumeId = s.id; P.started = false; P.busy = false; P.model = '';
  // a conversa que voce renomeou a mao chega com o apelido em s.title: zerar o
  // nomeManual deixava o titulo automatico sobrescrever no fim do turno
  P.titulo = s.title || ''; P.hist = []; P.nomeManual = !!s.nome;
  // sobra da conversa ANTERIOR: sem limpar, o savePanes logo abaixo gravava a
  // conversa velha, o titulo vinha do arquivo errado e o anel de contexto mentia
  P.sessaoId = null; P.sessaoFile = ''; P.sessaoRemota = false;
  P.tokens = 0; P.janela = 0; P.passarContexto = null;
  P.anexos = []; pintarAnexos(P); pintarTokens(P); esconderPermissao(P);
  P.blocks.clear(); P.tools.clear(); P.chat.innerHTML = '';
  fillModels(P); paintEngine(P); setDot(P, 'off');
  $('.p-cwd', P.el).textContent = nomePasta(P.cwd);
  pintarModo(P); pintarNome(P);
  setFocus(P); savePanes();

  note(P, 'Conversa: ' + s.title);
  const remotoAqui = remotoDoAba(abaAtual());
  const msgs = (remotoAqui
    ? await window.api.sessionHistoryRemoto({ remoto: remotoAqui, id: s.id })
    : await window.api.sessionHistory({ engine: s.engine, file: s.file, id: s.id })) || [];
  for (const m of (msgs || [])) {
    if (m.role === 'user') userMsg(P, m.text);   // o userMsg ja grava no historico
    else if (m.role === 'bot') {
      const b = botBlock(P, 'h' + Math.random()); b.raw = m.text; b.el.innerHTML = mdSeguro(m.text);
      P.hist.push({ quem: s.engine === 'codex' ? 'Codex' : 'Claude', texto: m.text });
    }
    else if (m.role === 'tool') { toolStart(P, 'h' + Math.random(), m.name, m.arg); }
  }
  document.querySelectorAll('.tool-st').forEach(x => { if (x.classList.contains('run')) { x.className = 'tool-st ok'; x.innerHTML = ico('check'); } });
  const faixa = document.createElement('div');
  faixa.className = 'troca'; faixa.innerHTML = '<span></span>';
  $('span', faixa).textContent = 'daqui pra baixo é a conversa de agora';
  P.chat.appendChild(faixa);
  scroll(P, true);
  $('.p-input', P.el).focus();
}

/* ao abrir o app, devolve os paineis da ultima vez com a conversa ja carregada */
async function restaurarPaineis(salvos, abaId, gen) {
  sairDaAbertura();
  for (const s of salvos.slice(0, 12)) {
    // o usuario trocou de aba de novo enquanto isso carregava: para aqui
    if (gen !== undefined && gen !== abaGen) return;
    const P = newPane({ engine: s.engine, cwd: s.cwd, model: s.model, mode: s.mode, effort: s.effort, titulo: s.titulo, abaId });
    P.resumeId = s.sessaoId;
    if (s.contexto) P.passarContexto = s.contexto;
    // devolve o texto que voce tinha comecado a escrever
    if (s.rascunho) {
      const campo = $('.p-input', P.el);
      if (campo) { campo.value = s.rascunho; campo.style.height = 'auto'; campo.style.height = Math.min(campo.scrollHeight, 190) + 'px'; }
    }
    // painel remoto nao tem arquivo aqui: nao carregar o caminho falso adiante
    P.sessaoFile = remotoDoAba(abaPorId(abaId)) ? '' : (s.file || '');
    pintarNome(P); setDot(P, 'off');
    let msgs = [];
    try {
      const remotoAqui = remotoDoAba(abaPorId(abaId));
      // aba SSH: a conversa mora no servidor, ponto. Nao olhar o "file" salvo -
      // painel gravado antes desta correcao tem um caminho local FALSO que
      // fazia o app procurar no PC e voltar sempre vazio.
      msgs = (remotoAqui
        ? await window.api.sessionHistoryRemoto({ remoto: remotoAqui, id: s.sessaoId })
        : await window.api.sessionHistory({ engine: s.engine, file: s.file, id: s.sessaoId })) || [];
    } catch {}
    for (const msg of msgs) {
      // o historico em memoria tambem: sem ele, trocar de motor depois de
      // reabrir o app mandava o outro comecar do zero, sem saber de nada
      if (msg.role === 'user') userMsg(P, msg.text);   // o userMsg ja grava no historico
      else if (msg.role === 'bot') {
        const b = botBlock(P, 'r' + Math.random()); b.raw = msg.text; b.el.innerHTML = mdSeguro(msg.text);
        P.hist.push({ quem: s.engine === 'codex' ? 'Codex' : 'Claude', texto: msg.text });
      }
    }
    if (msgs.length) {
      const d = document.createElement('div');
      d.className = 'troca'; d.innerHTML = '<span></span>';
      $('span', d).textContent = 'conversa de antes — pode continuar daqui';
      P.chat.appendChild(d); scroll(P, true);
    }
  }
  const primeiro = [...panes.values()][0];
  if (primeiro) { setFocus(primeiro); $('.p-input', primeiro.el).focus(); }
  for (const Q of panes.values()) atualizarGit(Q);   // chip do git em todos, nao so' no focado
  savePanes();
}

/* abre um painel novo ja sabendo do que voce estava falando, sem tocar no
   painel atual - a mesma mecanica usada quando se troca Claude<->Codex */
function ramificar(P) {
  if (totalDePaineis() >= 12) { note(P, 'Já são 12 painéis. Feche um para ramificar.', true); return; }
  if (!P.hist.length) { note(P, 'Ainda não há conversa para levar adiante.', true); return; }
  const novo = newPane({ engine: P.engine, cwd: P.cwd, model: P.model, mode: P.mode, effort: P.effort, abaId: P.abaId });
  novo.passarContexto = montarContexto(P);
  novo.titulo = (P.titulo || 'Conversa') + ' (ramo)';
  pintarNome(novo);
  const d = document.createElement('div');
  d.className = 'troca'; d.innerHTML = '<span></span>';
  $('span', d).textContent = 'ramo de "' + (P.titulo || 'conversa anterior') + '" — escreva pra continuar daqui';
  clearEmpty(novo);   // a tela de "painel vazio" ocupa 100% da altura e empurrava a faixa pra fora
  novo.chat.appendChild(d);
  savePanes();
}

async function novaConversa(engine) {
  // a pasta tem que ser a da ABA: numa aba de servidor, cfg.defCwd e' um caminho
  // do Windows e o painel tentava entrar nele dentro do Linux
  const P = totalDePaineis() < 12
    ? newPane({ engine, cwd: cwdPadraoDaAba(abaAtual()), abaId: cfg.abaAtiva })
    : focusPane;
  if (!P) return;
  await window.api.paneStop({ paneId: P.id, engine: P.engine });
  if (P.morto) return;
  destravarPainel(P);
  P.engine = engine; P.resumeId = null; P.started = false; P.titulo = ''; P.hist = [];
  // painel reaproveitado: sem isto ele voltava na conversa antiga ao reabrir o app
  P.sessaoId = null; P.sessaoFile = ''; P.sessaoRemota = false;
  P.tokens = 0; P.janela = 0; P.passarContexto = null; P.nomeManual = false;
  P.anexos = []; pintarAnexos(P); pintarTokens(P); esconderPermissao(P);
  P.chat.innerHTML = ''; P.blocks.clear(); P.tools.clear(); pintarNome(P);
  fillModels(P); paintEngine(P); setDot(P, 'off'); setFocus(P);
  savePanes();
  $('.p-input', P.el).focus();
}

$$('.side-busca').forEach(inp => {
  let timer = 0;
  inp.addEventListener('input', () => {
    const eng = inp.dataset.busca;
    buscaAtual[eng] = inp.value;
    clearTimeout(timer);
    timer = setTimeout(() => { if (histCache[eng]) paintHist(eng, histCache[eng]); }, 260);
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); inp.value = ''; buscaAtual[inp.dataset.busca] = '';
      if (histCache[inp.dataset.busca]) paintHist(inp.dataset.busca, histCache[inp.dataset.busca]); }
  });
});

document.querySelectorAll('[data-reload]').forEach(b =>
  b.addEventListener('click', () => { loadHist(b.dataset.reload, true); carregarUsoSidebar(b.dataset.reload); }));
document.querySelectorAll('[data-new]').forEach(b =>
  b.addEventListener('click', () => novaConversa(b.dataset.new)));
document.querySelectorAll('[data-novo-grupo]').forEach(b =>
  b.addEventListener('click', () => abrirModalGrupo(null)));

/* ============ interface geral ============ */
$('#btnAddPane').addEventListener('click', () => { if (totalDePaineis() < 12) newPane(); });
$('#btnPickFolder').addEventListener('click', async () => {
  if (!focusPane) return;
  $('.p-cwd', focusPane.el).click();
});
function aplicarTema(t) {
  document.documentElement.setAttribute('data-tema', t || 'escuro');
  $$('.tema-bt').forEach(b => b.classList.toggle('on', b.dataset.tema === (t || 'escuro')));
}
$$('.tema-bt').forEach(b => b.addEventListener('click', async () => {
  cfg.tema = b.dataset.tema;
  aplicarTema(cfg.tema);
  await window.api.setConfig(cfg);
}));

$('#chkRobos').addEventListener('change', async (e) => {
  cfg.verRobos = e.target.checked;
  await window.api.setConfig(cfg);
  histCache.claude = null; histCache.codex = null;
  const aberta = $$('.side-view').find(v => !v.classList.contains('hidden'));
  if (aberta && aberta.dataset.view === 'hclaude') loadHist('claude', true);
  if (aberta && aberta.dataset.view === 'hcodex') loadHist('codex', true);
});

$('#btnFoto').addEventListener('click', async () => {
  const r = await window.api.pickPhoto();
  if (!r) return;
  if (r.error) { alert(r.error); return; }
  cfg.foto = r.dataUrl; await window.api.setConfig(cfg); repintarAvatares();
});
$('#btnFotoTirar').addEventListener('click', async () => {
  delete cfg.foto; await window.api.setConfig(cfg); repintarAvatares();
});

$('#btnDefCwd').addEventListener('click', async () => {
  const p = await window.api.pickFolder(cfg.defCwd || HOME);
  if (!p) return;
  cfg.defCwd = p; await window.api.setConfig(cfg); $('#defCwd').textContent = p;
});

document.querySelectorAll('.act').forEach(b => b.addEventListener('click', () => {
  const v = b.dataset.view;
  if (b.classList.contains('active')) return toggleSidebar();   // clicar no icone ja aberto fecha
  $('#sidebar').classList.remove('hidden'); $('#dragbar').classList.remove('hidden');
  document.querySelectorAll('.act').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.side-view').forEach(x => x.classList.toggle('hidden', x.dataset.view !== v));
  $('#sidebar').classList.remove('hidden'); $('#dragbar').classList.remove('hidden');
  if (v === 'hclaude') { loadHist('claude'); carregarUsoSidebar('claude'); pintarAbasGrupo('claude'); pintarCartaoConta('claude'); }
  if (v === 'hcodex') { loadHist('codex'); carregarUsoSidebar('codex'); pintarAbasGrupo('codex'); pintarCartaoConta('codex'); }
}));
function toggleSidebar() { $('#sidebar').classList.toggle('hidden'); $('#dragbar').classList.toggle('hidden'); }

(() => {
  let drag = false;
  $('#dragbar').addEventListener('mousedown', () => { drag = true; document.body.style.cursor = 'col-resize'; });
  window.addEventListener('mousemove', (e) => { if (drag) $('#sidebar').style.width = Math.min(480, Math.max(160, e.clientX - 48)) + 'px'; });
  window.addEventListener('mouseup', () => { drag = false; document.body.style.cursor = ''; });
})();

document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey)) return;
  // Ctrl+Shift+1..9 troca de ABA local; Ctrl+1..9 foca o painel
  if (e.shiftKey) {
    // com Shift, e.key vira "!" "@" "#"...; e.code continua sendo Digit1..Digit9
    const mm = /^Digit([1-9])$/.exec(e.code || '');
    if (mm) {
      const ab = abasLocais()[Number(mm[1]) - 1];
      if (ab) { e.preventDefault(); trocarAbaLocal(ab.id); }
    }
    return;
  }
  if (/^[1-9]$/.test(e.key)) {
    const arr = [...panes.values()];
    const P = arr[Number(e.key) - 1];
    if (P) { e.preventDefault(); setFocus(P); $('.p-input', P.el).focus(); }
    return;
  }
  if (e.key === 'f' || e.key === 'F') {
    // dentro do terminal embutido, Ctrl+F e' do shell
    const noTerm = document.activeElement && document.activeElement.closest && document.activeElement.closest('.term-wrap');
    if (noTerm) return;
    e.preventDefault(); buscarNoPainel(focusPane); return;
  }
  // Ctrl+0 vai pro ultimo painel (cobre o 10, 11 e 12, que nao tem numero)
  if (e.key === '0') {
    const arr = [...panes.values()];
    const P = arr[arr.length - 1];
    if (P) { e.preventDefault(); setFocus(P); $('.p-input', P.el).focus(); }
  }
});

window.addEventListener('resize', () => { for (const P of panes.values()) paintEngine(P); });

function irParaPainel(passo) {
  const arr = [...panes.values()];
  if (arr.length < 2) return;
  const i = Math.max(0, arr.indexOf(focusPane));
  const alvo = arr[(i + passo + arr.length) % arr.length];
  if (alvo) { setFocus(alvo); $('.p-input', alvo.el).focus(); }
}
function abrirBuscaDeConversa() {
  const eng = (focusPane && focusPane.engine === 'codex') ? 'codex' : 'claude';
  const bt = document.querySelector('.act[data-view="h' + eng + '"]');
  if (bt && !bt.classList.contains('active')) bt.click();
  else { $('#sidebar').classList.remove('hidden'); $('#dragbar').classList.remove('hidden'); }
  const campo = document.querySelector('.side-busca[data-busca="' + eng + '"]');
  if (campo) setTimeout(() => { campo.focus(); campo.select(); }, 60);
}

window.api.onMenu((a) => {
  // Ctrl+K, Ctrl+L, Ctrl+P... sao teclas do shell. Dentro do terminal embutido
  // elas nao podem virar acao do app (o Ctrl+K chegava a limpar a conversa)
  const noTerminal = document.activeElement && document.activeElement.closest
    && document.activeElement.closest('.term-wrap');
  if (noTerminal && ['clearPane', 'focarInput', 'novaConversa', 'buscarConversa', 'toggleSidebar'].includes(a)) return;
  if (a === 'newPane') { if (totalDePaineis() < 12) newPane(); }
  else if (a === 'closePane' && focusPane) closePane(focusPane.id);
  else if (a === 'pickFolder' && focusPane) $('.p-cwd', focusPane.el).click();
  else if (a === 'toggleSidebar') toggleSidebar();
  else if (a === 'novaConversa') novaConversa(focusPane ? focusPane.engine : (cfg.lastEngine || 'claude'));
  else if (a === 'buscarConversa') abrirBuscaDeConversa();
  else if (a === 'focarInput' && focusPane) $('.p-input', focusPane.el).focus();
  else if (a === 'painelProximo') irParaPainel(1);
  else if (a === 'painelAnterior') irParaPainel(-1);
  else if (a === 'parar') {
    const alvo = (focusPane && focusPane.busy) ? [focusPane] : [...panes.values()].filter(P => P.busy);
    for (const P of alvo) window.api.paneInterrupt({ paneId: P.id, engine: P.engine });
  }
  else if (a === 'clearPane' && focusPane) {
    focusPane.chat.innerHTML = ''; focusPane.blocks.clear(); focusPane.tools.clear();
    note(focusPane, 'Tela limpa. A conversa continua de onde estava.');
  }
});

/* ============ boot ============ */
(async function boot() {
  $('#svgClaude').innerHTML = '<path d="' + LOGO.claude + '"/>';
  $('#svgCodex').innerHTML = '<path d="' + LOGO.codex + '"/>';
  HOME = await window.api.home();
  cfg = await window.api.getConfig();
  cfg.defCwd = cfg.defCwd || HOME;
  // abas locais: na primeira vez semeia "PC inteiro" + "VPS"; quem ja tinha
  // paineis salvos (versao sem abas) migra tudo pro "PC inteiro", sem perder nada
  if (!Array.isArray(cfg.abas) || !cfg.abas.length) {
    cfg.abas = abasLocaisPadrao();
    if (Array.isArray(cfg.panes) && cfg.panes.length) { cfg.abas[0].paineis = cfg.panes; delete cfg.panes; }
  }
  if (!cfg.abaAtiva || !abaPorId(cfg.abaAtiva)) cfg.abaAtiva = cfg.abas[0].id;
  pintarAbasLocal();
  carregarUsoSidebar('claude'); carregarUsoSidebar('codex');
  pintarCartaoConta('claude'); pintarCartaoConta('codex');
  pintarAbasGrupo('claude'); pintarAbasGrupo('codex');
  setInterval(() => { carregarUsoSidebar('claude'); carregarUsoSidebar('codex'); }, 5 * 60 * 1000);
  $('#defCwd').textContent = cfg.defCwd;
  $('#chkRobos').checked = !!cfg.verRobos;
  aplicarTema(cfg.tema);
  if (EH_WIN) $$('[title]').forEach(el => { if (el.title.includes('⌘')) el.title = el.title.replace(/⌘/g, 'Ctrl+'); });
  $('#verLine').textContent = 'Cockpit 1.0 · até 12 painéis lado a lado';
  repintarAvatares();
  window.api.codexModels().then(ms => { if (ms && ms.length) { MODELOS_CODEX = ms; for (const P of panes.values()) if (P.engine === 'codex') fillModels(P); } });
  // tela de abertura: escolher com quem vai trabalhar
  $('#bvClaude').innerHTML = svgMotor('claude');
  $('#bvCodex').innerHTML = svgMotor('codex');
  $('#bvDoisA').innerHTML = svgMotor('claude');
  $('#bvDoisB').innerHTML = svgMotor('codex');
  // barra de icones aparece, a lateral comeca fechada, e a area de paineis fica fora do caminho
  $('#sidebar').classList.add('hidden'); $('#dragbar').classList.add('hidden');
  $('#panes').style.display = 'none';
  // tinha conversa aberta da ultima vez? volta tudo como estava, sem passar pela abertura
  const salvos = ((abaAtual() && abaAtual().paineis) || []).filter(p => p && (p.sessaoId || p.contexto || p.rascunho));
  if (salvos.length) {
    if (!MODELOS_CODEX && salvos.some(p => p.engine === 'codex')) {
      try { const ms = await window.api.codexModels(); if (ms && ms.length) MODELOS_CODEX = ms; } catch {}
    }
    await restaurarPaineis(salvos, cfg.abaAtiva);
    return;
  }
  const comecar = (quais) => {
    sairDaAbertura();
    for (const m of quais) newPane({ engine: m, cwd: cfg.defCwd || HOME, abaId: cfg.abaAtiva });
    setFocus([...panes.values()][0]);
    setTimeout(() => { const P = [...panes.values()][0]; if (P) $('.p-input', P.el).focus(); }, 120);
  };
  $$('.bv-bt[data-motor]').forEach(b => b.addEventListener('click', () => comecar([b.dataset.motor])));
  $('.bv-dois').addEventListener('click', () => comecar(['claude', 'codex']));
  document.addEventListener('keydown', function abertura(e) {
    if (!$('#boasvindas')) { document.removeEventListener('keydown', abertura); return; }
    if (e.key === '1') comecar(['claude']);
    if (e.key === '2') comecar(['codex']);
    if (e.key === 'Enter') comecar(['claude', 'codex']);
  });
})();
