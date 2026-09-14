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
  // Los tres bancos abiertos (sus muestras pasan por la app, pero si alguna
  // vista usa el enlace directo tiene que poder cargarlo).
  "https://api.openverse.org",
  "https://upload.wikimedia.org",
  "https://thumb.wikimedia.org",
  "https://archive.org",
  "https://*.archive.org",
  // Fotos de producto de Amazon. Solo se cargan cuando hay cuenta de
  // Afiliados: sin API no hay imágenes que enseñar.
  "https://m.media-amazon.com",
  "https://images-na.ssl-images-amazon.com",
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
  // Vídeo de Wikimedia (webm) y de Internet Archive, que sirve desde
  // subdominios distintos en cada descarga.
  "https://upload.wikimedia.org",
  "https://archive.org",
  "https://*.archive.org",
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
