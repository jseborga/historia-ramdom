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
# espeak-ng: voz local por defecto, sin clave ni red.
# Las fuentes son las que ofrece el editor para los rotulos.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg espeak-ng mbrola mbrola-es1 mbrola-es2 mbrola-mx1 mbrola-mx2 mbrola-vz1 \
      openssl ca-certificates tini curl \
      fonts-dejavu-core fonts-liberation2 fonts-lato fonts-open-sans fonts-roboto \
    && rm -rf /var/lib/apt/lists/*

# Piper: voz neural local, la menos robotica sin pagar. Binario + dos voces en espanol.
ARG PIPER_VERSION=2023.11.14-2
RUN mkdir -p /opt/piper/voces \
    && curl -sSL "https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_x86_64.tar.gz" \
       | tar -xz -C /opt/piper --strip-components=1 \
    && for v in es/es_MX/claude/high/es_MX-claude-high es/es_ES/davefx/medium/es_ES-davefx-medium; do \
         n=$(basename "$v"); \
         curl -sSL -o "/opt/piper/voces/$n.onnx" "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/$v.onnx"; \
         curl -sSL -o "/opt/piper/voces/$n.onnx.json" "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/$v.onnx.json"; \
       done
ENV PIPER_BIN=/opt/piper/piper PIPER_VOCES=/opt/piper/voces
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/web/dist ./web/dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/fonts ./fonts
RUN mkdir -p /data/videos /data/trabajo /data/musica && chown -R node:node /data
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
