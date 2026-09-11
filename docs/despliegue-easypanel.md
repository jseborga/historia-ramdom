# Instalar el estudio en Easypanel, paso a paso

Guía completa: desde un servidor vacío hasta la app funcionando con su dominio,
su volumen y el primer usuario creado.

Los nombres de pestaña son los de Easypanel; si tu versión los llama de otra
forma, la idea es la misma.

---

## 0. Lo que necesitas antes de empezar

| | |
|---|---|
| Servidor | 2 vCPU y 4 GB de RAM como punto de partida. El render con ffmpeg es lo más pesado. |
| Disco | 20 GB bastan: los MP4 se borran solos a los 15 días (`RETENCION_DIAS`). |
| Dominio | Un subdominio, por ejemplo `estudio.tudominio.com`, con un registro **A** apuntando a la IP del servidor. |
| Claves | Al menos una de IA (Groq es gratis para empezar) y al menos una de clips (Pexels o Pixabay). |
| Repositorio | Este repo en GitHub. Si es privado, conecta antes tu cuenta de GitHub en Easypanel. |

Crea el registro DNS **antes** de pedir el certificado: si el dominio no
resuelve todavía, la emisión falla.

---

## 1. Asegurar el servidor

Antes de instalar nada:

- **SSH solo con llave**, sin contraseña y sin entrar como root.
- **Firewall** con únicamente los puertos 22, 80 y 443 abiertos.
- El panel de Easypanel (puerto 3000 del host) **no debería quedar abierto a
  todo internet**: restríngelo a tu IP o ponlo detrás de un dominio con HTTPS.
- En Easypanel: contraseña fuerte y **verificación en dos pasos activada**.
- Mantén al día el sistema operativo y el propio Easypanel.

> El puerto 3000 del panel y el puerto 3000 de la app son cosas distintas: la
> app escucha en el 3000 **dentro de su contenedor**, en la red interna, y solo
> se llega a ella a través del proxy.

---

## 2. Crear el proyecto

En Easypanel, **New Project** con el nombre `estudio`.

El nombre importa: Easypanel bautiza los servicios internos como
`<proyecto>_<servicio>`, y ese es el nombre de host que usarás en
`DATABASE_URL` y `REDIS_URL`. Si llamas al proyecto de otra forma, ajusta las
variables en consecuencia.

---

## 3. Postgres

1. Dentro del proyecto: **+ Service → Postgres**.
2. Nombre: `postgres`.
3. Contraseña: genera una larga (ver sección 5).
4. Base de datos: `estudio`.
5. **No publiques el puerto.** Solo tiene que verlo la app por la red interna.
6. Deploy.

Host interno resultante: **`estudio_postgres`**, puerto 5432.

---

## 4. Redis

1. **+ Service → Redis**.
2. Nombre: `redis`.
3. Contraseña: otra distinta, también larga.
4. Tampoco publiques el puerto.
5. Deploy.

Host interno resultante: **`estudio_redis`**, puerto 6379.

Redis guarda la cola de trabajos y la caché de búsquedas de clips. Si se vacía
no pierdes historias: la app vuelve a registrar los horarios de todas las series
activas al arrancar.

---

## 5. Generar los secretos

Hazlo **en tu máquina**, no en el panel, y guarda los valores en tu gestor de
contraseñas antes de pegarlos:

```bash
openssl rand -base64 32   # ENCRYPTION_KEY  (tiene que ser base64 de 32 bytes)
openssl rand -hex 32      # API_TOKEN       (para el servidor MCP)
openssl rand -base64 24   # contraseña de Postgres
openssl rand -base64 24   # contraseña de Redis
```

Para el login maestro necesitas el hash de tu contraseña. Puedes sacarlo después
del primer despliegue, desde la Shell del servicio:

```bash
node dist/scripts/cifrar-secreto.js --password
```

> **`ENCRYPTION_KEY` es la pieza crítica.** Si la pierdes, tendrás que volver a
> conectar TikTok y volver a cifrar cualquier variable que hayas guardado con
> el prefijo `enc:`. Guárdala en dos sitios.

---

## 6. Crear el servicio de la app

1. **+ Service → App**, nombre `app`.
2. Pestaña **Source**:
   - Provider: **GitHub**
   - Repositorio: `jseborga/historia-ramdom`
   - Rama: la que quieras desplegar
   - Build Path: `/`
3. Pestaña **Build**:
   - Método: **Dockerfile**
   - Dockerfile path: `Dockerfile` (está en la raíz)

No toques el comando de arranque: el Dockerfile ya ejecuta
`prisma migrate deploy` y después el servidor, así que las migraciones se
aplican solas en cada despliegue.

---

## 7. Variables de entorno

Pestaña **Environment**. Pega esto y sustituye lo que está en MAYÚSCULAS.
Easypanel reemplaza `$(PRIMARY_DOMAIN)` por el dominio principal del servicio,
así que esa línea puedes dejarla tal cual.

```bash
NODE_ENV=production
PORT=3000
PUBLIC_URL=https://$(PRIMARY_DOMAIN)

DATABASE_URL=postgres://postgres:CLAVE_POSTGRES@estudio_postgres:5432/estudio
REDIS_URL=redis://default:CLAVE_REDIS@estudio_redis:6379

DATA_DIR=/data
ENCRYPTION_KEY=TU_CLAVE_BASE64_DE_32_BYTES

# Login maestro (el hash lo generas en el paso 11)
ADMIN_EMAIL=tu@correo.com
ADMIN_PASSWORD_HASH=

# Token para el servidor MCP; déjalo vacío si no lo vas a usar todavía
API_TOKEN=TU_TOKEN_HEX

# Límites
MAX_CLIP_MB=150
MAX_VIDEO_MB=300
RETENCION_DIAS=15

# IA: pon solo las que tengas
GROQ_API_KEY=
GEMINI_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=

# Modelos (compruébalos antes de desplegar: cambian a menudo)
GROQ_MODELO=llama-3.3-70b-versatile
GEMINI_MODELO=gemini-2.5-flash
OPENAI_MODELO=gpt-4o-mini
ANTHROPIC_MODELO=claude-opus-5
GEMINI_MODELO_VOZ=gemini-3.1-flash-tts-preview
GEMINI_VOZ=Kore
OPENAI_MODELO_VOZ=gpt-4o-mini-tts
OPENAI_VOZ=coral

# Clips: hace falta al menos una
PEXELS_API_KEY=
PIXABAY_API_KEY=

# Reddit: déjalo apagado hasta que lo quieras
REDDIT_ACTIVO=false

# TikTok: opcional. El callback se deduce de PUBLIC_URL si no lo pones.
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
```

**Las variables que dejes en blanco se ignoran**, así que puedes pegar el bloque
entero y rellenar solo lo que uses. Una línea como `API_TOKEN=` es lo mismo que
no ponerla.

### Qué es obligatorio y qué no

| Variable | ¿Obligatoria? | Si falta |
|---|---|---|
| `PUBLIC_URL`, `DATABASE_URL`, `REDIS_URL`, `ENCRYPTION_KEY` | **Sí** | La app no arranca y dice cuál falta |
| Una clave de IA | Sí, en la práctica | No se puede escribir ningún guion |
| `PEXELS_API_KEY` o `PIXABAY_API_KEY` | Sí, en la práctica | No hay clips y la historia falla |
| `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` | No | Creas el usuario a mano por Shell |
| `API_TOKEN` | No | El servidor MCP no puede conectarse |
| TikTok, Reddit | No | Esas funciones quedan apagadas |

### Guardar variables cifradas (opcional)

Cualquier variable sensible admite el formato `enc:...`:

```bash
ENCRYPTION_KEY=tu_clave node dist/scripts/cifrar-secreto.js
```

Pega el resultado completo, con el prefijo `enc:` incluido. Si el descifrado
falla, la app no arranca y el registro dice **qué** variable falla, nunca su
valor. Ten presente que `ENCRYPTION_KEY` vive en el mismo panel, así que esto
protege contra capturas y volcados de configuración, no contra alguien que ya
tiene acceso al servidor.

---

## 8. Volumen de datos

Pestaña **Storage** → **Add Mount**:

| Campo | Valor |
|---|---|
| Type | **Volume** |
| Name | `datos` |
| Mount Path | `/data` |

Eso es todo: la app crea sola `videos/`, `trabajo/` y `musica/` dentro.

- `videos/` — los MP4 terminados, que se sirven en la descarga.
- `trabajo/` — carpeta temporal de cada render; se borra al terminar.
- `musica/` — las pistas de fondo que tú subas.

**Sin este volumen los vídeos se pierden en cada despliegue.** El contenedor
corre como usuario `node`; si alguna vez ves errores de permisos al escribir,
es ahí donde hay que mirar.

---

## 9. Dominio y HTTPS

Pestaña **Domains** → **Add Domain**:

| Campo | Valor |
|---|---|
| Host | `estudio.tudominio.com` |
| HTTPS | **activado** |
| Port | **3000** |
| Primary | **sí** |

El puerto 3000 es el que escucha la app dentro del contenedor; el proxy de
Easypanel se encarga del 443 y del certificado. Marcarlo como *Primary* es lo
que hace que `$(PRIMARY_DOMAIN)` tenga valor.

Opcional pero recomendable mientras pruebas: en **Security**, activa **HTTP
Basic Auth**. Es una capa extra del proxy, delante del login de la app; no lo
sustituye.

---

## 10. Recursos y despliegue

En **Resources**, pon un techo para que un render no ahogue al resto del
servidor:

- Memoria: **3072 MB**
- CPU: **1.5** núcleos

Ahora pulsa **Deploy** y mira la salida:

- Si falla **durante el build**, el problema está en el Dockerfile o en las
  dependencias.
- Si falla **después**, míralo en **Logs** del servicio: casi siempre es una
  variable de entorno.

La primera construcción tarda varios minutos (instala ffmpeg y compila el
frontend).

---

## 11. Primer arranque

Abre la **Shell** del servicio `app`.

**Opción A, login maestro (recomendada).** Genera el hash:

```bash
node dist/scripts/cifrar-secreto.js --password
```

Copia la línea `ADMIN_PASSWORD_HASH=...` completa, pégala en **Environment** y
vuelve a desplegar. En cada arranque la app crea o actualiza ese usuario.

**Opción B, a mano.** Un usuario normal, sin tocar variables:

```bash
node dist/scripts/crear-admin.js
```

Comprueba que el volumen se puede escribir:

```bash
touch /data/prueba && ls -la /data && rm /data/prueba
```

Y que la app responde:

```bash
curl -s localhost:3000/api/salud     # {"ok":true}
```

Entra a `https://estudio.tudominio.com`, inicia sesión y crea una serie de
prueba con un horario cercano para ver el ciclo completo.

---

## 12. Ajustes finales

**Auto Deploy.** Actívalo para que cada push a la rama despliegue solo. La URL
de despliegue lleva un token secreto dentro: no la compartas.

**Música de fondo.** Sube tus pistas con licencia libre al volumen:

```bash
# desde tu máquina
scp pista.mp3 usuario@servidor:/var/lib/docker/volumes/<volumen>/_data/musica/
```

Si no encuentras la ruta del volumen, súbelas a cualquier sitio del servidor y
muévelas desde la Shell del servicio a `/data/musica`. Aparecerán en el selector
de música del editor y de las series.

**TikTok.** En developers.tiktok.com registra la app y pon como redirección
exactamente:

```
https://estudio.tudominio.com/api/tiktok/callback
```

Copia `Client key` y `Client secret` a las variables. Luego, en **Ajustes** de
la app, pulsa *Conectar cuenta de TikTok*.

Los permisos que se piden salen de `TIKTOK_SCOPES`; por defecto
`user.info.basic,video.upload,video.list`. Añade `video.publish` solo cuando
TikTok te apruebe la publicación directa. **Si cambias esa variable tienes que
volver a conectar la cuenta**: los permisos se fijan en el momento de autorizar,
no se amplían solos. Detalles del flujo y de los tipos de cuenta en
[`tiktok.md`](tiktok.md).

**Servidor MCP.** En tu máquina, con el repo clonado y compilado:

```json
{
  "mcpServers": {
    "estudio": {
      "command": "node",
      "args": ["/ruta/al/repo/dist/mcp/servidor.js"],
      "env": {
        "ESTUDIO_URL": "https://estudio.tudominio.com",
        "ESTUDIO_TOKEN": "el mismo valor que API_TOKEN"
      }
    }
  }
}
```

**Copias de seguridad.** En **Storage**, programa copias del volumen `datos`
hacia un proveedor externo, y copias de Postgres. Haz **una restauración de
prueba**: una copia que nunca se ha restaurado no es una copia.

---

## 13. Si algo falla

| Síntoma | Causa habitual |
|---|---|
| `Configuracion invalida. Revisa las variables de entorno` | Falta una de las cuatro obligatorias. El propio mensaje las lista. |
| `ENCRYPTION_KEY debe ser base64 de 32 bytes` | Se generó con otro comando. Usa `openssl rand -base64 32`. |
| `ADMIN_PASSWORD_HASH: must start with "$argon2"` | El valor no es un hash. Genéralo con `node dist/scripts/cifrar-secreto.js --password` y pega la línea entera, o deja la variable en blanco. |
| `API_TOKEN: at least 32 character(s)` | Token demasiado corto. Usa `openssl rand -hex 32`, o déjalo en blanco si no usas el servidor MCP. |
| `No se pudieron descifrar las variables (...)` | La `ENCRYPTION_KEY` no es la misma con la que cifraste. |
| No conecta a la base de datos | El host es `<proyecto>_<servicio>`, no `localhost`. Revisa el nombre del proyecto. |
| El certificado no se emite | El DNS todavía no apunta al servidor, o no propagó. |
| La web carga pero da 502 | El dominio apunta a un puerto que no es el 3000. |
| Las historias quedan en `ERROR` con "Sin clips" | Faltan `PEXELS_API_KEY` y `PIXABAY_API_KEY`. |
| `El video compilado pesa X MB y supera el limite` | Sube `MAX_VIDEO_MB` o acorta la duración de la serie. |
| Los vídeos desaparecen al desplegar | Falta el volumen en `/data`. |
| Permisos al escribir en `/data` | El proceso corre como `node`; revisa el propietario del volumen. |
