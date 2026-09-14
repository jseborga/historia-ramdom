import type { FastifyInstance, FastifyReply } from "fastify";
import { env } from "../env.js";

/**
 * Términos de servicio y política de privacidad, servidos por la propia app.
 *
 * TikTok (y Amazon, y cualquier plataforma seria) pide las dos direcciones
 * publicadas en el dominio y accesibles **sin iniciar sesión** para aprobar la
 * aplicación. Por eso viven aquí y no dentro del frontend, que exige login:
 *
 *   https://tu-dominio/terminos   ·  https://tu-dominio/terms
 *   https://tu-dominio/privacidad ·  https://tu-dominio/privacy
 *
 * El texto describe lo que esta app hace **de verdad** —qué guarda, con quién
 * habla y cuánto tiempo lo conserva—, así que si cambia el comportamiento hay
 * que cambiarlo aquí también. Cada página lleva la versión en español y, debajo,
 * la misma en inglés, porque quien revisa la app no suele leer español.
 */

/** Fecha de la última revisión de estos textos. Súbela si cambias el contenido. */
const ACTUALIZADO = "14 de septiembre de 2026";
const ACTUALIZADO_EN = "September 14, 2026";

const escapar = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const dominio = () => env.PUBLIC_URL.replace(/\/$/, "");
const titular = () => env.LEGAL_TITULAR?.trim() || "";
const contacto = () => env.LEGAL_CONTACTO?.trim() || "";

/**
 * Si falta el titular o el correo, el documento sale igual pero con un aviso
 * bien visible: es preferible verlo uno mismo antes que enviar a revisión una
 * política firmada por nadie.
 */
function aviso() {
  const faltan = [!titular() && "LEGAL_TITULAR", !contacto() && "LEGAL_CONTACTO"].filter(Boolean);
  if (!faltan.length) return "";
  return `<p class="falta"><strong>Sin terminar:</strong> falta configurar ${faltan.join(
    " y ",
  )} en el entorno del servidor. Hasta que no esté, este documento no identifica a nadie y no sirve
  para registrar la aplicación. · <em>Incomplete: set ${faltan.join(" and ")} on the server.</em></p>`;
}

const quien = () => escapar(titular() || "[titular sin configurar]");
const correo = () =>
  contacto()
    ? `<a href="mailto:${escapar(contacto())}">${escapar(contacto())}</a>`
    : "[correo sin configurar]";

const ESTILO = `
  :root { color-scheme: light dark; }
  body { margin: 0; background: #10131a; color: #e7e9ee; font: 16px/1.65 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 46rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
  h1 { font-size: 1.7rem; line-height: 1.25; margin: 0 0 .35rem; }
  h2 { font-size: 1.15rem; margin: 2rem 0 .5rem; }
  h3 { font-size: 1rem; margin: 1.4rem 0 .35rem; }
  p, li { color: #cfd4df; }
  li { margin: .3rem 0; }
  a { color: #7fd1ff; }
  code { background: #1b202b; padding: .1rem .35rem; border-radius: .25rem; font-size: .9em; }
  .fecha { color: #8b93a5; font-size: .9rem; margin: 0 0 1.5rem; }
  .falta { background: #3b1d1d; border: 1px solid #7a3232; color: #ffd9d9; padding: .8rem 1rem; border-radius: .5rem; }
  hr { border: 0; border-top: 1px solid #262c39; margin: 3rem 0 2rem; }
  footer { color: #8b93a5; font-size: .9rem; margin-top: 2.5rem; }
  @media (prefers-color-scheme: light) {
    body { background: #fbfbfd; color: #1a1d24; }
    p, li { color: #333a48; }
    a { color: #0b62b0; }
    code { background: #eceef3; }
    .falta { background: #fdecec; border-color: #e0a2a2; color: #7a1f1f; }
    hr { border-top-color: #dfe2ea; }
    .fecha, footer { color: #6a7182; }
  }
`;

function pagina(reply: FastifyReply, titulo: string, cuerpo: string) {
  return reply.header("Content-Type", "text/html; charset=utf-8").send(
    `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(titulo)}</title>
<style>${ESTILO}</style>
</head>
<body><main>
${cuerpo}
<footer>
  <a href="/terminos">Términos de servicio</a> · <a href="/privacidad">Política de privacidad</a> ·
  <a href="${escapar(dominio())}">${escapar(dominio())}</a>
</footer>
</main></body>
</html>`,
  );
}

// ------------------------------------------------------------ Privacidad

const privacidad = () => `
<h1>Política de privacidad</h1>
<p class="fecha">Última actualización: ${ACTUALIZADO}</p>
${aviso()}

<p>Este documento explica qué datos trata <strong>${quien()}</strong> («el titular») a través de la
aplicación publicada en <code>${escapar(dominio())}</code> («la aplicación»), una herramienta
privada para producir y publicar vídeos cortos. La aplicación <strong>no tiene registro público</strong>:
solo la usan las cuentas que el titular crea.</p>

<h2>1. Qué datos se tratan</h2>
<h3>Cuenta de acceso</h3>
<ul>
  <li>Correo electrónico y contraseña de quien entra. La contraseña <strong>no se guarda</strong>:
      se guarda un resumen criptográfico con argon2id.</li>
  <li>Sesiones: una cookie propia <code>sid</code> (<code>httpOnly</code>, <code>secure</code>,
      <code>sameSite=strict</code>) que caduca a los 7 días. En la base de datos solo se guarda un
      hash del testigo, no el testigo.</li>
  <li>No hay cookies de terceros, ni analítica, ni rastreo publicitario de ningún tipo.</li>
</ul>

<h3>Cuenta de TikTok conectada (opcional)</h3>
<ul>
  <li>Identificador de la cuenta (<code>open_id</code>), nombre público si TikTok lo entrega,
      permisos concedidos y fecha de caducidad del testigo.</li>
  <li>Testigos de acceso y de refresco, <strong>cifrados con AES-256-GCM</strong> antes de
      guardarlos. Se usan únicamente para subir los vídeos del titular y leer las estadísticas de
      esos mismos vídeos.</li>
  <li>Los testigos se obtienen por el flujo oficial de OAuth de TikTok: la aplicación nunca conoce
      la contraseña de TikTok.</li>
</ul>

<h3>Estadísticas de publicación</h3>
<ul>
  <li>De los vídeos propios publicados por la aplicación: visualizaciones, «me gusta», comentarios,
      compartidos y guardados, más el identificador público del vídeo.</li>
  <li>Son cifras <strong>agregadas del vídeo</strong>. La aplicación no recoge ni almacena datos de
      las personas que ven, comentan o comparten.</li>
</ul>

<h3>Contenido</h3>
<ul>
  <li>Guiones, textos, vídeos, fotos y audios que el titular sube o genera en la aplicación.</li>
  <li>Los archivos de trabajo y los MP4 se borran automáticamente pasados
      ${env.RETENCION_DIAS} días.</li>
</ul>

<h3>Registros del servidor</h3>
<ul>
  <li>Registro técnico de peticiones (ruta, código de respuesta, tiempo). Las cabeceras
      <code>authorization</code> y <code>cookie</code> se omiten expresamente, y las claves de los
      servicios externos nunca se escriben en el registro.</li>
</ul>

<h2>2. Para qué se usan</h2>
<p>Para lo único que hace la aplicación: dejar entrar a quien tiene cuenta, producir los vídeos,
publicarlos en la cuenta de TikTok que el titular haya conectado y enseñar cómo han funcionado. No
se usan para publicidad, ni para elaborar perfiles, ni para entrenar modelos propios.</p>

<h2>3. Con quién se comparten</h2>
<p>No se venden ni se ceden a terceros con fines comerciales. Para funcionar, la aplicación envía lo
imprescindible a estos proveedores, cada uno con su propia política:</p>
<ul>
  <li><strong>Motores de texto</strong> (Anthropic, Google, OpenAI o Groq, según cuál se configure):
      reciben las instrucciones y el texto del guion que se les pide escribir.</li>
  <li><strong>Bancos de imagen</strong> (Pexels, Pixabay, NASA, Openverse, Wikimedia Commons,
      Internet Archive): reciben las palabras de búsqueda.</li>
  <li><strong>Amazon</strong> (Product Advertising API), si está configurada: recibe los términos de
      búsqueda o el código del producto.</li>
  <li><strong>TikTok</strong>: recibe el vídeo y su descripción cuando el titular lo publica.</li>
  <li><strong>Proveedor de alojamiento</strong>: la aplicación corre en un servidor contratado por el
      titular.</li>
</ul>

<h2>4. Dónde se guardan y durante cuánto tiempo</h2>
<ul>
  <li>En la base de datos y el disco del servidor del titular, no en servicios de terceros.</li>
  <li>Cuentas de acceso y estadísticas: mientras la aplicación siga en uso.</li>
  <li>Vídeos y archivos de trabajo: ${env.RETENCION_DIAS} días.</li>
  <li>Sesiones: 7 días, y se borran antes al cerrar sesión.</li>
  <li>Testigos de TikTok: hasta que se desconecta la cuenta, momento en el que se
      <strong>borran</strong> de la base de datos.</li>
</ul>

<h2>5. Seguridad</h2>
<p>Tráfico por HTTPS; contraseñas con argon2id; testigos de TikTok y claves sensibles cifrados con
AES-256-GCM; política de contenido del navegador restringida a los dominios necesarios; límite de
peticiones; y ninguna clave viaja al navegador. Ningún sistema es infalible, pero estas son las
medidas que la aplicación aplica hoy.</p>

<h2>6. Tus derechos</h2>
<p>Quien tenga cuenta puede pedir acceso, copia, corrección o borrado de sus datos escribiendo a
${correo()}. La conexión con TikTok se puede revocar en cualquier momento desde <em>Ajustes →
Desconectar</em> en la aplicación, o desde TikTok en <em>Configuración → Seguridad y permisos →
Aplicaciones conectadas</em>; al hacerlo, los testigos guardados se eliminan.</p>

<h2>7. Menores</h2>
<p>La aplicación no está dirigida a menores de 13 años y no recoge datos de menores a sabiendas.</p>

<h2>8. Cambios</h2>
<p>Si cambia lo que la aplicación hace con los datos, cambia este texto y su fecha de actualización.</p>

<h2>9. Contacto</h2>
<p>${quien()} · ${correo()} · Jurisdicción: ${escapar(env.LEGAL_JURISDICCION)}.</p>

<hr>

<h1 id="en">Privacy Policy (English)</h1>
<p class="fecha">Last updated: ${ACTUALIZADO_EN}</p>

<p>This policy describes the data handled by <strong>${quien()}</strong> (“the operator”) through the
application at <code>${escapar(dominio())}</code> (“the app”), a private tool used to produce and
publish short videos. The app has <strong>no public sign-up</strong>: only accounts created by the
operator can use it.</p>

<h2>1. Data we process</h2>
<ul>
  <li><strong>Sign-in account:</strong> email address and a password hash (argon2id — the password
      itself is never stored). Sessions use a first-party <code>sid</code> cookie
      (<code>httpOnly</code>, <code>secure</code>, <code>sameSite=strict</code>) that expires after 7
      days; only a hash of the session token is stored. No third-party cookies, no analytics, no
      advertising trackers.</li>
  <li><strong>Connected TikTok account (optional):</strong> the account identifier
      (<code>open_id</code>), public nickname if TikTok returns one, granted scopes, and access and
      refresh tokens <strong>encrypted with AES-256-GCM</strong>. They are used only to upload the
      operator’s own videos and read the statistics of those videos. Tokens are obtained through
      TikTok’s official OAuth flow; the app never sees a TikTok password.</li>
  <li><strong>Publishing statistics:</strong> view, like, comment, share and save counts for the
      operator’s own videos, plus the public video id. These are aggregate per-video figures; the app
      does not collect data about the people who watch, comment on or share the videos.</li>
  <li><strong>Content:</strong> scripts, text, video, photos and audio uploaded or generated by the
      operator. Working files and rendered MP4s are deleted automatically after
      ${env.RETENCION_DIAS} days.</li>
  <li><strong>Server logs:</strong> request path, status code and timing. The
      <code>authorization</code> and <code>cookie</code> headers are redacted, and API keys are never
      written to logs.</li>
</ul>

<h2>2. Why</h2>
<p>Only to run the app: authenticate the operator, produce videos, publish them to the TikTok account
the operator connected, and report how they performed. Never for advertising, profiling, or training
our own models.</p>

<h2>3. Sharing</h2>
<p>Data is never sold or shared for commercial purposes. The app sends the minimum necessary to:
text engines (Anthropic, Google, OpenAI or Groq — the script prompt and text); stock media banks
(Pexels, Pixabay, NASA, Openverse, Wikimedia Commons, Internet Archive — the search keywords);
Amazon’s Product Advertising API, if configured (search terms or product code); TikTok (the video and
its caption, when the operator publishes); and the hosting provider running the server.</p>

<h2>4. Storage and retention</h2>
<p>Everything is stored on the operator’s own server. Accounts and statistics are kept while the app
is in use; videos and working files for ${env.RETENCION_DIAS} days; sessions for 7 days; TikTok tokens
until the account is disconnected, at which point they are <strong>deleted</strong>.</p>

<h2>5. Security</h2>
<p>HTTPS, argon2id password hashing, AES-256-GCM encryption for TikTok tokens and sensitive keys, a
restrictive browser content policy, rate limiting, and no secrets ever sent to the browser.</p>

<h2>6. Your rights</h2>
<p>Account holders may request access, a copy, correction or deletion of their data by writing to
${correo()}. The TikTok connection can be revoked at any time from <em>Settings → Disconnect</em> in
the app, or in TikTok under <em>Settings → Security and permissions → Connected apps</em>; the stored
tokens are then deleted.</p>

<h2>7. Children</h2>
<p>The app is not directed to children under 13 and does not knowingly collect their data.</p>

<h2>8. Changes and contact</h2>
<p>If what the app does with data changes, this text and its date change with it.
${quien()} · ${correo()} · Jurisdiction: ${escapar(env.LEGAL_JURISDICCION)}.</p>
`;

// ------------------------------------------------------------ Términos

const terminos = () => `
<h1>Términos de servicio</h1>
<p class="fecha">Última actualización: ${ACTUALIZADO}</p>
${aviso()}

<p>Estos términos regulan el uso de la aplicación publicada en <code>${escapar(dominio())}</code>
(«la aplicación»), operada por <strong>${quien()}</strong> («el titular»). Usarla implica
aceptarlos.</p>

<h2>1. Qué es la aplicación</h2>
<p>Una herramienta privada de producción de vídeo: escribe guiones con ayuda de modelos de
inteligencia artificial, monta el vídeo con material propio o de bancos de imagen con licencia libre,
genera la voz en off y, si el titular lo decide, lo publica en su propia cuenta de TikTok.
<strong>No es una red social ni un servicio abierto al público</strong>: no hay registro, y solo
entran las cuentas que crea el titular.</p>

<h2>2. Acceso</h2>
<ul>
  <li>Las credenciales son personales e intransferibles.</li>
  <li>El titular puede revocar el acceso en cualquier momento, sin aviso previo.</li>
  <li>Quien detecte un uso no autorizado de su cuenta debe comunicarlo a ${correo()}.</li>
</ul>

<h2>3. Uso aceptable</h2>
<p>No se permite usar la aplicación para:</p>
<ul>
  <li>producir o publicar contenido ilegal, violento, de odio, acosador, sexual explícito o engañoso;</li>
  <li>suplantar a personas u organizaciones, ni inventar declaraciones atribuidas a personas reales;</li>
  <li>infringir derechos de autor, marcas o licencias de terceros;</li>
  <li>automatizar la publicación de forma que incumpla las normas de la plataforma de destino.</li>
</ul>
<p>El contenido generado con inteligencia artificial se marca como tal, tanto en la descripción del
vídeo como en la etiqueta correspondiente al publicarlo.</p>

<h2>4. Material de terceros y créditos</h2>
<p>La aplicación busca vídeo y fotos en Pexels, Pixabay, la NASA, Openverse, Wikimedia Commons e
Internet Archive, y guarda de cada pieza su autor, su página y su licencia. Quien publica es
responsable de respetar esa licencia y de mantener los créditos que la app prepara.</p>

<h2>5. Enlaces de afiliado</h2>
<p>Los vídeos que hacen referencia a un producto pueden incluir un enlace de afiliado de Amazon. En
ese caso la descripción lleva siempre la divulgación «Como Afiliado de Amazon, gano por las compras
adscritas.». Las imágenes y los datos de producto proceden únicamente de la API oficial de Amazon
(Product Advertising API v5). Los precios son una referencia del momento de la consulta y pueden
cambiar en Amazon en cualquier instante.</p>

<h2>6. TikTok</h2>
<p>La conexión con TikTok es voluntaria y se hace con las <strong>APIs oficiales</strong> de TikTok,
mediante OAuth. La aplicación solo sube los vídeos que el titular decide subir, y se puede revocar el
permiso en cualquier momento desde TikTok o desde la propia aplicación. El uso de esas APIs queda
sujeto además a los términos para desarrolladores y a las Normas de la Comunidad de TikTok. La
aplicación no usa métodos no oficiales, ni automatiza interacciones (seguir, comentar, dar «me
gusta») en nombre de nadie.</p>

<h2>7. Contenido generado por IA</h2>
<p>Los textos los escribe un modelo de lenguaje y <strong>pueden contener errores o afirmaciones
inexactas</strong>. Revisarlos antes de publicar es responsabilidad de quien publica. La aplicación no
garantiza la veracidad de lo que genera.</p>

<h2>8. Disponibilidad y garantías</h2>
<p>La aplicación se ofrece «tal cual», sin garantía de disponibilidad, de que funcione sin fallos ni
de que los servicios externos de los que depende (modelos de IA, bancos de imagen, TikTok, Amazon)
sigan funcionando o manteniendo sus condiciones.</p>

<h2>9. Responsabilidad</h2>
<p>En la medida que permita la ley aplicable, el titular no responde por daños indirectos o
derivados, pérdida de contenido, de alcance o de ingresos por el uso de la aplicación. Cada usuario
es responsable del contenido que produce y publica con ella.</p>

<h2>10. Cambios y ley aplicable</h2>
<p>Estos términos pueden cambiar; la fecha de arriba indica la última revisión. Se rigen por la
legislación de ${escapar(env.LEGAL_JURISDICCION)}.</p>

<h2>11. Contacto</h2>
<p>${quien()} · ${correo()}</p>

<hr>

<h1 id="en">Terms of Service (English)</h1>
<p class="fecha">Last updated: ${ACTUALIZADO_EN}</p>

<p>These terms govern the use of the application at <code>${escapar(dominio())}</code> (“the app”),
operated by <strong>${quien()}</strong> (“the operator”). Using it means accepting them.</p>

<h2>1. What the app is</h2>
<p>A private video production tool: it drafts scripts with AI models, edits video from the operator’s
own footage or from openly licensed stock banks, generates voice-over, and — if the operator chooses —
publishes to the operator’s own TikTok account. It is <strong>not a social network or a public
service</strong>: there is no sign-up, and only accounts created by the operator can log in.</p>

<h2>2. Access</h2>
<p>Credentials are personal and non-transferable. The operator may revoke access at any time. Report
any unauthorised use to ${correo()}.</p>

<h2>3. Acceptable use</h2>
<p>The app may not be used to produce or publish illegal, violent, hateful, harassing, sexually
explicit or deceptive content; to impersonate people or organisations or fabricate statements
attributed to real people; to infringe copyright, trademarks or third-party licences; or to automate
publishing in ways that breach the destination platform’s rules. AI-generated content is labelled as
such, both in the caption and with the platform’s AI-generated content tag.</p>

<h2>4. Third-party material and credits</h2>
<p>The app searches Pexels, Pixabay, NASA, Openverse, Wikimedia Commons and the Internet Archive, and
stores each item’s author, source page and licence. Whoever publishes is responsible for honouring
those licences and keeping the credits the app prepares.</p>

<h2>5. Affiliate links</h2>
<p>Videos referencing a product may include an Amazon affiliate link. When they do, the caption always
carries the required disclosure (“As an Amazon Associate I earn from qualifying purchases”, in
Spanish). Product images and data come solely from Amazon’s official Product Advertising API v5.
Prices are indicative at the time of the query and may change at any moment.</p>

<h2>6. TikTok</h2>
<p>Connecting TikTok is optional and uses TikTok’s <strong>official APIs</strong> via OAuth. The app
only uploads videos the operator chooses to upload, and the authorisation can be revoked at any time
from TikTok or from the app. Use of those APIs is additionally subject to TikTok’s Developer Terms of
Service and Community Guidelines. The app uses no unofficial methods and does not automate
interactions (following, commenting, liking) on anyone’s behalf.</p>

<h2>7. AI-generated content</h2>
<p>Text is written by a language model and <strong>may contain errors or inaccurate statements</strong>.
Reviewing it before publishing is the publisher’s responsibility; the app makes no warranty as to the
accuracy of what it generates.</p>

<h2>8. Availability, warranties and liability</h2>
<p>The app is provided “as is”, with no warranty of availability or fitness, and no guarantee that the
external services it depends on (AI models, stock banks, TikTok, Amazon) will keep working or keep
their current terms. To the extent permitted by law, the operator is not liable for indirect or
consequential damages, or loss of content, reach or revenue. Each user is responsible for the content
they produce and publish.</p>

<h2>9. Changes, governing law and contact</h2>
<p>These terms may change; the date above marks the latest revision. They are governed by the laws of
${escapar(env.LEGAL_JURISDICCION)}. ${quien()} · ${correo()}</p>
`;

export async function rutasLegales(app: FastifyInstance) {
  // Cuatro direcciones, dos documentos: el formulario de TikTok admite
  // cualquiera, y quien llegue en inglés no se queda mirando un 404.
  for (const ruta of ["/terminos", "/terms"]) {
    app.get(ruta, async (_req, reply) => pagina(reply, "Términos de servicio", terminos()));
  }
  for (const ruta of ["/privacidad", "/privacy"]) {
    app.get(ruta, async (_req, reply) => pagina(reply, "Política de privacidad", privacidad()));
  }
}

/** Para los diagnósticos: las direcciones que hay que pegar y si están completas. */
export const estadoLegal = () => ({
  terminos: `${dominio()}/terminos`,
  privacidad: `${dominio()}/privacidad`,
  completo: Boolean(titular() && contacto()),
});
