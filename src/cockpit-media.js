'use strict';
const { imageData } = require('./cockpit-experiments');
function nativeImage(item) {
  if (!item || item.type !== 'imageGeneration') return null;
  if (item.failure || item.status === 'failed') return { id: item.id, error: true, text: 'A geração da imagem falhou.' };
  try {
    const raw = item.result || '';
    const image = imageData(raw.startsWith('data:') ? raw : 'data:image/png;base64,' + raw);
    return { id: item.id, image: image.data, text: String(item.revisedPrompt || '').slice(0, 12000) };
  } catch { return { id: item.id, error: true, text: 'O motor devolveu uma imagem sem prévia compatível.', file: typeof item.savedPath === 'string' ? item.savedPath : '' }; }
}
module.exports = { nativeImage };
