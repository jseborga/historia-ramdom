-- CreateEnum
CREATE TYPE "EstadoIdea" AS ENUM ('PENDIENTE', 'USADA', 'DESCARTADA');

-- CreateEnum
CREATE TYPE "FuenteIdea" AS ENUM ('MANUAL', 'IA', 'REDDIT');

-- CreateEnum
CREATE TYPE "ModoMusica" AS ENUM ('FIJA', 'ROTAR');

-- CreateEnum
CREATE TYPE "FuenteMetrica" AS ENUM ('API', 'MANUAL');

-- AlterTable
ALTER TABLE "Serie" ADD COLUMN     "idioma" TEXT NOT NULL DEFAULT 'es',
ADD COLUMN     "musicaModo" "ModoMusica" NOT NULL DEFAULT 'FIJA';

-- AlterTable
ALTER TABLE "Historia" ADD COLUMN     "ganchoId" TEXT,
ADD COLUMN     "musica" TEXT,
ADD COLUMN     "ganchoTexto" TEXT,
ADD COLUMN     "ideaId" TEXT,
ADD COLUMN     "videoTikTok" TEXT;

-- CreateTable
CREATE TABLE "Idea" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "tema" TEXT NOT NULL,
    "idioma" TEXT NOT NULL DEFAULT 'es',
    "fuente" "FuenteIdea" NOT NULL DEFAULT 'MANUAL',
    "refExterna" TEXT,
    "notas" TEXT,
    "estado" "EstadoIdea" NOT NULL DEFAULT 'PENDIENTE',
    "puntuacion" DOUBLE PRECISION,
    "usos" INTEGER NOT NULL DEFAULT 0,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Idea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gancho" (
    "id" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "idioma" TEXT NOT NULL DEFAULT 'es',
    "usos" INTEGER NOT NULL DEFAULT 0,
    "puntuacion" DOUBLE PRECISION,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Gancho_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Metrica" (
    "id" TEXT NOT NULL,
    "historiaId" TEXT NOT NULL,
    "vistas" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comentarios" INTEGER NOT NULL DEFAULT 0,
    "compartidos" INTEGER NOT NULL DEFAULT 0,
    "guardados" INTEGER NOT NULL DEFAULT 0,
    "duracionSeg" DOUBLE PRECISION,
    "tiempoPromedioSeg" DOUBLE PRECISION,
    "puntuacion" DOUBLE PRECISION,
    "fuente" "FuenteMetrica" NOT NULL DEFAULT 'MANUAL',
    "actualizadaEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Metrica_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Idea_refExterna_key" ON "Idea"("refExterna");

-- CreateIndex
CREATE INDEX "Idea_estado_puntuacion_idx" ON "Idea"("estado", "puntuacion");

-- CreateIndex
CREATE INDEX "Idea_idioma_idx" ON "Idea"("idioma");

-- CreateIndex
CREATE INDEX "Gancho_puntuacion_idx" ON "Gancho"("puntuacion");

-- CreateIndex
CREATE UNIQUE INDEX "Gancho_texto_idioma_key" ON "Gancho"("texto", "idioma");

-- CreateIndex
CREATE UNIQUE INDEX "Metrica_historiaId_key" ON "Metrica"("historiaId");

-- CreateIndex
CREATE INDEX "Metrica_puntuacion_idx" ON "Metrica"("puntuacion");

-- AddForeignKey
ALTER TABLE "Historia" ADD CONSTRAINT "Historia_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Historia" ADD CONSTRAINT "Historia_ganchoId_fkey" FOREIGN KEY ("ganchoId") REFERENCES "Gancho"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Metrica" ADD CONSTRAINT "Metrica_historiaId_fkey" FOREIGN KEY ("historiaId") REFERENCES "Historia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

