export function fitWithin(w, h, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('decode'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Returns raw base64 (no "data:image/jpeg;base64," prefix).
export async function resizeToJpegBase64(file, maxEdge = 400, quality = 0.8) {
  try {
    const img = await decode(file);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const { width, height } = fitWithin(w, h, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    if (img.close) img.close();
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const i = dataUrl.indexOf(',');
    if (i < 0 || !width || !height) throw new Error('bad');
    return dataUrl.slice(i + 1);
  } catch (e) {
    throw new Error('bad_image');
  }
}
