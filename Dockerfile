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
      ffmpeg espeak-ng openssl ca-certificates tini \
      fonts-dejavu-core fonts-liberation2 fonts-lato fonts-open-sans fonts-roboto \
    && rm -rf /var/lib/apt/lists/*
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
