# ---- Etapa de construccion ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build && npm prune --omit=dev

# ---- Imagen final ----
FROM node:22-bookworm-slim
# Todo esto esta en Debian "main": ffmpeg, espeak-ng (voz robotica de respaldo)
# y las fuentes de los rotulos.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg espeak-ng openssl ca-certificates tini curl \
      fonts-dejavu-core fonts-liberation2 fonts-lato \
    && (apt-get install -y --no-install-recommends fonts-open-sans fonts-roboto || true) \
    && rm -rf /var/lib/apt/lists/*

# MBROLA es OPCIONAL y viene apagado: sus voces son "non-free" en Debian y su
# licencia prohibe venderlas o meterlas en un producto que se venda sin permiso.
# Para un canal monetizado usa Piper (mas abajo), que es Apache-2.0 / CC0.
# Activalo solo si te sirve:  --build-arg CON_MBROLA=true
ARG CON_MBROLA=false
RUN if [ "$CON_MBROLA" = "true" ]; then \
      ( sed -i 's/^Components: main$/Components: main contrib non-free non-free-firmware/' /etc/apt/sources.list.d/debian.sources 2>/dev/null \
        || sed -i 's/ main$/ main contrib non-free non-free-firmware/' /etc/apt/sources.list ) \
      && apt-get update \
      && apt-get install -y --no-install-recommends mbrola mbrola-es1 mbrola-es2 mbrola-mx1 mbrola-mx2 mbrola-vz1 \
      && rm -rf /var/lib/apt/lists/*; \
    fi

# Piper: voz neural local, la menos robotica sin pagar y con licencia apta para
# uso comercial (es_MX claude: Apache-2.0; es_ES davefx: CC0). Binario + dos voces.
ARG PIPER_VERSION=2023.11.14-2
RUN mkdir -p /opt/piper/voces \
    && curl -sSL "https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_x86_64.tar.gz" \
       | tar -xz -C /opt/piper --strip-components=1 \
    && for v in es/es_MX/claude/high/es_MX-claude-high es/es_ES/davefx/medium/es_ES-davefx-medium \
                es/es_AR/daniela/high/es_AR-daniela-high en/en_US/lessac/medium/en_US-lessac-medium; do \
         n=$(basename "$v"); \
         curl -sSL -o "/opt/piper/voces/$n.onnx" "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/$v.onnx"; \
         curl -sSL -o "/opt/piper/voces/$n.onnx.json" "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/$v.onnx.json"; \
       done
ENV PIPER_BIN=/opt/piper/piper PIPER_VOCES=/opt/piper/voces

# Cloudflare Containers: el disco del contenedor se borra cada vez que duerme,
# así que /data es un bucket de R2 montado con FUSE (tigrisfs). Solo se
# instala en esa imagen: --build-arg CON_R2=true (lo pone cloudflare/wrangler.jsonc).
ARG CON_R2=false
ARG TIGRISFS_VERSION=1.2.1
RUN if [ "$CON_R2" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends fuse3 \
      && rm -rf /var/lib/apt/lists/* \
      && curl -fsSL "https://github.com/tigrisdata/tigrisfs/releases/download/v${TIGRISFS_VERSION}/tigrisfs_${TIGRISFS_VERSION}_linux_amd64.tar.gz" \
         | tar -xz -C /usr/local/bin tigrisfs \
      && chmod +x /usr/local/bin/tigrisfs; \
    fi
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/web/dist ./web/dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/fonts ./fonts
COPY --from=build --chown=node:node /app/biblia ./biblia
COPY --chown=node:node cloudflare/arranque.sh ./cloudflare/arranque.sh
RUN mkdir -p /data/videos /data/trabajo /data/musica && chown -R node:node /data
# En Cloudflare arranca como root solo para montar R2; el script baja a `node`
# antes de lanzar la app. En Easypanel, `node` desde el principio.
ARG USUARIO=node
USER ${USUARIO}
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
