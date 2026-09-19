/* quadro-fluxo.js — leva 41 (B5): o desenho do quadro vira algo que a IA ENTENDE.

   Funcoes PURAS (sem DOM e sem Excalidraw), pra poder testar com cenas reais:
   - fluxoEmTexto(cena, op): caixas, losangos e setas viram um passo a passo em
     markdown que vai no campo de escrever (editavel) junto com o PNG;
   - lerBlocoExcalidraw(texto): confere um bloco ```excalidraw de uma mensagem
     antes de tentar desenhar (bloco ruim continua como codigo, sem quebrar nada).

   O index.html carrega isto antes do app.js (window.QuadroFluxo); os testes
   carregam com require. */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else raiz.QuadroFluxo = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TIPOS_CAIXA = ['rectangle', 'diamond', 'ellipse'];
  // folga (em unidades da cena) pra ligar uma seta que foi solta PERTO da caixa, sem grudar
  const FOLGA_LIGACAO = 24;

  const limpar = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  function elementosDe(cena) {
    let d = cena;
    if (typeof d === 'string') {
      const t = d.trim();
      if (!t) return [];
      d = JSON.parse(t);
    }
    if (Array.isArray(d)) return d;
    if (d && typeof d === 'object' && Array.isArray(d.elements)) return d.elements;
    return [];
  }

  /* texto de um elemento de texto: originalText e' o que a pessoa escreveu
     (text vem com as quebras que o Excalidraw poe pra caber na caixa) */
  const textoDe = (el) => limpar(typeof el.originalText === 'string' ? el.originalText : el.text);

  function caixaDe(el) {
    const w = Number(el.width) || 0, h = Number(el.height) || 0;
    const x = Number(el.x) || 0, y = Number(el.y) || 0;
    const x1 = Math.min(x, x + w), y1 = Math.min(y, y + h);
    return { x1, y1, x2: x1 + Math.abs(w), y2: y1 + Math.abs(h), cx: x1 + Math.abs(w) / 2, cy: y1 + Math.abs(h) / 2, h: Math.abs(h) };
  }

  function pontasDaSeta(el) {
    const x = Number(el.x) || 0, y = Number(el.y) || 0;
    let pts = Array.isArray(el.points) ? el.points.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) : [];
    if (pts.length < 2) pts = [[0, 0], [Number(el.width) || 0, Number(el.height) || 0]];
    const a = pts[0], b = pts[pts.length - 1];
    return [{ x: x + a[0], y: y + a[1] }, { x: x + b[0], y: y + b[1] }];
  }

  /* de cima pra baixo, e na mesma "linha" (centros perto) da esquerda pra direita */
  function porPosicao(a, b) {
    const mesmaLinha = Math.abs(a.caixa.cy - b.caixa.cy) <= Math.max(8, Math.min(a.caixa.h, b.caixa.h) / 2);
    if (!mesmaLinha) return a.caixa.cy - b.caixa.cy;
    return (a.caixa.cx - b.caixa.cx) || (a.caixa.cy - b.caixa.cy);
  }

  /* a caixa mais perto do ponto (dentro dela ou a ate' FOLGA_LIGACAO da borda);
     empate: a menor (a de dentro, quando uma caixa esta' desenhada dentro de outra) */
  function caixaPerto(no, p) {
    let melhor = null, dist = Infinity, area = Infinity;
    for (const n of no) {
      const c = n.caixa;
      const dx = Math.max(c.x1 - p.x, 0, p.x - c.x2), dy = Math.max(c.y1 - p.y, 0, p.y - c.y2);
      const d = Math.hypot(dx, dy);
      if (d > FOLGA_LIGACAO) continue;
      const a = (c.x2 - c.x1) * (c.y2 - c.y1);
      if (d < dist || (d === dist && a < area)) { melhor = n; dist = d; area = a; }
    }
    return melhor;
  }

  const idDaPonta = (binding, ponta) => {
    if (binding && typeof binding === 'object' && typeof binding.elementId === 'string') return binding.elementId;
    if (ponta && typeof ponta === 'object' && typeof ponta.id === 'string') return ponta.id;   // esqueleto: start/end {id}
    return null;
  };

  function montarGrafo(cena) {
    // elemento sem id (esqueleto) ganha um so' aqui dentro: copia, sem mexer no que veio
    const todos = elementosDe(cena).filter((el) => el && typeof el === 'object' && !el.isDeleted)
      .map((el, i) => ((typeof el.id === 'string' && el.id) ? el : Object.assign({}, el, { id: '_sem_id_' + i })));
    const porId = new Map(todos.map((el) => [el.id, el]));

    // texto preso num conteiner (caixa ou seta) vs texto solto
    const textoDoConteiner = new Map();
    const soltos = [];
    for (const el of todos) {
      if (el.type !== 'text') continue;
      const dono = typeof el.containerId === 'string' ? porId.get(el.containerId) : null;
      if (dono) textoDoConteiner.set(dono.id, [textoDoConteiner.get(dono.id), textoDe(el)].filter(Boolean).join(' '));
      else soltos.push(el);
    }
    const rotuloDe = (el) => limpar(textoDoConteiner.get(el.id) || (el.label && el.label.text) || '');

    const setas = todos.filter((el) => el.type === 'arrow');
    // texto solto em que uma seta foi grudada vira passo tambem
    const alvosDeSeta = new Set();
    for (const s of setas) for (const id of [idDaPonta(s.startBinding, s.start), idDaPonta(s.endBinding, s.end)]) if (id) alvosDeSeta.add(id);

    const nos = [];
    for (const el of todos) {
      const eCaixa = TIPOS_CAIXA.includes(el.type);
      const eTextoLigado = el.type === 'text' && soltos.includes(el) && alvosDeSeta.has(el.id);
      if (!eCaixa && !eTextoLigado) continue;
      nos.push({ id: el.id, tipo: el.type, texto: eTextoLigado ? textoDe(el) : rotuloDe(el), caixa: caixaDe(el) });
    }
    const noPorId = new Map(nos.map((n) => [n.id, n]));
    const notas = soltos.filter((el) => !noPorId.has(el.id)).map((el) => ({ texto: textoDe(el), caixa: caixaDe(el) })).filter((n) => n.texto);

    const ligacoes = [], setasSoltas = [];
    for (const s of setas) {
      const [pIni, pFim] = pontasDaSeta(s);
      const idIni = idDaPonta(s.startBinding, s.start), idFim = idDaPonta(s.endBinding, s.end);
      let de = idIni ? noPorId.get(idIni) : null;
      let para = idFim ? noPorId.get(idFim) : null;
      // seta que nao grudou: vale a ponta solta perto de uma caixa
      if (!de && !idIni) de = caixaPerto(nos, pIni);
      if (!para && !idFim) para = caixaPerto(nos, pFim);
      // as duas pontas "perto" da MESMA caixa sem grudar: e' rabisco dentro da caixa, nao volta
      if (de && para && de === para && !(idIni && idFim)) { if (!idFim) para = null; else de = null; }
      const rotulo = rotuloDe(s);
      if (de && para) ligacoes.push({ de, para, rotulo, y: Math.min(pIni.y, pFim.y), x: Math.min(pIni.x, pFim.x) });
      else setasSoltas.push({ de, para, rotulo, y: Math.min(pIni.y, pFim.y), x: Math.min(pIni.x, pFim.x) });
    }

    const outros = { freedraw: 0, image: 0, line: 0 };
    for (const el of todos) if (el.type in outros) outros[el.type]++;
    return { nos, ligacoes, setasSoltas, notas, outros };
  }

  /* ordem dos passos: topologica (quem recebe seta vem depois de quem manda),
     comecando pelas caixas sem entrada e seguindo o ramo que acabou de andar;
     empate pela posicao. Num ciclo, entra quem ja' recebe seta de um numerado. */
  function ordenar(nos, ligacoes) {
    const ordem = [], posDe = new Map();
    const restantes = new Set(nos);
    const entradasDe = (n) => ligacoes.filter((l) => l.para === n && l.de !== n);
    const nota = (n) => {   // quanto maior, mais "continuacao" do que acabou de ser numerado
      let m = -1;
      for (const l of entradasDe(n)) if (posDe.has(l.de)) m = Math.max(m, posDe.get(l.de));
      return m;
    };
    const melhor = (lista) => lista.sort((a, b) => (nota(b) - nota(a)) || porPosicao(a, b))[0];
    while (restantes.size) {
      const vivos = [...restantes];
      let prontos = vivos.filter((n) => entradasDe(n).every((l) => posDe.has(l.de)));
      if (!prontos.length) {
        const comEntrada = vivos.filter((n) => nota(n) >= 0);
        prontos = comEntrada.length ? comEntrada : vivos;
      }
      const n = melhor(prontos);
      posDe.set(n, ordem.length);
      ordem.push(n);
      restantes.delete(n);
    }
    return ordem;
  }

  const ENTRADA_DE_CONDICAO = /^(se|caso|quando|senão|senao|if|else)\b/i;

  /**
   * Cena do Excalidraw (string JSON, {elements} ou lista; completa ou esqueleto) → markdown.
   * op.comImagem: diz no cabecalho que a imagem vai junto.
   * Devolve '' quando nao tem caixa, seta nem texto pra descrever.
   */
  function fluxoEmTexto(cena, op) {
    op = op || {};
    let g;
    try { g = montarGrafo(cena); } catch { return ''; }
    const { nos, ligacoes, setasSoltas, notas, outros } = g;
    if (!nos.length && !notas.length && !setasSoltas.length) return '';

    const ordem = ordenar(nos, ligacoes);
    const num = new Map(ordem.map((n, i) => [n, i + 1]));
    const nomeDe = (n) => n.texto || (n.tipo === 'diamond' ? '(losango sem texto)' : n.tipo === 'ellipse' ? '(elipse sem texto)' : '(caixa sem texto)');
    const ref = (n) => num.get(n) + '. ' + nomeDe(n);
    const volta = (l) => (num.get(l.para) <= num.get(l.de) ? ' (volta: ciclo)' : '');

    const linhas = [];
    linhas.push(op.comImagem ? 'Fluxo desenhado no quadro (a imagem vai anexada):' : 'Fluxo desenhado no quadro:');
    if (ordem.length) {
      linhas.push('');
      for (const n of ordem) {
        const decisao = n.tipo === 'diamond';
        const saidas = ligacoes.filter((l) => l.de === n).sort((a, b) => (num.get(a.para) - num.get(b.para)) || (a.y - b.y) || (a.x - b.x));
        const temEntrada = ligacoes.some((l) => l.para === n && l.de !== n);
        const cab = num.get(n) + '. ' + nomeDe(n) + (decisao ? ' (decisão)' : '');
        if (!saidas.length) {
          linhas.push(cab + (temEntrada ? ' (fim)' : (ordem.length > 1 ? ' (sem setas)' : '')));
        } else if (saidas.length === 1 && !decisao) {
          const l = saidas[0];
          linhas.push(cab + ' → ' + (l.rotulo ? '(' + l.rotulo + ') → ' : '') + ref(l.para) + volta(l));
        } else {
          linhas.push(cab);
          saidas.forEach((l, i) => {
            let cond;
            if (l.rotulo) cond = '(' + (decisao && !ENTRADA_DE_CONDICAO.test(l.rotulo) ? 'se ' : '') + l.rotulo + ')';
            else cond = decisao ? '(saída ' + (i + 1) + ', sem rótulo)' : '(segue)';
            linhas.push('   - ' + cond + ' → ' + ref(l.para) + volta(l));
          });
        }
      }
    }
    if (notas.length) {
      linhas.push('', ordem.length ? 'Notas soltas no quadro:' : 'Texto escrito no quadro:');
      for (const n of notas.slice().sort((a, b) => porPosicao(a, b))) linhas.push('- ' + n.texto);
    }
    if (setasSoltas.length) {
      linhas.push('', 'Setas que não ligam duas caixas:');
      for (const s of setasSoltas.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x))) {
        const r = s.rotulo ? ' ("' + s.rotulo + '")' : '';
        if (s.de) linhas.push('- sai de ' + ref(s.de) + ' e não chega em nenhuma caixa' + r);
        else if (s.para) linhas.push('- chega em ' + ref(s.para) + ' sem sair de nenhuma caixa' + r);
        else linhas.push('- seta solta, sem ligar nada' + r);
      }
    }
    const extra = [];
    if (outros.freedraw) extra.push(outros.freedraw + (outros.freedraw > 1 ? ' traços à mão' : ' traço à mão'));
    if (outros.line) extra.push(outros.line + (outros.line > 1 ? ' linhas' : ' linha'));
    if (outros.image) extra.push(outros.image + (outros.image > 1 ? ' imagens' : ' imagem'));
    if (extra.length) linhas.push('', 'Também no desenho (só na imagem): ' + extra.join(', ') + '.');
    return linhas.join('\n');
  }

  /* ---------------- bloco ```excalidraw numa mensagem ---------------- */
  const LIMITE_BLOCO = 1000000;     // 1 MB de texto
  const MAX_ELEMENTOS = 2000;
  const TIPOS_OK = ['rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'text', 'freedraw', 'image', 'frame'];
  const pontosOk = (pts) => Array.isArray(pts) && pts.every((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));

  /**
   * Confere o conteudo de um bloco ```excalidraw (cena completa OU lista-esqueleto do
   * convertToExcalidrawElements). { ok:true, elementos, esqueleto, texto } ou { ok:false, erro }.
   */
  function lerBlocoExcalidraw(texto) {
    const t = String(texto == null ? '' : texto).trim();
    const falha = (erro) => ({ ok: false, erro });
    if (!t) return falha('bloco vazio');
    if (t.length > LIMITE_BLOCO) return falha('bloco grande demais');
    let d;
    try { d = JSON.parse(t); } catch { return falha('não é um JSON válido'); }
    let elementos;
    if (Array.isArray(d)) elementos = d;
    else if (d && typeof d === 'object' && Array.isArray(d.elements)) elementos = d.elements;
    else return falha('esperava uma lista de elementos ou {"elements": [...]}');
    if (elementos.length > MAX_ELEMENTOS) return falha('elementos demais (' + elementos.length + ')');
    const ids = new Set();
    for (let i = 0; i < elementos.length; i++) {
      const el = elementos[i], qual = 'elemento ' + (i + 1);
      if (!el || typeof el !== 'object' || Array.isArray(el)) return falha(qual + ' não é um objeto');
      if (!TIPOS_OK.includes(el.type)) return falha(qual + ': tipo "' + String(el.type) + '" desconhecido');
      if (!Number.isFinite(el.x) || !Number.isFinite(el.y)) return falha(qual + ': faltam x e y numéricos');
      for (const k of ['width', 'height']) if (k in el && !Number.isFinite(el[k])) return falha(qual + ': ' + k + ' não é número');
      if (el.type === 'text' && typeof el.text !== 'string') return falha(qual + ': texto sem "text"');
      if ('label' in el && (!el.label || typeof el.label !== 'object' || typeof el.label.text !== 'string')) return falha(qual + ': "label" precisa de {"text": "..."}');
      if ('points' in el && !pontosOk(el.points)) return falha(qual + ': "points" inválido');
      if (el.type === 'freedraw' && !pontosOk(el.points)) return falha(qual + ': traço sem "points"');
      if ('id' in el && typeof el.id !== 'string') return falha(qual + ': "id" precisa ser texto');
      if (typeof el.id === 'string') ids.add(el.id);
    }
    const vivos = elementos.filter((el) => !el.isDeleted);
    if (!vivos.length) return falha('nenhum elemento');
    const esqueleto = elementos.some((el) => typeof el.id !== 'string' || 'label' in el || 'start' in el || 'end' in el);
    for (let i = 0; i < elementos.length; i++) {
      for (const k of ['start', 'end']) {
        const p = elementos[i][k];
        if (p == null) continue;
        if (typeof p !== 'object' || Array.isArray(p)) return falha('elemento ' + (i + 1) + ': "' + k + '" precisa ser {"id": "..."}');
        if ('id' in p && (typeof p.id !== 'string' || !ids.has(p.id))) return falha('elemento ' + (i + 1) + ': "' + k + '" aponta pra um id que não existe');
        if (!('id' in p) && !TIPOS_OK.includes(p.type)) return falha('elemento ' + (i + 1) + ': "' + k + '" sem id nem tipo');
      }
    }
    return { ok: true, elementos, esqueleto, texto: t };
  }

  return { fluxoEmTexto, lerBlocoExcalidraw, montarGrafo, TIPOS_CAIXA };
});
