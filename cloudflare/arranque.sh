#!/bin/sh
# Arranque del estudio en Cloudflare Containers.
#
# El disco del contenedor se borra cada vez que se duerme, así que lo que tiene
# que durar (vídeos, música, biblioteca, proyectos) vive en un bucket de R2
# montado en DATA_DIR con tigrisfs. El trabajo de ffmpeg, que escribe y borra
# sin parar, va al disco local (TRABAJO_DIR), que es mucho más rápido.
#
# Corre como root solo para montar; la app baja al usuario `node`.
# R2_ENDPOINT cambia el destino (otro S3, o un MinIO para probar en local).
set -eu

: "${R2_BUCKET:?Falta R2_BUCKET}"
: "${R2_ACCOUNT_ID:?Falta R2_ACCOUNT_ID}"
: "${R2_ACCESS_KEY_ID:?Falta R2_ACCESS_KEY_ID}"
: "${R2_SECRET_ACCESS_KEY:?Falta R2_SECRET_ACCESS_KEY}"

DATA_DIR="${DATA_DIR:-/data}"
TRABAJO_DIR="${TRABAJO_DIR:-/tmp/trabajo}"
export DATA_DIR TRABAJO_DIR
mkdir -p "$DATA_DIR" "$TRABAJO_DIR"
chown node:node "$TRABAJO_DIR"

# Las credenciales van a un archivo que solo lee root: por variables de
# entorno, tigrisfs escribe la clave de acceso en el registro.
CREDENCIALES=/run/r2/credenciales
(
  umask 077
  mkdir -p /run/r2
  printf '[default]\naws_access_key_id = %s\naws_secret_access_key = %s\n' \
    "$R2_ACCESS_KEY_ID" "$R2_SECRET_ACCESS_KEY" > "$CREDENCIALES"
)

# tigrisfs sigue como root (--setuid/--setgid 0); los archivos aparecen como
# del usuario `node` (--uid/--gid), que es con el que corre la app.
env -u R2_ACCESS_KEY_ID -u R2_SECRET_ACCESS_KEY AWS_SHARED_CREDENTIALS_FILE="$CREDENCIALES" \
  /usr/local/bin/tigrisfs \
  --endpoint "${R2_ENDPOINT:-https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com}" \
  --region auto \
  --uid 1000 --gid 1000 --setuid 0 --setgid 0 \
  --memory-limit "${R2_CACHE_MB:-512}" \
  -o allow_other \
  -f "$R2_BUCKET" "$DATA_DIR" &
FUSE_PID=$!

# Esperar al montaje: sin esto la app arrancaría sobre una carpeta vacía y
# creería que no hay nada guardado.
intento=0
until mountpoint -q "$DATA_DIR"; do
  if ! kill -0 "$FUSE_PID" 2>/dev/null; then
    echo "tigrisfs terminó antes de montar R2: revisa R2_BUCKET y las claves" >&2
    exit 1
  fi
  intento=$((intento + 1))
  if [ "$intento" -ge 60 ]; then
    echo "R2 no se montó en 60 s" >&2
    exit 1
  fi
  sleep 1
done
echo "R2 montado en $DATA_DIR"

# Las credenciales de R2 no le hacen falta a la app.
unset R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY

cd /app
setpriv --reuid=node --regid=node --init-groups \
  env HOME=/home/node sh -c 'npx prisma migrate deploy && exec node dist/index.js' &
APP_PID=$!

# Al pedir que pare (el contenedor se duerme o se redespliega): primero la app,
# que cierra la cola y suelta los archivos; después, desmontar R2 para que
# termine de subir lo que tuviera pendiente.
parar() {
  kill -TERM "$APP_PID" 2>/dev/null || true
  wait "$APP_PID" 2>/dev/null || true
  fusermount3 -u "$DATA_DIR" 2>/dev/null || umount "$DATA_DIR" 2>/dev/null || true
  wait "$FUSE_PID" 2>/dev/null || true
  exit 0
}
trap parar TERM INT

wait "$APP_PID"
codigo=$?
fusermount3 -u "$DATA_DIR" 2>/dev/null || true
exit "$codigo"
