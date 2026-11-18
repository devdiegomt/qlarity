/**
 * Achica una foto en el celular antes de subirla.
 *
 * La cámara de un teléfono saca fotos de 3 a 8 MB; subir eso con datos móviles,
 * de pie al lado del carro, es lento y caro. A 1600 px de lado y calidad 0,75
 * una foto queda en 200-400 KB y todavía se ve un rayón. El backend acepta
 * hasta 1,5 MB.
 *
 * `imageOrientation: 'from-image'` respeta la rotación EXIF: sin eso, las fotos
 * tomadas con el teléfono vertical salen acostadas.
 */
export const LADO_MAXIMO = 1600;

export async function achicarFoto(archivo: File): Promise<Blob> {
  const bitmap = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
  const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
  const ancho = Math.round(bitmap.width * escala);
  const alto = Math.round(bitmap.height * escala);
  const lienzo = document.createElement('canvas');
  lienzo.width = ancho;
  lienzo.height = alto;
  const ctx = lienzo.getContext('2d');
  if (!ctx) throw new Error('No se pudo procesar la foto en este navegador');
  ctx.drawImage(bitmap, 0, 0, ancho, alto);
  bitmap.close();
  return new Promise((resolver, rechazar) =>
    lienzo.toBlob((b) => (b ? resolver(b) : rechazar(new Error('No se pudo procesar la foto'))), 'image/jpeg', 0.75),
  );
}
