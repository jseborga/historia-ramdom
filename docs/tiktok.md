# TikTok: cómo se conecta y qué cuenta hace falta

## Cómo se conecta la cuenta

La conexión es un OAuth normal. Tú nunca le das tu contraseña de TikTok a la
app: autorizas en el propio TikTok y este devuelve un permiso revocable.

1. En **Ajustes** pulsas *Conectar cuenta de TikTok*.
2. La app genera un `state` aleatorio, lo guarda en una cookie `httpOnly` y te
   manda a `https://www.tiktok.com/v2/auth/authorize/` con la clave pública de
   la app, la URL de retorno y los permisos pedidos.
3. Inicias sesión en TikTok (o ya lo estás) y ves la pantalla de permisos.
4. TikTok te devuelve a `https://tu-dominio/api/tiktok/callback` con un código.
   La app comprueba que el `state` coincide —eso evita que alguien te enchufe
   una autorización ajena— y canjea el código por dos tokens.
5. Los tokens se guardan **cifrados con AES-256-GCM** en la base de datos. El de
   acceso caduca pronto; antes de cada subida la app lo renueva sola con el de
   refresco y vuelve a cifrar ambos.

A partir de ahí, cada subida abre la sesión con ese token, manda el MP4 por
trozos y guarda el identificador de la publicación.

Puedes cortar la conexión desde **Ajustes → Desconectar**, o desde TikTok en
*Configuración → Seguridad y permisos → Aplicaciones conectadas*.

## Permisos (`TIKTOK_SCOPES`)

| Permiso | Para qué | ¿Aprobación aparte? |
|---|---|---|
| `user.info.basic` | Identificar la cuenta | No |
| `video.upload` | Enviar el vídeo a **borradores** | Sí, al enviar la app a revisión |
| `video.list` | Leer vistas, likes, comentarios y compartidos | Sí |
| `video.publish` | **Publicar directo**, sin pasar por la app | Sí, y con auditoría |

Por defecto se piden los tres primeros. Añade `video.publish` solo cuando te lo
aprueben.

**Los permisos se fijan al autorizar.** Si cambias `TIKTOK_SCOPES`, hay que
desconectar y volver a conectar la cuenta; si no, la app fallará con un mensaje
que te dice exactamente qué permiso falta y cuáles tiene.

## Qué tipo de cuenta necesitas

Depende del camino, y son dos cosas distintas que conviene no mezclar:

### Camino A — descargar el MP4 y programarlo en TikTok Studio

- Necesitas una cuenta **Creator o Business**: el botón de programar solo
  aparece en esas. Se cambia en la app: *Ajustes y privacidad → Cuenta →
  Cambiar a cuenta de empresa*. Es gratis y reversible.
- Entras a tiktok.com en el navegador, abres TikTok Studio, subes el MP4 y
  programas **hasta 10 días** por delante.
- No necesitas registrar nada en TikTok for Developers.

### Camino B — conectar la app por API

- **Cualquier cuenta puede autorizar**: personal, Creator o Business. Aquí el
  tipo de cuenta no es lo que manda.
- Lo que manda es el estado de **tu app de desarrollador**. Mientras no supere
  la auditoría de TikTok:
  - todo lo que publique queda en **modo privado** (`SELF_ONLY`);
  - como mucho **5 usuarios pueden publicar en 24 horas**;
  - y **las cuentas que publiquen deben estar en privado** en el momento de
    publicar.
- Para que un vídeo pase a público después, el dueño de la cuenta tiene que
  poner la cuenta en público y luego cambiar la privacidad de cada vídeo, uno
  a uno.
- Además, registrar la app pide una página de política de privacidad y otra de
  términos publicadas en tu dominio.

Por eso, para un canal propio, el camino A suele ser el sensato, y el B tiene
sentido sobre todo en modo **borradores**: la app sube el vídeo, te llega la
notificación y rematas la publicación desde el móvil en diez segundos.

## ¿Puede ser una cuenta nueva?

Sí, técnicamente no hay ningún impedimento: una cuenta recién creada puede
autorizar la app igual que una antigua.

Ahora, tres advertencias prácticas que no son de la API sino de cómo funciona
TikTok:

1. **Para programar en TikTok Studio hay que cambiarla a Creator o Business.**
   Es inmediato, pero es un paso que la gente olvida y luego no encuentra el
   botón de programar.
2. **Una cuenta nueva publicando en automático es el perfil más vigilado.** Si
   lo primero que hace es soltar varios vídeos generados con IA, lo más probable
   es que el alcance se hunda. Conviene empezar despacio, una o dos
   publicaciones al día, y marcar siempre la etiqueta de contenido generado
   con IA.
3. **Si vas por la API sin auditoría, la cuenta tiene que estar en privado**
   para poder publicar, lo cual es bastante incompatible con hacer crecer una
   cuenta nueva. Otra razón para empezar por el camino A.

## Lo que TikTok no da

- **El tiempo medio de visualización no está en la API.** La Display API entrega
  vistas, likes, comentarios y compartidos; la retención solo aparece en la
  analítica de TikTok Studio. Por eso cada historia tiene un formulario donde
  ese dato se escribe a mano.
- **CapCut no tiene API pública.** Su vínculo con TikTok funciona solo dentro de
  la app móvil de CapCut. Si quieres retocar un vídeo, descárgalo y ábrelo ahí.
- **Nada de bots de navegador** ni métodos no oficiales para publicar: incumplen
  los términos y ponen en riesgo la cuenta.
