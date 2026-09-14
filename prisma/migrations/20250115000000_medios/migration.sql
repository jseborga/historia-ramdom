-- Biblioteca de vídeo y foto: lo que se sube y lo que se guarda de los bancos,
-- para componer vídeos sin volver a buscar.
CREATE TYPE "ClaseMedio" AS ENUM ('VIDEO', 'IMAGEN');

CREATE TABLE "Medio" (
  "id" TEXT NOT NULL,
  "clase" "ClaseMedio" NOT NULL,
  "archivo" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "fuente" TEXT NOT NULL DEFAULT 'subido',
  "autor" TEXT,
  "pagina" TEXT,
  "licencia" TEXT,
  "externoId" TEXT,
  "duracion" DOUBLE PRECISION,
  "ancho" INTEGER,
  "alto" INTEGER,
  "bytes" DOUBLE PRECISION,
  "etiquetas" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Medio_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Medio_archivo_key" ON "Medio"("archivo");
CREATE INDEX "Medio_clase_creadoEn_idx" ON "Medio"("clase", "creadoEn");
CREATE INDEX "Medio_externoId_idx" ON "Medio"("externoId");
