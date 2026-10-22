-- AlterTable
ALTER TABLE "ReferenciaBiblica" ADD COLUMN "visual" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "CitaPensador" (
    "id" TEXT NOT NULL,
    "autor" TEXT NOT NULL,
    "obra" TEXT NOT NULL DEFAULT '',
    "ubicacion" TEXT NOT NULL DEFAULT '',
    "texto" TEXT NOT NULL,
    "temas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contexto" TEXT NOT NULL DEFAULT '',
    "remate" TEXT NOT NULL DEFAULT '',
    "visual" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "verificada" BOOLEAN NOT NULL DEFAULT false,
    "fuente" "FuenteIdea" NOT NULL DEFAULT 'MANUAL',
    "usos" INTEGER NOT NULL DEFAULT 0,
    "usadaEn" TIMESTAMP(3),
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editadaEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CitaPensador_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CitaPensador_autor_texto_key" ON "CitaPensador"("autor", "texto");

-- CreateIndex
CREATE INDEX "CitaPensador_autor_idx" ON "CitaPensador"("autor");
