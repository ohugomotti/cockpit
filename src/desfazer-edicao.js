'use strict';
/* Tarefa 9 (27/09/2026): "Desfazer esta mudança" direto no passo.

   Nucleo PURO: nada de disco nem de Electron. Recebe o conteudo atual do
   arquivo e a mudanca que o PROPRIO main emitiu (nunca o que a tela mandar) e
   diz o que o arquivo vira, ou por que nao da'. Quem le e grava e' o main.js
   (canal arquivo:desfazer); quem desenha o botao e' o app.js.

   Porte do Cockpit do Homero (main.js 1518: troca a ocorrencia UNICA do texto
   novo pelo antigo; recusa texto cortado, texto que sumiu e texto repetido),
   com o que ele nao fazia:
   - recusa "trocar todas" (replace_all), texto novo vazio (nao da' pra achar
     onde ele estava) e MultiEdit que chegou incompleto (mais de 20 trocas);
   - adapta LF/CRLF ao arquivo: o Claude manda old/new em LF e grava o
     arquivo de volta nas quebras dele. Arquivo com quebras MISTURADAS so'
     aceita o texto literal e nunca parte um \r\n ao meio;
   - MultiEdit desfaz da ultima troca para a primeira (cada uma mexeu no
     resultado da anterior), e e' tudo ou nada: qualquer parte que nao bata
     cancela o plano inteiro, sem conteudo novo;
   - Write so' volta se o arquivo ainda for o que a IA gravou (a ferramenta
     pode ter trocado LF por CRLF e posto/tirado o BOM: isso nao conta). O
     antes volta como o main leu, byte a byte; arquivo que a IA criou vai pra
     Lixeira (o main decide pelo "lixeira"), nunca vira arquivo vazio. */

const MARCA_CORTE = '\n…(cortado)';   // a mesma do corta() do main.js e do acp.js
const LIMITE_BYTES = 5 * 1024 * 1024;
const TIPOS = new Set(['edit', 'multi', 'write', 'write-novo']);

/* Os recados que a tela mostra (note de erro). Frases curtas, sem travessao.
   Os do nucleo e os do main moram juntos: um lugar so' pra revisar o texto. */
const MOTIVOS = {
  // nucleo
  tipo: 'Este tipo de mudança não dá para desfazer daqui.',
  todas: 'Esta edição trocou todas as vezes que o texto aparecia. Não dá para desfazer com segurança.',
  incompleta: 'Esta edição tem partes demais para desfazer daqui.',
  cortada: 'Esta mudança é grande demais e não ficou guardada inteira. Não dá para desfazer daqui.',
  vazia: 'Esta mudança não deixou texto no lugar. Não dá para achar onde desfazer.',
  inexato: 'Não guardei uma cópia fiel do arquivo de antes. Não dá para desfazer daqui.',
  mudou: 'O arquivo mudou depois desta mudança. Desfazer agora estragaria o que veio depois.',
  repetido: 'O trecho novo aparece mais de uma vez no arquivo. Não dá para saber qual desfazer.',
  quebra: 'O trecho novo corta uma quebra de linha do arquivo ao meio. Não dá para desfazer com segurança.',
  nada: 'Esta mudança não alterou nada no arquivo.',
  varios: 'Este passo mexeu em mais de um arquivo. Não dá para desfazer só uma parte daqui.',
  // main (arquivo:desfazer)
  sumiu: 'Não achei esta mudança para desfazer. O painel pode ter sido reiniciado.',
  remoto: 'Este painel roda no servidor. Desfaça a mudança por lá.',
  trabalhando: 'Espere o agente terminar para desfazer.',
  desfeita: 'Esta mudança já foi desfeita.',
  andando: 'Esta mudança já está sendo desfeita.',
  passoErro: 'Este passo deu erro ou foi negado. Não mudou nada para desfazer.',
  passoAberto: 'Este passo não terminou. Não dá para saber se a mudança foi aplicada.',
  idRepetido: 'Este passo apareceu mais de uma vez na conversa. Não dá para saber qual mudança desfazer.',
  linkFisico: 'Este arquivo tem outro nome apontando pra ele (link físico). Desfaça pelo seu editor.',
  grande: 'O arquivo era grande demais para guardar como estava. Não dá para desfazer daqui.',
  incerto: 'Não deu para conferir o arquivo antes desta mudança. Não dá para desfazer daqui.',
  rede: 'O arquivo está numa pasta de rede. Não dá para desfazer daqui.',
  caminho: 'O caminho do arquivo não está completo. Não dá para desfazer daqui.',
  naoExiste: 'O arquivo não existe mais.',
  naoArquivo: 'Este caminho não é de um arquivo.',
  grandeDemais: 'O arquivo passou de 5 MB. Não dá para desfazer daqui.',
  naoUtf8: 'O arquivo não está em UTF-8. Desfazer daqui poderia estragar o resto dele.',
  aberto: 'O arquivo está aberto em outro programa. Feche e tente de novo.',
  lixeira: 'Não consegui mandar o arquivo para a Lixeira. Se ele estiver aberto em outro programa, feche e tente de novo.',
  falhou: 'Não consegui desfazer esta mudança.',
};

const falha = (codigo) => ({ ok: false, codigo, motivo: MOTIVOS[codigo] || MOTIVOS.falhou });
const texto = (v) => (v == null ? '' : String(v));

/* Caminho completo DESTE PC. No Windows: letra de unidade + barra ("C:\...").
   Fora: relativo ("pasta\a.txt"), relativo a' unidade ("C:a.txt"), da raiz da
   unidade atual ("\a.txt"), de rede ("\\servidor\...", "//servidor/...") e de
   dispositivo ("\\?\", "\\.\"). */
function caminhoLocal(p, ehWin) {
  const c = typeof p === 'string' ? p : '';
  if (!c || c.includes('\0')) return false;
  if (/^[\\/]{2}/.test(c)) return false;
  return ehWin ? /^[A-Za-z]:[\\/]/.test(c) : c.startsWith('/');
}

/* A "mudanca" que o main emitiu (formato do mudancaDaFerramenta e do acp.js:
   edit/write com antes/depois soltos, multi com partes) no formato do plano:
   { tipo, partes:[{antes, depois}], todas, total?, antesInexato?, varios? }.
   "varios" (revisao 1): passo do ACP com mais de um diff; a tela so' mostra um. */
function daMudancaEmitida(m) {
  const o = m && typeof m === 'object' ? m : {};
  const partes = o.tipo === 'multi'
    ? (Array.isArray(o.partes) ? o.partes : []).map((p) => ({ antes: texto(p && p.antes), depois: texto(p && p.depois) }))
    : [{ antes: texto(o.antes), depois: texto(o.depois) }];
  const out = { tipo: texto(o.tipo), partes, todas: !!o.todas };
  if (typeof o.total === 'number') out.total = o.total;
  if (o.antesInexato) out.antesInexato = true;
  if (o.varios) out.varios = true;
  return out;
}

/* As regras que nao dependem do arquivo: o main chama ANTES de tocar no disco.
   Devolve null (pode seguir) ou a recusa. */
function validarMudanca(mudanca) {
  const m = mudanca && typeof mudanca === 'object' ? mudanca : null;
  if (!m || !TIPOS.has(m.tipo)) return falha('tipo');
  const partes = Array.isArray(m.partes) ? m.partes : [];
  if (!partes.length || (m.tipo !== 'multi' && partes.length !== 1)) return falha('tipo');
  for (const p of partes) {
    if (!p || typeof p !== 'object' || typeof p.depois !== 'string' || (p.antes != null && typeof p.antes !== 'string')) return falha('tipo');
  }
  if (m.todas) return falha('todas');
  if (m.varios) return falha('varios');
  if (m.tipo === 'multi' && m.total != null && m.total !== partes.length) return falha('incompleta');
  for (const p of partes) {
    if (texto(p.antes).endsWith(MARCA_CORTE) || p.depois.endsWith(MARCA_CORTE)) return falha('cortada');
  }
  if (partes.some((p) => !p.depois)) return falha('vazia');
  if (m.tipo === 'write' && m.antesInexato) return falha('inexato');
  return null;
}

/* Quebras do arquivo: 'crlf' (so' \r\n), 'lf' (nenhum \r\n; vale pro arquivo
   de uma linha so') ou 'misto'. */
function estiloDasQuebras(t) {
  const crlf = t.includes('\r\n');
  if (!crlf) return 'lf';
  return /(^|[^\r])\n/.test(t) ? 'misto' : 'crlf';
}
function adaptar(t, estilo) {
  if (estilo === 'crlf') return t.replace(/\r?\n/g, '\r\n');
  if (estilo === 'lf') return t.replace(/\r\n/g, '\n');
  return t;   // misto: so' o texto literal, do jeito que o agente mandou
}
const soLF = (t) => t.replace(/\r\n/g, '\n');
const semBOM = (t) => (t.charCodeAt(0) === 0xFEFF ? t.slice(1) : t);

/* onde o trecho aparece UMA vez so', sem partir um \r\n ao meio */
function acharUmaVez(conteudo, trecho) {
  const i = conteudo.indexOf(trecho);
  if (i < 0) return { codigo: 'mudou' };
  if (conteudo.indexOf(trecho, i + 1) >= 0) return { codigo: 'repetido' };   // tambem pega a ocorrencia sobreposta
  const fim = i + trecho.length;
  if ((trecho[0] === '\n' && conteudo[i - 1] === '\r') || (trecho[trecho.length - 1] === '\r' && conteudo[fim] === '\n')) return { codigo: 'quebra' };
  return { onde: i };
}

/* planejarDesfazer(conteudoAtual, mudanca)
     -> { ok: true, novoConteudo }                     (edit, multi, write)
      | { ok: true, novoConteudo: '', lixeira: true }  (write-novo: o main manda pra Lixeira)
      | { ok: false, codigo, motivo }
   mudanca = { tipo:'edit'|'multi'|'write'|'write-novo', partes:[{ antes, depois }], todas,
               total? (MultiEdit: quantas trocas a ferramenta tinha), antesInexato? (Write) } */
function planejarDesfazer(conteudoAtual, mudanca) {
  const recusa = validarMudanca(mudanca);
  if (recusa) return recusa;
  if (typeof conteudoAtual !== 'string') return falha('mudou');
  const atual = conteudoAtual;
  const partes = mudanca.partes;

  if (mudanca.tipo === 'write' || mudanca.tipo === 'write-novo') {
    const p = partes[0];
    if (semBOM(soLF(atual)) !== semBOM(soLF(p.depois))) return falha('mudou');
    if (mudanca.tipo === 'write-novo') return { ok: true, novoConteudo: '', lixeira: true };
    const antes = texto(p.antes);
    if (antes === atual) return falha('nada');
    return { ok: true, novoConteudo: antes };
  }

  const estilo = estiloDasQuebras(atual);
  let conteudo = atual;
  // de tras pra frente: a ultima troca e' a primeira a sair, senao o texto nao bate
  for (let k = partes.length - 1; k >= 0; k--) {
    const depois = adaptar(partes[k].depois, estilo);
    const antes = adaptar(texto(partes[k].antes), estilo);
    const achou = acharUmaVez(conteudo, depois);
    if (achou.codigo) return falha(achou.codigo);   // tudo ou nada: nenhuma parte sai daqui
    conteudo = conteudo.slice(0, achou.onde) + antes + conteudo.slice(achou.onde + depois.length);
  }
  if (conteudo === atual) return falha('nada');
  return { ok: true, novoConteudo: conteudo };
}

module.exports = { MARCA_CORTE, LIMITE_BYTES, MOTIVOS, caminhoLocal, daMudancaEmitida, validarMudanca, planejarDesfazer };
