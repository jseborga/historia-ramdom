/**
 * La política de contenido del navegador, en un sitio y no dentro del arranque.
 *
 * Está aquí porque además de aplicarla hay que poder **enseñarla**: cuando una
 * miniatura no carga, lo primero que hay que saber es si el servidor que está
 * corriendo permite ese dominio. La comprobación de Ajustes la lee de aquí, así
 * que dice lo que de verdad se está aplicando y no lo que debería.
 */

/** Dominios de imagen: miniaturas de los bancos y muestras propias. */
export const IMG_SRC = [
  "'self'",
  "data:",
  "https://images.pexels.com",
  "https://cdn.pixabay.com",
  "https://pixabay.com",
  // Pixabay sirve las muestras de sus entradas antiguas desde aquí.
  "https://i.vimeocdn.com",
  "https://images-assets.nasa.gov",
];

/**
 * Dominios de vídeo y audio: los mismos CDN de los que el servidor ya
 * descarga, para poder ver el clip antes de elegirlo sin pasar el archivo por
 * nuestro ancho de banda.
 */
export const MEDIA_SRC = [
  "'self'",
  "blob:",
  "https://videos.pexels.com",
  "https://cdn.pixabay.com",
  "https://videos.pixabay.com",
  "https://player.vimeo.com",
  "https://images-assets.nasa.gov",
];

export const DIRECTIVAS_CSP = {
  "default-src": ["'self'"],
  "img-src": IMG_SRC,
  "media-src": MEDIA_SRC,
  "connect-src": ["'self'"],
};

/** Los dominios externos que se permiten, sin `'self'` ni esquemas sueltos. */
export const dominiosPermitidos = (lista: string[]) =>
  lista.filter((d) => d.startsWith("https://")).map((d) => d.replace("https://", ""));
