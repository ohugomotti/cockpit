/* Janela de recorte: mostra a foto da tela (tirada pelo main com o Cockpit
   escondido), voce arrasta um retangulo e o pedaco vira anexo no painel.
   As coordenadas vao em pixels de CSS; o main multiplica pela escala da tela. */
(async () => {
  const foto = document.getElementById('foto');
  const veu = document.getElementById('veu');
  const sel = document.getElementById('sel');
  const medida = document.getElementById('medida');
  const dica = document.getElementById('dica');
  let dados = null;
  try { dados = await window.recorte.dados(); } catch {}
  if (!dados || !dados.png) { dica.textContent = 'Não consegui carregar a foto da tela.'; setTimeout(() => window.recorte.cancelar(), 1200); return; }
  foto.src = dados.png;

  let ini = null;
  let ret = null;   // { x, y, w, h } em px de CSS
  const pinta = () => {
    if (!ret || ret.w < 2 || ret.h < 2) { sel.style.display = 'none'; medida.style.display = 'none'; veu.style.background = ''; return; }
    sel.style.display = 'block';
    sel.style.left = ret.x + 'px'; sel.style.top = ret.y + 'px'; sel.style.width = ret.w + 'px'; sel.style.height = ret.h + 'px';
    veu.style.background = 'transparent';   // a sombra do proprio retangulo escurece o resto
    medida.style.display = 'block';
    medida.textContent = Math.round(ret.w * dados.escala) + ' × ' + Math.round(ret.h * dados.escala);
    medida.style.left = ret.x + 'px';
    medida.style.top = (ret.y > 24 ? ret.y - 22 : ret.y + ret.h + 4) + 'px';
  };
  let mandou = false;   // Enter segurado / mouseup + Enter: um recorte so'
  const confirmar = async () => {
    if (mandou || !ret || ret.w < 4 || ret.h < 4) return;
    mandou = true;
    dica.textContent = 'Anexando…';
    try {
      const r = await window.recorte.pronto(ret);
      if (r && r.error) { mandou = false; dica.textContent = 'Não deu: ' + r.error + '. Esc cancela.'; }
    } catch { mandou = false; }
  };
  document.addEventListener('mousedown', (e) => { if (e.button !== 0) return; ini = { x: e.clientX, y: e.clientY }; ret = { x: ini.x, y: ini.y, w: 0, h: 0 }; pinta(); });
  document.addEventListener('mousemove', (e) => {
    if (!ini) return;
    ret = { x: Math.min(ini.x, e.clientX), y: Math.min(ini.y, e.clientY), w: Math.abs(e.clientX - ini.x), h: Math.abs(e.clientY - ini.y) };
    pinta();
  });
  document.addEventListener('mouseup', () => {
    if (!ini) return;
    ini = null;
    // soltou o mouse com um retangulo de verdade: ja recorta (menos um passo)
    if (ret && ret.w >= 4 && ret.h >= 4) confirmar();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); window.recorte.cancelar(); }
    if (e.key === 'Enter') { e.preventDefault(); confirmar(); }
  });
  document.addEventListener('contextmenu', (e) => { e.preventDefault(); window.recorte.cancelar(); });
})();
