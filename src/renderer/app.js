/* ============ estado global ============ */
let cfg = {}, HOME = '';
/* tema salvo, entregue pelo preload ANTES do boot: sem isto a tela nascia no
   escuro e so' depois de ler o config virava Claro/Jornal/Motti (piscava) */
try { if (window.api && window.api.temaInicial) document.documentElement.setAttribute('data-tema', window.api.temaInicial === 'motti' ? 'azul' : window.api.temaInicial); } catch {}
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
  return { host: aba.host, usuario: aba.usuario, chave: aba.chave, caminhoRemoto: aba.caminhoRemoto || '~', ...(aba.porta != null ? { porta: aba.porta } : {}) };
}
function remotoDoPane(P) { return remotoDoAba(abaPorId(P.abaId)); }
/* Aba de servidor ainda em branco -- o Cockpit vem com uma assim de proposito.
   Sem usuario e host o pedido NAO chega a virar SSH la' no processo principal:
   ele cai no disco DESTE PC sem avisar (arvore, "@" e visor liam a pasta errada
   calados). Entao arvore, "@" e visor param aqui e dizem o que falta. */
function faltaConfigurarServidor(remoto) {
  return !!remoto && (!String(remoto.usuario || '').trim() || !String(remoto.host || '').trim());
}
const AVISO_ABA_EM_BRANCO = 'Esta aba ainda não tem servidor configurado — preencha usuário, host e chave em Editar aba.';
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
/* logos oficiais dos motores (fonte de cada um logo abaixo) */
const LOGO = {
  claude: 'M4.7144 15.9555l4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
  codex: 'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z',
};
/* logos oficiais: claude e codex do simple-icons; gemini e grok do
   @lobehub/icons-static-svg 1.95.0 (MIT) -- os dois tambem em 24x24, cabem no
   mesmo viewBox do svgMotor; acp e' um plugue (protocolo aberto, sem marca) */
LOGO.gemini = 'M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z';
LOGO.grok = 'M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815';
// plugue do ACP (protocolo aberto, sem marca): dois pinos, corpo e cabo
LOGO.acp = 'M9 2h2v5h2V2h2v5h2a1 1 0 0 1 1 1v3a6 6 0 0 1-5 5.92V22h-2v-5.08A6 6 0 0 1 6 11V8a1 1 0 0 1 1-1h2V2z';

const ICONES = {"hand": "<path d=\"M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2\" /> <path d=\"M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2\" /> <path d=\"M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8\" /> <path d=\"M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15\" />", "code-xml": "<path d=\"m18 16 4-4-4-4\" /> <path d=\"m6 8-4 4 4 4\" /> <path d=\"m14.5 4-5 16\" />", "clipboard-list": "<rect width=\"8\" height=\"4\" x=\"8\" y=\"2\" rx=\"1\" ry=\"1\" /> <path d=\"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2\" /> <path d=\"M12 11h4\" /> <path d=\"M12 16h4\" /> <path d=\"M8 11h.01\" /> <path d=\"M8 16h.01\" />", "zap": "<path d=\"M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z\" />", "unlock": "<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\" /> <path d=\"M7 11V7a5 5 0 0 1 9.9-1\" />", "upload": "<path d=\"M12 3v12\" /> <path d=\"m17 8-5-5-5 5\" /> <path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\" />", "image": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" ry=\"2\" /> <circle cx=\"9\" cy=\"9\" r=\"2\" /> <path d=\"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21\" />", "folder": "<path d=\"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z\" />", "map-pin": "<path d=\"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0\" /> <circle cx=\"12\" cy=\"10\" r=\"3\" />", "eraser": "<path d=\"M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21\" /> <path d=\"m5.082 11.09 8.828 8.828\" />", "sparkles": "<path d=\"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z\" /> <path d=\"M20 2v4\" /> <path d=\"M22 4h-4\" /> <circle cx=\"4\" cy=\"20\" r=\"2\" />", "brain": "<path d=\"M12 18V5\" /> <path d=\"M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4\" /> <path d=\"M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5\" /> <path d=\"M17.997 5.125a4 4 0 0 1 2.526 5.77\" /> <path d=\"M18 18a4 4 0 0 0 2-7.464\" /> <path d=\"M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517\" /> <path d=\"M6 18a4 4 0 0 1-2-7.464\" /> <path d=\"M6.003 5.125a4 4 0 0 0-2.526 5.77\" />", "sliders-horizontal": "<path d=\"M10 5H3\" /> <path d=\"M12 19H3\" /> <path d=\"M14 3v4\" /> <path d=\"M16 17v4\" /> <path d=\"M21 12h-9\" /> <path d=\"M21 19h-5\" /> <path d=\"M21 5h-7\" /> <path d=\"M8 10v4\" /> <path d=\"M8 12H3\" />", "lock": "<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\" /> <path d=\"M7 11V7a5 5 0 0 1 10 0v4\" />", "arrow-left-right": "<path d=\"M8 3 4 7l4 4\" /> <path d=\"M4 7h16\" /> <path d=\"m16 21 4-4-4-4\" /> <path d=\"M20 17H4\" />", "folder-open": "<path d=\"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2\" />", "plus": "<path d=\"M5 12h14\" /> <path d=\"M12 5v14\" />", "plug": "<path d=\"M12 22v-5\" /> <path d=\"M15 8V2\" /> <path d=\"M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z\" /> <path d=\"M9 8V2\" />", "key-round": "<path d=\"M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z\" /> <circle cx=\"16.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\" />", "log-out": "<path d=\"m16 17 5-5-5-5\" /> <path d=\"M21 12H9\" /> <path d=\"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4\" />", "user": "<path d=\"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2\" /> <circle cx=\"12\" cy=\"7\" r=\"4\" />", "file-code": "<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\" /> <path d=\"M14 2v5a1 1 0 0 0 1 1h5\" /> <path d=\"M10 12.5 8 15l2 2.5\" /> <path d=\"m14 12.5 2 2.5-2 2.5\" />", "file-text": "<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\" /> <path d=\"M14 2v5a1 1 0 0 0 1 1h5\" /> <path d=\"M10 9H8\" /> <path d=\"M16 13H8\" /> <path d=\"M16 17H8\" />", "braces": "<path d=\"M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1\" /> <path d=\"M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1\" />", "terminal": "<path d=\"M12 19h8\" /> <path d=\"m4 17 6-6-6-6\" />", "file": "<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\" /> <path d=\"M14 2v5a1 1 0 0 0 1 1h5\" />", "refresh-cw": "<path d=\"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8\" /> <path d=\"M21 3v5h-5\" /> <path d=\"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16\" /> <path d=\"M8 16H3v5\" />", "circle-help": "<circle cx=\"12\" cy=\"12\" r=\"10\" /> <path d=\"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3\" /> <path d=\"M12 17h.01\" />", "x": "<path d=\"M18 6 6 18\" /> <path d=\"m6 6 12 12\" />", "check": "<path d=\"M20 6 9 17l-5-5\" />", "panel-left": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" /> <path d=\"M9 3v18\" />", "chevron-right": "<path d=\"m9 18 6-6-6-6\" />", "chevron-down": "<path d=\"m6 9 6 6 6-6\" />", "arrow-up": "<path d=\"m5 12 7-7 7 7\" /> <path d=\"M12 19V5\" />", "square": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" />", "rotate-cw": "<path d=\"M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8\" /> <path d=\"M21 3v5h-5\" />", "circle": "<circle cx=\"12\" cy=\"12\" r=\"10\" />", "minus": "<path d=\"M5 12h14\" />", "pencil": "<path d=\"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z\" /> <path d=\"m15 5 4 4\" />", "search": "<path d=\"m21 21-4.34-4.34\" /> <circle cx=\"11\" cy=\"11\" r=\"8\" />", "star": "<path d=\"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z\" />", "mic": "<path d=\"M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z\" /> <path d=\"M19 10v2a7 7 0 0 1-14 0v-2\" /> <line x1=\"12\" x2=\"12\" y1=\"19\" y2=\"22\" />", "server": "<rect width=\"20\" height=\"8\" x=\"2\" y=\"2\" rx=\"2\" ry=\"2\" /> <rect width=\"20\" height=\"8\" x=\"2\" y=\"14\" rx=\"2\" ry=\"2\" /> <line x1=\"6\" x2=\"6.01\" y1=\"6\" y2=\"6\" /> <line x1=\"6\" x2=\"6.01\" y1=\"18\" y2=\"18\" />", "settings": "<path d=\"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915\" /> <circle cx=\"12\" cy=\"12\" r=\"3\" />", "messages-square": "<path d=\"M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z\" /> <path d=\"M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1\" />", "git-compare": "<circle cx=\"18\" cy=\"18\" r=\"3\" /> <circle cx=\"6\" cy=\"6\" r=\"3\" /> <path d=\"M13 6h3a2 2 0 0 1 2 2v7\" /> <path d=\"M11 18H8a2 2 0 0 1-2-2V9\" />", "git-branch": "<line x1=\"6\" x2=\"6\" y1=\"3\" y2=\"15\" /> <circle cx=\"18\" cy=\"6\" r=\"3\" /> <circle cx=\"6\" cy=\"18\" r=\"3\" /> <path d=\"M18 9a9 9 0 0 1-9 9\" />", "workflow": "<rect width=\"8\" height=\"8\" x=\"3\" y=\"3\" rx=\"2\" /> <path d=\"M7 11v4a2 2 0 0 0 2 2h4\" /> <rect width=\"8\" height=\"8\" x=\"13\" y=\"13\" rx=\"2\" />"};
const ico = (n) => '<svg viewBox="0 0 24 24" class="ic" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + (ICONES[n] || '') + '</svg>';
/* Um lugar so' para o nome de cada motor. Antes isto era um
   "nomeDoMotor(engine)" espalhado em oito pontos -- e cada
   motor novo obrigaria a caçar todos de novo. */
const NOME_MOTOR = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', grok: 'Grok', acp: 'ACP' };
const nomeDoMotor = (eng) => NOME_MOTOR[eng] || 'Claude';
const MOTORES = ['claude', 'codex', 'gemini', 'grok', 'acp'];

/* A barra lateral tem uma coluna por motor, e cada pedaco dela e' um id fixo no
   HTML (#histClaude, #contaGemini...). Antes isto era escrito a mao em cinco
   lugares como "engine === 'claude' ? '#histClaude' : '#histCodex'" -- ou seja,
   QUALQUER motor que nao fosse o Claude ia escrever na coluna do Codex: um
   painel do Gemini pintava a conta dele no cartao do Codex. */
const CAIXA_MOTOR = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', grok: 'Grok', acp: 'Acp' };
const caixaDoMotor = (pre, eng) => document.getElementById(pre + (CAIXA_MOTOR[eng] || 'Claude'));
/* Estado guardado por motor. Nascendo com os quatro, um "++" numa chave que nao
   existe deixa de virar NaN e a lista deixa de nunca mais pintar. */
const porMotor = (valor) => { const o = {}; for (const m of MOTORES) o[m] = valor; return o; };


/* UM lugar so' desenha logo de motor (a barra da esquerda tambem passa por aqui).
   id: so' pra barra, que tem teste de tela procurando #svgClaude, #svgGemini... */
const svgMotor = (eng, id) => '<svg viewBox="0 0 24 24" class="logo-motor"' + (id ? ' id="' + id + '"' : '') + '><path d="' + (LOGO[eng] || LOGO.claude) + '"/></svg>';
/* logo do motor como marca de rotulo (menu, colunas, conta, Torre, debate): na
   cor do proprio motor (style.css), tamanho pelo contexto */
const marcaDoMotor = (eng, cls = '') => '<span class="marca-motor' + (cls ? ' ' + cls : '') + '" data-motor="' + (MOTORES.includes(eng) ? eng : 'claude') + '">' + svgMotor(MOTORES.includes(eng) ? eng : 'claude') + '</span>';
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

/* padrao: o modelo de painel NOVO do Claude. Era o Opus 5 (1M); desde 14/09/2026
   e' o Sonnet 5 (pedido do Hugo). Nos Ajustes da' pra escolher outro
   (cfg.defModelClaude) -- quem le isso e' o catalogoClaude, logo abaixo. */
const MODELOS_CLAUDE = [
  { id: 'claude-opus-5[1m]', nome: 'Opus 5 (1M)', desc: 'O mais forte, com memória gigante',
    efforts: ['low','medium','high','xhigh','max'], padraoEffort: 'high' },
  { id: 'claude-opus-5', nome: 'Opus 5', desc: 'O mais forte',
    efforts: ['low','medium','high','xhigh','max'], padraoEffort: 'high' },
  /* id conferido RODANDO em 06/09/2026 (exige Claude Code 2.1.251+) */
  { id: 'claude-fable-5-1', nome: 'Fable 5.1 (1M)', desc: 'O Fable novo, com memória gigante',
    efforts: ['low','medium','high','xhigh','max'], padraoEffort: 'medium' },
  { id: 'claude-fable-5', nome: 'Fable 5', desc: 'Da família Claude 5',
    efforts: ['low','medium','high','xhigh','max'], padraoEffort: 'medium' },
  { id: 'claude-sonnet-5', nome: 'Sonnet 5', desc: 'Rápido e bom para o dia a dia',
    efforts: ['low','medium','high','xhigh','max'], padraoEffort: 'medium', padrao: true },
  { id: 'claude-haiku-4-5-20251001', nome: 'Haiku 4.5', desc: 'O mais barato e veloz',
    efforts: ['low','medium','high'], padraoEffort: 'medium' },
];
/* O catalogo que o painel le (modelosDe -> fillModels/modeloAtual). Com um
   modelo escolhido nos Ajustes, o "padrao" passa pra ele; vazio ou um id que nao
   existe mais = o Sonnet 5 da lista. So' vale pra painel SEM modelo proprio:
   restaurado ou escolhido no menu, o painel fica com o dele (fillModels so' troca
   quando o modelo do painel nao esta no catalogo). A copia e' guardada: modelosDe
   roda a cada repintura. */
let catClaudeCache = { chave: '', lista: MODELOS_CLAUDE };
function catalogoClaude() {
  const pedido = (cfg && typeof cfg.defModelClaude === 'string') ? cfg.defModelClaude : '';
  const escolhido = MODELOS_CLAUDE.some((m) => m.id === pedido) ? pedido : '';
  if (catClaudeCache.chave !== escolhido) {
    catClaudeCache = { chave: escolhido, lista: escolhido ? MODELOS_CLAUDE.map((m) => ({ ...m, padrao: m.id === escolhido })) : MODELOS_CLAUDE };
  }
  return catClaudeCache.lista;
}
const idModeloPadraoClaude = () => (catalogoClaude().find((m) => m.padrao) || MODELOS_CLAUDE[0]).id;
/* O historico do Claude grava em cada resposta o modelo que respondeu
   ("claude-opus-5", "claude-sonnet-5"...; "<synthetic>" e' texto do proprio CLI).
   Conversa reaberta pela lista volta nesse modelo. O arquivo nao diz se era a
   versao 1M -- e o Hugo usa o Opus SEMPRE com 1M (48 paineis salvos em
   claude-opus-5[1m] em 15/09): Opus 5 do historico volta como Opus 5 (1M)
   (auditoria 1; antes caia no Opus 5 de 200k e a conversa longa estourava).
   Fora do catalogo: '' (vale o padrao). */
const APELIDO_CLAUDE = { opus: 'claude-opus-5', sonnet: 'claude-sonnet-5', haiku: 'claude-haiku-4-5-20251001', fable: 'claude-fable-5' };
const COM_1M = { 'claude-opus-5': 'claude-opus-5[1m]' };
/* o Sonnet que assume quando o escolhido cai (--fallback-model, menu de modelos) */
const RESERVA_CLAUDE = 'claude-sonnet-5';
/* auditoria 2: com a reserva ligada, a ultima resposta pode ser do Sonnet
   RESERVA (o Fable/Opus caiu naquele turno). Ela nao decide o modelo: vale a
   resposta mais recente de outro modelo. So' Sonnet no historico = Sonnet. */
function modeloDoHistorico(msgs) {
  const lista = Array.isArray(msgs) ? msgs : [];
  const reservaLigada = typeof cfg !== 'undefined' && !!(cfg && cfg.fallbackClaude);
  let soReserva = '';
  for (let i = lista.length - 1; i >= 0; i--) {
    const bruto = String((lista[i] && lista[i].model) || '').trim();
    if (!bruto || bruto.startsWith('<')) continue;
    const id = bruto.replace(/\[1m\]$/i, '');
    const alvo = MODELOS_CLAUDE.find((m) => m.id === id) || MODELOS_CLAUDE.find((m) => m.id === APELIDO_CLAUDE[id.toLowerCase()]);
    if (alvo && reservaLigada && alvo.id === RESERVA_CLAUDE) { soReserva = soReserva || alvo.id; continue; }
    if (!alvo) return soReserva;
    return COM_1M[alvo.id] || alvo.id;
  }
  return soReserva;
}
let MODELOS_CODEX = null;   // vem do proprio Codex

/* Lista conferida RODANDO cada modelo com a chave do Hugo — 06/09/2026 e de
   novo em 22/09/2026 (`gemini --skip-trust -m <id> -p ...`, os cinco
   responderam). Em 06/09 os 2.5 ja tinham morrido ("no longer available to new
   users") e o 3.1-pro-preview tinha camada gratis ZERO: oferecer qualquer um
   deles seria vender erro 404.
   Novidades de 22/09: o 3.8 Flash (o que o Google recomenda hoje para projeto
   novo) e o 3.5 Flash Lite. O 3.7 Flash tambem responde, mas ficou de fora --
   o 3.8 e' o sucessor direto e a lista precisa caber na tela. O 3.1 Flash Lite
   continua na lista mesmo tendo sucessor: tirar um id que algum painel salvo
   usa faz o fillModels trocar o modelo daquele painel pelo padrao, calado. */
const MODELOS_GEMINI = [
  { id: '', nome: 'padrão do Gemini', desc: 'ele escolhe o modelo a cada pedido (auto)', efforts: [], padrao: true },
  { id: 'gemini-3.8-flash', nome: 'Gemini 3.8 Flash', desc: 'o mais novo — o que o Google recomenda hoje', efforts: [] },
  { id: 'gemini-3.5-flash', nome: 'Gemini 3.5 Flash', desc: 'rápido, com camada grátis', efforts: [] },
  { id: 'gemini-3.5-flash-lite', nome: 'Gemini 3.5 Flash Lite', desc: 'o leve atual, mais barato que o Flash', efforts: [] },
  { id: 'gemini-3.1-flash-lite', nome: 'Gemini 3.1 Flash Lite', desc: 'o leve da geração passada', efforts: [] },
];
const MODELOS_GROK = [
  { id: '', nome: 'padrão do Grok', desc: 'o que está no ~/.grok/config.toml', efforts: [], padrao: true },
];
/* No painel ACP o "modelo" e' o COMANDO que sobe o agente: e' o que o main
   recebe como model e passa pro acp.js. So' o primeiro foi provado rodando
   nesta maquina (testes/acp-vivo.js); os outros existem no npm/site, mas nao
   rodaram aqui - a descricao diz isso em vez de prometer. */
const MODELOS_ACP = [
  { id: 'gemini --acp', nome: 'Gemini (ACP)', desc: 'o Gemini CLI falando ACP — provado nesta máquina', efforts: [], padrao: true },
  { id: 'npx -y @zed-industries/claude-code-acp', nome: 'Claude Code (ACP)', desc: 'adaptador do Zed pro Claude Code (baixa na 1ª vez; não testado aqui)', efforts: [] },
  { id: 'npx -y @zed-industries/codex-acp', nome: 'Codex (ACP)', desc: 'adaptador do Zed pro Codex (baixa na 1ª vez; não testado aqui)', efforts: [] },
  { id: 'opencode acp', nome: 'OpenCode (ACP)', desc: 'se o OpenCode estiver instalado (não testado aqui)', efforts: [] },
  { id: 'qwen --acp', nome: 'Qwen Code (ACP)', desc: 'se o Qwen Code estiver instalado (não testado aqui)', efforts: [] },
];
/* comando proprio (digitado no menu) entra na lista: senao o fillModels o
   trocava pelo padrao ao religar o painel */
function modelosAcp(P) {
  const proprio = String(P.model || '').trim();
  if (!proprio || MODELOS_ACP.some((m) => m.id === proprio)) return MODELOS_ACP;
  return [...MODELOS_ACP, { id: proprio, nome: proprio.split(/\s+/)[0] + ' (comando próprio)', desc: proprio, efforts: [] }];
}

function modelosDe(P) {
  if (P.engine === 'claude') return catalogoClaude();
  if (P.engine === 'gemini') return MODELOS_GEMINI;
  if (P.engine === 'grok') return MODELOS_GROK;
  if (P.engine === 'acp') return modelosAcp(P);
  const remote = typeof remotoDoPane === 'function' ? remotoDoPane(P) : null;
  const scope = remote ? JSON.stringify([remote.usuario, remote.host, Number(remote.porta || 22), remote.chave || '']) : 'pc';
  if (P.uiCodexModelsScope === scope && Array.isArray(P.uiCodexModels) && P.uiCodexModels.length) return P.uiCodexModels;
  if (!remote && Array.isArray(MODELOS_CODEX) && MODELOS_CODEX.length) return MODELOS_CODEX;
  return [{ id: P.model || '', nome: P.model || 'padrão do Codex', desc: 'Modelo configurado; catálogo indisponível', efforts: [], padraoEffort: P.effort || 'medium' }];
}
function modeloAtual(P) {
  const ms = modelosDe(P);
  return ms.find(m => m.id === P.model) || ms.find(m => m.padrao) || ms[0];
}
function esforcosDe(P) {
  const m = modeloAtual(P);
  const e = (m?.efforts || []).map(x => (typeof x === 'string' ? { id: x, desc: EF_DESC_PT[x] || '' } : { id: x.id, desc: EF_DESC_PT[x.id] || x.desc || '' }));
  return e.length ? e : [{ id: 'medium', desc: '' }];
}

const TOOL_PT = {
  Read: 'Lendo arquivo', Write: 'Criando arquivo', Edit: 'Editando arquivo', Bash: 'Terminal',
  Glob: 'Procurando arquivos', Grep: 'Buscando no código', WebSearch: 'Pesquisando na web',
  WebFetch: 'Abrindo link', Task: 'Agente', TodoWrite: 'Lista de tarefas', Skill: 'Skill',
  NotebookEdit: 'Editando notebook', BashOutput: 'Saída do terminal',
  PushNotification: 'Avisando você', mcp__cockpit__plano: 'Plano', mcp__cockpit__perguntar: 'Pergunta',
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

/* ======================= DITADO AO VIVO =======================
   Voce fala e o texto vai aparecendo no campo, sem esperar terminar.

   Como funciona: capturamos o som cru (16 kHz, mono) e, a cada ~1s, mandamos a
   FRASE INTEIRA ate agora pro whisper em modo rapido. O que ele devolve e a
   legenda provisoria. Quando voce faz uma pausa, a frase e dada por encerrada,
   o texto dela vira definitivo e a proxima comeca do zero.

   Por que a frase inteira, e nao so o pedaco novo? Porque o whisper nao e um
   modelo de fluxo continuo: um pedaco de 1s solto, sem o que veio antes, sai
   errado quase sempre. Reenviar a frase custa mais CPU e paga com precisao.

   Por que cortar na pausa? Senao a frase cresceria sem fim e cada rodada
   ficaria mais lenta que a anterior, ate a legenda nao acompanhar mais a fala.

   Uma legenda por vez: se a anterior ainda nao voltou, a rodada e pulada. Sem
   isso a fila cresce e o texto na tela fica cada vez mais atrasado. */

const TAXA_DITADO = 16000;         // o que o modelo espera
const MS_ENTRE_RODADAS = 900;      // no maximo uma legenda nova por vez
const MS_PAUSA_FECHA = 850;        // silencio que encerra a frase
const SEG_MAX_FRASE = 18;          // frase longa demais e fechada na marra
const MIN_SEG_PRA_MANDAR = 0.6;    // menos que isto nao rende texto nenhum
/* Piso de silencio: NAO pode ser numero fixo. Medido nesta maquina, um
   microfone entrega RMS ~0,0035 falando - com um piso fixo de 0,012 nada
   contaria como fala, nenhuma frase fecharia e o ditado ficaria mudo. Entao o
   ruido do ambiente e medido enquanto voce fala e o limiar acompanha. */
const RUIDO_MIN = 0.0012;          // piso absoluto: abaixo disto e' linha morta
const RUIDO_FATOR = 3.5;           // fala = este tanto acima do ruido de fundo

/* Nivel de som do bloco (RMS). Serve pra duas coisas: saber quando ha silencio,
   e desenhar a barrinha no botao - sem ela nao da pra saber se o microfone esta
   captando, e era esse o susto de "o botao nao funciona". */
function nivelRms(bloco) {
  let s = 0;
  for (let i = 0; i < bloco.length; i++) s += bloco[i] * bloco[i];
  return Math.sqrt(s / (bloco.length || 1));
}

function juntarAmostras(pedacos) {
  let n = 0;
  for (const p of pedacos) n += p.length;
  const out = new Int16Array(n);
  let i = 0;
  for (const p of pedacos) { out.set(p, i); i += p.length; }
  return out;
}

function juntarTexto(a, b) {
  const t = String(b || '').trim();
  if (!t) return a;
  return a ? (a.replace(/\s+$/, '') + ' ' + t) : t;
}

/* O que ja esta fechado, na ordem em que foi falado. Cada frase entra com o
   texto provisorio (o do modelo rapido, que ja estava na tela) e depois troca
   pelo caprichado quando ele chega - sem nunca sumir da tela no meio. */
function textoDasFrases(d) {
  let s = '';
  for (const f of d.frases) s = juntarTexto(s, f.final != null ? f.final : f.provisorio);
  return s;
}

const TITULO_MIC = 'Ditar: falar e virar texto (Ctrl+Alt+Space de qualquer lugar, se ligado nos Ajustes). Diga "manda" pra enviar, "cancela" pra desistir, "apaga isso" pra tirar a última frase. Shift+clique para parar sem enviar.';
function ligarDitado(P, btMic, el) {
  let D = null;   // sessao de ditado em andamento

  const crescerCampo = (inp2) => {
    inp2.style.height = 'auto';
    inp2.style.height = Math.min(inp2.scrollHeight, 190) + 'px';
  };

  /* Escreve no campo sem atropelar o que a pessoa digitou: se o valor mudou por
     fora entre uma legenda e outra, o que estiver la vira a nova base. */
  const escrever = (d, texto) => {
    const inp2 = $('.p-input', el);
    if (!inp2) return;
    if (d.ultimoEscrito != null && inp2.value !== d.ultimoEscrito) {
      d.base = inp2.value;                     // teclou durante o ditado
      texto = d.base + textoDasFrases(d) + d.parcial;
    }
    inp2.value = texto;
    d.ultimoEscrito = texto;
    crescerCampo(inp2);
    P.rascunho = texto;
  };

  const pararDitado = async (motivo) => {
    if (!D) return;
    const d = D; D = null; P._ditado = null;
    clearInterval(d.timer);
    try { d.proc.onaudioprocess = null; } catch {}
    try { d.proc.disconnect(); d.fonte.disconnect(); d.mudo.disconnect(); } catch {}
    try { d.trilha.getTracks().forEach((t) => t.stop()); } catch {}   // apaga a luz do microfone
    try { d.ctx.close(); } catch {}
    btMic.classList.remove('gravando');
    btMic.style.removeProperty('--nivel');
    btMic.title = TITULO_MIC;
    try { window.api.audioDitadoCancelar({ paneId: P.id }); } catch {}

    if (motivo === 'cancelado' || P.morto) return;

    btMic.classList.add('pensando');
    try {
      // o pedaco que ficou em aberto (voce parou no meio de uma frase)
      const resto = juntarAmostras(d.frase);
      if (resto.length > TAXA_DITADO * 0.35) {
        const f = { provisorio: d.parcial.trim(), final: null };
        d.frases.push(f);
        const r = await window.api.audioDitadoFinal({ paneId: P.id, amostras: resto });
        f.final = (r && r.texto != null) ? String(r.texto).trim() : f.provisorio;
        if (r && r.error && !textoDasFrases(d).trim()) mostrarAviso({ texto: r.error, tipo: 'erro' });
      }
      // frases que fecharam ha pouco e ainda estao sendo caprichadas
      for (let i = 0; i < 120 && d.finaisNaRua > 0; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
    } catch {} finally { btMic.classList.remove('pensando'); }

    if (P.morto) return;
    d.parcial = '';
    escrever(d, d.base + textoDasFrases(d));
    if (!d.comando && !textoDasFrases(d).trim()) {   // "manda" sozinho nao e' "nao entendi"
      // nao saiu nada: dizer POR QUE, em vez de so "nao entendi"
      /* dizer QUAL e o problema. "Nao entendi" nao ajuda quem esta com o
         microfone baixo demais - e era esse o caso na medicao. */
      mostrarAviso({
        texto: d.picoGeral < 0.004
          ? 'N\u00e3o captei som nenhum. Veja se o microfone certo est\u00e1 escolhido no Windows.'
          : (d.picoGeral < 0.03
            ? 'O microfone captou muito baixo. Aumente o volume dele no Windows, ou fale mais perto.'
            : 'N\u00e3o entendi o que foi falado. Tente falar um pouco mais devagar.'),
        tipo: 'alerta',
      });
    }
    const inp2 = $('.p-input', el);
    if (inp2) { inp2.focus(); crescerCampo(inp2); }
    /* "falar e mandar" (Ajustes): parou de ditar com 3+ palavras, vai. Nao vale
       quando quem parou foi o envio ou um comando de voz (eles ja cuidam disso). */
    if (cfg.vozManda && motivo !== 'enviou' && motivo !== 'comando' && motivo !== 'botao-editar' && inp2 && inp2.value.trim()) {
      const n = textoDasFrases(d).trim().split(/\s+/).filter(Boolean).length;
      if (n >= 3) setTimeout(() => { if (!P.morto && !P._ditado) send(P); }, 60);
    }
  };
  // fechar o painel / trocar de aba tem que apagar o microfone
  P.pararGravacao = () => { pararDitado('cancelado'); };
  P.pararDitado = pararDitado;

  /* ===== comandos de voz =====
     A ultima frase fechada, se for SO' um comando, nao vira texto: vira acao.
     Sem modelo extra - a frase normalizada contra meia duzia de padroes. */
  const comandoDeVoz = (d, f) => {
    const t = normalizarFala(f.final != null ? f.final : f.provisorio);
    if (!t || t.split(' ').length > 4) return false;
    const tira = () => { const i = d.frases.indexOf(f); if (i >= 0) d.frases.splice(i, 1); return i; };
    if (/^(manda|mandar|envia|enviar)( isso| agora| ai)?$/.test(t)) {
      d.comando = true; tira(); escrever(d, d.base + textoDasFrases(d));
      pararDitado('comando').then(() => { const c = $('.p-input', el); if (!P.morto && c && c.value.trim()) send(P); });
      return true;
    }
    if (/^(cancela|cancelar)( isso| tudo| o ditado)?$/.test(t)) {
      d.comando = true; tira(); d.frases = []; d.parcial = ''; escrever(d, d.base);
      pararDitado('cancelado');
      return true;
    }
    if (/^(apaga|apagar|remove|remover) (isso|essa|essa frase|a ultima|a ultima frase|o ultimo)$/.test(t)) {
      // some a frase que veio ANTES do comando (no passe caprichado a seguinte ja pode ter fechado)
      d.comando = true;
      const i = tira();
      if (i > 0) d.frases.splice(i - 1, 1);
      escrever(d, d.base + textoDasFrases(d) + (d.parcial || ''));   // mantem a legenda que estava na tela
      return true;
    }
    if (/^proximo painel$/.test(t)) {
      d.comando = true; tira(); escrever(d, d.base + textoDasFrases(d));
      pararDitado('comando').then(() => { if (!P.morto) irParaPainel(1); });
      return true;
    }
    return false;
  };

  btMic.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (D) { pararDitado(e.shiftKey ? 'botao-editar' : 'botao'); return; }   // Shift+clique: para SEM enviar

    const disp = await window.api.audioDisponivel();
    if (!disp || !disp.ok) {
      mostrarAviso({ texto: 'A transcri\u00e7\u00e3o de \u00e1udio ainda n\u00e3o est\u00e1 instalada nesta m\u00e1quina.', tipo: 'alerta' });
      return;
    }
    // o modelo demora ~11s pra acordar na primeira vez: comeca agora, enquanto
    // a pessoa ainda esta falando a primeira frase
    try { window.api.audioAquecer(); } catch {}

    let trilha;
    try {
      trilha = await navigator.mediaDevices.getUserMedia({
        // supressao de ruido agressiva come voz baixa e a transcricao volta
        // vazia; ja o ganho automatico ajuda quem fala longe do microfone
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true },
      });
    } catch (err) {
      mostrarAviso({
        texto: (err && err.name === 'NotAllowedError')
          ? 'O Windows n\u00e3o deixou usar o microfone. Libere em Privacidade > Microfone.'
          : 'N\u00e3o consegui abrir o microfone: ' + ((err && err.name) || 'erro'),
        tipo: 'erro',
      });
      return;
    }
    if (P.morto) { try { trilha.getTracks().forEach((t) => t.stop()); } catch {} return; }

    /* Daqui em diante o microfone JA ESTA ABERTO. Qualquer tropeco tem que
       fechar a trilha antes de sair: sem isto a captura ficava ligada sem tela,
       sem botao aceso e sem jeito de parar a nao ser fechando o app. */
    let ctx, fonte, proc, mudo;
    try {
      try { ctx = new AudioContext({ sampleRate: TAXA_DITADO }); }
      catch { ctx = new AudioContext(); }
      fonte = ctx.createMediaStreamSource(trilha);
      proc = ctx.createScriptProcessor(4096, 1, 1);
      /* o ScriptProcessor so roda se estiver ligado na saida - mas com volume
         ZERO, senao o microfone sai pelo alto-falante e vira microfonia */
      mudo = ctx.createGain();
      mudo.gain.value = 0;
      fonte.connect(proc); proc.connect(mudo); mudo.connect(ctx.destination);
    } catch (err) {
      try { trilha.getTracks().forEach((t) => t.stop()); } catch {}
      try { ctx && ctx.close(); } catch {}
      mostrarAviso({ texto: 'Não consegui preparar o áudio: ' + ((err && err.message) || 'erro'), tipo: 'erro' });
      return;
    }

    const inpAgora = $('.p-input', el);
    D = {
      ctx, fonte, proc, mudo, trilha,
      base: inpAgora && inpAgora.value ? inpAgora.value.replace(/\s*$/, '') + ' ' : '',
      frases: [], parcial: '', ultimoEscrito: null,
      frase: [], amostrasNaFrase: 0,
      falouNaFrase: false, msSilencio: 0, picoGeral: 0,
      ruidoFundo: 0, blocosVistos: 0,
      pedindo: false, ultimoEnvio: 0, mandadoAte: 0, timer: 0,
      finaisNaRua: 0,
    };
    P._ditado = D;

    proc.onaudioprocess = (ev) => {
      if (!D) return;
      const ent = ev.inputBuffer.getChannelData(0);
      // o navegador pode entregar outra taxa: reamostra na mao se precisar
      const razao = ctx.sampleRate / TAXA_DITADO;
      const n = Math.max(1, Math.floor(ent.length / razao));
      const bloco = new Int16Array(n);
      let pico = 0;
      for (let i = 0; i < n; i++) {
        const v = ent[Math.min(ent.length - 1, Math.floor(i * razao))];
        const a = v < 0 ? -v : v;
        if (a > pico) pico = a;
        bloco[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
      }
      D.frase.push(bloco);
      D.amostrasNaFrase += n;
      if (pico > D.picoGeral) D.picoGeral = pico;

      const rms = nivelRms(ent);
      /* piso de ruido: comeca no primeiro bloco e depois so' desce devagar, pra
         acompanhar o ambiente sem ser puxado pra cima pela propria voz */
      /* O piso nasce no CHAO e sobe devagar. Nascendo do primeiro bloco, quem
         ja comeca falando cravava o piso no nivel da propria voz e ficava ~5s
         sem ser ouvido. Errar pra baixo so custa uma rodada a mais; errar pra
         cima deixa o ditado surdo. */
      D.blocosVistos++;
      if (rms < D.ruidoFundo || !D.ruidoFundo) D.ruidoFundo = D.ruidoFundo
        ? (D.ruidoFundo * 0.8 + rms * 0.2) : Math.max(RUIDO_MIN, rms * 0.2);
      else D.ruidoFundo = D.ruidoFundo * 0.995 + rms * 0.005;
      const limiar = Math.max(RUIDO_MIN * 2, D.ruidoFundo * RUIDO_FATOR);

      // a barrinha mostra a voz EM RELACAO ao limiar: cheia = ele te ouve bem
      btMic.style.setProperty('--nivel', Math.min(1, rms / (limiar * 2.5)).toFixed(2));
      const durMs = (n / TAXA_DITADO) * 1000;
      if (rms > limiar) { D.falouNaFrase = true; D.msSilencio = 0; }
      else D.msSilencio += durMs;
    };

    btMic.classList.add('gravando');
    btMic.title = 'Ditando\u2026 clique para parar';

    // o relogio do ditado: decide quando pedir legenda e quando fechar a frase
    D.timer = setInterval(async () => {
      if (!D || D.pedindo) return;
      const d = D;
      const segNaFrase = d.amostrasNaFrase / TAXA_DITADO;
      const agora = Date.now();
      /* microfone ligado e ninguem falando: joga o silencio fora em vez de
         deixar crescer ate o teto e gastar um passe caprichado em cima de nada.
         Guarda o ultimo meio segundo, pra nao cortar o comeco da proxima fala. */
      if (!d.falouNaFrase && segNaFrase > 2) {
        const guardar = Math.round(TAXA_DITADO * 0.5);
        const tudo = juntarAmostras(d.frase);
        const cauda = tudo.slice(Math.max(0, tudo.length - guardar));
        d.frase = [cauda]; d.amostrasNaFrase = cauda.length; d.mandadoAte = 0;
        return;
      }
      // o teto so vale pra frase em que houve fala de verdade
      const fechar = d.falouNaFrase
        && (d.msSilencio >= MS_PAUSA_FECHA || segNaFrase >= SEG_MAX_FRASE);

      if (!fechar) {
        if (agora - d.ultimoEnvio < MS_ENTRE_RODADAS) return;
        if (segNaFrase < MIN_SEG_PRA_MANDAR) return;
        if (!d.falouNaFrase) return;                      // so ruido: nao gasta rodada
        if (d.amostrasNaFrase === d.mandadoAte) return;   // nada novo desde a ultima
      } else if (segNaFrase < MIN_SEG_PRA_MANDAR) {
        // pausa numa frase curta demais: joga fora e recomeca
        d.frase = []; d.amostrasNaFrase = 0; d.falouNaFrase = false; d.msSilencio = 0;
        return;
      }

      const amostras = juntarAmostras(d.frase);

      if (fechar) {
        /* A frase entra JA na lista, com o texto provisorio que esta na tela, e
           o passe caprichado vai por fora. Sem isso, os ~4s dele seguravam a
           legenda da frase seguinte e a tela ficava parada enquanto a pessoa
           continuava falando. */
        const f = { provisorio: d.parcial.trim(), final: null };
        d.frases.push(f);
        d.parcial = '';
        d.frase = []; d.amostrasNaFrase = 0; d.mandadoAte = 0;
        d.falouNaFrase = false; d.msSilencio = 0;
        // frase que e' so' um comando ("manda", "cancela"...) vira acao, nao texto
        if (comandoDeVoz(d, f)) return;
        escrever(d, d.base + textoDasFrases(d));
        d.finaisNaRua++;
        window.api.audioDitadoFinal({ paneId: P.id, amostras }).then((r) => {
          f.final = (r && r.texto != null) ? String(r.texto).trim() : f.provisorio;
          if (D === d && d.frases.includes(f) && comandoDeVoz(d, f)) return;   // a legenda errou, o passe caprichado acertou o comando (frase ja apagada nao manda mais nada)
          if (D === d) escrever(d, d.base + textoDasFrases(d) + d.parcial);
        }).catch(() => { f.final = f.provisorio; })
          .then(() => { d.finaisNaRua--; });
        return;
      }

      d.pedindo = true; d.ultimoEnvio = agora; d.mandadoAte = d.amostrasNaFrase;
      try {
        const r = await window.api.audioDitado({ paneId: P.id, amostras });
        if (!D || D !== d) return;             // parou enquanto transcrevia
        if (r && (r.ocupado || r.descartado)) return;
        if (r && r.error) return;              // erro solto nao apaga a legenda
        const texto = (r && r.texto) || '';
        d.parcial = texto ? ((d.frases.length ? ' ' : '') + texto) : '';
        escrever(d, d.base + textoDasFrases(d) + d.parcial);
      } catch {} finally { d.pedindo = false; }
    }, 250);
  });
}

/* Motor do painel que esta nascendo. Numa aba de SERVIDOR so' o Claude roda (a
   mesma guarda do trocarMotor): um painel novo que nascia no ultimo motor usado
   -- o Codex, por exemplo -- rodava no PC enquanto a tela dizia VPS. E sem
   ultimo motor salvo o padrao e' o Claude (era o Codex). */
async function capacidadeRemota(engine, remoto) {
  if (faltaConfigurarServidor(remoto)) return false;
  try { const mapa = await window.api.motoresDisponiveis(remoto); return mapa?.[engine]?.disponivel === true; } catch { return false; }
}
function motorDoPainelNovo(pedido, aba) {
  // O destino é mantido; o backend valida capacidade sem fallback local.
  if (MOTORES.includes(pedido)) return pedido;
  return MOTORES.includes(cfg.lastEngine) ? cfg.lastEngine : 'claude';
}

function newPane(opts = {}) {
  sairDaAbertura();
  const id = 'p' + bootId + '_' + (++paneSeq);
  const el = $('#tplPane').content.firstElementChild.cloneNode(true);
  el.dataset.id = id;

  const abaId = opts.abaId || cfg.abaAtiva;
  const aba = abaPorId(abaId);
  const engine = motorDoPainelNovo(opts.engine, aba);
  // pediram um motor que nao roda nesta aba (ex.: ficha antiga de Codex numa aba
  // de servidor): nasce Claude, e a conversa/modelo daquele motor nao vem junto
  const recusado = (opts.engine && opts.engine !== engine) ? opts.engine : null;
  const P = {
    id, el, abaId,
    // ordem de nascimento: a Torre precisa de um desempate que NAO dependa de o
    // painel estar na tela ou no segundo plano (senao ela troca de ordem so'
    // porque voce trocou de pasta). O id ja' tem o numero, mas colado num texto.
    uiOrdem: paneSeq,
    engine,
    /* auditoria 1: motor recusado = a pasta pedida era do PC (a ficha do Codex
       guardava C:\...). O Claude desta aba roda no servidor: vai pra pasta DA
       ABA, sem pasta isolada do PC -- senao o ssh fazia cd 'C:\...' no Linux. */
    cwd: recusado ? cwdPadraoDaAba(aba) : (opts.cwd || cwdPadraoDaAba(aba)),
    // Pasta real comum aos motores; P.worktree continua reservado ao legado Claude.
    managedWorktree: recusado ? null : (opts.managedWorktree || null),
    model: recusado ? '' : (opts.model || ''),
    started: false, busy: false, queued: null, hist: [], passarContexto: null,
    titulo: (recusado && opts.resumeId) ? '' : (opts.titulo || ''), sessaoId: null,
    resumeId: recusado ? null : (opts.resumeId || null), sessaoFile: '', anexos: [],
    envio: cfg.envioPadrao || 'fila',
    // MESMO motor da linha do engine, acima: conferir o modo contra outro motor
    // fazia o painel mostrar "Manual" e rodar sem sandbox nenhum
    mode: modoValido(engine, opts.mode || cfg.defMode),
    effort: opts.effort || cfg.defEffort || 'high',
    // Cada motor guarda sua propria conversa e suas escolhas. Fichas antigas
    // nao tinham engineStates; os campos planos acima continuam sendo a fonte
    // retrocompativel para o motor que estava aberto.
    engineStates: (opts.engineStates && typeof opts.engineStates === 'object')
      ? JSON.parse(JSON.stringify(opts.engineStates)) : {},
    blocks: new Map(), tools: new Map(),
    chat: $('.pane-chat', el),
  };
  panes.set(id, P);
  queueMicrotask(() => window.CockpitUI?.attach(P));
  setTimeout(() => window.CockpitCollaboration?.attach(P), 0);

  // botao do motor: UM so' em todo painel, e abre a lista dos cinco
  $('.p-motor', el).addEventListener('click', (e) => { e.stopPropagation(); menuMotores(P); });

  // modelo
  $('.p-model', el).addEventListener('click', (e) => { e.stopPropagation(); menuModelos(P); });

  // pasta (so' faz sentido numa aba local; numa aba remota a pasta e' a da aba)
  const btnCwd = $('.p-cwd', el);
  const trocarCwdDoPainel = (p) => trocarPastaDoPainel(P, p);
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
  /* leva 41 (B6): medido FORA da tela (painel restaurado antes de ir pra coluna,
     painel do fundo) o scrollHeight e' 0 e o campo ficava com 0px: o rascunho
     existia e era salvo, mas so' aparecia ao digitar. Sem medida, fica a altura
     natural; o observador abaixo mede de novo quando o campo ganha largura. */
  const grow = () => { inp.style.height = 'auto'; const h = inp.scrollHeight; if (h) inp.style.height = Math.min(h, 190) + 'px'; };
  inp.addEventListener('input', grow);
  if (typeof ResizeObserver === 'function') {
    let larguraCampo = 0;
    // so' a LARGURA dispara: a altura que o grow muda nao volta aqui (sem laco)
    new ResizeObserver(() => {
      const w = inp.clientWidth;
      if (w === larguraCampo) return;
      larguraCampo = w;
      if (w && inp.value) grow();
    }).observe(inp);
  }
  let timerRascunho = 0;
  inp.addEventListener('input', () => {
    clearTimeout(timerRascunho);
    timerRascunho = setTimeout(savePanes, 900);   // guarda o rascunho, sem gravar a cada tecla
  });
  inp.addEventListener('keydown', (e) => {
    // no CLI o Shift+Tab troca o modo de permissao. Aqui ele nao era tratado:
    // virava o "voltar foco" do navegador, o cursor saia do campo e parecia
    // que o app tinha travado.
    if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); e.stopPropagation(); girarModo(P); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(P); }
    // stopPropagation: sem ele o ouvinte global tambem tratava o Esc, e com este painel parado parava TODOS os ocupados
    if (e.key === 'Escape' && !quadro) { e.stopPropagation(); if (!dialogoAberto()) tratarEsc(P); }
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
    // apagou o "@": fecha o menu e, no remoto, cancela a busca que ainda vinha
    // pela rede (senao ela abriria o menu sozinha segundos depois)
    else { if ($('.p-modal .menu-arquivos', el)) fecharMenus(); cancelarBuscaArquivos(P); }
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
  el.addEventListener('mousedown', () => { marcarConclusaoLida(P); setFocus(P); });
  el.addEventListener('keydown', () => marcarConclusaoLida(P));
  // colar: imagem da area de transferencia ou arquivo copiado no Finder/Explorer
  const colar = async (e) => {
    if (pasteDoTerminal(e)) return;   // quem cola no terminal embutido e' ele
    const dt = e.clipboardData;
    const temTexto = dt && [...(dt.items || [])].some(i => i.kind === 'string' && i.type === 'text/plain');
    const temArquivoNoEvento = dt && [...(dt.files || [])].length > 0;
    if (temArquivoNoEvento) {
      const fs2 = caminhosDosArquivos(dt);
      if (fs2.length) { e.preventDefault(); setFocus(P); await anexar(P, fs2); return; }
    }
    const r = await window.api.colados();
    if (r && r.arquivos && r.arquivos.length) {
      e.preventDefault(); setFocus(P); await anexar(P, r.arquivos); return;
    }
    if (!temTexto) e.preventDefault();
  };
  el.addEventListener('paste', colar);   // um so: o evento do campo sobe ate aqui

  // aba do topo arrastada por cima do painel nao e' arquivo: nao acende nem
  // aceita (sem o preventDefault o soltar aqui e' recusado e o arrasto cancela)
  el.addEventListener('dragover', (e) => { if (arrastandoAba || arrastaDePasta(e)) return; e.preventDefault(); el.classList.add('soltando'); });
  el.addEventListener('dragleave', () => el.classList.remove('soltando'));
  el.addEventListener('drop', async (e) => {
    if (arrastandoAba || arrastaDePasta(e)) return;
    e.preventDefault(); el.classList.remove('soltando');
    const fs = caminhosDosArquivos(e.dataTransfer);
    if (fs.length) { setFocus(P); await anexar(P, fs); }
    else if ((e.dataTransfer.files || []).length) note(P, 'Não consegui ler o caminho desse arquivo. Copie e cole aqui que funciona.', true);
  });

  $('.p-send', el).addEventListener('click', () => send(P));
  $('.p-stop', el).addEventListener('click', () => interromperPainel(P));   // durante o religar, cancela o religar

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

  // microfone: ditado AO VIVO. O texto vai aparecendo no campo enquanto voce fala.
  const btMic = $('.p-mic', el);
  btMic.innerHTML = ico('mic') + '<span class="mic-nivel"></span>';
  btMic.title = TITULO_MIC;
  ligarDitado(P, btMic, el);

  // botao +  (anexar)
  $('.p-plus', el).addEventListener('click', (e) => { e.stopPropagation(); menuAnexo(P); });
  // botao /  (comandos)
  $('.p-slash', el).addEventListener('click', (e) => { e.stopPropagation(); menuSkills(P); });
  // leva 41 (B5): quadro de fluxo a um clique (antes so' pelo "+" e pelo "/")
  const btFluxo = $('.p-fluxo', el);
  if (btFluxo) {
    btFluxo.innerHTML = ico('workflow');
    btFluxo.addEventListener('click', (e) => { e.stopPropagation(); abrirQuadro(P); });
  }

  btnCwd.textContent = (aba && aba.tipo === 'ssh') ? ('🖧 ' + aba.nome) : nomePasta(P.cwd);
  fillModels(P); paintEngine(P); pintarModo(P);

  /* nasce numa coluna so' dele, na PONTA ESQUERDA da esteira; empilhar e'
     decisao sua, arrastando. Antes ele nascia em max+1, na ponta direita: com
     a esteira cheia a sessao nova abria fora da tela e so' aparecia depois do
     scrollIntoView. Agora as que ja estavam andam uma casa pra direita e a
     nova fica onde o olho ja esta. */
  if (opts.coluna != null) {
    P.coluna = opts.coluna;
  } else {
    for (const q of panes.values()) if (q !== P) q.coluna = (q.coluna == null ? 0 : q.coluna) + 1;
    P.coluna = 0;
  }
  ligarArrastarPainel(P);
  montarColunas();
  setFocus(P);
  inp.focus();
  /* a entrada em si e' um fade curto (mv-nasce, em cockpit-anim.css). Vem
     DEPOIS do montarColunas porque ele reparenta o elemento, e reparentar
     reinicia a animacao. */
  el.classList.add('mv-nasce');
  setTimeout(() => el.classList.remove('mv-nasce'), 420);
  if (recusado) note(P, 'O ' + nomeDoMotor(recusado) + ' ainda não roda em servidor remoto. Nesta aba, o painel abriu no Claude.', true);
  setTimeout(() => el.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' }), 60);
  setTimeout(savePanes, 30);
  return P;
}

/* ===================== COLUNAS =====================
   Antes os paineis eram uma fila unica na horizontal. Agora cada painel
   pertence a uma COLUNA (P.coluna), e uma coluna pode ter varias sessoes
   empilhadas - como as abas do VS Code em grupos de editor.
   Painel novo nasce numa coluna so' dele; empilhar e' decisao sua, arrastando. */

function colunasDaTela() {
  const mapa = new Map();
  for (const P of panes.values()) {
    const c = (P.coluna == null) ? 999 : P.coluna;
    if (!mapa.has(c)) mapa.set(c, []);
    mapa.get(c).push(P);
  }
  return [...mapa.entries()].sort((a, b) => a[0] - b[0]).map(([, ps]) => ps);
}

/* renumera as colunas pra 0,1,2... - sem buracos depois de fechar painel */
function arrumarNumeroDasColunas() {
  const grupos = colunasDaTela();
  grupos.forEach((ps, i) => ps.forEach(P => { P.coluna = i; }));
  return grupos;
}

/* a largura ajustada fica com os paineis da coluna: o elemento .coluna e'
   descartado e recriado a cada montarColunas() */
function guardarLarguraDaColuna(col) {
  if (!col || !col.classList || !col.classList.contains('coluna')) return;
  const px = Math.round(col.getBoundingClientRect().width);
  const n = Number(col.dataset.coluna);
  for (const P of panes.values()) if (P.coluna === n) P.larguraColuna = px;
}

/* divisor horizontal: separa duas sessoes DENTRO da mesma coluna */
function makeSplitterH() {
  const s = document.createElement('div');
  s.className = 'pane-split-h';
  s.title = 'Arraste para ajustar a altura · clique duas vezes para dividir igual';
  s.addEventListener('dblclick', (e) => {
    e.preventDefault(); e.stopPropagation();
    const col = s.parentElement;
    if (col) for (const p of col.querySelectorAll('.pane')) p.style.flex = '';
    savePanes();
  });
  s.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const prev = s.previousElementSibling, next = s.nextElementSibling;
    if (!prev || !next) return;
    const y0 = e.clientY, h1 = prev.getBoundingClientRect().height, h2 = next.getBoundingClientRect().height;
    const move = (ev) => {
      const d = ev.clientY - y0;
      // 160: abaixo disso o campo de escrever comeca a ser cortado pelo painel
      const a = Math.max(160, h1 + d), b = Math.max(160, h2 - d);
      prev.style.flex = '0 0 ' + a + 'px'; next.style.flex = '0 0 ' + b + 'px';
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.style.cursor = ''; savePanes(); };
    document.body.style.cursor = 'row-resize';
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  });
  return s;
}

/* Monta a tela inteira a partir de panes + P.coluna. Substitui o antigo
   "enfileira painel atras de painel". Guarda e devolve o cursor, porque mover
   elemento no DOM apaga o foco de tudo que esta dentro dele. */
/* Restaurar uma aba cria os paineis um a um, e cada um pedia uma remontagem
   INTEIRA da tela (innerHTML='' + reanexar tudo). Com 5 paineis davam 10
   remontagens, cada uma piscando e mexendo em rolagem e foco. Durante o lote,
   as chamadas ficam guardadas e a montagem acontece UMA vez, no fim. */
let montagemAdiada = 0;
let montagemPedida = false;
/* ficou arvore pra carregar quando a montagem em lote terminar (ver setFocus) */
let arvorePendente = false;
async function comMontagemAdiada(fn) {
  montagemAdiada++;
  // AWAIT: sem ele o 'finally' rodava no primeiro await de dentro e o lote
  // acabava ja no primeiro painel - a economia era so' aparente
  try { return await fn(); }
  finally {
    montagemAdiada--;
    /* try/finally: se o montarColunas estourar (e' DOM), o 'arvorePendente'
       ficava preso em true PRA SEMPRE, e a guarda do setFocus
       (focusPane === P && !arvorePendente) parava de proteger -- todo mousedown
       no painel ja' em foco recarregava a arvore, uma conexao SSH por clique em
       aba remota. */
    try { if (!montagemAdiada && montagemPedida) { montagemPedida = false; montarColunas(); } }
    finally {
      /* A barra da esquerda tambem espera o lote acabar. Restaurar a aba da VPS
         (13 paineis) trocava o foco 13 vezes, e cada troca carregava a arvore:
         13 idas de SSH pra MESMA pasta, das quais o treeGen jogava 12 fora --
         mas a conexao ja' tinha aberto e o find ja' tinha rodado. Agora a
         arvore carrega UMA vez, pro painel que ficou com o foco. */
      if (!montagemAdiada && arvorePendente) { arvorePendente = false; atualizarBarraDaEsquerda(focusPane); }
    }
  }
}

function montarColunas() {
  if (montagemAdiada) { montagemPedida = true; return; }
  const caixa = $('#panes');
  if (!caixa) return;
  const tinhaFoco = document.activeElement;
  const sel = tinhaFoco && typeof tinhaFoco.selectionStart === 'number'
    ? { ini: tinhaFoco.selectionStart, fim: tinhaFoco.selectionEnd } : null;

  // reanexar um elemento no DOM zera o scrollTop dele. Sem guardar, toda
  // remontagem jogava a conversa de volta pro COMECO.
  const rolagens = new Map();
  for (const P of panes.values()) {
    if (P.chat && P.chat.isConnected) {
      rolagens.set(P.id, { topo: P.chat.scrollTop, noFim: estavaNoFim(P) });
    }
  }
  const grupos = arrumarNumeroDasColunas();
  caixa.innerHTML = '';
  caixa.appendChild(faixaDeColunaNova(0));   // soltar aqui cria coluna na frente
  grupos.forEach((ps, i) => {
    if (i) caixa.appendChild(makeSplitter());
    const col = document.createElement('div');
    col.className = 'coluna';
    col.dataset.coluna = String(i);
    // a largura que voce ajustou vive no painel, nao no elemento da coluna:
    // a coluna e' recriada a cada montagem e levava o ajuste junto
    const larg = ps.find(q => q.larguraColuna);
    if (larg) col.style.flex = '0 0 ' + larg.larguraColuna + 'px';
    ps.forEach((P, j) => {
      if (j) col.appendChild(makeSplitterH());
      col.appendChild(P.el);
      P.el.classList.toggle('empilhado', ps.length > 1);
    });
    ligarSoltarNaColuna(col, i);
    caixa.appendChild(col);
    caixa.appendChild(faixaDeColunaNova(i + 1));   // e uma depois de cada coluna
  });

  // devolve cada conversa pra onde ela estava - e quem estava no fim CONTINUA
  // no fim, mesmo que a altura tenha mudado na remontagem
  for (const P of panes.values()) {
    const r = rolagens.get(P.id);
    if (!r || !P.chat) continue;
    if (r.noFim) irProFim(P); else P.chat.scrollTop = r.topo;
  }
  if (tinhaFoco && tinhaFoco.isConnected && typeof tinhaFoco.focus === 'function') {
    try { tinhaFoco.focus(); if (sel) tinhaFoco.setSelectionRange(sel.ini, sel.fim); } catch {}
  }
}

/* ---- arrastar a sessao de uma coluna pra outra ---- */
let arrastando = null;
/* Medido: o que NAO encolhe num painel soma ~146px (nome + cabecalho + campo de
   escrever). Acima de 3 por coluna a conversa some e o campo e' cortado. */
const MAX_POR_COLUNA = 3;

function ligarArrastarPainel(P, alvo) {
  const alca = alvo || $('.pane-nome', P.el);
  if (!alca || alca.dataset.dragPaneBound) return;
  alca.dataset.dragPaneBound = 'true';
  alca.setAttribute('draggable', 'true');
  alca.addEventListener('dragstart', (e) => {
    arrastando = P.id;
    P.el.classList.add('arrastando');
    try { e.dataTransfer.setData('text/plain', P.id); e.dataTransfer.effectAllowed = 'move'; } catch {}
  });
  alca.addEventListener('dragend', () => {
    arrastando = null;
    P.el.classList.remove('arrastando');
    for (const el of document.querySelectorAll('.coluna.alvo, .faixa-nova.alvo')) el.classList.remove('alvo');
  });
}

/* Faixa fina entre as colunas. Soltar uma sessao aqui tira ela da pilha e cria
   uma COLUNA nova nesta posicao - sem isso, empilhar era um caminho sem volta. */
function faixaDeColunaNova(posicao) {
  const f = document.createElement('div');
  f.className = 'faixa-nova';
  f.title = 'Solte aqui para esta conversa virar uma coluna só dela';
  f.addEventListener('dragover', (e) => {
    if (!arrastando) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch {}
    for (const c of document.querySelectorAll('.coluna.alvo, .faixa-nova.alvo')) {
      if (c !== f) c.classList.remove('alvo');
    }
    f.classList.add('alvo');
  });
  f.addEventListener('dragleave', () => f.classList.remove('alvo'));
  f.addEventListener('drop', (e) => {
    if (!arrastando) return;
    e.preventDefault(); e.stopPropagation();
    f.classList.remove('alvo');
    const P = panes.get(arrastando);
    arrastando = null;
    if (!P) return;
    const sozinhaAqui = [...panes.values()].filter(q => q.coluna === P.coluna).length === 1;
    if (sozinhaAqui && (P.coluna === posicao || P.coluna === posicao - 1)) return;  // ja e' isso
    // abre espaco: quem estava daqui pra frente anda uma casa
    for (const q of panes.values()) if (q !== P && q.coluna >= posicao) q.coluna += 1;
    P.coluna = posicao;
    P.el.style.flex = '';
    for (const q of panes.values()) q.el.style.flex = '';
    montarColunas(); savePanes();
    note(P, 'Esta conversa virou uma coluna só dela.');
  });
  return f;
}

function ligarSoltarNaColuna(col, indice) {
  col.addEventListener('dragover', (e) => {
    if (!arrastando) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch {}
    // apaga as outras antes: saindo por cima de um filho o 'dragleave' nao vem,
    // e voce via a coluna de origem acesa junto com a de destino
    for (const c of document.querySelectorAll('.coluna.alvo, .faixa-nova.alvo')) {
      if (c !== col) c.classList.remove('alvo');
    }
    col.classList.add('alvo');
  });
  col.addEventListener('dragleave', (e) => {
    if (e.target === col) col.classList.remove('alvo');
  });
  col.addEventListener('drop', (e) => {
    if (!arrastando) return;
    e.preventDefault(); e.stopPropagation();
    col.classList.remove('alvo');
    const P = panes.get(arrastando);
    arrastando = null;
    if (!P || P.coluna === indice) return;
    const jaLa = [...panes.values()].filter(q => q.coluna === indice).length;
    if (jaLa >= MAX_POR_COLUNA) {
      note(P, 'Já são ' + MAX_POR_COLUNA + ' conversas nesta coluna. Com mais que isso o campo de escrever não cabe.', true);
      return;
    }
    const saiuDe = P.coluna;
    P.coluna = indice;
    // altura travada em pixel nao pode viajar junto: numa coluna nova ela deixa
    // buraco, e numa coluna cheia empurra o campo de escrever pra fora
    P.el.style.flex = '';
    for (const q of panes.values()) if (q.coluna === indice || q.coluna === saiuDe) q.el.style.flex = '';
    montarColunas(); savePanes();
    note(P, 'Esta conversa foi para a coluna ' + (indice + 1) + '.');
  });
}

function makeSplitter() {
  const s = document.createElement('div');
  s.className = 'pane-split';
  s.title = 'Arraste para ajustar · clique duas vezes para deixar todos do mesmo tamanho';
  s.addEventListener('dblclick', (e) => {
    e.preventDefault(); e.stopPropagation();
    for (const c of document.querySelectorAll('#panes .coluna')) c.style.flex = '';
    for (const P of panes.values()) P.larguraColuna = 0;   // volta todas ao padrao
    savePanes();
  });
  s.addEventListener('mousedown', (e) => {
    e.preventDefault();
    let prev = s.previousElementSibling, next = s.nextElementSibling;
    // As faixas de drop ficam entre a coluna e o separador. Nunca redimensionar a faixa.
    while (prev && !prev.classList.contains('coluna')) prev = prev.previousElementSibling;
    while (next && !next.classList.contains('coluna')) next = next.nextElementSibling;
    if (!prev || !next) return;
    const startX = e.clientX, w1 = prev.getBoundingClientRect().width, w2 = next.getBoundingClientRect().width;
    const move = (ev) => {
      const d = ev.clientX - startX;
      const min1 = parseFloat(getComputedStyle(prev).minWidth) || 280;
      const min2 = parseFloat(getComputedStyle(next).minWidth) || 280;
      const a = Math.max(min1, Math.min(w1 + w2 - min2, w1 + d)), b = w1 + w2 - a;
      prev.style.flex = '0 0 ' + a + 'px'; next.style.flex = '0 0 ' + b + 'px';
    };
    const up = () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      guardarLarguraDaColuna(prev); guardarLarguraDaColuna(next);   // sobrevive a remontagem
      savePanes();
    };
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
/* O que merece voltar. Antes exigia sessaoId/contexto/rascunho -- mas quem
   troca a pasta do painel, clica em "nova conversa" ou troca Claude<->Codex
   fica com sessaoId null. O painel era GRAVADO e depois DESCARTADO na leitura:
   sumia da aba, com coluna e largura junto. Toda ficha tem paneId; e' o que
   define que ela e' um painel de verdade. */
/* As leituras do servidor podem devolver { error } no lugar da lista.
   Antes qualquer falha de SSH virava uma lista vazia -- igual a "nao tem
   conversa" -- e nao dava pra saber que o problema era a chave ou a rede. */
function listaOuErro(r) {
  if (r && !Array.isArray(r) && r.error) return { itens: [], erro: r.error };
  return { itens: Array.isArray(r) ? r : [], erro: '' };
}

/* Desde o Electron 32 o File nao tem mais ".path": arrastar arquivo passou a
   nao fazer nada, calado. O caminho certo agora e' o webUtils, que o preload
   expoe. A leitura antiga fica de reserva pra versao velha. */
/* Pasta da faixa de cima arrastada por cima de um painel. Desde que as pastas
   sairam da lateral e viraram a faixa colada nos paineis (21/09/2026), todo
   arrasto de pasta cruza a area de painel -- e o painel acendia o alvo de
   "solte o arquivo aqui" e aceitava o drop, sem fazer nada. O proprio
   dataTransfer diz o tipo, entao nao precisa de flag compartilhada com o
   cockpit-ui.js (onde mora o draggingPlace). */
function arrastaDePasta(e) {
  const t = e && e.dataTransfer && e.dataTransfer.types;
  return !!t && Array.from(t).includes('application/cockpit-place');
}
function caminhosDosArquivos(dt) {
  const arqs = [...((dt && dt.files) || [])];
  const out = [];
  for (const f of arqs) {
    let p = '';
    try { p = (window.api.caminhoDoArquivo && window.api.caminhoDoArquivo(f)) || f.path || ''; } catch { p = f.path || ''; }
    if (p) out.push(p);
  }
  return out;
}

function fichaVale(f) {
  return !!(f && (f.paneId || f.sessaoId || f.contexto || f.rascunho));
}

function fichaDoPainel(P) {
  guardarEstadoDoMotor(P);
  // paneId: sem um id estavel na ficha nao da' pra saber QUAL painel da lista
  // salva corresponde a este - e a mesclagem virava sobrescrita
  /* A Torre e' a visao de TODAS as pastas. Sem o estado aqui, a conversa de uma
     pasta que ainda nao foi aberta nesta sessao so' existia como ficha, e ficha
     sem estado vale "guardada": quem estava trabalhando ou esperando resposta
     sumia da Torre e so' voltava quando voce abria aquela pasta -- a Torre
     mudando por causa da troca de pasta, que e' o que o Hugo nao quer.
     Guarda so' o que NAO e' "saved", pra ficha antiga continuar igual. */
  // typeof: esta funcao tambem roda recortada dentro de teste, sem 'window'
  const estado = typeof window === 'object' && window.CockpitUI ? window.CockpitUI.stateOf(P) : '';
  return ({ paneId: P.id, coluna: (P.coluna == null ? 0 : P.coluna),
    uiUnread: !!P.uiUnread, uiCompleted: !!P.uiCompleted,
    uiEstado: (estado && estado !== 'saved') ? estado : undefined,
    larguraColuna: P.larguraColuna || 0, engine: P.engine, cwd: P.cwd, model: P.model, mode: P.mode, effort: P.effort,
    engineStates: P.engineStates, titulo: P.titulo,
    // leva 41 (B6): de onde veio o nome (seu > 3 palavras do Cockpit > aiTitle)
    nomeManual: P.nomeManual || undefined, tituloAuto: (P.tituloAuto && !P.nomeManual) || undefined,
    sessaoId: P.sessaoId || P.resumeId || P.resumeAnterior || null, file: P.sessaoFile || '', remoto: !!(P.sessaoRemota || remotoDoPane(P)),
    // ramo que ainda nao mandou a 1a mensagem: sem guardar, reabrir o app
    // viraria CONTINUACAO da conversa de origem em vez de ramo dela
    fork: P.forkPendente || undefined,
    // branch isolada em que este painel trabalha (so' Claude): sem guardar, reabrir
    // o app voltava a conversa pra pasta principal
    worktree: P.worktree || undefined,
    managedWorktree: P.managedWorktree || undefined,
    // o desenho do quadro deste painel (cena .excalidraw); acima de 200 KB nao
    // vai pro config - ai fica so' enquanto o app estiver aberto
    quadro: P.quadroArquivo || ((P.quadroCena && P.quadroCena.length <= 200000) ? P.quadroCena : undefined),   // caminho do arquivo da cena; a cena inline so' enquanto o arquivo nao existe
    rascunho: (($('.p-input', P.el) || {}).value || '').slice(0, 24000),   // texto da inbox pode ter 20 KB
    // conversa que trocou de motor e ainda nao mandou a 1a mensagem: sem guardar
    // isto, trocar de aba no meio jogava fora tudo que ja tinha sido dito
    contexto: (P.passarContexto || '').slice(0, 20000) });
}

/* Fichas que o config tinha e que ainda NAO viraram painel na tela.

   Restaurar uma aba e' lento (cada painel busca o historico, e no servidor isso
   e' uma conexao por conversa). Se voce troca de aba no meio, o laco para - e
   antes o savePanes seguinte gravava so' os que tinham nascido, apagando o
   resto do config pra sempre. Foi assim que duas conversas do servidor sumiram
   sozinhas: eram as duas maiores, as ultimas da fila.

   Agora o que ficou pra tras espera aqui e volta pro config no proximo save.
   Some so' o que voce fechar de proposito - o closePane limpa daqui tambem. */
const fichasPendentes = new Map();   // abaId -> [ficha, ...]

function guardarPendentes(abaId, fichas) {
  if (!abaId || !fichas || !fichas.length) return;
  const antes = fichasPendentes.get(abaId) || [];
  const chave = (f) => (f && (f.paneId || (f.sessaoId && 's:' + f.sessaoId))) || null;
  const tem = new Set(antes.map(chave));
  fichasPendentes.set(abaId, antes.concat(fichas.filter((f) => !tem.has(chave(f)))));
}

function soltarPendente(abaId, P) {
  const lista = fichasPendentes.get(abaId);
  if (!lista || !P) return;
  const sessao = P.sessaoId || P.resumeId;
  const resta = lista.filter((f) => !(f.paneId && f.paneId === P.id)
                                 && !(sessao && f.sessaoId === sessao));
  if (resta.length) fichasPendentes.set(abaId, resta);
  else fichasPendentes.delete(abaId);
}

function savePanes() {
  const ab = abaAtual();
  /* cada painel volta pra ficha da PROPRIA aba. Antes ia tudo pra aba ativa:
     se um painel de outra aba escapasse pra ca' (restauracao atropelada por um
     clique, por exemplo), a conversa era gravada na aba errada e sumia da
     verdadeira. Era o "vazamento entre abas". */
  const daqui = [], deOutras = [];
  for (const P of panes.values()) {
    // aba de origem apagada: o painel fica aqui, senao a ficha dele nao teria
    // pra onde ir e sumiria calada
    const outra = ab && P.abaId && P.abaId !== ab.id && abaPorId(P.abaId);
    if (outra) { deOutras.push(P); continue; }
    // adotou a ficha: adota o painel junto, senao ele fica apontando pra uma
    // aba que nao existe e some no segundo plano pra sempre
    if (ab && P.abaId && P.abaId !== ab.id) P.abaId = ab.id;
    daqui.push(P);
  }
  const daAba = daqui.map(fichaDoPainel);
  /* o que ainda nao coube na tela continua no config: sem isto, uma restauracao
     interrompida apagava painel de verdade */
  if (ab) {
    const pend = fichasPendentes.get(ab.id) || [];
    const chave = (f) => (f && (f.paneId || (f.sessaoId && 's:' + f.sessaoId))) || null;
    const naTela = new Set(daAba.map(chave));
    ab.paineis = daAba.concat(pend.filter((f) => !naTela.has(chave(f))));
  } else cfg.panes = daAba;   // sem aba (versao antiga) ainda funciona
  // os que continuam rodando fora da tela ATUALIZAM a ficha deles na aba de
  // origem. MESCLAR, nunca substituir: trocando a lista inteira, os painéis
  // parados daquela aba (que nao estao no segundo plano) sumiam do config.
  const porAba = {};
  for (const P of panesFundo.values()) (porAba[P.abaId] = porAba[P.abaId] || []).push(fichaDoPainel(P));
  for (const P of deOutras) (porAba[P.abaId] = porAba[P.abaId] || []).push(fichaDoPainel(P));
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
/* O teto de 12 e' de MOTORES vivos, nao de conversas guardadas. Agora que toda
   aba fica com a tela montada em memoria, somar tudo faria 14 paineis em 6 abas
   estourarem o limite e voce nao conseguiria abrir NENHUM painel novo. Conta:
   os desta aba + os de outras abas que ainda estao com o motor rodando. */
/* Nao ha mais teto de painéis: o 12 estava escrito na mao em sete lugares e a
   tela aguenta bem mais (o #panes rola na horizontal, e cada painel tem 240px
   de largura minima). O que pesa e' a MAQUINA - cada painel do Claude e um
   processo proprio - entao a partir daqui o app avisa, uma vez, em vez de
   barrar. Quem decide quantos cabem e' voce. */
const totalDePaineis = () => panes.size
  + [...panesFundo.values()].filter(P => P.busy || P.started || (P.terms && P.terms.size)).length;

const PAINEIS_MUITOS = 16;
let avisouMuitosPaineis = false;

/* Sempre true: existe pra deixar claro, em cada ponto que abre painel, que ali
   havia uma trava - e pra ter um lugar so' caso um teto precise voltar. */
function cabeMaisPainel() {
  const n = totalDePaineis();
  if (n >= PAINEIS_MUITOS && !avisouMuitosPaineis) {
    avisouMuitosPaineis = true;
    mostrarAviso({
      texto: 'Você já tem ' + n + ' painéis abertos. Cada um é um processo à parte — '
        + 'de olho na memória se a máquina começar a arrastar. Não vou mais avisar.',
      tipo: 'alerta',
    });
  }
  return true;
}

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
/* (obs: agora TODO painel fica em panesFundo ao sair da aba, entao estas duas
   contas olham P.busy / P.pedindoPerm, nunca a mera presenca no mapa) */
function esperandoPorAba() {
  const conta = {};
  for (const P of panesFundo.values()) if (P.pedindoPerm) conta[P.abaId] = (conta[P.abaId] || 0) + 1;
  return conta;
}

/* qualquer troca que reinicia o motor precisa destravar o painel: antes,
   trocar de modelo no meio de uma resposta deixava "trabalhando…" eterno e
   toda mensagem nova ficava presa na fila */
/* auditoria 2: devolve um texto ao campo de escrever SEM apagar o que ja' esta'
   la' (junta na frente, como a fila). Antes, com o campo ocupado, a mensagem
   que voltava era descartada calada. */
function devolverAoCampo(P, texto) {
  const t = String(texto == null ? '' : texto).trim();
  const inp = t && P && P.el ? $('.p-input', P.el) : null;
  if (!inp) return false;
  const atual = String(inp.value || '').trim();
  if (atual === t || atual.startsWith(t + '\n\n')) return true;   // ja' voltou
  inp.value = atual ? (t + '\n\n' + inp.value) : t;
  inp.style.height = 'auto'; if (inp.scrollHeight) inp.style.height = Math.min(inp.scrollHeight, 190) + 'px';
  return true;
}

/* auditoria 2: trocar modo, modelo, esforco, motor, conta ou pasta para o
   painel. Com a resposta rodando, avisa que ela foi cortada. Durante o
   "Religo em N s" nao ha' resposta rodando: o que morre e' o RELIGAR -- o
   recado diz isso e o chip "Continuar" volta (antes dizia "resposta
   interrompida" e o "continue" que ia sair sumia). */
function antesDaTroca(P) { return { ocupado: !!(P && P.busy), religando: !!(P && P._religar) }; }
function avisarTroca(P, antes, oQue, o) {
  const x = o || {};
  if (!P || P.morto || !antes) return;
  if (antes.religando) note(P, 'Cancelei a religação automática (você ' + (x.voce || ('trocou ' + oQue)) + '). ' + (x.depois || 'Mande "continue" pra retomar.'), true);
  else if (antes.ocupado && !x.soReligar) note(P, 'A resposta em andamento foi interrompida para ' + (x.acao || ('trocar ' + oQue)) + '.', true);
}

/* auditoria 2: o painel virou OUTRA conversa (apagou a de antes, trocou a pasta,
   ficha de motor recusado). O nome da anterior nao pode ir junto -- com o
   nomeManual ligado ele era gravado no id NOVO do nomes.json. */
function zerarNomeDaConversa(P) {
  P.titulo = ''; P.nomeManual = false; esquecerTituloAuto(P);
  /* conferencia final: marca ONDE a conversa nova comeca no P.hist. O hist
     antigo fica (leva o contexto na troca de motor), mas as falas de antes da
     marca nao sao desta conversa -- sem isto, depois de apagar a conversa ou
     trocar a pasta, a 1a mensagem nunca ganhava o nome de 3 palavras. */
  const h = Array.isArray(P.hist) ? P.hist : [];
  P._fimDaConversaAnterior = h.length ? h[h.length - 1] : null;
  if (P.el) pintarNome(P);
}

/* trocar a pasta do painel (botao da pasta ou menu /). Pasta nova = conversa nova. */
async function trocarPastaDoPainel(P, p) {
  window.CockpitUI?.cancelResume(P);
  if (!p || !P) return;
  const antes = antesDaTroca(P);
  P.cwd = p; P.managedWorktree = null;
  const btnCwd = $('.p-cwd', P.el); if (btnCwd) btnCwd.textContent = nomePasta(p);
  await window.api.paneStop({ paneId: P.id, engine: P.engine });
  if (P.morto) return;
  destravarPainel(P);
  avisarTroca(P, antes, 'a pasta', { soReligar: true, depois: 'Pasta nova começa conversa nova.' });
  limparSessoesDeTodosMotores(P);
  // pasta nova = conversa nova: com o resumeId antigo o Claude procurava a
  // sessao na pasta errada, nao achava, e o painel caia em looping
  P.resumeId = null; P.sessaoId = null; P.sessaoFile = ''; P.resumeAnterior = null;
  P.started = false; setDot(P, 'off');
  zerarNomeDaConversa(P);   // auditoria 2: o nome da conversa de antes nao passa pra nova
  limparPlano(P); limparAuditoria(P); zerarTurno(P); P.forkPendente = false; P.avisoModelo = null; P.acpInfo = null; P.acpModelos = null; P.worktree = null; mostrarPastaNoPainel(P);
  // aba remota nem chega aqui (o botao da pasta recusa antes), mas a arvore
  // segue o PAINEL de qualquer jeito -- nunca o formato do caminho
  if (focusPane === P) { loadTree(P.cwd, remotoDoPane(P)); $('#tbTitle').textContent = shortPath(P.cwd) + '  ·  ' + nomeDoMotor(P.engine); }
  note(P, 'Pasta: ' + shortPath(p)); savePanes(); atualizarGit(P);
}

function destravarPainel(P) {
  /* auditoria 1: parada de proposito (trocar motor/modelo/modo/pasta) durante o
     "Religo em 8 s": o religar pendente morre aqui. Antes ele ficava agendado,
     o painel seguia "trabalhando" e a mensagem que ele ia reenviar sumia. */
  if (P._religar) cancelarReligar(P);
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

function guardarEstadoDoMotor(P) {
  if (!P || !P.engine) return;
  if (!P.engineStates || typeof P.engineStates !== 'object') P.engineStates = {};
  P.engineStates[P.engine] = {
    model: P.model || '', effort: P.effort || '', mode: P.mode || '',
    sessaoId: P.sessaoId || null, sessaoFile: P.sessaoFile || '',
    sessaoRemota: !!P.sessaoRemota,
    resumeId: P.resumeId || P.resumeAnterior || null,
    forkPendente: !!P.forkPendente,
    worktree: P.worktree || null,
  };
}

function limparSessoesDeTodosMotores(P) {
  if (!P || !P.engineStates || typeof P.engineStates !== 'object') return;
  for (const s of Object.values(P.engineStates)) {
    if (!s || typeof s !== 'object') continue;
    s.sessaoId = null; s.sessaoFile = ''; s.sessaoRemota = false;
    s.resumeId = null; s.forkPendente = false; s.worktree = null;
  }
}

function restaurarEstadoDoMotor(P, engine) {
  const s = P.engineStates && P.engineStates[engine];
  P.started = false;
  P.model = (s && s.model) || '';
  P.modeloDoPadrao = false;   // auditoria 2: o fillModels liga de novo se o padrao entrar no vazio
  P.effort = (s && s.effort) || cfg.defEffort || 'high';
  P.mode = modoValido(engine, (s && s.mode) || cfg.defMode);
  P.sessaoId = (s && s.sessaoId) || null;
  P.sessaoFile = (s && s.sessaoFile) || '';
  P.sessaoRemota = !!(s && s.sessaoRemota);
  P.resumeId = (s && (s.sessaoId || s.resumeId)) || null;
  P.resumeAnterior = null;
  P.forkPendente = !!(s && s.forkPendente);
  P.worktree = (s && s.worktree) || null;
  return !!P.resumeId;
}

async function trocarMotor(P, novo) {
  if (!P || P.morto || novo === P.engine) return;
  // clicar duas vezes rapido fazia duas trocas se atropelarem no meio
  if (P._trocando) return;
  const engineAnterior = P.engine, abaAnterior = P.abaId, remotoAnterior = remotoDoPane(P);
  const origemAnterior = JSON.stringify(remotoAnterior), geracaoConta = P.uiContaGeracao || 0;
  const painelValido = () => !P.morto && P.engine === engineAnterior && P.abaId === abaAnterior
    && JSON.stringify(remotoDoPane(P)) === origemAnterior && geracaoConta === (P.uiContaGeracao || 0);
  /* motor que nao esta na maquina: recusa AQUI, nao so' nos menus. Quem
     chegasse por outro caminho trocava pro motor ausente e o painel so'
     quebrava na primeira mensagem, ja com a conversa desmontada. */
  if (!remotoAnterior && motorDisponivel[novo] === false) {
    note(P, 'O ' + nomeDoMotor(novo) + ' não está instalado nesta máquina. ' + (COMO_INSTALAR[novo] || ''), true);
    return;
  }
  P._trocando = true;
  try {
    if (remotoAnterior && !(await capacidadeRemota(novo, remotoAnterior))) {
      if (painelValido()) note(P, 'Motor indisponível neste servidor. Nenhuma execução local foi iniciada.', true);
      return;
    }
    if (!painelValido()) return;
    window.CockpitUI?.cancelResume(P);
    P.uiEnvioGeracao = (P.uiEnvioGeracao || 0) + 1;
    const antigo = nomeDoMotor(P.engine);
    guardarEstadoDoMotor(P);
    // monta o contexto ANTES de mexer no estado do painel
    const contexto = P.hist.length ? montarContexto(P) : null;
    const religava = !!P._religar;   // auditoria 2: o recado certo se o que morre e' o religar
    await window.api.paneStop({ paneId: P.id, engine: P.engine });
    if (!painelValido()) return;
    // o motor morre de proposito, entao 'engine-down' NAO chega pra destravar:
    // sem isto, trocar de motor no meio de uma resposta deixava "trabalhando…"
    // pra sempre e toda mensagem nova caia na fila em vez de ser enviada
    destravarPainel(P);
    if (religava) note(P, 'Cancelei a religação automática (você trocou o motor). Mande "continue" pra retomar.', true);
    P.engine = novo;
    // o modo real era da sessao do motor anterior: no botao do motor novo ele mentia
    P.modoReal = null; P._avisouModo = false;
    const voltando = restaurarEstadoDoMotor(P, novo);
    // contador de contexto e' do outro motor: continuar mostrando mente
    // o painel vai reiniciar: o microfone nao pode continuar ligado sozinho
    if (P.pararGravacao) { try { P.pararGravacao(); } catch {} }
    P.tokens = 0; P.janela = 0; pintarTokens(P);
    P.blocks.clear(); esquecerPassos(P);
    // plano, sugestao, auditoria e rastro do turno sao da conversa que acabou
    limparPlano(P); limparAuditoria(P); zerarTurno(P); P.avisoModelo = null; P.acpInfo = null; P.acpModelos = null;
    cfg.lastEngine = novo; window.api.setConfig(cfg);
    fillModels(P); paintEngine(P); mostrarPastaNoPainel(P); pintarModo(P); setDot(P, 'off');
    // o modo do motor antigo pode nao existir no novo: cai no primeiro dele.
    // ANTES do savePanes: gravando o modo velho, ao reabrir o app o painel caia
    // no modo mais permissivo do motor novo sem ninguem ter escolhido isso
    P.mode = modoValido(novo, P.mode);
    pintarModo(P);
    // Na primeira visita ao motor ele recebe o contexto visivel. Ao voltar para
    // um motor que ja tinha sessao, retoma a conversa real daquele motor.
    P.passarContexto = voltando ? null : contexto;
    savePanes();   // depois de definir o contexto, senao ele nao era guardado
    marcaTroca(P, antigo, nomeDoMotor(novo));
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
  let escolhido = ms.find(m => m.id === P.model);
  const conversaAtiva = !!(P.started || P.sessaoId || P.resumeId || P.resumeAnterior);
  // Quando o catalogo chega depois da ficha, uma escolha removida pode ser
  // exibida como indisponivel, mas nunca troca silenciosamente uma thread viva.
  /* auditoria 1: o modelo VAZIO que vira o padrao passa a ser o escolhido. Antes
     o rotulo era decidido com o "escolhido" de antes da troca, e a conversa
     reaberta pela lista (P.model = '') aparecia "claude-sonnet-5 (indisponível)". */
  if (!escolhido && !(P.model && conversaAtiva)) {
    escolhido = ms.find(m => m.padrao) || ms[0]; P.model = escolhido.id;
    P.modeloDoPadrao = true;   // auditoria 2: ninguem escolheu -- trocar o padrao nos Ajustes alcanca este painel vazio
  }
  const ef = esforcosDe(P);
  if (!ef.find(e => e.id === P.effort) && !(P.model && conversaAtiva && !escolhido)) {
    P.effort = modeloAtual(P).padraoEffort || ef[Math.min(2, ef.length - 1)].id;
  }
  const nome = (!escolhido && P.model && conversaAtiva) ? P.model + ' (indisponível)' : modeloAtual(P).nome;
  $('.p-model', P.el).innerHTML = ico(P.engine === 'acp' ? 'plug' : 'brain') + '<span>' + nome + '</span>';
}

/* A pasta ja aparece na aba la em cima. Ela so' precisa ficar no painel quando
   a aba tem MAIS DE UMA pasta (ex: Members = backend + frontend), porque ai a
   aba sozinha nao diz em qual delas este painel esta. */
function mostrarPastaNoPainel(P) {
  const bt = $('.p-cwd', P.el);
  if (!bt) return;
  const aba = abaPorId(P.abaId) || abaAtual();
  // aba remota SEMPRE mostra: e' ali que aparece em qual servidor o painel esta
  const mostrar = !!aba && (aba.tipo === 'ssh' || pastasDaAba(aba).length > 1 || !!P.worktree || !!P.managedWorktree);
  bt.classList.toggle('hidden', !mostrar);
  // painel local: escreve SEMPRE (com ou sem worktree), senao o "⎇ nome" ficava
  // no botao depois de sair do worktree
  if (!remotoDoPane(P)) bt.textContent = nomePasta(P.cwd) + (P.managedWorktree ? '  ⎇ ' + (P.managedWorktree.branch || 'isolada') : P.worktree ? '  ⎇ ' + P.worktree : '');
}

/* Um botao so', em TODO painel: mostra o motor de agora e abre a lista dos
   cinco. Ate a leva 38 o topo tinha duas telas pra mesma acao -- um interruptor
   de dois lados (Claude|Codex) e, so' nos outros motores, este botao. Alem de
   inconsistente, a tela mentia: sentado num painel Claude nao havia caminho
   nenhum ate o Gemini, o Grok ou o ACP a nao ser pela paleta de comandos. */
function pintarBotaoDeMotor(P) {
  const bt = $('.p-motor', P.el);
  if (!bt) return;
  /* paintEngine roda a CADA evento de resize da janela (o listener no fim do
     arquivo). Sem esta saida, arrastar a borda reescrevia dois SVGs por painel
     em todo quadro do arrasto, de graca. O interruptor antigo escapava disso
     por acidente: ele saia cedo justamente nos paineis Claude e Codex. */
  if (bt.dataset.motor === P.engine) return;
  bt.dataset.motor = P.engine;
  $('.logo-lugar', bt).innerHTML = svgMotor(P.engine);
  $('.pm-nome', bt).textContent = nomeDoMotor(P.engine);
  $('.pm-seta', bt).innerHTML = ico('chevron-down');
  // ⌘ e' a convencao do app (o boot troca por "Ctrl+" no Windows) -- mas
  // aquele rewrite roda uma vez so', antes de existir painel, entao aqui a
  // troca e' na hora
  bt.title = atalhoDaMaquina('Motor: ' + nomeDoMotor(P.engine) + ' — clique pra trocar (⌘⇧M alterna Claude e Codex)');
}

/* Ctrl+Shift+M: o vaivem que o interruptor de dois lados fazia num clique so'.
   Em Claude ou Codex ele alterna direto; fora disso abre a lista, em vez de
   escolher por voce.

   As duas recusas do trocarMotor viram lista, nao tecla morta:
     - ABA REMOTA so' roda o Claude. Insistir no vaivem daria ate' a nota
       ERRADA: a ordem das guardas la' embaixo culpa "nao esta instalado" antes
       de chegar no "nao roda em servidor", e voce instalaria o Codex a toa.
     - O OUTRO CLI PODE NAO EXISTIR nesta maquina. A lista marca quem falta e
       diz como instalar; a tecla sozinha so' piscaria uma nota. */
function alternarMotor(P) {
  if (remotoDoPane(P) && window.CockpitUI) return window.CockpitUI.agentLayer(P, 'engine');
  // aba remota: o UNICO movimento que o trocarMotor deixa e' voltar pro Claude
  // (painel Codex ali existe -- novaConversa e a tela de abertura criam na aba
  // ativa, VPS inclusive). Fora dessa volta, a lista.
  if (remotoDoPane(P)) {
    if (P.engine !== 'claude' && motorDisponivel.claude !== false) return trocarMotor(P, 'claude');
    return menuMotores(P);
  }
  if (P.engine === 'claude' && motorDisponivel.codex !== false) return trocarMotor(P, 'codex');
  if (P.engine === 'codex' && motorDisponivel.claude !== false) return trocarMotor(P, 'claude');
  return menuMotores(P);
}

/* Um lugar so' pra escrever atalho em titulo: o app usa ⌘ e o boot troca por
   "Ctrl+" no Windows (EH_WIN, la' no fim). Texto criado DEPOIS do boot -- como
   o do botao de motor, que nasce com o painel -- nao passa por aquele rewrite,
   entao converte aqui. */
function atalhoDaMaquina(txt) { return EH_WIN ? String(txt).replace(/\u2318/g, 'Ctrl+').replace(/\u21e7/g, 'Shift+') : txt; }

function paintEngine(P) {
  // mesmo motivo da saida antecipada do pintarBotaoDeMotor: paintEngine roda a
  // cada resize, e este logo (o gigante do painel vazio) tambem era reescrito
  // em todo quadro do arrasto
  const vazio = $('.pe-logo', P.el);
  if (vazio && vazio.dataset.motor !== P.engine) { vazio.dataset.motor = P.engine; vazio.innerHTML = svgMotor(P.engine); }
  mostrarPastaNoPainel(P);
  for (const eng of MOTORES) P.el.classList.toggle('eng-' + eng, P.engine === eng);
  // motor sem cor propria cai no roxo generico. As regras eng-gemini/grok/acp
  // vem depois no CSS e ganham dele: isto e' o cinto de um motor novo
  P.el.classList.toggle('eng-outro', P.engine !== 'codex' && P.engine !== 'claude');
  pintarBotaoDeMotor(P);
}
/* A barra da esquerda (arvore + titulo do projeto) e' UMA so' pra todos os
   paineis: quem manda nela e' o painel em foco. Ela sai do setFocus de
   proposito -- durante uma montagem em lote o foco muda uma vez por painel, e
   no remoto cada troca custava uma conexao SSH inteira. */
/* A arvore so' e' carregada quando da' pra VER. A barra da esquerda nasce
   FECHADA (o boot esconde #sidebar), e sem esta conferencia cada clique num
   painel de aba remota abria uma conexao SSH -- mais uma por pasta lembrada no
   'expanded' -- pra pintar uma arvore que ninguem estava olhando: com 3 pastas
   abertas, um clique = 4 conexoes. O titulo e o nome do projeto continuam
   sendo atualizados sempre; so' a leitura de pasta espera. */
function viewLateralVisivel(view) {
  const v = $('.side-view[data-view="' + view + '"]');
  if (!v || !v.isConnected || v.closest('.hidden,[hidden]') || !v.getClientRects().length) return false;
  const camada = v.closest('.ck-layer');
  if (camada && camada.closest('.ck-overlay')) return true;
  const barra = $('#sidebar');
  return !!barra && barra.contains(v) && !barra.classList.contains('hidden');
}
function arvoreNaTela() {
  return viewLateralVisivel('explorer');
}
let arvoreEsperandoBarra = false;
function atualizarBarraDaEsquerda(P) {
  if (!P) return;
  const remoto = remotoDoPane(P);
  const podeVer = arvoreNaTela();
  arvoreEsperandoBarra = !podeVer;   // ficou pra tras: carrega quando a barra abrir
  if (remoto) {
    /* Arvore DENTRO do servidor (leva 37). O proprio loadTree incrementa o
       treeGen, que e' o que impede uma resposta lenta de SSH de pintar a arvore
       do painel que voce ja' deixou pra tras -- a barra da esquerda e' UMA so'
       pra todos os paineis. */
    if (podeVer) loadTree(P.cwd || remoto.caminhoRemoto, remoto);
    $('#projName').textContent = '🖧 ' + (remoto.usuario || '') + '@' + (remoto.host || '');
    $('#tbTitle').textContent = remoto.usuario + '@' + remoto.host + ':' + (P.cwd || remoto.caminhoRemoto) + '  ·  ' + nomeDoMotor(P.engine);
    return;
  }
  if (podeVer) loadTree(P.cwd);
  atualizarGit(P);
  $('#tbTitle').textContent = shortPath(P.cwd) + '  ·  ' + nomeDoMotor(P.engine);
  $('#projName').textContent = P.cwd === HOME ? 'Pasta: ' + ESTE_PC + ' inteiro' : ('Pasta: ' + baseNome(P.cwd));
}
/* A barra apareceu (abriu, ou trocou pra view de arquivos): a arvore que ficou
   esperando carrega AGORA, uma vez so'. Se nada ficou pendente, nao pede nada
   -- voltar da Torre pra Arquivos nao pode custar uma conexao. */
function barraDaEsquerdaApareceu() {
  if (arvoreEsperandoBarra && arvoreNaTela()) atualizarBarraDaEsquerda(focusPane);
}
function marcarConclusaoLida(P) {
  if (!P?.uiUnread) return;
  P.uiUnread = false;
  savePanes();
  window.CockpitUI?.refresh();
}
function setFocus(P) {
  window.CockpitUI?.refresh();
  if (!P) return;
  /* o 'arvorePendente' entra na conta: com um painel so', o setFocus do fim da
     restauracao cai neste mesmo painel e antes voltava aqui -- a arvore nunca
     seria carregada. */
  if (focusPane === P && !arvorePendente) return;
  const trocou = focusPane !== P;
  focusPane = P;
  if (trocou) {
    for (const q of panes.values()) q.el.classList.toggle('focus', q === P);
    irAtePainel(P);
  }
  // montagem em lote: a arvore fica pendente e o comMontagemAdiada a carrega
  // UMA vez no fim, pro painel que sobrou com o foco
  if (montagemAdiada) { arvorePendente = true; return; }
  arvorePendente = false;
  atualizarBarraDaEsquerda(P);
}
function soltarTerminaisMortos(P) {
  if (!P || !P.termsMortos) return;
  for (const id of P.termsMortos) { const t = termsVivos.get(id); if (t && t.term) { t.onDiscard?.(); try { t.term.dispose(); } catch {} } termsVivos.delete(id); }
  P.termsMortos.clear();
}

function matarTerminaisDoPainel(P) {
  soltarTerminaisMortos(P);   // os que ja tinham terminado sozinhos
  if (P) P._fecharTerm = null;
  if (!P || !P.terms) return;
  for (const tid of [...P.terms]) {
    try { window.api.termKill({ id: tid }); } catch {}
    const t = termsVivos.get(tid);
    if (t) {
      t.onDiscard?.();
      if (t.ro) { try { t.ro.disconnect(); } catch {} t.ro = null; }
      try { t.term.dispose(); } catch {} termsVivos.delete(tid);
    }
  }
  P.terms.clear();
}

async function closePane(id) {
  window.CockpitUI?.cancelResume(acharPainel(id));
  const P = panes.get(id); if (!P) return;
  if (panes.size === 1) { note(P, 'Este é o último painel.'); return; }
  clearInterval(P.relogio); P.relogio = 0;
  clearInterval(P.relogioRobos); P.relogioRobos = 0;
  clearTimeout(P.timerNome); P.timerNome = 0;
  pararIrProFim(P);
  soltarNavArquivos(P);
  P.morto = true;
  if (P.debateId && window.api.debateStop) { try { await window.api.debateStop(P.debateId); } catch {} }
  soltarPendente(P.abaId, P);   // fechou de proposito: nao volta no proximo save
  // caixa aberta de um painel que morre: solta o motor do outro lado
  if (P.perguntaAberta) { try { window.api.perguntaResponder({ id: P.perguntaAberta.id, cancelado: true }); } catch {} }
  P.filaPerg = null; P.perguntaAberta = null;
  if (P.pararGravacao) { try { P.pararGravacao(); } catch {} }
  const tj = $('#avisoPaineis');
  if (tj && tj._itens) { tj._itens.delete(id); }
  matarTerminaisDoPainel(P);
  await window.api.paneStop({ paneId: id, engine: P.engine });
  if (quadro && quadro.P === P) fecharQuadro();   // o desenho nao pode ficar preso num painel morto
  P.el.remove(); panes.delete(id);
  for (const q of panes.values()) q.el.style.flex = '';
  montarColunas();
  if (focusPane === P) setFocus([...panes.values()][0]);
  savePanes();
  sincronizarPendencias();
}
/* Sair da aba. Quem está TRABALHANDO (ou com terminal aberto) continua vivo em
   segundo plano; quem está parado é desligado como antes — nesse caso não custa
   nada, porque a conversa volta sozinha com --resume na próxima mensagem. */
async function guardarPaineisDaAba() {
  for (const P of panes.values()) {
    // trabalhando (ou com terminal aberto) = o MOTOR continua rodando tambem
    const motorContinua = !!(P.busy || (P.terms && P.terms.size));
    soltarNavArquivos(P);

    /* o painel continua vivo no fundo, mas o MICROFONE nao pode continuar
       ligado sem ninguem olhando: o ditado para aqui e o que ja virou texto
       fica no campo, esperando voce voltar */
    if (P.pararGravacao) { try { P.pararGravacao(); } catch {} }

    // TODO painel fica guardado com a tela montada. Antes, quem estava parado
    // era destruido e remontado do zero na volta - por isso "todos os chats
    // carregavam" a cada troca de aba. Guardar o desenho custa memoria, nao
    // processo, e faz a volta ser instantanea.
    if (quadro && quadro.P === P) fecharQuadro();
    P.el.remove();
    panesFundo.set(P.id, P);
    if (motorContinua) continue;

    /* Parado: desliga so' o MOTOR. A conversa fica na tela e religa com
       --resume na proxima mensagem, sem recarregar nada.

       O que vinha aqui embaixo antes era o caminho de DESTRUIR o painel
       (P.morto = true, matar os terminais, parar de novo). Ele fazia sentido
       quando sair da aba jogava o painel fora; depois que a leva 17 passou a
       guardar todos, virou uma armadilha: o painel voltava desenhado mas morto
       por dentro, e dezesseis caminhos do app desistem quando P.morto e
       verdadeiro - o ditado, o nome automatico da conversa, o relogio do turno.
       Painel guardado nao morre. */
    P.uiEnvioGeracao = (P.uiEnvioGeracao || 0) + 1;
    await window.api.paneStop({ paneId: P.id, engine: P.engine });
    desligarMotor(P);   // guarda o endereco da conversa antes de desligar
  }
  $('#panes').innerHTML = '';   // so' os divisores; os paineis ja sairam inteiros
  panes.clear();
  focusPane = null;
}

/* A tela tem que respeitar a ordem salva da aba. Quem voltou vivo era sempre
   colocado ANTES dos recriados, e o savePanes seguinte gravava essa ordem
   trocada - o embaralhamento virava permanente. */
function reordenarPaineis(fichasSalvas) {
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
  // a ordem do MAPA manda na ordem da tela (montarColunas percorre panes)
  if (ordem.length) {
    panes.clear();
    for (const P of ordem) panes.set(P.id, P);
    montarColunas();
    return;
  }
}

/* Voltar pra aba: quem ficou rodando volta pra tela do jeito que estava. */
function trazerPaineisDoFundo(abaId) {
  const caixa = $('#panes');
  let quantos = 0;
  for (const P of [...panesFundo.values()]) {
    if (P.abaId !== abaId) continue;
    panesFundo.delete(P.id);
    panes.set(P.id, P);
    // fora da tela o scroll nao anda: sem isto voce voltava no COMECO da conversa
    irProFim(P);
    if (P.busy) trabalhando(P);   // recria o bloco e religa o relogio do turno
    quantos++;
  }
  if (quantos) {
    montarColunas();
    // montarColunas ja devolve a rolagem, mas quem volta do segundo plano
    // tinha scrollHeight ZERO enquanto estava fora da tela: garante o fim aqui
    for (const P of panes.values()) if (P.abaId === abaId) irProFim(P);
  }
  return quantos;
}

/* ---- reordenar as abas do topo (leva 41, B4) ----
   Arrastar a aba muda o lugar dela na barra; o botao direito tem "Mover para a
   esquerda/direita" pra quem nao quer arrastar. So' a ORDEM de cfg.abas muda:
   cada aba continua sendo o mesmo objeto, com os mesmos paineis, e a ativa
   continua ativa. Ctrl+Shift+1..9 seguem a ordem nova. */
let arrastandoAba = null;        // id da aba na mao -- NAO e' o 'arrastando' dos paineis
let abasRepintarDepois = false;  // alguem pediu pintura da barra no meio do arrasto
ICONES['arrow-left'] = '<path d="m12 19-7-7 7-7" /> <path d="M19 12H5" />';
ICONES['arrow-right'] = '<path d="M5 12h14" /> <path d="m12 5 7 7-7 7" />';

/* conta pura: a lista com o item de 'de' levado pra casa 'para' (presa nas
   pontas). Sempre uma COPIA -- quem estiver percorrendo a lista velha no meio
   de um await nao ve os itens pularem de lugar. */
function moverNaLista(lista, de, para) {
  const copia = Array.isArray(lista) ? lista.slice() : [];
  if (!Number.isInteger(de) || de < 0 || de >= copia.length) return copia;
  const destino = Math.max(0, Math.min(copia.length - 1, Number.isFinite(para) ? Math.trunc(para) : de));
  const [item] = copia.splice(de, 1);
  copia.splice(destino, 0, item);
  return copia;
}
/* soltou antes (ou depois) da aba 'alvo': em que casa a aba de 'de' termina.
   Tirando ela da lista, quem estava a direita anda uma casa pra tras. */
function indiceAoSoltar(de, alvo, depois) {
  const para = alvo + (depois ? 1 : 0);
  return para > de ? para - 1 : para;
}
function moverAbaLocal(id, para) {
  const lista = abasLocais();
  const de = lista.findIndex(a => a.id === id);
  if (de < 0) return false;
  const nova = moverNaLista(lista, de, para);
  if (nova.every((a, i) => a === lista[i])) return false;
  cfg.abas = nova;
  window.api.setConfig(cfg);
  pintarAbasLocal();
  return true;
}
function moverAbaUmaCasa(id, passo) {
  const lista = abasLocais();
  const i = lista.findIndex(a => a.id === id);
  const para = i + passo;
  if (i < 0 || para < 0 || para >= lista.length) return false;
  return moverAbaLocal(id, para);
}

function comecarArrastoDeAba(e, id, bt) {
  arrastandoAba = id;
  fecharPopGlobal();
  try {
    // tipo proprio, nao text/plain: soltando no campo de escrever, ele colaria o id
    e.dataTransfer.setData('application/x-cockpit-aba', id);
    e.dataTransfer.effectAllowed = 'move';
  } catch {}
  // meio apagada so' depois do navegador tirar a "foto" que acompanha o mouse
  setTimeout(() => { if (arrastandoAba === id) bt.classList.add('al-arrastando'); }, 0);
}
function limparMarcaDeSoltar() {
  for (const x of document.querySelectorAll('.aba-local.al-antes, .aba-local.al-depois')) x.classList.remove('al-antes', 'al-depois');
}
function terminarArrastoDeAba() {
  if (!arrastandoAba) return;
  arrastandoAba = null;
  limparMarcaDeSoltar();
  for (const x of document.querySelectorAll('.aba-local.al-arrastando')) x.classList.remove('al-arrastando');
  if (abasRepintarDepois) pintarAbasLocal();
}
/* onde a aba cai: em cima de uma aba, antes ou depois dela conforme a metade;
   no vao entre duas, no "+" ou no espaco vazio da barra, antes da primeira aba
   que esta a direita do mouse (ou depois da ultima) -- sem buraco onde "nao
   acontece nada". */
function alvoDoSoltar(box, x) {
  const botoes = [...box.querySelectorAll('.aba-local[data-aba-id]')];
  if (!botoes.length) return null;
  let bt = botoes[botoes.length - 1], depois = true;
  for (const b of botoes) {
    const r = b.getBoundingClientRect();
    if (x >= r.left && x <= r.right) { bt = b; depois = x >= r.left + r.width / 2; break; }
    if (x < r.left) { bt = b; depois = false; break; }
  }
  const alvo = abasLocais().findIndex(a => a.id === bt.dataset.abaId);
  return alvo < 0 ? null : { bt, alvo, depois };
}
/* ligado UMA vez na barra (a caixa fica; so' os botoes de dentro sao refeitos).
   Arquivo e painel arrastados passam reto: aqui so' reage com aba na mao. */
function ligarSoltarNaBarraDeAbas(box) {
  if (box.dataset.soltarAba) return;
  box.dataset.soltarAba = '1';
  /* dragenter tambem: entrando numa aba nova o Chromium manda so' o dragenter
     (o dragover vem no passo seguinte), e a barrinha ficava um passo atrasada */
  const aoPassar = (e) => {
    if (!arrastandoAba) return;
    e.preventDefault();
    limparMarcaDeSoltar();
    const de = abasLocais().findIndex(a => a.id === arrastandoAba);
    const onde = alvoDoSoltar(box, e.clientX);
    // cair onde ja esta: sem barrinha e sem "mover" (soltar ali nao faz nada)
    if (!onde || de < 0 || indiceAoSoltar(de, onde.alvo, onde.depois) === de) {
      try { e.dataTransfer.dropEffect = 'none'; } catch {}
      return;
    }
    try { e.dataTransfer.dropEffect = 'move'; } catch {}
    onde.bt.classList.add(onde.depois ? 'al-depois' : 'al-antes');
  };
  box.addEventListener('dragenter', aoPassar);
  box.addEventListener('dragover', aoPassar);
  box.addEventListener('dragleave', (e) => {
    if (!arrastandoAba) return;
    // saiu da barra de verdade, nao so' passou de um botao pro outro. Pelo
    // ponto e nao pelo relatedTarget: o dragleave do botao velho chega DEPOIS
    // do dragenter do novo, e apagava a barrinha que acabou de acender
    const r = box.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom) limparMarcaDeSoltar();
  });
  box.addEventListener('drop', (e) => {
    if (!arrastandoAba) return;
    e.preventDefault();
    const id = arrastandoAba;
    const de = abasLocais().findIndex(a => a.id === id);
    const onde = alvoDoSoltar(box, e.clientX);
    terminarArrastoDeAba();
    if (onde && de >= 0) moverAbaLocal(id, indiceAoSoltar(de, onde.alvo, onde.depois));
  });
  // rede de seguranca: se o 'dragend' da aba se perder, o proximo clique
  // encerra o arrasto (durante um arrasto de verdade nao existe mousedown)
  document.addEventListener('mousedown', terminarArrastoDeAba, true);
}

/* botao direito na aba: o jeito de reordenar sem arrastar */
function menuDaAbaLocal(ab, bt) {
  const pop = abrirPopGlobal(bt);
  const lista = abasLocais();
  const i = lista.findIndex(a => a.id === ab.id);
  const item = (texto, icone, pode, passo) => {
    const x = document.createElement('div');
    x.className = 'mi' + (pode ? '' : ' mi-desligado');
    x.innerHTML = '<div class="mi-ic"></div><div class="mi-txt"><div class="mi-n"></div></div>';
    $('.mi-ic', x).innerHTML = ico(icone);
    $('.mi-n', x).textContent = texto;
    if (pode) {
      x.addEventListener('click', () => { fecharPopGlobal(); moverAbaUmaCasa(ab.id, passo); });
      // da' pra usar pelo teclado tambem (tecla de menu na aba -> Tab/Enter)
      x.tabIndex = 0;
      x.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); x.click(); } });
    } else x.setAttribute('aria-disabled', 'true');
    return x;
  };
  pop.appendChild(item('Mover para a esquerda', 'arrow-left', i > 0, -1));
  pop.appendChild(item('Mover para a direita', 'arrow-right', i >= 0 && i < lista.length - 1, 1));
  const primeiro = pop.querySelector('.mi[tabindex]');
  if (primeiro) primeiro.focus();
}

/* ---- desenha as abas no topo (tipo aba de navegador) ---- */
function pintarAbasLocal() {
  const box = $('#abasLocal');
  if (!box) return;
  // com uma aba na mao, refazer os botoes tiraria do lugar justo o que voce
  // segura (e o fim do arrasto se perderia): pinta quando soltar
  if (arrastandoAba) { abasRepintarDepois = true; return; }
  window.CockpitUI?.refresh();
  abasRepintarDepois = false;
  try { pintarAbasLocalMiolo(box); }
  catch (e) {
    // se der erro, mostra na propria barra em vez de sumir em silencio
    box.innerHTML = '<span style="color:var(--red);font-size:11px;padding:0 8px">Erro nas abas: ' + (e && e.message || e) + '</span>';
  }
}
function pintarAbasLocalMiolo(box) {
  ligarSoltarNaBarraDeAbas(box);
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
    bt.title = ondeAba + '\n\n(duplo clique para editar esta aba)\n(arraste para reordenar, ou use o botão direito)';
    // arrastar reordena; o clique simples continua trocando de aba (depois de
    // um arrasto o navegador nao dispara 'click', entao arrastar nao troca)
    bt.draggable = true;
    bt.dataset.abaId = ab.id;
    bt.addEventListener('dragstart', (e) => comecarArrastoDeAba(e, ab.id, bt));
    bt.addEventListener('dragend', terminarArrastoDeAba);
    bt.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); menuDaAbaLocal(ab, bt); });
    bt.addEventListener('click', (e) => { if (!e.target.closest('.al-x')) trocarAbaLocal(ab.id); });
    // so' edita com duplo clique na aba em que voce JA esta. Clicando rapido
    // entre abas diferentes, o navegador tambem dispara 'dblclick' - e o modal
    // de editar (que cobre a tela inteira) abria sem voce pedir, travando tudo.
    bt.addEventListener('dblclick', (e) => {
      if (e.target.closest('.al-x')) return;
      if (trocandoAba || ab.id !== cfg.abaAtiva) return;
      abrirModalAbaLocal(ab);
    });
    if (podeApagar) $('.al-x', bt).addEventListener('click', (e) => { e.stopPropagation(); apagarAbaLocal(ab); });
    box.appendChild(bt);
  }
  const add = document.createElement('button');
  add.className = 'aba-local aba-local-add';
  add.innerHTML = ico('plus');
  add.title = 'Nova aba (pasta ou servidor remoto)';
  add.addEventListener('click', () => abrirModalAbaLocal(null));
  box.appendChild(add);

  // a barra superior saiu (a moldura do Windows ja diz o nome do app), entao o
  // botao de "abrir painel ao lado" mudou pra ca, no canto direito
  const espaco = document.createElement('span');
  espaco.className = 'abas-espaco';
  box.appendChild(espaco);
  const maisPainel = document.createElement('button');
  maisPainel.className = 'abas-add-painel';
  maisPainel.innerHTML = ico('plus');
  maisPainel.title = 'Abrir painel ao lado (Ctrl+T)';
  maisPainel.addEventListener('click', () => { if (cabeMaisPainel()) newPane(); });
  box.appendChild(maisPainel);
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
  verTodasAsConversas.claude = verTodasAsConversas.codex = false;   // filtro volta ao normal
  savePanes();
  await guardarPaineisDaAba();
  const contaAntes = porMotor('');
  for (const eng of MOTORES) contaAntes[eng] = lugarDaContaAtiva(eng).chave;
  cfg.abaAtiva = novoId;
  window.api.setConfig(cfg);
  pintarAbasLocal();
  sincronizarPendencias();
  repintarContaSeMudouDeLugar(contaAntes);
  $('#panes').style.display = '';
  for (const eng of MOTORES) histCache[eng] = null;
  const abaLateralAberta = $$('.side-view').find(v => !v.classList.contains('hidden'));
  for (const eng of MOTORES) if (abaLateralAberta && abaLateralAberta.dataset.view === 'h' + eng) loadHist(eng, true);
  // quem ficou trabalhando nesta aba volta INTEIRO: nao recarrega, nao reinicia
  const voltaram = trazerPaineisDoFundo(novoId);
  const ab = abaAtual();
  const salvos = (ab && Array.isArray(ab.paineis)) ? ab.paineis.filter(fichaVale) : [];
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
  if (gen === abaGen) { reordenarPaineis(salvos); savePanes(); devolverOCursor(); }
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

/* A lateral segue a aba ativa: indo do PC pra VPS (ou entre dois servidores),
   o cartao e o medidor do motor cuja conta mudou de lugar sao repintados. Antes
   eles continuavam mostrando a conta do PC dentro da aba da VPS. */
function repintarContaSeMudouDeLugar(antes) {
  for (const eng of MOTORES) {
    if (!CONTA_NO_SERVIDOR[eng] || lugarDaContaAtiva(eng).chave === antes[eng]) continue;
    pintarCartaoConta(eng);
    carregarUsoSidebar(eng);
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
  // painel guardado dessa aba morre com ela (agora sao todos, nao so' os que
  // estavam trabalhando)
  for (const P of [...panesFundo.values()]) {
    if (P.abaId !== ab.id) continue;
    panesFundo.delete(P.id);
    clearInterval(P.relogio); P.relogio = 0;
    P.morto = true;
    // debate do painel morre com a aba (antes seguia gastando, sem tela pra mostrar)
    if (P.debateId && window.api.debateStop) { try { await window.api.debateStop(P.debateId); } catch {} }
    matarTerminaisDoPainel(P);
    try { await window.api.paneStop({ paneId: P.id, engine: P.engine }); } catch {}
  }
  cfg.abas = abasLocais().filter(a => a.id !== ab.id);
  window.api.setConfig(cfg);
  pintarAbasLocal();
}

/* ---- criar/editar aba: nome + tipo (pasta local ou servidor remoto) ---- */
function bloqueioEdicaoDestino(existente, dado) {
  if (!existente) return '';
  const identidade = (a) => a.tipo === 'ssh'
    ? JSON.stringify(['ssh', a.host || '', a.usuario || '', Number(a.porta ?? 22), a.chave || '', a.caminhoRemoto || '~'])
    : 'local';
  if (identidade(existente) === identidade(dado)) return '';
  const vinculados = (Array.isArray(existente.paineis) && existente.paineis.length)
    || [...panes.values(), ...panesFundo.values()].some(P => !P.morto && P.abaId === existente.id);
  return vinculados ? 'Feche os painéis desta aba antes de alterar o destino, ou crie uma nova aba para o outro servidor. As conversas guardadas são preservadas.' : '';
}
function abrirModalAbaLocal(existente, seed) {
  seed = seed || {};
  const remoteSeed = !existente && seed.remoto ? { ...seed.remoto, caminhoRemoto: seed.caminho || seed.remoto.caminhoRemoto || "~" } : null;
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
    +   '<label for="abPorta" class="mo-dica">Porta SSH</label><input id="abPorta" type="number" min="1" max="65535" step="1" value="22">'
    +   '<div class="mo-dica">Chave privada (arquivo SSH)</div>'
    +   '<div class="path-box" id="abChaveMostra">—</div>'
    +   '<button class="mo-btn" id="abEscolherChave">Escolher arquivo</button>'
    +   '<input id="abCaminho" placeholder="Pasta no servidor (opcional), ex: ~/projeto">'
    + '</div>'
    + '<div class="mo-form" id="abCorpoConectores">'
    +   '<div class="mo-dica">Conectores (MCP) nesta aba — vale pros painéis do Claude, a partir da próxima ligação</div>'
    +   '<div id="abConectoresLista" class="conectores-lista"></div>'
    +   '<div class="mo-dica" id="abConectoresNota"></div>'
    + '</div>'
    + '<div class="mo-dica" style="margin-top:10px">Cor</div>'
    + '<div class="cor-linha">' + GRUPO_CORES.map(c => '<button class="cor-sw" data-cor="' + c + '" style="background:' + c + '"></button>').join('') + '</div>'
    + '<div id="abDestinoErro" class="mo-dica hidden" role="alert"></div>'
    + '<div class="mo-rodape"><button class="mo-btn destaque" id="abOk">' + (editando ? 'Salvar' : 'Criar aba') + '</button>'
    + '<button class="mo-btn" id="abCancela">Cancelar</button></div>';
  $('.mo-x', cx).onclick = fecharModalGlobal;
  $('#abCancela', cx).onclick = fecharModalGlobal;

  let tipo = (existente && existente.tipo) || (remoteSeed ? 'ssh' : 'local');
  let pastasEscolhidas = (existente && existente.tipo === 'local') ? pastasDaAba(existente) : (!existente && seed.caminho && !remoteSeed ? [seed.caminho] : []);
  let chaveEscolhida = (existente && existente.chave) || remoteSeed?.chave || '';
  let corEscolhida = (existente && existente.cor) || GRUPO_CORES[Math.floor(Math.random() * GRUPO_CORES.length)];

  const pintaTipo = () => {
    $$('.tipo-bt', cx).forEach(b => b.classList.toggle('on', b.dataset.tipo === tipo));
    $('#abCorpoLocal', cx).classList.toggle('hidden', tipo !== 'local');
    $('#abCorpoSsh', cx).classList.toggle('hidden', tipo !== 'ssh');
    // painel remoto roda o Claude no servidor: os conectores daqui nao valem la'
    const cc = $('#abCorpoConectores', cx); if (cc) cc.classList.toggle('hidden', tipo !== 'local');
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
    if (p && !pastasEscolhidas.some(x => mesmaPasta(x, p))) {
      pastasEscolhidas.push(p); pintarPastas();
      if (!editando && !$('#abNome', cx).value.trim()) $('#abNome', cx).value = baseNome(p);
    }
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

  /* Perfil de conectores da aba: a lista vem do que as sessoes do Claude ja
     anunciaram (cfg.conectoresVistos); o que fica DESMARCADO e' guardado em
     aba.conectoresFora - assim conector novo nasce ligado. */
  let conectoresFora = (existente && Array.isArray(existente.conectoresFora)) ? existente.conectoresFora.slice() : [];
  const pintarNotaConectores = () => {
    const nota = $('#abConectoresNota', cx);
    if (!nota) return;
    nota.textContent = conectoresFora.length
      ? conectoresFora.length + (conectoresFora.length === 1 ? ' conector desligado' : ' conectores desligados') + ' nesta aba: menos contexto por turno e painel ligando mais rápido.'
      : 'Todos ligados (padrão). Desmarque o que esta aba não usa.';
  };
  const pintarConectores = () => {
    const box = $('#abConectoresLista', cx);
    if (!box) return;
    // o 'cockpit' (perguntar, plano) nao e' opcional: fica fora da lista
    const vistos = Array.isArray(cfg.conectoresVistos) ? cfg.conectoresVistos.filter((n) => n !== 'cockpit').sort((a, b) => a.localeCompare(b)) : [];
    box.innerHTML = '';
    if (!vistos.length) {
      const nota = $('#abConectoresNota', cx);
      if (nota) nota.textContent = 'Abra um painel do Claude uma vez: a lista dos conectores da sua conta aparece aqui.';
      return;
    }
    for (const nome of vistos) {
      const l = document.createElement('label');
      l.className = 'chave conector-item';
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = !conectoresFora.includes(nome);
      c.addEventListener('change', () => {
        conectoresFora = conectoresFora.filter((n) => n !== nome);
        if (!c.checked) conectoresFora.push(nome);
        pintarNotaConectores();
      });
      const s = document.createElement('span');
      s.textContent = nome.replace(/^claude\.ai /, '☁ ').replace(/^plugin:/, '🧩 ');
      l.appendChild(c); l.appendChild(s);
      box.appendChild(l);
    }
    pintarNotaConectores();
  };
  pintarConectores();

  $('#abNome', cx).value = existente ? existente.nome : (seed.caminho ? baseNome(seed.caminho) : '');
  const dadosSsh = existente?.tipo === 'ssh' ? existente : remoteSeed;
  if (dadosSsh) {
    $('#abHost', cx).value = dadosSsh.host || '';
    $('#abUsuario', cx).value = dadosSsh.usuario || '';
    $('#abPorta', cx).value = dadosSsh.porta ?? 22;
    $('#abCaminho', cx).value = dadosSsh.caminhoRemoto || '';
  }
  setTimeout(() => $('#abNome', cx)?.focus(), 30);

  $('#abOk', cx).onclick = () => {
    const nome = $('#abNome', cx).value.trim();
    const mostrarErro = (texto) => { const aviso = $('#abDestinoErro', cx); aviso.textContent = texto; aviso.classList.remove('hidden'); };
    if (!nome) { mostrarErro('Dê um nome a este lugar.'); $('#abNome', cx).focus(); return; }
    let dado;
    if (tipo === 'ssh') {
      const host = $('#abHost', cx).value.trim(), usuario = $('#abUsuario', cx).value.trim();
      const compacto = $('#abEndereco', cx);
      if (compacto && !compacto.reportValidity()) { compacto.focus(); return; }
      if (!host || !usuario || !chaveEscolhida) { mostrarErro('Preencha o endereço e o usuário e escolha a chave SSH.'); return; }
      const campoPorta = $('#abPorta', cx), porta = Number(campoPorta.value);
      campoPorta.setCustomValidity(Number.isInteger(porta) && porta >= 1 && porta <= 65535 ? '' : 'Informe uma porta entre 1 e 65535.');
      if (!campoPorta.checkValidity()) { const detalhes = campoPorta.closest('details'); if (detalhes) detalhes.open = true; }
      if (!campoPorta.reportValidity()) { campoPorta.focus(); return; }
      dado = { nome, tipo: 'ssh', host, usuario, porta, chave: chaveEscolhida, caminhoRemoto: $('#abCaminho', cx).value.trim() || '~', cor: corEscolhida };
    } else {
      dado = { nome, tipo: 'local', caminhos: pastasEscolhidas.slice(), caminho: null, cor: corEscolhida, conectoresFora: conectoresFora.slice() };
    }
    const bloqueio = bloqueioEdicaoDestino(existente, dado);
    if (bloqueio) {
      const aviso = $('#abDestinoErro', cx); aviso.textContent = bloqueio; aviso.classList.remove('hidden');
      return;
    }
    const contaAntes = porMotor('');
    for (const eng of MOTORES) contaAntes[eng] = lugarDaContaAtiva(eng).chave;
    if (editando) { Object.assign(existente, dado); }
    else {
      if (!Array.isArray(cfg.abas)) cfg.abas = [];
      cfg.abas.push(Object.assign({ id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), paineis: [] }, dado));
    }
    window.api.setConfig(cfg);
    fecharModalGlobal();
    pintarAbasLocal();
    // trocou o servidor da aba ativa: a conta da lateral passa a ser a do novo
    repintarContaSeMudouDeLugar(contaAntes);
    /* Trocou host, usuario ou a pasta do SERVIDOR: ninguem avisava os paineis.
       O P.cwd congelava no servidor ANTIGO (ou no C:\ da abertura), a arvore
       seguia listando o A e o titulo dizia A -- clicar num no' colava caminho
       do A na mensagem que ia pro B, e o duplo clique pedia arquivo do A ao
       servidor B (o 'remoto' do closure e' A, o remotoDoPane ja' e' B). */
    if (editando && existente && existente.tipo === 'ssh') {
      const casa = cwdPadraoDaAba(existente);
      for (const Q of [...panes.values(), ...panesFundo.values()]) if (Q.abaId === existente.id) Q.cwd = casa;
      savePanes();
    }
    // a aba pode ter ganhado ou perdido pasta: sem avisar os paineis, o botao
    // da pasta continuava escondido e o popup dele abria no canto da janela
    for (const Q of panes.values()) mostrarPastaNoPainel(Q);
    /* E a barra da esquerda na mao: o setFocus sai cedo quando o painel ja'
       esta' em foco (focusPane === P && !arvorePendente), entao arvore e titulo
       ficavam no servidor velho ate' voce clicar em outro painel. */
    if (editando && existente && existente.tipo === 'ssh' && focusPane && focusPane.abaId === existente.id) atualizarBarraDaEsquerda(focusPane);
    for (const eng of MOTORES) histCache[eng] = null;
    const abaLateralAberta = $$('.side-view').find(v => !v.classList.contains('hidden'));
    for (const eng of MOTORES) if (abaLateralAberta && abaLateralAberta.dataset.view === 'h' + eng) loadHist(eng, true);
  };
  window.CockpitUI?.placeDialog?.(cx, existente, () => ({
    host: $('#abHost', cx).value.trim(), usuario: $('#abUsuario', cx).value.trim(),
    porta: Number($('#abPorta', cx).value), chave: chaveEscolhida,
    caminhoRemoto: $('#abCaminho', cx).value.trim() || '~',
  }));
}

function pintarTokens(P) {
  window.CockpitUI?.refresh();
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
  P.uiLastState = state;
  window.CockpitUI?.refresh();
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
    case 'PushNotification': return { txt: 'Avisando você', det: curto };
    case 'mcp__cockpit__plano': return { txt: 'Atualizando o plano', det: '' };
    case 'mcp__cockpit__perguntar': return { txt: 'Perguntando pra você', det: '' };
    // categorias do ACP que nao existem no Claude
    case 'Excluindo': return { txt: 'Excluindo', det: soNome(a) };
    case 'Movendo': return { txt: 'Movendo', det: curto };
    case 'Pensando': return { txt: 'Pensando', det: curto };
    default: return { txt: toolLabel(nome), det: curto };
  }
}

function passo(P, frase, id, nome) {
  if (!P.busy) return;
  clearEmpty(P);
  let box = P.passosEl;
  if (!box || box.parentNode !== P.chat) {
    box = document.createElement('div');
    box.className = 'passos';
    box._n = 0; box._erros = 0;   // contadores: o cabecalho nao rele a caixa a cada passo
    P.chat.appendChild(box);
    P.passosEl = box;
  }
  const d = document.createElement('div');
  d.className = 'passo';
  d.dataset.tipo = tipoDoPasso(nome || frase.txt);
  d.innerHTML = '<span class="pa-pt"></span><span class="pa-t"></span><span class="pa-d"></span>';
  $('.pa-t', d).textContent = frase.txt;
  $('.pa-d', d).textContent = frase.det || '';
  if (id) d.dataset.id = id;
  box.appendChild(d);
  /* Antes um laco apagava o primeiro filho da caixa acima de oito. Um turno
     de leva emite 34+ passos; o erro do passo 21 sumia da tela E do DOM, e a
     prova do que aconteceu evaporava. Agora TODOS ficam: acima de 8 a caixa
     mostra os 8 ultimos (e todo erro, sempre), com um cabecalho pra abrir o
     resto e filtrar por tipo. */
  ajustarCaixaDePassos(box, d);
  /* A caixa so' e' movida quando NAO esta' no fim. Um appendChild numa caixa de
     900 passos re-inseria os 900 nos a cada ferramenta (medido na auditoria:
     8ms por passo, 45ms com a linha do tempo aberta - 3,5s num turno de leva). */
  const ultimo = (P.trabEl && P.trabEl.parentNode === P.chat) ? P.trabEl.previousElementSibling : P.chat.lastElementChild;
  if (ultimo !== box) P.chat.appendChild(box);
  if (P.trabEl && P.chat.lastElementChild !== P.trabEl) P.chat.appendChild(P.trabEl);
  scroll(P);
}

function passoPronto(P, id, erro) {
  const d = acharPasso(P, id);
  if (!d) return;
  const box = d.parentElement;
  const caixa = !!(box && box.classList && box.classList.contains('passos'));
  if (erro && caixa && !d.classList.contains('erro')) box._erros = (box._erros == null ? passosDaCaixa(box).filter((x) => x.classList.contains('erro')).length : box._erros) + 1;
  d.classList.add(erro ? 'erro' : 'ok');
  if (erro && caixa) pintarCabecalhoDePassos(box);   // o cabecalho passa a contar o erro
}

const PASSOS_VISIVEIS = 8;
const passosDaCaixa = (box) => [...box.children].filter((x) => x.classList.contains('passo'));
/* de que tipo e' o passo, pro filtro do cabecalho (o nome cru da ferramenta
   quando ha', senao a frase traduzida) */
function tipoDoPasso(nome) {
  const n = String(nome || '');
  if (/^(Bash|Terminal|BashOutput|execute)$/i.test(n) || /terminal/i.test(n)) return 'terminal';
  if (/^(Read|Write|Edit|MultiEdit|NotebookEdit|Excluindo|Movendo)$/i.test(n) || /arquivo/i.test(n)) return 'arquivo';
  if (/^(Grep|Glob|WebSearch|WebFetch)$/i.test(n) || /(Procurando|Buscando|Pesquisando|Abrindo uma)/i.test(n)) return 'busca';
  return 'outro';
}
/* Recontagem completa: so' quando a caixa nao tem os contadores (ou quando a
   janela dos 8 nasce e todos precisam ser marcados de uma vez). */
function recontarCaixa(box) {
  const todos = passosDaCaixa(box);
  box._n = todos.length;
  box._erros = todos.filter((x) => x.classList.contains('erro')).length;
  todos.forEach((x, i) => x.classList.toggle('recente', i >= todos.length - PASSOS_VISIVEIS));
}
/* Passo novo = trabalho constante: entra o novo na janela dos 8 ultimos, sai o
   que ficou 9 posicoes atras; o cabecalho e' atualizado no lugar. */
function ajustarCaixaDePassos(box, novo) {
  if (!novo || box._n == null) recontarCaixa(box);
  else {
    box._n++;
    if (box._n === PASSOS_VISIVEIS + 1) recontarCaixa(box);   // a janela nasce: marca os 8 de uma vez
    else if (box._n > PASSOS_VISIVEIS) {
      novo.classList.add('recente');
      let sai = novo;
      for (let i = 0; i < PASSOS_VISIVEIS && sai; i++) sai = sai.previousElementSibling;
      if (sai && sai.classList.contains('passo')) sai.classList.remove('recente');
    }
  }
  let cab = $('.passos-vivo', box);
  if (box._n <= PASSOS_VISIVEIS) {
    if (cab) cab.remove();
    box.classList.remove('grande', 'tudo');
    return;
  }
  box.classList.add('grande');
  if (!cab) {
    cab = document.createElement('div');   // div: botao dentro de botao e' HTML invalido
    cab.className = 'passos-vivo';
    box.insertBefore(cab, box.firstChild);
  }
  pintarCabecalhoDePassos(box);
}
const rotuloDeErros = (erros) => (erros ? ' · ' + erros + (erros === 1 ? ' erro' : ' erros') : '');
function pintarCabecalhoDePassos(box) {
  const cab = $('.passos-vivo', box);
  if (!cab) return;
  if (box._n == null) recontarCaixa(box);
  const n = box._n, erros = box._erros || 0;
  const aberto = box.classList.contains('tudo');
  // atualiza NO LUGAR: refazer por innerHTML a cada passo recriava os botoes de
  // filtro debaixo do cursor
  let t = $('.pv-txt', cab);
  if (!t) {
    t = document.createElement('button');
    t.type = 'button';
    t.className = 'pv-txt';
    t.addEventListener('click', (e) => {
      e.stopPropagation();
      box.classList.toggle('tudo');
      if (!box.classList.contains('tudo')) delete box.dataset.filtro;   // filtro e' coisa da caixa aberta
      pintarCabecalhoDePassos(box);
    });
    cab.appendChild(t);
  }
  t.textContent = (aberto ? 'esconder os passos anteriores' : 'ver todos os ' + n + ' passos') + rotuloDeErros(erros);
  t.title = aberto ? 'Recolher (os 8 últimos e os erros continuam à vista)' : 'Abrir a linha do tempo inteira deste trecho';
  cab.classList.toggle('com-erro', erros > 0);
  let filtros = $('.pv-filtros', cab);
  if (!aberto) { if (filtros) filtros.remove(); return; }
  if (!filtros) { filtros = criarFiltrosDePassos(box); cab.appendChild(filtros); }
  for (const b of filtros.children) b.classList.toggle('on', (box.dataset.filtro || '') === (b.dataset.filtro || ''));
}
function criarFiltrosDePassos(box) {
  const filtros = document.createElement('span');
  filtros.className = 'pv-filtros';
  for (const [id, rotulo] of [['', 'tudo'], ['terminal', 'terminal'], ['arquivo', 'arquivos'], ['busca', 'buscas'], ['outro', 'outros']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pv-f';
    b.dataset.filtro = id;
    b.textContent = rotulo;
    b.title = id ? 'Mostrar só os passos de ' + rotulo + ' (erros ficam sempre)' : 'Mostrar todos os passos';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (id) box.dataset.filtro = id; else delete box.dataset.filtro;
      pintarCabecalhoDePassos(box);
    });
    filtros.appendChild(b);
  }
  return filtros;
}

/* Fecha a caixa de passos ATUAL sem mexer nela: ela fica no lugar, e a proxima
   ferramenta abre outra, abaixo. E o que preserva a ordem "falou, fez, falou". */
/* Zera o que o painel guarda sobre a tela. Os cinco pontos que apagam o chat
   chamam isto: sem soltar as caixas seladas, elas ficavam na lista apontando
   pra elementos que ja sairam do documento. */
/* Desliga o motor SEM perder o endereco da conversa.

   Ao ligar, o app passa --resume e zera o P.resumeId (aquele id ja foi gasto).
   De la pra frente quem guarda o endereco e o P.sessaoId, que o motor mandou no
   'system init'. Entao todo lugar que desliga o motor precisa devolver esse
   endereco pro resumeId - senao a proxima mensagem sobe uma conversa NOVA e o
   Claude responde sem lembrar de nada, com a conversa inteira ainda na tela.

   Ja aconteceu duas vezes por esquecimento em pontos diferentes. Por isso agora
   e uma funcao so'. */
function desligarMotor(P) {
  if (!P) return;
  P.uiEnvioGeracao = (P.uiEnvioGeracao || 0) + 1;
  // inclui o guardado: entre ligar o motor e a sessao nascer, os outros dois
  // sao null, e sem ele a conversa religava do zero
  P.resumeId = P.sessaoId || P.resumeId || P.resumeAnterior;
  P.started = false;
  clearInterval(P.relogio); P.relogio = 0;
  setDot(P, 'off');
}

function esquecerPassos(P) {
  P.passosEl = null;
  P.passosSelados = null;
}

function selarPassos(P) {
  const box = P.passosEl;
  P.passosEl = null;
  if (!box) return;
  if (!box.children.length) { box.remove(); return; }
  (P.passosSelados || (P.passosSelados = [])).push(box);
}

/* no fim do turno os passos viravam pó. Agora encolhem num resumo clicavel,
   pra dar pra conferir depois o que ele mexeu. */
function recolherCaixa(box, P) {
  if (!box || box.parentNode !== P.chat) { if (box) box.remove(); return; }
  const passos = passosDaCaixa(box);
  const n = passos.length;
  if (!n) { box.remove(); return; }
  if (box.classList.contains('recolhido')) return;
  // o cabecalho "ao vivo" sai; o de recolhido assume (e os erros ficam a vista)
  const vivo = $('.passos-vivo', box);
  if (vivo) vivo.remove();
  box.classList.remove('grande', 'tudo');
  delete box.dataset.filtro;
  box.classList.add('recolhido');
  const erros = passos.filter((x) => x.classList.contains('erro')).length;
  const rotulo = (n === 1 ? '1 passo' : n + ' passos') + rotuloDeErros(erros);
  const cab = document.createElement('button');
  cab.className = 'passos-cab' + (erros ? ' com-erro' : '');
  cab.textContent = rotulo;
  cab.title = 'Ver o que ele fez aqui';
  cab.addEventListener('click', () => {
    box.classList.toggle('aberto');
    cab.textContent = box.classList.contains('aberto') ? 'esconder passos' : rotulo;
  });
  box.insertBefore(cab, box.firstChild);
}

function limparPassos(P) {
  // recolhe a caixa aberta E as que ficaram pelo caminho do turno
  const abertas = (P.passosSelados || []).slice();
  P.passosSelados = null;
  const atual = P.passosEl;
  P.passosEl = null;
  for (const b of abertas) recolherCaixa(b, P);
  recolherCaixa(atual, P);
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
/* "45s", "3m05s", "1h30", "48h", "3 dias". Antes nao tinha hora nem dia: uma
   sessao de dois dias aparecia na Torre como "ha 2880m00s". */
function duracaoCurta(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm' + String(s % 60).padStart(2, '0') + 's';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h' + String(m % 60).padStart(2, '0');
  if (h < 72) return h + 'h';
  return Math.floor(h / 24) + ' dias';
}
/* linha discreta no fim do turno: quanto levou, quanto consumiu e o que mudou */
function marcarFimDoTurno(P) {
  window.CockpitUI?.refresh();
  if (!P.t0) return;
  const levou = Date.now() - P.t0;
  P.t0 = 0;
  const temMudanca = !!(P.diffTurno || (P.mudancasTurno && P.mudancasTurno.length));
  const prints = (P.printsTurno || []).slice();   // congela: o proximo turno zera
  // resposta curta, sem mudanca e sem print nao precisa de carimbo
  if (levou < 3000 && !temMudanca && !prints.length) return;
  const d = document.createElement('div');
  d.className = 'turno-fim';
  const tok = P.tokens ? ' · ' + (P.tokens / 1000).toFixed(1) + 'k de contexto' : '';
  // consumo DESTE turno (entrada nova + saida), quando o motor informa
  const uso = P.usoTurno ? ' · ' + fmtK(P.usoTurno.entrada) + '↑ ' + fmtK(P.usoTurno.saida) + '↓' : '';
  d.textContent = 'levou ' + duracaoCurta(levou) + uso + tok;
  if (temMudanca) {
    const n = P.diffTurno ? arquivosDoDiffUnificado(P.diffTurno) : P.mudancasTurno.length;
    const bt = document.createElement('button');
    bt.className = 'turno-mudancas';
    bt.textContent = 'ver mudanças (' + n + (n === 1 ? ' arquivo' : ' arquivos') + ')';
    bt.title = 'Tudo que este turno mexeu em arquivo, num lugar só';
    // congela o rastro DESTE turno: o proximo turno zera P.mudancasTurno
    const mudancas = (P.mudancasTurno || []).slice();
    const diffTurno = P.diffTurno || '';
    bt.addEventListener('click', (e) => {
      e.stopPropagation();
      const guardaM = P.mudancasTurno, guardaD = P.diffTurno;
      P.mudancasTurno = mudancas; P.diffTurno = diffTurno;
      try { mostrarMudancasDoTurno(P); } finally { P.mudancasTurno = guardaM; P.diffTurno = guardaD; }
    });
    d.appendChild(bt);
  }
  if (prints.length) {
    const bp = document.createElement('button');
    bp.className = 'turno-mudancas turno-prints';
    bp.textContent = prints.length + (prints.length === 1 ? ' print' : ' prints');
    bp.title = 'As imagens que o agente viu neste turno';
    bp.addEventListener('click', (e) => { e.stopPropagation(); mostrarPrintsDoTurno(P, prints); });
    d.appendChild(bp);
  }
  P.chat.appendChild(d); scroll(P);
}
function atBottom(P) { return P.chat.scrollHeight - P.chat.scrollTop - P.chat.clientHeight < 100; }
function scroll(P, force) { if (force || atBottom(P)) P.chat.scrollTop = P.chat.scrollHeight; }

/* estava olhando o fim da conversa? (folga de 40px pra nao ser exigente demais) */
function estavaNoFim(P) {
  if (!P || !P.chat) return true;
  const c = P.chat;
  return c.scrollHeight - c.scrollTop - c.clientHeight < 40;
}

/* Levar pro fim DE VERDADE. Um scrollTop sozinho nao basta quando a conversa
   acabou de ser montada: o navegador ainda nao calculou a altura, e as imagens
   do historico carregam depois e empurram tudo pra baixo. */
function irProFim(P) {
  if (!P || !P.chat) return;
  // cancela um "ir pro fim" anterior que ainda esteja pendente: sem isso,
  // varias chamadas empilhavam timers e a tela voltava pro fim sozinha
  pararIrProFim(P);
  let valeu = true;
  P._pararFim = () => { valeu = false; };
  const põe = () => {
    if (!valeu || !P.chat || P.chat.isConnected === false) return;
    P.chat.scrollTop = P.chat.scrollHeight;
  };
  põe();
  requestAnimationFrame(() => { põe(); requestAnimationFrame(põe); });
  // imagem que ainda esta carregando muda a altura depois: rola de novo quando chegar
  const imgs = [...P.chat.querySelectorAll('img')].filter(i => !i.complete);
  for (const im of imgs) {
    const fim = () => { põe(); im.removeEventListener('load', fim); im.removeEventListener('error', fim); };
    im.addEventListener('load', fim); im.addEventListener('error', fim);
  }
  // rede pra fontes/markdown que assentam um pouco depois
  P._timersFim = [setTimeout(põe, 120), setTimeout(põe, 400)];
}

/* voce rolou pra cima? entao o "ir pro fim" que estava agendado nao vale mais */
function pararIrProFim(P) {
  if (!P) return;
  if (P._pararFim) { try { P._pararFim(); } catch {} P._pararFim = null; }
  for (const t of (P._timersFim || [])) clearTimeout(t);
  P._timersFim = [];
}

/* devolve o balao e a entrada do historico: quem chamou precisa poder desfazer
   EXATAMENTE o que desenhou, e nao "o ultimo que estiver na tela" - com dois
   envios ao mesmo tempo, o ultimo pode ser de outra mensagem */
/* imagem que veio do arquivo da conversa (print colado numa sessao anterior) */
function imagensDoHistorico(P, imagens) {
  if (!imagens || !imagens.length) return null;
  const cx = document.createElement('div');
  cx.className = 'msg-imgs';
  for (const im of imagens) {
    const img = document.createElement('img');
    img.className = 'msg-img';
    img.src = 'data:' + (im.mime || 'image/png') + ';base64,' + im.dados;
    img.alt = 'imagem que você enviou';
    img.addEventListener('click', () => verImagemGrande(img.src));
    cx.appendChild(img);
  }
  return cx;
}

/* abre a imagem em tamanho grande, usando o visor que ja existe no painel */
function verImagemGrande(src) {
  const cx = abrirModalGlobal();
  cx.className = 'modal-cx modal-img';
  const img = document.createElement('img');
  img.src = src; img.className = 'img-grande';
  cx.appendChild(img);
  cx.onclick = () => fecharModalGlobal();
}

function userMsg(P, text, anexos, imagensSalvas) {
  clearEmpty(P);
  /* fala que o PROPRIO CLI injeta como se fosse sua (ao retomar um turno
     cortado): vira faixa, nao balao, e nao entra no historico */
  const marca = marcaDoSistema(text);
  if (marca && !(anexos && anexos.length) && !(imagensSalvas && imagensSalvas.length)) {
    const f = document.createElement('div');
    f.className = 'troca retomada';
    f.innerHTML = '<span></span>';
    $('span', f).textContent = marca;
    P.chat.appendChild(f); scroll(P, true);
    return { balao: f, entrada: null };
  }
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
  // print colado numa sessao anterior, lido do arquivo da conversa
  const galeria = imagensDoHistorico(P, imagensSalvas);
  if (galeria) d.insertBefore(galeria, $('.msg-body', d));
  $('.msg-body', d).textContent = text;
  /* "voltar para cá": abre um RAMO com a conversa ate' esta mensagem, sem
     mexer no painel atual. Conta-se a posicao DO FIM na hora do clique - a
     tela pode mostrar so' a cauda da conversa, e do fim a conta sempre bate.
     Vai junto o TEXTO e quantas mensagens iguais vem depois: e' por ele que o
     Claude acha o ponto de corte no arquivo da conversa. */
  const btVoltar = document.createElement('button');
  btVoltar.className = 'msg-voltar';
  btVoltar.title = 'Voltar para cá: abre um ramo num painel novo a partir deste ponto. Este painel não muda.';
  btVoltar.innerHTML = ico('rotate-cw') + '<span>voltar para cá</span>';
  btVoltar.addEventListener('click', (e) => {
    e.stopPropagation();
    const todas = [...P.chat.querySelectorAll('.msg.user')];
    const i = todas.indexOf(d);
    if (i < 0) return;
    const corpoDe = (x) => { const b = $('.msg-body', x); return b ? b.textContent : ''; };
    const meu = corpoDe(d);
    const repetidasDepois = todas.slice(i + 1).filter((x) => corpoDe(x) === meu).length;
    ramificarAte(P, todas.length - i, { texto: meu, repetidasDepois });
  });
  d.appendChild(btVoltar);
  P.chat.appendChild(d); scroll(P, true);
  const vazia = !String(text || '').trim();
  if (vazia) $('.msg-body', d).classList.add('hidden');
  const entrada = { quem: 'Você', texto: text };
  // mensagem que era so' imagem nao vira '### Você:' vazio no contexto
  if (!vazia) P.hist.push(entrada);
  return { balao: d, entrada };
}
function pintarAvatar(el) {
  // a foto vem do config: montada como texto de HTML, um valor com aspas
  // quebrava o atributo. Como elemento, o valor e' so' valor.
  if (cfg.foto) {
    el.innerHTML = '';
    const im = new Image(); im.alt = ''; im.src = cfg.foto; el.appendChild(im);
  } else el.innerHTML = ico('user');
}
function repintarAvatares() {
  $$('.msg.user .av').forEach(pintarAvatar); $('#fotoPrev') && pintarAvatar($('#fotoPrev'));
  const bt = $('#btnFotoTirar'); if (bt) bt.disabled = !cfg.foto;   // sem foto, "Remover" nao tem o que remover
}

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

/* ===================== DESENHO DENTRO DA CONVERSA (leva 41) =====================
   Bloco ```excalidraw numa mensagem (cena completa ou lista-esqueleto) vira
   desenho, com "Abrir no quadro" e "Ver código". O SVG sai do bundle do quadro
   (carregado so' quando aparece um bloco), passa pelo DOMPurify - o conteudo veio
   do modelo - e entra INLINE: so' assim ele usa as fontes locais do Excalidraw
   que ficam no documento (num <img> nao enxergaria, e a CSP barra fonte data:).
   Bloco invalido fica como codigo, sem quebrar a mensagem. */
let seqDesenho = 0;
function svgLimpo(svg, prefixo) {
  let frag;
  try {
    frag = DOMPurify.sanitize(svg.outerHTML, {
      USE_PROFILES: { svg: true, svgFilters: true },
      // link no desenho navegaria a janela do app; <style> de fora vale pra pagina inteira
      FORBID_TAGS: ['a', 'style', 'foreignObject', 'script'],
      RETURN_DOM_FRAGMENT: true,
    });
  } catch { return null; }
  const s = frag && frag.querySelector('svg');
  if (!s) return null;
  /* ids unicos por desenho: dois desenhos na mesma tela com os mesmos ids (a
     mascara da seta com rotulo e' "mask-<id do elemento>", e o agente repete
     "a", "b"...) roubavam a mascara um do outro */
  const ids = new Map();
  for (const n of s.querySelectorAll('[id]')) { const novo = prefixo + n.id; ids.set(n.id, novo); n.id = novo; }
  if (ids.size) {
    const troca = (v) => v
      .replace(/url\(\s*#([^)\s]+)\s*\)/g, (m, id) => (ids.has(id) ? 'url(#' + ids.get(id) + ')' : m))
      .replace(/^#(.+)$/, (m, id) => (ids.has(id) ? '#' + ids.get(id) : m));
    for (const n of s.querySelectorAll('*')) {
      for (const a of [...n.attributes]) {
        if (!/url\(|^#/.test(a.value)) continue;
        const v = troca(a.value);
        if (v !== a.value) n.setAttribute(a.name, v);
      }
    }
  }
  s.removeAttribute('filter');   // o escuro e' do CSS (segue o tema do app, ate' trocando depois)
  return s;
}
function desenharBlocosExcalidraw(P, el) {
  if (!el || !window.QuadroFluxo) return;
  for (const code of el.querySelectorAll('pre > code.language-excalidraw')) {
    const pre = code.parentElement;
    if (!pre || pre.dataset.desenho) continue;
    const bloco = window.QuadroFluxo.lerBlocoExcalidraw(code.textContent);
    if (!bloco.ok) { pre.dataset.desenho = 'invalido'; pre.title = 'Não virou desenho: ' + bloco.erro; continue; }
    pre.dataset.desenho = 'sim';
    const fig = document.createElement('figure');
    fig.className = 'fluxo-desenho';
    const area = document.createElement('div');
    area.className = 'fluxo-svg';
    area.textContent = 'desenhando…';
    const barra = document.createElement('figcaption');
    barra.className = 'fluxo-barra';
    const btAbrir = document.createElement('button');
    btAbrir.className = 'fluxo-bt';
    btAbrir.textContent = 'Abrir no quadro';
    btAbrir.title = 'Abre este desenho no quadro deste painel: dá pra mexer e mandar de volta';
    btAbrir.addEventListener('click', (e) => { e.stopPropagation(); abrirQuadro(P, bloco.texto); });
    const btCod = document.createElement('button');
    btCod.className = 'fluxo-bt';
    btCod.textContent = 'Ver código';
    btCod.addEventListener('click', (e) => {
      e.stopPropagation();
      const escondido = pre.classList.toggle('hidden');
      btCod.textContent = escondido ? 'Ver código' : 'Esconder código';
    });
    barra.append(btAbrir, btCod);
    fig.append(area, barra);
    pre.parentNode.insertBefore(fig, pre);
    pre.classList.add('hidden');
    const desfazer = (motivo) => {
      fig.remove(); pre.classList.remove('hidden');
      pre.dataset.desenho = 'invalido'; pre.title = 'Não virou desenho: ' + motivo;
    };
    carregarQuadro()
      .then(() => window.Quadro.desenharSvg(bloco.texto, { fundo: false }))
      .then((svg) => {
        if (!svg) return desfazer('nada pra desenhar');
        const limpo = svgLimpo(svg, 'fx' + (++seqDesenho) + '-');
        if (!limpo) return desfazer('o desenho não passou na limpeza');
        area.textContent = '';
        area.appendChild(limpo);
        if (P) scroll(P);
      })
      .catch((e) => desfazer(String((e && e.message) || e)));
  }
}

function botBlock(P, key) {
  clearEmpty(P);
  const d = document.createElement('div');
  d.className = 'msg bot';
  /* Uma resposta pode vir em varias falas (uma antes de cada ferramenta). O
     nome do motor so aparece na primeira: repetir "Claude" quatro vezes fazia
     parecer que ele tinha respondido quatro vezes. */
  if (P.blocks && P.blocks.get('resp')) d.classList.add('msg-seguida');
  d.innerHTML = '<div class="msg-role"><span class="av">' + svgMotor(P.engine) + '</span>'
    + nomeDoMotor(P.engine) + '</div>'
    + '<button class="msg-copiar" title="Copiar esta resposta">copiar</button>'
    + '<div class="msg-body"></div>';
  P.chat.appendChild(d);
  const b = { el: $('.msg-body', d), raw: '' };
  $('.msg-copiar', d).addEventListener('click', (e) => { e.stopPropagation(); copiarTexto(b.raw, $('.msg-copiar', d)); });
  P.blocks.set(key, b); scroll(P);
  return b;
}
function textDelta(P, key, text) {
  // um bloco POR FALA (pela chave), nao um "bloco corrente": dois sub-agentes
  // falando junto se intercalam, e o corrente unico repetia a fala a cada troca
  let b = P.blocks.get('b:' + key);
  if (!b) {
    /* fala NOVA: o que ele fez ate agora fica onde esta, acima. Sem selar, a
       caixa de passos era arrastada pro fim a cada ferramenta e no fim do turno
       todos os textos ficavam em cima e todas as ferramentas embaixo - parecia
       que ele tinha respondido varias vezes seguidas sem fazer nada. */
    selarPassos(P);
    b = botBlock(P, 'b:' + key);
    P.blocks.set('resp', b); P.blocks.set('respKey', key);
  } else if (P.passosEl) {
    // continuacao da MESMA fala: o que saiu no meio fica antes dela
    P.chat.insertBefore(P.passosEl, b.el.parentElement);
  }
  b.raw += text;
  /* Nao redesenha a cada pedacinho. Cada redesenho reprocessa a resposta
     INTEIRA em markdown, entao o custo cresce ao quadrado: medido nesta
     maquina, uma resposta de 100 KB gastava 23s de processador desenhando a
     cada pedaco, contra 3,9s desenhando a cada 100ms -- 6x menos, e a tela
     para de engasgar quando varios paineis respondem juntos.
     O texto aparece com ate' 100ms de atraso; resposta curta que termina antes
     disso e' desenhada pelo textFinal, que cancela este temporizador. */
  if (!b._timer) {
    b._timer = setTimeout(() => {
      b._timer = 0;
      try { b.el.innerHTML = mdSeguro(b.raw); } catch { b.el.textContent = b.raw; }
      scroll(P);
      legendarTrabalho(P, b.raw);   // aqui, no freio, e nao a cada letra
    }, 100);
  }
  if (P.trabEl) P.chat.appendChild(P.trabEl);
  scroll(P);
}
let ultimoPensar = 0;
function thinkDelta(P, text) {
  trabalhando(P, 'pensando');
  const agora = Date.now();
  if (agora - ultimoPensar > 8000) {
    ultimoPensar = agora;
    // sem o teto de 8 passos, um pensamento longo empilharia dezenas destes:
    // se o ultimo passo ja e' "Pensando", nao repete
    const ult = P.passosEl ? passosDaCaixa(P.passosEl).slice(-1)[0] : null;
    if (!(ult && $('.pa-t', ult) && $('.pa-t', ult).textContent === 'Pensando no problema')) passo(P, { txt: 'Pensando no problema', det: '' });
  }
}
function marcarLinksWeb(el) {
  for (const a of el.querySelectorAll('a[href^="http"]')) {
    a.classList.add('link-web');
    a.title = 'abre no seu navegador';
  }
}

function linkarArquivos(P, el) {
  // Mac: /Users/... | Windows: C:\... e caminho de rede
  // extensao de ate' 6 letras, mais .excalidraw e .excalidraw.md (leva 41: cortava em ".excali")
  const re = /((?:[A-Za-z]:[\\/]|\\\\)[^\s"'<>)|*?]+\.(?:excalidraw(?:\.md)?|[A-Za-z0-9]{1,6})|\/(?:Users|tmp|private|Volumes|home)\/[^\s"'<>)]+\.(?:excalidraw(?:\.md)?|[A-Za-z0-9]{1,6}))/g;
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
          /* O caminho veio do MODELO. Num painel da VPS ele escreve
             /home/hugo/app.js, e ate' a leva 37 o clique ia ler o disco deste
             PC e dizia "Nao consegui abrir". Quem manda e' o PAINEL. */
          a.onclick = (e) => { e.preventDefault(); e.stopPropagation(); verArquivo(P, caminho, remotoDoPane(P)); };
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
function metadadosDaMensagem(ev) {
  if (!ev || typeof ev !== 'object') return {};
  const out = {};
  for (const k of ['delivery', 'questions', 'memoryCitation']) if (ev[k] != null) out[k] = ev[k];
  return out;
}

function textFinal(P, key, text, evento) {
  if (!text || !text.trim()) return;
  const metadata = metadadosDaMensagem(evento);
  let b = P.blocks.get('b:' + key);
  let fundiu = false;
  if (!b) {
    // rede de seguranca contra RESPOSTA EM DOBRO: se o id mudou entre o texto
    // que chegou letra a letra e a versao final, o que esta na tela e' esta
    // MESMA fala - continua no mesmo bloco em vez de repetir tudo embaixo.
    const corrente = P.blocks.get('resp');
    if (corrente && mesmaFala(corrente.raw, text)) { b = corrente; fundiu = true; }
    else {
      // fala NOVA sem streaming (ACP, Gemini, Grok): o que ele fez ate agora fica
      // acima, senao a caixa de passos era arrastada pro fim a cada ferramenta
      selarPassos(P);
      b = botBlock(P, 'b:' + key);
    }
    P.blocks.set('b:' + key, b);
    P.blocks.set('resp', b); P.blocks.set('respKey', key);
  }
  if (b._timer) { clearTimeout(b._timer); b._timer = 0; }   // o desenho final manda
  b.raw = text; b.el.innerHTML = mdSeguro(text);
  b.metadata = metadata;
  desenharBlocosExcalidraw(P, b.el);
  linkarArquivos(P, b.el); marcarLinksWeb(b.el); botoesDeCodigo(b.el); marcarRecibo(b.el);
  legendarTrabalho(P, text);
  if (P.trabEl) P.chat.appendChild(P.trabEl);
  scroll(P);
  const quem = nomeDoMotor(P.engine);
  const ult = P.hist[P.hist.length - 1];
  // mesma chave = continuacao do mesmo bloco; chave nova = fala nova.
  // 'fundiu' so' e' true quando a bolha na tela tambem era a mesma fala: sem
  // essa amarra, duas falas que comecassem igual viravam UMA no historico
  if (ult && ult.quem === quem && (ult.chave === key || (fundiu && mesmaFala(ult.texto, text)))) {
    ult.texto = text; ult.chave = key; Object.assign(ult, metadata);
  } else P.hist.push({ quem, texto: text, chave: key, ...metadata });
}
function toolStart(P, id, name, arg, mudanca) {
  passo(P, fraseDoPasso(name, arg), id, name);
  if (mudanca) anexarMudancaAoPasso(P, id, mudanca);
}
/* o diff pode chegar junto do passo (Claude; tool_call do ACP) ou depois
   (tool_call_update do ACP): o mesmo botao "ver mudanca" serve aos dois */
function anexarMudancaAoPasso(P, id, mudanca) {
  if (!mudanca) return;
  const d = acharPasso(P, id);
  /* rastro do turno: alimenta o "ver mudanças" do carimbo de fim de turno. So'
     entra mudanca APLICADA (auditoria 1): o diff chega no INICIO do passo, antes
     da permissao -- um Write negado (ou que deu erro) contava como arquivo
     mudado. Passo em andamento fica pendente; o toolEnd decide. */
  const fim = d && d.dataset ? d.dataset.fim : '';
  if (!id || fim === 'ok') (P.mudancasTurno = P.mudancasTurno || []).push({ path: mudanca.path || '', mudanca });
  else if (fim !== 'erro') (P.mudancasPendentes = P.mudancasPendentes || new Map()).set(id, mudanca);
  if (!d || $('.pa-diff', d)) return;
  const bt = document.createElement('button');
  bt.className = 'pa-diff';
  // so' conta as linhas agora; o desenho do diff so' e' montado se voce abrir
  const resumo = resumoDaMudanca(mudanca);
  const rotulo = () => (d.dataset && d.dataset.fim === 'erro') ? 'ver o que ia mudar' : 'ver mudança' + (resumo ? ' ' + resumo : '');
  bt.textContent = rotulo();
  bt.title = mudanca.path || 'ver o que muda no arquivo';
  let bloco = null;
  bt.addEventListener('click', (e) => {
    e.stopPropagation();
    const aberto = $('.diff', d);
    if (aberto) { aberto.remove(); bt.textContent = rotulo(); return; }
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
  if (!id) return null;
  /* tambem nas caixas ja seladas por uma fala nova: o fim do passo (ok/erro,
     saida, print, diff tardio) pode chegar depois que ele falou no meio */
  const caixas = [P.passosEl, ...((P.passosSelados || []).slice().reverse())].filter(Boolean);
  for (const box of caixas) {
    const d = [...box.children].reverse().find((x) => x.dataset && x.dataset.id === id);
    if (d) return d;
  }
  return null;
}
function toolOutput(P, id, text) {
  const d = acharPasso(P, id);
  if (!d || !text) return;
  // teto por passo: sem ele, uma conversa de 950 passos guardava dezenas de MB
  // de texto pra sempre. 8.000 ainda mostra um stack trace inteiro no "ver saida".
  d._saida = ((d._saida || '') + text).slice(-8000);
}
function toolEnd(P, id, output, isErr, imagens) {
  const d = acharPasso(P, id);
  passoPronto(P, id, isErr);
  // auditoria 1: a mudanca do passo so' conta no fim do turno se ele deu certo
  if (d && d.dataset) d.dataset.fim = isErr ? 'erro' : 'ok';
  const pendente = P.mudancasPendentes && P.mudancasPendentes.get(id);
  if (pendente) {
    P.mudancasPendentes.delete(id);
    if (!isErr) (P.mudancasTurno = P.mudancasTurno || []).push({ path: pendente.path || '', mudanca: pendente });
  }
  if (isErr && d) {
    const bt = $('.pa-diff', d);
    if (bt) { bt.textContent = 'ver o que ia mudar'; bt.title = 'Não foi aplicada (negada ou deu erro). ' + (pendente && pendente.path || ''); }
  }
  if (imagens && imagens.length) mostrarPrintsDoPasso(P, d, imagens);
  if (!d) return;
  const txt = String(output || d._saida || '').trim();
  if (!txt) return;
  d._saida = txt.slice(-8000);
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

function textoDaNota(value) {
  if (typeof value === 'string' && value !== '[object Object]') return value;
  if (value && typeof value === 'object') {
    for (const item of [value.message, value.error?.message, value.error]) {
      if (typeof item === 'string' && item !== '[object Object]') return item;
    }
  }
  return 'Não foi possível concluir a operação. Tente novamente.';
}

function note(P, text, isErr) {
  clearEmpty(P);
  const d = document.createElement('div');
  d.className = 'note' + (isErr ? ' err' : '');
  d.textContent = textoDaNota(text);
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
/* as opcoes de ligar o motor num lugar so': os DOIS pontos que ligam (o start
   normal e o religa apos queda) tem que mandar exatamente o mesmo pacote */
function opcoesDeStart(P) {
  // nova sessao: o modo real de uma sessao anterior (ou o aviso ja mostrado) nao vale mais
  P.modoReal = null; P._avisouModo = false;
  return {
    paneId: P.id, engine: P.engine, cwd: P.cwd, model: P.model || undefined,
    approval: P.mode, effort: esforcoDe(P), resumeId: P.resumeId || undefined,
    remoto: remotoDoPane(P) || undefined,
    // ramo pendente: o start leva --fork-session (sessao nova com todo o historico)
    fork: P.forkPendente || undefined,
    sugestoes: cfg.sugestoes !== false,
    // se o modelo escolhido cair, o Sonnet assume (so' Claude; opcao no menu de modelos)
    fallback: (P.engine === 'claude' && cfg.fallbackClaude) ? RESERVA_CLAUDE : undefined,
    // branch isolada (menu /) e conectores que a aba desligou (editor da aba)
    worktree: (P.engine === 'claude' && P.worktree) || undefined,
    semConectores: conectoresForaDaAba(P),
    // de que aba e' (vai pro retomar.json e pro registro de quedas)
    abaId: P.abaId || undefined,
  };
}
/* Depois do start: guarda o endereco ate' o evento 'sessao' trazer o
   definitivo. Se ele JA chegou e e' outro -- o ramo do Claude no PC, que
   nasce com --session-id e avisa antes da resposta do start --, o id da
   ORIGEM nao pode ficar guardado: a lista acharia o ramo como se fosse ela. */
function guardarEnderecoAteASessao(P) {
  P.resumeAnterior = (P.sessaoId && P.sessaoId !== P.resumeId) ? null : (P.resumeId || P.resumeAnterior || null);
}
async function send(P) {
  if (!P || P.morto) return;
  if (contaEmAlteracao(P)) { note(P, 'Conclua ou feche a alteração de conta. Seu texto continua no campo.'); return; }
  const geracaoConta = P.uiContaGeracao || 0, geracaoEnvio = P.uiEnvioGeracao || 0;
  const idDoEnvio = P.id, motorDoEnvio = P.engine, abaDoEnvio = P.abaId;
  let inicioPendente = null;
  const mesmoInicio = () => !inicioPendente || P.uiInicioEnvio === inicioPendente;
  const mesmoPainel = () => P.id === idDoEnvio && P.engine === motorDoEnvio && P.abaId === abaDoEnvio;
  const mesmaTentativa = () => mesmoPainel() && mesmoInicio()
    && geracaoConta === (P.uiContaGeracao || 0) && geracaoEnvio === (P.uiEnvioGeracao || 0);
  const donoDoInicio = () => mesmoInicio() && (P.morto || (mesmoPainel()
    && (mesmaTentativa() || (!P.started && !P.busy))));
  const envioAindaValido = () => !P.morto && mesmaTentativa() && !P._trocando && !P._worktreeBusy && !contaEmAlteracao(P);
  if (P._worktreeBusy) { note(P, 'Aguarde a troca de pasta terminar; seu texto continua no campo.'); return; }
  const inp = $('.p-input', P.el);
  /* ditando? o ditado acaba aqui. Sem isto o campo era limpo pelo envio, a
     legenda seguinte via "mudou por fora", adotava o vazio como base e
     reescrevia o ditado inteiro em cima da mensagem que acabou de sair. */
  const ditava = !!(P._ditado && P.pararDitado);
  if (ditava) { try { await P.pararDitado('enviou'); } catch {} }
  if (!envioAindaValido()) { if (!P.morto) note(P, 'O envio foi interrompido. Seu texto continua no campo.'); return; }
  let text = inp.value.trim();
  /* Enter no campo vazio COM o chip "Continuar" na tela = "continue" ("continue"
     e' a 1a palavra de 17% das suas mensagens). O chip so' nasce no fim de um
     turno desta sessao - conversa recem-aberta nao liga o motor sem querer.
     Nao vale depois de um ditado que nao captou som (o vazio ali e' falha, nao
     pedido), nem com anexo pendente (esquecimento). */
  if (!text && !ditava && $('.p-cont', P.el) && podeContinuar(P) && !(P.anexos && P.anexos.length)) { text = 'continue'; inp.value = text; }
  if (!text) return;
  window.CockpitUI?.cancelResume(P);
  P.uiTerminalError = false; P.uiInterrupted = false; P.uiCompleted = false; P.uiUnread = false;

  /* A mensagem vai sair: a busca do "@" que ainda estiver em voo morre aqui.
     Sem isto ela ficava viva, porque o campo e' limpo NA MAO logo abaixo
     (inp.value = '') e limpar por codigo nao dispara o evento 'input' -- o
     unico lugar de onde o cancelamento saia. No servidor o temporizador de
     450 ms acordava DEPOIS do envio e abria o menu de arquivos por cima da
     resposta que estava chegando. */
  pararBuscaDeArquivos(P);
  soltarNavArquivos(P);   // e o atalho de setas sai junto: sem menu, sem dono

  /* trabalhando OU ligando: durante os 10-90s do "Ligando o ACP…" um 2o Enter
     abria um 2o start e a tela lia a resposta como "conexao caiu", religando
     por cima do turno. Agora vai pra fila, igual ao painel ocupado. */
  if (P.busy || P.ligando) {
    const anx = P.anexos.slice(); P.anexos = []; pintarAnexos(P);
    inp.value = ''; inp.style.height = 'auto';
    userMsg(P, text, anx);
    let envio = text;
    if (anx.length) envio += '\n\nArquivos que anexei (abra cada um antes de responder):\n' + anx.map(a => '- ' + a.path).join('\n');
    if (P.envio === 'entra' && !P.ligando) {
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
  // leva 41 (B6): decide ANTES do userMsg (ele poe esta mensagem no historico)
  const nomeAuto = podeGerarTituloAuto(P, text);
  const escrito = userMsg(P, text, anexos);
  if (nomeAuto) iniciarTituloAuto(P, text);
  // "continue" e "/comando" nao viram nome: a proxima mensagem de verdade da' o nome
  else if (!P.titulo && !soComandoOuContinue(text)) { P.titulo = tituloCurto(text); P._tituloDe = 'curto'; pintarNome(P); }

  if (!P.started) {
    setDot(P, 'busy');
    note(P, 'Ligando o ' + nomeDoMotor(P.engine) + '…');
    P.ligando = true;
    try {
      // o main devolve false quando nao consegue ligar (SSH invalido, binario
      // sumido): sem olhar o retorno, o painel dizia "trabalhando" pra sempre
      inicioPendente = {}; P.uiInicioEnvio = inicioPendente;
      const ligou = await window.api.paneStart(opcoesDeStart(P));
      if (ligou === false) throw new Error('o motor não subiu');
      if (!envioAindaValido()) {
        if (donoDoInicio()) {
          try { await window.api.paneStop({ paneId: idDoEnvio, engine: motorDoEnvio }); } catch {}
        }
        throw new Error('O envio foi interrompido antes de iniciar.');
      }
      // guarda o endereco ate' o evento 'sessao' trazer o definitivo: entre um e
      // outro, uma queda de SSH apagava a conversa (religava do zero)
      guardarEnderecoAteASessao(P);
      P.started = true; P.resumeId = null;
      /* o ramo (forkPendente) NAO e' esquecido aqui: quem desliga e' o evento
         'sessao' com o endereco novo. Uma queda antes dele refaz o ramo em vez
         de continuar a conversa de origem. */
    } catch (e) {
      if (P.morto || !donoDoInicio()) return;
      if (donoDoInicio()) { setDot(P, 'off'); pararTrabalho(P); }
      desfazerEnvio(P, escrito, text, anexos);
      note(P, 'Não consegui ligar: ' + (e && e.message || e), true);
      return;
    } finally { if (donoDoInicio()) P.ligando = false; }
  }
  if (!envioAindaValido()) { if (!P.morto) desfazerEnvio(P, escrito, text, anexos); return; }
  P.busy = true; setDot(P, 'busy'); zerarTurno(P); P.blocks.clear(); pararTrabalho(P); limparPassos(P); trabalhando(P);
  subirNaLista(P);
  let envio = text;
  // Claude E Codex recebem imagem DENTRO da mensagem (no Codex virou item
  // localImage no turn/start); Gemini/Grok continuam indo pelo caminho no texto
  const ehClaude = P.engine === 'claude';
  const mandaImagem = ehClaude || P.engine === 'codex' || P.engine === 'acp';
  const listar = mandaImagem ? anexos.filter(x => !IMG_EXT.includes(String(x.ext || '').toLowerCase())) : anexos;
  /* o aviso morava DENTRO do if abaixo, entao um print grande (que vira caminho
     em vez de imagem, acima de 4 MB) passava calado: o servidor recebe um
     "C:\..." que nao existe la. Agora avisa sempre que houver anexo. */
  const TETO_IMG = 4 * 1024 * 1024;   // acima disso a imagem vira caminho, e o servidor nao le
  const soCaminho = listar.length
    || anexos.some(x => IMG_EXT.includes(String(x.ext || '').toLowerCase()) && (x.bytes || 0) > TETO_IMG);
  if (remotoDoPane(P) && soCaminho) {
    note(P, 'Atenção: este painel roda no servidor, e o caminho do arquivo é do seu PC — ele não vai conseguir abrir.', true);
  }
  if (listar.length) {
    envio += '\n\nArquivos que anexei (abra cada um antes de responder):\n'
      + listar.map(x => '- ' + x.path).join('\n');
  }
  const contextoUsado = P.passarContexto;
  if (P.passarContexto) { envio = P.passarContexto + envio; P.passarContexto = null; }
  /* auditoria 2: o que VOCE escreveu, separado do envio montado (contexto da
     troca de motor + lista de anexos). Se esta mensagem tiver que voltar pro
     campo (religar cancelado, ramo que caiu antes de nascer), volta so' ela. */
  P._envioAtual = { digitado: text, anexos, contexto: contextoUsado || null, escrito };

  const pacote = () => ({ paneId: P.id, engine: P.engine, text: envio,
    // so' imagem: o resto ja foi listado no texto acima, mandar de novo duplicava
    anexos: mandaImagem ? anexos.filter(x => IMG_EXT.includes(String(x.ext || '').toLowerCase())).map(x => x.path) : undefined,
    effort: P.engine === 'codex' ? esforcoDe(P) : undefined });

  try {
    if (!envioAindaValido()) throw new Error('O envio foi interrompido.');
    const foi = await window.api.paneSend(pacote());
    if (foi === false) {
      if (!envioAindaValido()) throw new Error('O envio foi interrompido.');
      /* O motor tinha morrido sem o painel saber - e o caso comum na aba do
         servidor, onde a conexao cai calada entre uma mensagem e outra. O app
         ja religava sozinho, so' que na mensagem SEGUINTE, cobrando de voce
         reescrever a que se perdeu. Agora ele religa na MESMA conversa e manda
         de novo aqui, uma vez. */
      note(P, 'A conexão tinha caído. Religando e mandando de novo…');
      P.resumeId = P.sessaoId || P.resumeId || P.resumeAnterior;   // continua a mesma conversa
      P.started = false; P.busy = false; P.ligando = true;
      inicioPendente = {}; P.uiInicioEnvio = inicioPendente;
      const ligou = await window.api.paneStart(opcoesDeStart(P));
      if (ligou === false) throw new Error('não consegui religar o motor');
      if (!envioAindaValido()) {
        if (donoDoInicio()) {
          try { await window.api.paneStop({ paneId: idDoEnvio, engine: motorDoEnvio }); } catch {}
        }
        throw new Error('O reenvio foi interrompido.');
      }
      // guarda o endereco ate' o evento 'sessao' trazer o definitivo: entre um e
      // outro, uma queda de SSH apagava a conversa (religava do zero)
      guardarEnderecoAteASessao(P);
      P.started = true; P.resumeId = null; P.ligando = false; P.busy = true;
      const foiDeNovo = await window.api.paneSend(pacote());
      if (foiDeNovo === false) throw new Error('o motor não está ligado');
    }
  }
  catch (e) {
    if (P.morto) return;
    if (!envioAindaValido()) {
      if (!donoDoInicio()) return;
      P.ligando = false; P.busy = false; setDot(P, 'off'); pararTrabalho(P);
      if (mesmoPainel() && contextoUsado && !P.passarContexto) P.passarContexto = contextoUsado;
      desfazerEnvio(P, escrito, text, anexos);
      note(P, 'O envio foi interrompido. Seu texto foi preservado.', true);
      return;
    }
    /* o servidor (Codex) caiu no meio do envio e o religar ja' foi agendado pelo
       'engine-down', que chega antes deste erro: nao se sabe se a mensagem
       chegou, entao o religar manda ELA de novo em vez do "continue". O balao
       fica na tela. */
    if (P._religar) { P._religar.texto = envio; Object.assign(P._religar, { digitado: text, anexos, contexto: contextoUsado || null }); return; }
    if (donoDoInicio()) P.ligando = false;
    P.busy = false; setDot(P, 'idle'); pararTrabalho(P); limparPassos(P);
    // nao perde o que ja tinha sido dito na troca de motor
    if (contextoUsado) P.passarContexto = contextoUsado;
    desfazerEnvio(P, escrito, text, anexos);
    note(P, 'Falhou: ' + (e && e.message || e), true);
  }
}

/* ===================== QUEDA DO MOTOR (leva 41, B2) =====================
   Motor que morre NO MEIO de um turno religa sozinho na mesma conversa e pede
   pra continuar: ate' 2 tentativas em 10 minutos (espera 2 s, depois 8 s).
   Quem diz se estava em turno e' o main (quedas.js): liga no envio, desliga no
   fim do turno, no stop e no Esc.
   NAO religa: parada de proposito (stop, trocar motor/modelo/modo/conta, fechar
   o painel, guardar a aba, auto-desliga do fundo -- tudo passa pelo paneStop, e
   o preload anota a hora em paradaEm), limite de uso, conta pedindo login,
   motor que nao existe, painel de servidor (o processo antigo pode seguir vivo
   la' e o religar criaria um segundo motor na mesma conversa). */
const RELIGA_NO_TURNO = { claude: true, codex: true };
const ESPERAS_RELIGAR = [2000, 8000];
const JANELA_RELIGAR = 10 * 60 * 1000;
const ESFORCO_NO_ENVIO = { codex: true };

/* '' = pode religar; senao, o motivo de nao religar */
function motivoPraNaoReligar(P, ev) {
  if (!P || P.morto) return 'fechado';
  if (ev && ev.tipo === 'proposito') return 'proposito';   // o app derrubou (troca de conta do Codex): quem derrubou avisa
  /* auditoria 1: ramo que ainda nao nasceu (o Claude caiu antes do init): nao ha'
     conversa nova pra continuar, e um "continue" num fork novo da origem seria o
     assunto da ORIGEM. A proxima mensagem refaz o ramo. Limite e login seguem
     com o recado deles. */
  if (P.forkPendente && (!ev || !ev.tipo || ev.tipo === 'queda' || ev.tipo === 'ausente')) return 'ramo';
  if (!RELIGA_NO_TURNO[P.engine]) return 'motor';
  /* auditoria 2: morreu depois de dizer que bateu no limite (o turno ja' tinha
     acabado no 'result' de erro): o recado e' o do limite, nao "a proxima
     mensagem religa" -- ela so' bateria no limite de novo */
  if (ev && ev.tipo === 'limite') return 'limite';
  if (!ev || !ev.emTurno) return 'parado';
  if (ev.tipo && ev.tipo !== 'queda') return ev.tipo;
  if (ev.remoto || remotoDoPane(P)) return 'servidor';
  // parou de proposito quase junto com a queda (o stop ainda estava a caminho)
  const parou = (window.api.paradaEm && window.api.paradaEm(P.id)) || 0;
  if (parou && parou >= (ev.recebidoEm || Date.now()) - 2000) return 'proposito';
  const r = P._religadas;
  if (r && Date.now() - r.desde < JANELA_RELIGAR && r.n >= ESPERAS_RELIGAR.length) return 'esgotou';
  return '';
}

/* a mensagem da fila volta pro campo de escrever -- nunca some */
function devolverFilaAoCampo(P) {
  const q = P && P.queued;
  if (!q) return false;
  P.queued = null; pintarFila(P);
  const inp = $('.p-input', P.el);
  if (inp) {
    inp.value = String(inp.value || '').trim() ? (q + '\n\n' + inp.value) : q;
    inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 190) + 'px';
  }
  return true;
}

function motorCaiu(P, ev, noFundo) {
  P.uiInterrupted = true; P.uiCompleted = false; P.uiUnread = false;
  window.CockpitUI?.cancelResume(P);
  const recebido = Date.now();
  // "a proxima mensagem religa" - mas so' religa na MESMA conversa se o
  // endereco dela for guardado agora
  desligarMotor(P);
  pararTrabalho(P); limparPassos(P);
  esconderPermissao(P);
  const porque = motivoPraNaoReligar(P, { ...ev, recebidoEm: recebido });
  if (!porque) { agendarReligar(P, recebido); if (noFundo) pintarAbasLocal(); return 'religa'; }
  P.busy = false;
  if (noFundo) pintarAbasLocal();   // senao a aba seguia pulsando um trabalho ja morto
  if (porque === 'fechado' || porque === 'proposito') return porque;   // quem parou ja' disse o que houve
  const voltou = devolverFilaAoCampo(P);
  const fila = voltou ? ' A mensagem que estava na fila voltou pro campo de escrever.' : '';
  if (porque === 'ramo') {
    // o desligarMotor acima ja' devolveu o id da ORIGEM ao resumeId; o fork segue pendente
    /* auditoria 2: a mensagem que ia criar o ramo nao chegou a lugar nenhum:
       volta pro campo (junto do que ja' estiver la'), sem o contexto montado */
    const e = ev.emTurno ? P._envioAtual : null; P._envioAtual = null;
    let voltouMsg = false;
    if (e && e.digitado) {
      if (e.escrito && e.escrito.balao) { try { e.escrito.balao.remove(); } catch {} }
      if (e.escrito && e.escrito.entrada) { const i = P.hist.indexOf(e.escrito.entrada); if (i >= 0) P.hist.splice(i, 1); }
      voltouMsg = devolverAoCampo(P, e.digitado);
      if (e.anexos && e.anexos.length && !(P.anexos && P.anexos.length)) { P.anexos = e.anexos.slice(); pintarAnexos(P); }
      if (e.contexto && !P.passarContexto) P.passarContexto = e.contexto;
    }
    const msg = voltouMsg ? ' Sua mensagem voltou pro campo de escrever.' : '';
    /* a ORIGEM sumiu ("No conversation found": apagada, ou de outra pasta): nao
       ha' de onde ramificar. Prometer que "a proxima mensagem cria o ramo" dava
       o mesmo erro de novo -- o painel vira conversa nova. */
    if (ev.tipo === 'ausente' && /No conversation found/i.test(ev.motivo || '')) {
      P.forkPendente = false; P.resumeId = null; P.resumeAnterior = null;
      zerarNomeDaConversa(P);   // o "(ramo) …" era de uma conversa que nao existe mais
      savePanes();
      note(P, 'A conversa original não existe mais (foi apagada ou mudou de lugar), então não dá pra ramificar. A próxima mensagem começa uma conversa nova.' + msg + fila, true);
      return porque;
    }
    note(P, 'O motor caiu antes de o ramo nascer. A conversa original não mudou; a próxima mensagem cria o ramo de novo.' + msg + fila
      + (ev.motivo ? '  (' + ev.motivo + ')' : ''), true);
    return porque;
  }
  if (porque === 'limite') {
    // a nota do limite (com a tarja) ja' saiu nesta resposta: so' a fila, se voltou
    if (ev.limiteJaAvisado) { if (fila) note(P, fila.trim()); return porque; }
    const t = (ev.limite && ev.limite.texto) || 'Limite de uso atingido. Não vou retomar sozinho.';
    note(P, t + fila, true);
    // reseta em ms (auditoria 1): a tarja compara como numero -- "15:00" virava NaN e, fechada, nunca mais voltava
    mostrarAviso({ id: 'limite-uso-' + P.engine, tipo: 'alerta', fixo: true, reseta: (ev.limite && ev.limite.ms) || undefined, texto: nomeDoMotor(P.engine) + ': ' + t });
    return porque;
  }
  if (porque === 'login') {
    note(P, 'O ' + nomeDoMotor(P.engine) + ' parou porque a conta pediu para entrar de novo.' + fila, true);
    avisarLoginDoServidor(P, (ev.motivo && /login|oauth|api key|authentication/i.test(ev.motivo)) ? ev.motivo : 'not logged in');
    return porque;
  }
  if (porque === 'esgotou') {
    note(P, 'O motor caiu de novo. Já religuei ' + ESPERAS_RELIGAR.length + ' vezes e parei de tentar. A próxima mensagem religa.' + fila
      + (ev.motivo ? '  (' + ev.motivo + ')' : ''), true);
    return porque;
  }
  /* dizer QUAL foi o motivo, quando o motor deixou algum. Sem isso, chave
     recusada, pasta que sumiu e servidor fora do ar viravam a mesma frase. */
  const base = ev.remoto ? 'A conexão com o servidor caiu.' : 'A conexão caiu.';
  note(P, base + ' A próxima mensagem religa.' + fila + (ev.motivo ? '  (' + ev.motivo + ')' : ''), true);
  avisarLoginDoServidor(P, ev.motivo);   // caiu por falta de conta NO SERVIDOR: botao certo
  return porque;
}

/* o painel segue "ocupado" durante a espera: mensagem nova vai pra fila, trocar
   de aba nao desliga o motor dele, e o Esc cancela o religar */
function agendarReligar(P, tQueda) {
  const agora = Date.now();
  if (!P._religadas || agora - P._religadas.desde >= JANELA_RELIGAR) P._religadas = { n: 0, desde: agora };
  const n = ++P._religadas.n;
  if (P._religar) clearTimeout(P._religar.timer);
  P.busy = true; setDot(P, 'busy'); trabalhando(P, '— o motor caiu, religando');
  const espera = ESPERAS_RELIGAR[n - 1];
  note(P, 'O motor caiu no meio do trabalho. Religo em ' + Math.round(espera / 1000) + ' s e peço pra continuar.');
  P._religar = { n, tQueda, timer: setTimeout(() => religarEContinuar(P, n, tQueda), espera) };
}

function cancelarReligar(P, recado) {
  const r = P && P._religar;
  if (!r) return false;
  clearTimeout(r.timer); P._religar = null;
  P.busy = false; setDot(P, 'off'); pararTrabalho(P);
  /* a mensagem que o religar ia mandar DE NOVO (o Codex caiu no envio: nao se
     sabe se chegou) volta pro campo -- cancelar nao pode engolir ela */
  /* auditoria 2: volta SO' o que voce digitou (o r.texto e' o envio montado,
     com o contexto da troca de motor e a lista de anexos), JUNTO do que ja'
     estiver no campo (antes, campo ocupado = mensagem descartada). Os anexos e o
     contexto voltam pro lugar deles. */
  if (r.texto) {
    devolverAoCampo(P, r.digitado != null ? r.digitado : r.texto);
    if (r.anexos && r.anexos.length && !(P.anexos && P.anexos.length)) { P.anexos = r.anexos.slice(); pintarAnexos(P); }
    if (r.contexto && !P.passarContexto) P.passarContexto = r.contexto;
  }
  devolverFilaAoCampo(P);
  if (recado) note(P, recado);
  // o "continue" que o religar ia mandar: o chip volta (Enter no campo vazio manda)
  if (!r.texto) mostrarContinuar(P);
  if (!panes.has(P.id)) pintarAbasLocal();
  return true;
}

/* n = tentativa (1 ou 2); 0 = retomada no boot (o app fechou no meio do turno) */
async function religarEContinuar(P, n, tQueda) {
  const r = P._religar;
  if (!r || r.n !== n) return false;
  P._religar = null;
  const eng = P.engine;
  const parouDepois = () => ((window.api.paradaEm && window.api.paradaEm(P.id)) || 0) >= tQueda - 2000;
  const desistir = (txt) => {
    P.busy = false; setDot(P, 'off'); pararTrabalho(P);
    devolverFilaAoCampo(P);
    if (txt) note(P, txt, true);
    if (!panes.has(P.id)) pintarAbasLocal();
    return false;
  };
  /* parou de proposito no meio (trocou motor/modelo/conta, abriu outra conversa):
     quem parou manda no painel agora. So' tira o "trabalhando" que era do
     religar, se ninguem ligou outro motor por cima. */
  const largar = () => {
    if (!P.morto && !P.started && P.busy) { P.busy = false; setDot(P, 'off'); pararTrabalho(P); devolverFilaAoCampo(P); }
    return false;
  };
  if (P.morto || P.started) return false;
  if (parouDepois()) return largar();
  /* ramo do Claude que caiu antes de ganhar endereco proprio (so' no servidor,
     onde o id chega pelo 'system init'): um "continue" num fork novo da origem
     continuaria o assunto da ORIGEM, nao o seu. A proxima mensagem refaz o ramo. */
  if (P.forkPendente) return desistir('O motor caiu antes de o ramo nascer. Mande a mensagem de novo: ela cria o ramo.');
  P.resumeId = P.sessaoId || P.resumeId || P.resumeAnterior;
  if (!P.resumeId) return desistir('O motor caiu antes de a conversa ganhar endereço; não dá pra retomar. Mande a mensagem de novo.');
  let ligou;
  P.ligando = true;
  try { ligou = await window.api.paneStart({ ...opcoesDeStart(P), religar: true }); }
  catch (e) { P.ligando = false; return desistir('Não consegui religar o motor (' + ((e && e.message) || e) + '). A próxima mensagem tenta de novo.'); }
  P.ligando = false;
  /* fechou o painel enquanto o motor subia: o do Codex sobe em etapas e pode ter
     amarrado a thread depois do stop do fechar -- solta de novo. So' no painel
     morto: nos outros casos um stop aqui mataria o motor novo que voce ligou. */
  if (P.morto) { try { window.api.paneStop({ paneId: P.id, engine: eng }); } catch {} return false; }
  if (P.engine !== eng || parouDepois()) return largar();
  if (ligou === false || (ligou && ligou.error)) return desistir('Não consegui religar o motor. A próxima mensagem tenta de novo.');
  // (ramo pendente nao chega aqui: desistiu acima)
  P.resumeAnterior = P.resumeId; P.started = true; P.resumeId = null;
  // o Codex que caiu no meio do ENVIO: nao se sabe se a mensagem chegou, entao vai ela de novo
  const texto = r.texto || 'continue';
  zerarTurno(P); P.t0 = Date.now(); P.blocks.clear();
  userMsg(P, texto);
  trabalhando(P);
  let foi = false;
  try { foi = await window.api.paneSend({ paneId: P.id, engine: P.engine, text: texto, effort: ESFORCO_NO_ENVIO[P.engine] ? esforcoDe(P) : undefined }); }
  catch { foi = false; }
  if (P.morto) return false;
  if (foi === false) return desistir('Religuei o motor, mas não consegui mandar o "continue". Mande de novo.');
  const txt = n
    ? 'O motor caiu; religuei e pedi pra continuar (' + n + '/' + ESPERAS_RELIGAR.length + ').'
    : 'O Cockpit tinha fechado no meio deste trabalho; religuei e pedi pra continuar.';
  note(P, txt, true);
  mostrarAviso({ id: 'religou-' + P.id, tipo: 'alerta', texto: (P.titulo || 'Um painel') + ': ' + txt });
  return true;
}

/* o botao de parar e o Esc passam por aqui: durante a espera do religar nao ha
   motor pra interromper, entao parar = cancelar o religar */
function interromperPainel(P) {
  if (!P || P.morto) return;
  P.uiEnvioGeracao = (P.uiEnvioGeracao || 0) + 1;
  P.uiInterrupted = true; P.uiCompleted = false; P.uiUnread = false;
  window.CockpitUI?.cancelResume(P);
  if (P._religar) { cancelarReligar(P, 'Religação cancelada. A próxima mensagem religa.'); return; }
  window.api.paneInterrupt({ paneId: P.id, engine: P.engine });
}

/* Boot/recarga: painel restaurado cuja conversa estava NO MEIO de um turno
   quando o app fechou (retomar.json, lido pelo main). O main entrega cada
   conversa uma vez so'; aqui ainda se confere que o painel nao ligou. */
async function retomarSeCaiu(P, s) {
  /* ramo que ainda nao nasceu: o sessaoId da ficha e' o da ORIGEM. Pedir a
     retomada dele religaria a conversa original (e roubaria a retomada de um
     painel que esteja com ela aberta). */
  if (!P || !s || s.fork || P.forkPendente) return false;
  if (!s.sessaoId || !RELIGA_NO_TURNO[s.engine] || !window.api.retomarPegar) return false;
  if (remotoDoPane(P)) return false;
  let item = null;
  try { item = await window.api.retomarPegar({ engine: s.engine, sessaoId: s.sessaoId, paneId: s.paneId || '' }); } catch {}
  if (!item || P.morto || P.started || P.busy || P.engine !== s.engine) return false;
  note(P, 'O Cockpit fechou no meio deste trabalho. Religando e pedindo pra continuar…');
  P.busy = true; setDot(P, 'busy'); trabalhando(P, '— retomando');
  P._religar = { n: 0, tQueda: Date.now(), timer: 0 };
  return religarEContinuar(P, 0, P._religar.tQueda);
}

/* limite de uso numa nota do motor: frase clara com a hora em que libera */
function limiteNaTela(P, lim) {
  P.uiInterrupted = true;
  window.CockpitUI?.offerResume(P, lim);
  note(P, lim.texto, true);
  mostrarAviso({ id: 'limite-uso-' + P.engine, tipo: 'alerta', fixo: true, reseta: lim.ms || undefined, texto: nomeDoMotor(P.engine) + ': ' + lim.texto });
}

/* ============ eventos vindos do motor ============ */
/* Rede de seguranca: antes, um erro no desenho de um unico evento derrubava o
   resto do tratamento -- inclusive o envio da mensagem que estava na fila. */
window.api.onPaneEvent((ev) => { try { tratarEventoDoPainel(ev); } catch (e) { console.error('evento', ev && ev.kind, e); } });
function tratarEventoDoPainel(ev) {
  // acharPainel, nao panes.get: o painel pode estar rodando em outra aba
  const P = acharPainel(ev.paneId); if (!P) return;
  const noFundo = !panes.has(ev.paneId);
  switch (ev.kind) {
    case 'busy': P.uiTerminalError = false; P.uiInterrupted = false; P.uiCompleted = false; P.uiUnread = false; P.busy = true; setDot(P, 'busy'); zerarTurno(P); trabalhando(P); if (noFundo) pintarAbasLocal(); break;
    // a checklist do proprio agente (TodoWrite / turn-plan / write_todos)
    case 'plano': desenharPlano(P, ev.itens); break;
    // proxima mensagem sugerida (chip acima do campo; nunca envia sozinho)
    case 'sugestao': mostrarSugestoes(P, ev.itens); break;
    // ---- leva 33: motor ACP ----
    case 'acp-info':
      P.acpInfo = ev; P.acpModelos = ev.modelos || []; P.acpModeloAtual = ev.modeloAtual || '';
      if (ev.comandos && ev.comandos.length) P.acpComandos = ev.comandos;
      note(P, 'Agente ACP ligado: ' + (ev.agente || '?') + (ev.versao ? ' ' + ev.versao : '')
        + (ev.retomou ? ' · conversa retomada' : '') + (ev.modoAtual ? ' · modo: ' + nomeDoModoAcp(ev.modoAtual) : ''));
      break;
    case 'acp-comandos': P.acpComandos = ev.itens || []; break;
    case 'acp-modo': if (P.acpInfo) P.acpInfo.modoAtual = ev.modo; break;
    // ---- leva 35: torre ----
    // conectores que a sessao do Claude conhece: alimentam o editor de abas
    case 'conectores': registrarConectores(ev.itens, P); break;
    // ---- leva 36: entrada ----
    case 'anexo-pronto': anexar(P, [ev.arquivo]).then(() => { if ((P.anexos || []).some((x) => x && x.path === ev.arquivo)) note(P, (ev.origem === 'recorte' ? 'Recorte' : 'Imagem') + ' anexado.'); const c = $('.p-input', P.el); if (c) c.focus(); }); break;
    // o diff de um passo que chegou DEPOIS do passo (tool_call_update do ACP)
    case 'tool-mudanca': anexarMudancaAoPasso(P, ev.id, ev.mudanca); break;
    // ---- leva 34: sinais ----
    // o agente te chamou (PushNotification interceptada no main)
    case 'aviso-agente': avisoDoAgente(P, ev.texto); break;
    // consumo DESTE turno (vai pro carimbo de fim de turno)
    case 'turno-uso': P.usoTurno = { entrada: ev.entrada || 0, saida: ev.saida || 0 }; break;
    // diff agregado do turno, pronto do motor (Codex)
    case 'diff-turno': P.diffTurno = ev.diff || ''; break;
    // qual modelo respondeu de fato (pra detectar fallback assumindo)
    case 'modelo-usado':
      if (ev.modelo && P.model && ev.modelo !== P.model && P.avisoModelo !== ev.modelo
          && !String(P.model).startsWith(ev.modelo) && !ev.modelo.startsWith(String(P.model).replace(/\[.*$/, ''))) {
        P.avisoModelo = ev.modelo;
        note(P, 'Quem respondeu este turno foi ' + ev.modelo + ' (o modelo escolhido não estava disponível).');
      }
      break;
    // chegou o endereco definitivo: o guardado nao serve mais pra nada
    // (no ramo pendente, so' o endereco NOVO vale -- ver aoNascerSessao)
    case 'sessao': aoNascerSessao(P, ev); break;
    // o motor as vezes sobe num modo diferente do pedido (ex.: Haiku nao tem Auto)
    case 'modo-real': aplicarModoReal(P, ev.modo); break;
    case 'text-delta': textDelta(P, ev.id, ev.text); break;
    case 'think-delta': thinkDelta(P, ev.text); break;
    case 'text-final': textFinal(P, ev.id, ev.text, ev); break;
    case 'tool-start': toolStart(P, ev.id, ev.name, ev.arg, ev.mudanca); break;
    case 'tool-output': toolOutput(P, ev.id, ev.text); break;
    case 'tool-end': toolEnd(P, ev.id, ev.output, ev.error, ev.imagens); window.CockpitCollaboration?.resources(P, ev.id, ev.recursos); break;
    case 'agent-state': if (torreVisivel()) pintarAgentesDaTorre(); break;   // no conteiner fixo do fim, nunca solto no #torre
    case 'compactou': $('.p-compactar', P.el).classList.remove('rodando'); avisoEnvio(P, 'Conversa resumida. O que importa foi mantido.'); break;
    case 'tokens':
      /* Dois avisos diferentes chegam por aqui: o 'assistant' manda o TOTAL
         ocupado, e o fim do turno manda so' o tamanho da JANELA. Com
         "ev.total || 0" o segundo zerava o numero que o primeiro tinha
         acabado de acertar, e a barrinha esvaziava sozinha ao terminar. */
      if (ev.janela) P.janela = ev.janela;
      if (ev.total != null) P.tokens = ev.total;
      pintarTokens(P);
      break;
    case 'janela': P.janela = ev.total; pintarTokens(P); break;
    case 'note':
      if (ev.error) { P.uiTerminalError = true; P.uiCompleted = false; P.uiUnread = false; window.CockpitUI?.refresh(); }
      // limite de uso: frase clara com a hora em que libera (o main ja' leu a hora)
      if (ev.error && ev.limite) { limiteNaTela(P, ev.limite); break; }
      note(P, ev.text, ev.error); if (ev.error) avisarLoginDoServidor(P, ev.text); break;
    case 'permissao-cancelada': {
      if (ev.key && P.filaPerm) {
        const eraAberta = P.filaPerm[0] && P.filaPerm[0].key === ev.key;
        P.filaPerm = P.filaPerm.filter((x) => x.key !== ev.key);
        if (eraAberta) {
          if (P.filaPerm.length) desenharPermissao(P);
          else { P.pedindoPerm = false; esconderPermissao(P); }
        }
      } else esconderPermissao(P);
      if (noFundo) pintarAbasLocal();
      sincronizarPendencias();
      break;
    }
    case 'turn-end':
      if (ev.error || ['failed', 'error', 'erro'].includes(ev.status)) {
        P.uiTerminalError = true;
        P.uiCompleted = false; P.uiUnread = false;
      } else if (['interrupted', 'cancelled', 'canceled', 'aborted'].includes(ev.status)) {
        P.uiInterrupted = true;
        P.uiCompleted = false; P.uiUnread = false;
      } else if (!P.uiInterrupted && !P.uiTerminalError) {
        P.uiCompleted = true;
        P.uiUnread = noFundo || focusPane !== P || document.hidden || !document.hasFocus();
      }
      // quem tira o cartao de permissao e' o 'permissao-cancelada' vindo do
      // motor, que ANTES responde o pedido - esconder aqui deixava o Codex
      // esperando uma resposta pra sempre
      P.busy = false; setDot(P, 'idle'); P.blocks.clear(); pararTrabalho(P); limparPassos(P);
      marcarFimDoTurno(P);
      savePanes();
      mostrarContinuar(P);
      avisarPainel(P, 'terminou');
      atualizarGit(P);
      // acabou o motivo de segurar o motor fora da tela: desliga e devolve pro
      // config. A conversa volta sozinha com --resume quando voce abrir a aba.
      if (noFundo && !P.queued && !(P.filaPerm && P.filaPerm.length) && !(P.terms && P.terms.size)) {
        // desliga o MOTOR (acabou o trabalho), mas NAO tira do panesFundo: a
        // tela dele continua guardada pra voltar pronta quando voce abrir a aba
        desligarMotor(P);   // guarda o endereco da conversa antes de desligar
        P.desligadoNoFundo = true;
        savePanes();
        window.api.paneStop({ paneId: P.id, engine: P.engine });
      }
      if (noFundo) pintarAbasLocal();   // a aba para de pulsar quando termina
      $('.p-compactar', P.el).classList.remove('rodando');
      setTimeout(() => { if (!P.busy) { pararTrabalho(P); limparPassos(P); } }, 400);
      histCache[P.engine] = null;
      setTimeout(() => buscarNome(P), 1200);
      const abaHist = $('.side-view[data-view="h' + P.engine + '"]');
      if (abaHist && !abaHist.classList.contains('hidden')) loadHist(P.engine, true);
      if (P.queued) {
        setTimeout(async () => {
          // a fila so' esvazia AQUI: nos 150ms de espera o painel segue "com
          // fila", entao o chip Continuar nao aparece nem um Enter vazio dobra o envio
          const q = P.queued; if (!q) return; P.queued = null; pintarFila(P);
          // painel FECHADO nao envia mais nada. Mas painel que so' mudou de aba
          // continua vivo e a mensagem da fila tem que ir - antes ela sumia calada
          if (P.morto || !acharPainel(P.id)) return;
          P.busy = true; setDot(P, 'busy'); zerarTurno(P);   // turno novo: rastro do anterior nao acumula
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
    // leva 41 (B2): no meio do turno religa sozinho; parado, limite ou login, avisa claro
    case 'engine-down': motorCaiu(P, ev, noFundo); break;
    case 'approval': showApproval(P, ev); avisarPainel(P, 'está pedindo permissão'); break;
    case 'pergunta': mostrarPergunta(P, ev); avisarPainel(P, ev.bloqueante === false ? 'deixou uma pergunta' : 'está perguntando'); break;
    case 'pergunta-cancelada': {
      // o motor desistiu de esperar (deu o teto de 30 min)
      const aberta = P.perguntaAberta && P.perguntaAberta.id === ev.id;
      if (P.filaPerg) P.filaPerg = P.filaPerg.filter((x) => x.id !== ev.id);
      if (aberta) { note(P, 'A pergunta expirou — ele seguiu sem a sua resposta.', true); proximaPergunta(P); }
      break;
    }
    case 'robos': roboDoPainel(P, ev); break;
    case 'auto-liberado':
      // alem do aviso que some, entra na auditoria do painel (distintivo ⚡N)
      registrarAuto(P, ev);
      note(P, 'liberado automaticamente: ' + ev.tool + (ev.arg ? ' · ' + String(ev.arg).slice(0, 60) : ''));
      break;
  }
}

/* a barra de permissao e' UMA por painel, mas o modelo pede varias ferramentas
   na mesma volta. O segundo pedido sobrescrevia o botao do primeiro, que nunca
   era respondido - e o motor ficava esperando pra sempre, painel travado em
   "trabalhando...". Agora os pedidos entram numa fila e aparecem um a um. */
/* ===================== CAIXA DE PERGUNTAS =====================
   O motor parou pra te perguntar alguma coisa e esta esperando. A caixa nasce
   presa embaixo da conversa, no mesmo lugar e com a mesma cara do pedido de
   permissao - que ja e' como o Cockpit diz "parei, preciso de voce".

   Enquanto ela esta aberta, o turno NAO morreu: a ferramenta do outro lado esta
   parada esperando o arquivo de resposta. Por isso fechar a caixa nao e' de
   graca - manda "cancelado" e o motor segue pelo caminho conservador. */

function esconderPergunta(P) {
  const cx = P && P.el && $('.pane-perg', P.el);
  if (!cx) return;
  cx.classList.add('hidden');
  cx.innerHTML = '';
  P.perguntaAberta = null;
}

/* uma pergunta de cada vez: se chegar outra com uma aberta, a nova espera */
function mostrarPergunta(P, ev) {
  if (!P.filaPerg) P.filaPerg = [];
  // o mesmo pedido pode chegar duas vezes (o fs.watch e a varredura de 1s):
  // sem esta guarda, a caixa era redesenhada e perdia o que voce ja marcou
  const jaTem = (P.perguntaAberta && P.perguntaAberta.id === ev.id)
    || P.filaPerg.some((x) => x.id === ev.id);
  if (jaTem) return;
  P.filaPerg.push(ev);
  if (!P.perguntaAberta) desenharPergunta(P);
  else note(P, 'Mais uma pergunta na fila (' + P.filaPerg.length + ' esperando).');

  // painel fora da tela: sem aviso, o motor ficaria parado ate o teto de 30min
  // e a unica pista seria a bolinha, que diz "trabalhando", nao "esperando voce"
  if (!panes.has(P.id) && panesFundo.has(P.id)) {
    pintarAbasLocal();
    try {
      new Notification('Cockpit — uma pergunta pra você', {
        body: (P.titulo || 'Um painel') + ' parou pra perguntar, na aba ' + nomeCurtoDaAba(abaPorId(P.abaId)),
      });
    } catch {}
  }
  sincronizarPendencias();
}

function proximaPergunta(P, cxExterna) {
  if (P.filaPerg && P.filaPerg.length) P.filaPerg.shift();
  P.perguntaAberta = null;
  if (P.filaPerg && P.filaPerg.length) { desenharPergunta(P); if (cxExterna) desenharPergunta(P, cxExterna); }
  else { esconderPergunta(P); if (cxExterna) cxExterna.classList.add('hidden'); pintarAbasLocal(); }
  sincronizarPendencias();
}

function desenharPergunta(P, cxExterna) {
  const ev = (P.filaPerg && P.filaPerg[0]);
  const cx = cxExterna || $('.pane-perg', P.el);
  if (!ev || !cx) return;
  P.perguntaAberta = ev;
  cx.innerHTML = '';
  cx.classList.remove('hidden');

  const perguntas = Array.isArray(ev.perguntas) ? ev.perguntas.slice(0, 4) : [];
  // o que esta marcado em cada pergunta: Set pra multipla, string pra unica
  const escolhas = perguntas.map((q) => (q && q.varias ? new Set() : null));
  const livres = perguntas.map(() => '');

  const topo = document.createElement('div');
  topo.className = 'perg-topo';
  topo.innerHTML = '<span class="perg-sino"></span><b>'
    + (ev.bloqueante === false
      ? (perguntas.length > 1 ? perguntas.length + ' perguntas' : 'Uma pergunta')
      : (perguntas.length > 1 ? perguntas.length + ' perguntas antes de seguir' : 'Uma pergunta antes de seguir'))
    + '</b><span class="perg-dica">' + (ev.bloqueante === false ? 'responda pela caixa de texto' : 'ele está esperando aqui') + '</span>';
  cx.appendChild(topo);

  perguntas.forEach((q, i) => {
    const bloco = document.createElement('div');
    bloco.className = 'perg-item';

    if (q.titulo) {
      const t = document.createElement('div');
      t.className = 'perg-tit';
      t.textContent = q.titulo;
      bloco.appendChild(t);
    }
    const pq = document.createElement('div');
    pq.className = 'perg-txt';
    pq.textContent = String(q.pergunta || '');
    bloco.appendChild(pq);

    const lista = document.createElement('div');
    lista.className = 'perg-ops';
    /* pergunta de senha/chave nao mostra opcao pronta: clicar num rotulo
       publico viraria resposta, e o resumo depois esconderia esse rotulo como
       "(resposta oculta)" - o que engana quem le a conversa */
    const opcoes = (q.segredo || !Array.isArray(q.opcoes)) ? [] : q.opcoes.slice(0, 5);
    opcoes.forEach((op) => {
      const rotulo = String((op && op.rotulo) || '');
      if (!rotulo) return;
      const bt = document.createElement('button');
      bt.className = 'perg-op';
      bt.type = 'button';
      const linha = document.createElement('span');
      linha.className = 'po-rot';
      linha.textContent = rotulo;
      bt.appendChild(linha);
      if (op.detalhe) {
        const d = document.createElement('span');
        d.className = 'po-det';
        d.textContent = String(op.detalhe);
        bt.appendChild(d);
      }
      bt.addEventListener('click', (e) => {
        e.stopPropagation();
        if (q.varias) {
          const s = escolhas[i];
          if (s.has(rotulo)) s.delete(rotulo); else s.add(rotulo);
          bt.classList.toggle('marcada', s.has(rotulo));
        } else {
          escolhas[i] = rotulo;
          for (const outro of lista.querySelectorAll('.perg-op')) outro.classList.remove('marcada');
          bt.classList.add('marcada');
          /* clicar MARCA, nao envia. Chegou a enviar direto quando havia uma
             pergunta so' - era rapido, mas um clique errado virava resposta
             definitiva no meio do trabalho, sem desfazer. Um clique a mais e'
             barato; resposta errada custa o turno inteiro. Quem quer rapidez
             tem o Enter, logo abaixo. */
        }
        conferir();
      });
      lista.appendChild(bt);
    });
    bloco.appendChild(lista);

    // sempre cabe escrever a resposta que nao estava na lista
    const livre = document.createElement('input');
    if (q.segredo) livre.dataset.segredo = '1';
    livre.className = 'perg-livre';
    // o Codex marca isSecret quando pede senha/chave: nao pode ficar na tela
    livre.type = q.segredo ? 'password' : 'text';
    livre.placeholder = q.segredo ? 'digite aqui (fica oculto)' : 'ou escreva a sua resposta…';
    livre.addEventListener('input', () => { livres[i] = livre.value; conferir(); });
    livre.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); enviar(); }
    });
    bloco.appendChild(livre);
    cx.appendChild(bloco);
  });

  const pe = document.createElement('div');
  pe.className = 'perg-pe';
  const btOk = document.createElement('button');
  btOk.className = 'perg-ok';
  btOk.type = 'button';
  btOk.textContent = 'Responder';
  const btNao = document.createElement('button');
  btNao.className = 'perg-nao';
  btNao.type = 'button';
  btNao.textContent = 'Decide você';
  btNao.title = 'Fecha sem responder: ele segue pelo caminho mais conservador e diz o que ficou em aberto';
  pe.appendChild(btOk); pe.appendChild(btNao);
  cx.appendChild(pe);

  const respostaDe = (i) => {
    const livre = String(livres[i] || '').trim();
    const q = perguntas[i] || {};
    if (q.varias) {
      const marcadas = [...(escolhas[i] || [])];
      if (livre) marcadas.push(livre);
      return marcadas.length ? marcadas : null;
    }
    if (livre) return livre;             // o que voce escreve vale mais que o botao
    return escolhas[i] || null;
  };
  const conferir = () => {
    const faltam = perguntas.filter((_, i) => respostaDe(i) == null).length;
    btOk.disabled = faltam > 0;
    btOk.textContent = faltam > 0
      ? (faltam === perguntas.length ? 'Responder' : 'Falta ' + faltam)
      : 'Responder';
  };

  let mandou = false;
  const enviar = () => {
    if (mandou || ev._uiAnswered || P.morto || P.filaPerg?.[0] !== ev) return;
    const respostas = perguntas.map((_, i) => respostaDe(i));
    if (respostas.some((r) => r == null)) return conferir();
    mandou = true; ev._uiAnswered = true;
    window.api.perguntaResponder({ id: ev.id, respostas });
    // fica na conversa o que voce respondeu, pra dar pra reler depois
    const resumo = perguntas.map((q, i) => {
      const r = respostas[i];
      // resposta secreta nao vai pro historico da conversa
      if (q.segredo) return '• ' + String(q.pergunta || '') + '  →  (resposta oculta)';
      return '• ' + String(q.pergunta || '') + '  →  ' + (Array.isArray(r) ? r.join(' + ') : String(r));
    }).join('\n');
    note(P, 'Você respondeu:\n' + resumo);
    proximaPergunta(P, cxExterna);
  };
  const desistir = () => {
    if (mandou || ev._uiAnswered || P.morto || P.filaPerg?.[0] !== ev) return;
    mandou = true; ev._uiAnswered = true;
    window.api.perguntaResponder({ id: ev.id, cancelado: true });
    note(P, 'Você deixou a decisão com ele.');
    proximaPergunta(P, cxExterna);
  };
  btOk.addEventListener('click', (e) => { e.stopPropagation(); enviar(); });
  btNao.addEventListener('click', (e) => { e.stopPropagation(); desistir(); });

  /* Enter manda, quando ja da' pra mandar; Esc devolve a decisao pra ele.
     Fica na caixa (nao na janela) pra nao atrapalhar quem esta digitando no
     campo de mensagem do painel. */
  cx.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !btOk.disabled) { e.preventDefault(); e.stopPropagation(); enviar(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); /* Fechar uma camada não responde à pergunta. */ }
  });
  conferir();

  piscar(P);   // painel fora de vista: chama atencao, igual ao pedido de permissao
  if (quadro) avisarNoQuadro('⚠ ' + (P.titulo || 'O painel') + ' fez uma pergunta — feche o quadro pra responder.', true);
  /* o foco vai pro comeco do PRIMEIRO bloco, nao pro primeiro campo secreto do
     cartao: com o segredo na 2a pergunta, o foco pulava a 1a por cima e o Enter
     nao enviava (faltava resposta), o que parecia que o botao estava quebrado */
  const bloco1 = $('.perg-item', cx) || cx;
  const primeira = $('.perg-livre[data-segredo]', bloco1) || $('.perg-op', bloco1) || $('.perg-livre', bloco1);
  if (primeira && panes.has(P.id)) setTimeout(() => { try { primeira.focus(); } catch {} }, 60);
  scroll(P, true);
}

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
  sincronizarPendencias();
}

function proximaPermissao(P, barExterna) {
  if (P.filaPerm && P.filaPerm.length) P.filaPerm.shift();
  if (P.filaPerm && P.filaPerm.length) { desenharPermissao(P); if (barExterna) desenharPermissao(P, barExterna); }
  else { P.pedindoPerm = false; esconderPermissao(P); if (barExterna) barExterna.classList.add('hidden'); pintarAbasLocal(); }
  sincronizarPendencias();
}

function desenharPermissao(P, barExterna) {
  const ev = P.filaPerm[0];
  const bar = barExterna || $('.pane-perm', P.el);
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
    btSempre.textContent = ev.tool ? 'Sempre permitir ' + (ev.rotulo || ev.tool) : 'Sempre permitir';
    btSempre.title = ev.tool ? 'Não perguntar mais por ' + (ev.rotulo || ev.tool) + ' neste painel (vale até fechar o painel)' : '';
  }
  bar.classList.remove('hidden');
  piscar(P);   // painel fora de vista: chama atencao
  if (quadro) avisarNoQuadro('⚠ ' + (P.titulo || 'O painel') + ' está pedindo permissão — feche o quadro pra responder.', true);
  // Trava no pedido, compartilhada entre a doca e o popover.
  const done = async (allow, sempre = false) => {
    if (ev._uiResponding || ev._uiAnswered || P.morto || P.filaPerm?.[0] !== ev) return;
    ev._uiResponding = true;
    try {
      if (sempre && ev.tool) {
        await window.api.autoLiberar({ paneId: P.id, tool: ev.tool });
        if (P.morto || P.filaPerm?.[0] !== ev) return;
      }
      const ok = await window.api.approve({ key: ev.key, allow });
      ev._uiAnswered = true;
      if (ok === false) note(P, 'Esse pedido já tinha expirado — o motor não estava mais esperando.', true);
      if (sempre) note(P, 'Não vou mais perguntar por ' + (ev.rotulo || ev.tool) + ' neste painel.');
      if (!P.morto && P.filaPerm?.[0] === ev) proximaPermissao(P, barExterna);
    } catch (e) {
      note(P, 'Não consegui enviar a resposta: ' + (e && e.message || e), true);
    } finally { ev._uiResponding = false; }
  };
  $('.pp-yes', bar).onclick = () => done(true);
  $('.pp-no', bar).onclick = () => done(false);
  if (btSempre) btSempre.onclick = () => done(true, true);
}


/* ============ arvore de arquivos ============ */
/* O 'expanded' e' um Set GLOBAL, e caminho sozinho nao identifica pasta:
   '/home/hugo/x' existe igualzinho em dois servidores diferentes -- e no dia em
   que o Cockpit rodar num Mac, tambem aqui. Por isso a chave leva o ALVO junto:
   'usuario@host|caminho' no servidor, 'local|caminho' neste PC. Assim cada
   arvore lembra so' do que e' dela e uma nao abre pasta da outra. */
const expanded = new Set();
const chaveAberta = (remoto, caminho) =>
  (remoto ? (remoto.usuario || '') + '@' + (remoto.host || '') + ':' + Number(remoto.porta ?? 22) + '|' + (remoto.chave || '') : 'local') + '|' + caminho;
let treeGen = 0;
/* O 'remoto' ({host, usuario, chave, caminhoRemoto}) vem do PAINEL em foco. Sem
   ele tudo le' o disco deste PC, exatamente como antes. */
async function loadTree(dir, remoto) {
  const gen = ++treeGen;                    // cancela um carregamento anterior ainda em andamento
  $('#projName').textContent = remoto
    ? ('🖧 ' + (remoto.usuario || '') + '@' + (remoto.host || ''))
    : (dir === HOME ? 'Pasta: ' + ESTE_PC + ' inteiro' : ('Pasta: ' + baseNome(dir)));
  const box = $('#tree'); box.innerHTML = '';
  // aba de servidor em branco: nao adianta pedir nada, e ler o disco daqui seria pior
  if (faltaConfigurarServidor(remoto)) {
    const d = document.createElement('div');
    d.className = 'hint'; d.style.padding = '10px 14px'; d.textContent = AVISO_ABA_EM_BRANCO;
    box.appendChild(d);
    return;
  }
  await level(dir, box, 0, gen, remoto);
}
async function level(dir, container, depth, gen, remoto) {
  if (gen !== undefined && gen !== treeGen) return;
  /* SSH leva segundos, nao milissegundos. Sem esta linha a barra da esquerda
     fica em branco e o usuario le' "quebrado" onde e' so' "lento". */
  if (remoto) container.innerHTML = '<div class="tree-carregando">Lendo o servidor…</div>';
  let r = null;
  try { r = await window.api.listDir(dir, remoto || undefined); }
  catch (e) { r = { error: 'Não consegui ler esta pasta: ' + ((e && e.message) || e) }; }
  if (gen !== undefined && gen !== treeGen) return;
  container.innerHTML = '';                 // tira o "lendo…" (no local ja' estava vazio)
  if (!r) r = { error: 'Não veio resposta ao listar esta pasta.' };
  if (r.error) {
    // textContent, nao innerHTML: o motivo pode vir do servidor e nao vira marcacao
    const d = document.createElement('div');
    d.className = 'hint'; d.style.padding = '6px 14px'; d.textContent = r.error;
    container.appendChild(d);
    return;
  }
  for (const e of (r.entries || [])) {
    /* Confere a geracao a CADA volta, nao so' na entrada. O 'await level(...)'
       de uma subpasta aberta suspende este laco por segundos no remoto; se voce
       trocar de painel nesse meio-tempo, o loadTree novo limpa a caixa e comeca
       a pintar a arvore do servidor B -- e este laco, ao voltar, continuava
       despejando os itens do servidor A por baixo. Clicar num intruso colava
       caminho do servidor A na mensagem do painel B. */
    if (gen !== undefined && gen !== treeGen) return;
    const n = document.createElement('div');
    n.className = 'node ' + (e.dir ? 'd' : 'f');
    n.style.paddingLeft = (8 + depth * 12) + 'px';
    const chave = chaveAberta(remoto, e.path);
    const open = expanded.has(chave);
    n.innerHTML = '<span class="chev">' + (e.dir ? (open ? ico('chevron-down') : ico('chevron-right')) : '') + '</span>'
      + '<span class="ico">' + (e.dir ? ico('folder') : icon(e.name)) + '</span><span class="nm"></span>';
    $('.nm', n).textContent = e.name;
    container.appendChild(n);
    if (e.dir) {
      const kids = document.createElement('div'); container.appendChild(kids);
      if (open) await level(e.path, kids, depth + 1, gen, remoto);
      n.addEventListener('click', async () => {
        // abrir pasta tambem carrega o gen: trocou de painel no meio, nao pinta
        if (expanded.has(chave)) { expanded.delete(chave); kids.innerHTML = ''; $('.chev', n).innerHTML = ico('chevron-right'); return; }
        expanded.add(chave); $('.chev', n).innerHTML = ico('chevron-down');
        await level(e.path, kids, depth + 1, gen, remoto);
        /* No servidor a resposta demora segundos: da' tempo de o 2o clique
           fechar a pasta antes dela chegar. Sem esta conferencia a resposta
           atrasada pintava os filhos assim mesmo, e a pasta ficava com seta
           fechada e conteudo aberto embaixo. */
        if (!expanded.has(chave)) { kids.innerHTML = ''; $('.chev', n).innerHTML = ico('chevron-right'); }
      });
    } else {
      n.addEventListener('click', () => {
        if (!focusPane) return;
        const inp = $('.p-input', focusPane.el);
        inp.value = (inp.value ? inp.value + ' ' : '') + e.path;
        inp.focus();
      });
      n.addEventListener('dblclick', async () => {
        /* No servidor "abrir no PC" nao existe -- o duplo clique abre no visor,
           que agora sabe ler la' dentro. A rota e' pelo PAINEL, nunca pelo
           formato do caminho. */
        if (remoto) { if (focusPane) verArquivo(focusPane, e.path, remotoDoPane(focusPane)); return; }
        const r2 = await window.api.openPath(e.path);
        // sem isso, arquivo recusado por seguranca nao abria e nao explicava nada
        if (r2 && r2.error && focusPane) note(focusPane, r2.error, true);
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
    /* approvalsReviewer: auto_review no thread/start - um revisor automatico do
       proprio Codex decide os pedidos arriscados, dentro do sandbox da pasta */
    { id: 'revisado',  ic: 'sparkles', nome: 'Revisado por IA',   desc: 'Um revisor automático aprova ou barra os pedidos arriscados, sem te interromper' },
    { id: 'bypass',    ic: 'unlock', nome: 'Sem pedir permissão',    desc: 'Faz tudo sem perguntar, inclusive o que é perigoso' },
  ],
  /* No ACP o pedido de permissao chega pelo protocolo (session/request_permission)
     e vira o mesmo cartao Permitir/Negar. Os modos sao traduzidos pro vocabulario
     de cada agente (default/autoEdit/plan/yolo no Gemini) quando ele os tem;
     "sem pedir permissao" vale sempre, porque quem aprova ai e' o Cockpit. */
  acp: [
    { id: 'manual',    ic: 'hand', nome: 'Manual',                 desc: 'O agente pergunta antes de cada ação' },
    { id: 'auto-edit', ic: 'code-xml', nome: 'Editar automaticamente', desc: 'Mexe nos arquivos sozinho e pergunta o resto (se o agente tiver esse modo)' },
    { id: 'plan',      ic: 'clipboard-list', nome: 'Plano',                  desc: 'Só estuda e mostra o plano (se o agente tiver esse modo)' },
    { id: 'bypass',    ic: 'unlock', nome: 'Sem pedir permissão',    desc: 'O Cockpit aprova todo pedido do agente sozinho' },
  ],
  /* No Gemini e no Grok o Cockpit conversa por fora da tela deles, e o pedido de
     permissao nao tem por onde chegar ate' voce. Entao so' entram os modos que
     funcionam de verdade sem ninguem pra responder: "faz tudo" e "so' leitura". */
  gemini: [
    { id: 'plan',      ic: 'clipboard-list', nome: 'Só leitura',    desc: 'Estuda e responde, mas não altera nada' },
    { id: 'auto',      ic: 'code-xml', nome: 'Editar automaticamente', desc: 'Mexe nos arquivos sozinho' },
    { id: 'bypass',    ic: 'unlock', nome: 'Sem pedir permissão',    desc: 'Faz tudo sem perguntar, inclusive o que é perigoso' },
  ],
  /* O Grok tem modos proprios, mas a flag exata ainda nao foi confirmada (precisa
     de assinatura pra testar). Oferecer "so' leitura" sem mandar nada na linha
     seria prometer uma trava que nao existe -- entao aqui so' aparece o que ele
     de fato faz: o que estiver no ~/.grok/config.toml. */
  grok: [
    { id: 'bypass',    ic: 'sliders-horizontal', nome: 'O que estiver no Grok', desc: 'vale a configuração do próprio Grok, no ~/.grok/config.toml' },
  ],
};
const esforcoDe = (P) => P.effort;
/* Modo salvo que nao existe neste motor (ex.: "plan" do Gemini indo pro Codex)
   cai no PRIMEIRO da lista, que e' o mais cuidadoso. Caindo no ultimo, como
   antes, um painel novo nascia em "faz tudo sem perguntar" so' porque o modo do
   outro motor nao existia aqui. */
/* O padrao guardado e' de um motor so'; o painel novo pode ser de outro. */
function modoValido(engine, modo) {
  const lista = MODOS[engine] || MODOS.claude;
  return lista.some((m) => m.id === modo) ? modo : lista[0].id;
}
const modoDe = (P) => {
  const lista = MODOS[P.engine] || MODOS.claude;
  return lista.find((m) => m.id === P.mode) || lista[0];
};

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

/* Depois de derrubar o motor de proposito (trocou de modelo, de modo, de conta),
   a proxima mensagem tem que voltar NA MESMA conversa. O Claude e os motores por
   turno (Gemini, Grok) retomam pelo endereco da sessao; o Codex nao usa isso, ele
   guarda a thread do lado dele.
   Isto estava escrito como "se for claude" em cinco lugares -- e por isso trocar
   o modelo de um painel do Gemini comecava uma conversa NOVA, calada, jogando
   fora tudo que ja tinha sido dito. */
function guardarConversaPraVoltar(P) {
  P.resumeId = P.sessaoId || P.resumeId;
  guardarEstadoDoMotor(P);
}

async function trocarEsforco(P, id) {
  window.CockpitUI?.cancelResume(P);
  P.effort = id; cfg.defEffort = id; window.api.setConfig(cfg);
  if (P.engine === 'claude' && P.started) {
    const antes = antesDaTroca(P);
    await window.api.paneStop({ paneId: P.id, engine: P.engine });
    if (P.morto) return;
    // auditoria 2: com ele trabalhando, a resposta e' cortada -- avisa, como nas outras trocas
    avisarTroca(P, antes, 'o esforço');
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
  window.CockpitUI?.refresh();
  const barra = $('.pane-nome', P.el);
  const t = (P.titulo || '').trim();
  // a barra do nome virou a primeira linha do painel E a alca de arrastar entre
  // colunas: ela nao pode mais sumir quando a conversa ainda nao tem nome
  barra.classList.toggle('sem-nome', !t);
  $('.pn-txt', barra).textContent = t || 'Conversa nova';
  barra.title = !t ? 'Conversa ainda sem nome — arraste daqui para mover de coluna'
    : (P.tituloAuto && !P.nomeManual) ? t + '\nNome dado pelo Cockpit a partir da 1ª mensagem. Clique duas vezes para mudar.'
    : t;
}

function renomearAqui(P) {
  const barra = $('.pane-nome', P.el);
  if ($('.pn-input', barra)) return;
  const txt = $('.pn-txt', barra), lapis = $('.pn-edit', barra);
  const inp = document.createElement('input');
  inp.className = 'pn-input';
  inp.value = P.titulo || '';
  txt.style.display = 'none'; lapis.style.display = 'none';
  barra.setAttribute('draggable', 'false');   // enquanto edita, o mouse e' do campo
  barra.insertBefore(inp, txt);
  inp.focus(); inp.select();
  let pronto = false;
  const fim = async (salvar) => {
    if (pronto) return; pronto = true;
    const novo = inp.value.trim();
    inp.remove(); txt.style.display = ''; lapis.style.display = '';
    barra.setAttribute('draggable', 'true');   // volta a poder arrastar
    if (salvar && novo && novo !== P.titulo) {
      P.titulo = novo; P.nomeManual = true; P.tituloAuto = false; pintarNome(P); savePanes();
      const id = P.sessaoId || P.resumeId;
      if (id) { await window.api.renomear({ engine: P.engine, id, nome: novo, remoto: remotoDoPane(P) });
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

/* Nome da conversa a partir da primeira mensagem. O Claude Code grava um
   'aiTitle' bem melhor no arquivo, mas so' depois de um tempo - e em boa parte
   das conversas ele nunca vem. Ate la, este resumo cru fica no lugar do trecho
   de 70 letras que so' mostrava o comeco da frase. */
const PALAVRA_VAZIA = new Set(['a','o','as','os','de','da','do','das','dos','em','no','na','nos','nas',
  'um','uma','uns','umas','para','pra','pro','por','com','sem','que','se','e','ou','the','of','to',
  'eu','voce','vc','me','meu','minha','isso','esse','essa','este','esta','ai','la','ta','tá','so','só',
  'quero','queria','preciso','gostaria','pode','poderia']);
/* frase curta fica INTEIRA: aparar as pontas de "faz isso pra mim" sobrava
   so' "Mim". So' vale aparar quando ha frase suficiente pra sobrar sentido. */
const MIN_PRA_APARAR = 5;
function tituloCurto(texto) {
  let t = String(texto || '');
  t = t.replace(/```[\s\S]*?```/g, ' ')          // bloco de codigo nao vira titulo
       .replace(/https?:\/\/\S+/g, ' ')            // link tambem nao
       .replace(/[A-Za-z]:\\[^\s]+|\/[\w.-]+\/\S*/g, ' ')   // nem caminho de arquivo
       .replace(/<[^>]+>/g, ' ')
       .replace(/\s+/g, ' ')
       .trim();
  // sobrou nada util (mensagem que era so' link, so' caminho ou so' codigo):
  // devolve VAZIO. O painel mostra "Conversa nova" e o titulo do Claude Code
  // assume depois - melhor do que carimbar a URL crua como nome.
  if (!t) return '';
  const frase = t.split(/(?<=[.!?;\n])\s/)[0] || t;
  const so = (p) => p.toLowerCase().replace(/[^\wáéíóúâêôãõçà-ú]/gi, '');
  let palavras = frase.split(' ').filter(Boolean);
  // corta palavra sem conteudo SO' das pontas: tirando do meio, a frase
  // embaralhava ("faz isso pra mim" virava "Mim")
  if (palavras.length >= MIN_PRA_APARAR) {
    let i = 0;
    // para de comer quando sobrariam menos de 2 palavras
    while (i < palavras.length - 2 && PALAVRA_VAZIA.has(so(palavras[i]))) i++;
    let j = palavras.length;
    while (j > i + 2 && PALAVRA_VAZIA.has(so(palavras[j - 1]))) j--;
    palavras = palavras.slice(i, j);
  }
  if (!palavras.length) return '';
  let nome = palavras.slice(0, 5).join(' ');
  // apara pontuacao pendurada no fim, inclusive ! e ?
  nome = nome.replace(/[\s,;:.!?\-]+$/, '').trim();
  if (!nome) return '';
  nome = nome.charAt(0).toUpperCase() + nome.slice(1);
  return nome.slice(0, 48);
}

/* Le o 'aiTitle' que o proprio CLI grava no arquivo da conversa. Isso e' coisa
   SO' do Claude Code: 'sessions:titulo' devolve '' pra qualquer outro motor, e
   o Codex, o Gemini, o Grok e o ACP nao escrevem titulo nenhum no arquivo
   deles. Por isso o engine !== 'claude' FICA aqui: tirar nao daria nome a
   ninguem, so' faria cada painel de outro motor bater 6 vezes no main (uma a
   cada 20 s) pra receber '' de volta.
   Nao confundir com o nome de 3 palavras do Cockpit: aquele vale pra TODO
   motor e nasce em podeGerarTituloAuto/iniciarTituloAuto, logo abaixo. */
async function buscarNome(P) {
  // leva 41 (B6): o de 3 palavras do Cockpit vence o aiTitle - nem rele
  if (P.morto || P.engine !== 'claude' || !P.sessaoId || P.nomeManual || P.tituloAuto) return;
  // o de 3 palavras ainda esta' chegando: tenta de novo depois, sem gastar tentativa
  if (P._tituloAutoEmVoo) { clearTimeout(P.timerNome); P.timerNome = setTimeout(() => buscarNome(P), 20000); return; }
  let t = await window.api.sessionTitulo({ engine: 'claude', file: P.sessaoFile, id: P.sessaoId });
  if (P.nomeManual || P.tituloAuto) return;   // chegou um nome melhor enquanto lia
  // o ramo herda o titulo da origem no arquivo: sem a marca, os dois paineis ficavam com o mesmo nome
  const ehRamo = /^\(ramo\)/i.test(P.titulo || '');
  if (t && ehRamo) t = tituloDeRamo(t);
  // auditoria 2: nome que veio so' do aiTitle -- a 1a demanda de verdade ainda ganha o de 3 palavras
  if (t && t !== P.titulo) { P.titulo = t; P._tituloDe = ehRamo ? null : 'ai'; pintarNome(P); savePanes(); return; }
  // o 'aiTitle' costuma demorar algumas mensagens pra aparecer: tenta de novo
  // mais tarde, em vez de desistir na primeira
  P.tentouNome = (P.tentouNome || 0) + 1;
  clearTimeout(P.timerNome);
  if (!t && P.tentouNome <= 6) P.timerNome = setTimeout(() => buscarNome(P), 20000);
}

/* ===== leva 41 (B6): nome de 3 palavras da conversa nova =====
   Na 1a mensagem de uma conversa NOVA o Cockpit pede ao Claude (Haiku, no PC,
   sem ferramenta) um nome de exatamente 3 palavras que resume o pedido. Vale
   pra todos os motores: o nome e' do Cockpit, o Claude so' resume.
   Quem vence: o nome que VOCE deu > o de 3 palavras > o aiTitle do CLI > o
   resumo cru (tituloCurto). Enquanto o de 3 palavras nao chega (ou se falhar),
   fica o resumo cru cortado em 3 palavras. Uma chamada por conversa. */
const PALAVRAS_DO_NOME = 3;
function soComandoOuContinue(texto) {
  const t = String(texto || '').trim();
  if (!t) return true;
  if (t.startsWith('/')) return true;   // comando ("/model", "/compact"...) nao e' demanda
  return /^(continue|continua|continuar|prossiga|segue)[\s.!…]*$/i.test(t);
}
function tituloCurto3(texto) {
  const t = tituloCurto(texto);
  return t ? t.split(' ').slice(0, PALAVRAS_DO_NOME).join(' ').replace(/[\s,;:.!?\-]+$/, '').trim() : '';
}
/* Conversa nova de verdade: sem nome (o ramo nasce "(ramo) …", a reaberta e a
   restaurada ja' chegam com nome), sem endereco de conversa que ja existe, sem
   fala sua antes desta (fora "continue" e "/comando") e sem pedido em voo. */
function podeGerarTituloAuto(P, text) {
  if (!P || P.morto || cfg.tituloAuto === false) return false;
  if (P.nomeManual || P.tituloAuto || P._tituloAutoChave) return false;
  /* auditoria 2: 1a mensagem "continue" ou "/comando" e o aiTitle (ou o resumo
     cru) ja' deu nome: a demanda de verdade que vem depois ainda ganha o de 3
     palavras. Nome vindo da lista, da ficha ou do ramo continua barrando. */
  if (String(P.titulo || '').trim() && P._tituloDe !== 'curto' && P._tituloDe !== 'ai') return false;
  if (P.resumeId || P.forkPendente) return false;
  /* conferencia final: so' as falas DESTA conversa (depois da marca do
     zerarNomeDaConversa). Marca que sumiu do hist (openSession/novaConversa
     trocam o hist inteiro) = o hist todo e' desta conversa. */
  const hist = Array.isArray(P.hist) ? P.hist : [];
  const desde = P._fimDaConversaAnterior ? hist.lastIndexOf(P._fimDaConversaAnterior) + 1 : 0;
  if (hist.slice(desde).some((h) => h && h.quem === 'Você' && !soComandoOuContinue(h.texto))) return false;
  return !soComandoOuContinue(text);
}
async function iniciarTituloAuto(P, text) {
  const chave = P.id + ':' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  P._tituloAutoChave = chave; P._tituloAutoEmVoo = true;
  /* auditoria 2: de QUEM e' o pedido -- motor e conversa. O endereco pode chegar
     depois (evento 'sessao', ver aoNascerSessao). Se o painel fechar, trocar de
     motor ou virar outra conversa com o nome voando, o nome vai pra conversa
     que pediu, e nao pro painel de agora. */
  const pedido = { chave, engine: P.engine, sessao: P.sessaoId || null };
  P._tituloPedido = pedido;
  // anexo e imagem ficam de fora: vai so' o texto que voce escreveu
  P.titulo = tituloCurto3(text); P._tituloDe = 'curto'; pintarNome(P);
  let r = null;
  try { r = await window.api.tituloAuto({ chave, texto: String(text || '') }); } catch { r = null; }
  const t = r && typeof r.titulo === 'string' ? r.titulo.trim() : '';
  const aqui = P._tituloAutoChave === chave && !P.morto && P.engine === pedido.engine
    && (!pedido.sessao || !P.sessaoId || P.sessaoId === pedido.sessao);
  if (!aqui) {
    if (P._tituloAutoChave === chave) P._tituloAutoEmVoo = false;
    // grava na conversa que pediu (o nome que voce der continua vencendo: o auto mora a' parte)
    if (t && pedido.sessao) {
      Promise.resolve(window.api.renomear({ engine: pedido.engine, id: pedido.sessao, nome: t, auto: true }))
        .then(() => { histCache[pedido.engine] = null; }).catch(() => {});
    }
    return;
  }
  P._tituloAutoEmVoo = false;
  // voce deu nome no meio: o seu vence; sem titulo: fica o resumo cru
  if (P.nomeManual || !t) return;
  P.titulo = t; P.tituloAuto = true; P._tituloDe = null;
  if (P.el) pintarNome(P);
  savePanes();
  gravarNomeDoPainel(P);
}
/* grava o nome do painel pra conversa (userData/nomes.json), pra lista da
   lateral e a Torre mostrarem o mesmo. O automatico vai marcado (auto: true):
   o seu continua vencendo. Sem endereco ainda, grava quando ele chegar. */
function gravarNomeDoPainel(P) {
  const id = P && P.sessaoId;
  if (!id || !P.titulo || P._nomeGravadoEm === id + '|' + P.titulo) return;
  const auto = !!(P.tituloAuto && !P.nomeManual);
  if (!auto && !P.nomeManual) return;   // aiTitle e resumo cru nao se gravam: sao do motor
  P._nomeGravadoEm = id + '|' + P.titulo;
  const motor = P.engine;
  Promise.resolve(window.api.renomear({ engine: motor, id, nome: P.titulo, auto, remoto: remotoDoPane(P) })).then(() => {
    histCache[motor] = null;
    const aba = $('.side-view[data-view="h' + motor + '"]');
    if (aba && !aba.classList.contains('hidden')) loadHist(motor, true);
  }).catch(() => { P._nomeGravadoEm = null; });
}
// o painel virou outra conversa: o nome automatico da anterior nao vale mais
function esquecerTituloAuto(P) {
  P.tituloAuto = false; P._tituloAutoChave = null; P._tituloAutoEmVoo = false; P._nomeGravadoEm = null;
  P._tituloDe = null; P._tituloPedido = null;   // auditoria 2: o pedido voando continua sabendo de quem e' (iniciarTituloAuto)
}

/* Em aba de servidor o motor do Claude sobe sempre sem pedir permissao (o
   pedido nao atravessa o SSH). Deixar P.mode com outra coisa faz o crachá
   prometer uma revisao que nao vai existir. */
function ajeitarModoRemoto(P) {
  if (P && P.engine === 'claude' && remotoDoPane(P) && P.mode !== 'bypass') P.mode = 'bypass';
}

function pintarModo(P) {
  ajeitarModoRemoto(P);
  const m = modoDe(P);
  P.mode = m.id;
  const bt = $('.p-modo', P.el);
  const rebaixado = !!(P.modoReal && P.modoReal !== m.id);
  const real = rebaixado ? ((MODOS.claude || []).find((x) => x.id === P.modoReal) || m) : m;
  $('.modo-ic', P.el).innerHTML = ico(real.ic);
  $('.modo-nome', P.el).textContent = real.nome;
  bt.classList.toggle('rebaixado', rebaixado);
  bt.title = rebaixado ? ('Você pediu ' + m.nome + '; o motor subiu em ' + real.nome + '.') : 'O que ele pode fazer sem perguntar';
}

/* O motor diz no inicio da sessao em que modo ele subiu. Se for diferente do que
   voce escolheu (ex.: Haiku nao tem Auto), o botao mostra o real e avisa UMA vez.
   P.mode continua sendo a sua escolha: volta a valer ao trocar pra um modelo que
   tenha o modo. P.modoReal nao entra na ficha. */
function aplicarModoReal(P, modo) {
  if (!P || P.engine !== 'claude' || remotoDoPane(P)) return;
  P.modoReal = modo || null;
  pintarModo(P);
  const pedido = modoDe(P).id;
  if (P.modoReal && P.modoReal !== pedido && !P._avisouModo) {
    P._avisouModo = true;
    const nome = (id) => ((MODOS.claude || []).find((m) => m.id === id) || {}).nome || id;
    note(P, 'O ' + ((modeloAtual(P) || {}).nome || 'modelo') + ' não tem o modo ' + nome(pedido) + ' — este painel está em ' + nome(P.modoReal) + '.', true);
  }
}

/* 'cancelarBusca' so' chega FALSE de dentro do novoMenu -- ali quem fecha e'
   quem vai abrir outro menu no lugar, e a busca do "@" nao pode se matar
   sozinha. Em todo o resto (clique fora, Esc, janelaTerminal, conectores,
   conta, diff do git) fechar o menu MATA a busca que ainda vinha pela rede.
   Sem isso ela voltava do servidor segundos depois, chamava novoMenu e fazia
   cx.className='modal-cx'; cx.innerHTML='' na janelinha que a essa altura era o
   TERMINAL do "Entrar na conta": o terminal perdia o DOM e o pty ficava vivo e
   orfao por tras -- a telinha preta de novo, por outra porta. */
function fecharMenus(cancelarBusca) {
  for (const P of panes.values()) {
    const m = $('.p-modal', P.el);
    if (m && m.classList.contains('como-menu')) { m.classList.add('hidden'); m.classList.remove('como-menu'); $('.modal-cx', m).innerHTML = ''; }
    soltarNavArquivos(P);
  }
  if (cancelarBusca !== false) pararBuscaEmVoo();
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
/* <dialog> aberto (debate, conectores): o teclado e' dele. Sem esta guarda o Esc
   que fechava o dialogo tambem parava o painel de tras. */
function dialogoAberto() { return !!document.querySelector('dialog[open]'); }

/* Esc (leva 41, B2): fecha o que estiver aberto; sem nada aberto, para SO' o
   painel em foco, e so' se ele estiver trabalhando. Antes, com o foco num
   painel parado, o Esc parava TODOS os ocupados -- em 11/09 cinco sessoes
   levaram "[Request interrupted by user]" no mesmo segundo. */
function tratarEsc(P, semParar) {
  if (!$('#popGrupo').classList.contains('hidden')) { fecharPopGlobal(); return 'fechou'; }
  if (!$('#modalGrupo').classList.contains('hidden')) { fecharModalGlobal(); return 'fechou'; }
  const visorAberto = [...panes.values()].some(Q => !$('.p-visor', Q.el).classList.contains('hidden'));
  if (visorAberto) { fecharVisor(); return 'fechou'; }
  const popupAberto = [...panes.values()].some(Q => !$('.p-modal', Q.el).classList.contains('hidden'));
  if (popupAberto) {
    fecharMenus();
    // o terminal so' morre no painel em que voce esta: Esc no painel B nao pode
    // derrubar o login que esta rodando no painel A. E o painel A tambem nao
    // pode ter a janelinha ESCONDIDA com o processo vivo por tras dela.
    if (focusPane) fecharTerminalDoPainel(focusPane);
    for (const Q of panes.values()) if (!Q._fecharTerm) fecharModal(Q);
    return 'fechou';
  }
  if (P && P.busy && !semParar) { interromperPainel(P); return 'parou'; }
  return '';
}
/* auditoria 1: Esc que nasceu FORA de um painel (barra lateral -- Automacoes,
   Torre, Ajustes, lista, filtro --, abas do topo, menus, caixas do app) fecha o
   que estiver aberto mas NUNCA para a IA do painel em foco. Sem foco nenhum (o
   Esc cai no corpo da pagina) vale onde foi o ultimo clique. */
function escGlobal(e) {
  if (e.key !== 'Escape' || quadro) return;   // com o quadro aberto o Esc e' do Excalidraw
  if (dialogoAberto()) return;
  // dentro do terminal embutido, Esc é do terminal, não fecha a janelinha
  const dentroTerm = document.activeElement && document.activeElement.closest && document.activeElement.closest('.term-wrap');
  if (dentroTerm) return;
  const alvo = e.target && e.target.nodeType === 1 ? e.target : null;
  const solto = !alvo || alvo === document.body || alvo === document.documentElement;
  const fora = solto ? !!document.escForaDoPainel : !(alvo.closest && alvo.closest('.pane'));
  tratarEsc(focusPane, fora);
}
document.addEventListener('keydown', escGlobal);
// onde foi o ultimo clique (captura: antes de qualquer ouvinte parar o evento)
document.addEventListener('mousedown', (e) => { document.escForaDoPainel = !(e.target && e.target.closest && e.target.closest('.pane')); }, true);

function novoMenu(P) {
  fecharMenus(false);   // e' a propria busca do "@" reabrindo a janelinha: nao pode se cancelar
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
/* logo: '<motor>' poe o logo do motor no lugar do icone; tagLogo: '<motor>' poe
   o logo antes do texto da etiqueta (ex.: "Trocar de motor  [logo] Claude") */
function elItem({ ic, logo, nome, desc, tag, tagLogo, on }, aoClicar) {
  const d = document.createElement('div');
  d.className = 'mi' + (on ? ' on' : '');
  d.innerHTML = '<div class="mi-ic"></div><div class="mi-txt"><div class="mi-n"></div></div>'
    + (on ? '<div class="mi-ck">' + ico('check') + '</div>' : (tag ? '<div class="mi-tag"></div>' : ''));
  $('.mi-ic', d).innerHTML = logo ? marcaDoMotor(logo) : ic ? (ICONES[ic] ? ico(ic) : '<span class="ic-txt">' + ic + '</span>') : '';
  $('.mi-n', d).textContent = nome;
  if (desc) { const e = document.createElement('div'); e.className = 'mi-d'; e.textContent = desc; $('.mi-txt', d).appendChild(e); }
  if (tag && !on) {
    const t = $('.mi-tag', d);
    t.textContent = tag;
    if (tagLogo) t.insertAdjacentHTML('afterbegin', marcaDoMotor(tagLogo));
  }
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

/* Shift+Tab: anda pelos modos de permissao na ordem da lista, igual ao CLI. */
async function girarModo(P) {
  // 'bypass' (faz tudo sem perguntar) e 'revisado' (aprova arriscado sozinho,
  // via revisor) ficam FORA do ciclo: chegar neles sem querer, so' de teclar
  // rapido, e' grave demais. Pra usar, pelo menu de modos.
  const lista = (MODOS[P.engine] || []).filter(m => m.id !== 'bypass' && m.id !== 'revisado');
  if (!lista.length) return;
  const i = lista.findIndex(m => m.id === P.mode);
  const mo = lista[(i + 1) % lista.length];
  // so' ESTE painel: o giro nao pode virar o padrao de todo painel novo
  P.mode = mo.id;
  /* auditoria 1: voce escolheu o modo agora -- o "modo real" em que a sessao
     ANTERIOR subiu (ex.: Manual do Haiku) nao vale mais. Sem isto o botao seguia
     mostrando o modo velho depois do Shift+Tab. */
  P.modoReal = null; P._avisouModo = false;
  pintarModo(P);
  const antes = antesDaTroca(P);
  await window.api.paneStop({ paneId: P.id, engine: P.engine });
  if (P.morto) return;
  avisarTroca(P, antes, 'o modo');
  guardarConversaPraVoltar(P);
  destravarPainel(P);
  P.started = false; setDot(P, 'off');
  note(P, 'Modo: ' + mo.nome + ' — ' + mo.desc.toLowerCase() + '.');
  savePanes();
  const campo = $('.p-input', P.el);
  if (campo) campo.focus();      // o cursor continua onde estava
}

/* ---- menu de Modos + barrinha de esforço ---- */
/* Escolher entre os cinco motores. Desde a leva 39 esta e' a UNICA lista: o
   botao do topo de qualquer painel abre ela, e a paleta de comandos tambem.
   Motor novo entra so' no MOTORES la' em cima -- nao ha mais desenho de barra
   pra mexer. */
function menuMotores(P) {
  if (window.CockpitUI) return window.CockpitUI.agentLayer(P, 'engine');
  const m = novoMenu(P);
  m.appendChild(tituloPopup('Motores'));
  m.appendChild(subPopup('A conversa continua: o motor novo recebe o que já foi dito.'));
  /* Numa aba de servidor so' o Claude roda. Antes a lista vendia os outros
     quatro com o texto normal ("o da OpenAI, com aprovacao passo a passo") e a
     recusa so' vinha DEPOIS do clique: dizer isso aqui poupa a viagem. */
  const remoto = !!remotoDoPane(P);
  for (const eng of MOTORES) {
    const dispo = motorDisponivel[eng];
    const soLocal = remoto && eng !== 'claude';
    m.appendChild(elItem({
      logo: eng, nome: nomeDoMotor(eng), on: eng === P.engine,
      desc: eng === P.engine ? 'é o que está em uso agora'
        : soLocal ? 'ainda não roda em servidor remoto'
        : dispo === false ? 'não instalado nesta máquina' : DICA_MOTOR[eng] || '',
    }, () => {
      if (eng === P.engine) return;
      if (soLocal) {
        note(P, 'O ' + nomeDoMotor(eng) + ' ainda não roda em servidor remoto. Nesta aba, use o Claude.', true);
        return;
      }
      if (dispo === false) {
        note(P, 'O ' + nomeDoMotor(eng) + ' não está instalado nesta máquina. ' + (COMO_INSTALAR[eng] || ''), true);
        return;
      }
      trocarMotor(P, eng);
    }));
  }
}

const DICA_MOTOR = {
  claude: 'o mais completo aqui: pergunta antes de agir e roda no servidor',
  codex: 'o da OpenAI, com aprovação passo a passo',
  gemini: 'o do Google, com camada grátis',
  grok: 'o do xAI, precisa de SuperGrok ou X Premium+',
  acp: 'qualquer agente que fale ACP (Gemini, Claude Code, Codex, OpenCode…) por um comando',
};
/* Primeiro uso: links de instalação oficiais; cada pessoa entra na própria conta. */
const GUIA_MOTORES = [
  { id: 'claude', nome: 'Claude Code', url: 'https://code.claude.com/docs/en/setup', login: 'Depois de instalar no Windows, abra o terminal e execute claude. Siga o login com sua conta.' },
  { id: 'codex', nome: 'Codex CLI', url: 'https://developers.openai.com/codex/cli', login: 'Depois de instalar no Windows, abra o terminal e execute codex. Siga o login com sua conta.' },
  { id: 'gemini', nome: 'Gemini CLI', url: 'https://geminicli.com/docs/get-started/installation/', login: 'A instalação usa Node.js e npm. Depois, execute gemini no terminal e entre com sua conta Google.' },
];
function precisaPrimeirosPassos(config, disponibilidade) {
  const temConversas = Array.isArray(config?.panes) && config.panes.length > 0;
  const temAbas = Array.isArray(config?.abas) && config.abas.length > 0;
  return !temConversas && !temAbas && ['claude', 'codex', 'gemini', 'grok'].every(id => disponibilidade?.[id] === false);
}
function prepararPrimeirosPassos() {
  const criarBotao = (id, classe, texto) => {
    if (document.getElementById(id)) return null;
    const bt = document.createElement('button');
    bt.id = id; bt.type = 'button'; bt.className = classe; bt.textContent = texto;
    bt.addEventListener('click', abrirPrimeirosPassos);
    return bt;
  };
  const motores = [...document.querySelectorAll('.settings .aj-grupo')]
    .find(grupo => /^Motores/.test(grupo.querySelector('h3')?.textContent || ''));
  const ajustar = criarBotao('btnPrimeirosPassosAjustes', 'btn-wide', 'Primeiros passos · instalar e conectar');
  if (motores && ajustar) motores.prepend(ajustar);
  const abertura = document.querySelector('#boasvindas .bv-cx');
  const ajudar = criarBotao('btnPrimeirosPassosInicio', 'mo-btn', 'Primeiros passos');
  if (abertura && ajudar) abertura.append(ajudar);
}
function abrirPrimeirosPassos() {
  const anterior = document.getElementById('primeirosPassos');
  if (anterior?.open) { anterior.querySelector('button')?.focus(); return; }
  const focoAnterior = document.activeElement;
  const criar = (tag, classe, texto) => {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto) el.textContent = texto;
    return el;
  };
  const dlg = criar('dialog', 'co-dialog co-health-dialog');
  dlg.id = 'primeirosPassos'; dlg.setAttribute('aria-labelledby', 'primeirosPassosTitulo');
  const cab = criar('div', 'co-dialog-head');
  const titulo = criar('h2', '', 'Primeiros passos'); titulo.id = 'primeirosPassosTitulo';
  const fechar = criar('button', 'co-close', 'Fechar'); fechar.type = 'button';
  fechar.setAttribute('aria-label', 'Fechar primeiros passos');
  fechar.addEventListener('click', () => dlg.close()); cab.append(titulo, fechar);
  const corpo = criar('div', 'co-dialog-body');
  corpo.append(criar('p', 'aj-info', '1. Instale pelo menos um motor de IA no Windows. 2. Entre com sua própria conta. 3. Reabra o Cockpit e escolha esse motor para conversar.'));
  corpo.append(criar('p', 'aj-desc', 'O instalador inclui o Cockpit. Motores de IA, assinaturas, contas e modelos de voz são configurados separadamente em cada computador.'));
  const estados = new Map();
  const abrirGuia = (url, nome) => {
    const bt = criar('button', 'mo-btn', nome); bt.type = 'button';
    bt.addEventListener('click', async () => {
      try { await window.api.abrirLink(url); }
      catch { aviso.textContent = 'Não consegui abrir o navegador. Acesse: ' + url; }
    });
    return bt;
  };
  for (const motor of GUIA_MOTORES) {
    const item = criar('section', 'aj-grupo');
    item.append(criar('h3', 'aj-titulo', motor.nome));
    const estado = criar('p', 'aj-desc', 'Conferindo instalação…'); estados.set(motor.id, estado);
    item.append(estado, criar('p', 'aj-info', motor.login), abrirGuia(motor.url, 'Guia oficial · ' + motor.nome));
    corpo.append(item);
  }
  corpo.append(criar('p', 'aj-info', 'Git para Windows habilita revisão de alterações e pastas de trabalho isoladas. Para SSH, configure seu servidor, usuário e chave na seção Lugares. Voz precisa de Python, pacotes e modelo de transcrição local.'));
  corpo.append(abrirGuia('https://git-scm.com/install/windows', 'Guia oficial · Git para Windows'));
  corpo.append(criar('p', 'aj-desc', 'Para trocar de conta depois, use o ícone do motor → Gerenciar contas. Grok e agentes ACP seguem a instalação e o login do agente escolhido.'));
  const aviso = criar('p', 'aj-info'); aviso.setAttribute('role', 'status'); aviso.setAttribute('aria-live', 'polite'); corpo.append(aviso);
  const acoes = criar('div', 'co-actions');
  const conferir = criar('button', 'co-bt', 'Verificar novamente'); conferir.type = 'button';
  const concluir = criar('button', 'co-bt co-primary', 'Continuar'); concluir.type = 'button';
  concluir.addEventListener('click', () => dlg.close()); acoes.append(conferir, concluir);
  dlg.append(cab, corpo, acoes);
  const atualizar = async () => {
    conferir.disabled = true; aviso.textContent = 'Conferindo os motores deste computador…';
    try {
      const r = await verMotoresDisponiveis();
      if (!dlg.isConnected) return;
      for (const [id, el] of estados) el.textContent = r?.[id] === true
        ? 'Instalado neste computador. O login é conferido pelo próprio motor.'
        : r?.[id] === false ? 'Ainda não instalado neste computador.' : 'Não consegui conferir a instalação.';
      aviso.textContent = r ? 'Após instalar, reabra o Cockpit para atualizar os caminhos dos programas.' : 'Não consegui verificar agora. Você pode abrir os guias e tentar novamente.';
    } catch { if (dlg.isConnected) aviso.textContent = 'Não consegui verificar agora. Tente novamente.'; }
    finally { conferir.disabled = false; }
  };
  conferir.addEventListener('click', atualizar);
  dlg.addEventListener('keydown', e => { if (e.key === 'Escape') e.stopPropagation(); });
  dlg.addEventListener('close', () => { dlg.remove(); if (focoAnterior?.isConnected) focoAnterior.focus(); });
  document.body.append(dlg); dlg.showModal(); fechar.focus(); atualizar();
}

const COMO_INSTALAR = {
  claude: 'Abra Primeiros passos para instalar o Claude Code e entrar com sua própria conta.',
  codex: 'Abra Primeiros passos para instalar o Codex CLI e entrar com sua própria conta.',
  gemini: 'Instale com "npm i -g @google/gemini-cli" e entre na conta rodando "gemini" no terminal.',
  grok: 'Instale pelo site do xAI e entre na conta rodando "grok" no terminal.',
  acp: 'Precisa do Gemini CLI ("npm i -g @google/gemini-cli") ou do npx pra baixar um adaptador ACP.',
};
/* Preenchido no arranque. Enquanto for null a tela nao afirma nada: so' depois
   da resposta e' que um motor aparece como "nao instalado". */
const motorDisponivel = { claude: true, codex: true, gemini: null, grok: null, acp: null };
async function verMotoresDisponiveis() {
  let disponibilidade = null;
  try {
    const r = await window.api.motoresDisponiveis();
    if (r && typeof r === 'object') { Object.assign(motorDisponivel, r); disponibilidade = r; }
  } catch {}
  /* a resposta chega depois da tela desenhada: aqui e o momento de marcar na
     abertura quem nao esta instalado, em vez de deixar o botao mentir. */
  for (const eng of MOTORES) {
    const bt = document.querySelector('.bv-bt[data-motor="' + eng + '"]');
    if (!bt) continue;
    const fora = motorDisponivel[eng] === false;
    bt.classList.toggle('fora', fora);
    bt.title = fora ? 'Não está instalado nesta máquina' : '';
    // o icone da barra tambem: senao ele promete uma coluna de conversas de
    // um motor que nem esta na maquina
    const icone = document.querySelector('.act[data-view="h' + eng + '"]');
    if (!icone) continue;
    icone.classList.toggle('fora', fora);
    icone.title = 'Conversas do ' + nomeDoMotor(eng) + (fora ? ' — não instalado nesta máquina' : '');
  }
  return disponibilidade;
}

async function mudarModoDoPainel(P, mo) {
  window.CockpitUI?.cancelResume(P);
  const ehRemoto = !!remotoDoPane(P) && P.engine === 'claude';
      P.mode = mo.id;
      P.modoReal = null; P._avisouModo = false;   // auditoria 1: o modo real da sessao anterior nao vale mais
      // aba de servidor so' aceita bypass: gravar isso como padrao rebaixaria
      // tambem os paineis do PC, que sao a maioria
      if (!ehRemoto) { cfg.defMode = mo.id; window.api.setConfig(cfg); }
      pintarModo(P);
      const antes = antesDaTroca(P);
      await window.api.paneStop({ paneId: P.id, engine: P.engine });
      if (P.morto) return;
      avisarTroca(P, antes, 'o modo');
      // so o Claude reaplica o modo ao retomar; no Codex a politica antiga ficaria valendo
      guardarConversaPraVoltar(P);
      destravarPainel(P);
      P.started = false; setDot(P, 'off');
      note(P, 'Modo: ' + mo.nome + ' — ' + mo.desc.toLowerCase() + '.');
      savePanes();
}

function menuModos(P) {
  if (window.CockpitUI) return window.CockpitUI.agentLayer(P, 'mode');
  const m = novoMenu(P);
  m.appendChild(tituloPopup('Modos'));
  m.appendChild(subPopup('O que ele pode fazer sem te perguntar.'));

  // A restrição de modo abaixo pertence somente ao transporte legado do Claude.
  const ehRemoto = !!remotoDoPane(P) && P.engine === 'claude';
  if (ehRemoto) {
    m.appendChild(subPopup('Nesta aba o Claude trabalha dentro do servidor, e o pedido de permissão não atravessa o SSH: lá ele age sem perguntar. Para revisar antes, use um painel do PC.'));
  }
  for (const mo of MODOS[P.engine]) {
    m.appendChild(elItem({ ic: mo.ic, nome: mo.nome, desc: mo.desc, on: mo.id === P.mode }, async () => {
      if (ehRemoto && mo.id !== 'bypass') {
        note(P, 'Este painel roda dentro do servidor: lá o Claude age sem pedir permissão, independente do modo. Para revisar cada passo, use um painel do PC.', true);
        return;
      }
      await mudarModoDoPainel(P, mo);
    }));
  }
  m.appendChild(elLinha());

  m.appendChild(barraEsforco(P));
}

/* ---- menu de modelos (no cabeçalho) ---- */
/* Trocar o modelo reinicia o motor na mesma conversa. Com ele trabalhando, a
   resposta em andamento e' cortada: avisa, igual a troca de modo (auditoria 1 --
   antes cortava calado). O modo real da sessao anterior (ex.: o Haiku subiu em
   Manual) tambem sai: o modelo novo pode ter o modo que voce escolheu. */
async function trocarModeloDoPainel(P, mo) {
  window.CockpitUI?.cancelResume(P);
  P.model = mo.id;
  P.modeloDoPadrao = false;   // auditoria 2: escolhido a mao -- o padrao dos Ajustes nao mexe mais aqui
  P.modoReal = null; P._avisouModo = false;
  const ef = esforcosDe(P);
  if (!ef.find(e => e.id === P.effort)) P.effort = mo.padraoEffort || ef[0].id;
  fillModels(P); pintarModo(P);
  const antes = antesDaTroca(P);
  await window.api.paneStop({ paneId: P.id, engine: P.engine });
  if (P.morto) return;
  avisarTroca(P, antes, 'o modelo');
  guardarConversaPraVoltar(P);
  destravarPainel(P);
  P.started = false; setDot(P, 'off'); savePanes();
}
async function alternarFallbackClaude(P) {
  if (!P || P.morto || P.engine !== 'claude') return;
  cfg.fallbackClaude = !cfg.fallbackClaude;
  window.api.setConfig(cfg);
  // Religa na mesma conversa para aplicar a opção no próximo envio.
  const antes = antesDaTroca(P);
  await window.api.paneStop({ paneId: P.id, engine: P.engine });
  if (P.morto || P.engine !== 'claude') return;
  avisarTroca(P, antes, 'o Sonnet reserva', { acao: 'ligar/desligar o Sonnet reserva', voce: 'ligou/desligou o Sonnet reserva' });
  guardarConversaPraVoltar(P);
  destravarPainel(P);
  P.started = false; setDot(P, 'off'); savePanes();
  note(P, cfg.fallbackClaude
    ? 'Combinado: se o modelo escolhido cair, o Sonnet assume e eu aviso aqui.'
    : 'Fallback desligado: se o modelo cair, o turno falha e você decide.');
}
async function menuModelos(P) {
  if (window.CockpitUI) return window.CockpitUI.agentLayer(P, 'model');
  const m = novoMenu(P);
  const pintar = () => {
    m.innerHTML = '';
    if (P.engine === 'acp') { pintarMenuAcp(P, m); return; }
    m.appendChild(tituloPopup('Modelo'));
    m.appendChild(subPopup('Qual cérebro este painel vai usar, e quanto ele deve pensar.'));
    for (const mo of modelosDe(P)) {
      m.appendChild(elItem({ nome: mo.nome, desc: mo.desc, on: mo.id === P.model }, () => trocarModeloDoPainel(P, mo)));
    }
    if (P.engine === 'claude') {
      m.appendChild(elLinha());
      m.appendChild(elItem({
        ic: 'refresh-cw', nome: 'Se o modelo cair, usar o Sonnet',
        desc: 'quando o escolhido estiver fora do ar, o Sonnet 5 assume o turno e o painel avisa',
        on: !!cfg.fallbackClaude,
      }, () => alternarFallbackClaude(P)));
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

/* o modo que o agente anunciou, no vocabulario da tela quando da' pra traduzir */
function nomeDoModoAcp(id) {
  const s = String(id || '');
  if (!s) return '';
  if (/^(yolo|bypassPermissions|bypass_permissions|bypass|full-auto|fullAuto)$/i.test(s)) return 'sem pedir permissão';
  if (/^(autoEdit|auto_edit|acceptEdits|accept_edits|auto-edit)$/i.test(s)) return 'editar automaticamente';
  if (/^(plan|planning|readOnly|read-only|read_only)$/i.test(s)) return 'plano';
  if (/^(default|ask|normal|interactive)$/i.test(s)) return 'manual';
  return s;
}

/* menu do painel ACP: o "modelo" e' o agente (um comando), e embaixo os
   modelos que o proprio agente anunciou ao abrir a sessao (session/set_model,
   provado no Gemini). Trocar de agente e' sessao nova - o id pertence ao outro. */
function pintarMenuAcp(P, m) {
  m.appendChild(tituloPopup('Agente ACP'));
  m.appendChild(subPopup('Qual programa este painel roda. Todos falam o mesmo protocolo; trocar leva a conversa junto.'));
  const trocarAgente = async (cmd) => {
    if (!cmd || cmd === P.model) return;   // mesmo agente: nada a trocar
    const antigo = modeloAtual(P).nome;
    const contexto = P.hist.length ? montarContexto(P) : null;
    await window.api.paneStop({ paneId: P.id, engine: P.engine });
    if (P.morto) return;
    destravarPainel(P);
    // o painel vai reiniciar: o microfone nao pode continuar ligado sozinho
    if (P.pararGravacao) { try { P.pararGravacao(); } catch {} }
    P.model = cmd; fillModels(P);
    // mesma limpeza da troca de motor: a sessao, o contexto medido e o rastro
    // do turno eram do agente anterior
    P.resumeId = null; P.sessaoId = null; P.sessaoFile = ''; P.resumeAnterior = null;
    P.acpInfo = null; P.acpModelos = null; P.acpModeloAtual = ''; P.acpComandos = null;
    P.tokens = 0; P.janela = 0; pintarTokens(P);
    P.blocks.clear(); esquecerPassos(P);
    limparPlano(P); limparAuditoria(P); zerarTurno(P); P.forkPendente = false;
    P.started = false; setDot(P, 'off');
    P.passarContexto = contexto;
    savePanes();
    marcaTroca(P, antigo, modeloAtual(P).nome);
  };
  for (const mo of modelosDe(P)) {
    m.appendChild(elItem({ nome: mo.nome, desc: mo.desc, on: mo.id === P.model }, () => { if (mo.id !== P.model) trocarAgente(mo.id); }));
  }
  const cx = document.createElement('div');
  cx.className = 'menu-cmd';
  const inp = document.createElement('input');
  inp.className = 'menu-search';
  inp.placeholder = 'Outro comando… (ex.: meu-agente --acp) e Enter';
  inp.addEventListener('click', (e) => e.stopPropagation());
  inp.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') e.stopPropagation();   // o Esc continua fechando o menu
    if (e.key === 'Enter') { const v = inp.value.trim(); if (v) { fecharMenus(); trocarAgente(v); } }
  });
  cx.appendChild(inp);
  m.appendChild(cx);
  const modelos = P.acpModelos || [];
  if (modelos.length) {
    m.appendChild(elLinha());
    m.appendChild(elSecao('Modelo do agente'));
    for (const mo of modelos) {
      m.appendChild(elItem({ nome: mo.nome || mo.id, desc: mo.desc || '', on: mo.id === P.acpModeloAtual }, async () => {
        const r = await window.api.acpConfig({ paneId: P.id, modelo: mo.id });
        if (r && r.ok) { P.acpModeloAtual = mo.id; note(P, 'Modelo do agente: ' + (mo.nome || mo.id)); }
        else note(P, (r && r.error) || 'Não deu para trocar o modelo.', true);
      }));
    }
  }
  const info = P.acpInfo;
  if (info && info.agente) {
    m.appendChild(elLinha());
    m.appendChild(subPopup('Ligado: ' + info.agente + (info.versao ? ' ' + info.versao : '') + (info.modoAtual ? ' · modo: ' + nomeDoModoAcp(info.modoAtual) : '')));
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
    { ic: 'image', nome: 'Recortar a tela', desc: 'esconde o Cockpit, você arrasta o pedaço (Ctrl+Alt+R de qualquer lugar, se ligado nos Ajustes)', act: 'recorte' },
    { ic: 'image', nome: 'Fotografar', desc: 'pela webcam: rascunho no papel, quadro físico (o celular aparece se estiver como câmera)', act: 'foto' },
    { ic: 'workflow', nome: 'Desenhar no quadro', desc: 'quadro branco (Excalidraw) aqui dentro: fluxo, arquitetura, tela — vira imagem + passo a passo no prompt', act: 'quadro' },
  ];
  for (const i of itens) m.appendChild(elItem(i, async () => {
    if (i.act === 'cwd') return inserirNoInput(P, P.cwd);
    if (i.act === 'recorte') return recortarTela(P);
    if (i.act === 'foto') return fotografar(P);
    if (i.act === 'quadro') return abrirQuadro(P);
    const files = await window.api.pickFiles(i.act);
    if (files && files.length) {
      if (i.act === 'folder') inserirNoInput(P, files.join(' '));
      else await anexar(P, files);
    }
  }));
}

/* ---- menu do / (ações, modelo e comandos) ---- */
/* Etiqueta de escopo na lista de skills.
   So' aparece no que FOGE do normal: quase tudo e' "pessoal" (315 de 316 aqui),
   e etiquetar todas so' encheria a lista de ruido. Skill que vem da PASTA do
   projeto, essa sim muda conforme o painel - e por isso ganha etiqueta. */
const ESCOPO_PT = { project: 'do projeto', workspace: 'do projeto', plugin: 'plugin', builtin: 'nativa', system: 'sistema' };
function etiquetaSkill(sk) {
  if (!sk || sk.source !== 'native') return '';
  return ESCOPO_PT[String(sk.scope || '').toLowerCase()] || '';
}

/* filtro das acoes do "/": o nome e os sinonimos (chaves). Sem as chaves,
   quem procurava "ramificar" ou "fork" nao achava nada. q ja' vem minusculo. */
function acaoCasa(a, q) {
  if (!q) return true;
  return String(a.nome || '').toLowerCase().includes(q) || String(a.chaves || '').toLowerCase().includes(q);
}
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
    { sec: 'Contexto', ic: 'eraser', nome: 'Limpar a tela', desc: 'a conversa continua', act: () => { P.chat.innerHTML = ''; P.blocks.clear(); P.tools.clear(); esquecerPassos(P); } },
    { sec: 'Contexto', ic: 'sparkles', nome: 'Começar conversa nova', act: () => novaConversa(P.engine) },
    { sec: 'Modelo', ic: 'brain', nome: 'Trocar modelo…', tag: modeloAtual(P).nome, act: () => menuModelos(P) },
    { sec: 'Modelo', ic: 'sliders-horizontal', nome: 'Esforço', tag: EF_PT[P.effort] || P.effort, act: () => menuModelos(P) },
    { sec: 'Modelo', ic: 'lock', nome: 'Modos de permissão', tag: modoDe(P).nome, act: () => menuModos(P) },
    { sec: 'Modelo', ic: 'unlock', nome: 'Limpar liberações automáticas', desc: 'volta a perguntar sobre as ferramentas que você liberou neste painel', act: async () => {
      await window.api.liberacoes({ paneId: P.id, limpar: true });
      note(P, 'Pronto: volto a perguntar antes de usar qualquer ferramenta.');
    } },
    { sec: 'Modelo', ic: 'arrow-left-right', nome: 'Trocar de motor', tag: nomeDoMotor(P.engine), tagLogo: P.engine, desc: atalhoDaMaquina('continua a mesma conversa com outro · \u2318\u21e7M alterna Claude e Codex'), act: () => menuMotores(P) },
    { sec: 'Painel', ic: 'folder-open', nome: 'Trocar a pasta deste painel', tag: nomePasta(P.cwd), act: () => $('.p-cwd', P.el).click() },
    { sec: 'Painel', ic: 'plus', nome: 'Abrir outro painel ao lado', act: () => { if (cabeMaisPainel()) newPane({ engine: P.engine, cwd: P.cwd }); } },
    { sec: 'Painel', ic: 'workflow', nome: 'Quadro branco', chaves: 'desenhar fluxo fluxograma excalidraw diagrama', tag: (P.quadroCena || P.quadroArquivo) ? 'com desenho' : '', desc: 'desenhar um fluxo e mandar como imagem + passo a passo (Excalidraw embutido)', act: () => abrirQuadro(P) },
    { sec: 'Painel', ic: 'git-branch', nome: 'Ramificar conversa', chaves: 'ramificar fork ramo continuar em outro painel', desc: 'abre um painel novo com esta conversa, pra seguir por outro caminho; este painel não muda', act: () => ramificar(P) },
    { sec: 'Painel', ic: 'folder-open', nome: 'Pastas Git isoladas…', tag: (P.managedWorktree || P.worktree) ? '⎇' : '',
      desc: 'criar, abrir uma existente ou voltar à pasta principal · Codex e Claude', act: () => alternarWorktree(P) },
    { sec: 'Prompts', ic: 'star', nome: 'Salvar o texto do campo como prompt…', desc: 'pra reaproveitar pedidos longos (fica em ~/.claude/cockpit-prompts.json)', act: () => salvarPromptDoCampo(P) },
    { sec: 'Prompts', ic: 'eraser', nome: 'Apagar um prompt salvo…', act: () => apagarPromptSalvo(P) },
    { sec: 'Conectores', ic: 'plug', nome: 'conectores', desc: 'ver, reconectar ou adicionar um conector', act: () => janelaConectores(P) },
    { sec: 'Conectores', ic: 'plug', nome: 'Diagnóstico dos conectores', desc: 'ver o que está carregado e as chamadas observadas nesta sessão', act: () => window.CockpitCollaboration?.health(P) },
    { sec: 'Painel', ic: 'messages-square', nome: 'Debater com Codex e Claude', desc: 'os dois leem o projeto (só leitura) e discutem, só quando você iniciar', act: () => window.CockpitCollaboration?.open(P) },
    { sec: 'Painel', ic: 'git-compare', nome: 'Revisar código com os dois', desc: 'debate somente leitura sobre as alterações atuais do Git', act: () => window.CockpitCollaboration?.open(P, { review: true }) },
    { sec: 'Painel', ic: 'terminal', nome: 'terminal', desc: 'rodar comandos aqui dentro, sem abrir o Terminal do sistema', act: () => janelaTerminal(P, linhaShell(P.cwd, remotoDoPane(P)), 'Terminal — ' + (remotoDoPane(P) ? nomeCurtoDaAba(abaPorId(P.abaId)) : nomePasta(P.cwd))) },
    { sec: 'Conta', ic: 'arrow-left-right', nome: 'Trocar de conta', desc: 'alternar entre as contas já guardadas, sem sair desta conversa', act: () => menuContas(P.engine, ancoraDoPainel(P), null) },
    { sec: 'Conta', ic: 'key-round', nome: 'login', desc: 'entrar com outra conta do ' + nomeDoMotor(P.engine), act: () => contaAcao(P, 'login') },
    { sec: 'Conta', ic: 'log-out', nome: 'logout', desc: 'sair da conta atual', act: () => contaAcao(P, 'logout') },
    { sec: 'Conta', ic: 'user', nome: 'conta', desc: 'quem está entrado e quanto do limite já foi', act: () => janelaConta(P) },
  ];

  let skills = [];
  let prompts = [];
  const pintar = (f) => {
    /* as skills do Codex chegam DEPOIS (o menu abre na hora e se completa
       sozinho). Sem guardar quem estava marcado, esse repintar apagava a
       selecao e o Enter disparava o primeiro item da lista, nao o escolhido.
       Guarda o TEXTO, nao a posicao: com outro filtro a lista muda inteira, e
       remarcar "a linha 3" apontaria pra uma acao que nao tem nada a ver -
       um Enter ali chamaria logout, ou limparia a tela. */
    const marcadoEl = corpo.querySelector('.mi.sel');
    const marcado = marcadoEl ? marcadoEl.textContent : null;
    corpo.innerHTML = '';
    const q = (f || '').toLowerCase().replace(/^\//, '');
    let secAtual = '';
    for (const a of acoes) {
      if (q && !acaoCasa(a, q)) continue;
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
    // prompts salvos: filtram pelo nome e pelo comeco do texto, e entram no campo
    const promptsVis = prompts.filter((p) => !q || String(p.nome || '').toLowerCase().includes(q) || String(p.texto || '').toLowerCase().includes(q)).slice(0, 40);
    if (promptsVis.length) {
      corpo.appendChild(elSecao('Prompts salvos (' + prompts.length + ')'));
      for (const p of promptsVis) corpo.appendChild(elItem({ ic: 'star', nome: p.nome, desc: String(p.texto || '').replace(/\s+/g, ' ').slice(0, 90) }, () => {
        const inp = $('.p-input', P.el);
        if (inp.value.startsWith('/') && !inp.value.includes(' ')) inp.value = '';
        inserirNoInput(P, p.texto);
      }));
    }
    const vis = (q ? [...porNome, ...porDesc] : skills).slice(0, 150);
    if (vis.length) {
      corpo.appendChild(elSecao('Comandos e skills' + (skills.length ? ' (' + skills.length + ')' : '')));
      for (const sk of vis) corpo.appendChild(elItem({ ic: '/', nome: sk.name, desc: sk.desc, tag: etiquetaSkill(sk) }, () => {
        const inp = $('.p-input', P.el);
        if (inp.value.startsWith('/') && !inp.value.includes(' ')) inp.value = '';
        inserirNoInput(P, '/' + sk.name);
      }));
    } else if (!corpo.children.length) {
      corpo.innerHTML = '<div class="menu-empty">Nada encontrado.</div>';
    }
    if (marcado != null) {
      const volta = [...corpo.querySelectorAll('.mi')].find((x) => x.textContent === marcado);
      // nao achou o mesmo item: fica sem selecao, que e' melhor do que marcar outro
      if (volta) { volta.classList.add('sel'); volta.scrollIntoView({ block: 'nearest' }); }
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
  [skills, prompts] = await Promise.all([
    // a pasta vai junto: no Codex as skills mudam conforme o projeto do painel
    window.api.skills({ engine: P.engine, paneId: P.id, cwd: P.cwd, remoto: remotoDoPane(P) }).then((s) => s || []).catch(() => []),
    window.api.promptsLer().then((p) => p || []).catch(() => []),
  ]);
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
// motor: tarja que fala de UM motor (limite, versao nova, conta) leva o logo dele
function mostrarAviso({ id, texto, tipo, acao, aoClicar, fixo, nivel, reseta, aoFechar, motor }) {
  const icDoAviso = () => (motor && MOTORES.includes(motor)) ? marcaDoMotor(motor) : ico(tipo === 'alerta' ? 'circle-help' : tipo === 'erro' ? 'x' : 'circle');
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
  if (typeof quadro !== 'undefined' && quadro) avisarNoQuadro(texto, tipo === 'erro' || tipo === 'alerta');   // a tarja fica atras do quadro
  // ja esta na tela: atualiza o texto em vez de empilhar outra tarja
  /* CSS.escape (como os outros dois call sites ja' fazem): o id vem de dado
     real. O das rotinas e' caminho + nome -- 'rotina-\BackupVPSHostinger' -- e
     dentro de um seletor CSS o '\B' vira 'B': o seletor nao casava com nada e
     disparar 3x empilhava 3 tarjas em vez de atualizar uma. */
  const existente = id && $('[data-aviso="' + CSS.escape(id) + '"]', caixa);
  if (existente) {
    const t = $('.avi-txt', existente);
    if (t) t.textContent = texto;
    existente.className = 'aviso aviso-' + (tipo || 'info');
    if (typeof nivel === 'number') existente.dataset.nivel = String(nivel);
    if (reseta) existente.dataset.reseta = String(reseta);
    const ic = $('.av-ic', existente);
    if (ic) ic.innerHTML = icDoAviso();
    // se agora tem acao e antes nao tinha, o botao precisa aparecer
    // o texto novo vem com acao nova: "usar" e o X tem que apontar pra ESTA chamada
    const btAntigo = $('.avi-acao', existente);
    if (acao) {
      const bt = btAntigo || document.createElement('button');
      bt.className = 'avi-acao';
      bt.textContent = acao;
      bt.onclick = () => { try { aoClicar && aoClicar(); } catch {} existente.remove(); };
      if (!btAntigo) existente.insertBefore(bt, $('.avi-x', existente));
    } else if (btAntigo) btAntigo.remove();
    const xAntigo = $('.avi-x', existente);
    if (xAntigo) xAntigo.onclick = () => { if (id) avisosFechados.set(id, { nivel: existente.dataset.nivel !== undefined ? Number(existente.dataset.nivel) : 0, reseta: existente.dataset.reseta !== undefined ? Number(existente.dataset.reseta) : 0 }); existente.remove(); if (aoFechar) { try { aoFechar(); } catch {} } };
    // aviso repetido (o do agente repete): o prazo de 20s recomeca, senao o
    // timer do primeiro apagava o segundo poucos segundos depois de aparecer
    if (!fixo) {
      clearTimeout(existente._t);
      existente._t = setTimeout(() => {
        if (id) avisosFechados.set(id, { nivel: existente.dataset.nivel !== undefined ? Number(existente.dataset.nivel) : 0, reseta: existente.dataset.reseta !== undefined ? Number(existente.dataset.reseta) : 0 });
        existente.remove();
      }, 20000);
    }
    return;
  }
  const d = document.createElement('div');
  d.className = 'aviso aviso-' + (tipo || 'info');
  if (id) d.dataset.aviso = id;
  d.innerHTML = '<span class="av-ic"></span><span class="avi-txt"></span>'
    + (acao ? '<button class="avi-acao"></button>' : '')
    + '<button class="avi-x"></button>';
  $('.av-ic', d).innerHTML = icDoAviso();
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
  $('.avi-x', d).onclick = () => { if (id) avisosFechados.set(id, comoEsta()); d.remove(); if (aoFechar) { try { aoFechar(); } catch {} } };
  caixa.appendChild(d);
  // some sozinho, mas NAO cala pra sempre: se o limite subir, avisa de novo
  if (!fixo) d._t = setTimeout(() => { if (id) avisosFechados.set(id, comoEsta()); d.remove(); }, 20000);
}

/* ---- ONDE mora a conta: este PC ou o servidor da aba ----
   Numa aba de servidor o painel do Claude roda o claude DE LA', com a
   credencial de la'. Ate' a leva 41 a tela so' conhecia a conta do PC: o
   /login numa aba da VPS logava o PC, o cartao e o medidor mostravam o PC e
   trocar a conta do PC derrubava ate' os paineis da VPS. Cada motor agora
   consulta a conta do destino da aba, incluindo sua porta SSH. */
const CONTA_NO_SERVIDOR = { claude: true, codex: true, gemini: true, grok: true, acp: true };
function servidorDaConta(engine, aba) { return CONTA_NO_SERVIDOR[engine] ? remotoDoAba(aba) : null; }
const chaveDoLugar = (r) => { if (!r) return 'pc'; const host = String(r.host || ''); return String(r.usuario || '') + '@' + (host.includes(':') ? '[' + host.replace(/^\[|\]$/g, '') + ']' : host) + (Number(r.porta ?? 22) !== 22 ? ':' + r.porta : ''); };
function lugarDaConta(engine, aba) {
  const r = servidorDaConta(engine, aba);
  return { remoto: r, chave: chaveDoLugar(r), rotulo: r ? ((aba && aba.nome) || 'Servidor') + ' · ' + chaveDoLugar(r) : ESTE_PC };
}
// a barra lateral segue a ABA ATIVA; a janela do painel segue a aba DO painel
const lugarDaContaAtiva = (engine) => lugarDaConta(engine, abaAtual());
const lugarDaContaDoPainel = (P) => lugarDaConta(P.engine, abaPorId(P.abaId));
// pedido pros canais de conta: sem 'remoto' e' o formato antigo (so' o motor)
function pedidoDeConta(engine, lugar, extra) {
  return (lugar && lugar.remoto) ? { engine, remoto: lugar.remoto, ...(extra || {}) } : (extra ? { engine, ...extra } : engine);
}
// paineis que usam a MESMA conta (desta aba e os de segundo plano de outras)
function paineisDaConta(engine, chave) {
  return [...panes.values(), ...panesFundo.values()]
    .filter((Q) => Q.engine === engine && lugarDaContaDoPainel(Q).chave === chave);
}
// um painel VISIVEL (o terminal de login abre dentro dele) do motor e do lugar certos
function painelParaConta(engine, chave) {
  const serve = (Q) => Q && !Q.morto && Q.engine === engine && lugarDaContaDoPainel(Q).chave === chave;
  if (serve(focusPane) && panes.get(focusPane.id) === focusPane) return focusPane;
  return [...panes.values()].find(serve) || null;
}
function semPainelDaConta(engine, lugar) {
  mostrarAviso({ texto: 'Abra um painel do ' + nomeDoMotor(engine) + (lugar.remoto ? ' na aba ' + lugar.rotulo : '') + ' para fazer isso.', tipo: 'info' });
}

function entrarNaContaDoLugar(engine, lugar) {
  const P = painelParaConta(engine, lugar.chave);
  if (!P) return semPainelDaConta(engine, lugar);
  setFocus(P); return contaAcao(P, 'login');
}
const operacoesDeConta = new Map();
const chaveDaOperacaoDeConta = (engine, lugar) => engine + ':' + lugar.chave;
function contaEmAlteracao(P) { return !!P && operacoesDeConta.has(chaveDaOperacaoDeConta(P.engine, lugarDaContaDoPainel(P))); }
function capacidadesDaConta(engine, lugar) {
  return window.api.contasDisponivel(pedidoDeConta(engine, lugar)).then((r) => r || {}).catch(() => ({ orientacao: 'Não foi possível verificar as ações desta conta. Tente novamente.' }));
}
function perfilDeContaUtilizavel(perfil) {
  return !!perfil && perfil.podeUsar !== false && !perfil.precisaLogin && perfil.estado !== 'login';
}
function escopoDaConta(lugar) { return lugar.remoto ? 'Servidor · ' + lugar.chave : 'Neste ' + ESTE_PC; }
async function prepararMudancaDaConta(engine, lugar, acao) {
  const chave = chaveDaOperacaoDeConta(engine, lugar);
  if (operacoesDeConta.has(chave)) throw new Error('Uma alteração desta conta já está em andamento. Conclua ou feche o terminal de conta.');
  const token = {};
  operacoesDeConta.set(chave, token);
  const liberar = () => { if (operacoesDeConta.get(chave) === token) operacoesDeConta.delete(chave); };
  try {
    const religados = await pararPaineisDaConta(engine, lugar, { acao });
    if (religados === null) { liberar(); return null; }
    if (engine === 'codex' && !lugar.remoto) {
      const r = await window.api.codexReiniciar();
      if (r?.error) throw new Error(r.error);
    }
    savePanes();
    return { religados, liberar };
  } catch (e) { liberar(); throw e; }
}
async function trocarContaGuardada(engine, lugar, perfil) {
  const capacidade = await capacidadesDaConta(engine, lugar);
  if (!capacidade.trocar) throw new Error(capacidade.orientacao || 'A troca de conta não está disponível neste destino.');
  if (!perfilDeContaUtilizavel(perfil)) throw new Error('Esta conta precisa de um novo login antes de ser usada.');
  const operacao = await prepararMudancaDaConta(engine, lugar, 'trocar');
  if (!operacao) return false;
  try {
    const r = await window.api.contasTrocar(pedidoDeConta(engine, lugar, { apelido: perfil.apelido }));
    if (!r?.ok) throw new Error(r?.error || 'Não foi possível confirmar a troca de conta.');
    await pintarCartaoConta(engine, true);
    carregarUsoSidebar(engine, true);
    mostrarAviso({ texto: 'Conta do ' + nomeDoMotor(engine) + ' em ' + escopoDaConta(lugar) + ' trocada para "' + perfil.apelido + '".' + (operacao.religados ? ' As conversas continuam na próxima mensagem.' : ''), tipo: 'info', motor: engine });
    return true;
  } catch (e) {
    throw new Error((e?.message || e) + (operacao.religados ? ' Os painéis foram parados; as conversas e os rascunhos foram preservados.' : ''));
  } finally { operacao.liberar(); }
}

/* Trocar/entrar numa conta: os paineis que usam ESSA conta param agora e
   religam na mesma conversa na proxima mensagem (um Claude vivo renova o token
   e reescreveria a credencial por cima da nova). So' os do mesmo lugar: trocar a
   conta do PC nao derruba painel da VPS, e trocar a da VPS so' mexe nos daquele
   usuario@host. Painel trabalhando so' para com o seu ok.
   Devolve quantos vao religar, ou null se voce desistiu. */
const MOTOR_DO_DEBATE = { claude: true, codex: true };   // os dois do debate (cockpit-debate.js)
async function pararPaineisDaConta(engine, lugar, opcoes) {
  opcoes = opcoes || {};
  const alvos = paineisDaConta(engine, lugar.chave).filter((Q) => !Q.morto);
  const ocupados = alvos.filter((Q) => Q.busy || Q.ligando);
  let debatesVivos = [];
  if (!lugar.remoto && MOTOR_DO_DEBATE[engine] && window.api.debateList) {
    const lista = await window.api.debateList();
    debatesVivos = Array.isArray(lista) ? lista.filter((d) => d?.status === 'running') : [];
  }
  const efeitos = [];
  if (ocupados.length) efeitos.push(ocupados.length + (ocupados.length === 1 ? ' painel em andamento será parado' : ' painéis em andamento serão parados'));
  if (debatesVivos.length) efeitos.push(debatesVivos.length + (debatesVivos.length === 1 ? ' debate em andamento será parado' : ' debates em andamento serão parados'));
  const sair = opcoes.acao === 'logout';
  if ((efeitos.length || sair) && !confirm((sair ? 'Sair da conta do ' : 'Alterar a conta do ') + nomeDoMotor(engine) + ' em ' + escopoDaConta(lugar) + '? '
      + (efeitos.length ? efeitos.join(' e ') + '. ' : '') + 'As conversas e os rascunhos serão preservados.'
      + (sair ? ' Todos os painéis que usam esta conta precisarão de um novo login.' : '') + ' Continuar?')) return null;
  // Cancelar a confirmação não altera retomadas, processos nem identidade.
  window.CockpitUI?.cancelResumesFor(engine, lugar.chave);
  for (const d of debatesVivos) {
    const r = await window.api.debateStop(d.id);
    if (r?.error) throw new Error(r.error);
  }
  let religados = 0;
  for (const Q of alvos) {
    const antes = antesDaTroca(Q), sessao = Q.sessaoId || Q.resumeId;
    const estavaLigado = Q.started || sessao;
    Q.uiContaGeracao = (Q.uiContaGeracao || 0) + 1;
    const r = await window.api.paneStop({ paneId: Q.id, engine: Q.engine });
    if (r === false || r?.error) throw new Error(r?.error || 'Não foi possível parar um painel desta conta.');
    if (Q.morto) continue;
    devolverFilaAoCampo(Q);
    destravarPainel(Q);
    avisarTroca(Q, antes, 'a conta');
    Q.resumeId = sessao; Q.sessaoId = null;
    if (estavaLigado) religados++;
    Q.started = false; Q.ligando = false; Q.busy = false;
    Q.uiInterrupted = !!antes.ocupado; Q.uiCompleted = false;
    setDot(Q, 'off');
  }
  return religados;
}

/* O motor do servidor pediu login ("Not logged in", "OAuth ... expired",
   "Please run /login"). Digitar /login ali levava pro login do PC -- e o erro
   voltava na mensagem seguinte, em loop. Numa aba de servidor vira tarja com o
   botao que entra NA conta do servidor. */
const PEDE_LOGIN = /not logged in|please run \/login|oauth (?:token|session)[^.\n]{0,40}expired|invalid api key|authentication_error/i;
const pedeLogin = (texto) => PEDE_LOGIN.test(String(texto || ''));
function avisarLoginDoServidor(P, texto) {
  if (!P || !pedeLogin(texto)) return false;
  const lugar = lugarDaContaDoPainel(P);
  /* Painel DESTE PC (leva 41, B2): antes o erro de conta aparecia como "a
     conexao caiu" e so'. Agora e' tarja com o botao que abre o login daqui. */
  if (!lugar.remoto) {
    mostrarAviso({
      id: 'login-pc-' + P.engine, tipo: 'erro', fixo: true,
      texto: 'Entre de novo na conta do ' + nomeDoMotor(P.engine) + ' neste ' + ESTE_PC + ': a entrada venceu ou saiu.',
      acao: 'Entrar de novo',
      aoClicar: () => {
        const Q = (!P.morto && panes.get(P.id) === P) ? P : painelParaConta(P.engine, lugar.chave);
        if (!Q) return semPainelDaConta(P.engine, lugar);
        setFocus(Q); contaAcao(Q, 'login');
      },
    });
    return true;
  }
  mostrarAviso({
    id: 'login-servidor-' + P.engine + '-' + lugar.chave, tipo: 'erro', fixo: true,
    texto: 'O ' + nomeDoMotor(P.engine) + ' do servidor ' + lugar.chave + ' está sem conta (ou a entrada venceu). O login é feito lá, não neste ' + ESTE_PC + '.',
    acao: 'Entrar na conta da VPS',
    aoClicar: () => {
      const Q = (!P.morto && panes.get(P.id) === P) ? P : painelParaConta(P.engine, lugar.chave);
      if (!Q) return semPainelDaConta(P.engine, lugar);
      setFocus(Q); contaAcao(Q, 'login');
    },
  });
  return true;
}

/* avisa quando o limite de uso esta perto do fim - o dado ja existia, so'
   nao chegava ate voce a nao ser que abrisse a lista de conversas */
function checarLimite(engine, c, lugar) {
  if (!c || !c.entrou) return;
  // conta do servidor tem limite proprio: aviso proprio, que diz de onde e'
  const onde = (lugar && lugar.remoto) ? '@' + lugar.chave : '';
  const nome = nomeDoMotor(engine) + (onde ? ' (' + lugar.chave + ')' : '');
  const sem = c.semana && c.semana.pct;
  const ses = c.sessao && c.sessao.pct;
  if (sem >= 80) {
    mostrarAviso({
      id: 'limite-semana-' + engine + onde, nivel: sem, reseta: c.semana.reseta, motor: engine,
      tipo: sem >= 95 ? 'erro' : 'alerta', fixo: true,
      texto: 'Você já usou ' + sem + '% do limite semanal do ' + nome
        + (c.semana.reseta ? ' · zera ' + quandoFuturo(c.semana.reseta) : ''),
      acao: 'ver conta',
      aoClicar: () => {
        const l = lugar || lugarDaContaAtiva(engine);
        const Q = painelParaConta(engine, l.chave);
        if (Q) janelaConta(Q); else semPainelDaConta(engine, l);
      },
    });
  }
  if (ses >= 90) {
    mostrarAviso({
      id: 'limite-sessao-' + engine + onde, nivel: ses, reseta: c.sessao.reseta, motor: engine,
      tipo: 'alerta',
      texto: 'Sessão do ' + nome + ' em ' + ses + '%' + (c.sessao.reseta ? ' · zera ' + quandoFuturo(c.sessao.reseta) : ''),
    });
  }
}

/* O botao "Entrar no X" do topo da coluna chamava contaAcao(focusPane) -- o
   motor do PAINEL EM FOCO, nao o da coluna. Com um painel do Gemini aberto,
   clicar em "Entrar no Grok" rodava o login do Gemini. Agora o login e' sempre
   do motor da coluna, e sem painel dele a tela diz isso em vez de errar calada. */
function entrarNaConta(engine) {
  // o cartao e' da ABA ATIVA: o painel tem de usar essa mesma conta (PC ou servidor)
  const P = painelParaConta(engine, lugarDaContaAtiva(engine).chave);
  if (P) { setFocus(P); contaAcao(P, 'login'); return; }
  const recado = 'Abra um painel do ' + nomeDoMotor(engine) + ' para entrar na conta dele.';
  if (focusPane) { note(focusPane, recado, true); return; }
  const box = caixaDoMotor('hist', engine);
  if (box) {
    box.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'hist-load';
    d.textContent = recado;
    box.appendChild(d);
  }
}

/* Rotulo "PC" / "VPS · usuario@host" no topo do cartao. So' aparece quando
   existe aba de servidor configurada: sem ela toda conta e' deste PC. */
const temAbaDeServidor = () => abasLocais().some((a) => a.tipo === 'ssh' && String(a.host || '').trim());
function marcarLugarNoCartao(alvo, lugar) {
  if (!temAbaDeServidor()) return;
  const d = document.createElement('div');
  d.className = 'ct-onde' + (lugar.remoto ? ' remoto' : '');
  d.innerHTML = lugar.remoto ? ico('server') : '';
  d.appendChild(document.createTextNode(lugar.rotulo));
  d.title = lugar.remoto
    ? 'Conta usada no servidor desta aba. Entrar, sair e trocar mexem lá, não neste ' + ESTE_PC + '.'
    : 'Conta deste ' + ESTE_PC + '.';
  alvo.insertBefore(d, alvo.firstChild);
}

/* ---- cartao da conta, no topo da lista de conversas ---- */
async function pintarCartaoConta(engine, fresco) {
  const alvo = caixaDoMotor('conta', engine);
  if (!alvo) return;
  // ler a conta demora (o do Claude tem prazo de 25s): se outra pintura comecar
  // no meio, esta aqui desiste em vez de empilhar botao repetido
  const geracao = (alvo._geracao = (alvo._geracao || 0) + 1);
  if (engine === 'acp') {
    // a conta e' do programa que cada painel escolher: nao ha' o que entrar ou trocar aqui
    alvo.innerHTML = '<div class="ct-fixo"></div>';
    $('.ct-fixo', alvo).textContent = 'A conta é a do próprio agente (Gemini, Claude Code, Codex…), a mesma que ele usa no terminal.';
    return;
  }
  // a conta mostrada e' a do lugar da ABA ATIVA (PC ou servidor)
  const lugar = lugarDaContaAtiva(engine);
  if (lugar.remoto && faltaConfigurarServidor(lugar.remoto)) {
    alvo.innerHTML = '<div class="ct-fixo"></div>';
    $('.ct-fixo', alvo).textContent = AVISO_ABA_EM_BRANCO;
    return;
  }
  let c = null;
  try { c = await window.api.contaLer(pedidoDeConta(engine, lugar, fresco ? { fresco: true } : null)); } catch {}
  if (geracao !== alvo._geracao) return;
  if (c && c.erro) {
    // servidor fora do ar NAO e' "voce nao entrou": o botao de login seria mentira
    alvo.innerHTML = '<div class="ct-fixo"></div><button class="ct-guardadas">Tentar de novo</button>';
    $('.ct-fixo', alvo).textContent = 'Não consegui ler a conta de ' + lugar.rotulo + '. ' + (c.motivo || '');
    $('.ct-guardadas', alvo).onclick = (e) => { e.stopPropagation(); pintarCartaoConta(engine, true); carregarUsoSidebar(engine, true); };
    marcarLugarNoCartao(alvo, lugar);
    return;
  }
  if (!c || !c.entrou) {
    alvo.innerHTML = '<button class="ct-entrar">' + marcaDoMotor(engine) + '<span>Entrar no ' + (nomeDoMotor(engine)) + '</span></button>';
    $('.ct-entrar', alvo).onclick = () => entrarNaConta(engine);
    marcarLugarNoCartao(alvo, lugar);
    // tem conta guardada? entao da' pra voltar pra ela sem refazer login
    try {
      const gs = await window.api.contasListar(pedidoDeConta(engine, lugar));
      if (geracao !== alvo._geracao) return;
      if (Array.isArray(gs) && gs.length) {
        const b = document.createElement('button');
        b.className = 'ct-guardadas';
        b.textContent = gs.length === 1 ? 'Usar a conta guardada' : 'Usar uma conta guardada';
        b.onclick = (e) => { e.stopPropagation(); menuContas(engine, b, null, lugar); };
        alvo.appendChild(b);
      }
    } catch {}
    return;
  }
  checarLimite(engine, c, lugar);
  const email = c.email || c.nome || '—';
  const inicial = (email.trim()[0] || '?').toUpperCase();
  alvo.innerHTML = '<button class="ct-bt">'
    + '<span class="ct-ini"></span>'
    + '<span class="ct-info"><span class="ct-email"></span><span class="ct-plano"></span></span>'
    + '<span class="ct-seta"></span></button>';
  $('.ct-ini', alvo).textContent = inicial;
  $('.ct-ini', alvo).style.background = 'var(--' + engine + ')';
  $('.ct-email', alvo).textContent = email;
  $('.ct-plano', alvo).textContent = [c.plano, c.via].filter(Boolean).join(' · ') || 'conectado';
  $('.ct-seta', alvo).innerHTML = ico('chevron-down');
  $('.ct-bt', alvo).title = email;
  $('.ct-bt', alvo).onclick = (e) => { e.stopPropagation(); menuContas(engine, $('.ct-bt', alvo), c, lugar); };
  marcarLugarNoCartao(alvo, lugar);
}

/* o popup precisa se pendurar em algo que NAO some quando o menu fecha */
function ancoraDoPainel(P) {
  return (P && P.el && ($('.p-model', P.el) || $('.p-head', P.el))) || (P && P.el) || document.body;
}

/* 'lugar' diz de QUAL conta e' o menu (PC ou servidor da aba). Sem ele, vale a
   aba ativa -- que e' a aba de qualquer painel visivel. */
async function menuContas(engine, ancora, c, lugar) {
  lugar = lugar || lugarDaContaAtiva(engine);
  if (lugar.remoto && faltaConfigurarServidor(lugar.remoto)) { mostrarAviso({ texto: AVISO_ABA_EM_BRANCO, tipo: 'erro' }); return; }
  const pop = abrirPopGlobal(ancora), pedido = {};
  pop._contaPedido = pedido;
  pop.textContent = 'Consultando ações da conta…';
  const atual = () => pop._contaPedido === pedido && !pop.classList.contains('hidden');
  const item = (texto, sub, icone, aoClicar, marcado) => {
    const d = document.createElement('div');
    d.className = 'mi' + (marcado ? ' on' : '');
    d.setAttribute('role', 'button'); d.tabIndex = 0;
    d.innerHTML = '<div class="mi-ic"></div><div class="mi-txt"><div class="mi-n"></div></div>'
      + (marcado ? '<div class="mi-ck">' + ico('check') + '</div>' : '');
    $('.mi-ic', d).innerHTML = ico(icone); $('.mi-n', d).textContent = texto;
    if (sub) { const n = document.createElement('div'); n.className = 'mi-d'; n.textContent = sub; $('.mi-txt', d).appendChild(n); }
    d.addEventListener('click', (e) => {
      e.stopPropagation(); fecharPopGlobal();
      Promise.resolve().then(aoClicar).catch((error) => mostrarAviso({ texto: error?.message || String(error), tipo: 'erro' }));
    });
    d.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); d.click(); } });
    return d;
  };
  try {
    const [capacidade, lista, conta] = await Promise.all([
      capacidadesDaConta(engine, lugar),
      window.api.contasListar(pedidoDeConta(engine, lugar)),
      c ? Promise.resolve(c) : window.api.contaLer(pedidoDeConta(engine, lugar)).catch(() => null),
    ]);
    if (!atual()) return;
    c = conta;
    const guardadas = Array.isArray(lista) ? lista : [];
    pop.replaceChildren();
    const cab = document.createElement('div'); cab.className = 'menu-secao'; cab.textContent = 'Conta do ' + nomeDoMotor(engine); cab.insertAdjacentHTML('afterbegin', marcaDoMotor(engine, 'marca-secao')); pop.appendChild(cab);
    const onde = document.createElement('div'); onde.className = 'menu-onde'; onde.textContent = escopoDaConta(lugar); pop.appendChild(onde);
    if (lista?.error) { const aviso = document.createElement('div'); aviso.className = 'menu-onde erro'; aviso.textContent = lista.error; pop.appendChild(aviso); }
    if (!capacidade.gerenciado) {
      const aviso = document.createElement('div'); aviso.className = 'menu-onde'; aviso.textContent = capacidade.orientacao || 'A gestão desta conta é feita no terminal do motor.'; pop.appendChild(aviso);
    }
    if (capacidade.trocar) for (const g of guardadas) {
      const utilizavel = perfilDeContaUtilizavel(g);
      pop.appendChild(item(g.atual ? g.apelido : utilizavel ? 'Usar ' + g.apelido : 'Entrar novamente · ' + g.apelido,
        g.atual ? 'em uso agora' : utilizavel ? 'continua as conversas com esta conta' : g.motivo || 'Faça o login e guarde novamente com este apelido.',
        utilizavel ? 'user' : 'key-round', () => g.atual ? undefined : utilizavel ? trocarContaGuardada(engine, lugar, g) : entrarNaContaDoLugar(engine, lugar), g.atual));
    }
    if (capacidade.salvar) pop.appendChild(item('Guardar a conta de agora…', c?.email || '', 'plus', () => {
      pedirTexto({ titulo: 'Guardar esta conta', dica: 'Dê um apelido. A cópia fica em ' + escopoDaConta(lugar) + '.', valor: (c?.email || '').split('@')[0], exemplo: 'ex.: pessoal, trabalho',
        aoConfirmar: async (apelido) => {
          try {
            const r = await window.api.contasSalvar(pedidoDeConta(engine, lugar, { apelido }));
            if (!r?.ok) throw new Error(r?.error || 'A conta não foi guardada.');
            mostrarAviso({ texto: 'Conta guardada como "' + apelido + '".', tipo: 'info' });
            window.CockpitUI?.refreshAccounts(true);
          } catch (e) { mostrarAviso({ texto: e?.message || String(e), tipo: 'erro' }); }
        },
      });
    }));
    if (capacidade.login) pop.appendChild(item('Entrar com outra conta', escopoDaConta(lugar), 'key-round', () => entrarNaContaDoLugar(engine, lugar)));
    if (capacidade.logout) pop.appendChild(item('Sair da conta', escopoDaConta(lugar), 'log-out', () => {
      const P = painelParaConta(engine, lugar.chave);
      if (!P) return semPainelDaConta(engine, lugar);
      setFocus(P); return contaAcao(P, 'logout');
    }));
    if (capacidade.trocar && guardadas.length) pop.appendChild(item('Esquecer uma conta guardada…', 'Apaga apenas a cópia guardada', 'x', () => {
      const cx = abrirModalGlobal();
      cx.innerHTML = '<div class="mo-top"><span class="mo-tit">Contas guardadas</span><button class="mo-x">' + ico('x') + '</button></div><div class="mo-sub">Esquecer a cópia guardada não desconecta a conta.</div><div class="mo-lista" id="lstContas"></div><div class="mo-rodape"><button class="mo-btn" id="ctFechar">Fechar</button></div>';
      $('.mo-x', cx).onclick = fecharModalGlobal; $('#ctFechar', cx).onclick = fecharModalGlobal;
      const lista = $('#lstContas', cx);
      const pintar = (itens) => {
        lista.replaceChildren();
        if (!itens.length) { lista.textContent = 'Nenhuma conta guardada.'; return; }
        for (const g of itens) {
          const linha = document.createElement('div'); linha.className = 'co';
          linha.innerHTML = '<span class="co-txt"><span class="co-n"></span></span><button class="co-bt">Esquecer</button>';
          $('.co-n', linha).textContent = g.apelido;
          $('.co-bt', linha).onclick = async () => {
            if (!confirm('Esquecer a cópia guardada "' + g.apelido + '" em ' + escopoDaConta(lugar) + '? A conta em uso continuará conectada.')) return;
            const bt = $('.co-bt', linha); bt.disabled = true;
            try {
              const r = await window.api.contasEsquecer(pedidoDeConta(engine, lugar, { apelido: g.apelido }));
              if (!r?.ok) throw new Error(r?.error || 'Não foi possível esquecer a conta.');
              const novas = await window.api.contasListar(pedidoDeConta(engine, lugar));
              if (!Array.isArray(novas)) throw new Error(novas?.error || 'Não foi possível atualizar a lista.');
              pintar(novas); window.CockpitUI?.refreshAccounts(true);
            } catch (e) { mostrarAviso({ texto: e?.message || String(e), tipo: 'erro' }); }
            finally { bt.disabled = false; }
          };
          lista.appendChild(linha);
        }
      };
      pintar(guardadas);
    }));
    requestAnimationFrame(() => {
      if (!atual()) return;
      const r = ancora.getBoundingClientRect(), alt = pop.getBoundingClientRect().height;
      if (r.bottom + alt + 6 > window.innerHeight - 10) pop.style.top = Math.max(10, r.top - alt - 6) + 'px';
    });
  } catch (e) {
    if (atual()) pop.textContent = 'Não foi possível consultar as contas: ' + (e?.message || e);
  }
}

/* ---- completar caminho de arquivo com "@" ---- */
let buscaArqTimer = 0;
/* Geracao da busca. No servidor a resposta demora e pode chegar DEPOIS da tecla
   seguinte -- sem isto a lista velha pintava por cima da nova. */
let buscaArqGen = 0;
/* Tirou o "@" do campo: a busca que ainda estava voltando do servidor nao pode
   abrir o menu segundos depois. No local a busca e' instantanea e o caminho
   segue exatamente como antes (esta funcao nao faz nada). */
/* Para a busca de arquivo do "@" que ainda esta' em voo. Vale nos DOIS ramos:
   o temporizador e' de 140 ms no disco e de 450 ms no servidor, e nos dois ele
   pode acordar depois de o campo ter sido limpo -- ai o menu de arquivos abre
   sozinho por cima do que ja' esta' acontecendo na tela. */
/* O miolo do cancelamento, sem tocar na tela. Separado de proposito: o
   pararBuscaDeArquivos fecha menu, e fechar menu chama o cancelamento de volta
   -- em circulo. O fecharMenus usa ESTE. */
function pararBuscaEmVoo() {
  clearTimeout(buscaArqTimer);
  buscaArqGen++;
}
function pararBuscaDeArquivos(P) {
  if (!P) return;
  pararBuscaEmVoo();
  // o "procurando…" pode ja' estar na tela: some junto, senao ficava pra sempre
  if ($('.menu-arquivos', P.el)) fecharMenus();
}
/* Chamado pelo ouvinte de 'input' quando o "@" some do texto. No ramo local
   quem fecha o menu e' o proprio call site, entao aqui ele segue sem efeito -
   o comportamento no disco continua byte por byte o de sempre. */
function cancelarBuscaArquivos(P) {
  if (!P || !remotoDoPane(P)) return;
  pararBuscaDeArquivos(P);
}
/* solta o atalho de setas do menu de arquivos. Se ficar preso, ele engole o
   Enter do campo e a mensagem nunca e' enviada. */
function soltarNavArquivos(P) {
  if (P && P._navArq && P._navArqInp) {
    try { P._navArqInp.removeEventListener('keydown', P._navArq, true); } catch {}
  }
  if (P) { P._navArq = null; P._navArqInp = null; }
}
/* Uma caixinha de "Arquivos" so' com um recado dentro (procurando / deu erro).
   Vale so' pro ramo remoto: no local a lista chega antes de dar tempo de ler. */
function recadoDeArquivos(P, texto, ehErro) {
  const m = novoMenu(P);
  m.classList.add('menu-arquivos');
  m.appendChild(tituloPopup('Arquivos'));
  const s = subPopup(texto);
  if (ehErro) s.classList.add('erro');
  m.appendChild(s);
}
/* A janelinha do painel (.p-modal) e' UMA so': o terminal do "Entrar na
   conta", os conectores, a conta e o diff do git moram nela tambem. Uma
   resposta atrasada da busca so' pode escrever ali se a janelinha estiver
   fechada ou se ainda for o menu ('como-menu'). Sem esta conferencia ela
   apagava o conteudo de quem tinha ocupado o lugar no meio-tempo. */
function janelinhaOcupada(P) {
  const m = P && P.el && $('.p-modal', P.el);
  if (!m || !m.classList) return false;
  if (m.classList.contains('hidden')) return false;
  return !m.classList.contains('como-menu');
}
async function menuArquivos(P, termo, posArroba) {
  const remoto = remotoDoPane(P);
  clearTimeout(buscaArqTimer);
  const meuGen = ++buscaArqGen;
  buscaArqTimer = setTimeout(async () => {
    if (meuGen !== buscaArqGen) return;
    if (janelinhaOcupada(P)) return;   // a janelinha virou terminal/conta/diff: nao e' mais nossa
    // aba de servidor em branco: sem isso o pedido cairia no disco DESTE PC calado
    if (faltaConfigurarServidor(remoto)) { recadoDeArquivos(P, AVISO_ABA_EM_BRANCO, true); return; }
    // no servidor a ida e volta demora: avisa que esta procurando, senao parece travado
    if (remoto) recadoDeArquivos(P, 'Procurando em ' + (remoto.usuario || '') + '@' + (remoto.host || '') + '…');
    let itens = [], erro = '';
    try {
      const r = await window.api.buscarArquivos({ cwd: P.cwd, termo, remoto: remoto || undefined });
      /* As DUAS formas, de proposito: o ramo LOCAL devolve a lista crua (como
         sempre) e o REMOTO devolve { itens, error } -- porque falha de rede nao
         pode virar "essa pasta nao tem arquivo nenhum". */
      if (Array.isArray(r)) itens = r;
      else if (r && typeof r === 'object') { itens = Array.isArray(r.itens) ? r.itens : []; erro = r.error || ''; }
    } catch (e) { erro = 'Não consegui buscar os arquivos: ' + ((e && e.message) || e); }
    if (meuGen !== buscaArqGen) return;   // outra tecla ja' pediu uma busca mais nova
    if (janelinhaOcupada(P)) return;      // enquanto o SSH voltava, a janelinha virou outra coisa
    // rede fora aparece como MOTIVO no lugar da lista; fechar calado parecia travamento
    if (erro) { recadoDeArquivos(P, erro, true); return; }
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
        /* auditoria 2: este ouvinte e o do campo (que para a IA com Esc) moram no
           MESMO elemento -- stopPropagation nao segura o outro. Sem o Immediate, o
           Esc fechava o menu aqui e o do campo, ja' sem menu aberto, parava a IA. */
        ev.stopImmediatePropagation(); ev.preventDefault();
        fecharMenus(); soltarNavArquivos(P);
      }
    };
    P._navArq = nav; P._navArqInp = inp;
    inp.addEventListener('keydown', nav, true);
    // 140 ms e' o tempo de varrer um disco; por SSH cada tecla viraria uma
    // conexao, entao no remoto a espera sobe e a tela avisa que esta procurando
  }, remoto ? 450 : 140);
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
  const inp = $('.p-input', P.el);
  if (inp) inp.focus({ preventScroll: true });
  try {
    const area = $('#panes');
    const painel = P.el.getBoundingClientRect();
    const limites = area.getBoundingClientRect();
    // Rolagem determinística: animação smooth pode ser cancelada pelo foco do campo.
    if (painel.right > limites.right) area.scrollLeft += painel.right - limites.right;
    else if (painel.left < limites.left) area.scrollLeft -= limites.left - painel.left;
    P.el.scrollIntoView({ behavior: 'instant', inline: 'nearest', block: 'nearest' });
  } catch {}
}

function painelVisivel(P) {
  if (quadro) return false;   // o quadro cobre a tela inteira: todo painel esta' fora de vista
  try {
    const r = P.el.getBoundingClientRect();
    const caixa = $('#panes').getBoundingClientRect();
    const naLargura = r.right > caixa.left + 40 && r.left < caixa.right - 40;
    // empilhado e espremido conta como "fora de vista": voce nao consegue ler
    // o que aconteceu num painel de 30px de altura
    return naLargura && r.height > 160;
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
    if (quadro) fecharQuadro();   // o quadro cobre tudo: fecha antes de levar ate' o painel
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
  // no worktree o chip mostra a branch isolada (a pasta nasce na 1a mensagem)
  const pastaGit = cwdGitDoPainel(P);
  try { g = await window.api.gitStatus({ cwd: pastaGit }); } catch {}
  if (!g || !g.branch) {
    if (P.worktree) { chip.classList.remove('hidden'); chip.textContent = '⎇ ' + P.worktree + ' (a criar)'; chip.title = 'O worktree nasce na primeira mensagem'; chip.onclick = null; }
    else chip.classList.add('hidden');
    return;
  }
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
        try { texto = await window.api.gitDiff({ cwd: pastaGit, arquivo: arq.nome }); } catch {}
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

/* Fecha o terminal do painel SEM avisar quem o abriu.
   O "aoFechar" existe pra reagir ao fim do trabalho (religar na conta nova,
   voltar pra lista de conectores). Quando so' estamos dando lugar a um terminal
   NOVO, disparar isso apaga a janelinha recem-criada e ainda escreve na tela que
   a conta foi trocada -- sem login nenhum ter acontecido. */
function fecharTerminalEmSilencio(P) {
  if (!P || !P._fecharTerm) return;
  const f = P._fecharTerm; P._fecharTerm = null;
  P._semAvisar = true;
  try { f(); } finally { P._semAvisar = false; }
}
function fecharModal(P) {
  // matar o terminal e' decisao de quem fecha, nao efeito colateral de esconder
  // a caixa: o Esc global fecha a caixa de TODOS os paineis de uma vez
  const m = $('.p-modal', P.el);
  m.classList.add('hidden'); $('.modal-cx', m).innerHTML = '';
}

/* texto de fora (nome de App, recado de erro da API) nunca entra cru no HTML */
function escHtml(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function janelaConectores(P) {
  fecharMenus();
  fecharTerminalDoPainel(P);
  const modal = $('.p-modal', P.el);
  const cx = $('.modal-cx', modal);
  modal.classList.remove('hidden');
  modal.onclick = (e) => { if (e.target === modal) fecharModal(P); };
  cx.onclick = (e) => e.stopPropagation();

  const motor = nomeDoMotor(P.engine);
  const cabeca = () =>
    '<div class="mo-top"><span class="mo-tit">' + marcaDoMotor(P.engine, 'marca-tit') + 'Conectores</span><button class="mo-x">' + ico('x') + '</button></div>'
    + '<div class="mo-sub">Serviços ligados ao ' + motor + ' neste ' + ESTE_PC + '.</div>';

  cx.innerHTML = cabeca() + '<div class="mo-carregando">Verificando conectores…</div>';
  $('.mo-x', cx).onclick = () => fecharModal(P);

  /* No Codex sao DUAS coisas diferentes na mesma tela: os Apps do ChatGPT (que
     vivem na conta e valem em qualquer maquina) e os conectores MCP que rodam
     aqui no PC. As duas chamadas vao juntas pra tela nao abrir em dois tempos. */
  const [lista, appsR] = await Promise.all([
    window.api.mcpList({ engine: P.engine, paneId: P.id, remoto: remotoDoPane(P) }),
    P.engine === 'codex' && window.api.codexApps
      ? window.api.codexApps(remotoDoPane(P)).catch(() => null)
      : Promise.resolve(null),
  ]);
  if (!modal || modal.classList.contains('hidden')) return;

  const apps = (appsR && Array.isArray(appsR.apps)) ? appsR.apps : [];
  const blocoApps = () => {
    if (!appsR) return '';
    const cabecaApps = '<div class="mo-sec">Apps do ChatGPT<span class="mo-sec-d">valem na sua conta, em qualquer computador</span></div>';
    if (appsR.error) return cabecaApps + '<div class="mo-erro">' + escHtml(appsR.error) + '</div>';
    if (!apps.length) return cabecaApps + '<div class="mo-carregando">Nenhum App por enquanto.</div>';
    const linhas = apps.map((a, i) => {
      /* amarelo e' "precisa de voce" (a lista de MCP usa a mesma cor pra
         "precisa entrar"): App desligado de proposito e' cinza, nao amarelo */
      /* amarelo so' quando ha' o que voce possa fazer (como "precisa entrar" na
         lista de MCP). App ligado que simplesmente nao expoe ferramenta nenhuma
         nao e' problema seu: fica cinza, com o texto explicando. */
      const classe = a.chamavel ? 'ok' : 'off';
      // sem acesso na conta, "Instalar" so' leva a uma pagina que nao resolve
      const podeInstalar = a.acessivel && !a.instalado && a.installUrl;
      return '<div class="co ap" data-i="' + i + '">'
        + '<span class="co-pt ' + classe + '"></span>'
        + '<span class="co-txt"><span class="co-n"></span><span class="co-s"></span></span>'
        + (podeInstalar ? '<button class="co-bt destaque" data-ac="instalar">Instalar</button>' : '')
        + '</div>';
    }).join('');
    return cabecaApps
      + (appsR.aviso ? '<div class="mo-dica">' + escHtml(appsR.aviso) + '</div>' : '')
      + '<div class="mo-lista">' + linhas + '</div>';
  };
  const ligarApps = () => {
    $$('.co.ap', cx).forEach((el) => {
      const a = apps[Number(el.dataset.i)];
      if (!a) return;
      $('.co-n', el).textContent = a.nome;
      $('.co-s', el).textContent = a.status;
      el.title = a.desc || a.nome;
      const bt = $('.co-bt', el);
      if (bt) bt.onclick = () => window.api.abrirLink(a.installUrl);
    });
  };

  if (lista && lista.error) {
    /* o erro dos conectores locais nao pode apagar os Apps que carregaram bem,
       nem sumir com o rodape - senao a tela fica sem "Atualizar" e sem saida.
       E o texto vem de fora (mensagem do CLI): entra escapado. */
    cx.innerHTML = cabeca()
      + blocoApps()
      + (appsR ? '<div class="mo-sec">Conectores deste ' + ESTE_PC + '<span class="mo-sec-d">MCP instalados aqui</span></div>' : '')
      + '<div class="mo-erro">' + escHtml(lista.error) + '</div>'
      /* "Adicionar conector" fica MESMO no erro: quando a lista falha por nao
         haver nada configurado, adicionar e' justamente o que resolve - sem o
         botao o "Atualizar" so' repete o mesmo erro, em circulo */
      + '<div class="mo-rodape"><button class="mo-btn destaque" id="btAdd">Adicionar conector</button>'
      + '<button class="mo-btn" id="btRe">Atualizar</button></div>';
    $('.mo-x', cx).onclick = () => fecharModal(P);
    ligarApps();
    $('#btRe', cx).onclick = () => janelaConectores(P);
    $('#btAdd', cx).onclick = () => formConector(P);
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
      + blocoApps()
      + (appsR ? '<div class="mo-sec">Conectores deste ' + ESTE_PC + '<span class="mo-sec-d">MCP instalados aqui</span></div>' : '')
      + '<div class="mo-lista">' + (linhas || '<div class="mo-carregando">Nenhum conector ainda.</div>') + '</div>'
      + '<div class="mo-rodape"><button class="mo-btn destaque" id="btAdd">Adicionar conector</button>'
      + '<button class="mo-btn" id="btRe">Atualizar</button></div>';
    $('.mo-x', cx).onclick = () => fecharModal(P);
    ligarApps();
    // ":not(.ap)" e' essencial: sem isso as linhas dos Apps entravam neste laco
    // e o data-i delas apontava pro conector MCP errado
    $$('.co:not(.ap)', cx).forEach((el) => {
      const c = arr[Number(el.dataset.i)];
      $('.co-n', el).textContent = nomeLimpo(c.nome);
      $('.co-s', el).textContent = c.precisaEntrar ? 'precisa entrar' : c.status;
      el.title = c.nome + (c.alvo ? '\n' + c.alvo : '');
      $$('.co-bt', el).forEach(bt => bt.onclick = async () => {
        const ac = bt.dataset.ac;
        if (ac === 'remove' && !confirm('Tirar o conector "' + c.nome + '" do ' + motor + '?')) return;
        bt.textContent = '…';
        const r = await window.api.mcpAcao({ engine: P.engine, paneId: P.id, remoto: remotoDoPane(P), acao: ac, nome: c.nome });
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
  const motor = nomeDoMotor(P.engine);
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
    const r = await window.api.mcpAcao({ engine: P.engine, paneId: P.id, remoto: remotoDoPane(P), acao: 'add', nome, url, comando });
    if (r && r.error) { erro.style.display = 'block'; erro.textContent = r.error; $('#cnOk', cx).textContent = 'Tentar de novo'; return; }
    fecharModal(P);
    avisoTemp(P, 'Conector "' + nome + '" adicionado. Vale na próxima conversa deste painel.');
    await window.api.paneStop({ paneId: P.id, engine: P.engine });
    if (P.morto) return;
    guardarConversaPraVoltar(P);
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
    /* host, usuario e chave vao pra uma linha que o cmd.exe executa: sem
       conferir, um deles com aspas ou "&" roda comando LOCAL no PC em vez de
       conectar. Nome de maquina e de usuario nao tem esses caracteres. */
    // nao pode COMECAR com "-": o ssh leria como opcao (-o ProxyCommand=...)
    const simples = (s) => /^[A-Za-z0-9._@:][A-Za-z0-9._@:-]*$/.test(String(s || ''));
    if (!simples(remoto.usuario) || !simples(remoto.host)) return null;
    const porta = Number(remoto.porta ?? 22);
    if (!Number.isInteger(porta) || porta < 1 || porta > 65535) return null;
    const chave = String(remoto.chave || '');
    if (/["`\r\n%]/.test(chave)) return null;   // o cmd expande %VAR% aqui tambem
    // o caminho vai pra MESMA linha: uma aspa dupla fecha o bloco do cmd.exe e o
    // que vier depois roda no PC, nao no servidor. E "%VAR%" o cmd expande antes.
    if (/["`\r\n%]/.test(p)) return null;
    const alvo = remoto.usuario + '@' + remoto.host;
    return 'ssh -t -p ' + porta + ' -i "' + chave + '" -o StrictHostKeyChecking=accept-new ' + alvo + ' "' + cd + ' || exit 1; exec \$SHELL -l"';
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
// sem caracteres de controle: um BEL/SI grudado no fim nao entra no link
const REG_LINK = /https?:\/\/[^\s\x00-\x1f"'<>)\]]+/g;

window.api.onTermEvent(({ id, kind, data, code }) => {
  const t = termsVivos.get(id);
  if (!t) return;
  if (kind === 'data') { t.term.write(data); t.viu(data); }
  if (kind === 'exit') {
    t.vivo = false; t.exitCode = Number.isInteger(code) ? code : null;
    t.onExit?.({ code: t.exitCode, cancelled: !!t.cancelled });
    t.term.write('\r\n\x1b[90m— terminou' + (Number.isInteger(code) ? ' (código ' + code + ')' : ', código não informado') + ' —\x1b[0m\r\n');
    /* solta o painel. Enquanto o id continuava em P.terms, o motor era
       considerado ocupado e NUNCA desligava -- nem no fim do turno, nem ao sair
       da aba. Um painel esquecido assim segura o claude vivo (centenas de MB)
       pelo resto do dia. A janela do terminal continua na tela pra leitura. */
    for (const P of [...panes.values(), ...panesFundo.values()]) {
      if (!P.terms || !P.terms.delete(id)) continue;
      // lembra que este terminal foi deste painel: o closePane ainda precisa
      // soltar o xterm, que continua na tela pra leitura
      (P.termsMortos = P.termsMortos || new Set()).add(id);
    }
  }
});

/* Ajusta o terminal ao tamanho real da caixa. Sem isto ele fica fixo em 92
   colunas: com 3 paineis lado a lado, metade do texto cai fora e nao ha rolagem
   -- inclusive o link e o codigo do "claude /login". */
function ajustarTerminal(t, caixa) {
  if (!t || !t.term || !caixa) return;
  const larg = caixa.clientWidth, alt = caixa.clientHeight;
  if (!larg || !alt) return;
  // medida de um caractere: o xterm usa fonte monoespacada
  const cw = (t.term._core && t.term._core._renderService && t.term._core._renderService.dimensions
    && t.term._core._renderService.dimensions.css
    && t.term._core._renderService.dimensions.css.cell) || null;
  const larguraCar = (cw && cw.width) || 7.03;
  const alturaCar = (cw && cw.height) || 17;
  const cols = Math.max(20, Math.floor((larg - 16) / larguraCar));
  const rows = Math.max(6, Math.floor((alt - 12) / alturaCar));
  if (t.cols === cols && t.rows === rows) return;
  t.cols = cols; t.rows = rows;
  try { t.term.resize(cols, rows); } catch {}
  try { window.api.termResize({ id: t.id, cols, rows }); } catch {}
}

/* ---- colar e copiar no terminal embutido (leva 41.1) ----
   O "claude auth login" na VPS pede pra COLAR o codigo que o site mostra. No
   Windows o Ctrl+V chegava no programa como ^V: o xterm transforma Ctrl+letra
   em caractere de controle e da preventDefault, entao nem o paste do navegador
   nem o Colar do menu Editar aconteciam, e o botao direito nao fazia nada.
   Agora Ctrl+V / Ctrl+Shift+V / Shift+Insert e o botao direito leem a area de
   transferencia e colam por UM caminho so' (term.paste, que respeita o
   bracketed paste). O preventDefault impede o navegador de colar de novo. */
function teclaDeColarOuCopiar(e, temSelecao, ehWin) {
  if (!e || e.type !== 'keydown' || e.altKey || e.metaKey) return null;
  if (e.shiftKey && !e.ctrlKey && (e.code === 'Insert' || e.key === 'Insert')) return 'colar';
  // no Mac o Ctrl+V do terminal e' ^V de verdade; la' cola com Cmd+V, que o xterm ja trata
  if (!e.ctrlKey || !ehWin) return null;
  /* vale a LETRA do layout (no Dvorak a tecla fisica do V escreve "k");
     a tecla fisica so' quando a letra nao e' latina (cirilico, grego...) */
  const k = String(e.key || '').toLowerCase();
  const letra = /^[a-z]$/.test(k) ? k : (/^Key[A-Z]$/.test(e.code || '') ? e.code.slice(3).toLowerCase() : '');
  if (letra === 'v') return 'colar';
  // sem selecao o Ctrl+C segue sendo "parar" (^C) pro programa
  if (letra === 'c' && temSelecao) return 'copiar';
  return null;
}
/* Programa que nao ligou o bracketed paste (pwsh, cmd) executa cada linha
   colada na hora. Devolve quantas linhas pedem confirmacao (0 = cola direto).
   Quebra so' no fim nao conta: e' uma linha. */
function linhasQuePedemConfirmacao(texto, bracketed) {
  if (bracketed) return 0;
  const n = String(texto || '').replace(/(?:\r\n|\r|\n)$/, '').split(/\r\n|\r|\n/).length;
  return n > 1 ? n : 0;
}
// o botao Colar e' pro codigo do login: quebra de linha no fim viraria Enter antes da hora
function textoParaColar(texto, ehCodigo) {
  const t = String(texto == null ? '' : texto);
  return ehCodigo ? t.trim() : t;
}
// paste que nasce dentro do terminal e' do terminal, nao vira anexo do painel
function pasteDoTerminal(e) {
  const alvo = e && e.target;
  return !!(alvo && typeof alvo.closest === 'function' && alvo.closest('.cx-term'));
}
async function colarNoTerminal(term, ehCodigo, avisar) {
  const aviso = (m) => { try { avisar && avisar(m); } catch {} };
  let r = null;
  try { r = await window.api.textoCopiado(); } catch {}
  if (r && r.erro === 'grande') { aviso('O texto copiado é grande demais pra colar aqui (mais de 1 MB).'); return false; }
  const t = textoParaColar(r && r.texto, ehCodigo);
  // imagem ou arquivo copiado: nao tem texto
  if (!t) { aviso('Não tem texto copiado pra colar.'); return false; }
  let bracketed = false;
  try { bracketed = !!(term.modes && term.modes.bracketedPasteMode); } catch {}
  const n = linhasQuePedemConfirmacao(t, bracketed);
  if (n && !(await confirmarNoApp('Colar ' + n + ' linhas?', 'Cada linha roda como comando, na hora.', 'Colar'))) {
    try { term.focus(); } catch {}
    return false;
  }
  try { term.paste(t); term.focus(); } catch { return false; }   // o terminal pode ter fechado no meio
  return true;
}
function copiarDoTerminal(term) {
  const t = term.getSelection();
  term.clearSelection();
  if (t) Promise.resolve(window.api.copiarTexto(t)).catch(() => {});
  return !!t;
}
/* O ConPTY (Windows) redesenha a saida: troca quebra de linha por "mover o
   cursor" (ESC[6;1H) e esconde/mostra o cursor no meio. Lido cru, o link do
   login engolia isso e o "Abrir link" abria "...state=abc<ESC>[6;1HPaste".
   Aqui as sequencias somem; as que mudam a posicao viram espaco. */
function textoVisivelDoTerminal(s) {
  return String(s || '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')                 // OSC (titulo da janela)
    .replace(/\x1bP[\s\S]*?\x1b\\/g, '')                                // DCS
    // CSI com qualquer parametro: ESC[>4;2m, ESC[<u, cor com dois-pontos
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, (m) => (/[A-HJKSTXdf]$/.test(m) ? ' ' : ''))
    .replace(/\x1b[()][0-9A-Za-z]|\x1b[=>78]/g, '');
}

function janelaTerminal(P, linha, titulo, aoFechar, opcoes) {
  opcoes = opcoes || {};
  fecharMenus();

  if (!linha) {
    const r = remotoDoPane(P);
    const vazio = r && (!String(r.usuario || '').trim() || !String(r.host || '').trim());
    mostrarAviso({
      texto: vazio
        ? 'Esta aba ainda não tem servidor configurado — preencha usuário, host e chave em Editar aba.'
        : 'Um dos campos desta aba (usuário, host, chave ou pasta no servidor) tem caractere que não pode entrar num comando — normalmente aspas ou %. Confira em Editar aba.',
      tipo: 'erro',
    });
    return;
  }
  /* O terminal anterior deste painel sai AGORA, antes do novo nascer. Fechar
     depois de montar matava o terminal NOVO: P._fecharTerm ja apontava pra ele,
     entao o fechamento "em silencio" dava dispose no xterm recem-criado e o
     tirava de termsVivos -- o comando ate rodava, mas nada mais chegava na tela.
     Era isso que deixava o "Entrar na conta" com a telinha preta vazia. */
  fecharTerminalEmSilencio(P);

  const modal = $('.p-modal', P.el), cx = $('.modal-cx', modal);
  modal.classList.remove('hidden');
  cx.className = 'modal-cx cx-term';
  cx.onclick = (e) => e.stopPropagation();

  const id = 't' + bootId + '_' + (++termSeq);
  if (!P.terms) P.terms = new Set();
  P.terms.add(id);
  cx.innerHTML =
    '<div class="mo-top"><span class="mo-tit"></span><button class="mo-x">' + ico('x') + '</button></div>'
    + '<div class="mo-sub">Rodando aqui dentro do Cockpit. Se o site mostrar um código, copie e clique em Colar (ou Ctrl+V na tela preta). Para escolher algo, clique na tela preta e digite.</div>'
    + '<div class="term-wrap"><div class="term-tela"></div></div>'
    + '<div class="term-link"><span class="mono"></span><button class="term-abrir">Abrir link</button>'
    + '<span class="term-aviso" aria-live="polite"></span>'
    + '<button class="term-colar" title="Cole aqui o código que o site mostrou">Colar</button></div>'
    + (opcoes.login ? '<form class="term-code-form"><label for="code-' + id + '">Código de login</label><div><input id="code-' + id + '" class="term-code-input" type="text" autocomplete="off" spellcheck="false" placeholder="Cole o código aqui"><button type="submit" class="mo-btn destaque">Enviar</button></div></form>' : '')
    + '<div class="mo-rodape"><button class="mo-btn" id="tmCancela">Cancelar</button>'
    + '<button class="mo-btn destaque" id="tmFecha">Fechar</button></div>';
  $('.mo-tit', cx).textContent = titulo || 'Terminal';
  if (opcoes.login) $('.mo-sub', cx).textContent = 'Abra o link, copie o código mostrado pelo site e cole no campo Código de login. Clique em Enviar para continuar.';

  const term = new Terminal({
    cols: 92, rows: 22, fontSize: 12, lineHeight: 1.25, cursorBlink: true, scrollback: 4000,
    // no Mac o xterm marcava a palavra antes do nosso botao direito: ele copiava sempre em vez de colar
    rightClickSelectsWord: false,
    fontFamily: '"Cascadia Mono", Consolas, ui-monospace, SFMono-Regular, Menlo, monospace',
    theme: { background: '#141416', foreground: '#dcdcdc', cursor: '#d8bd8a', selectionBackground: '#ffffff30' },
  });
  // aviso curto na barra do terminal (nada copiado, texto grande demais)
  let prazoAviso = 0;
  const avisarTerm = (msg) => {
    const a = $('.term-aviso', cx);
    if (!a) return;
    a.textContent = msg;
    clearTimeout(prazoAviso);
    prazoAviso = setTimeout(() => { a.textContent = ''; }, 5000);
  };
  const telaTerm = $('.term-tela', cx);
  term.open(telaTerm);
  term.onData((d) => {
    Promise.resolve(window.api.termInput({ id, data: d })).then(r => {
      if (r?.error) avisarTerm('O terminal não recebeu o texto: ' + r.error);
    }).catch(() => avisarTerm('Não foi possível enviar ao terminal.'));
  });
  term.attachCustomKeyEventHandler((e) => {
    const acao = teclaDeColarOuCopiar(e, term.hasSelection(), EH_WIN);
    if (!acao) return true;
    e.preventDefault();
    if (acao === 'colar') colarNoTerminal(term, false, avisarTerm); else copiarDoTerminal(term);
    return false;
  });
  // botao direito como no Windows Terminal: com selecao copia, sem selecao cola
  telaTerm.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (term.hasSelection()) copiarDoTerminal(term); else colarNoTerminal(term, false, avisarTerm);
  });

  const elLink = $('.term-link', cx), txtLink = $('.mono', elLink);
  const reg = {
    id, term, buf: '', vivo: true, exitCode: null, cancelled: false, onExit: opcoes.onExit, onDiscard: opcoes.onDiscard,   // sem o id, o redimensionamento nao chegava no pty
    viu(d) {
      this.buf = (this.buf + d).slice(-8000);
      const achou = textoVisivelDoTerminal(this.buf).match(REG_LINK);
      if (!achou) return;
      const u = achou[achou.length - 1].replace(/[.,;]+$/, '');
      if (txtLink.textContent === u) return;
      txtLink.textContent = u; elLink.classList.add('ver');
    },
  };
  termsVivos.set(id, reg);
  $('.term-abrir', elLink).onclick = () => window.api.openUrl(txtLink.textContent);
  const codeForm = opcoes.login ? $('.term-code-form', cx) : null, codeInput = opcoes.login ? $('.term-code-input', cx) : null;
  if (codeForm) {
    codeForm.addEventListener('submit', async e => {
      e.preventDefault(); e.stopPropagation();
      if (!reg.vivo || reg.runError) { avisarTerm('Este terminal já encerrou. Abra o login novamente.'); return; }
      const code = codeInput.value.trim();
      if (!code || /[\x00-\x20\x7f]/.test(code)) { avisarTerm('Cole somente o código de login, sem espaços ou quebras de linha.'); codeInput.focus(); return; }
      const send = $('button', codeForm);
      if (send.disabled) return;
      send.disabled = true;
      try {
        const result = await window.api.termInput({ id, data: code + '\r' });
        if (result?.error) throw new Error(result.error);
        codeInput.value = '';
        avisarTerm('Código enviado. Aguarde a confirmação do login.');
        term.focus();
      } catch { avisarTerm('O terminal não recebeu o código. Confira se o login ainda está aberto.'); }
      finally { send.disabled = false; }
    });
  }
  $('.term-colar', elLink).onclick = async () => {
    if (!codeInput) return colarNoTerminal(term, true, avisarTerm);
    try {
      const result = await window.api.textoCopiado();
      if (!result?.texto) { avisarTerm('Não tem texto copiado para colar.'); return; }
      codeInput.value = result.texto.trim(); codeInput.focus();
    } catch { avisarTerm('Cole o código diretamente no campo com Ctrl+V.'); }
  };

  let fechado = false;
  const fechar = () => {
    if (fechado) return; fechado = true;
    P._fecharTerm = null;
    if (reg.ro) { try { reg.ro.disconnect(); } catch {} reg.ro = null; }
    window.api.termKill({ id });
    try { term.dispose(); } catch {}
    termsVivos.delete(id);
    if (P.terms) P.terms.delete(id);
    cx.className = 'modal-cx';
    if (P._semAvisar) { reg.onDiscard?.(); return; }
    fecharModal(P);
    aoFechar && aoFechar({ code: reg.exitCode, cancelled: !!reg.cancelled || reg.vivo, error: reg.runError });
  };
  // Esc chama fecharModal direto: sem isto o login rodava, o pty ficava vivo e o
  // painel NUNCA religava na conta nova (quem faz isso e' o aoFechar)
  P._fecharTerm = fechar;
  modal.onclick = (e) => { if (e.target === modal) fechar(); };
  $('.mo-x', cx).onclick = fechar;
  $('#tmFecha', cx).onclick = fechar;
  $('#tmCancela', cx).onclick = () => { reg.cancelled = true; window.api.termInput({ id, data: '\x03' }); term.focus(); };

  /* o terminal nascia fixo em 92 colunas: com 3 paineis lado a lado sumia
     metade do texto, sem rolagem -- inclusive o codigo do "claude /login".
     Agora ele mede a caixa antes de rodar e acompanha quando ela muda. */
  // o antigo ja saiu la em cima, antes deste nascer
  const caixaTerm = $('.term-wrap', cx);
  ajustarTerminal(reg, caixaTerm);
  if (window.ResizeObserver) {
    reg.ro = new ResizeObserver(() => ajustarTerminal(reg, caixaTerm));
    try { reg.ro.observe(caixaTerm); } catch {}
  }
  window.api.termRun({ id, linha, cols: reg.cols || 92, rows: reg.rows || 22 }).then((r) => {
    if (r?.error) { reg.runError = r.error; term.write('\r\n\x1b[31m[não consegui rodar: ' + r.error + ']\x1b[0m\r\n'); reg.onExit?.({ code: null, error: r.error }); }
  }).catch((e) => { reg.runError = String(e?.message || e); reg.onExit?.({ code: null, error: reg.runError }); });
  setTimeout(() => { ajustarTerminal(reg, caixaTerm); term.focus(); }, 60);
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
async function carregarUsoSidebar(engine, fresco) {
  window.CockpitUI?.refreshAccounts(!!fresco);
  const alvo = caixaDoMotor('uso', engine);
  if (!alvo) return;
  // o medidor segue a ABA ATIVA, como o cartao: na aba da VPS e' o limite da conta de la'
  const lugar = lugarDaContaAtiva(engine);
  const geracao = (alvo._geracao = (alvo._geracao || 0) + 1);
  // barras de OUTRO lugar (a aba mudou) nao podem ficar na tela com o rotulo novo
  const trocouDeLugar = alvo.dataset.lugar !== lugar.chave;
  if (trocouDeLugar) { alvo.innerHTML = ''; alvo.dataset.lugar = lugar.chave; }
  if (lugar.remoto && faltaConfigurarServidor(lugar.remoto)) return;
  try {
    const c = await window.api.contaLer(pedidoDeConta(engine, lugar, fresco ? { fresco: true } : null));
    if (geracao !== alvo._geracao) return;   // outra leitura (outra aba) ja' passou na frente
    if (!c || !c.entrou) { alvo.innerHTML = ''; return; }
    checarLimite(engine, c, lugar);   // avisa na faixa do topo quando esta perto do fim
    // sessao/semana vazias podem ser um erro passageiro (ex: a propria API de uso
    // deu limite) - nesse caso mantem o que ja estava na tela, nao apaga
    if (!c.sessao && !c.semana) return;
    alvo.innerHTML = barraUso('Sessão', c.sessao) + barraUso('Semana', c.semana);
  } catch { /* e' so um indicador; se falhar, mantem o que ja estava na tela */ }
}

async function janelaConta(P) {
  if (!P || P.morto) return;
  fecharMenus();
  fecharTerminalDoPainel(P);
  if (!window.CockpitUI?.accountLayer) return note(P, 'Não foi possível abrir a interface de contas.', true);
  return window.CockpitUI.accountLayer(P.engine, abaPorId(P.abaId));
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
  if (!P || P.morto) return;
  const engine = P.engine, lugar = lugarDaContaDoPainel(P), abaId = P.abaId;
  const painelValido = () => !P.morto && P.engine === engine && P.abaId === abaId && lugarDaContaDoPainel(P).chave === lugar.chave;
  const geracaoInicial = P.uiContaGeracao || 0;
  if (lugar.remoto && faltaConfigurarServidor(lugar.remoto)) return note(P, AVISO_ABA_EM_BRANCO, true);
  let operacao, terminalAberto = false;
  const atualizar = () => { pintarCartaoConta(engine, true); carregarUsoSidebar(engine, true); savePanes(); };
  try {
    if (acao === 'status') {
      const r = await window.api.auth(pedidoDeConta(engine, lugar, { acao }));
      if (painelValido()) avisoTemp(P, r?.motivo || r?.texto || 'Não foi possível verificar a conta.');
      return;
    }
    const capacidade = await capacidadesDaConta(engine, lugar);
    if (!painelValido() || geracaoInicial !== (P.uiContaGeracao || 0)) return;
    if (!capacidade[acao]) return note(P, capacidade.orientacao || 'Esta ação de conta não está disponível neste destino.', true);
    operacao = await prepararMudancaDaConta(engine, lugar, acao);
    if (!operacao || !painelValido()) return;
    const geracaoPreparada = P.uiContaGeracao || 0;
    const r = await window.api.auth(pedidoDeConta(engine, lugar, { acao }));
    if (!painelValido() || geracaoPreparada !== (P.uiContaGeracao || 0)) return;
    if (!r?.terminal || r.error) throw new Error(r?.error || 'Não foi possível abrir a autenticação.');
    let concluido = false;
    const concluir = async (fim = {}) => {
      if (concluido) return;
      concluido = true;
      try {
        if (fim.cancelled || fim.code !== 0 || fim.error) {
          if (painelValido()) note(P, fim.error ? 'Não foi possível iniciar a autenticação: ' + fim.error : fim.cancelled ? 'Operação de conta cancelada. O login não foi confirmado.' : 'O comando de conta terminou com erro. O login não foi confirmado.', true);
          return;
        }
        const status = await window.api.auth(pedidoDeConta(engine, lugar, { acao: 'status' }));
        const esperado = acao === 'login';
        if (status?.verificado === true && status.entrou === esperado) {
          if (painelValido()) avisoTemp(P, esperado ? 'Login confirmado em ' + escopoDaConta(lugar) + '. A próxima mensagem continua a conversa.' : 'Saída da conta confirmada em ' + escopoDaConta(lugar) + '.');
        } else if (painelValido()) note(P, 'O comando terminou, mas não foi possível confirmar ' + (esperado ? 'o login' : 'a saída da conta') + '. ' + (status?.motivo || status?.error || 'Verifique a conta antes de continuar.'), true);
      } catch (e) { if (painelValido()) note(P, 'Não foi possível verificar a conta: ' + (e?.message || e), true); }
      finally { operacao.liberar(); atualizar(); }
    };
    janelaTerminal(P, r.terminal, r.titulo || 'Conta', concluir, { login: acao === 'login', onExit: concluir, onDiscard: () => concluir({ cancelled: true }) });
    terminalAberto = true;
  } catch (e) {
    operacao?.liberar();
    if (painelValido()) note(P, 'Não consegui alterar a conta: ' + (e?.message || e), true);
    atualizar();
  } finally { if (!terminalAberto) operacao?.liberar(); }
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
  /* ANEXO E' SEMPRE DESTE PC, mesmo com o painel rodando na VPS: ele mora em
     userData/colados, aqui no Windows. Por isso o null e' EXPLICITO -- se um dia
     alguem trocar por remotoDoPane(P), o preview de anexo quebra no servidor. */
  if (P) d.onclick = (e) => { if (!e.target.closest('.anx-x')) verArquivo(P, a.path, null); };
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
  // imagem anexada: "texto" tira o que esta' escrito nela (OCR local do Windows)
  // e poe no campo, pra editar antes de mandar
  if (P && IMG_EXT.includes(String(a.ext || '').toLowerCase()) && !/svg/i.test(String(a.ext || ''))) {
    const bt = document.createElement('button');
    bt.className = 'anx-ocr';
    bt.textContent = a._ocr ? 'lendo…' : 'texto';
    bt.disabled = !!a._ocr;
    bt.title = 'Extrair o texto desta imagem (OCR local, ~1 s) e colocar no campo';
    bt.onclick = (e) => { e.stopPropagation(); extrairTexto(P, a, bt); };
    d.appendChild(bt);
  }
  return d;
}

/* a mensagem em fila virava um aviso que sumia em 12s; agora fica na tela */
function pintarFila(P) {
  window.CockpitUI?.refresh();
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
    }, P));   // com o painel: clique abre no visor e imagem ganha o botao "texto" (OCR)
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
/* A cena de um .excalidraw.md do Obsidian: { json } (texto da cena, pronto pro
   quadro), { comprimida: true } ou null (nao achou cena -- mostra como texto). */
function cenaDoExcalidrawMd(texto) {
  const s = String(texto || '');
  const m = /```(compressed-json|json)[ \t]*\r?\n([\s\S]*?)\r?\n```/.exec(s);
  if (!m) return null;
  if (m[1] === 'compressed-json') return { comprimida: true };
  try {
    const o = JSON.parse(m[2]);
    if (o && typeof o === 'object' && (o.type === 'excalidraw' || Array.isArray(o.elements))) return { json: m[2] };
  } catch {}
  return null;
}
function fecharVisor() { $$('.p-visor').forEach(v => { v.classList.add('hidden'); $('.visor-corpo', v).innerHTML = ''; }); }

// resposta de SSH demora: dois cliques seguidos nao podem pintar fora de ordem
let visorGen = 0;
/* recado simples no corpo do visor, montado com textContent -- o motivo pode vir
   do servidor e nao pode virar marcacao dentro da tela */
function recadoVisor(corpo, linhas) {
  corpo.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'visor-vazio';
  linhas.filter(Boolean).forEach((t, i) => {
    if (i) d.appendChild(document.createElement('br'));
    d.appendChild(document.createTextNode(t));
  });
  corpo.appendChild(d);
  return d;
}
/* O 'remoto' vem de QUEM CHAMA, painel por painel -- nunca do formato do
   caminho. "Parece POSIX, entao e' do servidor" quebra no dia em que o Cockpit
   rodar num Mac. Os tres chamadores:
     - link de arquivo no texto do modelo  -> o remoto do PAINEL;
     - duplo clique na arvore              -> o remoto do PAINEL;
     - ficha de anexo                      -> null EXPLICITO (anexo colado mora
       em userData/colados, aqui neste PC, mesmo com o painel na VPS). */
async function verArquivo(P, caminho, remoto) {
  window.CockpitUI?.closeToolView?.("explorer");
  const v = $('.p-visor', P.el);
  const corpo = $('.visor-corpo', v);
  const meuGen = ++visorGen; P._visorGen = meuGen;
  v.classList.remove('hidden');
  v.onclick = (e) => { if (e.target === v) fecharVisor(); };
  $('.visor-nome', v).textContent = baseNome(caminho);
  $('.visor-x', v).innerHTML = ico('x');
  $('.visor-x', v).onclick = fecharVisor;
  const btAbrir = $('.visor-abrir', v);
  // "Abrir no PC" so' vale pro que esta' neste PC: no servidor o botao some
  btAbrir.classList.toggle('hidden', !!remoto);
  btAbrir.innerHTML = ico('upload');
  btAbrir.title = 'Abrir no ' + ESTE_PC;
  btAbrir.onclick = async () => {
    const r = await window.api.openPath(caminho);
    if (r && r.error) { const c = $('.visor-corpo', v); if (c) c.insertAdjacentHTML('afterbegin', '<div class="visor-vazio"></div>'); const av = $('.visor-vazio', c); if (av) av.textContent = r.error; }
  };
  corpo.innerHTML = '<div class="visor-vazio">' + (remoto ? 'lendo no servidor…' : 'abrindo…') + '</div>';
  // aba de servidor em branco: sem isso o pedido leria o disco DESTE PC calado
  if (faltaConfigurarServidor(remoto)) { recadoVisor(corpo, [AVISO_ABA_EM_BRANCO]); return; }

  let a = null;
  try { a = await window.api.verArquivo(caminho, remoto || undefined); }
  catch (e) { a = { erro: 'Não consegui abrir: ' + ((e && e.message) || e) }; }
  if (P._visorGen !== meuGen) return;   // ja' clicaram em outro arquivo
  if (!a || a.erro) { recadoVisor(corpo, ['Não consegui abrir.', (a && a.erro) || '']); return; }
  // cena do Excalidraw (o agente pode ter escrito uma): abre no quadro pra voce editar e devolver
  if (/\.excalidraw$/i.test(caminho)) {
    corpo.innerHTML = '';
    const dica = document.createElement('div');
    dica.className = 'visor-vazio';
    if (remoto) {
      /* o quadro le' e grava em userData deste PC (arquivo:lerTexto / imagem:salvar),
         entao desenho que esta' no servidor nao tem como ir e voltar ainda */
      dica.textContent = 'Desenho do Excalidraw (' + tamanhoBonito(a.bytes) + ') no servidor. '
        + 'O quadro só abre desenho deste ' + ESTE_PC + ' — traga o arquivo pra cá para editar.';
      corpo.appendChild(dica);
      return;
    }
    const bt = document.createElement('button');
    bt.className = 'mo-btn destaque';
    bt.textContent = 'Abrir no quadro';
    bt.addEventListener('click', async () => {
      let r = null;
      try { r = await window.api.textoLer({ arquivo: caminho }); } catch (e) { r = { error: String(e && e.message || e) }; }
      if (!r || !r.content) { note(P, 'Não consegui ler esse desenho: ' + ((r && r.error) || 'arquivo vazio'), true); return; }
      fecharVisor();
      abrirQuadro(P, r.content);
    });
    dica.textContent = 'Desenho do Excalidraw (' + tamanhoBonito(a.bytes) + ').';
    corpo.appendChild(dica); corpo.appendChild(bt);
    return;
  }
  /* auditoria 2: desenho do plugin Excalidraw do Obsidian (.excalidraw.md): a
     cena mora num bloco ```json no fim do markdown. Cena legivel = "Abrir no
     quadro" (uma copia: o .md nao muda). Comprimida (```compressed-json) o
     quadro nao le -- diz isso, em vez de mostrar o texto como se fosse nota. */
  if (/\.excalidraw\.md$/i.test(caminho) && a.tipo === 'texto') {
    const cena = cenaDoExcalidrawMd(a.dados);
    if (cena) {
      $('.visor-nome', v).textContent = a.nome + '  ·  ' + tamanhoBonito(a.bytes);
      corpo.innerHTML = '';
      const dica = document.createElement('div');
      dica.className = 'visor-vazio';
      if (cena.comprimida) {
        dica.textContent = 'Desenho comprimido do Obsidian (' + tamanhoBonito(a.bytes) + '): o quadro daqui não lê esse formato. Abra no Obsidian'
          + (remoto ? '.' : ' (botão do canto abre no ' + ESTE_PC + ').');
        corpo.appendChild(dica);
        return;
      }
      const bt = document.createElement('button');
      bt.className = 'mo-btn destaque';
      bt.textContent = 'Abrir no quadro';
      bt.addEventListener('click', () => { fecharVisor(); abrirQuadro(P, cena.json); });
      dica.textContent = 'Desenho do Excalidraw do Obsidian (' + tamanhoBonito(a.bytes) + '). O quadro abre uma cópia; o arquivo .md não muda.';
      corpo.appendChild(dica); corpo.appendChild(bt);
      return;
    }
  }
  $('.visor-nome', v).textContent = a.nome + '  ·  ' + tamanhoBonito(a.bytes);
  if (a.tipo === 'imagem') { corpo.innerHTML = ''; const i = document.createElement('img'); i.src = a.dados; corpo.appendChild(i); }
  else if (a.tipo === 'texto') { corpo.innerHTML = '<pre></pre>'; $('pre', corpo).textContent = a.dados; }
  else if (remoto) recadoVisor(corpo, ['Este tipo não abre aqui dentro.', 'Ele está no servidor — use o terminal (menu /) para trabalhar nele.']);
  else recadoVisor(corpo, ['Este tipo não abre aqui dentro.', 'Use o botão do canto para abrir no ' + ESTE_PC + '.']);
}

/* ============ conversas recentes ============ */
const histCache = porMotor(null);

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

const histGen = porMotor(0);
const pintaGen = porMotor(0);
const escondidasPorFiltro = porMotor(0);
/* a aba sem pasta ("PC inteiro") tambem filtra agora. Sem isto, o aviso
   "clique para ver todas" levava pra ela mesma e nao fazia nada. */
const semPastaFiltrou = porMotor(false);
const verTodasAsConversas = porMotor(false);
async function loadHist(engine, force) {
  const meuGen = ++histGen[engine];
  const box = caixaDoMotor('hist', engine);
  if (!box) return;
  if (histCache[engine]) paintHist(engine, histCache[engine]);   // mostra o que ja tem
  else box.innerHTML = '<div class="hist-load">Carregando…</div>';

  const aba = abaAtual();
  let r;
  if (aba && aba.tipo === 'ssh') {
    // as conversas de uma aba remota ficam gravadas dentro do servidor, nao aqui
    escondidasPorFiltro[engine] = 0;   // aba remota nao filtra por pasta local
    // so' o Claude atravessa o SSH: os outros nao tem conversa GRAVADA no servidor
    r = await window.api.sessionsRemoto({ engine, remoto: remotoDoAba(aba) });
  } else {
    r = engine === 'claude' ? await window.api.sessionsClaude(!!cfg.verRobos)
      : engine === 'codex' ? await window.api.sessionsCodex(!!cfg.verRobos)
      : await window.api.sessionsCli(engine);
    const pastas = pastasDaAba(aba);
    if (pastas.length && Array.isArray(r)) {
      const todas = r.length;
      r = r.filter(s => pastas.some(p => mesmaPasta(s.cwd, p)));
      escondidasPorFiltro[engine] = todas - r.length;   // pra avisar na tela
    } else if (Array.isArray(r)) {
      // aba sem pasta ("PC inteiro"): antes mostrava TUDO, inclusive as conversas
      // que pertencem as abas de projeto. Agora ela fica com o que sobra.
      const deOutras = [];
      for (const outra of abasLocais()) {
        if (!outra || outra.id === (aba && aba.id) || outra.tipo === 'ssh') continue;
        for (const p of pastasDaAba(outra)) deOutras.push(p);
      }
      if (deOutras.length && !verTodasAsConversas[engine]) {
        const todas = r.length;
        r = r.filter(s => !deOutras.some(p => mesmaPasta(s.cwd, p)));
        escondidasPorFiltro[engine] = todas - r.length;
        semPastaFiltrou[engine] = true;    // aqui o aviso vira "mostrar assim mesmo"
      } else { escondidasPorFiltro[engine] = 0; semPastaFiltrou[engine] = false; }
    } else escondidasPorFiltro[engine] = 0;
  }
  // chegou tarde: o usuario ja trocou de aba ou pediu outra lista
  if (meuGen !== histGen[engine]) return;
  if (r && r.aviso) {
    box.innerHTML = '';
    const av = document.createElement('div');
    av.className = 'hist-load';
    av.textContent = r.aviso;
    box.appendChild(av);
    histCache[engine] = [];
    return;
  }
  if (r && r.error) {
    // o motivo vem do servidor: entra como TEXTO, nunca como HTML
    box.innerHTML = '';
    const av = document.createElement('div');
    av.className = 'hist-load';
    av.textContent = 'Não consegui ler: ' + r.error;
    box.appendChild(av);
    histCache[engine] = [];   // senao a busca repinta a lista da aba anterior por cima
    return;
  }
  histCache[engine] = r || [];
  paintHist(engine, histCache[engine]);
}

const buscaAtual = porMotor('');

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
const filtroGrupo = porMotor(null);   // aba ativa em cada lista; nao e' salvo, reseta a cada abertura

function pintarAbasGrupo(engine) {
  const box = caixaDoMotor('abas', engine);
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
/* quem abre o modal pode deixar aqui o que precisa rodar quando ele fechar por
   QUALQUER caminho (X, veu, Esc): a camera desliga, a Promise resolve */
let aoFecharModalGlobal = null;
function abrirModalGlobal() {
  aoFecharModalGlobal = null;
  const modal = $('#modalGrupo'), cx = $('.modal-cx', modal);
  cx.className = 'modal-cx';   // limpa marca de uso anterior (ex: a de imagem,
                               // que tira fundo e borda e deixava o formulario
                               // seguinte ilegivel ate reiniciar o app)
  modal.classList.remove('hidden');
  modal.onclick = (e) => { if (e.target === modal) fecharModalGlobal(); };
  cx.onclick = (e) => e.stopPropagation();
  cx.innerHTML = '';
  return cx;
}
function fecharModalGlobal() {
  const f = aoFecharModalGlobal; aoFecharModalGlobal = null;
  if (f) { try { f(); } catch {} }
  const modal = $('#modalGrupo');
  modal.classList.add('hidden'); $('.modal-cx', modal).innerHTML = '';
}

/* popup pequeno ancorado perto do botao que abriu, tipo menu de selecao */
function fecharPopGlobal() { const pop = $('#popGrupo'); pop._contaPedido = null; pop.classList.add('hidden'); pop.innerHTML = ''; }
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
    for (const eng of MOTORES) { pintarAbasGrupo(eng); if (histCache[eng]) paintHist(eng, histCache[eng]); }
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
  for (const eng of MOTORES) { pintarAbasGrupo(eng); if (histCache[eng]) paintHist(eng, histCache[eng]); }
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

/* auditoria 2: renomeou pela LISTA -- o painel aberto com essa conversa (nesta
   aba ou rodando no fundo) e a ficha salva de outra aba passam a ter o nome
   novo, e a ficha e' gravada (savePanes). Antes a ficha ficava com o nome velho
   e reabrir o app trazia ele de volta. Ramo que ainda nao nasceu carrega o id da
   ORIGEM e nao e' esta conversa (painelDaConversa). */
function renomearPaineisDaConversa(s, novo) {
  const identidade = { engine: s.engine, remoto: s.remoto ? (s.remotoDestino || remotoDoAba(abaAtual())) : null };
  const vivos = [...panes.values(), ...panesFundo.values()].filter((P) => !P.morto);
  const alvos = vivos.filter((P) => painelDaConversa([P], s.id, identidade));
  for (const P of alvos) {
    P.titulo = novo; P.nomeManual = true; esquecerTituloAuto(P);
    P._nomeGravadoEm = s.id + '|' + novo;   // o nome ja' foi gravado agora: nao regrava
    if (panes.has(P.id) && P.el) pintarNome(P);   // o de fundo nao tem nome na tela pra pintar
  }
  // fichas que so' existem no config (outra aba) ou que ainda nao couberam na tela
  const renomearFicha = (pp, abaId) => {
    if (!pp || pp.fork || !painelDaConversa([{ ...pp, abaId }], s.id, identidade)) return;
    pp.titulo = novo; pp.nomeManual = true; pp.tituloAuto = false;
  };
  for (const ab of abasLocais()) {
    for (const pp of Array.isArray(ab.paineis) ? ab.paineis : []) renomearFicha(pp, ab.id);
    for (const pp of fichasPendentes.get(ab.id) || []) renomearFicha(pp, ab.id);
  }
  savePanes();
  return alvos.length;
}

function linhaConversa(s, termo, trecho) {
  const destinoDaLinha = s.remoto ? (s.remotoDestino || remotoDoAba(abaAtual())) : null;
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
    // vale tambem pra conversa do servidor: o ramo roda la', na aba de agora
    const ramo = mi('Ramificar em painel novo', 'git-branch', () => ramificarDaLista(s));
    ramo.title = 'Abre um painel novo que continua esta conversa por outro caminho. A original não muda e não é aberta.';
    pop.appendChild(ramo);
    pop.appendChild(Object.assign(document.createElement('div'), { className: 'menu-linha' }));
    pop.appendChild(mi('Exportar como .md', 'upload', async () => {
      const r = await window.api.exportarSessao({ engine: s.engine, id: s.id, file: s.file, titulo: s.title, remoto: destinoDaLinha });
      if (r && r.error) alert('Não consegui exportar: ' + r.error);
      else if (r && r.ok && focusPane) note(focusPane, 'Conversa salva em ' + r.caminho);
    }));
    pop.appendChild(Object.assign(document.createElement('div'), { className: 'menu-linha' }));
    pop.appendChild(mi('Apagar conversa', 'x', async () => {
      if (!confirm('Mandar "' + s.title + '" para a Lixeira?\n\nDá para restaurar de lá se mudar de ideia.')) return;
      const r = await window.api.apagarSessao({ engine: s.engine, id: s.id, file: s.file, remoto: destinoDaLinha });
      if (r && r.error) { alert('Não consegui apagar: ' + r.error); return; }
      d.remove();
      // painel aberto que usava esta conversa: para o motor de verdade
      for (const Q of [...panes.values(), ...panesFundo.values()]) {
        if (Q.engine === s.engine && chaveDoLugar(remotoDoPane(Q)) === chaveDoLugar(destinoDaLinha) && (Q.sessaoId === s.id || Q.resumeId === s.id || Q.resumeAnterior === s.id)) {
          try { await window.api.paneStop({ paneId: Q.id, engine: Q.engine }); } catch {}
          destravarPainel(Q);
          Q.sessaoId = null; Q.resumeId = null; Q.resumeAnterior = null; Q.sessaoFile = ''; Q.started = false;
          // auditoria 2: a proxima e' conversa NOVA -- o nome da apagada nao vai junto
          Q.forkPendente = false; zerarNomeDaConversa(Q);
          setDot(Q, 'off');
          note(Q, 'Esta conversa foi apagada. A próxima mensagem começa uma nova.', true);
        }
      }
      // painel salvo em OUTRA aba local: so' existe no config, o laco acima nao alcanca
      for (const ab of abasLocais()) {
        if (!Array.isArray(ab.paineis)) continue;
        for (const pp of ab.paineis) {
          if (pp && pp.sessaoId === s.id) { pp.sessaoId = null; pp.file = ''; pp.titulo = ''; pp.nomeManual = false; pp.tituloAuto = false; pp.fork = false; }
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
      await window.api.renomear({ engine: s.engine, id: s.id, nome: novo, remoto: destinoDaLinha });
      s.title = novo;
      alvo.textContent = novo;
      d.title = novo + '\n' + s.cwd;
      histCache[s.engine] = null;
      renomearPaineisDaConversa({ ...s, remotoDestino: destinoDaLinha }, novo);
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
  const box = caixaDoMotor('hist', engine);
  if (!box) return;
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
      if (semPastaFiltrou[engine]) {
        // ja estamos na aba sem pasta: aqui o botao mostra tudo em vez de
        // tentar trocar pra uma aba que e' esta mesma
        av.title = 'Estas conversas pertencem às outras abas. Clique para mostrar assim mesmo.';
        av.addEventListener('click', () => { verTodasAsConversas[engine] = true; loadHist(engine, true); });
      } else {
        av.title = 'Esta aba mostra só as conversas das pastas dela. Clique para ver todas.';
        av.addEventListener('click', () => {
          const pc = abasLocais().find(x => x.tipo === 'local' && !pastasDaAba(x).length);
          if (pc) { verTodasAsConversas[engine] = true; trocarAbaLocal(pc.id); }
        });
      }
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
  window.CockpitUI?.closeToolView?.("h" + s.engine);
  const abaDaLista = abaAtual();
  const destinoDaLista = s.remoto ? (s.remotoDestino || remotoDoAba(abaDaLista)) : null;
  if (chaveDoLugar(destinoDaLista) !== chaveDoLugar(remotoDoAba(abaDaLista)) ||
      String(destinoDaLista?.chave || '') !== String(remotoDoAba(abaDaLista)?.chave || '')) {
    mostrarAviso({ tipo: 'erro', texto: 'Esta conversa pertence a outro lugar. Abra o histórico no lugar de origem.' });
    return;
  }
  const identidade = { engine: s.engine, remoto: destinoDaLista };
  // ja esta aberta em algum painel? so pisca e leva voce ate ela
  // tambem os que estao rodando em OUTRA aba: abrir de novo criaria um segundo
  // motor na MESMA conversa (dois 'claude --resume' no mesmo arquivo; no Codex,
  // o roteamento por thread era sequestrado e o painel antigo travava)
  // (o ramo que ainda nao nasceu leva o id da ORIGEM e nao conta: painelDaConversa)
  const noFundo = painelDaConversa([...panesFundo.values()], s.id, identidade);
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
  const aberta = painelDaConversa([...panes.values()], s.id, identidade);
  if (aberta) {
    document.querySelectorAll('.hist-item').forEach(x => x.classList.remove('on'));
    if (el) el.classList.add('on');
    setFocus(aberta);
    piscar(aberta);
    $('.p-input', aberta.el).focus();
    return;
  }
  /* aba de servidor: so' o Claude roda la' (mesma guarda do trocarMotor). A
     lista de outro motor ainda com a cache do PC na tela abria a conversa num
     painel que rodava no PC com a tela dizendo VPS. */
  if (destinoDaLista && !(await capacidadeRemota(s.engine, destinoDaLista))) { mostrarAviso({tipo:'erro', texto:'Motor indisponível neste servidor.'}); return; }
  if (cfg.abaAtiva !== abaDaLista.id) return;

  // cada conversa da lista abre no seu proprio painel, sem atropelar o que ja esta rolando
  let P = null;
  if (cabeMaisPainel()) P = newPane({ engine: s.engine, cwd: s.cwd, titulo: s.title });
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
  P.engine = s.engine; P.cwd = s.cwd; P.managedWorktree = null; P.resumeId = s.id; P.started = false; P.busy = false; P.model = '';
  P.modoReal = null; P._avisouModo = false;   // auditoria 2: o modo real era da sessao de antes deste painel
  if (s.engine === 'acp' && s.comando) P.model = s.comando;   // a conversa e' daquele agente
  // a conversa que voce renomeou a mao chega com o apelido em s.title: zerar o
  // nomeManual deixava o titulo automatico sobrescrever no fim do turno
  P.titulo = s.title || ''; P.hist = []; P.nomeManual = !!s.nome;
  esquecerTituloAuto(P); P.tituloAuto = !P.nomeManual && !!s.tituloAuto;   // leva 41 (B6): reaberta nao ganha nome novo
  if (P.nomeManual || P.tituloAuto) P._nomeGravadoEm = s.id + '|' + P.titulo;   // o nome ja' veio da lista: nao regrava
  // sobra da conversa ANTERIOR: sem limpar, o savePanes logo abaixo gravava a
  // conversa velha, o titulo vinha do arquivo errado e o anel de contexto mentia
  P.sessaoId = null; P.sessaoFile = ''; P.sessaoRemota = false; P.resumeAnterior = null;
  P.tokens = 0; P.janela = 0; P.passarContexto = null;
  P.anexos = []; pintarAnexos(P); pintarTokens(P); esconderPermissao(P);
  P.blocks.clear(); P.tools.clear(); P.chat.innerHTML = ''; esquecerPassos(P);
  limparPlano(P); limparAuditoria(P); zerarTurno(P); P.forkPendente = false; P.avisoModelo = null; P.acpInfo = null; P.acpModelos = null; P.worktree = null;
  fillModels(P); paintEngine(P); setDot(P, 'off');
  // em aba de servidor o motor roda SEMPRE na pasta da aba: mostrar a pasta de
  // origem da conversa deixaria o cabecalho dizendo um lugar onde ele nao esta'
  const abaAqui = abaPorId(P.abaId);
  $('.p-cwd', P.el).textContent = remotoDoPane(P)
    ? ('🖧 ' + (abaAqui ? abaAqui.nome : 'servidor'))
    : nomePasta(P.cwd);
  pintarModo(P); pintarNome(P);
  setFocus(P); savePanes();

  note(P, 'Conversa: ' + s.title);
  const remotoAqui = remotoDoAba(abaAtual());
  let msgs = [];
  if (remotoAqui) {
    const lido = listaOuErro(await window.api.sessionHistory({ engine: s.engine, remoto: remotoAqui, id: s.id }));
    if (lido.erro) note(P, 'Não consegui ler esta conversa no servidor. ' + lido.erro, true);
    msgs = lido.itens;
  } else {
    msgs = (await window.api.sessionHistory({ engine: s.engine, file: s.file, id: s.id })) || [];
  }
  for (const m of (msgs || [])) {
    if (m.role === 'user') userMsg(P, m.text, null, m.imagens);   // o userMsg ja grava no historico
    else if (m.role === 'bot') {
      const b = botBlock(P, 'h' + Math.random()); b.raw = m.text; b.el.innerHTML = mdSeguro(m.text); marcarRecibo(b.el); desenharBlocosExcalidraw(P, b.el);
      linkarArquivos(P, b.el); marcarLinksWeb(b.el); botoesDeCodigo(b.el);   // auditoria 2: como a fala ao vivo (caminho clicavel)
      P.hist.push({ quem: nomeDoMotor(s.engine), texto: m.text });
    }
    else if (m.role === 'tool') { toolStart(P, 'h' + Math.random(), m.name, m.arg); }
  }
  /* a conversa volta no modelo em que estava (o ultimo que respondeu nela);
     antes o P.model = '' acima deixava toda conversa reaberta no padrao. Sem
     essa informacao, fica o padrao. Painel que ja subiu o motor nao troca: o
     rotulo passaria a mentir sobre o processo que esta rodando. */
  if (s.engine === 'claude' && !P.morto && !P.started) {
    const doHist = modeloDoHistorico(msgs);
    if (doHist && doHist !== P.model) { P.model = doHist; fillModels(P); savePanes(); }
  }
  document.querySelectorAll('.tool-st').forEach(x => { if (x.classList.contains('run')) { x.className = 'tool-st ok'; x.innerHTML = ico('check'); } });
  const faixa = document.createElement('div');
  faixa.className = 'troca'; faixa.innerHTML = '<span></span>';
  $('span', faixa).textContent = 'daqui pra baixo é a conversa de agora';
  P.chat.appendChild(faixa);
  irProFim(P);   // abre no fim: e' de onde voce vai continuar
  $('.p-input', P.el).focus();
}

/* ao abrir o app, devolve os paineis da ultima vez com a conversa ja carregada */
async function restaurarPaineis(salvos, abaId, gen) {
  sairDaAbertura();
  return await comMontagemAdiada(() => restaurarPaineisMiolo(salvos, abaId, gen));
}

function opcoesDoPainelSalvo(s, abaId) {
  /* coluna vai JUNTO, e nao so' no ajuste logo depois do newPane (linha do
     "a montagem acontece no fim do lote"): desde que o painel novo nasce na
     ponta esquerda, criar sem coluna empurra os vizinhos uma casa pra direita.
     Num lote de restauracao isso embaralhava a disposicao salva — dois paineis
     acabavam na mesma coluna. Com a coluna declarada, ninguem e' empurrado. */
  return { engine: s.engine, cwd: s.cwd, model: s.model, mode: s.mode, effort: s.effort,
    engineStates: s.engineStates, managedWorktree: s.managedWorktree || null, resumeId: s.sessaoId, titulo: s.titulo, abaId,
    coluna: s.coluna };
}

async function restaurarPaineisMiolo(salvos, abaId, gen) {
  // sem corte: com o teto de 12 fora, tudo o que estava aberto volta a abrir
  const lista = salvos;
  for (let i = 0; i < lista.length; i++) {
    const s = lista[i];
    /* Trocou de aba enquanto isto carregava: para aqui, MAS guarda quem ficou
       pra tras. Antes o laco so' voltava, e o proximo savePanes apagava esses
       painéis do config como se voce os tivesse fechado. */
    if (gen !== undefined && gen !== abaGen) { guardarPendentes(abaId, lista.slice(i)); return; }
    // resumeId precisa existir ANTES do fillModels chamado dentro de newPane:
    // sem isso, o catálogo ainda ausente apagava o modelo salvo da thread.
    /* ficha antiga pode nao ter coluna gravada: cai no indice do lote, que e a
       ordem em que ela foi salva. Sem isso ela nasceria na ponta esquerda e
       empurraria as ja restauradas. */
    const salvas = opcoesDoPainelSalvo(s, abaId);
    if (salvas.coluna == null) salvas.coluna = i;
    const P = newPane(salvas);
    P.uiRestoredPaneId = s.paneId || null;   // identidade transitória para focar a ficha clicada no Navigator
    // Só restaura ramo e metadados quando a ficha pertence ao mesmo motor.
    const mesmoMotor = P.engine === s.engine;
    P.forkPendente = mesmoMotor && !!s.fork;   // ramo que ainda nao mandou a 1a mensagem
    // leva 41 (B6): quem deu o nome volta junto (sem isto, reabrir o app deixava
    // a releitura do aiTitle passar por cima do seu nome e do de 3 palavras)
    P.nomeManual = !!s.nomeManual; P.tituloAuto = !P.nomeManual && !!s.tituloAuto;
    if (s.sessaoId && (P.nomeManual || P.tituloAuto)) P._nomeGravadoEm = s.sessaoId + '|' + (s.titulo || '');
    // Defesa para fichas antigas de um motor removido do catálogo.
    if (!mesmoMotor) zerarNomeDaConversa(P);
    P.worktree = mesmoMotor ? (s.worktree || null) : null;   // pasta isolada do PC nao vai pro Claude do servidor
    if (P.worktree || P.managedWorktree) mostrarPastaNoPainel(P);
    // ficha nova traz o caminho do arquivo; ficha antiga trazia a cena em JSON
    if (s.quadro && String(s.quadro).trim().startsWith('{')) {
      P.quadroCena = s.quadro; P.quadroArquivo = null;
      // ficha do pacote anterior: vira arquivo ja, senao o proximo savePanes descartava o desenho
      window.api.textoSalvar({ texto: s.quadro, prefixo: 'quadro', ext: 'excalidraw', nome: 'quadro-' + P.id })
        .then((r) => { if (r && r.arquivo) { P.quadroArquivo = r.arquivo; savePanes(); } }).catch(() => {});
    } else { P.quadroCena = null; P.quadroArquivo = s.quadro || null; }
    soltarPendente(abaId, P);   // nasceu: nao e' mais pendencia
    if (s.coluna != null) P.coluna = s.coluna;   // a montagem acontece no fim do lote
    if (s.larguraColuna) P.larguraColuna = s.larguraColuna;
    P.uiUnread = !!s.uiUnread; P.uiCompleted = !!s.uiCompleted;
    if (s.contexto) P.passarContexto = s.contexto;
    // devolve o texto que voce tinha comecado a escrever
    if (s.rascunho) {
      const campo = $('.p-input', P.el);
      /* aqui o painel ainda NAO esta' na tela (a montagem vem no fim do lote):
         scrollHeight 0 virava altura 0px e o rascunho sumia. Mede so' se der;
         senao a altura natural fica e o observador do campo mede ao montar. */
      if (campo) { campo.value = s.rascunho; campo.style.height = 'auto'; if (campo.scrollHeight) campo.style.height = Math.min(campo.scrollHeight, 190) + 'px'; }
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
      if (!mesmoMotor) msgs = [];
      else if (remotoAqui) {
        const lido = listaOuErro(await window.api.sessionHistory({ engine: s.engine, remoto: remotoAqui, id: s.sessaoId }));
        if (lido.erro) note(P, 'Não consegui trazer o histórico do servidor. ' + lido.erro, true);
        msgs = lido.itens;
      } else {
        msgs = (await window.api.sessionHistory({ engine: s.engine, file: s.file, id: s.sessaoId })) || [];
      }
    } catch {}
    for (const msg of msgs) {
      // o historico em memoria tambem: sem ele, trocar de motor depois de
      // reabrir o app mandava o outro comecar do zero, sem saber de nada
      if (msg.role === 'user') userMsg(P, msg.text, null, msg.imagens);   // o userMsg ja grava no historico
      else if (msg.role === 'bot') {
        const b = botBlock(P, 'r' + Math.random()); b.raw = msg.text; b.el.innerHTML = mdSeguro(msg.text); marcarRecibo(b.el); desenharBlocosExcalidraw(P, b.el);
        linkarArquivos(P, b.el); marcarLinksWeb(b.el); botoesDeCodigo(b.el);   // auditoria 2: como a fala ao vivo (caminho clicavel)
        P.hist.push({ quem: nomeDoMotor(s.engine), texto: msg.text });
      }
    }
    if (msgs.length) {
      const d = document.createElement('div');
      d.className = 'troca'; d.innerHTML = '<span></span>';
      $('span', d).textContent = 'conversa de antes — pode continuar daqui';
      P.chat.appendChild(d);
      irProFim(P);   // abre no fim: e' de onde voce vai continuar
    }
    /* ramo que ainda nao nasceu: o que aparece acima e' a conversa de ORIGEM.
       Sem esta faixa, parecia que escrever aqui continuaria a original. */
    if (P.forkPendente) {
      clearEmpty(P);
      const d = document.createElement('div');
      d.className = 'troca ramo'; d.innerHTML = '<span></span>';
      $('span', d).textContent = 'Ramo ainda não ligado: a primeira mensagem cria o ramo com esta conversa. A original não muda.';
      P.chat.appendChild(d);
    }
    /* leva 41 (B2): esta conversa estava NO MEIO de um turno quando o app fechou
       ou a tela recarregou? Religa e pede pra continuar (sem travar o laco). */
    retomarSeCaiu(P, s).catch(() => {});
  }
  const primeiro = [...panes.values()][0];
  if (primeiro) { setFocus(primeiro); $('.p-input', primeiro.el).focus(); }
  for (const Q of panes.values()) atualizarGit(Q);   // chip do git em todos, nao so' no focado
  savePanes();
}

/* ===================== RAMIFICAR (fork de verdade) =====================
   Antes, "ramificar" colava so' um resumo de 14k no painel novo e o resto se
   perdia. Agora o ramo e' REAL onde o motor sabe fazer: Claude usa
   --fork-session (sessao nova com o historico inteiro), Codex usa thread/fork
   (com ponto de corte), Gemini ganha uma copia do arquivo com id novo. O
   resumo colado continua como reserva pra quem nao tem sessao ainda. */
function ramificar(P) { return ramificarAte(P, null); }

/* "(ramo) Titulo" -- o mesmo formato do "continuar aqui (ramo)" da Torre.
   Ramo de ramo nao empilha "(ramo) (ramo)"; o sufixo antigo " (ramo)" some. */
function tituloDeRamo(t) {
  const base = String(t || '').replace(/^\(ramo\)\s*/i, '').replace(/\s*\(ramo\)$/i, '').trim();
  return '(ramo) ' + (base || 'Conversa');
}

/* o painel do ramo nasce com as escolhas da origem (motor, pasta, modelo,
   modo, esforco, aba). o.fork = ramo do Claude que ainda nao nasceu: o
   --fork-session roda no primeiro start; ate' la a ficha guarda o fork, senao
   reabrir o app viraria continuacao da conversa de ORIGEM. */
function novoPainelRamo(P, o) {
  const x = o || {};
  const titulo = tituloDeRamo(P.titulo);
  const novo = newPane({ engine: P.engine, cwd: P.cwd, model: P.model, mode: P.mode, effort: P.effort, abaId: P.abaId,
    resumeId: x.resumeId || null, titulo });
  /* auditoria 1: o painel nasceu em OUTRO motor (o newPane recusa motor que nao
     roda na aba -- Codex numa aba de servidor vira Claude). O id e o fork eram do
     motor de origem: um Claude com --resume de uma thread do Codex cai em laco. */
  const mesmoMotor = novo.engine === P.engine;
  novo.resumeId = mesmoMotor ? (x.resumeId || null) : null;
  novo.titulo = titulo;
  if (x.fork && mesmoMotor) novo.forkPendente = true;
  /* leva 41 (B6): a origem tinha nome do Cockpit (3 palavras) ou seu: o ramo
     fica "(ramo) <esse nome>" e o aiTitle que o ramo herda no arquivo nao
     passa por cima. E' do Cockpit (automatico): voce ainda renomeia. */
  if (P.tituloAuto || P.nomeManual) novo.tituloAuto = true;
  pintarNome(novo);
  return novo;
}

/* doFim: a K-esima mensagem SUA contando do fim (null = conversa inteira).
   Conta-se do fim de proposito: a tela pode mostrar so' a cauda da conversa,
   e contar do inicio erraria o ponto. alvo = { texto, repetidasDepois } da
   mensagem escolhida -- o Claude corta o arquivo pelo TEXTO (a posicao do fim
   escorrega com comando e fala tecnica, que a tela e o arquivo contam diferente). */
/* auditoria 1: numa aba de SERVIDOR so' o Claude roda. O ramo de outro motor
   nasceria Claude com o id daquele motor (queda em laco) -- recusa ANTES de
   pedir o fork ao motor, dizendo o que fazer. */
function avisoRamoNoServidor(eng) {
  return 'Não foi possível confirmar a ramificação do ' + nomeDoMotor(eng) + ' neste servidor. Confira a disponibilidade do motor no destino e tente novamente.';
}
async function ramificarAte(P, doFim, alvo) {
  if (remotoDoPane(P) && !(await capacidadeRemota(P.engine, remotoDoPane(P)))) { note(P, avisoRamoNoServidor(P.engine), true); return null; }
  const id = P.sessaoId || P.resumeId;
  if (P.engine === 'claude' && id) {
    // conversa inteira: no PC e no servidor, o fork e' do proprio CLI, no start
    if (doFim == null) return forkClaude(P);
    /* "voltar para cá" = ramo cortado de verdade: o main copia o .jsonl ate'
       ANTES da mensagem escolhida, com sessionId novo. So' no PC, onde o
       arquivo mora; no servidor segue o resumo colado. */
    if (!remotoDoPane(P)) {
      const texto = String((alvo && alvo.texto) || '');
      let r = null;
      try {
        r = await window.api.sessaoFork({ engine: 'claude', id, doFim, alvo: texto,
          repetidasDepois: (alvo && alvo.repetidasDepois) || 0, cwd: P.cwd });
      } catch (e) { r = { error: String(e && e.message || e) }; }
      if (r && (r.id || r.vazio)) {
        // o ramo ja' e' sessao nova: --resume nele, sem --fork-session de novo
        const novo = novoPainelRamo(P, { resumeId: r.id || null });
        // a mensagem escolhida volta pro campo: mandar de novo ou mudar
        const campo = $('.p-input', novo.el);
        if (campo && texto) { campo.value = texto; campo.style.height = 'auto'; campo.style.height = Math.min(campo.scrollHeight || 0, 190) + 'px'; }
        faixaDeRamo(novo, P, doFim, false, { antes: true, vazio: !!r.vazio });
        savePanes();
        return novo;
      }
      note(P, 'Não deu para cortar a conversa neste ponto (' + ((r && r.error) || 'sem resposta') + ') — vou levar só um resumo do que foi dito.', true);
    }
    return ramoPorContexto(P, doFim);
  }
  if ((P.engine === 'codex' || P.engine === 'gemini') && id) {
    let r = null;
    try { r = await window.api.sessaoFork({ engine: P.engine, id, doFim, remoto: remotoDoPane(P) }); } catch (e) { r = { error: String(e && e.message || e) }; }
    if (r && r.id) {
      const novo = abrirRamo(P, r.id, doFim);
      if (r.aviso) note(novo, r.aviso);
      return novo;
    }
    note(P, 'Não deu para ramificar de verdade (' + ((r && r.error) || 'sem resposta') + ') — vou levar só o resumo da conversa.', true);
  }
  return ramoPorContexto(P, doFim);
}

/* Claude: o fork acontece no LIGAR do painel novo (--resume + --fork-session).
   Ate' la, o painel guarda a intencao em forkPendente -- e so' o evento
   'sessao' com o endereco NOVO desliga (aoNascerSessao). */
function forkClaude(P) {
  const novo = novoPainelRamo(P, { resumeId: P.sessaoId || P.resumeId, fork: true });
  faixaDeRamo(novo, P, null);
  savePanes();
  return novo;
}

/* Codex/Gemini: o fork JA aconteceu no motor; o painel novo so' retoma o id */
function abrirRamo(P, idNovo, doFim) {
  const novo = novoPainelRamo(P, { resumeId: idNovo });
  faixaDeRamo(novo, P, doFim);
  savePanes();
  return novo;
}

/* reserva: painel novo com o resumo colado (o caminho antigo), com corte opcional */
function ramoPorContexto(P, doFim) {
  if (!P.hist.length) { note(P, 'Ainda não há conversa para levar adiante.', true); return null; }
  let hist = P.hist;
  if (doFim != null && doFim >= 1) {
    const idxUser = [];
    for (let i = 0; i < hist.length; i++) if (hist[i].quem === 'Você') idxUser.push(i);
    const alvo = idxUser[idxUser.length - doFim];
    if (alvo != null) hist = hist.slice(0, alvo + 1);
  }
  const novo = novoPainelRamo(P, {});
  novo.passarContexto = montarContexto({ hist });
  faixaDeRamo(novo, P, doFim, true);
  savePanes();
  return novo;
}

/* De que modelo e' a conversa de ORIGEM de um ramo aberto pela lista (auditoria
   1: antes o ramo nascia no padrao). Manda o painel que esta com ela aberta
   (aqui ou em outra aba); senao, no Claude, o ultimo modelo que respondeu no
   arquivo (modeloDoHistorico); senao '' = padrao. */
async function modeloDaOrigem(s) {
  const remoto = s.remoto ? (s.remotoDestino || remotoDoAba(abaAtual())) : null;
  const aberto = painelDaConversa([...panes.values(), ...panesFundo.values()].filter((P) => !P.morto), s.id, { engine: s.engine, remoto });
  if (aberto && aberto.model) return { model: aberto.model, effort: aberto.effort || '' };
  if (s.engine !== 'claude') return { model: '' };
  let msgs = [];
  try {
    msgs = s.remoto
      ? (listaOuErro(await window.api.sessionHistoryRemoto({ remoto, id: s.id })).itens || [])
      : ((await window.api.sessionHistory({ engine: s.engine, file: s.file, id: s.id })) || []);
  } catch {}
  return { model: modeloDoHistorico(msgs) };
}

/* "Mais ações" da lista -> "Ramificar em painel novo": o ramo nasce na aba
   de agora, SEM abrir a conversa original (ela continua intacta, e pode estar
   aberta em outro painel sem conflito: o ramo e' outra sessao). */
async function ramificarDaLista(s) {
  window.CockpitUI?.closeToolView?.("h" + s.engine);
  if (!s || !s.id) return null;
  if (!cabeMaisPainel()) return null;
  const atual = abaAtual();
  const remoto = s.remoto ? (s.remotoDestino || remotoDoAba(atual)) : undefined;
  const mesmoDestino = (aba) => {
    const destino = remotoDoAba(aba);
    return !!destino && ['host', 'usuario', 'chave', 'caminhoRemoto', 'porta'].every((campo) =>
      String(destino[campo] || (campo === 'porta' ? 22 : campo === 'caminhoRemoto' ? '~' : '')) ===
      String(remoto?.[campo] || (campo === 'porta' ? 22 : campo === 'caminhoRemoto' ? '~' : '')));
  };
  const aba = s.remoto
    ? (mesmoDestino(atual) ? atual : abasLocais().find(mesmoDestino))
    : (atual && !remotoDoAba(atual) ? atual : abasLocais().find((a) => a.tipo !== 'ssh'));
  if (!aba || (s.remoto && (!remoto || faltaConfigurarServidor(remoto)))) {
    mostrarAviso({ id: 'ramo-no-servidor', tipo: 'alerta', texto: 'A aba de origem desta conversa não está disponível. Abra o destino original para ramificar.' });
    return null;
  }
  if (remoto) {
    let motor;
    try { motor = (await window.api.motoresDisponiveis(remoto))?.[s.engine]; } catch {}
    if (motor?.disponivel !== true || (motor.capacidades?.fork === false && ['claude', 'codex', 'gemini'].includes(s.engine))) {
      mostrarAviso({ id: 'ramo-no-servidor', tipo: 'alerta', texto: avisoRamoNoServidor(s.engine) });
      return null;
    }
  }
  const origem = { engine: s.engine, cwd: s.cwd, titulo: s.title || '', abaId: aba.id, hist: [],
    model: (s.engine === 'acp' && s.comando) ? s.comando : '',
    tituloAuto: !!(s.tituloAuto || s.nome) };   // leva 41 (B6): nome do Cockpit/seu segue no "(ramo) …"
  // Um id pode existir em dois servidores. Só herda o modelo do mesmo destino.
  let herdado = {};
  if (remoto) {
    const aberto = [...panes.values(), ...panesFundo.values()].find((p) =>
      p.engine === s.engine && p.abaId === aba.id && !p.forkPendente &&
      (p.sessaoId === s.id || p.resumeId === s.id));
    if (aberto) herdado = { model: aberto.model, effort: aberto.effort };
    else if (s.engine === 'claude') {
      try {
        const msgs = listaOuErro(await window.api.sessionHistory({ engine: s.engine, id: s.id, remoto })).itens || [];
        herdado.model = modeloDoHistorico(msgs);
      } catch {}
    }
  } else {
    herdado = await modeloDaOrigem(s);
  }
  if (herdado.model && !origem.model) origem.model = herdado.model;
  if (herdado.effort) origem.effort = herdado.effort;
  // Claude (PC ou servidor): fork do proprio CLI no primeiro start
  if (s.engine === 'claude') {
    const novo = novoPainelRamo(origem, { resumeId: s.id, fork: true });
    faixaDeRamo(novo, origem, null);
    savePanes();
    return novo;
  }
  // Cada adaptador ramifica no destino original da conversa.
  let falhou = '';
  if (s.engine === 'codex' || s.engine === 'gemini') {
    let r = null;
    try { r = await window.api.sessaoFork({ engine: s.engine, id: s.id, remoto }); } catch (e) { r = { error: String(e && e.message || e) }; }
    if (r && r.id) {
      const novo = abrirRamo(origem, r.id, null);
      if (r.aviso) note(novo, r.aviso);
      return novo;
    }
    falhou = (r && r.error) || 'sem resposta';
  }
  // o resto leva um resumo do que foi dito (lido do arquivo, sem abrir a conversa)
  let msgs = [];
  try {
    if (remoto) msgs = listaOuErro(await window.api.sessionHistory({ engine: s.engine, id: s.id, remoto })).itens || [];
    else msgs = (await window.api.sessionHistory({ engine: s.engine, file: s.file, id: s.id })) || [];
  } catch {}
  origem.hist = msgs.filter((m) => m && (m.role === 'user' || m.role === 'bot') && String(m.text || '').trim())
    .map((m) => ({ quem: m.role === 'user' ? 'Você' : nomeDoMotor(s.engine), texto: m.text }));
  if (!origem.hist.length) {
    mostrarAviso({ id: 'ramo-vazio', tipo: 'alerta', texto: 'Não achei o que foi dito em "' + (s.title || 'conversa') + '" para levar a um ramo.' });
    return null;
  }
  const novo = ramoPorContexto(origem, null);
  if (novo && falhou) note(novo, 'Não deu para ramificar de verdade (' + falhou + ') — levei um resumo do que foi dito.', true);
  return novo;
}

/* a conversa da lista ja' esta' aberta em algum destes paineis? Ramo que ainda
   nao nasceu NAO conta: o resumeId dele e' o da ORIGEM, e achar o ramo aqui
   fazia o clique na conversa original cair no painel do ramo. */
function painelDaConversa(lista, id, identidade) {
  if (!id) return undefined;
  const mesmoDestino = (q) => {
    const remoto = remotoDoPane(q), esperado = identidade.remoto;
    return !!remoto === !!esperado && ['host', 'usuario', 'chave', 'porta'].every((campo) =>
      (campo === 'porta' ? Number(remoto?.[campo] ?? 22) : String(remoto?.[campo] || '')) ===
      (campo === 'porta' ? Number(esperado?.[campo] ?? 22) : String(esperado?.[campo] || '')));
  };
  return lista.find((q) =>
    (!identidade || (q.engine === identidade.engine && mesmoDestino(q))) &&
    (q.sessaoId === id || (!q.forkPendente && (q.resumeId === id || q.resumeAnterior === id))));
}

/* chegou o endereco da sessao (evento 'sessao'). No ramo pendente, so' o
   endereco NOVO encerra o fork: se um 'sessao' trouxesse o id da origem e o
   fork fosse esquecido, a proxima religacao continuaria a conversa de ORIGEM
   (dois motores na mesma sessao, se ela estiver aberta em outro painel). */
function aoNascerSessao(P, ev) {
  if (P.forkPendente) {
    if (!ev.id || ev.id === (P.resumeId || P.resumeAnterior)) return;
    /* auditoria 1: no PC o endereco do ramo chega na hora do start (--session-id
       nosso), ANTES de o Claude abrir a origem. Se ele cair ali (origem sumiu,
       conta, rede), o ramo nunca existiu -- dar por nascido virava conversa
       VAZIA rotulada de ramo. So' o init do proprio Claude confirma. */
    if (ev.provisorio) return;
    P.forkPendente = false;
  }
  P.sessaoId = ev.id; P.sessaoFile = ev.file || ''; P.sessaoRemota = !!ev.remoto; P.resumeAnterior = null;
  // auditoria 2: o nome de 3 palavras voando fica sabendo de qual conversa ele e'
  const pedido = P._tituloPedido;
  if (pedido && pedido.chave === P._tituloAutoChave && pedido.engine === P.engine && !pedido.sessao && ev.id) pedido.sessao = String(ev.id);
  savePanes();   // sessaoRemota entra na ficha
  gravarNomeDoPainel(P);   // leva 41 (B6): o nome de 3 palavras (ou o seu) segue pra lista
}

function faixaDeRamo(novo, P, doFim, soResumo, extra) {
  clearEmpty(novo);   // a tela de "painel vazio" ocupa 100% da altura e empurrava a faixa pra fora
  const x = extra || {};
  const d = document.createElement('div');
  d.className = 'troca ramo'; d.innerHTML = '<span></span>';
  const origem = 'Ramo de "' + (P.titulo || 'conversa anterior') + '": ';
  let txt;
  if (soResumo) txt = 'levou um resumo do que foi dito, não a conversa inteira. A original não muda. Escreva pra continuar.';
  else if (x.antes && x.vazio) txt = 'aquela era a primeira mensagem, então o ramo começa do zero. Ela voltou pro campo.';
  else if (x.antes) txt = 'levou a conversa até antes daquela mensagem, que voltou pro campo. Mande de novo ou mude. A original não muda.';
  else if (doFim != null) txt = 'levou a conversa até aquele ponto. A original não muda. Escreva pra continuar.';
  else txt = 'levou a conversa inteira. A original não muda. Escreva pra continuar.';
  $('span', d).textContent = origem + txt;
  novo.chat.appendChild(d);
  const c = $('.p-input', novo.el); if (c) c.focus();
}

/* ===================== PLANO VIVO DO TURNO =====================
   A checklist que o proprio agente mantem (TodoWrite no Claude, turn/plan no
   Codex, write_todos no Gemini) vira um bloco fixo acima do campo: da' pra ver
   onde ele esta' sem rolar a conversa. */
function desenharPlano(P, itens) {
  if (window.CockpitUI) return window.CockpitUI.plan(P, itens);
  P.plano = Array.isArray(itens) ? itens : [];
  let cx = $('.pane-plano', P.el);
  if (!P.plano.length) { if (cx) cx.remove(); return; }
  if (!cx) {
    cx = document.createElement('div');
    cx.className = 'pane-plano';
    P.el.insertBefore(cx, $('.pane-perg', P.el));
    if (P.planoAberto === undefined) P.planoAberto = true;
  }
  const feitos = P.plano.filter((x) => x.estado === 'feito').length;
  cx.innerHTML = '';
  const cab = document.createElement('button');
  cab.className = 'pl-cab';
  cab.innerHTML = '<span class="pl-seta"></span><span class="pl-tit">Plano</span><span class="pl-conta"></span><span class="pl-barra"><span class="pl-cheio"></span></span>';
  $('.pl-seta', cab).innerHTML = ico(P.planoAberto ? 'chevron-down' : 'chevron-right');
  $('.pl-conta', cab).textContent = feitos + '/' + P.plano.length;
  $('.pl-cheio', cab).style.width = Math.round((feitos / P.plano.length) * 100) + '%';
  cab.title = P.planoAberto ? 'Recolher o plano' : 'Abrir o plano';
  cab.addEventListener('click', (e) => { e.stopPropagation(); P.planoAberto = !P.planoAberto; desenharPlano(P, P.plano); });
  cx.appendChild(cab);
  if (P.planoAberto) {
    const corpo = document.createElement('div');
    corpo.className = 'pl-corpo';
    for (const it of P.plano) {
      const d = document.createElement('div');
      d.className = 'pl-item pl-' + (it.estado || 'pendente');
      d.innerHTML = '<span class="pl-pt"></span><span class="pl-txt"></span>';
      $('.pl-txt', d).textContent = it.txt || '';
      corpo.appendChild(d);
    }
    cx.appendChild(corpo);
    corpo.scrollTop = corpo.scrollHeight;   // o passo atual costuma ser o ultimo
  }
}
function limparPlano(P) {
  $('.ck-plan', P.el)?.remove();
  if (!P) return;
  P.plano = [];
  const cx = P.el && $('.pane-plano', P.el);
  if (cx) cx.remove();
}

/* ===================== SUGESTAO DE PROXIMA MENSAGEM =====================
   O Claude preve a proxima mensagem depois de cada turno (--prompt-suggestions).
   Vira chip discreto acima do campo: clicou, preencheu - NUNCA envia sozinho. */
/* Um simbolo so' na barra de baixo, nao 1 ou 2 chips de texto acima do campo:
   a frase inteira vive no title (hover). Com UMA sugestao o clique ja' preenche;
   com DUAS abre o menu, senao nao daria pra escolher. */
function mostrarSugestoes(P, itens) {
  limparSugestoes(P);
  if (cfg.sugestoes === false) return;
  const lista = (itens || []).filter(Boolean).slice(0, 2);
  if (!lista.length) return;
  const bar = $('.cmp-bar', P.el);
  if (!bar) return;
  const box = document.createElement('div');
  box.className = 'p-sugs';
  const bt = document.createElement('button');
  bt.className = 'sug-chip';
  bt.innerHTML = ico('sparkles');
  bt.title = (lista.length > 1
    ? 'Sugestões dele — clique pra escolher (não envia sozinho):\n'
    : 'Sugestão dele — clique pra preencher o campo (não envia sozinho):\n')
    + lista.map((t) => '• ' + t).join('\n');
  bt.addEventListener('click', (e) => {
    e.stopPropagation();
    if (lista.length === 1) return usarSugestao(P, lista[0]);
    menuSugestoes(P, lista);
  });
  box.appendChild(bt);
  /* antes do Continuar, pra ordem na barra nao depender de quem apareceu primeiro */
  bar.insertBefore(box, $('.p-cont', P.el) || $('.p-stop', P.el));
}
function usarSugestao(P, t) {
  if (!P || !P.el) return;
  /* a sugestao ja' caducou (turno novo comecou e zerarTurno limpou o chip):
     nao atropela o que ele escreveu nesse meio-tempo */
  if (!$('.p-sugs', P.el)) return;
  const inp = $('.p-input', P.el);
  if (!inp) return;
  inp.value = t;
  inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 190) + 'px';
  inp.focus();
  limparSugestoes(P);
}
function menuSugestoes(P, lista) {
  const m = novoMenu(P);
  m.classList.add('menu-sugs');   // marca pra limparSugestoes fechar SO' este menu
  m.appendChild(tituloPopup('Sugestões'));
  m.appendChild(subPopup('Preenche o campo — não envia sozinho.'));
  /* o rotulo corta em 90 (o texto inteiro continua indo pro campo): sugestao
     longa do motor esticava o menu sem limite */
  for (const t of lista) {
    m.appendChild(elItem({ ic: 'sparkles', nome: t.length > 90 ? t.slice(0, 90) + '…' : t }, () => usarSugestao(P, t)));
  }
}
function limparSugestoes(P) {
  const b = P && P.el && $('.p-sugs', P.el);
  if (b) b.remove();
  /* O menu das 2 sugestoes sobrevivia ao chip: zerarTurno limpa a sugestao em
     TODO 'busy', e um clique atrasado no menu esquecido sobrescrevia o que o
     Hugo ja' tinha comecado a escrever. So' fecha se o menu ABERTO for o de
     sugestao ('como-menu' sai no fechamento; a marca 'menu-sugs' fica no cx ate'
     o proximo novoMenu reescrever o className -- por isso as duas condicoes).
     fecharMenus() normal, nao o (false): o (false) e' exclusividade do novoMenu
     (contrato em testes/teste-remoto-tela.js). Matar a busca do "@" aqui nao
     custa nada -- ela usa o MESMO .p-modal, entao nunca esta' em voo junto. */
  if (P && P.el && $('.p-modal.como-menu .modal-cx.menu-sugs', P.el)) fecharMenus();
}

/* ===================== AUDITORIA DE AUTONOMIA =====================
   O que rodou sem perguntar (liberado por "sempre permitir") deixava so' um
   aviso que some. Agora fica contado num distintivo no cabecalho do painel,
   com a lista completa a um clique - confianca auditavel, nao cega. */
function registrarAuto(P, ev) {
  (P.autoAcoes = P.autoAcoes || []).push({ tool: (ev && ev.tool) || 'ferramenta', arg: String((ev && ev.arg) || ''), quando: Date.now() });
  pintarAuditoria(P);
}
function pintarAuditoria(P) {
  const n = (P.autoAcoes || []).length;
  let bt = $('.p-audit', P.el);
  if (!n) { if (bt) bt.remove(); return; }
  if (!bt) {
    bt = document.createElement('button');
    bt.className = 'p-audit';
    bt.title = 'Ações que rodaram sem perguntar neste painel — clique pra ver';
    const dot = $('.p-dot', P.el);
    if (!dot) return;
    dot.parentElement.insertBefore(bt, dot);
    bt.addEventListener('click', (e) => {
      e.stopPropagation();
      const pop = abrirPopGlobal(bt);
      const cab = document.createElement('div');
      cab.className = 'menu-secao';
      cab.textContent = 'Rodou sem perguntar (' + (P.autoAcoes || []).length + ')';
      pop.appendChild(cab);
      for (const a of (P.autoAcoes || []).slice(-30).reverse()) {
        const d = document.createElement('div');
        d.className = 'mi';
        d.innerHTML = '<div class="mi-ic"></div><div class="mi-txt"><div class="mi-n"></div><div class="mi-d"></div></div>';
        $('.mi-ic', d).innerHTML = ico('zap');
        $('.mi-n', d).textContent = toolLabel(a.tool);
        $('.mi-d', d).textContent = (a.arg ? a.arg.slice(0, 70) + '  ·  ' : '') + quando(a.quando);
        pop.appendChild(d);
      }
    });
  }
  bt.innerHTML = ico('zap') + '<span>' + n + '</span>';
}
function limparAuditoria(P) {
  if (!P) return;
  P.autoAcoes = [];
  const bt = P.el && $('.p-audit', P.el);
  if (bt) bt.remove();
}

/* ===================== RASTRO DO TURNO (uso + mudancas) ===================== */
function zerarTurno(P) {
  P.usoTurno = null;
  P.mudancasTurno = [];
  P.mudancasPendentes = null;   // passo do turno anterior que nunca terminou nao conta
  P.diffTurno = '';
  P.printsTurno = [];
  limparSugestoes(P);
  limparContinuar(P);
}
const fmtK = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n || 0));
function arquivosDoDiffUnificado(diff) {
  const m = String(diff || '').match(/^diff --git /gm);
  return m ? m.length : 1;
}
function mostrarMudancasDoTurno(P) {
  const modal = $('.p-modal', P.el), cx = $('.modal-cx', modal);
  modal.classList.remove('hidden');
  modal.onclick = (e) => { if (e.target === modal) fecharModal(P); };
  cx.className = 'modal-cx';
  cx.onclick = (e) => e.stopPropagation();
  cx.innerHTML = '<div class="mo-top"><span class="mo-tit">O que mudou neste turno</span><button class="mo-x">' + ico('x') + '</button></div>';
  $('.mo-x', cx).onclick = () => fecharModal(P);
  const corpo = document.createElement('div');
  corpo.className = 'mo-lista';
  cx.appendChild(corpo);
  if (P.diffTurno) {
    // o Codex manda o diff agregado pronto (turn/diff/updated): desenha como o do git
    const box = document.createElement('div');
    box.className = 'diff diff-git';
    for (const linha of String(P.diffTurno).split('\n').slice(0, 4000)) {
      const d = document.createElement('div');
      const t = linha.startsWith('+') && !linha.startsWith('+++') ? 'mais'
        : linha.startsWith('-') && !linha.startsWith('---') ? 'menos'
        : linha.startsWith('@@') || linha.startsWith('diff --git') ? 'pulo' : 'igual';
      d.className = t === 'pulo' ? 'df-pulo' : 'df-l df-' + t;
      d.textContent = linha;
      box.appendChild(d);
    }
    corpo.appendChild(box);
    return;
  }
  for (const m of (P.mudancasTurno || [])) {
    const tit = document.createElement('div');
    tit.className = 'menu-secao';
    tit.textContent = m.path || 'arquivo';
    corpo.appendChild(tit);
    corpo.appendChild(elDiff(m.mudanca));
  }
  if (!(P.mudancasTurno || []).length) corpo.innerHTML = '<div class="mo-carregando">Nenhuma mudança de arquivo neste turno.</div>';
}

/* ===================== AVISO DO AGENTE (PushNotification) =====================
   O agente decidiu que voce precisa saber de algo AGORA. O CLI, sem terminal,
   descartava ("not sent"); o main intercepta a chamada e ela chega aqui:
   cartao na conversa (fica), tarja no topo (com "ir pro painel") e aviso do
   sistema quando a janela ou o painel estao fora de vista. */
function avisoDoAgente(P, texto) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!t) return;
  clearEmpty(P);
  const d = document.createElement('div');
  d.className = 'aviso-agente';
  d.innerHTML = '<span class="ag-ic"></span><span class="ag-txt"></span>';
  $('.ag-ic', d).innerHTML = ico('zap');
  $('.ag-txt', d).textContent = t;
  d.setAttribute('role', 'status');
  // o cartao entra DEPOIS da caixa de passos atual (selada); o passo da propria
  // notificacao, que o main manda em seguida, abre outra caixa embaixo
  selarPassos(P);
  P.chat.appendChild(d);
  if (P.trabEl) P.chat.appendChild(P.trabEl);
  scroll(P);
  const nome = P.titulo || 'Painel';
  mostrarAviso({
    id: 'agente-' + P.id, tipo: 'alerta', texto: nome + ': ' + t, reseta: String(Date.now()),
    acao: 'ir pro painel',
    aoClicar: () => irAoPainel(P),
  });
  if (document.hidden || !painelVisivel(P)) {
    try { new Notification('Cockpit — ' + nome, { body: t }); } catch {}
  }
}

/* leva voce ate' o painel, inclusive quando ele esta' em OUTRA aba (mesma
   regra do "ir" da tarja de atencao) */
function irAoPainel(P) {
  const focar = (Q) => { marcarConclusaoLida(Q); setFocus(Q); irAtePainel(Q); piscar(Q); const c = $('.p-input', Q.el); if (c) c.focus(); };
  if (panes.has(P.id)) return focar(P);
  if (P.abaId && P.abaId !== cfg.abaAtiva) {
    trocarAbaLocal(P.abaId).then(() => {
      const Q = panes.get(P.id) || [...panes.values()].find((q) => q.sessaoId && q.sessaoId === (P.sessaoId || P.resumeId));
      if (Q) focar(Q);
    });
  }
}

/* ===================== CONTINUAR A UM CLIQUE =====================
   Chip fixo quando o painel esta' parado com conversa; Enter no campo vazio
   manda o mesmo "continue". Nunca aparece com trabalho rodando ou fila. */
function podeContinuar(P) { return !!(P && !P.busy && !P.queued && !P.morto && P.hist && P.hist.length); }
/* ===================== ROBO EM SEGUNDO PLANO =====================
   Agente ou comando lancado pra rodar FORA do turno: o turno acaba, o painel
   fica "parado" e o trabalho continua sem nada na tela. Este chip e' o unico
   sinal de que ainda tem robo trabalhando por tras.

   Ele NAO some sozinho por tempo: sai quando a conclusao chega (o main casa
   pelo mesmo tool_use_id do lancamento). Robo que morre sem avisar - que
   acontece de verdade quando a sessao reinicia no meio - deixa o chip na
   tela com o tempo subindo, que e' exatamente o aviso que faltava. */
function roboDoPainel(P, ev) {
  if (!P.robos) P.robos = new Map();
  /* chega a lista INTEIRA, nao um evento de comeco/fim: espelha. O t0 de quem
     ja estava na lista e' preservado, senao o "ha X" reiniciaria a cada
     mudanca (um robo que entra zeraria o relogio do que ja estava rodando). */
  const agora = Date.now();
  const nova = new Map();
  for (const t of (ev.tarefas || [])) {
    const antigo = P.robos.get(t.id);
    nova.set(t.id, { tipo: t.tipo, desc: t.desc, t0: (antigo && antigo.t0) || agora });
  }
  P.robos = nova;
  pintarRobos(P);
  if (!panes.has(P.id) && panesFundo.has(P.id)) pintarAbasLocal();   // aba fora da tela tambem mostra
}
function pintarRobos(P) {
  window.CockpitUI?.refresh();
  if (!P || !P.el) return;
  const antigo = $('.p-robos', P.el); if (antigo) antigo.remove();
  const n = P.robos ? P.robos.size : 0;
  if (!n) { if (P.relogioRobos) { clearInterval(P.relogioRobos); P.relogioRobos = 0; } return; }
  const cmp = $('.pane-cmp', P.el); if (!cmp) return;
  const box = document.createElement('div');
  box.className = 'p-robos';
  const maisVelho = Math.min(...[...P.robos.values()].map((r) => r.t0));
  const ico = document.createElement('span');
  ico.className = 'robo-ico';
  ico.textContent = '🤖';
  const txt = document.createElement('span');
  txt.className = 'robo-txt';
  txt.textContent = n === 1 ? 'um robô trabalhando' : n + ' robôs trabalhando';
  const tempo = document.createElement('span');
  tempo.className = 'robo-tempo';
  tempo.textContent = 'há ' + duracaoCurta(Date.now() - maisVelho);
  box.append(ico, txt, tempo);
  box.title = [...P.robos.values()].map((r) => '• ' + (r.desc || r.tipo)).join('\n')
    + '\n\nSai sozinho quando o robô terminar.';
  cmp.insertBefore(box, $('.cmp-top', P.el));
  // o "há X" precisa andar sozinho: sem isso o chip mente depois do primeiro minuto
  if (!P.relogioRobos) P.relogioRobos = setInterval(() => pintarRobos(P), 10000);
}
/* Mora na barra de baixo, ao lado do Enviar, e e' so' o simbolo: o nome vive no
   title (hover), como os outros botoes da barra. Ocupava uma linha inteira acima
   do campo -- texto na tela que o Hugo le uma vez e nunca mais. */
function mostrarContinuar(P) {
  limparContinuar(P);
  if (!podeContinuar(P)) return;
  const bar = $('.cmp-bar', P.el);
  if (!bar) return;
  const box = document.createElement('div');
  box.className = 'p-cont';
  const bt = document.createElement('button');
  bt.className = 'cont-chip';
  bt.innerHTML = ico('chevron-right');
  bt.title = 'Continuar — manda "continue" (Enter no campo vazio faz o mesmo)';
  bt.addEventListener('click', (e) => { e.stopPropagation(); enviarContinue(P); });
  box.appendChild(bt);
  bar.insertBefore(box, $('.p-stop', P.el));
}
function limparContinuar(P) {
  const b = P && P.el && $('.p-cont', P.el);
  if (b) b.remove();
}
function enviarContinue(P) {
  if (contaEmAlteracao(P)) { note(P, 'Conclua ou feche a alteração de conta antes de continuar.'); return; }
  if (!podeContinuar(P)) return;
  const inp = $('.p-input', P.el);
  if (!inp || inp.value.trim()) return;   // tem texto escrito: nao atropela
  inp.value = 'continue';
  send(P);
}

/* ===================== ULTIMA FALA COMO LEGENDA =====================
   Num turno de 20 minutos a unica pista era o relogio: as frases-narracao do
   agente somem no scroll. A ultima frase curta vira legenda do "trabalhando…". */
function legendaDaFala(texto) {
  // o corpo de uma cerca de codigo fora ("const x = 1;" nao e' legenda)
  const cauda = String(texto || '').slice(-600).replace(/```[\s\S]*?(```|$)/g, '');
  const linhas = cauda.split('\n')
    .filter((l) => !/^\s*(\||```|~~~)/.test(l))                      // linha de tabela e cerca de codigo nao sao legenda
    .map((l) => l.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')          // [texto](url) e ![alt](url) -> texto
      .replace(/^[\s#>*\-•\d.)]+/, '').replace(/[*_`~]/g, '').trim())
    .filter((l) => l.length > 2 && !/^[|:\-\s]+$/.test(l));
  const ult = linhas[linhas.length - 1] || '';
  return ult.length > 90 ? ult.slice(0, 88).trimEnd() + '…' : ult;
}
function legendarTrabalho(P, texto) {
  if (!P || !P.busy || !P.trabEl) return;
  const el = $('.trab-txt', P.trabEl);
  if (!el) return;
  const leg = legendaDaFala(texto);
  el.textContent = leg ? 'trabalhando… ' + leg : 'trabalhando…';
  el.title = leg;
}

/* ===================== RETOMADA HONESTA =====================
   Ao retomar um turno cortado, o proprio CLI injeta "Continue from where you
   left off." - e a tela desenhava como fala sua, em ingles. */
function marcaDoSistema(text) {
  const t = String(text || '').trim();
  if (/^Continue from where you left off\.?$/i.test(t)) return 'retomado automaticamente depois de reiniciar';
  if (/^\[Request interrupted by user( for tool use)?\]$/i.test(t)) return 'você interrompeu aqui';
  return '';
}

/* ===================== PRINTS DO AGENTE =====================
   Imagem dentro do resultado de uma ferramenta (o agente tirou um print) vira
   miniatura no proprio passo; clique abre grande. No carimbo do turno, a
   galeria. Antes era jogada fora: 85 prints invisiveis em 30 dias. */
function mostrarPrintsDoPasso(P, d, imagens) {
  const lista = (imagens || []).filter((im) => im && im.dados).slice(0, 4);
  if (!lista.length) return;
  P.printsTurno = P.printsTurno || [];
  let cx = d ? $('.pa-imgs', d) : null;
  if (d && !cx) { cx = document.createElement('div'); cx.className = 'pa-imgs'; d.appendChild(cx); }
  for (const im of lista) {
    const src = 'data:' + (im.mime || 'image/png') + ';base64,' + im.dados;
    if (P.printsTurno.length < 40) P.printsTurno.push(src);
    if (!cx) continue;
    const img = document.createElement('img');
    img.className = 'pa-img';
    img.src = src;
    img.alt = 'print tirado pelo agente';
    img.title = 'Print que o agente tirou — clique pra ver grande';
    img.addEventListener('click', (e) => { e.stopPropagation(); verImagemGrande(src); });
    cx.appendChild(img);
  }
  if (d) d.classList.add('com-print');
  scroll(P);
}
function mostrarPrintsDoTurno(P, lista) {
  const modal = $('.p-modal', P.el), cx = $('.modal-cx', modal);
  modal.classList.remove('hidden');
  modal.onclick = (e) => { if (e.target === modal) fecharModal(P); };
  cx.className = 'modal-cx';
  cx.onclick = (e) => e.stopPropagation();
  cx.innerHTML = '<div class="mo-top"><span class="mo-tit">O que ele viu neste turno</span><button class="mo-x">' + ico('x') + '</button></div>';
  $('.mo-x', cx).onclick = () => fecharModal(P);
  const corpo = document.createElement('div');
  corpo.className = 'mo-lista mo-prints';
  for (const src of (lista || [])) {
    const img = document.createElement('img');
    img.className = 'mo-print';
    img.alt = 'print tirado pelo agente';
    img.src = src;
    img.addEventListener('click', () => verImagemGrande(src));
    corpo.appendChild(img);
  }
  cx.appendChild(corpo);
}

/* ===================== RECIBO DO TURNO =====================
   Turno longo termina com "## Recibo" (o que fiz · o que mudou · como testar),
   pedido nas instrucoes da casa. Aqui ele vira um cartao destacado no fim da
   fala, em vez de mais um titulo perdido no texto. */
function marcarRecibo(el) {
  if (!el || el.querySelector('.recibo')) return;
  const cabs = [...el.querySelectorAll('h1,h2,h3,h4')];
  // titulo SO' "Recibo" (ou "Recibo do turno"): "Recibo de pagamento" e' assunto, nao fecho
  const cab = cabs.find((h) => /^\s*recibo(\s+do\s+turno)?\s*:?\s*$/i.test(h.textContent || ''));
  if (!cab || cab.parentNode !== el) return;   // so' no nivel de cima da fala
  const nivel = (h) => Number(h.tagName[1]) || 9;
  // tem outra secao do mesmo nivel (ou acima) depois dele: nao e' o fecho, nao engole o resto
  if (cabs.slice(cabs.indexOf(cab) + 1).some((h) => nivel(h) <= nivel(cab))) return;
  const cx = document.createElement('div');
  cx.className = 'recibo';
  el.insertBefore(cx, cab);
  let n = cab;
  while (n) { const prox = n.nextSibling; cx.appendChild(n); n = prox; }
  cab.classList.add('recibo-tit');
}

/* ===================== PERFIS DE CONECTORES =====================
   Cada aba escolhe quais conectores (MCP) os paineis do Claude carregam. A
   lista de nomes vem do 'system init' das sessoes; o que a aba desliga vai pro
   start como --disallowedTools (tira do contexto: medido 635 -> 475 ferramentas
   desligando so' dois). */
function registrarConectores(itens, P) {
  const nomes = (itens || []).map((x) => String((x && x.nome) || '').trim()).filter(Boolean);
  if (!nomes.length) return;
  const antes = Array.isArray(cfg.conectoresVistos) ? cfg.conectoresVistos : [];
  /* conector de PROJETO (escopo de projeto do ~/.claude.json, .mcp.json) so' aparece
     nas sessoes daquela pasta: substituir a lista pela de UMA sessao o apagava do
     editor. Fica a uniao; some so' quem nao e' visto ha' 30 dias. */
  const quando = (cfg.conectoresQuando && typeof cfg.conectoresQuando === 'object') ? cfg.conectoresQuando : {};
  const agora = Date.now();
  for (const n of antes) if (quando[n] == null) quando[n] = agora;   // lista antiga sem data: conta a partir de agora
  for (const n of nomes) quando[n] = agora;
  const limite = agora - 30 * 24 * 60 * 60 * 1000;
  const novos = [...new Set([...antes, ...nomes])].filter((n) => (quando[n] || 0) >= limite).slice(0, 120);
  for (const n of Object.keys(quando)) if (!novos.includes(n)) delete quando[n];
  const mudouData = nomes.some((n) => antes.includes(n));   // so' renovou a data: grava tambem, sem barulho
  cfg.conectoresQuando = quando;
  if (mudouData || novos.length !== antes.length || novos.some((n, i) => n !== antes[i])) { cfg.conectoresVistos = novos; window.api.setConfig(cfg); }
}
function conectoresForaDaAba(P) {
  if (!P || P.engine !== 'claude' || remotoDoPane(P)) return undefined;
  const aba = abaPorId(P.abaId);
  const lista = aba && Array.isArray(aba.conectoresFora) ? aba.conectoresFora.filter(Boolean) : [];
  return lista.length ? lista : undefined;
}

/* ===================== PASTAS GIT ISOLADAS =====================
   O Cockpit cria a arvore no Git e usa seu cwd real nos dois motores.
   Worktrees antigas criadas pela flag Claude continuam reconhecidas. */
function perguntarTexto(titulo, dica, inicial) {
  return new Promise((res) => {
    const cx = abrirModalGlobal();
    cx.innerHTML = '<div class="mo-top"><span class="mo-tit"></span><button class="mo-x">' + ico('x') + '</button></div>'
      + '<div class="mo-sub"></div><div class="mo-form"><input id="pedirTextoInp" maxlength="120"></div>'
      + '<div class="mo-rodape"><button class="mo-btn destaque" id="pedirTextoOk">OK</button><button class="mo-btn" id="pedirTextoCancela">Cancelar</button></div>';
    $('.mo-tit', cx).textContent = titulo;
    $('.mo-sub', cx).textContent = dica || '';
    const inp = $('#pedirTextoInp', cx);
    inp.value = inicial || '';
    let feito = false;
    const fim = (v) => { if (feito) return; feito = true; fecharModalGlobal(); res(v); };
    aoFecharModalGlobal = () => fim(null);   // veu/Esc: quem esperava a resposta nao fica pendurado
    $('.mo-x', cx).onclick = () => fim(null);
    $('#pedirTextoCancela', cx).onclick = () => fim(null);
    $('#pedirTextoOk', cx).onclick = () => fim(inp.value);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); fim(inp.value); }
      // auditoria 1: o Esc e' desta caixa. Subindo, chegava no Esc global com o
      // modal ja' fechado -- e parava a IA do painel em foco
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fim(null); }
    });
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
  });
}
function cwdGitDoPainel(P) {
  return !P.managedWorktree && P.worktree
    ? P.cwd.replace(/[\\/]+$/, '') + '/.claude/worktrees/' + P.worktree : P.cwd;
}

async function alternarWorktree(P) {
  if (!['codex', 'claude'].includes(P.engine)) { note(P, 'As pastas isoladas estão disponíveis nos painéis Codex e Claude.', true); return; }
  if (remotoDoPane(P)) { note(P, 'As pastas isoladas deste menu são locais.', true); return; }
  if (P.busy || P.ligando || P._trocando || P._worktreeBusy) { note(P, 'Espere o trabalho terminar ou pare o painel antes de trocar de pasta.', true); return; }
  const origem = P.cwd, motor = P.engine;
  const cx = abrirModalGlobal();
  cx.innerHTML = '<div class="mo-top"><span class="mo-tit">Pastas Git isoladas</span><button class="mo-x">' + ico('x') + '</button></div><div class="mo-sub">Carregando as pastas deste repositório…</div><div class="mo-lista"></div><div class="mo-rodape"><button class="mo-btn destaque" data-wt="criar">Criar pasta isolada…</button></div>';
  $('.mo-x', cx).onclick = fecharModalGlobal;
  const btCriar = $('[data-wt="criar"]', cx);
  btCriar.disabled = true;
  let catalog;
  try {
    catalog = await window.api.gitWorktreesList({ cwd: cwdGitDoPainel(P) });
    if (catalog.error && P.managedWorktree) catalog = await window.api.gitWorktreesList({ cwd: P.managedWorktree.root });
    // Worktree legado ainda pendente so nasce na primeira mensagem Claude.
    if (catalog.error && P.worktree && !P.managedWorktree) catalog = await window.api.gitWorktreesList({ cwd: P.cwd });
  } catch (error) { catalog = { error: String(error.message || error) }; }
  if (!cx.isConnected || P.morto || P.cwd !== origem || P.engine !== motor) return;
  if (catalog.error) { $('.mo-sub', cx).textContent = catalog.error; return; }
  $('.mo-sub', cx).textContent = 'Cada pasta tem sua branch. Criar usa o último commit da pasta atual; alterações ainda não commitadas ficam onde estão. Abrir outra pasta inicia conversas novas nos dois motores.';
  const lista = $('.mo-lista', cx);
  for (const item of catalog.items) {
    const row = document.createElement('div'); row.className = 'co';
    row.innerHTML = '<span class="co-txt"><span class="co-n"></span><span class="co-s"></span></span><button class="co-bt">Abrir</button>';
    $('.co-n', row).textContent = (item.isMain ? 'Pasta principal' : item.branch || 'Commit isolado') + (item.isCurrent ? ' · atual' : '');
    $('.co-s', row).textContent = item.path + (item.locked ? ' · protegida no Git' : '') + (item.prunable ? ' · indisponível' : '');
    const button = $('.co-bt', row);
    button.disabled = item.prunable || (item.isCurrent && !P.worktree);
    button.textContent = item.isMain && (P.managedWorktree || P.worktree) ? 'Voltar à principal' : 'Abrir';
    button.onclick = async () => {
      if (P.cwd !== origem || P.engine !== motor) return;
      fecharModalGlobal();
      await aplicarWorktree(P, item);
    };
    lista.appendChild(row);
  }
  btCriar.disabled = false;
  btCriar.onclick = async () => {
    if (P.cwd !== origem || P.engine !== motor) return;
    const name = await perguntarTexto('Criar pasta Git isolada', 'Nome curto (letras, números, hífen ou sublinhado). A branch será cockpit/nome. Os arquivos da pasta atual ficam preservados.', 'exp-' + new Date().toISOString().slice(5, 10).replace('-', ''));
    if (!name || P.morto || P.cwd !== origem || P.engine !== motor || P.busy || P.ligando || P._trocando) return;
    P._worktreeBusy = true;
    try {
      const result = await window.api.gitWorktreesCreate({ cwd: catalog.currentPath, name: name.trim() });
      if (result.error) { note(P, result.error, true); return; }
      if (P.morto || P.cwd !== origem || P.engine !== motor || P.busy || P.ligando || P._trocando) {
        if (!P.morto) note(P, 'Pasta criada em ' + result.path + '. Abra pelo menu quando terminar o trabalho.');
        return;
      }
      P._worktreeBusy = false;
      await aplicarWorktree(P, result);
    } catch (error) { note(P, String(error.message || error), true); }
    finally { P._worktreeBusy = false; }
  };
}

async function aplicarWorktree(P, item) {
  if (P.busy || P.ligando || P._trocando || P._worktreeBusy || P.morto) return;
  const origem = P.cwd, motor = P.engine;
  let ownEngineLock = false;
  P._worktreeBusy = true;
  try {
    const target = item || { path: P.managedWorktree ? P.managedWorktree.root : P.cwd };
    const verified = await window.api.gitWorktreesOpen({ cwd: (P.managedWorktree && P.managedWorktree.root) || P.cwd, path: target.path });
    if (verified.error) { note(P, verified.error, true); return; }
    if (P.morto || P.cwd !== origem || P.engine !== motor || P.busy || P.ligando || P._trocando) return;
    // Bloqueia uma troca de motor concorrente durante o fechamento do processo.
    P._trocando = true;
    ownEngineLock = true;
    guardarEstadoDoMotor(P);
    await window.api.paneStop({ paneId: P.id, engine: P.engine });
    if (P.morto || P.cwd !== origem || P.engine !== motor) return;
    destravarPainel(P);
    limparSessoesDeTodosMotores(P);
    P.cwd = verified.path;
    P.managedWorktree = verified.isMain ? null : { root: verified.root, path: verified.path, branch: verified.branch };
    P.worktree = null;
    P.resumeId = null; P.sessaoId = null; P.sessaoFile = ''; P.resumeAnterior = null; P.sessaoRemota = false;
    P.started = false; P.forkPendente = false; P.passarContexto = null;
    P.tokens = 0; P.janela = 0; P.titulo = ''; P.nomeManual = false; P.hist = [];
    esquecerTituloAuto(P);   // leva 41 (B6): conversa nova, nome novo
    P.chat.innerHTML = ''; P.blocks.clear(); P.tools.clear(); esquecerPassos(P);
    P.anexos = []; pintarAnexos(P); pintarTokens(P); pintarNome(P); esconderPermissao(P);
    limparPlano(P); limparAuditoria(P); zerarTurno(P); P.avisoModelo = null; P.acpInfo = null; P.acpModelos = null;
    mostrarPastaNoPainel(P); atualizarGit(P); setDot(P, 'off'); savePanes();
    if (focusPane === P) { loadTree(P.cwd, null); $('#tbTitle').textContent = shortPath(P.cwd) + '  ·  ' + nomeDoMotor(P.engine); }
    note(P, (verified.isMain ? 'Pasta principal: ' : 'Pasta isolada: ') + shortPath(P.cwd) + '. Conversas novas; arquivos preservados.');
  } catch (error) { note(P, String(error.message || error), true); }
  finally { P._worktreeBusy = false; if (ownEngineLock) P._trocando = false; }
}

/* ===================== TORRE DE CONTROLE =====================
   Uma tela com TODAS as sessoes: cada painel de cada aba (o que esta fazendo,
   ha' quanto tempo, se parou esperando voce) e as sessoes do Claude que rodam
   FORA do Cockpit nesta maquina (VS Code, terminal, Telegram). O maestro vendo
   o palco inteiro - antes so' havia uma bolinha por aba. */
/* As sessoes de fora (claude agents --json). 'quando' e' a hora da ULTIMA
   LEITURA BOA, carimbada so' na VOLTA -- antes era carimbada na ida, e o tique
   de 4 s no meio da busca pintava "nenhuma" com a lista ainda voando. 'pedido'
   so' segura o intervalo pra nao pedir de novo a cada tique. */
let torreAgentes = { quando: 0, pedido: 0, itens: [], erro: '', buscando: false };
let torreGen = 0;   // busca em voo: a mais nova ganha, a antiga nao mexe na lista
function torreVisivel() {
  return viewLateralVisivel('torre');
}
function estadoDoPainel(P) {
  if (P.pedindoPerm || (P.filaPerm && P.filaPerm.length)) return { txt: 'esperando você autorizar', cls: 'espera' };
  if (P.perguntaAberta && P.perguntaAberta.bloqueante !== false) return { txt: 'esperando sua resposta', cls: 'espera' };
  if (P.busy) {
    const el = P.trabEl && $('.trab-txt', P.trabEl);
    const leg = el ? String(el.textContent || '').replace(/^trabalhando…\s*/, '') : '';
    return { txt: 'trabalhando há ' + duracaoCurta(Date.now() - (P.t0 || Date.now())) + (leg ? ' · ' + leg : ''), cls: 'ocupado' };
  }
  if (P.queued) return { txt: 'com mensagem na fila', cls: 'parado' };
  if (P.started) return { txt: 'parado, motor ligado', cls: 'parado' };
  if (P.hist && P.hist.length) return { txt: 'parado', cls: 'parado' };
  // ramo recem-aberto (ou conversa pra retomar) nao e' painel vazio: tem historia esperando
  if (P.resumeId) return { txt: P.forkPendente ? 'ramo pronto: escreva pra continuar' : 'conversa pronta pra continuar', cls: 'parado' };
  return { txt: 'vazio', cls: 'vazio' };
}
/* Titulo da linha: o do painel; sem ele, a primeira coisa que voce escreveu;
   sem nada, "nova conversa" (antes era "sem título", N vezes). */
function tituloNaTorre(P) {
  if (P.titulo) return P.titulo;
  const primeira = (P.hist || []).find((h) => h && h.quem === 'Você' && String(h.texto || '').trim());
  if (!primeira) return 'nova conversa';
  const t = String(primeira.texto).replace(/\s+/g, ' ').trim();
  return t.length > 60 ? t.slice(0, 59) + '…' : t;
}
/* O texto da secao "Claude fora do Cockpit" nos seus 3 estados: esperando a
   primeira resposta, leu e nao ha' nada, nao conseguiu ler (a ultima lista boa
   continua por baixo, marcada como antiga). Mesmo desenho das Rotinas. */
function rotuloDasSessoesDeFora({ quando, erro, n }) {
  const hora = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (erro) return 'não consegui listar: ' + erro + (n && quando ? ' · mostrando a lista das ' + hora(quando) : '');
  if (!quando) return 'lendo…';
  if (!n) return 'nenhuma · conferido às ' + hora(quando);
  return n + (n === 1 ? ' sessão' : ' sessões') + ' · conferido às ' + hora(quando);
}
/* Quem e' de fora de verdade. "Daqui" e' so' a conversa com o motor LIGADO num
   painel deste Cockpit (id atual do painel) ou o processo que ele abriu (o main
   marca 'daqui' pelo pid). Antes bastava um painel APONTAR pro id (ficha
   guardada, resumeId) pra conversa viva no terminal sumir da lista -- e ai' dois
   processos escreviam na mesma conversa sem ninguem ver. Agora ela fica, com a
   nota de onde tambem esta' guardada. */
function separarSessoesDeFora(externas, vivos, guardadas) {
  const lista = (externas || []).filter((a) => a && a.sessionId);
  const deCa = new Set(lista.filter((a) => a.daqui).map((a) => a.sessionId));
  const vistos = new Set(), fora = [];
  for (const a of lista) {
    if (deCa.has(a.sessionId) || vivos.has(a.sessionId) || vistos.has(a.sessionId)) continue;
    vistos.add(a.sessionId);   // o mesmo id aparece 2x quando ha' sub-processo
    const aba = guardadas && guardadas.get(a.sessionId);
    fora.push(aba ? { ...a, guardadaEm: aba } : a);
  }
  return fora;
}
/* Comando pra continuar no terminal (PowerShell, o shell desta maquina). Antes
   era 'cd "..."; claude --resume id', que quebrava com $, crase e [ ] no
   caminho. -LiteralPath nao interpreta nada; aspa simples dentro vira ''.
   Sessao VIVA ganha --fork-session: abre uma copia, a original segue onde esta'. */
function comandoParaRetomar({ cwd, sessionId, viva }) {
  const id = String(sessionId || '');
  if (!/^[\w-]+$/.test(id)) return '';
  const resume = 'claude --resume ' + id + (viva ? ' --fork-session' : '');
  /* auditoria 1: o PowerShell tambem trata ’ ‘ ‚ ‛ como aspa simples -- uma
     pasta "C:\it’s" fechava a string no meio. Dobra todas elas. */
  return cwd ? "Set-Location -LiteralPath '" + String(cwd).replace(/['\u2018\u2019\u201A\u201B]/g, (c) => c + c) + "'; " + resume : resume;
}
const ORIGEM_DA_SESSAO = { cockpit: 'Cockpit', cli: 'terminal', 'claude-vscode': 'VS Code', 'sdk-cli': 'via SDK', 'sdk-ts': 'via SDK', 'sdk-py': 'via SDK' };
/* Linha da Torre: o logo do motor e' a marca; o ESTADO e' um selinho no canto
   do logo (style.css .ti-logo::after). O nome do motor vai pra dica. */
function linhaDaTorre({ titulo, motor, estado, aoClicar, acoes, dica, icone, chave }) {
  const d = document.createElement('div');
  d.className = 'torre-item ' + (estado.cls || '');
  if (chave) d.dataset.pane = chave;
  const marca = icone ? '<span class="ti-logo ti-ic">' + ico(icone) + '</span>' : marcaDoMotor(motor, 'ti-logo');
  d.innerHTML = marca + '<span class="ti-txt"><span class="ti-tit"></span><span class="ti-est"></span></span>';
  $('.ti-tit', d).textContent = titulo;
  $('.ti-est', d).textContent = estado.txt;
  d.title = dica || ((motor ? nomeDoMotor(motor) : '') + (aoClicar ? ' · clique para ir até o painel' : ''));
  if (aoClicar) d.addEventListener('click', aoClicar);
  else d.classList.add('fora');
  if (acoes && acoes.length) {
    const cx = document.createElement('div');
    cx.className = 'ti-acoes';
    for (const ac of acoes) {
      const b = document.createElement('button');
      b.className = 'ti-acao';
      b.textContent = ac.rotulo;
      b.title = ac.dica || '';
      b.addEventListener('click', (e) => { e.stopPropagation(); ac.aoClicar(b); });
      cx.appendChild(b);
    }
    d.appendChild(cx);
  }
  return d;
}
/* ===================== PENDENCIAS =====================
   Uma view SO' com quem esta esperando voce agora (permissao ou pergunta
   bloqueante), de qualquer aba - local ou VPS. Mesma fonte de dados da Torre
   (panes+panesFundo cruzados com abasLocais): um painel remoto e' um objeto
   P igual a qualquer outro, entao entra de graca, sem codigo especial. */
function listaDePendencias() {
  const vivos = [...new Map([...panes.values(), ...panesFundo.values()].map((P) => [P.id, P])).values()];
  const porAba = new Map(abasLocais().map((ab) => [ab.id, ab]));
  const itens = [];
  for (const P of vivos) {
    const e = estadoDoPainel(P);
    if (e.cls !== 'espera') continue;
    itens.push({ P, aba: porAba.get(P.abaId) || null, estado: e });
  }
  return itens;
}
function pendenciasVisivel() {
  const v = $('.side-view[data-view="pendencias"]');
  return !!v && !v.classList.contains('hidden') && !$('#sidebar').classList.contains('hidden');
}
/* Chamado sempre que o estado de permissao/pergunta de QUALQUER painel muda
   (chegou, foi respondido ou cancelado) - nos MESMOS pontos que hoje pintam
   o ponto ambar da aba. Atualiza o numero no icone SEMPRE (voce precisa
   saber mesmo com a view fechada); a lista inteira so' se estiver aberta -
   redesenhar a toa custa caro a toa, igual a Torre ja faz com pintarAgentesDaTorre. */
function sincronizarPendencias() {
  window.CockpitUI?.refresh();
  const n = listaDePendencias().length;
  const badge = $('.act[data-view="pendencias"] .act-badge');
  if (badge) {
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.toggle('hidden', n === 0);
  }
  if (pendenciasVisivel()) pintarPendencias();
}
const pendenciasExpandidas = new Set();   // ids de painel expandidos, sobrevive a repinturas
function pintarPendencias() {
  const view = $('#pendencias'); if (!view) return;
  const lista = $('.pendencias-lista', view);
  const badgeView = $('.pendencias-count', view);
  const itens = listaDePendencias();
  lista.innerHTML = '';
  if (badgeView) {
    badgeView.textContent = String(itens.length);
    badgeView.style.display = itens.length ? 'flex' : 'none';
  }
  if (!itens.length) {
    const vazio = document.createElement('div');
    vazio.className = 'pendencias-vazio';
    vazio.textContent = 'Nenhuma pendência agora. Quando algum painel precisar de você, aparece aqui — de qualquer aba, inclusive VPS.';
    lista.appendChild(vazio);
    return;
  }
  const idsAtuais = new Set(itens.map((it) => it.P.id));
  for (const id of [...pendenciasExpandidas]) if (!idsAtuais.has(id)) pendenciasExpandidas.delete(id);
  if (itens.length === 1) pendenciasExpandidas.add(itens[0].P.id);
  for (const { P, aba, estado } of itens) lista.appendChild(cardDePendencia(P, aba, estado));
}
function cardDePendencia(P, aba, estado) {
  const card = document.createElement('div');
  card.className = 'pendencias-card';
  card.dataset.pane = P.id;
  const expandido = pendenciasExpandidas.has(P.id);
  card.classList.toggle('expandido', expandido);

  const header = document.createElement('div');
  header.className = 'pendencias-card-header';
  const nome = document.createElement('span');
  nome.className = 'pend-nome';
  nome.textContent = tituloNaTorre(P);
  const abaSpan = document.createElement('span');
  abaSpan.className = 'pend-aba';
  abaSpan.textContent = aba ? (aba.nome + (aba.tipo === 'ssh' ? ' 🖧' : '')) : '—';
  header.append(nome, abaSpan);
  const filaTotal = ((P.filaPerm && P.filaPerm.length) || 0) + ((P.filaPerg && P.filaPerg.length) || 0);
  if (filaTotal > 1) {
    const cnt = document.createElement('span');
    cnt.className = 'pend-count';
    cnt.textContent = filaTotal + ' na fila';
    header.appendChild(cnt);
  }
  card.appendChild(header);

  const tipo = document.createElement('span');
  tipo.className = 'pend-tipo';
  tipo.textContent = estado.txt;
  card.appendChild(tipo);

  const irBt = document.createElement('button');
  irBt.className = 'pend-btn pend-btn-ir';
  irBt.type = 'button';
  irBt.textContent = 'ir até lá';
  irBt.title = 'Troca de aba e vai até este painel';
  irBt.addEventListener('click', (e) => { e.stopPropagation(); irAoPainel(P); });
  card.appendChild(irBt);

  const body = document.createElement('div');
  body.className = 'pendencias-card-body';
  card.appendChild(body);

  const alternarExpansao = () => {
    const vaiAbrir = !card.classList.contains('expandido');
    card.classList.toggle('expandido', vaiAbrir);
    if (vaiAbrir) { pendenciasExpandidas.add(P.id); montarCorpoDaPendencia(P, body); }
    else pendenciasExpandidas.delete(P.id);
  };
  header.addEventListener('click', alternarExpansao);
  tipo.addEventListener('click', alternarExpansao);
  if (expandido) montarCorpoDaPendencia(P, body);
  return card;
}
/* Body do card: reaproveita o MESMO desenho e os MESMOS botoes que o painel
   usa (desenharPermissao/desenharPergunta) - so' aponta pra um container
   diferente. Nao duplica logica de aprovacao/resposta (essa e' a licao da
   Task 1: a versao anterior duplicava e tinha bug real). */
function montarCorpoDaPendencia(P, body) {
  body.innerHTML = '';
  const temPermissao = P.pedindoPerm || (P.filaPerm && P.filaPerm.length);
  const temPergunta = P.perguntaAberta && P.perguntaAberta.bloqueante !== false;
  if (temPermissao) {
    const bar = document.createElement('div');
    bar.className = 'pane-perm';
    bar.innerHTML = '<div class="pp-txt"></div><div class="pp-btns">'
      + '<button class="pp-yes">Permitir</button>'
      + '<button class="pp-sempre hidden">Sempre permitir</button>'
      + '<button class="pp-no">Negar</button></div>';
    body.appendChild(bar);
    desenharPermissao(P, bar);
  }
  if (temPergunta) {
    const cx = document.createElement('div');
    cx.className = 'pane-perg';
    body.appendChild(cx);
    desenharPergunta(P, cx);
  }
  if (!temPermissao && !temPergunta) {
    const nada = document.createElement('div');
    nada.className = 'pend-tipo';
    nada.textContent = 'Isso acabou de se resolver.';
    body.appendChild(nada);
  }
}
/* A Torre em dois andares FIXOS: a lista (refeita a cada pintura) e, no fim, os
   agentes -- que so' o paintAgents mexe. Antes a pintura apagava tudo e so' o
   intervalo recolocava os agentes: a secao sumia, e um agent-state no meio da
   busca a punha ACIMA de "Claude fora". Pintar e' sincrono; a busca das
   sessoes de fora corre por fora (buscarSessoesDeFora) e repinta ao voltar. */
function pintarTorre(forcarAgentes) {
  const box = $('#torre');
  if (!box) return;
  let lista = $('.torre-lista', box), agentesBox = $('.torre-agentes', box);
  if (!lista || !agentesBox) {
    box.innerHTML = '';
    lista = document.createElement('div'); lista.className = 'torre-lista';
    agentesBox = document.createElement('div'); agentesBox.className = 'torre-agentes';
    box.append(lista, agentesBox);
  }
  const vivos = [...new Map([...panes.values(), ...panesFundo.values()].map((P) => [P.id, P])).values()];
  const sessoesVivas = new Set();   // conversa com o motor LIGADO num painel daqui
  const guardadas = new Map();      // id -> aba: so' apontada (ficha guardada, painel parado)
  const blocos = [];
  let total = 0, ocupados = 0, esperando = 0;
  for (const ab of abasLocais()) {
    const daAba = vivos.filter((P) => P.abaId === ab.id);
    for (const P of daAba) {
      if (P.started && P.sessaoId) sessoesVivas.add(P.sessaoId);
      else for (const s of [P.sessaoId, P.resumeId, P.resumeAnterior]) if (s && !guardadas.has(s)) guardadas.set(s, ab.nome);
    }
    const idsVivos = new Set(daAba.map((P) => P.id));
    const guardados = (ab.paineis || []).filter((f) => f && f.paneId && !idsVivos.has(f.paneId) && (f.sessaoId || f.titulo));
    for (const f of guardados) if (f.sessaoId && !guardadas.has(f.sessaoId)) guardadas.set(f.sessaoId, ab.nome);
    if (!daAba.length && !guardados.length) continue;
    const sec = document.createElement('div');
    sec.className = 'torre-aba';
    sec.innerHTML = '<span class="torre-cor"></span><span class="torre-nome"></span><span class="torre-conta"></span>';
    $('.torre-cor', sec).style.background = ab.cor || (ab.tipo === 'ssh' ? '#5aa469' : '#6ea8fe');
    $('.torre-nome', sec).textContent = ab.nome + (ab.tipo === 'ssh' ? ' 🖧' : '');
    const n = daAba.length + guardados.length;
    $('.torre-conta', sec).textContent = n + (n === 1 ? ' painel' : ' painéis');
    blocos.push(sec);
    // painel vazio nao diz nada de relance: N deles viram UMA linha
    const vazios = [];
    for (const P of daAba) {
      const e = estadoDoPainel(P);
      total++; if (e.cls === 'ocupado') ocupados++; if (e.cls === 'espera') esperando++;
      if (e.cls === 'vazio') { vazios.push(P); continue; }
      blocos.push(linhaDaTorre({ titulo: tituloNaTorre(P), motor: P.engine, estado: e, chave: P.id, aoClicar: () => irAoPainel(P) }));
    }
    if (vazios.length) {
      blocos.push(linhaDaTorre({
        titulo: vazios.length === 1 ? '1 painel vazio' : vazios.length + ' painéis vazios',
        icone: 'square', estado: { txt: 'clique para ir ao primeiro', cls: 'vazio' },
        dica: 'Sem conversa ainda: ' + vazios.map((P) => nomeDoMotor(P.engine)).join(', '),
        aoClicar: () => irAoPainel(vazios[0]),
      }));
    }
    for (const f of guardados) {
      total++;
      /* a restauracao cria o painel com id NOVO: procurar so' pelo paneId da
         ficha nunca achava, e o clique trocava de aba e parava ali */
      blocos.push(linhaDaTorre({ titulo: f.titulo || 'nova conversa', motor: f.engine, estado: { txt: 'guardado (volta ao abrir a aba)', cls: 'vazio' }, aoClicar: () => trocarAbaLocal(ab.id).then(() => { const Q = panes.get(f.paneId) || [...panes.values()].find((q) => f.sessaoId && (q.sessaoId || q.resumeId) === f.sessaoId); if (Q) irAoPainel(Q); }) }));
    }
  }
  const resumo = document.createElement('div');
  resumo.className = 'torre-resumo';
  resumo.textContent = total
    ? total + (total === 1 ? ' painel' : ' painéis') + ' · ' + ocupados + ' trabalhando' + (esperando ? ' · ' + esperando + ' esperando você' : '')
    : 'Nenhum painel aberto.';

  // "Claude fora do Cockpit": mesmo cabecalho das abas, com o logo do motor
  const fora = separarSessoesDeFora(torreAgentes.itens, sessoesVivas, guardadas);
  const secFora = document.createElement('div');
  secFora.className = 'torre-aba torre-fora';
  secFora.innerHTML = marcaDoMotor('claude') + '<span class="torre-nome"></span><span class="torre-conta"></span>';
  $('.torre-nome', secFora).textContent = 'Claude fora do Cockpit';
  const nota = document.createElement('div');
  nota.className = 'torre-nota' + (torreAgentes.erro ? ' erro' : '');
  nota.textContent = rotuloDasSessoesDeFora({ quando: torreAgentes.quando, erro: torreAgentes.erro, n: fora.length });
  const linhasFora = fora.map((a) => {
    const ha = a.startedAt ? duracaoCurta(Date.now() - a.startedAt) : '';
    // a origem vem de um arquivo em disco: so' chave conhecida vira rotulo
    const origem = (Object.prototype.hasOwnProperty.call(ORIGEM_DA_SESSAO, a.origem) && ORIGEM_DA_SESSAO[a.origem]) || 'sessão do Claude';
    const linha = linhaDaTorre({
      titulo: a.name || baseNome(a.cwd) || a.sessionId.slice(0, 8),
      motor: 'claude',
      // "ha' X" antes do caminho: caminho comprido corta com reticencias e levava o tempo junto
      estado: { txt: [origem, ha && 'há ' + ha, shortPath(a.cwd)].filter(Boolean).join(' · ') + (a.guardadaEm ? ' · também guardada na aba ' + a.guardadaEm : ''), cls: a.status === 'busy' ? 'ocupado' : '' },
      dica: 'Claude · ' + origem + (a.status === 'busy' ? ' · trabalhando agora' : '') + '\n' + a.cwd,
      acoes: [
        { rotulo: 'continuar aqui (ramo)', dica: 'Abre um painel novo nesta aba com uma CÓPIA desta conversa, com o histórico inteiro. A sessão lá fora continua intacta.', aoClicar: () => continuarSessaoDeFora(a) },
        { rotulo: 'copiar comando', dica: 'Copia o comando do PowerShell que abre uma cópia desta conversa num terminal. A original continua onde está.', aoClicar: (bt) => copiarTexto(comandoParaRetomar({ cwd: a.cwd, sessionId: a.sessionId, viva: true }), bt) },
        { rotulo: 'abrir a pasta', dica: a.cwd, aoClicar: () => abrirPastaDaSessao(a.cwd) },
      ],
    });
    if (torreAgentes.erro) linha.classList.add('antiga');   // lista boa de antes, por baixo do erro
    return linha;
  });
  lista.replaceChildren(resumo, ...blocos, secFora, nota, ...linhasFora);
  pintarAgentesDaTorre();
  if (forcarAgentes || (!torreAgentes.buscando && Date.now() - torreAgentes.pedido > 30000)) buscarSessoesDeFora(!!forcarAgentes);
}
function pintarAgentesDaTorre() {
  const a = $('#torre .torre-agentes');
  if (a) window.CockpitCollaboration?.paintAgents(a);
}
/* A busca e' SO' de quem busca (igual as Rotinas): repintar nao invalida quem
   esta' voando. A mais nova ganha; a atrasada sai calada. */
async function buscarSessoesDeFora(forcar) {
  const gen = ++torreGen;
  torreAgentes.buscando = true;
  torreAgentes.pedido = Date.now();
  let r = null;
  try { r = await window.api.agentesClaude({ forcar }); } catch (e) { r = { ok: false, erro: String(e && e.message || e) }; }
  if (gen !== torreGen) return;
  torreAgentes.buscando = false;
  if (r && r.ok && Array.isArray(r.itens)) { torreAgentes.itens = r.itens; torreAgentes.quando = r.quando || Date.now(); torreAgentes.erro = ''; }
  else torreAgentes.erro = (r && (r.erro || r.error)) || 'sem resposta';
  if (torreVisivel()) pintarTorre(false);
}
/* "continuar aqui (ramo)": painel novo com --resume <id> --fork-session. A
   sessao de fora e' DESTE PC; numa aba de servidor o --resume procuraria la' e
   nao acharia -- entao vai pra uma aba local. */
async function continuarSessaoDeFora(a) {
  if (!a || !a.sessionId) return;
  let aba = abaAtual();
  if (aba && aba.tipo === 'ssh') {
    const local = abasLocais().find((x) => x.tipo !== 'ssh');
    if (local) { await trocarAbaLocal(local.id); aba = abaAtual(); }
    if (!aba || aba.tipo === 'ssh') { mostrarAviso({ texto: 'Essa conversa é deste PC: abra uma aba local para continuar ela aqui.', tipo: 'erro' }); return; }
  }
  const titulo = a.name || baseNome(a.cwd) || 'conversa';
  /* auditoria 2: o ramo nasce no modelo em que a sessao de fora estava (o ultimo
     que respondeu no .jsonl dela, o mesmo da lista); sem isso, no padrao */
  let doFora = { model: '' };
  try { doFora = (await modeloDaOrigem({ engine: 'claude', id: a.sessionId, file: '', remoto: false })) || doFora; } catch {}
  const novo = newPane({ engine: 'claude', cwd: a.cwd || undefined, abaId: aba && aba.id,
    model: doFora.model || undefined, effort: doFora.effort || undefined });
  novo.resumeId = a.sessionId;
  novo.forkPendente = true;
  novo.titulo = '(ramo) ' + titulo;
  pintarNome(novo);
  faixaDeRamo(novo, { titulo }, null);
  savePanes();
  if (torreVisivel()) pintarTorre(false);
}
async function abrirPastaDaSessao(cwd) {
  let r = null;
  try { r = await window.api.openPath(cwd); } catch (e) { r = String(e && e.message || e); }
  const erro = typeof r === 'string' ? r : ((r && r.error) || '');
  // antes falhava mudo: pasta apagada ou unidade desmontada e nada acontecia
  if (erro) mostrarAviso({ texto: 'Não consegui abrir a pasta ' + shortPath(cwd) + ': ' + erro, tipo: 'erro' });
}
/* A cada 4 s, so' com a Torre na tela e a janela a vista. Com o mouse em cima a
   lista NAO e' refeita (o botao sumiria debaixo do clique), mas o relogio de
   cada linha continua andando: congela a ORDEM, nao o texto. */
function atualizarRelogiosDaTorre() {
  for (const d of $$('#torre .torre-item[data-pane]')) {
    const P = panes.get(d.dataset.pane) || panesFundo.get(d.dataset.pane);
    if (!P) continue;
    const e = estadoDoPainel(P);
    $('.ti-est', d).textContent = e.txt;
    d.className = 'torre-item ' + (e.cls || '');
  }
}
setInterval(() => {
  if (document.hidden || !torreVisivel()) return;
  const b = $('#torre');
  if (b && b.matches(':hover')) atualizarRelogiosDaTorre();
  else pintarTorre(false);
}, 4000);

/* ===================== ROTINAS DO WINDOWS =====================
   As automacoes agendadas que rodam sozinhas nesta maquina (backup da VPS,
   radar diario, gestor de trafego...). A tela existe por um motivo so': quando
   uma delas para, ninguem fica sabendo -- duas estavam paradas ha semanas em
   silencio. Por isso o que falhou vem PRIMEIRO, em vermelho e com o motivo em
   portugues; o resto da lista e' so' contexto.
   Leva 41: na tela ela se chama "Automações" (a palavra do Hugo) e segue o
   desenho da Torre e dos Ajustes -- marca com selinho de estado no canto, duas
   linhas de estado, acoes numa linha propria. As acoes so' aparecem com a linha
   ABERTA: antes um "disparar" em cada uma das 21 linhas cortava o nome e o
   estado de 22 delas no meio (medido na tela). */
let rotinasCache = { itens: [], erro: '', velha: false, quando: 0, lidoEm: 0 };
let rotinasGen = 0;                    // repaint em voo: o mais novo ganha, o antigo nao monta por cima
const rotinasDisparando = new Set();   // trava de duplo clique, uma chave por rotina
const rotinasLigando = new Set();      // a mesma trava pro ligar/desligar
const rotinasAbertas = new Map();      // chave -> linha aberta (true) ou fechada (false) pelo usuario
/* O PowerShell leva 3-4 s de processo. Com a view aberta a lista era relida a
   cada 20 s -- um PowerShell a cada ~24 s numa maquina com 1,8 GB livres. Agora
   a cada minuto; as linhas se repintam do cache a cada 8 s, o que basta pro
   "há 3 min" andar. O botao de atualizar e o "rodar agora" furam na hora. */
const ROTINAS_RELER_MS = 60000;

function rotinasVisivel() {
  return viewLateralVisivel('rotinas');
}
function resumoDasRotinas() {
  return { itens: rotinasCache.itens.slice(), erro: rotinasCache.erro,
    velha: rotinasCache.velha || (!!rotinasCache.lidoEm && Date.now() - rotinasCache.lidoEm > 150000), lidoEm: rotinasCache.lidoEm };
}
const chaveDaRotina = (t) => String((t && t.caminho) || '') + String((t && t.nome) || '');
const horaCurta = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const hexDaRotina = (n) => '0x' + (Number(n) >>> 0).toString(16).toUpperCase();

/* Perto de agora, tempo relativo ("há 42 min", "em 9 min"): e' o que se quer
   saber de relance. Longe, o dia e a hora ("hoje 08:15", "ontem 22:00",
   "25/08 08:56"). 'agora' vem de fora no teste. */
function quandoDaRotina(iso, agora) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const ja = agora === undefined ? Date.now() : agora;
  const dif = d.getTime() - ja;
  const min = Math.round(Math.abs(dif) / 60000);
  if (dif <= 0) {
    if (-dif < 60000) return 'agora há pouco';
    if (min < 60) return 'há ' + min + ' min';
    if (min < 6 * 60) return 'há ' + Math.round(min / 60) + ' h';
  } else {
    if (dif < 60000) return 'em menos de 1 min';
    if (min < 60) return 'em ' + min + ' min';
  }
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const soODia = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((soODia(new Date(ja)) - soODia(d)) / 86400000);
  if (dias === 0) return 'hoje ' + hora;
  if (dias === 1) return 'ontem ' + hora;
  if (dias === -1) return 'amanhã ' + hora;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + hora;
}
// "falhou em 25/08 08:56", mas "falhou há 3 h" e "falhou ontem 22:00"
const comQuando = (q) => (q ? ' ' + (/^\d/.test(q) ? 'em ' + q : q) : '');

/* Nome pra ler: o Windows pendura o SID do usuario ("-S-1-5-21-1842...-1001")
   ou um GUID ("-{50a21cd4-...}") no fim de tarefa de programa. O nome inteiro
   continua na dica da linha. */
function nomeDaRotina(nome) {
  const s = String(nome || '');
  return s.replace(/-S-1-5-21(-\d+)+$/i, '').replace(/-\{[0-9a-f-]{36}\}$/i, '') || s;
}

/* Falha que pede atencao: a da automacao LIGADA. A desligada que falhou da
   ultima vez ficava pra sempre na caixa vermelha -- um alarme permanente pra
   algo que ele desligou de proposito. A linha continua dizendo que falhou. */
const emAlarme = (t) => !!(t && t.falhou) && t.estado !== 'desativada' && t.estado !== 'rodando';

/* As tres coisas que a linha diz: a classe do selinho, o que aconteceu da
   ultima vez e quando ela roda de novo. */
function textosDaRotina(t, agora) {
  const rodando = t.estado === 'rodando';
  const desligada = t.estado === 'desativada';
  const ultima = quandoDaRotina(t.ultima, agora);
  const semResultado = t.resultado === null || t.resultado === undefined;
  const nuncaRodou = !ultima || t.resultado === 0x41303;
  /* Quem esta' RODANDO AGORA vem primeiro na conta. O 'falhou' e' o resultado
     da execucao ANTERIOR: se a rotina esta' trabalhando neste instante, mostrar
     "falhou" e' dizer que esta quebrado o que esta funcionando. Ao vivo:
     "RtkAudUService64_BG || falhou em hoje 13:00: codigo 0x40010004", com a
     tarefa em Running. */
  let est;
  if (rodando) est = 'rodando agora' + (ultima ? ' · começou' + comQuando(ultima) : '');
  else if (t.falhou) est = 'falhou' + comQuando(ultima) + ': ' + (t.motivo || 'motivo desconhecido');
  else if (nuncaRodou) est = 'ainda não rodou';
  else if (semResultado) est = 'rodou' + comQuando(ultima);
  // "deu certo" so' com o zero de verdade; os outros codigos sem falha dizem o que sao
  else if (t.resultado === 0) est = 'deu certo' + comQuando(ultima);
  else est = 'rodou' + comQuando(ultima) + (t.motivo ? ' · ' + t.motivo : '');
  /* Sem proxima execucao nao quer dizer parada: as que rodam ao entrar no
     Windows nao tem hora marcada. Antes todas diziam "sem próxima marcada". */
  const proxima = quandoDaRotina(t.proxima, agora);
  let quando;
  if (desligada) quando = 'desligada: só roda se você mandar';
  else if (proxima) quando = 'próxima ' + proxima + (t.repete ? ' · ' + t.repete : '');
  else quando = t.repete || 'sem próxima marcada';
  /* Selinho: verde so' com "deu certo". Antes "nunca rodou" e resultado
     desconhecido ganhavam o mesmo verde de quem rodou bem. */
  const cls = rodando ? 'ocupado' : emAlarme(t) ? 'espera' : desligada ? 'fora'
    : (nuncaRodou || semResultado || t.resultado !== 0) ? 'sem-info' : 'parado';
  return { est, quando, cls };
}

// o relogio do botao da barra: marcacao fixa do proprio app, nunca dado do Windows
const MARCA_ROTINA = '<span class="ri-marca"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/></svg></span>';

function linhaDaRotina(t, agora) {
  const { est, quando, cls } = textosDaRotina(t, agora);
  const chave = chaveDaRotina(t);
  // a sua que falhou nasce aberta, com as acoes a mao; o resto, fechado
  const aberta = rotinasAbertas.has(chave) ? rotinasAbertas.get(chave) : !!(!window.CockpitUI && emAlarme(t) && t.dele !== false);
  const d = document.createElement('div');
  d.className = 'rot-item ' + cls + (aberta ? ' aberta' : '');
  d.dataset.rotina = chave;
  d.innerHTML = MARCA_ROTINA + '<span class="ri-txt"><span class="ri-tit"></span><span class="ri-est"></span><span class="ri-quando"></span></span>';
  /* nome, motivo e horario vem do Windows: entram por textContent, nunca por
     innerHTML -- nome de tarefa aceita < e & e viraria marcacao na tela. */
  $('.ri-tit', d).textContent = nomeDaRotina(t.nome);
  $('.ri-est', d).textContent = est;
  $('.ri-quando', d).textContent = quando;
  const dica = t.nome + (t.caminho && t.caminho !== '\\' ? '  ·  ' + t.caminho : '');
  d.title = dica + '\nClique para ver o que ela faz e as ações';
  // a linha abre e fecha pelo teclado tambem (Tab ate' ela, Enter ou espaco)
  d.tabIndex = 0;
  d.setAttribute('role', 'button');
  d.setAttribute('aria-expanded', aberta ? 'true' : 'false');
  /* Abrir/fechar mexe SO' nesta linha, sem repintar a lista: repintar tiraria o
     foco do teclado e o lugar da rolagem. */
  const alternar = () => {
    const agoraAberta = !d.classList.contains('aberta');
    rotinasAbertas.set(chave, agoraAberta);
    d.classList.toggle('aberta', agoraAberta);
    d.setAttribute('aria-expanded', agoraAberta ? 'true' : 'false');
    const det = $('.ri-det', d);
    if (det) det.remove();
    if (agoraAberta) d.appendChild(detalheDaRotina(t));
  };
  d.addEventListener('click', alternar);
  d.addEventListener('keydown', (e) => {
    /* auditoria 1: Esc (na linha ou num botao dela) fecha a linha aberta e para
       aqui. Subindo, chegava no Esc global e interrompia o painel em foco. */
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (d.classList.contains('aberta')) { alternar(); d.focus(); }
      return;
    }
    if (e.target !== d || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    alternar();
  });
  if (window.CockpitUI && emAlarme(t) && t.dele !== false) {
    const rodar = botaoDeRotina('Rodar agora', 'Pede confirmação antes de executar.', bt => dispararRotina(t, bt));
    rodar.classList.add('ck-run-automation');
    rodar.disabled = rotinasDisparando.has(chave);
    if (rodar.disabled) rodar.textContent = 'Iniciando…';
    d.appendChild(rodar);
  }
  if (aberta) d.appendChild(detalheDaRotina(t));
  return d;
}

function botaoDeRotina(rotulo, dica, aoClicar) {
  const b = document.createElement('button');
  b.className = 'ri-acao';
  b.textContent = rotulo;
  b.title = dica || '';
  b.addEventListener('click', (e) => { e.stopPropagation(); aoClicar(b); });
  return b;
}

/* A linha aberta: o que ela faz (a descricao que o Hugo escreveu no Agendador),
   o que ela roda, o codigo cru quando falhou (pra procurar) e as acoes. */
function detalheDaRotina(t) {
  const chave = chaveDaRotina(t);
  const det = document.createElement('div');
  det.className = 'ri-det';
  det.addEventListener('click', (e) => e.stopPropagation());   // clicar no texto aberto nao fecha a linha
  if (t.descricao) {
    const p = document.createElement('span');
    p.className = 'aj-desc';
    p.textContent = t.descricao;
    det.appendChild(p);
  }
  const fatos = [];
  if (t.programa) fatos.push('roda ' + t.programa);
  if (t.falhou && Number.isFinite(t.resultado)) fatos.push('código ' + hexDaRotina(t.resultado));
  if (fatos.length) {
    const f = document.createElement('span');
    f.className = 'ri-fatos';
    f.textContent = fatos.join(' · ');
    det.appendChild(f);
  }
  const acoes = document.createElement('div');
  acoes.className = 'ri-acoes';
  const rodando = t.estado === 'rodando';
  const desligada = t.estado === 'desativada';
  const btRodar = botaoDeRotina('rodar agora',
    rodando ? 'Ela já está rodando agora.' : 'Roda esta automação agora, sem esperar a hora marcada. Pede confirmação antes.',
    (bt) => dispararRotina(t, bt));
  /* ja' rodando: o Agendador aceitaria o pedido e nao faria nada (a tarefa
     ignora a segunda execucao), e a tela diria "começou a rodar" -- mentira */
  if (rodando) btRodar.disabled = true;
  // desligada, o Windows recusa ("A tarefa está desabilitada."): o botao ja' diz isso antes
  if (desligada) { btRodar.disabled = true; btRodar.title = 'Desligada: ligue antes de rodar.'; }
  // repaint no meio de um disparo nao pode devolver o botao habilitado
  if (rotinasDisparando.has(chave)) { btRodar.disabled = true; btRodar.textContent = 'iniciando…'; }
  acoes.appendChild(btRodar);
  const btLigar = botaoDeRotina(desligada ? 'ligar' : 'desligar',
    desligada ? 'Volta a rodar sozinha no horário marcado.' : 'Para de rodar sozinha até você ligar de novo. Nada é apagado.',
    (bt) => ligarRotina(t, desligada, bt));
  if (rotinasLigando.has(chave)) { btLigar.disabled = true; btLigar.textContent = desligada ? 'ligando…' : 'desligando…'; }
  acoes.appendChild(btLigar);
  if (t.pasta) acoes.appendChild(botaoDeRotina('abrir a pasta', t.pasta, () => abrirPastaDaSessao(t.pasta)));
  det.appendChild(acoes);
  return det;
}

const achaNoCache = (chave) => rotinasCache.itens.find((x) => chaveDaRotina(x) === chave);
/* Cada acao e' um acontecimento novo, nao uma situacao que continua: a tarja que
   some sozinha em 20 s fica anotada como "dispensada", e sem um 'reseta' novo a
   PROXIMA tarja da mesma automacao (rodar de novo, desligar) era engolida calada. */
let rotinasAvisoSeq = 0;

/* Rodar agora dispara trabalho de verdade (o mesmo que a hora marcada
   dispararia): pergunta antes -- pelo modal do app, que nao trava a janela como
   o confirm() -- e trava a rotina ate' o agendador responder pra o segundo
   clique nao mandar duas vezes. */
async function dispararRotina(t, bt) {
  const chave = chaveDaRotina(t);
  if (rotinasDisparando.has(chave)) return;
  const nome = nomeDaRotina(t.nome);
  const oQueFaz = t.descricao ? t.descricao.replace(/[.\s]*$/, '.') + ' ' : '';
  if (!(await confirmarNoApp('Rodar "' + nome + '" agora?', oQueFaz + 'Ela roda de verdade, na hora, como se fosse o horário marcado.', 'Rodar agora'))) return;
  if (rotinasDisparando.has(chave)) return;   // o segundo clique esperou o mesmo modal
  rotinasDisparando.add(chave);
  if (bt) { bt.disabled = true; bt.textContent = 'iniciando…'; }
  let erro = '';
  try {
    const r = await window.api.rotinasDisparar({ nome: t.nome, caminho: t.caminho });
    erro = (r && r.error) || '';
  } catch (e) { erro = String(e && e.message || e); }
  rotinasDisparando.delete(chave);
  if (!erro) {
    /* o Agendador disse que comecou: a tela mostra isso JA', sem esperar os 3 s
       da proxima leitura, e a linha continua aberta onde quer que ela caia */
    const x = achaNoCache(chave);
    if (x) { x.estado = 'rodando'; x.ultima = new Date().toISOString(); x.falhou = false; }
    rotinasAbertas.set(chave, true);
  }
  mostrarAviso({
    id: 'rotina-' + chave,
    texto: erro ? 'Não consegui rodar "' + nome + '": ' + erro : '"' + nome + '" começou a rodar.',
    tipo: erro ? 'erro' : 'info',
    reseta: ++rotinasAvisoSeq,
  });
  rotinasCache.quando = 0;   // o estado de verdade vem na proxima pintura
  if (rotinasVisivel()) pintarRotinas(true);
  /* a maioria das dele termina em segundos: sem esta segunda leitura a linha
     ficava "rodando agora" ate' a releitura do minuto seguinte */
  if (!erro) setTimeout(() => {
    if (!rotinasVisivel()) return;
    // mouse ou teclado na lista: nao troca a linha debaixo dele; o proximo tique livre le
    const b = $('#rotinas');
    if (b && (b.matches(':hover') || (document.activeElement && b.contains(document.activeElement)))) { rotinasCache.quando = 0; return; }
    pintarRotinas(true, true);
  }, 8000);
}

/* Ligar/desligar. Desligar nao apaga nada (a tarefa fica no Agendador); ligar
   faz ela voltar a rodar sozinha -- as duas perguntam antes, porque uma
   automacao desligada costuma estar assim de proposito. */
async function ligarRotina(t, ligar, bt) {
  const chave = chaveDaRotina(t);
  if (rotinasLigando.has(chave)) return;
  const nome = nomeDaRotina(t.nome);
  const ok = ligar
    ? await confirmarNoApp('Ligar "' + nome + '" de novo?', 'Ela volta a rodar sozinha' + (t.repete ? ' (' + t.repete + ')' : ' no horário marcado') + '.', 'Ligar')
    : await confirmarNoApp('Desligar "' + nome + '"?', 'Ela para de rodar sozinha até você ligar de novo. Nada é apagado: a automação continua no Agendador do Windows.', 'Desligar');
  if (!ok || rotinasLigando.has(chave)) return;
  rotinasLigando.add(chave);
  if (bt) { bt.disabled = true; bt.textContent = ligar ? 'ligando…' : 'desligando…'; }
  let erro = '';
  try {
    const r = await window.api.rotinasLigar({ nome: t.nome, caminho: t.caminho, ligar });
    erro = (r && r.error) || '';
  } catch (e) { erro = String(e && e.message || e); }
  rotinasLigando.delete(chave);
  if (!erro) { const x = achaNoCache(chave); if (x) x.estado = ligar ? 'pronta' : 'desativada'; }
  mostrarAviso({
    id: 'rotina-' + chave,
    texto: erro ? 'Não consegui ' + (ligar ? 'ligar' : 'desligar') + ' "' + nome + '": ' + erro
      : '"' + nome + '" ' + (ligar ? 'foi ligada: volta a rodar sozinha.' : 'foi desligada: só roda se você mandar.'),
    tipo: erro ? 'erro' : 'info',
    reseta: ++rotinasAvisoSeq,
  });
  rotinasCache.quando = 0;
  if (rotinasVisivel()) pintarRotinas(true);
}

function grupoDeRotinas(nome, quantas, extra, tag) {
  const g = document.createElement(tag || 'div');
  g.className = 'rot-grupo';
  g.innerHTML = '<span class="rot-nome"></span><span class="rot-conta"></span>';
  $('.rot-nome', g).textContent = nome;
  $('.rot-conta', g).textContent = String(quantas) + (extra || '');
  return g;
}

/* As rotinas de fabricante (OneDrive, Realtek, Zoom, Samsung, Chrome) entram
   num grupo proprio, RECOLHIDO. Elas nao somem -- um clique abre -- mas saem do
   caminho: o bloco vermelho existe pra ele ver as DELE, e antes metade do que
   estava la' era ruido do sistema. O cabecalho e' um BOTAO (leva 41): antes era
   uma div, e pelo teclado nao dava pra abrir. */
let rotinasOutrasAbertas = false;
function cabecalhoDasOutras(quantas, quantasFalharam, clicavel, aberto) {
  const g = grupoDeRotinas('Do sistema e de programas', quantas,
    quantasFalharam ? ' · ' + quantasFalharam + ' com falha' : '', clicavel ? 'button' : 'div');
  if (!clicavel) return g;
  g.classList.add('clicavel');
  g.setAttribute('aria-expanded', aberto ? 'true' : 'false');
  const seta = document.createElement('span');
  seta.className = 'rot-seta';
  // marcacao fixa do proprio app (nunca dado do Windows): innerHTML aqui e' seguro
  seta.innerHTML = ico(aberto ? 'chevron-down' : 'chevron-right');
  g.appendChild(seta);
  g.title = aberto ? 'Esconder as automações do sistema' : 'Mostrar as automações do sistema e dos programas (OneDrive, drivers, atualizadores)';
  g.addEventListener('click', () => { rotinasOutrasAbertas = !rotinasOutrasAbertas; pintarRotinas(false); });
  return g;
}

function blocoDeInfo(texto, botao) {
  const cx = document.createElement('div');
  cx.className = 'aj-info';
  const s = document.createElement('span');
  s.textContent = texto;
  cx.appendChild(s);
  if (botao) { cx.appendChild(document.createElement('br')); cx.appendChild(botao); }
  return cx;
}
// sem acento e em minusculas: "gestor trafego" acha "GestorTrafego" e "Tráfego"
const normalizarBusca = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/* O botao de atualizar diz que esta' lendo (gira e trava). Antes, com lista na
   tela, clicar nele nao mudava nada por 3-4 s -- parecia quebrado. */
function marcarAtualizarRotinas(lendo) {
  const b = $('#btnRotinasAtualizar');
  if (!b) return;
  b.classList.toggle('lendo', lendo);
  b.disabled = lendo;
  b.title = lendo ? 'Lendo o Agendador do Windows…' : 'Atualizar agora';
}

/* forcar: busca de novo (o cache de 60 s daqui). furarCache: pede ao main pra
   nao usar o cache de 15 s dele -- so' o botao de atualizar e o "tentar de
   novo" (abrir a view continua usando o cache curto, como na Torre). */
async function pintarRotinas(forcar, furarCache) {
  const box = $('#rotinas');
  if (!box) return;
  // a lista vem por IPC (PowerShell leva ~3s): pinta o que ja tem em cache e
  // atualiza quando a resposta chegar
  if (forcar || Date.now() - rotinasCache.quando > ROTINAS_RELER_MS) {
    /* A geracao e' SO' de quem vai BUSCAR. Antes todo repaint tomava uma nova, e
       o perdedor da corrida repintava dentro do proprio return -- isso derrubava
       a chamada BOA que ainda estava em voo: ela voltava, via gen !== rotinasGen
       e ia pro lixo (nem pintava, nem gravava no cache). Com o 'quando' ja'
       atualizado, a tela ficava 20 s dizendo "Nenhuma rotina agendada nesta
       maquina" numa maquina com 19 rotinas. Repintar nao invalida quem voa. */
    const gen = ++rotinasGen;
    rotinasCache.quando = Date.now();
    marcarAtualizarRotinas(true);
    /* O PowerShell leva 2,9-3,9 s e a view abria EM BRANCO. O "lendo..." e' o
       que separa "lento" de "quebrado" -- a arvore ja' resolveu isso com o
       .tree-carregando. So' quando ainda nao ha' lista nenhuma: por cima de uma
       lista pronta isso seria pisca-pisca a cada atualizacao. */
    if (!rotinasCache.itens.length && rotinasVisivel()) {
      box.innerHTML = '';
      const lendo = document.createElement('div');
      lendo.className = 'rot-carregando';
      lendo.textContent = 'Lendo as automações do Agendador do Windows…';
      box.appendChild(lendo);
    }
    let chegou = null, erroDaChamada = '';
    try { chegou = await window.api.rotinasListar(furarCache ? { forcar: true } : undefined); }
    catch (e) { erroDaChamada = String(e && e.message || e); }
    /* Resposta atrasada de uma busca ultrapassada por OUTRA busca nao pode
       sobrescrever a lista mais nova -- nem a tela, NEM o cache. Sai calada: o
       repaint aqui e' que invalidava o vencedor. */
    if (gen !== rotinasGen) return;
    marcarAtualizarRotinas(false);
    if (erroDaChamada) {
      rotinasCache.erro = erroDaChamada;
      // a lista que ficou na tela e' a de antes: dizer isso, nao fingir que e' nova
      rotinasCache.velha = rotinasCache.itens.length > 0;
    } else {
      rotinasCache.itens = (chegou && Array.isArray(chegou.itens)) ? chegou.itens : [];
      rotinasCache.erro = (chegou && chegou.error) || '';
      rotinasCache.velha = !!(chegou && chegou.velho);
      if (!rotinasCache.erro) rotinasCache.lidoEm = Date.now();
    }
    window.CockpitUI?.automationChanged?.();
    if (!rotinasVisivel()) return;
  }
  const agora = Date.now();
  const porNome = (a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR');
  const todas = rotinasCache.itens;
  const total = todas.length;
  /* 'dele' pode faltar numa lista guardada por uma versao antiga: na duvida a
     rotina e' DELE, porque o erro de esconder e' pior que o de mostrar demais. */
  const minhasTodas = todas.filter((t) => t.dele !== false);
  const sistemaTodas = todas.filter((t) => t.dele === false);
  const falhasMinhas = minhasTodas.filter(emAlarme).length;
  const falhasDoSistema = sistemaTodas.filter(emAlarme).length;
  const desligadasComFalha = minhasTodas.filter((t) => t.falhou && !emAlarme(t)).length;
  const rodandoAgora = todas.filter((t) => t.estado === 'rodando').length;

  // filtro: so' aparece quando a lista e' grande (ou quando ja' tem texto nele)
  const campo = $('#rotFiltro');
  const filtroCru = campo ? String(campo.value || '').trim() : '';
  if (campo) campo.classList.toggle('hidden', total < 10 && !filtroCru);
  const filtro = normalizarBusca(filtroCru);
  const bate = (t) => !filtro || normalizarBusca([t.nome, t.descricao, t.programa].join(' ')).includes(filtro);
  const minhas = minhasTodas.filter(bate);
  const doSistema = sistemaTodas.filter(bate).sort(porNome);
  const falhas = minhas.filter(emAlarme).sort(porNome);
  const resto = minhas.filter((t) => !emAlarme(t)).sort(porNome);

  const blocos = [];
  const resumo = document.createElement('div');
  resumo.className = 'rot-resumo' + (falhasMinhas || (!total && rotinasCache.erro) ? ' tem-falha' : '');
  blocos.push(resumo);
  if (!total) {
    /* Os tres jeitos de nao ter lista, cada um com o seu texto. Antes o erro
       dizia so' "Não consegui ler o Agendador" -- o motivo sumia, nao havia como
       tentar de novo, e fora do Windows a frase era a mesma (mentira: nao ha'
       Agendador pra ler). */
    const soWindows = /só existem no Windows/.test(rotinasCache.erro);
    if (soWindows) {
      resumo.className = 'rot-resumo';
      resumo.textContent = 'Automações agendadas só existem no Windows.';
    } else if (rotinasCache.erro) {
      resumo.textContent = 'Não consegui ler o Agendador do Windows.';
      blocos.push(blocoDeInfo(rotinasCache.erro, botaoDeRotina('tentar de novo', 'Lê o Agendador outra vez', () => pintarRotinas(true, true))));
    } else {
      resumo.textContent = 'Nenhuma automação agendada neste PC.';
      blocos.push(blocoDeInfo('As tarefas do próprio Windows ficam de fora da lista. As que você criar no Agendador aparecem aqui.'));
    }
  } else {
    resumo.textContent = falhasMinhas
      ? (falhasMinhas === 1 ? '1 das suas falhou na última vez' : falhasMinhas + ' das suas falharam na última vez')
      : (minhasTodas.length ? (desligadasComFalha ? 'Nenhuma das ligadas falhou na última vez' : 'Nenhuma das suas falhou na última vez') : 'Nenhuma automação sua neste PC');
    const sub = document.createElement('div');
    sub.className = 'rot-sub';
    sub.textContent = [
      minhasTodas.length + (minhasTodas.length === 1 ? ' sua' : ' suas'),
      sistemaTodas.length ? sistemaTodas.length + ' do sistema' + (falhasDoSistema ? ' (' + falhasDoSistema + ' com falha)' : '') : '',
      rodandoAgora ? rodandoAgora + ' rodando agora' : '',
      rotinasCache.lidoEm && !rotinasCache.velha ? 'conferido às ' + horaCurta(rotinasCache.lidoEm) : '',
    ].filter(Boolean).join(' · ');
    blocos.push(sub);
    if (rotinasCache.erro) {
      const m = document.createElement('div');
      m.className = 'rot-nota erro';
      m.textContent = 'Não consegui atualizar: ' + rotinasCache.erro.replace(/[.\s]*$/, '')
        + (rotinasCache.lidoEm ? '. Esta é a lista das ' + horaCurta(rotinasCache.lidoEm) + '.' : '. Esta é a lista de antes.');
      blocos.push(m);
    }
  }
  // o bloco vermelho vem primeiro e fechado numa caixa propria: e' o que a tela
  // veio resolver, nao pode virar mais uma linha no meio de trinta
  if (falhas.length) {
    const cx = document.createElement('div');
    cx.className = 'rot-caixa';
    cx.appendChild(grupoDeRotinas(window.CockpitUI ? 'Parou' : 'Com erro na última vez', falhas.length));
    for (const t of falhas) cx.appendChild(linhaDaRotina(t, agora));
    blocos.push(cx);
  }
  if (resto.length) {
    if (window.CockpitUI) {
      const emDia = resto.filter(t => t.resultado === 0 && t.ultima && !t.falhou && t.estado !== 'desativada' && t.estado !== 'rodando');
      const demais = resto.filter(t => !emDia.includes(t));
      for (const [nome, tarefas] of [['Em dia', emDia], ['Outras automações', demais]]) {
        if (!tarefas.length) continue;
        blocos.push(grupoDeRotinas(nome, tarefas.length));
        for (const t of tarefas) blocos.push(linhaDaRotina(t, agora));
      }
    } else {
      blocos.push(grupoDeRotinas(falhas.length ? 'As outras suas' : 'Suas automações', resto.length));
      for (const t of resto) blocos.push(linhaDaRotina(t, agora));
    }
  }
  // as de fabricante ficam recolhidas: presentes, contadas, fora do destaque.
  // Com filtro elas abrem sozinhas (quem busca quer ver o que achou).
  if (doSistema.length) {
    const aberto = rotinasOutrasAbertas || !!filtro;
    blocos.push(cabecalhoDasOutras(doSistema.length, doSistema.filter(emAlarme).length, !filtro, aberto));
    if (aberto) for (const t of doSistema) blocos.push(linhaDaRotina(t, agora));
  }
  if (filtro && !minhas.length && !doSistema.length) blocos.push(blocoDeInfo('Nenhuma automação com "' + filtroCru + '".'));
  box.innerHTML = '';
  for (const b of blocos) box.appendChild(b);
}
/* Sem a guarda do :hover o botao some debaixo do mouse no meio do clique,
   porque o repaint troca a linha inteira. Com o foco do teclado dentro da
   lista, o mesmo: repintar jogava o foco fora. Janela escondida nao pinta. */
setInterval(() => {
  if (document.hidden || !rotinasVisivel()) return;
  const b = $('#rotinas');
  if (b && (b.matches(':hover') || (document.activeElement && b.contains(document.activeElement)))) return;
  pintarRotinas(false);
}, 8000);
/* Tecla digitada DENTRO da view e' da view. Provado na tela: com a tela de
   boas-vindas aberta, Enter numa linha (ou num botao dela) e um "2" digitado no
   filtro chegavam no ouvinte da abertura, que abria painel do Claude e do Codex
   e roubava o foco. Atalho com Ctrl/Alt continua subindo; Esc e Tab tambem. */
const teclaDaView = (e) => !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== 'Escape' && e.key !== 'Tab';
const caixaDasRotinas = $('#rotinas');
// auditoria 1: o Esc dentro da lista tambem para aqui (a linha fecha no ouvinte dela)
if (caixaDasRotinas) caixaDasRotinas.addEventListener('keydown', (e) => { if (teclaDaView(e) || e.key === 'Escape') e.stopPropagation(); });
const campoDasRotinas = $('#rotFiltro');
if (campoDasRotinas) {
  campoDasRotinas.addEventListener('input', () => pintarRotinas(false));
  // Esc limpa o filtro e fica AQUI: nao pode chegar no Esc global (que para painel)
  campoDasRotinas.addEventListener('keydown', (e) => {
    if (teclaDaView(e)) { e.stopPropagation(); return; }
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (campoDasRotinas.value) { campoDasRotinas.value = ''; pintarRotinas(false); }
  });
}

/* ===================== ENTRADA SEM DIGITAR =====================
   Outras portas alem do teclado: recorte de tela, foto pela webcam, texto
   tirado de imagem (OCR do Windows), prompts salvos, caixa de entrada do
   celular. O ditado e os comandos de voz moram em ligarDitado. */
function normalizarFala(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
async function recortarTela(P) {
  fecharMenus();
  let r = null;
  try { r = await window.api.recortarTela({ paneId: P.id }); } catch (e) { r = { error: String(e && e.message || e) }; }
  if (r && r.error) note(P, 'Não consegui recortar: ' + r.error, true);
}
/* foto pela webcam (ou pelo celular, quando ele esta' como camera do Windows):
   rascunho no papel, quadro fisico, o que estiver na sua frente */
async function fotografar(P) {
  fecharMenus();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { note(P, 'Este computador não deixa abrir a câmera por aqui.', true); return; }
  const cx = abrirModalGlobal();
  cx.className = 'modal-cx foto-cx';
  cx.innerHTML = '<div class="mo-top"><span class="mo-tit">Fotografar</span><button class="mo-x">' + ico('x') + '</button></div>'
    + '<div class="mo-sub">Enquadre e clique em Tirar. A foto entra como anexo do painel.</div>'
    + '<video class="foto-video" autoplay playsinline muted></video>'
    + '<div class="mo-form"><select id="fotoCam" class="menu-search"></select></div>'
    + '<div class="mo-rodape"><button class="mo-btn destaque" id="fotoTirar">Tirar</button><button class="mo-btn" id="fotoCancela">Cancelar</button></div>';
  const video = $('.foto-video', cx);
  let trilha = null, fechado = false;
  const parar = () => { try { trilha && trilha.getTracks().forEach((t) => t.stop()); } catch {} trilha = null; };
  const fechar = () => { parar(); fecharModalGlobal(); };
  // fechar pelo veu ou por Esc passa por aqui: a luz da camera nao fica acesa sem tela
  aoFecharModalGlobal = () => { fechado = true; parar(); try { video.srcObject = null; } catch {} };
  $('.mo-x', cx).onclick = fechar;
  $('#fotoCancela', cx).onclick = fechar;
  const abrir = async (deviceId) => {
    parar();
    try {
      const nova = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } } : { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      // a caixa fechou enquanto a camera acordava: a trilha atrasada morre aqui mesmo
      if (fechado) { try { nova.getTracks().forEach((t) => t.stop()); } catch {} return; }
      trilha = nova; video.srcObject = trilha;
    } catch (err) {
      if (fechado) return;
      const nome = (err && err.name) || '';
      // a camera lembrada sumiu (celular desconectado): esquece a preferencia e cai na padrao
      if (deviceId && (nome === 'OverconstrainedError' || nome === 'NotFoundError' || nome === 'NotReadableError')) {
        if (nome !== 'NotReadableError') { cfg.cameraPreferida = ''; window.api.setConfig(cfg); }   // "em uso" e' passageiro: a preferencia fica
        return abrir(null);
      }
      fechar();
      note(P, nome === 'NotAllowedError' ? 'O Windows não deixou usar a câmera. Libere em Privacidade > Câmera.'
        : nome === 'NotFoundError' ? 'Nenhuma câmera encontrada.'
        : nome === 'NotReadableError' ? 'A câmera está em uso por outro programa.'
        : 'Não consegui abrir a câmera' + (nome ? ' (' + nome + ')' : '') + '.', true);
    }
  };
  await abrir(cfg.cameraPreferida || null);
  if (!trilha || fechado) return;
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const sel = $('#fotoCam', cx);
    sel.innerHTML = '';
    for (const d of devs) { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || 'Câmera'; if (d.deviceId === cfg.cameraPreferida) o.selected = true; sel.appendChild(o); }
    sel.classList.toggle('hidden', devs.length < 2);
    sel.addEventListener('change', () => { cfg.cameraPreferida = sel.value; window.api.setConfig(cfg); abrir(sel.value); });
  } catch {}
  $('#fotoTirar', cx).onclick = async () => {
    if (!video.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    const dados = c.toDataURL('image/jpeg', 0.92);
    fechar();
    const r = await window.api.imagemSalvar({ dados, prefixo: 'foto' });
    if (r && r.arquivo) { await anexar(P, [r.arquivo]); note(P, 'Foto anexada.'); }
    else note(P, 'Não consegui guardar a foto: ' + ((r && r.error) || 'erro'), true);
  };
}
/* OCR: o texto que esta' na imagem vai pro campo, editavel */
async function extrairTexto(P, a, bt) {
  if (a._ocr) return;   // ja esta lendo (a ficha pode ter sido repintada no meio)
  a._ocr = true;
  const antes = bt ? bt.textContent : '';
  if (bt) { bt.textContent = 'lendo…'; bt.disabled = true; }
  let r = null;
  try { r = await window.api.ocrLer({ arquivo: a.path }); } catch (e) { r = { error: String(e && e.message || e) }; }
  a._ocr = false;
  if (bt && bt.isConnected) { bt.textContent = antes; bt.disabled = false; }
  else if ((P.anexos || []).includes(a)) pintarAnexos(P);   // a barra foi repintada no meio: o botao novo estava "lendo…"
  if (r && r.texto) { inserirNoInput(P, r.texto); note(P, 'Texto da imagem colocado no campo (confira antes de mandar).'); }
  else note(P, 'Não achei texto nessa imagem' + (r && r.error ? ': ' + r.error : '.'), true);
}
/* prompts salvos: reaproveitar pedidos longos sem redigitar */
async function salvarPromptDoCampo(P) {
  const inp = $('.p-input', P.el);
  const texto = (inp && inp.value.trim()) || '';
  if (!texto) { note(P, 'Escreva o prompt no campo primeiro; depois salve por aqui.', true); return; }
  const nome = await perguntarTexto('Salvar prompt', 'Um nome curto pra achar depois no menu /.', texto.replace(/\s+/g, ' ').slice(0, 40));
  if (!nome || !nome.trim()) return;
  const lista = (await window.api.promptsLer()) || [];
  const limpo = nome.trim().slice(0, 60);
  const semIgual = lista.filter((p) => p.nome !== limpo);
  semIgual.unshift({ nome: limpo, texto, quando: Date.now() });
  const r = await window.api.promptsSalvar(semIgual);
  note(P, r && r.ok ? 'Prompt "' + limpo + '" salvo. Aparece no menu / em "Prompts salvos".' : 'Não consegui salvar: ' + ((r && r.error) || 'erro'), !(r && r.ok));
}
async function apagarPromptSalvo(P) {
  const lista = (await window.api.promptsLer()) || [];
  if (!lista.length) { note(P, 'Nenhum prompt salvo ainda.'); return; }
  const m = novoMenu(P);
  m.appendChild(tituloPopup('Apagar prompt salvo'));
  m.appendChild(subPopup('Clique no que quer apagar.'));
  for (const p of lista) m.appendChild(elItem({ ic: 'eraser', nome: p.nome, desc: String(p.texto || '').replace(/\s+/g, ' ').slice(0, 80) }, async () => {
    const r = await window.api.promptsSalvar(lista.filter((x) => x !== p));
    note(P, r && r.ok ? 'Prompt "' + p.nome + '" apagado.' : 'Não consegui apagar.', !(r && r.ok));
  }));
}
/* caixa de entrada: audio transcrito/foto que chegou do celular (ou de um
   script) vira tarja com "usar" - o texto vai pro campo do painel em foco, a
   imagem vira anexo */
function chegouNaInbox(m) {
  if (!m || !m.arquivo) return;
  const corta = (s) => '"' + String(s || '').replace(/\s+/g, ' ').slice(0, 80) + (String(s || '').length > 80 ? '…' : '') + '"';
  const resumo = m.tipo === 'texto' ? corta(m.texto) : ((m.nome || 'imagem') + (m.legenda ? ' · ' + corta(m.legenda) : ''));
  // o mesmo nome regravado: a tarja antiga apontava pro MESMO caminho, e o X dela apagava a mensagem nova
  try { [...document.querySelectorAll('#avisos [data-aviso^="inbox-' + CSS.escape(m.nome) + '-"]')].forEach((t) => t.remove()); } catch {}
  const idAviso = 'inbox-' + m.nome + '-' + Math.round((m.quando || Date.now()) / 1000);
  mostrarAviso({
    // id por arquivo E hora: o mesmo nome noutro dia nao herda o "fechado" do anterior
    id: idAviso, tipo: 'info', fixo: true,
    texto: (m.tipo === 'texto' ? '📱 Chegou do celular: ' : '📱 Imagem do celular: ') + resumo,
    acao: 'usar',
    aoClicar: () => usarDaInbox(m),
    // o X descarta de verdade (apaga da caixa); antes so' escondia e o arquivo voltava a cada abertura
    aoFechar: () => { try { window.api.inboxConsumir({ arquivo: m.arquivo, apagar: true }); } catch {} },
  });
  // o X aqui nao so' esconde: apaga da caixa. Dizer isso.
  try { const x = document.querySelector('#avisos [data-aviso="' + CSS.escape(idAviso) + '"] .avi-x'); if (x) x.title = 'Descartar: apaga da caixa de entrada'; } catch {}
}
async function usarDaInbox(m) {
  const P = focusPane || [...panes.values()][0];
  if (!P) { mostrarAviso({ tipo: 'alerta', texto: 'Abra um painel primeiro; a mensagem continua na caixa de entrada.' }); return; }
  let r = null;
  try { r = await window.api.inboxConsumir({ arquivo: m.arquivo }); } catch {}
  if (m.tipo === 'texto') { inserirNoInput(P, m.texto || ''); const c = $('.p-input', P.el); if (c) c.focus(); }
  else if (r && r.arquivo) {
    await anexar(P, [r.arquivo]);
    if (m.legenda) inserirNoInput(P, m.legenda);   // a legenda da foto vai junto, no campo
    note(P, 'Imagem do celular anexada.');
  }
  else note(P, 'Não consegui pegar a imagem da caixa de entrada' + (r && r.error ? ': ' + r.error : '.'), true);
}

/* ===================== QUADRO BRANCO (Excalidraw embutido) =====================
   Desenhar arquitetura, fluxo ou tela e mandar como imagem - nenhum dos
   concorrentes tem isso embutido. O bundle (vendor/quadro.js, 1,4 MB + fontes
   locais) so' e' carregado na primeira abertura, pra nao pesar o boot. A cena
   fica guardada por painel (P.quadroCena) e volta ao reabrir. */
let quadro = null;            // { q, P } enquanto aberto
let quadroCarregando = null;
function carregarQuadro() {
  if (window.Quadro) return Promise.resolve(true);
  if (quadroCarregando) return quadroCarregando;
  quadroCarregando = new Promise((res, rej) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = 'vendor/quadro.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'vendor/quadro.js';
    s.onload = () => res(true);
    s.onerror = () => { quadroCarregando = null; rej(new Error('não consegui carregar o quadro (vendor/quadro.js)')); };
    document.head.appendChild(s);
  });
  return quadroCarregando;
}
async function abrirQuadro(P, cenaInicial) {
  fecharMenus();
  const cx = $('#quadro');
  if (!cx || !P) return;
  // desenho proprio do painel nao e' trocado pelo de um arquivo sem perguntar
  if (cenaInicial && (P.quadroCena || P.quadroArquivo) && !confirm('Este painel já tem um desenho. Trocar pelo do arquivo? O atual se perde.')) return;
  try { await carregarQuadro(); } catch (e) { note(P, String(e && e.message || e), true); return; }
  if (quadro) fecharQuadro();
  // cena guardada em arquivo (nao no config): le na hora de abrir. Nao passa pelo
  // fs:read, que corta em 500 KB - um print colado ja passa disso
  if (!cenaInicial && !P.quadroCena && P.quadroArquivo) {
    let r = null;
    try { r = await window.api.textoLer({ arquivo: P.quadroArquivo }); } catch (e) { r = { error: String(e && e.message || e) }; }
    if (r && r.content) P.quadroCena = r.content;
    else if (r && /ENOENT|no such file/i.test(String(r.error || ''))) {
      // o arquivo sumiu de verdade: comeca do zero, mas avisando
      P.quadroArquivo = null; savePanes();
      note(P, 'O arquivo do desenho deste painel sumiu; o quadro abre vazio.', true);
    } else {
      // sem conseguir ler, abrir vazio e fechar apagaria o caminho: nao abre, nao apaga nada
      note(P, 'Não consegui ler o desenho guardado (' + ((r && r.error) || 'erro') + '). Ele continua em ' + P.quadroArquivo + '.', true);
      return;
    }
  }
  cx.classList.remove('hidden');
  const tema = (cfg.tema === 'claro' || cfg.tema === 'jornal') ? 'light' : 'dark';
  let cena = cenaInicial || P.quadroCena || null;
  let q;
  try {
    q = window.Quadro.montar($('#quadroArea'), { tema, langCode: 'pt-BR', cena: cena || undefined });
  } catch (e) { cx.classList.add('hidden'); note(P, 'O quadro não abriu: ' + (e && e.message || e), true); return; }
  quadro = { q, P };
  $('#quadroTit').textContent = 'Quadro · ' + (P.titulo || nomeDoMotor(P.engine));
  try { await q.pronto; } catch {}
  focarQuadro();
  if (cenaInicial && quadro && quadro.q === q) {
    // cena vinda de arquivo (o agente escreveu): entra depois de pronto, ajustada na tela
    try { await q.carregar(cenaInicial, { ajustar: true }); } catch (e) { note(P, 'Não consegui ler esse desenho: ' + (e && e.message || e), true); }
  }
}
/* o foco tem que estar DENTRO do Excalidraw: com ele no campo de texto atras,
   Esc interrompia o agente e as teclas de ferramenta iam parar no prompt */
function focarQuadro() {
  if (!quadro) return;
  const alvo = $('#quadroArea .excalidraw-container') || $('#quadroArea .excalidraw');
  if (!alvo) return;
  if (!alvo.hasAttribute('tabindex')) alvo.setAttribute('tabindex', '-1');
  try { alvo.focus({ preventScroll: true }); } catch {}
  const at = document.activeElement;
  if (at && at.closest && at.closest('.p-input')) at.blur();
}
/* feedback do quadro no proprio topo dele: note() e as tarjas ficam ATRAS do overlay */
function avisarNoQuadro(msg, erro) {
  const d = $('.quadro-dica'); if (!d) return;
  if (!d._padraoNodes) d._padraoNodes = [...d.childNodes].map(n => n.cloneNode(true));
  d.textContent = msg; d.classList.toggle('erro', !!erro);
  clearTimeout(d._t);
  d._t = setTimeout(() => { d.replaceChildren(...d._padraoNodes.map(n => n.cloneNode(true))); d.classList.remove('erro'); }, 6000);
}
function fecharQuadro() {
  const cx = $('#quadro');
  if (!cx || cx.classList.contains('hidden') || !quadro) { if (cx) cx.classList.add('hidden'); quadro = null; return; }
  const { q, P } = quadro;
  try { P.quadroCena = q.vazio() ? null : q.cena(); } catch {}
  try { q.destruir(); } catch {}
  quadro = null;
  cx.classList.add('hidden');
  /* a cena vai pra um arquivo proprio do painel (userData/quadros); a ficha
     guarda so' o caminho. Antes ia inteira no config a cada savePanes (ate' 200 KB
     por painel, e um print colado passava disso e sumia calado). */
  if (P.quadroCena) {
    // reaproveita o arquivo que a ficha ja aponta (o id do painel muda a cada abertura do app)
    const nomeQuadro = P.quadroArquivo ? String(P.quadroArquivo).split(/[\\/]/).pop().replace(/\.excalidraw$/, '') : 'quadro-' + P.id;
    window.api.textoSalvar({ texto: P.quadroCena, prefixo: 'quadro', ext: 'excalidraw', nome: nomeQuadro }).then((r) => {
      if (r && r.arquivo) { P.quadroArquivo = r.arquivo; savePanes(); }
      else if (r && r.error) note(P, 'Não consegui guardar o desenho: ' + r.error + ' (ele fica só enquanto o app estiver aberto).', true);
    }).catch(() => {});
  } else { P.quadroArquivo = null; savePanes(); }
  const c = $('.p-input', P.el);
  if (c) c.focus();
}
async function anexarQuadro(comoArquivo) {
  if (!quadro) return;
  const { q, P } = quadro;
  const avisa = (m, erro) => (quadro ? avisarNoQuadro(m, erro) : note(P, m, erro));
  try {
    if (q.vazio()) { avisa('O quadro está vazio: desenhe alguma coisa antes de anexar.', true); return; }
    P.quadroCena = q.cena();
    let arquivo = null;
    if (comoArquivo) {
      const r = await window.api.textoSalvar({ texto: P.quadroCena, prefixo: 'quadro', ext: 'excalidraw' });
      if (!r || !r.arquivo) throw new Error((r && r.error) || 'não salvou');
      arquivo = r.arquivo;
    } else {
      const blob = await q.exportarPng({ escala: 2, fundo: true, escuro: false });
      if (!blob) { avisa('O quadro está vazio.', true); return; }
      const dados = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error('leitura do PNG')); fr.readAsDataURL(blob); });
      const r = await window.api.imagemSalvar({ dados, prefixo: 'quadro' });
      if (!r || !r.arquivo) throw new Error((r && r.error) || 'não salvou');
      arquivo = r.arquivo;
    }
    fecharQuadro();
    await anexar(P, [arquivo]);
    note(P, comoArquivo ? 'Cena .excalidraw anexada: o agente pode abrir, editar e escrever de volta.' : 'Desenho anexado como imagem.');
  } catch (e) { avisa('Não consegui anexar o quadro: ' + (e && e.message || e), true); }
}
/* leva 41 (B5) "Mandar pro prompt": o PNG vai anexado E o passo a passo do fluxo
   (QuadroFluxo.fluxoEmTexto) entra no campo, editavel, antes de enviar. A IA le
   o texto (caixa = passo, losango = decisao, seta = o que vem depois); a imagem
   confirma o que o texto nao pega (rabisco, print colado). */
function escreverFluxoNoCampo(P, texto) {
  const campo = $('.p-input', P.el);
  if (!campo) return;
  const antes = campo.value.replace(/\s+$/, '');
  campo.value = antes ? antes + '\n\n' + texto : texto;
  campo.dispatchEvent(new Event('input', { bubbles: true }));   // cresce o campo e guarda o rascunho
  campo.focus();
  campo.setSelectionRange(campo.value.length, campo.value.length);
  campo.scrollTop = campo.scrollHeight;
}
async function mandarQuadroProPrompt() {
  if (!quadro) return;
  const { q, P } = quadro;
  const avisa = (m, erro) => (quadro ? avisarNoQuadro(m, erro) : note(P, m, erro));
  try {
    if (q.vazio()) { avisa('O quadro está vazio: desenhe o fluxo antes de mandar.', true); return; }
    const cena = q.cena();
    let texto = '';
    try { texto = window.QuadroFluxo ? window.QuadroFluxo.fluxoEmTexto(cena, { comImagem: true }) : ''; } catch {}
    const blob = await q.exportarPng({ escala: 2, fundo: true, escuro: false });
    if (!blob) { avisa('O quadro está vazio.', true); return; }
    const dados = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error('leitura do PNG')); fr.readAsDataURL(blob); });
    const r = await window.api.imagemSalvar({ dados, prefixo: 'quadro' });
    if (!r || !r.arquivo) throw new Error((r && r.error) || 'não salvou');
    fecharQuadro();   // guarda a cena no painel, como o Fechar
    await anexar(P, [r.arquivo]);
    if (texto) escreverFluxoNoCampo(P, texto);
    note(P, texto
      ? 'Desenho anexado e o passo a passo do fluxo foi pro campo: revise e envie.'
      : 'Desenho anexado. Não achei caixa, seta nem texto pra descrever, então vai só a imagem.');
  } catch (e) { avisa('Não consegui mandar o desenho: ' + (e && e.message || e), true); }
}
(() => {
  const liga = (id, fn) => { const b = document.getElementById(id); if (b) b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); };
  liga('quadroPrompt', () => mandarQuadroProPrompt());
  liga('quadroAnexar', () => anexarQuadro(false));
  liga('quadroArquivo', () => anexarQuadro(true));
  liga('quadroLimpar', () => {
    if (!quadro) return;
    let temCoisa = false; try { temCoisa = !quadro.q.vazio(); } catch {}
    if (temCoisa && !confirm('Apagar tudo do quadro? Não dá pra desfazer.')) return;
    quadro.q.limpar(); focarQuadro();
  });
  liga('quadroFechar', () => fecharQuadro());
})();

/* ===================== MOTOR DESATUALIZADO? =====================
   Checa 1x por abertura (com cache de 20h no main) e avisa na faixa do topo.
   Foi assim que se descobriu o Claude 13 versoes atras sem ninguem saber. */
const versaoMaisNova = (a, b) => {
  const pa = String(a || '').split('.').map(Number), pb = String(b || '').split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pb[i] || 0) > (pa[i] || 0)) return true; if ((pb[i] || 0) < (pa[i] || 0)) return false; }
  return false;
};
async function checarVersoesDosMotores() {
  let vs = null;
  try { vs = await window.api.motoresVersoes(); } catch { return; }
  if (!vs || typeof vs !== 'object') return;
  const comandos = { claude: 'claude update', codex: 'npm i -g @openai/codex', gemini: 'npm i -g @google/gemini-cli' };
  for (const eng of Object.keys(vs)) {
    const v = vs[eng];
    if (!v || !v.instalada || !v.ultima || !versaoMaisNova(v.instalada, v.ultima)) continue;
    mostrarAviso({
      id: 'update-' + eng,
      tipo: 'info', motor: eng,
      texto: nomeDoMotor(eng) + ' tem versão nova: ' + v.instalada + ' → ' + v.ultima + '. Atualize com "' + (comandos[eng] || '') + '" no terminal.',
    });
  }
}

async function novaConversa(engine) {
  /* "Nova conversa" na coluna de um motor que nao esta na maquina abria um
     painel que so' quebrava na primeira mensagem. A tela de abertura e o menu
     de motores ja recusavam; aqui faltava. */
  /* aba de servidor: so' o Claude roda la' (mesma guarda do trocarMotor). Sem
     isto, "Nova conversa" do Codex abria um Codex no PC com a tela dizendo VPS. */
  const abaNova = abaAtual(), abaIdNova = cfg.abaAtiva;
  const remotoNovo = remotoDoAba(abaNova), origemNova = JSON.stringify(remotoNovo);
  const origemValida = () => cfg.abaAtiva === abaIdNova && abaAtual() === abaNova && JSON.stringify(remotoDoAba(abaNova)) === origemNova;
  const soClaudeAqui = !!remotoNovo && !(await capacidadeRemota(engine, remotoNovo));
  if (!origemValida()) return;
  if ((!remotoNovo && motorDisponivel[engine] === false) || soClaudeAqui) {
    const recado = soClaudeAqui
      ? 'O ' + nomeDoMotor(engine) + ' está indisponível neste servidor. Confira a instalação e a conexão.'
      : 'O ' + nomeDoMotor(engine) + ' não está instalado nesta máquina. ' + (COMO_INSTALAR[engine] || '');
    const av = $('#bvAviso');
    /* nada de alert(): ele TRAVA a janela inteira do Electron. O recado aparece
       onde a pessoa estava olhando - a tela de abertura, o painel em foco, ou a
       propria coluna onde ela clicou. */
    if (av) { av.textContent = recado; av.classList.remove('hidden'); }
    else if (focusPane) note(focusPane, recado, true);
    else {
      const box = caixaDoMotor('hist', engine);
      if (box) {
        box.innerHTML = '';
        const d = document.createElement('div');
        d.className = 'hist-load';
        d.textContent = recado;
        box.appendChild(d);
      }
    }
    return;
  }
  // a pasta tem que ser a da ABA: numa aba de servidor, cfg.defCwd e' um caminho
  // do Windows e o painel tentava entrar nele dentro do Linux
  const P = cabeMaisPainel()
    ? newPane({ engine, cwd: cwdPadraoDaAba(abaNova), abaId: abaIdNova })
    : focusPane;
  if (!P) return;
  const motorAnterior = P.engine;
  P.uiEnvioGeracao = (P.uiEnvioGeracao || 0) + 1;
  await window.api.paneStop({ paneId: P.id, engine: motorAnterior });
  if (P.morto || !origemValida() || P.engine !== motorAnterior || P.abaId !== abaIdNova) return;
  destravarPainel(P);
  if (P.engine !== engine) P.model = '';   // o modelo (ou o comando ACP) era do motor anterior
  P.engine = engine; P.resumeId = null; P.started = false; P.titulo = ''; P.hist = [];
  P.modoReal = null; P._avisouModo = false;   // auditoria 2: o modo real era da conversa de antes
  P.mode = modoValido(engine, P.mode);   // "Auto" do Claude nao existe no ACP: o rotulo mentia e o agente rodava em manual
  // painel reaproveitado: sem isto ele voltava na conversa antiga ao reabrir o app
  P.sessaoId = null; P.sessaoFile = ''; P.sessaoRemota = false; P.resumeAnterior = null;
  P.tokens = 0; P.janela = 0; P.passarContexto = null; P.nomeManual = false;
  esquecerTituloAuto(P);   // leva 41 (B6): conversa nova, nome novo
  P.anexos = []; pintarAnexos(P); pintarTokens(P); esconderPermissao(P);
  P.chat.innerHTML = ''; P.blocks.clear(); P.tools.clear(); esquecerPassos(P); pintarNome(P);
  limparPlano(P); limparAuditoria(P); zerarTurno(P); P.forkPendente = false; P.avisoModelo = null; P.acpInfo = null; P.acpModelos = null; P.worktree = (engine === 'claude' ? P.worktree : null);   // conversa nova na mesma arvore continua no worktree
  fillModels(P); paintEngine(P); pintarModo(P); setDot(P, 'off'); setFocus(P);
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
$('#btnAddPane').addEventListener('click', () => { if (cabeMaisPainel()) newPane(); });
$('#btnPickFolder').addEventListener('click', async () => {
  if (!focusPane) return;
  $('.p-cwd', focusPane.el).click();
});
function aplicarTema(t) {
  const visual = t === 'motti' ? 'azul' : (t || 'escuro');
  document.documentElement.setAttribute('data-tema', visual);
  $$('.tema-bt').forEach(b => b.classList.toggle('on', b.dataset.tema === visual));
}
$$('.tema-bt').forEach(b => b.addEventListener('click', async () => {
  cfg.tema = b.dataset.tema;
  aplicarTema(cfg.tema);
  await window.api.setConfig(cfg);
}));

$('#chkRobos').addEventListener('change', async (e) => {
  cfg.verRobos = e.target.checked;
  await window.api.setConfig(cfg);
  for (const eng of MOTORES) histCache[eng] = null;
  const aberta = $$('.side-view').find(v => !v.classList.contains('hidden'));
  for (const eng of MOTORES) if (aberta && aberta.dataset.view === 'h' + eng) loadHist(eng, true);
});

/* ---- sua foto ----
   A foto ia INTEIRA pro config.json (ate ~4 MB em base64), e o config e'
   regravado -- com .bak -- a cada pausa de digitacao, alem de cada balao seu
   carregar a imagem cheia. O avatar tem 46 px: 256 px sobram. Reduz AQUI, antes
   de gravar (o canvas do Chromium le png, jpg, webp e gif). */
const FOTO_LADO = 256;
function medidaDaFoto(w, h, max = FOTO_LADO) {
  const W = Math.max(1, Math.round(Number(w) || 1)), H = Math.max(1, Math.round(Number(h) || 1));
  const k = Math.min(1, max / Math.max(W, H));
  return { w: Math.max(1, Math.round(W * k)), h: Math.max(1, Math.round(H * k)) };
}
/* devolve o dataURL reduzido (ou o mesmo, se ja' for pequeno); null se a
   imagem nao abrir. PNG so' quando ha' transparencia de verdade (senao o fundo
   transparente viraria preto no jpeg); o resto vai em jpeg 0,85. */
function reduzirFoto(dataUrl) {
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => {
      try {
        const { w, h } = medidaDaFoto(img.naturalWidth, img.naturalHeight);
        if (w === img.naturalWidth && h === img.naturalHeight && String(dataUrl).length < 400000) return ok(dataUrl);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, 0, 0, w, h);
        let transparente = false;
        if (!/^data:image\/jpe?g/i.test(String(dataUrl))) {
          const px = g.getImageData(0, 0, w, h).data;
          for (let i = 3; i < px.length; i += 4) if (px[i] < 250) { transparente = true; break; }
        }
        ok(transparente ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85));
      } catch { ok(null); }
    };
    img.onerror = () => ok(null);
    img.src = dataUrl;
  });
}
async function usarFotoEscolhida(r) {
  if (!r) return false;
  // nada de alert(): ele TRAVA a janela inteira do Electron
  if (r.error) { mostrarAviso({ id: 'foto', tipo: 'erro', texto: r.error }); return false; }
  const pequena = await reduzirFoto(r.dataUrl);
  if (!pequena) { mostrarAviso({ id: 'foto', tipo: 'erro', texto: 'Não consegui abrir essa imagem. Tente outra (PNG ou JPG).' }); return false; }
  cfg.foto = pequena; await window.api.setConfig(cfg); repintarAvatares();
  return true;
}
/* foto de antes desta versao (a do Hugo tinha 3,7 MB no config): reduz na
   primeira abertura e regrava UMA vez. Pequena, nem decodifica. */
async function encolherFotoAntiga() {
  if (!cfg.foto || String(cfg.foto).length < 120000) return false;
  const antes = cfg.foto;
  const nova = await reduzirFoto(antes);
  if (!nova || nova.length >= antes.length || cfg.foto !== antes) return false;
  cfg.foto = nova; await window.api.setConfig(cfg); repintarAvatares();
  return true;
}
/* confirmacao pelo modal do proprio app (o confirm() do navegador trava a janela) */
function confirmarNoApp(titulo, texto, rotuloOk) {
  return new Promise((res) => {
    const cx = abrirModalGlobal();
    cx.innerHTML = '<div class="mo-top"><span class="mo-tit"></span><button class="mo-x">' + ico('x') + '</button></div>'
      + '<div class="mo-sub"></div>'
      + '<div class="mo-rodape"><button class="mo-btn destaque" data-conf="ok"></button><button class="mo-btn" data-conf="nao">Cancelar</button></div>';
    $('.mo-tit', cx).textContent = titulo;
    $('.mo-sub', cx).textContent = texto || '';
    const ok = $('[data-conf="ok"]', cx);
    ok.textContent = rotuloOk || 'OK';
    let feito = false;
    const fim = (v) => { if (feito) return; feito = true; fecharModalGlobal(); res(v); };
    aoFecharModalGlobal = () => fim(false);   // veu/Esc: quem esperava nao fica pendurado
    $('.mo-x', cx).onclick = () => fim(false);
    $('[data-conf="nao"]', cx).onclick = () => fim(false);
    ok.onclick = () => fim(true);
    setTimeout(() => ok.focus(), 30);
  });
}
$('#btnFoto').addEventListener('click', async () => { await usarFotoEscolhida(await window.api.pickPhoto()); });
$('#btnFotoTirar').addEventListener('click', async () => {
  if (!cfg.foto) return;
  if (!(await confirmarNoApp('Remover sua foto?', 'Suas mensagens voltam a mostrar o ícone padrão. Dá pra escolher outra depois.', 'Remover'))) return;
  delete cfg.foto; await window.api.setConfig(cfg); repintarAvatares();
});

$('#btnDefCwd').addEventListener('click', async () => {
  const p = await window.api.pickFolder({ start: cfg.defCwd || HOME, titulo: 'Pasta inicial dos painéis novos' });
  if (!p) return;
  cfg.defCwd = p; await window.api.setConfig(cfg); $('#defCwd').textContent = p;
});

/* "Modelo dos paineis novos (Claude)": vazio = o padrao da lista (Sonnet 5).
   Painel aberto nao muda: ele ja' tem o modelo dele. */
function ligarSeletorModeloClaude() {
  const sel = $('#selModeloClaude');
  if (!sel) return;
  sel.innerHTML = '';
  const padraoDaLista = MODELOS_CLAUDE.find((m) => m.padrao) || MODELOS_CLAUDE[0];
  for (const m of MODELOS_CLAUDE) {
    const o = document.createElement('option');
    o.value = m.id === padraoDaLista.id ? '' : m.id;
    o.textContent = m.id === padraoDaLista.id ? m.nome + ' (padrão)' : m.nome;
    sel.appendChild(o);
  }
  sel.value = MODELOS_CLAUDE.some((m) => m.id === cfg.defModelClaude && m.id !== padraoDaLista.id) ? cfg.defModelClaude : '';
  sel.addEventListener('change', async () => {
    cfg.defModelClaude = sel.value;
    await window.api.setConfig(cfg);
    aplicarPadraoNosPaineisVazios();
  });
}
/* auditoria 2: painel do Claude ja' na tela, VAZIO (sem conversa, sem mensagem
   mandada, motor desligado) e cujo modelo ninguem escolheu (entrou o padrao):
   o padrao novo vale nele tambem. Painel com conversa, com modelo escolhido a
   mao ou restaurado com o modelo salvo fica como esta'. */
function aplicarPadraoNosPaineisVazios() {
  const id = idModeloPadraoClaude();
  let mudou = 0;
  for (const Q of [...panes.values(), ...panesFundo.values()]) {
    if (!Q || Q.morto || Q.engine !== 'claude' || !Q.modeloDoPadrao || Q.model === id) continue;
    if (Q.started || Q.busy || Q.ligando || Q.sessaoId || Q.resumeId || Q.resumeAnterior || Q.forkPendente || (Q.hist && Q.hist.length)) continue;
    Q.model = id;
    if (Q.el) fillModels(Q);   // acerta o esforco se o novo nao tiver o de agora, e o rotulo
    mudou++;
  }
  if (mudou) savePanes();
  return mudou;
}

/* Boot: pergunta ao main se o motor de voz salvo esta' valendo. Se ele recusar
   (a checagem do Parakeet passou do prazo de 30 s, o modelo sumiu), o seletor
   mostra o que esta' valendo e a nota explica -- mas NADA e' gravado: uma falha
   passageira apagava o Parakeet do config pra sempre. Grava so' quem troca. */
/* atalho global que outro programa ja' pegou: o menu da janela NAO tem Ditar nem
   Recortar, entao o aviso aponta o caminho que existe de verdade */
const AVISO_ATALHO_OCUPADO = (falhos) => 'Atalho já usado por outro programa: ' + falhos.join(', ')
  + '. Use o microfone do painel para ditar e “+ → Recortar a tela” para recortar.';
async function conferirMotorVozNoBoot(selVoz, pintarInfoVoz) {
  let r = null;
  try { r = await window.api.audioMotor({ motor: selVoz.value }); } catch { r = null; }
  if (r && r.error) {
    selVoz.value = (r.motor === 'parakeet') ? 'parakeet' : 'whisper';
    const el = $('#motorVozInfo');
    if (el) el.textContent = r.error + ' Sua escolha continua guardada: tento de novo na próxima abertura.';
    return false;
  }
  pintarInfoVoz();
  return true;
}

document.querySelectorAll('.act').forEach(b => b.addEventListener('click', () => {
  const v = b.dataset.view;
  if (b.classList.contains('active')) return toggleSidebar();   // clicar no icone ja aberto fecha
  $('#sidebar').classList.remove('hidden'); $('#dragbar').classList.remove('hidden');
  document.querySelectorAll('.act').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.side-view').forEach(x => x.classList.toggle('hidden', x.dataset.view !== v));
  $('#sidebar').classList.remove('hidden'); $('#dragbar').classList.remove('hidden');
  if (v === 'pendencias') pintarPendencias();
  if (v === 'torre') pintarTorre(false);   // abrir usa o cache curto do main; so' o botao fura
  if (v === 'rotinas') pintarRotinas(true);
  barraDaEsquerdaApareceu();   // abriu na view de arquivos: a arvore adiada carrega aqui
  for (const eng of MOTORES) {
    if (v !== 'h' + eng) continue;
    loadHist(eng); carregarUsoSidebar(eng); pintarAbasGrupo(eng); pintarCartaoConta(eng);
  }
}));
const btTorre = document.getElementById('btnTorreAtualizar');
if (btTorre) { btTorre.innerHTML = ico('refresh-cw'); btTorre.addEventListener('click', () => pintarTorre(true)); }
const btRotinas = document.getElementById('btnRotinasAtualizar');
if (btRotinas) { btRotinas.innerHTML = ico('refresh-cw'); btRotinas.addEventListener('click', () => pintarRotinas(true, true)); }
function toggleSidebar() { if (window.CockpitUI) { window.CockpitUI.toggleNavigator(); return; } $('#sidebar').classList.toggle('hidden'); $('#dragbar').classList.toggle('hidden'); barraDaEsquerdaApareceu(); }

(() => {
  let drag = false;
  $('#dragbar').addEventListener('mousedown', () => { drag = true; document.body.style.cursor = 'col-resize'; });
  window.addEventListener('mousemove', (e) => { if (drag) $('#sidebar').style.width = Math.min(480, Math.max(160, e.clientX - 48)) + 'px'; });
  window.addEventListener('mouseup', () => { drag = false; document.body.style.cursor = ''; });
})();

document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey)) return;
  // dialogo ou caixa do app aberta: Ctrl+1..9 / Ctrl+F nao mexem no que esta por tras
  if (dialogoAberto() || !$('#modalGrupo').classList.contains('hidden')) return;
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
    const arr = colunasDaTela().flat();   // ordem da TELA, nao a de criacao
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
  // Ctrl+0 vai pro ultimo painel (Ctrl+1..9 cobrem os nove primeiros)
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
  const eng = (focusPane && MOTORES.includes(focusPane.engine)) ? focusPane.engine : 'claude';
  const bt = document.querySelector('.act[data-view="h' + eng + '"]');
  if (bt && !bt.classList.contains('active')) bt.click();
  else { $('#sidebar').classList.remove('hidden'); $('#dragbar').classList.remove('hidden'); }
  const campo = document.querySelector('.side-busca[data-busca="' + eng + '"]');
  if (campo) setTimeout(() => { campo.focus(); campo.select(); }, 60);
}

/* "Parar" do menu da janela: para o painel em foco. Com o foco num painel
   parado, parar TODOS os ocupados da aba so' com a sua confirmacao (antes parava
   todos calado). */
function pararPeloMenu() {
  if (focusPane && focusPane.busy) { interromperPainel(focusPane); return 'foco'; }
  const ocupados = [...panes.values()].filter((Q) => Q.busy);
  if (!ocupados.length) return '';
  const quantos = ocupados.length === 1 ? 'o painel desta aba que está trabalhando' : 'os ' + ocupados.length + ' painéis desta aba que estão trabalhando';
  if (!confirm('O painel em foco não está trabalhando. Parar ' + quantos + '?')) return 'desistiu';
  for (const Q of ocupados) interromperPainel(Q);
  return 'todos';
}

/* Nomeada de proposito: e' o que a tecla do menu da janela dispara, e a unica
   forma de um teste exercitar a fiacao inteira (as duas guardas inclusive) sem
   depender de mandar tecla pro sistema operacional. */
function acaoDeMenu(a) {
  if (window.CockpitUI?.menuAction(a)) return;
  // Ctrl+K, Ctrl+L, Ctrl+P... sao teclas do shell. Dentro do terminal embutido
  // elas nao podem virar acao do app (o Ctrl+K chegava a limpar a conversa)
  const noTerminal = document.activeElement && document.activeElement.closest
    && document.activeElement.closest('.term-wrap');
  /* 'trocarMotor' entrou nesta lista na leva 39, e e' o mais grave dela: a
     tecla mata o agente no meio do turno, joga fora o id da sessao (sem ele nao
     da' mais pra retomar aquela conversa no motor antigo) e grava tudo. Se o
     Ctrl+K, que so' limpa a tela, ja' era barrado dentro do terminal, este com
     mais razao. Pelo botao continua valendo -- ali voce mirou. */
  if (noTerminal && ['clearPane', 'focarInput', 'novaConversa', 'buscarConversa', 'toggleSidebar', 'trocarMotor'].includes(a)) return;
  // quadro aberto: Ctrl+K e' "link" no Excalidraw, nao "limpar a conversa"; Ctrl+W fecharia o dono do desenho.
  // So' "parar" (interromper o agente) passa: quem ve besteira acontecendo nao pode ter que fechar o quadro antes
  /* dialogo (debate, conectores) ou caixa do app aberta: o atalho nao pode agir
     no painel de TRAS (Ctrl+W fechava o painel com a caixa aberta por cima).
     Com a caixa do app, so' "parar" passa -- e ele so' mexe no painel em foco. */
  if (dialogoAberto()) return;
  if (!$('#modalGrupo').classList.contains('hidden') && a !== 'parar') return;
  if (quadro && a !== 'parar') return;
  if (a === 'newPane') { if (cabeMaisPainel()) newPane(); }
  else if (a === 'closePane' && focusPane) closePane(focusPane.id);
  else if (a === 'pickFolder' && focusPane) $('.p-cwd', focusPane.el).click();
  else if (a === 'trocarMotor' && focusPane) alternarMotor(focusPane);
  else if (a === 'toggleSidebar') toggleSidebar();
  else if (a === 'novaConversa') novaConversa(focusPane ? focusPane.engine : (cfg.lastEngine || 'claude'));
  else if (a === 'buscarConversa') abrirBuscaDeConversa();
  else if (a === 'focarInput' && focusPane) $('.p-input', focusPane.el).focus();
  else if (a === 'ditar' && focusPane) $('.p-mic', focusPane.el).click();   // Ctrl+Shift+Space, de qualquer lugar
  else if (a === 'recortar' && focusPane) recortarTela(focusPane);            // Ctrl+Shift+R
  else if (a === 'painelProximo') irParaPainel(1);
  else if (a === 'painelAnterior') irParaPainel(-1);
  else if (a === 'parar') pararPeloMenu();
  else if (a === 'clearPane' && focusPane) {
    focusPane.chat.innerHTML = ''; focusPane.blocks.clear(); focusPane.tools.clear(); esquecerPassos(focusPane);
    note(focusPane, 'Tela limpa. A conversa continua de onde estava.');
  }
}
window.api.onMenu(acaoDeMenu);

/* Rede de seguranca do cursor. Se por qualquer motivo o foco cair no corpo da
   pagina - troca de aba, painel recriado, voltar pro app depois de um alt-tab -
   o teclado fica sem destino e parece que o app "travou". Aqui ele volta pro
   campo do painel em foco. */
function devolverOCursor() {
  const solto = !document.activeElement || document.activeElement === document.body
    || document.activeElement === document.documentElement;
  if (!solto) return;                       // voce ja esta digitando em algum lugar: nao atrapalha
  if (!$('#modalGrupo').classList.contains('hidden')) return;   // tem caixa aberta: o foco e' dela
  if (quadro) return;                                            // quadro aberto: o foco e' do desenho
  const P = focusPane || [...panes.values()][0];
  if (!P || !P.el || !P.el.isConnected) return;
  if (!$('.p-modal', P.el).classList.contains('hidden')) return;  // janelinha do painel aberta
  const campo = $('.p-input', P.el);
  if (campo) { try { campo.focus(); } catch {} }
}
window.addEventListener('focus', () => setTimeout(devolverOCursor, 60));
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(devolverOCursor, 60); });

/* ============ boot ============ */
(async function boot() {
  /* o <svg> de cada icone da barra nasce VAZIO no HTML e e' preenchido aqui.
     Com dois motores novos, escrever os dois a mao deixava o Gemini e o Grok
     como dois botoes invisiveis ocupando espaco na barra. Sai do svgMotor, o
     mesmo do resto do app: um desenho so' pra trocar quando a marca mudar. */
  for (const eng of MOTORES) {
    const el = document.getElementById('svg' + (CAIXA_MOTOR[eng] || ''));
    if (el) el.outerHTML = svgMotor(eng, el.id);
  }
  // logo dos rotulos fixos do HTML (cabecalho de cada coluna de conversas):
  // o lugar nasce vazio porque o desenho mora aqui no JS
  for (const el of $$('.marca-motor[data-motor]:empty')) el.innerHTML = svgMotor(el.dataset.motor);
  HOME = await window.api.home();
  cfg = await window.api.getConfig();
  aplicarTema(cfg.tema); // Antes de preparar ou publicar a interface: evita piscar no tema errado.
  const configPrimeiroUso = { abas: cfg.abas, panes: cfg.panes };
  prepararPrimeirosPassos();
  window.dispatchEvent(new CustomEvent('cockpit-config-ready'));
  cfg.defCwd = cfg.defCwd || HOME;
  // abas locais: na primeira vez semeia "PC inteiro" + "VPS"; quem ja tinha
  // paineis salvos (versao sem abas) migra tudo pro "PC inteiro", sem perder nada
  if (!Array.isArray(cfg.abas) || !cfg.abas.length) {
    cfg.abas = abasLocaisPadrao();
    if (Array.isArray(cfg.panes) && cfg.panes.length) { cfg.abas[0].paineis = cfg.panes; delete cfg.panes; }
  }
  if (!cfg.abaAtiva || !abaPorId(cfg.abaAtiva)) cfg.abaAtiva = cfg.abas[0].id;
  pintarAbasLocal();
  for (const eng of MOTORES) { carregarUsoSidebar(eng); pintarCartaoConta(eng); pintarAbasGrupo(eng); }
  setInterval(() => { for (const eng of MOTORES) carregarUsoSidebar(eng); }, 5 * 60 * 1000);
  $('#defCwd').textContent = cfg.defCwd;
  $('#chkRobos').checked = !!cfg.verRobos;
  // auditoria 2: nome de 3 palavras (B6) com interruptor -- ligado por padrao
  const chkTit = $('#chkTituloAuto');
  if (chkTit) {
    chkTit.checked = cfg.tituloAuto !== false;
    chkTit.addEventListener('change', async (e) => {
      cfg.tituloAuto = !!e.target.checked;
      await window.api.setConfig(cfg);
    });
  }
  const chkSug = $('#chkSugestoes');
  if (chkSug) {
    chkSug.checked = cfg.sugestoes !== false;
    chkSug.addEventListener('change', async (e) => {
      cfg.sugestoes = !!e.target.checked;
      await window.api.setConfig(cfg);
      if (!cfg.sugestoes) for (const Q of panes.values()) limparSugestoes(Q);
    });
  }
  const selVoz = $('#selMotorVoz');
  if (selVoz) {
    selVoz.value = cfg.motorVoz === 'parakeet' ? 'parakeet' : 'whisper';
    const pintarInfoVoz = async () => {
      const el = $('#motorVozInfo');
      if (!el) return;
      if (selVoz.value !== 'parakeet') { el.textContent = 'Whisper base (legenda) + small (texto final), 100% local.'; return; }
      el.textContent = 'Conferindo o modelo do Parakeet…';
      try {
        const i = await window.api.audioMotorInfo();
        if (i && i.error) el.textContent = i.error;
        else if (i && i.baixado) el.textContent = 'Parakeet v3 pronto (modelo de 640 MB já baixado). Um processo faz legenda e texto final.';
        else el.textContent = 'Modelo do Parakeet ainda não baixado. Rode uma vez no terminal: ' + ((i && i.comando) || 'ouvinte-parakeet.py --baixar') + ' e escolha o Parakeet de novo.';
      } catch { el.textContent = 'Não consegui conferir o Parakeet.'; }
    };
    // o main pode recusar o motor salvo (modelo sumiu, checagem lenta): o seletor
    // acompanha o que esta' valendo, mas a SUA escolha nao e' regravada
    conferirMotorVozNoBoot(selVoz, pintarInfoVoz).catch(() => pintarInfoVoz());
    selVoz.addEventListener('change', async () => {
      let r = null;
      try { r = await window.api.audioMotor({ motor: selVoz.value }); } catch (e) { r = { error: String(e && e.message || e) }; }
      if (r && r.error) {
        // o main recusou (ex: modelo do Parakeet nao baixado): o seletor volta e a nota explica
        selVoz.value = (r.motor === 'parakeet') ? 'parakeet' : 'whisper';
        const el = $('#motorVozInfo'); if (el) el.textContent = r.error;
        cfg.motorVoz = selVoz.value; await window.api.setConfig(cfg);
        return;
      }
      cfg.motorVoz = selVoz.value;
      await window.api.setConfig(cfg);
      pintarInfoVoz();
    });
  }
  const chkAtalhos = $('#chkAtalhosGlobais');
  if (chkAtalhos) {
    chkAtalhos.checked = !!cfg.atalhosGlobais;
    chkAtalhos.addEventListener('change', async (e) => {
      cfg.atalhosGlobais = !!e.target.checked;
      await window.api.setConfig(cfg);
      try {
        const r = await window.api.atalhosLigar({ ligado: cfg.atalhosGlobais });
        const av = $('#atalhosAviso');
        if (av) { av.textContent = (r && r.falhos && r.falhos.length) ? AVISO_ATALHO_OCUPADO(r.falhos) : ''; av.classList.toggle('hidden', !av.textContent); }
      } catch {}
    });
  }
  const chkVoz = $('#chkVozManda');
  if (chkVoz) {
    chkVoz.checked = !!cfg.vozManda;
    chkVoz.addEventListener('change', async (e) => { cfg.vozManda = !!e.target.checked; await window.api.setConfig(cfg); });
  }
  // caixa de entrada (celular/bots) e atalhos globais que nao pegaram
  try {
    const pasta = await window.api.inboxPasta();
    const el = $('#inboxPasta'); if (el) el.textContent = pasta || '—';
    const bt = $('#btnInboxAbrir'); if (bt) bt.addEventListener('click', () => window.api.openPath(pasta));
    const est = await window.api.atalhosEstado();
    const av = $('#atalhosAviso');
    if (av && est && est.falhos && est.falhos.length) { av.textContent = AVISO_ATALHO_OCUPADO(est.falhos); av.classList.remove('hidden'); }
  } catch {}
  window.api.onInbox((m) => chegouNaInbox(m));
  if (window.api.inboxOuvindo) window.api.inboxOuvindo().catch(() => {});   // so' agora o main pode anunciar
  /* o Parakeet nao subiu (modelo nao baixado etc.): o main ja voltou pro Whisper
     NESTA sessao; a tela acompanha. A escolha salva fica (gravar e' so' quando
     voce troca): na proxima abertura o boot confere de novo e explica. */
  if (window.api.onVozMotorCaiu) window.api.onVozMotorCaiu((m) => {
    const sel = $('#selMotorVoz'); if (sel) sel.value = 'whisper';
    const info = $('#motorVozInfo'); if (info) info.textContent = 'O Parakeet não subiu; o ditado está no Whisper até você escolher de novo ou reabrir o Cockpit.';
    mostrarAviso({ id: 'voz-caiu', tipo: 'alerta', texto: 'O Parakeet não subiu (' + String((m && m.motivo) || 'sem motivo').slice(0, 140) + '). Voltei o ditado pro Whisper.' });
  });
  // motor desatualizado? checa com calma, depois que a tela ja assentou
  setTimeout(checarVersoesDosMotores, 12000);
  if (EH_WIN) $$('[title]').forEach(el => { if (el.title.includes('⌘')) el.title = el.title.replace(/⌘/g, 'Ctrl+'); });
  ligarSeletorModeloClaude();
  // "ate 12 paineis" era de antes: o teto saiu (so' avisa a partir de 16)
  Promise.resolve(window.api.versao ? window.api.versao() : '').catch(() => '')
    .then((v) => { $('#verLine').textContent = ('Cockpit ' + (v || '')).trim(); });
  repintarAvatares();
  encolherFotoAntiga().catch(() => {});
  verMotoresDisponiveis().then(disponibilidade => {
    if (precisaPrimeirosPassos(configPrimeiroUso, disponibilidade) && !panes.size && !document.querySelector('dialog[open]')) abrirPrimeirosPassos();
  });
  window.api.codexModels().then(ms => { if (ms && ms.length) { MODELOS_CODEX = ms; for (const P of panes.values()) if (P.engine === 'codex') fillModels(P); } });
  // tela de abertura: escolher com quem vai trabalhar
  for (const eng of MOTORES) { const el = caixaDoMotor('bv', eng); if (el) el.innerHTML = svgMotor(eng); }
  $('#bvDoisA').innerHTML = svgMotor('claude');
  $('#bvDoisB').innerHTML = svgMotor('codex');
  // barra de icones aparece, a lateral comeca fechada, e a area de paineis fica fora do caminho
  $('#sidebar').classList.add('hidden'); $('#dragbar').classList.add('hidden');
  $('#panes').style.display = 'none';
  // tinha conversa aberta da ultima vez? volta tudo como estava, sem passar pela abertura
  const salvos = ((abaAtual() && abaAtual().paineis) || []).filter(fichaVale);
  if (salvos.length) {
    if (!MODELOS_CODEX && salvos.some(p => p.engine === 'codex')) {
      try { const ms = await window.api.codexModels(); if (ms && ms.length) MODELOS_CODEX = ms; } catch {}
    }
    /* mesma trava da troca de aba: restaurar uma aba SSH leva dezenas de
       segundos (uma conexao por conversa) e o clique impaciente numa outra aba
       atropelava a restauracao. Agora o clique fica guardado pro fim. */
    trocandoAba = true; abaIndoPara = cfg.abaAtiva;
    const gen = ++abaGen;
    try { await restaurarPaineis(salvos, cfg.abaAtiva, gen); }
    finally {
      trocandoAba = false; abaIndoPara = null;
      const proxima = abaPendente; abaPendente = null;
      if (proxima && proxima !== cfg.abaAtiva) trocarAbaLocal(proxima);
    }
    return;
  }
  const comecar = async (quais) => {
    /* motor que nao esta na maquina nao pode abrir painel: antes ele abria e
       so quebrava depois que voce mandasse a primeira mensagem. */
    const fora = remotoDoAba(abaAtual()) ? [] : quais.filter((m) => motorDisponivel[m] === false);
    if (fora.length) {
      const av = $('#bvAviso');
      if (av) {
        av.textContent = 'O ' + fora.map(nomeDoMotor).join(' e o ') + ' não está instalado nesta máquina. '
          + (COMO_INSTALAR[fora[0]] || '');
        av.classList.remove('hidden');
      }
      return;
    }
    // aba de servidor: so' o Claude roda la' (o Codex rodaria no PC com a tela dizendo VPS)
    const destinoRemoto = remotoDoAba(abaAtual());
    const permitidos = destinoRemoto ? await Promise.all(quais.map(m => capacidadeRemota(m, destinoRemoto))) : quais.map(() => true);
    const soLocal = quais.filter((m, i) => !permitidos[i]);
    if (soLocal.length) {
      const av = $('#bvAviso');
      if (av) {
        av.textContent = 'O ' + soLocal.map(nomeDoMotor).join(' e o ') + ' está indisponível neste servidor. Confira a instalação e a conexão.';
        av.classList.remove('hidden');
      }
      return;
    }
    sairDaAbertura();
    // lote tambem aqui: dois motores de uma vez sao dois paineis, e numa aba
    // remota isso eram duas conexoes SSH pra mesma pasta
    comMontagemAdiada(() => {
      /* a pasta e' a da ABA (mesma correcao do trocarMotor): numa aba de
         servidor, cfg.defCwd e' um caminho do Windows, e o painel nascia com
         P.cwd = C:\Users\... -- a arvore e o "@" mandavam cd 'C:\Users\...'
         pro Ubuntu e o servidor respondia "nao consegui abrir a pasta". */
      /* de tras pra frente: cada painel novo nasce na ponta esquerda, entao
         criar na ordem direta deixaria os motores invertidos na tela. */
      for (const m of [...quais].reverse()) newPane({ engine: m, cwd: cwdPadraoDaAba(abaAtual()), abaId: cfg.abaAtiva });
      setFocus([...panes.values()][0]);
    });
    setTimeout(() => { const P = [...panes.values()][0]; if (P) $('.p-input', P.el).focus(); }, 120);
  };
  $$('.bv-bt[data-motor]').forEach(b => b.addEventListener('click', () => comecar([b.dataset.motor])));
  $('.bv-dois').addEventListener('click', () => comecar(['claude', 'codex']));
  document.addEventListener('keydown', function abertura(e) {
    if (!$('#boasvindas')) { document.removeEventListener('keydown', abertura); return; }
    // 1 a 5: a ordem e a mesma da lista de motores
    const escolhido = /^[1-9]$/.test(e.key) ? MOTORES[Number(e.key) - 1] : null;
    if (escolhido) comecar([escolhido]);
    if (e.key === 'Enter') comecar(['claude', 'codex']);
  });
})();
