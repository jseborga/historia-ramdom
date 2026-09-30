-- Producciones con IA de vídeo: tráileres de obras que no existen (y, después,
-- miniseries). Los vídeos se generan fuera, en Veo, con los prompts que da la
-- app, y se suben a la Galería; aquí se guarda la biblia, los personajes con
-- su ficha fija y el estado de cada plano.
CREATE TYPE "TipoProduccion" AS ENUM ('TRAILER', 'MINISERIE');
CREATE TYPE "EstadoPlano" AS ENUM ('PENDIENTE', 'PROMPT_COPIADO', 'SUBIDO', 'APROBADO', 'REGENERAR');

CREATE TABLE "Produccion" (
    "id" TEXT NOT NULL,
    "tipo" "TipoProduccion" NOT NULL DEFAULT 'TRAILER',
    "obra" TEXT NOT NULL DEFAULT 'pelicula',
    "idea" TEXT NOT NULL DEFAULT '',
    "titulo" TEXT NOT NULL,
    "logline" TEXT NOT NULL DEFAULT '',
    "genero" TEXT NOT NULL DEFAULT '',
    "formato" TEXT NOT NULL DEFAULT 'tiktok',
    "estilo" TEXT NOT NULL DEFAULT '',
    "idioma" TEXT NOT NULL DEFAULT 'es',
    "pitch" JSONB,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editadaEn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Produccion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Produccion_creadaEn_idx" ON "Produccion"("creadaEn");

CREATE TABLE "Personaje" (
    "id" TEXT NOT NULL,
    "produccionId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "nombre" TEXT NOT NULL,
    "papel" TEXT NOT NULL DEFAULT '',
    "ficha" TEXT NOT NULL DEFAULT '',
    "voz" TEXT NOT NULL DEFAULT '',
    "medioId" TEXT,
    CONSTRAINT "Personaje_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Personaje_produccionId_orden_idx" ON "Personaje"("produccionId", "orden");
ALTER TABLE "Personaje" ADD CONSTRAINT "Personaje_produccionId_fkey" FOREIGN KEY ("produccionId") REFERENCES "Produccion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Plano" (
    "id" TEXT NOT NULL,
    "produccionId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "episodio" INTEGER NOT NULL DEFAULT 1,
    "tipo" TEXT NOT NULL DEFAULT 'veo',
    "parte" TEXT NOT NULL DEFAULT '',
    "duracion" INTEGER NOT NULL DEFAULT 8,
    "accion" TEXT NOT NULL DEFAULT '',
    "camara" TEXT NOT NULL DEFAULT '',
    "sonido" TEXT NOT NULL DEFAULT '',
    "dialogo" JSONB NOT NULL DEFAULT '[]',
    "personajes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "continua" BOOLEAN NOT NULL DEFAULT false,
    "rotulo" TEXT NOT NULL DEFAULT '',
    "momentoTrailer" BOOLEAN NOT NULL DEFAULT true,
    "estado" "EstadoPlano" NOT NULL DEFAULT 'PENDIENTE',
    "medioId" TEXT,
    "nota" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "Plano_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Plano_produccionId_orden_idx" ON "Plano"("produccionId", "orden");
ALTER TABLE "Plano" ADD CONSTRAINT "Plano_produccionId_fkey" FOREIGN KEY ("produccionId") REFERENCES "Produccion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
