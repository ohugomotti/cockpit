'use strict';
/* Vigia do arquivo aberto no leitor (Leva 2, Task 5, UI 7.2-6).

   O leitor pede UMA vigia por painel (a "chave"): quando o arquivo LOCAL muda no disco, o main avisa a tela e ela se
   recarrega mantendo a rolagem. Sem Electron: o fs, o aviso, o log e o relogio entram por parametro, entao tudo aqui
   roda em teste (test/leitor-navegacao.test.js). Regras:
   - Caminho de rede (\\servidor, //servidor) nunca chega ao fs: a trava da leva 1 (ehCaminhoDeRede) e' a PRIMEIRA
     coisa que vigiar() faz, e sem ela o modulo nem nasce.
   - Uma vigia por chave. Pedir outra vigia pra mesma chave (o leitor trocou de documento) fecha a anterior ANTES de
     olhar o pedido novo: mesmo recusado, o documento antigo ja' saiu da tela.
   - fs.watch na PASTA, filtrando pelo nome: quem salva gravando um temporario e renomeando por cima mata o watch de
     um arquivo no macOS e no Linux; o da pasta sobrevive. Sem 'persistent': a vigia nunca segura o processo.
   - Debounce de 300 ms: salvar costuma gerar 2 ou 3 eventos, e eles viram um aviso so'.
   - Evento nao e' mudanca. So' avisa se a data ou o tamanho mudaram de verdade desde o ultimo aviso (ou desde que a
     vigia comecou). No Windows ler o arquivo tambem dispara 'change' (ultimo acesso); sem esta conferencia cada
     recarga se vigiaria a si mesma pra sempre.
   - O stat e' assincrono (fs.promises.stat): numa unidade de rede mapeada (Z:) fora do ar o statSync segurava o main por
     ~20 s. O vigiar() devolve na hora, as conferencias correm uma de cada vez e um aviso que chega depois de parar (ou de
     trocar de documento) nao vale.
   - Parada garantida: parar() fecha o watcher e cancela o temporizador; pararTodos() e' o que o main chama quando a
     tela recarrega, cai ou fecha. */
const path = require('node:path');

const ATRASO_MS = 300;
const TETO_CHAVE = 200;
const LIMITE_VIGIAS = 32;   // uma por painel e so' ha um visor aberto por vez: passar disso e' bug da tela, e nao pode virar vazamento
const CONTROLES = /[\u0000-\u001f\u007f]/;      // o mesmo que a tela tira antes de decidir se e' rede (file-links.js)
const SUMIU = new Set(['ENOENT', 'ENOTDIR']);   // o arquivo ou a pasta nao esta mais la: esperado, nao e' erro
// o nome que o watch entrega pode vir decomposto (macOS) ou com outra caixa (Windows): compara o que e' o mesmo nome
const nomeIgual = (a, b) => String(a).normalize('NFC').toLowerCase() === String(b).normalize('NFC').toLowerCase();
const igual = (a, b) => !!a && !!b && a.mtimeMs === b.mtimeMs && a.size === b.size;

function criarVigia({ fs, ehCaminhoDeRede, avisar, log = () => {}, atrasoMs = ATRASO_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (!fs || typeof fs.watch !== 'function' || !fs.promises || typeof fs.promises.stat !== 'function') throw new TypeError('fs com watch e promises.stat obrigatorio');
  if (typeof ehCaminhoDeRede !== 'function') throw new TypeError('a trava de caminho de rede e obrigatoria');
  if (typeof avisar !== 'function') throw new TypeError('avisar obrigatorio');
  const vigias = new Map();   // chave -> { chave, arquivo, nome, watcher, timer, ultimo, fila }
  const registrar = (contexto, erro) => { try { log(contexto, erro); } catch {} };

  // { mtimeMs, size } do arquivo, ou null se ele nao esta mais la; qualquer outra falha sobe.
  // Assincrono de proposito: numa unidade de rede mapeada (Z:) fora do ar o statSync segurava o main por ~20 s.
  async function estadoDoArquivo(arquivo) {
    try { const st = await fs.promises.stat(arquivo); return { mtimeMs: st.mtimeMs, size: st.size }; }
    catch (e) { if (SUMIU.has(e && e.code)) return null; throw e; }
  }
  function enviar(vigia, evento) {
    try { avisar({ chave: vigia.chave, arquivo: vigia.arquivo, evento }); }
    catch (e) { registrar('vigia:avisar', e); }
  }
  /* Uma conferencia de cada vez, em ordem (vigia.fila; a primeira e' a do estado de ANTES da leitura): com o disco lento,
     duas ao mesmo tempo se atropelariam e o "ultimo" ficaria velho. `fim` e' a ultima conferencia de uma vigia que o
     watch derrubou: ela ja' saiu da lista, mas o aviso de "apagado" ainda vale. */
  function verificar(vigia, fim = false) {
    const vale = () => fim || vigias.get(vigia.chave) === vigia;   // senao parou ou trocou enquanto esperava
    vigia.fila = vigia.fila.then(async () => {
      if (!vale()) return;
      let agora;
      try { agora = await estadoDoArquivo(vigia.arquivo); }
      catch (e) { registrar('vigia:verificar', e); return; }   // falha passageira (arquivo trancado): espera o proximo evento
      if (!vale()) return;   // parou ou trocou enquanto o stat rodava: o aviso nao vale mais
      if (!agora) {
        if (vigia.ultimo) { vigia.ultimo = null; enviar(vigia, 'apagado'); }
        return;
      }
      if (igual(vigia.ultimo, agora)) return;   // evento sem mudanca de verdade
      vigia.ultimo = agora;
      enviar(vigia, 'mudou');
    }).catch((e) => registrar('vigia:verificar', e));   // a fila nunca fica rejeitada
  }
  function agendar(vigia) {
    if (vigias.get(vigia.chave) !== vigia) return;   // evento que ja estava a caminho quando a vigia saiu
    clearTimer(vigia.timer);
    vigia.timer = setTimer(() => { vigia.timer = null; verificar(vigia); }, atrasoMs);
    if (vigia.timer && typeof vigia.timer.unref === 'function') vigia.timer.unref();
  }

  function parar(chave) {
    const vigia = typeof chave === 'string' ? vigias.get(chave) : undefined;
    if (!vigia) return false;
    vigias.delete(chave);
    clearTimer(vigia.timer); vigia.timer = null;
    try { vigia.watcher.close(); } catch (e) { registrar('vigia:fechar', e); }
    return true;
  }
  function pararTodos() { for (const chave of [...vigias.keys()]) parar(chave); }

  function vigiar(chave, arquivo) {
    if (typeof chave === 'string' && chave) parar(chave);   // trocou de documento: a vigia velha sai antes de qualquer recusa
    if (typeof chave !== 'string' || !chave || chave.length > TETO_CHAVE || typeof arquivo !== 'string' || !arquivo) return { ok: false, motivo: 'pedido' };
    if (ehCaminhoDeRede(arquivo)) return { ok: false, motivo: 'rede' };   // ANTES de qualquer fs.* ou path.*
    if (CONTROLES.test(arquivo) || !path.isAbsolute(arquivo)) return { ok: false, motivo: 'caminho' };
    if (vigias.size >= LIMITE_VIGIAS) return { ok: false, motivo: 'limite' };
    const nome = path.basename(arquivo);
    const vigia = { chave, arquivo, nome, watcher: null, timer: null, ultimo: null, fila: null };
    // o estado de ANTES da leitura: o que mudar depois dele gera aviso (a tela pede a vigia antes de ler o arquivo).
    // Ele corre no disco enquanto o vigiar() ja' devolve; as conferencias do debounce esperam por ele (vigia.fila)
    vigia.fila = estadoDoArquivo(arquivo).then((estado) => { vigia.ultimo = estado; }, (e) => { registrar('vigia:abrir', e); });
    try {
      vigia.watcher = fs.watch(path.dirname(arquivo), { persistent: false }, (_tipo, quem) => {
        if (quem == null || nomeIgual(path.basename(String(quem)), nome)) agendar(vigia);
      });
    } catch (e) {
      if (!SUMIU.has(e && e.code)) registrar('vigia:abrir', e);
      return { ok: false, motivo: 'erro' };
    }
    // sem ouvinte de 'error' o Node derruba o main (pasta apagada com o leitor aberto gera EPERM no Windows)
    vigia.watcher.on('error', (e) => {
      if (!SUMIU.has(e && e.code)) registrar('vigia:watch', e);
      if (vigias.get(chave) !== vigia) return;
      parar(chave);              // watch com erro nao e' watch: sai da lista (e fecha)
      verificar(vigia, true);    // ultima conferencia: se o arquivo sumiu junto com a pasta, o leitor fica sabendo
    });
    vigias.set(chave, vigia);
    return { ok: true };
  }

  return { vigiar, parar, pararTodos, ativas: () => [...vigias.keys()] };
}

module.exports = { criarVigia, ATRASO_MS, LIMITE_VIGIAS };
